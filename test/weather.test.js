import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherController, currentWeather, normalizeWeather } from '../weather.js';
import { createAtmosphere } from '../weather-atmosphere.js';
import { randomSequence, weatherLooks, weatherWind } from '../weather-effects.js';
import { advanceParticles, createParticles, createPrecipitationObjects } from '../three-precipitation.js';
import { windowLightOrbit } from '../window-light.js';

function respond(t, documents) {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    urls.push(new URL(url));
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(documents.shift());
  });
  return urls;
}
const signal = () => new AbortController().signal;
const config = overrides => normalizeWeather({ mode: 'location', location: 'Shanghai', ...overrides });

test('weather defaults to off and upgrades saved location preferences', () => {
  assert.equal(normalizeWeather().mode, 'off');
  const saved = { enabled: true, provider: 'custom', location: 'Shanghai', endpoint: 'https://weather.example/current' };
  assert.deepEqual(normalizeWeather(saved), {
    mode: 'location', effect: 'clear', facing: 'south', provider: saved.provider, location: saved.location, endpoint: saved.endpoint, refreshMinutes: 30,
  });
  assert.equal(normalizeWeather({ enabled: false }).mode, 'off');
  assert.equal(normalizeWeather({ ...saved, mode: 'fixed', effect: 'heavySnow' }).effect, 'heavySnow');
  assert.equal(normalizeWeather({ ...saved, mode: 'fixed' }).mode, 'fixed');
  assert.equal(normalizeWeather({ mode: 'invalid' }).mode, 'off');
  assert.equal(normalizeWeather({ mode: 'fixed', effect: 'invalid' }).effect, 'clear');
  assert.equal(normalizeWeather({ mode: 'fixed', effect: 'night' }).effect, 'clear');
  for (const facing of ['east', 'west', 'south', 'north']) assert.equal(normalizeWeather({ facing }).facing, facing);
  for (const facing of ['up', '__proto__', ['north'], null]) assert.equal(normalizeWeather({ facing }).facing, 'south');
});

test('refresh interval accepts whole minutes and defaults to 30 for invalid values', () => {
  assert.equal(normalizeWeather({ refreshMinutes: 1 }).refreshMinutes, 1);
  assert.equal(normalizeWeather({ refreshMinutes: 45 }).refreshMinutes, 45);
  for (const refreshMinutes of [undefined, 0, -1, 1.5, '15', Infinity, true]) {
    assert.equal(normalizeWeather({ refreshMinutes }).refreshMinutes, 30);
  }
});

test('Open-Meteo resolves a city, reports the actual match and translates its current weather', async t => {
  const urls = respond(t, [{ results: [{ name: 'Shanghai', country: 'China', latitude: 31.2, longitude: 121.5 }] },
    { current: { weather_code: 63, wind_speed_10m: 24.5, wind_direction_10m: 275 } }]);
  assert.deepEqual(await currentWeather(config(), signal()), { place: 'Shanghai, China', effect: 'rain', windKmh: 24.5, windDegrees: 275 });
  assert.equal(urls[0].searchParams.get('name'), 'Shanghai');
  assert.equal(urls[1].searchParams.get('longitude'), '121.5');
  assert.equal(urls[1].searchParams.get('current'), 'weather_code,wind_speed_10m,wind_direction_10m');
  assert.equal(urls[1].searchParams.get('wind_speed_unit'), 'kmh');
});

test('coordinates skip geocoding, including at zero, and unrecognised locations fail distinctly', async t => {
  const urls = respond(t, [{ current: { weather_code: 0, is_day: 0 } }, {}]);
  assert.equal((await currentWeather(config({ location: '0， 0' }), signal())).effect, 'clear');
  assert.equal(urls[0].hostname, 'api.open-meteo.com');
  await assert.rejects(currentWeather(config({ location: '91,0' }), signal()), /weatherLocationUnknown/);
  await assert.rejects(currentWeather(config(), signal()), /weatherLocationUnknown/);
  assert.equal(urls.length, 2);
});

test('wttr and custom endpoints use their own location format and reject invalid responses', async t => {
  const urls = respond(t, [{ current_condition: [{ weatherCode: '338', windspeedKmph: '7', winddirDegree: '20' }] },
    { current: { weather_code: 95, wind_speed_10m: 0, wind_direction_10m: 360 } },
    { current: { weather_code: 95, wind_speed_10m: -15, wind_direction_10m: -1 } }, { current: {} }]);
  const location = 'New York & NJ';
  assert.deepEqual(await currentWeather(config({ provider: 'wttr.in', location }), signal()),
    { effect: 'heavySnow', place: location, windKmh: 7, windDegrees: 20 });
  assert.equal(urls[0].hostname, 'wttr.in');
  assert.equal(decodeURIComponent(urls[0].pathname), '/' + location);
  const custom = config({ provider: 'custom', endpoint: 'https://weather.example/current?units=m', location });
  assert.deepEqual(await currentWeather(custom, signal()), { effect: 'storm', place: location, windKmh: 0, windDegrees: 0 });
  assert.equal(urls[1].searchParams.get('location'), location);
  assert.equal(urls[1].searchParams.get('units'), 'm');
  assert.deepEqual(await currentWeather(custom, signal()), { effect: 'storm', place: location, windKmh: null, windDegrees: null });
  await assert.rejects(currentWeather(custom, signal()), /weatherUnavailable/);
  for (const endpoint of ['http://example.com', 'https://owner:secret@example.com', '/relative']) {
    await assert.rejects(currentWeather({ ...custom, endpoint }, signal()), /weatherEndpointInvalid/);
  }
  assert.equal(urls.length, 4);
});

test('weather polling cancels superseded work, retries failures and stops on disable and unload', async () => {
  let now = 100, state;
  const requests = [];
  const service = createWeatherController(patch => { state = patch; }, (config, signal) => new Promise((resolve, reject) => {
    requests.push({ config, signal, resolve, reject });
  }), () => now);
  const settings = { enabled: true, weather: config() };
  const sync = () => service.sync(settings);
  await service.sync({ ...settings, weather: normalizeWeather() });
  await service.sync({ ...settings, weather: config({ location: '' }) });
  assert.equal(state.weatherStatus, 'weatherLocationNeeded');
  assert.equal(requests.length, 0);
  const old = sync();
  await sync();
  assert.equal(requests.length, 1);
  settings.weather = config({ location: 'Paris' });
  const next = sync();
  assert.ok(requests[0].signal.aborted);
  requests[1].resolve({ effect: 'fog', place: 'Paris' });
  await next;
  requests[0].resolve({ effect: 'clear', place: 'Shanghai' });
  await old;
  assert.equal(state.observation.place, 'Paris');
  now += 29 * 60000;
  await sync();
  assert.equal(requests.length, 2);
  now += 60000;
  const refresh = sync();
  requests[2].reject(new Error());
  await refresh;
  assert.equal(state.weatherStatus, 'weatherUnavailable');
  now += 4 * 60000;
  await sync();
  assert.equal(requests.length, 3);
  now += 60000;
  const retry = sync();
  await service.sync({ ...settings, enabled: false });
  assert.ok(requests[3].signal.aborted);
  requests[3].resolve({ effect: 'rain', place: 'Paris' });
  await retry;
  assert.deepEqual(state, { observation: null, weatherStatus: '' });
  const last = sync();
  service.dispose();
  assert.ok(requests[4].signal.aborted);
  requests[4].reject(new Error());
  await last;
  assert.equal(state.weatherStatus, 'weatherLoading', 'disposed requests cannot publish results');
});

test('leaving location mode cancels its pending lookup and only location mode queries again', async () => {
  let state;
  const requests = [];
  const service = createWeatherController(patch => { state = patch; }, (options, signal) => new Promise(resolve => {
    requests.push({ location: options.location, resolve, signal });
  }));
  const sync = (mode, force) => service.sync({ enabled: true, weather: config({ mode, effect: 'snow' }) }, force);
  await sync('off', true);
  await sync('fixed', true);
  assert.equal(requests.length, 0);
  const old = sync('location');
  const { resolve, signal } = requests[0];
  await sync('fixed');
  assert.ok(signal.aborted);
  resolve({ effect: 'rain', place: 'Shanghai' });
  await old;
  assert.deepEqual(state, { observation: null, weatherStatus: '' });
  const next = sync('location');
  requests[1].resolve({ effect: 'clear', place: 'Shanghai' });
  await next;
  assert.deepEqual(requests.map(request => request.location), ['Shanghai', 'Shanghai']);
  assert.deepEqual(state.observation, { effect: 'clear', place: 'Shanghai' });
  await sync('off');
  assert.deepEqual(state, { observation: null, weatherStatus: '' });
});

test('the automatic weather timer uses the saved interval and reschedules when it changes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const minute = 60000;
  const requests = [];
  const service = createWeatherController(() => {}, async () => {
    requests.push(Date.now());
    return { effect: 'clouds', place: 'Shanghai' };
  });
  t.after(() => service.dispose());
  const sync = (refreshMinutes, mode = 'location') => service.sync({ enabled: true, weather: config({ mode, refreshMinutes }) });
  await sync(4);
  t.mock.timers.tick(4 * minute - 1);
  assert.deepEqual(requests, [0]);
  t.mock.timers.tick(1);
  assert.deepEqual(requests, [0, 4 * minute]);
  await Promise.resolve();
  t.mock.timers.tick(minute);
  await sync(2);
  t.mock.timers.tick(minute - 1);
  assert.equal(requests.length, 2);
  t.mock.timers.tick(1);
  assert.deepEqual(requests, [0, 4 * minute, 6 * minute]);
  await Promise.resolve();
  await sync(2, 'fixed');
  t.mock.timers.tick(10 * minute);
  assert.equal(requests.length, 3);
});

test('providers distinguish rain and snow intensity and all eight window scenes', async t => {
  const cases = [
    [0, 113, 'clear'], [3, 122, 'clouds'], [61, 296, 'lightRain'], [65, 308, 'heavyRain'],
    [71, 326, 'lightSnow'], [75, 338, 'heavySnow'], [95, 389, 'storm'], [45, 248, 'fog'],
    [63, 302, 'rain'], [73, 332, 'snow'], [80, 353, 'lightRain'], [82, 359, 'heavyRain'],
    [85, 368, 'lightSnow'], [86, 371, 'heavySnow'],
  ];
  const documents = [];
  respond(t, documents);
  for (const [wmo, wwo, expected] of cases) {
    for (const provider of ['open-meteo', 'custom', 'wttr.in']) {
      documents.push(provider === 'wttr.in' ? { current_condition: [{ weatherCode: String(wwo) }] } : { current: { weather_code: wmo } });
      const options = config({ provider, location: '31,121', endpoint: 'https://weather.example/current' });
      assert.equal((await currentWeather(options, signal())).effect, expected);
    }
  }
});

const orbit = (hour, facing = 'south') => windowLightOrbit(facing, new Date(2026, 10, 24, hour));

function atmosphereFixture(t, effect) {
  const atmosphere = createAtmosphere(weatherLooks[effect], effect);
  t.after(atmosphere.dispose);
  const { object } = atmosphere;
  const sheet = object.children.find(child => child.material?.uniforms?.scattering);
  const lightning = object.getObjectByName('weather-lightning');
  let previous = 0;
  return {
    object,
    sheet,
    lightning,
    bolt: lightning?.getObjectByName('lightning-bolt'),
    flash: lightning?.getObjectByName('lightning-glow'),
    uniforms: sheet.material.uniforms,
    update(time, overrides) {
      const dt = time - previous;
      previous = time;
      atmosphere.update({
        width: 1360, height: 800, time, dt, light: orbit(12),
        crosswind: 0, hasWindDirection: true, reduced: false, ...overrides,
      });
    },
  };
}

test('each weather scene has distinct atmosphere settings and the relevant procedural texture', t => {
  const effects = ['clear', 'clouds', 'lightRain', 'rain', 'heavyRain', 'lightSnow', 'snow', 'heavySnow', 'fog', 'storm'];
  const scenes = effects.map(effect => atmosphereFixture(t, effect));
  const settings = scenes.map(({ object, sheet, uniforms, bolt, update }) => {
    update(0);
    assert.ok(object.isGroup && sheet.material.isShaderMaterial);
    return JSON.stringify([sheet.material.defines, uniforms.glow.value, uniforms.scattering.value, uniforms.ice.value, Boolean(bolt)]);
  });
  assert.equal(new Set(settings).size, effects.length);
  for (const effect of ['clouds', 'heavySnow', 'fog']) {
    const texture = scenes[effects.indexOf(effect)].uniforms.pattern.value;
    assert.ok(texture.isDataTexture);
    const { data, width, height } = texture.image;
    assert.equal(data.length, width * height);
    assert.ok(data.some(value => value !== data[0]));
  }
});

test('reported wind projects cloud and fog drift in the direction of the facing window', t => {
  assert.equal(Math.abs(weatherWind(0).crosswind), 0);
  assert.equal(weatherWind(60).crosswind, -1);
  assert.equal(weatherWind(60, 90, 'south').crosswind, 1);
  assert.equal(weatherWind(60, 90, 'north').crosswind, -1);
  for (const facing of ['east', 'west']) assert.ok(Math.abs(weatherWind(60, 90, facing).crosswind) < 1e-12);

  function drift(effect, speed, bearing, facing) {
    const f = atmosphereFixture(t, effect);
    const { crosswind } = weatherWind(speed, bearing, facing);
    const params = { crosswind, hasWindDirection: bearing != null };
    f.update(0, params);
    f.update(3, params);
    const offset = f.uniforms.offset.value;
    f.update(20, { ...params, reduced: true });
    assert.equal(f.uniforms.offset.value, offset);
    f.update(21, params);
    assert.ok(Math.abs((f.uniforms.offset.value - offset) - offset / 3) < 1e-8);
    return offset;
  }

  for (const effect of ['clouds', 'fog']) {
    assert.ok(drift(effect, 60, 90, 'south') > 0);
    assert.ok(drift(effect, 60, 90, 'north') < 0);
    assert.ok(Math.abs(drift(effect, 60, 90, 'east')) < 1e-12);
    assert.equal(drift(effect, 0, 90, 'south'), 0);
    assert.ok(drift(effect, 60, null, 'south') < drift(effect, 0, null, 'south'));
  }
});

test('local clock moves sunlight and dimmer moonlight from east to west', t => {
  const [morning, noon, evening] = [8, 12, 16].map(hour => orbit(hour));
  const [moonrise, midnight, moonset] = [20, 0, 4].map(hour => orbit(hour));
  for (const [early, high, late] of [[morning, noon, evening], [moonrise, midnight, moonset]]) {
    assert.ok(early.x < high.x && high.x < late.x);
    assert.ok(high.y < early.y && high.y < late.y);
    assert.ok(early.intensity > 0 && late.intensity > 0);
  }
  assert.ok(midnight.intensity < noon.intensity);
  assert.equal(orbit(12, 'north').intensity, 0);
  assert.ok(orbit(8, 'east').intensity > orbit(8, 'west').intensity);
  assert.ok(orbit(16, 'west').intensity > orbit(16, 'east').intensity);

  const f = atmosphereFixture(t, 'clouds');
  const { origin, axis, glow, scattering, lightColor } = f.uniforms;
  f.update(0, { light: orbit(12, 'north') });
  assert.equal(glow.value, 0);
  assert.equal(scattering.value, 0);
  f.update(0, { light: morning });
  assert.deepEqual(origin.value.toArray(), [morning.x / 100, morning.y / 100]);
  assert.ok(axis.value.x > 0);
  f.update(0, { light: evening });
  assert.ok(axis.value.x < 0);
  f.update(0, { light: noon });
  assert.ok(glow.value > 0 && scattering.value > 0);
  const dayGlow = glow.value;
  assert.ok(lightColor.value.x > lightColor.value.z);
  f.update(0, { light: midnight });
  assert.ok(glow.value > 0 && glow.value < dayGlow);
  assert.ok(lightColor.value.x < lightColor.value.z);
});

test('sunlit clear and cloudy skies move their rays in calm air and pause for reduced motion', t => {
  for (const effect of ['clear', 'clouds']) {
    const f = atmosphereFixture(t, effect);
    const snapshot = () => f.uniforms.beamMotion.value.toArray();
    f.update(0);
    const initial = snapshot();
    f.update(3);
    const moving = snapshot();
    assert.notDeepEqual(moving, initial);
    assert.equal(f.uniforms.offset.value, 0);
    f.update(15, { reduced: true });
    assert.deepEqual(snapshot(), moving);
    f.update(16);
    assert.notDeepEqual(snapshot(), moving);
    f.update(17, { light: orbit(12, 'north') });
    assert.equal(f.uniforms.scattering.value, 0);
    f.update(18, { light: orbit(23) });
    const moonlight = snapshot();
    f.update(20, { light: orbit(23) });
    assert.deepEqual(snapshot(), moonlight);
  }
});

test('larger rain streaks and snowflakes fall faster', () => {
  for (const effect of ['lightRain', 'rain', 'heavyRain', 'lightSnow', 'snow', 'heavySnow']) {
    const look = weatherLooks[effect];
    const size = look.snow ? 'radius' : 'length';
    const random = randomSequence(42);
    const particles = createParticles(look, 1200, 800, random).sort((a, b) => a[size] - b[size]);
    for (const particle of particles) {
      particle.x = 600;
      particle.y = 200;
    }
    advanceParticles(particles, 1200, 800, .1, -.625, random);
    assert.ok(particles.length > 20);
    for (let i = 1; i < particles.length; i++) {
      assert.ok(particles[i][size] > particles[i - 1][size], effect);
      assert.ok(particles[i].y > particles[i - 1].y, effect);
      assert.ok(particles[i].x < 600 && particles[i].y > 200, effect);
    }
  }
});

test('rain and snow intensity change density while preserving the size and speed distribution', t => {
  for (const effects of [['lightRain', 'rain', 'heavyRain'], ['lightSnow', 'snow', 'heavySnow']]) {
    const heavyLook = weatherLooks[effects[2]];
    const precipitation = createPrecipitationObjects(heavyLook);
    t.after(precipitation.dispose);
    const [mesh] = precipitation.object.children;
    let previousCount = 0;
    for (const [width, height] of [[360, 640], [680, 785], [1360, 800], [3840, 2160], [7680, 4320]]) {
      const [light, moderate, heavy] = effects.map(effect =>
        createParticles(weatherLooks[effect], width, height, randomSequence(42)));
      assert.ok(light.length >= 10 && heavy.length >= 70, `${effects[2]} at ${width}×${height}`);
      assert.ok(moderate.length >= light.length * 2.8 && heavy.length >= moderate.length * 1.9);
      assert.ok(heavy.length >= previousCount && heavy.length <= 720);
      previousCount = heavy.length;

      // The backing canvas can shrink independently without removing airborne precipitation.
      for (const scale of [.8, .24]) {
        precipitation.update({ width, height, pixelWidth: width * scale, pixelHeight: height * scale, dt: 0, crosswind: 0 });
        assert.equal(mesh.count, heavy.length);
      }
      assert.deepEqual(light, heavy.slice(0, light.length));
      assert.deepEqual(moderate, heavy.slice(0, moderate.length));
      const tiers = [0, 1, 2].map(band => heavy.filter(particle => particle.band === band));
      for (let tier = 1; tier < tiers.length; tier++) {
        for (const field of ['width', 'length', 'speed']) {
          assert.ok(Math.min(...tiers[tier].map(particle => particle[field])) >
            Math.max(...tiers[tier - 1].map(particle => particle[field])), field);
        }
      }
      const snow = Boolean(heavyLook.snow);
      assert.ok(heavy.every(p => p.width <= (snow ? 10 : 1.5) && p.length <= (snow ? 10 : 23)));
    }
    assert.equal(mesh.count, 720);
  }
});

test('long rain streaks leave the viewport before they wrap under crosswind', () => {
  for (const slope of [-.625, .625]) {
    const particle = { x: slope < 0 ? -18 : 818, y: 180, speed: 160, length: 80, width: 4 };
    advanceParticles([particle], 800, 600, .1, slope, randomSequence(42));
    assert.equal(particle.x, slope < 0 ? -28 : 828);
    advanceParticles([particle], 800, 600, .4, slope, randomSequence(42));
    assert.equal(particle.x, slope < 0 ? 840 : -40);
  }
});

test('rain intensity controls the odds of a flash and each attempt gets a new delay', t => {
  let random = 0;
  t.mock.method(Math, 'random', () => random);
  const rain = atmosphereFixture(t, 'rain');
  rain.update(7.99);
  assert.equal(rain.lightning.visible, false);
  random = .5;
  rain.update(8);
  assert.equal(rain.lightning.visible, false);
  random = .2;
  rain.update(21.99);
  assert.equal(rain.lightning.visible, false);
  rain.update(22);
  assert.equal(rain.lightning.visible, true);
  rain.update(22.6);
  assert.equal(rain.lightning.visible, false);
  rain.update(32.39);
  assert.equal(rain.lightning.visible, false);
  rain.update(32.41);
  assert.equal(rain.lightning.visible, true);

  for (const [effect, roll, flashes] of [
    ['lightRain', .08, true], ['lightRain', .12, false],
    ['rain', .3, false], ['heavyRain', .3, true], ['heavyRain', .6, false],
  ]) {
    random = 0;
    const f = atmosphereFixture(t, effect);
    random = roll;
    f.update(8);
    assert.equal(f.lightning.visible, flashes, effect);
  }
  assert.equal(atmosphereFixture(t, 'heavySnow').bolt, undefined);
});

test('a thunderstorm starts with an early strike then waits a randomized interval', t => {
  let random = .4;
  t.mock.method(Math, 'random', () => random);
  const f = atmosphereFixture(t, 'storm');
  f.update(1.52);
  assert.equal(f.lightning.visible, false);
  random = .99;
  f.update(1.54);
  assert.equal(f.lightning.visible, true);
  f.update(2.29);
  assert.equal(f.lightning.visible, false);
  f.update(21.4);
  assert.equal(f.lightning.visible, false);
  f.update(21.43);
  assert.equal(f.lightning.visible, true);
});

test('the bolt has three tapered forks and stays visible across software renderer frames', t => {
  let random = 0;
  t.mock.method(Math, 'random', () => random);
  const f = atmosphereFixture(t, 'storm');
  let released = 0;
  f.bolt.geometry.addEventListener('dispose', () => released++);
  random = .35;
  f.update(.95, { pixelWidth: 340, pixelHeight: 200 });
  assert.equal(released, 1);
  const first = f.bolt.geometry;
  first.addEventListener('dispose', () => released++);
  const points = first.getAttribute('position');
  const endpoints = first.getAttribute('endpoint');
  const profile = first.getAttribute('profile');
  const outgoing = new Map();
  assert.ok(points.count > 13 * 6 && points.count % 6 === 0);
  for (let i = 0; i < points.count; i += 6) {
    const start = [points.getX(i), points.getY(i)];
    const end = [endpoints.getX(i), endpoints.getY(i)];
    assert.ok([...start, ...end].every(axis => Number.isFinite(axis) && axis >= 0 && axis <= 1));
    assert.ok(end[1] > start[1], 'every branch descends');
    assert.ok(profile.getZ(i) > 0 && profile.getZ(i) <= 1);
    const key = start.join(',');
    outgoing.set(key, (outgoing.get(key) || 0) + 1);
  }
  assert.equal([...outgoing.values()].filter(count => count === 2).length, 3);
  const bolt = f.bolt.material.uniforms;
  const glow = f.flash.material.uniforms;
  assert.equal(bolt.pixel.value, 4);
  assert.equal(bolt.power.value, 1);
  assert.ok(glow.power.value > .5 && glow.span.value.x < 1);
  for (const age of [.125, .25, .375, .5]) {
    f.update(.95 + age);
    assert.ok(f.lightning.visible);
    assert.ok(bolt.power.value > .08 && bolt.power.value < 1);
  }
  f.update(1.7);
  assert.equal(f.lightning.visible, false);
  random = .86;
  f.update(13.2);
  assert.equal(released, 2);
  assert.notDeepEqual(f.bolt.geometry.getAttribute('position').array, points.array);
});

test('reduced motion ends a flash and waits for a fresh delay after resuming', t => {
  let random = 0;
  t.mock.method(Math, 'random', () => random);
  const f = atmosphereFixture(t, 'storm');
  random = .5;
  f.update(1);
  assert.ok(f.lightning.visible);
  const strike = f.bolt.geometry;
  f.update(1.1, { reduced: true });
  assert.equal(f.lightning.visible, false);
  f.update(60, { reduced: true });
  assert.equal(f.bolt.geometry, strike);
  f.update(60.01);
  assert.equal(f.lightning.visible, false);
  f.update(74);
  assert.equal(f.lightning.visible, false);
  f.update(74.02);
  assert.equal(f.lightning.visible, true);
  assert.notEqual(f.bolt.geometry, strike);
});
