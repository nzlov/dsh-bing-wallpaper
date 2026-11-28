import { SparkRenderer, SplatFileType, SplatMesh } from '@sparkjsdev/spark';
import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

const SPLAT_BYTES = 32;
const MAX_CAMERA_SHIFT = 0.028;
const webglOptions = {
  alpha: true, depth: false, stencil: false, antialias: false,
  premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'low-power',
};

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
  const scene = new Scene();
  let disposed = false, mesh, renderer, spark, frameFence, shaderFailed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frameFence) gl.deleteSync(frameFence);
    scene.clear();
    mesh?.dispose();
    spark?.dispose();
    renderer?.dispose();
    if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  try {
    const response = await fetchImpl(dataUrl, { credentials: 'same-origin', signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('SHARP scene unavailable');
    }
    const intrinsics = sceneIntrinsics(response.headers);
    const fileBytes = new Uint8Array(await response.arrayBuffer());
    signal.throwIfAborted();
    if (!fileBytes.byteLength || fileBytes.byteLength % SPLAT_BYTES) {
      throw new Error('Invalid SHARP scene data');
    }

    mesh = new SplatMesh({ fileBytes, fileType: SplatFileType.SPLAT, lod: false });
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
      // SHARP's reference renderer uses a zero screen-space low-pass filter.
      blurAmount: 0,
      onDirty: () => { if (!disposed && !signal.aborted) invalidate(); },
    });
    scene.add(mesh, spark);
    const near = Math.max(0.0001, Math.min(0.01, intrinsics.depth / 64));
    const far = Math.max(10_000, intrinsics.depth * 2048);
    const camera = new PerspectiveCamera(50, 1, near, far);
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const device = gl.getParameter(debugInfo?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
    let width = 0, height = 0;
    return {
      // Software rasterizers follow input directly to avoid spending seconds
      // drawing an easing sequence after the pointer has stopped.
      interpolateMotion: !/swiftshader|llvmpipe|softpipe|software (?:rasterizer|renderer)|microsoft basic render/i.test(device),
      sourceWidth: intrinsics.width,
      maxCanvasSide: Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
      draw(frame) {
        if (disposed || gl.isContextLost()) throw new Error('SHARP WebGL context unavailable');
        // Keep at most one full-scene draw queued. A slow GPU can skip
        // intermediate pointer positions and draw the latest one when ready.
        if (frameFence) {
          const result = gl.clientWaitSync(frameFence, 0, 0);
          if (result === gl.TIMEOUT_EXPIRED) return false;
          if (result === gl.WAIT_FAILED) throw new Error('SHARP frame sync failed');
          gl.deleteSync(frameFence);
        }
        if (frame.pixelWidth !== width || frame.pixelHeight !== height) {
          width = frame.pixelWidth;
          height = frame.pixelHeight;
          renderer.setSize(width, height, false);
        }
        positionSharpCamera(camera, intrinsics, frame);
        renderer.render(scene, camera);
        if (shaderFailed) throw new Error('SHARP shader compilation failed');
        frameFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        return true;
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
