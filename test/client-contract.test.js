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
  assert.doesNotMatch(source, /bdt-(?:palette|strength)-help|aria-describedby|paletteHint|highVisibility|visibilityHint|t\('intro'\)|t\('note'\)|'original'/);
  assert.doesNotMatch(source, /require\(['"]@deepseek-ai\//);
});
test('wallpaper consumes the shared readability scrim and dynamic-off releases every colour override', async () => {
  const source = await read('client-main.js');
  assert.match(source, /const shade = core\.wallpaperShade\(s\.scheme\)/);
  assert.match(source, /linear-gradient\(\$\{shade\},\$\{shade\}\)/);
  assert.match(source, /if \(!settings\.dynamic\) for \(const key of Object\.keys\(tokens\)\) if \(key !== '--dsw-alias-bg-base'\) delete tokens\[key\]/);
  assert.match(source, /if \(!settings\.enabled \|\| !state\.url\) \{ tokenDisposer\?\.\(\)/);
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
