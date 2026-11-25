// DSH paints its base on the frame and again on the conversation. The photo
// owns wallpaper visibility, so the shell only needs its foreground surfaces.
export const SHELL_FRAME = 'body div:has(> [data-shell-overlay])';
export const SHELL_WALLPAPER_CSS = `
${SHELL_FRAME},
html[data-windows-titlebar] ${SHELL_FRAME},
${SHELL_FRAME} > div:has(> div > [data-slot="main"]),
${SHELL_FRAME} > :is([data-rightbar-col],[data-shell-bottom]),
body [data-slot="main.conversation"] > [data-phase]{background-color:transparent}
`;

// dshmarket 1.73.20 ConfirmFold declares these four variables locally using
// literal light colors. Body token inheritance cannot replace them. Restrict
// this adapter to its actual CSS-module class; do not recolor images or states.
// Both normal and uncommon (inverse) capability pills consume the paired roles.
export const MARKETPLACE_THEME_CSS = `body .nUhMVa_confirmPanel{--fold-bg:var(--dsw-alias-bg-layer-2)!important;--fold-border:var(--dsw-alias-border-l2)!important;--fold-ink:var(--dsw-alias-label-primary)!important;--fold-on-ink:var(--dsw-alias-bg-layer-1)!important}`;

// DSH 0.2.2-rc.4, dsh-context 0.86.0 and Design beta.30. Expose the
// existing shell wallpaper instead of painting or filtering a second copy.
const trajectory = '[data-conversation-composer-overlay]:has([data-trajectory-scroll])';
const ledger = `${trajectory} [data-trajectory-scroll] > table[data-scroll-ready]`;
const contextPage = 'body :is(.lc-root:not(:is([data-sidebar-right-panel], .lc-modal-card) *), [data-global-panel] .lc-ov-page)';
const templates = '[data-global-panel] [data-studio-mount] [data-testid="native-template-library"]';
const pageWallpaper = `
${trajectory},${trajectory} div:has(> [data-trajectory-scroll]),${templates}{background-color:transparent}
${contextPage}{--lc-canvas:transparent}
/* One extra light/dark matte for dense ledger text, not one per wrapper.
   Sticky toolbar, timeline, selection and details keep their own fills. */
${ledger}{background-color:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 40%,transparent)}
`;

// Only the template library UI consumes this bridge. Don't remap Design's
// document palettes, chart roles, preview colours or portalled overlays.
const templateTheme = {
  background: 'bg-layer-1', foreground: 'label-primary',
  muted: 'bg-layer-2', 'muted-foreground': 'label-secondary',
  secondary: 'interactive-bg-active', 'secondary-foreground': 'label-primary',
  accent: 'interactive-bg-hover', 'accent-foreground': 'label-primary',
  border: 'border-l2', input: 'border-l2', ring: 'brand-primary',
  primary: 'button-primary-fill', 'primary-foreground': 'label-primary-foreground',
  'action-background': 'button-primary-fill', 'action-hover': 'button-primary-hover',
  'action-pressed': 'button-primary-hover', 'action-foreground': 'label-primary-foreground',
  'action-pressed-foreground': 'label-primary-foreground',
};
const pageTheme = `
${ledger}{--dsw-alias-trajectory-accent:var(--dsw-alias-brand-primary)}
${contextPage}{--lc-control-track:var(--dsw-alias-bg-layer-2)}
${contextPage} :is(.lc-card:not(.lc-recom), .lc-pulse-header):not(.lc-modal-card *){background-color:color-mix(in srgb,var(--dsw-alias-bg-layer-1),var(--dsw-alias-brand-primary) 7%)}
${templates}{${Object.entries(templateTheme).map(([key, alias]) => `--${key}:var(--dsw-alias-${alias})`).join(';')}}
`;

export function pluginPageCSS(dynamic) {
  return dynamic ? pageWallpaper + pageTheme : pageWallpaper;
}

// Opt-in system tweaks for third-party plugins that write default hardcoded
// accent colors inline (e.g. dsh-quick-prompts's #4D6BFE default chip).
export const SYSTEM_TWEAKS_CSS = `body .qp-chip[style*="#4D6BFE" i]{--chip-color:var(--dsw-alias-brand-primary)!important}`;
