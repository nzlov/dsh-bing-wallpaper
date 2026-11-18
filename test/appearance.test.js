import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppearanceController } from '../appearance.js';
import { DEFAULTS, scheduledScheme } from '../palette.js';
function setup(preference = 'system') {
  let controller, external = 0;
  const theme = { getTheme: () => ({ preference }), setTheme: next => { preference = next; controller.changed({ preference }); } };
  controller = createAppearanceController(theme, () => external++, scheduledScheme);
  return { theme, controller, external: () => external };
}
test('scheduled switching restores prior appearance and emits no external override', () => {
  const { theme, controller, external } = setup();
  controller.sync(DEFAULTS, new Date(2026, 10, 18, 8)); assert.equal(theme.getTheme().preference, 'light');
  controller.sync(DEFAULTS, new Date(2026, 10, 18, 20)); assert.equal(theme.getTheme().preference, 'dark');
  controller.restore(); assert.equal(theme.getTheme().preference, 'system'); assert.equal(external(), 0);
});
test('user Appearance overrides stop ownership, and a fresh takeover restores the latest choice', () => {
  const { theme, controller, external } = setup();
  controller.sync({ ...DEFAULTS, mode: 'light' });
  theme.setTheme('dark'); assert.equal(external(), 1);
  controller.restore(); assert.equal(theme.getTheme().preference, 'dark');
  controller.sync({ ...DEFAULTS, mode: 'system' }); assert.equal(theme.getTheme().preference, 'system');
  controller.restore(); assert.equal(theme.getTheme().preference, 'dark');
});
test('follow mode never writes theme and disabling restores exactly once', () => {
  const { theme, controller } = setup('dark');
  controller.sync({ ...DEFAULTS, mode: 'follow' }); assert.equal(theme.getTheme().preference, 'dark');
  controller.sync({ ...DEFAULTS, mode: 'light' });
  controller.sync({ ...DEFAULTS, enabled: false }); assert.equal(theme.getTheme().preference, 'dark');
  theme.setTheme('light'); controller.restore(); assert.equal(theme.getTheme().preference, 'light');
});
test('token-only theme notifications do not give up schedule ownership', () => {
  const { controller, external } = setup();
  controller.sync({ ...DEFAULTS, mode: 'light' }); controller.changed({ preference: 'light' }); assert.equal(external(), 0);
});
