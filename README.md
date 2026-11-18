# Bing wallpaper for DSH

[简体中文](README.zh-CN.md) · English

Daily Bing wallpapers, image-derived theme colours, and automatic light/dark appearance for DSH Web. A standalone plugin with no changes to DSH itself.

## Features

- China and international (US) Bing sources, with separate caches and no automatic cross-source fallback.
- Ten colour styles: M3 Content, M3 Tonal Spot, M3 Fruit Salad, M3 Rainbow, M3 Monochrome, Vibrant, Faithful, Soft, Dysfunctional, and Muted.
- Clickable palette cards show light and dark previews separated by a diagonal line.
- Wallpaper visibility from 10% to 100%, with a reading overlay; photos, icons, and semantic status colours are not recoloured.
- Scheduled, system, follow-DSH, or fixed light/dark appearance. The default schedule is 07:00–19:00 in the browser’s local time zone.
- Image title, date, source, and copyright overlaid at the bottom of the photo; refresh icon in the top-right corner.
- Automatic update checks, keeping the previous image on failure; Chinese and English UI.

## Installation

Requires DSH `>=0.2.2-rc.4 <0.3.0`.

In DSH’s plugin manager, install **`@nzlov/dsh-bing-wallpaper`**, or ask the DSH agent to install that npm bundle. The npm package is prebuilt; no manual build is needed. Installation affects all sessions in the current profile.

To install from source (requires Git, Node.js, and npm):

```sh
git clone https://github.com/nzlov/dsh-bing-wallpaper.git
cd dsh-bing-wallpaper
npm ci --ignore-scripts
npm run build
```

Then install this directory in DSH using its absolute path.

Open **Settings → Bing daily wallpaper**. Rebuild after changing source files; follow Plugin Manager’s restart instructions when updating an installed bundle.

## Notes

- No API key or CDN is required. Requests go only to fixed Bing HTTPS endpoints; chat content and browser credentials are not forwarded to Bing.
- Images are cached in memory, not saved as an offline wallpaper library. Update checks use an hourly server cache, so refreshing does not necessarily download a new image. The two regions may show the same photo.
- Plugin controls are saved in the current browser. DSH’s appearance preference is shared across the profile; use scheduling in one primary browser to avoid competing schedules.

## License and credits

Author: [nzlov](https://github.com/nzlov).

- Plugin code and the original SVG icon: [MIT](LICENSE).
- Material Color Utilities: Apache-2.0; see [third-party notices](THIRD_PARTY_NOTICES.md) and the [included license](third-party/material-color-utilities-LICENSE.txt).
- Photographs belong to Bing and the respective photographers. The plugin’s license does not grant rights to redistribute or commercially use those photographs. Follow the copyright link shown on each image.
