import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { pluginPageCSS } from '../src/client/compatibility.js';
import { contrast, makeTokens, PALETTE_MODES } from '../src/client/theme/palette.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('wallpaper integration targets page canvases and leaves overlays and semantic colours alone', async () => {
  const wallpaper = pluginPageCSS(false), themed = pluginPageCSS(true);
  assert.ok(themed.startsWith(wallpaper));
  assert.match(wallpaper, /\[data-conversation-composer-overlay\]:has\(\[data-trajectory-scroll\]\)/);
  assert.match(wallpaper, /\[data-trajectory-scroll\] > table\[data-scroll-ready\]/);
  assert.match(wallpaper, /\.lc-root:not\(:is\(\[data-sidebar-right-panel\], \.lc-modal-card\) \*\)/);
  assert.match(wallpaper, /\[data-global-panel\] \.lc-ov-page\)\{--lc-canvas:transparent\}/);
  const library = '[data-global-panel] [data-studio-mount] [data-testid="native-template-library"]';
  assert.ok(wallpaper.includes(`${library}{background-color:transparent}`));
  assert.doesNotMatch(wallpaper, /--lc-control-track|--action-background|--dsw-alias-trajectory-accent/);
  assert.match(themed, /table\[data-scroll-ready\]\{--dsw-alias-trajectory-accent:var\(--dsw-alias-brand-primary\)/);
  assert.match(themed, /--lc-control-track:var\(--dsw-alias-bg-layer-2\)/);
  assert.match(themed, /:is\(\.lc-card:not\(\.lc-recom\), \.lc-pulse-header\):not\(\.lc-modal-card \*\)\{background-color:/);
  assert.match(themed, /--action-background:var\(--dsw-alias-button-primary-fill\)/);
  assert.match(themed, /--action-foreground:var\(--dsw-alias-label-primary-foreground\)/);
  assert.doesNotMatch(themed, /(?:backdrop-)?filter:|--dsw-alias-state-[\w-]+:|--chart-\d|--lc-(?:member|task)-hue|\.lc-heat|template-library-item|\biframe\b|(?:^|,)table\b/m);
  assert.deepEqual((await transform(themed, { loader: 'css' })).warnings, []);

  const source = await read('src/client/client-main.js');
  const component = source.slice(source.indexOf('function Wallpaper()'), source.indexOf('function Settings()'));
  assert.match(component, /if \(!s\.settings\.enabled \|\| !s\.url\) return null;[\s\S]+\$\{pluginPageCSS\(s\.settings\.dynamic\)\}/);
  const bundle = await read('dist/client.js');
  for (const marker of [library, 'table[data-scroll-ready]', '--lc-canvas:transparent', '--lc-control-track:var(--dsw-alias-bg-layer-2)']) {
    assert.ok(bundle.includes(marker), marker);
  }
});

test('themed card and template foreground/background pairs retain contrast', () => {
  const rgb = value => value.match(/\d+/g).map(Number);
  const mix = (base, top, opacity) => base.map((v, i) => v * (1 - opacity) + top[i] * opacity);
  for (const mode of PALETTE_MODES) for (const accent of [[190, 38, 44], [20, 95, 210], [128, 255, 255], [92, 116, 132]]) {
    const tokens = makeTokens(accent, 100, mode, 'high-contrast');
    for (const scheme of ['light', 'dark']) {
      const get = role => rgb(tokens[`--dsw-alias-${role}`][scheme]);
      const surface = get('bg-layer-1');
      const card = mix(surface, get('brand-primary'), .07);
      for (const role of ['label-primary', 'label-secondary', 'label-tertiary']) {
        for (const fill of [card, get('bg-layer-2'), get('interactive-bg-active'), get('interactive-bg-hover')]) {
          assert.ok(contrast(get(role), fill) >= 4.5, `${mode}/${accent}/${scheme}/${role}`);
        }
      }
      for (const fill of ['button-primary-fill', 'button-primary-hover']) {
        assert.ok(contrast(get('label-primary-foreground'), get(fill)) >= 4.5, `${mode}/${scheme}/${fill}`);
      }
    }
  }
});
