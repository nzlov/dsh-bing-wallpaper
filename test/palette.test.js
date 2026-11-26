import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Hct, argbFromRgb, redFromArgb, greenFromArgb, blueFromArgb,
  SchemeContent, SchemeTonalSpot, SchemeFruitSalad, SchemeRainbow, SchemeMonochrome,
} from '@material/material-color-utilities';
import {
  PALETTE_MODES, TEXT_COLOR_MODES, DEFAULTS, normalizeSettings, scheduledScheme,
  makeTokens, contrast, rgbToHsl, hslToRgb, localDate,
} from '../src/client/theme/palette.js';
import { makeCustomSchemes } from '../src/client/theme/custom-palette.js';

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
  '--dsw-alias-bg-layer-3', '--dsw-alias-bg-module-platform', '--dsw-alias-bg-multi-select', '--dsw-alias-bg-document-preview',
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
  '--dsw-alias-turn-trigger-bg', '--dsw-alias-turn-trigger-bg-hover', '--shiki-background',
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
  ['--dsw-alias-hovercard-state-done', '--dsw-alias-hovercard-bg'],
  ['--dsw-alias-hovercard-state-error', '--dsw-alias-hovercard-bg'],
];
const EXTRA_OPAQUE_KEYS = [
  '--dsw-alias-brand-primary-invert', '--dsw-alias-label-document-preview', '--dsw-alias-label-deep-diving', '--dsw-alias-label-deep-diving-shimmer',
  '--dsw-alias-onboarding-accent', '--dsw-alias-trajectory-accent', '--dsw-specific-sidebar-right-flash', '--dsw-specific-guide-hero',
  '--dsw-alias-state-business-primary', '--dsw-alias-state-business-tertiary', '--dsw-alias-state-done-primary',
  '--dsw-alias-state-error-primary', '--dsw-alias-state-error-secondary', '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary', '--dsw-alias-state-success-secondary', '--dsw-alias-state-success-tertiary',
  '--dsw-alias-state-warn-label', '--dsw-alias-state-warn-primary', '--dsw-alias-state-warn-secondary', '--dsw-alias-state-warn-tertiary',
  '--dsw-alias-file-diff-added-bg', '--dsw-alias-file-diff-added-gutter', '--dsw-alias-file-diff-added-marker',
  '--dsw-alias-file-diff-deleted-bg', '--dsw-alias-file-diff-deleted-gutter', '--dsw-alias-file-diff-deleted-marker',
  '--dsw-alias-chart-messages', '--dsw-alias-chart-system', '--dsw-alias-chart-tools',
  '--dsw-alias-illustration-background', '--dsw-alias-illustration-backing', '--dsw-alias-illustration-detail',
  '--dsw-alias-illustration-inset', '--dsw-alias-illustration-shadow', '--dsw-alias-illustration-surface',
  '--dsw-alias-json-tree-icon', '--dsw-alias-json-tree-keyword', '--dsw-alias-json-tree-number',
  '--dsw-alias-json-tree-property', '--dsw-alias-json-tree-punctuation', '--dsw-alias-json-tree-string',
  '--shiki-foreground', '--shiki-token-comment', '--shiki-token-constant', '--shiki-token-function',
  '--shiki-token-keyword', '--shiki-token-link', '--shiki-token-parameter', '--shiki-token-punctuation',
  '--shiki-token-string', '--shiki-token-string-expression',
];
const TRANSLUCENT_KEYS = [
  '--dsw-alias-bg-document-selection', '--dsw-alias-bg-skeleton', '--dsw-specific-file-upload-track',
  '--dsw-alias-border-inverted', '--dsw-alias-border-inverted2', '--dsw-alias-code-diff-added',
  '--dsw-alias-code-diff-deleted', '--dsw-alias-interactive-bg-hover-danger', '--dsw-alias-json-tree-hover',
  '--dsw-alias-label-shimmer',
];
const GRADIENT_KEYS = [
  '--dsw-gradient-onboarding-blue-stops', '--dsw-gradient-onboarding-cyan-stops', '--dsw-gradient-onboarding-violet-stops',
];
const SYSTEM_TWEAK_KEYS = [
  '--dsw-alias-bg-mask-1', '--dsw-alias-bg-mask-2', '--dsw-alias-bg-mask-3', '--dsw-alias-bg-mask-drop', '--dsw-alias-bg-mask-photo',
  '--dsw-alias-button-tool-bar-fill', '--dsw-alias-button-tool-bar-fill-invisible', '--dsw-alias-button-tool-bar-hover',
  '--dsw-alias-label-on-color',
  '--dsw-specific-sidebar-glass-collapsed-fill', '--dsw-specific-sidebar-glass-collapsed-hover',
  '--dsw-specific-sidebar-glass-fill', '--dsw-specific-sidebar-glass-hover', '--dsw-specific-sidebar-tint',
  '--dsw-specific-sidebar-wash-bottom', '--dsw-specific-sidebar-wash-bottom-clear',
  '--dsw-specific-sidebar-wash-top', '--dsw-specific-sidebar-wash-top-clear',
];
const TOKEN_KEYS = [
  '--dsw-alias-bg-base', ...SURFACES, ...CONTROL_SURFACES, ...FOREGROUNDS, ...BRAND_FILLS, ...INFO_FILLS, ...ON_ACCENT,
  '--dsw-alias-border-l1', ...BORDERS, '--dsw-focus-ring-color', '--dsw-alias-switch-thumb',
  ...new Set(INVERSE_PAIRS.flat()), ...EXTRA_OPAQUE_KEYS, ...TRANSLUCENT_KEYS, ...GRADIENT_KEYS,
];
const FULL_TOKEN_KEYS = [...TOKEN_KEYS, ...SYSTEM_TWEAK_KEYS];
const TRANSLUCENT_SET = new Set(['--dsw-alias-bg-base', ...TRANSLUCENT_KEYS, ...SYSTEM_TWEAK_KEYS.filter(k => k !== '--dsw-alias-label-on-color')]);
const GRADIENT_SET = new Set(GRADIENT_KEYS);
const ERROR_FAMILY = new Set([
  '--dsw-alias-state-error-primary', '--dsw-alias-state-error-secondary', '--dsw-alias-hovercard-state-error',
  '--dsw-alias-interactive-bg-hover-danger', '--dsw-alias-code-diff-deleted',
  '--dsw-alias-file-diff-deleted-bg', '--dsw-alias-file-diff-deleted-gutter', '--dsw-alias-file-diff-deleted-marker',
]);
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

function validTokens(tokens, context, expectedKeys = TOKEN_KEYS) {
  assert.deepEqual(Object.keys(tokens).sort(), [...expectedKeys].sort(), `${context}: exactly the ${expectedKeys.length} audited theme tokens`);
  for (const key of expectedKeys) {
    assert.deepEqual(Object.keys(tokens[key]).sort(), ['dark', 'light'], `${context}: ${key} scheme pair`);
    for (const scheme of SCHEMES) {
      const value = tokens[key][scheme];
      if (GRADIENT_SET.has(key)) {
        assert.match(value, /^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\) [\d.]+%, rgb\(\d{1,3}, \d{1,3}, \d{1,3}\) [\d.]+%, rgb\(\d{1,3}, \d{1,3}, \d{1,3}\) [\d.]+%, rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/, `${context} ${key} ${scheme}`);
        continue;
      }
      const color = parseCss(value, `${context} ${key} ${scheme}`);
      if (!TRANSLUCENT_SET.has(key)) assert.equal(color.alpha, 1, `${context}: opaque token ${key} must stay opaque`);
    }
  }
}

function assertAccessible(tokens, strength, context, checkSemanticPairs = false) {
  for (const scheme of SCHEMES) {
    const rgb = key => parseCss(tokens[key][scheme]).rgb;
    const backgrounds = new Map([...SURFACES, ...CONTROL_SURFACES].map(key => [tokens[key][scheme], [key, rgb(key)]]));
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
    check(rgb('--dsw-alias-switch-thumb'), rgb('--dsw-alias-border-l3'), 3, 'off-switch thumb on track');
    if (checkSemanticPairs) {
      check(rgb('--dsw-alias-state-business-primary'), rgb('--dsw-alias-state-business-tertiary'), 4.5, 'business primary on tertiary');
      check(rgb('--dsw-alias-state-success-primary'), rgb('--dsw-alias-state-success-tertiary'), 4.5, 'success primary on tertiary');
      check(rgb('--dsw-alias-state-warn-label'), rgb('--dsw-alias-state-warn-tertiary'), 4.5, 'warn label on tertiary');
      check(rgb('--dsw-alias-label-primary'), rgb('--dsw-alias-file-diff-added-bg'), 4.5, 'primary text on diff added bg');
      check(rgb('--dsw-alias-label-primary'), rgb('--dsw-alias-file-diff-deleted-bg'), 4.5, 'primary text on diff deleted bg');
      check(rgb('--dsw-alias-file-diff-added-marker'), rgb('--dsw-alias-file-diff-added-gutter'), 4.5, 'diff added marker on gutter');
      check(rgb('--dsw-alias-file-diff-deleted-marker'), rgb('--dsw-alias-file-diff-deleted-gutter'), 4.5, 'diff deleted marker on gutter');
      for (const key of [
        '--shiki-token-keyword', '--shiki-token-constant', '--shiki-token-string', '--shiki-token-string-expression',
        '--shiki-token-function', '--shiki-token-parameter', '--shiki-token-comment', '--shiki-token-punctuation', '--shiki-token-link',
        '--dsw-alias-state-error-primary', '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary',
      ]) {
        check(rgb(key), rgb('--shiki-background'), 4.5, `${key} on code block`);
      }
      if ('--dsw-alias-label-on-color' in tokens) {
        for (const fill of INFO_FILLS) check(rgb('--dsw-alias-label-on-color'), rgb(fill), 4.5, `label-on-color on ${fill}`);
      }
    }
  }
}

test('opaque surfaces stay readable at maximum wallpaper visibility', () => {
  for (const mode of MODES) for (const accent of ACCENTS) {
    assertAccessible(makeTokens(accent, 100, mode, 'high-contrast'), 100, `${mode} high-contrast source=${accent}`, true);
    assertAccessible(makeTokens(accent, 100, mode, 'high-contrast', { pureBlackDark: true, systemTweaks: true }), 100, `${mode} high-contrast pureBlack+tweaks source=${accent}`, true);
    if (['content', 'tonal-spot', 'fruit-salad', 'rainbow', 'monochrome'].includes(mode)) {
      assertAccessible(makeTokens(accent, 100, mode, 'theme'), 100, `${mode} theme source=${accent}`);
    }
  }
});

test('independent custom candidates retain contrast on opaque surfaces', () => {
  const sources = [
    [[255, 20, 20], [20, 255, 255], [20, 20, 255]],
    [[20, 60, 230], [230, 140, 20], [40, 230, 40]],
    [[110, 110, 110], [255, 180, 0], [200, 10, 150]],
  ];
  for (const mode of ['vibrant', 'faithful', 'soft', 'dysfunctional', 'muted']) {
    for (const candidates of sources) for (const strength of [10, 28, 100]) {
      assertAccessible(makeTokens(candidates, strength, mode, 'high-contrast'), strength, `${mode} candidates=${JSON.stringify(candidates)}`);
    }
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
  assert.equal(TOKEN_KEYS.length, 156);
  assert.equal(FULL_TOKEN_KEYS.length, 174);
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

test('static primitives remain untouched and system tweaks gate the 18 system-level overrides', () => {
  const base = makeTokens([180, 92, 30], 100, 'content');
  const full = makeTokens([180, 92, 30], 100, 'content', 'theme', { systemTweaks: true });
  validTokens(base, 'base content');
  validTokens(full, 'systemTweaks content', FULL_TOKEN_KEYS);
  for (const key of Object.keys(base)) {
    assert.doesNotMatch(key, /(?:--dsw-static-|bg-mask-|button-tool-bar|label-on-color|sidebar-glass|sidebar-tint|sidebar-wash)/);
  }
  for (const key of Object.keys(full)) {
    assert.doesNotMatch(key, /--dsw-static-/);
  }
  for (const key of SYSTEM_TWEAK_KEYS) {
    assert.equal(key in base, false, `${key} stays off by default`);
    assert.equal(key in full, true, `${key} enabled by systemTweaks`);
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

test('all modes produce exactly 156 base tokens (174 with systemTweaks) and distinct light/dark schemes', () => {
  for (const mode of MODES) for (const accent of ACCENTS) for (const strength of STRENGTHS) {
    const tokens = makeTokens(accent, strength, mode);
    const context = `${mode} rgb=${accent} strength=${strength}`;
    validTokens(tokens, context);
    for (const key of ['--dsw-alias-bg-base', ...SURFACES, ...FOREGROUNDS]) {
      assert.notDeepEqual(parseCss(tokens[key].light).rgb, parseCss(tokens[key].dark).rgb, `${context} ${key}: light and dark must differ`);
    }
  }
});

test('M3 modes project official HCT scheme roles directly without secondary mixing', () => {
  const official = {
    content: SchemeContent, 'tonal-spot': SchemeTonalSpot, 'fruit-salad': SchemeFruitSalad,
    rainbow: SchemeRainbow, monochrome: SchemeMonochrome,
  };
  const surfaceRoles = {
    '--dsw-alias-bg-base': 'surface', '--dsw-alias-bg-layer-1': 'surfaceContainerLow',
    '--dsw-alias-bg-layer-2': 'surfaceContainer', '--dsw-alias-bg-overlay': 'surfaceContainer',
    '--dsw-specific-sidebar-fill': 'surfaceContainerHigh', '--dsw-alias-interactive-bg-hover': 'surfaceContainerHigh',
    '--dsw-alias-interactive-bg-active': 'surfaceContainerHighest', '--dsw-alias-border-l1': 'outlineVariant',
  };
  const themeRoles = {
    '--dsw-alias-brand-primary': 'primary', '--dsw-alias-label-primary-foreground': 'onPrimary',
    '--dsw-alias-border-l2': 'outline',
  };
  for (const [mode, Scheme] of Object.entries(official)) for (const accent of [[22, 144, 187], [227, 44, 91], [97, 170, 31]]) {
    const source = Hct.fromInt(argbFromRgb(...accent));
    for (const strength of [28, 75]) {
      for (const textMode of TEXT_COLOR_MODES) {
        const tokens = makeTokens(accent, strength, mode, textMode);
        for (const schemeName of SCHEMES) {
          const scheme = new Scheme(source, schemeName === 'dark', 0);
          for (const [key, role] of Object.entries(surfaceRoles)) {
            assert.deepEqual(parseCss(tokens[key][schemeName]).rgb, fromArgb(scheme[role]), `${mode} ${textMode} ${schemeName} ${key}: official ${Scheme.name}.${role}`);
          }
          if (textMode === 'theme') {
            for (const [key, role] of Object.entries(themeRoles)) {
              assert.deepEqual(parseCss(tokens[key][schemeName]).rgb, fromArgb(scheme[role]), `${mode} theme ${schemeName} ${key}: official ${Scheme.name}.${role}`);
            }
          }
        }
      }
    }
  }
});

test('custom modes keep Noctalia brand and border roles in theme mode while high-contrast uses neutral text', () => {
  assert.deepEqual(TEXT_COLOR_MODES, ['theme', 'high-contrast']);
  assert.equal(DEFAULTS.textColorMode, 'theme');
  assert.equal(normalizeSettings({ textColorMode: 'high-contrast' }).textColorMode, 'high-contrast');
  assert.equal(normalizeSettings({ textColorMode: 'bogus' }).textColorMode, 'theme');
  const candidates = [[255, 220, 0], [0, 120, 220], [220, 40, 120]];
  for (const mode of ['vibrant', 'faithful', 'soft', 'dysfunctional', 'muted']) {
    const schemes = makeCustomSchemes(candidates, mode);
    const themeTokens = makeTokens(candidates, 75, mode, 'theme');
    const hcTokens = makeTokens(candidates, 75, mode, 'high-contrast');
    for (const [i, schemeName] of SCHEMES.entries()) {
      const scheme = schemes[i];
      assert.deepEqual(parseCss(themeTokens['--dsw-alias-brand-primary'][schemeName]).rgb, fromArgb(scheme.primary));
      assert.deepEqual(parseCss(themeTokens['--dsw-alias-border-l2'][schemeName]).rgb, fromArgb(scheme.outline));
      assert.deepEqual(parseCss(themeTokens['--dsw-alias-bg-layer-2'][schemeName]).rgb, fromArgb(scheme.surfaceContainer));
      assert.deepEqual(parseCss(themeTokens['--dsw-specific-sidebar-fill'][schemeName]).rgb, fromArgb(scheme.surfaceContainerHigh));
      const hcText = parseCss(hcTokens['--dsw-alias-label-primary'][schemeName]).rgb;
      assert.ok(Math.max(...hcText) - Math.min(...hcText) <= 10, `high-contrast keeps crisp near-neutral text: ${hcText}`);
    }
  }
});

test('mode-specific candidates reach the DSH mapping and theme mode skips contrast boost', () => {
  const red = [227, 44, 91], blue = [22, 144, 187], green = [97, 170, 31];
  const candidates = { content: [red], vibrant: [red, blue, green], faithful: [blue, green, red] };
  assert.deepEqual(makeTokens(candidates, 28, 'content'), makeTokens(red, 28, 'content'));
  assert.deepEqual(makeTokens(candidates, 28, 'vibrant'), makeTokens(candidates.vibrant, 28, 'vibrant'));
  assert.deepEqual(makeTokens(candidates, 28, 'faithful'), makeTokens(candidates.faithful, 28, 'faithful'));
  assert.notDeepEqual(makeTokens(candidates, 28, 'vibrant'), makeTokens(candidates, 28, 'faithful'));
  assert.notDeepEqual(makeTokens([22, 144, 187], 28, 'vibrant', 'theme'), makeTokens([22, 144, 187], 28, 'vibrant', 'high-contrast'));
});

test('monochrome tokens stay grayscale even for saturated source colours', () => {
  for (const accent of ACCENTS) for (const strength of [10, 50, 75, 100]) {
    const tokens = makeTokens(accent, strength, 'monochrome', 'theme');
    for (const key of TOKEN_KEYS) {
      if (ERROR_FAMILY.has(key) || GRADIENT_SET.has(key)) continue;
      for (const scheme of SCHEMES) {
        const [r, g, b] = parseCss(tokens[key][scheme]).rgb;
        assert.equal(r, g, `monochrome ${key} ${scheme} red=green`);
        assert.equal(g, b, `monochrome ${key} ${scheme} green=blue`);
      }
    }
  }
});

test('route A (theme) uses Noctalia palette roles while route B (high-contrast) harmonizes semantic and syntax hues', () => {
  const hueOf = rgb => Hct.fromInt(argbFromRgb(...rgb)).hue;
  const hueDiff = (a, b) => 180 - Math.abs(Math.abs(a - b) - 180);
  const seed = [79, 87, 110]; // #4f576e Noctalia SunsetPoint seed
  const routeA = makeTokens(seed, 50, 'content', 'theme');
  const routeB = makeTokens(seed, 50, 'content', 'high-contrast');
  for (const schemeName of SCHEMES) {
    const scheme = new SchemeContent(Hct.fromInt(argbFromRgb(...seed)), schemeName === 'dark', 0);
    // Route A: pure Noctalia palette roles (gtk4 + btop + helix + kitty palette style)
    assert.deepEqual(parseCss(routeA['--dsw-alias-state-business-primary'][schemeName]).rgb, fromArgb(scheme.primary));
    assert.deepEqual(parseCss(routeA['--dsw-alias-state-done-primary'][schemeName]).rgb, fromArgb(scheme.tertiary));
    assert.deepEqual(parseCss(routeA['--dsw-alias-state-success-primary'][schemeName]).rgb, fromArgb(scheme.secondary));
    assert.deepEqual(parseCss(routeA['--dsw-alias-state-warn-primary'][schemeName]).rgb, fromArgb(scheme.tertiary));
    assert.deepEqual(parseCss(routeA['--dsw-alias-state-error-primary'][schemeName]).rgb, fromArgb(scheme.error));
    assert.deepEqual(parseCss(routeA['--dsw-alias-file-diff-added-marker'][schemeName]).rgb, fromArgb(scheme.primary));
    assert.deepEqual(parseCss(routeA['--dsw-alias-file-diff-deleted-marker'][schemeName]).rgb, fromArgb(scheme.error));
    assert.deepEqual(parseCss(routeA['--dsw-alias-chart-messages'][schemeName]).rgb, fromArgb(scheme.primary));
    assert.deepEqual(parseCss(routeA['--dsw-alias-chart-system'][schemeName]).rgb, fromArgb(scheme.secondary));
    assert.deepEqual(parseCss(routeA['--dsw-alias-chart-tools'][schemeName]).rgb, fromArgb(scheme.tertiary));
    assert.deepEqual(parseCss(routeA['--shiki-token-keyword'][schemeName]).rgb, fromArgb(scheme.primary));
    assert.deepEqual(parseCss(routeA['--shiki-token-constant'][schemeName]).rgb, fromArgb(scheme.secondary));
    assert.deepEqual(parseCss(routeA['--shiki-token-string'][schemeName]).rgb, fromArgb(scheme.tertiary));

    // Route B: Material-harmonized canonical hues (within 15 deg of green 142 / amber 78 / red 27)
    const successRgb = parseCss(routeB['--dsw-alias-state-success-primary'][schemeName]).rgb;
    const warnRgb = parseCss(routeB['--dsw-alias-state-warn-primary'][schemeName]).rgb;
    const errorRgb = parseCss(routeB['--dsw-alias-state-error-primary'][schemeName]).rgb;
    const diffAddRgb = parseCss(routeB['--dsw-alias-file-diff-added-marker'][schemeName]).rgb;
    assert.ok(hueDiff(hueOf(successRgb), 142) <= 18, `route B ${schemeName} harmonized green: ${hueOf(successRgb)}`);
    assert.ok(hueDiff(hueOf(diffAddRgb), 142) <= 18, `route B ${schemeName} harmonized diff added: ${hueOf(diffAddRgb)}`);
    assert.ok(hueDiff(hueOf(warnRgb), 78) <= 18, `route B ${schemeName} harmonized amber: ${hueOf(warnRgb)}`);
    assert.ok(hueDiff(hueOf(errorRgb), 27) <= 18, `route B ${schemeName} harmonized red: ${hueOf(errorRgb)}`);
  }
});

test('pureBlackDark shifts only the dark surface ladder to pure black matching Noctalia applyPureBlackDark', () => {
  assert.equal(DEFAULTS.pureBlackDark, false);
  assert.equal(DEFAULTS.systemTweaks, false);
  assert.equal(normalizeSettings({ pureBlackDark: true, systemTweaks: true }).pureBlackDark, true);
  assert.equal(normalizeSettings({ pureBlackDark: 'yes', systemTweaks: 1 }).pureBlackDark, false);
  assert.equal(normalizeSettings({ pureBlackDark: 'yes', systemTweaks: 1 }).systemTweaks, false);

  const normal = makeTokens([79, 87, 110], 50, 'content', 'theme', { pureBlackDark: false });
  const pure = makeTokens([79, 87, 110], 50, 'content', 'theme', { pureBlackDark: true });
  for (const key of TOKEN_KEYS) {
    assert.equal(pure[key].light, normal[key].light, `pureBlackDark must not alter light ${key}`);
  }
  assert.deepEqual(parseCss(pure['--dsw-alias-bg-base'].dark).rgb, [0, 0, 0]);
  assert.deepEqual(parseCss(pure['--dsw-alias-bg-layer-1'].dark).rgb, [14, 14, 16]);
  assert.deepEqual(parseCss(pure['--dsw-alias-bg-layer-2'].dark).rgb, [19, 19, 21]);
  assert.deepEqual(parseCss(pure['--dsw-specific-sidebar-fill'].dark).rgb, [30, 30, 31]);
  assert.deepEqual(parseCss(pure['--dsw-alias-bg-layer-3'].dark).rgb, [40, 39, 41]);
  for (const mode of MODES) {
    const tokens = makeTokens([22, 144, 187], 75, mode, 'high-contrast', { pureBlackDark: true });
    assert.deepEqual(parseCss(tokens['--dsw-alias-bg-base'].dark).rgb, [0, 0, 0], `${mode} dark base is #000000`);
    assertAccessible(tokens, 75, `${mode} pureBlackDark high-contrast`, true);
  }
});

test('custom grayscale candidates stay neutral through the DSH role mapping', () => {
  const candidates = Array.from({ length: 5 }, () => [128, 128, 128]);
  for (const mode of ['vibrant', 'faithful', 'soft', 'dysfunctional', 'muted']) {
    const tokens = makeTokens(candidates, 28, mode);
    for (const scheme of SCHEMES) for (const key of ['--dsw-alias-brand-primary', ...SURFACES, '--dsw-alias-interactive-bg-active']) {
      const rgb = parseCss(tokens[key][scheme]).rgb;
      assert.ok(Math.max(...rgb) - Math.min(...rgb) <= 1, `${mode} ${scheme} ${key}: ${rgb}`);
    }
  }
});

test('muted stays subdued after accessibility adjustment without becoming monochrome', () => {
  let hasTint = false;
  for (const accent of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [22, 144, 187]]) {
    const tokens = makeTokens(accent, 28, 'muted');
    const vibrant = makeTokens(accent, 28, 'vibrant');
    for (const scheme of SCHEMES) {
      for (const key of ['--dsw-alias-brand-primary', ...SURFACES]) {
        const rgb = parseCss(tokens[key][scheme]).rgb;
        const chroma = Hct.fromInt(argbFromRgb(...rgb)).chroma;
        const maximum = key === '--dsw-alias-brand-primary' ? 32 : 12;
        assert.ok(chroma <= maximum, `muted ${key} ${scheme}: low HCT chroma, got ${chroma}`);
        const colorful = parseCss(vibrant[key][scheme]).rgb;
        assert.ok(chroma < Hct.fromInt(argbFromRgb(...colorful)).chroma, `${key} ${scheme}: muted is less colorful than vibrant`);
        if (key === '--dsw-alias-brand-primary' && Math.max(...rgb) - Math.min(...rgb) > 3) hasTint = true;
      }
    }
  }
  assert.ok(hasTint, 'muted must retain a subtle accent instead of being renamed monochrome');
});

test('all modes retain accessible text and accents on panels in high-contrast mode', () => {
  // Sweep the full hue wheel, not just the screenshot source colour.
  for (const mode of MODES) for (let hue = 0; hue < 360; hue += 10) {
    const accent = hslToRgb([hue, 90, 50]);
    for (const strength of STRENGTHS) {
      assertAccessible(makeTokens(accent, strength, mode, 'high-contrast'), strength, `${mode} hue=${hue} strength=${strength}`);
    }
  }
  for (const mode of MODES) for (const accent of [[0, 0, 0], [255, 255, 255], [150, 150, 150]]) {
    for (const strength of STRENGTHS) assertAccessible(makeTokens(accent, strength, mode, 'high-contrast'), strength, `${mode} rgb=${accent} strength=${strength}`);
  }
});

test('base alpha changes by one percentage point per step of wallpaper visibility', () => {
  for (const mode of MODES) {
    let previous = { light: Infinity, dark: Infinity };
    for (let strength = 10; strength <= 100; strength++) {
      const tokens = makeTokens([20, 130, 180], strength, mode);
      for (const scheme of SCHEMES) {
        const alpha = parseCss(tokens['--dsw-alias-bg-base'][scheme]).alpha;
        assert.equal(alpha, (100 - strength) / 100, `${mode} ${scheme} strength=${strength}: linear alpha`);
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
    for (const textMode of TEXT_COLOR_MODES) {
      const tokens = makeTokens([20, 130, 180], input, mode, textMode);
      validTokens(tokens, `${mode} ${textMode} malformed strength=${String(input)}`);
      assert.deepEqual(tokens, makeTokens([20, 130, 180], expected, mode, textMode), `${mode} ${textMode}: strength ${String(input)} normalizes to ${expected}`);
      if (textMode === 'high-contrast') assertAccessible(tokens, expected, `${mode} normalized strength=${expected}`);
    }
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
        for (const textMode of TEXT_COLOR_MODES) {
          const tokens = makeTokens(accent, strength, mode, textMode);
          validTokens(tokens, `${mode} ${textMode} invalid accent=${String(accent)} strength=${strength}`);
          if (textMode === 'high-contrast') assertAccessible(tokens, strength, `${mode} sanitized accent=${String(accent)} strength=${strength}`);
        }
      }
    }
  }
});

test('theme mode visibly tints primary, secondary and tertiary text toward the subject hue', () => {
  const spread = rgb => Math.max(...rgb) - Math.min(...rgb);
  const chroma = rgb => Hct.fromInt(argbFromRgb(...rgb)).chroma;
  for (const mode of MODES.filter(name => name !== 'monochrome')) {
    const cool = makeTokens([22, 144, 187], 75, mode, 'theme');
    const warm = makeTokens([255, 128, 0], 75, mode, 'theme');
    for (const scheme of SCHEMES) {
      for (const key of ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary']) {
        const coolRgb = parseCss(cool[key][scheme]).rgb;
        const warmRgb = parseCss(warm[key][scheme]).rgb;
        assert.notDeepEqual(coolRgb, warmRgb, `${mode} ${scheme} ${key} distinguishes cool vs warm wallpapers`);
        assert.ok(coolRgb[2] > coolRgb[0], `${mode} ${scheme} ${key} cool text retains blue bias: ${coolRgb}`);
        assert.ok(warmRgb[0] > warmRgb[2], `${mode} ${scheme} ${key} warm text retains warm bias: ${warmRgb}`);
        assert.ok(spread(coolRgb) >= (mode === 'muted' ? 8 : 16), `${mode} ${scheme} ${key} cool tint spread: ${coolRgb}`);
        assert.ok(spread(warmRgb) >= (mode === 'muted' ? 10 : 18), `${mode} ${scheme} ${key} warm tint spread: ${warmRgb}`);
      }
    }
  }
  const vibrant = makeTokens([22, 144, 187], 75, 'vibrant', 'theme');
  const muted = makeTokens([22, 144, 187], 75, 'muted', 'theme');
  for (const scheme of SCHEMES) {
    assert.ok(chroma(parseCss(muted['--dsw-alias-label-primary'][scheme]).rgb)
      < chroma(parseCss(vibrant['--dsw-alias-label-primary'][scheme]).rgb));
    const gray = makeTokens([[128, 128, 128]], 75, 'vibrant', 'theme');
    for (const key of ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary']) {
      assert.ok(spread(parseCss(gray[key][scheme]).rgb) <= 1, `grayscale vibrant ${scheme} ${key} stays neutral`);
    }
  }
});
