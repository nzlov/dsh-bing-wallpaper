// A decorative DSH layout thumbnail, not a second working interface. All colors
// use the actual sidebar/chat/composer roles, scoped to private preview variables.
const PREVIEW_ROLES = Object.freeze({
  canvas: '--dsw-specific-sidebar-fill',
  surface: '--dsw-alias-bg-layer-1',
  raised: '--dsw-alias-bg-layer-2',
  selected: '--dsw-specific-sidebar-nav-item-active',
  ink: '--dsw-alias-label-primary',
  muted: '--dsw-alias-label-secondary',
  border: '--dsw-alias-border-l2',
  brand: '--dsw-alias-brand-primary',
  'on-brand': '--dsw-alias-label-primary-foreground',
  bubble: '--dsw-specific-bubble',
  code: '--dsw-alias-markdown-code-block',
  input: '--dsw-specific-input-major',
});

export function palettePreviewStyle(tokens, scheme) {
  const variant = scheme === 'dark' ? 'dark' : 'light';
  return Object.fromEntries(Object.entries(PREVIEW_ROLES).map(([role, key]) => [`--bdt-mini-${role}`, tokens[key][variant]]));
}

// Overlay two identical full-size layouts, rather than compressing each theme
// into half a window. Complementary clips keep every UI detail aligned.
export function renderPaletteMiniature(h, tokens) {
  return h('span', { className: 'bdt-mini-split', 'aria-hidden': true, style: palettePreviewStyle(tokens, 'light') },
    renderScene(h, tokens, 'light'), renderScene(h, tokens, 'dark'),
    h('svg', { className: 'bdt-mini-diagonal', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': true, focusable: false },
      h('line', { x1: 100, y1: 0, x2: 0, y2: 100, vectorEffect: 'non-scaling-stroke' })));
}

function renderScene(h, tokens, scheme) {
  return h('span', { className: `bdt-mini bdt-mini-${scheme}`, 'aria-hidden': true, style: palettePreviewStyle(tokens, scheme) },
    h('span', { className: 'bdt-mini-app' },
      h('span', { className: 'bdt-mini-sidebar' },
        h('span', { className: 'bdt-mini-logo' }, 'DSH'),
        h('span', { className: 'bdt-mini-nav bdt-mini-nav-active' }, h('span', { className: 'bdt-mini-line' })),
        h('span', { className: 'bdt-mini-nav' }, h('span', { className: 'bdt-mini-line' })),
        h('span', { className: 'bdt-mini-nav' }, h('span', { className: 'bdt-mini-line bdt-mini-short' })),
        h('span', { className: 'bdt-mini-sidebar-footer' }, h('span', { className: 'bdt-mini-line bdt-mini-short' }))),
      h('span', { className: 'bdt-mini-chat' },
        h('span', { className: 'bdt-mini-heading' }, h('span', { className: 'bdt-mini-line' }), h('span', { className: 'bdt-mini-badge' })),
        h('span', { className: 'bdt-mini-bubble' }, h('span', { className: 'bdt-mini-line' })),
        h('span', { className: 'bdt-mini-reply' },
          h('span', { className: 'bdt-mini-line' }), h('span', { className: 'bdt-mini-line bdt-mini-short' }),
          h('span', { className: 'bdt-mini-code' }, h('span', { className: 'bdt-mini-code-line' }), h('span', { className: 'bdt-mini-code-line bdt-mini-short' }))),
        h('span', { className: 'bdt-mini-composer' }, h('span', { className: 'bdt-mini-line' }), h('span', { className: 'bdt-mini-send' }, '↑')))));
}

export const PALETTE_PREVIEW_CSS = `
.bdt-mini-split{position:relative;display:block;height:116px;overflow:hidden;border-radius:7px;color:var(--bdt-mini-border);pointer-events:none;user-select:none}
.bdt-mini-split>.bdt-mini{position:absolute;inset:0}.bdt-mini-light{clip-path:polygon(0 0,100% 0,0 100%)}.bdt-mini-dark{clip-path:polygon(100% 0,100% 100%,0 100%)}
.bdt-mini-diagonal{position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.5}
.bdt-mini{display:block;border-radius:8px;color:var(--bdt-mini-ink);font-size:9px;line-height:1.2;user-select:none;pointer-events:none}
.bdt-mini-app{display:grid;grid-template-columns:29% minmax(0,1fr);height:116px;overflow:hidden;border:1px solid var(--bdt-mini-border);border-radius:7px;background:var(--bdt-mini-surface)}
.bdt-mini-sidebar{display:flex;flex-direction:column;gap:5px;min-width:0;padding:7px 5px;background:var(--bdt-mini-canvas);border-inline-end:1px solid var(--bdt-mini-border)}
.bdt-mini-logo{display:block;padding:0 3px 3px;font-weight:700;font-size:9px;letter-spacing:.3px}
.bdt-mini-nav{display:flex;align-items:center;min-height:12px;padding:4px;border-radius:3px;color:var(--bdt-mini-muted)}.bdt-mini-nav-active{background:var(--bdt-mini-selected);color:var(--bdt-mini-brand)}.bdt-mini-sidebar-footer{display:block;margin-top:auto;padding:4px;color:var(--bdt-mini-muted)}
.bdt-mini-line{display:block;width:85%;height:3px;flex-shrink:1;border-radius:2px;background:currentColor}.bdt-mini-short{width:58%}
.bdt-mini-chat{display:flex;flex-direction:column;gap:6px;min-width:0;padding:7px}
.bdt-mini-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--bdt-mini-muted)}.bdt-mini-heading>.bdt-mini-line{width:52%}.bdt-mini-badge{display:block;width:13px;height:6px;border-radius:3px;background:var(--bdt-mini-raised)}
.bdt-mini-bubble{display:block;align-self:flex-end;width:75%;padding:5px 6px;border-radius:5px;background:var(--bdt-mini-bubble)}
.bdt-mini-reply{display:flex;flex-direction:column;gap:4px;min-width:0}.bdt-mini-code{display:flex;flex-direction:column;gap:3px;padding:5px 6px;border-radius:4px;background:var(--bdt-mini-code)}.bdt-mini-code-line{display:block;width:80%;height:2px;border-radius:2px;background:var(--bdt-mini-muted)}.bdt-mini-code-line.bdt-mini-short{width:54%}
.bdt-mini-composer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:22px;margin-top:auto;padding:3px 4px 3px 6px;border:1px solid var(--bdt-mini-border);border-radius:5px;background:var(--bdt-mini-input);color:var(--bdt-mini-muted)}.bdt-mini-composer>.bdt-mini-line{width:48%}.bdt-mini-send{display:flex;align-items:center;justify-content:center;flex:0 0 14px;height:14px;border-radius:4px;background:var(--bdt-mini-brand);color:var(--bdt-mini-on-brand);font-size:11px;font-weight:600}
`;
