import {
  DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, PlaneGeometry,
  ShaderMaterial, Vector2, Vector3,
} from 'three';
import { createGlassImpacts } from './glass-impact.js';
import { randomSequence } from './weather-effects.js';

const capacity = 720;
const compactViewportArea = 600 * 600;
const padding = 24;
const rainEdge = 1.57;
const rainTiers = [
  { width: [.50, .74], length: [4, 8], radius: [.45, .80], speed: [160, 250], opacity: .42 },
  { width: [.80, 1.06], length: [9, 15], radius: [.85, 1.30], speed: [265, 390], opacity: .55 },
  { width: [1.12, 1.48], length: [16, 23], radius: [1.40, 2.15], speed: [405, 535], opacity: .63 },
];
const snowTiers = [
  { radius: [.65, 1.40], speed: [22, 43], sway: [1.6, 3.4], opacity: .62, arms: .13 },
  { radius: [1.60, 2.85], speed: [46, 73], sway: [3.8, 6.2], opacity: .82, arms: .50 },
  { radius: [4.00, 4.90], speed: [77, 108], sway: [6.6, 9.1], opacity: .96, arms: .78 },
];

const vertexShader = `
uniform vec2 viewport;
uniform sampler2D wallpaper;
uniform vec4 cover;
uniform float hasWallpaper;
uniform vec3 photoWeight;
uniform vec3 matteLight;
uniform vec2 paneEdges;
attribute vec3 particleStyle;
varying vec2 local;
varying vec3 style;
varying float lightGround;
void main() {
  local = position.xy * 2.0;
  style = particleStyle;
  vec2 center = instanceMatrix[3].xy;
  vec2 backdrop = center.x < paneEdges.x ? vec2(photoWeight.y, matteLight.y) :
    center.x >= paneEdges.y ? vec2(photoWeight.z, matteLight.z) : vec2(photoWeight.x, matteLight.x);
  float photoLight = 0.5;
  if (hasWallpaper > 0.5) {
    vec2 uv = clamp((center - cover.xy) / cover.zw, 0.0, 1.0);
    vec3 sampleColor = texture2D(wallpaper, vec2(uv.x, 1.0 - uv.y)).rgb;
    photoLight = dot(sqrt(sampleColor), vec3(0.213, 0.715, 0.072));
  }
  lightGround = smoothstep(0.41, 0.59, photoLight * backdrop.x + backdrop.y);
  vec2 point = (instanceMatrix * vec4(position, 1.0)).xy;
  gl_Position = vec4(point * (vec2(2.0, -2.0) / viewport) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const rainShader = `
uniform vec3 rainRaster;
varying vec2 local;
varying vec3 style;
varying float lightGround;
void main() {
  float along = local.y * 0.5 + 0.5;
  float lineWidth = style.y * mix(1.0, 0.55, smoothstep(0.14, 1.0, along));
  float stripWidth = style.y + rainRaster.x;
  float widthRatio = lineWidth / stripWidth;
  float across = 1.0 - smoothstep(widthRatio * 0.55, min(1.0, widthRatio + 0.48), abs(local.x));
  if (rainRaster.y > 0.0) {
    // Filter the narrow line over a backing pixel before it reaches CSS upscaling.
    float filterWidth = rainRaster.y * 1.42;
    float distance = abs(local.x) * stripWidth * 0.5;
    float coverage = clamp((lineWidth + filterWidth) * 0.5 - distance,
      0.0, min(lineWidth, filterWidth)) / filterWidth;
    float lengthFade = pow(min(1.0, style.z / rainRaster.z), 0.66);
    across = min(1.0, sqrt(coverage) * 1.12) * lengthFade;
  }
  float trail = mix(0.48, 1.0, 1.0 - along) * (1.0 - smoothstep(0.60, 1.0, along));
  float tip = smoothstep(0.0, 0.055, along);
  // On a bright surface the refracted body reads darker, with a short reflected glint at its tip.
  vec3 body = mix(vec3(0.73, 0.79, 0.83), vec3(0.12, 0.16, 0.19), lightGround);
  float glint = (1.0 - smoothstep(0.06, 0.46, along)) * (1.0 - smoothstep(0.08, 0.72, abs(local.x + 0.24)));
  gl_FragColor = vec4(mix(body, vec3(0.94, 0.97, 1.0), glint * 0.78), min(1.0, style.x * 1.25) * across * trail * tip);
}`;

const snowShader = `
uniform float snowSampleRadius;
varying vec2 local;
varying vec3 style;
varying float lightGround;
void main() {
  float radius = length(local);
  float angle = atan(local.y, local.x + 0.00001);
  float crystal = 0.5 + 0.5 * cos(angle * 6.0);
  float halo = (1.0 - smoothstep(0.06, 1.0, radius)) * 0.38;
  float core = 1.0 - smoothstep(0.23, 0.60 + 0.12 * crystal, radius);
  float arms = smoothstep(0.82, 0.99, crystal) * (1.0 - smoothstep(0.48, 0.92, radius)) * style.y;
  float widthScale = min(1.0, style.z / max(style.z, snowSampleRadius));
  // At subpixel sizes, a soft footprint preserves the flake's coverage as it moves.
  float coverage = 1.0 - smoothstep(0.08, 0.96, radius);
  float crystalShape = max(halo, max(core * 0.96, arms));
  float shape = mix(coverage, crystalShape, smoothstep(0.55, 1.0, widthScale));
  float opacity = style.x * widthScale * shape;
  vec3 shade = mix(vec3(0.68, 0.73, 0.77), vec3(0.21, 0.25, 0.29), lightGround);
  float detail = smoothstep(0.45, 1.0, widthScale);
  float highlight = core * mix(0.32, 1.0 - 0.78 * smoothstep(-0.3, 0.4, local.x), detail);
  gl_FragColor = vec4(mix(shade, vec3(0.98, 0.99, 1.0), highlight), opacity);
}`;

function particleCount(look, width, height) {
  const intensity = look.snow || look.rain || 0;
  const area = width * height;
  // Reduce the rate of particle loss in compact windows so even light weather remains visible.
  const densityArea = Math.max(area, Math.sqrt(area * compactViewportArea));
  const fullDensityCount = Math.min(capacity, densityArea / (look.snow ? 3200 : 2700));
  return Math.round(fullDensityCount * intensity ** 1.65);
}

function interpolate([start, end], fraction) {
  return start + (end - start) * fraction;
}

export function createParticles(look, width, height, random, count = particleCount(look, width, height)) {
  const snow = Boolean(look.snow);
  // Apparent size follows viewing distance. Rainfall and snowfall rates determine only how many particles are in the air.
  const bounds = [0, .52, .92, 1];
  const tiers = snow ? snowTiers : rainTiers;
  return Array.from({ length: count }, () => {
    const depth = random();
    const band = depth < bounds[1] ? 0 : depth < bounds[2] ? 1 : 2;
    const size = (depth - bounds[band]) / (bounds[band + 1] - bounds[band]);
    const tier = tiers[band];
    const radius = interpolate(tier.radius, size);
    return {
      x: random() * width,
      y: random() * height,
      radius,
      width: snow ? 2 * radius : interpolate(tier.width, size),
      length: snow ? 2 * radius : interpolate(tier.length, size),
      speed: interpolate(tier.speed, size),
      phase: random() * Math.PI * 2,
      sway: snow ? interpolate(tier.sway, size) : 0,
      band,
    };
  });
}

export function advanceParticles(particles, width, height, seconds, slope, random) {
  for (const particle of particles) {
    const fall = particle.speed * seconds;
    particle.y += fall;
    const bottomPadding = Math.max(padding, particle.length);
    if (particle.y >= height + bottomPadding) {
      particle.y -= height + padding + bottomPadding;
      particle.x = random() * (width + 2 * padding) - padding;
      continue;
    }
    particle.x += fall * slope;
    if (particle.sway) {
      const phase = particle.phase + seconds * 1.8;
      particle.x += particle.sway * (Math.sin(phase) - Math.sin(particle.phase));
      particle.phase = phase;
    }
    const sidePadding = Math.max(padding, particle.length * Math.abs(slope) + (particle.width || 0));
    if (particle.x >= width + sidePadding) particle.x -= width + 2 * sidePadding;
    else if (particle.x < -sidePadding) particle.x += width + 2 * sidePadding;
  }
}

export function createPrecipitationObjects(look, photo) {
  const snow = Boolean(look.snow);
  const particleRandom = randomSequence(765231);
  const particles = [];
  const viewport = new Vector2();
  const rainRaster = new Vector3(rainEdge, 0, 0);
  const snowSampleRadius = { value: 0 };
  const photoWeight = new Vector3(1, 1, 1), matteLight = new Vector3();
  const paneEdges = new Vector2();
  const impacts = createGlassImpacts(look, randomSequence(624821), photo);
  const geometry = new PlaneGeometry(1, 1);
  const style = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
  style.onUpload(() => style.clearUpdateRanges());
  geometry.setAttribute('particleStyle', style);
  const material = new ShaderMaterial({
    uniforms: { viewport: { value: viewport }, rainRaster: { value: rainRaster }, snowSampleRadius,
      ...impacts.photoUniforms, photoWeight: { value: photoWeight }, matteLight: { value: matteLight }, paneEdges: { value: paneEdges } },
    vertexShader, fragmentShader: snow ? snowShader : rainShader,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const transforms = mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  const matrix = transforms.array;
  const object = new Group();
  object.add(mesh, impacts.object);
  let width = 0, height = 0;

  function update({ width: nextWidth, height: nextHeight, pixelWidth, pixelHeight, dt, crosswind, wind = 0, reduced, backdrop, leftEdge, rightEdge }) {
    if (nextWidth <= 0 || nextHeight <= 0) return;
    if (width !== nextWidth || height !== nextHeight) {
      const count = particleCount(look, nextWidth, nextHeight);
      if (count < particles.length) particles.length = count;
      for (const particle of particles) {
        particle.x = Math.max(-padding, Math.min(nextWidth + padding, particle.x * nextWidth / width));
        particle.y = Math.max(-padding, Math.min(nextHeight + padding, particle.y * nextHeight / height));
      }
      width = nextWidth;
      height = nextHeight;
      viewport.set(width, height);
      const firstNew = particles.length;
      if (count > firstNew) {
        for (const particle of createParticles(look, width, height, particleRandom, count - firstNew)) {
          const { band } = particle;
          if (snow) {
            const { opacity, arms } = snowTiers[band];
            style.setXYZ(particles.length, opacity, arms, particle.radius + .4);
          } else {
            style.setXYZ(particles.length, rainTiers[band].opacity, particle.width, particle.length);
          }
          particles.push(particle);
        }
        style.addUpdateRange(firstNew * style.itemSize, (count - firstNew) * style.itemSize);
        style.needsUpdate = true;
      }
    }
    const slope = crosswind * .625;
    if (dt > 0 && !reduced) advanceParticles(particles, width, height, dt, slope, particleRandom);
    const cssPixel = Math.max(pixelWidth > 0 ? width / pixelWidth : 0, pixelHeight > 0 ? height / pixelHeight : 0);
    impacts.update(particles, dt, width, height, slope, wind, reduced, cssPixel);
    paneEdges.set(leftEdge ?? 0, rightEdge ?? width);
    if (backdrop) {
      photoWeight.set(backdrop.main.photo, backdrop.left.photo, backdrop.right.photo);
      matteLight.set(backdrop.main.matte, backdrop.left.matte, backdrop.right.matte);
    }
    const filterPixel = cssPixel > 1.6 ? cssPixel : 0;
    const edgeWidth = Math.max(rainEdge, 1.62 * filterPixel);
    const minLength = Math.min(20, 1.8 * filterPixel);
    rainRaster.set(edgeWidth, filterPixel, minLength);
    snowSampleRadius.value = .73 * filterPixel;
    const rainNormal = 1 / Math.hypot(1, slope);
    const count = particles.length;
    for (let i = 0; i < count; i++) {
      const { x, y, radius, width: lineWidth, length, phase } = particles[i];
      const offset = i * 16;
      if (snow) {
        const spread = Math.max(radius + .4, snowSampleRadius.value) * 2;
        const stretch = .76 + .24 * (.5 + .5 * Math.sin(phase));
        const orientation = phase * .68 + slope * .36;
        const cosine = Math.cos(orientation) * spread;
        const sine = Math.sin(orientation) * spread;
        matrix[offset] = cosine;
        matrix[offset + 1] = sine;
        matrix[offset + 4] = sine * stretch;
        matrix[offset + 5] = -cosine * stretch;
        matrix[offset + 12] = x;
        matrix[offset + 13] = y;
      } else {
        const across = (lineWidth + edgeWidth) * rainNormal;
        const streakLength = Math.max(length, minLength);
        const drift = streakLength * slope;
        matrix[offset] = across;
        matrix[offset + 1] = -across * slope;
        matrix[offset + 4] = -drift;
        matrix[offset + 5] = -streakLength;
        matrix[offset + 12] = x - drift / 2;
        matrix[offset + 13] = y - streakLength / 2;
      }
    }
    mesh.count = count;
    if (count) {
      transforms.clearUpdateRanges();
      transforms.addUpdateRange(0, count * transforms.itemSize);
      transforms.needsUpdate = true;
    }
  }

  function dispose() {
    object.clear();
    mesh.dispose();
    geometry.dispose();
    material.dispose();
    impacts.dispose();
  }

  return { object, update, dispose };
}
