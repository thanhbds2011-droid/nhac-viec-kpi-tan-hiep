/*
 * OneSignal Web Push + Notification Center
 * Runtime 9.9.0
 *
 * - One source supports two GitHub Pages origins using separate OneSignal App IDs.
 * - OneSignal worker uses a dedicated sub-scope so it does not replace the PWA worker.
 * - Firebase UID is used as OneSignal External ID only after application access is granted.
 * - No OneSignal API key/private secret is stored in this frontend.
 */
(function () {
  'use strict';

  const cfg = window.YTE_APP_CONFIG || {};
  const hostMap = (cfg.ONESIGNAL && cfg.ONESIGNAL.HOSTS) || {};
  const host = String(window.location.hostname || '').toLowerCase();
  const appId = String(hostMap[host] || '');
  const supportedHost = !!appId;
  const gatewayUrl = String(cfg.NOTIFICATION_GATEWAY_URL || '').trim();
  const MAX_HISTORY = 60;
  const ROUTE_KEY = 'YTE_OS_PENDING_ROUTE';
  const ROUTE_DATA_KEY = 'YTE_OS_PENDING_ROUTE_DATA';

  let sdk = null;
  let initPromise = null;
  let currentIdentity = null;
  let eventsBound = false;

  function byId(id) { return document.getElementById(id); }
  function safeText(value) { return String(value == null ? '' : value); }
  function nowIso() { return new Date().toISOString(); }
  function appBaseUrl() { return new URL('./', document.baseURI).href; }
  function basePath() { return new URL('./', document.baseURI).pathname; }
  function workerPath() { return (basePath() + 'push/onesignal/OneSignalSDKWorker.js').replace(/^\//, ''); }
  function workerScope() { return basePath() + 'push/onesignal/'; }
  function storageKey(uid) { return 'yte_notification_history_v1:' + host + ':' + safeText(uid || 'anonymous'); }

  function currentUid() { return currentIdentity && currentIdentity.uid ? currentIdentity.uid : ''; }
  function readHistory() {
    const uid = currentUid();
    if (!uid) return [];
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey(uid)) || '[]');
      return Array.isArray(raw) ? raw.slice(0, MAX_HISTORY) : [];
    } catch (_) { return []; }
  }
  function writeHistory(items) {
    const uid = currentUid();
    if (!uid) return;
    try { localStorage.setItem(storageKey(uid), JSON.stringify((items || []).slice(0, MAX_HISTORY))); } catch (_) {}
  }
  function notificationId(notification) {
    return safeText(notification && (notification.notificationId || notification.id || notification.webEventId || notification.rawPayload && notification.rawPayload.custom && notification.rawPayload.custom.i)) || ('local-' + Date.now());
  }
  function notificationTitle(notification) {
    return safeText(notification && (notification.title || notification.heading || notification.headings && (notification.headings.vi || notification.headings.en))) || 'Phòng Y tế';
  }
  function notificationBody(notification) {
    return safeText(notification && (notification.body || notification.content || notification.contents && (notification.contents.vi || notification.contents.en))) || 'Có thông báo mới.';
  }
  function notificationData(notification) {
    return (notification && (notification.additionalData || notification.data)) || {};
  }
  function addHistory(item, markRead) {
    if (!currentUid()) return;
    const items = readHistory();
    const id = safeText(item.id || ('local-' + Date.now()));
    const existing = items.findIndex(function (x) { return x.id === id; });
    const normalized = {
      id: id,
      title: safeText(item.title || 'Phòng Y tế'),
      body: safeText(item.body || 'Có thông báo mới.'),
      at: safeText(item.at || nowIso()),
      read: markRead === true || item.read === true,
      data: item.data && typeof item.data === 'object' ? item.data : {}
    };
    if (existing >= 0) {
      normalized.read = normalized.read || items[existing].read === true;
      items.splice(existing, 1);
    }
    items.unshift(normalized);
    writeHistory(items);
    renderHistory();
  }
  function unreadCount() { return readHistory().filter(function (item) { return item.read !== true; }).length; }
  function markAllRead() {
    const items = readHistory().map(function (item) { return Object.assign({}, item, { read: true }); });
    writeHistory(items); renderHistory();
  }
  function markRead(id) {
    const items = readHistory().map(function (item) { return item.id === id ? Object.assign({}, item, { read: true }) : item; });
    writeHistory(items); renderHistory();
  }
  function clearHistory() { writeHistory([]); renderHistory(); }

  function relativeTime(iso) {
    const time = new Date(iso).getTime();
    if (!Number.isFinite(time)) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
    if (seconds < 45) return 'Vừa xong';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' phút trước';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' giờ trước';
    if (seconds < 604800) return Math.floor(seconds / 86400) + ' ngày trước';
    try { return new Intl.DateTimeFormat('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(time)); }
    catch (_) { return ''; }
  }
  function escapeHtml(value) {
    return safeText(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  function renderHistory() {
    const badge = byId('notificationBadge');
    const count = unreadCount();
    if (badge) { badge.hidden = count < 1; badge.textContent = count > 99 ? '99+' : String(count); }
    const list = byId('notificationList');
    if (!list) return;
    const items = readHistory();
    if (!items.length) {
      list.innerHTML = '<div class="notification-empty"><strong>Chưa có thông báo.</strong><span>Các thông báo nhận trên thiết bị này sẽ xuất hiện tại đây.</span></div>';
      return;
    }
    list.innerHTML = items.map(function (item) {
      return '<button class="notification-item'+(item.read ? '' : ' is-unread')+'" type="button" data-notification-id="'+escapeHtml(item.id)+'">'
        + '<span class="notification-dot" aria-hidden="true"></span>'
        + '<span class="notification-copy"><strong>'+escapeHtml(item.title)+'</strong><span>'+escapeHtml(item.body)+'</span><small>'+escapeHtml(relativeTime(item.at))+'</small></span>'
        + '</button>';
    }).join('');
  }

  function setStatus(text, kind) {
    const el = byId('notificationDeviceStatus');
    if (!el) return;
    el.textContent = safeText(text || '');
    el.className = 'notification-device-status' + (kind ? ' is-' + kind : '');
  }
  function setDeviceCardVisible(visible) {
    const card = byId('notificationDeviceCard');
    if (card) card.hidden = !visible;
  }
  function updateToggleButton(label, disabled, visible) {
    const btn = byId('notificationToggle');
    if (!btn) return;
    btn.textContent = label;
    btn.disabled = !!disabled;
    btn.hidden = visible === false;
  }

  async function refreshPermissionUi() {
    // Khối thiết lập chỉ dùng cho bước bật thông báo lần đầu.
    // Sau khi thiết bị đã subscribed, khối này tự ẩn; người dùng tắt Push
    // bằng cài đặt hệ điều hành/trình duyệt, không opt-out trong ứng dụng.
    setDeviceCardVisible(true);

    if (!supportedHost) {
      setStatus('Thông báo chưa được cấu hình cho địa chỉ này.', 'warn');
      updateToggleButton('Không khả dụng', true, false);
      return;
    }
    const OneSignal = await ensureInit();
    if (!OneSignal) {
      setStatus('Chưa kết nối được dịch vụ thông báo. Ứng dụng vẫn sử dụng bình thường.', 'warn');
      updateToggleButton('Thử lại', false, true);
      return;
    }
    let pushSupported = false;
    try { pushSupported = !!OneSignal.Notifications.isPushSupported(); } catch (_) {}
    if (!pushSupported) {
      setStatus('Trình duyệt hoặc thiết bị này chưa hỗ trợ Web Push.', 'warn');
      updateToggleButton('Không hỗ trợ', true, false);
      return;
    }

    const nativePermission = (typeof Notification !== 'undefined') ? Notification.permission : 'default';
    const permission = !!OneSignal.Notifications.permission;
    const optedIn = !!(OneSignal.User && OneSignal.User.PushSubscription && OneSignal.User.PushSubscription.optedIn);

    if (permission && optedIn) {
      setDeviceCardVisible(false);
      updateToggleButton('', true, false);
      return;
    }

    if (nativePermission === 'denied') {
      setStatus('Thông báo đang tắt trong cài đặt thiết bị. Muốn bật lại, hãy mở Cài đặt > Thông báo của ứng dụng/trình duyệt.', 'danger');
      updateToggleButton('', true, false);
    } else if (permission) {
      setStatus('Thiết bị đã có quyền thông báo. Bấm Bật thông báo để khôi phục nhận Push.', 'muted');
      updateToggleButton('Bật thông báo', false, true);
    } else {
      setStatus('Bật để nhận thông báo quan trọng ngay cả khi ứng dụng không mở.', 'muted');
      updateToggleButton('Bật thông báo', false, true);
    }
  }

  function positionPanel() {
    const layer = byId('notificationLayer');
    const panel = layer && layer.querySelector('.notification-panel');
    const bell = byId('btnNotificationCenter');
    if (!layer || layer.hidden || !panel || !bell) return;
    const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    const bellRect = bell.getBoundingClientRect();
    const mobile = viewportWidth <= 760;
    if (mobile) {
      const header = document.querySelector('.app-header, .header, header');
      const headerRect = header ? header.getBoundingClientRect() : bellRect;
      panel.style.left = '10px';
      panel.style.right = '10px';
      panel.style.width = 'auto';
      panel.style.top = Math.max(8, Math.round(headerRect.bottom + 8)) + 'px';
      panel.style.maxHeight = Math.max(280, Math.round(viewportHeight - headerRect.bottom - 20)) + 'px';
      return;
    }
    const width = Math.min(430, viewportWidth - 24);
    const left = Math.max(12, Math.min(viewportWidth - width - 12, bellRect.right - width));
    panel.style.width = width + 'px';
    panel.style.left = Math.round(left) + 'px';
    panel.style.right = 'auto';
    panel.style.top = Math.round(bellRect.bottom + 9) + 'px';
    panel.style.maxHeight = Math.max(340, Math.min(680, Math.round(viewportHeight - bellRect.bottom - 24))) + 'px';
  }
  function openPanel(event) {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    const layer = byId('notificationLayer');
    const bell = byId('btnNotificationCenter');
    if (!layer || !currentUid()) return;
    if (!layer.hidden) { closePanel(); return; }
    layer.hidden = false;
    if (bell) bell.setAttribute('aria-expanded', 'true');
    renderHistory();
    refreshPermissionUi();
    requestAnimationFrame(positionPanel);
  }
  function closePanel() {
    const layer = byId('notificationLayer');
    const bell = byId('btnNotificationCenter');
    if (layer) layer.hidden = true;
    if (bell) bell.setAttribute('aria-expanded', 'false');
  }

  function savePendingRoute(data) {
    data = data && typeof data === 'object' ? data : {};
    const view = safeText(data.view || data.route || '').toLowerCase();
    if (!view) return false;
    try {
      sessionStorage.setItem(ROUTE_KEY, view);
      sessionStorage.setItem(ROUTE_DATA_KEY, JSON.stringify(data));
      return true;
    } catch (_) { return false; }
  }
  function routeTo(data) {
    data = data && typeof data === 'object' ? data : {};
    let view = safeText(data.view || data.route || '').toLowerCase();
    if (!view) return;
    const aliases = { tongquan:'dashboard', dashboard:'dashboard', nhaplieu:'entry', entry:'entry', baocao:'dashboard', report:'dashboard', reports:'dashboard', chuyenvien:'journey', journey:'journey', quantri:'admin', admin:'admin', reconciliation:'dashboard' };
    view = aliases[view] || view;
    const eventType = safeText(data.eventType || '');
    if (data.requestId || eventType.startsWith('REPORT_REVIEW_')) view = 'dashboard';
    else if (data.caseId || data.resourceId || /^(TRANSFER_|DEATH_|JOURNEY_)/.test(eventType)) view = 'journey';
    if (!['dashboard','entry','journey','admin'].includes(view)) return;
    savePendingRoute(Object.assign({}, data, { view: view }));
    consumePendingRoute();
  }
  async function consumePendingRoute() {
    let view = '', data = {};
    try {
      view = sessionStorage.getItem(ROUTE_KEY) || '';
      data = JSON.parse(sessionStorage.getItem(ROUTE_DATA_KEY) || '{}');
    } catch (_) {}
    if (!view) return;
    // Tương thích payload lưu từ bản cũ sau khi tách Báo cáo và Chuyển viện.
    const eventType = safeText(data.eventType || '');
    if (view === 'reconciliation' || data.requestId || eventType.startsWith('REPORT_REVIEW_')) view = 'dashboard';
    else if (view === 'reports' && (data.caseId || data.resourceId || /^(TRANSFER_|DEATH_|JOURNEY_)/.test(eventType))) view = 'journey';
    else if (view === 'reports' || view === 'report' || view === 'baocao') view = 'dashboard';
    const api = window.YTE_APP_UI;
    if (!api || typeof api.openView !== 'function') return;
    try {
      api.openView(view);
      let handled = true;
      if (view === 'journey' && window.YTE_JOURNEYS && typeof window.YTE_JOURNEYS.openResource === 'function') {
        handled = await window.YTE_JOURNEYS.openResource(data);
      }
      if (view === 'entry' && data.date) {
        const entryDate = byId('entryDate');
        if (entryDate) {
          entryDate.value = safeText(data.date);
          entryDate.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      if (handled !== false) {
        sessionStorage.removeItem(ROUTE_KEY);
        sessionStorage.removeItem(ROUTE_DATA_KEY);
        const url = new URL(window.location.href);
        ['view','resourceId','caseId','eventType','requestId','date','metricType','status'].forEach(function (key) { url.searchParams.delete(key); });
        history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
      }
    } catch (_) {}
  }
  function captureRouteFromUrl() {
    try {
      const url = new URL(window.location.href);
      const data = {};
      ['view','resourceId','caseId','eventType','requestId','date','metricType','status'].forEach(function (key) {
        const value = url.searchParams.get(key);
        if (value) data[key] = value;
      });
      if (data.view) { routeTo(data); }
    } catch (_) {}
  }

  function bindSdkEvents(OneSignal) {
    if (eventsBound || !OneSignal) return;
    eventsBound = true;
    try {
      OneSignal.Notifications.addEventListener('permissionChange', function () { refreshPermissionUi(); });
      OneSignal.Notifications.addEventListener('foregroundWillDisplay', function (event) {
        const n = event && event.notification ? event.notification : event;
        addHistory({ id: notificationId(n), title: notificationTitle(n), body: notificationBody(n), data: notificationData(n), at: nowIso() }, false);
      });
      OneSignal.Notifications.addEventListener('click', function (event) {
        const n = event && event.notification ? event.notification : event;
        const id = notificationId(n);
        addHistory({ id: id, title: notificationTitle(n), body: notificationBody(n), data: notificationData(n), at: nowIso() }, true);
        const data = notificationData(n);
        if (data && (data.view || data.route)) routeTo(data);
      });
      OneSignal.User.PushSubscription.addEventListener('change', function () { refreshPermissionUi(); });
    } catch (error) { console.warn('OneSignal event binding:', error); }
  }

  function ensureInit() {
    if (initPromise) return initPromise;
    initPromise = new Promise(function (resolve) {
      if (!supportedHost) { resolve(null); return; }
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async function (OneSignal) {
        try {
          await OneSignal.init({
            appId: appId,
            serviceWorkerPath: workerPath(),
            serviceWorkerParam: { scope: workerScope() },
            autoResubscribe: true,
            welcomeNotification: { disable: true },
            notificationClickHandlerMatch: 'origin',
            notificationClickHandlerAction: 'navigate'
          });
          sdk = OneSignal;
          try { OneSignal.Notifications.setDefaultTitle('Phòng Y tế'); } catch (_) {}
          try { OneSignal.Notifications.setDefaultUrl(appBaseUrl()); } catch (_) {}
          bindSdkEvents(OneSignal);
          resolve(OneSignal);
        } catch (error) {
          console.warn('Không khởi tạo được OneSignal:', error);
          resolve(null);
        }
      });
      window.setTimeout(function () { if (!sdk) resolve(null); }, 12000);
    });
    return initPromise;
  }

  function roleRank(role) {
    const value = safeText(role).toLowerCase();
    if (value === 'admin' || value === 'quản trị') return 3;
    if (value === 'nhaplieu' || value === 'nhập liệu') return 2;
    if (value === 'viewer' || value === 'xem') return 1;
    return 0;
  }
  function normalizeRole(role) {
    const rank = roleRank(role);
    return rank === 3 ? 'admin' : rank === 2 ? 'nhaplieu' : rank === 1 ? 'viewer' : 'none';
  }
  function highestRole(identity) {
    const roles = [identity && identity.tongHopRole, identity && identity.reportRole];
    let best = 'none', rank = 0;
    roles.forEach(function (role) { const r = roleRank(role); if (r > rank) { rank = r; best = normalizeRole(role); } });
    return best;
  }

  async function syncUser(identity) {
    identity = identity || null;
    const uid = safeText(identity && identity.uid || '');
    if (!uid) { await clearUser(); return; }
    const normalized = {
      uid: uid,
      tongHopRole: normalizeRole(identity.tongHopRole),
      reportRole: normalizeRole(identity.reportRole),
      role: highestRole(identity)
    };
    currentIdentity = normalized;
    const button = byId('btnNotificationCenter');
    if (button) button.hidden = false;
    renderHistory();
    const OneSignal = await ensureInit();
    if (!OneSignal) { refreshPermissionUi(); return; }
    try {
      await OneSignal.login(uid);
      // OneSignal Free chỉ cho tối đa 2 Data Tags/user.
      // Xóa tags legacy rồi chỉ giữ 2 tags nghiệp vụ. Vì SDK có thể xử lý
      // đồng bộ tag theo hàng đợi, lặp lại addTags sau một khoảng ngắn để
      // tự phục hồi trường hợp lần ghi đầu tiên bị giới hạn tag chặn im lặng.
      try { OneSignal.User.removeTags(['role', 'app']); } catch (_) {}
      const desiredTags = {
        tonghop_role: normalized.tongHopRole,
        baocao_role: normalized.reportRole
      };
      const applyDesiredTags = function () {
        try { OneSignal.User.addTags(desiredTags); } catch (_) {}
      };
      applyDesiredTags();
      window.setTimeout(applyDesiredTags, 1500);
      window.setTimeout(applyDesiredTags, 5000);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && OneSignal.User.PushSubscription && !OneSignal.User.PushSubscription.optedIn) {
        await OneSignal.User.PushSubscription.optIn();
      }
    } catch (error) { console.warn('OneSignal sync user:', error); }
    refreshPermissionUi();
    window.setTimeout(consumePendingRoute, 0);
  }

  async function clearUser() {
    if (!currentIdentity) {
      const button = byId('btnNotificationCenter'); if (button) button.hidden = true;
      closePanel(); return;
    }
    const OneSignal = await ensureInit();
    try {
      if (OneSignal && OneSignal.User && OneSignal.User.PushSubscription && OneSignal.User.PushSubscription.optedIn) await OneSignal.User.PushSubscription.optOut();
      if (OneSignal) await OneSignal.logout();
    } catch (error) { console.warn('OneSignal logout:', error); }
    currentIdentity = null;
    const button = byId('btnNotificationCenter'); if (button) button.hidden = true;
    closePanel(); renderHistory();
  }

  async function getFirebaseAuthForGateway() {
    const appModule = await import('https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js');
    const authModule = await import('https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js');
    const apps = appModule.getApps();
    if (!apps.length) throw new Error('FIREBASE_APP_NOT_READY');
    return authModule.getAuth(apps[0]);
  }

  async function sendBusinessEvent(eventType, resourceId, extra) {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/i.test(gatewayUrl)) {
      throw new Error('NOTIFICATION_GATEWAY_NOT_CONFIGURED');
    }
    const auth = await getFirebaseAuthForGateway();
    const user = auth.currentUser;
    if (!user) throw new Error('NOT_AUTHENTICATED');
    const idToken = await user.getIdToken();
    const payload = Object.assign({
      action: 'BUSINESS_EVENT',
      eventType: safeText(eventType).trim().toUpperCase(),
      idToken: idToken
    }, extra && typeof extra === 'object' ? extra : {});
    if (resourceId) payload.resourceId = safeText(resourceId).trim();
    const response = await fetch(gatewayUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text || '{}'); }
    catch (_) { throw new Error('NOTIFICATION_GATEWAY_INVALID_RESPONSE'); }
    if (!response.ok || !result || result.success !== true) {
      const code = result && (result.error || result.message) ? (result.error || result.message) : ('HTTP_' + response.status);
      throw new Error('NOTIFICATION_GATEWAY_FAILED: ' + code);
    }
    return result;
  }

  function notifyBusinessEvent(eventType, resourceId, extra) {
    return sendBusinessEvent(eventType, resourceId, extra).catch(function (error) {
      // Push không được phép làm rollback nghiệp vụ đã ghi thành công vào Firebase.
      console.warn('Notification business event:', eventType, error);
      return null;
    });
  }

  async function togglePush() {
    const OneSignal = await ensureInit();
    if (!OneSignal) { await refreshPermissionUi(); return; }
    try {
      if (!OneSignal.Notifications.isPushSupported()) { await refreshPermissionUi(); return; }
      // Nút trong ứng dụng chỉ có chức năng BẬT. Không cho optOut từ UI.
      // Khi muốn tắt, người dùng quản lý quyền tại Cài đặt của điện thoại/trình duyệt.
      if (!OneSignal.Notifications.permission) await OneSignal.Notifications.requestPermission();
      if (OneSignal.Notifications.permission && !OneSignal.User.PushSubscription.optedIn) {
        await OneSignal.User.PushSubscription.optIn();
      }
    } catch (error) { console.warn('OneSignal enable push:', error); }
    await refreshPermissionUi();
  }

  function bindUi() {
    const open = byId('btnNotificationCenter');
    const close = byId('notificationClose');
    const layer = byId('notificationLayer');
    const toggle = byId('notificationToggle');
    const markAll = byId('notificationMarkAllRead');
    const clear = byId('notificationClearHistory');
    const list = byId('notificationList');
    if (open) open.addEventListener('click', openPanel);
    if (close) close.addEventListener('click', closePanel);
    document.addEventListener('pointerdown', function (event) {
      if (!layer || layer.hidden) return;
      const panel = layer.querySelector('.notification-panel');
      if ((panel && panel.contains(event.target)) || (open && open.contains(event.target))) return;
      closePanel();
    });
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);
    if (toggle) toggle.addEventListener('click', togglePush);
    if (markAll) markAll.addEventListener('click', markAllRead);
    if (clear) clear.addEventListener('click', clearHistory);
    if (list) list.addEventListener('click', function (event) {
      const button = event.target.closest('.notification-item');
      if (!button) return;
      const id = button.getAttribute('data-notification-id') || '';
      const record = readHistory().find(function (item) { return item.id === id; }) || null;
      markRead(id);
      if (record && record.data) routeTo(record.data);
      closePanel();
    });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && layer && !layer.hidden) closePanel(); });
    captureRouteFromUrl();
    renderHistory();
    if (supportedHost) ensureInit();
  }

  window.YTE_NOTIFICATIONS = Object.freeze({
    syncUser: syncUser,
    clearUser: clearUser,
    signOut: clearUser,
    open: openPanel,
    addLocal: function (title, body, data) { addHistory({ title:title, body:body, data:data || {}, at:nowIso() }, false); },
    getHistory: function () { return readHistory().slice(); },
    consumePendingRoute: consumePendingRoute,
    getAppId: function () { return appId; },
    sendBusinessEvent: sendBusinessEvent,
    notifyBusinessEvent: notifyBusinessEvent,
    getGatewayUrl: function () { return gatewayUrl; }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi, { once:true });
  else bindUi();
})();
