import { WEATHER_EFFECTS } from './weather-effects.js';
import { FACING_BEARINGS } from './window-light.js';

export const WEATHER_MODES = ['off', 'fixed', 'location'];
export const WEATHER_PROVIDERS = ['open-meteo', 'wttr.in', 'custom'];
const MINUTE = 60000;
const MAX_TIMEOUT = 2147483647;

export function normalizeWeather(input) {
  const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const mode = input?.mode ?? (input?.enabled === true ? 'location' : 'off');
  const refreshMinutes = input?.refreshMinutes;
  return {
    mode: WEATHER_MODES.includes(mode) ? mode : 'off',
    effect: WEATHER_EFFECTS.includes(input?.effect) ? input.effect : 'clear',
    facing: typeof input?.facing === 'string' && Object.hasOwn(FACING_BEARINGS, input.facing) ? input.facing : 'south',
    provider: WEATHER_PROVIDERS.includes(input?.provider) ? input.provider : 'open-meteo',
    location: text(input?.location, 200),
    endpoint: text(input?.endpoint, 2048),
    refreshMinutes: Number.isSafeInteger(refreshMinutes) && refreshMinutes >= 1 ? refreshMinutes : 30,
  };
}

export function customEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url;
  } catch { /* An incomplete settings value has no usable endpoint. */ }
  return null;
}

const wmo = {
  clear: [0, 1], clouds: [2, 3], fog: [45, 48],
  lightRain: [51, 53, 56, 61, 66, 80], rain: [55, 57, 63, 81], heavyRain: [65, 67, 82],
  lightSnow: [71, 77, 85], snow: [73], heavySnow: [75, 86], storm: [95, 96, 99],
};
const wttr = {
  clear: [113], clouds: [116, 119, 122], fog: [143, 248, 260],
  lightRain: [176, 185, 263, 266, 281, 293, 296, 311, 353], rain: [284, 299, 302, 314], heavyRain: [305, 308, 356, 359],
  lightSnow: [179, 182, 317, 323, 326, 350, 362, 368, 374], snow: [227, 320, 329, 332, 365], heavySnow: [230, 335, 338, 371, 377],
  storm: [200, 386, 389, 392, 395],
};

function condition(codes, code) {
  const match = Object.entries(codes).find(([, values]) => values.includes(code));
  if (!match) throw new Error('weatherUnavailable');
  return match[0];
}

function nonNegativeNumber(value) {
  const speed = typeof value === 'string' && value.trim() ? Number(value) : value;
  return Number.isFinite(speed) && speed >= 0 ? speed : null;
}

function windDirection(value) {
  const degrees = nonNegativeNumber(value);
  return degrees !== null && degrees <= 360 ? degrees % 360 : null;
}

async function readJSON(url, signal) {
  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  if (!response.ok) throw new Error('weatherUnavailable');
  return response.json();
}

export async function currentWeather({ provider, location, endpoint }, signal) {
  if (provider === 'wttr.in') {
    const data = await readJSON('https://wttr.in/' + encodeURIComponent(location) + '?format=j1', signal);
    const current = data.current_condition?.[0];
    const effect = condition(wttr, Number(current?.weatherCode));
    return { effect, place: data.nearest_area?.[0]?.areaName?.[0]?.value || location,
      windKmh: nonNegativeNumber(current.windspeedKmph), windDegrees: windDirection(current.winddirDegree) };
  }
  let url, place = location;
  if (provider === 'custom') {
    url = customEndpoint(endpoint);
    if (!url) throw new Error('weatherEndpointInvalid');
    url.searchParams.set('location', location);
  } else {
    const pair = /^([+-]?\d+(?:\.\d+)?)\s*[,，]\s*([+-]?\d+(?:\.\d+)?)$/.exec(location);
    let latitude, longitude;
    if (pair) {
      latitude = Number(pair[1]);
      longitude = Number(pair[2]);
    } else {
      const search = new URL('https://geocoding-api.open-meteo.com/v1/search');
      search.searchParams.set('name', location);
      search.searchParams.set('count', '1');
      search.searchParams.set('language', (globalThis.navigator?.language || 'en').split('-')[0]);
      const { results } = await readJSON(search, signal);
      if (!results?.length) throw new Error('weatherLocationUnknown');
      ({ latitude, longitude } = results[0]);
      place = [results[0].name, results[0].admin1, results[0].country].filter(Boolean).join(', ');
    }
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      throw new Error('weatherLocationUnknown');
    }
    url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({ latitude, longitude, current: 'weather_code,wind_speed_10m,wind_direction_10m', wind_speed_unit: 'kmh' });
  }
  const { current } = await readJSON(url, signal);
  const effect = condition(wmo, current?.weather_code);
  return { effect, place, windKmh: nonNegativeNumber(current.wind_speed_10m), windDegrees: windDirection(current.wind_direction_10m) };
}

export function createWeatherController(publish, lookup = currentWeather, now = Date.now) {
  let key = '', pending, timer, latestSettings, lastCheck = -Infinity, retry = false, observation = null;
  function reset() {
    clearTimeout(timer);
    pending?.abort();
    pending = undefined;
    key = '';
    lastCheck = -Infinity;
    retry = false;
    observation = null;
  }
  async function sync(settings, force = false) {
    latestSettings = settings;
    const config = settings.weather;
    const { mode, provider, location, endpoint } = config;
    const next = settings.enabled && mode === 'location' ? JSON.stringify([provider, location, endpoint]) : '';
    if (key !== next) {
      reset();
      key = next;
      if (!key) publish({ observation, weatherStatus: '' });
    }
    if (!key || pending) return;
    clearTimeout(timer);
    const delay = lastCheck + (retry ? 5 : config.refreshMinutes) * MINUTE - now();
    if (!force && delay > 0) {
      timer = setTimeout(() => void sync(latestSettings), Math.min(delay, MAX_TIMEOUT));
      return;
    }
    if (!location || (provider === 'custom' && !customEndpoint(endpoint))) {
      publish({ observation, weatherStatus: location ? 'weatherEndpointInvalid' : 'weatherLocationNeeded' });
      return;
    }
    const request = new AbortController();
    pending = request;
    const timeout = setTimeout(() => request.abort(), 15000);
    publish({ observation, weatherStatus: 'weatherLoading' });
    try {
      const result = await lookup(config, request.signal);
      if (pending !== request) return;
      request.signal.throwIfAborted();
      observation = result;
      lastCheck = now();
      retry = false;
      publish({ observation, weatherStatus: '' });
    } catch (error) {
      if (pending !== request) return;
      lastCheck = now();
      retry = true;
      observation = null;
      publish({ observation, weatherStatus: error?.message === 'weatherLocationUnknown' ? error.message : 'weatherUnavailable' });
    } finally {
      clearTimeout(timeout);
      if (pending === request) {
        pending = undefined;
        void sync(latestSettings);
      }
    }
  }
  return { sync, dispose: reset };
}
