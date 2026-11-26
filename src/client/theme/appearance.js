// Service-only controller. Never touches the DOM or stores DSH settings directly.
export function createAppearanceController(theme, onExternalChange, scheduledScheme) {
  let original = theme.getTheme().preference, applied = '', writing = false;
  function restore() {
    if (applied && theme.getTheme().preference === applied) {
      writing = true;
      try { theme.setTheme(original); } finally { writing = false; }
    }
    applied = '';
  }
  return {
    restore,
    sync(settings, date = new Date()) {
      if (!settings.enabled || settings.mode === 'follow') { restore(); return; }
      const target = settings.mode === 'schedule' ? scheduledScheme(date, settings.day, settings.night) : settings.mode;
      if (!target) return;
      // Sample at each new takeover, not at plugin startup: a later user choice wins.
      if (!applied) original = theme.getTheme().preference;
      writing = true;
      try {
        if (theme.getTheme().preference !== target) theme.setTheme(target);
        applied = target;
      } finally { writing = false; }
    },
    changed(snapshot) {
      if (!writing && applied && snapshot.preference !== applied) {
        applied = '';
        onExternalChange();
      }
    },
  };
}
