import {
  Contrast, Hct, TonalPalette, argbFromRgb, redFromArgb, greenFromArgb, blueFromArgb, xyzFromArgb,
  SchemeContent, SchemeTonalSpot, SchemeFruitSalad, SchemeRainbow, SchemeMonochrome,
} from '@material/material-color-utilities';
import { makeCustomSchemes } from './custom-palette.js';
import { wallpaperFilters } from '../../shared/wallpaper-filter.js';
import { normalizeWeather } from '../weather/weather.js';
import { normalizeSidebar } from '../wallpaper/sidebar-background.js';
import { DEFAULT_STRENGTH, normalizeStrength, backgroundAlpha } from '../wallpaper/wallpaper-visibility.js';
import { normalizeParallax } from '../wallpaper/wallpaper-parallax.js';

export { normalizeStrength, backgroundAlpha } from '../wallpaper/wallpaper-visibility.js';

// Pure image-colour and scheduling logic; shared by browser bundle and tests.
export const PALETTE_MODES = Object.freeze(['content', 'tonal-spot', 'fruit-salad', 'rainbow', 'monochrome', 'vibrant', 'faithful', 'soft', 'dysfunctional', 'muted']);
export const TEXT_COLOR_MODES = Object.freeze(['theme', 'high-contrast']);
export const RESOLUTIONS = Object.freeze(['1080p', '2k', '4k']);
const { filterMode, filterAmounts } = wallpaperFilters.normalize();
const parallaxDefaults = normalizeParallax();
const sidebarDefaults = () => {
  const sidebar = normalizeSidebar();
  return Object.freeze({ ...sidebar, filterAmounts: Object.freeze(sidebar.filterAmounts) });
};
export const DEFAULTS = Object.freeze({
  enabled: true, dynamic: true, market: 'zh-CN', resolution: '1080p', paletteMode: 'content', textColorMode: 'theme',
  pureBlackDark: false, systemTweaks: false, mode: 'schedule', day: '07:00', night: '19:00', strength: DEFAULT_STRENGTH,
  weather: Object.freeze(normalizeWeather()),
  filterMode, filterAmounts: Object.freeze(filterAmounts), ...parallaxDefaults, leftSidebar: sidebarDefaults(), rightSidebar: sidebarDefaults(),
});
export function normalizeSettings(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
    dynamic: typeof input.dynamic === 'boolean' ? input.dynamic : true,
    market: ['zh-CN', 'en-US'].includes(input.market) ? input.market : DEFAULTS.market,
    resolution: RESOLUTIONS.includes(input.resolution) ? input.resolution : DEFAULTS.resolution,
    paletteMode: PALETTE_MODES.includes(input.paletteMode) ? input.paletteMode : DEFAULTS.paletteMode,
    textColorMode: TEXT_COLOR_MODES.includes(input.textColorMode) ? input.textColorMode : DEFAULTS.textColorMode,
    pureBlackDark: typeof input.pureBlackDark === 'boolean' ? input.pureBlackDark : DEFAULTS.pureBlackDark,
    systemTweaks: typeof input.systemTweaks === 'boolean' ? input.systemTweaks : DEFAULTS.systemTweaks,
    mode: ['follow', 'schedule', 'system', 'light', 'dark'].includes(input.mode) ? input.mode : 'schedule',
    day: time(input.day) ? input.day : DEFAULTS.day,
    night: time(input.night) ? input.night : DEFAULTS.night,
    strength: normalizeStrength(input.strength),
    weather: normalizeWeather(input.weather),
    ...wallpaperFilters.normalize(input),
    ...normalizeParallax(input),
    leftSidebar: normalizeSidebar(input.leftSidebar),
    rightSidebar: normalizeSidebar(input.rightSidebar),
  };
}
export function scheduledScheme(date, day, night) {
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const now = date.getHours() * 60 + date.getMinutes();
  const start = minutes(day), end = minutes(night);
  if (start === end) return null;
  return (start < end ? now >= start && now < end : now >= start || now < end) ? 'light' : 'dark';
}
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, s * 100, l * 100];
}
export function hslToRgb([h, s, l]) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgb.map(v => Math.round((v + m) * 255));
}
export function luminance(rgb) {
  return xyzFromArgb(argbFromRgb(...rgb))[1] / 100;
}
export function contrast(a, b) {
  return Contrast.ratioOfYs(xyzFromArgb(argbFromRgb(...a))[1], xyzFromArgb(argbFromRgb(...b))[1]);
}
const MATERIAL_SCHEMES = Object.freeze({
  content: SchemeContent, 'tonal-spot': SchemeTonalSpot, 'fruit-salad': SchemeFruitSalad,
  rainbow: SchemeRainbow, monochrome: SchemeMonochrome,
});
const schemeCache = new Map();
const fromArgb = argb => [redFromArgb(argb), greenFromArgb(argb), blueFromArgb(argb)];
const rgbCss = rgb => `rgb(${rgb.join(', ')})`;
const rgbaCss = (rgb, alpha) => `rgba(${rgb.join(', ')}, ${alpha})`;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wrapHue = hue => ((hue % 360) + 360) % 360;
const diffDegrees = (a, b) => 180 - Math.abs(Math.abs(a - b) - 180);
const rotationDirection = (from, to) => (wrapHue(to - from) <= 180 ? 1 : -1);

// Material harmonization matching Noctalia's fixed_palette.cpp standardAnsiColors:
// rotate canonical semantic hue toward the wallpaper primary by up to 15 degrees.
function harmonizeHue(hue, accentHct) {
  if (accentHct.chroma < 12) return hue;
  const rotation = Math.min(diffDegrees(hue, accentHct.hue) * 0.5, 15);
  return wrapHue(hue + rotation * rotationDirection(hue, accentHct.hue));
}

function harmonizedPalette(canonicalHue, accentHct, chromaMin = 36, chromaMax = 64) {
  const hue = harmonizeHue(canonicalHue, accentHct);
  const chroma = clamp(accentHct.chroma, chromaMin, chromaMax);
  return TonalPalette.fromHueAndChroma(hue, chroma);
}

function schemesFor(candidates, mode) {
  const key = `${mode}:${candidates.map(rgb => rgb.join(',')).join(';')}`;
  if (!schemeCache.has(key)) {
    const Scheme = MATERIAL_SCHEMES[mode];
    if (Scheme) {
      const hct = Hct.fromInt(argbFromRgb(...candidates[0]));
      schemeCache.set(key, [new Scheme(hct, false, 0), new Scheme(hct, true, 0)]);
    } else {
      schemeCache.set(key, makeCustomSchemes(candidates, mode));
    }
    if (schemeCache.size > 22) schemeCache.delete(schemeCache.keys().next().value);
  }
  return schemeCache.get(key);
}

function gradientStops(palette, stops) {
  return stops.map(([tone, pos]) => pos ? `${rgbCss(fromArgb(palette.tone(tone)))} ${pos}` : rgbCss(fromArgb(palette.tone(tone)))).join(', ');
}

function themeTokens(candidates, strength, mode, textColorMode, { pureBlackDark = false, systemTweaks = false } = {}) {
  const tokens = {}, alpha = backgroundAlpha(strength);
  const highContrast = textColorMode === 'high-contrast';
  for (const [i, scheme] of schemesFor(candidates, mode).entries()) {
    const dark = i === 1, variant = dark ? 'dark' : 'light';
    // Noctalia applyPureBlackDark(): shift the dark surface ramp by surface's HCT tone
    // so surface lands at pure #000000 while preserving elevation steps above it.
    const pureShift = dark && pureBlackDark ? Hct.fromInt(scheme.surface).tone : 0;
    const surfaceRole = argb => {
      if (pureShift <= 0) return fromArgb(argb);
      const hct = Hct.fromInt(argb);
      hct.tone = Math.max(0, hct.tone - pureShift);
      return fromArgb(hct.toInt());
    };
    const baseSurface = surfaceRole(scheme.surface);
    const surfaceLowest = surfaceRole(scheme.surfaceContainerLowest);
    const surface = surfaceRole(scheme.surfaceContainerLow);
    const raised = surfaceRole(scheme.surfaceContainer);
    const hover = surfaceRole(scheme.surfaceContainerHigh);
    const selected = surfaceRole(scheme.surfaceContainerHighest);
    const outlineVariant = fromArgb(scheme.outlineVariant);
    const values = {
      '--dsw-alias-bg-base': baseSurface,
      '--dsw-alias-bg-layer-1': surface,
      '--dsw-alias-bg-layer-2': raised,
      '--dsw-specific-sidebar-fill': hover,
      '--dsw-alias-border-l1': outlineVariant,
      '--dsw-alias-border-l2': fromArgb(scheme.outline),
      '--dsw-alias-bg-overlay': raised,
    };
    const surfaceAliases = {
      '--dsw-alias-bg-layer-3': selected,
      '--dsw-alias-bg-module-platform': selected,
      '--dsw-alias-bg-multi-select': selected,
      '--dsw-alias-bg-document-preview': surface,
      '--dsw-alias-card-fill': surface,
      '--dsw-alias-card-fill-hover': hover,
      '--dsw-alias-card-tile-fill': surface,
      '--dsw-alias-onboarding-card-fill': surface,
      '--dsw-alias-onboarding-secondary-fill': raised,
      '--dsw-alias-button-elevated-fill': surface,
      '--dsw-alias-button-floating-fill': surface,
      '--dsw-alias-button-floating-hover': hover,
      '--dsw-alias-button-ghost-active-fill': selected,
      '--dsw-alias-button-ghost-active-hover': hover,
      '--dsw-alias-button-primary-dimmed': selected,
      '--dsw-alias-interactive-bg-active': selected,
      '--dsw-alias-interactive-bg-hover': hover,
      '--dsw-alias-interactive-bg-hover-solid': hover,
      '--dsw-alias-interactive-bg-hover-accent': selected,
      '--dsw-menu-surface-fill': raised,
      '--dsw-alias-menu-group-header-fill': surface,
      '--dsw-specific-menu': raised,
      '--dsw-specific-input-major': surface,
      '--dsw-specific-login-input': raised,
      '--dsw-specific-selector': selected,
      '--dsw-specific-tip': surface,
      '--dsw-specific-sidebar-nav-item-active': selected,
      '--dsw-specific-sidebar-nav-item-active-accent': selected,
      '--dsw-specific-bubble': raised,
      '--dsw-specific-bubble-highlight': selected,
      '--dsw-alias-markdown-code-block': raised,
      '--dsw-alias-markdown-code-block-banner': surface,
      '--dsw-alias-markdown-inline-code': raised,
      '--dsw-alias-markdown-code-segment-selected': surface,
      '--dsw-alias-markdown-code-segment-unselected': raised,
      '--dsw-alias-markdown-placeholder': selected,
      '--dsw-alias-markdown-tag': selected,
      '--dsw-alias-markdown-citation': selected,
      '--dsw-alias-turn-trigger-bg': raised,
      '--dsw-alias-turn-trigger-bg-hover': hover,
      '--shiki-background': raised,
    };
    Object.assign(values, surfaceAliases);
    // An unmasked photo can contain every luminance; no single foreground can
    // guarantee contrast over it. Keep opaque controls and panels readable.
    const backgrounds = [surface, raised, hover, selected];
    const accessible = (palette, start, minimum = 4.6, bgs = backgrounds, lightDirection = dark) => {
      let tone = Math.round(clamp(start, 0, 100));
      while (bgs.some(bg => contrast(fromArgb(palette.tone(tone)), bg) < minimum) && tone > 0 && tone < 100) {
        tone += lightDirection ? 1 : -1;
      }
      return fromArgb(palette.tone(tone));
    };
    const primaryHct = Hct.fromInt(scheme.primary);
    const primaryChroma = scheme.primaryPalette.chroma;
    const tintedText = !highContrast && mode !== 'monochrome' && primaryChroma >= 4;
    const muted = mode === 'muted';
    const textPalette = (minChroma, maxChroma, ratio, fallback) => tintedText
      ? TonalPalette.fromHueAndChroma(scheme.primaryPalette.hue, Math.min(maxChroma, Math.max(minChroma, primaryChroma * ratio)))
      : fallback;
    const primaryTextPalette = textPalette(muted ? 8 : 24, muted ? 18 : 40, muted ? 0.8 : 0.9, scheme.neutralPalette);
    const secondaryTextPalette = textPalette(muted ? 10 : 28, muted ? 22 : 48, 1, scheme.neutralVariantPalette);
    const businessBgTone = dark ? (pureBlackDark ? 18 : 24) : 92;
    const businessTertiary = fromArgb(scheme.primaryPalette.tone(businessBgTone));
    const brand = highContrast
      ? accessible(scheme.primaryPalette, primaryHct.tone, 4.6, [...backgrounds, businessTertiary])
      : fromArgb(scheme.primary);
    const brandHover = fromArgb(scheme.primaryPalette.tone(clamp(Hct.fromInt(argbFromRgb(...brand)).tone + (dark ? 7 : -7), 0, 100)));
    const onBrand = highContrast
      ? [[0, 0, 0], [255, 255, 255]].sort((a, b) => Math.min(contrast(b, brand), contrast(b, brandHover)) - Math.min(contrast(a, brand), contrast(a, brandHover)))[0]
      : fromArgb(scheme.onPrimary);
    const secondaryAccent = highContrast
      ? accessible(scheme.secondaryPalette, Hct.fromInt(scheme.secondary).tone)
      : fromArgb(scheme.secondary);
    const tertiaryAccent = highContrast
      ? accessible(scheme.tertiaryPalette, Hct.fromInt(scheme.tertiary).tone)
      : fromArgb(scheme.tertiary);

    values['--dsw-alias-brand-primary'] = brand;
    values['--dsw-alias-brand-primary-invert'] = fromArgb(scheme.inversePrimary);
    const labelPrimary = highContrast
      ? accessible(scheme.neutralPalette, Hct.fromInt(scheme.onSurface).tone)
      : accessible(primaryTextPalette, tintedText ? (dark ? 82 : 28) : Hct.fromInt(scheme.onSurface).tone);
    const labelSecondary = highContrast
      ? accessible(scheme.neutralVariantPalette, Hct.fromInt(scheme.onSurfaceVariant).tone)
      : accessible(secondaryTextPalette, tintedText ? (dark ? 74 : 38) : Hct.fromInt(scheme.onSurfaceVariant).tone);
    const caption = highContrast
      ? accessible(scheme.neutralVariantPalette, dark ? 70 : 50)
      : accessible(secondaryTextPalette, tintedText ? (dark ? 68 : 48) : (dark ? 70 : 50));
    values['--dsw-alias-label-primary'] = labelPrimary;
    values['--dsw-alias-label-secondary'] = labelSecondary;
    values['--dsw-alias-label-document-preview'] = labelSecondary;
    for (const key of ['--dsw-alias-label-tertiary', '--dsw-alias-label-caption', '--dsw-alias-label-dimmed']) values[key] = caption;
    for (const key of ['--dsw-alias-brand-text', '--dsw-alias-brand-primary-new-colorprimary-new-color', '--dsw-alias-link']) values[key] = brand;
    for (const key of ['--dsw-alias-label-primary-bluish', '--dsw-alias-label-primary-dimmed', '--dsw-alias-menu-icon', '--shiki-foreground']) values[key] = labelPrimary;
    for (const key of ['--dsw-alias-button-primary-fill', '--dsw-alias-button-contrast-fill']) values[key] = brand;
    values['--dsw-alias-button-primary-hover'] = brandHover;
    // on-color is shared with semantic controls: preserve its default white unless
    // systemTweaks is explicitly enabled, and keep info buttons readable in both schemes.
    values['--dsw-alias-button-info-fill'] = fromArgb(scheme.primaryPalette.tone(35));
    values['--dsw-alias-button-info-hover'] = fromArgb(scheme.primaryPalette.tone(28));
    for (const key of ['--dsw-alias-label-primary-foreground', '--dsw-alias-label-primary-inverted']) values[key] = onBrand;
    values['--dsw-focus-ring-color'] = brand;
    const borderL2 = highContrast
      ? accessible(scheme.neutralVariantPalette, dark ? 60 : 50, 3.1)
      : fromArgb(scheme.outline);
    values['--dsw-alias-border-l2'] = borderL2;
    for (const key of ['--dsw-alias-border-selected', '--dsw-alias-button-ghost-active-border']) values[key] = brand;
    for (const key of ['--dsw-alias-border-l3', '--dsw-alias-border-l4', '--dsw-alias-border-l2-darkmode-thin', '--dsw-alias-onboarding-checkbox-border', '--dsw-alias-scrollbar-bg-l1', '--dsw-alias-scrollbar-bg-l2']) values[key] = borderL2;
    for (const key of ['--dsw-alias-scrollbar-hover-l1', '--dsw-alias-scrollbar-hover-l2']) values[key] = brand;
    // The off switch uses border-l3 as its track. The stock dark thumb is too
    // close to our readable outline: pair it with the track, not the page fill.
    const track = values['--dsw-alias-border-l3'];
    values['--dsw-alias-switch-thumb'] = contrast([0, 0, 0], track) > contrast([255, 255, 255], track) ? [0, 0, 0] : [255, 255, 255];

    // Business / accent / trajectory / onboarding / charts (Noctalia qtct + btop roles).
    for (const key of ['--dsw-alias-state-business-primary', '--dsw-alias-trajectory-accent', '--dsw-alias-onboarding-accent', '--dsw-specific-sidebar-right-flash', '--dsw-alias-label-deep-diving']) values[key] = brand;
    values['--dsw-alias-state-business-tertiary'] = businessTertiary;
    values['--dsw-alias-label-deep-diving-shimmer'] = tertiaryAccent;
    values['--dsw-alias-state-done-primary'] = tertiaryAccent;
    values['--dsw-alias-state-idle-primary'] = dark ? borderL2 : outlineVariant;
    values['--dsw-specific-guide-hero'] = outlineVariant;
    values['--dsw-alias-chart-messages'] = brand;
    values['--dsw-alias-chart-system'] = secondaryAccent;
    values['--dsw-alias-chart-tools'] = tertiaryAccent;

    // Empty-state illustrations follow the qtct v5 surface + outline elevation ladder.
    values['--dsw-alias-illustration-background'] = surface;
    values['--dsw-alias-illustration-surface'] = raised;
    values['--dsw-alias-illustration-inset'] = hover;
    values['--dsw-alias-illustration-shadow'] = hover;
    values['--dsw-alias-illustration-backing'] = outlineVariant;
    values['--dsw-alias-illustration-detail'] = borderL2;

    // Route A ('theme'): pure Noctalia palette roles (gtk4 / emacs / kitty palette style).
    // Route B ('high-contrast'): Material-harmonized semantic & ANSI hues (Noctalia standard style).
    const containerTone = dark ? (pureBlackDark ? 14 : 20) : 92;
    const diffBgTone = dark ? (pureBlackDark ? 14 : 18) : 93;
    const diffGutterTone = dark ? (pureBlackDark ? 10 : 14) : 95;
    const errorPal = highContrast ? harmonizedPalette(27, primaryHct, 44, 64) : scheme.errorPalette;
    const successPal = highContrast ? harmonizedPalette(142, primaryHct, 40, 62) : scheme.secondaryPalette;
    const warnPal = highContrast ? harmonizedPalette(78, primaryHct, 44, 64) : scheme.tertiaryPalette;
    const diffAddedPal = highContrast ? successPal : scheme.primaryPalette;
    const diffDeletedPal = errorPal;

    const successTertiary = fromArgb(successPal.tone(containerTone));
    const warnTertiary = fromArgb(warnPal.tone(containerTone));
    const diffAddedBg = fromArgb(diffAddedPal.tone(diffBgTone));
    const diffAddedGutter = fromArgb(diffAddedPal.tone(diffGutterTone));
    const diffDeletedBg = fromArgb(diffDeletedPal.tone(diffBgTone));
    const diffDeletedGutter = fromArgb(diffDeletedPal.tone(diffGutterTone));

    const errorPrimary = highContrast
      ? accessible(errorPal, dark ? 76 : 42, 4.6, [...backgrounds, diffDeletedBg, diffDeletedGutter])
      : fromArgb(scheme.error);
    const errorSecondary = highContrast
      ? accessible(errorPal, dark ? 80 : 48, 4.6, backgrounds)
      : fromArgb(errorPal.tone(dark ? 76 : 52));
    const successPrimary = highContrast
      ? accessible(successPal, dark ? 76 : 38, 4.6, [...backgrounds, successTertiary, diffAddedBg, diffAddedGutter])
      : secondaryAccent;
    const successSecondary = highContrast
      ? accessible(successPal, dark ? 82 : 44, 4.6, backgrounds)
      : fromArgb(successPal.tone(dark ? 74 : 46));
    const warnPrimary = highContrast
      ? accessible(warnPal, dark ? 78 : 38, 4.6, [...backgrounds, warnTertiary])
      : tertiaryAccent;
    const warnSecondary = highContrast
      ? accessible(warnPal, dark ? 84 : 44, 4.6, backgrounds)
      : fromArgb(warnPal.tone(dark ? 74 : 46));
    const diffAddedMarker = highContrast ? successPrimary : brand;
    const diffDeletedMarker = errorPrimary;

    values['--dsw-alias-state-error-primary'] = errorPrimary;
    values['--dsw-alias-state-error-secondary'] = errorSecondary;
    values['--dsw-alias-state-success-primary'] = successPrimary;
    values['--dsw-alias-state-success-secondary'] = successSecondary;
    values['--dsw-alias-state-success-tertiary'] = successTertiary;
    values['--dsw-alias-state-warn-primary'] = warnPrimary;
    values['--dsw-alias-state-warn-label'] = warnPrimary;
    values['--dsw-alias-state-warn-secondary'] = warnSecondary;
    values['--dsw-alias-state-warn-tertiary'] = warnTertiary;
    values['--dsw-alias-file-diff-added-bg'] = diffAddedBg;
    values['--dsw-alias-file-diff-added-gutter'] = diffAddedGutter;
    values['--dsw-alias-file-diff-added-marker'] = diffAddedMarker;
    values['--dsw-alias-file-diff-deleted-bg'] = diffDeletedBg;
    values['--dsw-alias-file-diff-deleted-gutter'] = diffDeletedGutter;
    values['--dsw-alias-file-diff-deleted-marker'] = diffDeletedMarker;

    // Code syntax highlighting (Shiki + JSON tree):
    // Route A mirrors Noctalia helix.toml; Route B uses harmonized ANSI hues with WCAG contrast.
    const syntaxKeyword = highContrast
      ? accessible(harmonizedPalette(334, primaryHct, 40, 62), dark ? 76 : 42, 4.6, backgrounds)
      : brand;
    const syntaxConstant = highContrast
      ? accessible(harmonizedPalette(270, primaryHct, 40, 62), dark ? 76 : 42, 4.6, backgrounds)
      : secondaryAccent;
    const syntaxString = highContrast ? successPrimary : tertiaryAccent;
    const syntaxStringExpr = highContrast
      ? accessible(harmonizedPalette(156, primaryHct, 40, 62), dark ? 78 : 38, 4.6, backgrounds)
      : tertiaryAccent;
    const syntaxFunction = highContrast
      ? accessible(harmonizedPalette(208, primaryHct, 40, 62), dark ? 76 : 40, 4.6, backgrounds)
      : tertiaryAccent;
    const syntaxParameter = highContrast ? warnPrimary : labelSecondary;
    const syntaxComment = highContrast ? caption : borderL2;
    const syntaxPunctuation = labelSecondary;

    values['--shiki-token-keyword'] = syntaxKeyword;
    values['--shiki-token-constant'] = syntaxConstant;
    values['--shiki-token-string'] = syntaxString;
    values['--shiki-token-string-expression'] = syntaxStringExpr;
    values['--shiki-token-function'] = syntaxFunction;
    values['--shiki-token-parameter'] = syntaxParameter;
    values['--shiki-token-comment'] = syntaxComment;
    values['--shiki-token-punctuation'] = syntaxPunctuation;
    values['--shiki-token-link'] = brand;
    values['--dsw-alias-json-tree-icon'] = labelSecondary;
    values['--dsw-alias-json-tree-keyword'] = syntaxKeyword;
    values['--dsw-alias-json-tree-number'] = syntaxConstant;
    values['--dsw-alias-json-tree-property'] = syntaxFunction;
    values['--dsw-alias-json-tree-punctuation'] = labelPrimary;
    values['--dsw-alias-json-tree-string'] = syntaxString;

    // Inverse informational surfaces stay dark in BOTH schemes.
    const inverse = fromArgb(scheme.neutralPalette.tone(dark && pureBlackDark ? 8 : 14));
    const inverseInk = fromArgb(primaryTextPalette.tone(tintedText ? 95 : 98));
    for (const key of ['--dsw-alias-tooltip-bg', '--dsw-alias-toast-bg', '--dsw-alias-hovercard-bg']) values[key] = inverse;
    for (const key of ['--dsw-alias-tooltip-label', '--dsw-alias-toast-label', '--dsw-alias-hovercard-label-primary']) values[key] = inverseInk;
    values['--dsw-alias-tooltip-key-bg'] = fromArgb(scheme.neutralPalette.tone(dark && pureBlackDark ? 20 : 26));
    values['--dsw-alias-toast-action'] = fromArgb(scheme.primaryPalette.tone(80));
    values['--dsw-alias-hovercard-label-secondary'] = fromArgb(secondaryTextPalette.tone(85));
    values['--dsw-alias-hovercard-label-tertiary'] = fromArgb(secondaryTextPalette.tone(78));
    values['--dsw-alias-hovercard-state-done'] = accessible(scheme.tertiaryPalette, 80, 4.6, [inverse], true);
    values['--dsw-alias-hovercard-state-error'] = accessible(errorPal, 80, 4.6, [inverse], true);

    // Translucent and composite CSS tokens.
    const cssValues = {
      '--dsw-alias-bg-document-selection': rgbaCss(fromArgb(scheme.primaryContainer), 0.4),
      '--dsw-alias-bg-skeleton': rgbaCss(labelPrimary, dark ? 0.08 : 0.05),
      '--dsw-specific-file-upload-track': rgbaCss(labelPrimary, dark ? 0.12 : 0.08),
      '--dsw-alias-border-inverted': dark ? rgbaCss(outlineVariant, 0.32) : 'rgba(0, 0, 0, 0)',
      '--dsw-alias-border-inverted2': dark ? rgbaCss(borderL2, 0.36) : 'rgba(0, 0, 0, 0)',
      '--dsw-alias-code-diff-added': rgbaCss(diffAddedMarker, dark ? 0.12 : 0.08),
      '--dsw-alias-code-diff-deleted': rgbaCss(diffDeletedMarker, dark ? 0.12 : 0.08),
      '--dsw-alias-interactive-bg-hover-danger': rgbaCss(errorPrimary, dark ? 0.15 : 0.08),
      '--dsw-alias-json-tree-hover': rgbaCss(labelPrimary, dark ? 0.06 : 0.04),
      '--dsw-alias-label-shimmer': rgbaCss(labelPrimary, dark ? 0.45 : 0.3),
      '--dsw-gradient-onboarding-blue-stops': gradientStops(scheme.primaryPalette, [[42, '18.75%'], [58, '51.78%'], [80, '86.252%'], [42, '']]),
      '--dsw-gradient-onboarding-cyan-stops': gradientStops(scheme.secondaryPalette, [[42, '21.154%'], [62, '50.954%'], [84, '85.326%'], [42, '']]),
      '--dsw-gradient-onboarding-violet-stops': gradientStops(scheme.tertiaryPalette, [[38, '33.102%'], [58, '50.954%'], [82, '85.326%'], [38, '']]),
    };

    if (systemTweaks) {
      const scrim = dark && pureBlackDark ? [0, 0, 0] : fromArgb(scheme.neutralPalette.tone(4));
      const toolbarFill = fromArgb(scheme.neutralPalette.tone(32));
      const toolbarInvisible = fromArgb(scheme.neutralPalette.tone(16));
      const toolbarHover = fromArgb(scheme.neutralPalette.tone(38));
      const glassBase = dark ? labelPrimary : surfaceLowest;
      values['--dsw-alias-label-on-color'] = tintedText ? fromArgb(primaryTextPalette.tone(98)) : [255, 255, 255];
      Object.assign(cssValues, {
        '--dsw-alias-bg-mask-1': rgbaCss(scrim, dark ? 0.5 : 0.24),
        '--dsw-alias-bg-mask-2': rgbaCss(scrim, dark ? 0.2 : 0.12),
        '--dsw-alias-bg-mask-3': rgbaCss(scrim, 0.48),
        '--dsw-alias-bg-mask-photo': rgbaCss(scrim, 0.88),
        '--dsw-alias-bg-mask-drop': rgbaCss(baseSurface, 0.72),
        '--dsw-alias-button-tool-bar-fill': rgbaCss(toolbarFill, 0.5),
        '--dsw-alias-button-tool-bar-fill-invisible': rgbaCss(toolbarInvisible, 0.36),
        '--dsw-alias-button-tool-bar-hover': rgbaCss(toolbarHover, 0.62),
        '--dsw-specific-sidebar-glass-fill': rgbaCss(glassBase, dark ? 0.15 : 0.55),
        '--dsw-specific-sidebar-glass-hover': rgbaCss(glassBase, dark ? 0.2 : 0.3),
        '--dsw-specific-sidebar-glass-collapsed-fill': dark ? rgbaCss(glassBase, 0.15) : 'rgba(0, 0, 0, 0)',
        '--dsw-specific-sidebar-glass-collapsed-hover': dark ? rgbaCss(glassBase, 0.2) : rgbaCss(hover, 0.85),
        '--dsw-specific-sidebar-tint': rgbaCss(hover, dark ? 0.5 : 0.4),
        '--dsw-specific-sidebar-wash-top': rgbaCss(brand, dark ? 0.08 : 0.1),
        '--dsw-specific-sidebar-wash-top-clear': rgbaCss(brand, 0),
        '--dsw-specific-sidebar-wash-bottom': rgbaCss(tertiaryAccent, dark ? 0.07 : 0.09),
        '--dsw-specific-sidebar-wash-bottom-clear': rgbaCss(tertiaryAccent, 0),
      });
    }

    for (const [key, rgb] of Object.entries(values)) {
      tokens[key] ||= {};
      tokens[key][variant] = key === '--dsw-alias-bg-base' ? rgbaCss(rgb, alpha) : rgbCss(rgb);
    }
    for (const [key, css] of Object.entries(cssValues)) {
      tokens[key] ||= {};
      tokens[key][variant] = css;
    }
  }
  return tokens;
}
export function makeTokens(accent, strength = DEFAULTS.strength, mode = DEFAULTS.paletteMode, textColorMode = DEFAULTS.textColorMode, options = {}) {
  strength = normalizeStrength(strength);
  const fallback = [92, 116, 132];
  const selected = typeof mode === 'string' && PALETTE_MODES.includes(mode) ? mode : DEFAULTS.paletteMode;
  const textMode = typeof textColorMode === 'string' && TEXT_COLOR_MODES.includes(textColorMode) ? textColorMode : DEFAULTS.textColorMode;
  const opts = options && typeof options === 'object'
    ? { pureBlackDark: Boolean(options.pureBlackDark), systemTweaks: Boolean(options.systemTweaks) }
    : { pureBlackDark: DEFAULTS.pureBlackDark, systemTweaks: DEFAULTS.systemTweaks };
  // Decoded wallpapers provide per-mode candidates; accepting a single RGB
  // remains useful before the first image and for existing integrations.
  if (accent && !Array.isArray(accent) && !ArrayBuffer.isView(accent) && typeof accent === 'object') {
    accent = Object.hasOwn(accent, selected) ? accent[selected] : fallback;
  }
  const list = Array.isArray(accent) && Array.isArray(accent[0]) ? accent.slice(0, 5) : [accent];
  const candidates = list.map(rgb => (Array.isArray(rgb) || ArrayBuffer.isView(rgb)) && rgb.length >= 3
    ? fallback.map((value, i) => Number.isFinite(rgb[i]) ? Math.round(Math.max(0, Math.min(255, rgb[i]))) : value)
    : fallback);
  return themeTokens(candidates.length ? candidates : [fallback], strength, selected, textMode, opts);
}
