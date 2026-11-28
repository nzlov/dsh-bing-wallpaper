import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as core from '../src/client/theme/palette.js';
import { createPlugin } from '../src/client/client-main.js';
import { createAppearanceController } from '../src/client/theme/appearance.js';
import { BOOT_CACHE_KEY, PREFERENCES_KEY } from '../src/shared/boot-theme.js';

test('wallpaper metadata supplies mode-specific previews without decoding image pixels or fetching again', async t => {
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
  const imageUrl = '/bing-daily-theme/api/image?id=OHR.Test_ZH-CN123_1920x1080.jpg';
  const imagePalette = Object.fromEntries(core.PALETTE_MODES.map((mode, index) =>
    [mode, [[40 + index * 10, 105, 205], [45, 170, 70], [215, 80, 45]]]));
  globalThis.document = {
    createElement() { assert.fail('the image does not need a canvas for theme colours'); },
    addEventListener() {}, removeEventListener() {}, getElementById() { return null; },
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  let decodes = 0;
  globalThis.Image = class {
    async decode() {
      assert.equal(this.src, imageUrl);
      decodes++;
    }
  };
  const fetch = t.mock.method(globalThis, 'fetch', async url => {
    assert.ok(url.startsWith('/bing-daily-theme/api/daily'));
    return Response.json({ market: 'zh-CN', imageUrl, imageWidth: 256, imageHeight: 144, imagePalette });
  });
  const en = JSON.parse(await readFile(new URL('../locale/en.json', import.meta.url), 'utf8'));
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) }),
    useSyncExternalStore(_subscribe, get) { return get(); },
    useState: initial => [initial(), () => {}], useMemo: make => make(), useId: () => 'test', useEffect() {}, useLayoutEffect() {},
  };
  const writes = [];
  let resolveFirstTheme;
  const firstTheme = new Promise(resolve => { resolveFirstTheme = resolve; });
  createPlugin(React, core, { en, zh: en }, createAppearanceController).apply({
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
  assert.equal(decodes, 1);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(writes.at(-1), core.makeTokens(imagePalette, core.DEFAULTS.strength, 'content'));

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
      core.makeTokens(imagePalette, core.DEFAULTS.strength, mode)['--dsw-alias-brand-primary'].light, `${mode} preview uses its own candidates`);
    choice.props.onChange();
    assert.deepEqual(writes.at(-1), core.makeTokens(imagePalette, core.DEFAULTS.strength, mode), mode);
    assert.equal(JSON.parse(stored.get(BOOT_CACHE_KEY)).paletteMode, mode);
  }
  assert.equal(decodes, 1, 'mode changes reuse the same wallpaper');
  assert.equal(fetch.mock.callCount(), 1, 'mode changes reuse palette metadata');
});
