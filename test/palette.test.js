import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Hct, argbFromRgb, redFromArgb, greenFromArgb, blueFromArgb,
  SchemeContent, SchemeTonalSpot, SchemeFruitSalad, SchemeRainbow, SchemeMonochrome,
  SchemeVibrant, SchemeFidelity, SchemeNeutral, SchemeExpressive,
} from '@material/material-color-utilities';
import {
  PALETTE_MODES, DEFAULTS, normalizeSettings, scheduledScheme, extractAccent,
  makeTokens, contrast, rgbToHsl, hslToRgb, localDate, WALLPAPER_VEIL, wallpaperShade,
} from '../palette.js';

const MODES = ['content', 'tonal-spot', 'fruit-salad', 'rainbow', 'monochrome', 'vibrant', 'faithful', 'soft', 'dysfunctional', 'muted'];
const SCHEMES = ['light', 'dark'];
const SURFACES = ['--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay', '--dsw-specific-sidebar-fill'];
const FOREGROUNDS = [
  '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
  '--dsw-alias-label-caption', '--dsw-alias-label-dimmed', '--dsw-alias-label-primary-bluish', '--dsw-alias-label-primary-dimmed',
  '--dsw-alias-menu-icon', '--dsw-alias-brand-primary', '--dsw-alias-brand-text',
  '--dsw-alias-brand-primary-new-colorprimary-new-color', '--dsw-alias-link',
];
// Names checked against installed ui-theme@0.2.2-rc.4 design-platform.css and focus.css.
// Neutral reading surfaces are distinct from brand fills, which need on-accent text.
const CONTROL_SURFACES = [
  '--dsw-alias-bg-layer-3', '--dsw-alias-bg-module-platform', '--dsw-alias-bg-multi-select',
  '--dsw-alias-card-fill', '--dsw-alias-card-fill-hover', '--dsw-alias-card-tile-fill',
  '--dsw-alias-onboarding-card-fill', '--dsw-alias-onboarding-secondary-fill',
  '--dsw-alias-button-elevated-fill', '--dsw-alias-button-floating-fill', '--dsw-alias-button-floating-hover',
  '--dsw-alias-button-ghost-active-fill', '--dsw-alias-button-ghost-active-hover', '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-interactive-bg-active', '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-interactive-bg-hover-accent', '--dsw-menu-surface-fill', '--dsw-alias-menu-group-header-fill',
  '--dsw-specific-menu', '--dsw-specific-input-major', '--dsw-specific-login-input', '--dsw-specific-selector',
  '--dsw-specific-tip', '--dsw-specific-sidebar-nav-item-active', '--dsw-specific-sidebar-nav-item-active-accent',
  '--dsw-specific-bubble', '--dsw-specific-bubble-highlight', '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-code-block-banner', '--dsw-alias-markdown-inline-code',
  '--dsw-alias-markdown-code-segment-selected', '--dsw-alias-markdown-code-segment-unselected',
  '--dsw-alias-markdown-placeholder', '--dsw-alias-markdown-tag', '--dsw-alias-markdown-citation',
];
const BRAND_FILLS = ['--dsw-alias-button-primary-fill', '--dsw-alias-button-primary-hover', '--dsw-alias-button-contrast-fill'];
const INFO_FILLS = ['--dsw-alias-button-info-fill', '--dsw-alias-button-info-hover'];
const ON_ACCENT = ['--dsw-alias-label-primary-foreground', '--dsw-alias-label-primary-inverted'];
const BORDERS = [
  '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4', '--dsw-alias-border-selected',
  '--dsw-alias-button-ghost-active-border', '--dsw-alias-border-l2-darkmode-thin', '--dsw-alias-onboarding-checkbox-border',
  '--dsw-alias-scrollbar-bg-l1', '--dsw-alias-scrollbar-bg-l2', '--dsw-alias-scrollbar-hover-l1', '--dsw-alias-scrollbar-hover-l2',
];
const INVERSE_PAIRS = [
  ['--dsw-alias-tooltip-label', '--dsw-alias-tooltip-bg'],
  ['--dsw-alias-tooltip-label', '--dsw-alias-tooltip-key-bg'],
  ['--dsw-alias-toast-label', '--dsw-alias-toast-bg'],
  ['--dsw-alias-toast-action', '--dsw-alias-toast-bg'],
  ['--dsw-alias-hovercard-label-primary', '--dsw-alias-hovercard-bg'],
  ['--dsw-alias-hovercard-label-secondary', '--dsw-alias-hovercard-bg'],
  ['--dsw-alias-hovercard-label-tertiary', '--dsw-alias-hovercard-bg'],
];
const TOKEN_KEYS = ['--dsw-alias-bg-base', ...SURFACES, ...CONTROL_SURFACES, ...FOREGROUNDS, ...BRAND_FILLS, ...INFO_FILLS, ...ON_ACCENT, '--dsw-alias-border-l1', ...BORDERS, '--dsw-focus-ring-color', '--dsw-alias-switch-thumb', ...new Set(INVERSE_PAIRS.flat())];
const PHOTOS = [[0, 0, 0], [255, 255, 255], [64, 64, 64], [128, 128, 128], [192, 192, 192], [255, 0, 0], [0, 255, 0], [0, 0, 255], [23, 99, 211]];
const EXPECTED_VEIL = { light: { rgb: [255, 255, 255], alpha: 0.56 }, dark: { rgb: [0, 0, 0], alpha: 0.62 } };
const STRENGTHS = [10, 28, 50, 51, 75, 99, 100];
const ACCENTS = [[255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [0, 213, 255], [255, 128, 0], [22, 144, 187], [150, 150, 150], [0, 0, 0], [255, 255, 255]];
const at = (hour, minute = 0) => new Date(2026, 10, 18, hour, minute);
const fromArgb = argb => [redFromArgb(argb), greenFromArgb(argb), blueFromArgb(argb)];

function parseCss(css, context = css) {
  assert.equal(typeof css, 'string', context);
  const match = /^(rgb|rgba)\(([^)]+)\)$/.exec(css);
  assert.ok(match, `valid rgb/rgba CSS: ${context}: ${css}`);
  const fields = match[2].split(',').map(value => value.trim());
  assert.equal(fields.length, match[1] === 'rgba' ? 4 : 3, context);
  for (const field of fields) assert.match(field, /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i, context);
  const values = fields.map(Number);
  for (const channel of values.slice(0, 3)) {
    assert.ok(Number.isFinite(channel) && channel >= 0 && channel <= 255, `finite RGB channel: ${context}`);
  }
  const alpha = values[3] ?? 1;
  assert.ok(Number.isFinite(alpha) && alpha >= 0 && alpha <= 1, `finite alpha: ${context}`);
  return { rgb: values.slice(0, 3), alpha };
}

// Keep contrast assertions independent of the production contrast implementation.
function ratio(a, b) {
  const luminance = rgb => rgb.map(value => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function validTokens(tokens, context) {
  assert.deepEqual(Object.keys(tokens).sort(), [...TOKEN_KEYS].sort(), `${context}: exactly the ${TOKEN_KEYS.length} audited theme tokens`);
  for (const key of TOKEN_KEYS) {
    assert.deepEqual(Object.keys(tokens[key]).sort(), ['dark', 'light'], `${context}: ${key} scheme pair`);
    for (const scheme of SCHEMES) {
      const color = parseCss(tokens[key][scheme], `${context} ${key} ${scheme}`);
      if (key !== '--dsw-alias-bg-base') assert.equal(color.alpha, 1, `${context}: non-base tokens must stay opaque`);
    }
  }
}

function assertAccessible(tokens, strength, context, photos = PHOTOS.slice(0, 2)) {
  const blend = (top, bottom, opacity) => top.map((value, i) => Math.round(value * opacity + bottom[i] * (1 - opacity)));
  for (const scheme of SCHEMES) {
    const rgb = key => parseCss(tokens[key][scheme]).rgb;
    const backgrounds = new Map([...SURFACES, ...CONTROL_SURFACES].map(key => [tokens[key][scheme], [key, rgb(key)]]));
    const base = parseCss(tokens['--dsw-alias-bg-base'][scheme]);
    const veil = EXPECTED_VEIL[scheme];
    for (const photo of photos) {
      const backdrop = blend(veil.rgb, photo, veil.alpha);
      backgrounds.set(`photo:${photo}`, [`scrim over ${photo}`, backdrop]);
      backgrounds.set(`base:${photo}`, [`base over ${photo}`, blend(base.rgb, backdrop, base.alpha)]);
    }
    const check = (ink, fill, minimum, pair) => {
      const actual = ratio(ink, fill);
      if (actual < minimum) assert.fail(`${context} ${scheme} ${pair} at ${strength}%: ${actual} < ${minimum}`);
    };
    const text = FOREGROUNDS.map(key => [key, rgb(key)]);
    const edges = [...BORDERS, '--dsw-focus-ring-color'].map(key => [key, rgb(key)]);
    for (const [surface, background] of backgrounds.values()) {
      for (const [key, color] of text) check(color, background, 4.5, `${key} on ${surface}`);
      for (const [key, color] of edges) check(color, background, 3, `${key} on ${surface}`);
    }
    for (const fill of BRAND_FILLS) for (const ink of ON_ACCENT) check(rgb(ink), rgb(fill), 4.5, `${ink} on ${fill}`);
    for (const fill of INFO_FILLS) check([255, 255, 255], rgb(fill), 4.5, `white on ${fill}`);
    for (const [ink, fill] of INVERSE_PAIRS) check(rgb(ink), rgb(fill), 4.5, `${ink} on ${fill}`);
    // Stock DSH 0.2.2-rc.4 hovercard state colors: preserve them, but ensure
    // tinting their inverse background does not harm this actual component pair.
    for (const ink of [[242, 90, 90], [167, 139, 250]]) {
      check(ink, rgb('--dsw-alias-hovercard-bg'), 4.5, `stock hovercard state ${ink}`);
    }
    check(rgb('--dsw-alias-switch-thumb'), rgb('--dsw-alias-border-l3'), 3, 'off-switch thumb on track');
  }
}

test('wallpaper scrim matches the rendered light and dark overlay', () => {
  for (const scheme of SCHEMES) {
    assert.equal(WALLPAPER_VEIL[scheme], EXPECTED_VEIL[scheme].alpha);
    assert.deepEqual(parseCss(wallpaperShade(scheme)), EXPECTED_VEIL[scheme]);
  }
});

test('saturated and midtone photos stay readable at maximum wallpaper visibility', () => {
  for (const mode of MODES) for (const accent of ACCENTS) {
    assertAccessible(makeTokens(accent, 100, mode), 100, `${mode} source=${accent}`, PHOTOS);
  }
});

test('default, hovered and selected control surfaces remain distinct', () => {
  const tokens = makeTokens([180, 92, 30], 100, 'content');
  for (const scheme of SCHEMES) {
    const fills = ['--dsw-specific-input-major', '--dsw-alias-card-fill-hover', '--dsw-alias-bg-module-platform'];
    assert.equal(new Set(fills.map(key => tokens[key][scheme])).size, 3);
  }
});

test('More menus and Todo panels use tinted opaque overlays, never M3 pure-white Lowest', () => {
  assert.equal(TOKEN_KEYS.length, 85);
  for (const mode of MODES) for (const accent of ACCENTS) for (const strength of [10, 28, 100]) {
    const tokens = makeTokens(accent, strength, mode);
    for (const scheme of SCHEMES) {
      const overlay = tokens['--dsw-alias-bg-overlay'][scheme];
      assert.equal(tokens['--dsw-menu-surface-fill'][scheme], overlay);
      assert.equal(tokens['--dsw-specific-menu'][scheme], overlay);
      assert.equal(parseCss(overlay).alpha, 1);
      assert.notDeepEqual(parseCss(overlay).rgb, [255, 255, 255]);
      assert.notEqual(tokens['--dsw-alias-interactive-bg-hover'][scheme], overlay);
      assert.notEqual(tokens['--dsw-alias-interactive-bg-active'][scheme], overlay);
    }
  }
  for (const mode of ['content', 'tonal-spot', 'vibrant', 'faithful']) {
    assert.notEqual(makeTokens([180, 92, 30], 100, mode)['--dsw-menu-surface-fill'].light,
      makeTokens([22, 144, 187], 100, mode)['--dsw-menu-surface-fill'].light);
  }
});

test('inverse panels keep their dark surface and scrollbar hover remains distinguishable', () => {
  for (const mode of MODES) for (const accent of ACCENTS) {
    const tokens = makeTokens(accent, 100, mode);
    for (const scheme of SCHEMES) {
      for (const key of ['--dsw-alias-tooltip-bg', '--dsw-alias-toast-bg', '--dsw-alias-hovercard-bg']) {
        assert.ok(ratio([255, 255, 255], parseCss(tokens[key][scheme]).rgb) >= 12, `${mode} ${scheme} ${key} stays dark`);
      }
      for (const level of ['l1', 'l2']) {
        assert.notEqual(tokens[`--dsw-alias-scrollbar-bg-${level}`][scheme], tokens[`--dsw-alias-scrollbar-hover-${level}`][scheme]);
      }
    }
  }
});

test('semantic colors and shared on-color text are untouched', () => {
  for (const key of Object.keys(makeTokens([180, 92, 30], 100, 'content'))) {
    assert.doesNotMatch(key, /(?:--dsw-static-|state-|diff-|illustration-|label-on-color|brand-primary-invert|hovercard-state)/);
  }
});

test('palette modes expose only the ten screenshot-mode choices, defaulting to content', () => {
  assert.deepEqual(PALETTE_MODES, MODES);
  assert.equal(new Set(PALETTE_MODES).size, 10);
  assert.equal(PALETTE_MODES.includes('original'), false);
  assert.equal(DEFAULTS.paletteMode, 'content');
});

test('settings reject invalid fields and bound visibility to 10..100', () => {
  assert.deepEqual(normalizeSettings(), DEFAULTS);
  assert.deepEqual(normalizeSettings({ day: '99:02', night: '08:99', mode: 'bogus', enabled: 'yes', dynamic: 'yes', strength: NaN, paletteMode: 'bogus' }), DEFAULTS);
  assert.equal(normalizeSettings({ strength: 500 }).strength, 100);
  assert.equal(normalizeSettings({ strength: -3 }).strength, 10);
  for (const strength of STRENGTHS) assert.equal(normalizeSettings({ strength }).strength, strength);
  assert.equal(normalizeSettings({ strength: 50.6 }).strength, 51);
  assert.equal(normalizeSettings({ strength: 99.7 }).strength, 100);
  for (const strength of [NaN, Infinity, -Infinity, undefined, null, '75', '', {}, []]) {
    assert.equal(normalizeSettings({ strength }).strength, DEFAULTS.strength, `invalid strength ${String(strength)}`);
  }
  for (const input of [null, undefined, false, 42, 'invalid']) assert.deepEqual(normalizeSettings(input), DEFAULTS);
});

test('source defaults migrate to China and only the two fixed markets are accepted', () => {
  assert.equal(DEFAULTS.market, 'zh-CN');
  for (const market of ['zh-CN', 'en-US']) {
    const prefs = { ...DEFAULTS, market, paletteMode: 'soft', strength: 73 };
    assert.deepEqual(normalizeSettings(prefs), prefs);
  }
  for (const market of [undefined, null, '', 'global', 'EN-US', 'fr-FR', 'https://evil.test', {}, []]) {
    assert.equal(normalizeSettings({ market }).market, 'zh-CN');
  }
});

test('all palette choices normalize without changing independent theme settings', () => {
  const filter = { filterMode: 'blue', filterAmounts: { ...DEFAULTS.filterAmounts, blue: 42 } };
  for (const paletteMode of MODES) {
    const input = { ...DEFAULTS, enabled: false, dynamic: false, market: 'en-US', paletteMode, mode: 'dark', day: '05:30', night: '21:45', strength: 75, ...filter };
    assert.deepEqual(normalizeSettings(input), input);
    assert.deepEqual(normalizeSettings(normalizeSettings(input)), input);
  }
  for (const paletteMode of ['original', '', 'CONTENT', 'tonalSpot', 'unknown', null, undefined, 0, {}, []]) {
    const input = { ...DEFAULTS, paletteMode, strength: 99, mode: 'dark', day: '05:30', night: '21:45', enabled: false, dynamic: false, ...filter };
    assert.deepEqual(normalizeSettings(input), { ...input, market: 'zh-CN', paletteMode: 'content' }, 'only the unsupported palette preference changes');
  }
  for (const mode of ['follow', 'schedule', 'system', 'light', 'dark']) assert.equal(normalizeSettings({ mode }).mode, mode);
});

test('legacy original, unknown and missing palettes migrate to content without resetting other preferences', () => {
  for (const strength of STRENGTHS) for (const mode of ['follow', 'schedule', 'system', 'light', 'dark']) {
    for (const palette of [{}, { paletteMode: 'original' }, { paletteMode: 'unknown' }]) {
      const legacy = { enabled: false, dynamic: false, mode, day: '06:15', night: '22:30', strength, ...palette };
      const before = { ...legacy };
      const normalized = normalizeSettings(legacy);
      assert.deepEqual(normalized, { ...DEFAULTS, ...legacy, market: 'zh-CN', paletteMode: 'content' });
      assert.deepEqual(normalizeSettings(normalized), normalized, 'migration is idempotent');
      assert.deepEqual(legacy, before, 'migration must not mutate stored preferences');
    }
  }
  assert.deepEqual(makeTokens([22, 144, 187]), makeTokens([22, 144, 187], 28, 'content'));
});

test('removed original and invalid palette arguments fall back to content, including prototype names', () => {
  for (const mode of ['original', 'unknown', 'CONTENT', 'constructor', 'toString', '__proto__', 'hasOwnProperty', '', null, undefined, 1, true, {}, [], Symbol('palette')]) {
    for (const strength of STRENGTHS) {
      assert.deepEqual(makeTokens([22, 144, 187], strength, mode), makeTokens([22, 144, 187], strength, 'content'), `unsupported palette ${String(mode)} strength=${strength}`);
    }
  }
});

test('day/night boundary and midnight-wrapping schedules use local time', () => {
  for (const [h, m, expected] of [[6, 59, 'dark'], [7, 0, 'light'], [18, 59, 'light'], [19, 0, 'dark'], [0, 0, 'dark']]) assert.equal(scheduledScheme(at(h, m), '07:00', '19:00'), expected);
  assert.equal(scheduledScheme(at(23), '19:00', '07:00'), 'light');
  assert.equal(scheduledScheme(at(12), '19:00', '07:00'), 'dark');
  assert.equal(scheduledScheme(at(12), '07:00', '07:00'), null);
  assert.equal(localDate(at(12)), '2026-11-18');
});

test('colour extraction ignores transparency, near-white and black borders', () => {
  const data = new Uint8ClampedArray([20, 130, 180, 255, 22, 132, 182, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 0]);
  const rgb = extractAccent(data);
  assert.ok(rgb[2] > rgb[1] && rgb[1] > rgb[0]);
});

test('monochrome pictures and empty samples have safe fallback', () => {
  assert.deepEqual(extractAccent([128, 128, 128, 255]), [128, 128, 128]);
  assert.deepEqual(extractAccent([]), [92, 116, 132]);
});

test('HSL conversion round-trips representative colours', () => {
  for (const rgb of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [22, 144, 187], [128, 128, 128], [0, 0, 0], [255, 255, 255]]) assert.deepEqual(hslToRgb(rgbToHsl(rgb)), rgb);
});

test('contrast utility agrees with independent WCAG luminance and known ratios', () => {
  assert.equal(contrast([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(contrast([22, 144, 187], [22, 144, 187]), 1);
  for (const accent of ACCENTS) {
    for (const background of [[0, 0, 0], [255, 255, 255], [128, 128, 128]]) {
      assert.ok(Math.abs(contrast(accent, background) - ratio(accent, background)) < 1e-12);
    }
  }
});

test('all modes produce exactly 85 valid tokens and distinct light/dark schemes', () => {
  for (const mode of MODES) for (const accent of ACCENTS) for (const strength of STRENGTHS) {
    const tokens = makeTokens(accent, strength, mode);
    const context = `${mode} rgb=${accent} strength=${strength}`;
    validTokens(tokens, context);
    for (const key of ['--dsw-alias-bg-base', ...SURFACES, ...FOREGROUNDS]) {
      assert.notDeepEqual(parseCss(tokens[key].light).rgb, parseCss(tokens[key].dark).rgb, `${context} ${key}: light and dark must differ`);
    }
  }
});

test('M3 modes project official HCT scheme roles into both token schemes', () => {
  const official = {
    content: SchemeContent, 'tonal-spot': SchemeTonalSpot, 'fruit-salad': SchemeFruitSalad,
    rainbow: SchemeRainbow, monochrome: SchemeMonochrome, vibrant: SchemeVibrant,
    faithful: SchemeFidelity, soft: SchemeNeutral, dysfunctional: SchemeExpressive,
  };
  const roles = {
    '--dsw-alias-bg-base': 'surface', '--dsw-alias-bg-layer-1': 'surfaceContainerLow',
    '--dsw-alias-border-l1': 'outlineVariant',
  };
  // Layer 2 and the sidebar deliberately include the official secondary/tertiary
  // container roles: Content and Fidelity differ in tertiary, not primary/neutral.
  const mixedRoles = {
    '--dsw-alias-bg-layer-2': ['surfaceContainer', 'secondaryContainer', 0.08],
    '--dsw-alias-bg-overlay': ['surfaceContainerLow', 'secondaryContainer', 0.04],
    '--dsw-alias-interactive-bg-hover': ['surfaceContainerLow', 'secondaryContainer', 0.24],
    '--dsw-specific-sidebar-fill': ['surfaceContainerHigh', 'tertiaryContainer', 0.18],
  };
  for (const [mode, Scheme] of Object.entries(official)) for (const accent of [[22, 144, 187], [227, 44, 91], [97, 170, 31]]) {
    const source = Hct.fromInt(argbFromRgb(...accent));
    for (const strength of [28, 75]) {
      const tokens = makeTokens(accent, strength, mode);
      for (const schemeName of SCHEMES) {
        const scheme = new Scheme(source, schemeName === 'dark', 0);
        for (const [key, role] of Object.entries(roles)) {
          assert.deepEqual(parseCss(tokens[key][schemeName]).rgb, fromArgb(scheme[role]), `${mode} ${schemeName} ${key}: official ${Scheme.name}.${role}`);
        }
        for (const [key, [surfaceRole, tintRole, amount]] of Object.entries(mixedRoles)) {
          const surface = fromArgb(scheme[surfaceRole]);
          const tint = fromArgb(scheme[tintRole]);
          const expected = surface.map((channel, index) => Math.round(channel * (1 - amount) + tint[index] * amount));
          assert.deepEqual(parseCss(tokens[key][schemeName]).rgb, expected, `${mode} ${schemeName} ${key}: official ${surfaceRole}/${tintRole} projection`);
        }
      }
    }
  }
});

test('all ten palette modes have genuinely different light and dark output', () => {
  for (const scheme of SCHEMES) {
    const signatures = new Map();
    for (const mode of MODES) {
      const signature = JSON.stringify([[227, 44, 91], [22, 144, 187], [97, 170, 31]].map(accent => {
        const tokens = makeTokens(accent, 28, mode);
        return TOKEN_KEYS.map(key => tokens[key][scheme]);
      }));
      assert.equal(signatures.has(signature), false, `${mode} ${scheme} must not duplicate ${signatures.get(signature)}`);
      signatures.set(signature, mode);
    }
  }
});

test('monochrome tokens stay grayscale even for saturated source colours', () => {
  for (const accent of ACCENTS) for (const strength of [10, 50, 75, 100]) {
    const tokens = makeTokens(accent, strength, 'monochrome');
    for (const key of TOKEN_KEYS) for (const scheme of SCHEMES) {
      const [r, g, b] = parseCss(tokens[key][scheme]).rgb;
      assert.equal(r, g, `monochrome ${key} ${scheme} red=green`);
      assert.equal(g, b, `monochrome ${key} ${scheme} green=blue`);
    }
  }
});

test('muted uses low-chroma HCT without collapsing to monochrome', () => {
  let hasTint = false;
  for (const accent of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [22, 144, 187]]) {
    const tokens = makeTokens(accent, 28, 'muted');
    for (const scheme of SCHEMES) {
      for (const key of ['--dsw-alias-brand-primary', ...SURFACES]) {
        const rgb = parseCss(tokens[key][scheme]).rgb;
        const chroma = Hct.fromInt(argbFromRgb(...rgb)).chroma;
        const maximum = key === '--dsw-alias-brand-primary' ? 22 : 7;
        assert.ok(chroma <= maximum, `muted ${key} ${scheme}: low HCT chroma, got ${chroma}`);
        if (key === '--dsw-alias-brand-primary' && Math.max(...rgb) - Math.min(...rgb) > 3) hasTint = true;
      }
    }
  }
  assert.ok(hasTint, 'muted must retain a subtle accent instead of being renamed monochrome');
});

test('all modes retain accessible text and accents on panels at every visibility', () => {
  // Sweep the full hue wheel, not just the screenshot source colour.
  for (const mode of MODES) for (let hue = 0; hue < 360; hue += 10) {
    const accent = hslToRgb([hue, 90, 50]);
    for (const strength of STRENGTHS) {
      assertAccessible(makeTokens(accent, strength, mode), strength, `${mode} hue=${hue} strength=${strength}`);
    }
  }
  for (const mode of MODES) for (const accent of [[0, 0, 0], [255, 255, 255], [150, 150, 150]]) {
    for (const strength of STRENGTHS) assertAccessible(makeTokens(accent, strength, mode), strength, `${mode} rgb=${accent} strength=${strength}`);
  }
});

test('base alpha follows sqrt(1-strength/100), decreases monotonically and reaches exact zero', () => {
  for (const mode of MODES) {
    let previous = { light: Infinity, dark: Infinity };
    for (let strength = 10; strength <= 100; strength++) {
      const tokens = makeTokens([20, 130, 180], strength, mode);
      for (const scheme of SCHEMES) {
        const alpha = parseCss(tokens['--dsw-alias-bg-base'][scheme]).alpha;
        assert.ok(Math.abs(alpha - Math.sqrt(1 - strength / 100)) < 1e-12, `${mode} ${scheme} strength=${strength}: square-root alpha`);
        assert.ok(alpha < previous[scheme], `${mode} ${scheme} strength=${strength}: strictly decreasing alpha`);
        if (strength === 100) assert.equal(alpha, 0, `${mode} ${scheme}: fully visible wallpaper`);
        previous[scheme] = alpha;
      }
    }
  }
});

test('strength clamping and malformed values cannot create NaN or invalid CSS', () => {
  const cases = [
    [-500, 10], [0, 10], [9, 10], [10, 10], [50.6, 51], [51, 51], [75, 75],
    [99, 99], [100, 100], [101, 100], [500, 100],
    [NaN, 28], [Infinity, 28], [-Infinity, 28], [undefined, 28], [null, 28], ['75', 28], [{}, 28], [[], 28],
  ];
  for (const mode of MODES) for (const [input, expected] of cases) {
    const tokens = makeTokens([20, 130, 180], input, mode);
    validTokens(tokens, `${mode} malformed strength=${String(input)}`);
    assert.deepEqual(tokens, makeTokens([20, 130, 180], expected, mode), `${mode}: strength ${String(input)} normalizes to ${expected}`);
    assertAccessible(tokens, expected, `${mode} normalized strength=${expected}`);
  }
});

test('source sanitization clamps RGB channels, supports typed arrays and retains deterministic fallbacks', () => {
  for (const mode of MODES) {
    for (const [input, expected] of [
      [[-50, 999, 256], [0, 255, 255]],
      [[22.4, 144.6, 187.5], [22, 145, 188]],
      [[NaN, Infinity, -Infinity], [92, 116, 132]],
      [[22, NaN, 187], [22, 116, 187]],
      [[], [92, 116, 132]], [null, [92, 116, 132]],
      [new Uint8Array([22, 144, 187]), [22, 144, 187]],
      [new Uint8ClampedArray([22, 144, 187]), [22, 144, 187]],
      [new Float64Array([22.4, 144.6, 187.5]), [22, 145, 188]],
    ]) {
      assert.deepEqual(makeTokens(input, 75, mode), makeTokens(expected, 75, mode), `${mode}: deterministic RGB sanitization`);
    }
  }
});

test('invalid source channels are sanitized for every palette without leaking NaN', () => {
  for (const mode of MODES) {
    for (const accent of [null, undefined, [], {}, 'not-rgb', [NaN, Infinity, -Infinity], [-50, 999, 256], [22, NaN, 187]]) {
      for (const strength of [28, 75, 100]) {
        const tokens = makeTokens(accent, strength, mode);
        validTokens(tokens, `${mode} invalid accent=${String(accent)} strength=${strength}`);
        assertAccessible(tokens, strength, `${mode} sanitized accent=${String(accent)} strength=${strength}`);
      }
    }
  }
});
