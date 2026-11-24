import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowLightOrbit } from '../window-light.js';

const at = (hour, minute = 0, date = 24) => new Date(2026, 10, date, hour, minute);

test('clock-only calls select daylight from 06:00 to 18:00', () => {
  const orbit = date => windowLightOrbit('south', date);
  assert.equal(orbit(at(5, 59)).day, false);
  assert.equal(orbit(at(6)).day, true);
  assert.equal(orbit(at(17, 59)).day, true);
  assert.equal(orbit(at(18)).day, false);
  assert.deepEqual(orbit(at(12)), { day: true, altitude: 1, x: 50, y: -8, intensity: 1 });
  assert.deepEqual(windowLightOrbit('south', at(12), 'light', '19:00', '19:00'), orbit(at(12)));
});

test('the moon follows the scheduled night through midnight', () => {
  const moon = date => windowLightOrbit('south', date, 'dark', '08:30', '21:15');
  const [rise, beforeMidnight, midnight, peak, set] = [
    at(21, 15), at(23, 59), at(0, 0, 25), at(2, 53, 25), at(8, 30, 25),
  ].map(moon);

  assert.ok(rise.x < beforeMidnight.x && beforeMidnight.x < midnight.x);
  assert.ok(midnight.x < peak.x && peak.x < set.x);
  assert.ok(Math.hypot(midnight.x - beforeMidnight.x, midnight.y - beforeMidnight.y) < 1);
  assert.ok(peak.y < midnight.y && peak.y < set.y);
  assert.ok(peak.altitude > moon(at(2, 15, 25)).altitude);
  assert.ok(peak.altitude > moon(at(3, 30, 25)).altitude);
  assert.ok([rise, midnight, peak, set].every(light => !light.day && light.y > 0 && light.intensity > 0));
});

test('daylight can span midnight in a custom schedule', () => {
  const orbit = (date, scheme) => windowLightOrbit('south', date, scheme, '20:30', '07:15');
  assert.equal(orbit(at(23), 'light').day, true);
  assert.equal(orbit(at(2), 'light').day, true);
  assert.ok(orbit(at(23), 'light').x < orbit(at(2), 'light').x);
  assert.ok(orbit(at(9), 'dark').x < orbit(at(18), 'dark').x);
  assert.ok(orbit(at(14), 'dark').altitude > orbit(at(12), 'dark').altitude);
});

test('manual schemes have distinct positions and stay continuous across the clock boundaries', () => {
  const orbit = (date, scheme) => windowLightOrbit('south', date, scheme);
  const sun = orbit(at(12), 'light');
  const moon = orbit(at(12), 'dark');

  assert.equal(sun.day, true);
  assert.equal(moon.day, false);
  assert.ok(moon.x > 0 && moon.x < 100 && moon.y > 0 && moon.y < 100);
  assert.ok(moon.y > sun.y && moon.altitude < sun.altitude);
  assert.ok(moon.intensity > 0 && moon.intensity < sun.intensity);
  assert.ok(orbit(at(0), 'light').intensity > 0);

  for (const scheme of ['dark', 'light']) {
    for (const hour of [6, 18]) {
      const before = orbit(at(hour - 1, 59), scheme);
      const atBoundary = orbit(at(hour), scheme);
      const after = orbit(at(hour, 1), scheme);
      assert.equal(before.day, atBoundary.day);
      assert.equal(atBoundary.day, after.day);
      assert.ok(Math.hypot(before.x - atBoundary.x, before.y - atBoundary.y) < 1);
      assert.ok(Math.hypot(atBoundary.x - after.x, atBoundary.y - after.y) < 1);
    }
  }
  for (let hour = 0; hour < 24; hour++) assert.ok(orbit(at(hour), 'dark').intensity > 0);
});

test('moonlight exposure follows the direction of the window', () => {
  const orbit = (hour, facing) => windowLightOrbit(facing, at(hour), 'dark');
  assert.ok(orbit(20, 'east').intensity > orbit(20, 'west').intensity);
  assert.ok(orbit(4, 'west').intensity > orbit(4, 'east').intensity);
  assert.ok(orbit(0, 'south').intensity > 0);
  assert.equal(orbit(0, 'north').intensity, 0);
});
