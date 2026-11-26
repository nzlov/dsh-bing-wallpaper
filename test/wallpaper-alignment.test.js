import test from 'node:test';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { wallpaperGeometry, alignWallpaper } from '../src/client/wallpaper/wallpaper-alignment.js';
import { wallpaperFilters } from '../src/shared/wallpaper-filter.js';

test('one viewport cover preserves image proportions across desktop and mobile breakpoints', () => {
  for (const [vw, vh] of [[3019, 1389], [2175, 1927], [709, 1511], [767, 900], [768, 900], [1023, 900], [1024, 900]]) {
    for (const [iw, ih] of [[1920, 1080], [2400, 1600]]) {
      const geometry = wallpaperGeometry(vw, vh, iw, ih);
      assert.ok(geometry.width >= vw && geometry.height >= vh);
      assert.ok(Math.abs(geometry.width / geometry.height - iw / ih) < 1e-10);
      assert.equal(geometry.x * 2 + geometry.width, vw);
      assert.equal(geometry.y * 2 + geometry.height, vh);
    }
  }
  for (const value of [null, 'bad', Infinity, NaN, -1, 0]) {
    const geometry = wallpaperGeometry(value, value, value, value);
    assert.ok(Object.values(geometry).every(Number.isFinite));
  }
});

function fixture() {
  const style = () => {
    const values = new Map(), priorities = new Map();
    return {
      getPropertyValue: key => values.get(key) || '', getPropertyPriority: key => priorities.get(key) || '',
      setProperty(key, value, priority = '') { values.set(key, value); priorities.set(key, priority); },
      removeProperty(key) { values.delete(key); priorities.delete(key); },
    };
  };
  const element = (left, top, border = 0) => ({
    style: style(), clientLeft: border, clientTop: border, box: { left, top }, isConnected: true, running: false,
    getBoundingClientRect() { return this.box; }, getAnimations() { return this.running ? [{ playState: 'running' }] : []; },
    matches: () => true, closest: () => ({}), nodeType: 1,
  });
  const root = element(0, 0), left = element(0, 0, 1), right = element(2238.5, 0, 1), split = element(2600, 700);
  const document = { documentElement: root, body: {}, surfaces: [left, right, split], querySelectorAll() { return this.surfaces; } };
  const callbacks = new Map(), frames = new Map(), observations = [];
  let id = 0, time = 0;
  const window = {
    innerWidth: 3019, innerHeight: 1389, performance: { now: () => time },
    requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(name, fn) { callbacks.set(name, fn); }, removeEventListener(name) { callbacks.delete(name); },
    ResizeObserver: class {
      targets = new Set();
      constructor(callback) { this.callback = callback; observations.push(this); }
      observe(target) { this.targets.add(target); } unobserve(target) { this.targets.delete(target); } disconnect() { this.targets.clear(); }
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observations.push(this); }
      observe(target, options) { this.target = target; this.options = options; } disconnect() { this.disconnected = true; }
    },
  };
  const flush = () => { time += 16; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  const fire = (name, detail = {}) => callbacks.get(name)?.({ type: name, ...detail });
  return { document, window, root, left, right, split, frames, callbacks, observations, element, flush, fire };
}

test('panel offsets map every split and bordered surface onto the same viewport pixels', () => {
  const f = fixture();
  const dispose = alignWallpaper({ ...f, surfaces: 'test-surfaces', imageWidth: 1920, imageHeight: 1080 });
  const check = () => {
    const geometry = wallpaperGeometry(f.window.innerWidth, f.window.innerHeight, 1920, 1080);
    assert.equal(f.root.style.getPropertyValue('--bdt-wallpaper-size'), `${geometry.width}px ${geometry.height}px`);
    for (const target of f.document.surfaces) {
      const x = parseFloat(target.style.getPropertyValue('--bdt-wallpaper-x'));
      const y = parseFloat(target.style.getPropertyValue('--bdt-wallpaper-y'));
      assert.equal(parseFloat(target.style.getPropertyValue('--bdt-glass-x')) + target.box.left, 0);
      assert.equal(parseFloat(target.style.getPropertyValue('--bdt-glass-y')) + target.box.top, 0);
      assert.equal(x + target.box.left, geometry.x);
      assert.equal(y + target.box.top, geometry.y);
    }
  };
  check();
  f.window.innerWidth = 709; f.window.innerHeight = 1511;
  f.right.box = { left: 0, top: 0 }; f.split.box = { left: 0, top: 760 };
  f.fire('resize'); f.flush(); check();
  f.left.box.left = -240;
  f.fire('pointerdown', { target: f.left }); f.fire('pointermove'); f.flush(); check();
  f.fire('pointerup'); f.flush();
  f.right.running = true;
  f.fire('transitionrun', { target: f.right, propertyName: 'transform' });
  f.right.box.left = 120; f.flush(); check();
  f.right.box.left = 60; f.flush(); check();
  f.right.running = false; f.right.box.left = 0; f.flush(); check();
  assert.equal(f.frames.size, 0);
  dispose();
});

test('docking mutations observe new panes, retire removed ones and restore only owned custom properties', () => {
  const f = fixture();
  f.root.style.setProperty('--bdt-wallpaper-x', '25px', 'important');
  f.root.style.setProperty('color', 'red');
  const dispose = alignWallpaper({ ...f, surfaces: 'test-surfaces' });
  const [resize, mutations] = f.observations;
  const next = f.element(2500, 0);
  f.document.surfaces = [f.left, next];
  mutations.callback([{ type: 'childList', addedNodes: [next], removedNodes: [f.right, f.split] }]);
  assert.ok(resize.targets.has(next) && !resize.targets.has(f.right));
  assert.equal(f.right.style.getPropertyValue('--bdt-wallpaper-x'), '');
  assert.ok(next.style.getPropertyValue('--bdt-wallpaper-x'));
  next.style.setProperty('--bdt-wallpaper-x', 'external-owner');
  f.fire('resize');
  assert.equal(f.frames.size, 1);
  dispose();
  assert.equal(f.frames.size, 0);
  assert.equal(f.callbacks.size, 0);
  assert.equal(resize.targets.size, 0);
  assert.equal(mutations.disconnected, true);
  assert.equal(f.root.style.getPropertyValue('--bdt-wallpaper-x'), '25px');
  assert.equal(f.root.style.getPropertyPriority('--bdt-wallpaper-x'), 'important');
  assert.equal(f.root.style.getPropertyValue('color'), 'red');
  assert.equal(next.style.getPropertyValue('--bdt-wallpaper-x'), 'external-owner');
});

test('owned background layers remain mounted through transitions and mode changes and retire with their pane', () => {
  const f = fixture(), created = new Map(), removed = [];
  const dispose = alignWallpaper({
    ...f, surfaces: 'test-surfaces',
    mountBackground(target) {
      const layer = f.element(0, 0);
      layer.getBoundingClientRect = () => ({ left: target.box.left + .5, top: target.box.top + .5 });
      layer.remove = () => { removed.push(layer); };
      created.set(target, layer);
      return layer;
    },
  });
  const check = target => {
    const origin = created.get(target).getBoundingClientRect();
    const geometry = wallpaperGeometry(f.window.innerWidth, f.window.innerHeight, 1920, 1080);
    assert.equal(parseFloat(target.style.getPropertyValue('--bdt-wallpaper-x')) + origin.left, geometry.x);
    assert.equal(parseFloat(target.style.getPropertyValue('--bdt-wallpaper-y')) + origin.top, geometry.y);
  };
  check(f.right);
  const [resize, mutations] = f.observations;
  assert.ok(resize.targets.has(created.get(f.right)));
  f.right.running = true;
  f.fire('transitionrun', { target: f.right, propertyName: 'transform' });
  f.right.box.left = 2400; f.flush(); check(f.right);
  mutations.callback([{ type: 'attributes' }]);
  f.right.box.left = 2300; f.flush(); check(f.right);
  assert.equal(created.size, 3, 'mode and visibility changes reuse the filtered layers');
  assert.equal(removed.length, 0);
  assert.ok(mutations.options.attributeFilter.includes('data-sidebar-collapsed'));
  assert.ok(mutations.options.attributeFilter.includes('data-sidebar-right-opening'));
  f.left.box.left = -240;
  mutations.callback([{ type: 'attributes', attributeName: 'data-sidebar-collapsed', target: f.left }]);
  check(f.left);
  f.right.running = false; f.flush();
  f.document.surfaces = [f.left, f.split];
  mutations.callback([{ type: 'childList', addedNodes: [], removedNodes: [f.right] }]);
  f.flush();
  assert.deepEqual(removed, [created.get(f.right)]);
  assert.ok(!resize.targets.has(created.get(f.right)));
  dispose();
  assert.equal(removed.length, 3);
  assert.equal(new Set(removed).size, 3, 'each owned layer is removed exactly once');
});

test('retained tabs, sessions and dock/float migrations refresh layers on marker changes alone', () => {
  const f = fixture(), mounted = [], removed = [];
  const dispose = alignWallpaper({
    ...f, surfaces: 'test-surfaces',
    mountBackground(target) {
      const layer = f.element(0, 0);
      layer.getBoundingClientRect = () => target.getBoundingClientRect();
      layer.remove = () => removed.push(target);
      mounted.push(target);
      return layer;
    },
  });
  const mutations = f.observations[1];
  for (const name of ['data-dockkit-pane', 'data-dockkit-host', 'hidden']) {
    assert.ok(mutations.options.attributeFilter.includes(name), name);
  }
  const retained = f.element(2000, 0);
  f.document.surfaces = [f.left, retained];
  mutations.callback([{ type: 'attributes', attributeName: 'data-dockkit-pane', target: retained }]);
  f.flush();
  assert.deepEqual(mounted, [f.left, f.right, f.split, retained]);
  assert.deepEqual(removed, [f.right, f.split]);
  retained.box = { left: 1500, top: 50 };
  mutations.callback([{ type: 'attributes', attributeName: 'hidden', target: retained }]);
  f.flush();
  const geometry = wallpaperGeometry(f.window.innerWidth, f.window.innerHeight, 1920, 1080);
  assert.equal(parseFloat(retained.style.getPropertyValue('--bdt-wallpaper-x')) + 1500, geometry.x);
  assert.equal(parseFloat(retained.style.getPropertyValue('--bdt-wallpaper-y')) + 50, geometry.y);
  assert.equal(mounted.length, 4, 'showing a retained session reuses its layer');
  f.document.surfaces = [f.left];
  mutations.callback([{ type: 'attributes', attributeName: 'data-dockkit-host', target: retained }]);
  f.flush();
  assert.deepEqual(removed, [f.right, f.split, retained], 'floating panes release docked background ownership');
  f.document.surfaces = [f.left, retained];
  mutations.callback([{ type: 'attributes', attributeName: 'data-dockkit-host', target: retained }]);
  f.flush();
  assert.equal(mounted.length, 5, 'docking an existing pane mounts a fresh filtered layer');
  dispose();
});

test('the aligned main filter centers the cover with or without a measured size', async () => {
  const css = wallpaperFilters.css({
    selector: 'html', image: 'url("photo")', overlays: ['rgba(255, 255, 255, 0.56)'],
    settings: { filterMode: 'blur', filterAmounts: { blur: 12 } }, fixed: true, aligned: true,
  });
  assert.ok(css.includes('inset:-36px'));
  assert.ok(css.includes('background:url("photo") center/cover no-repeat'));
  assert.ok(css.includes('background-size:var(--bdt-wallpaper-size,cover)'));
  assert.ok(css.includes('background-position:calc(var(--bdt-wallpaper-x,50% - 36px) + 36px) calc(var(--bdt-wallpaper-y,50% - 36px) + 36px)'));
  assert.ok(css.includes('filter:blur(12px)'));
  const result = await transform(css, { loader: 'css' });
  assert.deepEqual(result.warnings, []);
});
