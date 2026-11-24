import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherEngine } from '../precipitation.js';
import { weatherBackdrop } from '../weather-backdrop.js';
import { weatherLooks } from '../weather-effects.js';

test('disabled weather leaves the wallpaper canvas untouched', () => {
  let calls = 0;
  const canvas = {
    getContext() { calls++; return null; },
  };
  assert.equal(createWeatherEngine({}, canvas, null, 'off', null, 'south'), null);
  assert.equal(calls, 0);
});

test('unavailable WebGL2 leaves the static wallpaper and never starts a CPU renderer', () => {
  const contexts = [];
  const canvas = {
    getContext(type) {
      contexts.push(type);
      return null;
    },
  };
  const document = {
    defaultView: {
      requestAnimationFrame() { assert.fail('unavailable WebGL2 should leave the static wallpaper'); },
    },
  };
  assert.equal(createWeatherEngine(document, canvas, weatherLooks.heavyRain, 'heavyRain', null, 'south'), null);
  assert.deepEqual(contexts, ['webgl2']);
});

const tokens = {
  '--dsw-alias-bg-base': { light: 'rgba(255, 255, 255, 0.9)', dark: 'rgba(0, 0, 0, 0.9)' },
  '--dsw-specific-sidebar-fill': { light: 'rgb(204, 204, 204)', dark: 'rgb(51, 51, 51)' },
};

function assertBackdrop(actual, photo, matte) {
  assert.ok(Math.abs(actual.photo - photo) < 1e-8, `photo weight: ${actual.photo}, expected ${photo}`);
  assert.ok(Math.abs(actual.matte - matte) < 1e-8, `matte brightness: ${actual.matte}, expected ${matte}`);
}

test('weather uses the active scheme and each pane’s visibility and theme tint', () => {
  const prefs = {
    strength: 10,
    leftSidebar: { tint: true },
    rightSidebar: { visibilityMode: 'custom', visibility: 70, tint: false },
  };
  for (const [scheme, base, sidebar] of [['light', 1, .8], ['dark', 0, .2]]) {
    const { main, left, right } = weatherBackdrop(prefs, tokens, scheme);
    assertBackdrop(main, .1, base * .9);
    assertBackdrop(left, .04, sidebar * .96);
    assertBackdrop(right, .7, sidebar * .3);
  }
});

test('weather combines the actual photo filters with the visibility matte', () => {
  const prefs = {
    strength: 50,
    filterMode: 'blue', filterAmounts: { blue: 25 },
    leftSidebar: { background: 'theme' },
    rightSidebar: { filterMode: 'frosted', filterAmounts: { frosted: 12 }, tint: false },
  };
  const { main, left, right } = weatherBackdrop(prefs, tokens, 'light');
  const blue = (.2126 * 48 + .7152 * 110 + .0722 * 246) / 255;
  assertBackdrop(main, .375, .5 + .125 * blue);
  assertBackdrop(left, 0, .8);
  assertBackdrop(right, .455, .445);

  const dimmed = { ...prefs, filterMode: 'dim', filterAmounts: { dim: 60 }, rightSidebar: { tint: false } };
  const inherited = weatherBackdrop(dimmed, tokens, 'light');
  assertBackdrop(inherited.main, .2, .5);
  assertBackdrop(inherited.right, .2, .4);

  for (const filterMode of ['blur', 'grayscale']) {
    assertBackdrop(weatherBackdrop({ ...prefs, filterMode }, tokens, 'light').main, .5, .5);
  }
});
