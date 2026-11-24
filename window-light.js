export const FACING_BEARINGS = { east: 90, west: 270, south: 180, north: 0 };
const radians = Math.PI / 180;

export function relativeBearing(degrees, facing) {
  return (degrees - FACING_BEARINGS[facing]) * radians;
}

export function windowLightOrbit(facing, time) {
  const hours = time.getHours() + time.getMinutes() / 60;
  const day = hours >= 6 && hours < 18;
  // Each light follows an east-to-west arc in local clock time.
  const progress = (day ? hours - 6 : (hours + 6) % 24) / 12;
  const altitude = Math.sin(Math.PI * progress);
  const bearing = relativeBearing(90 + progress * 180, facing);
  const exposure = Math.max(0, (Math.cos(bearing) + .2) / 1.2);
  return {
    day, altitude,
    x: 50 + 50 * Math.sin(bearing),
    y: 23 - 31 * altitude,
    intensity: exposure * Math.min(1, altitude * 10) * (.48 + .52 * altitude) * (day ? 1 : .52),
  };
}
