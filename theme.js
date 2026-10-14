(function () {
  'use strict';

  var ROOT = document.documentElement;
  var EYE_KEY = 'YTE_UI_EYE_COMFORT_V1';
  var DARK_KEY = 'YTE_UI_DARK_MODE_V1';

  function readFlag(key) {
    try { return localStorage.getItem(key) === '1'; } catch (_) { return false; }
  }

  function writeFlag(key, value) {
    try { localStorage.setItem(key, value ? '1' : '0'); } catch (_) {}
  }

  var state = {
    eye: readFlag(EYE_KEY),
    dark: readFlag(DARK_KEY)
  };

  function syncButton(button, active, onLabel, offLabel) {
    if (!button) return;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-label', active ? onLabel : offLabel);
    button.setAttribute('title', active ? onLabel : offLabel);
  }

  function applyTheme(notify) {
    ROOT.classList.toggle('theme-eye-comfort', !!state.eye);
    ROOT.classList.toggle('theme-dark', !!state.dark);
    ROOT.style.colorScheme = state.dark ? 'dark' : 'light';

    syncButton(document.getElementById('btnEyeComfort'), state.eye, 'Tắt bảo vệ mắt', 'Bảo vệ mắt');
    syncButton(document.getElementById('btnDarkMode'), state.dark, 'Tắt chế độ tối', 'Chế độ tối');

    if (notify) {
      try {
        window.dispatchEvent(new CustomEvent('yte:theme-change', {
          detail: { eye: !!state.eye, dark: !!state.dark }
        }));
      } catch (_) {}
    }
  }

  function bindThemeControls() {
    var eyeButton = document.getElementById('btnEyeComfort');
    var darkButton = document.getElementById('btnDarkMode');

    if (eyeButton) {
      eyeButton.addEventListener('click', function () {
        state.eye = !state.eye;
        writeFlag(EYE_KEY, state.eye);
        applyTheme(true);
      });
    }

    if (darkButton) {
      darkButton.addEventListener('click', function () {
        state.dark = !state.dark;
        writeFlag(DARK_KEY, state.dark);
        applyTheme(true);
      });
    }

    applyTheme(false);
  }

  window.YTE_THEME = Object.freeze({
    getState: function () { return { eye: !!state.eye, dark: !!state.dark }; },
    apply: function () { applyTheme(true); }
  });

  // Apply the persisted theme before the body is painted to minimize flashing.
  applyTheme(false);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindThemeControls, { once: true });
  } else {
    bindThemeControls();
  }
}());
