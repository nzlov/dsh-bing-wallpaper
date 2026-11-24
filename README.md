# Bing wallpaper for DSH

[简体中文](README.zh-CN.md) · English

Daily Bing wallpapers, image-derived theme colours, and automatic light/dark appearance for DSH Web. A standalone plugin with no changes to DSH itself.

![Bing daily wallpaper settings in DSH Web, showing the wallpaper preview, source selection, and image-derived colour styles (Chinese UI)](<assets/settings-preview.png>)

## Features

- China and international (US) Bing sources, with selectable 1080p, 2K (2560×1440) and 4K UHD (3840×2160) resolutions, separate caches and no automatic cross-source fallback.
- Ten colour styles: M3 Content, M3 Tonal Spot, M3 Fruit Salad, M3 Rainbow, M3 Monochrome, Vibrant, Faithful, Soft, Dysfunctional, and Muted.
- M3 styles use a ranked image seed; the five custom styles cluster multiple image colours and select candidates by style. Their colour generation is adapted from Noctalia, with browser sampling, candidate selection, and DSH readability adjustments, so results are not pixel-identical.
- Clickable palette cards show light and dark previews separated by a diagonal line.
- Linear wallpaper visibility from 10% to 100%, without a fixed reading overlay. Icons and semantic status colours are not recoloured.
- Optional blur, frosted glass (blur with a mist layer), blue tint, grayscale, and dimming filters, each with its own strength. Filters update the background live; the settings preview and theme extraction use the original image.
- Optional 3D depth parallax powered by WebGL (with Catmull-Rom bicubic upscaling, WebGL2 trilinear mipmaps, and smoothed depth warping), shared across the main wallpaper and wallpaper-backed sidebars via a single `0–100%` intensity slider (`0` = off). Stays zero-dependency by default; the slider activates once `@huggingface/transformers` is installed in the DSH profile and pauses under reduced motion.
- Main pages, sidebars and the startup screen use dedicated wallpaper filter layers over a solid-colour fallback. Page content, document images and charts are not filtered.
- Independent left/right sidebar backgrounds: wallpaper or solid theme colour, wallpaper visibility and filters that follow the main background or can be customized, and an option to match the toolbar background. Sidebar settings start collapsed when visibility follows the main background. Wallpaper shares viewport coordinates with the centre through resizing, splits and drawer animations. Both solid mode and the optional theme-colour overlay use the sidebar colour shown in the palette cards; the overlay remains independent of wallpaper visibility. Desktop and mobile share the same settings.
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

### Optional 3D depth parallax

Depth parallax is optional so the plugin stays dependency-free by default. To enable it, install `@huggingface/transformers` in your DSH profile and restart DSH:

```sh
dsh plugin --profile web add @huggingface/transformers
```

Once installed, the **Depth parallax** slider (`0–100%`, `0` = off) becomes enabled in settings, and the quantized depth model is downloaded once on demand and cached locally under `~/.cache/dsh-bing-wallpaper`. Without this package, no model is downloaded and the slider stays disabled with a note.

## Weather effects

In **Settings → Bing daily wallpaper**, open **Weather selection**. Choose **Off**, **Follow location**, or a scene such as **Cloudy** or **Heavy rain**. Selecting a scene applies it immediately. Follow location lets you enter a city or coordinates, or use your current location. Select a provider and click **Apply and check weather** to see the resolved location and condition.

One Three.js renderer draws every weather effect. Clouds and fog drift with the wind. An `InstancedMesh` draws the rain or snow in a batch. Light, moderate and heavy precipitation use different particle densities. Each intensity includes a mix of sizes, with larger drops and flakes falling faster. Raindrops splash on the glass, refract the current wallpaper and slide down, leaving a fading trail. Snowflakes briefly stick and melt, and frost forms along the edges. Rain can produce forked lightning, with a higher chance in heavier rain.

The main wallpaper and wallpaper-backed sidebars share the rendered frame. Wallpaper visibility adjusts only the photo beneath the weather. Settings show the original photo. Weather requires WebGL2. If the browser cannot create a context, the wallpaper remains visible. With hardware acceleration, animated weather adjusts its resolution and frame rate to measured drawing cost. Recognized software renderers use a smaller drawing buffer and fewer frames per second. Rendering pauses in background tabs, and reduced motion freezes the scene.

Set **Facing direction** to East, West, South or North (South by default). The window follows the active DSH appearance. Clear skies use the same fan of light shafts in both modes. The warm rays turn cooler, dimmer and slower in dark mode, and moonlight enters along a lower arc. The position depends on the computer’s local time and the window direction. In scheduled mode, the moonlight travels west from the configured start of dark mode until light mode begins. Passing clouds can shade either light source.

In Follow location mode, set **Update interval (minutes)** and click **Apply and check weather**. The browser sends the location directly to the selected provider and refreshes at that interval after a successful lookup. The default is 30 minutes and the minimum is 1 minute. Built-in providers are [Open-Meteo](https://open-meteo.com/) and [wttr.in](https://github.com/chubin/wttr.in). Open-Meteo uses its geocoding service for city names. Only Follow location makes weather requests. The reported wind speed and direction determine how rain, snow, clouds, fog and water on the glass move relative to the selected facing direction. Fixed scenes use baseline motion. A custom response with speed alone keeps the default leftward wind.

For a custom provider, enter an HTTPS endpoint that supports browser cross-origin requests (CORS). The browser sends a GET request with a `location` parameter, for example `?location=Shanghai`. Return JSON such as `{"current":{"weather_code":61,"wind_speed_10m":18,"wind_direction_10m":90}}` using a [WMO weather code](https://open-meteo.com/en/docs#weather_variable_documentation). For the optional wind fields, use km/h for `wind_speed_10m` and the direction the wind comes from in degrees clockwise from north for `wind_direction_10m` (90° is an east wind).

## Notes

- No API key or CDN is required. Wallpaper requests go only to fixed Bing HTTPS endpoints; chat content and browser credentials are not forwarded to Bing.
- Images are cached in memory, not saved as an offline wallpaper library. Update checks use an hourly server cache, so refreshing does not necessarily download a new image. The two regions may show the same photo.
- Plugin controls are saved in the current browser. DSH’s appearance preference is shared across the profile; use scheduling in one primary browser to avoid competing schedules.

## License and credits

Author: [nzlov](https://github.com/nzlov).

- Plugin code and the original SVG icon: [MIT](LICENSE).
- Material Color Utilities: Apache-2.0; see [third-party notices](THIRD_PARTY_NOTICES.md) and the [included license](third-party/material-color-utilities-LICENSE.txt).
- Photographs belong to Bing and the respective photographers. The plugin’s license does not grant rights to redistribute or commercially use those photographs. Follow the copyright link shown on each image.
