import {
  Camera, DataTexture, Group, LinearFilter, Mesh, PlaneGeometry, RedFormat,
  RepeatWrapping, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget,
} from 'three';
import { randomSequence } from './weather-effects.js';
import { createFogGlass } from './glass-impact.js';
import { createLightning } from './weather-lightning.js';

const tile = 256;

function atmosphereTexture(effect, frost) {
  const random = randomSequence(1837);
  const pixels = new Uint8Array(tile * tile);
  const noise = Array.from({ length: 32 * 32 }, random);
  function value(x, y, nx, ny) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const f = x - ix, g = y - iy;
    const u = f * f * (3 - 2 * f), v = g * g * (3 - 2 * g);
    const at = (dx, dy) => noise[((iy + dy) % ny) * 32 + (ix + dx) % nx];
    return (at(0, 0) * (1 - u) + at(1, 0) * u) * (1 - v) + (at(0, 1) * (1 - u) + at(1, 1) * u) * v;
  }
  function line(x, y, dx, dy, amount) {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    for (let i = 0; i <= steps; i++) {
      const px = Math.round(x + dx * i / steps);
      const py = Math.round(y + dy * i / steps);
      const index = ((py % tile + tile) % tile) * tile + (px % tile + tile) % tile;
      pixels[index] = Math.max(pixels[index], amount);
    }
  }
  if (frost) {
    for (let i = 0; i < 82; i++) {
      const x = random() * tile, y = 1 + random() * 6;
      const dy = 5 + random() ** 2 * 78, dx = (random() - .5) * dy;
      line(x, y, dx, dy, 175);
      for (let j = 1; j < 9; j++) {
        const t = j / 10, branch = dy * (1 - t) * .25;
        for (const dir of [-1, 1]) line(x + dx * t, y + dy * t, branch * dir, branch * .85, 105);
      }
    }
  } else {
    const nx = effect === 'fog' ? 2 : 4, ny = effect === 'fog' ? 8 : 5;
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const u = x / tile, v = y / tile;
        const n = .55 * value(u * nx, v * ny, nx, ny) + .30 * value(u * 8, v * 10, 8, 10)
          + .15 * value(u * 19, v * 25, 19, 25);
        pixels[y * tile + x] = Math.round(n * 255);
      }
    }
  }
  const texture = new DataTexture(pixels, tile, tile, RedFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const vertexShader = `
varying vec2 screen;
void main() {
  screen = vec2(uv.x, 1.0 - uv.y);
  gl_Position = vec4(position.xy, 0.9, 1.0);
}`;

const fragmentShader = `
varying vec2 screen;
uniform vec2 viewport, origin, axis;
uniform vec3 lightColor;
#ifdef SUNBEAMS
uniform vec3 beamMotion;
uniform bool moonlight;
#endif
uniform float glow, scattering, offset, ice;
uniform sampler2D pattern;
void addLayer(inout vec4 color, vec3 rgb, float a) {
  color = mix(color, vec4(rgb, 1.0), clamp(a, 0.0, 1.0));
}
float lobe(float x, float center, float width) {
  return 1.0 - smoothstep(0.0, width, abs(x - center));
}
void main() {
  vec4 color = vec4(0.0);
  vec2 rel = screen - origin;
  float aspect = viewport.x / viewport.y;
  vec2 d = rel * vec2(aspect, 1.0);
  float along = dot(d,axis);
  float side = dot(d,vec2(axis.y,-axis.x)) / max(0.001, along);
#ifdef CLOUDS
  vec2 cloudScale = vec2(aspect * 0.71, 0.95);
  vec2 drift = vec2(offset, 0.0);
  float n = texture2D(pattern, screen * cloudScale - drift).r;
  float density = smoothstep(0.44, 0.72, n);
  addLayer(color, vec3(mix(0.69, 0.97, density)), 0.49*density);
#endif
#ifdef SUNBEAMS
  float distanceToLight = length(d);
  if (moonlight) {
    float halo = 1.0 - smoothstep(0.0, 0.24, distanceToLight);
    float bloom = 1.0 - smoothstep(0.018, 0.075, distanceToLight);
    float edge = max(fwidth(distanceToLight), 0.001);
    float disc = 1.0 - smoothstep(0.019 - edge, 0.019 + edge, distanceToLight);
    float transmission = 1.0;
#ifdef CLOUDS
    transmission = 1.0 - 0.84 * density;
#endif
    float exposure = glow * transmission;
    addLayer(color, lightColor, exposure * (0.22 * halo * halo + 0.32 * bloom));
    if (disc > 0.0) {
      // Soft, uneven shading gives the moon a recognizable surface inside its halo.
      float mare = 1.0 - smoothstep(0.26, 1.0, length((d - vec2(-0.005, -0.004)) / vec2(0.010, 0.006)));
      float basin = 1.0 - smoothstep(0.24, 1.0, length((d - vec2(0.006, 0.005)) / vec2(0.005, 0.008)));
      vec3 face = mix(vec3(1.0, 0.99, 0.96), lightColor, 0.44) * (1.0 - 0.17 * mare - 0.13 * basin);
      addLayer(color, face, 1.24 * exposure * disc);
    }
  } else {
    float halo = 1.0 - smoothstep(0.015, 0.51, distanceToLight);
    float core = 1.0 - smoothstep(0.014, 0.082, distanceToLight);
    float sweep = beamMotion.x;
    float gap = beamMotion.y;
    float phase = beamMotion.z;
    float fan = (0.36 + 0.20 * phase) * lobe(side, -0.79 + sweep, 0.34)
              + (0.78 - 0.23 * phase) * lobe(side, -0.34 + gap, 0.22)
              + (0.59 + 0.38 * phase) * lobe(side,  0.08 + sweep, 0.25)
              + (0.66 - 0.19 * phase) * lobe(side,  0.55 - gap, 0.31);
    float shafts = fan * smoothstep(0.0, 0.16, along) * (1.0 - smoothstep(0.31, 1.30, distanceToLight));
    float transmission = 1.0;
#ifdef CLOUDS
    // Project each ray onto the same moving cloud field that shades the wallpaper.
    vec2 overhead = origin + rel * (0.22 / max(along, 0.22));
    float cover = texture2D(pattern, overhead * cloudScale - drift).r;
    transmission = mix(1.0, 0.24, smoothstep(0.39, 0.68, cover)) * (1.0 - 0.52 * density);
#endif
    addLayer(color, lightColor, transmission * (glow * (0.72*halo*halo + 0.40*core) + scattering*shafts));
  }
#else
  float halo = max(0.0, 1.0 - length(rel / vec2(0.34, 0.40)));
  float fan = 0.40*lobe(side,-0.65,0.15) + 0.83*lobe(side,-0.26,0.18) + lobe(side,0.10,0.17) + 0.54*lobe(side,0.57,0.20);
  float distanceFromLight = length(rel / vec2(0.78,1.25));
  float shafts = fan * step(0.0,along) * smoothstep(0.0,0.16,distanceFromLight) * (1.0-smoothstep(0.20,0.90,distanceFromLight));
  addLayer(color, lightColor, glow * halo * halo + scattering * shafts);
#endif
#ifdef FOG
  float n = texture2D(pattern, vec2(screen.x*viewport.x/viewport.y*0.65-offset, screen.y)).r;
  addLayer(color,vec3(0.89),0.03+0.21*smoothstep(0.27,0.73,n));
#endif
#ifdef FROST
  float bottom = (1.0-screen.y)*viewport.y;
  float edge = min(screen.x,1.0-screen.x)*viewport.x;
  vec2 strip = vec2(screen.x*viewport.x,bottom/max(0.4,ice))/256.0;
  vec2 sides = vec2(screen.y*viewport.y,edge/max(0.3,ice*0.57))/256.0;
  float crystal = max(texture2D(pattern,strip).r*(1.0-smoothstep(30.0,90.0,bottom/max(0.4,ice))),
                      texture2D(pattern,sides).r*(1.0-smoothstep(8.0,42.0,edge/max(0.3,ice))));
  addLayer(color,vec3(0.87,0.94,0.99),ice*(crystal*0.82+0.36*(1.0-smoothstep(0.0,46.0*ice,bottom))));
#endif
  gl_FragColor = vec4(color.rgb / max(color.a,0.0001), color.a);
}`;

export function createAtmosphere(look, effect, photo, renderer) {
  const object = new Group();
  const clouds = effect === 'clouds', fog = effect === 'fog', storm = effect === 'storm';
  const sunbeams = clouds || effect === 'clear';
  let sunlitTime = 0;
  const texture = clouds || fog || look.frost ? atmosphereTexture(effect, look.frost) : null;
  const uniforms = {
    viewport: {value: new Vector2()}, origin: {value: new Vector2()}, axis: {value: new Vector2()},
    lightColor: {value: new Vector3()},
    glow: {value: 0}, scattering: {value: 0}, offset: {value: 0},
    ice: {value: look.frost || 0}, pattern: {value: texture},
  };
  const defines = clouds ? { CLOUDS: 1 } : fog ? { FOG: 1 } : look.frost ? { FROST: 1 } : {};
  if (sunbeams) {
    defines.SUNBEAMS = 1;
    uniforms.beamMotion = { value: new Vector3(0, 0, 0.5) };
    uniforms.moonlight = { value: false };
  }
  const material = new ShaderMaterial({vertexShader, fragmentShader, uniforms, defines, transparent: true, depthWrite: false, depthTest: false});
  const sheet = new Mesh(new PlaneGeometry(2, 2), material);
  sheet.frustumCulled = false;
  // Between light or viewport changes the air and frost behind precipitation are static.
  // Cache this background on the same GPU so falling particles only sample it each frame.
  const cached = renderer && (look.rain || look.snow) ? new WebGLRenderTarget(1, 1, {
    depthBuffer: false, stencilBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter,
  }) : null;
  let capture, camera, display, lastLight, lastWidth, lastHeight;
  if (cached) {
    capture = new Scene();
    camera = new Camera();
    capture.add(sheet);
    display = new ShaderMaterial({
      uniforms: { sky: { value: cached.texture } },
      vertexShader,
      fragmentShader: `varying vec2 screen;
        uniform sampler2D sky;
        void main() {
          vec4 c = texture2D(sky, vec2(screen.x, 1.0-screen.y));
          gl_FragColor = vec4(c.rgb / max(c.a,0.0001), c.a);
        }`,
      transparent: true, depthWrite: false, depthTest: false,
    });
    const backdrop = new Mesh(sheet.geometry, display);
    backdrop.frustumCulled = false;
    object.add(backdrop);
  } else object.add(sheet);
  const condensation = fog ? createFogGlass(look, photo) : null;
  if (condensation) object.add(condensation.object);
  const lightning = createLightning(look, storm);
  if (lightning) object.add(lightning.object);
  let previous = 0;
  return {
    object,
    update(state) {
      const { width, height, time, light, crosswind, hasWindDirection, reduced } = state;
      condensation?.update(state);
      uniforms.viewport.value.set(width, height);
      uniforms.origin.value.set(light.x / 100, light.y / 100);
      const lean = (50-light.x)/60;
      uniforms.axis.value.set(lean, 1).normalize();
      if (sunbeams) {
        uniforms.moonlight.value = !light.day;
        const exposure = Math.sqrt(light.intensity);
        if (light.day) {
          uniforms.lightColor.value.set(1, .76 + .14*light.altitude, .49 + .23*light.altitude);
          uniforms.glow.value = .93 * look.light * exposure;
          uniforms.scattering.value = (clouds ? .89 : .59) * exposure;
          if (!reduced) sunlitTime += Math.max(0, time - previous);
          // Vary the width of the gaps and the balance of neighboring rays while the sun follows the clock.
          uniforms.beamMotion.value.set(
            .13*Math.sin(sunlitTime*.51) + .049*Math.sin(sunlitTime*.81),
            .12*Math.sin(sunlitTime*.43) - .065*Math.sin(sunlitTime*.67),
            .5 + .5*Math.sin(sunlitTime*.71),
          );
        } else {
          uniforms.lightColor.value.set(.88, .94, 1);
          uniforms.glow.value = .98 * look.light * exposure;
          uniforms.scattering.value = 0;
          uniforms.beamMotion.value.set(0, 0, .5);
        }
      } else {
        uniforms.lightColor.value.set(...(light.day ? [1,(207+34*light.altitude)/255,(151+67*light.altitude)/255] : [.757,.843,1]));
        uniforms.glow.value = look.light * light.intensity * .50;
        uniforms.scattering.value = look.scattering * light.intensity * 1.30;
      }
      const speed = hasWindDirection ? crosswind * 3.2 : -(1 + Math.abs(crosswind) * 2.2);
      if (!reduced) uniforms.offset.value += Math.max(0,time-previous) * speed / (fog ? 125 : 74);
      previous = time;
      if (cached && (lastLight !== light || lastWidth !== width || lastHeight !== height)) {
        const scale = Math.min(1, (look.frost ? 900 : 400) / Math.max(width,height));
        cached.setSize(Math.max(1,Math.round(width*scale)), Math.max(1,Math.round(height*scale)));
        const target = renderer.getRenderTarget();
        renderer.setRenderTarget(cached);
        try { renderer.render(capture,camera); }
        finally { renderer.setRenderTarget(target); }
        lastLight = light; lastWidth = width; lastHeight = height;
      }
      lightning?.update(state);
    },
    dispose() {
      sheet.geometry.dispose(); material.dispose(); texture?.dispose();
      display?.dispose(); cached?.dispose(); capture?.clear();
      condensation?.dispose();
      lightning?.dispose();
    },
  };
}
