import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as core from '../src/client/theme/palette.js';
import { createPlugin } from '../src/client/client-main.js';
import { createAppearanceController } from '../src/client/theme/appearance.js';
import { BOOT_CACHE_KEY, PREFERENCES_KEY } from '../src/shared/boot-theme.js';

test('one decoded image supplies mode-specific previews and theme changes without another fetch', async t => {
  const globals = ['localStorage', 'document', 'window', 'Image'];
  const original = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const disposers = [], slots = new Map(), stored = new Map();
  t.after(() => {
    try { for (const dispose of disposers.reverse()) dispose(); }
    finally {
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });

  stored.set(PREFERENCES_KEY, JSON.stringify({ ...core.DEFAULTS, mode: 'follow' }));
  globalThis.localStorage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: key => stored.delete(key),
  };
  const pixels = new Uint8ClampedArray(256 * 144 * 4);
  for (let i = 0; i < 256 * 144; i++) {
    const rgb = i < 18000 ? [40, 105, 205] : i < 28000 ? [45, 170, 70] : [215, 80, 45];
    pixels.set([...rgb, 255], i * 4);
  }
  const canvas = {
    width: 0, height: 0,
    getContext(type) {
      assert.equal(type, '2d');
      return {
        drawImage(_image, x, y, width, height) { assert.deepEqual([x, y, width, height], [0, 0, 256, 144]); },
        getImageData(x, y, width, height) {
          assert.deepEqual([x, y, width, height], [0, 0, 256, 144]);
          return { data: pixels };
        },
      };
    },
  };
  globalThis.document = {
    createElement(type) { assert.equal(type, 'canvas'); return canvas; },
    addEventListener() {}, removeEventListener() {}, getElementById() { return null; },
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.Image = class { naturalWidth = 256; naturalHeight = 144; async decode() {} };
  t.mock.method(URL, 'createObjectURL', () => 'blob:wallpaper');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const imageUrl = '/bing-daily-theme/api/image?id=OHR.Test_ZH-CN123_1920x1080.jpg';
  const fetch = t.mock.method(globalThis, 'fetch', async url => {
    if (url.startsWith('/bing-daily-theme/api/daily')) return { ok: true, json: async () => ({ market: 'zh-CN', imageUrl }) };
    assert.equal(url, imageUrl);
    return { ok: true, blob: async () => new Blob(['image'], { type: 'image/jpeg' }) };
  });
  let extractionCount = 0, extracted;
  const instrumentedCore = {
    ...core,
    extractImagePalettes(data, width, height) {
      extractionCount++;
      extracted = core.extractImagePalettes(data, width, height);
      return extracted;
    },
  };
  const en = JSON.parse(await readFile(new URL('../locale/en.json', import.meta.url), 'utf8'));
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) }),
    useSyncExternalStore(_subscribe, get) { return get(); },
    useState: initial => [initial(), () => {}], useMemo: make => make(), useId: () => 'test', useEffect() {}, useLayoutEffect() {},
  };
  const writes = [];
  let resolveFirstTheme;
  const firstTheme = new Promise(resolve => { resolveFirstTheme = resolve; });
  createPlugin(React, instrumentedCore, { en, zh: en }, createAppearanceController).apply({
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); },
    on() {},
    locale: { register() {}, bind: () => key => en[key] ?? key, subscribe: () => () => {}, getSnapshot: () => 'en' },
    slots: { inject: (_, register) => register(), register(options, component) { slots.set(options.id, component); return () => {}; } },
    theme: {
      getTheme: () => ({ preference: 'light', active: { colorScheme: 'light' } }),
      setTheme() {},
      overrideTokens(_source, tokens) { writes.push(tokens); resolveFirstTheme(); return () => {}; },
    },
  });
  let timeout;
  try {
    await Promise.race([firstTheme, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('image theme was not applied')), 10000); })]);
  } finally { clearTimeout(timeout); }
  assert.equal(extractionCount, 1);
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(canvas.width, 256);
  assert.equal(canvas.height, 144);
  assert.deepEqual(writes.at(-1), core.makeTokens(extracted, core.DEFAULTS.strength, 'content'));

  const nodes = node => typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
  const view = () => nodes(slots.get('bing-daily-theme')());
  for (const mode of core.PALETTE_MODES.slice(1)) {
    const screen = view();
    const choice = screen.find(node => node.props.type === 'radio' && node.props.value === mode);
    const label = screen.find(node => node.type === 'label' && node.props.htmlFor === `test-${mode}`);
    assert.ok(choice && label, `${mode} preview exists`);
    const preview = nodes(label).find(node => node.props.className === 'bdt-mini bdt-mini-light');
    assert.ok(preview, `${mode} light preview exists`);
    assert.equal(preview.props.style['--bdt-mini-brand'],
      core.makeTokens(extracted, core.DEFAULTS.strength, mode)['--dsw-alias-brand-primary'].light, `${mode} preview uses its own candidates`);
    choice.props.onChange();
    assert.deepEqual(writes.at(-1), core.makeTokens(extracted, core.DEFAULTS.strength, mode), mode);
    assert.equal(JSON.parse(stored.get(BOOT_CACHE_KEY)).paletteMode, mode);
  }
  assert.equal(extractionCount, 1, 'mode changes reuse extracted candidates');
  assert.equal(fetch.mock.callCount(), 2, 'mode changes do not request another image');
});
