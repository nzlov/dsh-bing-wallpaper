import test from 'node:test';
import assert from 'node:assert/strict';
import { redFromArgb, greenFromArgb, blueFromArgb } from '@material/material-color-utilities';
import { makeCustomSchemes } from '../src/client/theme/custom-palette.js';

const MODES = ['vibrant', 'faithful', 'soft', 'dysfunctional', 'muted'];
const ROLES = [
  'surface', 'surfaceVariant', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh',
  'outlineVariant', 'outline', 'primary', 'secondary', 'tertiary', 'primaryContainer',
  'secondaryContainer', 'tertiaryContainer', 'onSurface', 'onSurfaceVariant', 'error',
];
const PALETTES = ['primaryPalette', 'neutralPalette', 'neutralVariantPalette'];
const SOURCES = [
  [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 210, 255],
  [22, 144, 187], [150, 150, 150], [0, 0, 0], [255, 255, 255], [101, 55, 177],
];
const rgb = argb => [redFromArgb(argb), greenFromArgb(argb), blueFromArgb(argb)];
const validArgb = argb => Number.isInteger(argb) && argb >= 0 && argb <= 0xffffffff && argb >>> 24 === 255;

function hsl(argb) {
  const [r, g, b] = rgb(argb).map(value => value / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, l = (max + min) / 2;
  if (!delta) return [0, 0, l];
  const hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [((hue * 60) + 360) % 360, delta / (1 - Math.abs(2 * l - 1)), l];
}

function ratio(a, b) {
  const luminance = argb => rgb(argb).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const snapshot = schemes => schemes.map(scheme => ({
  roles: ROLES.map(role => scheme[role]),
  tones: PALETTES.map(palette => [0, 25, 50, 75, 100].map(tone => scheme[palette].tone(tone))),
}));

test('all modes supply light and dark ARGB roles and accessible tonal palettes', () => {
  for (const mode of MODES) {
    for (const source of SOURCES) {
      const schemes = makeCustomSchemes([source], mode);
      assert.equal(schemes.length, 2);
      for (const [index, scheme] of schemes.entries()) {
        const context = `${mode} ${source} ${index ? 'dark' : 'light'}`;
        for (const role of ROLES) assert.ok(validArgb(scheme[role]), `${context}: ${role}`);
        for (const palette of PALETTES) {
          assert.equal(typeof scheme[palette].tone, 'function', `${context}: ${palette}`);
          for (const tone of [0, 25, 50, 75, 100]) {
            assert.ok(validArgb(scheme[palette].tone(tone)), `${context}: ${palette} ${tone}`);
          }
        }
        assert.ok(ratio(scheme.onSurface, scheme.surface) >= 4.5, `${context}: onSurface`);
        assert.ok(ratio(scheme.onSurfaceVariant, scheme.surfaceVariant) >= 4.5, `${context}: onSurfaceVariant`);
        assert.ok(ratio(scheme.outline, scheme.surface) >= 3, `${context}: outline`);
        assert.ok(ratio(scheme.outlineVariant, scheme.surface) >= 3, `${context}: outlineVariant`);
        const ladder = ['surface', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh']
          .map(role => hsl(scheme[role])[2]);
        for (let i = 1; i < ladder.length; i++) {
          assert.ok(index ? ladder[i] > ladder[i - 1] : ladder[i] < ladder[i - 1], `${context}: ${ladder}`);
        }
      }
      assert.ok(hsl(schemes[0].surface)[2] > hsl(schemes[1].surface)[2], `${mode}: light/dark surface`);
    }
  }
});

test('normal modes share role formulas while Soft and Muted cap saturation', () => {
  const candidates = [[40, 120, 220], [220, 45, 45], [60, 190, 70]];
  const vibrant = makeCustomSchemes(candidates, 'vibrant');
  const faithful = makeCustomSchemes(candidates, 'faithful');
  const dysfunctional = makeCustomSchemes(candidates, 'dysfunctional');
  const soft = makeCustomSchemes(candidates, 'soft');
  const muted = makeCustomSchemes(candidates, 'muted');
  assert.deepEqual(snapshot(vibrant), snapshot(faithful));
  assert.deepEqual(snapshot(vibrant), snapshot(dysfunctional));
  assert.notDeepEqual(snapshot(soft), snapshot(faithful));
  assert.notDeepEqual(snapshot(muted), snapshot(soft));
  for (let i = 0; i < 2; i++) {
    assert.ok(hsl(vibrant[i].primary)[1] > hsl(soft[i].primary)[1]);
    assert.ok(hsl(soft[i].primary)[1] <= 0.56);
    assert.ok(hsl(muted[i].primary)[1] <= 0.16);
    assert.ok(hsl(muted[i].secondary)[1] <= 0.13);
    assert.ok(hsl(muted[i].tertiary)[1] <= 0.11);
  }
});

test('grayscale and near-grayscale source colors do not acquire an invented red accent', () => {
  for (const mode of MODES) for (const source of [[128, 128, 128], [129, 128, 127]]) {
    for (const scheme of makeCustomSchemes([source], mode)) {
      for (const role of ['primary', 'secondary', 'tertiary', 'primaryContainer', 'secondaryContainer', 'tertiaryContainer', 'surface', 'surfaceContainer', 'onSurface']) {
        const channels = rgb(scheme[role]);
        assert.ok(Math.max(...channels) - Math.min(...channels) <= 1, `${mode} ${source} ${role}: ${channels}`);
      }
    }
  }
});

test('candidate order is preserved and distinct secondary and tertiary colors are used', () => {
  const candidates = [[220, 50, 50], [50, 220, 50], [50, 50, 220]];
  for (const mode of MODES.filter(name => name !== 'muted')) {
    for (const scheme of makeCustomSchemes(candidates, mode)) {
      assert.ok(hueDistance(hsl(scheme.primary)[0], 0) < 2, `${mode} primary`);
      assert.ok(hueDistance(hsl(scheme.secondary)[0], 120) < 2, `${mode} secondary`);
      assert.ok(hueDistance(hsl(scheme.tertiary)[0], 240) < 2, `${mode} tertiary`);
      assert.ok(hueDistance(hsl(scheme.secondaryContainer)[0], 120) < 2, `${mode} secondary container`);
      assert.ok(hueDistance(hsl(scheme.tertiaryContainer)[0], 240) < 2, `${mode} tertiary container`);
    }
    const reordered = makeCustomSchemes([candidates[1], candidates[0], candidates[2]], mode);
    assert.ok(hueDistance(hsl(reordered[0].primary)[0], 120) < 2, `${mode} respects upstream ranking`);
  }
});

test('nearby candidates are skipped before hue rotations; Muted rotates the primary only', () => {
  const red = [220, 50, 50], nearRed = [220, 70, 50], green = [50, 220, 50];
  for (const mode of ['vibrant', 'faithful', 'soft', 'dysfunctional']) {
    const [scheme] = makeCustomSchemes([red, nearRed, green], mode);
    assert.ok(hueDistance(hsl(scheme.secondary)[0], 120) < 2, `${mode} skips the nearby candidate`);
    assert.ok(hueDistance(hsl(scheme.tertiary)[0], 60) < 2, `${mode} fallback tertiary`);
    const [later] = makeCustomSchemes([red, nearRed, nearRed, green, [50, 50, 220]], mode);
    assert.ok(hueDistance(hsl(later.secondary)[0], 120) < 2, `${mode} uses a fourth candidate`);
    assert.ok(hueDistance(hsl(later.tertiary)[0], 240) < 2, `${mode} uses a fifth candidate`);
    const [fallback] = makeCustomSchemes([red, green, green], mode);
    assert.ok(hueDistance(hsl(fallback.tertiary)[0], 60) < 2, `${mode} fallback tertiary`);
  }
  const [muted] = makeCustomSchemes([red, green, [50, 50, 220]], 'muted');
  assert.ok(hueDistance(hsl(muted.secondary)[0], 15) < 3);
  assert.ok(hueDistance(hsl(muted.tertiary)[0], 30) < 3);
  const [single] = makeCustomSchemes([red], 'muted');
  for (const role of ['primary', 'secondary', 'tertiary', 'surface', 'secondaryContainer', 'tertiaryContainer']) {
    assert.equal(muted[role], single[role], `Muted ${role} ignores other candidates`);
  }
});

test('invalid input falls back deterministically without mutating the caller', () => {
  const reference = snapshot(makeCustomSchemes([[103, 80, 164]], 'faithful'));
  for (const candidates of [undefined, null, [], [[NaN, 1, 2]], [[1, 2]], [[1, , 2]], [[Infinity, 0, 0]]]) {
    assert.deepEqual(snapshot(makeCustomSchemes(candidates, 'faithful')), reference);
  }
  assert.deepEqual(snapshot(makeCustomSchemes([], 'unknown')), reference);
  const candidates = [[-10, 127.5, 400], [NaN, 2, 3], [200, 40, 40]];
  const before = structuredClone(candidates);
  const result = snapshot(makeCustomSchemes(candidates, 'soft'));
  assert.deepEqual(candidates, before);
  assert.deepEqual(result, snapshot(makeCustomSchemes([[0, 128, 255], [200, 40, 40]], 'soft')));
  assert.deepEqual(result, snapshot(makeCustomSchemes(candidates, 'soft')));
});

test('error is a color role selected separately from the accent containers', () => {
  const red = [220, 40, 50];
  for (const scheme of makeCustomSchemes([[40, 80, 220], red], 'faithful')) {
    assert.deepEqual(rgb(scheme.error), red);
  }
  for (const scheme of makeCustomSchemes([[40, 80, 220]], 'faithful')) {
    assert.deepEqual(rgb(scheme.error), [253, 70, 99]);
  }
});
