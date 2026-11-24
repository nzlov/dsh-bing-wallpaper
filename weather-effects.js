import { relativeBearing } from './window-light.js';

// Keep atmospheric motion behind the water and frost on the glass.
export const weatherLooks = {
  clear: { light: 1, scattering: .09 },
  clouds: { light: .82, scattering: .33 },
  lightRain: { light: .58, scattering: .19, rain: .3, lightningChance: .1 },
  rain: { light: .36, scattering: .13, rain: .65, lightningChance: .25 },
  heavyRain: { light: .21, scattering: .09, rain: 1, lightningChance: .5 },
  lightSnow: { light: .66, scattering: .19, frost: .28, snow: .28 },
  snow: { light: .44, scattering: .16, frost: .65, snow: .65 },
  heavySnow: { light: .29, scattering: .12, frost: 1, snow: 1 },
  storm: { light: .14, scattering: .07, rain: 1, lightningChance: 1 },
  fog: { light: .64, scattering: .30 },
};
export const WEATHER_EFFECTS = Object.keys(weatherLooks);

const canvasAttribute = 'data-bdt-precipitation';
export const PRECIPITATION_CANVAS = `[${canvasAttribute}]`;

export const WEATHER_LAYOUT_CSS = `[data-bdt-weather-pane]{position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:inherit}
  [data-bdt-weather]{position:fixed;z-index:-1}
  [data-bdt-sidebar-background]>[data-bdt-weather-pane]{inset:auto;left:var(--bdt-glass-x,0px);top:var(--bdt-glass-y,0px);width:100vw;height:100vh;z-index:2}
  ${PRECIPITATION_CANVAS}{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}`;

export function createWeatherPane(document, active = true) {
  const pane = document.createElement('div');
  pane.setAttribute('data-bdt-weather-pane', '');
  if (active) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute(canvasAttribute, '');
    pane.append(canvas);
  }
  return pane;
}

export function randomSequence(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function weatherWind(windKmh, windDegrees, facing = 'south') {
  const wind = Math.max(0, Math.min(1, (windKmh || 0) / 60));
  // Reported bearings point into the wind. Project the flow to scene right.
  const crosswind = windDegrees == null ? -wind : -wind * Math.sin(relativeBearing(windDegrees, facing));
  return { wind, crosswind };
}
