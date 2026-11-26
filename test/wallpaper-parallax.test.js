import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import * as core from '../src/client/theme/palette.js';
import { createPlugin } from '../src/client/client-main.js';
import { createAppearanceController } from '../src/client/theme/appearance.js';
import { PREFERENCES_KEY } from '../src/shared/boot-theme.js';
import { encodeDepthPayload } from '../src/server/depth-service.js';
import {
  DEFAULT_PARALLAX_STRENGTH,
  clearDepthMemoryCache,
  decodeDepthPayload,
  depthUrlFor,
  mountParallaxWallpaper,
  normalizeParallax,
  parallaxMotion,
  smoothDepthMap,
} from '../src/client/wallpaper/wallpaper-parallax.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const IMAGE_URL = '/bing-daily-theme/api/image?id=OHR.Test_ZH-CN123_1920x1080.jpg';
const DEPTH_URL = '/bing-daily-theme/api/depth?id=OHR.Test_ZH-CN123_1920x1080.jpg';
const SAMPLE_PAYLOAD = encodeDepthPayload(new Uint8Array(16 * 9).fill(160), 16, 9);

test('parallax preferences default, clamp and migrate cleanly', () => {
  assert.equal(core.DEFAULTS.parallaxStrength, DEFAULT_PARALLAX_STRENGTH);
  assert.equal('parallax' in core.DEFAULTS, false);
  assert.deepEqual(normalizeParallax(), { parallaxStrength: 45 });
  assert.deepEqual(normalizeParallax({ parallaxStrength: 0 }), { parallaxStrength: 0 });
  assert.deepEqual(normalizeParallax({ parallaxStrength: 200 }), { parallaxStrength: 100 });
  assert.deepEqual(normalizeParallax({ parallaxStrength: -5 }), { parallaxStrength: 0 });
  assert.deepEqual(normalizeParallax({ parallaxStrength: 62.6 }), { parallaxStrength: 63 });
  assert.deepEqual(normalizeParallax({ parallax: false, parallaxStrength: 80 }), { parallaxStrength: 0 });
  assert.deepEqual(normalizeParallax({ parallax: true, parallaxStrength: 60 }), { parallaxStrength: 60 });
  for (const invalid of [NaN, Infinity, -Infinity, null, undefined, '50', {}, []]) {
    assert.equal(normalizeParallax({ parallaxStrength: invalid }).parallaxStrength, DEFAULT_PARALLAX_STRENGTH);
  }
  const migrated = core.normalizeSettings({ enabled: true, mode: 'dark', strength: 60 });
  assert.equal(migrated.parallaxStrength, 45);
});

test('depthUrlFor and decodeDepthPayload strictly validate canonical URLs and BDTD binaries', () => {
  assert.equal(depthUrlFor(IMAGE_URL), DEPTH_URL);
  assert.equal(
    depthUrlFor('/bing-daily-theme/api/image?market=en-US&id=OHR.Test_EN-US123_1920x1080.jpg'),
    '/bing-daily-theme/api/depth?market=en-US&id=OHR.Test_EN-US123_1920x1080.jpg',
  );
  assert.equal(
    depthUrlFor('/bing-daily-theme/api/image?resolution=2k&id=OHR.Test_ZH-CN123_1920x1080.jpg'),
    '/bing-daily-theme/api/depth?resolution=2k&id=OHR.Test_ZH-CN123_1920x1080.jpg',
  );
  assert.equal(
    depthUrlFor('/bing-daily-theme/api/image?market=en-US&resolution=4k&id=OHR.Test_EN-US123_1920x1080.jpg'),
    '/bing-daily-theme/api/depth?market=en-US&resolution=4k&id=OHR.Test_EN-US123_1920x1080.jpg',
  );
  for (const bad of ['', null, 'https://evil.test/image.jpg', '/bing-daily-theme/api/image?id=../secret', '/bing-daily-theme/api/image?resolution=8k&id=OHR.Test_ZH-CN123_1920x1080.jpg']) {
    assert.equal(depthUrlFor(bad), '');
  }
  const decoded = decodeDepthPayload(SAMPLE_PAYLOAD);
  assert.deepEqual({ width: decoded.width, height: decoded.height, len: decoded.data.byteLength }, { width: 16, height: 9, len: 144 });
  assert.equal(decodeDepthPayload(SAMPLE_PAYLOAD.slice(0, -1)), null);
  assert.equal(decodeDepthPayload(new Uint8Array([0, 0, 0, 0, 0, 2, 0, 2, 1, 2, 3, 4])), null);
});

test('smoothDepthMap eliminates sharp tearing cliffs while preserving foreground/background contrast', () => {
  const w = 64, h = 36;
  const cliff = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cliff[y * w + x] = x < w / 2 ? 10 : 245;
  const smoothed = smoothDepthMap(cliff, w, h, 4.5);
  assert.equal(smoothed.byteLength, w * h);
  let maxJump = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w; x++) {
      maxJump = Math.max(maxJump, Math.abs(smoothed[y * w + x] - smoothed[y * w + x - 1]));
    }
  }
  assert.ok(maxJump < 30, `smoothed cliff step (${maxJump}) stays continuous without tearing`);
  assert.ok(smoothed[h / 2 * w + 2] < 20, 'far side stays far');
  assert.ok(smoothed[h / 2 * w + w - 3] > 230, 'near side stays near');
});

test('parallaxMotion approaches target smoothly and settles without overshoot', () => {
  let pos = { x: 0, y: 0 };
  const target = { x: 0.8, y: -0.5 };
  for (let i = 0; i < 100; i++) {
    const next = parallaxMotion(target, pos, 16);
    assert.ok(next.x >= pos.x && next.x <= target.x);
    assert.ok(next.y <= pos.y && next.y >= target.y);
    pos = { x: next.x, y: next.y };
    if (next.settled) break;
  }
  assert.deepEqual(pos, target);
});

function createParallaxHarness({ webgl = true, webgl2 = false, dpr = 1, width = 1280, height = 900, reducedMotion = false, decodeReject = false, depthStatus = 200, depthBody = SAMPLE_PAYLOAD } = {}) {
  const listeners = new Map(), frames = new Map(), attrs = new Map();
  let frameId = 0, time = 0, draws = 0, blits = 0, shadersCompiled = 0, depthFetches = 0, mipmapsGenerated = 0;
  const uniforms = new Map();
  const makeNode = (tag, init = {}) => ({
    tag, style: {}, attributes: {}, children: [], isConnected: true, width: 0, height: 0,
    setAttribute(k, v) { this.attributes[k] = v; if (this === root) attrs.set(k, v); },
    removeAttribute(k) { delete this.attributes[k]; if (this === root) attrs.delete(k); },
    prepend(child) { this.children.unshift(child); child.parent = this; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); },
    querySelector(sel) {
      const name = sel.slice(1, -1);
      return this.children.find(c => Object.hasOwn(c.attributes, name)) || null;
    },
    addEventListener(name, fn) { listeners.set(`${tag}:${name}`, fn); },
    removeEventListener(name) { listeners.delete(`${tag}:${name}`); },
    getBoundingClientRect() { return this.box || { left: 0, top: 0, width: 0, height: 0 }; },
    ...init,
  });
  const root = makeNode('html');
  const leftPhoto = makeNode('div', { attributes: { 'data-bdt-sidebar-image': '' }, box: { left: -36, top: -36, width: 312, height: 972 } });
  const leftLayer = makeNode('div', { attributes: { 'data-bdt-sidebar-background': '' }, visibility: 'visible', children: [leftPhoto] });
  const rightPhoto = makeNode('div', { attributes: { 'data-bdt-sidebar-image': '' }, box: { left: 1000, top: 0, width: 280, height: 900 } });
  const rightLayer = makeNode('div', { attributes: { 'data-bdt-sidebar-background': '' }, visibility: 'hidden', children: [rightPhoto] });

  const uploadedTextures = [];
  const texParams = new Map();
  let boundTexture = null;
  const glMock = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TEXTURE0: 8, TEXTURE1: 9,
    TEXTURE_2D: 10, CLAMP_TO_EDGE: 11, LINEAR: 12, RGBA: 13, UNSIGNED_BYTE: 14,
    LUMINANCE: 15, UNPACK_ALIGNMENT: 16, TRIANGLE_STRIP: 17,
    TEXTURE_WRAP_S: 18, TEXTURE_WRAP_T: 19, TEXTURE_MIN_FILTER: 20, TEXTURE_MAG_FILTER: 21,
    createShader: type => ({ type }),
    shaderSource() {},
    compileShader() { shadersCompiled++; },
    getShaderParameter: () => true,
    deleteShader() {},
    createProgram: () => ({}),
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    deleteProgram() {},
    createBuffer: () => ({}),
    bindBuffer() {},
    bufferData() {},
    deleteBuffer() {},
    getAttribLocation: () => 0,
    getUniformLocation: (_p, name) => name,
    createTexture: () => ({ id: uploadedTextures.length }),
    bindTexture(_target, tex) { boundTexture = tex; },
    texParameteri(_target, pname, param) { texParams.set(`${boundTexture?.id}:${pname}`, param); },
    texImage2D(...args) { uploadedTextures.push(args); },
    deleteTexture() {},
    pixelStorei() {},
    viewport() {},
    useProgram() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    activeTexture() {},
    uniform1i(loc, v) { uniforms.set(loc, v); },
    uniform2f(loc, x, y) { uniforms.set(loc, [x, y]); },
    uniform1f(loc, v) { uniforms.set(loc, v); },
    drawArrays() { draws++; },
    ...(webgl2 ? {
      LINEAR_MIPMAP_LINEAR: 22,
      texStorage2D() {},
      generateMipmap() { mipmapsGenerated++; },
    } : {}),
  };

  const createdCanvases = [];
  const document = {
    documentElement: root,
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const node = makeNode('canvas', {
        getContext(type) {
          if (type === 'webgl2' || type === 'webgl') return webgl ? glMock : null;
          if (type === '2d') return { drawImage() { blits++; }, clearRect() {} };
          return null;
        },
      });
      createdCanvases.push(node);
      return node;
    },
    querySelectorAll(sel) {
      if (sel === '[data-bdt-sidebar-background]') return [leftLayer, rightLayer];
      if (sel === '[data-bdt-sidebar-canvas]') return [leftPhoto, rightPhoto].flatMap(p => p.children.filter(c => Object.hasOwn(c.attributes, 'data-bdt-sidebar-canvas')));
      return [];
    },
  };

  const mediaListeners = new Set();
  const media = {
    matches: reducedMotion,
    addEventListener(_name, fn) { mediaListeners.add(fn); },
    removeEventListener(_name, fn) { mediaListeners.delete(fn); },
  };

  const window = {
    innerWidth: width, innerHeight: height, devicePixelRatio: dpr,
    Image: class {
      decode() { return decodeReject ? Promise.reject(new Error('bad image')) : Promise.resolve(); }
    },
    matchMedia: () => media,
    getComputedStyle: el => ({ visibility: el.visibility || 'visible' }),
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(name, fn) { listeners.set(`window:${name}`, fn); },
    removeEventListener(name) { listeners.delete(`window:${name}`); },
  };

  const fetchImpl = async (url, init) => {
    depthFetches++;
    assert.equal(url, DEPTH_URL);
    assert.equal(init.credentials, 'same-origin');
    return new Response(depthBody, { status: depthStatus });
  };

  const flushFrames = (limit = 120) => {
    let count = 0;
    while (frames.size && count < limit) {
      time += 16;
      const batch = [...frames.values()];
      frames.clear();
      for (const fn of batch) fn(time);
      count++;
    }
    return count;
  };

  return {
    document, window, root, leftLayer, leftPhoto, rightPhoto, attrs, listeners, frames, mediaListeners,
    createdCanvases, uploadedTextures, texParams, uniforms, fetchImpl, flushFrames,
    getDraws: () => draws, getBlits: () => blits, getShadersCompiled: () => shadersCompiled, getDepthFetches: () => depthFetches, getMipmapsGenerated: () => mipmapsGenerated,
  };
}

test('mountParallaxWallpaper fetches backend depth map once per session, renders WebGL, syncs sidebars and respects reduced motion', async () => {
  clearDepthMemoryCache();
  const h = createParallaxHarness();
  const settings = core.normalizeSettings({ filterMode: 'blur', filterAmounts: { blur: 12 }, parallaxStrength: 60 });
  const controller = mountParallaxWallpaper({
    document: h.document, window: h.window, url: 'blob:test', depthUrl: DEPTH_URL,
    imageWidth: 1920, imageHeight: 1080, settings, fetchImpl: h.fetchImpl,
  });
  await new Promise(setImmediate);

  assert.equal(h.getDepthFetches(), 1);
  assert.equal(h.getShadersCompiled(), 2);
  assert.equal(h.getDraws(), 1);
  assert.equal(h.attrs.has('data-bdt-parallax-active'), true);
  assert.equal(h.leftPhoto.children.length, 1, 'visible wallpaper sidebar receives a synced canvas');
  assert.equal(h.rightPhoto.children.length, 0, 'hidden/theme sidebar does not mount a canvas');
  assert.equal(h.getBlits(), 1, '1 visible sidebar blit without frontend CPU downscaling');
  assert.equal(h.uploadedTextures.length, 2, 'uploads image texture and server depth texture');
  assert.equal(h.uploadedTextures[1][3], 16);
  assert.equal(h.uploadedTextures[1][4], 9);

  const mainCanvas = h.createdCanvases[0];
  assert.equal(mainCanvas.style.inset, '-36px');
  assert.equal(mainCanvas.style.zIndex, '-3', 'parallax canvas sits at the wallpaper layer behind visibility matte and weather');
  assert.equal(mainCanvas.style.filter, 'blur(12px)');

  h.listeners.get('window:pointermove')({ clientX: 1100, clientY: 200 });
  assert.equal(h.frames.size, 1);
  const steps = h.flushFrames();
  assert.ok(steps > 1 && steps < 120, `settled in ${steps} frames`);
  assert.equal(h.frames.size, 0);
  assert.equal(h.getDraws(), 1 + steps);

  controller.update({ settings: core.normalizeSettings({ filterMode: 'grayscale', parallaxStrength: 90 }) });
  assert.equal(mainCanvas.style.inset, '0');
  assert.equal(mainCanvas.style.filter, 'grayscale(100%)');

  for (const fn of h.mediaListeners) fn({ matches: true });
  assert.equal(h.attrs.has('data-bdt-parallax-active'), false);
  assert.equal(h.leftPhoto.children.length, 0);
  assert.equal(mainCanvas.style.display, 'none');

  for (const fn of h.mediaListeners) fn({ matches: false });
  assert.equal(h.attrs.has('data-bdt-parallax-active'), true);
  assert.equal(h.leftPhoto.children.length, 1);

  controller.dispose();
  assert.equal(h.attrs.has('data-bdt-parallax-active'), false);
  assert.equal(h.leftPhoto.children.length, 0);
  assert.equal(h.root.children.length, 0);
  assert.equal(h.listeners.size, 0);

  // Remounting for the same depthUrl reuses session memory cache without refetching.
  const remount = mountParallaxWallpaper({
    document: h.document, window: h.window, url: 'blob:test', depthUrl: DEPTH_URL,
    imageWidth: 1920, imageHeight: 1080, settings, fetchImpl: h.fetchImpl,
  });
  await new Promise(setImmediate);
  assert.equal(h.getDepthFetches(), 1, 'remount reuses cached depth map');
  assert.equal(h.attrs.has('data-bdt-parallax-active'), true);
  remount.dispose();
});

test('mountParallaxWallpaper uses WebGL2 mipmaps when downscaling and Catmull-Rom bicubic when magnifying', async () => {
  clearDepthMemoryCache();
  const h = createParallaxHarness({ webgl2: true, width: 1280, height: 720, dpr: 1 });
  const c = mountParallaxWallpaper({
    document: h.document, window: h.window, url: 'blob:test', depthUrl: DEPTH_URL,
    imageWidth: 1920, imageHeight: 1080, settings: core.DEFAULTS, fetchImpl: h.fetchImpl,
  });
  await new Promise(setImmediate);
  assert.equal(h.getMipmapsGenerated(), 1, 'generates NPOT mipmaps on WebGL2');
  assert.equal(h.uniforms.get('u_useBicubic'), 0, 'uses hardware trilinear mipmaps when downscaling');
  assert.equal(h.texParams.get('0:20'), 22, 'enables LINEAR_MIPMAP_LINEAR when downscaling');

  h.window.devicePixelRatio = 2;
  h.listeners.get('window:resize')();
  assert.equal(h.uniforms.get('u_useBicubic'), 1, 'switches to Catmull-Rom bicubic on HiDPI upscaling');
  assert.equal(h.texParams.get('0:20'), 12, 'switches TEXTURE_MIN_FILTER back to LINEAR so sampleBicubic always reads mip 0');
  c.dispose();

  const bundle = await read('dist/client.js');
  assert.ok(bundle.includes('sampleBicubic'), 'built client.js ships Catmull-Rom bicubic shader');
  assert.ok(!bundle.includes('const int STEPS = 8'), 'built client.js does not ship legacy stepped raymarcher');
});

test('mountParallaxWallpaper degrades silently when WebGL, backend depth API or image decode fails', async () => {
  clearDepthMemoryCache();
  for (const opts of [{ webgl: false }, { decodeReject: true }, { depthStatus: 503 }, { depthBody: new Uint8Array([1, 2, 3]) }]) {
    clearDepthMemoryCache();
    const h = createParallaxHarness(opts);
    const c = mountParallaxWallpaper({
      document: h.document, window: h.window, url: 'blob:test', depthUrl: DEPTH_URL,
      imageWidth: 1920, imageHeight: 1080, settings: core.DEFAULTS, fetchImpl: h.fetchImpl,
    });
    await new Promise(setImmediate);
    assert.equal(h.attrs.has('data-bdt-parallax-active'), false);
    assert.equal(h.getDraws(), 0);
    c.dispose();
  }
});

test('settings render single bilingual parallax slider where 0 disables parallax without refetching', async t => {
  const en = JSON.parse(await read('locale/en.json')), zh = JSON.parse(await read('locale/zh.json'));
  for (const dict of [en, zh]) {
    assert.ok(dict.parallax);
    assert.ok(dict.parallaxOff);
    assert.ok(dict.parallaxUnavailable);
    assert.equal('parallaxStrength' in dict, false);
  }
  const slots = new Map(), disposers = [];
  const saved = new Map(['localStorage', 'document', 'window', 'Image'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => {
    for (const d of disposers.reverse()) d();
    for (const [k, d] of saved) if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
  });
  const storage = new Map([[PREFERENCES_KEY, JSON.stringify(core.normalizeSettings({ mode: 'follow' }))]]);
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const pixels = new Uint8ClampedArray(112 * 112 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([40, 100, 180, 255], i);
  globalThis.document = {
    getElementById: () => null, addEventListener() {}, removeEventListener() {},
    createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }),
  };
  globalThis.Image = class { decode() { return Promise.resolve(); } };

  let overrides = 0, loaded;
  const ready = new Promise(resolve => { loaded = resolve; });
  const fetch = t.mock.method(globalThis, 'fetch', async url => url.includes('/api/daily')
    ? Response.json({ market: 'zh-CN', imageUrl: IMAGE_URL, date: '2026-11-24', parallaxAvailable: true })
    : new Response(new Blob(['image'], { type: 'image/jpeg' })));

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(c => c != null && c !== false) }),
    useSyncExternalStore: (_, get) => get(), useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useMemo: make => make(), useRef: current => ({ current }), useId: () => 'test', useEffect() {}, useLayoutEffect() {},
  };
  createPlugin(React, core, { en, zh }, createAppearanceController).apply({
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); }, on() {},
    locale: { register() {}, bind: () => k => en[k] ?? k, subscribe: () => () => {}, getSnapshot: () => 'en' },
    slots: { inject: (_, fn) => fn(), register: (opts, comp) => { slots.set(opts.id, comp); return () => {}; } },
    theme: { getTheme: () => ({ preference: 'light', active: { colorScheme: 'light' } }), setTheme() {}, overrideTokens() { overrides++; loaded(); return () => {}; } },
  });
  await ready;

  const settings = slots.get('bing-daily-theme'), wallpaper = slots.get('bing-daily-theme.wallpaper');
  const nodes = n => typeof n === 'object' ? [n, ...n.children.flatMap(nodes)] : [];
  const find = id => nodes(settings()).find(n => n.props.id === id);

  const slider = find('bdt-parallax');
  assert.equal(slider.props.type, 'range');
  assert.equal(slider.props.min, 0);
  assert.equal(slider.props.max, 100);
  assert.equal(slider.props.value, 45);
  assert.equal(slider.props.disabled, false);
  assert.equal(find('bdt-parallaxHint'), undefined);
  assert.equal(find('bdt-parallaxStrength'), undefined);
  assert.equal(nodes(settings()).find(n => n.type === 'output' && n.props.htmlFor === 'bdt-parallax').children[0], '45%');
  assert.ok(wallpaper().children[0].includes('html[data-bdt-parallax-active]::before{display:none}'));
  const parsed = await transform(wallpaper().children[0], { loader: 'css' });
  assert.deepEqual(parsed.warnings, []);

  const fetchesBefore = fetch.mock.callCount(), overridesBefore = overrides;
  find('bdt-parallax').props.onChange({ target: { value: '75' } });
  assert.equal(JSON.parse(storage.get(PREFERENCES_KEY)).parallaxStrength, 75);
  assert.equal(nodes(settings()).find(n => n.type === 'output' && n.props.htmlFor === 'bdt-parallax').children[0], '75%');
  find('bdt-parallax').props.onChange({ target: { value: '0' } });
  assert.equal(JSON.parse(storage.get(PREFERENCES_KEY)).parallaxStrength, 0);
  assert.equal(find('bdt-parallax').props['aria-valuetext'], en.parallaxOff);
  assert.equal(nodes(settings()).find(n => n.type === 'output' && n.props.htmlFor === 'bdt-parallax').children[0], en.parallaxOff);
  assert.equal(wallpaper().children[0].includes('data-bdt-parallax-active'), false);
  assert.equal(fetch.mock.callCount(), fetchesBefore);
  assert.equal(overrides, overridesBefore);
});

test('settings disable parallax slider with hint when optional runtime is absent', async t => {
  const en = JSON.parse(await read('locale/en.json')), zh = JSON.parse(await read('locale/zh.json'));
  const slots = new Map(), disposers = [];
  const saved = new Map(['localStorage', 'document', 'window', 'Image'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => {
    for (const d of disposers.reverse()) d();
    for (const [k, d] of saved) if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
  });
  const storage = new Map([[PREFERENCES_KEY, JSON.stringify(core.normalizeSettings({ mode: 'follow', parallaxStrength: 60 }))]]);
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const pixels = new Uint8ClampedArray(112 * 112 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([40, 100, 180, 255], i);
  globalThis.document = {
    getElementById: () => null, addEventListener() {}, removeEventListener() {},
    createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }),
  };
  globalThis.Image = class { decode() { return Promise.resolve(); } };

  let loaded;
  const ready = new Promise(resolve => { loaded = resolve; });
  t.mock.method(globalThis, 'fetch', async url => url.includes('/api/daily')
    ? Response.json({ market: 'zh-CN', imageUrl: IMAGE_URL, date: '2026-11-24' })
    : new Response(new Blob(['image'], { type: 'image/jpeg' })));

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(c => c != null && c !== false) }),
    useSyncExternalStore: (_, get) => get(), useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useMemo: make => make(), useRef: current => ({ current }), useId: () => 'test', useEffect() {}, useLayoutEffect() {},
  };
  createPlugin(React, core, { en, zh }, createAppearanceController).apply({
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); }, on() {},
    locale: { register() {}, bind: () => k => en[k] ?? k, subscribe: () => () => {}, getSnapshot: () => 'en' },
    slots: { inject: (_, fn) => fn(), register: (opts, comp) => { slots.set(opts.id, comp); return () => {}; } },
    theme: { getTheme: () => ({ preference: 'light', active: { colorScheme: 'light' } }), setTheme() {}, overrideTokens() { loaded(); return () => {}; } },
  });
  await ready;

  const settings = slots.get('bing-daily-theme'), wallpaper = slots.get('bing-daily-theme.wallpaper');
  const nodes = n => typeof n === 'object' ? [n, ...n.children.flatMap(nodes)] : [];
  const screen = nodes(settings());
  const slider = screen.find(n => n.props.id === 'bdt-parallax');
  const hint = screen.find(n => n.props.id === 'bdt-parallaxHint');
  assert.equal(slider.props.type, 'range');
  assert.equal(slider.props.disabled, true);
  assert.equal(slider.props.value, 0);
  assert.equal(slider.props['aria-describedby'], 'bdt-parallaxHint');
  assert.equal(screen.find(n => n.type === 'output' && n.props.htmlFor === 'bdt-parallax').children[0], en.parallaxOff);
  assert.equal(hint.children[0], en.parallaxUnavailable);
  assert.equal(wallpaper().children[0].includes('data-bdt-parallax-active'), false);
});
