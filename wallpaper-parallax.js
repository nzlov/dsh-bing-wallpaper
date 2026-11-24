import { wallpaperGeometry } from './wallpaper-alignment.js';
import { wallpaperFilters } from './wallpaper-filter.js';

export const DEFAULT_PARALLAX_STRENGTH = 45;

const DEPTH_MAGIC = [0x42, 0x44, 0x54, 0x44]; // "BDTD"
const DEPTH_HEADER_BYTES = 8;
const DEPTH_SMOOTH_SIGMA = 4.5;
const MAX_PARALLAX_SHIFT = 0.028;
const depthMemoryCache = new Map();

export function normalizeParallaxStrength(value) {
  return Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : DEFAULT_PARALLAX_STRENGTH;
}

export function normalizeParallax(input) {
  if (input?.parallax === false) return { parallaxStrength: 0 };
  return {
    parallaxStrength: normalizeParallaxStrength(input?.parallaxStrength),
  };
}

export function depthUrlFor(imageUrl) {
  if (typeof imageUrl !== 'string' || imageUrl.length > 300) return '';
  if (!/^\/bing-daily-theme\/api\/image\?(?:market=en-US&)?(?:resolution=(?:2k|4k)&)?id=OHR\.[A-Za-z0-9][A-Za-z0-9_-]*_1920x1080\.jpg$/.test(imageUrl)) {
    return '';
  }
  return imageUrl.replace('/bing-daily-theme/api/image?', '/bing-daily-theme/api/depth?');
}

export function decodeDepthPayload(input) {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes || bytes.byteLength <= DEPTH_HEADER_BYTES) return null;
  for (let i = 0; i < 4; i++) if (bytes[i] !== DEPTH_MAGIC[i]) return null;
  const width = (bytes[4] << 8) | bytes[5];
  const height = (bytes[6] << 8) | bytes[7];
  if (width < 1 || height < 1 || width > 4096 || height > 4096) return null;
  if (bytes.byteLength !== DEPTH_HEADER_BYTES + width * height) return null;
  return { width, height, data: bytes.subarray(DEPTH_HEADER_BYTES) };
}

/**
 * Separable Gaussian smoothing turns sharp single-image depth cliffs into
 * continuous slopes so UV warping never folds or tears along silhouettes.
 */
export function smoothDepthMap(src, width, height, sigma = DEPTH_SMOOTH_SIGMA) {
  const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height));
  if (!(src instanceof Uint8Array) || src.byteLength !== w * h) return src;
  const radius = Math.max(1, Math.min(24, Math.ceil(sigma * 2.5)));
  const kernel = new Float32Array(radius * 2 + 1);
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = weight;
    ksum += weight;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;

  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let i = -radius; i <= radius; i++) {
        const cx = Math.max(0, Math.min(w - 1, x + i));
        sum += src[row + cx] * kernel[i + radius];
      }
      tmp[row + x] = sum;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let i = -radius; i <= radius; i++) {
        const cy = Math.max(0, Math.min(h - 1, y + i));
        sum += tmp[cy * w + x] * kernel[i + radius];
      }
      out[y * w + x] = Math.max(0, Math.min(255, Math.round(sum)));
    }
  }
  return out;
}

export function clearDepthMemoryCache() {
  depthMemoryCache.clear();
}

export function parallaxMotion(target, current, dtMs) {
  const factor = 1 - Math.exp(-Math.min(Math.max(dtMs, 0), 50) * 0.012);
  let x = current.x + (target.x - current.x) * factor;
  let y = current.y + (target.y - current.y) * factor;
  const settled = Math.abs(target.x - x) < 0.0005 && Math.abs(target.y - y) < 0.0005;
  if (settled) { x = target.x; y = target.y; }
  return { x, y, settled };
}

const VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform sampler2D u_image;
uniform sampler2D u_depth;
uniform vec2 u_texSize;
uniform vec2 u_canvasSize;
uniform vec2 u_geomOrigin;
uniform vec2 u_geomSize;
uniform vec2 u_offset;
uniform float u_strength;
uniform float u_useBicubic;

// 5-tap hardware-bilinear Catmull-Rom bicubic reconstruction for crisp upscaling.
vec4 sampleBicubic(vec2 uv) {
  vec2 samplePos = uv * u_texSize;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;

  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);

  vec2 w12 = w1 + w2;
  vec2 offset12 = w2 / w12;

  vec2 invSize = 1.0 / u_texSize;
  vec2 minUv = invSize * 0.5;
  vec2 maxUv = 1.0 - minUv;
  vec2 texPos0 = clamp((texPos1 - 1.0) * invSize, minUv, maxUv);
  vec2 texPos3 = clamp((texPos1 + 2.0) * invSize, minUv, maxUv);
  vec2 texPos12 = clamp((texPos1 + offset12) * invSize, minUv, maxUv);

  float wtTop = w12.x * w0.y;
  float wtLeft = w0.x * w12.y;
  float wtCenter = w12.x * w12.y;
  float wtRight = w3.x * w12.y;
  float wtBottom = w12.x * w3.y;

  vec3 color =
    texture2D(u_image, vec2(texPos12.x, texPos0.y)).rgb * wtTop +
    texture2D(u_image, vec2(texPos0.x, texPos12.y)).rgb * wtLeft +
    texture2D(u_image, vec2(texPos12.x, texPos12.y)).rgb * wtCenter +
    texture2D(u_image, vec2(texPos3.x, texPos12.y)).rgb * wtRight +
    texture2D(u_image, vec2(texPos12.x, texPos3.y)).rgb * wtBottom;
  float totalWeight = wtTop + wtLeft + wtCenter + wtRight + wtBottom;
  return vec4(clamp(color / totalWeight, 0.0, 1.0), 1.0);
}

void main() {
  vec2 screenPos = v_uv * u_canvasSize;
  vec2 imgUv = (screenPos - u_geomOrigin) / u_geomSize;
  float zoom = 1.0 / (1.0 + u_strength * 1.05);
  vec2 baseUv = (imgUv - 0.5) * zoom + 0.5;
  vec2 maxShift = u_offset * u_strength;

  // Continuous fixed-point depth warp: smooth, invertible, and tear-free.
  vec2 uv = baseUv;
  for (int i = 0; i < 8; i++) {
    float d = texture2D(u_depth, clamp(uv, 0.002, 0.998)).r;
    vec2 nextUv = baseUv + maxShift * (d - 0.5);
    uv = mix(uv, nextUv, 0.65);
  }
  vec2 finalUv = clamp(uv, 0.0005, 0.9995);
  gl_FragColor = u_useBicubic > 0.5 ? sampleBicubic(finalUv) : texture2D(u_image, finalUv);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl) {
  const vert = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vert || !frag) {
    if (vert) gl.deleteShader(vert);
    if (frag) gl.deleteShader(frag);
    return null;
  }
  const program = gl.createProgram();
  if (!program) { gl.deleteShader(vert); gl.deleteShader(frag); return null; }
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function sidebarBleed(settings, sideKey) {
  const sidebar = settings?.[sideKey];
  if (!sidebar || sidebar.background === 'theme') return 0;
  const filterSource = sidebar.filterMode === 'inherit' ? settings : sidebar;
  return wallpaperFilters.effect(filterSource)?.bleed || 0;
}

async function fetchDepthMap(depthUrl, signal, fetchImpl) {
  const cached = depthMemoryCache.get(depthUrl);
  if (cached) return cached;
  const response = await fetchImpl(depthUrl, { credentials: 'same-origin', signal });
  if (!response.ok) return null;
  const decoded = decodeDepthPayload(await response.arrayBuffer());
  if (!decoded) return null;
  const smoothed = {
    width: decoded.width,
    height: decoded.height,
    data: smoothDepthMap(decoded.data, decoded.width, decoded.height, DEPTH_SMOOTH_SIGMA),
  };
  depthMemoryCache.delete(depthUrl);
  depthMemoryCache.set(depthUrl, smoothed);
  while (depthMemoryCache.size > 4) depthMemoryCache.delete(depthMemoryCache.keys().next().value);
  return smoothed;
}

export function mountParallaxWallpaper({
  document,
  window,
  url,
  photo,
  depthUrl,
  imageWidth,
  imageHeight,
  settings,
  fetchImpl = globalThis.fetch,
}) {
  const root = document.documentElement;
  let config = { imageWidth, imageHeight, settings };
  let disposed = false, ready = false, active = false, frame = 0, lastFrameTime = 0;
  let target = { x: 0, y: 0 }, current = { x: 0, y: 0 };
  let lastPointerTime = 0, gyroBase = null;
  let mainCanvas = null, gl = null, program = null, buffer = null, imageTex = null, depthTex = null;
  let locations = null, renderWidth = 0, renderHeight = 0, renderBleed = 0;
  let textureWidth = imageWidth || 1920, textureHeight = imageHeight || 1080, hasMipmaps = false, currentMinFilter = null;
  const abortController = new AbortController();

  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reducedMotion = Boolean(media?.matches);

  function setActive(next) {
    if (active === next) return;
    active = next;
    if (next) root.setAttribute('data-bdt-parallax-active', '');
    else root.removeAttribute('data-bdt-parallax-active');
  }

  function clearSidebarCanvases() {
    for (const canvas of document.querySelectorAll('[data-bdt-sidebar-canvas]')) canvas.remove();
  }

  function syncSidebars() {
    if (disposed || !active || !mainCanvas || !renderWidth || !renderHeight) {
      clearSidebarCanvases();
      return;
    }
    const vw = Math.max(1, window.innerWidth || 1);
    const vh = Math.max(1, window.innerHeight || 1);
    if (renderWidth !== vw + renderBleed * 2 || renderHeight !== vh + renderBleed * 2) {
      draw();
      return;
    }
    const scaleX = mainCanvas.width / renderWidth;
    const scaleY = mainCanvas.height / renderHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const layer of document.querySelectorAll('[data-bdt-sidebar-background]')) {
      const photoEl = layer.querySelector('[data-bdt-sidebar-image]');
      if (!photoEl) continue;
      if (window.getComputedStyle?.(layer).visibility === 'hidden') {
        photoEl.querySelector('[data-bdt-sidebar-canvas]')?.remove();
        continue;
      }
      const rect = photoEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      let sideCanvas = photoEl.querySelector('[data-bdt-sidebar-canvas]');
      if (!sideCanvas) {
        sideCanvas = document.createElement('canvas');
        sideCanvas.setAttribute('data-bdt-sidebar-canvas', '');
        sideCanvas.setAttribute('aria-hidden', 'true');
        photoEl.prepend(sideCanvas);
      }
      const tw = Math.max(1, Math.round(rect.width * dpr));
      const th = Math.max(1, Math.round(rect.height * dpr));
      if (sideCanvas.width !== tw || sideCanvas.height !== th) {
        sideCanvas.width = tw;
        sideCanvas.height = th;
      }
      const ctx = sideCanvas.getContext('2d');
      if (!ctx) continue;
      const sx = (rect.left + renderBleed) * scaleX;
      const sy = (rect.top + renderBleed) * scaleY;
      const sw = rect.width * scaleX;
      const sh = rect.height * scaleY;
      const csx = Math.max(0, sx), csy = Math.max(0, sy);
      const cex = Math.min(mainCanvas.width, sx + sw), cey = Math.min(mainCanvas.height, sy + sh);
      const csw = cex - csx, csh = cey - csy;
      ctx.clearRect(0, 0, tw, th);
      if (csw > 0 && csh > 0 && sw > 0 && sh > 0) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
          mainCanvas, csx, csy, csw, csh,
          ((csx - sx) / sw) * tw, ((csy - sy) / sh) * th, (csw / sw) * tw, (csh / sh) * th,
        );
      }
    }
  }

  function applyCanvasStyle() {
    if (!mainCanvas) return;
    const look = wallpaperFilters.effect(config.settings) || {};
    const mainBleed = look.bleed || 0;
    renderBleed = Math.max(mainBleed, sidebarBleed(config.settings, 'leftSidebar'), sidebarBleed(config.settings, 'rightSidebar'));
    const vw = Math.max(1, window.innerWidth || 1);
    const vh = Math.max(1, window.innerHeight || 1);
    const inset = renderBleed ? `-${renderBleed}px` : '0';
    mainCanvas.style.position = 'fixed';
    mainCanvas.style.inset = inset;
    mainCanvas.style.width = `${vw + renderBleed * 2}px`;
    mainCanvas.style.height = `${vh + renderBleed * 2}px`;
    mainCanvas.style.zIndex = '-3';
    mainCanvas.style.pointerEvents = 'none';
    mainCanvas.style.filter = look.filter || 'none';
  }

  function draw() {
    if (disposed || !ready || !gl || !mainCanvas || reducedMotion) return;
    applyCanvasStyle();
    const vw = Math.max(1, window.innerWidth || 1);
    const vh = Math.max(1, window.innerHeight || 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    renderWidth = vw + renderBleed * 2;
    renderHeight = vh + renderBleed * 2;
    const pixelW = Math.max(1, Math.round(renderWidth * dpr));
    const pixelH = Math.max(1, Math.round(renderHeight * dpr));
    if (mainCanvas.width !== pixelW || mainCanvas.height !== pixelH) {
      mainCanvas.width = pixelW;
      mainCanvas.height = pixelH;
    }
    const geom = wallpaperGeometry(vw, vh, config.imageWidth, config.imageHeight);
    const strength = (normalizeParallaxStrength(config.settings?.parallaxStrength) / 100) * MAX_PARALLAX_SHIFT;

    gl.viewport(0, 0, pixelW, pixelH);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(locations.pos);
    gl.vertexAttribPointer(locations.pos, 2, gl.FLOAT, false, 0, 0);

    const texelScale = (geom.width * dpr) / textureWidth;
    const useBicubic = !hasMipmaps || texelScale >= 0.95;
    const desiredMinFilter = useBicubic ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imageTex);
    if (currentMinFilter !== desiredMinFilter) {
      // Discontinuous floor() taps inside sampleBicubic would spike dFdx/dFdy
      // and select lower-resolution mip levels if LINEAR_MIPMAP_LINEAR stayed active.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, desiredMinFilter);
      currentMinFilter = desiredMinFilter;
    }
    gl.uniform1i(locations.image, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.uniform1i(locations.depth, 1);

    gl.uniform2f(locations.texSize, textureWidth, textureHeight);
    gl.uniform2f(locations.canvasSize, renderWidth, renderHeight);
    gl.uniform2f(locations.geomOrigin, geom.x + renderBleed, geom.y + renderBleed);
    gl.uniform2f(locations.geomSize, geom.width, geom.height);
    gl.uniform2f(locations.offset, current.x, current.y);
    gl.uniform1f(locations.strength, strength);
    gl.uniform1f(locations.useBicubic, useBicubic ? 1 : 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    setActive(true);
    syncSidebars();
  }

  function step(now) {
    frame = 0;
    if (disposed || !ready || reducedMotion) return;
    const dt = lastFrameTime ? now - lastFrameTime : 16;
    lastFrameTime = now;
    const next = parallaxMotion(target, current, dt);
    current = { x: next.x, y: next.y };
    draw();
    if (!next.settled) schedule();
    else lastFrameTime = 0;
  }

  function schedule() {
    if (!disposed && ready && !reducedMotion && !frame) {
      frame = window.requestAnimationFrame(step);
    }
  }

  function resetMotion() {
    if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
    lastFrameTime = 0;
    target = { x: 0, y: 0 };
    current = { x: 0, y: 0 };
  }

  const onPointerMove = event => {
    const vw = Math.max(1, window.innerWidth || 1);
    const vh = Math.max(1, window.innerHeight || 1);
    lastPointerTime = Date.now();
    target = {
      x: Math.max(-1, Math.min(1, (event.clientX / vw - 0.5) * 2)),
      y: Math.max(-1, Math.min(1, (event.clientY / vh - 0.5) * 2)),
    };
    schedule();
  };

  const onPointerLeave = () => {
    target = { x: 0, y: 0 };
    schedule();
  };

  const onOrientation = event => {
    if (event.gamma == null || event.beta == null) return;
    if (Date.now() - lastPointerTime < 500) return;
    if (!gyroBase) gyroBase = { beta: event.beta, gamma: event.gamma };
    target = {
      x: Math.max(-1, Math.min(1, (event.gamma - gyroBase.gamma) / 20)),
      y: Math.max(-1, Math.min(1, (event.beta - gyroBase.beta) / 20)),
    };
    schedule();
  };

  const onResize = () => { draw(); };

  const onMotionChange = event => {
    reducedMotion = Boolean(event.matches);
    if (reducedMotion) {
      resetMotion();
      setActive(false);
      clearSidebarCanvases();
      if (mainCanvas) mainCanvas.style.display = 'none';
    } else if (ready && mainCanvas) {
      mainCanvas.style.display = 'block';
      draw();
    }
  };

  const onContextLost = event => {
    event.preventDefault?.();
    ready = false;
    resetMotion();
    setActive(false);
    clearSidebarCanvases();
  };

  function cleanupGL() {
    if (gl) {
      if (imageTex) gl.deleteTexture(imageTex);
      if (depthTex) gl.deleteTexture(depthTex);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
    }
    if (mainCanvas) { mainCanvas.width = 0; mainCanvas.height = 0; }
    imageTex = null; depthTex = null; buffer = null; program = null; gl = null; hasMipmaps = false; currentMinFilter = null;
  }

  async function init() {
    if (!depthUrl || typeof fetchImpl !== 'function') return;
    mainCanvas = document.createElement('canvas');
    mainCanvas.setAttribute('data-bdt-parallax-canvas', '');
    mainCanvas.setAttribute('aria-hidden', 'true');
    const contextOptions = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true };
    gl = mainCanvas.getContext('webgl2', contextOptions) || mainCanvas.getContext('webgl', contextOptions);
    if (!gl) { mainCanvas = null; return; }
    program = createProgram(gl);
    if (!program) { cleanupGL(); mainCanvas = null; return; }

    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    locations = {
      pos: gl.getAttribLocation(program, 'a_pos'),
      image: gl.getUniformLocation(program, 'u_image'),
      depth: gl.getUniformLocation(program, 'u_depth'),
      texSize: gl.getUniformLocation(program, 'u_texSize'),
      canvasSize: gl.getUniformLocation(program, 'u_canvasSize'),
      geomOrigin: gl.getUniformLocation(program, 'u_geomOrigin'),
      geomSize: gl.getUniformLocation(program, 'u_geomSize'),
      offset: gl.getUniformLocation(program, 'u_offset'),
      strength: gl.getUniformLocation(program, 'u_strength'),
      useBicubic: gl.getUniformLocation(program, 'u_useBicubic'),
    };

    let img = photo;
    let loadImage;
    if (!img) {
      img = new window.Image();
      img.src = url;
      loadImage = img.decode();
    } else {
      loadImage = Promise.resolve();
    }
    let depth;
    try {
      [, depth] = await Promise.all([
        loadImage,
        fetchDepthMap(depthUrl, abortController.signal, fetchImpl),
      ]);
    } catch {
      if (!disposed) { cleanupGL(); mainCanvas = null; }
      return;
    }
    if (disposed || !depth) { cleanupGL(); mainCanvas = null; return; }
    textureWidth = Math.max(1, img.naturalWidth || config.imageWidth || 1920);
    textureHeight = Math.max(1, img.naturalHeight || config.imageHeight || 1080);

    imageTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, imageTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    currentMinFilter = gl.LINEAR;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    hasMipmaps = typeof gl.texStorage2D === 'function' && typeof gl.generateMipmap === 'function' && gl.LINEAR_MIPMAP_LINEAR !== undefined;
    if (hasMipmaps) gl.generateMipmap(gl.TEXTURE_2D);

    depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, depth.width, depth.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, depth.data);

    mainCanvas.addEventListener('webglcontextlost', onContextLost);
    applyCanvasStyle();
    if (reducedMotion) mainCanvas.style.display = 'none';
    (document.body || root).prepend(mainCanvas);
    ready = true;
    if (!reducedMotion) draw();
  }

  window.addEventListener('pointermove', onPointerMove, { passive: true, capture: true });
  root.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('blur', onPointerLeave);
  window.addEventListener('deviceorientation', onOrientation, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  media?.addEventListener?.('change', onMotionChange);

  void init();

  return {
    update(next) {
      config = { ...config, ...next };
      if (ready && !reducedMotion) draw();
    },
    syncSidebars,
    dispose() {
      disposed = true;
      ready = false;
      abortController.abort();
      resetMotion();
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      root.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('blur', onPointerLeave);
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('resize', onResize);
      media?.removeEventListener?.('change', onMotionChange);
      mainCanvas?.removeEventListener('webglcontextlost', onContextLost);
      setActive(false);
      clearSidebarCanvases();
      mainCanvas?.remove();
      cleanupGL();
      mainCanvas = null;
    },
  };
}
