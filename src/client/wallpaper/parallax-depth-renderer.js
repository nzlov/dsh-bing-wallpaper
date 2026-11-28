import { decodeWallpaperImage } from './wallpaper-parallax.js';

const DEPTH_MAGIC = [0x42, 0x44, 0x54, 0x44]; // BDTD
const DEPTH_HEADER_BYTES = 8;
const MAX_PARALLAX_SHIFT = 0.028;
const depthCache = new Map();

export function decodeDepthPayload(input) {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes || bytes.byteLength <= DEPTH_HEADER_BYTES) return null;
  for (let i = 0; i < 4; i++) if (bytes[i] !== DEPTH_MAGIC[i]) return null;
  const width = (bytes[4] << 8) | bytes[5];
  const height = (bytes[6] << 8) | bytes[7];
  if (width < 1 || height < 1 || width > 4096 || height > 4096) return null;
  if (bytes.byteLength !== DEPTH_HEADER_BYTES + width * height) return null;
  return { width, height, data: bytes.subarray(DEPTH_HEADER_BYTES) };
}

const VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform sampler2D u_image;
uniform sampler2D u_depth;
uniform vec2 u_texSize;
uniform vec2 u_canvasSize;
uniform vec2 u_geomOrigin;
uniform vec2 u_geomSize;
uniform vec2 u_offset;
uniform float u_strength;
uniform float u_useBicubic;

// 5-tap hardware-bilinear Catmull-Rom bicubic reconstruction for crisp upscaling.
vec4 sampleBicubic(vec2 uv) {
  vec2 samplePos = uv * u_texSize;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;

  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);

  vec2 w12 = w1 + w2;
  vec2 offset12 = w2 / w12;

  vec2 invSize = 1.0 / u_texSize;
  vec2 minUv = invSize * 0.5;
  vec2 maxUv = 1.0 - minUv;
  vec2 texPos0 = clamp((texPos1 - 1.0) * invSize, minUv, maxUv);
  vec2 texPos3 = clamp((texPos1 + 2.0) * invSize, minUv, maxUv);
  vec2 texPos12 = clamp((texPos1 + offset12) * invSize, minUv, maxUv);

  float wtTop = w12.x * w0.y;
  float wtLeft = w0.x * w12.y;
  float wtCenter = w12.x * w12.y;
  float wtRight = w3.x * w12.y;
  float wtBottom = w12.x * w3.y;

  vec3 color =
    texture2D(u_image, vec2(texPos12.x, texPos0.y)).rgb * wtTop +
    texture2D(u_image, vec2(texPos0.x, texPos12.y)).rgb * wtLeft +
    texture2D(u_image, vec2(texPos12.x, texPos12.y)).rgb * wtCenter +
    texture2D(u_image, vec2(texPos3.x, texPos12.y)).rgb * wtRight +
    texture2D(u_image, vec2(texPos12.x, texPos3.y)).rgb * wtBottom;
  float totalWeight = wtTop + wtLeft + wtCenter + wtRight + wtBottom;
  return vec4(clamp(color / totalWeight, 0.0, 1.0), 1.0);
}

void main() {
  vec2 screenPos = v_uv * u_canvasSize;
  vec2 imgUv = (screenPos - u_geomOrigin) / u_geomSize;
  float zoom = 1.0 / (1.0 + u_strength * 1.05);
  vec2 baseUv = (imgUv - 0.5) * zoom + 0.5;
  vec2 maxShift = u_offset * u_strength;

  // Continuous fixed-point depth warp: smooth, invertible, and tear-free.
  vec2 uv = baseUv;
  for (int i = 0; i < 8; i++) {
    float d = texture2D(u_depth, clamp(uv, 0.002, 0.998)).r;
    vec2 nextUv = baseUv + maxShift * (d - 0.5);
    uv = mix(uv, nextUv, 0.65);
  }
  vec2 finalUv = clamp(uv, 0.0005, 0.9995);
  gl_FragColor = u_useBicubic > 0.5 ? sampleBicubic(finalUv) : texture2D(u_image, finalUv);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl, modern) {
  const vertex = modern
    ? '#version 300 es\n' + VERTEX_SHADER.replace('attribute ', 'in ').replace('varying ', 'out ')
    : VERTEX_SHADER;
  const fragment = modern
    ? '#version 300 es\n' + FRAGMENT_SHADER
      .replace('varying vec2 v_uv;', 'in vec2 v_uv;\nout vec4 colorOut;')
      .replaceAll('texture2D(', 'texture(')
      .replace('gl_FragColor', 'colorOut')
    : FRAGMENT_SHADER;
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertex);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
  if (!vert || !frag) {
    if (vert) gl.deleteShader(vert);
    if (frag) gl.deleteShader(frag);
    return null;
  }
  const program = gl.createProgram();
  if (!program) { gl.deleteShader(vert); gl.deleteShader(frag); return null; }
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

async function loadDepth(url, signal, fetchImpl) {
  if (depthCache.has(url)) return depthCache.get(url);
  const response = await fetchImpl(url, { credentials: 'same-origin', signal });
  if (!response.ok) throw new Error('Depth map unavailable');
  const data = decodeDepthPayload(await response.arrayBuffer());
  signal.throwIfAborted();
  if (!data) throw new Error('Invalid depth map');
  depthCache.set(url, data);
  while (depthCache.size > 4) depthCache.delete(depthCache.keys().next().value);
  return data;
}

function configureTexture(gl, texture, filter) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

export async function createDepthParallaxRenderer({
  canvas, photo, url, dataUrl, imageWidth, imageHeight, signal, fetchImpl = globalThis.fetch,
}) {
  const options = { alpha: false, antialias: false, depth: false, stencil: false };
  const modern = canvas.getContext('webgl2', options);
  const gl = modern || canvas.getContext('webgl', options);
  if (!gl) return null;

  const program = createProgram(gl, Boolean(modern));
  if (!program) return null;
  let buffer, imageTex, depthTex;
  const dispose = () => {
    if (imageTex) gl.deleteTexture(imageTex);
    if (depthTex) gl.deleteTexture(depthTex);
    if (buffer) gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  };

  try {
    const [image, depth] = await Promise.all([
      photo ?? decodeWallpaperImage(url, signal),
      loadDepth(dataUrl, signal, fetchImpl),
    ]);
    signal.throwIfAborted();
    const textureWidth = Math.max(1, image.naturalWidth || imageWidth || 1920);
    const textureHeight = Math.max(1, image.naturalHeight || imageHeight || 1080);
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (Math.max(textureWidth, textureHeight, depth.width, depth.height) > maxTextureSize) {
      throw new Error('Wallpaper textures exceed WebGL limits');
    }
    const position = gl.getAttribLocation(program, 'a_pos');
    const uniforms = Object.fromEntries(
      ['image', 'depth', 'texSize', 'canvasSize', 'geomOrigin', 'geomSize', 'offset', 'strength', 'useBicubic']
        .map(name => [name, gl.getUniformLocation(program, `u_${name}`)]),
    );
    buffer = gl.createBuffer();
    imageTex = gl.createTexture();
    depthTex = gl.createTexture();
    if (!buffer || !imageTex || !depthTex) throw new Error('Wallpaper WebGL allocation failed');

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uniforms.texSize, textureWidth, textureHeight);

    gl.activeTexture(gl.TEXTURE0);
    configureTexture(gl, imageTex, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    if (modern) gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1i(uniforms.image, 0);

    gl.activeTexture(gl.TEXTURE1);
    configureTexture(gl, depthTex, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, modern ? gl.R8 : gl.LUMINANCE, depth.width, depth.height, 0,
      modern ? gl.RED : gl.LUMINANCE, gl.UNSIGNED_BYTE, depth.data);
    gl.uniform1i(uniforms.depth, 1);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Wallpaper WebGL upload failed');

    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const software = debug && /swiftshader|llvmpipe|softpipe|software rasterizer/i.test(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
    let currentMinFilter = gl.LINEAR;

    return {
      maxPixels: software ? 1280 * 720 : 3840 * 2160,
      draw({ geometry, renderWidth, renderHeight, pixelWidth, pixelHeight, bleed, dpr, offset, strength }) {
        gl.viewport(0, 0, pixelWidth, pixelHeight);
        const bicubic = !modern || geometry.width * dpr / textureWidth >= 0.95;
        const filter = bicubic ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR;
        if (currentMinFilter !== filter) {
          gl.activeTexture(gl.TEXTURE0);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
          currentMinFilter = filter;
        }

        gl.uniform2f(uniforms.canvasSize, renderWidth, renderHeight);
        gl.uniform2f(uniforms.geomOrigin, geometry.x + bleed, geometry.y + bleed);
        gl.uniform2f(uniforms.geomSize, geometry.width, geometry.height);
        gl.uniform2f(uniforms.offset, offset.x, offset.y);
        gl.uniform1f(uniforms.strength, strength * MAX_PARALLAX_SHIFT);
        gl.uniform1f(uniforms.useBicubic, bicubic ? 1 : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
