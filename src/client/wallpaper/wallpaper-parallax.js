import { wallpaperFilters } from '../../shared/wallpaper-filter.js';
import { wallpaperGeometry } from './wallpaper-alignment.js';

export const DEFAULT_PARALLAX_STRENGTH = 45;
export const PARALLAX_MODES = Object.freeze(['depth', 'sharp']);

export function normalizeParallaxStrength(value) {
  return Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : DEFAULT_PARALLAX_STRENGTH;
}

export function normalizeParallax(input) {
  return {
    parallaxMode: PARALLAX_MODES.includes(input?.parallaxMode) ? input.parallaxMode : 'depth',
    parallaxStrength: input?.parallax === false ? 0 : normalizeParallaxStrength(input?.parallaxStrength),
  };
}

export function isParallaxModeAvailable(meta, mode) {
  return Array.isArray(meta?.parallaxModes) && meta.parallaxModes.includes(mode);
}

export function parallaxDataUrl(imageUrl, mode) {
  if (typeof imageUrl !== 'string' || imageUrl.length > 300) return '';
  if (!/^\/bing-daily-theme\/api\/image\?(?:market=en-US&)?(?:resolution=(?:2k|4k)&)?id=OHR\.[A-Za-z0-9][A-Za-z0-9_-]*_1920x1080\.jpg$/.test(imageUrl)) return '';
  if (!PARALLAX_MODES.includes(mode)) return '';
  return imageUrl.replace('/api/image?', mode === 'depth' ? '/api/depth?' : '/api/scene?');
}

export async function decodeWallpaperImage(url, signal) {
  signal.throwIfAborted();
  const image = new Image();
  let onAbort;
  try {
    image.src = url;
    await Promise.race([image.decode(), new Promise((_, reject) => {
      onAbort = () => {
        image.removeAttribute?.('src');
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    })]);
    signal.throwIfAborted();
    return image;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export function parallaxMotion(target, current, dtMs) {
  const factor = 1 - Math.exp(-Math.min(Math.max(dtMs, 0), 50) * 0.012);
  const x = current.x + (target.x - current.x) * factor;
  const y = current.y + (target.y - current.y) * factor;
  const settled = Math.abs(target.x - x) < 0.0005 && Math.abs(target.y - y) < 0.0005;
  return settled ? { ...target, settled } : { x, y, settled };
}

function sidebarBleed(settings, key) {
  const sidebar = settings?.[key];
  if (!sidebar || sidebar.background === 'theme') return 0;
  return wallpaperFilters.effect(sidebar.filterMode === 'inherit' ? settings : sidebar)?.bleed || 0;
}

function observeFramePointers(document, window, onMove, onLeave) {
  const frames = new Map();
  const pointerOptions = { passive: true, capture: true };

  function syncFrame(frame) {
    const child = frame.contentDocument;
    const previous = frames.get(frame);
    if (previous?.document === child) return;
    previous?.dispose();
    frames.delete(frame);
    if (!child) return;

    const move = event => {
      const { left, top, width, height } = frame.getBoundingClientRect();
      const { clientLeft, clientTop, offsetWidth, offsetHeight } = frame;
      if (!width || !height || !offsetWidth || !offsetHeight) return;
      onMove({
        clientX: left + (clientLeft + event.clientX) * width / offsetWidth,
        clientY: top + (clientTop + event.clientY) * height / offsetHeight,
      });
    };
    const leave = event => {
      if (event.target === child.documentElement) onLeave();
    };
    child.addEventListener('pointermove', move, pointerOptions);
    child.addEventListener('pointerleave', leave, pointerOptions);
    const stopNested = observeFramePointers(child, window, move, onLeave);
    frames.set(frame, { document: child, dispose() {
      child.removeEventListener('pointermove', move, pointerOptions);
      child.removeEventListener('pointerleave', leave, pointerOptions);
      stopNested();
    } });
  }

  function syncFrames() {
    const present = new Set(document.querySelectorAll('iframe'));
    for (const [frame, tracked] of frames) {
      if (present.has(frame)) continue;
      tracked.dispose();
      frames.delete(frame);
    }
    for (const frame of present) syncFrame(frame);
  }

  // A navigation can replace the child document without changing the frame element.
  const onLoad = event => { if (event.target.localName === 'iframe') syncFrame(event.target); };
  document.addEventListener('load', onLoad, true);
  const containsFrame = node => node.nodeType === 1 && (node.localName === 'iframe' || node.querySelector('iframe'));
  const observer = typeof window.MutationObserver === 'function' ? new window.MutationObserver(records => {
    if (records.some(({ addedNodes, removedNodes }) => [...addedNodes, ...removedNodes].some(containsFrame))) syncFrames();
  }) : null;
  if (observer) observer.observe(document, { childList: true, subtree: true });
  syncFrames();
  return () => {
    observer?.disconnect();
    document.removeEventListener('load', onLoad, true);
    for (const tracked of frames.values()) tracked.dispose();
    frames.clear();
  };
}

export function mountParallaxWallpaper({
  document, window, url, photo, dataUrl, imageWidth, imageHeight, settings, createRenderer, fetchImpl = globalThis.fetch,
}) {
  const root = document.documentElement;
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const lifetime = new AbortController();
  let config = { imageWidth, imageHeight, settings };
  let strength = normalizeParallaxStrength(settings?.parallaxStrength) / 100;
  let stopFramePointers;
  let canvas, renderer, layout, crops, initializationStarted = false, failed = false, active = false;
  let frame = 0, startFrame = 0, lastFrameTime = 0, lastPointerTime = 0, gyroBase;
  let target = { x: 0, y: 0 }, offset = { x: 0, y: 0 };

  function canDraw() {
    return strength > 0 && !lifetime.signal.aborted && !document.hidden && !media?.matches && !failed;
  }

  function setActive(next) {
    if (active === next) return;
    active = next;
    if (next) root.setAttribute('data-bdt-parallax-active', '');
    else root.removeAttribute('data-bdt-parallax-active');
    if (canvas) canvas.style.display = next ? 'block' : 'none';
  }

  function resetMotion() {
    if (frame) window.cancelAnimationFrame(frame);
    if (startFrame) window.cancelAnimationFrame(startFrame);
    frame = 0;
    startFrame = 0;
    lastFrameTime = 0;
    target = { x: 0, y: 0 };
    offset = { x: 0, y: 0 };
    gyroBase = undefined;
  }

  function hide() {
    resetMotion();
    setActive(false);
    for (const element of document.querySelectorAll('[data-bdt-sidebar-canvas]')) element.remove();
    crops = undefined;
  }

  function disposeRenderer() {
    hide();
    stopFramePointers?.();
    stopFramePointers = undefined;
    renderer?.dispose();
    renderer = undefined;
    canvas?.removeEventListener('webglcontextlost', onContextLost);
    canvas?.remove();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    canvas = undefined;
  }

  function fail() {
    failed = true;
    lifetime.abort();
    disposeRenderer();
  }

  function measure() {
    const look = wallpaperFilters.effect(config.settings);
    const bleed = Math.max(look?.bleed || 0, sidebarBleed(config.settings, 'leftSidebar'), sidebarBleed(config.settings, 'rightSidebar'));
    const width = Math.max(1, window.innerWidth || 1), height = Math.max(1, window.innerHeight || 1);
    const renderWidth = width + 2 * bleed, renderHeight = height + 2 * bleed;
    const geometry = wallpaperGeometry(width, height, config.imageWidth, config.imageHeight);
    // At source density, each visible source pixel maps to one SHARP canvas pixel.
    const dpr = renderer.sourceWidth
      ? Math.min(renderer.sourceWidth / geometry.width, renderer.maxCanvasSide / Math.max(renderWidth, renderHeight))
      : Math.min(window.devicePixelRatio || 1, 2, Math.sqrt((renderer.maxPixels ?? Infinity) / (renderWidth * renderHeight)));
    const pixelWidth = Math.max(1, Math.round(renderWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(renderHeight * dpr));
    layout = { geometry, renderWidth, renderHeight, pixelWidth, pixelHeight, bleed, dpr };

    canvas.style.inset = bleed ? `-${bleed}px` : '0';
    canvas.style.width = `${renderWidth}px`;
    canvas.style.height = `${renderHeight}px`;
    canvas.style.filter = look?.filter || 'none';
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    crops = undefined;
  }

  function measureSidebarCrops() {
    const { renderWidth, renderHeight, pixelWidth, pixelHeight, bleed, dpr } = layout;
    const scaleX = pixelWidth / renderWidth, scaleY = pixelHeight / renderHeight;
    const measured = [];
    for (const layer of document.querySelectorAll('[data-bdt-sidebar-background]')) {
      const photoElement = layer.querySelector('[data-bdt-sidebar-image]');
      if (!photoElement) continue;
      let side = photoElement.querySelector('[data-bdt-sidebar-canvas]');
      if (window.getComputedStyle?.(layer).visibility === 'hidden') { side?.remove(); continue; }
      const rect = photoElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (!side) {
        side = document.createElement('canvas');
        side.setAttribute('data-bdt-sidebar-canvas', '');
        side.setAttribute('aria-hidden', 'true');
        photoElement.prepend(side);
      }
      const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
      if (side.width !== width) side.width = width;
      if (side.height !== height) side.height = height;
      const context = side.getContext('2d');
      if (!context) continue;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      const x = (rect.left + bleed) * scaleX, y = (rect.top + bleed) * scaleY;
      const w = rect.width * scaleX, h = rect.height * scaleY;
      const left = Math.max(0, x), top = Math.max(0, y);
      const sourceWidth = Math.min(pixelWidth, x + w) - left, sourceHeight = Math.min(pixelHeight, y + h) - top;
      const copy = sourceWidth > 0 && sourceHeight > 0 && [left, top, sourceWidth, sourceHeight,
        (left - x) * width / w, (top - y) * height / h, sourceWidth * width / w, sourceHeight * height / h];
      measured.push({ context, width, height, copy });
    }
    return measured;
  }

  function draw() {
    if (!layout) measure();
    renderer.draw({ ...layout, offset, strength });
    setActive(true);
    crops ??= measureSidebarCrops();
    for (const { context, width, height, copy } of crops) {
      context.clearRect(0, 0, width, height);
      if (copy) context.drawImage(canvas, ...copy);
    }
  }

  function step(now) {
    frame = 0;
    if (!canDraw() || !renderer) return;
    const dt = lastFrameTime ? now - lastFrameTime : 16;
    const next = parallaxMotion(target, offset, dt);
    offset = { x: next.x, y: next.y };
    lastFrameTime = next.settled ? 0 : now;
    try { draw(); } catch { fail(); return; }
    if (!next.settled) schedule();
  }

  function schedule() {
    if (canDraw() && renderer && !frame) frame = window.requestAnimationFrame(step);
  }

  async function initialize() {
    if (initializationStarted || !dataUrl || !canDraw()) return;
    initializationStarted = true;
    canvas = document.createElement('canvas');
    canvas.setAttribute('data-bdt-parallax-canvas', '');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'fixed', zIndex: '-3', pointerEvents: 'none', display: 'none' });
    canvas.addEventListener('webglcontextlost', onContextLost);
    try {
      const initialized = await createRenderer({
        document, window, canvas, photo, url, dataUrl, imageWidth, imageHeight,
        signal: lifetime.signal, fetchImpl, invalidate: schedule,
      });
      if (lifetime.signal.aborted) { initialized?.dispose(); return; }
      if (!initialized) { fail(); return; }
      renderer = initialized;
      stopFramePointers = observeFramePointers(document, window, onPointerMove, onPointerLeave);
      (document.body || root).prepend(canvas);
      schedule();
    } catch {
      if (!lifetime.signal.aborted) fail();
    }
  }

  function onContextLost(event) {
    event.preventDefault?.();
    fail();
  }

  function resumeOrPause() {
    if (!canDraw()) { hide(); return; }
    if (!initializationStarted && !startFrame && dataUrl) {
      // Give the static wallpaper and theme a paint before preparing GPU resources.
      startFrame = window.requestAnimationFrame(() => {
        startFrame = window.requestAnimationFrame(() => {
          startFrame = 0;
          void initialize();
        });
      });
    }
    schedule();
  }

  function move(x, y) {
    if (!canDraw()) return;
    const clamp = value => Math.max(-1, Math.min(1, value));
    const next = { x: clamp(x), y: clamp(y) };
    if (next.x === target.x && next.y === target.y) return;
    target = next;
    schedule();
  }

  function onPointerMove(event) {
    lastPointerTime = Date.now();
    move(event.clientX / Math.max(1, window.innerWidth || 1) * 2 - 1,
      event.clientY / Math.max(1, window.innerHeight || 1) * 2 - 1);
  }

  function onPointerLeave() { move(0, 0); }

  function onOrientation({ gamma, beta }) {
    if (!Number.isFinite(gamma) || !Number.isFinite(beta) || Date.now() - lastPointerTime < 500) return;
    gyroBase ??= { gamma, beta };
    move((gamma - gyroBase.gamma) / 20, (beta - gyroBase.beta) / 20);
  }

  function onResize() { layout = undefined; schedule(); }
  function syncSidebars() { crops = undefined; schedule(); }

  window.addEventListener('pointermove', onPointerMove, { passive: true, capture: true });
  root.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('blur', onPointerLeave);
  window.addEventListener('deviceorientation', onOrientation, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  media?.addEventListener?.('change', resumeOrPause);
  document.addEventListener('visibilitychange', resumeOrPause);
  resumeOrPause();

  return {
    update(next) {
      const changed = Object.entries(next).some(([key, value]) => config[key] !== value);
      if (!changed) return;
      config = { ...config, ...next };
      strength = normalizeParallaxStrength(config.settings?.parallaxStrength) / 100;
      layout = undefined;
      resumeOrPause();
    },
    syncSidebars,
    dispose() {
      lifetime.abort();
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      root.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('blur', onPointerLeave);
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('resize', onResize);
      media?.removeEventListener?.('change', resumeOrPause);
      document.removeEventListener('visibilitychange', resumeOrPause);
      disposeRenderer();
    },
  };
}
