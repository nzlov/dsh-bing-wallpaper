import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PALETTE_MODES, makeTokens, contrast } from '../palette.js';
import { palettePreviewStyle, PALETTE_PREVIEW_CSS } from '../palette-preview.js';
const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const ROLES = {
  canvas: '--dsw-specific-sidebar-fill', surface: '--dsw-alias-bg-layer-1', raised: '--dsw-alias-bg-layer-2',
  selected: '--dsw-specific-sidebar-nav-item-active', ink: '--dsw-alias-label-primary', muted: '--dsw-alias-label-secondary',
  border: '--dsw-alias-border-l2', brand: '--dsw-alias-brand-primary', 'on-brand': '--dsw-alias-label-primary-foreground',
  bubble: '--dsw-specific-bubble', code: '--dsw-alias-markdown-code-block', input: '--dsw-specific-input-major',
};
const rgb = css => {
  assert.match(css, /^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
  return css.match(/\d+/g).map(Number);
};

test('all ten previews use each mode’s own paired roles, not the currently selected theme', () => {
  for (const accent of [[198, 109, 37], [29, 112, 218], [128, 128, 128]]) {
    for (const mode of PALETTE_MODES) {
      const tokens = makeTokens(accent, 28, mode);
      const before = JSON.stringify(tokens);
      for (const scheme of ['light', 'dark']) {
        const style = palettePreviewStyle(tokens, scheme);
        assert.equal(Object.keys(style).length, Object.keys(ROLES).length);
        for (const [role, token] of Object.entries(ROLES)) assert.equal(style[`--bdt-mini-${role}`], tokens[token][scheme], `${mode}/${scheme}/${role}`);
        assert.ok(Object.keys(style).every(key => key.startsWith('--bdt-mini-')));
      }
      assert.equal(JSON.stringify(tokens), before, 'preview must not mutate or override live tokens');
    }
  }
});

test('preview text and chat surfaces remain readable in both schemes at visibility endpoints', () => {
  for (const mode of PALETTE_MODES) for (const strength of [10, 28, 100]) {
    const tokens = makeTokens([198, 109, 37], strength, mode);
    for (const scheme of ['light', 'dark']) {
      const style = palettePreviewStyle(tokens, scheme);
      const c = role => rgb(style[`--bdt-mini-${role}`]);
      const context = `${mode}/${strength}/${scheme}`;
      for (const surface of ['canvas', 'surface', 'raised', 'selected', 'bubble', 'code', 'input']) {
        assert.ok(contrast(c('ink'), c(surface)) >= 4.5, `${context}/ink/${surface}`);
        assert.ok(contrast(c('muted'), c(surface)) >= 4.5, `${context}/muted/${surface}`);
        assert.ok(contrast(c('border'), c(surface)) >= 3, `${context}/border/${surface}`);
      }
      assert.ok(contrast(c('on-brand'), c('brand')) >= 4.5, `${context}/primary-action`);
    }
  }
});

test('current scheme and new image colors change preview styles without leaking CSS roles', () => {
  const warm = makeTokens([215, 98, 20], 28, 'content');
  const cool = makeTokens([29, 82, 214], 28, 'content');
  assert.notDeepEqual(palettePreviewStyle(warm, 'light'), palettePreviewStyle(cool, 'light'));
  assert.notDeepEqual(palettePreviewStyle(warm, 'light'), palettePreviewStyle(warm, 'dark'));
  assert.deepEqual(palettePreviewStyle(warm), palettePreviewStyle(warm, 'light'));
  assert.deepEqual(palettePreviewStyle(warm, 'invalid'), palettePreviewStyle(warm, 'light'));
  assert.notEqual(palettePreviewStyle(warm, 'light'), palettePreviewStyle(warm, 'light'));
  const used = new Set([...PALETTE_PREVIEW_CSS.matchAll(/var\((--bdt-mini-[a-z-]+)\)/g)].map(match => match[1]));
  assert.deepEqual([...used].sort(), Object.keys(palettePreviewStyle(warm, 'light')).sort());
  assert.doesNotMatch(PALETTE_PREVIEW_CSS, /--dsw-|#[0-9a-f]{3,8}\b|rgba?\(|\b(?:white|black)\b|url\(/i);
});

test('miniature markup is decorative and contains no fake interactive or focusable controls', async () => {
  const source = await read('palette-preview.js');
  assert.deepEqual([...new Set([...source.matchAll(/h\('([^']+)'/g)].map(match => match[1]))], ['span', 'svg', 'line']);
  assert.match(source, /className: 'bdt-mini-split', 'aria-hidden': true/);
  assert.match(source, /className: 'bdt-mini-diagonal'[^\n]+focusable: false/);
  for (const part of ['app', 'sidebar', 'logo', 'nav-active', 'chat', 'bubble', 'code', 'composer', 'send']) assert.ok(source.includes(`bdt-mini-${part}`));
  assert.match(source, /className: 'bdt-mini-logo' \}, 'DSH'/);
  assert.doesNotMatch(source, /bdt-mini-(?:window|bar|tabs|number|button|slider)/, 'use DSH layout instead of the generic sample window');
  assert.doesNotMatch(source, /\b(?:tabIndex|onClick|onChange|dangerouslySetInnerHTML|fetch|localStorage)\b|\b(?:role|href|id):/);
});

test('aligned full-size light and dark scenes have complementary diagonal clips', async () => {
  const source = await read('palette-preview.js');
  assert.match(source, /export function renderPaletteMiniature\(h, tokens\)/);
  assert.match(source, /renderScene\(h, tokens, 'light'\), renderScene\(h, tokens, 'dark'\)/);
  assert.match(PALETTE_PREVIEW_CSS, /bdt-mini-split>\.bdt-mini\{position:absolute;inset:0\}/);
  assert.match(PALETTE_PREVIEW_CSS, /bdt-mini-light\{clip-path:polygon\(0 0,100% 0,0 100%\)\}/);
  assert.match(PALETTE_PREVIEW_CSS, /bdt-mini-dark\{clip-path:polygon\(100% 0,100% 100%,0 100%\)\}/);
  assert.match(source, /x1: 100, y1: 0, x2: 0, y2: 100, vectorEffect: 'non-scaling-stroke'/);
});

test('native radio group preserves selection, disabling and visible keyboard focus', async () => {
  const source = await read('client-main.js');
  assert.match(source, /h\('fieldset', \{ className: 'bdt-palette-group', disabled: !prefs\.dynamic/);
  assert.match(source, /h\('legend', null, t\('paletteMode'\)\)/);
  assert.match(source, /const paletteGroup = React\.useId\(\)/);
  assert.match(source, /htmlFor: `\$\{paletteGroup\}-\$\{mode\}`/);
  assert.match(source, /id: `\$\{paletteGroup\}-\$\{mode\}`[^\n]+type: 'radio', name: paletteGroup, value: mode, checked: prefs\.paletteMode === mode, onChange: \(\) => update\(\{ paletteMode: mode \}\)/);
  assert.match(source, /bdt-palette-choice:focus-visible\+\.bdt-palette-card\{outline:2px/);
  assert.match(source, /className: 'bdt-palette-check', 'aria-hidden': true \}, '✓'/);
  assert.match(source, /bdt-palette-choice:checked\+\.bdt-palette-card \.bdt-palette-check\{visibility:visible\}/);
  const radioStyle = source.match(/\.bdt-palette-choice\{([^}]+)\}/)?.[1];
  assert.ok(radioStyle);
  assert.doesNotMatch(radioStyle, /display:none|visibility:hidden/);
  assert.doesNotMatch(source, /onKeyDown|aria-checked|role: 'radio'/, 'keep native radio keyboard behavior and state');
});

test('grid adapts to container width and memoization does not depend on selected mode', async () => {
  const source = await read('client-main.js');
  assert.match(source, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,180px\),1fr\)\)/);
  assert.match(source, /\.bdt-palette-name\{[^}]+overflow-wrap:anywhere/);
  assert.match(source, /const palettes = React\.useMemo\(\(\) => core\.PALETTE_MODES\.map\(mode => \(\{ mode, tokens: core\.makeTokens\(s\.accent, prefs\.strength, mode\) \}\)\), \[s\.accent, prefs\.strength\]\)/);
  assert.match(source, /renderPaletteMiniature\(h, previewTokens\)/);
  const manifest = JSON.parse(await read('package.json'));
  assert.ok(manifest.files.includes('client.js'));
  assert.ok(!manifest.files.includes('palette-preview.js'), 'preview source is bundled, not shipped as an extra runtime module');
  const client = await read('client.js');
  for (const name of ['bdt-palette-grid', 'bdt-mini-split', 'bdt-mini-diagonal', 'bdt-mini-app', 'bdt-mini-composer', 'bdt-mini-code', 'bdt-palette-choice']) assert.ok(client.includes(name), `${name} missing from prebuilt client`);
});
