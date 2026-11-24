import test from 'node:test';
import assert from 'node:assert/strict';
import { createFogGlass, createGlassImpacts } from '../glass-impact.js';

const SPLASH = 0, BEAD = 1, TRAIL = 2, SNOW = 3;

function marks(object, kind) {
  const { impactStyle } = object.geometry.attributes;
  const transforms = object.instanceMatrix.array;
  return Array.from({ length: object.count }, (_, i) => ({
    kind: impactStyle.getX(i), alpha: impactStyle.getY(i),
    x: transforms[i * 16 + 12], y: transforms[i * 16 + 13],
    width: Math.hypot(transforms[i * 16], transforms[i * 16 + 1]),
    height: Math.hypot(transforms[i * 16 + 4], transforms[i * 16 + 5]),
  })).filter(mark => kind === undefined || mark.kind === kind);
}

function fixture(t, look, photo, random = () => .5) {
  const impacts = createGlassImpacts(look, random, photo);
  t.after(impacts.dispose);
  const { object } = impacts;
  return {
    advance(particles, seconds, slope = 0, reduced = false) {
      impacts.update(particles, seconds, 160, 150, slope, 0, reduced);
    },
    marks: kind => marks(object, kind),
    impacts,
  };
}

test('rain splashes at the visible particle position, then the bead and its wet trace fade', t => {
  const f = fixture(t, { rain: 1 });
  const drop = { x: 40, y: 45, radius: 1.5 };
  const outside = { x: -8, y: 40, radius: 2 };
  f.advance([drop, outside], .034, .5);
  assert.ok(drop.y < 0);
  assert.deepEqual(outside, { x: -8, y: 40, radius: 2 });

  const [contact] = f.marks(BEAD);
  assert.deepEqual([contact.x, contact.y], [40, 45]);
  const splash = f.marks(SPLASH);
  assert.ok(splash.length > 0 && splash.every(({ x, y }) => Math.hypot(x - 40, y - 45) < 4));

  f.advance([], .88);
  const [slide] = f.marks(BEAD);
  const [trail] = f.marks(TRAIL);
  assert.ok(slide.x > 40 && slide.y > 45);
  assert.ok(trail.y < slide.y && trail.y > 45);
  assert.equal(f.marks(SPLASH).length, 0);

  f.advance([], .9);
  assert.ok(f.marks(BEAD)[0].alpha < slide.alpha);
  assert.ok(f.marks(TRAIL)[0].alpha < trail.alpha);
  f.advance([], 1);
  assert.equal(f.marks().length, 0);
});

test('snow scatters briefly, sticks at the contact and melts in place', t => {
  const f = fixture(t, { snow: .65 });
  const snow = { x: 60, y: 70, radius: 2 };
  f.advance([snow], .034, -.5);
  assert.ok(snow.y < 0);
  assert.ok(f.marks(SPLASH).length > 0);
  const [contact] = f.marks(SNOW);

  f.advance([], .76);
  assert.equal(f.marks(SPLASH).length, 0);
  const [flake] = f.marks(SNOW);
  assert.ok(flake.width < contact.width && flake.alpha < contact.alpha);
  assert.deepEqual([flake.x, flake.y], [60, 70]);
  assert.deepEqual(f.marks(BEAD).map(({ x, y }) => [x, y]), [[60, 70]]);
  f.advance([], 1);
  assert.equal(f.marks().length, 0);
});

test('glass contacts scale with the pane, weather and wind and have bounded concurrency', t => {
  function run(rain, width, height, slope, wind = 0) {
    const f = fixture(t, { rain });
    const particles = Array.from({ length: 200 }, () => ({ x: 50, y: 50, radius: 1 }));
    for (let frame = 0; frame < 90; frame++) {
      f.impacts.update(particles, 1 / 30, width, height, slope, wind, false);
    }
    return { contacts: particles.filter(particle => particle.y < 0).length, marks: f.marks(BEAD).length };
  }

  const light = run(.3, 1300, 800, 0);
  const rain = run(.65, 1300, 800, 0);
  assert.ok(light.contacts < rain.contacts);
  assert.ok(run(.65, 800, 600, 0).contacts < rain.contacts);
  assert.ok(run(.65, 1300, 800, .625).contacts > rain.contacts);
  assert.ok(run(.65, 1300, 800, 0, .8).contacts > rain.contacts);
  const storm = run(1, 3840, 2160, .625);
  assert.ok(storm.contacts > storm.marks);
  assert.ok(storm.marks <= 42);
});

test('reducing motion removes every mark and the next drop can make contact after motion resumes', t => {
  const f = fixture(t, { rain: .3 });
  const first = { x: 40, y: 50, radius: 2 };
  const next = { x: 65, y: 80, radius: 2 };
  f.advance([first, next], .034);
  assert.equal(f.marks(BEAD).length, 1);
  f.advance([first, next], .034, 0, true);
  assert.equal(f.marks().length, 0);
  f.advance([first, next], .034);
  assert.equal(f.marks(BEAD).length, 1);
  assert.ok(first.y < 0 && next.y < 0);
});

test('larger beads run faster and moving beads turn gradually with changing wind', t => {
  function slide(radius) {
    const f = fixture(t, { rain: 1 });
    f.advance([{ x: 40, y: 45, radius }], .034, .625);
    f.advance([], .74, .625);
    return f;
  }

  const fine = slide(.8);
  const steady = slide(3.5);
  const changing = slide(3.5);
  assert.ok(steady.marks(BEAD)[0].y > fine.marks(BEAD)[0].y);

  steady.advance([], .034, .625);
  changing.advance([], .034, -.625);
  assert.ok(Math.abs(steady.marks(BEAD)[0].x - changing.marks(BEAD)[0].x) < .25);
  for (let frame = 0; frame < 20; frame++) {
    steady.advance([], .034, .625);
    changing.advance([], .034, -.625);
  }
  assert.ok(steady.marks(BEAD)[0].x - changing.marks(BEAD)[0].x > 2);
});

test('rain can hit the glass from any size band and larger drops make a larger bead and splash at their tip', t => {
  const far = { x: 16, y: 30, radius: .55, band: 0 };
  const middle = { x: 36, y: 50, radius: 1.8, band: 1 };
  const near = { x: 66, y: 70, radius: 4.7, band: 2 };
  const first = fixture(t, { rain: 1 });
  const varied = fixture(t, { rain: 1 }, undefined, () => .2);
  varied.advance([far, middle, near], .034);
  assert.ok(far.y < 0 && middle.y === 50 && near.y === 70);
  first.advance([near], .034);
  assert.ok(near.y < 0);
  const [bead] = first.marks(BEAD);
  assert.deepEqual([bead.x, bead.y], [66, 70]);
  assert.ok(bead.width > varied.marks(BEAD)[0].width * 2 && bead.width < 10);
  assert.ok(first.marks(SPLASH)[0].width > varied.marks(SPLASH)[0].width);
});

test('precipitation intensity changes the frequency of glass contacts while a mark follows particle size', t => {
  for (const weather of ['rain', 'snow']) {
    const showers = [.3, .65, 1].map(intensity => fixture(t, { [weather]: intensity }, undefined, () => .2));
    for (const glass of showers) glass.advance([{ x: 40, y: 45, radius: 1.8, band: 1 }], .034, .45);
    for (const dt of [0, .14, .47, .78, 1]) {
      for (const glass of showers) glass.advance([], dt, .45);
      const marks = showers[0].marks();
      for (const glass of showers.slice(1)) assert.deepEqual(glass.marks(), marks);
    }
    assert.equal(showers[0].marks().length, 0);
  }
});

test('coarse sampling keeps thin beads and traces visible at their original positions', t => {
  const high = fixture(t, { rain: 1 }), low = fixture(t, { rain: 1 });
  function move(glass, dt, pixelSize, particles = []) {
    glass.impacts.update(particles, dt, 160, 150, .5, 0, false, pixelSize);
  }
  for (const [glass, pixelSize] of [[high, 1.25], [low, 1 / .22]]) {
    move(glass, .034, pixelSize, [{ x: 40, y: 45, radius: .65 }]);
    move(glass, .8, pixelSize);
  }
  for (const shape of [BEAD, TRAIL]) {
    const [native] = high.marks(shape), [filtered] = low.marks(shape);
    assert.deepEqual([filtered.x, filtered.y], [native.x, native.y]);
    assert.ok(filtered.width > native.width);
    assert.ok(filtered.alpha > 0 && filtered.alpha < native.alpha);
  }
});

test('a small stuck flake melts sooner than a large one and keeps faint coverage in a coarse buffer', t => {
  const fine = fixture(t, { snow: .65 }), coarse = fixture(t, { snow: .65 }), large = fixture(t, { snow: .65 });
  move(fine, .034, .75, 0);
  move(coarse, .034, .75, 1 / .22);
  move(large, .034, 4.8, 0);
  const [native] = fine.marks(SNOW), [sampled] = coarse.marks(SNOW);
  assert.deepEqual([sampled.x, sampled.y], [native.x, native.y]);
  assert.ok(sampled.width > native.width && sampled.alpha < native.alpha);
  assert.ok(large.marks(SNOW)[0].width > native.width);
  for (const glass of [fine, coarse, large]) glass.advance([], 1.35);
  assert.equal(fine.marks(SNOW).length, 0);
  assert.equal(coarse.marks(SNOW).length, 0);
  assert.equal(large.marks(SNOW).length, 1);

  function move(glass, dt, radius, pixelSize) {
    glass.impacts.update([{ x: 40, y: 45, radius }], dt, 160, 150, .5, 0, false, pixelSize);
  }
});

test('the glass samples the original photo at the viewport cover coordinates', t => {
  const photo = { naturalWidth: 400, naturalHeight: 200 };
  const f = fixture(t, { rain: 1 }, photo);
  const { material } = f.impacts.object;
  f.advance([], 0);
  assert.equal(material.uniforms.wallpaper.value.image, photo);
  assert.equal(material.uniforms.hasWallpaper.value, 1);
  assert.deepEqual(material.uniforms.cover.value.toArray(), [-70, 0, 300, 150]);
  f.impacts.update([], 0, 400, 200, 0, 0, false);
  assert.deepEqual(material.uniforms.cover.value.toArray(), [0, 0, 400, 200]);
});

test('fog beads grow in place, run slowly with the wind and disappear', t => {
  function run(crosswind) {
    const fog = createFogGlass({ light: .64 }, { naturalWidth: 400, naturalHeight: 200 });
    t.after(fog.dispose);
    const step = (dt, reduced = false) => fog.update({ width: 160, height: 150, dt, crosswind, wind: .7, reduced });
    fog.update({ width: 160, height: 150 });
    assert.equal(fog.object.count, 0);
    step(.05);
    const [small] = marks(fog.object, BEAD);
    step(.85);
    const [growing] = marks(fog.object, BEAD);
    assert.deepEqual([growing.x, growing.y], [small.x, small.y]);
    assert.ok(growing.width > small.width && growing.alpha > small.alpha);

    let elapsed = .85, sliding;
    while (elapsed < 5) {
      step(.1);
      elapsed += .1;
      [sliding] = marks(fog.object, BEAD);
      if (sliding?.y > small.y + 5) break;
    }
    assert.ok(sliding.y > small.y + 5 && elapsed > 1.5);
    assert.equal(marks(fog.object, SPLASH).length, 0);
    assert.ok(marks(fog.object, TRAIL).length > 0);
    assert.equal(fog.object.material.uniforms.hasWallpaper.value, 1);

    step(7);
    assert.equal(fog.object.count, 0);
    return sliding.x;
  }
  assert.ok(run(.9) > run(-.9));
});

test('fog drops stay sparse and reducing motion returns to the static glass', t => {
  const fog = createFogGlass({ light: .64 });
  t.after(fog.dispose);
  const step = (dt, reduced = false) => fog.update({ width: 3840, height: 2160, dt, reduced });
  let maxBeads = 0;
  for (let frame = 0; frame < 240; frame++) {
    step(.1);
    maxBeads = Math.max(maxBeads, marks(fog.object, BEAD).length);
  }
  assert.ok(maxBeads > 1 && maxBeads <= 6);
  step(0, true);
  step(20, true);
  assert.equal(fog.object.count, 0);
  step(0);
  assert.equal(fog.object.count, 0);
  step(.1);
  assert.equal(marks(fog.object, BEAD).length, 1);
});
