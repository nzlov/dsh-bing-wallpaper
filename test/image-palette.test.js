import test from 'node:test';
import assert from 'node:assert/strict';
import { extractImagePalettes } from '../src/client/theme/image-palette.js';

const PIXELS = 112 * 112;
const M3 = ['content', 'tonal-spot', 'fruit-salad', 'rainbow', 'monochrome'];
const CUSTOM = ['vibrant', 'faithful', 'soft', 'dysfunctional', 'muted'];
const MODES = [...M3, ...CUSTOM];
const RED = [255, 0, 0], BLUE = [60, 100, 160], GRAY = [128, 128, 128];

function image(pixelAt) {
  const pixels = new Uint8ClampedArray(PIXELS * 4);
  for (let i = 0; i < PIXELS; i++) pixels.set(pixelAt(i), i * 4);
  return pixels;
}

function blocks(regions) {
  const ends = [];
  let total = 0;
  for (const [count, color] of regions) ends.push([total += count, color]);
  assert.equal(total, PIXELS / 16);
  return image(i => [...ends.find(([end]) => Math.floor(i / 16) < end)[1], 255]);
}

function validPalettes(palettes) {
  assert.deepEqual(Object.keys(palettes), MODES);
  for (const mode of MODES) {
    assert.equal(palettes[mode].length, M3.includes(mode) ? 1 : 5, mode);
    for (const rgb of palettes[mode]) {
      assert.equal(rgb.length, 3, mode);
      for (const channel of rgb) assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255, `${mode}: ${rgb}`);
    }
  }
}

test('requires the documented RGBA size and type', () => {
  assert.throws(() => extractImagePalettes(null), TypeError);
  assert.throws(() => extractImagePalettes(new Uint8Array(PIXELS * 4)), TypeError);
  assert.throws(() => extractImagePalettes(new Uint8ClampedArray(PIXELS * 4 - 1)), TypeError);
});

test('all modes return safe independent RGB arrays and do not alter the input', () => {
  const pixels = blocks([[353, GRAY], [274, BLUE], [157, RED]]);
  const original = pixels.slice();
  const palettes = extractImagePalettes(pixels);
  validPalettes(palettes);
  assert.deepEqual(pixels, original);
  for (const mode of M3) assert.deepEqual(palettes[mode], palettes.content);
  assert.deepEqual(palettes.faithful, palettes.soft);
  palettes.content[0][0] = -1;
  palettes.faithful[0][0] = -1;
  assert.notEqual(palettes.monochrome[0][0], -1);
  assert.notEqual(palettes.soft[0][0], -1);
});

test('vibrant, faithful, dysfunctional, and muted use distinct scoring priorities', () => {
  const palettes = extractImagePalettes(blocks([[353, GRAY], [274, BLUE], [157, RED]]));
  assert.deepEqual(palettes.muted[0], GRAY, 'muted chooses the most common cluster, including gray');
  assert.deepEqual(palettes.faithful[0], BLUE, 'faithful prefers the largest colorful family');
  assert.deepEqual(palettes.soft, palettes.faithful, 'soft uses faithful source selection');
  assert.deepEqual(palettes.dysfunctional[0], RED, 'dysfunctional favors a distant colorful family');
  assert.deepEqual(palettes.vibrant[0], RED, 'vibrant favors chroma over raw population');
});

test('faithful totals color families rather than choosing the biggest individual cluster', () => {
  const darkRed = [190, 20, 20], brightRed = [255, 30, 30], blue = [60, 100, 180];
  const palettes = extractImagePalettes(blocks([[185, darkRed], [185, brightRed], [294, blue], [120, GRAY]]));
  assert.deepEqual(palettes.muted[0], blue);
  assert.ok([darkRed, brightRed].some(rgb => rgb.every((value, i) => value === palettes.faithful[0][i])));
  assert.deepEqual(palettes.dysfunctional[0], blue);
});

test('transparent pixel RGB is ignored and alpha threshold is consistent', () => {
  const makeImage = hidden => image(i => {
    if (i % 4 === 0) return [...BLUE, 200];
    if (i % 16 === 1) return [...RED, 255];
    return [...hidden, i % 2 ? 0 : 199];
  });
  const palettes = extractImagePalettes(makeImage([255, 255, 0]));
  assert.deepEqual(palettes, extractImagePalettes(makeImage([0, 255, 255])));
  assert.deepEqual(palettes.muted[0], BLUE);
  assert.deepEqual(palettes.faithful[0], BLUE);
});

test('custom sampling does not miss a vertical stripe between the old fixed columns', () => {
  const pixels = image(i => {
    const x = i % 112;
    return [...(x >= 1 && x <= 15 ? RED : BLUE), 255];
  });
  const palettes = extractImagePalettes(pixels);
  for (const mode of ['vibrant', 'faithful', 'soft', 'dysfunctional']) {
    assert.ok(palettes[mode].some(rgb => rgb.every((value, i) => value === RED[i])), `${mode} sees the red stripe`);
  }
});

test('empty and low-chroma images have documented deterministic fallbacks', () => {
  const transparent = extractImagePalettes(image(() => [255, 0, 0, 0]));
  validPalettes(transparent);
  for (const mode of M3) assert.deepEqual(transparent[mode], [[66, 133, 244]]);
  for (const mode of CUSTOM) assert.deepEqual(transparent[mode][0], [103, 80, 164]);
  assert.equal(new Set(transparent.vibrant.map(rgb => rgb.join(','))).size, 5);

  const gray = extractImagePalettes(image(() => [...GRAY, 255]));
  for (const mode of M3) assert.deepEqual(gray[mode], [[66, 133, 244]]);
  for (const mode of CUSTOM) assert.deepEqual(gray[mode], Array.from({ length: 5 }, () => GRAY));
});

test('sparse visible pixels still contribute when all fixed sample positions are transparent', () => {
  const pixels = image(i => i === 1 ? [...RED, 255] : [0, 255, 0, 0]);
  const palettes = extractImagePalettes(pixels);
  for (const mode of M3) assert.deepEqual(palettes[mode], [RED]);
  for (const mode of CUSTOM) assert.deepEqual(palettes[mode][0], RED);
  assert.deepEqual(palettes.faithful.slice(0, 3), [[255, 0, 0], [255, 255, 0], [0, 255, 0]]);
});

test('complex inputs are deterministic across resolutions without consulting global randomness', () => {
  const pixels = image(i => [(i * 17) % 256, (i * 31 + Math.floor(i / 67)) % 256, (i * 53 + Math.floor(i / 23)) % 256, 255]);
  const original = Math.random;
  const rejectRandomness = () => { throw new Error('randomness used'); };
  try {
    Math.random = rejectRandomness;
    const first = extractImagePalettes(pixels);
    assert.equal(Math.random, rejectRandomness);
    validPalettes(first);
    assert.deepEqual(extractImagePalettes(pixels), first);
    const wide = new Uint8ClampedArray(256 * 144 * 4);
    for (let i = 0; i < 256 * 144; i++) wide.set([(i * 13) % 256, (i * 29) % 256, (i * 47) % 256, 255], i * 4);
    validPalettes(extractImagePalettes(wide, 256, 144));
    assert.throws(() => extractImagePalettes(wide), TypeError);
    assert.equal(Math.random, rejectRandomness);
  } finally {
    Math.random = original;
  }
});
