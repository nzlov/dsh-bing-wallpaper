import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, PlaneGeometry, ShaderMaterial, Vector2,
} from 'three';

const corners = [[0, -1], [0, 1], [1, -1], [1, -1], [0, 1], [1, 1]];

const boltVertexShader = `
uniform vec2 viewport;
uniform float pixel;
attribute vec2 endpoint;
attribute vec3 profile;
varying vec2 local;
varying vec3 line;
varying float strength;
void main() {
  vec2 start = position.xy * viewport;
  vec2 delta = endpoint * viewport - start;
  float span = max(0.001, length(delta));
  vec2 tangent = delta / span;
  vec2 normal = vec2(-tangent.y, tangent.x);
  float core = max(mix(0.65, 2.1, profile.z), pixel * mix(0.46, 0.80, profile.z));
  float halo = core + max(4.0, 1.85 * pixel) * mix(0.65, 1.30, profile.z);
  local = vec2(profile.x * span + (2.0 * profile.x - 1.0) * halo, profile.y * halo);
  line = vec3(span, core, halo);
  strength = profile.z;
  vec2 point = start + tangent * local.x + normal * local.y;
  gl_Position = vec4(point / viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}
`;

const boltFragmentShader = `
uniform float pixel, power;
varying vec2 local;
varying vec3 line;
varying float strength;
void main() {
  float beyond = max(0.0, max(-local.x, local.x - line.x));
  float distance = length(vec2(beyond, local.y));
  float core = 1.0 - smoothstep(line.y * 0.64, line.y + pixel * 0.37, distance);
  float halo = 1.0 - smoothstep(line.y * 0.45, line.z, distance);
  float alpha = (core + (1.0 - core) * halo * halo * 0.44) * mix(0.54, 1.0, strength);
  vec3 color = mix(vec3(0.46, 0.59, 1.0), vec3(0.97, 0.99, 1.0), core);
  gl_FragColor = vec4(color, power * alpha);
}
`;

const glowVertexShader = `
uniform vec2 center, span;
varying vec2 offset;
void main() {
  offset = uv * 2.0 - 1.0;
  vec2 point = center + offset * span * 0.5;
  gl_Position = vec4(point * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}
`;

const glowFragmentShader = `
uniform float power;
varying vec2 offset;
void main() {
  float falloff = 1.0 - smoothstep(0.0, 1.0, length(offset));
  gl_FragColor = vec4(0.63, 0.71, 1.0, power * falloff * falloff);
}
`;

function lightningPath(random, intensity) {
  const positions = [], endpoints = [], profiles = [];
  function segment([x, y], [nextX, nextY], strength) {
    for (const [along, side] of corners) {
      positions.push(x, y, 0);
      endpoints.push(nextX, nextY);
      profiles.push(along, side, strength);
    }
  }

  function path(start, segments, descent, drift, spread, thickness, taper) {
    const points = [start];
    const [x, y] = start;
    for (let i = 1; i <= segments; i++) {
      const progress = (i + (random() - .5) * .42) / segments;
      const nextX = Math.max(.045, Math.min(.955, x + drift * progress + (random() - .5) * spread));
      const next = [nextX, y + progress * descent];
      segment(points.at(-1), next, thickness * (1 - i / segments * taper));
      points.push(next);
    }
    return points;
  }

  const start = [.22 + random() * .56, .005];
  const trunk = path(start, 13, (.34 + .28 * intensity) * (.88 + .24 * random()), (random() - .5) * .23, .086, 1, .35);
  const side = random() < .5 ? -1 : 1;
  for (let i = 0; i < 3; i++) {
    const root = trunk[2 + i * 3];
    const direction = i === 1 ? -side : side;
    path(root, 5 - Number(i === 2), (.10 + .13 * random()) * (1 - i * .12), direction * (.085 + .085 * random()),
      .043, .70 - i * .08, .42);
  }
  return {
    geometry: new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3))
      .setAttribute('endpoint', new Float32BufferAttribute(endpoints, 2))
      .setAttribute('profile', new Float32BufferAttribute(profiles, 3)),
    center: [start[0] * .6 + trunk[6][0] * .4, .13 + intensity * .063],
  };
}

export function createLightning(look, storm, random = Math.random) {
  if (!look.lightningChance) return null;
  const object = new Group();
  object.name = 'weather-lightning';
  object.visible = false;
  const uniforms = { viewport: { value: new Vector2() }, pixel: { value: 1 }, power: { value: 0 } };
  const glowUniforms = { center: { value: new Vector2() }, span: { value: new Vector2() }, power: { value: 0 } };
  const settings = { transparent: true, depthWrite: false, depthTest: false, side: DoubleSide, forceSinglePass: true };
  const bolt = new Mesh(new BufferGeometry(), new ShaderMaterial({
    ...settings, uniforms, vertexShader: boltVertexShader, fragmentShader: boltFragmentShader,
  }));
  const glow = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
    ...settings, uniforms: glowUniforms, vertexShader: glowVertexShader, fragmentShader: glowFragmentShader,
  }));
  bolt.name = 'lightning-bolt';
  glow.name = 'lightning-glow';
  bolt.frustumCulled = glow.frustumCulled = false;
  glow.renderOrder = 1;
  bolt.renderOrder = 1.1;
  object.add(glow, bolt);

  const interval = () => 8 + random() * 12;
  const duration = storm ? .74 : .58;
  let next = storm ? .95 + random() * 1.45 : interval();
  let strike = -Infinity, paused = false;
  return {
    object,
    update({ width, height, pixelWidth, pixelHeight, time, reduced }) {
      if (reduced) {
        paused = true;
        strike = -Infinity;
        object.visible = false;
        return;
      }
      if (paused) {
        paused = false;
        next = time + interval();
      }
      if (time >= next) {
        next = time + interval();
        if (random() < look.lightningChance) {
          const { geometry, center } = lightningPath(random, look.rain);
          bolt.geometry.dispose();
          bolt.geometry = geometry;
          glowUniforms.center.value.set(...center);
          strike = time;
        }
      }
      const age = time - strike;
      object.visible = age < duration;
      if (!object.visible) return;

      // The second pulse and fading tail remain visible on the software renderer's 8 Hz cadence.
      const pulse = Math.max(1 - age / .30, .74 * (1 - Math.abs(age - .26) / .19), .33 * (1 - age / duration));
      uniforms.viewport.value.set(width, height);
      uniforms.pixel.value = Math.max(width / (pixelWidth || width), height / (pixelHeight || height));
      uniforms.power.value = pulse;
      glowUniforms.span.value.set(Math.min(.78, height / width * .96), .66);
      glowUniforms.power.value = pulse * (storm ? .57 : .25 + .14 * look.rain);
    },
    dispose() {
      bolt.geometry.dispose();
      bolt.material.dispose();
      glow.geometry.dispose();
      glow.material.dispose();
    },
  };
}
