import { wallpaperFilters } from './wallpaper-filter.js';

export const SIDEBAR_COLOR_ROLE = '--dsw-specific-sidebar-fill';
export const SIDEBAR_TINT_ALPHA = .6;

export function sidebarColors(tokens, scheme) {
  const base = tokens[SIDEBAR_COLOR_ROLE][scheme];
  // The sidebar switch must remain effective at 100% main wallpaper visibility.
  return { base, matte: base.replace('rgb(', 'rgba(').replace(')', `, ${SIDEBAR_TINT_ALPHA})`) };
}

export function normalizeSidebar(input) {
  return {
    background: input?.background === 'theme' ? 'theme' : 'wallpaper',
    ...wallpaperFilters.normalize(input),
    filterMode: wallpaperFilters.modes.includes(input?.filterMode) ? input.filterMode : 'inherit',
    tint: typeof input?.tint === 'boolean' ? input.tint : true,
    toolbar: typeof input?.toolbar === 'boolean' ? input.toolbar : true,
  };
}

// DSH's renderer keeps a display:contents slot wrapper in the DOM. Anchor to
// that stable marker, not component nesting, CSS hashes or translated text.
const frame = 'body div:has(> [data-shell-overlay])';
const leftColumnChild = 'div:has(> [data-slot="sidebar"])';
const leftColumn = `${frame} > ${leftColumnChild}`;
const leftRoot = `${leftColumn} > [data-slot="sidebar"] > div`;
const rightPane = 'body [data-sidebar-right-panel] :is([data-dockkit-host="dock"] > [data-dockkit-pane], [data-dockkit-empty])';
const rightChrome = `${rightPane} [data-dockkit-strip]`;
const rightHeader = `${rightPane} > div:has(> [data-dockkit-strip])`;
export const SIDEBAR_SURFACES = `${leftColumn},${rightPane}`;

export function mountSidebarBackground(document, surface) {
  const layer = document.createElement('div');
  layer.setAttribute('data-bdt-sidebar-background', '');
  layer.setAttribute('aria-hidden', 'true');
  // Keep the decoration out of layout even before its stylesheet is mounted.
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.pointerEvents = 'none';
  const photo = document.createElement('div'), veil = document.createElement('div');
  photo.setAttribute('data-bdt-sidebar-image', '');
  veil.setAttribute('data-bdt-sidebar-veil', '');
  layer.append(photo, veil);
  surface.prepend(layer);
  return layer;
}

// The caller supplies a decoded image URL and the same visibility/readability
// overlays as the main wallpaper. Filter only the dedicated image element;
// never filter the pane, which can contain editors, iframes and fixed controls.
export function sidebarBackgroundCSS({ settings, image, overlays, matte, base = 'var(--dsw-alias-bg-layer-1)' }) {
  if (!settings.enabled || !image) return '';
  return ['leftSidebar', 'rightSidebar'].map(key => {
    const sidebar = normalizeSidebar(settings[key]), left = key === 'leftSidebar';
    const surface = left ? leftColumn : rightPane;
    const layer = `${surface} > [data-bdt-sidebar-background]`;
    const photo = `${layer} > [data-bdt-sidebar-image]`;
    const veil = `${layer} > [data-bdt-sidebar-veil]`;
    const header = left ? `${leftRoot} > [data-window-drag]` : `${rightHeader},${rightChrome}`;
    const toolbar = `${header}{background-color:${sidebar.toolbar ? 'transparent' : base}}`;
    // These anchors stay identical in solid and wallpaper modes, so switching
    // modes does not invalidate the background's measured viewport origin.
    const layout = left
      ? `${frame}:not([data-sidebar-drawer]) > ${leftColumnChild}{position:relative}${leftRoot}{position:relative;background:transparent}`
      : `${surface}{position:relative;isolation:isolate}`;
    const backing = `${surface}{background:${base}}${layout}${layer}{display:block;position:absolute;inset:0;z-index:${left ? 0 : -1};margin:0;padding:0;border:0;pointer-events:none;overflow:hidden;border-radius:inherit;isolation:isolate;visibility:hidden}`;
    // Native scroll fades use sidebar-fill; do not leave an unrelated solid
    // band above either the wallpaper or the custom solid-theme background.
    const clear = left ? `${surface}{--dsw-specific-sidebar-fill:transparent}` : `
${rightPane} > :is(div, [data-dockkit-pane]),
${rightPane} :is([data-dockkit-strip], [data-dockkit-strip-tabs], [data-dockkit-strip-fill], [data-dockkit-strip-chrome]){background-color:transparent}
`;
    if (sidebar.background === 'theme') {
      const selectors = left ? `${surface},${leftRoot}` : surface;
      const solid = `${selectors}{background:${base}}`;
      return backing + solid + clear + toolbar;
    }
    const look = wallpaperFilters.effect(sidebar.filterMode === 'inherit' ? settings : sidebar);
    const layers = sidebar.tint && matte ? [matte, ...overlays] : [...overlays];
    if (look?.tint) layers.push(look.tint);
    const bleed = look?.bleed || 0;
    // The moving pane never paints an unfiltered fallback photo. Its image
    // owns the filter, while the veil and theme tint travel in the same layer.
    // Dedicated elements also leave Dockkit's ::after reveal flash untouched.
    const picture = `${photo}{position:absolute;inset:${bleed ? `-${bleed}px` : '0'};z-index:0;pointer-events:none;background:${image} no-repeat;background-size:var(--bdt-wallpaper-size,cover);background-position:calc(var(--bdt-wallpaper-x,0px) + ${bleed}px) calc(var(--bdt-wallpaper-y,0px) + ${bleed}px);filter:${look?.filter || 'none'}}`;
    const scrim = `${veil}{position:absolute;inset:0;z-index:1;pointer-events:none;background-image:${layers.map(color => `linear-gradient(${color},${color})`).join(',')}}`;
    return `${backing}${layer}{visibility:inherit}${picture}${scrim}${clear}${toolbar}`;
  }).join('');
}
