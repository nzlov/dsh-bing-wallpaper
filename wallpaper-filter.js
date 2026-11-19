// Self-contained so the Host can embed the same filters in its startup script.
export function createWallpaperFilters() {
  const options = Object.freeze({
    blur: Object.freeze({ max: 32, initial: 12, unit: 'px' }),
    frosted: Object.freeze({ max: 32, initial: 12, unit: 'px' }),
    blue: Object.freeze({ max: 60, initial: 25, unit: '%' }),
    grayscale: Object.freeze({ max: 100, initial: 100, unit: '%' }),
    dim: Object.freeze({ max: 60, initial: 24, unit: '%' }),
  });
  const modes = Object.freeze(['none', ...Object.keys(options)]);

  function normalize(input) {
    const mode = input?.filterMode;
    const amounts = input?.filterAmounts;
    const filterAmounts = Object.fromEntries(Object.entries(options).map(([key, { max, initial }]) => {
      const amount = amounts != null && Object.hasOwn(amounts, key) ? amounts[key] : undefined;
      return [key, Number.isFinite(amount) ? Math.round(Math.min(max, Math.max(0, amount))) : initial];
    }));
    return { filterMode: modes.includes(mode) ? mode : 'none', filterAmounts };
  }

  function effect(input) {
    const { filterMode, filterAmounts } = normalize(input);
    const amount = filterAmounts[filterMode];
    if (!amount) return null;
    switch (filterMode) {
      case 'blur':
      case 'frosted': return {
        filter: `blur(${amount}px)`, bleed: amount * 3,
        // The frosted preset adds a mist layer; Blur leaves the photo colour alone.
        ...(filterMode === 'frosted' ? { tint: `rgb(255 255 255 / ${Math.round(amount * .75)}%)` } : {}),
      };
      case 'blue': return { tint: `rgb(48 110 246 / ${amount}%)` };
      case 'grayscale': return { filter: `grayscale(${amount}%)` };
      case 'dim': return { filter: `brightness(${100 - amount}%)` };
      default: return null;
    }
  }

  // The caller owns the selector, validated image CSS and readability overlays.
  // Put the filter on the image layer alone; paint the scrim above it, not
  // inside the filter, so its existing contrast bounds still apply.
  function css({ selector, image, overlays, settings, fixed = false }) {
    const look = effect(settings);
    if (!image || !look) return '';
    const position = fixed ? 'fixed' : 'absolute';
    const layers = look.tint ? [...overlays, look.tint] : overlays;
    const backing = fixed ? '' : `${selector}{position:relative;isolation:isolate;overflow:hidden}`;
    return `${backing}${selector}::before{content:"";position:${position};inset:${look.bleed ? `-${look.bleed}px` : '0'};z-index:-2;pointer-events:none;background:${image} center/cover no-repeat;${look.filter ? `filter:${look.filter};` : ''}}${selector}::after{content:"";position:${position};inset:0;z-index:-1;pointer-events:none;background-image:${layers.map(color => `linear-gradient(${color},${color})`).join(',')}}`;
  }

  return { modes, options, normalize, effect, css };
}

export const wallpaperFilters = createWallpaperFilters();
