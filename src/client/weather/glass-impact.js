import {
  DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, LinearFilter, PlaneGeometry, ShaderMaterial,
  SRGBColorSpace, Texture, Vector2, Vector4,
} from 'three';
import { wallpaperGeometry } from '../wallpaper/wallpaper-alignment.js';
import { randomSequence } from './weather-effects.js';

const maxImpacts = 42;
const maxFogBeads = 6;
const burst = [[0, 1], [1.15, .88], [2.53, .72], [3.86, 1.15], [5.34, .93]];
const capacity = maxImpacts * (burst.length + 2);
const splashMark = 0;
const waterBead = 1;
const waterTrail = 2;
const attachedSnow = 3;

const vertexShader = `
uniform vec2 viewport;
attribute vec4 impactStyle;
varying vec2 local;
varying vec2 point;
varying vec2 center;
varying vec4 style;
void main() {
  local = position.xy * 2.0;
  point = (instanceMatrix * vec4(position, 1.0)).xy;
  center = instanceMatrix[3].xy;
  style = impactStyle;
  gl_Position = vec4(point * (vec2(2.0, -2.0) / viewport) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const fragmentShader = `
uniform vec4 cover;
uniform sampler2D wallpaper;
uniform float hasWallpaper;
varying vec2 local;
varying vec2 point;
varying vec2 center;
varying vec4 style;

vec3 photoAt(vec2 pixel, vec3 tint) {
  if (hasWallpaper < 0.5) return tint;
  vec2 uv = clamp((pixel - cover.xy) / cover.zw, 0.0, 1.0);
  return texture2D(wallpaper, vec2(uv.x, 1.0 - uv.y)).rgb;
}

void main() {
  float r = length(local);
  vec3 color = vec3(0.79, 0.9, 1.0);
  float opacity;
  if (style.x < 0.5) {
    opacity = 1.0 - smoothstep(0.20, 1.0, r);
  } else if (style.x < 1.5) {
    float taper = 1.0 + 0.27 * smoothstep(-0.25, 1.0, local.y);
    r = length(vec2(local.x * taper, local.y));
    float depth = sqrt(max(0.0, 1.0 - r * r));
    vec2 lensScale = style.z > 0.0 ? style.zw : vec2(1.0);
    vec2 samplePoint = center - (point - center) * lensScale * (1.35 + 2.3 * depth) + vec2(1.8, -3.1) * depth;
    vec3 refracted = photoAt(samplePoint, vec3(0.37, 0.52, 0.63));
    float rim = smoothstep(0.68, 0.90, r);
    float shine = exp(-dot((local - vec2(-0.41, 0.36)) * vec2(4.8, 3.3),
      (local - vec2(-0.41, 0.36)) * vec2(4.8, 3.3)));
    float reflection = rim * smoothstep(-0.12, 0.76, -local.x + local.y) * 0.50 + shine * 0.69;
    color = mix(refracted * mix(0.93, 0.48, rim), vec3(0.86, 0.96, 1.0), clamp(reflection, 0.0, 0.94));
    opacity = (1.0 - smoothstep(0.83, 1.02, r)) * (0.67 + 0.29 * rim);
  } else if (style.x < 2.5) {
    float along = local.y * 0.5 + 0.5;
    float bend = sin(along * 3.14159265) * style.w;
    float across = local.x - bend;
    float breadth = mix(style.z * 0.94, style.z * 0.28, along);
    float profile = 1.0 - smoothstep(breadth * 0.24, breadth, abs(across));
    vec3 refracted = photoAt(point + vec2(-across * 5.0 + 1.4, -1.8), vec3(0.52, 0.67, 0.78));
    color = mix(refracted, vec3(0.68, 0.84, 0.96), 0.34 + 0.14 * across);
    opacity = profile * (1.0 - smoothstep(0.54, 1.0, along)) * smoothstep(0.0, 0.12, along);
  } else {
    float angle = atan(local.y, local.x + 0.00001);
    float crystal = 0.5 + 0.5 * cos(angle * 6.0);
    float core = 1.0 - smoothstep(0.27, 0.58 + 0.17 * crystal, r);
    float arms = smoothstep(0.71, 0.98, crystal) * (1.0 - smoothstep(0.45, 0.98, r));
    opacity = max(core, max(arms * 0.69, (1.0 - smoothstep(0.20, 1.0, r)) * 0.43));
    color = mix(vec3(0.72, 0.87, 0.98), vec3(0.98, 0.99, 1.0), core);
  }
  gl_FragColor = vec4(color, opacity * style.y);
  #include <colorspace_fragment>
}`;

export function createGlassImpacts(look, random, photo, fog = false) {
  const snow = Boolean(look.snow);
  const intensity = look.snow || look.rain || 0;
  const impacts = [];
  const geometry = new PlaneGeometry(1, 1);
  const maxMarks = fog ? maxFogBeads * 2 : capacity;
  const styles = new InstancedBufferAttribute(new Float32Array(maxMarks * 4), 4).setUsage(DynamicDrawUsage);
  geometry.setAttribute('impactStyle', styles);
  const viewport = new Vector2();
  const cover = new Vector4(0, 0, 1, 1);
  const wallpaper = new Texture(photo);
  wallpaper.colorSpace = SRGBColorSpace;
  wallpaper.minFilter = LinearFilter;
  wallpaper.generateMipmaps = false;
  const material = new ShaderMaterial({
    uniforms: { viewport: { value: viewport }, cover: { value: cover },
      wallpaper: { value: wallpaper }, hasWallpaper: { value: 0 } },
    vertexShader, fragmentShader, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const object = new InstancedMesh(geometry, material, maxMarks);
  object.frustumCulled = false;
  object.renderOrder = 4;
  object.count = 0;
  const transforms = object.instanceMatrix.setUsage(DynamicDrawUsage);
  const matrices = transforms.array;
  let untilImpact = 0;
  let markCount = 0;
  let filterPixel = 0;
  let imageWidth = 0, imageHeight = 0;

  function advance(particles, seconds, width, height, slope, wind) {
    if (seconds <= 0) return;
    const windResponse = -Math.expm1(-seconds / .34);
    let living = 0;
    for (const impact of impacts) {
      impact.age += seconds;
      if (impact.age >= impact.lifetime) continue;
      const previousSlope = impact.slope;
      impact.slope += (slope - impact.slope) * windResponse;
      if (!snow) {
        const slide = Math.max(0, impact.age - impact.hold);
        const travel = slide * (13 + slide * 20) * impact.slideSpeed;
        // Wind bends newly traveled segments while the water on the pane stays in place.
        impact.drift += (travel - impact.travel) * (previousSlope + impact.slope) * .09;
        impact.travel = travel;
        impact.slide = slide;
      }
      impacts[living++] = impact;
    }
    impacts.length = living;

    if (fog) {
      const rate = Math.min(1.25, width * height / 1600000 * (1 + .37 * wind));
      untilImpact -= seconds * rate;
      if (untilImpact <= 0 && impacts.length < maxFogBeads && rate > 0) {
        untilImpact += .74 + random() * .74;
        const hold = 1.5 + random() * 2.1;
        impacts.push({
          x: width * (.05 + random() * .9), y: height * (.08 + random() * .73),
          slope, hold, age: 0, slide: 0, travel: 0, drift: 0,
          slideSpeed: .20 + random() * .14 + .10 * wind,
          radius: 2.1 + random() * 2.7, phase: random() * Math.PI * 2,
          lifetime: hold + 1.9 + random() * 1.15,
        });
      }
      untilImpact = Math.max(0, untilImpact);
      return;
    }

    const rate = Math.min(24, width * height / 95000 * intensity * (snow ? .88 : 1.2)
      * (1 + .37 * wind + .75 * Math.abs(slope)));
    if (!particles.length || !rate) return;
    untilImpact -= seconds * rate;
    for (let added = 0; added < 2 && untilImpact <= 0 && impacts.length < maxImpacts; added++) {
      untilImpact += .65 + random() * .7;
      const start = Math.floor(random() * particles.length);
      let particle;
      for (let offset = 0; offset < particles.length; offset++) {
        const candidate = particles[(start + offset) % particles.length];
        if (candidate.x < 0 || candidate.x >= width || candidate.y < 0 || candidate.y >= height) continue;
        particle = candidate;
        break;
      }
      if (!particle) continue;
      const hold = .16 + random() * .26;
      impacts.push({
        x: particle.x, y: particle.y, slope, hold, age: 0, slide: 0, travel: 0, drift: 0,
        slideSpeed: .68 + .16 * Math.min(particle.radius, 5.5),
        radius: snow ? .88 + particle.radius * .92 : .95 + particle.radius * .78,
        phase: random() * Math.PI * 2,
        lifetime: snow ? .91 + random() * .53 + .10 * Math.min(particle.radius, 5) : hold + 1.2 + random() * .64,
      });
      // Keep the glass contact at the actual visible tip and recycle the airborne particle.
      particle.y = -24 - random() * 12;
      particle.x = random() * width;
    }
    untilImpact = Math.max(0, untilImpact);
  }

  function mark(x, y, width, height, angle, kind, opacity, shape = 0, bend = 0) {
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const offset = markCount * 16;
    matrices[offset] = cosine * width;
    matrices[offset + 1] = sine * width;
    matrices[offset + 4] = sine * height;
    matrices[offset + 5] = -cosine * height;
    matrices[offset + 12] = x;
    matrices[offset + 13] = y;
    styles.setXYZW(markCount++, kind, opacity, shape, bend);
  }

  function markWater(x, y, width, height, angle, opacity) {
    const minSampleSize = filterPixel * 1.36;
    const drawnWidth = Math.max(width, minSampleSize), drawnHeight = Math.max(height, minSampleSize);
    const scaleX = width / drawnWidth, scaleY = height / drawnHeight;
    // Integrate subpixel water before CSS upscaling, retaining the optical size.
    mark(x, y, drawnWidth, drawnHeight, angle, waterBead,
      opacity * Math.sqrt(scaleX * scaleY), scaleX, scaleY);
  }

  function scatter(impact) {
    const progress = impact.age / (snow ? .32 : .23);
    if (progress >= 1) return;
    const spread = impact.radius * (.5 + (snow ? 2.75 : 2.3) * progress);
    const size = snow ? Math.min(1.65, .75 + impact.radius * .15) : .82 + Math.min(.47, impact.radius * .10);
    for (const [angle, reach] of burst) {
      const direction = angle + impact.phase;
      const x = impact.x + spread * (Math.cos(direction) * reach + impact.slope * progress * .5);
      const y = impact.y + spread * (Math.sin(direction) * reach * .74 + progress * progress * .29);
      mark(x, y, (snow ? 1.75 : 2.05) * size, (3.6 - progress) * size, direction + Math.PI / 2,
        splashMark, (1 - progress) * .86);
    }
  }

  function stick(impact) {
    const melt = Math.max(0, (impact.age - .14) / (impact.lifetime - .14));
    const radius = impact.radius * (1 - .62 * melt);
    const diameter = radius * 2;
    const drawn = Math.max(diameter, filterPixel * 1.28);
    mark(impact.x, impact.y, drawn, drawn, impact.phase, attachedSnow, .96 * (1 - melt) * (diameter / drawn) ** 1.5);
    if (melt > 0) markWater(impact.x, impact.y, diameter, radius * 1.12, 0, Math.sin(Math.PI * melt) * .53);
  }

  function slideBead(impact) {
    const slide = impact.slide;
    const x = impact.x + impact.drift + Math.sin(slide * 5) * impact.radius * .34;
    const y = impact.y + impact.travel;
    const fade = Math.min(1, (impact.lifetime - impact.age) / (fog ? 1 : .58));
    const growth = fog ? Math.min(1, impact.age / impact.hold) : 1;
    const radius = impact.radius * (.56 + fade * .44) * (.22 + .78 * Math.sqrt(growth));
    if (impact.travel > 2) {
      const dx = (x - impact.x) * .84, dy = impact.travel * .84;
      const wetWidth = fog ? Math.min(1.65, radius * .48) : Math.min(1.32, radius * .43);
      const traceWidth = Math.max(wetWidth, filterPixel * .65);
      const coverage = Math.sqrt(wetWidth / traceWidth);
      const bend = Math.sin(impact.phase + slide * 3) * radius * Math.min(slide, 1) * .54;
      const halfWidth = traceWidth + Math.abs(bend) + .6;
      mark(x - dx / 2, y - dy / 2, halfWidth * 2, Math.hypot(dx, dy), Math.atan2(-dx, dy),
        waterTrail, Math.min(slide * 2, 1) * fade * (fog ? .36 : .63) * coverage, traceWidth / halfWidth, bend / halfWidth);
    }
    const stretch = .63 + (fog ? .49 * growth : Math.min(impact.age * 2.7, .49))
      + (fog ? Math.min(slide * .48, .52) : Math.min(slide * .39, .38));
    const width = radius * 2, height = width * stretch;
    markWater(x, y, width, height, -impact.slope * .09, fade * (fog ? .77 * growth : .94));
  }

  function update(particles, seconds, width, height, slope, wind, reduced, cssPixel = 0) {
    if (reduced) {
      impacts.length = 0;
      untilImpact = 0;
      object.count = 0;
      return;
    }
    filterPixel = !fog && cssPixel > 1.6 ? cssPixel : 0;
    const nextImageWidth = photo?.naturalWidth || 0, nextImageHeight = photo?.naturalHeight || 0;
    const imageChanged = imageWidth !== nextImageWidth || imageHeight !== nextImageHeight;
    if (imageChanged) {
      imageWidth = nextImageWidth;
      imageHeight = nextImageHeight;
      material.uniforms.hasWallpaper.value = Number(Boolean(imageWidth && imageHeight));
      if (imageWidth && imageHeight) wallpaper.needsUpdate = true;
    }
    if (imageChanged || viewport.x !== width || viewport.y !== height) {
      viewport.set(width, height);
      const { x, y, width: coverWidth, height: coverHeight } = wallpaperGeometry(width, height, imageWidth, imageHeight);
      cover.set(x, y, coverWidth, coverHeight);
    }
    advance(particles, seconds, width, height, slope, wind);
    markCount = 0;
    for (const impact of impacts) {
      if (!fog) scatter(impact);
      if (snow) stick(impact);
      else slideBead(impact);
    }
    object.count = markCount;
    if (markCount) {
      transforms.clearUpdateRanges();
      transforms.addUpdateRange(0, markCount * transforms.itemSize);
      styles.clearUpdateRanges();
      styles.addUpdateRange(0, markCount * styles.itemSize);
      transforms.needsUpdate = styles.needsUpdate = true;
    }
  }

  function dispose() {
    object.dispose();
    geometry.dispose();
    material.dispose();
    wallpaper.dispose();
  }

  return { object, update, dispose, photoUniforms: { wallpaper: material.uniforms.wallpaper,
    cover: material.uniforms.cover, hasWallpaper: material.uniforms.hasWallpaper } };
}

export function createFogGlass(look, photo) {
  const glass = createGlassImpacts(look, randomSequence(918267), photo, true);
  return {
    object: glass.object,
    update({ width, height, dt = 0, crosswind = 0, wind = 0, reduced = false }) {
      glass.update(null, dt, width, height, crosswind * .625, wind, reduced);
    },
    dispose: glass.dispose,
  };
}
