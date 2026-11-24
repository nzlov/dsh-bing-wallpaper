import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { BOOT_CACHE_KEY, BOOT_STYLE_ID, PREFERENCES_KEY, makeBootCache, bootThemeCSS, bootThemeInjection } from '../boot-theme.js';
import { MARKETPLACE_THEME_CSS } from '../compatibility.js';
import { wallpaperFilters } from '../wallpaper-filter.js';
import { DEFAULTS, PALETTE_MODES, makeTokens, contrast, backgroundAlpha } from '../palette.js';

const BOOT_SCRIPT = bootThemeInjection().text;
const imageUrl = '/bing-daily-theme/api/image?id=OHR.Test_ZH-CN123_1920x1080.jpg';
const day = new Date(2026, 10, 18, 12), night = new Date(2026, 10, 18, 23);
const settings = { ...DEFAULTS };
const cache = prefs => makeBootCache(prefs, makeTokens([190, 105, 52], prefs.strength, prefs.paletteMode), imageUrl);
const css = (prefs = settings, stored = cache(prefs), date = day, system = false, follow) => bootThemeCSS(prefs, stored, date, system, follow);
const parseRGB = value => value.match(/\d+/g).map(Number);

test('early Host row is self-contained body script without module/runtime/network dependencies', () => {
  const row = bootThemeInjection();
  assert.equal(row.kind, 'script'); assert.equal(row.placement, 'body');
  assert.equal(row.text, BOOT_SCRIPT);
  assert.ok(new Script(row.text));
  assert.doesNotMatch(row.text, /<\/script|\bfetch\(|\bimport\b|__ModuleLoader__|setInterval|MutationObserver/);
  for (const key of [PREFERENCES_KEY, BOOT_CACHE_KEY, BOOT_STYLE_ID]) assert.ok(row.text.includes(key));
  assert.doesNotMatch(row.text, /document\.body\.|documentElement\.style|setTheme/);
});

test('storage denial and malformed storage cannot abort shell startup', () => {
  for (const getItem of [() => { throw new Error('storage denied'); }, () => '{broken']) {
    assert.doesNotThrow(() => runInNewContext(BOOT_SCRIPT, { localStorage: { getItem } }));
  }
});

test('no-cache, disabled and dynamic-off never revive an old theme', () => {
  assert.equal(css(settings, null), '');
  assert.equal(css({ ...settings, enabled: false }, cache(settings)), '');
  assert.equal(css({ ...settings, dynamic: false }, cache(settings)), '');
  assert.equal(makeBootCache({ ...settings, enabled: false }, {}, imageUrl), null);
  assert.equal(makeBootCache({ ...settings, dynamic: false }, {}, imageUrl), null);
  assert.equal(css(settings, { ...cache(settings), version: 0 }), '');
  assert.equal(css(settings, { ...cache(settings), version: 1 }), '', 'old extraction results cannot flash before the new palette loads');
  assert.equal(css(settings, { ...cache(settings), version: 2 }), '', 'old scrim-era colors cannot flash before the new palette loads');
  assert.equal(css({ ...settings, paletteMode: 'vibrant' }, cache(settings)), '');
  assert.equal(css({ ...settings, strength: 100 }, cache(settings)), '');
  // A first successful refresh can cache the default palette before any user
  // preferences have been saved; its next boot still uses current defaults.
  assert.equal(css(null, cache(settings)), css(settings));
});

test('fresh local schedule handles both boundaries, overnight ranges and invalid hours', () => {
  const stored = cache(settings);
  const at = (hours, minutes = 0) => new Date(2026, 10, 18, hours, minutes);
  for (const [date, scheme] of [[at(6, 59), 'dark'], [at(7), 'light'], [at(18, 59), 'light'], [at(19), 'dark']]) {
    assert.ok(css(settings, stored, date).includes(`--dsw-alias-label-primary:${stored.colors[scheme].primary}`));
  }
  const reversed = { ...settings, day: '19:00', night: '07:00' };
  assert.match(css(reversed, cache(reversed), at(23)), /color-scheme:light/);
  assert.match(css(reversed, cache(reversed), at(12)), /color-scheme:dark/);
  for (const bad of [{ day: '25:00' }, { night: '07:00' }, { mode: 'unknown' }]) assert.equal(css({ ...settings, ...bad }), '');
});

test('system/fixed modes and Follow use both live native body selectors, not stale cached scheme', () => {
  assert.match(css({ ...settings, mode: 'system' }, undefined, day, true), /color-scheme:dark/);
  assert.match(css({ ...settings, mode: 'system' }, undefined, night, false), /color-scheme:light/);
  assert.match(css({ ...settings, mode: 'dark' }), /color-scheme:dark/);
  assert.match(css({ ...settings, mode: 'light' }, undefined, night), /color-scheme:light/);
  const follow = css({ ...settings, mode: 'follow' });
  assert.match(follow, /body:not\(\[data-ds-dark-theme\]\) \[data-dsh-boot\]/);
  assert.match(follow, /body\[data-ds-dark-theme\] \[data-dsh-boot\]/);
  assert.match(follow, /color-scheme:light/); assert.match(follow, /color-scheme:dark/);
});

for (const mode of PALETTE_MODES) test(`cached ${mode} palette contains six opaque readable roles for both schemes`, () => {
  const prefs = { ...settings, paletteMode: mode }, stored = cache(prefs);
  assert.equal(stored.imageUrl, imageUrl);
  for (const scheme of ['light', 'dark']) {
    const colors = stored.colors[scheme];
    assert.equal(Object.keys(colors).length, 6);
    for (const role of ['primary', 'secondary', 'tertiary', 'brand']) {
      assert.ok(contrast(parseRGB(colors[role]), parseRGB(colors.background)) >= 4.5, `${scheme} ${role}`);
    }
    assert.ok(contrast(parseRGB(colors.border), parseRGB(colors.background)) >= 3);
    assert.match(css({ ...prefs, mode: scheme }, stored), /background-color:rgb\(/);
  }
});

test('wallpaper startup uses the same linear visibility as the live background', () => {
  for (const strength of [10, 28, 99, 100]) for (const mode of ['light', 'dark']) {
    const prefs = { ...settings, mode, strength }, stored = cache(prefs), output = css(prefs, stored);
    assert.ok(output.includes(`, ${backgroundAlpha(strength)})`));
    assert.doesNotMatch(output, /rgba\(255, 255, 255, 0\.56\)|rgba\(0, 0, 0, 0\.62\)/);
    assert.ok(output.includes(`url("${imageUrl}")`));
    assert.match(output, /background-color:rgb\(/); // A failed image remains legible.
    assert.doesNotMatch(output, /--dsh-boot-arc|animation|mask|(?:^|[;{])(?:display|opacity):/);
    const container = output.slice(0, output.indexOf('}') + 1);
    assert.doesNotMatch(container, /position:/, 'startup keeps the host container layout');
  }
  for (const strength of [-1, 101, NaN, Infinity, '28']) assert.equal(css({ ...settings, strength }), '');
});

test('every startup filter mode paints only a solid fallback beneath its image and visibility tint', () => {
  for (const filterMode of wallpaperFilters.modes) {
    const prefs = { ...settings, filterMode }, output = css(prefs);
    const container = output.slice(0, output.indexOf('}') + 1);
    assert.match(container, /background-color:rgb\([^;]+\)!important;background-image:none!important;isolation:isolate/);
    assert.doesNotMatch(container, /url\(|position:/);
    const picture = output.match(/\[data-dsh-boot\]::before\{([^}]+)\}/)?.[1];
    const veil = output.match(/\[data-dsh-boot\]::after\{([^}]+)\}/)?.[1];
    assert.ok(picture.includes(`url("${imageUrl}")`));
    assert.ok(picture.includes('position:fixed'));
    assert.ok(picture.includes(`filter:${wallpaperFilters.effect(prefs)?.filter || 'none'}`));
    assert.ok(veil.includes('background-image:linear-gradient('));
    assert.doesNotMatch(veil, /url\(|filter:/);
  }
});

test('untrusted colors cannot inject CSS, URLs or script text', () => {
  for (const value of ['red', 'rgb(256, 0, 0)', 'rgb(-1, 0, 0)', 'rgba(1, 2, 3, 0)', 'rgb(1, 2, 3);display:none', '</style><script>bad()</script>']) {
    const stored = cache(settings); stored.colors.light.primary = value;
    assert.equal(css(settings, stored), '', value);
  }
});

test('cached image URLs are optional, same-origin and restricted to accepted JPEG ids', () => {
  for (const url of ['https://evil.test/x', '//evil.test/x', 'blob:anything', 'data:image/png,abc', imageUrl + '&x=1', imageUrl + '#x', '/bing-daily-theme/api/image?id=OHR.%22_1920x1080.jpg', '";display:none', null]) {
    const output = css(settings, { ...cache(settings), imageUrl: url });
    assert.match(output, /background-image:none!important/);
    assert.ok(!output.includes('url('), String(url));
  }
});

test('market adapter pairs all four local roles without changing warning, media or rarity semantics', () => {
  assert.ok(MARKETPLACE_THEME_CSS.startsWith('body .nUhMVa_confirmPanel{'));
  assert.equal((MARKETPLACE_THEME_CSS.match(/!important/g) || []).length, 4);
  for (const [local, token] of [['bg', 'bg-layer-2'], ['border', 'border-l2'], ['ink', 'label-primary'], ['on-ink', 'bg-layer-1']]) {
    assert.ok(MARKETPLACE_THEME_CSS.includes(`--fold-${local}:var(--dsw-alias-${token})!important`));
  }
  assert.doesNotMatch(MARKETPLACE_THEME_CSS, /img|filter:|capChip|warn|success|font-weight|background:/);
  for (const mode of PALETTE_MODES) for (const strength of [10, 28, 100]) {
    const tokens = makeTokens([190, 105, 52], strength, mode);
    for (const scheme of ['light', 'dark']) for (const surface of ['--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2']) {
      assert.ok(contrast(parseRGB(tokens['--dsw-alias-label-primary'][scheme]), parseRGB(tokens[surface][scheme])) >= 4.5);
    }
  }
});

test('main shell mount, not plugin apply or network success, removes the startup bridge', async () => {
  const source = await readFile(new URL('../client-main.js', import.meta.url), 'utf8');
  const start = source.indexOf('function Wallpaper()'), end = source.indexOf('function Settings()', start);
  const component = source.slice(start, end);
  assert.match(component, /React\.useEffect\(\(\) => \{ document\.getElementById\(BOOT_STYLE_ID\)\?\.remove\(\); \}, \[\]\)/);
  assert.ok(component.indexOf('React.useEffect') < component.indexOf('return null'));
  assert.match(component, /s\.settings\.dynamic \? MARKETPLACE_THEME_CSS : ''/);
  assert.equal((source.match(/document\.getElementById\(BOOT_STYLE_ID\)\?\.remove\(\)/g) || []).length, 2); // mount + plugin cleanup
  assert.match(source, /localStorage\.removeItem\(BOOT_CACHE_KEY\)/);
  assert.match(source, /localStorage\.setItem\(BOOT_CACHE_KEY, JSON\.stringify\(makeBootCache/);
});


test('startup cache is tied to the selected source and permits only its canonical image URL', () => {
  const global = { ...settings, market: 'en-US' };
  const globalUrl = imageUrl.replace('?id=', '?market=en-US&id=');
  const stored = makeBootCache(global, makeTokens([190, 105, 52], global.strength, global.paletteMode), globalUrl);
  assert.equal(stored.market, 'en-US');
  assert.ok(css(global, stored).includes(`url("${globalUrl}")`));
  assert.equal(css(settings, stored), '');
  assert.equal(css(global, cache(settings)), '');
  assert.match(css(global, { ...stored, imageUrl }), /background-image:none!important/);
  assert.match(css(settings, { ...cache(settings), imageUrl: globalUrl }), /background-image:none!important/);
  for (const value of [globalUrl + '&market=en-US', globalUrl.replace('en-US', 'fr-FR'), globalUrl + '&x=1']) {
    assert.match(css(global, { ...stored, imageUrl: value }), /background-image:none!important/);
  }
  const legacy = { ...settings }, legacyCache = cache(settings);
  delete legacy.market; delete legacyCache.market;
  assert.equal(css(legacy, legacyCache), css(settings));
  assert.equal(css({ ...settings, market: 'bogus' }, { ...cache(settings), market: 'bogus' }), '');
});
