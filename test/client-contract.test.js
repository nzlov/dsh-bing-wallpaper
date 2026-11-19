import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { PALETTE_MODES, makeTokens, contrast } from '../palette.js';
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
  const source = await read('client-main.js');
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
test('wallpaper consumes the shared readability scrim and dynamic-off releases every colour override', async () => {
  const source = await read('client-main.js');
  assert.match(source, /const shade = core\.wallpaperShade\(s\.scheme\)/);
  assert.match(source, /wallpaperFilters\.css\(\{ selector: 'html', image, overlays: \[shade\]/);
  assert.match(source, /if \(!settings\.dynamic\) for \(const key of Object\.keys\(tokens\)\) if \(key !== '--dsw-alias-bg-base'\) delete tokens\[key\]/);
  assert.match(source, /if \(!settings\.enabled \|\| !state\.url\) \{ tokenDisposer\?\.\(\)/);
});
test('wallpaper applies browser-local sidebar backgrounds only while enabled with a decoded photo', async () => {
  const source = await read('client-main.js');
  const wallpaper = source.slice(source.indexOf('function Wallpaper()'), source.indexOf('function Settings()'));
  assert.match(wallpaper, /if \(!s\.settings\.enabled \|\| !s\.url\) return null;[\s\S]+sidebarBackgroundCSS\(\{ settings: s\.settings, image, overlays: \[shade\], matte, base \}\)/);
  assert.match(wallpaper, /sidebarColors\(colors, s\.scheme\)/);
  assert.match(wallpaper, /alignWallpaper\(\{\s+document, window, surfaces: SIDEBAR_SURFACES/);
  assert.match(wallpaper, /mountBackground: surface => mountSidebarBackground\(document, surface\)/);
  const bundle = await read('client.js');
  assert.ok(bundle.includes('leftSidebar') && bundle.includes('rightSidebar') && bundle.includes('data-dockkit-strip'), 'prebuilt client includes sidebar controls and chrome styling');
});

test('palette sidebar colour preserves text and control contrast in both schemes', () => {
  const rgb = value => {
    assert.match(value, /^rgb\(\d+, \d+, \d+\)$/);
    return value.match(/\d+/g).map(Number);
  };
  const accents = [[29, 82, 214], [220, 100, 25], [67, 187, 128], [128, 255, 255], [128, 128, 128]];
  const surfaces = { light: [], dark: [] };
  for (const mode of PALETTE_MODES) for (const accent of accents) {
    const tokens = makeTokens(accent, 100, mode);
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
  const client = await read('client.js');
  assert.match(client, /__ModuleLoader__\.load/);
  for (const key of Object.keys(makeTokens([180, 92, 30], 100, 'content'))) assert.ok(client.includes(key), `${key} missing from built UI`);
  for (const mode of PALETTE_MODES) assert.ok(client.includes(`palette.${mode}`), `${mode} missing from built UI`);
  assert.doesNotMatch(client, /palette\.original|paletteHint\.|bdt-(?:palette|strength)-help|highVisibility|visibilityHint|原始配色|每小时、跨日、页面唤醒/);
  assert.ok(!client.includes("from '@material/"));
  assert.ok(!manifest.dependencies);
  assert.ok(manifest.files.includes('third-party'));
  for (const path of ['THIRD_PARTY_NOTICES.md','third-party/material-color-utilities-LICENSE.txt']) assert.ok((await stat(new URL(`../${path}`, import.meta.url))).isFile());
  assert.match(await read('third-party/material-color-utilities-LICENSE.txt'), /Apache License/);
});
test('public npm bundle uses one package identity and ships its runtime exports', async () => {
  const manifest = JSON.parse(await read('package.json'));
  const client = await read('client.js');
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
  assert.ok((await read('client-main.js')).includes(`SOURCE = '${manifest.name}'`));
  for (const key of ['.', './client', './icon']) assert.ok((await stat(new URL(`../${manifest.exports[key]}`, import.meta.url))).isFile(), key);
  assert.doesNotMatch(client, /@local\/dsh-bing-daily-theme/);
});

test('photo overlay keeps metadata and one accessible top-right refresh action', async () => {
  const source = await read('client-main.js');
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
  const source = await read('client-main.js');
  const dictionaries = await Promise.all(['en', 'zh'].map(async lang => JSON.parse(await read(`locale/${lang}.json`))));
  assert.doesNotMatch(source, /[\u3400-\u9fff]/, 'no hardcoded Chinese interface copy');
  for (const [, key] of source.matchAll(/\bt\('([^']+)'\)/g)) {
    for (const dictionary of dictionaries) assert.equal(typeof dictionary[key], 'string', key);
  }
  assert.match(source, /row\('market', h\('select', \{ id: 'bdt-market', value: prefs\.market, onChange: e => update\(\{ market: e\.target\.value \}\)/);
  assert.match(source, /\['zh-CN', 'en-US'\]\.map\(market => h\('option'[^\n]+t\(`market\.\$\{market\}`\)/);
  for (const dictionary of dictionaries) {
    assert.ok(dictionary['market.zh-CN']); assert.ok(dictionary['market.en-US']); assert.ok(dictionary.sourceFailed);
  }
  assert.notEqual(dictionaries[0].sourceFailed, dictionaries[1].sourceFailed);
});

test('source changes cancel obsolete work and cannot reuse or mislabel another market cache', async () => {
  const source = await read('client-main.js');
  assert.match(source, /sourceChanged = next\.market !== settings\.market/);
  assert.match(source, /if \(sourceChanged\) \{[^}]+generation\+\+; controller\?\.abort\(\); lastCheck = 0; lastDay = '';/);
  assert.match(source, /else if \(!wasEnabled \|\| sourceChanged\) void refresh\(\)/);
  assert.match(source, /const current = \+\+generation, market = settings\.market/);
  assert.match(source, /api\/daily\?market=\$\{market\}/);
  assert.match(source, /meta\.market !== market/);
  assert.match(source, /if \(!alive \|\| current !== generation\)/);
  assert.match(source, /settings\.dynamic && state\.meta\?\.market === settings\.market/);
  assert.match(source, /state\.meta && state\.meta\.market !== settings\.market/);
  assert.match(source, /s\.meta\.market === prefs\.market \? 'ready' : 'sourceFailed'/);
  assert.match(source, /core\.localDate\(\) !== lastDay \|\| state\.meta\?\.market !== settings\.market/);
});
