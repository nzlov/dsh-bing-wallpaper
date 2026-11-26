// Bundled by scripts/build.mjs. No runtime imports except the shared React instance.
import { PREFERENCES_KEY, BOOT_CACHE_KEY, BOOT_STYLE_ID, makeBootCache } from '../shared/boot-theme.js';
import { MARKETPLACE_THEME_CSS, SHELL_WALLPAPER_CSS, SYSTEM_TWEAKS_CSS, pluginPageCSS } from './compatibility.js';
import { wallpaperFilters } from '../shared/wallpaper-filter.js';
import { sidebarBackgroundCSS, sidebarColors, mountSidebarBackground, SIDEBAR_SURFACES } from './wallpaper/sidebar-background.js';
import { createWeatherController, customEndpoint, WEATHER_PROVIDERS } from './weather/weather.js';
import { createWeatherPane, PRECIPITATION_CANVAS, WEATHER_EFFECTS, WEATHER_LAYOUT_CSS, weatherLooks } from './weather/weather-effects.js';
import { weatherBackdrop } from './weather/weather-backdrop.js';
import { createWeatherEngine } from './weather/precipitation.js';
import { FACING_BEARINGS } from './weather/window-light.js';
import { alignWallpaper } from './wallpaper/wallpaper-alignment.js';
import { mountParallaxWallpaper, depthUrlFor } from './wallpaper/wallpaper-parallax.js';
import { renderPaletteMiniature, PALETTE_PREVIEW_CSS } from './theme/palette-preview.js';

const weatherChoices = ['off', 'location', ...WEATHER_EFFECTS];

function activeWeatherEffect({ settings, observation }) {
  if (!settings.enabled) return null;
  const { mode, effect } = settings.weather;
  if (mode === 'fixed') return effect;
  return mode === 'location' ? observation?.effect ?? null : null;
}

export function createPlugin(React, core, dictionaries, createAppearanceController) {
  const h = React.createElement, NS = 'bing-daily-theme', SOURCE = '@nzlov/dsh-bing-wallpaper';
  const KEY = PREFERENCES_KEY;
  return {
    inject: ['slots', 'theme', 'locale'],
    apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, 'en', dictionaries.en));
      ctx.effect(() => ctx.locale.register(NS, 'zh', dictionaries.zh));
      const t = ctx.locale.bind(NS);
      let settings;
      try { settings = core.normalizeSettings(JSON.parse(localStorage.getItem(KEY) || '{}')); }
      catch { settings = core.normalizeSettings(); }
      let state = { settings, busy: false, issue: '', meta: null, url: '', accent: [92, 116, 132], scheme: ctx.theme.getTheme().active.colorScheme, storageIssue: false };
      const listeners = new Set();
      const publish = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
      const weather = createWeatherController(publish);
      const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
      const useState = () => React.useSyncExternalStore(subscribe, () => state);
      let alive = true, tokenDisposer, controller, activeUrl = '';
      const appearance = createAppearanceController(ctx.theme, () => {
        settings = { ...settings, mode: 'follow' }; save(); publish({ settings });
      }, core.scheduledScheme);
      let lastCheck = 0, lastDay = '', generation = 0, updateWindowLight;
      function save() {
        let storageIssue = false;
        try { localStorage.setItem(KEY, JSON.stringify(settings)); }
        catch { storageIssue = true; }
        if (state.storageIssue !== storageIssue) publish({ storageIssue });
      }
      function restoreTheme() { appearance.restore(); }
      function syncMode() { appearance.sync(settings); }
      function syncTokens() {
        if (!settings.enabled || !settings.dynamic || (state.meta && state.meta.market !== settings.market) || (state.meta && (state.meta.resolution || '1080p') !== settings.resolution)) {
          try { localStorage.removeItem(BOOT_CACHE_KEY); } catch { /* Best-effort startup cache only. */ }
        }
        if (!settings.enabled || !state.url) { tokenDisposer?.(); tokenDisposer = undefined; return; }
        const tokens = core.makeTokens(settings.dynamic ? state.accent : [112, 112, 112], settings.strength, settings.dynamic ? settings.paletteMode : 'monochrome', settings.dynamic ? settings.textColorMode : 'theme', settings.dynamic ? { pureBlackDark: settings.pureBlackDark, systemTweaks: settings.systemTweaks } : {});
        if (!settings.dynamic) for (const key of Object.keys(tokens)) if (key !== '--dsw-alias-bg-base') delete tokens[key];
        const previous = tokenDisposer;
        tokenDisposer = ctx.theme.overrideTokens(SOURCE, tokens);
        previous?.();
        if (settings.dynamic && state.meta?.market === settings.market && (state.meta?.resolution || '1080p') === settings.resolution) {
          try { localStorage.setItem(BOOT_CACHE_KEY, JSON.stringify(makeBootCache(settings, tokens, state.meta?.imageUrl))); }
          catch { /* Palette persistence must not break wallpaper or theme application. */ }
        }
      }
      function update(patch, persist = true) {
        const next = core.normalizeSettings({ ...settings, ...patch });
        const backgroundOnly = Object.keys(next).every(key => ['filterMode', 'filterAmounts', 'parallaxStrength', 'leftSidebar', 'rightSidebar', 'weather'].includes(key) || next[key] === settings[key]);
        if (!backgroundOnly && next.day === next.night) { publish({ issue: 'sameTime' }); return; }
        if (JSON.stringify(next) === JSON.stringify(settings)) return;
        const weatherChanged = next.enabled !== settings.enabled || JSON.stringify(next.weather) !== JSON.stringify(settings.weather);
        // Local background controls can update without reloading the photo or theme.
        if (backgroundOnly) {
          settings = next; if (persist) save(); publish({ settings });
          if (weatherChanged) void weather.sync(settings);
          return;
        }
        const wasEnabled = settings.enabled, sourceChanged = next.market !== settings.market || next.resolution !== settings.resolution;
        if (sourceChanged) {
          // Invalidate even a request still decoding: a slow old source must not
          // overwrite a newer choice. Keep its displayed photo until success.
          generation++; controller?.abort(); lastCheck = 0; lastDay = ''; publish({ busy: false });
        }
        if (next.mode !== settings.mode || !next.enabled) restoreTheme();
        settings = next; if (persist) save(); publish({ settings, issue: '' }); syncTokens(); syncMode();
        if (weatherChanged) void weather.sync(settings);
        if (!settings.enabled) { generation++; controller?.abort(); publish({ busy: false }); }
        else if (!wasEnabled || sourceChanged) void refresh();
      }
      async function decode(blob, signal) {
        const url = URL.createObjectURL(blob), image = new Image();
        let onAbort;
        try {
          signal.throwIfAborted();
          image.src = url;
          await Promise.race([image.decode(), new Promise((_, reject) => {
            onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
            signal.addEventListener('abort', onAbort, { once: true });
          })]);
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const naturalWidth = image.naturalWidth || 112, naturalHeight = image.naturalHeight || 112;
          const scale = Math.min(1, 3840 / Math.max(naturalWidth, naturalHeight));
          const width = Math.max(1, Math.round(naturalWidth * scale));
          const height = Math.max(1, Math.round(naturalHeight * scale));
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('Canvas unavailable');
          context.drawImage(image, 0, 0, width, height);
          const accent = core.extractImagePalettes(context.getImageData(0, 0, width, height).data, width, height);
          return { url, accent, photo: image, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight };
        } catch (error) { URL.revokeObjectURL(url); throw error; }
        finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
      }
      async function refresh() {
        if (!alive || !settings.enabled || state.busy) return;
        const current = ++generation, market = settings.market, resolution = settings.resolution;
        const requestController = new AbortController(); controller = requestController;
        const signal = requestController.signal, timeout = setTimeout(() => requestController.abort(), 30000);
        publish({ busy: true, issue: '' }); lastCheck = Date.now();
        let decoded;
        try {
          const response = await fetch(`/bing-daily-theme/api/daily?market=${market}${resolution === '1080p' ? '' : `&resolution=${resolution}`}`, { signal, credentials: 'same-origin', cache: 'no-store' });
          if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
          const meta = await response.json();
          const marketPrefix = market === 'en-US' ? 'market=en-US&' : '';
          const resPrefix = resolution === '1080p' ? '' : `resolution=${resolution}&`;
          const expectedImage = new RegExp(`^\\/bing-daily-theme\\/api\\/image\\?${marketPrefix}${resPrefix}id=OHR\\.[A-Za-z0-9][A-Za-z0-9_-]*_1920x1080\\.jpg$`);
          if (meta.market !== market || (meta.resolution || '1080p') !== resolution || typeof meta.imageUrl !== 'string' || meta.imageUrl.length > 300 || !expectedImage.test(meta.imageUrl)) throw new Error('Invalid wallpaper source or URL');
          if (!state.meta || meta.imageUrl !== state.meta.imageUrl || !state.url) {
            const image = await fetch(meta.imageUrl, { signal, credentials: 'same-origin' });
            if (!image.ok) throw new Error(`Image HTTP ${image.status}`);
            const blob = await image.blob();
            if (blob.size > 20 * 1024 * 1024 || !blob.type.startsWith('image/')) throw new Error('Invalid wallpaper image');
            decoded = await decode(blob, signal);
          }
          if (!alive || current !== generation) { if (decoded) URL.revokeObjectURL(decoded.url); return; }
          const oldUrl = activeUrl;
          if (decoded) activeUrl = decoded.url;
          publish({ meta, ...(decoded || {}), issue: meta.stale ? 'stale' : '' });
          syncTokens();
          if (oldUrl && oldUrl !== activeUrl) URL.revokeObjectURL(oldUrl);
          lastDay = core.localDate();
        } catch (error) {
          if (alive && current === generation) publish({ issue: state.url ? (state.meta?.market !== market || (state.meta?.resolution || '1080p') !== resolution) ? 'sourceFailed' : 'fetchFailed' : 'firstFetchFailed' });
        } finally {
          clearTimeout(timeout);
          if (alive && current === generation) publish({ busy: false });
        }
      }
      function tick() {
        syncMode();
        updateWindowLight?.();
        if (settings.enabled && (core.localDate() !== lastDay || state.meta?.market !== settings.market || (state.meta?.resolution || '1080p') !== settings.resolution || ['fetchFailed', 'firstFetchFailed', 'sourceFailed', 'stale'].includes(state.issue) || Date.now() - lastCheck >= 3600000) && Date.now() - lastCheck >= 60000) void refresh();
      }
      ctx.on('theme/change', snapshot => {
        publish({ scheme: snapshot.active.colorScheme });
        appearance.changed(snapshot);
      });
      function useLocale() {
        React.useSyncExternalStore(fn => ctx.locale.subscribe(fn), () => ctx.locale.getSnapshot());
      }
      const css = `
.bdt-page{max-width:720px;padding:24px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
.bdt-page h2{font-size:20px;margin:0 0 16px;font-weight:600}.bdt-page p{margin:6px 0 18px;color:var(--dsw-alias-label-secondary)}
.bdt-photo{position:relative;margin:0;overflow:hidden;border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.bdt-preview{position:relative;overflow:hidden;width:100%;aspect-ratio:16/9;min-height:240px;background:var(--dsw-alias-bg-layer-2)}
.bdt-preview-image{position:absolute;inset:0;width:100%;height:100%;display:block;object-fit:cover;max-width:none}
.bdt-card{padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);margin:16px 0}
.bdt-card>h3{margin:0;padding-bottom:8px;font-size:16px;font-weight:600}
.bdt-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 0;flex-wrap:wrap}
:is(.bdt-card,.bdt-weather-form)>:not(:last-child),.bdt-sidebar-group[open]>summary,.bdt-sidebar-group .bdt-row:not(:last-child){border-bottom:1px solid var(--dsw-alias-border-l1)}
.bdt-control{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.bdt-page select,.bdt-page input:is([type=time],[type=text],[type=url],[type=number]),.bdt-page button{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;min-height:36px;max-width:100%}
.bdt-weather-form input{box-sizing:border-box;width:16rem}.bdt-weather-form input[type=number]{width:8rem}.bdt-weather-form .bdt-control{max-width:100%}
.bdt-weather-actions{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:12px 0}.bdt-weather-summary{display:flex;align-items:center;gap:4px 10px;flex-wrap:wrap;overflow-wrap:anywhere}
.bdt-page button{cursor:pointer}.bdt-page button:disabled{cursor:wait;opacity:.55}.bdt-page :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}.bdt-page input{accent-color:var(--dsw-alias-brand-primary)}
.bdt-page .bdt-wallpaper-select{box-sizing:border-box;width:12rem;min-height:44px}.bdt-filter-range{width:12rem;max-width:100%;min-width:0;min-height:44px}.bdt-control output{flex:0 0 5ch;min-width:5ch;white-space:nowrap;text-align:end;font-variant-numeric:tabular-nums}
.bdt-page a{color:var(--dsw-alias-brand-primary)}.bdt-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.bdt-field-hint{margin:-4px 0 12px}.bdt-swatches{display:flex;gap:8px;margin-top:10px}.bdt-swatch{width:24px;height:24px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2)}
.bdt-photo-caption{position:absolute;inset:auto 0 0;max-height:calc(100% - 64px);overflow:auto;padding:30px 16px 14px;color:var(--dsw-alias-tooltip-label);background:linear-gradient(to bottom,transparent,color-mix(in srgb,var(--dsw-alias-tooltip-bg) 82%,transparent) 26px,color-mix(in srgb,var(--dsw-alias-tooltip-bg) 90%,transparent));font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.bdt-photo-heading{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px}.bdt-photo-heading strong{min-width:0;font-size:14px}.bdt-photo-date{white-space:nowrap}.bdt-photo-details{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:5px}.bdt-page .bdt-photo-caption a{min-width:0;color:inherit;text-underline-offset:2px}.bdt-photo-caption .bdt-swatches{flex-shrink:0;margin:0;gap:6px}.bdt-photo-caption .bdt-swatch{width:20px;height:20px;border-color:color-mix(in srgb,var(--dsw-alias-tooltip-label) 55%,transparent)}
.bdt-page .bdt-photo-refresh{position:absolute;top:12px;inset-inline-end:12px;display:flex;align-items:center;justify-content:center;width:44px;height:44px;min-height:44px;padding:0;border-radius:50%;border:1px solid color-mix(in srgb,var(--dsw-alias-tooltip-label) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-tooltip-bg) 86%,transparent);color:var(--dsw-alias-tooltip-label)}.bdt-photo-refresh svg{width:20px;height:20px}.bdt-page .bdt-photo-refresh:disabled{cursor:not-allowed}.bdt-page .bdt-photo-refresh[aria-busy=true]{cursor:wait}.bdt-page .bdt-photo-refresh:focus-visible{outline-color:var(--dsw-alias-tooltip-label);box-shadow:0 0 0 5px var(--dsw-alias-tooltip-bg)}.bdt-photo-refresh[aria-busy=true] svg{animation:bdt-refresh-spin 1s linear infinite}.bdt-photo-status{display:block;margin:8px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}
@keyframes bdt-refresh-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.bdt-photo-refresh[aria-busy=true] svg{animation:none}}
.bdt-palette-group{min-width:0;padding:12px 0;margin:0;border:0}.bdt-palette-group legend{padding:0;font:inherit}
.bdt-palette-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px;margin-top:12px}
.bdt-palette-option{display:block;position:relative;min-width:0}.bdt-palette-choice{position:absolute;inset-inline-start:12px;top:12px;width:1px;height:1px;opacity:0;margin:0}
.bdt-palette-card{display:flex;flex-direction:column;gap:9px;height:100%;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.bdt-palette-choice:enabled+.bdt-palette-card:hover{border-color:var(--dsw-alias-brand-primary)}.bdt-palette-choice:checked+.bdt-palette-card{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}.bdt-palette-choice:focus-visible+.bdt-palette-card{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:4px}
.bdt-palette-caption{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px}.bdt-palette-name{min-width:0;overflow-wrap:anywhere;line-height:1.4}.bdt-palette-check{display:flex;align-items:center;justify-content:center;flex:0 0 18px;height:18px;border-radius:50%;font-size:12px;visibility:hidden;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}.bdt-palette-choice:checked+.bdt-palette-card .bdt-palette-check{visibility:visible}
.bdt-palette-group:disabled .bdt-palette-card{cursor:not-allowed}.bdt-palette-group:disabled .bdt-palette-name{color:var(--dsw-alias-label-secondary)}
.bdt-palette-group,.bdt-palette-card,.bdt-mini,.bdt-mini *{box-sizing:border-box}
.bdt-sidebar-group{min-width:0}.bdt-sidebar-group summary{padding:12px 0;font:inherit;font-weight:600;cursor:pointer}
.bdt-sidebar-group fieldset{min-width:0;margin:0;padding:0;border:0}.bdt-sidebar-legend{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
${PALETTE_PREVIEW_CSS}
@media(max-width:560px){.bdt-page{padding:16px}.bdt-row{gap:8px}.bdt-row>label{width:100%}.bdt-row:has(.bdt-wallpaper-select,.bdt-filter-range)>.bdt-control,.bdt-page .bdt-wallpaper-select{width:100%}.bdt-filter-range{flex:1}}`;
      function Wallpaper() {
        // apply() can precede other plugins or a startup failure: keep the boot
        // palette until the real shell actually mounts, even without an image.
        React.useEffect(() => { document.getElementById(BOOT_STYLE_ID)?.remove(); }, []);
        const s = useState();
        // DSH's transparent session tiles share the outer window's wallpaper and weather.
        const tiled = Boolean(window.frameElement?.matches('iframe[data-dsh-tile-layout]'));
        const condition = s.url && !tiled ? activeWeatherEffect(s) : null;
        const parallaxAvailable = Boolean(s.meta?.parallaxAvailable);
        const parallaxActive = Boolean(s.settings.enabled && parallaxAvailable && s.settings.parallaxStrength > 0 && s.url && !tiled);
        const { mode, facing } = s.settings.weather;
        const dayStart = s.settings.mode === 'schedule' ? s.settings.day : null;
        const nightStart = s.settings.mode === 'schedule' ? s.settings.night : null;
        const { windKmh, windDegrees } = (mode === 'location' && s.observation) || {};
        const look = weatherLooks[condition];
        const active = Boolean(look);
        const colors = React.useMemo(() => core.makeTokens(s.settings.dynamic ? s.accent : [112, 112, 112], s.settings.strength, s.settings.dynamic ? s.settings.paletteMode : 'monochrome', s.settings.dynamic ? s.settings.textColorMode : 'theme', s.settings.dynamic ? { pureBlackDark: s.settings.pureBlackDark, systemTweaks: s.settings.systemTweaks } : {}),
          [s.accent, s.settings.strength, s.settings.dynamic, s.settings.paletteMode, s.settings.textColorMode, s.settings.pureBlackDark, s.settings.systemTweaks]);
        const backdrop = React.useMemo(() => active ? weatherBackdrop(s.settings, colors, s.scheme) : null,
          [active, s.settings, colors, s.scheme]);
        const engine = React.useRef(null);
        const refreshCrop = React.useRef(null);
        const parallaxRef = React.useRef(null);
        React.useEffect(() => {
          const depthUrl = depthUrlFor(s.meta?.imageUrl);
          if (!parallaxActive || !depthUrl) return;
          const parallaxController = mountParallaxWallpaper({
            document, window, url: s.url, photo: s.photo, depthUrl,
            imageWidth: s.imageWidth, imageHeight: s.imageHeight, settings: s.settings,
          });
          parallaxRef.current = parallaxController;
          return () => {
            if (parallaxRef.current === parallaxController) parallaxRef.current = null;
            parallaxController.dispose();
          };
        }, [parallaxActive, s.url, s.photo, s.meta?.imageUrl]);
        React.useLayoutEffect(() => {
          parallaxRef.current?.update({ imageWidth: s.imageWidth, imageHeight: s.imageHeight, settings: s.settings });
        }, [s.imageWidth, s.imageHeight, s.settings]);
        React.useLayoutEffect(() => {
          if (!active) return;
          const layer = createWeatherPane(document);
          layer.setAttribute('data-bdt-weather', '');
          layer.setAttribute('aria-hidden', 'true');
          document.body.prepend(layer);
          const scene = createWeatherEngine(document, layer.querySelector(PRECIPITATION_CANVAS), look, condition, s.photo, facing);
          engine.current = scene;
          const updateLight = () => scene?.updateLight(new Date());
          updateWindowLight = updateLight;
          return () => {
            if (updateWindowLight === updateLight) updateWindowLight = undefined;
            scene?.dispose();
            engine.current = null;
            layer.remove();
          };
        }, [active]);
        React.useLayoutEffect(() => {
          engine.current?.updateLight(new Date(), s.scheme, dayStart, nightStart);
        }, [active, s.scheme, dayStart, nightStart]);
        React.useLayoutEffect(() => {
          engine.current?.setBackdrop(backdrop);
        }, [backdrop]);
        React.useLayoutEffect(() => {
          engine.current?.setEffect(look, condition, s.photo);
        }, [condition, look, s.photo]);
        React.useLayoutEffect(() => {
          engine.current?.setWeather(windKmh, windDegrees, facing);
        }, [look, s.photo, windKmh, windDegrees, facing]);
        React.useLayoutEffect(() => {
          refreshCrop.current?.();
          parallaxRef.current?.syncSidebars();
        }, [s.settings.leftSidebar.background, s.settings.rightSidebar.background]);
        React.useLayoutEffect(() => {
          if (!s.settings.enabled || !s.url) return;
          const stopAlignment = alignWallpaper({
            document, window, surfaces: SIDEBAR_SURFACES, imageWidth: s.imageWidth, imageHeight: s.imageHeight,
            mountBackground: surface => mountSidebarBackground(document, surface, active),
            onLayout: (width, height, surfaces) => {
              if (active) {
                const panes = surfaces.map(([layer, box]) => [layer, box,
                  layer?.parentElement?.closest('[data-sidebar-right-panel]') ? 'right' : 'left']);
                refreshCrop.current = () => engine.current?.layout(width, height, panes);
                refreshCrop.current();
              }
              parallaxRef.current?.syncSidebars();
            },
          });
          return () => {
            stopAlignment();
            refreshCrop.current = null;
          };
        }, [s.settings.enabled, s.url, s.imageWidth, s.imageHeight, active]);
        if (!s.settings.enabled || !s.url) return null;
        const image = `url(${JSON.stringify(s.url)})`;
        const visibilityMatte = colors['--dsw-alias-bg-base'][s.scheme];
        const overlays = s.settings.strength < 100 ? [visibilityMatte] : [];
        const filter = wallpaperFilters.css({ selector: 'html', image, overlays, settings: s.settings, fixed: true, aligned: true });
        const mainBase = visibilityMatte.replace(/^rgba\((\d+, \d+, \d+), [^)]+\)$/, 'rgb($1)');
        const { base, matte } = sidebarColors(colors, s.scheme);
        const sidebars = sidebarBackgroundCSS({ settings: s.settings, image, overlays: [], matte, base });
        const parallaxCSS = parallaxActive
          ? 'html[data-bdt-parallax-active]::before{display:none}html[data-bdt-parallax-active] [data-bdt-sidebar-image]{background-image:none!important}[data-bdt-sidebar-image]>[data-bdt-sidebar-canvas]{display:block;width:100%;height:100%;pointer-events:none}'
          : '';
        return h('style', null, `html{background-color:${mainBase};background-image:none}body{background-color:transparent!important}${filter}${SHELL_WALLPAPER_CSS}${sidebars}${parallaxCSS}${active ? WEATHER_LAYOUT_CSS : ''}${s.settings.dynamic ? MARKETPLACE_THEME_CSS : ''}${s.settings.dynamic && s.settings.systemTweaks ? SYSTEM_TWEAKS_CSS : ''}${pluginPageCSS(s.settings.dynamic)}`);
      }
      function WeatherForm({ config, observation, status, row }) {
        const [draft, setDraft] = React.useState(config);
        const [locating, setLocating] = React.useState(false);
        const [error, setError] = React.useState('');
        const edit = (key, value) => { setError(''); setDraft(current => ({ ...current, [key]: value })); };
        function locate() {
          const failed = () => { setLocating(false); setError('weatherLocateFailed'); };
          if (!navigator.geolocation) { failed(); return; }
          setLocating(true); setError('');
          navigator.geolocation.getCurrentPosition(({ coords }) => {
            edit('location', `${coords.latitude.toFixed(2)}, ${coords.longitude.toFixed(2)}`);
            setLocating(false);
          }, failed, { timeout: 10000, maximumAge: 300000 });
        }
        function submit(event) {
          event.preventDefault();
          if (!draft.location.trim()) { setError('weatherLocationNeeded'); return; }
          if (draft.provider === 'custom' && !customEndpoint(draft.endpoint)) { setError('weatherEndpointInvalid'); return; }
          const refreshMinutes = Number(draft.refreshMinutes);
          if (!Number.isSafeInteger(refreshMinutes) || refreshMinutes < 1) { setError('weatherRefreshMinutesInvalid'); return; }
          update({ weather: { ...settings.weather, ...draft, refreshMinutes } });
          void weather.sync(settings, true);
        }
        const message = error || status;
        const wind = observation?.windKmh;
        const direction = observation?.windDegrees;
        const summary = observation && [observation.place, t(`weather.${observation.effect}`),
          wind != null ? `${t('weatherWind')} ${wind} km/h` : null,
          direction != null ? `${t('weatherWindDirection')} ${direction}°` : null].filter(Boolean).join(' · ');
        return h('form', { className: 'bdt-weather-form', onSubmit: submit },
          row('weatherLocation', h('input', { id: 'bdt-weatherLocation', type: 'text', required: true, maxLength: 200,
            placeholder: t('weatherLocationPlaceholder'), value: draft.location, disabled: locating, onChange: e => edit('location', e.target.value) }),
            h('button', { type: 'button', disabled: locating, onClick: locate }, t(locating ? 'weatherLocating' : 'weatherLocate'))),
          row('weatherProvider', h('select', { id: 'bdt-weatherProvider', className: 'bdt-wallpaper-select', value: draft.provider,
            onChange: e => edit('provider', e.target.value) }, ...WEATHER_PROVIDERS.map(value => h('option', { key: value, value }, t(`weatherProvider.${value}`))))),
          draft.provider === 'custom' && h('div', null,
            row('weatherEndpoint', h('input', { id: 'bdt-weatherEndpoint', type: 'url', required: true, maxLength: 2048,
              'aria-describedby': 'bdt-weatherEndpointHint', value: draft.endpoint, placeholder: 'https://example.com/weather', onChange: e => edit('endpoint', e.target.value) })),
            h('p', { id: 'bdt-weatherEndpointHint', className: 'bdt-muted' }, t('weatherEndpointHint'))),
          row('weatherRefreshMinutes', h('input', { id: 'bdt-weatherRefreshMinutes', type: 'number', min: 1, step: 1, required: true,
            value: draft.refreshMinutes, onChange: e => edit('refreshMinutes', e.target.value) })),
          h('div', { className: 'bdt-weather-actions' },
            h('div', { className: 'bdt-weather-summary' },
              h('span', { role: 'status', className: 'bdt-muted' }, message ? t(message) : summary),
              observation && config.provider !== 'custom' && h('a', { href: config.provider === 'open-meteo' ? 'https://open-meteo.com/' : 'https://wttr.in/',
                className: 'bdt-muted', target: '_blank', rel: 'noopener noreferrer' }, t(`weatherProvider.${config.provider}`))),
            h('button', { type: 'submit', disabled: locating }, t('weatherApply'))));
      }
      function Settings() {
        useLocale(); const s = useState(), prefs = s.settings;
        const { facing, ...weatherConfig } = prefs.weather;
        const weatherChoice = prefs.weather.mode === 'fixed' ? prefs.weather.effect : prefs.weather.mode;
        const selectWeather = choice => {
          const patch = choice === 'off' || choice === 'location' ? { mode: choice } : { mode: 'fixed', effect: choice };
          update({ weather: { ...prefs.weather, ...patch } });
        };
        const [sidebarOpen, setSidebarOpen] = React.useState(() => Object.fromEntries(
          ['leftSidebar', 'rightSidebar'].map(key => [key, prefs[key].visibilityMode === 'custom'])));
        const group = (key, ...controls) => {
          const titleId = `bdt-group-${key}`;
          return h('section', { className: 'bdt-card', 'aria-labelledby': titleId },
            h('h3', { id: titleId }, t(`settingsGroup.${key}`)), ...controls);
        };
        const row = (label, control, hint, title = t(label)) => h('div', { key: label, className: 'bdt-row' }, h('label', { htmlFor: `bdt-${label}` }, title), h('div', { className: 'bdt-control' }, control, hint));
        const checkbox = key => h('input', { id: `bdt-${key}`, type: 'checkbox', checked: prefs[key], onChange: e => update({ [key]: e.target.checked }) });
        const filterOption = wallpaperFilters.options[prefs.filterMode], filterAmount = prefs.filterAmounts[prefs.filterMode];
        const filterLabel = `filterAmount.${prefs.filterMode}`, filterId = `bdt-${filterLabel}`;
        const parallaxAvailable = Boolean(s.meta?.parallaxAvailable);
        const parallaxValue = parallaxAvailable ? prefs.parallaxStrength : 0;
        const parallaxText = parallaxValue > 0 ? `${parallaxValue}%` : t('parallaxOff');
        const sidebarControls = key => {
          const sidebar = prefs[key], option = wallpaperFilters.options[sidebar.filterMode];
          const change = patch => update({ [key]: { ...sidebar, ...patch } });
          const id = field => `bdt-${key}.${field}`;
          const scopedRow = (field, control, hint, label = field) => row(`${key}.${field}`, control, hint, t(label));
          return h('details', { key, id: `bdt-${key}`, className: 'bdt-sidebar-group', open: sidebarOpen[key],
            onToggle: e => { const open = e.currentTarget.open; setSidebarOpen(current => ({ ...current, [key]: open })); },
          },
            h('summary', null, t(key)),
            h('fieldset', { disabled: !prefs.enabled },
              h('legend', { className: 'bdt-sidebar-legend' }, t(key)),
              scopedRow('background', h('select', { id: id('background'), className: 'bdt-wallpaper-select', value: sidebar.background, onChange: e => change({ background: e.target.value }) },
                ...['wallpaper', 'theme'].map(mode => h('option', { key: mode, value: mode }, t(`sidebarBackground.${mode}`)))), null, 'sidebarBackground'),
              scopedRow('visibilityMode', h('select', { id: id('visibilityMode'), className: 'bdt-wallpaper-select', value: sidebar.visibilityMode, disabled: sidebar.background !== 'wallpaper', onChange: e => change({ visibilityMode: e.target.value }) },
                ...['inherit', 'custom'].map(mode => h('option', { key: mode, value: mode }, t(`sidebarVisibility.${mode}`)))), null, 'sidebarVisibility'),
              sidebar.visibilityMode === 'custom' && scopedRow('visibility', h('input', { id: id('visibility'), className: 'bdt-filter-range', type: 'range', min: 10, max: 100, step: 1,
                value: sidebar.visibility, disabled: sidebar.background !== 'wallpaper', 'aria-valuetext': `${sidebar.visibility}%`,
                onChange: e => change({ visibility: Number(e.target.value) }),
              }), h('output', { htmlFor: id('visibility') }, `${sidebar.visibility}%`), 'sidebarVisibilityAmount'),
              scopedRow('tint', h('input', { id: id('tint'), type: 'checkbox', checked: sidebar.tint, disabled: sidebar.background !== 'wallpaper', onChange: e => change({ tint: e.target.checked }) }), null, 'sidebarTint'),
              scopedRow('filterMode', h('select', { id: id('filterMode'), className: 'bdt-wallpaper-select', value: sidebar.filterMode, disabled: sidebar.background !== 'wallpaper', onChange: e => change({ filterMode: e.target.value }) },
                ...['inherit', ...wallpaperFilters.modes].map(mode => h('option', { key: mode, value: mode }, t(`filter.${mode}`))))),
              option && scopedRow('filterAmount', h('input', { id: id('filterAmount'), className: 'bdt-filter-range', type: 'range', min: 0, max: option.max, step: 1,
                value: sidebar.filterAmounts[sidebar.filterMode], disabled: sidebar.background !== 'wallpaper',
                'aria-valuetext': option.unit === 'px' ? `${sidebar.filterAmounts[sidebar.filterMode]} ${t('filterPixels')}` : `${sidebar.filterAmounts[sidebar.filterMode]}%`,
                onChange: e => change({ filterAmounts: { ...sidebar.filterAmounts, [sidebar.filterMode]: Number(e.target.value) } }),
              }), h('output', { htmlFor: id('filterAmount') }, `${sidebar.filterAmounts[sidebar.filterMode]}${option.unit}`), `filterAmount.${sidebar.filterMode}`),
              scopedRow('toolbar', h('input', { id: id('toolbar'), type: 'checkbox', checked: sidebar.toolbar, onChange: e => change({ toolbar: e.target.checked }) }), null, 'sidebarToolbar')));
        };
        const tokens = React.useMemo(() => core.makeTokens(prefs.dynamic ? s.accent : [112, 112, 112], prefs.strength, prefs.dynamic ? prefs.paletteMode : 'monochrome', prefs.dynamic ? prefs.textColorMode : 'theme', prefs.dynamic ? { pureBlackDark: prefs.pureBlackDark, systemTweaks: prefs.systemTweaks } : {}), [s.accent, prefs.strength, prefs.paletteMode, prefs.dynamic, prefs.textColorMode, prefs.pureBlackDark, prefs.systemTweaks]);
        // Each option previews its own real palette. Selection/theme changes
        // must not recalculate all ten paired palettes or fetch another image.
        const palettes = React.useMemo(() => core.PALETTE_MODES.map(mode => ({ mode, tokens: core.makeTokens(s.accent, prefs.strength, mode, prefs.textColorMode, { pureBlackDark: prefs.pureBlackDark, systemTweaks: prefs.systemTweaks }) })), [s.accent, prefs.strength, prefs.textColorMode, prefs.pureBlackDark, prefs.systemTweaks]);
        const paletteGroup = React.useId();
        const copyrightUrl = typeof s.meta?.copyrightUrl === 'string' && /^https:\/\/(?:www|cn)\.bing\.com\//.test(s.meta.copyrightUrl) ? s.meta.copyrightUrl : 'https://www.bing.com/';
        return h('section', { className: 'bdt-page', 'aria-label': t('title') },
          h('style', null, css), h('h2', null, t('title')),
          h('figure', { className: 'bdt-photo' },
            s.url ? h('div', { className: 'bdt-preview' },
              h('img', { className: 'bdt-preview-image', src: s.url, alt: s.meta?.title || t('preview') }))
              : h('div', { className: 'bdt-preview', role: 'img', 'aria-label': t('preview') }),
            s.meta && h('figcaption', { className: 'bdt-photo-caption' },
              h('div', { className: 'bdt-photo-heading' }, h('strong', null, s.meta.title || t('preview')), h('span', { className: 'bdt-photo-date' }, `${s.meta.date} · ${t(`market.${s.meta.market}`)}`)),
              h('div', { className: 'bdt-photo-details' }, h('a', { href: copyrightUrl, target: '_blank', rel: 'noopener noreferrer' }, s.meta.copyright || t('source')),
                prefs.dynamic && h('div', { className: 'bdt-swatches', 'aria-label': t('palette') }, ...['light', 'dark'].map(mode => h('span', { key: mode, className: 'bdt-swatch', title: t(mode), style: { backgroundColor: tokens['--dsw-alias-brand-primary'][mode] } }))))),
            h('button', { className: 'bdt-photo-refresh', type: 'button', disabled: s.busy || !prefs.enabled, 'aria-label': t('refresh'), title: t('refresh'), 'aria-busy': s.busy, onClick: () => void refresh() },
              h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false },
                h('path', { d: 'M3 12a9 9 0 0 1 15.36-6.36L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.36 6.36L3 16M8 16H3v5' })))),
          h('span', { className: 'bdt-photo-status', role: 'status', 'aria-live': 'polite' }, !prefs.enabled ? t('paused') : s.busy ? t('loading') : s.issue ? t(s.issue) : t(s.meta ? (s.meta.resolution || '1080p') !== prefs.resolution ? 'sourceFailed' : s.meta.market === prefs.market ? 'ready' : 'sourceFailed' : 'waiting')),
          group('wallpaper',
            row('enabled', checkbox('enabled')),
            row('market', h('select', { id: 'bdt-market', value: prefs.market, onChange: e => update({ market: e.target.value }), className: 'bdt-wallpaper-select' }, ...['zh-CN', 'en-US'].map(market => h('option', { key: market, value: market }, t(`market.${market}`))))),
            row('resolution', h('select', { id: 'bdt-resolution', value: prefs.resolution, disabled: !prefs.enabled, onChange: e => update({ resolution: e.target.value }), className: 'bdt-wallpaper-select' }, ...core.RESOLUTIONS.map(resolution => h('option', { key: resolution, value: resolution }, t(`resolution.${resolution}`)))))),
          group('appearance',
            row('mode', h('select', { id: 'bdt-mode', value: prefs.mode, onChange: e => update({ mode: e.target.value }) }, ...['schedule', 'system', 'follow', 'light', 'dark'].map(mode => h('option', { key: mode, value: mode }, t(mode))))),
            prefs.mode === 'schedule' && ['day', 'night'].map(key => row(key, h('input', { id: `bdt-${key}`, type: 'time', value: prefs[key], onChange: e => update({ [key]: e.target.value }) })))),
          group('background',
            row('strength', h('input', { id: 'bdt-strength', type: 'range', min: 10, max: 100, step: 1, value: prefs.strength, 'aria-valuetext': `${prefs.strength}%`, onChange: e => update({ strength: Number(e.target.value) }) }), h('output', { htmlFor: 'bdt-strength' }, `${prefs.strength}%`)),
            row('filterMode', h('select', { id: 'bdt-filterMode', className: 'bdt-wallpaper-select', value: prefs.filterMode, disabled: !prefs.enabled, onChange: e => update({ filterMode: e.target.value }) },
              ...wallpaperFilters.modes.map(mode => h('option', { key: mode, value: mode }, t(`filter.${mode}`))))),
            filterOption && row(filterLabel, h('input', { id: filterId, className: 'bdt-filter-range', type: 'range', min: 0, max: filterOption.max, step: 1,
              value: filterAmount, disabled: !prefs.enabled, 'aria-valuetext': filterOption.unit === 'px' ? `${filterAmount} ${t('filterPixels')}` : `${filterAmount}%`,
              onChange: e => update({ filterAmounts: { ...prefs.filterAmounts, [prefs.filterMode]: Number(e.target.value) } }),
            }), h('output', { htmlFor: filterId }, `${filterAmount}${filterOption.unit}`)),
            h('div', null,
              row('parallax', h('input', { id: 'bdt-parallax', className: 'bdt-filter-range', type: 'range', min: 0, max: 100, step: 1,
                value: parallaxValue, disabled: !prefs.enabled || !parallaxAvailable,
                'aria-valuetext': parallaxText,
                'aria-describedby': parallaxAvailable ? undefined : 'bdt-parallaxHint',
                onChange: e => update({ parallaxStrength: Number(e.target.value) }),
              }), h('output', { htmlFor: 'bdt-parallax' }, parallaxText)),
              !parallaxAvailable && h('p', { id: 'bdt-parallaxHint', className: 'bdt-muted bdt-field-hint' }, t('parallaxUnavailable')))),
          group('sidebars', ...['leftSidebar', 'rightSidebar'].map(sidebarControls)),
          group('weather',
            row('weatherChoice', h('select', { id: 'bdt-weatherChoice', className: 'bdt-wallpaper-select', value: weatherChoice, disabled: !prefs.enabled,
              onChange: e => selectWeather(e.target.value) },
              ...weatherChoices.map(choice => h('option', { key: choice, value: choice },
                t(WEATHER_EFFECTS.includes(choice) ? `weather.${choice}` : `weatherChoice.${choice}`))))),
            prefs.enabled && prefs.weather.mode !== 'off' && row('weatherFacing', h('select', {
              id: 'bdt-weatherFacing', className: 'bdt-wallpaper-select', value: facing,
              onChange: e => update({ weather: { ...prefs.weather, facing: e.target.value } }),
            }, ...Object.keys(FACING_BEARINGS).map(value => h('option', { key: value, value }, t(`weatherFacing.${value}`))))),
            prefs.enabled && prefs.weather.mode === 'location' && h(WeatherForm, { key: JSON.stringify(weatherConfig), config: weatherConfig,
              observation: s.observation, status: s.weatherStatus, row })),
          group('colours',
            row('dynamic', checkbox('dynamic')),
            row('textColorMode', h('select', { id: 'bdt-textColorMode', className: 'bdt-wallpaper-select', value: prefs.textColorMode, disabled: !prefs.dynamic, onChange: e => update({ textColorMode: e.target.value }) },
              ...core.TEXT_COLOR_MODES.map(mode => h('option', { key: mode, value: mode }, t(`textColorMode.${mode}`))))),
            row('pureBlackDark', h('input', { id: 'bdt-pureBlackDark', type: 'checkbox', checked: prefs.pureBlackDark, disabled: !prefs.dynamic, onChange: e => update({ pureBlackDark: e.target.checked }) })),
            row('systemTweaks', h('input', { id: 'bdt-systemTweaks', type: 'checkbox', checked: prefs.systemTweaks, disabled: !prefs.dynamic, onChange: e => update({ systemTweaks: e.target.checked }) })),
            h('fieldset', { className: 'bdt-palette-group', disabled: !prefs.dynamic },
              h('legend', null, t('paletteMode')),
              h('div', { className: 'bdt-palette-grid' }, ...palettes.map(({ mode, tokens: previewTokens }) =>
                h('label', { key: mode, className: 'bdt-palette-option', htmlFor: `${paletteGroup}-${mode}` },
                  h('input', { id: `${paletteGroup}-${mode}`, className: 'bdt-palette-choice', type: 'radio', name: paletteGroup, value: mode, checked: prefs.paletteMode === mode, onChange: () => update({ paletteMode: mode }) }),
                  h('span', { className: 'bdt-palette-card' }, renderPaletteMiniature(h, previewTokens),
                    h('span', { className: 'bdt-palette-caption' }, h('span', { className: 'bdt-palette-name' }, t(`palette.${mode}`)), h('span', { className: 'bdt-palette-check', 'aria-hidden': true }, '✓')))))))),
          s.storageIssue && h('p', { role: 'status' }, t('storageFailed')));
      }
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'bing-daily-theme.wallpaper', order: -100 }, Wallpaper));
      ctx.effect(() => {
        const register = () => ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'bing-daily-theme', order: 25, label: () => t('title') }, Settings));
        let dispose = register();
        const unsubscribe = ctx.locale.subscribe(() => { dispose(); dispose = register(); });
        return () => { unsubscribe(); dispose(); };
      });
      ctx.effect(() => {
        const timer = setInterval(tick, 60000);
        const wake = () => {
          if (document.visibilityState !== 'visible') return;
          tick();
          void weather.sync(settings);
        };
        const online = () => { lastCheck = 0; tick(); };
        const storage = event => {
          if (event.key !== KEY) return;
          try {
            // A drag can queue many cross-window events. Ignore superseded
            // values and never echo a received value back into localStorage.
            if (event.newValue !== localStorage.getItem(KEY)) return;
            update(core.normalizeSettings(JSON.parse(event.newValue || '{}')), false);
          } catch { /* Ignore invalid third-party storage writes. */ }
        };
        document.addEventListener('visibilitychange', wake); window.addEventListener('online', online); window.addEventListener('storage', storage);
        syncMode(); void refresh(); void weather.sync(settings);
        return () => {
          weather.dispose(); alive = false; generation++; clearInterval(timer); controller?.abort();
          document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', online); window.removeEventListener('storage', storage);
          document.getElementById(BOOT_STYLE_ID)?.remove();
          tokenDisposer?.(); restoreTheme(); if (activeUrl) URL.revokeObjectURL(activeUrl); listeners.clear();
        };
      });
    },
  };
}
