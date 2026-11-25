# Third-party notices

The prebuilt browser artifact includes **Material Color Utilities 0.3.0**
(`@material/material-color-utilities`), copyright 2021–2024 Google LLC and
contributors, licensed under the Apache License, Version 2.0.

Source: https://github.com/material-foundation/material-color-utilities

The utility implementation is bundled without source changes; the plugin maps
its palettes to DSH theme roles and applies additional contrast adjustments.

The full Apache-2.0 license is included in
`third-party/material-color-utilities-LICENSE.txt`. Copyright and license notices
are also retained in the generated JavaScript artifact.

The image resampling, M3 quantization/scoring, custom palette generation,
Pure Black Dark surface transform, and UI role mappings adapt ideas and
algorithms from **Noctalia**, copyright 2026 noctalia-dev, licensed under the
MIT License.
Source: https://github.com/noctalia-dev/noctalia (initial port based on
revision `0e32beeeb3d3fedb6d1da720abcfe6fe4f4fad75`, with subsequent updates
from upstream `image_loader.cpp`, `m3_schemes.cpp`, `palette_transform.cpp`,
`fixed_palette.cpp`, and built-in templates).
The full license is included in `third-party/noctalia-LICENSE.txt`. Browser
decoding, accessibility adaptation, and DSH integration can differ from Noctalia.

The browser artifact includes Three.js 0.187.0 by the Three.js Authors, distributed under the MIT license in `third-party/three-LICENSE.txt`.

esbuild is a development-only build tool and is not part of the browser runtime.
Bing photographs remain owned by their respective rights holders.
