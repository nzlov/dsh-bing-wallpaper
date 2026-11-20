import {
  Hct, argbFromRgb, redFromArgb, greenFromArgb, blueFromArgb,
  SchemeContent, SchemeTonalSpot, SchemeFruitSalad, SchemeRainbow, SchemeMonochrome,
} from '@material/material-color-utilities';
import { makeCustomSchemes } from './custom-palette.js';
import { wallpaperFilters } from './wallpaper-filter.js';
import { normalizeSidebar } from './sidebar-background.js';
import { DEFAULT_STRENGTH, normalizeStrength, backgroundAlpha } from './wallpaper-visibility.js';

export { extractImagePalettes } from './image-palette.js';
export { normalizeStrength, backgroundAlpha } from './wallpaper-visibility.js';

// Pure image-colour and scheduling logic; shared by browser bundle and tests.
export const PALETTE_MODES = Object.freeze(['content', 'tonal-spot', 'fruit-salad', 'rainbow', 'monochrome', 'vibrant', 'faithful', 'soft', 'dysfunctional', 'muted']);
const { filterMode, filterAmounts } = wallpaperFilters.normalize();
const sidebarDefaults = () => {
  const sidebar = normalizeSidebar();
  return Object.freeze({ ...sidebar, filterAmounts: Object.freeze(sidebar.filterAmounts) });
};
export const DEFAULTS = Object.freeze({
  enabled: true, dynamic: true, market: 'zh-CN', paletteMode: 'content', mode: 'schedule', day: '07:00', night: '19:00', strength: DEFAULT_STRENGTH,
  filterMode, filterAmounts: Object.freeze(filterAmounts), leftSidebar: sidebarDefaults(), rightSidebar: sidebarDefaults(),
});
export function normalizeSettings(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
    dynamic: typeof input.dynamic === 'boolean' ? input.dynamic : true,
    market: ['zh-CN', 'en-US'].includes(input.market) ? input.market : DEFAULTS.market,
    paletteMode: PALETTE_MODES.includes(input.paletteMode) ? input.paletteMode : DEFAULTS.paletteMode,
    mode: ['follow', 'schedule', 'system', 'light', 'dark'].includes(input.mode) ? input.mode : 'schedule',
    day: time(input.day) ? input.day : DEFAULTS.day,
    night: time(input.night) ? input.night : DEFAULTS.night,
    strength: normalizeStrength(input.strength),
    ...wallpaperFilters.normalize(input),
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
  const linear = rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
const MATERIAL_SCHEMES = Object.freeze({
  content: SchemeContent, 'tonal-spot': SchemeTonalSpot, 'fruit-salad': SchemeFruitSalad,
  rainbow: SchemeRainbow, monochrome: SchemeMonochrome,
});
const schemeCache = new Map();
const fromArgb = argb => [redFromArgb(argb), greenFromArgb(argb), blueFromArgb(argb)];
const rgbCss = rgb => `rgb(${rgb.join(', ')})`;
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
function themeTokens(candidates, strength, mode) {
  const tokens = {}, alpha = backgroundAlpha(strength);
  for (const [i, scheme] of schemesFor(candidates, mode).entries()) {
    const dark = i === 1, variant = dark ? 'dark' : 'light';
    const values = {
      '--dsw-alias-bg-base': fromArgb(scheme.surface),
      '--dsw-alias-bg-layer-1': fromArgb(scheme.surfaceContainerLow),
      '--dsw-alias-bg-layer-2': fromArgb(scheme.surfaceContainer),
      '--dsw-specific-sidebar-fill': fromArgb(scheme.surfaceContainerHigh),
      '--dsw-alias-border-l1': fromArgb(scheme.outlineVariant),
      '--dsw-alias-border-l2': fromArgb(scheme.outline),
    };
    // DSH exposes one brand role, so carry the semantic secondary and tertiary
    // containers into selected and sidebar surfaces without recoloring states.
    const tint = (base, role, amount) => base.map((v, channel) => Math.round(v * (1 - amount) + role[channel] * amount));
    values['--dsw-alias-bg-layer-2'] = tint(values['--dsw-alias-bg-layer-2'], fromArgb(scheme.secondaryContainer), .08);
    values['--dsw-specific-sidebar-fill'] = tint(values['--dsw-specific-sidebar-fill'], fromArgb(scheme.tertiaryContainer), .18);
    const surface = values['--dsw-alias-bg-layer-1'];
    const selected = tint(values['--dsw-alias-bg-layer-2'], fromArgb(scheme.secondaryContainer), .20);
    // Lowest is tone 100 (pure white) in M3 light schemes: using it for the
    // shared menu/TodoPanel fill made correctly inherited tokens look unthemed.
    // Keep elevated reading panels opaque, gently tinted and independent of the
    // wallpaper alpha. A stronger hover tint preserves menu-item feedback.
    values['--dsw-alias-bg-overlay'] = tint(surface, fromArgb(scheme.secondaryContainer), .04);
    const hover = tint(surface, fromArgb(scheme.secondaryContainer), .24);
    const surfaceAliases = {
      '--dsw-alias-bg-layer-3': selected,
      '--dsw-alias-bg-module-platform': selected,
      '--dsw-alias-bg-multi-select': selected,
      '--dsw-alias-card-fill': surface,
      '--dsw-alias-card-fill-hover': hover,
      '--dsw-alias-card-tile-fill': surface,
      '--dsw-alias-onboarding-card-fill': surface,
      '--dsw-alias-onboarding-secondary-fill': values['--dsw-alias-bg-layer-2'],
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
      '--dsw-menu-surface-fill': values['--dsw-alias-bg-overlay'],
      '--dsw-alias-menu-group-header-fill': surface,
      '--dsw-specific-menu': values['--dsw-alias-bg-overlay'],
      '--dsw-specific-input-major': surface,
      '--dsw-specific-login-input': values['--dsw-alias-bg-layer-2'],
      '--dsw-specific-selector': selected,
      '--dsw-specific-tip': surface,
      '--dsw-specific-sidebar-nav-item-active': selected,
      '--dsw-specific-sidebar-nav-item-active-accent': selected,
      '--dsw-specific-bubble': values['--dsw-alias-bg-layer-2'],
      '--dsw-specific-bubble-highlight': selected,
      '--dsw-alias-markdown-code-block': values['--dsw-alias-bg-layer-2'],
      '--dsw-alias-markdown-code-block-banner': surface,
      '--dsw-alias-markdown-inline-code': values['--dsw-alias-bg-layer-2'],
      '--dsw-alias-markdown-code-segment-selected': surface,
      '--dsw-alias-markdown-code-segment-unselected': values['--dsw-alias-bg-layer-2'],
      '--dsw-alias-markdown-placeholder': selected,
      '--dsw-alias-markdown-tag': selected,
      '--dsw-alias-markdown-citation': selected,
    };
    Object.assign(values, surfaceAliases);
    // An unmasked photo can contain every luminance; no single foreground can
    // guarantee contrast over it. Keep opaque controls and panels readable.
    const backgrounds = [surface, values['--dsw-alias-bg-layer-2'], values['--dsw-alias-bg-overlay'], values['--dsw-specific-sidebar-fill'], selected, hover];
    const accessible = (palette, start, minimum = 4.6) => {
      let tone = Math.round(start);
      while (backgrounds.some(bg => contrast(fromArgb(palette.tone(tone)), bg) < minimum) && tone > 0 && tone < 100) tone += dark ? 1 : -1;
      return fromArgb(palette.tone(tone));
    };
    const brand = accessible(scheme.primaryPalette, Hct.fromInt(scheme.primary).tone);
    const brandHover = fromArgb(scheme.primaryPalette.tone(Math.max(0, Math.min(100, Hct.fromInt(argbFromRgb(...brand)).tone + (dark ? 7 : -7)))));
    const onBrand = [[0, 0, 0], [255, 255, 255]].sort((a, b) => Math.min(contrast(b, brand), contrast(b, brandHover)) - Math.min(contrast(a, brand), contrast(a, brandHover)))[0];
    values['--dsw-alias-brand-primary'] = brand;
    values['--dsw-alias-label-primary'] = accessible(scheme.neutralPalette, Hct.fromInt(scheme.onSurface).tone);
    values['--dsw-alias-label-secondary'] = accessible(scheme.neutralVariantPalette, Hct.fromInt(scheme.onSurfaceVariant).tone);
    const caption = accessible(scheme.neutralVariantPalette, dark ? 70 : 50);
    for (const key of ['--dsw-alias-label-tertiary', '--dsw-alias-label-caption', '--dsw-alias-label-dimmed']) values[key] = caption;
    for (const key of ['--dsw-alias-brand-text', '--dsw-alias-brand-primary-new-colorprimary-new-color', '--dsw-alias-link']) values[key] = brand;
    for (const key of ['--dsw-alias-label-primary-bluish', '--dsw-alias-label-primary-dimmed', '--dsw-alias-menu-icon']) values[key] = values['--dsw-alias-label-primary'];
    for (const key of ['--dsw-alias-button-primary-fill', '--dsw-alias-button-contrast-fill']) values[key] = brand;
    values['--dsw-alias-button-primary-hover'] = brandHover;
    // on-color is shared with semantic controls: preserve its default white and
    // give info/send buttons independent dark accent fills in both schemes.
    values['--dsw-alias-button-info-fill'] = fromArgb(scheme.primaryPalette.tone(35));
    values['--dsw-alias-button-info-hover'] = fromArgb(scheme.primaryPalette.tone(28));
    for (const key of ['--dsw-alias-label-primary-foreground', '--dsw-alias-label-primary-inverted']) values[key] = onBrand;
    values['--dsw-focus-ring-color'] = brand;
    values['--dsw-alias-border-l2'] = accessible(scheme.neutralVariantPalette, dark ? 60 : 50, 3.1);
    for (const key of ['--dsw-alias-border-selected', '--dsw-alias-button-ghost-active-border']) values[key] = brand;
    for (const key of ['--dsw-alias-border-l3', '--dsw-alias-border-l4', '--dsw-alias-border-l2-darkmode-thin', '--dsw-alias-onboarding-checkbox-border', '--dsw-alias-scrollbar-bg-l1', '--dsw-alias-scrollbar-bg-l2']) values[key] = values['--dsw-alias-border-l2'];
    for (const key of ['--dsw-alias-scrollbar-hover-l1', '--dsw-alias-scrollbar-hover-l2']) values[key] = brand;
    // The off switch uses border-l3 as its track. The stock dark thumb is too
    // close to our readable outline: pair it with the track, not the page fill.
    const track = values['--dsw-alias-border-l3'];
    values['--dsw-alias-switch-thumb'] = contrast([0, 0, 0], track) > contrast([255, 255, 255], track) ? [0, 0, 0] : [255, 255, 255];
    // Inverse informational surfaces stay dark in BOTH schemes. Never reuse
    // ordinary light-mode text or change the shared semantic on-color token.
    // Leave headroom for the stock red hovercard state after RGB rounding.
    const inverse = fromArgb(scheme.neutralPalette.tone(14));
    const inverseInk = fromArgb(scheme.neutralPalette.tone(98));
    for (const key of ['--dsw-alias-tooltip-bg', '--dsw-alias-toast-bg', '--dsw-alias-hovercard-bg']) values[key] = inverse;
    for (const key of ['--dsw-alias-tooltip-label', '--dsw-alias-toast-label', '--dsw-alias-hovercard-label-primary']) values[key] = inverseInk;
    values['--dsw-alias-tooltip-key-bg'] = tint(inverse, [255, 255, 255], .18);
    values['--dsw-alias-toast-action'] = fromArgb(scheme.primaryPalette.tone(80));
    values['--dsw-alias-hovercard-label-secondary'] = fromArgb(scheme.neutralPalette.tone(85));
    values['--dsw-alias-hovercard-label-tertiary'] = fromArgb(scheme.neutralPalette.tone(78));
    for (const [key, rgb] of Object.entries(values)) {
      tokens[key] ||= {};
      tokens[key][variant] = key === '--dsw-alias-bg-base' ? `rgba(${rgb.join(', ')}, ${alpha})` : rgbCss(rgb);
    }
  }
  return tokens;
}
export function makeTokens(accent, strength = DEFAULTS.strength, mode = DEFAULTS.paletteMode) {
  strength = normalizeStrength(strength);
  const fallback = [92, 116, 132];
  const selected = typeof mode === 'string' && PALETTE_MODES.includes(mode) ? mode : DEFAULTS.paletteMode;
  // Decoded wallpapers provide per-mode candidates; accepting a single RGB
  // remains useful before the first image and for existing integrations.
  if (accent && !Array.isArray(accent) && !ArrayBuffer.isView(accent) && typeof accent === 'object') {
    accent = Object.hasOwn(accent, selected) ? accent[selected] : fallback;
  }
  const list = Array.isArray(accent) && Array.isArray(accent[0]) ? accent.slice(0, 5) : [accent];
  const candidates = list.map(rgb => (Array.isArray(rgb) || ArrayBuffer.isView(rgb)) && rgb.length >= 3
    ? fallback.map((value, i) => Number.isFinite(rgb[i]) ? Math.round(Math.max(0, Math.min(255, rgb[i]))) : value)
    : fallback);
  return themeTokens(candidates.length ? candidates : [fallback], strength, selected);
}
