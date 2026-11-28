import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import * as core from '../src/client/theme/palette.js';
import { wallpaperFilters } from '../src/shared/wallpaper-filter.js';
import { normalizeSidebar, sidebarBackgroundCSS, sidebarColors, mountSidebarBackground, SIDEBAR_TINT_ALPHA } from '../src/client/wallpaper/sidebar-background.js';
import { palettePreviewStyle } from '../src/client/theme/palette-preview.js';
import { createPlugin } from '../src/client/client-main.js';
import { createAppearanceController } from '../src/client/theme/appearance.js';
import { PREFERENCES_KEY } from '../src/shared/boot-theme.js';
import { WEATHER_LAYOUT_CSS } from '../src/client/weather/weather-effects.js';

const photo = 'url("blob:https://example.test/wallpaper")';
const base = 'var(--dsw-alias-bg-layer-1)';
const leftColumn = 'body div:has(> [data-shell-overlay]) > div:has(> [data-slot="sidebar"])';
const leftRoot = `${leftColumn} > [data-slot="sidebar"] > div`;
const rightPane = 'body [data-sidebar-right-panel] :is([data-dockkit-host="dock"] > [data-dockkit-pane], [data-dockkit-empty])';
const background = surface => `${surface} > [data-bdt-sidebar-background]`;
const photoLayer = surface => `${background(surface)} > [data-bdt-sidebar-image]`;
const veilLayer = surface => `${background(surface)} > [data-bdt-sidebar-veil]`;
const rule = (css, selector) => {
  const start = css.indexOf(`${selector}{`);
  assert.ok(start >= 0, selector);
  return css.slice(start + selector.length + 1, css.indexOf('}', start));
};
const render = (input = {}) => sidebarBackgroundCSS({
  settings: core.normalizeSettings(input), image: photo, matte: 'rgba(240, 240, 240, 0.5)', overlays: [],
});
const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('sidebar defaults migrate existing preferences and independently retain bounded options', () => {
  const prefs = core.normalizeSettings({ filterMode: 'blur', filterAmounts: { blur: 17 } });
  assert.equal(prefs.leftSidebar.background, 'wallpaper');
  assert.equal(prefs.rightSidebar.filterMode, 'inherit');
  assert.equal(prefs.leftSidebar.toolbar, true);
  assert.equal(prefs.leftSidebar.tint, true);
  assert.equal(prefs.leftSidebar.visibilityMode, 'inherit');
  assert.equal(prefs.rightSidebar.visibilityMode, 'inherit');
  assert.equal(prefs.leftSidebar.visibility, 28);
  assert.notEqual(prefs.leftSidebar.filterAmounts, prefs.rightSidebar.filterAmounts);
  assert.ok(Object.isFrozen(core.DEFAULTS.leftSidebar.filterAmounts));
  const edited = core.normalizeSettings({
    ...prefs,
    leftSidebar: { background: 'theme', filterMode: 'blue', filterAmounts: { blue: 999, blur: 18.6 }, toolbar: false, tint: false, visibilityMode: 'custom', visibility: 103 },
    rightSidebar: { background: 'wallpaper', filterMode: 'dim', filterAmounts: { dim: -1, blur: 8 }, toolbar: true, visibilityMode: 'custom', visibility: 46.6 },
  });
  assert.equal(edited.leftSidebar.filterAmounts.blue, 60);
  assert.equal(edited.leftSidebar.filterAmounts.blur, 19);
  assert.equal(edited.rightSidebar.filterAmounts.dim, 0);
  assert.equal(edited.rightSidebar.filterAmounts.blur, 8);
  assert.equal(edited.filterAmounts.blur, 17);
  assert.equal(edited.leftSidebar.toolbar, false);
  assert.equal(edited.leftSidebar.tint, false);
  assert.equal(edited.rightSidebar.tint, true);
  assert.equal(edited.leftSidebar.visibilityMode, 'custom');
  assert.equal(edited.leftSidebar.visibility, 100);
  assert.equal(edited.rightSidebar.visibility, 47);
  assert.deepEqual(core.normalizeSettings(JSON.parse(JSON.stringify(edited))), edited);
  for (const value of [null, false, 'bad', [], { background: '</style>', filterMode: '__proto__', toolbar: 'false', visibilityMode: 'other', visibility: Infinity, filterAmounts: { blur: Infinity } }]) {
    assert.deepEqual(normalizeSidebar(value), normalizeSidebar());
  }
});

test('desktop, fullscreen and mobile share docked backgrounds without changing floating panes or frame stacking', async () => {
  const css = render();
  assert.equal(rule(css, rightPane), `background:${base}`);
  assert.ok(rule(css, photoLayer(rightPane)).includes(`background:${photo} no-repeat;background-size:var(--bdt-wallpaper-size,cover)`));
  assert.ok(css.includes(`${rightPane}{position:relative;isolation:isolate}`));
  assert.ok(css.includes(`${leftRoot}{position:relative;background:transparent}`));
  assert.ok(css.includes(`body div:has(> [data-shell-overlay]):not([data-sidebar-drawer]) > div:has(> [data-slot="sidebar"]){position:relative}`));
  assert.ok(css.includes(`${leftColumn}{--dsw-specific-sidebar-fill:transparent}`));
  assert.ok(css.includes(`${rightPane} > :is(div, [data-dockkit-pane])`), 'empty pane and body/header wrapper fills are cleared');
  assert.doesNotMatch(css, /fullscreen|@media|data-dockkit-float|::after|transform:|contain:/);
  for (const surface of [leftColumn, rightPane]) {
    assert.equal(rule(css, surface), `background:${base}`, 'moving surface has only an opaque fallback');
    assert.ok(rule(css, background(surface)).includes('overflow:hidden'));
    assert.ok(css.includes(`${background(surface)}{visibility:inherit}`), 'background follows the native pane visibility during closing');
  }
  assert.doesNotMatch(css, /data-sidebar-right-panel\]\{/, 'the common panel must not become a stacking or containing block');
  assert.doesNotMatch(css, / > div\{[^}]*isolation:/, 'left fixed caption controls must stay in the frame stacking context');
  const parsed = await transform(css, { loader: 'css' });
  assert.deepEqual(parsed.warnings, []);
  assert.equal(sidebarBackgroundCSS({ settings: { enabled: false }, image: photo, overlays: [] }), '');
  assert.equal(sidebarBackgroundCSS({ settings: core.DEFAULTS, image: '', overlays: [] }), '');
});

test('sidebar effects travel with their own image layer and independent toolbar fills', async () => {
  for (const scheme of ['light', 'dark']) for (const mode of wallpaperFilters.modes) {
    const css = render({
      filterMode: 'blur', filterAmounts: { blur: 7 },
      leftSidebar: { filterMode: mode, toolbar: false },
      rightSidebar: { filterMode: 'inherit' },
    }, scheme);
    const picture = rule(css, photoLayer(leftColumn)), veil = rule(css, veilLayer(leftColumn));
    const effect = wallpaperFilters.effect({ filterMode: mode });
    assert.ok(picture.includes(`filter:${effect?.filter || 'none'}`), mode);
    assert.ok(picture.includes(`background:${photo}`));
    assert.ok(veil.includes('rgba(240, 240, 240, 0.5)'), `${mode}: selected sidebar tint paints above the filtered image`);
    if (effect?.tint) assert.ok(veil.includes(effect.tint));
    assert.ok(rule(css, background(rightPane)).includes('z-index:-1'));
    assert.ok(rule(css, photoLayer(rightPane)).includes('filter:blur(7px)'));
    const bleed = effect?.bleed || 0;
    assert.ok(picture.includes(`background-position:calc(var(--bdt-wallpaper-x,0px) + ${bleed}px) calc(var(--bdt-wallpaper-y,0px) + ${bleed}px)`));
    assert.ok(css.includes(`${leftRoot} > [data-window-drag]{background-color:${base}}`));
    const parsed = await transform(css, { loader: 'css' });
    assert.deepEqual(parsed.warnings, []);
  }
  const zero = render({ leftSidebar: { filterMode: 'blur', filterAmounts: { blur: 0 } } });
  assert.ok(rule(zero, photoLayer(leftColumn)).includes('filter:none'));
  assert.ok(zero.includes('linear-gradient(rgba(240, 240, 240, 0.5)'));
  assert.doesNotMatch(render({ leftSidebar: { filterMode: 'blur);display:none', filterAmounts: { blur: '1);color:red' } } }), /display:none|color:red/);
});

test('background decoration mounts behind content without using the pane reveal-flash pseudo-element', () => {
  const document = {
    createElement(tag) {
      return {
        tag, attributes: {}, style: {}, children: [],
        setAttribute(name, value) { this.attributes[name] = value; },
        append(...children) { this.children.push(...children); },
        prepend(child) { this.children.unshift(child); },
      };
    },
  };
  const surface = document.createElement('section'), content = document.createElement('main');
  surface.append(content);
  const layer = mountSidebarBackground(document, surface);
  assert.deepEqual(surface.children, [layer, content]);
  assert.equal(layer.attributes['aria-hidden'], 'true');
  assert.equal(layer.style.position, 'absolute');
  assert.equal(layer.style.pointerEvents, 'none');
  assert.ok(Object.hasOwn(layer.attributes, 'data-bdt-sidebar-background'));
  assert.ok(Object.hasOwn(layer.children[0].attributes, 'data-bdt-sidebar-image'));
  assert.ok(Object.hasOwn(layer.children[1].attributes, 'data-bdt-sidebar-veil'));
});

test('solid theme backgrounds remain opaque with dynamic colours on or off', () => {
  for (const dynamic of [true, false]) {
    const css = render({ dynamic, leftSidebar: { background: 'theme' }, rightSidebar: { background: 'theme' } });
    assert.ok(css.includes(`${rightPane}{background:${base}}`));
    assert.ok(css.includes(`${leftColumn},${leftRoot}{background:${base}}`));
    assert.ok(css.includes(`${leftColumn}{--dsw-specific-sidebar-fill:transparent}`));
    assert.doesNotMatch(css, /brand-primary|color-mix/);
    assert.doesNotMatch(css, /url\(|::before|backdrop-filter/);
  }
});

test('wallpaper theme overlay is independent per side; solid mode is the exact opaque sidebar colour', () => {
  const css = render({ strength: 100, leftSidebar: { tint: false }, rightSidebar: { tint: true } });
  const [left, right] = css.split(`${rightPane}{background:`);
  assert.ok(!left.includes('rgba(240, 240, 240, 0.5)'));
  assert.ok(right.includes('rgba(240, 240, 240, 0.5)'));
  assert.ok(rule(css, veilLayer(leftColumn)).includes('background-image:none'));
  for (const tint of [true, false]) {
    const solid = sidebarBackgroundCSS({
      settings: core.normalizeSettings({ leftSidebar: { background: 'theme', tint }, rightSidebar: { background: 'theme', tint } }),
      image: photo, overlays: [], matte: 'rgba(12, 34, 56, 0.2)', base: 'rgb(12, 34, 56)',
    });
    assert.ok(solid.includes(`${rightPane}{background:rgb(12, 34, 56)}`));
    assert.doesNotMatch(solid, /rgba\(|color-mix|brand-primary|background-image|url\(/);
  }
});

test('solid and overlay colours use the palette card sidebar role in every mode and scheme', () => {
  for (const accent of [[29, 82, 214], [220, 100, 25], [128, 128, 128]]) for (const mode of core.PALETTE_MODES) {
    for (const strength of [10, 28, 100]) {
      const tokens = core.makeTokens(accent, strength, mode);
      for (const scheme of ['light', 'dark']) {
        const { base, matte } = sidebarColors(tokens, scheme);
        assert.equal(base, palettePreviewStyle(tokens, scheme)['--bdt-mini-canvas'], `${mode}/${scheme}: matches the visible sidebar sample`);
        assert.deepEqual(matte.match(/\d+/g).slice(0, 3), base.match(/\d+/g));
        assert.ok(matte.endsWith(`, ${SIDEBAR_TINT_ALPHA})`));
      }
    }
  }
});

test('theme overlay remains visible at maximum wallpaper visibility and only affects the selected side', () => {
  for (const scheme of ['light', 'dark']) {
    const tokens = core.makeTokens([29, 82, 214], 100);
    const { base, matte } = sidebarColors(tokens, scheme);
    const settings = core.normalizeSettings({ strength: 100, leftSidebar: { tint: true }, rightSidebar: { tint: false } });
    const css = sidebarBackgroundCSS({ settings, image: photo, overlays: [], base, matte });
    const [left, right] = css.split(`${rightPane}{background:`);
    assert.ok(left.includes(`linear-gradient(${matte},${matte})`));
    assert.ok(!right.includes(matte));
    const rgb = base.match(/\d+/g).map(Number);
    const photoPixel = scheme === 'light' ? 0 : 255;
    const uncoloured = photoPixel;
    const coloured = rgb.map(channel => channel * SIDEBAR_TINT_ALPHA + uncoloured * (1 - SIDEBAR_TINT_ALPHA));
    assert.ok(coloured.some(channel => Math.abs(channel - uncoloured) >= 10), `${scheme}: checkbox produces a visible overlay at 100%`);
  }
});

test('sidebar wallpaper has no extra tint when its overlay and filter are off', () => {
  const css = render({ strength: 100, leftSidebar: { tint: false }, rightSidebar: { tint: false } });
  for (const surface of [leftColumn, rightPane]) {
    assert.match(rule(css, photoLayer(surface)), /filter:none/);
    assert.match(rule(css, veilLayer(surface)), /background-image:none/);
  }
});

test('sidebars follow main visibility by default or retain independent custom values', () => {
  const tint = strength => `color-mix(in srgb, ${base} ${core.backgroundAlpha(strength) * 100}%, transparent)`;
  const surface = (css, side) => rule(css, veilLayer(side === 'left' ? leftColumn : rightPane));
  for (const strength of [10, 28, 50, 75, 99, 100]) {
    const css = render({ strength, leftSidebar: { tint: false }, rightSidebar: { tint: false } });
    for (const side of ['left', 'right']) {
      const layer = surface(css, side);
      if (strength === 100) assert.match(layer, /background-image:none/);
      else assert.ok(layer.includes(`linear-gradient(${tint(strength)},${tint(strength)})`), `${side} follows ${strength}%`);
    }
  }
  const sides = {
    leftSidebar: { tint: false, visibilityMode: 'custom', visibility: 75 },
    rightSidebar: { tint: false, visibilityMode: 'custom', visibility: 30 },
  };
  for (const strength of [10, 100]) {
    const css = render({ strength, ...sides });
    assert.ok(surface(css, 'left').includes(tint(75)));
    assert.ok(surface(css, 'right').includes(tint(30)));
  }
  const mixed = render({ strength: 40, ...sides, rightSidebar: { ...sides.rightSidebar, visibilityMode: 'inherit' } });
  assert.ok(surface(mixed, 'left').includes(tint(75)));
  assert.ok(surface(mixed, 'right').includes(tint(40)));
});

test('sidebar visibility fades filters beneath independently selected theme tint', async () => {
  const css = render({
    strength: 50, filterMode: 'blue', filterAmounts: { blue: 40 },
    leftSidebar: { tint: true }, rightSidebar: { tint: false },
  });
  const left = rule(css, veilLayer(leftColumn)), right = rule(css, veilLayer(rightPane));
  const visibility = `color-mix(in srgb, ${base} ${core.backgroundAlpha(50) * 100}%, transparent)`;
  const filter = 'rgb(48 110 246 / 40%)';
  assert.ok(left.includes('rgba(240, 240, 240, 0.5)') && left.includes(visibility) && left.includes(filter));
  assert.ok(left.indexOf('rgba(240, 240, 240, 0.5)') < left.indexOf(visibility));
  assert.ok(left.indexOf(visibility) < left.indexOf(filter));
  assert.ok(right.includes(visibility) && right.includes(filter));
  assert.ok(!right.includes('rgba(240, 240, 240, 0.5)'));
  assert.deepEqual((await transform(css, { loader: 'css' })).warnings, []);
});

test('sidebar settings render labelled controls, persist changes and leave wallpaper loading and theme tokens alone', { timeout: 5000 }, async t => {
  const en = JSON.parse(await read('locale/en.json')), zh = JSON.parse(await read('locale/zh.json'));
  for (const dict of [en, zh]) for (const key of ['leftSidebar', 'rightSidebar', 'sidebarBackground', 'sidebarBackground.wallpaper', 'sidebarBackground.theme', 'sidebarToolbar', 'sidebarTint', 'filter.inherit']) {
    assert.equal(typeof dict[key], 'string', key);
  }
  const slots = new Map(), disposers = [];
  const savedGlobals = new Map(['localStorage', 'document', 'window', 'Image'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    try { for (const dispose of disposers.reverse()) dispose(); }
    finally { for (const [key, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
  });
  const storage = new Map([[PREFERENCES_KEY, JSON.stringify(core.normalizeSettings({ mode: 'follow' }))]]);
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = {
    getElementById() { return null; }, addEventListener() {}, removeEventListener() {},
  };
  globalThis.Image = class { decode() { return Promise.resolve(); } };
  let fail = false, overrides = 0, themeWrites = 0, appliedTokens;
  let loaded;
  const applied = new Promise(resolve => { loaded = resolve; });
  const fetch = t.mock.method(globalThis, 'fetch', async url => {
    if (fail) return new Response('', { status: 503 });
    assert.ok(url.includes('/api/daily'));
    return Response.json({ market: 'zh-CN', imageUrl: '/bing-daily-theme/api/image?id=OHR.Test_ZH-CN123_1920x1080.jpg', date: '2026-11-20' });
  });
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) }),
    useSyncExternalStore: (_, get) => get(), useState: initial => [initial(), () => {}],
    useMemo: make => make(), useRef: current => ({ current }), useId: () => 'test', useEffect() {}, useLayoutEffect() {},
  };
  const ctx = {
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); }, on() {},
    locale: { register() {}, bind: () => key => en[key] ?? key, subscribe: () => () => {}, getSnapshot: () => 'en' },
    slots: { inject: (_, fn) => fn(), register: (options, component) => { slots.set(options.id, component); return () => {}; } },
    theme: { getTheme: () => ({ preference: 'light', active: { colorScheme: 'light' } }), setTheme() { themeWrites++; }, overrideTokens(_source, tokens) { appliedTokens = tokens; overrides++; loaded(); return () => {}; } },
  };
  createPlugin(React, core, { en, zh }, createAppearanceController).apply(ctx);
  await applied;
  await new Promise(setImmediate); // Allow the decoded photo to mount after theme application.
  const settings = slots.get('bing-daily-theme'), wallpaper = slots.get('bing-daily-theme.wallpaper');
  const nodes = node => typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
  const find = id => nodes(settings()).find(node => node.props.id === id);
  const change = (id, value, checked) => find(id).props.onChange({ target: { value, checked } });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(overrides, 1);
  assert.ok(wallpaper().children[0].includes('[data-dockkit-strip]'));
  const { base: solid, matte } = sidebarColors(appliedTokens, 'light');
  const selectedCard = nodes(settings()).find(node => node.type === 'label' && node.props.htmlFor === 'test-content');
  const sample = nodes(selectedCard).find(node => node.props.className === 'bdt-mini bdt-mini-light');
  assert.equal(solid, sample.props.style['--bdt-mini-canvas']);
  assert.ok(wallpaper().children[0].includes(`linear-gradient(${matte},${matte})`));
  for (const mode of wallpaperFilters.modes) {
    change('bdt-filterMode', mode);
    const css = wallpaper().children[0], container = rule(css, 'html');
    assert.match(container, /^background-color:rgb\([^;]+\);background-image:none$/);
    const effect = wallpaperFilters.effect({ filterMode: mode });
    assert.ok(rule(css, 'html::before').includes(`filter:${effect?.filter || 'none'}`));
    assert.ok(rule(css, 'html::before').includes('url('));
    const visibility = appliedTokens['--dsw-alias-bg-base'].light;
    const overlays = [visibility, ...(effect?.tint ? [effect.tint] : [])];
    assert.ok(rule(css, 'html::after').includes(`background-image:${overlays.map(color => `linear-gradient(${color},${color})`).join(',')}`));
    assert.doesNotMatch(rule(css, 'html::after'), /url\(|filter:/);
  }
  change('bdt-filterMode', 'none');
  change('bdt-strength', '100');
  assert.match(appliedTokens['--dsw-alias-bg-base'].light, /, 0\)$/);
  assert.match(rule(wallpaper().children[0], 'html::before'), /filter:none/);
  assert.match(rule(wallpaper().children[0], 'html::after'), /background-image:none/);
  for (const side of [leftColumn, rightPane]) assert.doesNotMatch(rule(wallpaper().children[0], veilLayer(side)), /color-mix/);
  change('bdt-strength', '28');
  change('bdt-weatherChoice', 'rain');
  const mainCSS = wallpaper().children[0];
  assert.ok(mainCSS.includes(WEATHER_LAYOUT_CSS));
  const shell = 'body div:has(> [data-shell-overlay])';
  const transparentSurfaces = mainCSS.match(/[^{}]+(?=\{background-color:transparent\})/g)
    .flatMap(selectors => selectors.split(/,\s*\n/).map(selector => selector.trim()));
  for (const selector of [shell, `html[data-windows-titlebar] ${shell}`, 'body [data-slot="main.conversation"] > [data-phase]']) {
    assert.ok(transparentSurfaces.includes(selector), selector);
  }
  globalThis.window.frameElement = { matches: selector => selector === 'iframe[data-dsh-tile-layout]' };
  assert.ok(!wallpaper().children[0].includes(WEATHER_LAYOUT_CSS));
  delete globalThis.window.frameElement;
  const depth = (css, selector) => Number(/z-index:(-?\d+)/.exec(rule(css, selector))[1]);
  assert.ok(depth(mainCSS, 'html::before') < depth(mainCSS, 'html::after'));
  assert.ok(depth(mainCSS, 'html::after') < depth(WEATHER_LAYOUT_CSS, '[data-bdt-weather]'));
  for (const side of [leftColumn, rightPane]) {
    assert.ok(depth(mainCSS, veilLayer(side)) < depth(WEATHER_LAYOUT_CSS, '[data-bdt-sidebar-background]>[data-bdt-weather-pane]'));
  }
  fail = true;
  nodes(settings()).find(node => node.props.className === 'bdt-photo-refresh').props.onClick();
  await new Promise(setImmediate);
  const calls = fetch.mock.callCount(), tokenCalls = overrides;
  change('bdt-leftSidebar.visibilityMode', 'custom');
  change('bdt-leftSidebar.visibility', '73');
  const leftVisibility = `color-mix(in srgb, ${solid} ${core.backgroundAlpha(73) * 100}%, transparent)`;
  assert.ok(rule(wallpaper().children[0], veilLayer(leftColumn)).includes(leftVisibility));
  assert.ok(!rule(wallpaper().children[0], veilLayer(rightPane)).includes(leftVisibility));
  change('bdt-leftSidebar.visibilityMode', 'inherit');
  assert.ok(!rule(wallpaper().children[0], veilLayer(leftColumn)).includes(leftVisibility));
  change('bdt-leftSidebar.visibilityMode', 'custom');
  assert.equal(find('bdt-leftSidebar.visibility').props.value, 73);
  change('bdt-leftSidebar.filterMode', 'blur');
  let amount = find('bdt-leftSidebar.filterAmount');
  assert.equal(amount.props.max, 32);
  assert.equal(amount.props['aria-valuetext'], '12 pixels');
  assert.ok(nodes(settings()).some(node => node.type === 'label' && node.props.htmlFor === amount.props.id));
  change(amount.props.id, '21');
  change('bdt-leftSidebar.filterMode', 'blue');
  change('bdt-leftSidebar.filterMode', 'blur');
  assert.equal(find('bdt-leftSidebar.filterAmount').props.value, 21);
  change('bdt-leftSidebar.tint', undefined, false);
  change('bdt-rightSidebar.toolbar', undefined, false);
  change('bdt-rightSidebar.background', 'theme');
  assert.equal(find('bdt-rightSidebar.filterMode').props.disabled, true);
  assert.equal(find('bdt-rightSidebar.tint').props.disabled, true);
  assert.equal(find('bdt-rightSidebar.visibilityMode').props.disabled, true);
  assert.ok(wallpaper().children[0].includes(`${rightPane}{background:${solid}}`));
  assert.ok(!wallpaper().children[0].includes(`linear-gradient(${matte},${matte})`));
  change('bdt-rightSidebar.background', 'wallpaper');
  assert.ok(wallpaper().children[0].includes(`linear-gradient(${matte},${matte})`), 'wallpaper overlays the same RGB used by solid mode');
  change('bdt-rightSidebar.background', 'theme');
  const prefs = JSON.parse(storage.get(PREFERENCES_KEY));
  assert.equal(prefs.leftSidebar.filterAmounts.blur, 21);
  assert.equal(prefs.leftSidebar.visibilityMode, 'custom');
  assert.equal(prefs.leftSidebar.visibility, 73);
  assert.equal(prefs.leftSidebar.tint, false);
  assert.equal(prefs.rightSidebar.tint, true);
  assert.equal(prefs.rightSidebar.toolbar, false);
  assert.equal(prefs.rightSidebar.background, 'theme');
  assert.equal(prefs.filterMode, 'none');
  assert.equal(fetch.mock.callCount(), calls);
  assert.equal(overrides, tokenCalls);
  assert.equal(themeWrites, 0);
  assert.ok(nodes(settings()).some(node => node.props.className === 'bdt-photo-status' && node.children.includes(en.fetchFailed)));
  change('bdt-enabled', undefined, false);
  assert.equal(wallpaper(), null);
  const sidebarFields = nodes(settings()).filter(node => node.type === 'details' && node.props.className === 'bdt-sidebar-group')
    .flatMap(node => node.children.filter(child => child.type === 'fieldset'));
  assert.equal(sidebarFields.length, 2);
  assert.ok(sidebarFields.every(node => node.props.disabled));
});
