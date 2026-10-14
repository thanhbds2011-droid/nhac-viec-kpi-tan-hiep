'use strict';

(function () {
  const cfg = window.YTE_APP_CONFIG || {};
  const currentVersion = String(cfg.VERSION || '10.0.19');
  const CHECK_INTERVAL_MS = 60000;
  const DEFER_RETRY_MS = 4000;
  const UPDATE_CONTEXT_KEY = 'yte-update-context';
  let registration = null;
  let reloadOnControllerChange = false;
  let latestRelease = null;
  let checkTimer = null;
  let checking = false;
  let deferredTimer = null;
  let autoApplyInFlight = false;

  function compareVersions(a, b) {
    const pa = String(a || '').split('.').map((n) => Number(n) || 0);
    const pb = String(b || '').split('.').map((n) => Number(n) || 0);
    const length = Math.max(pa.length, pb.length);
    for (let i = 0; i < length; i += 1) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da > db) return 1;
      if (da < db) return -1;
    }
    return 0;
  }

  function ensureBanner() {
    let banner = document.getElementById('appUpdateBanner');
    if (banner) return banner;
    banner = document.createElement('section');
    banner.id = 'appUpdateBanner';
    banner.className = 'app-update-banner';
    banner.hidden = true;
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = `
      <div class="app-update-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/></svg></div>
      <div class="app-update-copy">
        <strong id="appUpdateTitle">Đang chuẩn bị bản cập nhật</strong>
        <span id="appUpdateMessage">Ứng dụng sẽ tự cập nhật khi an toàn.</span>
      </div>
      <div class="app-update-actions">
        <button id="appUpdateNow" class="btn btn-primary app-update-now" type="button">Cập nhật ngay</button>
      </div>`;
    document.body.appendChild(banner);
    banner.querySelector('#appUpdateNow').addEventListener('click', () => applyUpdate({ userInitiated: true }));
    return banner;
  }

  function showBanner(release, message, buttonText, disabled) {
    const version = String(release?.version || 'mới');
    latestRelease = release || { version };
    const banner = ensureBanner();
    banner.dataset.version = version;
    banner.querySelector('#appUpdateTitle').textContent = `Có phiên bản mới v${version}`;
    banner.querySelector('#appUpdateMessage').textContent = String(message || release?.message || 'Ứng dụng sẽ tự cập nhật trong giây lát.');
    const button = banner.querySelector('#appUpdateNow');
    button.disabled = disabled === true;
    button.textContent = buttonText || 'Cập nhật ngay';
    banner.hidden = false;
  }

  function hideBanner() {
    const banner = document.getElementById('appUpdateBanner');
    if (banner) banner.hidden = true;
  }

  async function fetchReleaseInfo() {
    try {
      const response = await fetch(`./version.json?t=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) return null;
      const info = await response.json();
      if (!info || !info.version) return null;
      return info;
    } catch (_) { return null; }
  }

  function hasUnsavedChanges() {
    const guards = [
      window.YTE_APP_UI && window.YTE_APP_UI.hasUnsavedChanges,
      window.YTE_REPORTS && window.YTE_REPORTS.hasUnsavedChanges,
      window.YTE_JOURNEYS && window.YTE_JOURNEYS.hasUnsavedChanges
    ];
    return guards.some((guard) => {
      try { return typeof guard === 'function' && guard(); }
      catch (_) { return false; }
    });
  }

  function captureUpdateContext() {
    try {
      const appContext = window.YTE_APP_UI && typeof window.YTE_APP_UI.captureUpdateContext === 'function'
        ? window.YTE_APP_UI.captureUpdateContext()
        : null;
      const journeyContext = window.YTE_JOURNEYS && typeof window.YTE_JOURNEYS.captureUpdateContext === 'function'
        ? window.YTE_JOURNEYS.captureUpdateContext()
        : null;
      sessionStorage.setItem(UPDATE_CONTEXT_KEY, JSON.stringify({
        savedAt: Date.now(),
        fromVersion: currentVersion,
        app: appContext,
        journeys: journeyContext
      }));
    } catch (_) {}
  }

  function scheduleDeferredUpdate(release) {
    latestRelease = release || latestRelease;
    showBanner(latestRelease || { version: 'mới' }, 'Bạn đang có nội dung chưa lưu. Ứng dụng sẽ tự cập nhật ngay sau khi lưu hoặc đóng biểu mẫu.', 'Đang chờ lưu dữ liệu', true);
    clearTimeout(deferredTimer);
    deferredTimer = setTimeout(async () => {
      if (hasUnsavedChanges()) {
        scheduleDeferredUpdate(latestRelease);
        return;
      }
      await applyUpdate({ automatic: true });
    }, DEFER_RETRY_MS);
  }

  function inspectRegistration(reg) {
    if (!reg) return;
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) requestAutomaticApply(latestRelease || { version: 'mới' });
    if (reg.installing) watchInstalling(reg.installing);
    reg.addEventListener('updatefound', () => {
      if (reg.installing) watchInstalling(reg.installing);
    });
  }

  function watchInstalling(worker) {
    if (!worker || worker.__yteWatched) return;
    worker.__yteWatched = true;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        requestAutomaticApply(latestRelease || { version: 'mới' });
      }
    });
  }

  function requestAutomaticApply(release) {
    latestRelease = release || latestRelease;
    if (hasUnsavedChanges()) {
      scheduleDeferredUpdate(latestRelease);
      return;
    }
    showBanner(latestRelease || { version: 'mới' }, 'Bản cập nhật đã sẵn sàng và sẽ được áp dụng tự động.', 'Đang cập nhật…', true);
    window.setTimeout(() => applyUpdate({ automatic: true }), 350);
  }

  async function checkForUpdate() {
    if (checking) return;
    checking = true;
    try {
      const release = await fetchReleaseInfo();
      if (release) latestRelease = release;
      if (registration) {
        try { await registration.update(); } catch (_) {}
      }
      if (registration?.waiting && navigator.serviceWorker.controller) {
        requestAutomaticApply(release || latestRelease || { version: 'mới' });
        return;
      }
      if (release && compareVersions(release.version, currentVersion) > 0) {
        showBanner(release, 'Đã phát hiện phiên bản mới. Ứng dụng đang tải bản cập nhật và sẽ tự áp dụng khi an toàn.', 'Đang chuẩn bị…', true);
        if (hasUnsavedChanges()) scheduleDeferredUpdate(release);
      } else if (release && compareVersions(release.version, currentVersion) <= 0 && !registration?.waiting) {
        hideBanner();
      }
    } finally {
      checking = false;
    }
  }

  async function applyUpdate(options) {
    if (autoApplyInFlight) return;
    if (hasUnsavedChanges()) {
      scheduleDeferredUpdate(latestRelease);
      return;
    }
    autoApplyInFlight = true;
    clearTimeout(deferredTimer);
    captureUpdateContext();
    showBanner(latestRelease || { version: 'mới' }, 'Đang chuyển sang phiên bản mới. Vị trí làm việc hiện tại sẽ được khôi phục sau khi cập nhật.', 'Đang cập nhật…', true);
    try {
      if (registration) await registration.update().catch(() => {});
      if (registration?.waiting) {
        reloadOnControllerChange = true;
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && !registration?.waiting) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (registration?.waiting) {
        reloadOnControllerChange = true;
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
      // Fallback: navigation của service worker luôn network-first nên lần tải này nhận index mới.
      location.reload();
    } catch (_) {
      autoApplyInFlight = false;
      showBanner(latestRelease || { version: 'mới' }, 'Chưa thể hoàn tất cập nhật. Ứng dụng sẽ tự thử lại khi có kết nối ổn định.', 'Thử cập nhật', false);
      clearTimeout(deferredTimer);
      deferredTimer = setTimeout(checkForUpdate, DEFER_RETRY_MS);
    }
  }

  async function start() {
    if (!('serviceWorker' in navigator)) return;
    if (!(location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) return;
    try {
      registration = await navigator.serviceWorker.register('./service-worker.js', {
        scope: './',
        updateViaCache: 'none'
      });
      inspectRegistration(registration);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloadOnControllerChange) return;
        reloadOnControllerChange = false;
        location.reload();
      });
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data.type === 'YTE_SW_VERSION' && data.version && compareVersions(data.version, currentVersion) > 0) {
          requestAutomaticApply({ version: data.version, message: data.message || '' });
        }
      });
      await checkForUpdate();
      clearInterval(checkTimer);
      checkTimer = setInterval(() => {
        if (!document.hidden && navigator.onLine !== false) checkForUpdate();
      }, CHECK_INTERVAL_MS);
      window.addEventListener('focus', checkForUpdate);
      window.addEventListener('online', checkForUpdate);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkForUpdate();
      });
    } catch (error) {
      console.warn('Không khởi tạo được cơ chế cập nhật ứng dụng:', error);
    }
  }

  window.YTE_UPDATE_MANAGER = Object.freeze({
    check: checkForUpdate,
    apply: () => applyUpdate({ userInitiated: true }),
    currentVersion
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}());
