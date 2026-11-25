/*!
 * Image palette extraction aligned with Noctalia's image_loader.cpp,
 * m3_schemes.cpp and custom_schemes.cpp.
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
  Hct, QuantizerWu, argbFromLab, argbFromRgb, labFromArgb,
  redFromArgb, greenFromArgb, blueFromArgb,
} from '@material/material-color-utilities';

const TARGET_SIZE = 112;
const MATERIAL_FALLBACK = 0xff4285f4;
const CUSTOM_FALLBACK = 0xff6750a4;
const MIN_ALPHA = 200;

const f32 = Math.fround;
const rgbFromArgb = argb => [redFromArgb(argb), greenFromArgb(argb), blueFromArgb(argb)];
const squaredDistance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const sanitizeDegreesInt = degrees => ((degrees % 360) + 360) % 360;
const diffDegrees = (a, b) => 180 - Math.abs(Math.abs(a - b) - 180);
const toU8 = value => Math.floor(Math.min(255, Math.max(0, value)) + 0.5);

function triangleKernel(x) {
  x = x < 0 ? -x : x;
  return x < 1 ? f32(1 - x) : 0;
}

// Separable Triangle filter matching Noctalia's image_loader.cpp / Rust image crate.
function triangleResize(src, srcW, srcH, dstW, dstH) {
  const tmp = new Float32Array(srcW * dstH * 4);
  const ratioY = f32(srcH / dstH), sratioY = ratioY < 1 ? 1 : ratioY, supportY = sratioY;
  for (let outy = 0; outy < dstH; outy++) {
    const inputyOrig = f32(f32(outy + 0.5) * ratioY);
    const left = Math.min(srcH - 1, Math.max(0, Math.floor(f32(inputyOrig - supportY))));
    const right = Math.min(srcH, Math.max(left + 1, Math.ceil(f32(inputyOrig + supportY))));
    const inputy = f32(inputyOrig - 0.5);
    const count = right - left;
    const weights = new Float32Array(count);
    let sum = 0;
    for (let k = 0; k < count; k++) {
      const w = triangleKernel(f32(f32((left + k) - inputy) / sratioY));
      weights[k] = w;
      sum = f32(sum + w);
    }
    for (let k = 0; k < count; k++) weights[k] = f32(weights[k] / sum);
    const rowDst = outy * srcW * 4;
    for (let x = 0; x < srcW; x++) {
      let t0 = 0, t1 = 0, t2 = 0, t3 = 0;
      for (let k = 0; k < count; k++) {
        const w = weights[k], p = ((left + k) * srcW + x) * 4;
        t0 = f32(t0 + f32(src[p] * w));
        t1 = f32(t1 + f32(src[p + 1] * w));
        t2 = f32(t2 + f32(src[p + 2] * w));
        t3 = f32(t3 + f32(src[p + 3] * w));
      }
      const d = rowDst + x * 4;
      tmp[d] = t0; tmp[d + 1] = t1; tmp[d + 2] = t2; tmp[d + 3] = t3;
    }
  }
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const ratioX = f32(srcW / dstW), sratioX = ratioX < 1 ? 1 : ratioX, supportX = sratioX;
  for (let outx = 0; outx < dstW; outx++) {
    const inputxOrig = f32(f32(outx + 0.5) * ratioX);
    const left = Math.min(srcW - 1, Math.max(0, Math.floor(f32(inputxOrig - supportX))));
    const right = Math.min(srcW, Math.max(left + 1, Math.ceil(f32(inputxOrig + supportX))));
    const inputx = f32(inputxOrig - 0.5);
    const count = right - left;
    const weights = new Float32Array(count);
    let sum = 0;
    for (let k = 0; k < count; k++) {
      const w = triangleKernel(f32(f32((left + k) - inputx) / sratioX));
      weights[k] = w;
      sum = f32(sum + w);
    }
    for (let k = 0; k < count; k++) weights[k] = f32(weights[k] / sum);
    for (let y = 0; y < dstH; y++) {
      let t0 = 0, t1 = 0, t2 = 0, t3 = 0;
      const rowSrc = y * srcW * 4;
      for (let k = 0; k < count; k++) {
        const w = weights[k], p = rowSrc + (left + k) * 4;
        t0 = f32(t0 + f32(tmp[p] * w));
        t1 = f32(t1 + f32(tmp[p + 1] * w));
        t2 = f32(t2 + f32(tmp[p + 2] * w));
        t3 = f32(t3 + f32(tmp[p + 3] * w));
      }
      const d = (y * dstW + outx) * 4;
      dst[d] = toU8(t0); dst[d + 1] = toU8(t1); dst[d + 2] = toU8(t2); dst[d + 3] = toU8(t3);
    }
  }
  return dst;
}

// Separable Box filter matching Noctalia's image_loader.cpp for custom schemes.
function boxResize(src, srcW, srcH, dstW, dstH) {
  const epsilon = 1e-12;
  const tmp = new Float32Array(srcW * dstH * 4);
  const factorY = dstH / srcH;
  const supportY = Math.max(Math.max(1 / factorY + epsilon, 1) * 0.5, 0.5);
  for (let outy = 0; outy < dstH; outy++) {
    const bisect = (outy + 0.5) / factorY + epsilon;
    const start = Math.trunc(Math.max(bisect - supportY + 0.5, 0));
    const stop = Math.trunc(Math.min(bisect + supportY + 0.5, srcH));
    const count = stop - start;
    if (count <= 0) continue;
    const weight = f32(1 / count);
    const rowDst = outy * srcW * 4;
    for (let x = 0; x < srcW; x++) {
      let t0 = 0, t1 = 0, t2 = 0, t3 = 0;
      for (let i = start; i < stop; i++) {
        const p = (i * srcW + x) * 4;
        t0 = f32(t0 + f32(src[p] * weight));
        t1 = f32(t1 + f32(src[p + 1] * weight));
        t2 = f32(t2 + f32(src[p + 2] * weight));
        t3 = f32(t3 + f32(src[p + 3] * weight));
      }
      const d = rowDst + x * 4;
      tmp[d] = t0; tmp[d + 1] = t1; tmp[d + 2] = t2; tmp[d + 3] = t3;
    }
  }
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const factorX = dstW / srcW;
  const supportX = Math.max(Math.max(1 / factorX + epsilon, 1) * 0.5, 0.5);
  for (let outx = 0; outx < dstW; outx++) {
    const bisect = (outx + 0.5) / factorX + epsilon;
    const start = Math.trunc(Math.max(bisect - supportX + 0.5, 0));
    const stop = Math.trunc(Math.min(bisect + supportX + 0.5, srcW));
    const count = stop - start;
    if (count <= 0) continue;
    const weight = f32(1 / count);
    for (let y = 0; y < dstH; y++) {
      let t0 = 0, t1 = 0, t2 = 0, t3 = 0;
      const rowSrc = y * srcW * 4;
      for (let i = start; i < stop; i++) {
        const p = rowSrc + i * 4;
        t0 = f32(t0 + f32(tmp[p] * weight));
        t1 = f32(t1 + f32(tmp[p + 1] * weight));
        t2 = f32(t2 + f32(tmp[p + 2] * weight));
        t3 = f32(t3 + f32(tmp[p + 3] * weight));
      }
      const d = (y * dstW + outx) * 4;
      dst[d] = toU8(t0); dst[d + 1] = toU8(t1); dst[d + 2] = toU8(t2); dst[d + 3] = toU8(t3);
    }
  }
  return dst;
}

// Match C++ material_color_utilities QuantizeWu integer truncation.
class QuantizerWuTrunc extends QuantizerWu {
  createResult(colorCount) {
    const colors = [];
    for (let i = 0; i < colorCount; ++i) {
      const cube = this.cubes[i];
      const weight = this.volume(cube, this.weights);
      if (weight > 0) {
        const r = Math.trunc(this.volume(cube, this.momentsR) / weight);
        const g = Math.trunc(this.volume(cube, this.momentsG) / weight);
        const b = Math.trunc(this.volume(cube, this.momentsB) / weight);
        colors.push(((255 << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0);
      }
    }
    return colors;
  }
}

// Deterministic Matugen-order Wsmeans matching Noctalia's m3_schemes.cpp.
function wsmeansMatugenOrder(opaque, startingClusters, maxColors, dataFor) {
  if (!maxColors || !opaque.length) return [];
  maxColors = Math.min(maxColors, 256);
  const indexOf = new Map(), points = [], counts = [];
  for (const argb of opaque) {
    const idx = indexOf.get(argb);
    if (idx !== undefined) counts[idx]++;
    else {
      indexOf.set(argb, points.length);
      points.push(dataFor(argb).lab);
      counts.push(1);
    }
  }
  let clusterCount = Math.min(maxColors, points.length);
  if (startingClusters.length) clusterCount = Math.min(clusterCount, startingClusters.length);
  const clusters = Array.from({ length: clusterCount }, (_, i) =>
    startingClusters.length ? [...dataFor(startingClusters[i]).lab] : [...points[i]]);
  const clusterIndices = new Int32Array(points.length);
  for (let i = 0; i < points.length; i++) clusterIndices[i] = i % clusterCount;
  const pixelCountSums = new Uint32Array(clusterCount);
  const dmat = Array.from({ length: clusterCount }, () => Array.from({ length: clusterCount }, () => ({ distance: 0, index: 0 })));
  for (let iter = 0; iter < 10; iter++) {
    for (let i = 0; i < clusterCount; i++) {
      for (let j = i + 1; j < clusterCount; j++) {
        const distance = squaredDistance(clusters[i], clusters[j]);
        dmat[j][i] = { distance, index: i };
        dmat[i][j] = { distance, index: j };
      }
    }
    for (let i = 0; i < clusterCount; i++) dmat[i].sort((a, b) => a.distance - b.distance);
    let pointsMoved = 0;
    for (let i = 0; i < points.length; i++) {
      const point = points[i], prevIdx = clusterIndices[i];
      const prevD = squaredDistance(point, clusters[prevIdx]);
      let minD = prevD, newIdx = clusterCount;
      const row = dmat[prevIdx];
      for (let j = 0; j < clusterCount; j++) {
        if (row[j].distance >= 4 * prevD) continue;
        const d = squaredDistance(point, clusters[j]);
        if (d < minD) { minD = d; newIdx = j; }
      }
      if (newIdx !== clusterCount) {
        pointsMoved++;
        clusterIndices[i] = newIdx;
      }
    }
    if (pointsMoved === 0 && iter > 0) break;
    const sa = new Float64Array(clusterCount), sb = new Float64Array(clusterCount), sc = new Float64Array(clusterCount);
    pixelCountSums.fill(0);
    for (let i = 0; i < points.length; i++) {
      const ci = clusterIndices[i], cnt = counts[i], pt = points[i];
      pixelCountSums[ci] += cnt;
      sa[ci] += pt[0] * cnt;
      sb[ci] += pt[1] * cnt;
      sc[ci] += pt[2] * cnt;
    }
    for (let i = 0; i < clusterCount; i++) {
      const cnt = pixelCountSums[i];
      clusters[i] = cnt ? [sa[i] / cnt, sb[i] / cnt, sc[i] / cnt] : [0, 0, 0];
    }
  }
  const seen = new Set(), result = [];
  for (let i = 0; i < clusterCount; i++) {
    const cnt = pixelCountSums[i];
    if (!cnt) continue;
    const argb = argbFromLab(clusters[i][0], clusters[i][1], clusters[i][2]) >>> 0;
    if (seen.has(argb)) continue;
    seen.add(argb);
    result.push({ argb, population: cnt });
  }
  return result;
}

// Stable Matugen-order scoring matching Noctalia's m3_schemes.cpp.
function scoreMatugen(clusters, desired = 4, filter = true) {
  const huePopulation = new Uint32Array(360);
  const colorsHct = [];
  let populationSum = 0;
  for (const c of clusters) {
    const hct = Hct.fromInt(c.argb);
    colorsHct.push(hct);
    huePopulation[sanitizeDegreesInt(Math.floor(hct.hue))] += c.population;
    populationSum += c.population;
  }
  const hueExcited = new Float64Array(360);
  if (populationSum > 0) {
    for (let hue = 0; hue < 360; hue++) {
      const prop = huePopulation[hue] / populationSum;
      for (let i = hue - 14; i < hue + 16; i++) hueExcited[sanitizeDegreesInt(i)] += prop;
    }
  }
  const scored = [];
  for (const hct of colorsHct) {
    const hue = sanitizeDegreesInt(Math.round(hct.hue));
    const prop = hueExcited[hue];
    if (filter && (hct.chroma < 5 || prop <= 0.01)) continue;
    const propScore = prop * 100 * 0.7;
    const cw = hct.chroma < 48 ? 0.1 : 0.3;
    scored.push({ hct, score: propScore + (hct.chroma - 48) * cw });
  }
  scored.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (let diff = 90; diff >= 15; diff--) {
    chosen.length = 0;
    for (const entry of scored) {
      if (chosen.every(ch => diffDegrees(entry.hct.hue, ch.hue) >= diff)) {
        chosen.push(entry.hct);
        if (chosen.length >= desired) break;
      }
    }
    if (chosen.length >= desired) break;
  }
  return chosen.length ? chosen.map(hct => hct.toInt() >>> 0) : [MATERIAL_FALLBACK];
}

function materialSeed(opaque, dataFor, hctFor) {
  if (!opaque.length) return MATERIAL_FALLBACK;
  const wu = new QuantizerWuTrunc().quantize(opaque, 128);
  const clusters = wsmeansMatugenOrder(opaque, wu, 128, dataFor).filter(c => hctFor(c.argb).chroma >= 5);
  return scoreMatugen(clusters, 4, true)[0];
}

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
 * Extract seeds for all modes from an RGBA Canvas pixel buffer.
 * Inputs other than 112x112 are force-resized to 112x112 with Noctalia's
 * Triangle filter (M3) and Box filter (custom). Alpha below 200 is ignored.
 */
export function extractImagePalettes(pixels, width = TARGET_SIZE, height = TARGET_SIZE) {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0
    || !(pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4) {
    throw new TypeError('Expected an RGBA Uint8ClampedArray matching width x height');
  }
  const alreadyTarget = width === TARGET_SIZE && height === TARGET_SIZE;
  const m3Pixels = alreadyTarget ? pixels : triangleResize(pixels, width, height, TARGET_SIZE, TARGET_SIZE);
  const customPixels = alreadyTarget ? pixels : boxResize(pixels, width, height, TARGET_SIZE, TARGET_SIZE);
  const cache = new Map();
  const dataFor = argb => {
    if (!cache.has(argb)) cache.set(argb, { argb, lab: labFromArgb(argb) });
    return cache.get(argb);
  };
  const hctFor = argb => {
    const data = dataFor(argb);
    return data.hct ||= Hct.fromInt(argb);
  };
  const opaque = [];
  for (let i = 0; i < m3Pixels.length; i += 4) {
    if (m3Pixels[i + 3] < MIN_ALPHA) continue;
    opaque.push(argbFromRgb(m3Pixels[i], m3Pixels[i + 1], m3Pixels[i + 2]) >>> 0);
  }
  const customOpaque = [], sampled = [];
  for (let i = 0; i < customPixels.length; i += 4) {
    if (customPixels[i + 3] < MIN_ALPHA) continue;
    const argb = argbFromRgb(customPixels[i], customPixels[i + 1], customPixels[i + 2]) >>> 0;
    customOpaque.push(argb);
    const pixel = i / 4, x = pixel % TARGET_SIZE, y = Math.floor(pixel / TARGET_SIZE);
    // Vary the sampled columns by row: a fixed 16-pixel stride on a 112px
    // canvas repeatedly misses the same 15 out of every 16 vertical columns.
    if ((x + y) % 16 === 0) sampled.push(argb);
  }
  // Sparse transparency can hide every fixed-position sample. Preserve the
  // visible colors in that case without allowing transparent RGB to leak in.
  if (!sampled.length) for (let i = 0; i < customOpaque.length; i += 16) sampled.push(customOpaque[i]);
  const seed = materialSeed(opaque, dataFor, hctFor);
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
