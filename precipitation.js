import { OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { createPrecipitationObjects } from './three-precipitation.js';
import { createAtmosphere } from './weather-atmosphere.js';
import { PRECIPITATION_CANVAS, weatherWind } from './weather-effects.js';
import { windowLightOrbit } from './window-light.js';

const renderLevels = [
  { scale: .8, pixels: 1200000, cadence: 1 },
  { scale: .65, pixels: 700000, cadence: .92 },
  { scale: .50, pixels: 420000, cadence: .86 },
  { scale: .38, pixels: 260000, cadence: .80 },
];
const softwareLevel = { scale: .24, pixels: 100000 };
// Sample fine streaks and flakes more closely on small panes within the same full-screen pixel budgets.
const softwareRainLevel = { scale: .40, pixels: 100000 };
const softwareSnowLevel = { scale: .40, pixels: 85000 };
const webglOptions = {
  alpha: true, depth: false, stencil: false, antialias: false,
  premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'low-power',
};

function softwareRenderer(gl) {
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  const name = gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
  return /swiftshader|llvmpipe|softpipe|software (?:rasterizer|renderer)|microsoft basic render/i.test(name);
}

export function createWeatherEngine(document, canvas, look, effect, photo, facing) {
  if (!look || !canvas) return null;
  const window = document.defaultView;
  let gl, renderer, atmosphere, precipitation, software;
  try {
    gl = canvas.getContext('webgl2', webglOptions);
    if (!gl || gl.isContextLost()) return null;
    software = softwareRenderer(gl);
    renderer = new WebGLRenderer({ canvas, context: gl, ...webglOptions });
    renderer.setClearColor(0, 0);
    atmosphere = createAtmosphere(look, effect, photo, renderer);
    if (look.rain || look.snow) precipitation = createPrecipitationObjects(look, photo);
  } catch {
    precipitation?.dispose();
    atmosphere?.dispose();
    renderer?.dispose();
    gl?.getExtension?.('WEBGL_lose_context')?.loseContext();
    return null;
  }

  const scene = new Scene();
  const camera = new OrthographicCamera(0, 1, 0, 1, .1, 100);
  camera.position.z = 1;
  scene.add(atmosphere.object);
  if (precipitation) scene.add(precipitation.object);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = {
    width: 0, height: 0, pixelWidth: 0, pixelHeight: 0, dt: 0, time: 0,
    wind: 0, crosswind: 0, hasWindDirection: false, reduced: motion.matches,
    light: null, backdrop: null, leftEdge: 0, rightEdge: 0,
  };
  let lightDate = new Date(), scheme, dayStart, nightStart;
  const orbit = () => windowLightOrbit(facing, lightDate, scheme, dayStart, nightStart);
  state.light = orbit();
  let sidebars = new Map(), scaleX = 1, scaleY = 1;
  let surfaces = [], quality = 0, backingQuality;
  let samples = 0, slowFrames = 0, delayedFrames = 0, renderTime = 0;
  let stableFrames = 0, recoveryAfter = 0, lastUpgrade = -Infinity;
  let frame = 0, wakeTimer = 0, previous = 0, nextPaint = null;
  let disposed = false, shaderFailed = false;
  renderer.debug.onShaderError = () => { shaderFailed = true; };

  function stop() {
    if (frame) window.cancelAnimationFrame(frame);
    if (wakeTimer) window.clearTimeout(wakeTimer);
    frame = 0;
    wakeTimer = 0;
    nextPaint = null;
    stableFrames = samples = slowFrames = delayedFrames = renderTime = 0;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    motion.removeEventListener('change', sync);
    document.removeEventListener('visibilitychange', sync);
    canvas.removeEventListener('webglcontextlost', dispose);
    for (const { context, w, h } of sidebars.values()) context.clearRect(0, 0, w, h);
    sidebars.clear();
    releaseLayers();
    scene.clear();
    renderer.dispose();
    if (!gl.isContextLost()) renderer.forceContextLoss();
  }

  function draw(dt = 0) {
    if (disposed || !state.width || document.visibilityState === 'hidden') return;
    if (visibleQuality() !== backingQuality) configureView(state.width, state.height);
    state.dt = dt;
    state.time += dt;
    try {
      atmosphere.update(state);
      precipitation?.update(state);
      renderer.render(scene, camera);
    } catch {
      dispose();
      return;
    }
    if (shaderFailed || gl.isContextLost()) {
      dispose();
      return;
    }
    // Copy before the browser presents and discards the WebGL drawing buffer.
    for (const { context, x, y, w, h } of sidebars.values()) {
      context.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    }
  }

  function animated() {
    if (precipitation || effect === 'fog' || (effect === 'clouds' && drifting())) return true;
    return (effect === 'clear' || effect === 'clouds') && state.light.day && state.light.intensity > 0;
  }

  function drifting() {
    return !state.hasWindDirection || Math.abs(state.crosswind) >= .01;
  }

  function frameInterval() {
    const slowSky = effect === 'clear' || !drifting();
    if (software) return 1000 / (look.snow ? 7 : precipitation ? 8 : slowSky ? 4 : 6);
    const fps = look.snow ? 24 : look.rain ? 30 : slowSky ? 8 : 15;
    return 1000 / (fps * renderLevels[quality].cadence);
  }

  function releaseLayers() {
    if (precipitation) {
      scene.remove(precipitation.object);
      precipitation.dispose();
    }
    scene.remove(atmosphere.object);
    atmosphere.dispose();
  }

  function visibleQuality() {
    if (state.reduced || !animated()) return renderLevels[0];
    if (!software) return renderLevels[effect === 'clear' ? Math.max(2, quality) : quality];
    if (precipitation) return look.snow ? softwareSnowLevel : softwareRainLevel;
    return softwareLevel;
  }

  function configureView(width, height) {
    const level = visibleQuality();
    const resized = width !== state.width || height !== state.height;
    const changedBacking = resized || backingQuality !== level;
    if (resized) {
      state.width = width;
      state.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      camera.right = width;
      camera.bottom = height;
      camera.updateProjectionMatrix();
    }
    if (changedBacking) {
      backingQuality = level;
      const scale = Math.min(level.scale, Math.sqrt(level.pixels / (width * height)));
      renderer.setSize(Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale)), false);
      state.pixelWidth = canvas.width;
      state.pixelHeight = canvas.height;
      scaleX = state.pixelWidth / width;
      scaleY = state.pixelHeight / height;
    }
    const next = new Map();
    let changed = changedBacking;
    let leftEdge = 0, rightEdge = width;
    for (const [layer, box, side] of surfaces) {
      // All panes share the final scene and the same viewport pixel grid.
      const x = Math.max(0, Math.floor(box.left * scaleX));
      const y = Math.max(0, Math.floor(box.top * scaleY));
      const w = Math.min(canvas.width, Math.ceil(box.right * scaleX)) - x;
      const h = Math.min(canvas.height, Math.ceil(box.bottom * scaleY)) - y;
      if (w <= 0 || h <= 0) continue;
      if (side === 'left') leftEdge = Math.max(leftEdge, Math.min(width, box.right));
      if (side === 'right') rightEdge = Math.min(rightEdge, Math.max(0, box.left));
      const target = layer?.querySelector(PRECIPITATION_CANVAS);
      if (!target || window.getComputedStyle(target.parentElement).display === 'none') continue;
      const old = sidebars.get(target);
      if (!changedBacking && old?.x === x && old.y === y && old.w === w && old.h === h) {
        next.set(target, old);
        continue;
      }
      if (target.width !== w) target.width = w;
      if (target.height !== h) target.height = h;
      Object.assign(target.style, {
        left: `${x / scaleX}px`, top: `${y / scaleY}px`, width: `${w / scaleX}px`, height: `${h / scaleY}px`,
      });
      const context = old?.context ?? target.getContext('2d');
      if (!context) continue;
      context.globalCompositeOperation = 'copy';
      next.set(target, { context, x, y, w, h });
      changed = true;
    }
    if (leftEdge !== state.leftEdge || rightEdge !== state.rightEdge) {
      state.leftEdge = leftEdge;
      state.rightEdge = rightEdge;
      changed = true;
    }
    if (next.size < sidebars.size) {
      // Closing a pane removes a synchronous read of the scene.
      recoveryAfter = 0;
      stableFrames = samples = slowFrames = delayedFrames = renderTime = 0;
    }
    sidebars = next;
    return changed;
  }

  function tuneQuality(now, frameGap, cost) {
    renderTime += cost;
    if (cost > 18) slowFrames++;
    if (frameGap > frameInterval() * 1.6) delayedFrames++;
    if (++samples < 6) return;

    if (slowFrames >= 4 && quality < renderLevels.length - 1) {
      quality++;
      recoveryAfter = now + (now - lastUpgrade < 2500 ? 30000 : 5000);
      stableFrames = 0;
    } else if (quality && renderTime / samples < 7 && delayedFrames <= 1) {
      stableFrames += samples;
      if (stableFrames >= 72 && now >= recoveryAfter) {
        quality--;
        lastUpgrade = now;
        recoveryAfter = now + 5000;
        stableFrames = 0;
      }
    } else {
      stableFrames = 0;
    }
    samples = slowFrames = delayedFrames = renderTime = 0;
  }

  function schedule(delay = 0) {
    if (disposed || frame || wakeTimer || !state.width || state.reduced || document.visibilityState === 'hidden' || !animated()) return;
    if (delay > 0) {
      wakeTimer = window.setTimeout(() => {
        wakeTimer = 0;
        schedule();
      }, delay);
    } else frame = window.requestAnimationFrame(tick);
  }

  function tick(now) {
    frame = 0;
    if (nextPaint === null) {
      previous = now;
      nextPaint = now + frameInterval();
    }
    if (now >= nextPaint - 2) {
      const start = software ? 0 : window.performance.now();
      const frameGap = now - previous;
      draw(Math.min(frameGap, Math.max(160, frameInterval() * 1.5)) / 1000);
      // Include the synchronous work of presenting the shared frame to sidebars.
      if (!software) tuneQuality(now, frameGap, window.performance.now() - start);
      previous = now;
      const interval = frameInterval();
      nextPaint = Math.max(nextPaint + interval, now + interval / 2);
    }
    // Slow sky effects can sleep between paints, including on fast displays.
    if (!disposed) schedule(software || !precipitation ? nextPaint - window.performance.now() - 8 : 0);
  }

  function sync() {
    stop();
    state.reduced = motion.matches;
    if (document.visibilityState === 'hidden') return;
    lightDate = new Date();
    state.light = orbit();
    draw();
    schedule();
  }

  motion.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  canvas.addEventListener('webglcontextlost', dispose);

  return {
    layout(width, height, nextSurfaces) {
      if (disposed || width <= 0 || height <= 0) return;
      surfaces = nextSurfaces;
      if (configureView(width, height)) draw();
      schedule();
    },
    setBackdrop(backdrop) {
      if (disposed || state.backdrop === backdrop) return;
      state.backdrop = backdrop;
      draw();
    },
    setEffect(nextLook, nextEffect, nextPhoto) {
      if (disposed || !nextLook || (look === nextLook && effect === nextEffect && photo === nextPhoto)) return;
      let nextAtmosphere, nextPrecipitation;
      try {
        nextAtmosphere = createAtmosphere(nextLook, nextEffect, nextPhoto, renderer);
        if (nextLook.rain || nextLook.snow) nextPrecipitation = createPrecipitationObjects(nextLook, nextPhoto);
      } catch {
        nextAtmosphere?.dispose();
        nextPrecipitation?.dispose();
        dispose();
        return;
      }
      stop();
      releaseLayers();
      look = nextLook;
      effect = nextEffect;
      photo = nextPhoto;
      precipitation = nextPrecipitation;
      atmosphere = nextAtmosphere;
      scene.add(atmosphere.object);
      if (precipitation) scene.add(precipitation.object);
      state.time = 0;
      draw();
      schedule();
    },
    setWeather(windKmh, windDegrees, nextFacing) {
      if (disposed) return;
      const previousInterval = frameInterval();
      const { wind, crosswind } = weatherWind(windKmh, windDegrees, nextFacing);
      const hasWindDirection = windDegrees != null;
      if (state.wind === wind && state.crosswind === crosswind && state.hasWindDirection === hasWindDirection && facing === nextFacing) return;
      state.wind = wind;
      state.crosswind = crosswind;
      state.hasWindDirection = hasWindDirection;
      facing = nextFacing;
      state.light = orbit();
      if (!animated() || previousInterval !== frameInterval()) stop();
      draw();
      schedule();
    },
    updateLight(date, nextScheme = scheme, nextDayStart = dayStart, nextNightStart = nightStart) {
      if (disposed) return;
      if (nextScheme === scheme && nextDayStart === dayStart && nextNightStart === nightStart &&
          Math.floor(date.getTime() / 60000) === Math.floor(lightDate.getTime() / 60000)) return;
      scheme = nextScheme;
      dayStart = nextDayStart;
      nightStart = nextNightStart;
      lightDate = date;
      state.light = orbit();
      if (!animated()) stop();
      draw();
      schedule();
    },
    dispose,
  };
}
