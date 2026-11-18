// Bundled by scripts/build.mjs. No runtime imports except the shared React instance.
import { PREFERENCES_KEY, BOOT_CACHE_KEY, BOOT_STYLE_ID, makeBootCache } from './boot-theme.js';
import { MARKETPLACE_THEME_CSS } from './compatibility.js';
import { renderPaletteMiniature, PALETTE_PREVIEW_CSS } from './palette-preview.js';
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
      const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
      const useState = () => React.useSyncExternalStore(subscribe, () => state);
      let alive = true, tokenDisposer, controller, activeUrl = '';
      const appearance = createAppearanceController(ctx.theme, () => {
        settings = { ...settings, mode: 'follow' }; save(); publish({ settings });
      }, core.scheduledScheme);
      let lastCheck = 0, lastDay = '', generation = 0;
      function save() {
        try { localStorage.setItem(KEY, JSON.stringify(settings)); publish({ storageIssue: false }); }
        catch { publish({ storageIssue: true }); }
      }
      function restoreTheme() { appearance.restore(); }
      function syncMode() { appearance.sync(settings); }
      function syncTokens() {
        if (!settings.enabled || !settings.dynamic || (state.meta && state.meta.market !== settings.market)) {
          try { localStorage.removeItem(BOOT_CACHE_KEY); } catch { /* Best-effort startup cache only. */ }
        }
        if (!settings.enabled || !state.url) { tokenDisposer?.(); tokenDisposer = undefined; return; }
        const tokens = core.makeTokens(settings.dynamic ? state.accent : [112, 112, 112], settings.strength, settings.dynamic ? settings.paletteMode : 'monochrome');
        if (!settings.dynamic) for (const key of Object.keys(tokens)) if (key !== '--dsw-alias-bg-base') delete tokens[key];
        const previous = tokenDisposer;
        tokenDisposer = ctx.theme.overrideTokens(SOURCE, tokens);
        previous?.();
        if (settings.dynamic && state.meta?.market === settings.market) {
          try { localStorage.setItem(BOOT_CACHE_KEY, JSON.stringify(makeBootCache(settings, tokens, state.meta?.imageUrl))); }
          catch { /* Palette persistence must not break wallpaper or theme application. */ }
        }
      }
      function update(patch) {
        const next = core.normalizeSettings({ ...settings, ...patch });
        if (next.day === next.night) { publish({ issue: 'sameTime' }); return; }
        if (JSON.stringify(next) === JSON.stringify(settings)) return;
        const wasEnabled = settings.enabled, sourceChanged = next.market !== settings.market;
        if (sourceChanged) {
          // Invalidate even a request still decoding: a slow old source must not
          // overwrite a newer choice. Keep its displayed photo until success.
          generation++; controller?.abort(); lastCheck = 0; lastDay = ''; publish({ busy: false });
        }
        if (next.mode !== settings.mode || !next.enabled) restoreTheme();
        settings = next; save(); publish({ settings, issue: '' }); syncTokens(); syncMode();
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
          const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('Canvas unavailable');
          context.drawImage(image, 0, 0, 64, 64);
          const accent = core.extractAccent(context.getImageData(0, 0, 64, 64).data);
          return { url, accent };
        } catch (error) { URL.revokeObjectURL(url); throw error; }
        finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
      }
      async function refresh() {
        if (!alive || !settings.enabled || state.busy) return;
        const current = ++generation, market = settings.market;
        const requestController = new AbortController(); controller = requestController;
        const signal = requestController.signal, timeout = setTimeout(() => requestController.abort(), 30000);
        publish({ busy: true, issue: '' }); lastCheck = Date.now();
        let decoded;
        try {
          const response = await fetch(`/bing-daily-theme/api/daily?market=${market}`, { signal, credentials: 'same-origin', cache: 'no-store' });
          if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
          const meta = await response.json();
          const expectedImage = market === 'en-US' ? /^\/bing-daily-theme\/api\/image\?market=en-US&id=OHR\.[A-Za-z0-9][A-Za-z0-9_-]*_1920x1080\.jpg$/ : /^\/bing-daily-theme\/api\/image\?id=OHR\.[A-Za-z0-9][A-Za-z0-9_-]*_1920x1080\.jpg$/;
          if (meta.market !== market || typeof meta.imageUrl !== 'string' || meta.imageUrl.length > 300 || !expectedImage.test(meta.imageUrl)) throw new Error('Invalid wallpaper source or URL');
          if (!state.meta || meta.imageUrl !== state.meta.imageUrl || !state.url) {
            const image = await fetch(meta.imageUrl, { signal, credentials: 'same-origin' });
            if (!image.ok) throw new Error(`Image HTTP ${image.status}`);
            const blob = await image.blob();
            if (blob.size > 12 * 1024 * 1024 || !blob.type.startsWith('image/')) throw new Error('Invalid wallpaper image');
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
          if (alive && current === generation) publish({ issue: state.url ? state.meta?.market !== market ? 'sourceFailed' : 'fetchFailed' : 'firstFetchFailed' });
        } finally {
          clearTimeout(timeout);
          if (alive && current === generation) publish({ busy: false });
        }
      }
      function tick() {
        syncMode();
        if (settings.enabled && (core.localDate() !== lastDay || state.meta?.market !== settings.market || ['fetchFailed', 'firstFetchFailed', 'sourceFailed', 'stale'].includes(state.issue) || Date.now() - lastCheck >= 3600000) && Date.now() - lastCheck >= 60000) void refresh();
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
.bdt-photo{position:relative;margin:0;overflow:hidden;border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.bdt-preview{width:100%;aspect-ratio:16/9;min-height:240px;object-fit:cover;display:block;background:var(--dsw-alias-bg-layer-2)}
.bdt-card{padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);margin:16px 0}
.bdt-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 0;flex-wrap:wrap}.bdt-row+ .bdt-row{border-top:1px solid var(--dsw-alias-border-l1)}
.bdt-control{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.bdt-page select,.bdt-page input[type=time],.bdt-page button{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;min-height:36px;max-width:100%}
.bdt-page button{cursor:pointer}.bdt-page button:disabled{cursor:wait;opacity:.55}.bdt-page :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}.bdt-page input{accent-color:var(--dsw-alias-brand-primary)}
.bdt-page a{color:var(--dsw-alias-brand-primary)}.bdt-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.bdt-swatches{display:flex;gap:8px;margin-top:10px}.bdt-swatch{width:24px;height:24px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2)}
.bdt-photo-caption{position:absolute;inset:auto 0 0;max-height:calc(100% - 64px);overflow:auto;padding:30px 16px 14px;color:var(--dsw-alias-tooltip-label);background:linear-gradient(to bottom,transparent,color-mix(in srgb,var(--dsw-alias-tooltip-bg) 82%,transparent) 26px,color-mix(in srgb,var(--dsw-alias-tooltip-bg) 90%,transparent));font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.bdt-photo-heading{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px}.bdt-photo-heading strong{min-width:0;font-size:14px}.bdt-photo-date{white-space:nowrap}.bdt-photo-details{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:5px}.bdt-page .bdt-photo-caption a{min-width:0;color:inherit;text-underline-offset:2px}.bdt-photo-caption .bdt-swatches{flex-shrink:0;margin:0;gap:6px}.bdt-photo-caption .bdt-swatch{width:20px;height:20px;border-color:color-mix(in srgb,var(--dsw-alias-tooltip-label) 55%,transparent)}
.bdt-page .bdt-photo-refresh{position:absolute;top:12px;inset-inline-end:12px;display:flex;align-items:center;justify-content:center;width:44px;height:44px;min-height:44px;padding:0;border-radius:50%;border:1px solid color-mix(in srgb,var(--dsw-alias-tooltip-label) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-tooltip-bg) 86%,transparent);color:var(--dsw-alias-tooltip-label)}.bdt-photo-refresh svg{width:20px;height:20px}.bdt-page .bdt-photo-refresh:disabled{cursor:not-allowed}.bdt-page .bdt-photo-refresh[aria-busy=true]{cursor:wait}.bdt-page .bdt-photo-refresh:focus-visible{outline-color:var(--dsw-alias-tooltip-label);box-shadow:0 0 0 5px var(--dsw-alias-tooltip-bg)}.bdt-photo-refresh[aria-busy=true] svg{animation:bdt-refresh-spin 1s linear infinite}.bdt-photo-status{display:block;margin:8px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}
@keyframes bdt-refresh-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.bdt-photo-refresh[aria-busy=true] svg{animation:none}}
.bdt-palette-group{min-width:0;padding:12px 0;margin:0;border:0}.bdt-palette-group legend{padding:0;font:inherit}.bdt-palette-group+.bdt-row{border-top:1px solid var(--dsw-alias-border-l1)}
.bdt-palette-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px;margin-top:12px}
.bdt-palette-option{display:block;position:relative;min-width:0}.bdt-palette-choice{position:absolute;inset-inline-start:12px;top:12px;width:1px;height:1px;opacity:0;margin:0}
.bdt-palette-card{display:flex;flex-direction:column;gap:9px;height:100%;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.bdt-palette-choice:enabled+.bdt-palette-card:hover{border-color:var(--dsw-alias-brand-primary)}.bdt-palette-choice:checked+.bdt-palette-card{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}.bdt-palette-choice:focus-visible+.bdt-palette-card{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:4px}
.bdt-palette-caption{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px}.bdt-palette-name{min-width:0;overflow-wrap:anywhere;line-height:1.4}.bdt-palette-check{display:flex;align-items:center;justify-content:center;flex:0 0 18px;height:18px;border-radius:50%;font-size:12px;visibility:hidden;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}.bdt-palette-choice:checked+.bdt-palette-card .bdt-palette-check{visibility:visible}
.bdt-palette-group:disabled .bdt-palette-card{cursor:not-allowed}.bdt-palette-group:disabled .bdt-palette-name{color:var(--dsw-alias-label-secondary)}
.bdt-palette-group,.bdt-palette-card,.bdt-mini,.bdt-mini *{box-sizing:border-box}
${PALETTE_PREVIEW_CSS}
@media(max-width:560px){.bdt-page{padding:16px}.bdt-row{gap:8px}.bdt-row>label{width:100%}}`;
      function Wallpaper() {
        // apply() can precede other plugins or a startup failure: keep the boot
        // palette until the real shell actually mounts, even without an image.
        React.useEffect(() => { document.getElementById(BOOT_STYLE_ID)?.remove(); }, []);
        const s = useState();
        if (!s.settings.enabled || !s.url) return null;
        // Document wallpaper plus a bounded adapter for dshmarket's local fill
        // variables. No root replacement, image filter or overlay intercepts.
        const shade = core.wallpaperShade(s.scheme);
        return h('style', null, `html{background-image:linear-gradient(${shade},${shade}),url(${JSON.stringify(s.url)});background-size:cover;background-position:center;background-attachment:fixed}body{background-color:transparent!important}${s.settings.dynamic ? MARKETPLACE_THEME_CSS : ''}`);
      }
      function Settings() {
        useLocale(); const s = useState(), prefs = s.settings;
        const row = (label, control, hint) => h('div', { className: 'bdt-row' }, h('label', { htmlFor: `bdt-${label}` }, t(label)), h('div', { className: 'bdt-control' }, control, hint));
        const checkbox = key => h('input', { id: `bdt-${key}`, type: 'checkbox', checked: prefs[key], onChange: e => update({ [key]: e.target.checked }) });
        const tokens = React.useMemo(() => core.makeTokens(prefs.dynamic ? s.accent : [112, 112, 112], prefs.strength, prefs.dynamic ? prefs.paletteMode : 'monochrome'), [s.accent, prefs.strength, prefs.paletteMode, prefs.dynamic]);
        // Each option previews its own real palette. Selection/theme changes
        // must not recalculate all ten paired palettes or fetch another image.
        const palettes = React.useMemo(() => core.PALETTE_MODES.map(mode => ({ mode, tokens: core.makeTokens(s.accent, prefs.strength, mode) })), [s.accent, prefs.strength]);
        const paletteGroup = React.useId();
        const copyrightUrl = typeof s.meta?.copyrightUrl === 'string' && /^https:\/\/(?:www|cn)\.bing\.com\//.test(s.meta.copyrightUrl) ? s.meta.copyrightUrl : 'https://www.bing.com/';
        return h('section', { className: 'bdt-page', 'aria-label': t('title') },
          h('style', null, css), h('h2', null, t('title')),
          h('figure', { className: 'bdt-photo' },
            s.url ? h('img', { className: 'bdt-preview', src: s.url, alt: s.meta?.title || t('preview') }) : h('div', { className: 'bdt-preview', role: 'img', 'aria-label': t('preview') }),
            s.meta && h('figcaption', { className: 'bdt-photo-caption' },
              h('div', { className: 'bdt-photo-heading' }, h('strong', null, s.meta.title || t('preview')), h('span', { className: 'bdt-photo-date' }, `${s.meta.date} · ${t(`market.${s.meta.market}`)}`)),
              h('div', { className: 'bdt-photo-details' }, h('a', { href: copyrightUrl, target: '_blank', rel: 'noopener noreferrer' }, s.meta.copyright || t('source')),
                prefs.dynamic && h('div', { className: 'bdt-swatches', 'aria-label': t('palette') }, ...['light', 'dark'].map(mode => h('span', { key: mode, className: 'bdt-swatch', title: t(mode), style: { backgroundColor: tokens['--dsw-alias-brand-primary'][mode] } }))))),
            h('button', { className: 'bdt-photo-refresh', type: 'button', disabled: s.busy || !prefs.enabled, 'aria-label': t('refresh'), title: t('refresh'), 'aria-busy': s.busy, onClick: () => void refresh() },
              h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false },
                h('path', { d: 'M3 12a9 9 0 0 1 15.36-6.36L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.36 6.36L3 16M8 16H3v5' })))),
          h('span', { className: 'bdt-photo-status', role: 'status', 'aria-live': 'polite' }, !prefs.enabled ? t('paused') : s.busy ? t('loading') : s.issue ? t(s.issue) : t(s.meta ? s.meta.market === prefs.market ? 'ready' : 'sourceFailed' : 'waiting')),
          h('div', { className: 'bdt-card' }, row('enabled', checkbox('enabled')),
            row('market', h('select', { id: 'bdt-market', value: prefs.market, onChange: e => update({ market: e.target.value }) }, ...['zh-CN', 'en-US'].map(market => h('option', { key: market, value: market }, t(`market.${market}`))))),
            row('dynamic', checkbox('dynamic')),
            h('fieldset', { className: 'bdt-palette-group', disabled: !prefs.dynamic },
              h('legend', null, t('paletteMode')),
              h('div', { className: 'bdt-palette-grid' }, ...palettes.map(({ mode, tokens: previewTokens }) =>
                h('label', { key: mode, className: 'bdt-palette-option', htmlFor: `${paletteGroup}-${mode}` },
                  h('input', { id: `${paletteGroup}-${mode}`, className: 'bdt-palette-choice', type: 'radio', name: paletteGroup, value: mode, checked: prefs.paletteMode === mode, onChange: () => update({ paletteMode: mode }) }),
                  h('span', { className: 'bdt-palette-card' }, renderPaletteMiniature(h, previewTokens),
                    h('span', { className: 'bdt-palette-caption' }, h('span', { className: 'bdt-palette-name' }, t(`palette.${mode}`)), h('span', { className: 'bdt-palette-check', 'aria-hidden': true }, '✓'))))))),
            row('mode', h('select', { id: 'bdt-mode', value: prefs.mode, onChange: e => update({ mode: e.target.value }) }, ...['schedule', 'system', 'follow', 'light', 'dark'].map(mode => h('option', { key: mode, value: mode }, t(mode))))),
            prefs.mode === 'schedule' && h('div', null, ...['day', 'night'].map(key => row(key, h('input', { id: `bdt-${key}`, type: 'time', value: prefs[key], onChange: e => update({ [key]: e.target.value }) })))),
            row('strength', h('input', { id: 'bdt-strength', type: 'range', min: 10, max: 100, step: 1, value: prefs.strength, 'aria-valuetext': `${prefs.strength}%`, onChange: e => update({ strength: Number(e.target.value) }) }), h('output', { htmlFor: 'bdt-strength' }, `${prefs.strength}%`))),
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
        const wake = () => { if (document.visibilityState === 'visible') tick(); };
        const online = () => { lastCheck = 0; tick(); };
        const storage = event => {
          if (event.key !== KEY) return;
          try { update(core.normalizeSettings(JSON.parse(event.newValue || '{}'))); } catch { /* Ignore invalid third-party storage writes. */ }
        };
        document.addEventListener('visibilitychange', wake); window.addEventListener('online', online); window.addEventListener('storage', storage);
        syncMode(); void refresh();
        return () => {
          alive = false; generation++; clearInterval(timer); controller?.abort();
          document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', online); window.removeEventListener('storage', storage);
          document.getElementById(BOOT_STYLE_ID)?.remove();
          tokenDisposer?.(); restoreTheme(); if (activeUrl) URL.revokeObjectURL(activeUrl); listeners.clear();
        };
      });
    },
  };
}
