import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import * as core from '../src/client/theme/palette.js';
import { createPlugin } from '../src/client/client-main.js';
import { PREFERENCES_KEY } from '../src/shared/boot-theme.js';
const { PALETTE_MODES, makeTokens, contrast } = core;
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
test('both locales label the ten palettes without removed help text or original mode', async () => {
  const en = JSON.parse(await read('locale/en.json')), zh = JSON.parse(await read('locale/zh.json'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const dict of [en, zh]) {
    assert.ok(dict.paletteMode?.length);
    for (const mode of PALETTE_MODES) assert.ok(dict[`palette.${mode}`]?.length, mode);
    for (const key of Object.keys(dict)) assert.ok(!key.startsWith('paletteHint.'), key);
    for (const key of ['palette.original','paletteDisabled','visibilityHint','highVisibility','intro','note']) assert.ok(!(key in dict), `${key} removed`);
    for (const key of ['loading','refresh','firstFetchFailed','fetchFailed','sourceFailed','storageFailed','market','market.zh-CN','market.en-US']) assert.ok(dict[key]?.length, `${key} retained`);
  }
});
test('simplified controls retain labels and values without dangling help references', async () => {
  const source = await read('src/client/client-main.js');
  assert.match(source, /core\.makeTokens\(settings\.dynamic[^;]+settings\.paletteMode/);
  assert.match(source, /core\.makeTokens\(prefs\.dynamic[^;]+prefs\.strength[^;]+prefs\.paletteMode/);
  assert.match(source, /core\.PALETTE_MODES\.map/);
  assert.match(source, /h\('fieldset', \{ className: 'bdt-palette-group', disabled: !prefs\.dynamic/);
  assert.match(source, /h\('legend', null, t\('paletteMode'\)\)/);
  assert.match(source, /type: 'radio', name: paletteGroup, value: mode, checked: prefs\.paletteMode === mode, onChange: \(\) => update\(\{ paletteMode: mode \}\)/);
  assert.doesNotMatch(source, /row\('paletteMode'|id: 'bdt-paletteMode'/);
  assert.match(source, /prefs\.dynamic && h\('div', \{ className: 'bdt-swatches'/);
  assert.match(source, /id: 'bdt-strength'[^}]+max: 100[^}]+step: 1/);
  assert.match(source, /'aria-valuetext': `\$\{prefs\.strength\}%`/);
  assert.match(source, /h\('label', \{ htmlFor:/);
  assert.match(source, /role: 'status', 'aria-live': 'polite'/);
  assert.doesNotMatch(source, /bdt-(?:palette|strength)-help|paletteHint|highVisibility|visibilityHint|t\('intro'\)|t\('note'\)|'original'/);
  assert.doesNotMatch(source, /require\(['"]@deepseek-ai\//);
});
test('wallpaper has no fixed readability scrim and dynamic-off releases every colour override', async () => {
  const source = await read('src/client/client-main.js');
  const wallpaper = source.slice(source.indexOf('function Wallpaper()'), source.indexOf('function Settings()'));
  assert.doesNotMatch(wallpaper, /wallpaperShade/);
  assert.match(source, /if \(!settings\.dynamic\) for \(const key of Object\.keys\(tokens\)\) if \(key !== '--dsw-alias-bg-base'\) delete tokens\[key\]/);
  assert.match(source, /if \(!settings\.enabled \|\| \(!state\.url && !\(settings\.dynamic && matches\)\)\) \{\s*tokenDisposer\?\.\(\)/);
});
test('wallpaper applies browser-local sidebar backgrounds only while enabled with a decoded photo', async () => {
  const source = await read('src/client/client-main.js');
  const wallpaper = source.slice(source.indexOf('function Wallpaper()'), source.indexOf('function Settings()'));
  assert.match(wallpaper, /if \(!s\.settings\.enabled \|\| !s\.url\) return null;[\s\S]+sidebarBackgroundCSS\(\{ settings: s\.settings, image, overlays: \[\], matte, base \}\)/);
  assert.match(wallpaper, /sidebarColors\(colors, s\.scheme\)/);
  assert.match(wallpaper, /alignWallpaper\(\{\s+document, window, surfaces: SIDEBAR_SURFACES/);
  assert.match(wallpaper, /mountBackground: surface => mountSidebarBackground\(document, surface, active\)/);
  const bundle = await read('dist/client.js');
  assert.ok(bundle.includes('leftSidebar') && bundle.includes('rightSidebar') && bundle.includes('data-dockkit-strip'), 'prebuilt client includes sidebar controls and chrome styling');
});

test('settings have labelled groups and keep scheduled times together', async t => {
  const dictionaries = Object.fromEntries(await Promise.all(['en', 'zh'].map(async lang => [lang, JSON.parse(await read(`locale/${lang}.json`))])));
  const originals = new Map(['localStorage', 'document', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = new Map([[PREFERENCES_KEY, JSON.stringify({ enabled: false, mode: 'schedule', day: '06:15', night: '20:30' })]]);
  const disposers = [], slots = new Map();
  t.after(() => {
    try { for (const dispose of disposers.reverse()) dispose(); }
    finally { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
  });
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById() { return null; } };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) }),
    useSyncExternalStore: (_, get) => get(), useState: initial => [initial(), () => {}], useMemo: make => make(), useRef: current => ({ current }), useId: () => 'bdt-test', useEffect() {}, useLayoutEffect() {},
  };
  let lang = 'en';
  createPlugin(React, core, dictionaries, () => ({ sync() {}, restore() {}, changed() {} })).apply({
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); }, on() {},
    locale: { register() {}, bind: () => key => dictionaries[lang][key] ?? key, subscribe: () => () => {}, getSnapshot: () => lang },
    slots: { inject: (_, register) => register(), register(options, component) { slots.set(options.id, component); return () => {}; } },
    theme: { getTheme: () => ({ active: { colorScheme: 'light' } }), overrideTokens: () => () => {} },
  });
  const nodes = node => typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
  const view = () => nodes(slots.get('bing-daily-theme')());
  const find = (screen, id) => screen.find(node => node.props.id === id);
  const assertOrder = (screen, ids) => {
    const indexes = ids.map(id => screen.findIndex(node => node.props.id === id));
    assert.ok(indexes.every(index => index >= 0), `missing controls: ${ids.filter((_, i) => indexes[i] < 0)}`);
    assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
    for (const id of ids) assert.equal(screen.filter(node => node.props.id === id).length, 1, id);
  };
  const groups = {
    wallpaper: ['enabled', 'market', 'resolution'],
    appearance: ['mode', 'day', 'night'],
    background: ['strength', 'filterMode', 'parallaxMode', 'parallax'],
    sidebars: ['leftSidebar.background', 'rightSidebar.background'],
    weather: ['weatherChoice'],
    colours: ['dynamic', ...PALETTE_MODES.map(mode => `test-${mode}`)],
  };
  const ordered = ['bdt-mode', 'bdt-day', 'bdt-night', 'bdt-strength', 'bdt-leftSidebar.background', 'bdt-rightSidebar.background'];
  for (lang of ['en', 'zh']) {
    const screen = view();
    assertOrder(screen, ordered);
    const sections = screen.filter(node => node.type === 'section' && node.props.className === 'bdt-card');
    assert.deepEqual(sections.map(section => section.props['aria-labelledby']), Object.keys(groups).map(key => `bdt-group-${key}`));
    for (const [key, controls] of Object.entries(groups)) {
      const titleId = `bdt-group-${key}`;
      const section = sections.find(node => node.props['aria-labelledby'] === titleId);
      const contents = nodes(section);
      const heading = find(contents, titleId);
      assert.equal(heading?.type, 'h3');
      assert.ok(dictionaries[lang][`settingsGroup.${key}`]);
      assert.equal(heading.children[0], dictionaries[lang][`settingsGroup.${key}`]);
      assertOrder(contents, controls.map(id => `bdt-${id}`));
    }
    for (const key of ['mode', 'day', 'night', 'strength']) {
      const label = screen.find(node => node.type === 'label' && node.props.htmlFor === `bdt-${key}`);
      assert.equal(label?.children[0], dictionaries[lang][key]);
    }
    assert.equal(find(screen, 'bdt-day').props.value, '06:15');
    assert.equal(find(screen, 'bdt-night').props.value, '20:30');
  }
  find(view(), 'bdt-mode').props.onChange({ target: { value: 'follow' } });
  let screen = view();
  assertOrder(screen, ['bdt-mode', 'bdt-strength', 'bdt-leftSidebar.background', 'bdt-rightSidebar.background']);
  assert.equal(find(screen, 'bdt-day'), undefined);
  assert.equal(find(screen, 'bdt-night'), undefined);
  find(screen, 'bdt-strength').props.onChange({ target: { value: '72' } });
  find(view(), 'bdt-mode').props.onChange({ target: { value: 'schedule' } });
  screen = view();
  assertOrder(screen, ordered);
  assert.equal(find(screen, 'bdt-strength').props.value, 72);
  assert.equal(find(screen, 'bdt-day').props.value, '06:15');
  find(screen, 'bdt-day').props.onChange({ target: { value: '07:00' } });
  assert.equal(JSON.parse(storage.get(PREFERENCES_KEY)).day, '07:00');
  assert.equal(JSON.parse(storage.get(PREFERENCES_KEY)).strength, 72);
});

test('sidebar visibility controls and disclosure state stay independent and retain custom values', async t => {
  const dictionaries = Object.fromEntries(await Promise.all(['en', 'zh'].map(async lang => [lang, JSON.parse(await read(`locale/${lang}.json`))])));
  const originals = new Map(['localStorage', 'document', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const initial = { enabled: true, leftSidebar: { visibilityMode: 'inherit' }, rightSidebar: { visibilityMode: 'custom', visibility: 67 } };
  const storage = new Map([[PREFERENCES_KEY, JSON.stringify(initial)]]);
  const disposers = [], slots = new Map();
  t.after(() => {
    try { for (const dispose of disposers.reverse()) dispose(); }
    finally { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
  });
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById() { return null; } };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  let sidebarOpen;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) }),
    useSyncExternalStore(_, get) {
      const snapshot = get();
      return snapshot?.settings ? { ...snapshot, url: 'blob:preview' } : snapshot;
    },
    useMemo: make => make(), useRef: current => ({ current }), useId: () => 'test', useEffect() {}, useLayoutEffect() {},
    useState(initialState) {
      if (sidebarOpen === undefined) sidebarOpen = initialState();
      return [sidebarOpen, update => { sidebarOpen = typeof update === 'function' ? update(sidebarOpen) : update; }];
    },
  };
  let lang = 'en', effects = 0;
  const ctx = {
    // The fourth effect starts the unrelated refresh timer and network request.
    effect(fn) { if (++effects === 4) return; const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); }, on() {},
    locale: { register() {}, bind: () => key => dictionaries[lang][key] ?? key, subscribe: () => () => {}, getSnapshot: () => lang },
    slots: { inject: (_, register) => register(), register(options, component) { slots.set(options.id, component); return () => {}; } },
    theme: { getTheme: () => ({ active: { colorScheme: 'light' } }), overrideTokens: () => () => {} },
  };
  const start = () => createPlugin(React, core, dictionaries, () => ({ sync() {}, restore() {}, changed() {} })).apply(ctx);
  start();
  const nodes = node => typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
  const view = () => nodes(slots.get('bing-daily-theme')());
  const find = id => view().find(node => node.props.id === id);
  const change = (id, value) => find(id).props.onChange({ target: { value } });
  const toggle = (side, open) => find(`bdt-${side}`).props.onToggle({ currentTarget: { open } });
  const saved = () => JSON.parse(storage.get(PREFERENCES_KEY));

  for (lang of ['en', 'zh']) {
    for (const side of ['leftSidebar', 'rightSidebar']) {
      const panel = find(`bdt-${side}`), fieldset = panel.children.find(node => node.type === 'fieldset');
      assert.equal(panel.type, 'details');
      assert.equal(panel.children[0].type, 'summary');
      assert.equal(panel.children[0].children[0], dictionaries[lang][side]);
      assert.equal(fieldset.children[0].type, 'legend');
      assert.equal(fieldset.children[0].children[0], dictionaries[lang][side]);
      assert.equal(fieldset.props.disabled, false);
      const selector = find(`bdt-${side}.visibilityMode`);
      assert.equal(selector.props.disabled, false);
      assert.deepEqual(selector.children.map(option => [option.props.value, option.children[0]]), [
        ['inherit', dictionaries[lang]['sidebarVisibility.inherit']], ['custom', dictionaries[lang]['sidebarVisibility.custom']],
      ]);
      const label = view().find(node => node.type === 'label' && node.props.htmlFor === selector.props.id);
      assert.equal(label.children[0], dictionaries[lang].sidebarVisibility);
      if (side === 'rightSidebar') {
        const amountLabel = view().find(node => node.type === 'label' && node.props.htmlFor === `bdt-${side}.visibility`);
        assert.equal(amountLabel.children[0], dictionaries[lang].sidebarVisibilityAmount);
      }
    }
  }
  assert.equal(find('bdt-leftSidebar').props.open, false);
  assert.equal(find('bdt-rightSidebar').props.open, true);
  assert.equal(find('bdt-leftSidebar.visibility'), undefined);
  assert.equal(find('bdt-rightSidebar.visibility').props.value, 67);

  const untouched = storage.get(PREFERENCES_KEY);
  toggle('leftSidebar', true);
  toggle('rightSidebar', false);
  assert.equal(find('bdt-leftSidebar').props.open, true);
  assert.equal(find('bdt-rightSidebar').props.open, false);
  assert.equal(storage.get(PREFERENCES_KEY), untouched, 'panel expansion is not persisted as a preference');

  change('bdt-leftSidebar.visibilityMode', 'custom');
  let slider = find('bdt-leftSidebar.visibility');
  assert.deepEqual([slider.props.min, slider.props.max, slider.props.step, slider.props.value], [10, 100, 1, 28]);
  assert.equal(slider.props['aria-valuetext'], '28%');
  assert.equal(view().find(node => node.type === 'output' && node.props.htmlFor === slider.props.id).children[0], '28%');
  change('bdt-leftSidebar.visibility', '93');
  change('bdt-leftSidebar.visibilityMode', 'inherit');
  assert.equal(find('bdt-leftSidebar.visibility'), undefined);
  assert.equal(find('bdt-leftSidebar').props.open, true, 'switching to inherit keeps the panel open');
  assert.equal(saved().leftSidebar.visibility, 93);
  change('bdt-strength', '72');
  change('bdt-leftSidebar.visibilityMode', 'custom');
  assert.equal(find('bdt-leftSidebar.visibility').props.value, 93);
  assert.equal(find('bdt-rightSidebar.visibility').props.value, 67);

  toggle('rightSidebar', true);
  change('bdt-rightSidebar.background', 'theme');
  assert.equal(find('bdt-rightSidebar.visibilityMode').props.disabled, true);
  assert.equal(find('bdt-rightSidebar.visibility').props.disabled, true);
  assert.equal(find('bdt-leftSidebar.visibilityMode').props.disabled, false);
  assert.equal(saved().rightSidebar.visibility, 67);
  change('bdt-rightSidebar.background', 'wallpaper');
  assert.equal(find('bdt-rightSidebar.visibilityMode').props.disabled, false);
  assert.equal(find('bdt-rightSidebar.visibility').props.disabled, false);
  change('bdt-rightSidebar.visibility', '10');
  assert.equal(saved().rightSidebar.visibility, 10);
  assert.equal(saved().leftSidebar.visibility, 93);
  change('bdt-rightSidebar.visibility', '100');
  assert.equal(saved().rightSidebar.visibility, 100);

  change('bdt-leftSidebar.visibilityMode', 'inherit');
  toggle('rightSidebar', false);
  sidebarOpen = undefined; effects = 0;
  start(); // Reload preferences rather than retaining the last disclosure state.
  assert.equal(find('bdt-leftSidebar').props.open, false);
  assert.equal(find('bdt-rightSidebar').props.open, true);
  assert.equal(saved().leftSidebar.visibility, 93);
  assert.equal(find('bdt-rightSidebar.visibility').props.value, 100);
  toggle('leftSidebar', true);
  change('bdt-leftSidebar.visibilityMode', 'custom');
  assert.equal(find('bdt-leftSidebar.visibility').props.value, 93);

  await t.test('one weather selector applies fixed conditions and keeps the original photo in settings', () => {
    const optionValues = find('bdt-weatherChoice').children.map(node => node.props.value);
    assert.deepEqual(optionValues.slice(0, 2), ['off', 'location']);
    assert.ok(optionValues.includes('clouds') && optionValues.includes('heavyRain'));
    assert.equal(find('bdt-weatherEffect'), undefined);
    assert.equal(find('bdt-weatherFacing'), undefined);
    change('bdt-weatherChoice', 'heavyRain');
    assert.equal(saved().weather.mode, 'fixed');
    assert.equal(saved().weather.effect, 'heavyRain');
    assert.equal(find('bdt-weatherChoice').props.value, 'heavyRain');
    assert.equal(find('bdt-weatherFacing').props.value, 'south');
    assert.deepEqual(find('bdt-weatherFacing').children.map(option => option.props.value), ['east', 'west', 'south', 'north']);
    change('bdt-weatherFacing', 'east');
    assert.equal(saved().weather.facing, 'east');
    assert.match(slots.get('bing-daily-theme.wallpaper')().children[0], /\[data-bdt-precipitation\]\{position:absolute/);
    for (const mode of ['none', 'blur', 'frosted', 'blue', 'grayscale', 'dim']) {
      change('bdt-filterMode', mode);
      const screen = view();
      const preview = screen.find(node => node.props.className === 'bdt-preview');
      assert.equal(preview.children.length, 1, `${mode} has no overlay`);
      assert.equal(preview.children[0].type, 'img');
      assert.equal(preview.children[0].props.src, 'blob:preview');
      assert.equal(preview.children[0].props.style, undefined, `${mode} has no image filter or bleed`);
      assert.ok(!screen.some(node => node.props.className === 'bdt-preview-tint'));
      if (mode === 'blur') {
        const wallpaper = slots.get('bing-daily-theme.wallpaper')();
        assert.match(wallpaper.children[0], /filter:blur\(12px\)/, 'the rain keeps the selected wallpaper filter strength');
      }
      if (mode === 'blue') {
        const wallpaper = slots.get('bing-daily-theme.wallpaper')();
        assert.match(wallpaper.children[0], /rgb\(48 110 246 \/ 25%\)/, 'the actual wallpaper keeps its tint');
      }
    }
  });

  find('bdt-enabled').props.onChange({ target: { checked: false } });
  for (const side of ['leftSidebar', 'rightSidebar']) {
    assert.equal(find(`bdt-${side}`).children.find(node => node.type === 'fieldset').props.disabled, true);
  }
  const textSelect = find('bdt-textColorMode');
  assert.deepEqual(textSelect.children.map(option => option.props.value), ['theme', 'high-contrast']);
  change('bdt-textColorMode', 'high-contrast');
  assert.equal(saved().textColorMode, 'high-contrast');
  assert.equal(find('bdt-pureBlackDark').props.checked, false);
  assert.equal(find('bdt-systemTweaks').props.checked, false);
  find('bdt-pureBlackDark').props.onChange({ target: { checked: true } });
  find('bdt-systemTweaks').props.onChange({ target: { checked: true } });
  assert.equal(saved().pureBlackDark, true);
  assert.equal(saved().systemTweaks, true);
  find('bdt-enabled').props.onChange({ target: { checked: true } });
  assert.match(slots.get('bing-daily-theme.wallpaper')().children[0], /\.qp-chip\[style\*="#4D6BFE" i\]/);
  find('bdt-systemTweaks').props.onChange({ target: { checked: false } });
  assert.doesNotMatch(slots.get('bing-daily-theme.wallpaper')().children[0], /\.qp-chip\[style\*="#4D6BFE" i\]/);
  find('bdt-dynamic').props.onChange({ target: { checked: false } });
  assert.equal(find('bdt-textColorMode').props.disabled, true);
  assert.equal(find('bdt-pureBlackDark').props.disabled, true);
  assert.equal(find('bdt-systemTweaks').props.disabled, true);
});

test('palette sidebar colour preserves text and control contrast in both schemes', () => {
  const rgb = value => {
    assert.match(value, /^rgb\(\d+, \d+, \d+\)$/);
    return value.match(/\d+/g).map(Number);
  };
  const accents = [[29, 82, 214], [220, 100, 25], [67, 187, 128], [128, 255, 255], [128, 128, 128]];
  const surfaces = { light: [], dark: [] };
  for (const mode of PALETTE_MODES) for (const accent of accents) {
    const tokens = makeTokens(accent, 100, mode, 'high-contrast');
    for (const scheme of ['light', 'dark']) {
      const color = key => rgb(tokens[key][scheme]);
      const surface = color('--dsw-specific-sidebar-fill');
      for (const role of ['label-primary', 'label-secondary', 'label-tertiary', 'brand-primary']) {
        assert.ok(contrast(color(`--dsw-alias-${role}`), surface) >= 4.5, `${mode}/${scheme}/${role}`);
      }
      for (const role of ['--dsw-alias-border-l3', '--dsw-focus-ring-color']) {
        assert.ok(contrast(color(role), surface) >= 3, `${mode}/${scheme}/${role}`);
      }
      if (mode === 'monochrome') assert.equal(new Set(surface).size, 1);
      if (mode === 'content' && accent === accents[0]) surfaces[scheme].push(surface);
      if (mode === 'content' && accent === accents[1]) surfaces[scheme].push(surface);
    }
  }
  for (const [cool, warm] of Object.values(surfaces)) {
    assert.ok(cool[2] > cool[0] && warm[0] > warm[2], 'background follows the palette hue in both schemes');
  }
});
test('prebuilt artifact ships ten modes without removed help copy', async () => {
  const manifest = JSON.parse(await read('package.json'));
  const client = await read('dist/client.js');
  assert.match(client, /__ModuleLoader__\.load/);
  for (const key of Object.keys(makeTokens([180, 92, 30], 100, 'content'))) assert.ok(client.includes(key), `${key} missing from built UI`);
  for (const mode of PALETTE_MODES) assert.ok(client.includes(`palette.${mode}`), `${mode} missing from built UI`);
  assert.doesNotMatch(client, /palette\.original|paletteHint\.|bdt-(?:palette|strength)-help|highVisibility|visibilityHint|原始配色|每小时、跨日、页面唤醒/);
  assert.ok(!client.includes("from '@material/"));
  assert.ok(!client.includes("from '@huggingface/"));
  assert.deepEqual(Object.keys(manifest.dependencies || {}), ['@material/material-color-utilities', 'jpeg-js']);
  assert.deepEqual(Object.keys(manifest.optionalDependencies || {}), []);
  assert.deepEqual(Object.keys(manifest.peerDependencies || {}), []);
  assert.ok(manifest.files.includes('src/server'));
  assert.ok(manifest.files.includes('third-party'));
  assert.ok(manifest.files.includes('dist/sharp-renderer.js'));
  assert.ok(client.includes('/bing-daily-theme/assets/sharp-renderer.js'));
  assert.match(await read('dist/sharp-renderer.js'), /as createSharpParallaxRenderer/);
  for (const path of ['third-party/NOTICES.md','third-party/material-color-utilities-LICENSE.txt', 'third-party/noctalia-LICENSE.txt', 'third-party/spark-LICENSE.txt']) assert.ok((await stat(new URL(`../${path}`, import.meta.url))).isFile());
  assert.match(await read('third-party/material-color-utilities-LICENSE.txt'), /Apache License/);
  assert.match(await read('third-party/noctalia-LICENSE.txt'), /Copyright \(c\) 2026 noctalia-dev/);
});
test('public npm bundle uses one package identity and ships its runtime exports', async () => {
  const manifest = JSON.parse(await read('package.json'));
  const client = await read('dist/client.js');
  const { runInNewContext } = await import('node:vm');
  let registration;
  runInNewContext(client, { window: { __ModuleLoader__: { load(value) { registration = value; } } } }, { timeout: 1000 });
  assert.equal(manifest.name, '@nzlov/dsh-bing-wallpaper');
  assert.equal(manifest.author, 'nzlov');
  assert.notEqual(manifest.private, true);
  assert.deepEqual(manifest.publishConfig, { access: 'public', registry: 'https://registry.npmjs.org/' });
  assert.equal(manifest.scripts.prepack, 'npm run build');
  assert.equal(registration.id, manifest.name);
  assert.equal(typeof registration.factory, 'function');
  assert.ok((await read('cordis.patch.yml')).includes(`name: '${manifest.name}'`));
  assert.ok((await read('src/client/client-main.js')).includes(`SOURCE = '${manifest.name}'`));
  assert.equal(manifest.exports['./icon'], './icon.svg');
  assert.ok(manifest.files.includes('icon.svg'));
  for (const key of ['.', './client', './icon']) assert.ok((await stat(new URL(`../${manifest.exports[key]}`, import.meta.url))).isFile(), key);
  assert.doesNotMatch(client, /@local\/dsh-bing-daily-theme/);
});

test('photo overlay keeps metadata and one accessible top-right refresh action', async () => {
  const source = await read('src/client/client-main.js');
  const figure = source.slice(source.indexOf("h('figure', { className: 'bdt-photo'"), source.indexOf("h('span', { className: 'bdt-photo-status'"));
  for (const part of ["h('figcaption'", 'bdt-photo-heading', 'bdt-photo-date', 'bdt-photo-details', 'copyrightUrl', 'bdt-swatches', 'bdt-photo-refresh']) assert.ok(figure.includes(part), part);
  assert.match(figure, /s\.meta\.title \|\| t\('preview'\)/);
  assert.match(figure, /t\(`market\.\$\{s\.meta\.market\}`\)/);
  assert.match(figure, /target: '_blank', rel: 'noopener noreferrer'/);
  assert.match(figure, /disabled: s\.busy \|\| !prefs\.enabled, 'aria-label': t\('refresh'\), title: t\('refresh'\), 'aria-busy': s\.busy, onClick: \(\) => void refresh\(\)/);
  assert.match(figure, /h\('svg', [^\n]+'aria-hidden': true, focusable: false/);
  assert.equal((source.match(/onClick: \(\) => void refresh\(\)/g) || []).length, 1);
  assert.match(source, /\.bdt-photo-caption\{[^}]*position:absolute[^}]+overflow:auto[^}]+background:linear-gradient\(to bottom,transparent/);
  assert.match(source, /max-height:calc\(100% - 64px\)/);
  assert.match(source, /\.bdt-photo\{[^}]*position:relative/);
  assert.match(source, /\.bdt-page \.bdt-photo-refresh\{[^}]+top:12px;inset-inline-end:12px[^}]+width:44px;height:44px/);
  assert.match(source, /prefers-reduced-motion:reduce/);
  assert.match(source, /\.bdt-page \.bdt-photo-refresh:focus-visible/);
  assert.match(source, /className: 'bdt-photo-status', role: 'status', 'aria-live': 'polite'/);
  assert.ok(source.indexOf("className: 'bdt-photo-status'") < source.indexOf("row('enabled'"));
});

test('overlay and refresh ink remain readable over photo extremes in both schemes', () => {
  const rgb = value => value.match(/\d+/g).map(Number);
  for (const mode of PALETTE_MODES) for (const accent of [[215, 98, 20], [29, 82, 214], [128, 128, 128]]) {
    const tokens = makeTokens(accent, 28, mode);
    for (const scheme of ['light', 'dark']) {
      const bg = rgb(tokens['--dsw-alias-tooltip-bg'][scheme]);
      const ink = rgb(tokens['--dsw-alias-tooltip-label'][scheme]);
      for (const opacity of [.82, .86, .9]) for (const photo of [0, 255]) {
        const composite = bg.map(channel => opacity * channel + (1 - opacity) * photo);
        assert.ok(contrast(ink, composite) >= 4.5, `${mode}/${scheme}/${opacity}/${photo}`);
      }
    }
  }
});

test('market selection, feedback and refresh labels use matching bilingual dictionaries', async () => {
  const source = await read('src/client/client-main.js');
  const dictionaries = await Promise.all(['en', 'zh'].map(async lang => JSON.parse(await read(`locale/${lang}.json`))));
  assert.doesNotMatch(source, /[\u3400-\u9fff]/, 'no hardcoded Chinese interface copy');
  for (const [, key] of source.matchAll(/\bt\('([^']+)'\)/g)) {
    for (const dictionary of dictionaries) assert.equal(typeof dictionary[key], 'string', key);
  }
  assert.match(source, /row\('market', h\('select', \{ id: 'bdt-market', value: prefs\.market, onChange: e => update\(\{ market: e\.target\.value \}\)/);
  assert.match(source, /row\('resolution', h\('select', \{ id: 'bdt-resolution', value: prefs\.resolution/);
  assert.match(source, /\['zh-CN', 'en-US'\]\.map\(market => h\('option'[^\n]+t\(`market\.\$\{market\}`\)/);
  for (const dictionary of dictionaries) {
    assert.ok(dictionary['market.zh-CN']); assert.ok(dictionary['market.en-US']); assert.ok(dictionary.sourceFailed);
    for (const res of ['1080p', '2k', '4k']) assert.ok(dictionary[`resolution.${res}`], res);
  }
  assert.notEqual(dictionaries[0].sourceFailed, dictionaries[1].sourceFailed);
});

test('source changes cancel obsolete work and cannot reuse or mislabel another market cache', async () => {
  const source = await read('src/client/client-main.js');
  assert.match(source, /sourceChanged = next\.market !== settings\.market/);
  assert.match(source, /if \(sourceChanged\) \{[^}]+generation\+\+; controller\?\.abort\(\); lastCheck = 0; lastDay = '';/);
  assert.match(source, /else if \(!wasEnabled \|\| sourceChanged\) void refresh\(\)/);
  assert.match(source, /const current = \+\+generation, market = settings\.market/);
  assert.match(source, /api\/daily\?market=\$\{market\}/);
  assert.match(source, /meta\.market !== market/);
  assert.match(source, /if \(!alive \|\| current !== generation\)/);
  assert.match(source, /paletteSource\?\.market === settings\.market/);
  assert.match(source, /paletteSource && !matches/);
  assert.match(source, /s\.meta\.market === prefs\.market \? 'ready' : 'sourceFailed'/);
  assert.match(source, /core\.localDate\(\) !== lastDay \|\| state\.meta\?\.market !== settings\.market/);
});
