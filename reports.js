'use strict';

import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase,
  get,
  onValue,
  push,
  query,
  ref,
  orderByChild,
  startAt,
  endAt,
  set,
  update
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const CFG = window.YTE_APP_CONFIG || {};
const OWNER_EMAIL = String(CFG.OWNER_EMAIL || '').trim().toLowerCase();
const REPORT_ROOT = 'baoCaoYTe';
const YTE_APP_ROOT = 'yTeApp';
const TONG_HOP_ROOT = 'tongHopYTe';

const app = getApps().length ? getApp() : initializeApp(CFG.FIREBASE);
const auth = getAuth(app);
const db = getDatabase(app);

const reportState = {
  user: null,
  permission: null,
  tongHopPermission: null,
  type: 'CHUYEN_VIEN',
  mode: 'list',
  reports: [],
  users: [],
  editingId: '',
  readonly: false,
  loading: false,
  initialized: false,
  liveUnsubscribe: null,
  formBaseline: ''
};

function $(id) { return document.getElementById(id); }
function notifyBusinessEvent(eventType, resourceId) {
  const api = window.YTE_NOTIFICATIONS;
  if (!api || typeof api.notifyBusinessEvent !== 'function') return;
  void api.notifyBusinessEvent(eventType, resourceId);
}
async function confirmInApp(options) {
  const ui = window.YTE_APP_UI;
  if (!ui || typeof ui.confirm !== 'function') {
    showToast('Không mở được cửa sổ xác nhận. Vui lòng thử lại.', 'err');
    return false;
  }
  return ui.confirm(options || {});
}
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/\s+/g, ' ');
}
function formatPersonName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean).map((word) => {
    const lower = word.toLocaleLowerCase('vi-VN');
    return lower.charAt(0).toLocaleUpperCase('vi-VN') + lower.slice(1);
  }).join(' ');
}
function normalizeBHYT(value) { return String(value || '').toUpperCase().replace(/\s+/g, '').trim().slice(0, 40); }
function validBirthYear(value) {
  const year = Number(value || 0);
  return Number.isInteger(year) && year >= 1900 && year <= new Date().getFullYear();
}
async function preferredDisplayName(user, fallback) {
  if (!user) return String(fallback || '—');
  try {
    const snap = await get(ref(db, `${YTE_APP_ROOT}/tenHienThi/${user.uid}`));
    const custom = snap.exists() ? String(snap.child('displayName').val() || '').trim() : '';
    return String(custom || fallback || user.displayName || user.email || '—').slice(0, 150);
  } catch (_) {
    return String(fallback || user.displayName || user.email || '—').slice(0, 150);
  }
}
async function preferredDisplayNameByUid(uid, fallback) {
  if (!uid) return String(fallback || '—');
  try {
    const snap = await get(ref(db, `${YTE_APP_ROOT}/tenHienThi/${uid}`));
    const custom = snap.exists() ? String(snap.child('displayName').val() || '').trim() : '';
    return String(custom || fallback || '—').slice(0, 150);
  } catch (_) { return String(fallback || '—').slice(0, 150); }
}
function reportFormSignature() {
  return ['reportPatientName','reportGender','reportBirthYear','reportBHYT','reportAddress','reportCause','reportDeathDate','reportNote'].map((id) => `${id}:${String($(id)?.value || '')}`).join('|');
}
function isReportDirty() { return !!reportState.formBaseline && !reportState.readonly && reportFormSignature() !== reportState.formBaseline; }
function todayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function firstDayOfMonthIso() {
  return `${todayIso().slice(0, 7)}-01`;
}
function fmtDate(value) {
  const p = String(value || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(value || '');
}
function fmtDateTime(value) {
  const n = Number(value || 0);
  if (!n) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(n));
}
function monthKey(dateIso) { return String(dateIso || todayIso()).slice(0, 7); }
function roleLabel(role) {
  return role === 'admin' ? 'Quản trị' : role === 'nhaplieu' ? 'Nhập liệu' : role === 'viewer' ? 'Xem' : 'Chưa cấp';
}
function typeLabel(type) { return type === 'TU_VONG' ? 'Tử vong' : 'Chuyển viện'; }
function isOwner(user) { return !!(user && normalizeEmail(user.email) === OWNER_EMAIL); }
function validPermission(permission) {
  return !!(permission && permission.active === true && ['admin', 'nhaplieu', 'viewer'].includes(permission.role));
}
function isTongHopAdmin() {
  return !!(reportState.tongHopPermission && reportState.tongHopPermission.active === true && reportState.tongHopPermission.role === 'admin');
}
function isReportAdmin() {
  return !!(validPermission(reportState.permission) && reportState.permission.role === 'admin');
}
function isGlobalAdmin() {
  return !!((reportState.user || auth.currentUser) && (isOwner(reportState.user || auth.currentUser) || isTongHopAdmin() || isReportAdmin()));
}
function effectiveReportRole() {
  if (isGlobalAdmin()) return 'admin';
  const roles = [reportState.permission, reportState.tongHopPermission].filter(validPermission).map((permission) => permission.role);
  if (roles.includes('nhaplieu')) return 'nhaplieu';
  if (roles.includes('viewer')) return 'viewer';
  return '';
}
function hasReportViewAccess() {
  return !!effectiveReportRole();
}
function canEditReport() {
  return ['admin', 'nhaplieu'].includes(effectiveReportRole());
}
function canAdminReport() {
  return isGlobalAdmin();
}
function snapshotObject(snap) { return snap && snap.exists() ? (snap.val() || {}) : {}; }
function showToast(text, type) {
  const box = $('toast');
  if (!box) return;
  box.textContent = text;
  box.className = 'toast ' + (type || 'ok');
  box.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { box.hidden = true; }, 3500);
}
function showInlineState(id, text, type, spinning) {
  const box = $(id);
  if (!box) return;
  box.hidden = !text;
  box.className = 'inline-state ' + (type || '');
  box.innerHTML = text ? (spinning ? '<span class="spinner"></span>' : '') + '<span>' + esc(text) + '</span>' : '';
}
function activateView(name) {
  const button = document.querySelector('.nav-item[data-view="' + name + '"]');
  if (button) button.click();
}
function clearGlobalMessage() {
  const box = $('message');
  if (box) box.innerHTML = '';
}

async function ensureDirectoryProfile(user) {
  if (!user) return;
  const profileRef = ref(db, `${YTE_APP_ROOT}/nguoiDung/${user.uid}`);
  const snap = await get(profileRef);
  const old = snapshotObject(snap);
  const now = Date.now();
  await update(profileRef, {
    email: normalizeEmail(user.email),
    displayName: String(user.displayName || old.displayName || user.email || '').slice(0, 150),
    photoURL: String(user.photoURL || old.photoURL || '').slice(0, 1000),
    provider: 'google.com',
    active: true,
    createdAt: old.createdAt || now,
    updatedAt: now,
    lastLoginAt: now
  });
}

async function ensureOwnerPermission(user) {
  if (!isOwner(user)) return;
  const permissionRef = ref(db, `${REPORT_ROOT}/phanQuyen/${user.uid}`);
  const snap = await get(permissionRef);
  const old = snapshotObject(snap);
  if (old.active === true && old.role === 'admin') return;
  const now = Date.now();
  await update(permissionRef, {
    email: normalizeEmail(user.email),
    displayName: String(user.displayName || old.displayName || user.email || '').slice(0, 150),
    role: 'admin',
    active: true,
    source: old.source || 'OWNER_BOOTSTRAP',
    createdAt: old.createdAt || now,
    updatedAt: now
  });
}

async function refreshAccess() {
  const user = auth.currentUser;
  reportState.user = user || null;
  if (!user) {
    reportState.permission = null;
    reportState.tongHopPermission = null;
    updateModuleUi();
    return;
  }
  await ensureOwnerPermission(user);
  const store = window.YTE_PERMISSION_STORE;
  const shared = store && typeof store.getSnapshot === 'function' ? store.getSnapshot(user.uid) : null;
  if (shared && shared.ready === true && shared.uid === user.uid) {
    reportState.permission = shared.reportPermission || null;
    reportState.tongHopPermission = shared.tongHopPermission || null;
    updateModuleUi();
    return;
  }
  // Bootstrap fallback: một permission read lỗi không làm mất quyền hợp lệ ở module còn lại.
  const settled = await Promise.allSettled([
    get(ref(db, `${REPORT_ROOT}/phanQuyen/${user.uid}`)),
    get(ref(db, `${TONG_HOP_ROOT}/phanQuyen/${user.uid}`))
  ]);
  const reportSnap = settled[0].status === 'fulfilled' ? settled[0].value : null;
  const tongHopSnap = settled[1].status === 'fulfilled' ? settled[1].value : null;
  if (settled[0].status === 'rejected') console.warn('Quyền Báo cáo:', settled[0].reason);
  if (settled[1].status === 'rejected') console.warn('Quyền Tổng hợp:', settled[1].reason);
  reportState.permission = reportSnap && reportSnap.exists() ? reportSnap.val() : null;
  reportState.tongHopPermission = tongHopSnap && tongHopSnap.exists() ? tongHopSnap.val() : null;
  updateModuleUi();
}

window.addEventListener('yte:permissions-changed', function (event) {
  const user = auth.currentUser;
  const detail = event && event.detail || {};
  if (!user || !detail.ready || detail.uid !== user.uid) return;
  reportState.permission = detail.reportPermission || null;
  reportState.tongHopPermission = detail.tongHopPermission || null;
  updateModuleUi();
});

function userFacingReportError(error, fallback) {
  const raw = String(error && error.message ? error.message : error || '').trim();
  if (/permission[_ -]?denied|client doesn't have permission|firebase.*permission/i.test(raw)) {
    return 'Bạn chưa được cấp quyền sử dụng chức năng này. Vui lòng liên hệ người quản trị.';
  }
  if (/network|failed to fetch|unavailable|offline|timeout/i.test(raw)) {
    return 'Không thể kết nối dữ liệu lúc này. Vui lòng kiểm tra Internet và thử lại.';
  }
  return raw || fallback || 'Không thể thực hiện thao tác. Vui lòng thử lại.';
}

function friendlyGivenName(value) {
  let text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return 'bạn';
  if (text.includes('@')) text = text.split('@')[0].replace(/[._-]+/g, ' ').trim();
  const parts = text.split(' ').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'bạn';
}

function updateModuleUi(external) {
  if (external && external.authUser && !reportState.user) {
    reportState.user = auth.currentUser || null;
  }
  if (external && Object.prototype.hasOwnProperty.call(external, 'reportPermission')) {
    reportState.permission = external.reportPermission || null;
  }
  if (external && Object.prototype.hasOwnProperty.call(external, 'tongHopPermission')) {
    reportState.tongHopPermission = external.tongHopPermission || null;
  }

  const authenticated = !!(reportState.user || auth.currentUser);
  const globalAdmin = isGlobalAdmin();
  const tongHopActive = globalAdmin || (external && typeof external.tongHopActive === 'boolean'
    ? external.tongHopActive
    : !!(reportState.tongHopPermission && reportState.tongHopPermission.active === true &&
      ['admin', 'nhaplieu', 'viewer'].includes(reportState.tongHopPermission.role)));
  const reportActive = globalAdmin || validPermission(reportState.permission) || validPermission(reportState.tongHopPermission);

  if ($('navJourney')) $('navJourney').hidden = !reportActive;
  if ($('moduleTongHopCard')) $('moduleTongHopCard').hidden = !tongHopActive;
  if ($('noModuleAccess')) $('noModuleAccess').hidden = !authenticated || tongHopActive || reportActive;

  const user = reportState.user || auth.currentUser;
  if ($('homeWelcome')) {
    $('homeWelcome').textContent = user
      ? 'Xin chào, ' + friendlyGivenName(user.displayName || user.email || '') + ' 👋'
      : 'Chọn chức năng';
  }

  if ($('reportPermissionModeBtn')) $('reportPermissionModeBtn').hidden = true;
  if ($('btnNewReport')) $('btnNewReport').hidden = true;
}

async function routeAfterLogin(result) {
  await refreshAccess();
  clearGlobalMessage();
  const tongHopActive = !!(result && result.active === true);
  const reportActive = hasReportViewAccess();
  if (tongHopActive || reportActive) activateView('dashboard');
  else activateView('home');
}

async function routeAfterRestore(result) {
  await refreshAccess();
  const current = document.querySelector('.view.active');
  const currentName = current ? current.id.replace(/View$/, '') : '';
  const tongHopActive = !!(result && result.active === true);
  const reportActive = hasReportViewAccess();
  if (!auth.currentUser) return;
  if (currentName === 'home' && (tongHopActive || reportActive)) {
    activateView('dashboard');
    return;
  }
  if (currentName === 'dashboard' || currentName === 'auth' || !currentName) {
    if (!tongHopActive && reportActive) activateView('dashboard');
    else if (!tongHopActive && !reportActive) activateView('home');
  }
}

function onLogout() {
  reportState.user = null;
  reportState.permission = null;
  reportState.tongHopPermission = null;
  reportState.reports = [];
  reportState.users = [];
  updateModuleUi();
}

function onViewChanged(name) {
  if (name === 'home') updateModuleUi();
  if (name === 'journey') activateReportsView();
}

window.YTE_REPORTS = {
  routeAfterLogin,
  routeAfterRestore,
  updateModuleUi,
  onLogout,
  onViewChanged,
  refreshAccess,
  hasUnsavedChanges: function () { return false; }
};

function reportFilterValues() {
  const from = $('reportFromDate').value;
  const to = $('reportToDate').value;
  if (!from || !to) throw new Error('Vui lòng chọn đầy đủ khoảng thời gian.');
  if (from > to) throw new Error('Từ ngày không được lớn hơn đến ngày.');
  return {
    from,
    to,
    search: normalizeSearch($('reportSearch').value || ''),
    type: reportState.type
  };
}

function applyReportSnapshot(snap) {
  const raw = snapshotObject(snap);
  reportState.reports = Object.keys(raw).map((id) => ({ id, ...(raw[id] || {}) }));
  renderReports();
  showInlineState('reportLoadState', '', '', false);
}

function stopReportRealtime() {
  if (typeof reportState.liveUnsubscribe === 'function') reportState.liveUnsubscribe();
  reportState.liveUnsubscribe = null;
}

function startReportRealtime() {
  if (!hasReportViewAccess()) {
    stopReportRealtime();
    return;
  }
  if (reportState.liveUnsubscribe) return;
  reportState.liveUnsubscribe = onValue(ref(db, `${REPORT_ROOT}/baoCao`), (snap) => {
    applyReportSnapshot(snap);
  }, (error) => {
    console.error('Realtime báo cáo:', error);
    showInlineState('reportLoadState', 'Mất kết nối đồng bộ trực tiếp. Ứng dụng sẽ tự kết nối lại khi mạng ổn định.', 'err', false);
  });
}

async function loadReports(force) {
  if (!hasReportViewAccess()) {
    $('reportList').innerHTML = '<div class="empty">Tài khoản chưa được cấp quyền Báo cáo.</div>';
    return;
  }
  startReportRealtime();
  if (!force && reportState.reports.length) { renderReports(); return; }
  if (reportState.loading && !force) return;
  try { reportFilterValues(); }
  catch (error) { showInlineState('reportLoadState', userFacingReportError(error, 'Khoảng thời gian không hợp lệ.'), 'err', false); return; }

  reportState.loading = true;
  showInlineState('reportLoadState', 'Đang tải báo cáo...', '', true);
  try {
    const snap = await get(ref(db, `${REPORT_ROOT}/baoCao`));
    applyReportSnapshot(snap);
  } catch (error) {
    console.error(error);
    showInlineState('reportLoadState', userFacingReportError(error, 'Không thể tải dữ liệu báo cáo.'), 'err', false);
    $('reportList').innerHTML = '<div class="empty">Không thể tải dữ liệu báo cáo.</div>';
  } finally {
    reportState.loading = false;
  }
}

function filteredReports() {
  const filter = reportFilterValues();
  return reportState.reports
    .filter((item) => item.trangThai !== 'deleted')
    .filter((item) => String(item.ngayBaoCao || '') >= filter.from && String(item.ngayBaoCao || '') <= filter.to)
    .filter((item) => item.loaiBaoCao === filter.type)
    .filter((item) => {
      if (!filter.search) return true;
      const haystack = normalizeSearch([
        item.hoTenBenhNhan, item.hoTenNorm, item.diaChi, item.chanDoan,
        item.nguyenNhan, item.noiChuyen, item.noiDen, item.noiTuVong,
        item.ghiChu, item.createdByName
      ].join(' '));
      return haystack.includes(filter.search);
    })
    .sort((a, b) => String(b.ngayBaoCao || '').localeCompare(String(a.ngayBaoCao || '')) ||
      Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function renderReports() {
  let rows = [];
  try { rows = filteredReports(); } catch (error) { return; }

  const allActive = reportState.reports.filter((item) => item.trangThai !== 'deleted');
  $('reportFilteredCount').textContent = String(rows.length);
  $('reportDeathCount').textContent = String(allActive.filter((item) => item.loaiBaoCao === 'TU_VONG').length);

  if (!rows.length) {
    $('reportList').innerHTML = '<div class="empty">Chưa có báo cáo phù hợp trong khoảng thời gian đã chọn.</div>';
    return;
  }

  $('reportList').innerHTML = rows.map((item) => {
    const isDeath = item.loaiBaoCao === 'TU_VONG';
    const destination = isDeath ? (item.noiTuVong || '—') : (item.noiDen || '—');
    const summary = isDeath ? (item.nguyenNhan || '') : (item.chanDoan || '');
    const canEdit = canEditReport();
    const isAdmin = canAdminReport();
    return `<article class="report-row ${isDeath ? 'is-death' : 'is-transfer'}">
      <div class="report-row-mark">${isDeath ? 'TV' : 'CV'}</div>
      <div class="report-row-main">
        <div class="report-row-title">
          <strong>${esc(item.hoTenBenhNhan || 'Chưa có họ tên')}</strong>
          <span class="report-type-pill">${esc(typeLabel(item.loaiBaoCao))}</span>
        </div>
        <div class="report-row-meta">
          <span>${esc(item.gioiTinh || '—')}</span>
          <span>${item.namSinh ? `Sinh năm ${esc(item.namSinh)}` : '—'}</span>
          <span>${esc(fmtDate(item.ngayBaoCao))}</span>
          <span>${esc(destination)}</span>
        </div>
        ${summary ? `<p>${esc(summary)}</p>` : ''}
        <div class="report-row-by">Người nhập: ${esc(item.createdByName || item.legacyNguoiNhap || '—')}</div>
      </div>
      <div class="report-row-actions">
        <button class="small-btn btn-soft report-action" data-kind="view" data-id="${esc(item.id)}">Xem</button>
        ${canEdit ? `<button class="small-btn btn-soft report-action" data-kind="edit" data-id="${esc(item.id)}">Chỉnh sửa</button>` : ''}
        ${isAdmin ? `<button class="small-btn btn-danger report-action" data-kind="delete" data-id="${esc(item.id)}">Xóa</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

function setReportType() {
  reportState.type = 'CHUYEN_VIEN';
  if ($('transferJourneyPanel')) $('transferJourneyPanel').hidden = false;
  if ($('reportListPanel')) $('reportListPanel').hidden = true;
  if ($('reportPermissionPanel')) $('reportPermissionPanel').hidden = true;
  if ($('reportModeRow')) $('reportModeRow').hidden = true;
  if ($('btnNewReport')) $('btnNewReport').hidden = true;
  if ($('reportPageTitle')) $('reportPageTitle').textContent = 'Chuyển viện & tử vong';
  if ($('reportPageSubtitle')) $('reportPageSubtitle').textContent = 'Theo dõi hành trình, lượt chuyển viện và tử vong ngoài Trung tâm.';
  if (window.YTE_JOURNEYS && typeof window.YTE_JOURNEYS.setVisible === 'function') window.YTE_JOURNEYS.setVisible(!!$('journeyView')?.classList.contains('active'));
}

function setReportMode(mode) {
  mode = mode === 'permissions' && canAdminReport() ? 'permissions' : 'list';
  reportState.mode = mode;
  document.querySelectorAll('.report-mode-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-report-mode') === mode);
  });
  $('reportListPanel').hidden = mode !== 'list';
  $('reportPermissionPanel').hidden = mode !== 'permissions';
  if (mode === 'permissions') loadReportUsers(true);
}

async function activateReportsView() {
  await refreshAccess();
  if (!hasReportViewAccess()) {
    activateView('home');
    return;
  }
  setReportType();
  if (window.YTE_JOURNEYS && typeof window.YTE_JOURNEYS.activate === 'function') {
    await window.YTE_JOURNEYS.activate();
  }
}

function resetReportForm(type) {
  reportState.editingId = '';
  reportState.readonly = false;
  reportState.type = type === 'TU_VONG' ? 'TU_VONG' : 'CHUYEN_VIEN';
  $('reportPatientName').value = '';
  $('reportGender').value = '';
  $('reportBirthYear').value = '';
  if ($('reportBHYT')) $('reportBHYT').value = '';
  $('reportAddress').value = 'TTBTXH TÂN HIỆP';
  $('reportDiagnosis').value = '';
  $('reportTransferDate').value = todayIso();
  $('reportTransferFrom').value = 'Trung tâm Bảo trợ xã hội Tân Hiệp';
  $('reportTransferTo').value = '';
  $('reportCause').value = '';
  $('reportDeathDate').value = todayIso();
  $('reportDeathPlace').value = 'Trung tâm Bảo trợ xã hội Tân Hiệp';
  $('reportNote').value = '';
  $('reportFormError').textContent = '';
  updateReportFormKind();
  reportState.formBaseline = reportFormSignature();
}

function updateReportFormKind() {
  document.querySelectorAll('.report-kind-fields').forEach((box) => {
    box.hidden = box.getAttribute('data-kind') !== reportState.type;
  });
  $('reportDialogBadge').textContent = typeLabel(reportState.type).toUpperCase();
}

function setReportFormReadonly(readonly) {
  reportState.readonly = !!readonly;
  const layer = $('reportLayer');
  if (layer) layer.classList.toggle('is-readonly', reportState.readonly);
  const detail = $('reportReadonlyView'); if (detail) detail.hidden = !reportState.readonly;
  const fields = layer ? layer.querySelectorAll('input, select, textarea') : []; fields.forEach((field) => { field.disabled = !!readonly; });
  $('reportSave').hidden = !!readonly; $('reportCancel').textContent = readonly ? 'Đóng' : 'Quay lại';
  // Readonly popup đã có nút Đóng ở footer: không hiển thị thêm dấu X.
  if ($('reportCloseX')) $('reportCloseX').hidden = !!readonly;
}
function populateReadonlyReportDetails(item) {
  if (!$('reportReadonlyView')) return;
  const facts=[item.gioiTinh||'',item.namSinh?`Sinh năm ${item.namSinh}`:''].filter(Boolean);
  $('reportDetailName').textContent=item.hoTenBenhNhan||'Chưa có họ tên';$('reportDetailFacts').textContent=facts.length?facts.join(' · '):'Chưa có thông tin nhân thân';
  $('reportDetailDate').textContent=fmtDate(item.ngayTuVong||item.ngayBaoCao||'');$('reportDetailPlace').textContent=item.noiTuVong||'Trung tâm Bảo trợ xã hội Tân Hiệp';$('reportDetailAddress').textContent=item.diaChi||'—';$('reportDetailCause').textContent=item.nguyenNhan||'—';
  const note=String(item.ghiChu||'').trim();$('reportDetailNote').textContent=note||'—';$('reportDetailNoteRow').hidden=!note;$('reportDetailReporter').textContent=item.createdByName||item.legacyNguoiNhap||'—';
  preferredDisplayNameByUid(item.createdByUid,item.createdByName||item.legacyNguoiNhap||'—').then((name)=>{if(reportState.editingId===item.id&&$('reportDetailReporter'))$('reportDetailReporter').textContent=name;});
}

async function openCenterDeathForm() {
  if (!canEditReport()) return;
  reportState.type = 'TU_VONG';
  resetReportForm('TU_VONG');
  $('reportDialogTitle').textContent = 'Dữ liệu tử vong lưu trữ';
  $('reportDialogBadge').textContent = 'DỮ LIỆU LƯU TRỮ';
  $('reportReporter').textContent = await preferredDisplayName(reportState.user || auth.currentUser, reportState.permission && reportState.permission.displayName);
  setReportFormReadonly(false);
  reportState.formBaseline = reportFormSignature();
  $('reportLayer').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('reportPatientName').focus(), 0);
}
function openNewReport() { showToast('Nghiệp vụ này đã ngừng tạo mới. Tử vong được cập nhật từ hành trình Chuyển viện.', 'info'); return false; }
function openReportById(id) {
  const item = reportState.reports.find((row) => row.id === id);
  if (!item) return;
  populateReportForm(item, true);
}
function editReportById(id) {
  if (!canEditReport()) return;
  const item = reportState.reports.find((row) => row.id === id);
  if (!item || item.trangThai === 'deleted') return;
  populateReportForm(item, false);
}

function populateReportForm(item, readonly) {
  reportState.editingId = item.id;
  reportState.type = item.loaiBaoCao === 'TU_VONG' ? 'TU_VONG' : 'CHUYEN_VIEN';
  updateReportFormKind();
  $('reportPatientName').value = item.hoTenBenhNhan || '';
  $('reportGender').value = item.gioiTinh || '';
  $('reportBirthYear').value = item.namSinh || '';
  if ($('reportBHYT')) $('reportBHYT').value = item.theBHYT || '';
  $('reportAddress').value = item.diaChi || '';
  $('reportDiagnosis').value = item.chanDoan || '';
  $('reportTransferDate').value = item.ngayChuyenVien || item.ngayBaoCao || '';
  $('reportTransferFrom').value = item.noiChuyen || '';
  $('reportTransferTo').value = item.noiDen || '';
  $('reportCause').value = item.nguyenNhan || '';
  $('reportDeathDate').value = item.ngayTuVong || item.ngayBaoCao || '';
  $('reportDeathPlace').value = item.noiTuVong || '';
  $('reportNote').value = item.ghiChu || '';
  $('reportReporter').textContent = item.createdByName || item.legacyNguoiNhap || '—';
  preferredDisplayNameByUid(item.createdByUid, item.createdByName || item.legacyNguoiNhap || '—').then((name) => { if (reportState.editingId === item.id && $('reportReporter')) $('reportReporter').textContent = name; });
  if (readonly) populateReadonlyReportDetails(item);
  $('reportDialogTitle').textContent = reportState.type === 'TU_VONG' ? ((readonly ? 'Chi tiết' : 'Chỉnh sửa') + ' dữ liệu tử vong lưu trữ') : ((readonly ? 'Chi tiết ' : 'Chỉnh sửa ') + typeLabel(reportState.type).toLowerCase());
  $('reportFormError').textContent = '';
  setReportFormReadonly(readonly);
  $('reportLayer').hidden = false;
  document.body.style.overflow = 'hidden';
  reportState.formBaseline = reportFormSignature();
}

async function closeReportForm(force = false) {
  if (!force && isReportDirty()) {
    const discard = await confirmInApp({title:'Bỏ thay đổi chưa lưu?',message:'Bạn có thay đổi chưa lưu. Nếu tiếp tục, nội dung đang nhập sẽ bị bỏ.',confirmText:'Bỏ thay đổi',cancelText:'Tiếp tục nhập',danger:true});
    if (!discard) return false;
  }
  $('reportLayer').hidden = true;
  document.body.style.overflow = '';
  reportState.editingId = '';
  reportState.readonly = false;
  reportState.formBaseline = '';
  $('reportFormError').textContent = '';
  reportState.type = 'CHUYEN_VIEN';
  if ($('transferJourneyPanel')) $('transferJourneyPanel').hidden = false;
  if ($('reportListPanel')) $('reportListPanel').hidden = true;
  if ($('reportPageTitle')) $('reportPageTitle').textContent = 'Chuyển viện & tử vong';
  if ($('reportPageSubtitle')) $('reportPageSubtitle').textContent = 'Theo dõi hành trình, lượt chuyển viện và tử vong.';
  return true;
}

function reportPayload() {
  const name = formatPersonName($('reportPatientName').value || '');
  const gender = $('reportGender').value;
  const birth = String($('reportBirthYear').value || '').trim();
  const bhyt = '';
  const address = String($('reportAddress').value || '').trim();
  const note = String($('reportNote').value || '').trim();
  if (name.length < 2) throw new Error('Vui lòng nhập họ tên bệnh nhân.');
  if (!['Nam', 'Nữ'].includes(gender)) throw new Error('Vui lòng chọn giới tính.');
  if (!validBirthYear(birth)) throw new Error(`Năm sinh phải từ 1900 đến ${new Date().getFullYear()}.`);
  if (address.length > 300) throw new Error('Địa chỉ quá dài.');

  const common = {
    hoTenBenhNhan: name,
    hoTenNorm: normalizeSearch(name),
    gioiTinh: gender,
    namSinh: birth,
    theBHYT: bhyt,
    diaChi: address,
    ghiChu: note
  };

  if (reportState.type === 'CHUYEN_VIEN') {
    const diagnosis = String($('reportDiagnosis').value || '').trim();
    const date = $('reportTransferDate').value;
    const from = String($('reportTransferFrom').value || '').trim();
    const to = String($('reportTransferTo').value || '').trim();
    if (!diagnosis) throw new Error('Vui lòng nhập chẩn đoán.');
    if (!date) throw new Error('Vui lòng chọn ngày chuyển viện.');
    if (!from) throw new Error('Vui lòng nhập nơi chuyển.');
    if (!to) throw new Error('Vui lòng nhập nơi đến.');
    return {
      ...common,
      loaiBaoCao: 'CHUYEN_VIEN',
      ngayBaoCao: date,
      chanDoan: diagnosis,
      ngayChuyenVien: date,
      noiChuyen: from,
      noiDen: to
    };
  }

  const cause = String($('reportCause').value || '').trim();
  const date = $('reportDeathDate').value;
  const place = 'Trung tâm Bảo trợ xã hội Tân Hiệp';
  if (!cause) throw new Error('Vui lòng nhập nguyên nhân tử vong.');
  if (!date) throw new Error('Vui lòng chọn ngày tử vong.');
  if (!place) throw new Error('Vui lòng nhập nơi tử vong.');
  return {
    ...common,
    loaiBaoCao: 'TU_VONG',
    ngayBaoCao: date,
    nguyenNhan: cause,
    ngayTuVong: date,
    noiTuVong: place
  };
}

function comparePatientIdentity(source, payload) {
  const sourceName = normalizeSearch(source.doiTuongNorm || source.doiTuong || source.hoTenNorm || source.hoTenBenhNhan || '');
  const payloadName = normalizeSearch(payload.hoTenNorm || payload.hoTenBenhNhan || '');
  const sourceGender = String(source.gioiTinh || '');
  const payloadGender = String(payload.gioiTinh || '');
  const sourceYear = Number(source.namSinh || 0);
  const payloadYear = Number(payload.namSinh || 0);
  const sameProfile = sourceName === payloadName && sourceGender === payloadGender && sourceYear === payloadYear;
  return sameProfile ? { match: true, conflict: false } : { match: false, conflict: false };
}

async function findJourneyConflict(payload) {
  const snap = await get(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien`));
  const raw = snapshotObject(snap);
  for (const id of Object.keys(raw)) {
    const info = raw[id] && raw[id].thongTin ? raw[id].thongTin : {};
    const identity = comparePatientIdentity(info, payload);
    if (identity.conflict) throw new Error(identity.reason);
    if (!identity.match) continue;
    if (info.trangThaiKyThuat === 'OPEN') return { kind: 'OPEN', info };
    if (info.trangThaiHienTai === 'TU_VONG_TAI_BENH_VIEN') return { kind: 'HOSPITAL_DEATH', info };
  }
  return null;
}

async function findCenterDeathDuplicate(payload, excludeId) {
  const snap = await get(ref(db, `${REPORT_ROOT}/baoCao`));
  const raw = snapshotObject(snap);
  for (const id of Object.keys(raw)) {
    const item = { id, ...(raw[id] || {}) };
    if (!item || item.id === excludeId || item.trangThai === 'deleted' || item.loaiBaoCao !== 'TU_VONG') continue;
    if (!(item.source === 'CENTER_DEATH' || normalizeSearch(item.noiTuVong) === normalizeSearch('Trung tâm Bảo trợ xã hội Tân Hiệp'))) continue;
    const identity = comparePatientIdentity(item, payload);
    if (identity.conflict) throw new Error(identity.reason);
    if (identity.match) return item;
  }
  return null;
}

async function saveReport() {
  if (!canEditReport() || reportState.readonly) return;
  let payload;
  try { payload = reportPayload(); }
  catch (error) { $('reportFormError').textContent = userFacingReportError(error, 'Không thể lưu báo cáo.'); return; }

  const user = auth.currentUser;
  if (!user) { $('reportFormError').textContent = 'Vui lòng đăng nhập lại.'; return; }
  $('reportSave').disabled = true;
  $('reportSave').textContent = 'Đang lưu...';
  try {
    const existing = reportState.editingId
      ? reportState.reports.find((item) => item.id === reportState.editingId) || null
      : null;
    if (!existing) throw new Error('Nghiệp vụ này đã ngừng tạo mới. Tử vong được cập nhật từ hành trình Chuyển viện.');
    if (existing && existing.trangThai === 'deleted') throw new Error('Báo cáo đã bị xóa và không thể chỉnh sửa.');

    if (payload.loaiBaoCao === 'TU_VONG') {
      const journeyConflict = await findJourneyConflict(payload);
      if (journeyConflict && journeyConflict.kind === 'OPEN') {
        throw new Error(`Đối tượng đang có hành trình ngoài Trung tâm tại ${journeyConflict.info.noiHienTai || 'cơ sở y tế'}. Nếu tử vong trong quá trình chuyển viện, hãy cập nhật trạng thái Tử vong tại bệnh viện trên hành trình đó.`);
      }
      if (journeyConflict && journeyConflict.kind === 'HOSPITAL_DEATH') {
        throw new Error('Đối tượng đã được ghi nhận tử vong tại bệnh viện trong một hành trình chuyển viện. Không tạo thêm tử vong tại Trung tâm để tránh đếm trùng.');
      }
      const duplicateDeath = await findCenterDeathDuplicate(payload, existing && existing.id);
      if (duplicateDeath) {
        throw new Error(`Đối tượng đã có bản ghi tử vong tại Trung tâm ngày ${fmtDate(duplicateDeath.ngayBaoCao || duplicateDeath.ngayTuVong || '')}. Vui lòng mở bản ghi hiện có để chỉnh sửa thay vì tạo thêm.`);
      }
    }
    const now = Date.now();
    const generated = reportState.editingId || ((payload.loaiBaoCao === 'TU_VONG' ? 'TV_' : 'CV_') + push(ref(db, `${REPORT_ROOT}/baoCao`)).key);
    const displayName = await preferredDisplayName(user, reportState.permission && reportState.permission.displayName);
    const record = {
      ...payload,
      id: generated,
      trangThai: 'active',
      version: existing ? Number(existing.version || 0) + 1 : 1,
      createdAt: existing ? Number(existing.createdAt || now) : now,
      createdByUid: existing ? String(existing.createdByUid || user.uid) : user.uid,
      createdByEmail: existing ? String(existing.createdByEmail || normalizeEmail(user.email)) : normalizeEmail(user.email),
      createdByName: existing ? String(existing.createdByName || displayName) : displayName,
      updatedAt: now,
      updatedByUid: user.uid,
      updatedByEmail: normalizeEmail(user.email),
      updatedByName: displayName,
      source: payload.loaiBaoCao === 'TU_VONG' && normalizeSearch(payload.noiTuVong) === normalizeSearch('Trung tâm Bảo trợ xã hội Tân Hiệp')
        ? 'CENTER_DEATH'
        : (existing ? String(existing.source || 'APP') : 'APP')
    };

    const historyId = push(ref(db, `${REPORT_ROOT}/lichSu/${generated}`)).key;
    const logId = push(ref(db, `${REPORT_ROOT}/nhatKy/${monthKey(record.ngayBaoCao)}`)).key;
    const updates = {};
    updates[`${REPORT_ROOT}/baoCao/${generated}`] = record;
    updates[`${REPORT_ROOT}/lichSu/${generated}/${historyId}`] = {
      reportId: generated,
      loaiBaoCao: record.loaiBaoCao,
      action: existing ? 'UPDATE' : 'CREATE',
      beforeJson: JSON.stringify(existing || {}),
      afterJson: JSON.stringify(record),
      uid: user.uid,
      email: normalizeEmail(user.email),
      displayName,
      role: effectiveReportRole(),
      createdAt: now
    };
    updates[`${REPORT_ROOT}/nhatKy/${monthKey(record.ngayBaoCao)}/${logId}`] = {
      action: existing ? 'Cập nhật báo cáo' : 'Lập báo cáo',
      content: `${typeLabel(record.loaiBaoCao)} · ${record.hoTenBenhNhan}`,
      reportId: generated,
      loaiBaoCao: record.loaiBaoCao,
      dataDate: record.ngayBaoCao,
      uid: user.uid,
      email: normalizeEmail(user.email),
      displayName,
      role: effectiveReportRole(),
      createdAt: now
    };
    // Legacy CENTER_DEATH records remain editable for data stewardship only.
    // They no longer create public statistics or business events. Remove any old marker when touched.
    if (record.loaiBaoCao === 'TU_VONG' && record.source === 'CENTER_DEATH') {
      if (existing && existing.ngayBaoCao) updates[`${REPORT_ROOT}/congKhaiThongKe/tuVongTheoNgay/${existing.ngayBaoCao}/CENTER_${generated}`] = null;
      if (record.ngayBaoCao) updates[`${REPORT_ROOT}/congKhaiThongKe/tuVongTheoNgay/${record.ngayBaoCao}/CENTER_${generated}`] = null;
    }
    await update(ref(db), updates);
    closeReportForm(true);
    showToast(existing ? 'Đã cập nhật báo cáo.' : 'Đã lưu báo cáo.', 'ok');
    await loadReports(true);
    if (window.YTE_JOURNEYS && typeof window.YTE_JOURNEYS.setSubView === 'function') window.YTE_JOURNEYS.setSubView('history');
  } catch (error) {
    console.error(error);
    $('reportFormError').textContent = userFacingReportError(error, 'Không thể lưu báo cáo.');
  } finally {
    $('reportSave').disabled = false;
    $('reportSave').textContent = 'Lưu báo cáo';
  }
}

async function softDeleteReport(id) {
  if (!canAdminReport()) return;
  const item = reportState.reports.find((row) => row.id === id);
  if (!item) return;
  const confirmed = await confirmInApp({
    title: `Xóa báo cáo ${typeLabel(item.loaiBaoCao)}?`,
    message: `Bạn có chắc muốn xóa báo cáo của ${item.hoTenBenhNhan || 'đối tượng'}? Báo cáo sẽ rời danh sách chính nhưng vẫn được lưu trong lịch sử quản trị.`,
    confirmText: 'Xóa báo cáo',
    cancelText: 'Hủy',
    danger: true
  });
  if (!confirmed) return;
  const user = auth.currentUser;
  const now = Date.now();
  const displayName = await preferredDisplayName(user, reportState.permission && reportState.permission.displayName);
  const record = {
    ...item,
    trangThai: 'deleted',
    deletedAt: now,
    deletedByUid: user.uid,
    deletedByName: displayName,
    updatedAt: now,
    updatedByUid: user.uid,
    updatedByEmail: normalizeEmail(user.email),
    updatedByName: displayName,
    version: Number(item.version || 0) + 1
  };
  const historyId = push(ref(db, `${REPORT_ROOT}/lichSu/${id}`)).key;
  const logId = push(ref(db, `${REPORT_ROOT}/nhatKy/${monthKey(item.ngayBaoCao)}`)).key;
  const updates = {};
  updates[`${REPORT_ROOT}/baoCao/${id}`] = record;
  updates[`${REPORT_ROOT}/lichSu/${id}/${historyId}`] = {
    reportId: id,
    loaiBaoCao: item.loaiBaoCao,
    action: 'DELETE',
    beforeJson: JSON.stringify(item),
    afterJson: JSON.stringify(record),
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName,
    role: effectiveReportRole(),
    createdAt: now
  };
  updates[`${REPORT_ROOT}/nhatKy/${monthKey(item.ngayBaoCao)}/${logId}`] = {
    action: 'Xóa báo cáo',
    content: `${typeLabel(item.loaiBaoCao)} · ${item.hoTenBenhNhan}`,
    reportId: id,
    loaiBaoCao: item.loaiBaoCao,
    dataDate: item.ngayBaoCao,
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName,
    role: effectiveReportRole(),
    createdAt: now
  };
  if (item.loaiBaoCao === 'TU_VONG' && (item.source === 'CENTER_DEATH' || normalizeSearch(item.noiTuVong) === normalizeSearch('Trung tâm Bảo trợ xã hội Tân Hiệp'))) {
    updates[`${REPORT_ROOT}/congKhaiThongKe/tuVongTheoNgay/${item.ngayBaoCao}/CENTER_${id}`] = null;
  }
  await update(ref(db), updates);
  // Legacy center-death cleanup is silent: no new business event is emitted.
  showToast('Đã xóa báo cáo khỏi danh sách.', 'ok');
  await loadReports(true);
}

async function loadReportUsers(force) {
  if (!canAdminReport()) return;
  showInlineState('reportUserLoadState', 'Đang tải danh sách tài khoản...', '', true);
  try {
    const [directorySnap, permissionSnap] = await Promise.all([
      get(ref(db, `${YTE_APP_ROOT}/nguoiDung`)),
      get(ref(db, `${REPORT_ROOT}/phanQuyen`))
    ]);
    const directory = snapshotObject(directorySnap);
    const permissions = snapshotObject(permissionSnap);
    const uids = new Set([...Object.keys(directory), ...Object.keys(permissions)]);
    reportState.users = Array.from(uids).map((uid) => {
      const profile = directory[uid] || {};
      const permission = permissions[uid] || {};
      return {
        uid,
        name: permission.displayName || profile.displayName || permission.email || profile.email || '',
        email: permission.email || profile.email || '',
        role: permission.role || '',
        active: permission.active === true,
        lastLoginAt: profile.lastLoginAt || 0
      };
    }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
    renderReportUsers();
    showInlineState('reportUserLoadState', '', '', false);
  } catch (error) {
    console.error(error);
    showInlineState('reportUserLoadState', userFacingReportError(error, 'Không thể tải danh sách tài khoản.'), 'err', false);
  }
}

function renderReportUsers() {
  const q = normalizeSearch($('reportUserSearch').value || '');
  const rows = reportState.users.filter((item) => !q || normalizeSearch(`${item.name} ${item.email} ${item.role}`).includes(q));
  $('reportUserCount').textContent = reportState.users.length + ' tài khoản';
  if (!rows.length) {
    $('reportUsers').innerHTML = '<div class="empty">Không có tài khoản phù hợp.</div>';
    return;
  }
  const currentUid = auth.currentUser ? auth.currentUser.uid : '';
  $('reportUsers').innerHTML = `<table class="admin-table report-permission-table">
    <thead><tr><th>Họ tên</th><th>Email</th><th>Quyền Báo cáo</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th>Thao tác</th></tr></thead>
    <tbody>${rows.map((item) => {
      const isSelf = item.uid === currentUid;
      let actions = '';
      if (!item.role || !item.active) {
        actions += `<button class="small-btn btn-soft report-user-action" data-kind="grant-viewer" data-id="${esc(item.uid)}">Cấp Xem</button>`;
        actions += `<button class="small-btn btn-soft report-user-action" data-kind="grant-entry" data-id="${esc(item.uid)}">Cấp Nhập liệu</button>`;
        actions += `<button class="small-btn btn-primary report-user-action" data-kind="grant-admin" data-id="${esc(item.uid)}">Cấp Quản trị</button>`;
      } else {
        if (item.role !== 'viewer') actions += `<button class="small-btn btn-soft report-user-action" data-kind="role" data-value="viewer" data-id="${esc(item.uid)}"${isSelf ? ' disabled' : ''}>Cấp Xem</button>`;
        if (item.role !== 'nhaplieu') actions += `<button class="small-btn btn-soft report-user-action" data-kind="role" data-value="nhaplieu" data-id="${esc(item.uid)}"${isSelf ? ' disabled' : ''}>Cấp Nhập liệu</button>`;
        if (item.role !== 'admin') actions += `<button class="small-btn btn-soft report-user-action" data-kind="role" data-value="admin" data-id="${esc(item.uid)}"${isSelf ? ' disabled' : ''}>Cấp Quản trị</button>`;
        actions += `<button class="small-btn btn-danger report-user-action" data-kind="revoke" data-id="${esc(item.uid)}"${isSelf ? ' disabled' : ''}>Thu hồi</button>`;
      }
      return `<tr>
        <td data-label="Họ tên">${esc(item.name)}${isSelf ? ' <span class="meta">(Bạn)</span>' : ''}</td>
        <td data-label="Email">${esc(item.email)}</td>
        <td data-label="Quyền">${esc(roleLabel(item.role))}</td>
        <td data-label="Trạng thái">${item.active ? 'Hoạt động' : 'Chưa cấp'}</td>
        <td data-label="Đăng nhập gần nhất">${esc(fmtDateTime(item.lastLoginAt) || '—')}</td>
        <td data-label="Thao tác">${actions}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

async function setReportUserPermission(uid, role, active) {
  if (!canAdminReport()) return;
  const current = auth.currentUser;
  if (uid === current.uid && (!active || role !== 'admin')) throw new Error('Bạn không thể tự thu hồi hoặc hạ quyền Quản trị đang sử dụng.');
  const profileSnap = await get(ref(db, `${YTE_APP_ROOT}/nguoiDung/${uid}`));
  const profile = snapshotObject(profileSnap);
  if (!profile.email) throw new Error('Tài khoản chưa đăng nhập ứng dụng nên chưa có thông tin để cấp quyền.');
  const permRef = ref(db, `${REPORT_ROOT}/phanQuyen/${uid}`);
  const oldSnap = await get(permRef);
  const old = snapshotObject(oldSnap);
  const now = Date.now();
  await set(permRef, {
    email: normalizeEmail(profile.email),
    displayName: String(profile.displayName || profile.email || '').slice(0, 150),
    role: role || old.role || 'nhaplieu',
    active: active === true,
    source: old.source || 'REPORT_ADMIN',
    createdAt: old.createdAt || now,
    updatedAt: now,
    updatedByUid: current.uid
  });
  showToast(active ? `Đã cấp quyền ${roleLabel(role)}.` : 'Đã thu hồi quyền Báo cáo.', 'ok');
  await loadReportUsers(true);
  if (uid === current.uid) await refreshAccess();
}

async function revokeReportUser(uid) {
  return setReportUserPermission(uid, 'nhaplieu', false);
}

function initEvents() {
  if (reportState.initialized) return;
  reportState.initialized = true;
  $('reportFromDate').value = firstDayOfMonthIso();
  $('reportToDate').value = todayIso();

  document.querySelectorAll('.report-type-tab').forEach((tab) => {
    tab.addEventListener('click', () => setReportType(tab.getAttribute('data-report-type')));
  });
  document.querySelectorAll('.report-mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => setReportMode(tab.getAttribute('data-report-mode')));
  });

  $('moduleTongHopCard').addEventListener('click', () => activateView('dashboard'));
  $('btnReloadReports').addEventListener('click', () => loadReports(true));
  $('reportFromDate').addEventListener('change', () => loadReports(true));
  $('reportToDate').addEventListener('change', () => loadReports(true));
  $('reportSearch').addEventListener('input', renderReports);

  $('reportList').addEventListener('click', async (event) => {
    const button = event.target.closest('.report-action');
    if (!button) return;
    const id = button.getAttribute('data-id');
    const kind = button.getAttribute('data-kind');
    const item = reportState.reports.find((row) => row.id === id);
    if (!item) return;
    if (kind === 'view') populateReportForm(item, true);
    if (kind === 'edit') populateReportForm(item, false);
    if (kind === 'delete') {
      try { await softDeleteReport(id); }
      catch (error) { showToast(userFacingReportError(error), 'err'); }
    }
  });

  $('reportCancel').addEventListener('click', () => closeReportForm(false));
  $('reportCloseX').addEventListener('click', () => closeReportForm(false));
  $('reportSave').addEventListener('click', saveReport);
  $('reportLayer').addEventListener('click', (event) => { if (event.target === $('reportLayer')) closeReportForm(); });

  $('btnReloadReportUsers').addEventListener('click', () => loadReportUsers(true));
  $('reportUserSearch').addEventListener('input', renderReportUsers);
  $('reportUsers').addEventListener('click', async (event) => {
    const button = event.target.closest('.report-user-action');
    if (!button) return;
    const uid = button.getAttribute('data-id');
    const kind = button.getAttribute('data-kind');
    const value = button.getAttribute('data-value');
    try {
      if (kind === 'grant-viewer') await setReportUserPermission(uid, 'viewer', true);
      if (kind === 'grant-entry') await setReportUserPermission(uid, 'nhaplieu', true);
      if (kind === 'grant-admin') await setReportUserPermission(uid, 'admin', true);
      if (kind === 'role') await setReportUserPermission(uid, value, true);
      if (kind === 'revoke') await revokeReportUser(uid);
    } catch (error) {
      showToast(userFacingReportError(error), 'err');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('reportLayer').hidden) closeReportForm();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!isReportDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  setReportType(reportState.type);
}

function start() {
  initEvents();
  onAuthStateChanged(auth, async (user) => {
    reportState.user = user || null;
    if (!user) {
      stopReportRealtime();
      reportState.permission = null;
      reportState.tongHopPermission = null;
      updateModuleUi();
      return;
    }
    try {
      await refreshAccess();
    } catch (error) {
      console.error('Không thể nạp quyền Báo cáo:', error);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
