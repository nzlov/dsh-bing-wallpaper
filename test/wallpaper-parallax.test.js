import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as core from '../src/client/theme/palette.js';
import { createPlugin } from '../src/client/client-main.js';
import { PREFERENCES_KEY } from '../src/shared/boot-theme.js';
import { encodeDepthPayload } from '../src/server/depth-service.js';
import { createDepthParallaxRenderer, decodeDepthPayload } from '../src/client/wallpaper/parallax-depth-renderer.js';
import {
  DEFAULT_PARALLAX_STRENGTH, mountParallaxWallpaper,
  normalizeParallax, parallaxDataUrl, parallaxMotion,
} from '../src/client/wallpaper/wallpaper-parallax.js';

const IMAGE_URL = '/bing-daily-theme/api/image?id=OHR.Test_ZH-CN123_1920x1080.jpg';
const DEPTH_URL = '/bing-daily-theme/api/depth?id=OHR.Test_ZH-CN123_1920x1080.jpg';
const SAMPLE_PAYLOAD = encodeDepthPayload(new Uint8Array(16 * 9).fill(160), 16, 9);
const flush = () => new Promise(setImmediate);
let nextFixture = 0;

function setGlobals(t, globals) {
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
}

test('parallax preferences keep the old depth default and migrate disabled settings', () => {
  assert.equal(core.DEFAULTS.parallaxStrength, DEFAULT_PARALLAX_STRENGTH);
  assert.equal(core.DEFAULTS.parallaxMode, 'depth');
  assert.equal('parallax' in core.DEFAULTS, false);
  assert.deepEqual(normalizeParallax(), { parallaxMode: 'depth', parallaxStrength: 45 });
  assert.deepEqual(normalizeParallax({ parallaxMode: 'sharp', parallaxStrength: 200 }), { parallaxMode: 'sharp', parallaxStrength: 100 });
  assert.deepEqual(normalizeParallax({ parallaxMode: 'unknown', parallaxStrength: -5 }), { parallaxMode: 'depth', parallaxStrength: 0 });
  assert.deepEqual(normalizeParallax({ parallax: false, parallaxStrength: 80 }), { parallaxMode: 'depth', parallaxStrength: 0 });
  for (const invalid of [undefined, null, NaN, Infinity, '30', {}]) {
    assert.equal(normalizeParallax({ parallaxStrength: invalid }).parallaxStrength, DEFAULT_PARALLAX_STRENGTH);
  }
});

test('only canonical wallpaper paths can request the model output for either mode', () => {
  assert.equal(parallaxDataUrl(IMAGE_URL, 'depth'), DEPTH_URL);
  assert.equal(
    parallaxDataUrl('/bing-daily-theme/api/image?market=en-US&resolution=4k&id=OHR.Test_EN-US123_1920x1080.jpg', 'sharp'),
    '/bing-daily-theme/api/scene?market=en-US&resolution=4k&id=OHR.Test_EN-US123_1920x1080.jpg',
  );
  for (const invalid of ['https://example.org' + IMAGE_URL, IMAGE_URL + '&q=1', IMAGE_URL + '#fragment', '/api/image?id=x', null]) {
    assert.equal(parallaxDataUrl(invalid, 'depth'), '');
  }
  assert.equal(parallaxDataUrl(IMAGE_URL, 'anything'), '');
  assert.deepEqual(decodeDepthPayload(SAMPLE_PAYLOAD), { width: 16, height: 9, data: SAMPLE_PAYLOAD.slice(8) });
  assert.equal(decodeDepthPayload(SAMPLE_PAYLOAD.slice(0, -1)), null);
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

function createParallaxHarness({ webgl = true, webgl2 = false, dpr = 1, width = 1280, height = 900, reducedMotion = false, depthStatus = 200, depthBody = SAMPLE_PAYLOAD } = {}) {
  const dataUrl = DEPTH_URL.replace('OHR.Test_', `OHR.Test${++nextFixture}_`);
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

  const uploadedTextures = [], shaders = [];
  const texParams = new Map();
  let unit = 0, nextTexture = 0;
  const boundTextures = new Map();
  const glMock = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TEXTURE0: 8, TEXTURE1: 9,
    TEXTURE_2D: 10, CLAMP_TO_EDGE: 11, LINEAR: 12, RGBA: 13, UNSIGNED_BYTE: 14,
    LUMINANCE: 15, UNPACK_ALIGNMENT: 16, TRIANGLE_STRIP: 17, MAX_TEXTURE_SIZE: 24, R8: 25, RED: 26, NO_ERROR: 0,
    getExtension: () => null, getError: () => 0, getParameter: () => 4096,
    TEXTURE_WRAP_S: 18, TEXTURE_WRAP_T: 19, TEXTURE_MIN_FILTER: 20, TEXTURE_MAG_FILTER: 21,
    createShader: type => ({ type }),
    shaderSource(_shader, source) { shaders.push(source); },
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
    createTexture: () => ({ id: nextTexture++ }),
    bindTexture(_target, tex) { boundTextures.set(unit, tex); },
    texParameteri(_target, pname, param) { texParams.set(`${boundTextures.get(unit)?.id}:${pname}`, param); },
    texImage2D(...args) { uploadedTextures.push(args); },
    deleteTexture() {},
    pixelStorei() {},
    viewport() {},
    useProgram() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    activeTexture(next) { unit = next; },
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
    documentElement: root, hidden: false,
    addEventListener(name, fn) { listeners.set(`document:${name}`, fn); },
    removeEventListener(name) { listeners.delete(`document:${name}`); },
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const node = makeNode('canvas', {
        getContext(type) {
          if (type === 'webgl2') return webgl && webgl2 ? glMock : null;
          if (type === 'webgl') return webgl ? glMock : null;
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
    matchMedia: () => media,
    getComputedStyle: el => ({ visibility: el.visibility || 'visible' }),
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(name, fn) { listeners.set(`window:${name}`, fn); },
    removeEventListener(name) { listeners.delete(`window:${name}`); },
  };

  const fetchImpl = async (url, init) => {
    depthFetches++;
    assert.equal(url, dataUrl);
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
    document, window, root, leftLayer, leftPhoto, rightPhoto, attrs, listeners, frames, media, mediaListeners, dataUrl, shaders,
    createdCanvases, uploadedTextures, texParams, uniforms, fetchImpl, flushFrames,
    getDraws: () => draws, getBlits: () => blits, getShadersCompiled: () => shadersCompiled, getDepthFetches: () => depthFetches, getMipmapsGenerated: () => mipmapsGenerated,
  };
}

function mount(h, settings = core.DEFAULTS, createRenderer = createDepthParallaxRenderer) {
  return mountParallaxWallpaper({
    document: h.document, window: h.window, url: IMAGE_URL, dataUrl: h.dataUrl,
    imageWidth: 1920, imageHeight: 1080, photo: { naturalWidth: 1920, naturalHeight: 1080 },
    settings, fetchImpl: h.fetchImpl, createRenderer,
  });
}

async function startRenderer(h) {
  h.flushFrames(2);
  await flush();
  h.flushFrames();
}

test('motion updates depth uniforms without reloading images or a backend depth map', async t => {
  const h = createParallaxHarness();
  const settings = core.normalizeSettings({ filterMode: 'blur', filterAmounts: { blur: 12 }, parallaxStrength: 60 });
  const controller = mount(h, settings);
  t.after(() => controller.dispose());
  await startRenderer(h);

  assert.equal(h.getDepthFetches(), 1);
  assert.equal(h.getShadersCompiled(), 2);
  assert.equal(h.getDraws(), 1);
  assert.equal(h.attrs.has('data-bdt-parallax-active'), true);
  assert.equal(h.leftPhoto.children.length, 1);
  assert.equal(h.rightPhoto.children.length, 0);
  assert.equal(h.getBlits(), 1);
  assert.equal(h.uploadedTextures.length, 2);
  assert.equal(h.uploadedTextures[1][2], 15, 'WebGL1 uses a luminance texture');
  assert.deepEqual(h.uploadedTextures[1][8], SAMPLE_PAYLOAD.slice(8), 'uploads the server data as delivered');
  const canvas = h.createdCanvases[0];
  assert.equal(canvas.style.inset, '-36px');
  assert.equal(canvas.style.zIndex, '-3');
  assert.equal(canvas.style.filter, 'blur(12px)');

  h.listeners.get('window:pointermove')({ clientX: 1100, clientY: 200 });
  h.flushFrames(1);
  const first = h.uniforms.get('u_offset')[0];
  assert.ok(first > 0 && first < 0.7);
  const steps = h.flushFrames();
  assert.ok(steps > 1 && steps < 120);
  assert.equal(h.getDraws(), 2 + steps);
  assert.equal(h.getBlits(), h.getDraws());
  assert.equal(h.getDepthFetches(), 1);
  assert.equal(h.uploadedTextures.length, 2);

  controller.update({ settings: core.normalizeSettings({ filterMode: 'grayscale', parallaxStrength: 90 }) });
  h.flushFrames();
  assert.equal(canvas.style.inset, '0');
  assert.equal(canvas.style.filter, 'grayscale(100%)');

  controller.dispose();
  assert.equal(h.attrs.has('data-bdt-parallax-active'), false);
  assert.equal(h.leftPhoto.children.length, 0);
  assert.equal(h.root.children.length, 0);
  assert.equal(h.listeners.size, 0);

  const remount = mount(h, settings);
  t.after(() => remount.dispose());
  await startRenderer(h);
  assert.equal(h.getDepthFetches(), 1, 'another mount can reuse the current depth map');
});

test('iframe pointer movement drives the shared wallpaper across insertion, navigation and removal', async () => {
  const h = createParallaxHarness();
  function frameDocument() {
    return Object.assign(new EventTarget(), {
      iframes: [],
      documentElement: new EventTarget(),
      querySelectorAll(selector) { assert.equal(selector, 'iframe'); return this.iframes; },
      pointermove(clientX, clientY) {
        this.dispatchEvent(Object.assign(new Event('pointermove'), { clientX, clientY }));
      },
    });
  }
  const top = frameDocument();
  Object.assign(top, h.document, {
    querySelectorAll: selector => selector === 'iframe' ? top.iframes : h.document.querySelectorAll(selector),
  });
  const observers = new Map();
  h.window.MutationObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(node) { this.node = node; observers.set(node, this.callback); }
    disconnect() { observers.delete(this.node); }
  };
  function iframe(contentDocument, left, top, scale = 1) {
    return {
      localName: 'iframe', nodeType: 1, contentDocument,
      clientLeft: 2, clientTop: 2, offsetWidth: 200, offsetHeight: 200,
      getBoundingClientRect: () => ({ left, top, width: 200 * scale, height: 200 * scale }),
    };
  }
  const child = frameDocument(), nested = frameDocument(), foreign = iframe(null, 0, 0);
  child.iframes.push(iframe(nested, 20, 20));
  const tile = iframe(child, 800, 500, 2);
  top.iframes.push(foreign);
  const controller = mount({ ...h, document: top });
  await startRenderer(h);

  top.iframes.push(tile);
  observers.get(top)([{ addedNodes: [tile], removedNodes: [] }]);
  nested.pointermove(96, 76);
  assert.ok(h.flushFrames() > 0);
  assert.deepEqual(h.uniforms.get('u_offset'), [(1040 / 1280 - 0.5) * 2, (700 / 900 - 0.5) * 2]);

  const reloaded = frameDocument();
  tile.contentDocument = reloaded;
  h.listeners.get('document:load')({ target: tile });
  nested.pointermove(0, 0);
  assert.equal(h.flushFrames(), 0);
  reloaded.pointermove(98, 98);
  assert.ok(h.flushFrames() > 0);
  assert.deepEqual(h.uniforms.get('u_offset'), [(1000 / 1280 - 0.5) * 2, (700 / 900 - 0.5) * 2]);

  top.iframes.pop();
  observers.get(top)([{ addedNodes: [], removedNodes: [tile] }]);
  reloaded.pointermove(0, 0);
  assert.equal(h.flushFrames(), 0);
  controller.dispose();
  assert.equal(observers.size, 0);
});

test('WebGL2 compiles GLSL 3 with a single-channel depth texture and chooses the photo filter for the display scale', async t => {
  const h = createParallaxHarness({ webgl2: true, width: 1280, height: 720 });
  const controller = mount(h);
  t.after(() => controller.dispose());
  await startRenderer(h);
  assert.ok(h.shaders.every(source => source.startsWith('#version 300 es\n')));
  assert.equal(h.uploadedTextures[1][2], 25);
  assert.equal(h.uploadedTextures[1][6], 26);
  assert.equal(h.getMipmapsGenerated(), 1);
  assert.equal(h.uniforms.get('u_useBicubic'), 0);
  assert.equal(h.texParams.get('0:20'), 22);

  h.window.devicePixelRatio = 2;
  h.listeners.get('window:resize')();
  h.flushFrames();
  assert.equal(h.uniforms.get('u_useBicubic'), 1);
  assert.equal(h.texParams.get('0:20'), 12);
});

test('SHARP keeps source pixel density across wallpaper resolutions and viewport crops', async t => {
  for (const width of [1920, 2560, 3840]) {
    const h = createParallaxHarness({ width: 960, height: 540 });
    const controller = mount(h, core.DEFAULTS, async () => ({
      sourceWidth: width, maxCanvasSide: 8192, draw() {}, dispose() {},
    }));
    t.after(() => controller.dispose());
    controller.update({ imageWidth: width, imageHeight: width * 9 / 16 });
    await startRenderer(h);
    const canvas = h.createdCanvases[0];
    assert.deepEqual([canvas.width, canvas.height], [width, width * 9 / 16]);
    h.window.innerWidth = 480;
    h.listeners.get('window:resize')();
    h.flushFrames();
    assert.deepEqual([canvas.width, canvas.height], [width / 2, width * 9 / 16]);
  }
});

test('the common canvas starts once and suspends drawing in background tabs or reduced motion', async t => {
  const h = createParallaxHarness({ reducedMotion: true });
  let starts = 0, dirty, disposed = 0, calls = [];
  const controller = mount(h, core.DEFAULTS, async ({ invalidate }) => {
    starts++;
    dirty = invalidate;
    return { draw(layout) { calls.push(layout); }, dispose() { disposed++; }, maxPixels: 800 * 450 };
  });
  t.after(() => controller.dispose());
  await flush();
  assert.equal(starts, 0);

  h.media.matches = false;
  for (const fn of h.mediaListeners) fn();
  await startRenderer(h);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].pixelWidth * calls[0].pixelHeight <= 801 * 451);
  assert.equal(h.leftPhoto.children.length, 1);
  dirty();
  h.flushFrames();
  assert.equal(calls.length, 2);

  h.document.hidden = true;
  h.listeners.get('document:visibilitychange')();
  dirty();
  h.flushFrames();
  assert.equal(h.attrs.has('data-bdt-parallax-active'), false);
  assert.equal(h.leftPhoto.children.length, 0);
  assert.equal(calls.length, 2);
  h.document.hidden = false;
  h.listeners.get('document:visibilitychange')();
  h.flushFrames();
  assert.equal(calls.length, 3);

  controller.update({ settings: { ...core.DEFAULTS, parallaxStrength: 0 } });
  assert.equal(h.attrs.has('data-bdt-parallax-active'), false);
  controller.update({ settings: core.DEFAULTS });
  h.flushFrames();
  assert.equal(starts, 1);
  assert.equal(calls.length, 4);
  assert.equal(disposed, 0);
});

test('missing WebGL, a failed depth response and context loss preserve the static wallpaper', async t => {
  for (const options of [{ webgl: false }, { depthStatus: 503 }, { depthBody: new Uint8Array(1) }]) {
    const h = createParallaxHarness(options);
    const controller = mount(h);
    t.after(() => controller.dispose());
    await startRenderer(h);
    assert.equal(h.attrs.has('data-bdt-parallax-active'), false);
    assert.equal(h.root.children.length, 0);
  }
  const h = createParallaxHarness();
  const controller = mount(h);
  t.after(() => controller.dispose());
  await startRenderer(h);
  h.listeners.get('canvas:webglcontextlost')({ preventDefault() {} });
  assert.equal(h.attrs.has('data-bdt-parallax-active'), false);
  assert.equal(h.root.children.length, 0);
});

test('the wallpaper gets a paint before WebGL initialization and stays visible until depth arrives', async t => {
  const h = createParallaxHarness();
  let deliverDepth, requested = 0;
  h.fetchImpl = () => {
    requested++;
    return new Promise(resolve => { deliverDepth = resolve; });
  };
  const controller = mount(h);
  t.after(() => controller.dispose());
  h.flushFrames(1);
  assert.equal(h.createdCanvases.length, 0);
  assert.equal(h.attrs.has('data-bdt-parallax-active'), false);
  h.flushFrames(1);
  assert.equal(requested, 1);
  assert.equal(h.attrs.has('data-bdt-parallax-active'), false);
  assert.equal(h.getDraws(), 0);
  deliverDepth(new Response(SAMPLE_PAYLOAD));
  await flush();
  h.flushFrames();
  assert.equal(h.attrs.has('data-bdt-parallax-active'), true);
  assert.equal(h.getDraws(), 1);
  assert.equal(requested, 1);
});

const nodes = node => typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];

async function settingsApp(t, parallaxModes, { photoPending, depthPending, language = 'en' } = {}) {
  const en = JSON.parse(await readFile(new URL('../locale/en.json', import.meta.url), 'utf8'));
  const zh = JSON.parse(await readFile(new URL('../locale/zh.json', import.meta.url), 'utf8'));
  const dictionary = language === 'zh' ? zh : en;
  const localeSnapshot = { active: language };
  const storage = new Map([[PREFERENCES_KEY, JSON.stringify({ mode: 'follow' })]]);
  const disposers = [], slots = new Map();
  t.after(() => { for (const dispose of disposers.reverse()) dispose(); });
  setGlobals(t, {
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { addEventListener() {}, removeEventListener() {}, getElementById() { return null; } },
    window: { WebGLRenderingContext: depthPending ? class {} : undefined, addEventListener() {}, removeEventListener() {} },
    Image: class { async decode() { assert.equal(this.src, IMAGE_URL); await photoPending; } },
  });
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === DEPTH_URL) {
      assert.ok(depthPending);
      assert.equal(options.priority, 'low');
      return depthPending;
    }
    assert.ok(url.includes('/api/daily'));
    return Response.json({ market: 'zh-CN', imageUrl: IMAGE_URL, date: '2026-11-24', parallaxModes });
  });
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) }),
    useSyncExternalStore: (_, get) => get(), useState: initial => [initial(), () => {}], useMemo: make => make(),
    useRef: current => ({ current }), useId: () => 'test', useEffect() {}, useLayoutEffect() {},
  };
  let resolveTheme;
  const themeReady = new Promise(resolve => { resolveTheme = resolve; });
  createPlugin(React, core, { en, zh }, () => ({ sync() {}, restore() {}, changed() {} })).apply({
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); }, on() {},
    locale: { register() {}, bind: () => key => dictionary[key] ?? key, subscribe: () => () => {}, getSnapshot: () => localeSnapshot },
    slots: { inject: (_, register) => register(), register(options, component) { slots.set(options.id, component); return () => {}; } },
    theme: { getTheme: () => ({ active: { colorScheme: 'light' } }), overrideTokens() { resolveTheme(); return () => {}; } },
  });
  if (!photoPending) await themeReady;
  const screen = () => nodes(slots.get('bing-daily-theme')());
  return {
    en, zh, fetch, themeReady, screen, saved: () => JSON.parse(storage.get(PREFERENCES_KEY)),
    control: id => screen().find(node => node.props.id === `bdt-${id}`),
    wallpaper: () => slots.get('bing-daily-theme.wallpaper')()?.children[0],
  };
}

test('photo and depth start concurrently and a pending or failed depth request preserves the wallpaper and theme', { timeout: 5000 }, async t => {
  let resolvePhoto, rejectDepth;
  const photoPending = new Promise(resolve => { resolvePhoto = resolve; });
  const depthPending = new Promise((_, reject) => { rejectDepth = reject; });
  const { fetch, themeReady, wallpaper } = await settingsApp(t, ['depth'], { photoPending, depthPending });
  await flush();
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(fetch.mock.calls[1].arguments[0], DEPTH_URL);
  assert.equal(wallpaper(), undefined);

  resolvePhoto();
  await themeReady;
  const first = wallpaper();
  assert.ok(first.includes(IMAGE_URL));

  rejectDepth(new Error('Depth inference unavailable'));
  await flush();
  assert.equal(wallpaper(), first);
  assert.equal(fetch.mock.callCount(), 2);
});

test('settings select either server mode and keep one shared display image and an original preview', { timeout: 5000 }, async t => {
  const { en, zh, fetch, screen, control, saved, wallpaper } = await settingsApp(t, ['depth', 'sharp']);
  for (const dict of [en, zh]) for (const key of ['parallax', 'parallaxOff', 'parallaxMode', 'parallaxMode.depth', 'parallaxMode.sharp']) assert.ok(dict[key]);
  assert.equal(control('parallaxMode').props.value, 'depth');
  assert.deepEqual(control('parallaxMode').children.map(option => option.props.value), ['depth', 'sharp']);
  assert.equal(control('parallax').props.value, 45);
  assert.equal(control('parallax').props.disabled, false);
  assert.equal(control('parallaxHint'), undefined);
  assert.match(wallpaper(), /html\[data-bdt-parallax-active\]::before\{display:none\}/);
  assert.match(wallpaper(), /\[data-bdt-sidebar-image\]>\[data-bdt-sidebar-canvas\]/);
  assert.equal(screen().find(node => node.props.className === 'bdt-preview-image').props.src, IMAGE_URL);

  control('parallaxMode').props.onChange({ target: { value: 'sharp' } });
  assert.equal(saved().parallaxMode, 'sharp');
  assert.equal(control('parallax').props.disabled, false);
  assert.equal(control('parallax').props.value, 45);
  assert.equal(control('parallax').props.max, 100);
  control('parallax').props.onChange({ target: { value: '0' } });
  assert.equal(saved().parallaxStrength, 0);
  assert.equal(control('parallax').props['aria-valuetext'], en.parallaxOff);
  assert.doesNotMatch(wallpaper(), /data-bdt-parallax-active/);
  assert.equal(fetch.mock.callCount(), 1, 'settings changes do not refresh the original');
});

for (const [language, filename] of [['en', 'sharp-install.md'], ['zh', 'sharp-install.zh-CN.md']]) {
  test(`unconfigured SHARP shows the ${language} installation guide while depth remains selectable`, { timeout: 5000 }, async t => {
    const app = await settingsApp(t, ['depth'], { language });
    const { control, fetch, wallpaper } = app;
    control('parallaxMode').props.onChange({ target: { value: 'sharp' } });
    assert.equal(control('parallax').props.disabled, true);
    assert.equal(control('parallaxMode').props['aria-describedby'], 'bdt-parallaxHint');
    const [hint, , guide] = control('parallaxHint').children;
    assert.equal(hint, app[language]['parallaxUnavailable.sharp']);
    assert.match(hint, /model-runtime\/sharp/);
    assert.equal(guide.props.href, `https://github.com/nzlov/dsh-bing-wallpaper/blob/main/docs/${filename}`);
    assert.doesNotMatch(wallpaper(), /data-bdt-parallax-active/);

    control('parallaxMode').props.onChange({ target: { value: 'depth' } });
    assert.equal(control('parallax').props.disabled, false);
    assert.equal(control('parallax').props.value, 45);
    assert.equal(control('parallaxHint'), undefined);
    assert.equal(fetch.mock.callCount(), 1);
  });
}
