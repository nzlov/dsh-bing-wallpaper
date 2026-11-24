import { normalizeSidebar, SIDEBAR_COLOR_ROLE, SIDEBAR_TINT_ALPHA } from './sidebar-background.js';
import { wallpaperFilters } from './wallpaper-filter.js';
import { backgroundAlpha } from './wallpaper-visibility.js';

function brightness(red, green, blue) {
  return (.2126 * red + .7152 * green + .0722 * blue) / 255;
}

function tokenBrightness(color) {
  const [, red, green, blue] = color.match(/^rgba?\((\d+), (\d+), (\d+)/);
  return brightness(red, green, blue);
}

function wallpaperBackdrop(settings, color, visibility, themeTint = 0) {
  const effect = wallpaperFilters.effect(settings);
  const dim = Number(effect?.filter?.match(/^brightness\((\d+)%\)$/)?.[1] ?? 100) / 100;
  const filterTint = effect?.tint?.match(/^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/);
  const tint = filterTint ? Number(filterTint[4]) / 100 : 0;
  const tintBrightness = filterTint ? brightness(filterTint[1], filterTint[2], filterTint[3]) : 0;
  // Match the wallpaper's CSS layer order in display-space RGB.
  const visiblePhoto = (1 - backgroundAlpha(visibility)) * (1 - themeTint);
  return {
    photo: visiblePhoto * (1 - tint) * dim,
    matte: color * (1 - visiblePhoto) + tintBrightness * tint * visiblePhoto,
  };
}

export function weatherBackdrop(settings, tokens, scheme) {
  const sidebarColor = tokenBrightness(tokens[SIDEBAR_COLOR_ROLE][scheme]);
  const sidebarBackdrop = key => {
    const sidebar = normalizeSidebar(settings[key]);
    if (sidebar.background === 'theme') return { photo: 0, matte: sidebarColor };
    const filter = sidebar.filterMode === 'inherit' ? settings : sidebar;
    const visibility = sidebar.visibilityMode === 'custom' ? sidebar.visibility : settings.strength;
    return wallpaperBackdrop(filter, sidebarColor, visibility, sidebar.tint ? SIDEBAR_TINT_ALPHA : 0);
  };
  return {
    main: wallpaperBackdrop(settings, tokenBrightness(tokens['--dsw-alias-bg-base'][scheme]), settings.strength),
    left: sidebarBackdrop('leftSidebar'),
    right: sidebarBackdrop('rightSidebar'),
  };
}
