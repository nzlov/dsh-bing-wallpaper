/*!
 * Custom image palette extraction adapted from Noctalia's custom_schemes.cpp
 * (commit 0e32beeeb3d3fedb6d1da720abcfe6fe4f4fad75).
 * Copyright (c) 2026 noctalia-dev
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import {
  Hct, QuantizerWu, Score, argbFromLab, argbFromRgb, labFromArgb,
  redFromArgb, greenFromArgb, blueFromArgb,
} from '@material/material-color-utilities';

const PIXEL_COUNT = 112 * 112;
const MATERIAL_FALLBACK = 0xff4285f4;
const CUSTOM_FALLBACK = 0xff6750a4;
const MIN_ALPHA = 200;

const rgbFromArgb = argb => [redFromArgb(argb), greenFromArgb(argb), blueFromArgb(argb)];
const squaredDistance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function histogram(pixels, dataFor) {
  const counts = new Map();
  for (const argb of pixels) counts.set(argb, (counts.get(argb) || 0) + 1);
  return [...counts].map(([argb, count]) => ({ ...dataFor(argb), count }));
}

// Weighted identical pixels are equivalent to separate points. Keeping their
// first-seen order also makes representative and equal-distance ties stable.
function cluster(points, initialCenters) {
  const centers = initialCenters.map(lab => [...lab]);
  const assignments = new Int32Array(points.length).fill(-1);
  let totals = [];
  for (let iteration = 0; iteration < 10; iteration++) {
    totals = centers.map(() => [0, 0, 0, 0]);
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      let best = 0, distance = Infinity;
      for (let j = 0; j < centers.length; j++) {
        const d = squaredDistance(point.lab, centers[j]);
        if (d < distance) { distance = d; best = j; }
      }
      if (assignments[i] !== best) changed = true;
      assignments[i] = best;
      const total = totals[best], weight = point.count;
      total[0] += point.lab[0] * weight;
      total[1] += point.lab[1] * weight;
      total[2] += point.lab[2] * weight;
      total[3] += weight;
    }
    for (let j = 0; j < centers.length; j++) {
      const total = totals[j];
      if (total[3]) centers[j] = [total[0] / total[3], total[1] / total[3], total[2] / total[3]];
    }
    if (!changed) break;
  }
  const representatives = centers.map(() => ({ argb: 0, distance: Infinity }));
  for (let i = 0; i < points.length; i++) {
    const j = assignments[i], distance = squaredDistance(points[i].lab, centers[j]);
    if (distance < representatives[j].distance) representatives[j] = { argb: points[i].argb, distance };
  }
  return totals.flatMap((total, i) => total[3] ? [{
    centroid: argbFromLab(...centers[i]), representative: representatives[i].argb, count: total[3],
  }] : []).sort((a, b) => b.count - a.count);
}

function customClusters(sampled, count, dataFor) {
  if (!sampled.length) return [];
  // Noctalia initializes evenly along a stable lightness sort of the samples.
  const sorted = sampled.map(dataFor).sort((a, b) => a.lab[0] - b.lab[0]);
  const k = Math.min(count, sorted.length), step = Math.floor(sorted.length / k);
  const centers = Array.from({ length: k }, (_, i) => sorted[i * step].lab);
  return cluster(histogram(sampled, dataFor), centers);
}

function materialSeed(opaque, dataFor) {
  if (!opaque.length) return MATERIAL_FALLBACK;
  // MCU Celebi 0.3.0 uses unseeded Math.random internally. Wu plus bounded,
  // deterministic Lab refinement is a close alternative without changing the
  // host's global RNG; it is not Matugen/Noctalia byte-for-byte quantization.
  const seeds = new QuantizerWu().quantize(opaque, 128).map(argb => dataFor(argb).lab);
  const populations = new Map();
  for (const { centroid, count } of cluster(histogram(opaque, dataFor), seeds)) {
    // Noctalia drops very low-chroma clusters before scoring; Score's own
    // filtering can also fall back to Google Blue for unsuitable images.
    if (Hct.fromInt(centroid).chroma >= 5) {
      populations.set(centroid, (populations.get(centroid) || 0) + count);
    }
  }
  return Score.score(populations, { desired: 4, fallbackColorARGB: MATERIAL_FALLBACK, filter: true })[0];
}

function familyFor(hue) {
  if (hue >= 330 || hue < 30) return 0;
  if (hue < 60) return 1;
  if (hue < 105) return 2;
  if (hue < 190) return 3;
  if (hue < 270) return 4;
  return 5;
}

function familyRanking(entries, dysfunctional) {
  const families = Array.from({ length: 6 }, (_, family) => ({ family, entries: [], count: 0 }));
  for (const entry of entries) {
    if (entry.hct.chroma < 10) continue;
    const family = families[familyFor(entry.hct.hue)];
    family.entries.push(entry);
    family.count += entry.count;
  }
  const present = families.filter(family => family.count).sort((a, b) => b.count - a.count || a.family - b.family);
  if (!present.length) return [...entries].sort((a, b) => b.count - a.count);
  if (!dysfunctional) {
    return present.flatMap(family => family.entries.sort((a, b) => b.count - a.count || b.hct.chroma - a.hct.chroma));
  }
  const centers = [0, 45, 82.5, 147.5, 230, 300];
  const total = present.reduce((sum, family) => sum + family.count, 0);
  const dominant = present[0], distant = [], close = [dominant];
  for (const family of present.slice(1)) {
    const difference = Math.abs(centers[dominant.family] - centers[family.family]);
    const distance = Math.min(difference, 360 - difference);
    if (distance >= 45 && family.count >= total * .02) {
      const maxChroma = Math.max(...family.entries.map(entry => entry.hct.chroma));
      distant.push({ ...family, rank: distance * maxChroma });
    } else {
      close.push(family);
    }
  }
  distant.sort((a, b) => b.rank - a.rank || a.family - b.family);
  const byChroma = (a, b) => b.hct.chroma - a.hct.chroma || b.count - a.count;
  const byCount = (a, b) => b.count - a.count || b.hct.chroma - a.hct.chroma;
  // Distant families outrank nearby ones; within each group preserve the
  // reference's chroma/count priorities with deterministic family ties.
  return [
    ...distant.flatMap(family => family.entries.sort(byChroma)),
    ...close.flatMap(family => family.entries).sort(byCount),
  ];
}

function vibrantRanking(entries) {
  return [...entries].sort((a, b) => {
    const score = ({ hct, count }) => {
      const { chroma, hue, tone } = hct;
      let penalty = 0;
      if (tone < 20) penalty = (20 - tone) * 2;
      else if (tone > 80) penalty = (tone - 80) * 1.5;
      else if (tone < 40) penalty = (40 - tone) * .5;
      else if (tone > 60) penalty = (tone - 60) * .3;
      if (hue > 80 && hue < 110) penalty += 5;
      return (chroma - penalty) * count ** .3;
    };
    return score(b) - score(a);
  });
}

// Missing custom candidates rotate the primary in HSL, as in Noctalia.
// Grays stay gray rather than gaining an invented hue.
function rotateHue(argb, degrees) {
  const [r, g, b] = rgbFromArgb(argb).map(value => value / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const lightness = (max + min) / 2;
  if (!delta) return argb;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + degrees + 360) % 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)), m = lightness - chroma / 2;
  const channels = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x]
    : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return argbFromRgb(...channels.map(value => Math.round((value + m) * 255)));
}

function finishPalette(entries) {
  const colors = entries.slice(0, 5).map(entry => entry.argb);
  if (!colors.length) colors.push(CUSTOM_FALLBACK);
  while (colors.length < 5) colors.push(rotateHue(colors[0], colors.length * 60));
  return colors.map(rgbFromArgb);
}

/**
 * Extract seeds for all modes from a 112x112 RGBA Canvas pixel buffer.
 * Alpha below 200 is ignored; a completely transparent image uses stable
 * Material/Noctalia fallback colors. Canvas resizing is the caller's job.
 */
export function extractImagePalettes(pixels) {
  if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== PIXEL_COUNT * 4) {
    throw new TypeError('Expected a 112x112 RGBA Uint8ClampedArray');
  }
  const opaque = [], sampled = [], cache = new Map();
  const dataFor = argb => {
    if (!cache.has(argb)) cache.set(argb, { argb, lab: labFromArgb(argb) });
    return cache.get(argb);
  };
  const hctFor = argb => {
    const data = dataFor(argb);
    return data.hct ||= Hct.fromInt(argb);
  };
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < MIN_ALPHA) continue;
    const argb = argbFromRgb(pixels[i], pixels[i + 1], pixels[i + 2]);
    opaque.push(argb);
    const pixel = i / 4, x = pixel % 112, y = Math.floor(pixel / 112);
    // Vary the sampled columns by row: a fixed 16-pixel stride on a 112px
    // canvas repeatedly misses the same 15 out of every 16 vertical columns.
    if ((x + y) % 16 === 0) sampled.push(argb);
  }
  // Sparse transparency can hide every fixed-position sample. Preserve the
  // visible colors in that case without allowing transparent RGB to leak in.
  if (!sampled.length) for (let i = 0; i < opaque.length; i += 16) sampled.push(opaque[i]);
  const seed = materialSeed(opaque, dataFor);
  const withHct = (argb, count) => ({ argb, count, hct: hctFor(argb) });
  const colorful = sampled.filter(argb => hctFor(argb).chroma >= 5);
  const vibrantInput = colorful.length >= 40 ? colorful : sampled;
  const vibrant = customClusters(vibrantInput, 20, dataFor).map(c => withHct(c.centroid, c.count));
  const shared = customClusters(sampled, 48, dataFor).map(c => withHct(c.representative, c.count));
  const muted = customClusters(sampled, 24, dataFor).map(c => withHct(c.representative, c.count));
  return {
    content: [rgbFromArgb(seed)],
    'tonal-spot': [rgbFromArgb(seed)],
    'fruit-salad': [rgbFromArgb(seed)],
    rainbow: [rgbFromArgb(seed)],
    monochrome: [rgbFromArgb(seed)],
    vibrant: finishPalette(vibrantRanking(vibrant)),
    faithful: finishPalette(familyRanking(shared, false)),
    soft: finishPalette(familyRanking(shared, false)),
    dysfunctional: finishPalette(familyRanking(shared, true)),
    muted: finishPalette(muted),
  };
}
