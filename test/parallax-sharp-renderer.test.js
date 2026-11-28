import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { createSharpParallaxRenderer, positionSharpCamera } from '../src/client/wallpaper/parallax-sharp-renderer.js';

const intrinsics = { width: 1920, height: 1080, focal: 1540, depth: 3 };
const frame = {
  geometry: { x: -360, y: 0, width: 1280, height: 720 },
  renderWidth: 616, renderHeight: 776, bleed: 28,
  offset: { x: 0, y: 0 }, strength: 1,
};

function project(camera, { renderWidth, renderHeight }, { u, v, depth }) {
  camera.updateMatrixWorld();
  const point = new Vector3(
    (u - intrinsics.width / 2) * depth / intrinsics.focal,
    (intrinsics.height / 2 - v) * depth / intrinsics.focal,
    -depth,
  ).project(camera);
  return [(point.x + 1) * renderWidth / 2, (1 - point.y) * renderHeight / 2];
}

test('neutral SHARP projection follows the original wallpaper cover crop and filter margin', () => {
  const camera = new PerspectiveCamera();
  for (const geometry of [frame.geometry, { x: -420, y: 0, width: 1820, height: 1023.75 }]) {
    const layout = { ...frame, geometry };
    positionSharpCamera(camera, intrinsics, layout);
    for (const [u, v] of [[0, 0], [960, 540], [1300, 850], [1920, 1080]]) {
      const projected = project(camera, layout, { u, v, depth: 8 });
      assert.ok(Math.abs(projected[0] - (geometry.x + frame.bleed + u * geometry.width / intrinsics.width)) < 1e-8);
      assert.ok(Math.abs(projected[1] - (geometry.y + frame.bleed + v * geometry.height / intrinsics.height)) < 1e-8);
    }
  }
});

test('camera translation produces continuous, depth-dependent, signed parallax', () => {
  const camera = new PerspectiveCamera();
  const layout = { ...frame, offset: { x: 0.31, y: -0.58 } };
  const near = { u: 960, v: 540, depth: 3 };
  const far = { ...near, depth: 12 };
  positionSharpCamera(camera, intrinsics, { ...layout, strength: 0 });
  const center = project(camera, layout, near);
  positionSharpCamera(camera, intrinsics, layout);
  const foreground = project(camera, layout, near);
  const background = project(camera, layout, far);
  assert.ok(foreground[0] < background[0] && background[0] < center[0]);
  assert.ok(foreground[1] > background[1] && background[1] > center[1]);
  positionSharpCamera(camera, intrinsics, { ...layout, strength: 0.5 });
  const half = project(camera, layout, near);
  for (const axis of [0, 1]) assert.ok(Math.abs(half[axis] - (center[axis] + foreground[axis]) / 2) < 1e-8);
});

test('SHARP renderer checks WebGL2 before requesting a scene', async () => {
  await assert.rejects(createSharpParallaxRenderer({
    canvas: { getContext: () => null }, signal: new AbortController().signal,
    fetchImpl: () => assert.fail('unsupported renderer should not fetch a scene'),
  }), /requires WebGL2/);
});
