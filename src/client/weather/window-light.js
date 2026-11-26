export const FACING_BEARINGS = { east: 90, west: 270, south: 180, north: 0 };
const radians = Math.PI / 180;
const minutesPerDay = 24 * 60;

export function relativeBearing(degrees, facing) {
  return (degrees - FACING_BEARINGS[facing]) * radians;
}

function clockMinutes(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

export function windowLightOrbit(facing, time, scheme, dayStart, nightStart) {
  let dawn = clockMinutes(dayStart), dusk = clockMinutes(nightStart);
  if (dawn === null || dusk === null || dawn === dusk) {
    dawn = 6 * 60;
    dusk = 18 * 60;
  }
  const dayLength = (dusk - dawn + minutesPerDay) % minutesPerDay;
  const now = time.getHours() * 60 + time.getMinutes();
  const sinceDawn = (now - dawn + minutesPerDay) % minutesPerDay;
  const inDay = sinceDawn < dayLength;
  const day = scheme === 'light' || (scheme !== 'dark' && inDay);
  const phase = inDay ? sinceDawn / dayLength : (sinceDawn - dayLength) / (minutesPerDay - dayLength);
  // A theme that stays active outside its scheduled interval follows the arc back to its start.
  const progress = day === inDay ? phase : 1 - phase;
  const rise = Math.sin(Math.PI * progress);
  const altitude = day ? rise : .24 + .40 * rise;
  const bearing = relativeBearing(day ? 90 + 180 * progress : 110 + 152 * progress, facing);
  const exposure = Math.max(0, (Math.cos(bearing) + .2) / 1.2);
  return {
    day, altitude,
    x: 50 + (day ? 50 : 42) * Math.sin(bearing),
    y: day ? 23 - 31 * altitude : 27 - 24 * altitude,
    intensity: exposure * Math.min(1, altitude * 10) * (.48 + .52 * altitude) * (day ? 1 : .52),
  };
}
