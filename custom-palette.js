import {
  Hct, TonalPalette, argbFromRgb, redFromArgb, greenFromArgb, blueFromArgb,
} from '@material/material-color-utilities';

// Role formulas are adapted from Noctalia's custom_schemes.cpp,
// copyright (c) 2026 noctalia-dev, MIT: https://github.com/noctalia-dev/noctalia
const FALLBACK = [103, 80, 164];
const MODES = new Set(['vibrant', 'faithful', 'soft', 'dysfunctional', 'muted']);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wrapHue = hue => (hue % 360 + 360) % 360;
const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

function rgbToHsl(rgb) {
  const [r, g, b] = rgb.map(value => value / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const lightness = (max + min) / 2;
  if (!delta) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [wrapHue(hue * 60), saturation, lightness];
}

function hslToArgb([hue, saturation, lightness]) {
  const h = wrapHue(hue);
  const s = clamp(saturation, 0, 1), l = clamp(lightness, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const channels = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x] : h < 240 ? [0, x, c]
      : h < 300 ? [x, 0, c] : [c, 0, x];
  return argbFromRgb(...channels.map(value => Math.round((value + m) * 255)));
}

function luminance(argb) {
  const channels = [redFromArgb(argb), greenFromArgb(argb), blueFromArgb(argb)].map(value => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Noctalia adjusts in OKLCH. This smaller adapter searches HSL lightness while
// preserving hue and saturation; the resulting pixels are not an exact port.
function contrasting([h, s, start], background, minimum, dark) {
  for (let step = 0; step <= 200; step++) {
    const lightness = clamp(start + (dark ? 1 : -1) * step / 200, 0, 1);
    const color = hslToArgb([h, s, lightness]);
    if (contrast(color, background) >= minimum || lightness === (dark ? 1 : 0)) return color;
  }
}

function paletteFor(argb) {
  const color = Hct.fromInt(argb);
  return TonalPalette.fromHueAndChroma(color.hue, color.chroma);
}

function normalizeCandidates(candidates) {
  if (!Array.isArray(candidates)) return [FALLBACK];
  const valid = candidates.filter(rgb => Array.isArray(rgb) && rgb.length >= 3
    && Number.isFinite(rgb[0]) && Number.isFinite(rgb[1]) && Number.isFinite(rgb[2]))
    .slice(0, 5)
    .map(rgb => rgb.slice(0, 3).map(channel => Math.round(clamp(channel, 0, 255))));
  return valid.length ? valid : [FALLBACK];
}

function shifted([h, s, l], degrees) {
  // A hue rotation has no effect on an achromatic RGB color.
  return [s === 0 ? h : wrapHue(h + degrees), s, l];
}

function chooseAccents(colors, mode) {
  const primary = colors[0];
  if (mode === 'muted') return [primary, shifted(primary, 15), shifted(primary, 30)];
  // Scan all ranked candidates rather than only slots 2 and 3: several shades
  // of a dominant color should not hide a distinct color later in the image.
  const secondaryIndex = colors.findIndex((color, i) => i > 0 && hueDistance(primary[0], color[0]) > 30);
  const secondary = secondaryIndex < 0 ? shifted(primary, 30) : colors[secondaryIndex];
  const tertiary = colors.find((color, i) => i > 0 && i !== secondaryIndex
    && hueDistance(primary[0], color[0]) > 30 && hueDistance(secondary[0], color[0]) > 30)
    || shifted(primary, 60);
  return [primary, secondary, tertiary];
}

function adjustedAccent([h, s, l], index, mode, dark) {
  const minimums = [0.7, 0.6, 0.5], caps = [0.55, 0.45, 0.40];
  const softMinimums = [0.30, 0.24, 0.20], mutedCaps = [0.15, 0.12, 0.10];
  const low = [0.25, 0.22, 0.20], high = [0.45, 0.40, 0.35], darkLow = [0.65, 0.60, 0.60];
  // A nearly gray source has no meaningful HSL hue; minimum saturation would
  // otherwise turn its arbitrary zero-degree hue into an invented red.
  const saturation = s < 0.05 ? 0 : mode === 'muted' ? Math.min(s, mutedCaps[index])
    : mode === 'soft' ? clamp(s, softMinimums[index], caps[index]) : Math.max(s, minimums[index]);
  const lightness = dark ? Math.max(l, darkLow[index])
    : mode === 'muted' ? Math.min(l, high[index]) : clamp(l, low[index], high[index]);
  return [h, saturation, lightness];
}

function accentContainer([h, s, l], mode, dark) {
  if (s === 0) return [h, 0, dark ? Math.max(l - 0.35, 0.15) : Math.min(l + 0.35, 0.85)];
  if (dark) {
    const saturation = mode === 'muted' ? Math.min(s + 0.05, 0.15)
      : mode === 'soft' ? Math.min(s + 0.08, 0.60) : s + 0.15 * (1 - s);
    return [h, saturation, Math.max(l - 0.35, 0.15)];
  }
  const saturation = mode === 'muted' ? Math.max(s - 0.05, 0.05)
    : mode === 'soft' ? Math.max(s - 0.10, 0.18) : Math.max(s - 0.20, 0.30);
  return [h, saturation, Math.min(l + 0.35, 0.85)];
}

function makeScheme(colors, mode, dark) {
  const seeds = chooseAccents(colors, mode);
  const [primary, secondary, tertiary] = seeds.map((seed, i) => adjustedAccent(seed, i, mode, dark));
  const [sourceHue, sourceSaturation] = seeds[0];
  const neutralSource = sourceSaturation < 0.05;
  const normal = mode !== 'soft' && mode !== 'muted';
  let surfaceHue = sourceHue, surfaceSaturation = sourceSaturation;
  if (neutralSource) {
    surfaceSaturation = 0;
  } else if (dark && normal) {
    if (surfaceHue >= 160 && surfaceHue <= 200) surfaceHue = wrapHue(surfaceHue + 10);
    const cap = surfaceHue < 60 || surfaceHue > 300 ? 0.35 : surfaceHue < 120 ? 0.50 : 0.90;
    surfaceSaturation = Math.min(surfaceSaturation, cap);
  } else if (mode === 'soft') {
    surfaceSaturation = Math.min(surfaceSaturation, 0.22);
  } else if (mode === 'muted' && dark) {
    surfaceSaturation = 0.08;
  }
  const surfaceColor = (saturationCap, lightness) => hslToArgb([
    surfaceHue, Math.min(surfaceSaturation, saturationCap), lightness,
  ]);
  const caps = mode === 'muted' ? [0.08, 0.08, 0.08, 0.08, 0.08]
    : mode === 'soft' ? [0.16, 0.18, 0.14, 0.16, 0.18]
      : dark ? [0.90, 0.80, 0.85, 0.70, 0.75] : [0.90, 0.80, 0.85, 0.80, 0.75];
  const surface = surfaceColor(caps[0], dark ? 0.12 : 0.90);
  const surfaceVariant = surfaceColor(caps[1], dark ? 0.16 : 0.78);
  const surfaceContainerLow = surfaceColor(caps[2], dark ? 0.14 : 0.88);
  const surfaceContainer = surfaceColor(caps[3], dark ? 0.16 : 0.86);
  const surfaceContainerHigh = surfaceColor(caps[4], dark ? 0.20 : 0.84);
  const textSaturation = neutralSource ? 0 : mode === 'muted' ? 0.03 : mode === 'soft' ? 0.04 : 0.05;
  const onSurface = contrasting([sourceHue, textSaturation, dark ? 0.95 : 0.10], surface, 4.5, dark);
  const onSurfaceVariant = contrasting([sourceHue, neutralSource ? 0 : mode === 'muted' ? 0.03 : 0.05, dark ? 0.70 : 0.35],
    surfaceVariant, 4.5, dark);
  const outlineSaturation = neutralSource ? 0 : mode === 'muted' ? 0.05 : dark ? 0.10
    : mode === 'soft' ? 0.10 : Math.max(sourceSaturation * 0.4, 0.25);
  const variantSaturation = neutralSource ? 0 : mode === 'muted' ? 0.05 : dark ? 0.12
    : mode === 'soft' ? 0.12 : Math.max(sourceSaturation * 0.3, 0.20);
  const outline = contrasting([sourceHue, outlineSaturation, dark ? 0.30 : 0.65], surface, 3, dark);
  const outlineVariant = contrasting([sourceHue, variantSaturation, dark ? 0.40 : 0.75], surface, 3, dark);
  const error = colors.find(([h, s, l]) => (h <= 30 || h >= 330) && s > 0.4 && l > 0.3 && l < 0.7)
    || rgbToHsl([253, 70, 99]);
  const primaryArgb = hslToArgb(primary);
  return {
    primary: primaryArgb, secondary: hslToArgb(secondary), tertiary: hslToArgb(tertiary),
    primaryContainer: hslToArgb(accentContainer(primary, mode, dark)),
    secondaryContainer: hslToArgb(accentContainer(secondary, mode, dark)),
    tertiaryContainer: hslToArgb(accentContainer(tertiary, mode, dark)),
    // This is only a palette role; callers should keep DSH's semantic state colors.
    error: hslToArgb(error),
    surface, surfaceVariant, surfaceContainerLow, surfaceContainer, surfaceContainerHigh,
    outline, outlineVariant, onSurface, onSurfaceVariant,
    // HCT tonal palettes are an adapter for DSH's accessibility search, not
    // the source of the HSL role colors above.
    primaryPalette: paletteFor(primaryArgb),
    neutralPalette: paletteFor(onSurface),
    neutralVariantPalette: paletteFor(onSurfaceVariant),
  };
}

// candidates are pre-ranked RGB colors; the first supplies the primary hue.
export function makeCustomSchemes(candidates, mode) {
  const colors = normalizeCandidates(candidates).map(rgbToHsl);
  const selectedMode = MODES.has(mode) ? mode : 'faithful';
  return [makeScheme(colors, selectedMode, false), makeScheme(colors, selectedMode, true)];
}
