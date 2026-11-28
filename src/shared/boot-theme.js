// Dependency-free bridge for the interval before Client plugins can run.
import { createWallpaperFilters, wallpaperFilters } from './wallpaper-filter.js';

export const PREFERENCES_KEY = 'dsh.bing-daily-theme.preferences.v1';
export const BOOT_CACHE_KEY = 'dsh.bing-daily-theme.boot.v1';
export const BOOT_STYLE_ID = 'bdt-boot-theme';

export function makeBootCache(settings, tokens, imageUrl, accent) {
  if (!settings.enabled || !settings.dynamic) return null;
  const keys = {
    background: '--dsw-alias-bg-layer-1', primary: '--dsw-alias-label-primary',
    secondary: '--dsw-alias-label-secondary', tertiary: '--dsw-alias-label-tertiary',
    border: '--dsw-alias-border-l2', brand: '--dsw-alias-brand-primary',
  };
  const colors = {};
  for (const scheme of ['light', 'dark']) {
    colors[scheme] = Object.fromEntries(Object.entries(keys).map(([role, key]) => [role, tokens[key][scheme]]));
  }
  return { version: 3, market: settings.market || 'zh-CN', resolution: settings.resolution || '1080p', paletteMode: settings.paletteMode, textColorMode: settings.textColorMode || 'theme', pureBlackDark: Boolean(settings.pureBlackDark), strength: settings.strength, colors, imageUrl, accent };
}

// This pure function is also embedded verbatim in the Host's early script.
// All persisted values are untrusted: no arbitrary CSS or URL interpolation.
export function bootThemeCSS(settings, cache, now, systemDark, followDark, renderFilter = wallpaperFilters.css) {
  settings ??= { enabled: true, dynamic: true, paletteMode: 'content', textColorMode: 'theme', pureBlackDark: false, mode: 'schedule', day: '07:00', night: '19:00', strength: 28 };
  if (!settings || settings.enabled !== true || settings.dynamic !== true || !cache || cache.version !== 3
      || cache.paletteMode !== settings.paletteMode
      || (cache.textColorMode ?? 'theme') !== (settings.textColorMode ?? 'theme')
      || Boolean(cache.pureBlackDark) !== Boolean(settings.pureBlackDark)
      || cache.strength !== settings.strength
      || !['zh-CN', 'en-US'].includes(settings.market ?? 'zh-CN') || (cache.market ?? 'zh-CN') !== (settings.market ?? 'zh-CN')
      || !['1080p', '2k', '4k'].includes(settings.resolution ?? '1080p') || (cache.resolution ?? '1080p') !== (settings.resolution ?? '1080p')
      || !Number.isFinite(settings.strength) || settings.strength < 10 || settings.strength > 100) return '';
  // Follow stays selector-driven: structured row activation order may change
  // after a Host plugin reload, and the native body selector is authoritative.
  if (settings.mode === 'follow' && typeof followDark !== 'boolean') {
    return bootThemeCSS(settings, cache, now, systemDark, false, renderFilter).replaceAll('[data-dsh-boot]', 'body:not([data-ds-dark-theme]) [data-dsh-boot]')
      + bootThemeCSS(settings, cache, now, systemDark, true, renderFilter).replaceAll('[data-dsh-boot]', 'body[data-ds-dark-theme] [data-dsh-boot]');
  }
  let dark;
  if (settings.mode === 'schedule') {
    const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (!time(settings.day) || !time(settings.night) || settings.day === settings.night) return '';
    const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const start = minutes(settings.day), end = minutes(settings.night);
    const current = now.getHours() * 60 + now.getMinutes();
    dark = !(start < end ? current >= start && current < end : current >= start || current < end);
  } else if (settings.mode === 'system') dark = systemDark;
  else if (settings.mode === 'follow') dark = followDark;
  else if (settings.mode === 'light' || settings.mode === 'dark') dark = settings.mode === 'dark';
  else return '';
  const colors = cache.colors?.[dark ? 'dark' : 'light'];
  const roles = ['background', 'primary', 'secondary', 'tertiary', 'border', 'brand'];
  if (!colors || !roles.every(role => {
    if (typeof colors[role] !== 'string') return false;
    const match = /^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/.exec(colors[role]);
    return match && match.slice(1).every(channel => Number(channel) <= 255);
  })) return '';
  // The opaque backing also works when the in-memory image cache is empty.
  // Never store blob URLs or request an arbitrary cached URL at startup.
  const url = cache.imageUrl;
  const alpha = (100 - Math.round(settings.strength)) / 100;
  const matte = colors.background.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  const resolution = settings.resolution ?? '1080p';
  const imageMatch = typeof url === 'string' && url.length <= 300
    && /^\/bing-daily-theme\/api\/image\?(market=en-US&)?(?:resolution=(2k|4k)&)?id=OHR\.[A-Za-z0-9][A-Za-z0-9_-]*_1920x1080\.jpg$/.exec(url);
  const photo = imageMatch && Boolean(imageMatch[1]) === (settings.market === 'en-US')
    && (imageMatch[2] || '1080p') === resolution ? `url("${url}")` : '';
  const filter = renderFilter({ selector: '[data-dsh-boot]', image: photo, overlays: [matte], settings, fixed: true });
  return `[data-dsh-boot]{--dsw-alias-bg-base:${colors.background};--dsw-alias-label-primary:${colors.primary};--dsw-alias-label-secondary:${colors.secondary};--dsw-alias-label-tertiary:${colors.tertiary};--dsw-alias-border-l2:${colors.border};--dsw-alias-brand-primary:${colors.brand};background-color:${colors.background}!important;background-image:none!important;isolation:isolate;color-scheme:${dark ? 'dark' : 'light'}}${filter}`;
}

// No network await, timer, observer, global preference or body-style writes.
function startBootTheme(preferencesKey, cacheKey, styleId, resolveCSS, createFilters) {
  try {
    const css = resolveCSS(JSON.parse(localStorage.getItem(preferencesKey)), JSON.parse(localStorage.getItem(cacheKey)),
      new Date(), typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches, undefined, createFilters().css);
    if (!css) return;
    document.getElementById(styleId)?.remove();
    const style = document.createElement('style');
    style.id = styleId; style.textContent = css; document.head.append(style);
  } catch { /* Storage denial or damaged cache must never block shell startup. */ }
}

export function bootThemeInjection() {
  const text = `;(${startBootTheme.toString()})(${JSON.stringify(PREFERENCES_KEY)},${JSON.stringify(BOOT_CACHE_KEY)},${JSON.stringify(BOOT_STYLE_ID)},${bootThemeCSS.toString()},${createWallpaperFilters.toString()});`;
  return { kind: 'script', placement: 'body', text };
}
