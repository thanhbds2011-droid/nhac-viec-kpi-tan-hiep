'use strict';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase,
  get,
  onValue,
  push,
  query,
  ref,
  orderByKey,
  startAt,
  endAt,
  serverTimestamp,
  set,
  update
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

import { openReportPreview } from './report-preview.js';
import { downloadXlsx } from './excel-export.js';

const APP_CONFIG = window.YTE_APP_CONFIG || {};
const OWNER_EMAIL = String(APP_CONFIG.OWNER_EMAIL || '').trim().toLowerCase();
const ROOT = 'tongHopYTe';
const REPORT_ROOT = 'baoCaoYTe';
const YTE_APP_ROOT = 'yTeApp';
const PUBLIC_REPORT_STATS_ROOT = `${REPORT_ROOT}/congKhaiThongKe`;
const PERSON_DETAIL_ROOT = `${ROOT}/chiTietChiTieu`;
const APP_RUNTIME_VERSION = '10.0.19';

const firebaseApp = initializeApp(APP_CONFIG.FIREBASE);
const firebaseAuth = getAuth(firebaseApp);
const firebaseDatabase = getDatabase(firebaseApp);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// v10.0.1 - kho quyền dùng chung cho toàn ứng dụng. Chỉ app.js duy trì
// 02 subscription realtime tới permission của user hiện tại; các module khác
// nhận snapshot qua store này để tránh đọc/subscription trùng lặp.
const permissionStoreState = { uid: '', tongHop: null, report: null, ready: false, listeners: new Set() };
function emitPermissionStore() {
  const snapshot = Object.freeze({
    uid: permissionStoreState.uid,
    tongHopPermission: permissionStoreState.tongHop,
    reportPermission: permissionStoreState.report,
    ready: permissionStoreState.ready === true
  });
  permissionStoreState.listeners.forEach((fn) => { try { fn(snapshot); } catch (error) { console.warn('Permission subscriber:', error); } });
  try { window.dispatchEvent(new CustomEvent('yte:permissions-changed', { detail: snapshot })); } catch (_) {}
}
function publishPermissionStore(uid, tongHop, report, ready) {
  permissionStoreState.uid = String(uid || '');
  permissionStoreState.tongHop = tongHop || null;
  permissionStoreState.report = report || null;
  permissionStoreState.ready = ready === true;
  emitPermissionStore();
}
function resetPermissionStore() { publishPermissionStore('', null, null, false); }
window.YTE_PERMISSION_STORE = Object.freeze({
  getSnapshot: function (uid) {
    if (uid && permissionStoreState.uid && String(uid) !== permissionStoreState.uid) return { uid: String(uid), tongHopPermission: null, reportPermission: null, ready: false };
    return { uid: permissionStoreState.uid, tongHopPermission: permissionStoreState.tongHop, reportPermission: permissionStoreState.report, ready: permissionStoreState.ready === true };
  },
  subscribe: function (listener) {
    if (typeof listener !== 'function') return function () {};
    permissionStoreState.listeners.add(listener);
    try { listener(this.getSnapshot()); } catch (_) {}
    return function () { permissionStoreState.listeners.delete(listener); };
  }
});

const authPersistenceReady = setPersistence(firebaseAuth, browserLocalPersistence).catch((error) => {
  console.warn('Không thiết lập được Firebase Auth persistence:', error);
});

const authReady = new Promise((resolve) => {
  const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
    unsubscribe();
    resolve(user || null);
  });
});

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
function notifyBusinessEvent(eventType, resourceId, extra) {
  const api = window.YTE_NOTIFICATIONS;
  if (!api || typeof api.notifyBusinessEvent !== 'function') return;
  void api.notifyBusinessEvent(eventType, resourceId, extra);
}
function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
}
function normalizeCategoryCode(value) {
  let text = String(value || '').trim().toLocaleUpperCase('vi-VN');
  text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D');
  text = text.replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
  return text.slice(0, 60);
}
function normalizeMetricText(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function metricKindFromCategory(item) {
  const name = normalizeMetricText(item && (item.name || item.ten) || '');
  const code = normalizeCategoryCode(item && (item.code || item.ma) || '');
  if (['chuyen vien', 'luot chuyen vien', 'so luot chuyen vien'].includes(name) || ['CHUYEN_VIEN', 'CHUYENVIEN'].includes(code)) return 'transfer';
  if (['tu vong', 'luot tu vong', 'so tu vong', 'so luot tu vong'].includes(name) || ['TU_VONG', 'TUVONG'].includes(code)) return 'death';
  return '';
}
function personDetailKindFromCategory(item) {
  const name = normalizeMetricText(item && (item.name || item.ten) || '');
  const code = normalizeCategoryCode(item && (item.code || item.ma) || '');
  if (name === 'dieu tri lao' || ['DIEU_TRI_LAO','DIEUTRILAO'].includes(code)) return 'tb';
  if (['chuyen trung tam','chuyen ve trung tam','chuyen vao trung tam'].includes(name) || ['CHUYEN_TRUNG_TAM','CHUYENTRUNGTAM','CHUYEN_VE_TRUNG_TAM','CHUYENVETRUNGTAM'].includes(code)) return 'center';
  return '';
}
function decorateCategory(item) {
  const category = { ...item };
  category.derivedKind = metricKindFromCategory(category);
  category.personDetailKind = personDetailKindFromCategory(category);
  return category;
}
function isPersonDetailCategory(item) { return !!personDetailKindFromCategory(item); }
function isTrainingCategory(item) {
  const group = normalizeMetricText(item && (item.group || item.nhom) || '');
  const name = normalizeMetricText(item && (item.name || item.ten) || '');
  return group === 'tap huan' || name.startsWith('tap huan ');
}
function markerCount(raw, kind) {
  return Object.keys(raw || {}).filter((key) => {
    const active = raw[key] === true || raw[key] === 1 || raw[key] === '1';
    if (!active) return false;
    // Nghiệp vụ tử vong tại Trung tâm đã ngừng sử dụng từ v9.9.0.
    // Giữ dữ liệu legacy trong Firebase nhưng không đưa CENTER_* vào số liệu tự động.
    if (kind === 'death' && /^CENTER_/i.test(String(key))) return false;
    return true;
  }).length;
}
function derivedCategory(categories, kind) {
  return (categories || []).find((item) => metricKindFromCategory(item) === kind) || null;
}
function mergeDerivedDailyRecords(records, categories, date, transferRaw, deathRaw) {
  const map = new Map((records || []).map((item) => [item.code, item]));
  const transfer = derivedCategory(categories, 'transfer');
  const death = derivedCategory(categories, 'death');
  function applyDerived(category, kind, raw) {
    if (!category) return;
    const autoValue = markerCount(raw, kind);
    const stored = map.get(category.code) || null;
    if (!stored && autoValue === 0) return;
    map.set(category.code, {
      ...(stored || {}),
      id: `${date}-${category.code}`,
      date,
      code: category.code,
      name: category.name,
      value: autoValue,
      autoValue,
      note: '',
      autoDerived: true,
      derivedKind: kind,
      manualOverride: false,
      sourceLocked: true
    });
  }
  applyDerived(transfer, 'transfer', transferRaw);
  applyDerived(death, 'death', deathRaw);
  return Array.from(map.values());
}
function mergeDerivedRangeRecords(records, categories, transferByDate, deathByDate, from, to) {
  const map = new Map((records || []).map((item) => [item.id, item]));
  const transfer = derivedCategory(categories, 'transfer');
  const death = derivedCategory(categories, 'death');
  const derivedCodes = new Set([transfer && transfer.code, death && death.code].filter(Boolean));
  const dates = new Set([
    ...Object.keys(transferByDate || {}),
    ...Object.keys(deathByDate || {}),
    ...(records || []).filter((item) => derivedCodes.has(item.code)).map((item) => item.date)
  ]);
  function applyDerived(date, category, kind, raw) {
    if (!category) return;
    const id = `${date}-${category.code}`;
    const autoValue = markerCount(raw, kind);
    const stored = map.get(id) || null;
    if (!stored && autoValue === 0) return;
    map.set(id, {
      ...(stored || {}),
      id,
      date,
      code: category.code,
      name: category.name,
      value: autoValue,
      autoValue,
      note: '',
      autoDerived: true,
      derivedKind: kind,
      manualOverride: false,
      sourceLocked: true
    });
  }
  dates.forEach((date) => {
    if (date < from || date > to) return;
    applyDerived(date, transfer, 'transfer', (transferByDate || {})[date] || {});
    applyDerived(date, death, 'death', (deathByDate || {})[date] || {});
  });
  return Array.from(map.values());
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(Number(value || Date.now()));
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(date);
}
function todayIsoVietnam() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function monthKey(dateIso) {
  return String(dateIso || '').slice(0, 7);
}
function providerId(user) {
  const providers = (user && user.providerData) || [];
  if (providers.some((item) => item && item.providerId === 'password')) return 'password';
  if (providers.some((item) => item && item.providerId === 'google.com')) return 'google.com';
  return providers[0] && providers[0].providerId ? providers[0].providerId : '';
}
function uiRole(role) {
  return role === 'admin' ? 'Quản trị' : role === 'nhaplieu' ? 'Nhập liệu' : role === 'viewer' ? 'Xem' : '';
}
function dbRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'admin' || value === 'quản trị' || value === 'quan tri') return 'admin';
  if (value === 'viewer' || value === 'xem' || value === 'chỉ xem' || value === 'chi xem') return 'viewer';
  return 'nhaplieu';
}
function uiReportRole(role) {
  return role === 'admin' ? 'Quản trị' : role === 'nhaplieu' ? 'Nhập liệu' : role === 'viewer' ? 'Xem' : 'Chưa cấp';
}
function dbReportRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'admin' || value === 'quản trị' || value === 'quan tri') return 'admin';
  if (value === 'viewer' || value === 'xem' || value === 'chỉ xem' || value === 'chi xem') return 'viewer';
  return 'nhaplieu';
}
function uiStatus(active) {
  return active === true ? 'Hoạt động' : 'Khóa';
}
function snapshotObject(snapshot) {
  return snapshot && snapshot.exists() ? (snapshot.val() || {}) : {};
}
async function readOptionalSnapshot(referenceOrQuery) {
  try { return snapshotObject(await get(referenceOrQuery)); }
  catch (error) { console.warn('Không đọc được thống kê tự động:', error); return {}; }
}
function formatPersonName(value) {
  let text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  // Chuẩn hóa khoảng trắng quanh ngoặc và dấu gạch nối trước khi title-case.
  text = text.replace(/\s*\(\s*/g, ' (').replace(/\s+\)/g, ')').replace(/\s*-\s*/g, '-').trim();
  text = text.toLocaleLowerCase('vi-VN');
  // Viết hoa đầu chuỗi, đầu mỗi từ, sau dấu ngoặc mở và sau dấu gạch nối.
  return text.replace(/(^|[\s(-])(\p{L})/gu, (match, prefix, letter) => prefix + letter.toLocaleUpperCase('vi-VN'));
}
function formatHumanNameOrFallback(value) {
  const text = String(value || '').trim();
  if (!text || text.includes('@') || text === 'Quản trị hệ thống' || /^[A-Za-z0-9_-]{20,}$/.test(text)) return text;
  return formatPersonName(text);
}
async function preferredDisplayNameForUid(uid, fallback) {
  if (!uid) return String(fallback || '').trim();
  const raw = await readOptionalSnapshot(ref(firebaseDatabase, `${YTE_APP_ROOT}/tenHienThi/${uid}`));
  return formatHumanNameOrFallback(raw.displayName || fallback || '').slice(0, 150);
}
function ownerUser(user) {
  return !!(user && normalizeEmail(user.email) === OWNER_EMAIL);
}

async function ensureYteUserProfile(user) {
  if (!user) return;
  const profileRef = ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung/${user.uid}`);
  const snap = await get(profileRef);
  const old = snapshotObject(snap);
  const now = Date.now();
  await update(profileRef, {
    email: normalizeEmail(user.email),
    displayName: formatHumanNameOrFallback(user.displayName || old.displayName || user.email || '').slice(0, 150),
    photoURL: String(user.photoURL || old.photoURL || '').slice(0, 1000),
    provider: providerId(user),
    active: true,
    createdAt: old.createdAt || now,
    updatedAt: now,
    lastLoginAt: now
  });
}

async function ensureReportOwnerPermission(user) {
  if (!ownerUser(user)) return;
  const permissionRef = ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${user.uid}`);
  const snap = await get(permissionRef);
  const old = snapshotObject(snap);
  if (old.active === true && old.role === 'admin' && normalizeEmail(old.email) === normalizeEmail(user.email)) return;
  const now = Date.now();
  await update(permissionRef, {
    email: normalizeEmail(user.email),
    displayName: formatHumanNameOrFallback(user.displayName || old.displayName || 'Quản trị hệ thống').slice(0, 150),
    role: 'admin',
    active: true,
    source: old.source || 'OWNER_BOOTSTRAP',
    createdAt: old.createdAt || now,
    updatedAt: now
  });
}

async function getOwnReportPermission(user) {
  if (!user) return null;
  if (ownerUser(user)) await ensureReportOwnerPermission(user);
  const snap = await get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${user.uid}`));
  return snap.exists() ? snap.val() : null;
}

function validModulePermission(permission) {
  return !!(permission && permission.active === true && ['admin', 'nhaplieu', 'viewer'].includes(permission.role));
}
function effectivePermissionRole(tongHopPermission, reportPermission, user) {
  if (ownerUser(user)) return 'admin';
  const roles = [tongHopPermission, reportPermission]
    .filter(validModulePermission)
    .map((permission) => permission.role);
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('nhaplieu')) return 'nhaplieu';
  if (roles.includes('viewer')) return 'viewer';
  return '';
}
function effectivePermissionRecord(user, tongHopPermission, reportPermission, preferredName) {
  const role = effectivePermissionRole(tongHopPermission, reportPermission, user);
  if (!role) return null;
  const preferred = [tongHopPermission, reportPermission].find((permission) => validModulePermission(permission) && permission.role === role)
    || [tongHopPermission, reportPermission].find(validModulePermission)
    || {};
  return {
    ...preferred,
    email: normalizeEmail((user && user.email) || preferred.email),
    displayName: formatHumanNameOrFallback(preferredName || preferred.displayName || (user && user.displayName) || (user && user.email) || ''),
    role,
    active: true,
    source: preferred.source || 'EFFECTIVE_APP_PERMISSION'
  };
}

async function writeAuditLog(user, action, content, dataDate) {
  if (!user) return;
  const keyMonth = monthKey(dataDate) || new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit'
  }).format(new Date()).slice(0, 7);
  const logRef = push(ref(firebaseDatabase, `${ROOT}/nhatKy/${keyMonth}`));
  await set(logRef, {
    action: String(action || '').slice(0, 100),
    content: String(content || '').slice(0, 1000),
    dataDate: dataDate || '',
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName: formatHumanNameOrFallback((user.appPermission && user.appPermission.displayName) || user.displayName || user.email || '').slice(0, 150),
    role: user.appRole || '',
    createdAt: serverTimestamp()
  });
}

async function ensureOwnerPermission(user) {
  if (!ownerUser(user)) return;
  const permissionRef = ref(firebaseDatabase, `${ROOT}/phanQuyen/${user.uid}`);
  const snap = await get(permissionRef);
  const old = snapshotObject(snap);
  if (old.active === true && old.role === 'admin' && normalizeEmail(old.email) === normalizeEmail(user.email)) return;
  await update(permissionRef, {
    email: normalizeEmail(user.email),
    displayName: formatHumanNameOrFallback(user.displayName || 'Quản trị hệ thống').slice(0, 150),
    username: normalizeUsername(old.username || String(user.email || '').split('@')[0]),
    role: 'admin',
    active: true,
    source: old.source || 'OWNER_BOOTSTRAP',
    createdAt: old.createdAt || Date.now(),
    updatedAt: Date.now()
  });
}

async function ensureRegistrationRequest(user, profile) {
  if (!user) throw new Error('Chưa xác định được tài khoản. Vui lòng đăng nhập lại.');
  const requestRef = ref(firebaseDatabase, `${ROOT}/yeuCauDangKy/${user.uid}`);
  const snap = await get(requestRef);
  const existing = snapshotObject(snap);
  if (existing.status === 'pending' || existing.status === 'approved' || existing.status === 'rejected') return existing;

  const displayName = formatHumanNameOrFallback((profile && profile.displayName) || user.displayName || user.email || '').slice(0, 150);
  const username = normalizeUsername(
    (profile && profile.username) || existing.username || String(user.email || '').split('@')[0]
  );
  const request = {
    email: normalizeEmail(user.email),
    displayName: displayName,
    username: username,
    provider: providerId(user),
    status: 'pending',
    requestedAt: Date.now()
  };
  await set(requestRef, request);
  notifyBusinessEvent('ACCOUNT_PENDING', user.uid);
  return request;
}

async function getOwnPermission(user) {
  if (!user) return null;
  if (ownerUser(user)) await ensureOwnerPermission(user);
  const snap = await get(ref(firebaseDatabase, `${ROOT}/phanQuyen/${user.uid}`));
  return snap.exists() ? snap.val() : null;
}

async function readOwnPermissionPair(user) {
  if (!user) return { permission: null, reportPermission: null };
  // v10.0.1: sau khi 02 listener quyền trung tâm đã sẵn sàng, mọi nghiệp vụ
  // dùng snapshot chung thay vì phát sinh thêm get() cho cùng UID. Khi bootstrap
  // chưa sẵn sàng mới đọc trực tiếp một lần để không làm chậm đăng nhập.
  const sharedStore = window.YTE_PERMISSION_STORE;
  const shared = sharedStore && typeof sharedStore.getSnapshot === 'function'
    ? sharedStore.getSnapshot(user.uid)
    : null;
  if (shared && shared.ready === true && shared.uid === user.uid) {
    return {
      permission: shared.tongHopPermission || null,
      reportPermission: shared.reportPermission || null
    };
  }
  if (ownerUser(user)) {
    await Promise.allSettled([ensureOwnerPermission(user), ensureReportOwnerPermission(user)]);
  }
  const results = await Promise.allSettled([
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen/${user.uid}`)),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${user.uid}`))
  ]);
  function valueAt(index, label) {
    const result = results[index];
    if (result.status === 'fulfilled') return result.value && result.value.exists() ? result.value.val() : null;
    console.warn('Không đọc được quyền ' + label + ':', result.reason);
    return null;
  }
  return { permission: valueAt(0, 'Tổng hợp'), reportPermission: valueAt(1, 'Báo cáo') };
}

function permissionToUser(user, permission) {
  return {
    id: user.uid,
    uid: user.uid,
    name: String(permission.displayName || user.displayName || user.email || ''),
    username: String(permission.username || ''),
    email: normalizeEmail(user.email || permission.email),
    role: uiRole(permission.role),
    status: uiStatus(permission.active),
    active: permission.active === true,
    forcePasswordChange: false,
    provider: providerId(user),
    lastLogin: permission.lastLoginAt ? formatDateTime(permission.lastLoginAt) : ''
  };
}

async function resolveApplicationAccess(user, profile) {
  if (!user) return {
    success: true,
    active: false,
    tongHopActive: false,
    authenticated: false,
    pending: false,
    user: null,
    authUser: null,
    tongHopPermission: null,
    reportPermission: null,
    categories: []
  };

  await ensureYteUserProfile(user);

  const permissionPair = await readOwnPermissionPair(user);
  const permission = permissionPair.permission;
  const reportPermission = permissionPair.reportPermission;
  const preferredName = await preferredDisplayNameForUid(
    user.uid,
    (permission && permission.displayName) || (reportPermission && reportPermission.displayName) || user.displayName || user.email || ''
  );
  if (permission) permission.displayName = preferredName;
  if (reportPermission) reportPermission.displayName = preferredName;

  // v10.0.8: vai trò có hiệu lực là vai trò cao nhất đang hoạt động ở một trong
  // hai namespace tongHopYTe/phanQuyen hoặc baoCaoYTe/phanQuyen. Điều này giữ
  // backward compatibility cho tài khoản cũ và bảo đảm viewer/nhaplieu/admin
  // đều vào được đúng chức năng sau khi được cấp quyền.
  const effectivePermission = effectivePermissionRecord(user, permission, reportPermission, preferredName);
  if (effectivePermission) {
    return {
      success: true,
      active: true,
      tongHopActive: validModulePermission(permission),
      authenticated: true,
      pending: false,
      token: 'FIREBASE_AUTH',
      authUser: {
        uid: user.uid,
        email: normalizeEmail(user.email),
        name: preferredName || user.displayName || user.email || '',
        provider: providerId(user)
      },
      user: permissionToUser(user, effectivePermission),
      tongHopPermission: permission || null,
      reportPermission: reportPermission || null,
      effectiveRole: effectivePermission.role,
      categories: await readPrivateCategories(true)
    };
  }

  // Đã xác thực nhưng chưa có quyền hoạt động: vẫn được xem Tổng quan công khai.
  // Yêu cầu đăng ký chỉ dùng để quản trị cấp quyền, không làm mất Dashboard public.
  const request = await ensureRegistrationRequest(user, profile);
  const locked = !!((permission && permission.active === false) || (reportPermission && reportPermission.active === false));
  return {
    success: true,
    active: false,
    tongHopActive: false,
    authenticated: true,
    pending: request.status === 'pending',
    rejected: request.status === 'rejected',
    locked,
    authUser: {
      uid: user.uid,
      email: normalizeEmail(user.email),
      name: preferredName || user.displayName || user.email || '',
      provider: providerId(user)
    },
    user: null,
    tongHopPermission: permission || null,
    reportPermission: reportPermission || null,
    categories: [],
    message: request.status === 'rejected'
      ? 'Tài khoản chưa được cấp quyền sử dụng ứng dụng.'
      : (locked ? 'Tài khoản hiện chưa có quyền hoạt động.' : '')
  };
}

async function requireAppUser(requiredRole) {
  await authReady;
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Vui lòng đăng nhập.');
  const permissionPair = await readOwnPermissionPair(user);
  const permission = permissionPair.permission;
  const reportPermission = permissionPair.reportPermission;
  const role = effectivePermissionRole(permission, reportPermission, user);
  if (!['admin', 'nhaplieu'].includes(role)) {
    throw new Error('Tài khoản chưa được cấp quyền Nhập liệu hoặc đã bị khóa.');
  }
  if (requiredRole === 'admin' && role !== 'admin') {
    throw new Error('Bạn không có quyền Quản trị hệ thống.');
  }
  const preferredName = await preferredDisplayNameForUid(user.uid,
    (permission && permission.displayName) || (reportPermission && reportPermission.displayName) || user.displayName || user.email || '');
  user.appRole = role;
  user.appPermission = effectivePermissionRecord(user, permission, reportPermission, preferredName);
  return user;
}

async function requireAnyYteViewer() {
  await authReady;
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Vui lòng đăng nhập để xem dữ liệu chi tiết.');
  const permissionPair = await readOwnPermissionPair(user);
  const tongHopPermission = permissionPair.permission;
  const reportPermission = permissionPair.reportPermission;
  const role = effectivePermissionRole(tongHopPermission, reportPermission, user);
  if (!role) throw new Error('Tài khoản chưa được cấp quyền xem dữ liệu chi tiết.');
  return { user, tongHopPermission, reportPermission, effectiveRole: role };
}

async function readPublicCategories() {
  const snap = await get(ref(firebaseDatabase, `${ROOT}/congKhai/danhMucChiTieu`));
  const raw = snapshotObject(snap);
  return Object.keys(raw).map((code) => {
    const item = raw[code] || {};
    return decorateCategory({
      code,
      name: item.ten || code,
      group: item.nhom || 'Khác',
      unit: item.donVi || 'Lượt',
      order: Number(item.thuTu || 9999),
      status: item.trangThai || 'Hoạt động'
    });
  }).filter((item) => item.status === 'Hoạt động')
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'));
}

async function readPrivateCategories(activeOnly) {
  const snap = await get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu`));
  const raw = snapshotObject(snap);
  return Object.keys(raw).map((code) => {
    const item = raw[code] || {};
    return decorateCategory({
      code,
      name: item.ten || code,
      group: item.nhom || 'Khác',
      unit: item.donVi || 'Lượt',
      order: Number(item.thuTu || 9999),
      status: item.trangThai || 'Hoạt động'
    });
  }).filter((item) => !activeOnly || item.status === 'Hoạt động')
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'));
}

async function getDashboardDataFirebase(filter) {
  const from = String(filter && filter.from || '');
  const to = String(filter && filter.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error('Khoảng thời gian không hợp lệ.');
  }
  let usePrivate = false;
  if (firebaseAuth.currentUser) {
    try {
      const pair = await readOwnPermissionPair(firebaseAuth.currentUser);
      usePrivate = !!effectivePermissionRole(pair.permission, pair.reportPermission, firebaseAuth.currentUser);
    } catch (_) { usePrivate = false; }
  }
  let categories = usePrivate ? await readPrivateCategories(true) : await readPublicCategories();
  if (!categories.length && usePrivate) categories = await readPublicCategories();
  const dataRoot = usePrivate ? `${ROOT}/soLieuTheoNgay` : `${ROOT}/congKhai/soLieuTheoNgay`;
  const dataQuery = query(ref(firebaseDatabase, dataRoot), orderByKey(), startAt(from), endAt(to));
  const transferQuery = query(ref(firebaseDatabase, `${PUBLIC_REPORT_STATS_ROOT}/chuyenVienTheoNgay`), orderByKey(), startAt(from), endAt(to));
  const deathQuery = query(ref(firebaseDatabase, `${PUBLIC_REPORT_STATS_ROOT}/tuVongTheoNgay`), orderByKey(), startAt(from), endAt(to));
  const snap = await get(dataQuery);
  const [transferRaw, deathRaw] = await Promise.all([readOptionalSnapshot(transferQuery), readOptionalSnapshot(deathQuery)]);
  const hasTransfer = Object.keys(transferRaw || {}).some((date) => markerCount((transferRaw || {})[date] || {}, 'transfer') > 0);
  const hasDeath = Object.keys(deathRaw || {}).some((date) => markerCount((deathRaw || {})[date] || {}, 'death') > 0);
  if (hasTransfer && !derivedCategory(categories, 'transfer')) categories.push(decorateCategory({ code:'CHUYEN_VIEN', name:'Chuyển viện', group:'Báo cáo', unit:'Lượt', order:9001, status:'Hoạt động' }));
  if (hasDeath && !derivedCategory(categories, 'death')) categories.push(decorateCategory({ code:'TU_VONG', name:'Tử vong', group:'Báo cáo', unit:'Lượt', order:9002, status:'Hoạt động' }));
  categories.sort((a,b)=>a.order-b.order || a.name.localeCompare(b.name,'vi'));
  const raw = snapshotObject(snap);
  const records = [];
  Object.keys(raw).sort().forEach((date) => {
    const day = raw[date] || {};
    Object.keys(day).forEach((code) => {
      const item = day[code] || {};
      records.push({ id: `${date}-${code}`, date, code, name: item.ten || code, value: Number(item.giaTri || 0), note: usePrivate ? String(item.ghiChu || '') : '', updatedAt: item.updatedAt || 0, version: Number(item.version || 0) });
    });
  });
  const merged = mergeDerivedRangeRecords(records, categories, transferRaw, deathRaw, from, to);
  return { success: true, from, to, categories, records: merged, generatedAt: formatDateTime(new Date()) };
}

function journeyStatusLabel(value) {
  const labels = {
    DANG_THEO_DOI: 'Đang theo dõi',
    TAI_KHAM: 'Tái khám',
    DANG_DIEU_TRI: 'Đang điều trị',
    CHUYEN_TIEP_BENH_VIEN_KHAC: 'Chuyển tiếp bệnh viện khác',
    TU_VONG_TAI_BENH_VIEN: 'Tử vong tại bệnh viện',
    TU_VONG_TAI_NOI_KHAC: 'Tử vong tại nơi khác',
    DA_VE_TRUNG_TAM: 'Đã về Trung tâm'
  };
  return labels[String(value || '')] || 'Đang cập nhật';
}

function sourceCaseIdFromMarker(markerKey, kind) {
  const key = String(markerKey || '');
  if (!key) return '';
  if (kind === 'death') {
    if (/^CENTER_/i.test(key)) return '';
    return key.replace(/^(HOSP_|OTHER_)/i, '');
  }
  return key;
}

async function getDerivedSourceDetailsFirebase(filter) {
  await requireAnyYteViewer();
  const kind = String(filter && filter.kind || '').toLowerCase();
  const from = String(filter && filter.from || '');
  const to = String(filter && filter.to || '');
  if (!['transfer', 'death'].includes(kind)) throw new Error('Loại dữ liệu nguồn không hợp lệ.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error('Khoảng thời gian không hợp lệ.');
  }
  const statsPath = kind === 'death' ? 'tuVongTheoNgay' : 'chuyenVienTheoNgay';
  const statsQuery = query(ref(firebaseDatabase, `${PUBLIC_REPORT_STATS_ROOT}/${statsPath}`), orderByKey(), startAt(from), endAt(to));
  const stats = snapshotObject(await get(statsQuery));
  const markers = [];
  Object.keys(stats).sort().forEach((date) => {
    const day = stats[date] || {};
    Object.keys(day).forEach((markerKey) => {
      const active = day[markerKey] === true || day[markerKey] === 1 || day[markerKey] === '1';
      if (!active) return;
      const caseId = sourceCaseIdFromMarker(markerKey, kind);
      if (!caseId) return;
      markers.push({ date, markerKey, caseId });
    });
  });
  const uniqueIds = Array.from(new Set(markers.map((item) => item.caseId)));
  const casePairs = await Promise.all(uniqueIds.map(async (caseId) => {
    try {
      const snap = await get(ref(firebaseDatabase, `${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}`));
      return [caseId, snap.exists() ? (snap.val() || {}) : null];
    } catch (error) {
      if (/PERMISSION_DENIED|permission_denied/i.test(String(error && error.message || error))) throw error;
      console.warn('Không đọc được hồ sơ nguồn:', caseId, error);
      return [caseId, null];
    }
  }));
  const caseMap = new Map(casePairs);
  const rows = markers.map((marker) => {
    const raw = caseMap.get(marker.caseId) || {};
    const info = raw.thongTin && typeof raw.thongTin === 'object' ? raw.thongTin : {};
    if (!Object.keys(info).length) return null;
    const stagesRaw = raw.chang && typeof raw.chang === 'object' ? raw.chang : {};
    const stages = Object.keys(stagesRaw).map((id) => ({ id, ...(stagesRaw[id] || {}) }))
      .sort((a, b) => Number(a.thuTu || 0) - Number(b.thuTu || 0));
    const first = stages[0] || {};
    const last = stages[stages.length - 1] || {};
    const status = String(info.trangThaiHienTai || '');
    const isOtherDeath = /^OTHER_/i.test(marker.markerKey) || status === 'TU_VONG_TAI_NOI_KHAC';
    const isHospitalDeath = /^HOSP_/i.test(marker.markerKey) || status === 'TU_VONG_TAI_BENH_VIEN';
    return {
      id: marker.caseId,
      markerKey: marker.markerKey,
      kind,
      name: formatPersonName(info.doiTuong) || 'Đối tượng',
      birthYear: info.namSinh == null ? '' : String(info.namSinh),
      gender: String(info.gioiTinh || ''),
      date: marker.date,
      from: String(first.noiDi || info.noiDiBanDau || 'Trung tâm Bảo trợ xã hội Tân Hiệp'),
      to: String(first.noiDen || info.noiHienTai || ''),
      currentPlace: String(info.noiHienTai || last.noiDen || ''),
      status,
      statusLabel: journeyStatusLabel(status),
      deathType: kind === 'death' ? (isOtherDeath ? 'Tử vong tại nơi khác' : isHospitalDeath ? 'Tử vong tại bệnh viện' : 'Tử vong') : '',
      deathPlace: kind === 'death' ? String(info.noiTuVong || last.noiDen || info.noiHienTai || '') : ''
    };
  }).filter(Boolean);
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.name).localeCompare(String(b.name), 'vi'));
  return { success: true, kind, from, to, rows };
}

async function ensurePublicCategoryMirrorFirebase() {
  await requireReportPermissionManager();
  const snap = await get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu`));
  const raw = snapshotObject(snap);
  const updates = {};
  Object.keys(raw).forEach((code) => {
    const item = raw[code] || {};
    updates[`${ROOT}/congKhai/danhMucChiTieu/${code}`] = {
      ma: code,
      ten: String(item.ten || code),
      nhom: String(item.nhom || 'Khác'),
      donVi: String(item.donVi || 'Lượt'),
      thuTu: Number(item.thuTu || 9999),
      trangThai: String(item.trangThai || 'Hoạt động'),
      updatedAt: Date.now()
    };
  });
  if (Object.keys(updates).length) await update(ref(firebaseDatabase), updates);
  return { success: true, repaired: Object.keys(updates).length };
}

async function ensureReportStatisticsMarkersFirebase() {
  await authReady;
  const user = firebaseAuth.currentUser;
  if (!user) return { success:false, repaired:0 };
  const pair = await readOwnPermissionPair(user);
  const tp = pair.permission, rp = pair.reportPermission;
  const effectiveRole = effectivePermissionRole(tp, rp, user);
  if (!['admin','nhaplieu'].includes(effectiveRole)) return { success:false, repaired:0 };
  const snap = await get(ref(firebaseDatabase, `${REPORT_ROOT}/hanhTrinhChuyenVien`));
  const raw = snapshotObject(snap);
  const updates = {};
  Object.keys(raw).forEach((caseId) => {
    const record = raw[caseId] || {};
    const info = record.thongTin && typeof record.thongTin === 'object' ? record.thongTin : {};
    let transferDate = String(info.ngayChuyenVien || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) {
      const ts = Number(info.ngayGioDi || info.createdAt || 0);
      if (ts) transferDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts));
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) updates[`${PUBLIC_REPORT_STATS_ROOT}/chuyenVienTheoNgay/${transferDate}/${caseId}`] = true;
    const status = String(info.trangThaiHienTai || '');
    if (status === 'TU_VONG_TAI_BENH_VIEN' || status === 'TU_VONG_TAI_NOI_KHAC') {
      let deathDate = String(info.ngayTuVong || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deathDate)) {
        const ts = Number(info.updatedAt || 0);
        if (ts) deathDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts));
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(deathDate)) {
        const prefix = status === 'TU_VONG_TAI_NOI_KHAC' ? 'OTHER_' : 'HOSP_';
        updates[`${PUBLIC_REPORT_STATS_ROOT}/tuVongTheoNgay/${deathDate}/${prefix}${caseId}`] = true;
      }
    }
  });
  if (Object.keys(updates).length) await update(ref(firebaseDatabase), updates);
  return { success:true, repaired:Object.keys(updates).length };
}

async function personDetailCategoryFirebase(code) {
  const normalized = normalizeCategoryCode(code);
  if (!normalized) throw new Error('Chỉ tiêu không hợp lệ.');
  let snap = await get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu/${normalized}`)).catch(() => null);
  if (!snap || !snap.exists()) snap = await get(ref(firebaseDatabase, `${ROOT}/congKhai/danhMucChiTieu/${normalized}`)).catch(() => null);
  if (!snap || !snap.exists()) throw new Error('Không tìm thấy chỉ tiêu.');
  const item = snap.val() || {};
  const category = decorateCategory({ code:normalized, name:item.ten || normalized, group:item.nhom || 'Khác', unit:item.donVi || 'Lượt', order:Number(item.thuTu || 9999), status:item.trangThai || 'Hoạt động' });
  if (category.status !== 'Hoạt động' || !category.personDetailKind) throw new Error('Chỉ tiêu này không sử dụng danh sách đối tượng chi tiết.');
  return category;
}
async function personDetailDiagnosticFirebase(code, date) {
  const normalized = normalizeCategoryCode(code);
  const [privateCategorySnap, publicCategorySnap, privateSummarySnap, publicSummarySnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu/${normalized}`)).catch(() => null),
    get(ref(firebaseDatabase, `${ROOT}/congKhai/danhMucChiTieu/${normalized}`)).catch(() => null),
    date ? get(ref(firebaseDatabase, `${ROOT}/soLieuTheoNgay/${date}/${normalized}`)).catch(() => null) : Promise.resolve(null),
    date ? get(ref(firebaseDatabase, `${ROOT}/congKhai/soLieuTheoNgay/${date}/${normalized}`)).catch(() => null) : Promise.resolve(null)
  ]);
  const privateCategory = privateCategorySnap && privateCategorySnap.exists() ? privateCategorySnap.val() : null;
  const publicCategory = publicCategorySnap && publicCategorySnap.exists() ? publicCategorySnap.val() : null;
  return {
    code: normalized,
    privateCategory,
    publicCategory,
    privateVersion: privateSummarySnap && privateSummarySnap.exists() ? Number(privateSummarySnap.child('version').val() || 0) : 0,
    publicVersion: publicSummarySnap && publicSummarySnap.exists() ? Number(publicSummarySnap.child('version').val() || 0) : 0
  };
}
function normalizePersonIdentity(value) { return normalizeMetricText(formatPersonName(value)); }
function activePersonRows(raw) {
  return Object.keys(raw || {}).map((id) => {
    const item = { id, ...(raw[id] || {}) };
    if (item.hoTen) item.hoTen = formatPersonName(item.hoTen);
    return item;
  }).filter((item) => String(item.status || 'ACTIVE') !== 'DELETED');
}
async function getPersonDetailListFirebase(payload) {
  await requireAnyYteViewer();
  const date = String(payload && payload.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ngày không hợp lệ.');
  const category = await personDetailCategoryFirebase(payload && payload.code);
  const [snap, summarySnap] = await Promise.all([
    get(ref(firebaseDatabase, `${PERSON_DETAIL_ROOT}/${date}/${category.code}`)),
    get(ref(firebaseDatabase, `${ROOT}/congKhai/soLieuTheoNgay/${date}/${category.code}`)).catch(() => null)
  ]);
  const rows = activePersonRows(snapshotObject(snap)).sort((a,b)=>String(a.hoTen||'').localeCompare(String(b.hoTen||''),'vi'));
  const totalValue = summarySnap && summarySnap.exists() ? Number(summarySnap.child('giaTri').val() || 0) : rows.length;
  return { success:true, date, category, rows, totalValue, unresolvedCount:Math.max(0,totalValue-rows.length) };
}
async function getPersonDetailRangeFirebase(payload) {
  await requireAnyYteViewer();
  const from = String(payload && payload.from || ''), to = String(payload && payload.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error('Khoảng ngày không hợp lệ.');
  const category = await personDetailCategoryFirebase(payload && payload.code);
  const [snap, summarySnap] = await Promise.all([
    get(query(ref(firebaseDatabase, PERSON_DETAIL_ROOT), orderByKey(), startAt(from), endAt(to))),
    get(query(ref(firebaseDatabase, `${ROOT}/congKhai/soLieuTheoNgay`), orderByKey(), startAt(from), endAt(to))).catch(() => null)
  ]);
  const raw = snapshotObject(snap), rows=[];
  Object.keys(raw).sort().forEach((date)=>{
    const day = raw[date] || {}, group = day[category.code] || {};
    activePersonRows(group).forEach((item)=>rows.push({ ...item, date }));
  });
  rows.sort((a,b)=>String(b.date).localeCompare(String(a.date)) || String(a.hoTen||'').localeCompare(String(b.hoTen||''),'vi'));
  const summaryRaw = snapshotObject(summarySnap);
  const totalValue = Object.keys(summaryRaw).reduce((sum,date)=>sum+Number((((summaryRaw[date]||{})[category.code]||{}).giaTri)||0),0);
  return { success:true, from, to, category, rows, totalValue, unresolvedCount:Math.max(0,totalValue-rows.length) };
}
async function savePersonDetailFirebase(payload) {
  const user = await requireAppUser();
  const date = String(payload && payload.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ngày không hợp lệ.');
  if (date > todayIsoVietnam()) throw new Error('Ngày nghiệp vụ không được lớn hơn ngày hiện tại.');
  const category = await personDetailCategoryFirebase(payload && payload.code);
  const hoTen = formatPersonName(payload && payload.hoTen || '');
  const gioiTinh = String(payload && payload.gioiTinh || '').trim();
  const namSinh = Number(payload && payload.namSinh || 0);
  if (hoTen.length < 2 || hoTen.length > 150) throw new Error('Vui lòng nhập Họ và tên.');
  if (!['Nam','Nữ'].includes(gioiTinh)) throw new Error('Vui lòng chọn Giới tính.');
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(namSinh) || namSinh < 1900 || namSinh > currentYear) throw new Error(`Năm sinh phải từ 1900 đến ${currentYear}.`);
  const groupRef = ref(firebaseDatabase, `${PERSON_DETAIL_ROOT}/${date}/${category.code}`);
  const groupSnap = await get(groupRef), raw = snapshotObject(groupSnap), active = activePersonRows(raw);
  const editingId = String(payload && payload.id || '').trim();
  const duplicate = active.find((item)=>item.id !== editingId && normalizePersonIdentity(item.hoTen) === normalizePersonIdentity(hoTen) && String(item.gioiTinh||'')===gioiTinh && Number(item.namSinh||0)===namSinh);
  if (duplicate) throw new Error('Đối tượng này đã có trong danh sách của ngày đã chọn.');
  const detailId = editingId || push(groupRef).key;
  const existing = raw[detailId] || null;
  if (editingId && (!existing || String(existing.status||'ACTIVE')==='DELETED')) throw new Error('Không tìm thấy đối tượng cần cập nhật.');
  const displayName = formatHumanNameOrFallback(user.appPermission.displayName || user.displayName || user.email || '');
  const email = normalizeEmail(user.email), now = Date.now();
  const record = {
    id: detailId, date, code: category.code, metricName: category.name,
    hoTen, hoTenNorm: normalizePersonIdentity(hoTen), gioiTinh, namSinh, status:'ACTIVE',
    createdAt: existing ? Number(existing.createdAt || now) : now,
    createdByUid: existing ? String(existing.createdByUid || user.uid) : user.uid,
    createdByEmail: existing ? String(existing.createdByEmail || email) : email,
    createdByName: existing ? String(existing.createdByName || displayName) : displayName,
    updatedAt: now, updatedByUid:user.uid, updatedByEmail:email, updatedByName:displayName,
    deletedAt:0, deletedByUid:'', deletedByEmail:'', deletedByName:''
  };
  const updates = {};
  updates[`${PERSON_DETAIL_ROOT}/${date}/${category.code}/${detailId}`] = record;
  if (!editingId) {
    const summaryRef = ref(firebaseDatabase, `${ROOT}/soLieuTheoNgay/${date}/${category.code}`);
    const publicSummaryRef = ref(firebaseDatabase, `${ROOT}/congKhai/soLieuTheoNgay/${date}/${category.code}`);
    const [summarySnap, publicSummarySnap] = await Promise.all([
      get(summaryRef),
      get(publicSummaryRef).catch(() => null)
    ]);
    const summary = snapshotObject(summarySnap);
    const publicSummary = publicSummarySnap && publicSummarySnap.exists() ? snapshotObject(publicSummarySnap) : {};
    const beforeValue = Number(summary.giaTri || 0), afterValue = Math.max(beforeValue, active.length + 1);
    const privateVersion = Number(summary.version || 0) + 1;
    const publicVersion = Number(publicSummary.version || 0) + 1;
    updates[`${ROOT}/soLieuTheoNgay/${date}/${category.code}`] = { maChiTieu:category.code, ten:category.name, ngay:date, giaTri:afterValue, ghiChu:'', trangThai:'Hoạt động', version:privateVersion, createdAt:Number(summary.createdAt || now), createdByUid:String(summary.createdByUid || user.uid), updatedAt:now, updatedByUid:user.uid, updatedByEmail:email, updatedByName:displayName };
    updates[`${ROOT}/congKhai/soLieuTheoNgay/${date}/${category.code}`] = { maChiTieu:category.code, ten:category.name, ngay:date, giaTri:afterValue, version:publicVersion, updatedAt:now };
    const historyId = push(ref(firebaseDatabase, `${ROOT}/lichSu/${date.slice(0,7)}`)).key;
    updates[`${ROOT}/lichSu/${date.slice(0,7)}/${historyId}`] = { dataId:`${date}-${category.code}`, date, code:category.code, name:category.name, action:summarySnap.exists()?'Điều chỉnh':'Ghi nhận', beforeValue, afterValue, reason:`Thêm đối tượng: ${hoTen}`, uid:user.uid, email, displayName, role:user.appRole, createdAt:now };
  }
  const logId = push(ref(firebaseDatabase, `${ROOT}/nhatKy/${date.slice(0,7)}`)).key;
  updates[`${ROOT}/nhatKy/${date.slice(0,7)}/${logId}`] = {
    action:editingId?'Cập nhật chi tiết chỉ tiêu':'Thêm chi tiết chỉ tiêu',
    content:`${category.name} · ${hoTen} · ${gioiTinh} · ${namSinh}`,
    beforeJson: existing ? JSON.stringify(existing) : '',
    afterJson: JSON.stringify(record),
    reason: editingId ? 'Cập nhật thông tin đối tượng' : 'Thêm đối tượng vào danh sách',
    uid:user.uid, email, displayName, role:user.appRole, createdAt:now
  };
  try {
    await update(ref(firebaseDatabase), updates);
  } catch (error) {
    const [diagnostic, permissionPair] = await Promise.all([
      personDetailDiagnosticFirebase(category.code, date).catch(() => ({ code:category.code })),
      readOwnPermissionPair(user).catch(() => ({ permission:null, reportPermission:null }))
    ]);
    console.error('[PERSON_DETAIL_WRITE_FAILED]', {
      code: category.code,
      privateCategory: diagnostic.privateCategory || category,
      publicCategory: diagnostic.publicCategory || null,
      privateVersion: Number(diagnostic.privateVersion || 0),
      publicVersion: Number(diagnostic.publicVersion || 0),
      role: user.appRole,
      tongHopPermission: permissionPair.permission || null,
      baoCaoPermission: permissionPair.reportPermission || null,
      paths: Object.keys(updates),
      errorCode: error && error.code ? error.code : '',
      errorMessage: error && error.message ? error.message : String(error)
    });
    throw error;
  }
  return { success:true, id:detailId, date, message:editingId?'Đã cập nhật thông tin đối tượng.':'Đã thêm đối tượng vào danh sách.' };
}
async function deletePersonDetailFirebase(payload) {
  const user = await requireAppUser('admin');
  const date = String(payload && payload.date || ''), detailId = String(payload && payload.id || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !detailId) throw new Error('Dữ liệu xóa không hợp lệ.');
  const category = await personDetailCategoryFirebase(payload && payload.code);
  const groupRef = ref(firebaseDatabase, `${PERSON_DETAIL_ROOT}/${date}/${category.code}`);
  const groupSnap = await get(groupRef), raw = snapshotObject(groupSnap), active = activePersonRows(raw), existing = raw[detailId] || null;
  if (!existing || String(existing.status||'ACTIVE')==='DELETED') throw new Error('Đối tượng đã được xóa hoặc không còn tồn tại.');
  const displayName = formatHumanNameOrFallback(user.appPermission.displayName || user.displayName || user.email || ''), email = normalizeEmail(user.email), now=Date.now();
  const summaryRef = ref(firebaseDatabase, `${ROOT}/soLieuTheoNgay/${date}/${category.code}`);
  const publicSummaryRef = ref(firebaseDatabase, `${ROOT}/congKhai/soLieuTheoNgay/${date}/${category.code}`);
  const [summarySnap, publicSummarySnap] = await Promise.all([
    get(summaryRef),
    get(publicSummaryRef).catch(() => null)
  ]);
  const summary=snapshotObject(summarySnap), publicSummary=publicSummarySnap&&publicSummarySnap.exists()?snapshotObject(publicSummarySnap):{};
  const beforeValue=Number(summary.giaTri||active.length), afterValue=Math.max(0,active.length-1,beforeValue-1);
  const privateVersion=Number(summary.version||0)+1, publicVersion=Number(publicSummary.version||0)+1;
  const updates={};
  updates[`${PERSON_DETAIL_ROOT}/${date}/${category.code}/${detailId}`] = { ...existing, status:'DELETED', updatedAt:now, updatedByUid:user.uid, updatedByEmail:email, updatedByName:displayName, deletedAt:now, deletedByUid:user.uid, deletedByEmail:email, deletedByName:displayName };
  updates[`${ROOT}/soLieuTheoNgay/${date}/${category.code}`] = { maChiTieu:category.code, ten:category.name, ngay:date, giaTri:afterValue, ghiChu:'', trangThai:'Hoạt động', version:privateVersion, createdAt:Number(summary.createdAt||now), createdByUid:String(summary.createdByUid||user.uid), updatedAt:now, updatedByUid:user.uid, updatedByEmail:email, updatedByName:displayName };
  updates[`${ROOT}/congKhai/soLieuTheoNgay/${date}/${category.code}`] = { maChiTieu:category.code, ten:category.name, ngay:date, giaTri:afterValue, version:publicVersion, updatedAt:now };
  const historyId=push(ref(firebaseDatabase,`${ROOT}/lichSu/${date.slice(0,7)}`)).key;
  updates[`${ROOT}/lichSu/${date.slice(0,7)}/${historyId}`]={dataId:`${date}-${category.code}`,date,code:category.code,name:category.name,action:'Điều chỉnh',beforeValue,afterValue,reason:`Xóa đối tượng khỏi danh sách: ${existing.hoTen||''}`,uid:user.uid,email,displayName,role:user.appRole,createdAt:now};
  const logId=push(ref(firebaseDatabase,`${ROOT}/nhatKy/${date.slice(0,7)}`)).key;
  const deletedRecord = updates[`${PERSON_DETAIL_ROOT}/${date}/${category.code}/${detailId}`];
  updates[`${ROOT}/nhatKy/${date.slice(0,7)}/${logId}`]={
    action:'Xóa chi tiết chỉ tiêu',content:`${category.name} · ${existing.hoTen||detailId}`,
    beforeJson:JSON.stringify(existing),afterJson:JSON.stringify(deletedRecord),reason:'Xóa đối tượng khỏi danh sách',
    uid:user.uid,email,displayName,role:user.appRole,createdAt:now
  };
  try {
    await update(ref(firebaseDatabase),updates);
  } catch (error) {
    const [diagnostic, permissionPair] = await Promise.all([
      personDetailDiagnosticFirebase(category.code, date).catch(() => ({ code:category.code, privateVersion, publicVersion })),
      readOwnPermissionPair(user).catch(() => ({ permission:null, reportPermission:null }))
    ]);
    console.error('[PERSON_DETAIL_DELETE_FAILED]', {
      code: category.code,
      privateCategory: diagnostic.privateCategory || category,
      publicCategory: diagnostic.publicCategory || null,
      role: user.appRole,
      privateVersion: Number(diagnostic.privateVersion == null ? privateVersion : diagnostic.privateVersion),
      publicVersion: Number(diagnostic.publicVersion == null ? publicVersion : diagnostic.publicVersion),
      tongHopPermission: permissionPair.permission || null,
      baoCaoPermission: permissionPair.reportPermission || null,
      paths: Object.keys(updates),
      errorCode: error && error.code ? error.code : '',
      errorMessage: error && error.message ? error.message : String(error)
    });
    throw error;
  }
  return {success:true,message:'Đã xóa đối tượng khỏi danh sách.'};
}

async function getDailyDataFirebase(dateValue) {
  await requireAppUser();
  const date = String(dateValue || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ngày nhập số liệu không hợp lệ.');
  const [snap, categorySnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/soLieuTheoNgay/${date}`)),
    get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu`))
  ]);
  const [transferRaw, deathRaw] = await Promise.all([
    readOptionalSnapshot(ref(firebaseDatabase, `${PUBLIC_REPORT_STATS_ROOT}/chuyenVienTheoNgay/${date}`)),
    readOptionalSnapshot(ref(firebaseDatabase, `${PUBLIC_REPORT_STATS_ROOT}/tuVongTheoNgay/${date}`))
  ]);
  const raw = snapshotObject(snap);
  const categoriesRaw = snapshotObject(categorySnap);
  const categories = Object.keys(categoriesRaw).map((code) => { const item = categoriesRaw[code] || {}; return decorateCategory({ code, name: item.ten || code, group: item.nhom || 'Khác', unit: item.donVi || 'Lượt', order: Number(item.thuTu || 9999), status: item.trangThai || 'Hoạt động' }); }).filter((item) => item.status === 'Hoạt động');
  if(markerCount(transferRaw,'transfer')>0&&!derivedCategory(categories,'transfer')) categories.push(decorateCategory({code:'CHUYEN_VIEN',name:'Chuyển viện',group:'Báo cáo',unit:'Lượt',order:9001,status:'Hoạt động'}));
  if(markerCount(deathRaw,'death')>0&&!derivedCategory(categories,'death')) categories.push(decorateCategory({code:'TU_VONG',name:'Tử vong',group:'Báo cáo',unit:'Lượt',order:9002,status:'Hoạt động'}));
  const records = Object.keys(raw).map((code) => {
    const item = raw[code] || {};
    return { id: `${date}-${code}`, date, code, name: item.ten || code, value: Number(item.giaTri || 0), note: item.ghiChu || '', updatedBy: item.updatedByName || '', updatedAt: item.updatedAt ? formatDateTime(item.updatedAt) : '', version: Number(item.version || 0) };
  });
  return { success: true, date, records: mergeDerivedDailyRecords(records, categories, date, transferRaw, deathRaw) };
}

async function adjustDailyDataFirebase(payload) {
  const user = await requireAppUser();
  payload = payload || {};
  const date = String(payload.date || '');
  const code = normalizeCategoryCode(payload.code);
  const newValue = Number(payload.newValue);
  const expectedVersion = Number(payload.expectedVersion || 0);
  const reason = String(payload.reason || '').trim().slice(0, 500);
  const requestedNote = String(payload.note == null ? '' : payload.note).trim().slice(0, 1000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ngày số liệu không hợp lệ.');
  if (!code) throw new Error('Mã chỉ tiêu không hợp lệ.');
  if (!Number.isInteger(newValue) || newValue < 0) throw new Error('Số liệu mới phải là số nguyên không âm.');

  const categorySnap = await get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu/${code}`));
  if (!categorySnap.exists() || categorySnap.child('trangThai').val() !== 'Hoạt động') {
    throw new Error('Chỉ tiêu không tồn tại hoặc đã ngừng sử dụng.');
  }
  const category = categorySnap.val() || {};
  const categoryModel = { code, name: category.ten || code, group: category.nhom || 'Khác' };
  const derivedKind = metricKindFromCategory(categoryModel);
  if (derivedKind) {
    throw new Error('Chuyển viện/Tử vong là số liệu tự động từ dữ liệu nguồn. Hãy mở Chuyển viện để kiểm tra hoặc điều chỉnh dữ liệu nguồn.');
  }
  const personDetailKind = personDetailKindFromCategory(categoryModel);
  if (personDetailKind) {
    throw new Error((category.ten || code) + ' được quản lý theo danh sách Họ tên/Giới tính/Năm sinh. Vui lòng dùng Quản lý danh sách.');
  }
  const training = isTrainingCategory(categoryModel);
  if (training && requestedNote.length < 2) throw new Error('Vui lòng nhập Nội dung tập huấn.');

  const recordRef = ref(firebaseDatabase, `${ROOT}/soLieuTheoNgay/${date}/${code}`);
  const publicRecordRef = ref(firebaseDatabase, `${ROOT}/congKhai/soLieuTheoNgay/${date}/${code}`);
  const [currentSnap, publicSnap] = await Promise.all([
    get(recordRef),
    get(publicRecordRef).catch(() => null)
  ]);
  const current = snapshotObject(currentSnap);
  const publicCurrent = publicSnap && publicSnap.exists() ? snapshotObject(publicSnap) : {};
  const currentVersion = Number(current.version || 0);
  const publicVersion = Number(publicCurrent.version || 0);
  if (currentVersion !== expectedVersion) {
    throw new Error('Số liệu vừa được cập nhật từ thiết bị khác. Ứng dụng đã tự đồng bộ; vui lòng kiểm tra giá trị mới và thực hiện lại.');
  }
  const beforeValue = currentSnap.exists() ? Number(current.giaTri || 0) : 0;
  const beforeNote = String(current.ghiChu || '').trim();
  const afterNote = training ? requestedNote : beforeNote;
  if (currentSnap.exists() && beforeValue === newValue && beforeNote === afterNote) {
    throw new Error('Số liệu và nội dung mới đang bằng dữ liệu hiện tại.');
  }

  const nextPrivateVersion = currentVersion + 1;
  const nextPublicVersion = publicVersion + 1;
  const action = currentSnap.exists() ? 'Điều chỉnh' : 'Ghi nhận';
  const historyRef = push(ref(firebaseDatabase, `${ROOT}/lichSu/${monthKey(date)}`));
  const logRef = push(ref(firebaseDatabase, `${ROOT}/nhatKy/${monthKey(date)}`));
  const now = Date.now();
  const createdAt = current.createdAt || now;
  const createdByUid = current.createdByUid || user.uid;
  const displayName = formatHumanNameOrFallback(user.appPermission.displayName || user.displayName || user.email || '');

  const updates = {};
  updates[`${ROOT}/soLieuTheoNgay/${date}/${code}`] = {
    maChiTieu: code,
    ten: category.ten || code,
    ngay: date,
    giaTri: newValue,
    ghiChu: afterNote,
    trangThai: 'Hoạt động',
    version: nextPrivateVersion,
    createdAt,
    createdByUid,
    updatedAt: now,
    updatedByUid: user.uid,
    updatedByEmail: normalizeEmail(user.email),
    updatedByName: displayName
  };
  updates[`${ROOT}/congKhai/soLieuTheoNgay/${date}/${code}`] = {
    maChiTieu: code,
    ten: category.ten || code,
    ngay: date,
    giaTri: newValue,
    version: nextPublicVersion,
    updatedAt: now
  };
  const historyRecord = {
    dataId: `${date}-${code}`,
    date,
    code,
    name: category.ten || code,
    action,
    beforeValue,
    afterValue: newValue,
    beforeNote,
    afterNote,
    reason: reason || (action === 'Ghi nhận' ? 'Ghi nhận số liệu lần đầu' : 'Cập nhật trực tiếp trên ứng dụng'),
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName,
    role: user.appRole,
    createdAt: now
  };
  updates[`${ROOT}/lichSu/${monthKey(date)}/${historyRef.key}`] = historyRecord;
  updates[`${ROOT}/nhatKy/${monthKey(date)}/${logRef.key}`] = {
    action: action === 'Ghi nhận' ? 'Ghi nhận số liệu' : 'Điều chỉnh số liệu',
    content: `Ngày ${date} - ${category.ten || code}: ${currentSnap.exists() ? beforeValue : 'Chưa ghi nhận'} → ${newValue}${training ? ` · Nội dung: ${afterNote}` : ''}`,
    dataDate: date,
    beforeJson: currentSnap.exists() ? JSON.stringify(current) : '',
    afterJson: JSON.stringify(updates[`${ROOT}/soLieuTheoNgay/${date}/${code}`]),
    reason: historyRecord.reason,
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName,
    role: user.appRole,
    createdAt: now
  };

  try {
    await update(ref(firebaseDatabase), updates);
  } catch (error) {
    const [latestSnap, latestPublicSnap] = await Promise.all([
      get(recordRef).catch(() => null),
      get(publicRecordRef).catch(() => null)
    ]);
    const latestVersion = latestSnap && latestSnap.exists() ? Number(latestSnap.child('version').val() || 0) : 0;
    const latestPublicVersion = latestPublicSnap && latestPublicSnap.exists() ? Number(latestPublicSnap.child('version').val() || 0) : 0;
    console.error('[DAILY_DATA_WRITE_FAILED]', {
      code,
      category: categoryModel,
      role: user.appRole,
      privateVersion: currentVersion,
      publicVersion,
      latestPrivateVersion: latestVersion,
      latestPublicVersion,
      paths: Object.keys(updates),
      errorCode: error && error.code ? error.code : '',
      errorMessage: error && error.message ? error.message : String(error)
    });
    if (latestVersion !== currentVersion || latestPublicVersion !== publicVersion) {
      throw new Error('Số liệu vừa được cập nhật từ thiết bị khác. Ứng dụng đã tự đồng bộ; vui lòng kiểm tra giá trị mới và thực hiện lại.');
    }
    throw error;
  }

  return {
    success: true,
    record: {
      id: `${date}-${code}`,
      date,
      code,
      name: category.ten || code,
      value: newValue,
      note: afterNote,
      updatedBy: displayName,
      updatedAt: formatDateTime(now),
      version: nextPrivateVersion,
      autoDerived: false,
      derivedKind: '',
      manualOverride: false
    },
    message: action === 'Ghi nhận' ? 'Đã ghi nhận số liệu.' : 'Đã lưu thay đổi.'
  };
}

async function deleteDailyDataFirebase(payload) {
  const user = await requireAppUser('admin');
  payload = payload || {};
  const date = String(payload.date || '');
  const code = normalizeCategoryCode(payload.code);
  const expectedVersion = Number(payload.expectedVersion || 0);
  const reason = String(payload.reason || '').trim().slice(0, 500);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ngày số liệu không hợp lệ.');
  if (!code) throw new Error('Mã chỉ tiêu không hợp lệ.');
  if (reason.length < 3) throw new Error('Vui lòng nhập lý do xóa.');

  const categorySnap = await get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu/${code}`));
  if (!categorySnap.exists()) throw new Error('Chỉ tiêu không tồn tại.');
  const category = categorySnap.val() || {};
  const derivedKind = metricKindFromCategory({ code, name: category.ten || code });
  if (derivedKind) {
    throw new Error('Chuyển viện/Tử vong là số liệu tự động từ dữ liệu nguồn. Hãy mở Chuyển viện để điều chỉnh hoặc xóa dữ liệu nguồn.');
  }
  if (personDetailKindFromCategory({ code, name: category.ten || code })) {
    throw new Error((category.ten || code) + ' được quản lý theo danh sách đối tượng. Quản trị viên hãy xóa đối tượng trong danh sách để số liệu tự giảm đúng nguồn.');
  }

  const recordRef = ref(firebaseDatabase, `${ROOT}/soLieuTheoNgay/${date}/${code}`);
  const currentSnap = await get(recordRef);
  if (!currentSnap.exists()) throw new Error('Số liệu này không còn tồn tại. Ứng dụng sẽ tải lại dữ liệu mới nhất.');
  const current = currentSnap.val() || {};
  const currentVersion = Number(current.version || 0);
  if (currentVersion !== expectedVersion) {
    throw new Error('Số liệu vừa được cập nhật từ thiết bị khác. Vui lòng tải lại và kiểm tra trước khi xóa.');
  }

  const beforeValue = Number(current.giaTri || 0);
  const displayName = formatHumanNameOrFallback(user.appPermission.displayName || user.displayName || user.email || '');
  const historyRef = push(ref(firebaseDatabase, `${ROOT}/lichSu/${monthKey(date)}`));
  const logRef = push(ref(firebaseDatabase, `${ROOT}/nhatKy/${monthKey(date)}`));
  const updates = {};

  // Xóa record hiện hành và public mirror, nhưng giữ lịch sử/audit bất biến.
  updates[`${ROOT}/soLieuTheoNgay/${date}/${code}`] = null;
  updates[`${ROOT}/congKhai/soLieuTheoNgay/${date}/${code}`] = null;
  updates[`${ROOT}/lichSu/${monthKey(date)}/${historyRef.key}`] = {
    dataId: `${date}-${code}`,
    date,
    code,
    name: category.ten || code,
    action: 'Xóa số liệu',
    beforeValue,
    // Rules hiện hành của tongHopYTe/lichSu yêu cầu afterValue là number.
    // Với thao tác xóa, action là nguồn sự thật; 0 chỉ là giá trị audit tương thích Rules.
    // Khi đọc lịch sử, UI chuyển action 'Xóa số liệu' về trạng thái 'Đã xóa'.
    afterValue: 0,
    beforeNote: current.ghiChu || '',
    afterNote: '',
    reason,
    deletedVersion: currentVersion,
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName,
    role: user.appRole,
    createdAt: serverTimestamp()
  };
  updates[`${ROOT}/nhatKy/${monthKey(date)}/${logRef.key}`] = {
    action: 'Xóa số liệu',
    content: `Ngày ${date} - ${category.ten || code}: đã xóa giá trị ${beforeValue}. Lý do: ${reason}`,
    dataDate: date,
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName,
    role: user.appRole,
    createdAt: serverTimestamp()
  };

  try {
    await update(ref(firebaseDatabase), updates);
  } catch (error) {
    const latestSnap = await get(recordRef).catch(() => null);
    const latestVersion = latestSnap && latestSnap.exists() ? Number(latestSnap.child('version').val() || 0) : 0;
    if (latestVersion !== expectedVersion) {
      throw new Error('Số liệu vừa được cập nhật từ thiết bị khác. Vui lòng tải lại và kiểm tra trước khi xóa.');
    }
    throw error;
  }

  return { success: true, deleted: true, date, code, beforeValue, auditId: historyRef.key, message: 'Đã xóa số liệu. Thay đổi đã được lưu trong Lịch sử.' };
}

async function getDailyDataHistoryFirebase(payload) {
  await requireAppUser();
  payload = payload || {};
  const date = String(payload.date || '');
  const code = normalizeCategoryCode(payload.code);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ngày số liệu không hợp lệ.');
  if (!code) throw new Error('Mã chỉ tiêu không hợp lệ.');
  const [snap, namesSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/lichSu/${monthKey(date)}`)),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/tenHienThi`)).catch(() => null)
  ]);
  const raw = snapshotObject(snap);
  const displayNames = snapshotObject(namesSnap);
  const items = Object.keys(raw).map((id) => ({ id, ...(raw[id] || {}) }))
    .filter((item) => item.date === date && normalizeCategoryCode(item.code) === code)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .map((item) => ({
      id: item.id,
      action: String(item.action || ''),
      beforeValue: Number(item.beforeValue || 0),
      afterValue: String(item.action || '') === 'Xóa số liệu' ? null : (item.afterValue == null ? null : Number(item.afterValue || 0)),
      beforeNote: String(item.beforeNote || ''),
      afterNote: String(item.afterNote || ''),
      reason: String(item.reason || ''),
      displayName: formatHumanNameOrFallback((displayNames[item.uid] && displayNames[item.uid].displayName) || item.displayName || item.email || ''),
      email: normalizeEmail(item.email),
      role: String(item.role || ''),
      autoValue: item.autoValue == null ? null : Number(item.autoValue || 0),
      createdAt: Number(item.createdAt || 0),
      createdAtText: item.createdAt ? formatDateTime(item.createdAt) : ''
    }));
  return { success: true, date, code, items };
}

async function loginGoogleFirebase() {
  const credential = await signInWithPopup(firebaseAuth, googleProvider);
  return resolveApplicationAccess(credential.user);
}

async function restoreSessionFirebase() {
  await authReady;
  return resolveApplicationAccess(firebaseAuth.currentUser);
}

async function logoutFirebase() {
  await signOut(firebaseAuth);
  return { success: true, message: 'Đã đăng xuất.' };
}

async function getAdminCategoriesFirebase() {
  await requireAppUser('admin');
  return { success: true, categories: await readPrivateCategories(false) };
}

async function adminSaveCategoryFirebase(payload) {
  const user = await requireAppUser('admin');
  payload = payload || {};
  const originalCode = normalizeCategoryCode(payload.originalCode);
  const requestedCode = normalizeCategoryCode(payload.code);
  const name = String(payload.name || '').trim();
  const group = String(payload.group || 'Khác').trim();
  const unit = String(payload.unit || 'Lượt').trim();
  const order = Number(payload.order);
  const status = payload.status === 'Ngừng hoạt động' ? 'Ngừng hoạt động' : 'Hoạt động';
  if (name.length < 2 || name.length > 150) throw new Error('Tên chỉ tiêu phải có từ 2 đến 150 ký tự.');
  if (!group || group.length > 100) throw new Error('Nhóm chỉ tiêu không hợp lệ.');
  if (!unit || unit.length > 50) throw new Error('Đơn vị tính không hợp lệ.');
  if (!Number.isInteger(order) || order < 1 || order > 9999) throw new Error('Thứ tự hiển thị phải là số nguyên từ 1 đến 9999.');

  const all = await readPrivateCategories(false);
  if (all.some((item) => item.name.toLocaleLowerCase('vi-VN') === name.toLocaleLowerCase('vi-VN') && item.code !== originalCode)) {
    throw new Error('Tên chỉ tiêu này đã tồn tại.');
  }
  let code = originalCode;
  if (!code) {
    code = requestedCode || normalizeCategoryCode(name);
    if (!code) throw new Error('Không thể tạo mã chỉ tiêu từ tên đã nhập.');
    const existing = new Set(all.map((item) => item.code));
    const base = code;
    let suffix = 2;
    while (existing.has(code)) code = `${base}_${suffix++}`;
  }
  const now = Date.now();
  const oldSnap = await get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu/${code}`));
  const old = snapshotObject(oldSnap);
  const item = {
    ma: code,
    ten: name,
    nhom: group,
    donVi: unit,
    thuTu: order,
    trangThai: status,
    createdAt: old.createdAt || now,
    updatedAt: now,
    updatedByUid: user.uid
  };
  const safePublic = {
    ma: code, ten: name, nhom: group, donVi: unit, thuTu: order, trangThai: status, updatedAt: now
  };
  const updates = {};
  updates[`${ROOT}/danhMucChiTieu/${code}`] = item;
  updates[`${ROOT}/congKhai/danhMucChiTieu/${code}`] = safePublic;
  await update(ref(firebaseDatabase), updates);
  await writeAuditLog(user, oldSnap.exists() ? 'Sửa chỉ tiêu' : 'Thêm chỉ tiêu', `${code} - ${name} - ${status}`, '');
  return {
    success: true,
    category: { code, name, group, unit, order, status },
    message: oldSnap.exists() ? 'Đã cập nhật chỉ tiêu.' : 'Đã thêm chỉ tiêu mới.'
  };
}

async function adminSetCategoryStatusFirebase(codeValue, statusValue) {
  const user = await requireAppUser('admin');
  const code = normalizeCategoryCode(codeValue);
  const status = statusValue === 'Hoạt động' ? 'Hoạt động' : 'Ngừng hoạt động';
  const snap = await get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu/${code}`));
  if (!snap.exists()) throw new Error('Không tìm thấy chỉ tiêu.');
  const item = snap.val() || {};
  const now = Date.now();
  const updates = {};
  updates[`${ROOT}/danhMucChiTieu/${code}/trangThai`] = status;
  updates[`${ROOT}/danhMucChiTieu/${code}/updatedAt`] = now;
  updates[`${ROOT}/danhMucChiTieu/${code}/updatedByUid`] = user.uid;
  updates[`${ROOT}/congKhai/danhMucChiTieu/${code}/trangThai`] = status;
  updates[`${ROOT}/congKhai/danhMucChiTieu/${code}/updatedAt`] = now;
  await update(ref(firebaseDatabase), updates);
  await writeAuditLog(user, status === 'Hoạt động' ? 'Khôi phục chỉ tiêu' : 'Ngừng sử dụng chỉ tiêu', `${code} - ${item.ten || code}`, '');
  return { success: true, message: status === 'Hoạt động' ? 'Đã khôi phục chỉ tiêu.' : 'Đã ngừng sử dụng chỉ tiêu.' };
}

async function getAdminUsersFirebase() {
  await requireAppUser('admin');
  const [permissionSnap, requestSnap, directorySnap, displayNameSnap, deletedSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen`)),
    get(ref(firebaseDatabase, `${ROOT}/yeuCauDangKy`)),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung`)),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/tenHienThi`)).catch(() => null),
    get(ref(firebaseDatabase, `${ROOT}/cauHinh/taiKhoanDaXoa`)).catch(() => null)
  ]);
  const customNames = snapshotObject(displayNameSnap);
  const permissions = snapshotObject(permissionSnap);
  const requests = snapshotObject(requestSnap);
  const directory = snapshotObject(directorySnap);
  const deletedUsers = snapshotObject(deletedSnap);
  const allUids = new Set([
    ...Object.keys(directory),
    ...Object.keys(permissions),
    ...Object.keys(requests)
  ]);
  const users = [];
  allUids.forEach((uid) => {
    // yTeApp/nguoiDung là hồ sơ dùng chung của Phòng Y tế và Rules chỉ cho chính
    // chủ tài khoản ghi. Khi admin xóa khỏi ứng dụng, ta giữ hồ sơ này cho audit
    // nhưng ẩn tài khoản directory-only bằng tombstone trong tongHopYTe/cauHinh.
    if (deletedUsers[uid] && !permissions[uid] && !requests[uid]) return;
    const item = permissions[uid] || {};
    const request = requests[uid] || {};
    const profile = directory[uid] || {};
    const hasPermission = !!permissions[uid];
    const requestStatus = request.status || (hasPermission ? 'approved' : 'unassigned');
    users.push({
      id: uid,
      uid,
      name: formatHumanNameOrFallback((customNames[uid] && customNames[uid].displayName) || item.displayName || request.displayName || profile.displayName || item.email || request.email || profile.email || ''),
      username: item.username || request.username || '',
      email: item.email || request.email || profile.email || '',
      role: hasPermission ? uiRole(item.role) : '',
      status: hasPermission ? uiStatus(item.active) : 'Chưa cấp',
      isPending: !hasPermission,
      requestStatus,
      requestedAt: request.requestedAt ? formatDateTime(request.requestedAt) : (profile.createdAt ? formatDateTime(profile.createdAt) : ''),
      lastLogin: item.lastLoginAt ? formatDateTime(item.lastLoginAt) : (profile.lastLoginAt ? formatDateTime(profile.lastLoginAt) : '')
    });
  });
  users.sort((a, b) => (a.isPending === b.isPending ? String(a.name).localeCompare(String(b.name), 'vi') : a.isPending ? -1 : 1));
  return { success: true, users };
}

async function adminApproveRegistrationFirebase(uid, roleValue) {
  const admin = await requireAppUser('admin');
  const role = dbRole(roleValue);
  const [requestSnap, profileSnap, oldPermSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/yeuCauDangKy/${uid}`)),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung/${uid}`)),
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen/${uid}`))
  ]);
  const request = snapshotObject(requestSnap);
  const profile = snapshotObject(profileSnap);
  const oldPerm = snapshotObject(oldPermSnap);
  const email = normalizeEmail(request.email || profile.email || oldPerm.email);
  if (!email) throw new Error('Không tìm thấy thông tin tài khoản đã đăng nhập Google.');
  const displayName = formatHumanNameOrFallback(request.displayName || profile.displayName || oldPerm.displayName || email).slice(0, 150);
  const now = Date.now();
  const updates = {};
  updates[`${ROOT}/cauHinh/taiKhoanDaXoa/${uid}`] = null;
  updates[`${ROOT}/phanQuyen/${uid}`] = {
    email,
    displayName,
    username: normalizeUsername(request.username || oldPerm.username || String(email).split('@')[0]),
    role,
    active: true,
    legacyUserId: oldPerm.legacyUserId || '',
    source: oldPerm.source || 'APPROVED_IN_APP',
    createdAt: oldPerm.createdAt || now,
    updatedAt: now,
    approvedAt: now,
    approvedByUid: admin.uid
  };
  // v10.0.8: một vai trò dùng chung toàn ứng dụng. Luôn đồng bộ sang Báo cáo
  // để viewer/nhaplieu/admin không cần được cấp quyền lần thứ hai.
  const oldReportSnap = await get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${uid}`)).catch(() => null);
  const oldReport = snapshotObject(oldReportSnap);
  updates[`${REPORT_ROOT}/phanQuyen/${uid}`] = {
    email,
    displayName,
    role,
    active: true,
    source: oldReport.source || 'APP_ROLE_SYNC',
    createdAt: oldReport.createdAt || now,
    updatedAt: now,
    updatedByUid: admin.uid
  };
  if (requestSnap.exists()) {
    updates[`${ROOT}/yeuCauDangKy/${uid}/status`] = 'approved';
    updates[`${ROOT}/yeuCauDangKy/${uid}/reviewedAt`] = now;
    updates[`${ROOT}/yeuCauDangKy/${uid}/reviewedByUid`] = admin.uid;
  }
  await update(ref(firebaseDatabase), updates);
  await writeAuditLog(admin, 'Cấp quyền tài khoản', `${email} → ${uiRole(role)}`, '');
  notifyBusinessEvent('ACCOUNT_ROLE_CHANGED', uid);
  return { success: true, message: `Đã cấp quyền ${uiRole(role)} cho tài khoản.` };
}

async function adminRejectRegistrationFirebase(uid) {
  const admin = await requireAppUser('admin');
  const requestRef = ref(firebaseDatabase, `${ROOT}/yeuCauDangKy/${uid}`);
  const snap = await get(requestRef);
  if (!snap.exists()) throw new Error('Không tìm thấy yêu cầu đăng ký.');
  await update(requestRef, {
    status: 'rejected',
    reviewedAt: Date.now(),
    reviewedByUid: admin.uid
  });
  const item = snap.val() || {};
  await writeAuditLog(admin, 'Từ chối cấp quyền', item.email || uid, '');
  return { success: true, message: 'Đã từ chối yêu cầu cấp quyền.' };
}

async function adminSetUserStatusFirebase(uid, statusValue) {
  const admin = await requireAppUser('admin');
  if (uid === admin.uid) throw new Error('Bạn không thể tự khóa tài khoản đang sử dụng.');
  const active = statusValue === 'Hoạt động';
  const [tongHopSnap, reportSnap, profileSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen/${uid}`)),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${uid}`)).catch(() => null),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung/${uid}`)).catch(() => null)
  ]);
  if (!tongHopSnap.exists() && !(reportSnap && reportSnap.exists())) throw new Error('Không tìm thấy quyền tài khoản.');
  const tongHop = snapshotObject(tongHopSnap), report = snapshotObject(reportSnap), profile = snapshotObject(profileSnap);
  const role = effectivePermissionRole(tongHop, report, { email: tongHop.email || report.email || profile.email || '' }) || dbRole(tongHop.role || report.role || 'viewer');
  const email = normalizeEmail(tongHop.email || report.email || profile.email);
  const displayName = formatHumanNameOrFallback(tongHop.displayName || report.displayName || profile.displayName || email || uid).slice(0,150);
  const now = Date.now();
  const updates = {};
  updates[`${ROOT}/phanQuyen/${uid}`] = {
    ...tongHop,
    email, displayName,
    username: normalizeUsername(tongHop.username || String(email).split('@')[0]),
    role, active,
    createdAt: tongHop.createdAt || now,
    updatedAt: now,
    updatedByUid: admin.uid,
    revoked: !active,
    revokedAt: active ? null : now,
    revokedByUid: active ? null : admin.uid,
    source: tongHop.source || 'APP_ROLE_SYNC'
  };
  updates[`${REPORT_ROOT}/phanQuyen/${uid}`] = {
    ...report,
    email, displayName, role, active,
    createdAt: report.createdAt || now,
    updatedAt: now,
    updatedByUid: admin.uid,
    source: report.source || 'APP_ROLE_SYNC'
  };
  await update(ref(firebaseDatabase), updates);
  await writeAuditLog(admin, active ? 'Mở khóa tài khoản' : 'Khóa tài khoản', email || uid, '');
  notifyBusinessEvent(active ? 'ACCOUNT_ROLE_CHANGED' : 'ACCOUNT_LOCKED', uid);
  return { success: true, message: active ? 'Đã mở quyền sử dụng ứng dụng.' : 'Đã khóa quyền sử dụng ứng dụng.' };
}

async function adminSetUserRoleFirebase(uid, roleValue) {
  const admin = await requireAppUser('admin');
  const role = dbRole(roleValue);
  if (uid === admin.uid && role !== 'admin') throw new Error('Bạn không thể tự hạ quyền tài khoản Quản trị đang sử dụng.');
  const [tongHopSnap, profileSnap, reportSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen/${uid}`)).catch(() => null),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung/${uid}`)).catch(() => null),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${uid}`)).catch(() => null)
  ]);
  const tongHop = snapshotObject(tongHopSnap), profile = snapshotObject(profileSnap), report = snapshotObject(reportSnap);
  if (!(tongHopSnap && tongHopSnap.exists()) && !(reportSnap && reportSnap.exists())) throw new Error('Không tìm thấy quyền tài khoản.');
  const email = normalizeEmail(tongHop.email || report.email || profile.email);
  if (!email) throw new Error('Không xác định được email tài khoản.');
  const displayName = formatHumanNameOrFallback(tongHop.displayName || report.displayName || profile.displayName || email).slice(0,150);
  const now = Date.now();
  const updates = {};
  updates[`${ROOT}/phanQuyen/${uid}`] = {
    ...tongHop,
    email, displayName,
    username: normalizeUsername(tongHop.username || String(email).split('@')[0]),
    role, active:true,
    createdAt:tongHop.createdAt || now,
    updatedAt:now, updatedByUid:admin.uid,
    source:tongHop.source || 'APP_ROLE_SYNC'
  };
  updates[`${REPORT_ROOT}/phanQuyen/${uid}`] = {
    ...report,
    email, displayName, role, active:true,
    createdAt:report.createdAt || now,
    updatedAt:now, updatedByUid:admin.uid,
    source:report.source || 'APP_ROLE_SYNC'
  };
  await update(ref(firebaseDatabase), updates);
  await writeAuditLog(admin, 'Thay đổi vai trò', `${email || uid} → ${uiRole(role)}`, '');
  notifyBusinessEvent('ACCOUNT_ROLE_CHANGED', uid);
  return { success: true, message: `Đã cập nhật vai trò ${uiRole(role)} cho toàn ứng dụng.` };
}

async function adminRevokeUserFirebase(uid) {
  const admin = await requireAppUser('admin');
  if (uid === admin.uid) throw new Error('Bạn không thể tự thu hồi quyền tài khoản đang sử dụng.');
  const [tongHopSnap, reportSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen/${uid}`)).catch(() => null),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${uid}`)).catch(() => null)
  ]);
  const tongHop=snapshotObject(tongHopSnap), report=snapshotObject(reportSnap);
  if (!(tongHopSnap&&tongHopSnap.exists()) && !(reportSnap&&reportSnap.exists())) throw new Error('Không tìm thấy quyền tài khoản.');
  const now=Date.now(), updates={};
  if (tongHopSnap&&tongHopSnap.exists()) updates[`${ROOT}/phanQuyen/${uid}`]={...tongHop,active:false,revoked:true,revokedAt:now,revokedByUid:admin.uid,updatedAt:now,updatedByUid:admin.uid};
  if (reportSnap&&reportSnap.exists()) updates[`${REPORT_ROOT}/phanQuyen/${uid}`]={...report,active:false,updatedAt:now,updatedByUid:admin.uid};
  await update(ref(firebaseDatabase),updates);
  await writeAuditLog(admin,'Thu hồi quyền ứng dụng',tongHop.email||report.email||uid,'');
  notifyBusinessEvent('ACCOUNT_LOCKED',uid);
  return { success:true,message:'Đã thu hồi quyền sử dụng toàn ứng dụng.' };
}

async function adminDeleteUserFromAppFirebase(uid) {
  const admin = await requireAppUser('admin');
  if (!uid) throw new Error('Thiếu thông tin tài khoản cần xóa.');
  if (uid === admin.uid) throw new Error('Bạn không thể tự xóa tài khoản Quản trị đang sử dụng.');

  const [permissionSnap, requestSnap, reportPermissionSnap, allPermissionsSnap, profileSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen/${uid}`)),
    get(ref(firebaseDatabase, `${ROOT}/yeuCauDangKy/${uid}`)),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${uid}`)).catch(() => null),
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen`)),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung/${uid}`)).catch(() => null)
  ]);

  const permission = snapshotObject(permissionSnap);
  const request = snapshotObject(requestSnap);
  const reportPermission = snapshotObject(reportPermissionSnap);
  const profile = snapshotObject(profileSnap);
  const hasAnyAppRecord = permissionSnap.exists() || requestSnap.exists() || (reportPermissionSnap && reportPermissionSnap.exists()) || (profileSnap && profileSnap.exists());
  if (!hasAnyAppRecord) throw new Error('Tài khoản không còn quyền hoặc yêu cầu đăng ký trong Ứng dụng Phòng Y tế.');

  if (permissionSnap.exists() && permission.role === 'admin') {
    const allPermissions = snapshotObject(allPermissionsSnap);
    const remainingActiveAdmins = Object.keys(allPermissions).filter((key) => {
      if (key === uid) return false;
      const item = allPermissions[key] || {};
      return item.active === true && item.role === 'admin';
    });
    if (!remainingActiveAdmins.length && !ownerUser(admin)) {
      throw new Error('Không thể xóa quản trị viên cuối cùng của Tổng hợp Y tế.');
    }
  }

  const email = normalizeEmail(permission.email || request.email || reportPermission.email || profile.email || '');
  if (email === OWNER_EMAIL && !ownerUser(admin)) {
    throw new Error('Không thể xóa tài khoản quản trị hệ thống.');
  }
  const displayName = formatHumanNameOrFallback(permission.displayName || request.displayName || reportPermission.displayName || profile.displayName || email || uid).slice(0, 150);

  // Ghi audit trước khi gỡ quyền; không xóa lịch sử nghiệp vụ của tài khoản đích.
  await writeAuditLog(admin, 'Xóa tài khoản khỏi ứng dụng', `${displayName}${email ? ` (${email})` : ''}`, '');

  const updates = {};
  updates[`${ROOT}/phanQuyen/${uid}`] = null;
  updates[`${ROOT}/yeuCauDangKy/${uid}`] = null;
  updates[`${REPORT_ROOT}/phanQuyen/${uid}`] = null;
  updates[`${ROOT}/cauHinh/taiKhoanDaXoa/${uid}`] = {
    deletedAt: Date.now(),
    deletedByUid: admin.uid
  };
  // Cố ý giữ yTeApp/nguoiDung, yTeApp/tenHienThi và toàn bộ audit/history để
  // lịch sử vẫn đọc đúng danh tính và không ảnh hưởng phân hệ Y tế/HSBA khác.
  await update(ref(firebaseDatabase), updates);

  return {
    success: true,
    message: 'Đã xóa tài khoản khỏi Ứng dụng Phòng Y tế.'
  };
}


async function requireReportPermissionManager() {
  await authReady;
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Vui lòng đăng nhập.');
  if (ownerUser(user)) return { user, tongHopAdmin: true, reportAdmin: true, owner: true };
  const [tongHopSnap, reportSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen/${user.uid}`)),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${user.uid}`))
  ]);
  const tongHop = snapshotObject(tongHopSnap);
  const report = snapshotObject(reportSnap);
  const tongHopAdmin = tongHop.active === true && tongHop.role === 'admin';
  const reportAdmin = report.active === true && report.role === 'admin';
  if (!tongHopAdmin && !reportAdmin) throw new Error('Bạn không có quyền quản trị tài khoản Báo cáo.');
  return { user, tongHopAdmin, reportAdmin, owner: false };
}

async function getAdminReportUsersFirebase() {
  await requireReportPermissionManager();
  const [directorySnap, permissionSnap, displayNameSnap, deletedSnap, requestSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung`)),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen`)),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/tenHienThi`)).catch(() => null),
    get(ref(firebaseDatabase, `${ROOT}/cauHinh/taiKhoanDaXoa`)).catch(() => null),
    get(ref(firebaseDatabase, `${ROOT}/yeuCauDangKy`)).catch(() => null)
  ]);
  const directory = snapshotObject(directorySnap);
  const permissions = snapshotObject(permissionSnap);
  const customNames = snapshotObject(displayNameSnap);
  const deletedUsers = snapshotObject(deletedSnap);
  const requests = snapshotObject(requestSnap);
  const uids = new Set([...Object.keys(directory), ...Object.keys(permissions)]);
  const users = Array.from(uids).filter((uid) => {
    // Xóa khỏi ứng dụng phải đồng nhất ở cả màn hình Tài khoản Tổng hợp và Quyền Báo cáo.
    // Nếu người dùng đăng nhập lại và phát sinh một yêu cầu pending mới, họ được xem là
    // đăng ký lại và có thể xuất hiện để admin xét duyệt/cấp quyền lại.
    if (!deletedUsers[uid] || permissions[uid]) return true;
    return !!(requests[uid] && requests[uid].status === 'pending');
  }).map((uid) => {
    const profile = directory[uid] || {};
    const permission = permissions[uid] || {};
    return {
      id: uid,
      uid,
      name: formatHumanNameOrFallback((customNames[uid] && customNames[uid].displayName) || permission.displayName || profile.displayName || permission.email || profile.email || ''),
      email: normalizeEmail(permission.email || profile.email || ''),
      role: permission.role || '',
      roleLabel: uiReportRole(permission.role),
      active: permission.active === true,
      status: permission.active === true ? 'Hoạt động' : 'Chưa cấp',
      lastLoginAt: Number(profile.lastLoginAt || 0),
      lastLogin: profile.lastLoginAt ? formatDateTime(profile.lastLoginAt) : ''
    };
  }).sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email), 'vi'));
  return { success: true, users };
}

async function adminSetReportPermissionFirebase(uid, roleValue, activeValue) {
  const manager = await requireReportPermissionManager();
  const user = manager.user;
  const role = dbReportRole(roleValue);
  const active = activeValue === true || activeValue === 'true' || activeValue === 'Hoạt động';
  if (uid === user.uid && (manager.reportAdmin || manager.tongHopAdmin || manager.owner) && (!active || role !== 'admin')) {
    throw new Error('Bạn không thể tự thu hồi hoặc hạ quyền Quản trị đang sử dụng.');
  }
  const [profileSnap, oldReportSnap, oldTongHopSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung/${uid}`)),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${uid}`)).catch(() => null),
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen/${uid}`)).catch(() => null)
  ]);
  const profile = snapshotObject(profileSnap), oldReport = snapshotObject(oldReportSnap), oldTongHop = snapshotObject(oldTongHopSnap);
  const email = normalizeEmail(profile.email || oldReport.email || oldTongHop.email);
  if (!email) throw new Error('Tài khoản chưa đăng nhập Google nên chưa có thông tin để cấp quyền.');
  const displayName = formatHumanNameOrFallback(oldTongHop.displayName || oldReport.displayName || profile.displayName || email).slice(0,150);
  const now = Date.now();
  const updates = {};
  updates[`${ROOT}/phanQuyen/${uid}`] = {
    ...oldTongHop,
    email, displayName,
    username: normalizeUsername(oldTongHop.username || String(email).split('@')[0]),
    role, active,
    createdAt: oldTongHop.createdAt || now,
    updatedAt: now, updatedByUid: user.uid,
    source: oldTongHop.source || 'APP_ROLE_SYNC'
  };
  updates[`${REPORT_ROOT}/phanQuyen/${uid}`] = {
    ...oldReport,
    email, displayName, role, active,
    source: oldReport.source || 'APP_ROLE_SYNC',
    createdAt: oldReport.createdAt || now,
    updatedAt: now, updatedByUid: user.uid
  };
  await update(ref(firebaseDatabase), updates);
  notifyBusinessEvent(active ? 'ACCOUNT_ROLE_CHANGED' : 'ACCOUNT_LOCKED', uid);
  return {
    success: true,
    message: active ? `Đã cấp quyền ${uiReportRole(role)} cho toàn ứng dụng.` : 'Đã thu hồi quyền sử dụng toàn ứng dụng.'
  };
}

async function adminSetDisplayNameFirebase(uid, displayNameValue) {
  const manager = await requireReportPermissionManager();
  const displayName = formatPersonName(displayNameValue);
  if (!uid) throw new Error('Không xác định được tài khoản.');
  if (displayName.length < 2 || displayName.length > 150) throw new Error('Tên hiển thị phải từ 2 đến 150 ký tự.');
  await set(ref(firebaseDatabase, `${YTE_APP_ROOT}/tenHienThi/${uid}`), {
    displayName,
    updatedAt: Date.now(),
    updatedByUid: manager.user.uid
  });
  return { success: true, displayName, message: 'Đã lưu tên hiển thị dùng chung trong Ứng dụng Phòng Y tế.' };
}

async function firebaseCall(name, ...args) {
  // Dashboard chỉ đọc các nhánh congKhai được Realtime Database Rules cho phép public.
  // Không buộc luồng public này phải chờ Firebase Auth khôi phục phiên đăng nhập.
  if (name === 'getDashboardData') return getDashboardDataFirebase(args[0]);

  await authPersistenceReady;
  await authReady;
  switch (name) {
    case 'restoreSession': return restoreSessionFirebase();
    case 'googleLoginAccount': return loginGoogleFirebase();
    case 'logoutSession': return logoutFirebase();
    case 'getDerivedSourceDetails': return getDerivedSourceDetailsFirebase(args[0]);
    case 'getPersonDetailList': return getPersonDetailListFirebase(args[0]);
    case 'getPersonDetailRange': return getPersonDetailRangeFirebase(args[0]);
    case 'savePersonDetail': return savePersonDetailFirebase(args[0]);
    case 'deletePersonDetail': return deletePersonDetailFirebase(args[0]);
    case 'ensurePublicCategoryMirror': return ensurePublicCategoryMirrorFirebase();
    case 'ensureReportStatisticsMarkers': return ensureReportStatisticsMarkersFirebase();
    case 'getDailyData': return getDailyDataFirebase(args[0]);
    case 'adjustDailyData': return adjustDailyDataFirebase(args[0]);
    case 'deleteDailyData': return deleteDailyDataFirebase(args[0]);
    case 'getDailyDataHistory': return getDailyDataHistoryFirebase(args[0]);
    case 'getAdminUsers': return getAdminUsersFirebase();
    case 'getAdminCategories': return getAdminCategoriesFirebase();
    case 'adminSaveCategory': return adminSaveCategoryFirebase(args[1] || args[0]);
    case 'adminSetCategoryStatus': return adminSetCategoryStatusFirebase(args[1] || args[0], args[2] || args[1]);
    case 'adminSetUserStatus': return adminSetUserStatusFirebase(args[1] || args[0], args[2] || args[1]);
    case 'adminSetUserRole': return adminSetUserRoleFirebase(args[1] || args[0], args[2] || args[1]);
    case 'adminApproveRegistration': return adminApproveRegistrationFirebase(args[0], args[1]);
    case 'adminRejectRegistration': return adminRejectRegistrationFirebase(args[0]);
    case 'adminRevokeUser': return adminRevokeUserFirebase(args[1] || args[0]);
    case 'adminDeleteUser': return adminDeleteUserFromAppFirebase(args[1] || args[0]);
    case 'getAdminReportUsers': return getAdminReportUsersFirebase();
    case 'adminSetReportPermission': return adminSetReportPermissionFirebase(args[0], args[1], args[2]);
    case 'adminSetDisplayName': return adminSetDisplayNameFirebase(args[0], args[1]);
    default: throw new Error(`Chức năng không hợp lệ: ${name}`);
  }
}


var AUTO_SYNC_MS = 300000;
    var SILENT_SYNC_MIN_AGE_MS = 45000;
    var DASHBOARD_LOAD_TIMEOUT_MS = 12000;
    var ENTRY_CACHE_MS = 120000;
    var ADMIN_CACHE_MS = 60000;

    var state = {
      categories:[],records:[],from:'',to:'',
      token:'FIREBASE_AUTH',user:null,authUser:null,tongHopPermission:null,reportPermission:null,
      syncTimer:null,syncPromise:null,lastSyncAt:0,busyCount:0,
      dailyByCode:{},loadedEntryDate:'',entryRequestId:0,
      entryCache:{},entryLoads:{},
      adminUsers:[],adminLoadedAt:0,adminPromise:null,
      adminCategories:[],categoryLoadedAt:0,categoryPromise:null,adminSection:'users',
      editingCategoryCode:'',categorySaving:false,
      adjustingCode:'',adjustSaving:false,quickEntrySaving:false,quickEntryBaseline:'',deleteDailyCode:'',deleteDailySaving:false,
      historyCode:'',historyLoading:false,displayNameEditUid:'',
      personManagerCode:'',personManagerDate:'',personManagerRows:[],personManagerTotal:0,personManagerSaving:false,
      personManagerLiveUnsubscribers:[],personManagerLiveRaw:{},personManagerLiveSummary:null,
      sourceDetailLiveUnsubscribers:[],sourceDetailLiveContext:null,sourceDetailLiveRaw:{},sourceDetailLiveSummary:{},
      dashboardLiveUnsubscribe:null,dashboardTransferStatsUnsubscribe:null,dashboardDeathStatsUnsubscribe:null,categoryLiveUnsubscribe:null,entryLiveUnsubscribe:null,entryTransferStatsUnsubscribe:null,entryDeathStatsUnsubscribe:null,
      adminRealtimeUnsubscribers:[],adminRealtimeTimer:null,ownPermissionUnsubscribers:[],ownPermissionUid:'',ownPermissionSignature:'',ownPermissionValues:{tong:null,report:null,tongReady:false,reportReady:false},connectionUnsubscribe:null,wasDisconnected:false,
      dashboardBaseRecords:[],dashboardTransferStats:{},dashboardDeathStats:{},entryBaseRecords:[],entryTransferStats:{},entryDeathStats:{},
      liveRangeKey:'',entryLiveDate:''
    };
    var entryComposerReturnFocus=null;

    function $(id){return document.getElementById(id)}
    function publicCategoriesFromSnapshot(snap){
      var raw=snapshotObject(snap);
      return Object.keys(raw).map(function(code){var item=raw[code]||{},category=decorateCategory({code:code,name:item.ten||code,group:item.nhom||'Khác',unit:item.donVi||'Lượt',order:Number(item.thuTu||9999),status:item.trangThai||'Hoạt động'});return category}).filter(function(item){return item.status==='Hoạt động'}).sort(function(a,b){return a.order-b.order||a.name.localeCompare(b.name,'vi')});
    }
    function dashboardRecordsFromSnapshot(snap){
      var raw=snapshotObject(snap),records=[];
      Object.keys(raw).sort().forEach(function(date){var day=raw[date]||{};Object.keys(day).forEach(function(code){var item=day[code]||{};records.push({id:date+'-'+code,date:date,code:code,name:item.ten||code,value:Number(item.giaTri||0),note:'',updatedAt:item.updatedAt||0,version:Number(item.version||0)})})});
      return records;
    }
    function dailyRecordsFromSnapshot(snap,date){
      var raw=snapshotObject(snap);
      return Object.keys(raw).map(function(code){var item=raw[code]||{};return{id:date+'-'+code,date:date,code:code,name:item.ten||code,value:Number(item.giaTri||0),note:item.ghiChu||'',updatedBy:item.updatedByName||'',updatedAt:item.updatedAt?formatDateTime(item.updatedAt):'',version:Number(item.version||0)}});
    }
    function composeDashboardRecords(){
      state.records=mergeDerivedRangeRecords(state.dashboardBaseRecords,state.categories,state.dashboardTransferStats,state.dashboardDeathStats,state.from,state.to);
    }
    function composeEntryRecords(date){
      return mergeDerivedDailyRecords(state.entryBaseRecords,state.categories,date,state.entryTransferStats,state.entryDeathStats);
    }
    function stopDashboardRealtime(){
      [state.dashboardLiveUnsubscribe,state.dashboardTransferStatsUnsubscribe,state.dashboardDeathStatsUnsubscribe].forEach(function(fn){if(typeof fn==='function')fn()});
      state.dashboardLiveUnsubscribe=null;state.dashboardTransferStatsUnsubscribe=null;state.dashboardDeathStatsUnsubscribe=null;state.liveRangeKey='';
    }
    function stopEntryRealtime(){
      [state.entryLiveUnsubscribe,state.entryTransferStatsUnsubscribe,state.entryDeathStatsUnsubscribe].forEach(function(fn){if(typeof fn==='function')fn()});
      state.entryLiveUnsubscribe=null;state.entryTransferStatsUnsubscribe=null;state.entryDeathStatsUnsubscribe=null;state.entryLiveDate='';
    }
    function startCategoryRealtime(){
      if(state.categoryLiveUnsubscribe)return;
      state.categoryLiveUnsubscribe=onValue(ref(firebaseDatabase,ROOT+'/congKhai/danhMucChiTieu'),function(snap){
        var publicList=publicCategoriesFromSnapshot(snap);
        // v9.9.4: nếu mirror công khai bị dọn trong lúc bàn giao, tài khoản đã cấp quyền
        // vẫn dùng danh mục private đã nạp từ session thay vì làm dropdown rỗng.
        if(publicList.length || !state.categories.length) {
          if(Object.keys(state.dashboardTransferStats||{}).some(function(date){return markerCount((state.dashboardTransferStats||{})[date]||{},'transfer')>0})&&!derivedCategory(publicList,'transfer')) publicList.push(decorateCategory({code:'CHUYEN_VIEN',name:'Chuyển viện',group:'Báo cáo',unit:'Lượt',order:9001,status:'Hoạt động'}));
          if(Object.keys(state.dashboardDeathStats||{}).some(function(date){return markerCount((state.dashboardDeathStats||{})[date]||{},'death')>0})&&!derivedCategory(publicList,'death')) publicList.push(decorateCategory({code:'TU_VONG',name:'Tử vong',group:'Báo cáo',unit:'Lượt',order:9002,status:'Hoạt động'}));
          state.categories=publicList.sort(function(a,b){return a.order-b.order||a.name.localeCompare(b.name,'vi')});
        }
        populateContentFilter();composeDashboardRecords();renderAll();if(currentViewName()==='entry'){var date=$('entryDate').value;if(date&&state.entryLiveDate===date){var merged=composeEntryRecords(date);cacheDaily(date,merged);applyDailyCache(date)}renderIndicators()}
      },function(error){console.warn('Realtime danh mục:',error)});
    }
    function startDashboardRealtime(force){
      var range;try{range=getRange()}catch(error){return}
      var key=range.from+'|'+range.to;
      if(!force&&state.dashboardLiveUnsubscribe&&state.dashboardTransferStatsUnsubscribe&&state.dashboardDeathStatsUnsubscribe&&state.liveRangeKey===key)return;
      stopDashboardRealtime();state.liveRangeKey=key;state.from=range.from;state.to=range.to;
      var liveQuery=query(ref(firebaseDatabase,ROOT+'/congKhai/soLieuTheoNgay'),orderByKey(),startAt(range.from),endAt(range.to));
      var transferQuery=query(ref(firebaseDatabase,PUBLIC_REPORT_STATS_ROOT+'/chuyenVienTheoNgay'),orderByKey(),startAt(range.from),endAt(range.to));
      var deathQuery=query(ref(firebaseDatabase,PUBLIC_REPORT_STATS_ROOT+'/tuVongTheoNgay'),orderByKey(),startAt(range.from),endAt(range.to));
      function refresh(){
        if(Object.keys(state.dashboardTransferStats||{}).some(function(date){return markerCount((state.dashboardTransferStats||{})[date]||{},'transfer')>0})&&!derivedCategory(state.categories,'transfer')) state.categories.push(decorateCategory({code:'CHUYEN_VIEN',name:'Chuyển viện',group:'Báo cáo',unit:'Lượt',order:9001,status:'Hoạt động'}));
        if(Object.keys(state.dashboardDeathStats||{}).some(function(date){return markerCount((state.dashboardDeathStats||{})[date]||{},'death')>0})&&!derivedCategory(state.categories,'death')) state.categories.push(decorateCategory({code:'TU_VONG',name:'Tử vong',group:'Báo cáo',unit:'Lượt',order:9002,status:'Hoạt động'}));
        composeDashboardRecords();state.lastSyncAt=Date.now();$('rangeLabel').textContent=range.label;populateContentFilter();renderAll()
      }
      state.dashboardLiveUnsubscribe=onValue(liveQuery,function(snap){state.dashboardBaseRecords=dashboardRecordsFromSnapshot(snap);refresh()},function(error){console.warn('Realtime tổng quan:',error)});
      state.dashboardTransferStatsUnsubscribe=onValue(transferQuery,function(snap){state.dashboardTransferStats=snapshotObject(snap);refresh()},function(error){console.warn('Realtime chuyển viện tự động:',error)});
      state.dashboardDeathStatsUnsubscribe=onValue(deathQuery,function(snap){state.dashboardDeathStats=snapshotObject(snap);refresh()},function(error){console.warn('Realtime tử vong tự động:',error)});
    }
    function startEntryRealtime(date){
      date=String(date||'');if(!state.user||!/^\d{4}-\d{2}-\d{2}$/.test(date)){stopEntryRealtime();return}
      if(state.entryLiveUnsubscribe&&state.entryTransferStatsUnsubscribe&&state.entryDeathStatsUnsubscribe&&state.entryLiveDate===date)return;
      stopEntryRealtime();state.entryLiveDate=date;
      function refreshEntry(){
        if(markerCount(state.entryTransferStats||{},'transfer')>0&&!derivedCategory(state.categories,'transfer')) state.categories.push(decorateCategory({code:'CHUYEN_VIEN',name:'Chuyển viện',group:'Báo cáo',unit:'Lượt',order:9001,status:'Hoạt động'}));
        if(markerCount(state.entryDeathStats||{},'death')>0&&!derivedCategory(state.categories,'death')) state.categories.push(decorateCategory({code:'TU_VONG',name:'Tử vong',group:'Báo cáo',unit:'Lượt',order:9002,status:'Hoạt động'}));
        var records=composeEntryRecords(date);cacheDaily(date,records);if($('entryDate').value===date){applyDailyCache(date);setEntryLoadState('','ok',false)}
      }
      state.entryLiveUnsubscribe=onValue(ref(firebaseDatabase,ROOT+'/soLieuTheoNgay/'+date),function(snap){state.entryBaseRecords=dailyRecordsFromSnapshot(snap,date);refreshEntry()},function(error){console.warn('Realtime nhập liệu:',error);if(currentViewName()==='entry')setEntryLoadState('Mất kết nối đồng bộ trực tiếp. Ứng dụng sẽ tự kết nối lại khi mạng ổn định.','err',false)});
      state.entryTransferStatsUnsubscribe=onValue(ref(firebaseDatabase,PUBLIC_REPORT_STATS_ROOT+'/chuyenVienTheoNgay/'+date),function(snap){state.entryTransferStats=snapshotObject(snap);refreshEntry()},function(error){console.warn('Realtime chuyển viện ngày:',error)});
      state.entryDeathStatsUnsubscribe=onValue(ref(firebaseDatabase,PUBLIC_REPORT_STATS_ROOT+'/tuVongTheoNgay/'+date),function(snap){state.entryDeathStats=snapshotObject(snap);refreshEntry()},function(error){console.warn('Realtime tử vong ngày:',error)});
    }
    function stopOwnPermissionRealtime(){
      (state.ownPermissionUnsubscribers||[]).forEach(function(fn){if(typeof fn==='function')try{fn()}catch(_){}});
      state.ownPermissionUnsubscribers=[];state.ownPermissionUid='';state.ownPermissionSignature='';state.ownPermissionValues={tong:null,report:null,tongReady:false,reportReady:false};resetPermissionStore();
    }
    function startOwnPermissionRealtime(){
      var uid=state.authUser&&state.authUser.uid;if(!uid){stopOwnPermissionRealtime();return}
      if(state.ownPermissionUid===uid&&state.ownPermissionUnsubscribers.length)return;
      stopOwnPermissionRealtime();state.ownPermissionUid=uid;
      function accept(kind,snap){
        var v=snap.exists()?snapshotObject(snap):null;
        state.ownPermissionValues[kind]=v;state.ownPermissionValues[kind+'Ready']=true;
        if(!state.ownPermissionValues.tongReady||!state.ownPermissionValues.reportReady)return;
        publishPermissionStore(uid,state.ownPermissionValues.tong,state.ownPermissionValues.report,true);
        var signature=JSON.stringify({tong:state.ownPermissionValues.tong||null,report:state.ownPermissionValues.report||null});
        if(!state.ownPermissionSignature){state.ownPermissionSignature=signature;return}
        if(signature===state.ownPermissionSignature)return;
        state.ownPermissionSignature=signature;
        window.clearTimeout(state._permissionRefreshTimer);
        state._permissionRefreshTimer=window.setTimeout(function(){refreshCurrentSession().catch(function(){})},120);
      }
      state.ownPermissionUnsubscribers.push(onValue(ref(firebaseDatabase,ROOT+'/phanQuyen/'+uid),function(snap){accept('tong',snap)},function(error){console.warn('Realtime quyền Tổng hợp:',error)}));
      state.ownPermissionUnsubscribers.push(onValue(ref(firebaseDatabase,REPORT_ROOT+'/phanQuyen/'+uid),function(snap){accept('report',snap)},function(error){console.warn('Realtime quyền Báo cáo:',error)}));
    }
    function stopAdminRealtime(){
      (state.adminRealtimeUnsubscribers||[]).forEach(function(fn){if(typeof fn==='function')try{fn()}catch(_){}});
      state.adminRealtimeUnsubscribers=[];window.clearTimeout(state.adminRealtimeTimer);state.adminRealtimeTimer=null;
    }
    function scheduleAdminRealtimeRefresh(kind){
      if(kind==='users')state.adminLoadedAt=0;
      if(kind==='reports')state.adminLoadedAt=0;
      if(kind==='categories')state.categoryLoadedAt=0;
      window.clearTimeout(state.adminRealtimeTimer);
      state.adminRealtimeTimer=window.setTimeout(function(){
        if(currentViewName()!=='admin')return;
        if(state.adminSection==='users')loadAdminUsers(true).catch(function(){});
        else if(state.adminSection==='categories')loadAdminCategories(true).catch(function(){});

      },280);
    }
    function startAdminRealtime(){
      if(!isAnyAppAdmin()){stopAdminRealtime();return}
      if(state.adminRealtimeUnsubscribers&&state.adminRealtimeUnsubscribers.length)return;
      var targets=[
        [ROOT+'/phanQuyen','users'],[ROOT+'/yeuCauDangKy','users'],[YTE_APP_ROOT+'/tenHienThi','users'],
        [REPORT_ROOT+'/phanQuyen','users'],[ROOT+'/danhMucChiTieu','categories']
      ];
      targets.forEach(function(item){
        var first=true;
        state.adminRealtimeUnsubscribers.push(onValue(ref(firebaseDatabase,item[0]),function(){if(first){first=false;return}scheduleAdminRealtimeRefresh(item[1])},function(error){console.warn('Realtime Quản trị '+item[0]+':',error)}));
      });
    }
    function startConnectionRealtime(){
      if(state.connectionUnsubscribe)return;
      state.connectionUnsubscribe=onValue(ref(firebaseDatabase,'.info/connected'),function(snap){
        var connected=snap.val()===true;
        document.documentElement.dataset.firebaseConnected=connected?'true':'false';
        document.body.classList.toggle('firebase-offline',!connected);
        if($('sidebarConnectionDot')) $('sidebarConnectionDot').classList.toggle('is-offline',!connected);
        if($('sidebarConnectionText')) $('sidebarConnectionText').textContent=connected?'Đã kết nối':(navigator.onLine?'Đang kết nối lại':'Mất kết nối Internet');
        if(!connected){state.wasDisconnected=true;return}
        if(state.wasDisconnected){
          state.wasDisconnected=false;toast('Đã kết nối lại. Dữ liệu đang được đồng bộ tự động.','ok');
          Promise.resolve(syncData(true,true)).catch(function(){});
          if(currentViewName()==='entry'&&$('entryDate').value)loadDay({silent:true,force:true,notify:false}).catch(function(){});
          if(!$('personDetailLayer').hidden&&state.personManagerCode)startPersonManagerRealtime(true);
        }
      },function(error){console.warn('Theo dõi kết nối Firebase:',error)});
    }
    function call(name){
      var args=Array.prototype.slice.call(arguments,1);
      return firebaseCall.apply(null,[name].concat(args)).catch(function(error){
        var messageText=error&&error.message?error.message:String(error||'Có lỗi xảy ra.');
        if(/auth\/invalid-credential|auth\/invalid-login-credentials|auth\/wrong-password|auth\/user-not-found/.test(String(error&&error.code||'')+' '+messageText))messageText='Email hoặc mật khẩu không đúng.';
        if(/auth\/email-already-in-use/.test(String(error&&error.code||'')))messageText='Email này đã được đăng ký.';
        if(/PERMISSION_DENIED|permission_denied/i.test(messageText))messageText='Bạn không có quyền thực hiện thao tác này hoặc dữ liệu vừa thay đổi ở thiết bị khác. Ứng dụng sẽ tự đồng bộ dữ liệu mới nhất.';
        throw new Error(messageText);
      });
    }
    function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
    function uiIcon(name){
      var icons={
        edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
        history:'<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6"/><path d="M12 7v5l3 2"/>',
        plus:'<path d="M12 5v14M5 12h14"/>',
        dots:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
        check:'<path d="m5 12 4 4L19 6"/>'
      };
      return '<svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(icons[name]||'')+'</svg>';
    }
    function uiMetricIcon(category){
      var kind=metricKindFromCategory(category),text=normalizeMetricText((category&&category.name||'')+' '+(category&&category.group||'')),body='';
      if(kind==='transfer')body='<path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>';
      else if(kind==='death')body='<path d="M3 12h4l2-5 4 10 2-5h6"/>';
      else if(/noi tru|kham|benh|y te|suc khoe/.test(text))body='<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10Z"/><path d="M9 12h2l1-2 2 4 1-2h2"/>';
      else if(/thuoc|duoc/.test(text))body='<path d="m10.5 20.5-7-7a4 4 0 0 1 5.7-5.7l7 7a4 4 0 0 1-5.7 5.7Z"/><path d="m8 6 10 10"/>';
      else body='<path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>';
      return '<span class="summary-icon '+(kind?'is-'+kind:'')+'" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+body+'</svg></span>';
    }
    function isoLocal(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')}
    function fmtDate(value){var p=String(value||'').split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:String(value||'')}
    function toast(text,type){var box=$('toast');box.textContent=text;box.className='toast '+(type||'ok');box.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(function(){box.hidden=true},3500)}
    function message(text,type){type=type||'ok';if(type==='ok'){clearMessage();toast(text,'ok');return}$('message').innerHTML='<div class="message '+type+'">'+esc(text)+'</div>';window.scrollTo({top:0,behavior:'smooth'});toast(text,type)}
    function clearMessage(){$('message').innerHTML=''}
    var confirmResolver=null;
    function closeConfirm(result){var layer=$('confirmLayer');if(layer.hidden)return;layer.hidden=true;var anotherDialog=['personDetailLayer','sourceDetailLayer','dataHistoryLayer','categoryLayer'].some(function(id){var el=$(id);return el&&!el.hidden});document.body.style.overflow=anotherDialog?'hidden':'';var resolver=confirmResolver;confirmResolver=null;if(resolver)resolver(!!result)}
    function confirmAction(options){options=options||{};if(confirmResolver)closeConfirm(false);$('confirmTitle').textContent=options.title||'Xác nhận thao tác';$('confirmMessage').textContent=options.message||'';$('confirmAccept').textContent=options.confirmText||'Xác nhận';$('confirmCancel').textContent=options.cancelText||'Quay lại';$('confirmAccept').className='btn '+(options.danger?'btn-danger':'btn-primary');$('confirmLayer').classList.toggle('is-danger',!!options.danger);$('confirmLayer').hidden=false;document.body.style.overflow='hidden';window.setTimeout(function(){$('confirmAccept').focus()},0);return new Promise(function(resolve){confirmResolver=resolve})}
    function setBusy(active,text){state.busyCount=Math.max(0,state.busyCount+(active?1:-1));if(active&&text)$('loadingText').textContent=text;document.body.classList.toggle('is-busy',state.busyCount>0);if(state.busyCount===0)$('loadingText').textContent='Đang xử lý...'}
    function withTimeout(promise,timeoutMs,messageText){
      var timer=null;
      return Promise.race([
        Promise.resolve(promise),
        new Promise(function(_,reject){timer=window.setTimeout(function(){reject(new Error(messageText||'Tác vụ mất quá nhiều thời gian.'))},timeoutMs)})
      ]).finally(function(){if(timer!==null)window.clearTimeout(timer)});
    }
    function currentViewName(){var view=document.querySelector('.view.active');return view?view.id.replace(/View$/,''):''}
    function friendlyGivenName(value){
      var text=String(value||'').trim().replace(/\s+/g,' ');
      if(!text)return 'bạn';
      if(text.indexOf('@')>=0)text=text.split('@')[0].replace(/[._-]+/g,' ').trim();
      var parts=text.split(' ').filter(Boolean);
      return parts.length?parts[parts.length-1]:'bạn';
    }
    function isTongHopAdmin(){return!!(state.user&&state.user.role==='Quản trị')}
    function isReportAdmin(){return!!(state.reportPermission&&state.reportPermission.active===true&&state.reportPermission.role==='admin')}
    function isOwnerAdmin(){return!!(state.authUser&&normalizeEmail(state.authUser.email)===OWNER_EMAIL)}
    function isAnyAppAdmin(){return isOwnerAdmin()||isTongHopAdmin()||isReportAdmin()}
    function effectiveUiDbRole(){if(isAnyAppAdmin())return'admin';return state.user?dbRole(state.user.role):''}
    function hasReportAccess(){return!!state.authUser&&!!effectiveUiDbRole()}
    function canInputTongHop(){var role=effectiveUiDbRole();return role==='admin'||role==='nhaplieu'}
    function canViewDerivedDetails(){return!!state.authUser&&(isAnyAppAdmin()||!!state.user||hasReportAccess())}

    function defaultPrivateView(){
      if(state.user||hasReportAccess())return 'dashboard';
      return 'home';
    }

    async function requestViewNavigation(name){
      if(currentViewName()==='entry'&&name!=='entry'&&quickEntryDirty()){
        var confirmed=await confirmAction({title:'Rời màn hình Nhập liệu?',message:'Bạn có số liệu chưa lưu. Nếu chuyển màn hình, phần đang nhập có thể bị mất. Bạn muốn tiếp tục không?',confirmText:'Tiếp tục chuyển',cancelText:'Ở lại nhập liệu',danger:true});
        if(!confirmed)return false;
      }
      showView(name);
      return true;
    }
    function showView(name){
      setAccountMenu(false);
      var isAdmin=isAnyAppAdmin();
      var hasReport=hasReportAccess();
      var hasTongHop=!!state.user,canInput=canInputTongHop();
      if(name==='admin'&&!isAdmin){name=state.authUser?defaultPrivateView():'dashboard';message('Bạn không có quyền truy cập chức năng này.','err')}
      if(name==='entry'&&!canInput)name='dashboard';
      if(name==='reports'||name==='report'||name==='baocao')name='dashboard';
      if(name==='reconciliation')name='dashboard';
      if(name==='journey'&&!hasReport)name='dashboard';
      if(name==='home')name=hasTongHop||hasReport?defaultPrivateView():'dashboard';
      if(!$(name+'View'))name=defaultPrivateView();
      document.querySelectorAll('.view').forEach(function(view){view.classList.remove('active')});
      var target=$(name+'View');if(target)target.classList.add('active');
      document.querySelectorAll('.nav-item').forEach(function(button){var active=button.getAttribute('data-view')===name;button.classList.toggle('active',active);button.setAttribute('aria-current',active?'page':'false')});
      window.scrollTo({top:0,behavior:'smooth'});
      if(name==='entry')activateEntryView();
      if(name==='admin')showAdminSection(state.adminSection||'users');

      if(window.YTE_REPORTS&&typeof window.YTE_REPORTS.onViewChanged==='function')window.YTE_REPORTS.onViewChanged(name);
    }

    function setupDates(){
      var now=new Date(),today=isoLocal(now);
      $('singleDate').value=today;$('fromDate').value=today;$('toDate').value=today;$('entryDate').value=today;$('monthValue').value=today.slice(0,7);
      for(var year=now.getFullYear()-5;year<=now.getFullYear()+2;year++)$('yearValue').add(new Option(String(year),String(year)));
      $('yearValue').value=String(now.getFullYear());$('quarterValue').value=String(Math.ceil((now.getMonth()+1)/3));
    }
    function updateRangeFields(){var type=$('rangeType').value;['dateField','fromField','toField','monthField','quarterField','yearField'].forEach(function(id){$(id).hidden=true});if(type==='day')$('dateField').hidden=false;if(type==='range'){$('fromField').hidden=false;$('toField').hidden=false}if(type==='month')$('monthField').hidden=false;if(type==='quarter'){$('quarterField').hidden=false;$('yearField').hidden=false}if(type==='year')$('yearField').hidden=false}
    function getRange(){
      var type=$('rangeType').value,from,to,label;
      if(type==='day'){from=to=$('singleDate').value;label='Ngày '+fmtDate(from)}
      else if(type==='range'){from=$('fromDate').value;to=$('toDate').value;label='Từ '+fmtDate(from)+' đến '+fmtDate(to)}
      else if(type==='month'){var month=$('monthValue').value,mp=month.split('-'),lastDay=new Date(Number(mp[0]),Number(mp[1]),0).getDate();from=month+'-01';to=month+'-'+String(lastDay).padStart(2,'0');label='Tháng '+mp[1]+'/'+mp[0]}
      else if(type==='quarter'){var year=Number($('yearValue').value),quarter=Number($('quarterValue').value),startMonth=(quarter-1)*3+1,endMonth=startMonth+2,lastQuarterDay=new Date(year,endMonth,0).getDate();from=year+'-'+String(startMonth).padStart(2,'0')+'-01';to=year+'-'+String(endMonth).padStart(2,'0')+'-'+String(lastQuarterDay).padStart(2,'0');label='Quý '+quarter+'/'+year}
      else{var selectedYear=$('yearValue').value;from=selectedYear+'-01-01';to=selectedYear+'-12-31';label='Năm '+selectedYear}
      if(!from||!to)throw new Error('Vui lòng chọn đầy đủ thời gian.');if(from>to)throw new Error('Từ ngày không được lớn hơn đến ngày.');return{from:from,to:to,label:label};
    }
    // Dữ liệu lịch sử vẫn phải xuất hiện nếu danh mục đã bị ẩn hoặc mirror chưa cập nhật.
    // Không suy diễn đơn vị hoặc coi bản ghi không tồn tại là 0 đã xác nhận.
    function dashboardAvailableCategories(){
      var categories=(state.categories||[]).slice(),existing=new Set(categories.map(function(c){return c.code}));
      (state.records||[]).forEach(function(record){
        if(!record||!record.code||existing.has(record.code))return;
        existing.add(record.code);
        categories.push(decorateCategory({code:record.code,name:record.name||record.code,
          group:'Dữ liệu lịch sử / cần kiểm tra danh mục',unit:'',order:9999,status:'Không còn trong danh mục đang hoạt động'}));
      });
      return categories;
    }
    function populateContentFilter(){
      var filter=$('contentFilter'),current=filter.value||'all',categories=dashboardAvailableCategories();
      filter.innerHTML='<option value="all">Tất cả chỉ tiêu</option>'+categories.map(function(c){return'<option value="'+esc(c.code)+'">'+esc(c.name)+'</option>'}).join('');
      filter.value=categories.some(function(c){return c.code===current})?current:'all';
    }
    function selectedCategories(){var code=$('contentFilter').value||'all',categories=dashboardAvailableCategories();return code==='all'?categories:categories.filter(function(c){return c.code===code})}

    function syncData(silent,force){
      if(silent&&!force&&state.lastSyncAt&&Date.now()-state.lastSyncAt<SILENT_SYNC_MIN_AGE_MS)return Promise.resolve();
      if(state.syncPromise)return state.syncPromise;
      state.syncPromise=(async function(){
        try{
          var range=getRange();
          if(!silent)setBusy(true,'Đang tải dữ liệu...');
          var result=await withTimeout(
            call('getDashboardData',{from:range.from,to:range.to}),
            DASHBOARD_LOAD_TIMEOUT_MS,
            'Kết nối dữ liệu đang chậm. Ứng dụng sẽ tiếp tục tự đồng bộ khi mạng ổn định.'
          );
          if(!result||!result.success)throw new Error(result&&result.message?result.message:'Không thể tải dữ liệu.');
          state.categories=result.categories||[];state.records=result.records||[];state.from=result.from;state.to=result.to;state.lastSyncAt=Date.now();
          populateContentFilter();$('rangeLabel').textContent=range.label;renderAll();
          startCategoryRealtime();startDashboardRealtime(false);
          if(currentViewName()==='entry')renderIndicators();
          if(!silent)toast('Dữ liệu đã được cập nhật.','ok');
        }catch(error){if(!silent)message(error.message||String(error),'err')}
        finally{if(!silent)setBusy(false);state.syncPromise=null}
      })();return state.syncPromise;
    }
    function aggregate(){var totals={};state.records.forEach(function(record){totals[record.code]=(totals[record.code]||0)+Number(record.value||0)});return totals}
    function recordedCodeMap(){var map={};state.records.forEach(function(record){map[record.code]=true});return map}
    function renderAll(){var totals=aggregate();renderSummary(totals);}
    function categoryPriority(c){
      if(c.derivedKind==='transfer')return 0;
      if((c.personDetailKind||personDetailKindFromCategory(c))==='tb')return 1;
      if(c.derivedKind==='death')return 2;
      if((c.personDetailKind||personDetailKindFromCategory(c))==='center')return 3;
      return 99;
    }
    function sortedSummaryCategories(){
      return selectedCategories().slice().sort(function(a,b){return categoryPriority(a)-categoryPriority(b)||Number(a.order||9999)-Number(b.order||9999)||a.name.localeCompare(b.name,'vi')});
    }
    function renderSummary(totals){
      var recorded=recordedCodeMap(),categories=sortedSummaryCategories();
      var positive=categories.filter(function(c){return !!recorded[c.code]&&Number(totals[c.code]||0)>0});
      var nonPositive=categories.filter(function(c){return !recorded[c.code]||Number(totals[c.code]||0)===0});
      var canSeeSource=canViewDerivedDetails(),label=$('dashboardIndicatorCaption');
      if(label)label.textContent=positive.length+' chỉ tiêu phát sinh · '+nonPositive.length+' chỉ tiêu chưa phát sinh hoặc chưa ghi nhận';
      function card(c){
        var exists=!!recorded[c.code],value=Number(totals[c.code]||0),personKind=c.personDetailKind||personDetailKindFromCategory(c);
        var chip=c.derivedKind?'<span class="status-chip is-auto">Tự động từ nguồn Chuyển viện</span>':personKind?'<span class="status-chip is-auto">Theo danh sách đối tượng</span>':'';
        var detail='';
        if(c.derivedKind&&canSeeSource)detail='<button class="summary-source-detail-btn" data-source-kind="'+esc(c.derivedKind)+'" type="button"><span>Xem chi tiết</span><strong>'+value.toLocaleString('vi-VN')+' '+esc(c.unit)+'</strong><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>';
        else if(personKind&&canSeeSource)detail='<button class="summary-source-detail-btn" data-source-kind="person" data-code="'+esc(c.code)+'" type="button"><span>Xem chi tiết</span><strong>'+value.toLocaleString('vi-VN')+' '+esc(c.unit)+'</strong><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>';
        var display=exists?'<span class="summary-number">'+value.toLocaleString('vi-VN')+'</span>':'<span class="summary-unrecorded">Chưa ghi nhận</span>';
        return '<article class="summary-item summary-recorded-item '+(!exists?'is-unrecorded ':'')+((c.derivedKind||personKind)?'is-auto-derived':'')+'">'+uiMetricIcon(c)+'<div class="summary-copy"><h3>'+esc(c.name)+'</h3><p>'+esc(c.group)+'</p></div><div class="summary-value">'+display+(exists?'<span class="summary-unit">'+esc(c.unit)+'</span>':'')+chip+'</div>'+detail+'</article>';
      }
      var markup=positive.map(card).join('');
      if(nonPositive.length){
        markup+='<details class="dashboard-other-metrics" '+(positive.length?'':'open')+'><summary><span>Chỉ tiêu chưa phát sinh / chưa ghi nhận</span><strong>'+nonPositive.length+'</strong><span aria-hidden="true">⌄</span></summary><div class="summary-grid summary-grid-secondary">'+nonPositive.map(card).join('')+'</div></details>';
      }
      if(!categories.length)markup='<div class="empty dashboard-recorded-empty" style="grid-column:1/-1"><strong>Chưa có danh mục chỉ tiêu phù hợp.</strong><span>Vui lòng kiểm tra danh mục hoặc bỏ lọc chỉ tiêu.</span></div>';
      $('summaryCards').innerHTML=markup;
    }
    function summaryNotesForCategory(code){
      var notes=(state.records||[]).filter(function(r){return r.code===code&&String(r.note||'').trim()}).map(function(r){return fmtDate(r.date)+': '+String(r.note||'').trim()});
      return Array.from(new Set(notes)).join('; ');
    }
    function keyDashboardCategories(){
      function rank(c){if(c.derivedKind==='transfer')return 0;if((c.personDetailKind||personDetailKindFromCategory(c))==='tb')return 1;if(c.derivedKind==='death')return 2;if((c.personDetailKind||personDetailKindFromCategory(c))==='center')return 3;return 99}
      if(($('contentFilter')&&$('contentFilter').value||'all')!=='all')return selectedCategories();
      var all=(state.categories||[]).slice().sort(function(a,b){return rank(a)-rank(b)||Number(a.order||9999)-Number(b.order||9999)});
      var primary=all.filter(function(c){return rank(c)<99});
      return (primary.length?primary:all).slice(0,4);
    }
    function metricAccent(category,index){
      if(category&&category.derivedKind==='transfer')return 'pink';
      if(category&&category.derivedKind==='death')return 'rose';
      var person=category&&(category.personDetailKind||personDetailKindFromCategory(category));
      if(person==='tb')return 'blue';if(person==='center')return 'green';
      return ['pink','blue','rose','green'][index%4];
    }
    function renderEntrySideExtras(){
      var categories=keyDashboardCategories();
      if($('entryTodaySummary')){
        $('entryTodaySummary').innerHTML=categories.map(function(c,i){var r=state.dailyByCode&&state.dailyByCode[c.code];return '<div class="entry-today-item is-'+metricAccent(c,i)+'"><span>'+esc(c.name)+'</span><strong>'+Number(r&&r.value||0).toLocaleString('vi-VN')+'</strong><small>'+esc(c.unit||'')+'</small></div>'}).join('');
      }
      if($('entryRecentList')){
        var rows=Object.keys(state.dailyByCode||{}).map(function(code){return state.dailyByCode[code]}).filter(Boolean).sort(function(a,b){return Number(b.updatedAt||0)-Number(a.updatedAt||0)}).slice(0,5);
        $('entryRecentList').innerHTML=rows.length?rows.map(function(r){var c=(state.categories||[]).find(function(x){return x.code===r.code})||{name:r.name||r.code,unit:'Lượt'};var note=String(r.note||'').trim();return '<div class="entry-recent-item"><div><strong>'+esc(c.name)+'</strong><small>'+esc(r.updatedBy||'Đã ghi nhận')+'</small>'+(note?'<small class="entry-recent-note">'+esc(note)+'</small>':'')+'</div><span>'+Number(r.value||0).toLocaleString('vi-VN')+' '+esc(c.unit||'')+'</span></div>'}).join(''):'<div class="dashboard-chart-empty">Chưa có dữ liệu trong ngày này.</div>';
      }
    }
    function exportDashboardExcel(){
      try{
        var range=getRange(),available=selectedCategories(),allowed=new Set(available.map(function(c){return c.code})),cats=new Map(available.map(function(c){return[c.code,c]}));
        downloadXlsx({filename:'Bao-cao-Y-te_'+range.from+'_'+range.to+'.xlsx',sheetName:'Tong hop',title:'TỔNG HỢP SỐ LIỆU PHÒNG Y TẾ',subtitle:range.label,columns:[{key:'date',label:'Ngày',width:14},{key:'name',label:'Chỉ tiêu',width:32},{key:'value',label:'Giá trị',width:12},{key:'unit',label:'Đơn vị',width:12},{key:'note',label:'Nội dung/Ghi chú',width:42}],rows:(state.records||[]).filter(function(r){return allowed.has(r.code)}).map(function(r){var c=cats.get(r.code)||{};return{date:fmtDate(r.date),name:c.name||r.name||r.code,value:Number(r.value||0),unit:c.unit||'',note:String(r.note||'')}})});
      }catch(error){toast(error.message||'Không thể xuất Excel.','err')}
    }
    function setupProductionUiBindings(){
      if($('mobileNavLogout'))$('mobileNavLogout').addEventListener('click',logout);
      if($('btnDashboardExport'))$('btnDashboardExport').addEventListener('click',exportDashboardExcel);
      initializeGlobalIndicatorSearch();
    }

    // Global quick search: only the public indicator catalog and authorized navigation.
    // No private patient records are loaded for suggestions.
    function initializeGlobalIndicatorSearch(){
      var sources=[{input:$('globalSearch'),list:$('globalSearchResults')},{input:$('mobileGlobalSearch'),list:$('mobileSearchResults')}].filter(function(item){return item.input&&item.list});
      var savedFilter=null, selectedCode=null, activeIndex=-1;
      function normalize(text){return String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/\s+/g,' ').trim()}
      function accessibleViews(){
        var output=[{type:'view',name:'Tổng quan',group:'Chức năng',view:'dashboard'}];
        if(canInputTongHop())output.push({type:'view',name:'Nhập liệu',group:'Chức năng',view:'entry'});
        if(hasReportAccess())output.push({type:'view',name:'Chuyển viện',group:'Chức năng',view:'journey'});
        return output;
      }
      function matching(q){
        var term=normalize(q);if(!term)return[];
        var catalog=dashboardAvailableCategories().map(function(c){return{type:'indicator',name:c.name||c.code,group:c.group||'Chỉ tiêu',unit:c.unit||'',code:c.code,status:c.status||''}});
        return catalog.concat(accessibleViews()).filter(function(r){return normalize(r.name+' '+r.group+' '+(r.unit||'')).includes(term)}).sort(function(a,b){
          function score(r){var n=normalize(r.name);return n===term?0:n.startsWith(term)?1:2}
          return score(a)-score(b)||a.name.localeCompare(b.name,'vi');
        }).slice(0,12);
      }
      function clearLists(){sources.forEach(function(source){source.list.hidden=true;source.list.innerHTML='';source.input.setAttribute('aria-expanded','false');source.input.removeAttribute('aria-activedescendant')});activeIndex=-1}
      function clearSelection(restore){
        if(restore&&selectedCode&&savedFilter!==null&&$('contentFilter')&&$('contentFilter').value===selectedCode){
          var select=$('contentFilter');
          select.value=Array.from(select.options).some(function(o){return o.value===savedFilter})?savedFilter:'all';
          renderAll();
        }
        selectedCode=null;savedFilter=null;
      }
      window.YTE_CANCEL_SEARCH_RESTORE=function(){clearSelection(false)};
      async function choose(item){
        if(!item)return;
        if(currentViewName()==='entry'&&quickEntryDirty()) {
          var confirmed=await confirmAction({title:'Rời màn hình Nhập liệu?',message:'Số liệu đang nhập chưa lưu. Bạn có muốn chuyển tới kết quả tìm kiếm?',confirmText:'Chuyển màn hình',cancelText:'Tiếp tục nhập',danger:true});
          if(!confirmed)return;
        }
        if(!item)return;
        clearLists();sources.forEach(function(s){s.input.value=item.type==='indicator'?item.name:''});
        if(item.type==='view'){
          clearSelection(false);showView(item.view);
        }else{
          if(savedFilter===null)savedFilter=$('contentFilter').value||'all';
          var filter=$('contentFilter');
          if(!Array.from(filter.options).some(function(o){return o.value===item.code})){
            populateContentFilter();
          }
          if(Array.from(filter.options).some(function(o){return o.value===item.code})){
            selectedCode=item.code;filter.value=item.code;showView('dashboard');renderAll();
            var results=document.querySelector('#dashboardView .dashboard-results-panel');
            if(results)results.scrollIntoView({behavior:'smooth',block:'start'});
          }
        }
        if(window.YTE_CLOSE_MOBILE_NAV)window.YTE_CLOSE_MOBILE_NAV();
      }
      function renderSuggestions(source){
        var value=source.input.value,items=matching(value);
        if(source.input.id==='globalSearch'){var view=currentViewName(),target=view==='admin'?'adminSearch':view==='journey'?'journeyTrackingSearch':'';if(target&&$(target)){$(target).value=value;$(target).dispatchEvent(new Event('input',{bubbles:true}))}}
        sources.forEach(function(other){if(other!==source){other.input.value=value;other.list.hidden=true;other.list.innerHTML='';other.input.setAttribute('aria-expanded','false')}});
        if(!value.trim()){
          clearLists();clearSelection(true);return;
        }
        source.list.hidden=false;source.input.setAttribute('aria-expanded','true');
        source.list.innerHTML=items.length?items.map(function(item,i){return'<button type="button" class="search-result-option" role="option" id="'+source.list.id+'-option-'+i+'" data-index="'+i+'"><strong>'+esc(item.name)+'</strong><small>'+esc(item.group+(item.unit?' · '+item.unit:'')+(item.status&&/ngừng|inactive/i.test(item.status)?' · Ngừng sử dụng':''))+'</small></button>'}).join(''):'<div class="search-result-empty" role="status">Không tìm thấy chỉ tiêu hoặc chức năng phù hợp.</div>';
        activeIndex=-1;
      }
      sources.forEach(function(source){
        source.input.addEventListener('input',function(){renderSuggestions(source)});
        source.input.addEventListener('keydown',function(e){
          var items=matching(source.input.value);if(e.key==='Escape'){clearLists();return}
          if(!items.length)return;
          if(e.key==='ArrowDown'||e.key==='ArrowUp'){
            e.preventDefault();activeIndex=(activeIndex+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
            source.list.querySelectorAll('[role="option"]').forEach(function(el,i){var selected=i===activeIndex;el.classList.toggle('is-highlighted',selected);el.setAttribute('aria-selected',String(selected))});
            source.input.setAttribute('aria-activedescendant',source.list.id+'-option-'+activeIndex);
          }else if(e.key==='Enter'){e.preventDefault();choose(items[activeIndex<0?0:activeIndex]);}
        });
        source.list.addEventListener('click',function(event){var btn=event.target.closest('[data-index]');if(!btn)return;choose(matching(source.input.value)[Number(btn.dataset.index)])});
        source.input.addEventListener('search',function(){if(!source.input.value){clearLists();clearSelection(true)}});
      });
      document.addEventListener('pointerdown',function(event){if(!event.target.closest('.header-search,.mobile-nav-search'))clearLists()});
      window.addEventListener('keydown',function(event){if(event.key==='Escape')clearLists()});
    }

    function personBusinessDateLabel(category){
      var kind=category&&category.personDetailKind||'';
      return kind==='tb'?'Ngày điều trị *':kind==='center'?'Ngày chuyển Trung tâm *':'Ngày nghiệp vụ *';
    }
    function personPermissionMessage(error){
      var raw=String(error&&error.message||error||'');
      if(/permission.?denied|permission_denied|PERMISSION_DENIED/i.test(raw)) return 'Firebase từ chối thao tác. Hãy kiểm tra quyền tài khoản và Firebase Rules của chỉ tiêu; dữ liệu chưa được lưu.';
      return raw||'Không thể xử lý danh sách đối tượng.';
    }
    function updatePersonManagerSubtitle(){
      var category=state.categories.find(function(item){return item.code===state.personManagerCode});
      var date=state.personManagerDate||$('entryDate').value;
      if($('personDetailSubtitle'))$('personDetailSubtitle').textContent=(date?'Ngày '+fmtDate(date)+' · ':'')+'Số lượt tính tự động theo danh sách';
      if($('personDetailBusinessDateLabel'))$('personDetailBusinessDateLabel').textContent=personBusinessDateLabel(category);
    }
    function resetPersonManagerForm(){
      if($('personDetailId'))$('personDetailId').value='';
      if($('personDetailOriginalDate'))$('personDetailOriginalDate').value='';
      if($('personDetailName'))$('personDetailName').value='';
      if($('personDetailGender'))$('personDetailGender').value='';
      if($('personDetailBirthYear'))$('personDetailBirthYear').value='';
      if($('personDetailBusinessDate')){
        $('personDetailBusinessDate').disabled=false;
        $('personDetailBusinessDate').max=todayIsoVietnam();
        $('personDetailBusinessDate').value=state.personManagerDate||$('entryDate').value||todayIsoVietnam();
      }
      if($('personDetailError'))$('personDetailError').textContent='';
      if($('personDetailSave'))$('personDetailSave').textContent='Thêm vào danh sách';
      if($('personDetailReset'))$('personDetailReset').hidden=true;
      updatePersonManagerSubtitle();
    }
    function setPersonManagerSaving(active){
      state.personManagerSaving=active===true;
      ['personDetailName','personDetailGender','personDetailBirthYear','personDetailSave','personDetailReset','personDetailNew'].forEach(function(id){var el=$(id);if(el)el.disabled=state.personManagerSaving});
      if($('personDetailBusinessDate'))$('personDetailBusinessDate').disabled=state.personManagerSaving||!!($('personDetailId')&&$('personDetailId').value);
      if($('personDetailLayer'))$('personDetailLayer').setAttribute('aria-busy',state.personManagerSaving?'true':'false');
      if($('personDetailSave'))$('personDetailSave').textContent=state.personManagerSaving?'Đang lưu...':($('personDetailId')&&$('personDetailId').value?'Lưu thay đổi':'Thêm vào danh sách');
    }
    function renderPersonManagerList(){
      var list=$('personDetailList');if(!list)return;
      var rows=state.personManagerRows||[],total=Number(state.personManagerTotal||rows.length);
      if($('personDetailCount'))$('personDetailCount').textContent=total===rows.length?rows.length.toLocaleString('vi-VN')+' người':rows.length.toLocaleString('vi-VN')+' người chi tiết · '+total.toLocaleString('vi-VN')+' lượt';
      if(!rows.length){
        list.innerHTML='<div class="person-detail-empty"><strong>Chưa có đối tượng trong danh sách.</strong><span>Thêm Họ và tên, Giới tính, Năm sinh và Ngày nghiệp vụ để số liệu được tổng hợp tự động.</span></div>';
        return;
      }
      var allowEdit=canInputTongHop(),allowDelete=isAnyAppAdmin();
      list.innerHTML=rows.map(function(item,index){
        var actions='';
        if(allowEdit){
          actions='<div class="person-detail-item-actions"><button class="small-btn person-detail-action" data-kind="edit" data-id="'+esc(item.id)+'" type="button">Sửa</button>'+(allowDelete?'<button class="small-btn btn-danger person-detail-action" data-kind="delete" data-id="'+esc(item.id)+'" type="button">Xóa</button>':'')+'</div>';
        }
        return '<article class="person-detail-item"><span class="person-detail-number">'+(index+1)+'</span><div class="person-detail-person"><strong>'+esc(item.hoTen||'Đối tượng')+'</strong><span>'+esc([item.gioiTinh,item.namSinh?'Sinh '+item.namSinh:'',item.date?'Ngày '+fmtDate(item.date):''].filter(Boolean).join(' · '))+'</span></div>'+actions+'</article>';
      }).join('');
    }
    async function loadPersonManager(){
      var code=state.personManagerCode,date=state.personManagerDate||$('entryDate').value;
      if(!code||!date)return;
      if($('personDetailState')){$('personDetailState').hidden=false;$('personDetailState').className='inline-state';$('personDetailState').innerHTML='<span class="spinner"></span><span>Đang tải danh sách…</span>'}
      try{
        var result=await call('getPersonDetailList',{date:date,code:code});
        state.personManagerRows=result&&result.rows||[];state.personManagerTotal=Number(result&&result.totalValue||state.personManagerRows.length);
        renderPersonManagerList();
        if($('personDetailState')){
          var unresolved=Number(result&&result.unresolvedCount||0);
          if(unresolved>0){$('personDetailState').hidden=false;$('personDetailState').className='inline-state warn';$('personDetailState').textContent='Còn '+unresolved.toLocaleString('vi-VN')+' lượt dữ liệu cũ chưa có Họ tên/Giới tính/Năm sinh. Tổng số hiện tại được bảo toàn khi bổ sung dần danh sách.'}
          else $('personDetailState').hidden=true;
        }
      }catch(error){
        state.personManagerRows=[];renderPersonManagerList();
        if($('personDetailState')){$('personDetailState').hidden=false;$('personDetailState').className='inline-state err';$('personDetailState').textContent=personPermissionMessage(error)}
      }
    }
    function stopPersonManagerRealtime(){
      (state.personManagerLiveUnsubscribers||[]).forEach(function(fn){if(typeof fn==='function')try{fn()}catch(_){}});
      state.personManagerLiveUnsubscribers=[];state.personManagerLiveRaw={};state.personManagerLiveSummary=null;
    }
    function refreshPersonManagerRealtimeUi(){
      if(!state.personManagerCode||!state.personManagerDate||$('personDetailLayer').hidden)return;
      var rows=activePersonRows(state.personManagerLiveRaw||{}).sort(function(a,b){return String(a.hoTen||'').localeCompare(String(b.hoTen||''),'vi')});
      var total=state.personManagerLiveSummary==null?rows.length:Number(state.personManagerLiveSummary||0);
      state.personManagerRows=rows;state.personManagerTotal=total;renderPersonManagerList();
      if($('personDetailState')){
        var unresolved=Math.max(0,total-rows.length);
        if(unresolved>0){$('personDetailState').hidden=false;$('personDetailState').className='inline-state warn';$('personDetailState').textContent='Còn '+unresolved.toLocaleString('vi-VN')+' lượt dữ liệu cũ chưa có Họ tên/Giới tính/Năm sinh. Tổng số hiện tại được bảo toàn khi bổ sung dần danh sách.'}
        else if(!$('personDetailState').classList.contains('err')){$('personDetailState').hidden=true;$('personDetailState').textContent=''}
      }
    }
    function startPersonManagerRealtime(force){
      var code=state.personManagerCode,date=state.personManagerDate||$('entryDate').value;
      if(!code||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))return;
      if(!force&&state.personManagerLiveUnsubscribers&&state.personManagerLiveUnsubscribers.length)return;
      stopPersonManagerRealtime();
      var detailRef=ref(firebaseDatabase,PERSON_DETAIL_ROOT+'/'+date+'/'+code);
      var summaryRef=ref(firebaseDatabase,ROOT+'/congKhai/soLieuTheoNgay/'+date+'/'+code+'/giaTri');
      state.personManagerLiveUnsubscribers.push(onValue(detailRef,function(snap){state.personManagerLiveRaw=snapshotObject(snap);refreshPersonManagerRealtimeUi()},function(error){console.warn('Realtime danh sách đối tượng:',error);if($('personDetailState')){$('personDetailState').hidden=false;$('personDetailState').className='inline-state err';$('personDetailState').textContent=personPermissionMessage(error)}}));
      state.personManagerLiveUnsubscribers.push(onValue(summaryRef,function(snap){state.personManagerLiveSummary=snap.exists()?Number(snap.val()||0):null;refreshPersonManagerRealtimeUi()},function(error){console.warn('Realtime tổng số chi tiết:',error)}));
    }
    function openPersonManager(code){
      var category=state.categories.find(function(item){return item.code===code});
      if(!category||!category.personDetailKind){toast('Chỉ tiêu này không sử dụng danh sách đối tượng.','warn');return}
      if(!canInputTongHop()){toast('Bạn chỉ có quyền xem, không thể cập nhật danh sách.','warn');return}
      state.personManagerCode=code;state.personManagerDate=$('entryDate').value||todayIsoVietnam();state.personManagerRows=[];state.personManagerTotal=0;
      resetPersonManagerForm();
      $('personDetailTitle').textContent=category.name;
      updatePersonManagerSubtitle();
      $('personDetailCount').textContent='Đang tải…';
      $('personDetailList').innerHTML='';
      $('personDetailLayer').hidden=false;document.body.style.overflow='hidden';
      loadPersonManager();startPersonManagerRealtime(true);
      window.setTimeout(function(){if(window.matchMedia&&window.matchMedia('(pointer:fine) and (min-width:761px)').matches)$('personDetailName').focus()},0);
    }
    function closePersonManager(){
      if(state.personManagerSaving)return;
      stopPersonManagerRealtime();
      if($('personDetailLayer'))$('personDetailLayer').hidden=true;
      state.personManagerCode='';state.personManagerDate='';state.personManagerRows=[];state.personManagerTotal=0;
      resetPersonManagerForm();
      if($('sourceDetailLayer').hidden&&$('confirmLayer').hidden)document.body.style.overflow='';
    }
    function editPersonManagerEntry(id){
      var item=(state.personManagerRows||[]).find(function(row){return row.id===id});if(!item)return;
      $('personDetailId').value=item.id||'';$('personDetailOriginalDate').value=item.date||state.personManagerDate||'';$('personDetailName').value=item.hoTen||'';$('personDetailGender').value=item.gioiTinh||'';$('personDetailBirthYear').value=item.namSinh||'';$('personDetailBusinessDate').value=item.date||state.personManagerDate||$('entryDate').value;$('personDetailBusinessDate').disabled=true;
      $('personDetailSave').textContent='Lưu thay đổi';$('personDetailReset').hidden=false;$('personDetailError').textContent='';
      $('personDetailForm').scrollIntoView({behavior:'smooth',block:'nearest'});
      window.setTimeout(function(){$('personDetailName').focus();$('personDetailName').select()},80);
    }
    async function savePersonManagerEntry(event){
      if(event)event.preventDefault();if(state.personManagerSaving)return;
      var code=state.personManagerCode,date=String($('personDetailBusinessDate').value||state.personManagerDate||$('entryDate').value||'');
      var payload={date:date,code:code,id:String($('personDetailId').value||''),hoTen:String($('personDetailName').value||'').trim(),gioiTinh:String($('personDetailGender').value||''),namSinh:Number($('personDetailBirthYear').value||0)};
      if(payload.hoTen.length<2){$('personDetailError').textContent='Vui lòng nhập Họ và tên.';return}
      if(!payload.gioiTinh){$('personDetailError').textContent='Vui lòng chọn Giới tính.';return}
      var yearNow=new Date().getFullYear();if(!Number.isInteger(payload.namSinh)||payload.namSinh<1900||payload.namSinh>yearNow){$('personDetailError').textContent='Năm sinh phải từ 1900 đến '+yearNow+'.';return}
      if(!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)){ $('personDetailError').textContent='Vui lòng chọn ngày nghiệp vụ.';return }
      if(payload.date>todayIsoVietnam()){ $('personDetailError').textContent='Ngày nghiệp vụ không được lớn hơn ngày hiện tại.';return }
      $('personDetailError').textContent='';setPersonManagerSaving(true);
      try{
        var result=await call('savePersonDetail',payload);
        var previousManagerDate=state.personManagerDate;state.personManagerDate=String(result&&result.date||payload.date);if($('entryDate'))$('entryDate').value=state.personManagerDate;updatePersonManagerSubtitle();
        if(previousManagerDate!==state.personManagerDate)startPersonManagerRealtime(true);
        resetPersonManagerForm();toast(result&&result.message||'Đã lưu đối tượng.','ok');
        await loadPersonManager();
        await loadDay({silent:true,force:true,notify:false});
        Promise.resolve(syncData(true,true)).catch(function(){});
      }catch(error){$('personDetailError').textContent=personPermissionMessage(error)}
      finally{setPersonManagerSaving(false)}
    }
    async function deletePersonManagerEntry(id){
      if(!isAnyAppAdmin()){toast('Chỉ tài khoản Quản trị mới được xóa đối tượng.','warn');return}
      var item=(state.personManagerRows||[]).find(function(row){return row.id===id});if(!item)return;
      // Production invariant: đóng băng toàn bộ khóa nghiệp vụ trước khi mở confirm. Confirm có thể
      // thay đổi focus/stack dialog nhưng thao tác xóa không còn phụ thuộc state của popup.
      var deletePayload={
        id:String(item.id||id),
        date:String(item.date||state.personManagerDate||$('entryDate').value||''),
        code:String(state.personManagerCode||''),
        hoTen:String(item.hoTen||'đối tượng'),
        metricName:String($('personDetailTitle').textContent||'danh sách')
      };
      if(!deletePayload.code||!deletePayload.date){toast('Không xác định được chỉ tiêu hoặc ngày cần xóa. Vui lòng mở lại danh sách.','warn');return}
      var ok=await confirmAction({title:'Xóa khỏi danh sách?',message:'Xóa '+deletePayload.hoTen+' khỏi '+deletePayload.metricName+'. Số liệu tổng hợp sẽ tự giảm tương ứng.',confirmText:'Xóa đối tượng',cancelText:'Hủy',danger:true});
      if(!ok)return;
      setPersonManagerSaving(true);
      try{
        var result=await call('deletePersonDetail',{date:deletePayload.date,code:deletePayload.code,id:deletePayload.id});
        toast(result&&result.message||'Đã xóa đối tượng.','ok');
        // Listener realtime sẽ tự cập nhật danh sách ở tất cả thiết bị; vẫn chủ động tải lại
        // để bảo đảm thiết bị hiện tại phản hồi ngay cả khi mạng chập chờn.
        if(state.personManagerCode===deletePayload.code&&state.personManagerDate===deletePayload.date)await loadPersonManager();
        await loadDay({silent:true,force:true,notify:false});
        Promise.resolve(syncData(true,true)).catch(function(){});
      }catch(error){$('personDetailError').textContent=personPermissionMessage(error)}
      finally{setPersonManagerSaving(false)}
    }

    function stopSourceDetailRealtime(){
      (state.sourceDetailLiveUnsubscribers||[]).forEach(function(fn){if(typeof fn==='function')try{fn()}catch(_){}});
      state.sourceDetailLiveUnsubscribers=[];state.sourceDetailLiveContext=null;state.sourceDetailLiveRaw={};state.sourceDetailLiveSummary={};
    }
    function refreshPersonSourceDetailRealtime(){
      var ctx=state.sourceDetailLiveContext;if(!ctx||ctx.kind!=='person'||$('sourceDetailLayer').hidden)return;
      var raw=state.sourceDetailLiveRaw||{},rows=[];
      Object.keys(raw).sort().forEach(function(date){var day=raw[date]||{},group=day[ctx.code]||{};activePersonRows(group).forEach(function(item){rows.push(Object.assign({},item,{date:date}))})});
      rows.sort(function(a,b){return String(b.date).localeCompare(String(a.date))||String(a.hoTen||'').localeCompare(String(b.hoTen||''),'vi')});
      var summaryRaw=state.sourceDetailLiveSummary||{};
      var total=Object.keys(summaryRaw).reduce(function(sum,date){return sum+Number((((summaryRaw[date]||{})[ctx.code]||{}).giaTri)||0)},0);
      if(!Object.keys(summaryRaw).length)total=rows.length;
      var unresolved=Math.max(0,total-rows.length);
      $('sourceDetailCount').textContent=total!==rows.length?rows.length.toLocaleString('vi-VN')+' người chi tiết / '+total.toLocaleString('vi-VN')+' lượt':rows.length.toLocaleString('vi-VN')+' trường hợp';
      if(unresolved>0){$('sourceDetailState').hidden=false;$('sourceDetailState').className='inline-state warn';$('sourceDetailState').textContent='Còn '+unresolved.toLocaleString('vi-VN')+' lượt dữ liệu cũ chưa có thông tin nhân thân chi tiết.'}
      else if(!$('sourceDetailState').classList.contains('err')){$('sourceDetailState').hidden=true;$('sourceDetailState').textContent=''}
      renderSourceDetailRows('person',rows);
    }
    function startPersonSourceDetailRealtime(code,range){
      stopSourceDetailRealtime();
      if(!code||!range)return;
      state.sourceDetailLiveContext={kind:'person',code:code,from:range.from,to:range.to};
      var detailQuery=query(ref(firebaseDatabase,PERSON_DETAIL_ROOT),orderByKey(),startAt(range.from),endAt(range.to));
      var summaryQuery=query(ref(firebaseDatabase,ROOT+'/congKhai/soLieuTheoNgay'),orderByKey(),startAt(range.from),endAt(range.to));
      state.sourceDetailLiveUnsubscribers.push(onValue(detailQuery,function(snap){state.sourceDetailLiveRaw=snapshotObject(snap);refreshPersonSourceDetailRealtime()},function(error){console.warn('Realtime chi tiết đối tượng:',error)}));
      state.sourceDetailLiveUnsubscribers.push(onValue(summaryQuery,function(snap){state.sourceDetailLiveSummary=snapshotObject(snap);refreshPersonSourceDetailRealtime()},function(error){console.warn('Realtime tổng hợp chi tiết:',error)}));
    }
    function closeSourceDetail(){
      stopSourceDetailRealtime();
      var layer=$('sourceDetailLayer');if(!layer||layer.hidden)return;layer.hidden=true;document.body.style.overflow='';
    }
    function renderSourceDetailRows(kind,rows){
      var list=$('sourceDetailList');if(!list)return;
      if(!rows.length){list.innerHTML='<div class="source-detail-empty"><strong>Không có hồ sơ nguồn trong phạm vi này.</strong><span>Số liệu sẽ xuất hiện khi phân hệ Báo cáo có phát sinh hợp lệ.</span></div>';return}
      list.innerHTML=rows.map(function(item,index){
        var profile=[item.gender,item.birthYear?'Sinh '+item.birthYear:''].filter(Boolean).join(' · ');
        if(kind==='person'){
          var personProfile=[item.gioiTinh,item.namSinh?'Sinh '+item.namSinh:''].filter(Boolean).join(' · ');
          return'<article class="source-detail-item"><div class="source-detail-index">'+(index+1)+'</div><div class="source-detail-main"><div class="source-detail-name-row"><div><h4>'+esc(item.hoTen||'Đối tượng')+'</h4><p>'+esc(personProfile||'Thông tin đối tượng')+'</p></div><time>'+esc(fmtDate(item.date))+'</time></div></div></article>';
        }
        var detail=kind==='death'
          ? '<div class="source-detail-route is-death"><strong>'+esc(item.deathType||'Tử vong')+'</strong><span>'+esc(item.deathPlace||'Chưa ghi rõ nơi tử vong')+'</span></div>'
          : '<div class="source-detail-route"><span>'+esc(item.from||'Trung tâm')+'</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg><strong>'+esc(item.to||item.currentPlace||'Chưa ghi rõ nơi đến')+'</strong></div>';
        var current=(kind==='transfer'&&item.currentPlace&&item.currentPlace!==item.to)?'<div class="source-detail-status"><span>Hiện tại</span><strong>'+esc(item.currentPlace)+'</strong></div>':'';
        return'<article class="source-detail-item"><div class="source-detail-index">'+(index+1)+'</div><div class="source-detail-main"><div class="source-detail-name-row"><div><h4>'+esc(item.name)+'</h4><p>'+esc(profile||'Thông tin đối tượng')+'</p></div><time>'+esc(fmtDate(item.date))+'</time></div>'+detail+current+'<div class="source-detail-status"><span>Trạng thái</span><strong>'+esc(item.statusLabel||'Đang cập nhật')+'</strong></div></div></article>';
      }).join('');
    }
    async function openSourceDetail(kind,code){
      if(!canViewDerivedDetails()){message('Vui lòng đăng nhập bằng tài khoản đã được cấp quyền để xem chi tiết.','err');return}
      var range;try{range=getRange()}catch(error){message(error.message||String(error),'err');return}
      var category=code?state.categories.find(function(item){return item.code===code}):null;
      var layer=$('sourceDetailLayer'),title=kind==='person'?'Chi tiết '+String(category&&category.name||'chỉ tiêu'):kind==='death'?'Chi tiết Tử vong':'Chi tiết Chuyển viện';
      $('sourceDetailTitle').textContent=title;$('sourceDetailSubtitle').textContent=range.label;$('sourceDetailCount').textContent='Đang tải…';
      $('sourceDetailState').hidden=false;$('sourceDetailState').className='inline-state';$('sourceDetailState').innerHTML='<span class="spinner"></span><span>Đang đọc dữ liệu chi tiết…</span>';$('sourceDetailList').innerHTML='';
      $('sourceDetailOpenReports').hidden=kind==='person'||!hasReportAccess();layer.hidden=false;document.body.style.overflow='hidden';
      try{
        var result=kind==='person'?await call('getPersonDetailRange',{code:code,from:range.from,to:range.to}):await call('getDerivedSourceDetails',{kind:kind,from:range.from,to:range.to});
        var rows=result.rows||[],total=kind==='person'?Number(result.totalValue||rows.length):rows.length,unresolved=kind==='person'?Number(result.unresolvedCount||0):0;
        $('sourceDetailCount').textContent=(kind==='person'&&total!==rows.length)?rows.length.toLocaleString('vi-VN')+' người chi tiết / '+total.toLocaleString('vi-VN')+' lượt':rows.length.toLocaleString('vi-VN')+' trường hợp';
        if(unresolved>0){$('sourceDetailState').hidden=false;$('sourceDetailState').className='inline-state warn';$('sourceDetailState').textContent='Còn '+unresolved.toLocaleString('vi-VN')+' lượt dữ liệu cũ chưa có thông tin nhân thân chi tiết.'}else $('sourceDetailState').hidden=true;
        renderSourceDetailRows(kind,rows);
        if(kind==='person')startPersonSourceDetailRealtime(code,range);else stopSourceDetailRealtime();
      }catch(error){$('sourceDetailCount').textContent='Không tải được';$('sourceDetailState').hidden=false;$('sourceDetailState').className='inline-state err';$('sourceDetailState').textContent=error.message||'Không thể đọc dữ liệu nguồn.';}
    }

    function previewSummaryReport(){
      var totals=aggregate(),recorded=recordedCodeMap();
      var categories=sortedSummaryCategories().filter(function(c){return !!recorded[c.code]});
      var reportFrom=state.from||'',reportTo=state.to||reportFrom,reportLabel=String($('rangeLabel').textContent||'Phạm vi đang xem');
      var rows=categories.map(function(c,index){return{stt:index+1,chiTieu:c.name,nhom:c.group,giaTri:Number(totals[c.code]||0),donVi:c.unit,noiDung:summaryNotesForCategory(c.code)}});
      openReportPreview({
        title:'Báo cáo tổng hợp số liệu y tế',
        subtitle:reportLabel,
        filename:'Bao-cao-tong-hop-y-te_'+(reportFrom||'du-lieu')+(reportTo&&reportTo!==reportFrom?'_'+reportTo:'')+'.xlsx',
        sheetName:'Tổng hợp số liệu',
        columns:[
          {key:'stt',label:'STT',width:8},
          {key:'chiTieu',label:'Chỉ tiêu',width:34},
          {key:'nhom',label:'Nhóm',width:24},
          {key:'giaTri',label:'Giá trị',width:14},
          {key:'donVi',label:'Đơn vị',width:14},
          {key:'noiDung',label:'Nội dung/Ghi chú',width:42}
        ],
        rows:rows
      });
    }

    function cacheDaily(date,records){var byCode={};(records||[]).forEach(function(record){byCode[record.code]=record});state.entryCache[date]={byCode:byCode,loadedAt:Date.now()};return byCode}
    function hydrateDailyFromResult(result){if(result&&result.dailyDate){cacheDaily(result.dailyDate,result.dailyRecords||[]);if($('entryDate').value===result.dailyDate)applyDailyCache(result.dailyDate)}}
    function applyDailyCache(date){var cache=state.entryCache[date];if(!cache)return false;state.dailyByCode=cache.byCode||{};state.loadedEntryDate=date;renderIndicators();return true}
    function cacheIsFresh(date){return!!(state.entryCache[date]&&Date.now()-state.entryCache[date].loadedAt<ENTRY_CACHE_MS)}
    function setEntryLoadState(text,type,spinning){var box=$('entryLoadState');if(!spinning&&type==='ok'){box.hidden=true;box.textContent='';return}box.hidden=!text;box.className='inline-state '+(type||'');box.innerHTML=(spinning?'<span class="spinner"></span>':'')+'<span>'+esc(text||'')+'</span>'}

    function syncNotificationIdentity(){
      if(!window.YTE_NOTIFICATIONS)return;
      var authenticated=!!state.authUser,hasReport=hasReportAccess(),hasAccess=!!state.user||hasReport;
      if(!authenticated||!hasAccess){window.YTE_NOTIFICATIONS.clearUser().catch(function(){});return;}
      var role=effectiveUiDbRole()||'none';
      window.YTE_NOTIFICATIONS.syncUser({uid:state.authUser.uid,tongHopRole:role,reportRole:role}).catch(function(error){console.warn('Đồng bộ thông báo:',error)});
    }

    function setAccountMenu(open){
      var menu=$('headerAccountMenu'),trigger=$('headerUserSummary');if(!menu||!trigger)return;
      var enabled=!!state.authUser;
      menu.hidden=!(open&&enabled);trigger.setAttribute('aria-expanded',String(!menu.hidden));
    }
    function updateAuthUi(){
      var authenticated=!!state.authUser,loggedIn=!!state.user,isAdmin=isAnyAppAdmin(),canInput=canInputTongHop();
      var tongHopAdmin=isAnyAppAdmin();
      var hasReport=hasReportAccess();
      var hasAnyAccess=loggedIn||hasReport;
      if($('mobileNavToggle'))$('mobileNavToggle').hidden=false;
      if(!hasAnyAccess&&window.YTE_CLOSE_MOBILE_NAV)window.YTE_CLOSE_MOBILE_NAV();
      $('btnAccount').hidden=authenticated;$('btnTopLogout').hidden=!authenticated;if(authenticated){$('btnTopLogout').title='Đăng xuất '+String((loggedIn&&state.user&&state.user.name)||(state.authUser&&state.authUser.name)||'tài khoản');}
      var fullGreetingName=authenticated?String((loggedIn&&state.user&&state.user.name)||(state.authUser&&state.authUser.name)||'Người dùng Phòng Y tế'):'';
      var shortGreetingName=friendlyGivenName(fullGreetingName);
      if($('headerGreeting')){$('headerGreeting').hidden=!authenticated;$('headerGreeting').textContent=authenticated?'Xin chào, '+shortGreetingName+' 👋':'';$('headerGreeting').title=fullGreetingName;}
      if($('mobileGreeting')){$('mobileGreeting').hidden=!authenticated;$('mobileGreeting').textContent=authenticated?'Xin chào, '+shortGreetingName+' 👋':'';$('mobileGreeting').title=fullGreetingName;}
      if($('mobileNavUser')){$('mobileNavUser').textContent=authenticated?fullGreetingName:'Tài khoản';$('mobileNavUser').title=fullGreetingName;}
      if(!authenticated)setAccountMenu(false);
      if($('headerUserSummary')){
        $('headerUserSummary').hidden=!authenticated;
        if(authenticated){
          var initials=fullGreetingName.split(/\s+/).filter(Boolean).slice(-2).map(function(part){return part.charAt(0).toUpperCase()}).join('')||'YT';
          var googleUser=firebaseAuth&&firebaseAuth.currentUser?firebaseAuth.currentUser:null;
          var avatarUrl=String((googleUser&&googleUser.photoURL)||((googleUser&&googleUser.providerData||[]).find(function(provider){return provider&&provider.photoURL})||{}).photoURL||'').trim();
          var avatar=$('headerUserAvatar');
          avatar.textContent='';
          avatar.classList.remove('has-photo');
          if(avatarUrl){
            var avatarImage=document.createElement('img');
            avatarImage.alt='Ảnh đại diện Google của '+fullGreetingName;
            avatarImage.referrerPolicy='no-referrer';
            avatarImage.loading='eager';
            avatarImage.src=avatarUrl;
            avatarImage.addEventListener('load',function(){avatar.classList.add('has-photo')},{once:true});
            avatarImage.addEventListener('error',function(){avatar.classList.remove('has-photo');avatar.replaceChildren(document.createTextNode(initials))},{once:true});
            avatar.appendChild(avatarImage);
          }else{avatar.textContent=initials}
          $('headerUserName').textContent=fullGreetingName;
          var roleText=isAdmin?'Quản trị hệ thống':(loggedIn&&state.user?String(state.user.role||''):(state.reportPermission&&state.reportPermission.active?uiReportRole(state.reportPermission.role):'Chờ cấp quyền'));
          $('headerUserRole').textContent=roleText;
        }
      }
      if($('btnSync'))$('btnSync').hidden=false;
      if($('navDashboard'))$('navDashboard').hidden=false;
      $('navEntry').hidden=!canInput;$('navAdmin').hidden=!isAdmin;if($('navJourney'))$('navJourney').hidden=!hasReport;
      if($('btnPreviewSummary'))$('btnPreviewSummary').hidden=!hasReport;
      if($('adminUsersTab'))$('adminUsersTab').hidden=!tongHopAdmin;
      if($('adminCategoriesTab'))$('adminCategoriesTab').hidden=!tongHopAdmin;
      $('userGreeting').hidden=!authenticated;
      $('userGreeting').textContent=authenticated
        ? 'Xin chào, '+shortGreetingName+' 👋'+(hasAnyAccess?'':' · Chờ cấp quyền')
        : '';
      if(window.YTE_REPORTS&&typeof window.YTE_REPORTS.updateModuleUi==='function'){
        window.YTE_REPORTS.updateModuleUi({
          authenticated:authenticated,
          tongHopActive:loggedIn,
          tongHopRole:loggedIn?state.user.role:'',
          reportPermission:state.reportPermission,
          tongHopPermission:state.tongHopPermission||((window.YTE_PERMISSION_STORE&&window.YTE_PERMISSION_STORE.getSnapshot&&state.authUser)?window.YTE_PERMISSION_STORE.getSnapshot(state.authUser.uid).tongHopPermission:null),
          authUser:state.authUser
        });
      }
      syncNotificationIdentity();
      if(window.YTE_NOTIFICATIONS&&typeof window.YTE_NOTIFICATIONS.consumePendingRoute==='function')window.setTimeout(window.YTE_NOTIFICATIONS.consumePendingRoute,0);
      if(!loggedIn){
        stopEntryRealtime();
        state.entryCache={};state.dailyByCode={};state.loadedEntryDate='';state.adminUsers=[];state.adminLoadedAt=0;state.adminCategories=[];state.categoryLoadedAt=0;
        if(currentViewName()==='entry')showView(authenticated?defaultPrivateView():'dashboard');
        if(currentViewName()==='admin'&&!isAdmin)showView(authenticated?defaultPrivateView():'dashboard');
        if(currentViewName()==='journey'&&!hasReport)showView(authenticated?defaultPrivateView():'dashboard');
        if(currentViewName()==='home'&&hasReport)showView('dashboard');
        return;
      }
      if(!isAdmin&&currentViewName()==='admin')showView(defaultPrivateView());
      if(currentViewName()==='home')showView('dashboard');
      if(currentViewName()==='journey'&&!hasReport)showView(defaultPrivateView());
      $('entryUserName').textContent=state.user.name;
      $('entryUserMeta').textContent=state.user.role;
      if(canInput){
        startEntryRealtime($('entryDate').value);
        if(!applyDailyCache($('entryDate').value))loadDay({silent:true,force:false,notify:false});
      }else{
        stopEntryRealtime();
      }
    }
    function applySessionResult(result){
      result=result||{};
      state.authUser=result.authUser||null;
      state.user=result.active===true?result.user:null;
      state.tongHopPermission=result.tongHopPermission||null;
      state.reportPermission=result.reportPermission||null;
      state.categories=result.categories||state.categories;
      hydrateDailyFromResult(result);
      updateAuthUi();
      startConnectionRealtime();startOwnPermissionRealtime();if(isAnyAppAdmin())startAdminRealtime();else stopAdminRealtime();
      if(isAnyAppAdmin()) call('ensurePublicCategoryMirror').then(function(){return syncData(true,true)}).catch(function(error){console.warn('Khôi phục mirror danh mục:',error)});
      if(canInputTongHop()) call('ensureReportStatisticsMarkers').then(function(){return syncData(true,true)}).catch(function(error){console.warn('Đối soát marker Báo cáo:',error)});
      var hasReport=hasReportAccess();
      if(result.authenticated&&result.active!==true&&!hasReport&&(result.locked||result.rejected)&&result.message)message(result.message,'err');
      else if(result.authenticated&&result.active!==true&&!hasReport)clearMessage();
    }
    async function refreshCurrentSession(){
      try{var result=await call('restoreSession');applySessionResult(result);return result}catch(error){return null}
    }
    function captureUpdateContext(){
      var context={
        view:currentViewName(),adminSection:state.adminSection||'users',
        entryDate:$('entryDate')&&$('entryDate').value||'',rangeType:$('rangeType')&&$('rangeType').value||'day',
        singleDate:$('singleDate')&&$('singleDate').value||'',fromDate:$('fromDate')&&$('fromDate').value||'',toDate:$('toDate')&&$('toDate').value||'',
        monthValue:$('monthValue')&&$('monthValue').value||'',quarterValue:$('quarterValue')&&$('quarterValue').value||'',yearValue:$('yearValue')&&$('yearValue').value||'',
        contentFilter:$('contentFilter')&&$('contentFilter').value||'all'
      };
      return context;
    }
    function restoreUpdateContext(){
      var raw='';try{raw=sessionStorage.getItem('yte-update-context')||''}catch(_){}
      if(!raw)return;
      try{sessionStorage.removeItem('yte-update-context')}catch(_){}
      try{
        var saved=JSON.parse(raw),ctx=saved&&saved.app||{};
        if(!saved||Date.now()-Number(saved.savedAt||0)>30*60*1000)return;
        if(ctx.rangeType&&$('rangeType'))$('rangeType').value=ctx.rangeType;
        ['singleDate','fromDate','toDate','monthValue','quarterValue','yearValue','entryDate'].forEach(function(id){if(ctx[id]&&$(id))$(id).value=ctx[id]});
        updateRangeFields();
        if(ctx.contentFilter&&$('contentFilter'))$('contentFilter').value=ctx.contentFilter;
        if(ctx.adminSection)state.adminSection=ctx.adminSection;
        var target=String(ctx.view||'');if(target==='reports'||target==='report'||target==='baocao')target='dashboard';if(target&&['dashboard','entry','journey','admin'].indexOf(target)>=0)showView(target);
        if(target==='dashboard'){startDashboardRealtime(true);Promise.resolve(syncData(true,true)).catch(function(){})}
        if(target==='entry'&&$('entryDate').value){startEntryRealtime($('entryDate').value);loadDay({silent:true,force:true,notify:false}).catch(function(){})}
        if(target==='journey'&&saved.journeys&&window.YTE_JOURNEYS&&typeof window.YTE_JOURNEYS.restoreUpdateContext==='function')window.setTimeout(function(){window.YTE_JOURNEYS.restoreUpdateContext(saved.journeys)},50);
      }catch(error){console.warn('Không khôi phục được vị trí sau cập nhật:',error)}
    }
    window.YTE_REFRESH_SESSION=refreshCurrentSession;
    window.YTE_APP_UI=Object.freeze({
      hasUnsavedChanges:function(){return quickEntryDirty()||personManagerFormDirty()},
      openView:function(name){showView(String(name||''));},
      currentView:function(){return currentViewName();},
      captureUpdateContext:captureUpdateContext,
      confirm:function(options){return confirmAction(options||{});}
    });

    async function restore(){
      try{
        var result=await call('restoreSession');applySessionResult(result);
        if(window.YTE_REPORTS&&typeof window.YTE_REPORTS.routeAfterRestore==='function')await window.YTE_REPORTS.routeAfterRestore(result);
        restoreUpdateContext();
      }
      catch(error){state.authUser=null;state.user=null;state.reportPermission=null;updateAuthUi()}
    }
    async function loginGoogle(){
      setBusy(true,'Đang mở đăng nhập Google...');
      try{
        var result=await call('googleLoginAccount');
        applySessionResult(result);
        if(window.YTE_REPORTS&&typeof window.YTE_REPORTS.routeAfterLogin==='function')await window.YTE_REPORTS.routeAfterLogin(result);
        else showView('dashboard');
        if(result.active)toast('Đăng nhập Google thành công.','ok');else clearMessage();
      }catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function logout(){
      try{if(window.YTE_NOTIFICATIONS&&typeof window.YTE_NOTIFICATIONS.signOut==='function')await window.YTE_NOTIFICATIONS.signOut()}catch(error){}
      try{await call('logoutSession')}catch(error){}
      stopEntryRealtime();state.authUser=null;state.user=null;state.reportPermission=null;updateAuthUi();
      if(window.YTE_REPORTS&&typeof window.YTE_REPORTS.onLogout==='function')window.YTE_REPORTS.onLogout();
      showView('dashboard');message('Đã đăng xuất.','ok')
    }

    function activateEntryView(){
      if(!state.user)return
      var date=$('entryDate').value;startEntryRealtime(date);if(applyDailyCache(date)){if(cacheIsFresh(date))setEntryLoadState('','ok',false);else{setEntryLoadState('Đang kiểm tra dữ liệu mới nhất...','',true);loadDay({silent:true,force:true,notify:false})}}else{renderIndicators();setEntryLoadState('Đang chuẩn bị dữ liệu ngày '+fmtDate(date)+'...','',true);loadDay({silent:true,force:false,notify:false})}
    }
    function entryUnitInputLabel(unit){
      var text=String(unit||'').trim();
      if(!text)return 'Số liệu *';
      return 'Số '+text.toLocaleLowerCase('vi-VN')+' *';
    }
    function entryUnitPlaceholder(unit){
      var text=String(unit||'').trim();
      return text?'Nhập số '+text.toLocaleLowerCase('vi-VN'):'Nhập số liệu';
    }
    function updateEntryDateLabel(){
      // Chỉ hiển thị ngày tại bộ chọn ngày, không lặp lại ngày ở các khối nội dung.
    }
    function renderEntryCategoryOptions(){
      var select=$('entryCategorySelect');if(!select)return;
      var current=select.value,groups={};
      state.categories.forEach(function(category){var key=category.group||'Khác';if(!groups[key])groups[key]=[];groups[key].push(category)});
      var html=state.categories.length?'<option value="">Chọn chỉ tiêu cần nhập</option>':'<option value="">Chưa có danh mục chỉ tiêu</option>';
      Object.keys(groups).forEach(function(group){
        html+='<optgroup label="'+esc(group)+'">'+groups[group].map(function(category){return'<option value="'+esc(category.code)+'">'+esc(category.name)+(category.derivedKind?' · Tự động':' · '+esc(category.unit))+'</option>'}).join('')+'</optgroup>';
      });
      select.innerHTML=html;
      if(current&&state.categories.some(function(category){return category.code===current}))select.value=current;
      updateQuickEntrySelection(false);
    }
    function setEntrySelectedStatus(text,className){
      var chip=$('entrySelectedStatus');if(!chip)return;
      chip.className='status-chip '+(className||'');chip.textContent=text||'';chip.hidden=!text;
    }
    function resetEntrySelection(){
      if($('entryCategorySelect'))$('entryCategorySelect').value='';
      if($('entryQuickValue'))$('entryQuickValue').value='';
      if($('entryTrainingContent'))$('entryTrainingContent').value='';
      if($('entryTrainingContentField'))$('entryTrainingContentField').hidden=true;
      if($('entrySelectedNoteRow'))$('entrySelectedNoteRow').hidden=true;
      state.quickEntryBaseline='';state.lastQuickEntryCode='';
      if($('entrySelectedInfo'))$('entrySelectedInfo').hidden=true;
      if($('entryQuickValueField'))$('entryQuickValueField').hidden=true;
      if($('entryInlineActions'))$('entryInlineActions').hidden=true;
      if($('btnEntrySelectedHistory'))$('btnEntrySelectedHistory').hidden=true;
      if($('btnEntrySelectedAdjust'))$('btnEntrySelectedAdjust').hidden=true;
      if($('btnEntrySelectedDelete'))$('btnEntrySelectedDelete').hidden=true;
      if($('btnSaveQuickEntry'))$('btnSaveQuickEntry').hidden=false;
      if($('entryQuickError'))$('entryQuickError').textContent='';
      setEntrySelectedStatus('','');
    }
    function updateQuickEntrySelection(focusValue){
      var select=$('entryCategorySelect');if(!select)return;
      var code=select.value,category=state.categories.find(function(item){return item.code===code});
      var valueField=$('entryQuickValueField'),actions=$('entryInlineActions'),save=$('btnSaveQuickEntry'),adjust=$('btnEntrySelectedAdjust'),history=$('btnEntrySelectedHistory'),del=$('btnEntrySelectedDelete');
      if(!category){resetEntrySelection();return}
      var record=state.dailyByCode[code]||null,auto=!!category.derivedKind,current=auto?Number(record?record.autoValue!=null?record.autoValue:record.value||0:0):record?Number(record.value||0):null,autoValue=auto?current:null;
      var training=isTrainingCategory(category),trainingField=$('entryTrainingContentField'),trainingInput=$('entryTrainingContent');
      actions.hidden=false;
      if(trainingField)trainingField.hidden=!training||!!record||auto||!!category.personDetailKind;
      if(trainingInput&&training&&!record)trainingInput.value='';
      if(auto)setEntrySelectedStatus('Tự động từ Báo cáo','is-auto');
      else if(record)setEntrySelectedStatus('Đã ghi nhận','is-complete');else setEntrySelectedStatus('','');
      var personMode=!!category.personDetailKind;
      if(personMode)setEntrySelectedStatus('Theo danh sách đối tượng','is-auto');
      if(adjust&&adjust.querySelector('span'))adjust.querySelector('span').textContent=auto?'Xem nguồn':personMode?'Quản lý danh sách':'Cập nhật số liệu';
      if(history&&history.querySelector('span'))history.querySelector('span').textContent=auto?'Mở Báo cáo':'Lịch sử';
      history.hidden=auto?false:!record;
      if(personMode){
        valueField.hidden=true;save.hidden=true;adjust.hidden=!canInputTongHop();if(del)del.hidden=true;state.quickEntryBaseline='';$('entryQuickValue').value='';
      }else if(auto){
        valueField.hidden=true;save.hidden=true;adjust.hidden=!canInputTongHop();if(del)del.hidden=true;state.quickEntryBaseline='';$('entryQuickValue').value='';
      }else if(record){
        valueField.hidden=true;save.hidden=true;adjust.hidden=false;if(del)del.hidden=!isTongHopAdmin()&&!isOwnerAdmin();
        $('entryQuickValue').value=String(Number(record.value||0));state.quickEntryBaseline=code+'|'+$('entryQuickValue').value+'|'+(training?String(record.note||''):'');
      }else{
        valueField.hidden=false;save.hidden=false;adjust.hidden=true;if(del)del.hidden=true;
        $('entryQuickValueLabel').childNodes[0].nodeValue=entryUnitInputLabel(category.unit);$('entryQuickValue').placeholder=entryUnitPlaceholder(category.unit);$('entryQuickValue').value='';
        save.textContent='Lưu số liệu';save.disabled=false;state.quickEntryBaseline=code+'||';
        if(focusValue)window.setTimeout(function(){$('entryQuickValue').focus();$('entryQuickValue').select()},0);
      }
      state.lastQuickEntryCode=code;
      if($('entryQuickError'))$('entryQuickError').textContent='';
    }
    function openDerivedSource(code){
      var category=state.categories.find(function(item){return item.code===code});
      var date=$('entryDate').value;
      if(!category||!category.derivedKind)return;
      showView('journey');
      window.setTimeout(function(){
        if(window.YTE_JOURNEYS&&typeof window.YTE_JOURNEYS.openHistoryFilter==='function')window.YTE_JOURNEYS.openHistoryFilter({from:date,to:date,status:'all'});
      },80);
    }
    function setQuickEntrySaving(active){
      state.quickEntrySaving=active===true;
      ['entryCategorySelect','entryQuickValue','entryTrainingContent','btnEntrySelectedAdjust','btnEntrySelectedHistory','btnEntrySelectedDelete'].forEach(function(id){var el=$(id);if(el)el.disabled=state.quickEntrySaving});
      var save=$('btnSaveQuickEntry');if(save&&!save.hidden){save.disabled=state.quickEntrySaving||!$('entryCategorySelect').value;save.textContent=state.quickEntrySaving?'Đang lưu...':(state.dailyByCode[$('entryCategorySelect').value]?'Cập nhật số liệu':'Lưu số liệu')}
      if($('entryQuickProgress'))$('entryQuickProgress').hidden=!state.quickEntrySaving;
    }
    function quickEntryDirty(){
      var code=String($('entryCategorySelect')&&$('entryCategorySelect').value||''),category=state.categories.find(function(item){return item.code===code});
      if(!category||category.derivedKind||category.personDetailKind)return false;
      var note=isTrainingCategory(category)?String($('entryTrainingContent')&&$('entryTrainingContent').value||''):'';
      return code+'|'+String($('entryQuickValue').value||'')+'|'+note!==state.quickEntryBaseline;
    }
    function personManagerFormDirty(){
      if(!$('personDetailLayer')||$('personDetailLayer').hidden)return false;
      return !!String($('personDetailId').value||'').trim()||!!String($('personDetailName').value||'').trim()||!!String($('personDetailGender').value||'').trim()||!!String($('personDetailBirthYear').value||'').trim();
    }
    function quickEntryPayload(){
      var code=String($('entryCategorySelect').value||''),category=state.categories.find(function(item){return item.code===code});
      if(!category)throw new Error('Vui lòng chọn chỉ tiêu cần nhập.');
      if(category.derivedKind)throw new Error(category.name+' được hệ thống tự động tổng hợp từ phân hệ Chuyển viện & tử vong.');
      if(category.personDetailKind)throw new Error(category.name+' được quản lý theo danh sách đối tượng chi tiết.');
      var raw=String($('entryQuickValue').value||'').trim();if(raw==='')throw new Error('Vui lòng nhập '+entryUnitInputLabel(category.unit).replace(' *','').toLocaleLowerCase('vi-VN')+'. Có thể nhập 0.');
      var newValue=Number(raw);if(!isFinite(newValue)||newValue<0||Math.floor(newValue)!==newValue)throw new Error('Số liệu phải là số nguyên không âm.');
      var record=state.dailyByCode[code]||null;
      var note=isTrainingCategory(category)?String($('entryTrainingContent')&&$('entryTrainingContent').value||'').trim():String(record&&record.note||'');
      if(isTrainingCategory(category)&&note.length<2)throw new Error('Vui lòng nhập Nội dung tập huấn.');
      if(record&&newValue===Number(record.value||0)&&note===String(record.note||'').trim())throw new Error('Số liệu và nội dung mới đang bằng dữ liệu hiện tại.');
      return{token:state.token,date:$('entryDate').value,code:code,newValue:newValue,note:note,reason:record?'Cập nhật trực tiếp trên ứng dụng':'Ghi nhận số liệu lần đầu',expectedVersion:record?Number(record.version||0):0};
    }
    async function submitQuickEntry(){
      if(state.quickEntrySaving)return;var payload;
      try{payload=quickEntryPayload()}catch(error){$('entryQuickError').textContent=error.message||String(error);return}
      $('entryQuickError').textContent='';setQuickEntrySaving(true);
      try{
        var result=await call('adjustDailyData',payload);if(result.record)state.dailyByCode[payload.code]=result.record;
        state.entryCache[payload.date]={byCode:state.dailyByCode,loadedAt:Date.now()};renderIndicators();setQuickEntrySaving(false);setEntryLoadState('','ok',false);clearMessage();
        var savedCategory=state.categories.find(function(item){return item.code===payload.code});
        toast(savedCategory?'Đã lưu '+savedCategory.name+': '+Number(payload.newValue).toLocaleString('vi-VN')+' '+savedCategory.unit+'.':(result.message||'Đã lưu số liệu.'),'ok');
        $('rangeType').value='day';updateRangeFields();$('singleDate').value=payload.date;Promise.resolve(syncData(true,true)).catch(function(){});
      }catch(error){$('entryQuickError').textContent=error.message||String(error);setQuickEntrySaving(false)}
    }
    function renderIndicators(){renderEntryCategoryOptions();renderEntrySideExtras()}
    async function loadDay(options){
      options=options||{};if(!state.user)return
      var date=$('entryDate').value;if(!date){if(options.notify)message('Vui lòng chọn ngày nhập số liệu.','err');return}
      if(!options.force&&cacheIsFresh(date)){applyDailyCache(date);setEntryLoadState('','ok',false);return}
      if(state.entryLoads[date])return state.entryLoads[date];
      var requestId=++state.entryRequestId;$('btnLoadDay').disabled=true;setEntryLoadState('Đang kiểm tra dữ liệu mới nhất...','',true);
      var promise=(async function(){
        try{
          var result=await call('getDailyData',date,state.token);
          cacheDaily(date,result.records||[]);
          if(requestId!==state.entryRequestId||date!==$('entryDate').value)return;
          applyDailyCache(date);setEntryLoadState('','ok',false);if(options.notify)toast('Đã tải dữ liệu mới nhất.','ok')
        }catch(error){setEntryLoadState(error.message||String(error),'err',false);if(options.notify)message(error.message||String(error),'err')}
        finally{$('btnLoadDay').disabled=false;delete state.entryLoads[date]}
      })();state.entryLoads[date]=promise;return promise;
    }
    async function manualReloadDay(){
      if(state.adjustSaving||state.quickEntrySaving)return;
      await loadDay({silent:true,force:true,notify:true});
    }
    async function handleEntryDateChange(){
      if(state.adjustSaving||state.quickEntrySaving){
        $('entryDate').value=state.loadedEntryDate||$('entryDate').value;
        toast('Dữ liệu đang được lưu. Vui lòng chờ hoàn tất.','warn');
        return;
      }
      if(quickEntryDirty()){
        var discardEntry=await confirmAction({title:'Bỏ số liệu chưa lưu?',message:'Số liệu đang nhập chưa được lưu. Nếu tiếp tục đổi ngày, nội dung đang nhập sẽ bị bỏ.',confirmText:'Bỏ thay đổi',cancelText:'Tiếp tục nhập',danger:true});
        if(!discardEntry){$('entryDate').value=state.loadedEntryDate||$('entryDate').value;return;}
      }
      resetEntrySelection();state.dailyByCode={};state.loadedEntryDate='';renderIndicators();
      startEntryRealtime($('entryDate').value);
      if(!applyDailyCache($('entryDate').value))await loadDay({silent:true,force:false,notify:false});
      else if(!cacheIsFresh($('entryDate').value))loadDay({silent:true,force:true,notify:false});
    }
    function setAdjustmentSaving(active){
      state.adjustSaving=active===true;
      var card=$('adjustLayer').querySelector('.adjust-card');
      var saveButton=$('adjustSave');
      var cancelButton=$('adjustCancel');
      var valueInput=$('adjustNewValue');
      var reasonInput=$('adjustReason');
      var trainingInput=$('adjustTrainingContent');
      var progress=$('adjustProgress');
      $('adjustLayer').setAttribute('aria-busy',state.adjustSaving?'true':'false');
      if(card)card.classList.toggle('is-saving',state.adjustSaving);
      saveButton.disabled=state.adjustSaving;
      cancelButton.disabled=state.adjustSaving;
      valueInput.disabled=state.adjustSaving;
      if(reasonInput)reasonInput.disabled=state.adjustSaving;
      if(trainingInput)trainingInput.disabled=state.adjustSaving;
      progress.hidden=!state.adjustSaving;
      saveButton.innerHTML=state.adjustSaving
        ? '<span class="adjust-save-spinner" aria-hidden="true"></span><span>Đang lưu...</span>'
        : 'Lưu thay đổi';
    }
    function openAdjustDialog(code){
      if(state.adjustSaving)return;
      var record=state.dailyByCode[code]||null;
      var category=state.categories.find(function(item){return item.code===code});
      if(!category){toast('Không tìm thấy chỉ tiêu cần cập nhật.','warn');return}
      if(category.derivedKind){openDerivedSource(code);return}
      state.adjustingCode=code;
      var isDerived=!!(category.derivedKind||(record&&record.derivedKind));
      var autoValue=isDerived?Number(record?(record.autoValue==null?record.value||0:record.autoValue):0):null;
      $('adjustTitle').textContent='Sửa '+category.name;
      $('adjustContext').textContent='Ngày '+fmtDate($('entryDate').value)+' · Đơn vị: '+category.unit+' · Có thể nhập 0.';
      $('adjustCurrentValue').textContent=record?Number(record.value||0).toLocaleString('vi-VN')+' '+category.unit:(isDerived?'0 '+category.unit:'Chưa ghi nhận');
      $('adjustAutoReference').hidden=!isDerived;
      $('adjustAutoReference').textContent='';
      $('adjustReasonLabel').textContent='Lý do điều chỉnh';
      $('adjustReason').value='';
      $('adjustReason').placeholder='Nhập lý do nếu cần lưu để đối chiếu';
      var training=isTrainingCategory(category);
      if($('adjustTrainingContentField'))$('adjustTrainingContentField').hidden=!training;
      if($('adjustTrainingContent'))$('adjustTrainingContent').value=training?String(record&&record.note||''):'';
      $('adjustNewValue').value=record?String(Number(record.value||0)):'';
      $('adjustError').textContent='';
      setAdjustmentSaving(false);
      $('adjustLayer').hidden=false;
      document.body.style.overflow='hidden';
      window.setTimeout(function(){$('adjustNewValue').focus();$('adjustNewValue').select()},0);
    }
    function closeAdjustDialog(){
      if(state.adjustSaving)return;
      $('adjustLayer').hidden=true;
      state.adjustingCode='';
      $('adjustError').textContent='';
      $('adjustReason').value='';
      if($('adjustTrainingContent'))$('adjustTrainingContent').value='';
      if($('adjustTrainingContentField'))$('adjustTrainingContentField').hidden=true;
      $('adjustAutoReference').hidden=true;
      $('adjustProgress').hidden=true;
      if($('confirmLayer').hidden)document.body.style.overflow='';
    }
    function adjustmentPayload(){
      var code=state.adjustingCode;
      var record=state.dailyByCode[code]||null;
      var category=state.categories.find(function(item){return item.code===code});
      if(!category)throw new Error('Không tìm thấy chỉ tiêu cần cập nhật.');
      var raw=String($('adjustNewValue').value||'').trim();
      if(raw==='')throw new Error('Vui lòng nhập số liệu mới. Có thể nhập 0.');
      var newValue=Number(raw);
      if(!isFinite(newValue)||newValue<0||Math.floor(newValue)!==newValue)throw new Error('Số liệu mới phải là số nguyên không âm.');
      var training=isTrainingCategory(category),note=training?String($('adjustTrainingContent')&&$('adjustTrainingContent').value||'').trim():String(record&&record.note||'').trim();
      if(training&&note.length<2)throw new Error('Vui lòng nhập Nội dung tập huấn.');
      if(record&&newValue===Number(record.value||0)&&note===String(record.note||'').trim())throw new Error('Số liệu và nội dung mới đang bằng dữ liệu hiện tại.');
      var isDerived=!!(category.derivedKind||(record&&record.derivedKind));
      if(isDerived)throw new Error('Chuyển viện/Tử vong là số liệu tự động từ dữ liệu nguồn. Hãy mở Chuyển viện để điều chỉnh dữ liệu nguồn.');
      var typedReason=String($('adjustReason').value||'').trim();
      if(isDerived&&typedReason.length<3)throw new Error('Vui lòng nhập lý do điều chỉnh để lưu lịch sử đối chiếu.');
      var reason=typedReason||(record?'Cập nhật trực tiếp trên ứng dụng':'Ghi nhận số liệu lần đầu');
      return{
        token:state.token,
        date:$('entryDate').value,
        code:code,
        newValue:newValue,
        note:note,
        reason:reason,
        expectedVersion:record?Number(record.version||0):0
      };
    }
    async function submitAdjustment(){
      if(state.adjustSaving)return;
      var payload;
      try{payload=adjustmentPayload()}catch(error){$('adjustError').textContent=error.message||String(error);return}
      $('adjustError').textContent='';
      setAdjustmentSaving(true);
      try{
        var result=await call('adjustDailyData',payload);
        if(result.record)state.dailyByCode[payload.code]=result.record;
        state.entryCache[payload.date]={byCode:state.dailyByCode,loadedAt:Date.now()};
        setAdjustmentSaving(false);
        closeAdjustDialog();
        renderIndicators();
        setEntryLoadState('','ok',false);
        clearMessage();
        toast(result.message||'Đã lưu số liệu.','ok');
        $('rangeType').value='day';updateRangeFields();$('singleDate').value=payload.date;
        Promise.resolve(syncData(true,true)).catch(function(){});
      }catch(error){
        $('adjustError').textContent=error.message||String(error);
        setAdjustmentSaving(false);
      }
    }

    function setDeleteDailySaving(active){
      state.deleteDailySaving=active===true;
      var layer=$('deleteDailyLayer'),accept=$('deleteDailyAccept'),cancel=$('deleteDailyCancel'),reason=$('deleteDailyReason'),progress=$('deleteDailyProgress');
      if(layer)layer.setAttribute('aria-busy',state.deleteDailySaving?'true':'false');
      if(accept){accept.disabled=state.deleteDailySaving;accept.textContent=state.deleteDailySaving?'Đang xóa...':'Xóa số liệu'}
      if(cancel)cancel.disabled=state.deleteDailySaving;
      if(reason)reason.disabled=state.deleteDailySaving;
      if(progress)progress.hidden=!state.deleteDailySaving;
    }
    function openDeleteDailyDialog(code){
      if(state.deleteDailySaving)return;
      if(!isTongHopAdmin()&&!isOwnerAdmin()){toast('Chỉ tài khoản Quản trị mới được xóa số liệu.','warn');return;}
      var category=state.categories.find(function(item){return item.code===code}),record=state.dailyByCode[code]||null;
      if(!category||!record){toast('Không tìm thấy số liệu cần xóa.','warn');return}
      if(category.derivedKind||(record&&record.derivedKind)){toast('Số liệu tự động không thể xóa tại màn hình Nhập liệu.','warn');return}
      if(category.personDetailKind){toast(category.name+' được quản lý theo danh sách đối tượng. Hãy xóa người trong danh sách.','warn');return}
      state.deleteDailyCode=code;
      $('deleteDailyDate').textContent=fmtDate($('entryDate').value);
      $('deleteDailyCategory').textContent=category.name+' · '+category.unit;
      $('deleteDailyValue').textContent=Number(record.value||0).toLocaleString('vi-VN')+' '+category.unit;
      $('deleteDailyReason').value='';$('deleteDailyError').textContent='';setDeleteDailySaving(false);
      $('deleteDailyLayer').hidden=false;document.body.style.overflow='hidden';
      window.setTimeout(function(){$('deleteDailyReason').focus()},0);
    }
    function closeDeleteDailyDialog(){
      if(state.deleteDailySaving)return;
      $('deleteDailyLayer').hidden=true;state.deleteDailyCode='';$('deleteDailyReason').value='';$('deleteDailyError').textContent='';$('deleteDailyProgress').hidden=true;
      if($('confirmLayer').hidden&&$('adjustLayer').hidden&&$('dataHistoryLayer').hidden)document.body.style.overflow='';
    }
    async function submitDeleteDaily(){
      if(state.deleteDailySaving)return;
      var code=state.deleteDailyCode,category=state.categories.find(function(item){return item.code===code}),record=state.dailyByCode[code]||null;
      if(!category||!record){$('deleteDailyError').textContent='Số liệu không còn tồn tại. Vui lòng tải lại.';return}
      var reason=String($('deleteDailyReason').value||'').trim();
      if(reason.length<3){$('deleteDailyError').textContent='Vui lòng nhập lý do xóa ít nhất 3 ký tự.';$('deleteDailyReason').focus();return}
      setDeleteDailySaving(true);$('deleteDailyError').textContent='';
      try{
        var payload={token:state.token,date:$('entryDate').value,code:code,expectedVersion:Number(record.version||0),reason:reason};
        var result=await call('deleteDailyData',payload);
        if(result&&result.auditId)notifyBusinessEvent('TONGHOP_DATA_DELETED',result.auditId,{date:payload.date,code:code});
        delete state.dailyByCode[code];state.entryCache[payload.date]={byCode:state.dailyByCode,loadedAt:Date.now()};
        setDeleteDailySaving(false);closeDeleteDailyDialog();renderIndicators();clearMessage();toast(result.message||'Đã xóa số liệu.','ok');
        $('rangeType').value='day';updateRangeFields();$('singleDate').value=payload.date;Promise.resolve(syncData(true,true)).catch(function(){});
      }catch(error){$('deleteDailyError').textContent=error.message||String(error);setDeleteDailySaving(false)}
    }

    function renderDataHistory(items,category){
      var box=$('dataHistoryList');items=items||[];
      if(!items.length){box.innerHTML='<div class="data-history-empty"><strong>Chưa có lần điều chỉnh thủ công.</strong><span>Số liệu hiện tại đang được giữ theo nguồn tự động hoặc chưa phát sinh thay đổi.</span></div>';return}
      box.innerHTML=items.map(function(item){
        var who=esc(item.displayName||'Tài khoản được cấp quyền'),reason=esc(item.reason||'Không ghi lý do'),time=esc(item.createdAtText||'');
        var autoRef=item.autoValue==null?'':'<div class="data-history-auto">Tự động lúc điều chỉnh: '+Number(item.autoValue||0).toLocaleString('vi-VN')+' '+esc(category&&category.unit||'')+'</div>';
        var afterText=item.afterValue==null?'Đã xóa':Number(item.afterValue||0).toLocaleString('vi-VN')+' '+esc(category&&category.unit||'');
        var beforeNote=String(item.beforeNote||'').trim(),afterNote=String(item.afterNote||'').trim();
        var noteChange=(beforeNote||afterNote)?'<div class="data-history-note"><span>Nội dung</span><strong>'+esc(beforeNote||'Chưa ghi nội dung')+' → '+esc(afterNote||'Chưa ghi nội dung')+'</strong></div>':'';
        return'<article class="data-history-item"><div class="data-history-top"><strong>'+Number(item.beforeValue||0).toLocaleString('vi-VN')+' '+esc(category&&category.unit||'')+' → '+afterText+'</strong><span>'+time+'</span></div><div class="data-history-action">'+esc(item.action||'Điều chỉnh')+'</div>'+autoRef+noteChange+'<div class="data-history-reason">'+reason+'</div><div class="data-history-user"><strong>'+who+'</strong></div></article>'
      }).join('');
    }
    async function openDataHistoryDialog(code){
      var category=state.categories.find(function(item){return item.code===code});if(!category)return;if(category.derivedKind){$('adjustError').textContent='Chuyển viện/Tử vong là số liệu tự động từ Báo cáo và không được điều chỉnh trực tiếp.';return;}
      state.historyCode=code;state.historyLoading=true;
      $('dataHistoryTitle').textContent='Lịch sử điều chỉnh · '+category.name;
      $('dataHistoryContext').textContent='Ngày '+fmtDate($('entryDate').value)+' · Mọi thay đổi đều ghi nhận người thực hiện và thời điểm điều chỉnh.';
      $('dataHistoryList').innerHTML='<div class="data-history-loading"><span class="spinner"></span><span>Đang tải lịch sử...</span></div>';
      $('dataHistoryLayer').hidden=false;document.body.style.overflow='hidden';
      try{var result=await call('getDailyDataHistory',{date:$('entryDate').value,code:code,token:state.token});renderDataHistory(result.items||[],category)}
      catch(error){$('dataHistoryList').innerHTML='<div class="data-history-empty is-error"><strong>Không tải được lịch sử.</strong><span>'+esc(error.message||String(error))+'</span></div>'}
      finally{state.historyLoading=false}
    }
    function closeDataHistoryDialog(){$('dataHistoryLayer').hidden=true;state.historyCode='';if($('confirmLayer').hidden&&$('adjustLayer').hidden)document.body.style.overflow=''}


    function renderAdminUsers(){
      var query=String($('adminSearch').value||'').trim().toLowerCase();
      var statusFilter=$('adminStatusFilter')?String($('adminStatusFilter').value||'all'):'all';
      var totalCount=state.adminUsers.length;
      var pendingMetric=state.adminUsers.filter(function(user){return user.isPending&&(user.requestStatus==='pending'||user.requestStatus==='unassigned')}).length;
      var activeMetric=state.adminUsers.filter(function(user){return!user.isPending&&user.status==='Hoạt động'}).length;
      var adminMetric=state.adminUsers.filter(function(user){return!user.isPending&&user.role==='Quản trị'&&user.status==='Hoạt động'}).length;
      if($('adminMetricTotal'))$('adminMetricTotal').textContent=String(totalCount);
      if($('adminMetricPending'))$('adminMetricPending').textContent=String(pendingMetric);
      if($('adminMetricActive'))$('adminMetricActive').textContent=String(activeMetric);
      if($('adminMetricAdmins'))$('adminMetricAdmins').textContent=String(adminMetric);
      var rows=state.adminUsers.filter(function(user){
        var textOk=!query||String(user.name+' '+user.username+' '+user.email+' '+user.role+' '+user.status).toLowerCase().indexOf(query)>=0;
        if(!textOk)return false;
        if(statusFilter==='pending')return user.isPending&&(user.requestStatus==='pending'||user.requestStatus==='unassigned');
        if(statusFilter==='active')return !user.isPending&&user.status==='Hoạt động';
        if(statusFilter==='locked')return !user.isPending&&user.status!=='Hoạt động';
        if(statusFilter==='admin')return !user.isPending&&user.role==='Quản trị';
        return true;
      });
      var pendingRows=rows.filter(function(user){return user.isPending&&(user.requestStatus==='pending'||user.requestStatus==='unassigned'||user.requestStatus==='rejected')});
      var grantedRows=rows.filter(function(user){return!user.isPending});
      var pendingCount=state.adminUsers.filter(function(user){return user.isPending&&(user.requestStatus==='pending'||user.requestStatus==='unassigned')}).length;
      $('adminCount').textContent=state.adminUsers.length+' tài khoản';
      $('adminPending').hidden=pendingCount===0;$('adminPending').textContent=pendingCount+' chờ duyệt';
      $('adminNote').hidden=true;$('adminNote').textContent='';
      if(!rows.length){$('adminUsers').innerHTML='<div class="empty">Không có tài khoản phù hợp.</div>';return}
      function avatarText(user){var name=String(user.name||user.email||'?').trim();return esc((name.charAt(0)||'?').toUpperCase())}
      function roleOptions(selected){return ['Xem','Nhập liệu','Quản trị'].map(function(role){return'<option value="'+role+'"'+(role===selected?' selected':'')+'>'+role+'</option>'}).join('')}
      function accountIdentity(user,isSelf){
        var status=user.status||'Chưa cấp';
        var role=user.role||'Chưa cấp';
        var line=status+(role&&role!=='Chưa cấp'?' · '+role:'')+(isSelf?' · Tài khoản đang đăng nhập':'');
        return'<div class="admin-account-identity"><span class="admin-account-avatar">'+avatarText(user)+'</span><div class="admin-account-person"><strong>'+esc(user.name||'Chưa có tên')+(isSelf?' <span class="admin-self-tag">(Bạn)</span>':'')+'</strong><span>'+esc(user.email||user.username||'—')+'</span><small>'+esc(line)+'</small></div></div>';
      }
      function pendingCard(user){
        var isSelf=state.user&&user.id===state.user.id;
        var requestText=user.requestStatus==='rejected'?'Đã từ chối':(user.requestStatus==='unassigned'?'Chưa cấp quyền':'Chờ duyệt');
        var selectDisabled=user.requestStatus==='rejected'?' disabled':'';
        var controls='<div class="admin-account-controls"><select class="admin-role-select" aria-label="Chọn quyền cấp cho '+esc(user.name||user.email||'tài khoản')+'"'+selectDisabled+'>'+roleOptions('Xem')+'</select>';
        if(user.requestStatus!=='rejected')controls+='<button class="btn btn-primary admin-action" data-kind="approve-selected" data-id="'+esc(user.id)+'" type="button">Cấp quyền</button>';
        if(user.requestStatus==='pending')controls+='<button class="btn btn-soft admin-action admin-inline-secondary" data-kind="reject-registration" data-id="'+esc(user.id)+'" type="button">Từ chối</button>';
        if(!isSelf)controls+='<button class="btn btn-danger admin-action admin-inline-danger" data-kind="delete" data-id="'+esc(user.id)+'" type="button">Xóa tài khoản</button>';
        controls+='<details class="admin-account-more"><summary aria-label="Thao tác khác">•••</summary><div class="admin-row-popover"><button class="small-btn btn-soft admin-action" data-kind="display-name" data-id="'+esc(user.id)+'" type="button">Tên hiển thị</button>'+(user.requestStatus==='pending'?'<button class="small-btn btn-soft admin-action admin-mobile-only" data-kind="reject-registration" data-id="'+esc(user.id)+'" type="button">Từ chối</button>':'')+(!isSelf?'<button class="small-btn btn-danger admin-action admin-mobile-only" data-kind="delete" data-id="'+esc(user.id)+'" type="button">Xóa tài khoản</button>':'')+'</div></details></div>';
        return'<article class="admin-account-card is-pending">'+accountIdentity(user,isSelf)+'<div class="admin-request-meta"><span class="status-pill pending">'+requestText+'</span>'+(user.requestedAt?'<span>'+esc(user.requestedAt)+'</span>':'')+'</div>'+controls+'</article>';
      }
      function grantedCard(user){
        var isSelf=state.user&&user.id===state.user.id;
        var disabled=isSelf?' disabled':'';
        var nextStatus=user.status==='Hoạt động'?'Khóa':'Hoạt động';
        var controls='<div class="admin-account-controls"><select class="admin-role-select" aria-label="Vai trò của '+esc(user.name||user.email||'tài khoản')+'"'+disabled+'>'+roleOptions(user.role||'Xem')+'</select>'+
          '<button class="btn btn-primary admin-action" data-kind="save-role" data-id="'+esc(user.id)+'" type="button"'+disabled+'>Lưu quyền</button>'+
          (!isSelf?'<button class="btn btn-soft admin-action admin-inline-secondary" data-kind="status" data-id="'+esc(user.id)+'" data-value="'+esc(nextStatus)+'" type="button">'+(user.status==='Hoạt động'?'Khóa':'Mở khóa')+'</button><button class="btn btn-danger admin-action admin-inline-danger" data-kind="delete" data-id="'+esc(user.id)+'" type="button">Xóa tài khoản</button>':'')+
          '<details class="admin-account-more"><summary aria-label="Thao tác khác">•••</summary><div class="admin-row-popover"><button class="small-btn btn-soft admin-action" data-kind="display-name" data-id="'+esc(user.id)+'" type="button">Tên hiển thị</button>'+(!isSelf?'<button class="small-btn btn-soft admin-action admin-mobile-only" data-kind="status" data-id="'+esc(user.id)+'" data-value="'+esc(nextStatus)+'" type="button">'+(user.status==='Hoạt động'?'Khóa tài khoản':'Mở khóa tài khoản')+'</button><button class="small-btn btn-danger admin-action admin-mobile-only" data-kind="delete" data-id="'+esc(user.id)+'" type="button">Xóa tài khoản</button>':'')+'</div></details></div>';
        return'<article class="admin-account-card">'+accountIdentity(user,isSelf)+controls+'</article>';
      }
      function section(title,desc,list,kind){
        return'<section class="admin-account-section"><div class="admin-account-section-head"><div><h3>'+title+'</h3><p>'+desc+'</p></div><span class="admin-section-count">'+list.length+'</span></div><div class="admin-account-list">'+(list.length?list.map(kind==='pending'?pendingCard:grantedCard).join(''):'<div class="admin-section-empty">Không có tài khoản nào trong nhóm này.</div>')+'</div></section>';
      }
      $('adminUsers').innerHTML='<div class="admin-account-sections">'+section('Chưa được cấp quyền','Tài khoản đang chờ duyệt, chưa được cấp quyền hoặc đã bị từ chối.',pendingRows,'pending')+section('Đã được phân quyền','Quản lý vai trò, trạng thái hoạt động và quyền sử dụng Tổng hợp số liệu.',grantedRows,'granted')+'</div>';
    }
    async function loadAdminUsers(force){
      if(!state.user||state.user.role!=='Quản trị')return
      if(!force&&state.adminUsers.length&&Date.now()-state.adminLoadedAt<ADMIN_CACHE_MS){renderAdminUsers();$('adminLoadState').hidden=true;return}
      if(state.adminPromise)return state.adminPromise;$('adminLoadState').hidden=false;$('adminLoadState').className='inline-state';$('adminLoadState').innerHTML='<span class="spinner"></span><span>Đang tải danh sách tài khoản...</span>';$('adminUsers').innerHTML='<div class="empty">Đang chuẩn bị dữ liệu quản trị...</div>';
      state.adminPromise=(async function(){try{var result=await call('getAdminUsers',state.token);state.adminUsers=result.users||[];state.adminLoadedAt=Date.now();renderAdminUsers();$('adminLoadState').hidden=true;$('adminLoadState').textContent=''}catch(error){$('adminLoadState').hidden=false;$('adminLoadState').className='inline-state err';$('adminLoadState').textContent=error.message||String(error);$('adminUsers').innerHTML='<div class="empty">Không thể tải danh sách tài khoản. Vui lòng thử lại.</div>'}finally{state.adminPromise=null}})();return state.adminPromise;
    }
    function showAdminSection(name){
      var canTongHop=isAnyAppAdmin();
      if($('adminUsersTab'))$('adminUsersTab').hidden=!canTongHop;
      if($('adminCategoriesTab'))$('adminCategoriesTab').hidden=!canTongHop;
      if($('adminOverview'))$('adminOverview').hidden=!canTongHop;
      if(name!=='users'&&name!=='categories')name='users';
      state.adminSection=name;
      document.querySelectorAll('.admin-tab').forEach(function(tab){tab.classList.toggle('active',tab.getAttribute('data-admin-tab')===name)});
      $('adminUsersPanel').hidden=name!=='users';$('adminCategoriesPanel').hidden=name!=='categories';
      if(name==='users')loadAdminUsers(false);else loadAdminCategories(false);
    }

    function openDisplayNameDialog(id){
      var user=state.adminUsers.find(function(x){return x.id===id});if(!user)return;
      state.displayNameEditUid=id;$('displayNameEmail').textContent=user.email||'—';$('displayNameInput').value=user.name||'';$('displayNameError').textContent='';$('displayNameLayer').hidden=false;document.body.style.overflow='hidden';window.setTimeout(function(){$('displayNameInput').focus();$('displayNameInput').select()},0)
    }
    function closeDisplayNameDialog(){$('displayNameLayer').hidden=true;state.displayNameEditUid='';$('displayNameError').textContent='';if($('confirmLayer').hidden&&$('adjustLayer').hidden&&$('dataHistoryLayer').hidden)document.body.style.overflow=''}
    async function saveDisplayName(){var id=state.displayNameEditUid,name=$('displayNameInput').value;if(!id)return;$('displayNameSave').disabled=true;$('displayNameError').textContent='';try{var result=await call('adminSetDisplayName',id,name);message(result.message||'Đã lưu tên hiển thị.','ok');closeDisplayNameDialog();state.adminLoadedAt=0;await loadAdminUsers(true).catch(function(){});await refreshCurrentSession()}catch(error){$('displayNameError').textContent=error.message||String(error)}finally{$('displayNameSave').disabled=false}}

    function renderAdminCategories(){
      var query=String($('categorySearch').value||'').trim().toLowerCase();
      var rows=state.adminCategories.filter(function(item){return!query||String(item.code+' '+item.name+' '+item.group+' '+item.unit+' '+item.status).toLowerCase().indexOf(query)>=0});
      var inactive=state.adminCategories.filter(function(item){return item.status!=='Hoạt động'}).length;
      $('categoryCount').textContent=state.adminCategories.length+' chỉ tiêu';$('categoryInactiveCount').textContent=inactive+' ngừng sử dụng';
      if(!rows.length){$('adminCategories').innerHTML='<div class="empty">Không có chỉ tiêu phù hợp.</div>';return}
      $('adminCategories').innerHTML='<table class="category-table"><thead><tr><th>Mã</th><th>Tên chỉ tiêu</th><th>Nhóm</th><th>Đơn vị</th><th>Thứ tự</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>'+rows.map(function(item){
        var active=item.status==='Hoạt động';
        var actions='<button class="small-btn btn-soft category-action" data-kind="edit" data-code="'+esc(item.code)+'">Sửa</button>'+
          '<button class="small-btn '+(active?'btn-danger':'btn-soft')+' category-action" data-kind="status" data-code="'+esc(item.code)+'" data-value="'+(active?'Ngừng hoạt động':'Hoạt động')+'">'+(active?'Xóa':'Khôi phục')+'</button>';
        var mobileMore='<details class="category-mobile-more"><summary><span>Chi tiết</span><span aria-hidden="true">•••</span></summary><div class="category-mobile-detail-grid">'+
          '<div><span>Nhóm</span><strong>'+esc(item.group)+'</strong></div>'+
          '<div><span>Đơn vị</span><strong>'+esc(item.unit)+'</strong></div>'+
          '<div><span>Thứ tự</span><strong>'+Number(item.order||0)+'</strong></div>'+
          '<div><span>Trạng thái</span><strong>'+(active?'Hoạt động':'Ngừng sử dụng')+'</strong></div>'+
          '</div><div class="category-mobile-actions">'+actions+'</div></details>';
        return'<tr class="'+(active?'':'is-inactive')+'"><td data-label="Mã"><span class="category-code">'+esc(item.code)+'</span></td><td data-label="Tên chỉ tiêu"><b>'+esc(item.name)+'</b>'+mobileMore+'</td><td data-label="Nhóm">'+esc(item.group)+'</td><td data-label="Đơn vị">'+esc(item.unit)+'</td><td data-label="Thứ tự">'+Number(item.order||0)+'</td><td data-label="Trạng thái"><span class="status-pill'+(active?'':' pending')+'">'+(active?'Hoạt động':'Ngừng sử dụng')+'</span></td><td data-label="Thao tác">'+actions+'</td></tr>';
      }).join('')+'</tbody></table>';
    }
    async function loadAdminCategories(force){
      if(!state.user||state.user.role!=='Quản trị')return;
      if(!force&&state.adminCategories.length&&Date.now()-state.categoryLoadedAt<ADMIN_CACHE_MS){renderAdminCategories();$('categoryLoadState').hidden=true;return}
      if(state.categoryPromise)return state.categoryPromise;
      $('categoryLoadState').hidden=false;$('categoryLoadState').className='inline-state';$('categoryLoadState').innerHTML='<span class="spinner"></span><span>Đang tải danh mục chỉ tiêu...</span>';$('adminCategories').innerHTML='<div class="empty">Đang chuẩn bị danh mục...</div>';
      state.categoryPromise=(async function(){try{var result=await call('getAdminCategories',state.token);state.adminCategories=result.categories||[];state.categoryLoadedAt=Date.now();renderAdminCategories();$('categoryLoadState').hidden=true;$('categoryLoadState').textContent=''}catch(error){$('categoryLoadState').hidden=false;$('categoryLoadState').className='inline-state err';$('categoryLoadState').textContent=error.message||String(error);$('adminCategories').innerHTML='<div class="empty">Không thể tải danh mục chỉ tiêu. Vui lòng thử lại.</div>'}finally{state.categoryPromise=null}})();return state.categoryPromise;
    }
    function nextCategoryOrder(){var max=0;state.adminCategories.forEach(function(item){max=Math.max(max,Number(item.order||0))});return max+1}
    function openCategoryDialog(code){
      if(state.categorySaving)return;var item=code?state.adminCategories.find(function(row){return row.code===code}):null;
      state.editingCategoryCode=item?item.code:'';$('categoryDialogTitle').textContent=item?'Sửa chỉ tiêu':'Thêm chỉ tiêu';
      $('categoryName').value=item?item.name:'';$('categoryCode').value=item?item.code:'';$('categoryCode').disabled=!!item;
      $('categoryGroup').value=item?item.group:'Khác';$('categoryUnit').value=item?item.unit:'Lượt';$('categoryOrder').value=item?String(item.order||1):String(nextCategoryOrder());$('categoryStatus').value=item&&item.status!=='Hoạt động'?'Ngừng hoạt động':'Hoạt động';
      $('categoryCodeHelp').textContent=item?'Mã chỉ tiêu được giữ cố định để bảo toàn dữ liệu lịch sử.':'Có thể để trống; hệ thống sẽ tự tạo mã từ tên chỉ tiêu.';
      $('categoryError').textContent='';$('categorySave').disabled=false;$('categoryCancel').disabled=false;$('categorySave').textContent='Lưu chỉ tiêu';$('categoryLayer').hidden=false;document.body.style.overflow='hidden';window.setTimeout(function(){$('categoryName').focus()},0);
    }
    function closeCategoryDialog(){if(state.categorySaving)return;$('categoryLayer').hidden=true;state.editingCategoryCode='';$('categoryError').textContent='';if($('confirmLayer').hidden&&$('adjustLayer').hidden)document.body.style.overflow=''}
    function categoryPayload(){
      var name=String($('categoryName').value||'').trim(),group=String($('categoryGroup').value||'').trim(),unit=String($('categoryUnit').value||'').trim(),order=Number($('categoryOrder').value),status=$('categoryStatus').value;
      if(name.length<2)throw new Error('Vui lòng nhập tên chỉ tiêu từ 2 ký tự.');if(!group)throw new Error('Vui lòng nhập nhóm chỉ tiêu.');if(!unit)throw new Error('Vui lòng nhập đơn vị tính.');if(!isFinite(order)||order<1||Math.floor(order)!==order)throw new Error('Thứ tự hiển thị phải là số nguyên từ 1 trở lên.');
      return{originalCode:state.editingCategoryCode,code:$('categoryCode').value,name:name,group:group,unit:unit,order:order,status:status};
    }
    async function submitCategory(){
      if(state.categorySaving)return;var payload;try{payload=categoryPayload()}catch(error){$('categoryError').textContent=error.message||String(error);return}
      state.categorySaving=true;$('categoryError').textContent='';$('categorySave').disabled=true;$('categoryCancel').disabled=true;$('categorySave').innerHTML='<span class="spinner"></span><span>Đang lưu...</span>';
      try{var result=await call('adminSaveCategory',state.token,payload);state.categoryLoadedAt=0;await loadAdminCategories(true);state.lastSyncAt=0;await syncData(true,true);state.categorySaving=false;closeCategoryDialog();toast(result.message||'Đã lưu chỉ tiêu.','ok')}catch(error){$('categoryError').textContent=error.message||String(error)}finally{state.categorySaving=false;$('categorySave').disabled=false;$('categoryCancel').disabled=false;$('categorySave').textContent='Lưu chỉ tiêu'}
    }
    async function setCategoryStatus(code,status){
      var isDelete=status==='Ngừng hoạt động';var confirmed=await confirmAction({title:isDelete?'Xóa chỉ tiêu khỏi danh sách?':'Khôi phục chỉ tiêu?',message:isDelete?'Chỉ tiêu sẽ không còn xuất hiện ở Tổng quan và Nhập liệu. Số liệu lịch sử vẫn được giữ nguyên.':'Chỉ tiêu sẽ xuất hiện trở lại trên giao diện nhập liệu.',confirmText:isDelete?'Xóa chỉ tiêu':'Khôi phục',danger:isDelete});if(!confirmed)return;
      setBusy(true,isDelete?'Đang xóa chỉ tiêu...':'Đang khôi phục chỉ tiêu...');try{var result=await call('adminSetCategoryStatus',state.token,code,status);state.categoryLoadedAt=0;await loadAdminCategories(true);state.lastSyncAt=0;await syncData(true,true);toast(result.message||'Đã cập nhật chỉ tiêu.','ok')}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }

    async function adminStatus(id,status){
      var confirmed=await confirmAction({title:status==='Khóa'?'Khóa tài khoản?':'Mở khóa tài khoản?',message:status==='Khóa'?'Tài khoản này sẽ tạm thời không sử dụng được phần Tổng hợp số liệu.':'Tài khoản này sẽ sử dụng lại phần Tổng hợp số liệu.',confirmText:status==='Khóa'?'Khóa':'Mở khóa',danger:status==='Khóa'});
      if(!confirmed)return;setBusy(true,'Đang cập nhật quyền...');
      try{var result=await call('adminSetUserStatus',state.token,id,status);message(result.message,'ok');state.adminLoadedAt=0;await loadAdminUsers(true)}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function adminRole(id,role){
      var confirmed=await confirmAction({title:'Đổi quyền của tài khoản?',message:'Quyền sử dụng sẽ được cập nhật theo lựa chọn mới.',confirmText:'Lưu quyền',danger:false});
      if(!confirmed)return;setBusy(true,'Đang cập nhật vai trò...');
      try{var result=await call('adminSetUserRole',state.token,id,role);message(result.message,'ok');state.adminLoadedAt=0;await loadAdminUsers(true)}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function approveRegistration(id,role){
      var confirmed=await confirmAction({title:'Cấp quyền '+role+'?',message:'Tài khoản sẽ được sử dụng ứng dụng với quyền đã chọn.',confirmText:'Cấp quyền'});
      if(!confirmed)return;setBusy(true,'Đang cấp quyền...');
      try{var result=await call('adminApproveRegistration',id,role);message(result.message,'ok');state.adminLoadedAt=0;await loadAdminUsers(true)}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function rejectRegistration(id){
      var confirmed=await confirmAction({title:'Từ chối yêu cầu?',message:'Tài khoản này sẽ chưa được sử dụng ứng dụng.',confirmText:'Từ chối',danger:true});
      if(!confirmed)return;setBusy(true,'Đang từ chối yêu cầu...');
      try{var result=await call('adminRejectRegistration',id);message(result.message,'ok');state.adminLoadedAt=0;await loadAdminUsers(true)}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function adminRevoke(id){
      var confirmed=await confirmAction({title:'Thu hồi quyền Tổng hợp số liệu?',message:'Tài khoản sẽ không còn sử dụng phần Tổng hợp số liệu cho đến khi được cấp lại.',confirmText:'Thu hồi quyền',danger:true});
      if(!confirmed)return;setBusy(true,'Đang thu hồi quyền...');
      try{var result=await call('adminRevokeUser',state.token,id);message(result.message,'ok');state.adminLoadedAt=0;await loadAdminUsers(true)}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function adminDelete(id){
      var user=state.adminUsers.find(function(item){return item.id===id})||{};
      var name=user.name||user.email||'tài khoản này';
      var confirmed=await confirmAction({title:'Xóa '+name+' khỏi ứng dụng?',message:'Tài khoản này sẽ không còn sử dụng Ứng dụng Phòng Y tế. Bạn có chắc muốn xóa?',confirmText:'Xóa tài khoản',danger:true});
      if(!confirmed)return;setBusy(true,'Đang xóa tài khoản khỏi ứng dụng...');
      try{
        var result=await call('adminDeleteUser',state.token,id);
        message(result.message,'ok');
        state.adminLoadedAt=0;
        await loadAdminUsers(true).catch(function(){});
      }catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }

    async function initializeUi(){
      window.parent.postMessage({type:'YTE_APP_READY',version:'10.0.19'},'*');setupDates();updateRangeFields();
      document.querySelectorAll('.nav-item').forEach(function(button){button.addEventListener('click',async function(event){
        var target=button.getAttribute('data-view');
        if(currentViewName()==='entry'&&target!=='entry'&&quickEntryDirty())event.stopPropagation();
        if(await requestViewNavigation(target)){if(window.YTE_CLOSE_MOBILE_NAV)window.YTE_CLOSE_MOBILE_NAV()}
      })});
      setupProductionUiBindings();
      if($('headerUserSummary'))$('headerUserSummary').addEventListener('click',function(){setAccountMenu($('headerAccountMenu').hidden)});
      if($('navAdmin'))$('navAdmin').addEventListener('click',function(){setAccountMenu(false);showView('admin')});
      document.addEventListener('click',function(event){if($('headerAccountMenu')&&!$('headerAccountMenu').hidden&&!event.target.closest('#headerAccountMenu')&&!event.target.closest('#headerUserSummary'))setAccountMenu(false)});
      document.querySelectorAll('.admin-tab').forEach(function(tab){tab.addEventListener('click',function(){showAdminSection(tab.getAttribute('data-admin-tab'))})});
      $('btnAccount').onclick=function(){showView('auth')};$('btnTopLogout').onclick=function(){setAccountMenu(false);logout()};$('btnSync').onclick=function(){syncData(false)};$('btnApply').onclick=function(){syncData(false)};$('rangeType').onchange=function(){updateRangeFields()};$('contentFilter').onchange=function(){if(window.YTE_CANCEL_SEARCH_RESTORE)window.YTE_CANCEL_SEARCH_RESTORE();renderAll();};
      $('btnGoogleLogin').onclick=loginGoogle;
      if($('btnLoginClose'))$('btnLoginClose').onclick=function(){showView('dashboard')};
      if($('btnPreviewSummary'))$('btnPreviewSummary').onclick=previewSummaryReport;
      if($('summaryCards'))$('summaryCards').addEventListener('click',function(event){var button=event.target.closest('.summary-source-detail-btn');if(button)openSourceDetail(button.getAttribute('data-source-kind'),button.getAttribute('data-code')||'')});
      if($('sourceDetailClose'))$('sourceDetailClose').onclick=closeSourceDetail;if($('sourceDetailCloseBottom'))$('sourceDetailCloseBottom').onclick=closeSourceDetail;if($('sourceDetailLayer'))$('sourceDetailLayer').addEventListener('click',function(event){if(event.target===$('sourceDetailLayer'))closeSourceDetail()});if($('sourceDetailOpenReports'))$('sourceDetailOpenReports').onclick=function(){closeSourceDetail();showView('journey')};
      if($('personDetailClose'))$('personDetailClose').onclick=closePersonManager;if($('personDetailCloseBottom'))$('personDetailCloseBottom').onclick=closePersonManager;if($('personDetailLayer'))$('personDetailLayer').addEventListener('click',function(event){if(event.target===$('personDetailLayer'))closePersonManager()});
      if($('personDetailForm'))$('personDetailForm').addEventListener('submit',savePersonManagerEntry);if($('personDetailNew'))$('personDetailNew').onclick=function(){resetPersonManagerForm();$('personDetailName').focus()};if($('personDetailReset'))$('personDetailReset').onclick=resetPersonManagerForm;
      if($('personDetailName'))$('personDetailName').addEventListener('blur',function(){this.value=formatPersonName(this.value)});
      if($('personDetailList'))$('personDetailList').addEventListener('click',function(event){var button=event.target.closest('.person-detail-action');if(!button)return;var kind=button.getAttribute('data-kind'),id=button.getAttribute('data-id');if(kind==='edit')editPersonManagerEntry(id);if(kind==='delete')deletePersonManagerEntry(id)});
      $('confirmAccept').onclick=function(){closeConfirm(true)};$('confirmCancel').onclick=function(){closeConfirm(false)};$('confirmLayer').addEventListener('click',function(event){if(event.target===$('confirmLayer'))closeConfirm(false)});
      $('adjustCancel').onclick=closeAdjustDialog;$('adjustSave').onclick=submitAdjustment;$('adjustLayer').addEventListener('click',function(event){if(event.target===$('adjustLayer'))closeAdjustDialog()});
      $('dataHistoryClose').onclick=closeDataHistoryDialog;$('dataHistoryFooterClose').onclick=closeDataHistoryDialog;$('dataHistoryLayer').addEventListener('click',function(event){if(event.target===$('dataHistoryLayer'))closeDataHistoryDialog()});$('deleteDailyCancel').onclick=closeDeleteDailyDialog;$('deleteDailyAccept').onclick=submitDeleteDaily;$('deleteDailyLayer').addEventListener('click',function(event){if(event.target===$('deleteDailyLayer'))closeDeleteDailyDialog()});
      $('categoryCancel').onclick=closeCategoryDialog;$('categorySave').onclick=submitCategory;$('categoryLayer').addEventListener('click',function(event){if(event.target===$('categoryLayer'))closeCategoryDialog()});
      document.addEventListener('keydown',function(event){if(event.key!=='Escape')return;setAccountMenu(false);if($('personDetailLayer')&&!$('personDetailLayer').hidden)closePersonManager();else if($('sourceDetailLayer')&&!$('sourceDetailLayer').hidden)closeSourceDetail();else if(!$('deleteDailyLayer').hidden)closeDeleteDailyDialog();else if(!$('dataHistoryLayer').hidden)closeDataHistoryDialog();else if(!$('confirmLayer').hidden)closeConfirm(false);else if(!$('adjustLayer').hidden)closeAdjustDialog();else if(!$('categoryLayer').hidden)closeCategoryDialog()});
      window.addEventListener('beforeunload',function(event){if(!quickEntryDirty())return;event.preventDefault();event.returnValue=''});
      $('btnLoadDay').onclick=manualReloadDay;$('entryDate').onchange=handleEntryDateChange;
      $('entryCategorySelect').onchange=async function(){
        var previous=String(state.lastQuickEntryCode||''),next=this.value;
        var oldCategory=state.categories.find(function(c){return c.code===previous});
        if(previous&&next!==previous&&oldCategory&&!oldCategory.derivedKind&&!oldCategory.personDetailKind){
          var oldNote=isTrainingCategory(oldCategory)?String($('entryTrainingContent').value||''):'';
          var draft=previous+'|'+String($('entryQuickValue').value||'')+'|'+oldNote;
          if(draft!==state.quickEntryBaseline){
            var discarded=await confirmAction({title:'Đổi chỉ tiêu nhập liệu?',message:'Bạn đang nhập số liệu chưa lưu. Bạn có muốn bỏ phần đang nhập để chọn chỉ tiêu khác?',confirmText:'Bỏ phần đang nhập',cancelText:'Tiếp tục nhập',danger:true});
            if(!discarded){this.value=previous;return;}
          }
        }
        updateQuickEntrySelection(true);
      };$('btnSaveQuickEntry').onclick=submitQuickEntry;$('btnEntrySelectedAdjust').onclick=function(){var code=$('entryCategorySelect').value,category=state.categories.find(function(item){return item.code===code});if(!code)return;if(category&&category.derivedKind)openDerivedSource(code);else if(category&&category.personDetailKind)openPersonManager(code);else openAdjustDialog(code)};$('btnEntrySelectedDelete').onclick=function(){var code=$('entryCategorySelect').value,category=state.categories.find(function(item){return item.code===code});if(code&&!(category&&category.derivedKind))openDeleteDailyDialog(code)};$('btnEntrySelectedHistory').onclick=function(){var code=$('entryCategorySelect').value,category=state.categories.find(function(item){return item.code===code});if(!code)return;if(category&&category.derivedKind)openDerivedSource(code);else openDataHistoryDialog(code)};$('entryQuickValue').addEventListener('input',function(){if($('entryQuickError'))$('entryQuickError').textContent=''});if($('entryTrainingContent'))$('entryTrainingContent').addEventListener('input',function(){if($('entryQuickError'))$('entryQuickError').textContent=''});$('entryQuickValue').addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();submitQuickEntry()}});
      $('btnReloadUsers').onclick=function(){loadAdminUsers(true)};$('adminSearch').oninput=renderAdminUsers;if($('adminStatusFilter'))$('adminStatusFilter').onchange=renderAdminUsers;$('adminUsers').addEventListener('click',function(event){var button=event.target.closest('.admin-action');if(!button)return;var kind=button.getAttribute('data-kind'),id=button.getAttribute('data-id'),value=button.getAttribute('data-value'),card=button.closest('.admin-account-card');if(kind==='display-name'){openDisplayNameDialog(id);return}if(kind==='approve-selected'){var select=card&&card.querySelector('.admin-role-select');if(select)approveRegistration(id,select.value);return}if(kind==='save-role'){var roleSelect=card&&card.querySelector('.admin-role-select');if(roleSelect)adminRole(id,roleSelect.value);return}if(kind==='status')adminStatus(id,value);if(kind==='role')adminRole(id,value);if(kind==='approve-viewer')approveRegistration(id,'Xem');if(kind==='approve-entry')approveRegistration(id,'Nhập liệu');if(kind==='approve-admin')approveRegistration(id,'Quản trị');if(kind==='reject-registration')rejectRegistration(id);if(kind==='revoke')adminRevoke(id);if(kind==='delete')adminDelete(id)});
      $('displayNameCancel').onclick=closeDisplayNameDialog;$('displayNameCloseX').onclick=closeDisplayNameDialog;$('displayNameSave').onclick=saveDisplayName;$('displayNameLayer').addEventListener('click',function(event){if(event.target===$('displayNameLayer'))closeDisplayNameDialog()});
      if($('displayNameInput'))$('displayNameInput').addEventListener('blur',function(){this.value=formatPersonName(this.value)});
      $('btnAddCategory').onclick=function(){openCategoryDialog('')};$('btnReloadCategories').onclick=function(){loadAdminCategories(true)};$('categorySearch').oninput=renderAdminCategories;$('adminCategories').addEventListener('click',function(event){var button=event.target.closest('.category-action');if(!button)return;var kind=button.getAttribute('data-kind'),code=button.getAttribute('data-code'),value=button.getAttribute('data-value');if(kind==='edit')openCategoryDialog(code);if(kind==='status')setCategoryStatus(code,value)});
      document.addEventListener('visibilitychange',function(){if(!document.hidden&&Date.now()-state.lastSyncAt>90000)syncData(true)});window.addEventListener('focus',function(){if(Date.now()-state.lastSyncAt>90000)syncData(true)});
      // Public Dashboard phải có thể khởi động và nhận realtime độc lập với việc Firebase Auth
      // đang khôi phục session. Không await restore() ở startup để tránh khóa toàn bộ UI.
      startCategoryRealtime();startDashboardRealtime(false);updateAuthUi();
      onAuthStateChanged(firebaseAuth,function(user){if(!user&&state.authUser){stopOwnPermissionRealtime();stopAdminRealtime();stopPersonManagerRealtime();stopSourceDetailRealtime();state.authUser=null;state.user=null;state.reportPermission=null;updateAuthUi()}});
      Promise.resolve(restore()).catch(function(error){console.warn('Khôi phục phiên đăng nhập:',error)});
      Promise.resolve(syncData(false)).catch(function(error){console.warn('Đồng bộ Tổng quan ban đầu:',error)});
      state.syncTimer=setInterval(function(){if(!document.hidden)syncData(true)},AUTO_SYNC_MS);
    }

    function startUi(){
      initializeUi().catch(function(error){
        console.error('Khởi tạo ứng dụng thất bại:', error);
        var box=document.getElementById('message');
        if(box){box.innerHTML='<div class="message err">Không thể khởi tạo ứng dụng. Vui lòng tải lại trang. Nếu lỗi vẫn còn, mở F12 → Console và gửi nội dung lỗi cho quản trị viên.</div>';}
      });
    }

    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded',startUi,{once:true});
    }else{
      startUi();
    }
