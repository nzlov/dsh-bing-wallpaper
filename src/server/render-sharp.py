"""Generate a compressed Gaussian scene with an installed Apple SHARP environment."""

import argparse
import gzip
import math
from pathlib import Path
import struct


def load_source(path):
    from PIL import Image, ImageOps
    from sharp.utils.io import convert_focallength, extract_exif

    with Image.open(path) as source:
        exif = extract_exif(source)
        photo = ImageOps.exif_transpose(source).convert("RGB")

    focal_35mm = float(exif.get("FocalLengthIn35mmFilm") or exif.get("FocalLenIn35mmFilm") or 0)
    if not math.isfinite(focal_35mm) or focal_35mm < 1:
        focal_35mm = float(exif.get("FocalLength") or 30)
        if not math.isfinite(focal_35mm) or focal_35mm <= 0:
            focal_35mm = 30
        if focal_35mm < 10:
            focal_35mm *= 8.4
    return photo, convert_focallength(*photo.size, focal_35mm)


def splat_records(scene):
    import numpy as np
    from sharp.utils.color_space import linearRGB2sRGB

    def to_numpy(value):
        return value[0].detach().cpu().float().numpy()

    means = to_numpy(scene.mean_vectors)
    scales = to_numpy(scene.singular_values)
    quaternions = to_numpy(scene.quaternions)
    colors = to_numpy(linearRGB2sRGB(scene.colors.clamp(0, 1)))
    opacities = to_numpy(scene.opacities).reshape(-1)
    rotation_norms = np.linalg.norm(quaternions, axis=1)
    valid = (
        np.isfinite(means).all(axis=1) & (means[:, 2] > 0)
        & np.isfinite(scales).all(axis=1) & (scales > 0).all(axis=1)
        & np.isfinite(colors).all(axis=1) & np.isfinite(opacities)
        & np.isfinite(rotation_norms) & (rotation_norms > 1e-8)
    )
    # Standard .splat records retain SHARP's OpenCV camera coordinates and WXYZ rotations.
    count = int(valid.sum())
    records = np.empty(count, dtype=[
        ("position", "<f4", (3,)), ("scale", "<f4", (3,)),
        ("rgba", "u1", (4,)), ("rotation", "u1", (4,)),
    ])
    records["position"] = means[valid]
    records["scale"] = scales[valid]
    records["rgba"][:, :3] = np.rint(np.clip(colors[valid], 0, 1) * 255)
    records["rgba"][:, 3] = np.rint(np.clip(opacities[valid], 0, 1) * 255)
    rotations = quaternions[valid] / rotation_norms[valid, None]
    records["rotation"] = np.clip(np.rint(rotations * 128 + 128), 0, 255)

    return records


TILE = 1536
OVERLAP = 384


def tile_axis(length):
    """Each pair of adjacent windows has complementary linear fades."""
    extent = min(length, TILE)
    travel = length - extent
    steps = math.ceil(travel / (TILE - OVERLAP))
    starts = [round(i * travel / steps) for i in range(steps + 1)] if steps else [0]
    fades = []
    for left, right in zip(starts, starts[1:]):
        middle = (left + extent + right) / 2
        half = min(left + extent - right, right - left) / 2
        fades.append((middle - half, 2 * half))
    return [(s, extent, before, after) for s, before, after in
            zip(starts, [None, *fades], [*fades, None])]


def axis_weight(pixel, length, axis):
    start, extent, before, after = axis
    # Leave the outer fringe to the global prediction for disocclusion.
    weight = (pixel / 100).clamp(0, 1) * ((length - pixel) / 100).clamp(0, 1)
    if before:
        weight *= ((pixel - before[0]) / before[1]).clamp(0, 1)
    if after:
        weight *= ((after[0] + after[1] - pixel) / after[1]).clamp(0, 1)
    return weight


def project(scene, size, focal):
    x, y, z = scene.mean_vectors[0].T
    return x / z * focal + size[0] / 2, y / z * focal + size[1] / 2


def depth_grid(scene, pixels, size):
    """Nearest visible Gaussian in each 8-pixel cell, in full-image coordinates."""
    import numpy as np

    u, v = pixels
    z = scene.mean_vectors[0, :, 2]
    w, h = size
    visible = ((scene.opacities[0] > 0.25) & (z > 0) & z.isfinite()
               & (u >= 0) & (u < w) & (v >= 0) & (v < h))
    cols = math.ceil(w / 8)
    grid = np.full((math.ceil(h / 8), cols), np.inf, dtype=np.float32)
    indices = (v[visible].long() // 8) * cols + u[visible].long() // 8
    np.minimum.at(grid.ravel(), indices.cpu().numpy(), z[visible].cpu().numpy())
    return grid


def predict_tile(predictor, photo, focal, size, x_axis, y_axis, device):
    import torch
    from sharp.utils.gaussians import unproject_gaussians

    x, w = x_axis[:2]
    y, h = y_axis[:2]
    crop = torch.from_numpy(photo[y:y+h, x:x+w].copy()).to(device)
    image = crop.permute(2, 0, 1)[None].float() / 255
    if (w, h) != (TILE, TILE):
        image = torch.nn.functional.interpolate(image, (TILE, TILE), mode="bilinear", align_corners=True)
    ndc = predictor(image, image.new_tensor([focal / w]))
    identity = torch.eye(4, device=device)
    intrinsics = identity.clone()
    intrinsics[0, 0] = focal * TILE / w
    intrinsics[1, 1] = focal * TILE / h
    intrinsics[0, 2] = (size[0] / 2 - x) * TILE / w
    intrinsics[1, 2] = (size[1] / 2 - y) * TILE / h
    return unproject_gaussians(ndc, identity, intrinsics, (TILE, TILE))


def weighted_scene(scene, weight):
    keep = weight > 0.0001
    part = type(scene)(*(field[:, keep] for field in scene))
    # Blend optical thickness so two coincident predictions retain their density.
    alpha = 1 - (1 - part.opacities.clamp(0, 1)).pow(weight[keep])
    return part._replace(opacities=alpha)


def scene_parts(predictor, photo, focal, base, device):
    import numpy as np
    import torch

    h, w = photo.shape[:2]
    if max(w, h) <= TILE:
        yield base
        return

    size = (w, h)
    base_pixels = project(base, size, focal)
    base_depth = depth_grid(base, base_pixels, size)
    remaining = torch.ones_like(base.opacities[0])
    for ya in tile_axis(h):
        for xa in tile_axis(w):
            tile = predict_tile(predictor, photo, focal, size, xa, ya, device)
            pixels = project(tile, size, focal)
            tile_depth = depth_grid(tile, pixels, size)
            # Compare corresponding interior cells; reject sparse overlap and
            # leave the global prediction intact where a tile cannot be aligned.
            margin = min(100, xa[1] // 8, ya[1] // 8)
            interior = (slice((ya[0]+margin)//8, math.ceil((ya[0]+ya[1]-margin)/8)),
                        slice((xa[0]+margin)//8, math.ceil((xa[0]+xa[1]-margin)/8)))
            a, b = base_depth[interior], tile_depth[interior]
            valid = np.isfinite(a) & np.isfinite(b)
            if valid.sum() < 16:
                continue
            scale = float(np.median(a[valid] / b[valid]))
            if not math.isfinite(scale) or scale <= 0:
                continue
            tile = tile._replace(mean_vectors=tile.mean_vectors * scale, singular_values=tile.singular_values * scale)
            weight = axis_weight(pixels[0], w, xa) * axis_weight(pixels[1], h, ya)
            yield weighted_scene(tile, weight)
            remaining -= axis_weight(base_pixels[0], w, xa) * axis_weight(base_pixels[1], h, ya)
    yield weighted_scene(base, remaining.clamp(0, 1))


def write_scene(parts, size, focal, near_depth, output):
    # Stream tiles into one gzip member, then fill in the total record count.
    header = struct.Struct("<4sIIddI")
    count = 0
    with output.open("wb") as handle:
        handle.write(bytes(header.size))
        with gzip.GzipFile(filename="", fileobj=handle, mode="wb", compresslevel=4, mtime=0) as compressed:
            for part in parts:
                records = splat_records(part)
                if len(records):
                    compressed.write(memoryview(records).cast("B"))
                    count += len(records)
        if not count:
            raise ValueError("SHARP did not predict any visible scene points")
        handle.seek(0)
        handle.write(header.pack(b"BDS1", *size, focal, near_depth, count))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("checkpoint", type=Path)
    args = parser.parse_args()

    import numpy as np
    import torch
    from sharp.cli.predict import predict_image
    from sharp.models import PredictorParams, create_predictor

    device = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    photo, focal = load_source(args.input)

    with torch.no_grad():
        predictor = create_predictor(PredictorParams())
        predictor.load_state_dict(torch.load(args.checkpoint, map_location="cpu", weights_only=True))
        predictor.eval().to(device)
        pixels = np.array(photo)
        base = predict_image(predictor, pixels, focal, device)
        z = base.mean_vectors[0, :, 2]
        foreground = z[(base.opacities[0] > 0.02) & z.isfinite() & (z > 0)]
        if not foreground.numel():
            raise ValueError("SHARP did not predict any visible scene points")
        near_depth = float(np.quantile(foreground.cpu().numpy(), 0.1))
        write_scene(scene_parts(predictor, pixels, focal, base, device), photo.size, focal, near_depth, args.output)


if __name__ == "__main__":
    main()
