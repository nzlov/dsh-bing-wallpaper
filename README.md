# Bing wallpaper for DSH

[简体中文](README.zh-CN.md) · English

Daily Bing wallpapers, image-derived theme colours, and automatic light/dark appearance for DSH Web.

![Bing daily wallpaper settings in DSH Web, showing the wallpaper preview, source selection, and image-derived colour styles (Chinese UI)](<assets/settings-preview.png>)

## Features

- Daily Bing wallpapers from China or the US in 1080p, 2K, or 4K. Wallpapers refresh automatically or on demand and include the photo title, date, and credits.
- Wallpaper colours carry through to the interface, syntax highlighting, and diffs. Choose from ten palette styles with light and dark previews, high-contrast text, and a pure black dark mode.
- Light and dark appearance can follow the system, DSH, or a schedule, or stay fixed.
- Adjust wallpaper visibility and apply blur, frosted glass, blue tint, grayscale, or dimming. Each sidebar can use the wallpaper or a solid theme colour, with its own visibility, filter, and tint.
- Depth-map and SHARP 3D parallax work across the main wallpaper and sidebars, with adjustable strength and support for reduced motion.
- Weather scenes can follow local conditions or be selected manually, with sunlight, moonlight, clouds, fog, rain, snow, and lightning.
- Share default settings across devices or customise each device separately. The interface is available in Chinese and English.

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

Open **Settings → Bing daily wallpaper**. Plugin source lives in `src/`. Rebuild to update `dist/client.js`. When updating an installed bundle, follow Plugin Manager’s restart instructions.

### Optional parallax modes

Choose a mode in **Settings → Bing daily wallpaper → Parallax mode**. **Depth map (Depth Anything)** shifts pixels from the photo according to their depth. **3D scene (SHARP)** can reveal details the model predicts behind foreground objects as the viewpoint moves. The settings preview displays the original photo.

For **Depth map**, install `@huggingface/transformers` in your DSH profile and restart DSH.

```sh
dsh plugin --profile web add @huggingface/transformers
```

For **3D scene (SHARP)**, install the Python environment and checkpoint on the DSH server, then restart DSH. Follow the [SHARP manual installation guide](docs/sharp-install.md) for the commands and paths.

The server downloads the Depth Anything model on demand. It keeps the original photos and extracted palettes in memory and caches depth maps and compressed SHARP scenes in the `depth` and `scenes` directories under `${XDG_CACHE_HOME:-$HOME/.cache}/dsh-bing-wallpaper`.

The browser loads the depth map or SHARP scene for the current wallpaper and renders pointer movement in real time with WebGL. SHARP uses WebGL2 and loads its rendering code when selected. The original photo remains visible while model data is prepared, when reduced motion is enabled, or when rendering is unavailable.

## Weather effects

In **Settings → Bing daily wallpaper**, open **Weather selection**. Choose **Off**, **Follow location**, or a scene such as **Cloudy** or **Heavy rain**. Selecting a scene applies it immediately. Follow location lets you enter a city or coordinates, or use your current location. Select a provider and click **Apply and check weather** to see the resolved location and condition.

Weather appears across the main wallpaper and wallpaper-backed sidebars. Raindrops splash and slide down the glass, and snowflakes settle and melt. Reduced motion keeps the scene still.

Set **Facing direction** to East, West, South, or North. Light mode shows sunlight and dark mode shows moonlight, with lighting that follows local time and the selected direction.

In Follow location mode, set **Update interval (minutes)** and click **Apply and check weather**. The browser sends the location directly to the selected provider and refreshes at that interval after a successful lookup. The default is 30 minutes and the minimum is 1 minute. Built-in providers are [Open-Meteo](https://open-meteo.com/) and [wttr.in](https://github.com/chubin/wttr.in). Open-Meteo uses its geocoding service for city names. Only Follow location makes weather requests. The reported wind speed and direction determine how rain, snow, clouds, fog and water on the glass move relative to the selected facing direction. Fixed scenes use baseline motion. A custom response with speed alone keeps the default leftward wind.

For a custom provider, enter an HTTPS endpoint that supports browser cross-origin requests (CORS). The browser sends a GET request with a `location` parameter, for example `?location=Shanghai`. Return JSON such as `{"current":{"weather_code":61,"wind_speed_10m":18,"wind_direction_10m":90}}` using a [WMO weather code](https://open-meteo.com/en/docs#weather_variable_documentation). For the optional wind fields, use km/h for `wind_speed_10m` and the direction the wind comes from in degrees clockwise from north for `wind_direction_10m` (90° is an east wind).

## Notes

- No API key or CDN is required. Wallpaper requests go only to fixed Bing HTTPS endpoints; chat content and browser credentials are not forwarded to Bing.
- The server caches original Bing images in memory and checks for new images hourly. Refreshing may reuse the previous image. The two regions may show the same photo.
- New devices load the current profile’s default settings. Select **Save as default** to store the current settings (including weather location and custom endpoint) on the server. Subsequent edits apply only to the current browser. Select **Use default settings** to replace local settings and follow the profile again. Existing browser preferences are preserved on upgrade.
- DSH’s appearance preference is shared across the profile; use scheduling in one primary browser to avoid competing schedules.

## License and credits

Author: [nzlov](https://github.com/nzlov).

- Plugin code and the original SVG icon: [MIT](LICENSE).
- Material Color Utilities: Apache-2.0; see [third-party notices](third-party/NOTICES.md) and the [included license](third-party/material-color-utilities-LICENSE.txt).
- Photographs belong to Bing and the respective photographers. The plugin’s license does not grant rights to redistribute or commercially use those photographs. Follow the copyright link shown on each image.
