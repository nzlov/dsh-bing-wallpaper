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


def write_scene(scene, photo_size, focal, output):
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
    foreground = means[valid & (opacities > 0.02), 2]
    if not foreground.size:
        raise ValueError("SHARP did not predict any visible scene points")
    near_depth = float(np.quantile(foreground, 0.1))

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

    with output.open("wb") as handle:
        handle.write(struct.pack("<4sIIddI", b"BDS1", *photo_size, focal, near_depth, count))
        with gzip.GzipFile(filename="", fileobj=handle, mode="wb", compresslevel=4, mtime=0) as compressed:
            compressed.write(memoryview(records).cast("B"))


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
        scene = predict_image(predictor, np.array(photo), focal, device)
        del predictor
        write_scene(scene, photo.size, focal, args.output)


if __name__ == "__main__":
    main()
