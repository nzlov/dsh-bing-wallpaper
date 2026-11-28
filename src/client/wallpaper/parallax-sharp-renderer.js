import { SparkRenderer, SplatFileType, SplatMesh } from '@sparkjsdev/spark';
import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

const SPLAT_BYTES = 32;
const MAX_SCENE_BYTES = 64 * 1024 * 1024;
const MAX_CAMERA_SHIFT = 0.028;
const webglOptions = {
  alpha: true, depth: false, stencil: false, antialias: false,
  premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'low-power',
};

function isSoftwareRenderer(gl) {
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
  return /swiftshader|llvmpipe|softpipe|software (?:rasterizer|renderer)|microsoft basic render/i.test(renderer);
}

function sceneIntrinsics(headers) {
  const width = Number(headers.get('x-bdt-scene-width'));
  const height = Number(headers.get('x-bdt-scene-height'));
  const focal = Number(headers.get('x-bdt-scene-focal-px'));
  const depth = Number(headers.get('x-bdt-scene-near-depth'));
  if (![width, height, focal, depth].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Invalid SHARP scene intrinsics');
  }
  return { width, height, focal, depth };
}

export function positionSharpCamera(camera, { width, height, focal, depth }, frame) {
  const { geometry, renderWidth, renderHeight, bleed, offset, strength } = frame;
  // Use the same cover rectangle as the original wallpaper, including the
  // extra canvas margin used by the background filters.
  const centerX = geometry.x + bleed + geometry.width / 2;
  const centerY = geometry.y + bleed + geometry.height / 2;
  const x = camera.near * width / (focal * geometry.width);
  const y = camera.near * height / (focal * geometry.height);
  camera.projectionMatrix.makePerspective(
    -centerX * x, (renderWidth - centerX) * x,
    centerY * y, -(renderHeight - centerY) * y,
    camera.near, camera.far,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const shift = strength * MAX_CAMERA_SHIFT * depth / focal;
  camera.position.set(offset.x * shift * width, -offset.y * shift * height, 0);
}

export async function createSharpParallaxRenderer({ canvas, dataUrl, signal, fetchImpl, invalidate }) {
  signal.throwIfAborted();
  const gl = canvas.getContext('webgl2', webglOptions);
  if (!gl || gl.isContextLost()) throw new Error('SHARP requires WebGL2');
  const software = isSoftwareRenderer(gl);
  const scene = new Scene();
  let disposed = false, mesh, renderer, spark, shaderFailed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.clear();
    mesh?.dispose();
    spark?.dispose();
    renderer?.dispose();
    if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  try {
    const response = await fetchImpl(dataUrl, { credentials: 'same-origin', signal });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_SCENE_BYTES) {
      await response.body?.cancel();
      throw new Error('SHARP scene unavailable');
    }
    const intrinsics = sceneIntrinsics(response.headers);
    const fileBytes = new Uint8Array(await response.arrayBuffer());
    signal.throwIfAborted();
    if (!fileBytes.byteLength || fileBytes.byteLength > MAX_SCENE_BYTES || fileBytes.byteLength % SPLAT_BYTES) {
      throw new Error('Invalid SHARP scene data');
    }

    mesh = new SplatMesh({ fileBytes, fileType: SplatFileType.SPLAT, lod: true });
    // SHARP stores OpenCV axes. Three looks down -Z with +Y up.
    mesh.rotation.x = Math.PI;
    // Spark's worker finishes decoding independently of the fetch signal.
    // Wait for it to settle before disposing its decoded resources.
    await mesh.initialized;
    signal.throwIfAborted();
    if (gl.isContextLost()) throw new Error('SHARP WebGL context lost');

    renderer = new WebGLRenderer({ canvas, context: gl, ...webglOptions });
    renderer.setClearColor(0, 0);
    renderer.debug.onShaderError = () => { shaderFailed = true; };
    spark = new SparkRenderer({
      renderer,
      lodSplatCount: software ? 70_000 : 300_000,
      onDirty: () => { if (!disposed && !signal.aborted) invalidate(); },
    });
    scene.add(mesh, spark);
    const near = Math.max(0.0001, Math.min(0.01, intrinsics.depth / 64));
    const far = Math.max(10_000, intrinsics.depth * 2048);
    const camera = new PerspectiveCamera(50, 1, near, far);
    let width = 0, height = 0;
    return {
      sourceWidth: intrinsics.width,
      maxCanvasSide: Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
      draw(frame) {
        if (disposed || gl.isContextLost()) throw new Error('SHARP WebGL context unavailable');
        if (frame.pixelWidth !== width || frame.pixelHeight !== height) {
          width = frame.pixelWidth;
          height = frame.pixelHeight;
          renderer.setSize(width, height, false);
        }
        positionSharpCamera(camera, intrinsics, frame);
        renderer.render(scene, camera);
        if (shaderFailed) throw new Error('SHARP shader compilation failed');
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
