import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { transform } from 'esbuild';
import { createWallpaperFilters, wallpaperFilters as filters } from '../wallpaper-filter.js';
import { DEFAULTS, normalizeSettings, makeTokens } from '../palette.js';
import { bootThemeCSS, bootThemeInjection, makeBootCache } from '../boot-theme.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const photo = 'url("blob:https://example.test/test-image")';
const cachedUrl = '/bing-daily-theme/api/image?id=OHR.Test_ZH-CN123_1920x1080.jpg';
const render = (mode, amount) => filters.css({
  selector: 'html', image: photo, overlays: [], settings: { filterMode: mode, filterAmounts: { [mode]: amount } }, fixed: true,
});

test('legacy preferences default to no filter; mode amounts are independently retained and bounded', () => {
  const old = { enabled: true, mode: 'dark', strength: 60, dynamic: false };
  const prefs = normalizeSettings(old);
  assert.equal(prefs.filterMode, 'none');
  assert.equal(prefs.mode, 'dark');
  assert.equal(prefs.strength, 60);
  assert.equal(prefs.dynamic, false);
  assert.deepEqual(prefs.filterAmounts, { blur: 12, frosted: 12, blue: 25, grayscale: 100, dim: 24 });
  const edited = normalizeSettings({ ...prefs, filterMode: 'blur', filterAmounts: { blur: 9.7, frosted: 24, blue: 100, grayscale: -5, dim: '42', other: 40 } });
  assert.deepEqual(edited.filterAmounts, { blur: 10, frosted: 24, blue: 60, grayscale: 0, dim: 24 });
  const changed = normalizeSettings({ ...edited, filterMode: 'frosted' });
  assert.deepEqual(filters.effect(changed), { filter: 'blur(24px)', bleed: 72, tint: 'rgb(255 255 255 / 18%)' });
  const restored = normalizeSettings(JSON.parse(JSON.stringify({ ...changed, filterMode: 'blur' })));
  assert.deepEqual(restored, edited);
  assert.deepEqual(filters.effect(restored), { filter: 'blur(10px)', bleed: 30 });
  assert.deepEqual(filters.effect({ filterMode: 'blur', filterAmounts: { blur: 17 } }), { filter: 'blur(17px)', bleed: 51 }, 'the existing pure blur retains its strength and appearance');
  for (const invalid of ['__proto__', 'constructor', 'blur);display:none', {}, null]) {
    assert.equal(filters.normalize({ filterMode: invalid }).filterMode, 'none');
  }
  assert.equal(filters.normalize({ filterMode: 'blur', filterAmounts: { blur: Infinity } }).filterAmounts.blur, 12);
});

test('effects are bounded photo-only CSS; chosen tints paint above the image', async () => {
  for (const css of [render('none'), ...filters.modes.slice(1).map(mode => render(mode, 0)), render('bad);display:none', 15)]) {
    assert.match(css, /html::before\{[^}]+filter:none/);
    assert.ok(css.includes(photo));
    assert.match(css, /html::after\{[^}]*background-image:none/);
  }
  assert.equal(filters.css({ selector: 'html', image: '', overlays: [], settings: {} }), '');
  for (const [mode, amount, pattern] of [
    ['blur', 999, /position:fixed;inset:-96px;[^}]*filter:blur\(32px\)/],
    ['frosted', 999, /filter:blur\(32px\)[\s\S]+html::after\{[^}]*rgb\(255 255 255 \/ 24%\)/],
    ['blue', 40, /html::after\{[^}]*linear-gradient\(rgb\(48 110 246 \/ 40%\),rgb\(48 110 246 \/ 40%\)\)/],
    ['grayscale', 83, /filter:grayscale\(83%\)/],
    ['dim', 42, /filter:brightness\(58%\)/],
  ]) {
    const css = render(mode, amount);
    assert.match(css, pattern, mode);
    const [before, after] = css.split('html::after');
    assert.match(before, /^html::before\{content:"";position:fixed;[^}]*z-index:-3;pointer-events:none/);
    assert.ok(before.includes(photo));
    assert.match(after, /z-index:-2;pointer-events:none;background-image:(?:linear-gradient|none)/);
    assert.ok(!after.includes('filter:'));
    const compiled = await transform(css, { loader: 'css' });
    assert.deepEqual(compiled.warnings, []);
  }
  assert.doesNotMatch(render('blur', '32);display:none'), /display:none/);
});

test('startup keeps the same stored filter for both Follow themes and ignores unsupported cache URLs', () => {
  const settings = normalizeSettings({ ...DEFAULTS, mode: 'follow', filterMode: 'blur', filterAmounts: { blur: 17 } });
  const cache = makeBootCache(settings, makeTokens([29, 80, 214]), cachedUrl);
  const day = new Date(2026, 10, 20, 12);
  const output = bootThemeCSS(settings, cache, day, false);
  assert.equal((output.match(/filter:blur\(17px\)/g) || []).length, 2);
  assert.match(output, /body:not\(\[data-ds-dark-theme\]\) \[data-dsh-boot\]::before\{[^}]*position:fixed/);
  assert.match(output, /body\[data-ds-dark-theme\] \[data-dsh-boot\]::after\{[^}]*background-image:/);
  const standalone = new Script(`(prefs, cache, now) => (${bootThemeCSS.toString()})(prefs, cache, now, false, undefined, (${createWallpaperFilters.toString()})().css)`);
  assert.equal(standalone.runInNewContext()(settings, cache, day), output);
  assert.ok(bootThemeInjection().text.includes(createWallpaperFilters.toString()));
  assert.doesNotMatch(bootThemeCSS(settings, { ...cache, imageUrl: 'https://example.test/invalid' }, day, false), /filter:|::before|https:\/\//);
  assert.match(bootThemeCSS({ ...settings, filterMode: 'none' }, cache, day, false), /\[data-dsh-boot\]::before\{[^}]+filter:none/);
});

test('both locales name each filter and adjustment; settings preview keeps the original image', async () => {
  const source = await read('client-main.js');
  for (const lang of ['en', 'zh']) {
    const dictionary = JSON.parse(await read(`locale/${lang}.json`));
    for (const mode of filters.modes) assert.ok(dictionary[`filter.${mode}`]);
    for (const mode of filters.modes.slice(1)) assert.ok(dictionary[`filterAmount.${mode}`]);
    for (const key of ['filterMode', 'filterPixels']) assert.ok(dictionary[key]);
    assert.ok(!Object.hasOwn(dictionary, 'filterScope'));
    assert.notEqual(dictionary['filter.blur'], dictionary['filter.frosted']);
  }
  assert.match(source, /row\('filterMode', h\('select',.+className: 'bdt-wallpaper-select'.+disabled: !prefs\.enabled/);
  assert.match(source, /row\('market', h\('select',.+className: 'bdt-wallpaper-select'/);
  assert.match(source, /\.bdt-row\{display:flex;justify-content:space-between;align-items:center/);
  assert.match(source, /\.bdt-page \.bdt-wallpaper-select\{box-sizing:border-box;width:12rem;min-height:44px\}/);
  assert.match(source, /@media\(max-width:560px\)\{.*\.bdt-page \.bdt-wallpaper-select\{width:100%\}/);
  assert.doesNotMatch(source, /filterScope|bdt-filter-note/);
  assert.match(source, /filterOption && row\(filterLabel, h\('input',[^\n]+type: 'range', min: 0, max: filterOption\.max/);
  assert.match(source, /aria-valuetext[^\n]+filterPixels/);
  assert.match(source, /if \(backgroundOnly\) \{[^}]+publish\(\{ settings \}\);\s+if \(weatherChanged\) void weather.sync\(settings\);\s+return;/);
  assert.match(source, /className: 'bdt-preview-image', src: s\.url/);
  assert.doesNotMatch(source, /bdt-preview-tint|filter: look\?\.filter/);
  assert.match(source, /extractImagePalettes\(context\.getImageData/);
  const manifest = JSON.parse(await read('package.json'));
  assert.ok(manifest.files.includes('wallpaper-filter.js'));
  const client = (await read('client.js')).replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  for (const token of ['bdt-preview-image', 'bdt-filter-range', 'Background filter', '背景滤镜', '模糊（Blur）', 'Frosted glass']) assert.ok(client.includes(token), token);
  assert.ok(!client.includes('bdt-preview-tint'));
});
