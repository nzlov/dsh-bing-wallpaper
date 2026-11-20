import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as core from '../palette.js';
import { createPlugin } from '../client-main.js';
import { createAppearanceController } from '../appearance.js';
import { PREFERENCES_KEY } from '../boot-theme.js';

test('rapid main and sidebar slider changes converge across pages without storage echoes or stale-value jumps', async t => {
  const original = new Map(['localStorage', 'document', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const disposers = [], handlers = new Map(), apps = new Map(), writes = [], events = [];
  const notices = { a: 0, b: 0 };
  const en = JSON.parse(await readFile(new URL('../locale/en.json', import.meta.url), 'utf8'));
  const initial = core.normalizeSettings({
    mode: 'follow', filterMode: 'blur',
    leftSidebar: { filterMode: 'blur' }, rightSidebar: { filterMode: 'blur' },
  });
  const stored = new Map([[PREFERENCES_KEY, JSON.stringify(initial)]]);
  let active = 'a', themeWrites = 0, tokenWrites = 0;
  t.after(() => {
    try { for (const dispose of disposers.reverse()) dispose(); }
    finally { for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
  });
  globalThis.localStorage = {
    getItem: key => stored.get(key) ?? null,
    setItem(key, value) {
      const oldValue = stored.get(key) ?? null;
      stored.set(key, value);
      if (key !== PREFERENCES_KEY) return;
      writes.push({ from: active, value });
      if (oldValue !== value) for (const to of handlers.keys()) if (to !== active) events.push({ to, key, oldValue, newValue: value });
    },
    removeItem: key => stored.delete(key),
  };
  globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById() { return null; } };
  globalThis.window = {
    addEventListener(name, handler) { if (name === 'storage') handlers.set(active, handler); },
    removeEventListener(name, handler) {
      if (name === 'storage') for (const [owner, callback] of handlers) if (callback === handler) handlers.delete(owner);
    },
  };
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  const stores = new Set();
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) }),
    useSyncExternalStore(subscribe, get) {
      const value = get();
      if (value?.settings && !stores.has(subscribe)) {
        const owner = active;
        stores.add(subscribe);
        subscribe(() => { notices[owner]++; });
      }
      return value;
    },
    useState: initial => [initial(), () => {}], useMemo: make => make(), useId: () => 'test', useEffect() {}, useLayoutEffect() {},
  };
  for (const owner of ['a', 'b']) {
    active = owner;
    const slots = new Map();
    createPlugin(React, core, { en, zh: en }, createAppearanceController).apply({
      effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); }, on() {},
      locale: { register() {}, bind: () => key => en[key] ?? key, subscribe: () => () => {}, getSnapshot: () => 'en' },
      slots: { inject: (_, register) => register(), register(options, component) { slots.set(options.id, component); return () => {}; } },
      theme: {
        getTheme: () => ({ preference: 'light', active: { colorScheme: 'light' } }),
        setTheme() { themeWrites++; }, overrideTokens() { tokenWrites++; return () => {}; },
      },
    });
    apps.set(owner, slots.get('bing-daily-theme'));
  }
  await new Promise(setImmediate);
  const nodes = node => typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
  const view = owner => { active = owner; return nodes(apps.get(owner)()); };
  const input = (owner, id) => view(owner).find(node => node.props.id === id);
  const drag = (owner, id, amounts) => {
    const change = input(owner, id).props.onChange;
    for (const amount of amounts) { active = owner; change({ target: { value: String(amount) } }); }
  };
  const deliver = () => {
    const event = events.shift();
    active = event.to;
    handlers.get(event.to)(event);
  };
  const drain = () => {
    for (let budget = 100; events.length; budget--) {
      assert.ok(budget > 0, 'storage delivery must terminate, not re-enqueue alternating slider values');
      deliver();
    }
  };
  view('a'); view('b');
  const requests = fetch.mock.callCount();
  const amounts = Array.from({ length: 32 }, (_, i) => i + 1);
  drag('a', 'bdt-filterAmount.blur', amounts);
  assert.equal(writes.length, 32);
  assert.equal(notices.a, 32, 'one state notification per local input, without an extra unchanged save-status render');
  deliver();
  assert.equal(notices.b, 0, 'a queued old value must not move the peer slider backwards');
  drain();
  assert.equal(input('a', 'bdt-filterAmount.blur').props.value, 32);
  assert.equal(input('b', 'bdt-filterAmount.blur').props.value, 32);
  assert.equal(notices.b, 1);
  assert.equal(writes.length, 32, 'receivers must not write settings back');
  drag('b', 'bdt-leftSidebar.filterAmount', [9, 10, 11, 12, 20, 21, 31, 32]);
  drain();
  assert.equal(writes.length, 40);
  for (const owner of ['a', 'b']) {
    assert.equal(input(owner, 'bdt-leftSidebar.filterAmount').props.value, 32);
    assert.equal(input(owner, 'bdt-filterAmount.blur').props.value, 32);
    assert.equal(input(owner, 'bdt-rightSidebar.filterAmount').props.value, 12);
  }
  // Both pages can have pending input. The final stored snapshot wins once,
  // rather than replaying their earlier snapshots back and forth.
  drag('a', 'bdt-filterAmount.blur', [8, 9, 10]);
  drag('b', 'bdt-rightSidebar.filterAmount', [30, 31, 32]);
  drain();
  const latest = JSON.parse(stored.get(PREFERENCES_KEY));
  assert.equal(writes.length, 46);
  for (const owner of ['a', 'b']) {
    assert.equal(input(owner, 'bdt-filterAmount.blur').props.value, latest.filterAmounts.blur);
    assert.equal(input(owner, 'bdt-rightSidebar.filterAmount').props.value, latest.rightSidebar.filterAmounts.blur);
  }
  const before = { ...notices };
  active = 'a';
  handlers.get('a')({ key: PREFERENCES_KEY, newValue: stored.get(PREFERENCES_KEY) });
  assert.deepEqual(notices, before, 'duplicate snapshots do not render or write again');
  assert.equal(writes.length, 46);
  assert.equal(fetch.mock.callCount(), requests);
  assert.equal(themeWrites, 0);
  assert.equal(tokenWrites, 0);
});

test('range tracks and numeric outputs reserve stable widths across digit boundaries', async () => {
  const source = await readFile(new URL('../client-main.js', import.meta.url), 'utf8');
  assert.match(source, /\.bdt-filter-range\{width:12rem;max-width:100%;min-width:0;min-height:44px\}/);
  assert.match(source, /\.bdt-control output\{flex:0 0 5ch;min-width:5ch;white-space:nowrap;text-align:end;font-variant-numeric:tabular-nums\}/);
  assert.match(source, /h\('div', \{ key: label, className: 'bdt-row' \}/);
});
