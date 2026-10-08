'use strict';
const $ = (id) => document.getElementById(id);
const state = { config: null, credential: '', user: null, tasks: [], defaultTime: '07:30', editingId: null, onesignal: null, busy: false, sessionEpoch: 0 };
const VN = 'vi-VN';
let activeMobilePane = 'create';
function pad2(n) { return String(n).padStart(2, '0'); }
function vnDate(d) { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; }
function dateOffset(iso, daysBefore) {
  const [year, month, day] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day - daysBefore));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth()+1)}-${pad2(dt.getUTCDate())}`;
}
function nowVNDate() {
  const parts = new Intl.DateTimeFormat('en', {timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
}
function notify(message, error = false) {
  const el = $('toast'); el.textContent = message; el.classList.toggle('error', error); el.classList.remove('hide');
  clearTimeout(notify.timer); notify.timer = setTimeout(() => el.classList.add('hide'), 4800);
}
function busy(on) {
  state.busy = on;
  for (const id of ['saveTask','saveDefaultTime','reloadBtn','enablePush']) $(id).disabled = on;
  document.querySelectorAll('.task-actions button').forEach(b => b.disabled = on);
}
async function api(action, data = {}) {
  if (!state.credential) throw new Error('Bạn chưa đăng nhập Google.');
  const r = await fetch('/api/data', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({credential:state.credential, action, data}), cache:'no-store'
  });
  const json = await r.json().catch(() => ({error:'Máy chủ trả về dữ liệu không hợp lệ.'}));
  if (!r.ok || !json.ok) throw new Error(json.error || 'Không thể xử lý yêu cầu.');
  return json;
}
function showPane(name, scroll = false) {
  activeMobilePane = name === 'list' ? 'list' : 'create';
  const create = activeMobilePane === 'create';
  $('createPane').classList.toggle('is-mobile-active', create);
  $('listPane').classList.toggle('is-mobile-active', !create);
  $('tabCreate').classList.toggle('is-active', create);
  $('tabList').classList.toggle('is-active', !create);
  $('tabCreate').setAttribute('aria-pressed', String(create));
  $('tabList').setAttribute('aria-pressed', String(!create));
  if (scroll && window.matchMedia('(max-width: 720px)').matches) {
    document.querySelector('.mobile-nav').scrollIntoView({behavior:'smooth', block:'start'});
  }
}
function preview() {
  const date = $('dueDate').value, time = $('taskTime').value, box = $('datePreview');
  box.replaceChildren();
  box.classList.toggle('has-dates', Boolean(date && time));
  if (!date || !time) {
    box.textContent = 'Chọn ngày và giờ để xem các ngày nhắc.';
    return;
  }
  for (const [offset, label] of [[3,'Trước 3 ngày'],[2,'Trước 2 ngày'],[1,'Trước 1 ngày'],[0,'Đúng hạn']]) {
    const item = document.createElement('div'); item.className = 'preview-chip';
    if (offset === 0) item.classList.add('is-today');
    const cap = document.createElement('span'); cap.textContent = label;
    const day = document.createElement('strong');
    day.textContent = vnDate(dateOffset(date, offset)).slice(0,5);
    day.title = vnDate(dateOffset(date, offset)) + ' · ' + time;
    item.append(cap,day); box.appendChild(item);
  }
}
function makeButton(label, title, handler, className = '') {
  const b = document.createElement('button'); b.type = 'button';
  b.textContent = label; b.title = title; b.className = className;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', handler); return b;
}
function renderTasks() {
  const tasks = [...state.tasks].sort((a,b) => a.dueDate.localeCompare(b.dueDate) || a.time.localeCompare(b.time));
  const currentCount = tasks.filter(t => t.dueDate >= nowVNDate()).length;
  $('taskCount').textContent = currentCount;
  $('mobileCount').textContent = currentCount;
  const box = $('taskList'); box.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    const message = document.createElement('span'); message.textContent = 'Chưa có công việc nào.';
    const add = makeButton('＋ Thêm công việc', 'Thêm công việc đầu tiên', () => {
      resetForm(); showPane('create', true); $('taskTitle').focus();
    }, 'empty-add');
    empty.append(message,add); box.appendChild(empty); return;
  }
  for (const t of tasks) {
    const item = document.createElement('article'); item.className = 'task';
    const main = document.createElement('div'); main.className = 'task-content';
    const title = document.createElement('h3'); title.textContent = t.title;
    const meta = document.createElement('div'); meta.className = 'task-meta';
    const day = document.createElement('span'); day.className = 'date'; day.textContent = '📅 ' + vnDate(t.dueDate);
    const time = document.createElement('span'); time.className = 'time'; time.textContent = '⏰ ' + t.time;
    const badge = document.createElement('span'); badge.className = 'pill';
    if (t.dueDate < nowVNDate()) { badge.classList.add('done'); badge.textContent = 'Đã qua hạn'; }
    else if (t.pending > 0) { badge.classList.add('warn'); badge.textContent = 'Đang xếp lịch'; }
    else { badge.classList.add('ok'); badge.textContent = 'Đã lưu'; }
    meta.append(day,time,badge); main.append(title,meta);
    if (t.warning) {
      const warning = document.createElement('p'); warning.className = 'task-warning';
      warning.textContent = '⚠ ' + t.warning; main.appendChild(warning);
    }
    const actions = document.createElement('div'); actions.className = 'task-actions';
    actions.append(
      makeButton('Sửa', 'Sửa công việc ' + t.title, () => edit(t)),
      makeButton('Xóa', 'Xóa công việc ' + t.title, () => remove(t), 'delete-btn')
    );
    item.append(main,actions); box.appendChild(item);
  }
}
function edit(t) {
  state.editingId=t.id; $('taskTitle').value=t.title; $('dueDate').value=t.dueDate; $('taskTime').value=t.time;
  $('formHeading').textContent='Sửa công việc'; $('saveTask').textContent='Lưu thay đổi'; $('cancelEdit').classList.remove('hide');
  showPane('create', true); preview();
  if (!window.matchMedia('(max-width: 720px)').matches) document.querySelector('.form-panel').scrollIntoView({behavior:'smooth',block:'start'});
}
function resetForm() {
  state.editingId=null; $('taskForm').reset(); $('dueDate').min=nowVNDate(); $('taskTime').value=state.defaultTime;
  $('formHeading').textContent='Thêm công việc'; $('saveTask').textContent='＋ Lưu công việc';
  $('cancelEdit').classList.add('hide');preview();
}
function updateData(data) {
  if(Array.isArray(data.tasks)) state.tasks=data.tasks;
  if(typeof data.defaultTime==='string') state.defaultTime=data.defaultTime;
  $('defaultTime').value=state.defaultTime;
  $('defaultTimeLabel').textContent=state.defaultTime;
  renderTasks();
}
async function refresh() {
  busy(true);
  try {updateData(await api('load'));} catch(err) {notify(err.message,true);} finally {busy(false);}
}
async function saveTask(ev) {
  ev.preventDefault(); if(state.busy) return;
  const title=$('taskTitle').value.trim(),dueDate=$('dueDate').value,time=$('taskTime').value;
  if(!title||!dueDate||!time) return notify('Hãy nhập tên, ngày đến hạn và giờ nhắc.',true);
  busy(true);
  try {
    const data=await api('save',{id:state.editingId || '',title,dueDate,time});
    updateData(data);resetForm();showPane('list', true);notify(data.notice || 'Đã lưu công việc và chuẩn bị lịch nhắc.');
  } catch(err){notify(err.message,true);} finally {busy(false);}
}
async function remove(t) {
  $('confirmText').textContent=`Xóa công việc “${t.title}” và hủy các lượt nhắc chưa gửi?`;
  const dialog=$('confirmDialog'); dialog.showModal();
  dialog.addEventListener('close',async function handler(){
    dialog.removeEventListener('close',handler);
    if(dialog.returnValue!=='confirm'||state.busy) return;
    busy(true);
    try {const d=await api('remove',{id:t.id});updateData(d);if(state.editingId===t.id)resetForm();notify(d.notice||'Đã yêu cầu xóa lịch.');}
    catch(err){notify(err.message,true);}finally{busy(false);}
  });
}
async function saveDefaultTime() {
  busy(true);try{const r=await api('setDefaultTime',{time:$('defaultTime').value});updateData(r);if(!state.editingId)$('taskTime').value=state.defaultTime;preview();notify('Đã lưu giờ mặc định.');}
  catch(err){notify(err.message,true);}finally{busy(false);}
}
function pushState() {
  const o=state.onesignal;
  const enabled=!!(o && o.Notifications.permission && o.User.PushSubscription.optedIn && o.User.PushSubscription.id);
  $('pushDot').className='status-dot'+(enabled?' on':' off');
  $('pushStatus').textContent=enabled?'Thông báo đã bật':'Chưa bật thông báo';
  $('pushDetail').textContent=enabled?'Có thể nhận nhắc việc khi đóng ứng dụng.':
    'Nhấn Bật thông báo. iPhone: mở từ biểu tượng trên Màn hình chính.';
  $('enablePush').textContent=enabled?'Kiểm tra lại':'Bật thông báo';
}
async function initPush(externalId) {
  const epoch=state.sessionEpoch;
  try {
    if (!state.onesignal) {
      state.onesignal = await Promise.race([
        new Promise((resolve,reject) => {
          window.OneSignalDeferred=window.OneSignalDeferred || [];
          window.OneSignalDeferred.push(async (OneSignal) => {
            try {await OneSignal.init({appId:state.config.oneSignalAppId,serviceWorkerPath:'/OneSignalSDKWorker.js',serviceWorkerParam:{scope:'/'}});resolve(OneSignal);}
            catch(e){reject(e);}
          });
        }),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('OneSignal không tải được. Hãy kiểm tra trình duyệt, ad-block và cấu hình Site URL.')),18000))
      ]);
      state.onesignal.Notifications.addEventListener('permissionChange',pushState);
      state.onesignal.User.PushSubscription.addEventListener('change',pushState);
    }
    if(epoch!==state.sessionEpoch || !state.user) return;
    await state.onesignal.login(externalId);
    if(epoch!==state.sessionEpoch && !state.user){await state.onesignal.logout();return;}
    if(epoch===state.sessionEpoch)pushState();
  } catch(err) {
    $('pushStatus').textContent='Chưa kết nối được OneSignal';
    $('pushDetail').textContent=err.message||String(err);$('pushDot').className='status-dot off';
    notify('OneSignal: '+(err.message||String(err)),true);
  }
}
async function enablePush() {
  busy(true);
  try {
    if(!state.onesignal) await initPush(state.user.externalId);
    const o=state.onesignal;
    if(!o) throw new Error('OneSignal chưa sẵn sàng.');
    if(!o.Notifications.isPushSupported()) throw new Error('Trình duyệt này chưa hỗ trợ web push. iPhone: thêm web app ra Màn hình chính rồi mở từ đó.');
    if(!o.Notifications.permission) await o.Notifications.requestPermission();
    if(o.Notifications.permission && !o.User.PushSubscription.optedIn) await o.User.PushSubscription.optIn();
    await new Promise(resolve=>setTimeout(resolve,900));
    pushState();
    if(o.Notifications.permission && o.User.PushSubscription.optedIn) {
      const r=await api('sync');updateData(r);notify('Đã kích hoạt hoặc kiểm tra lại lịch thông báo.');
    } else notify('Chưa được cấp quyền thông báo trên thiết bị này.',true);
  }catch(err){notify(err.message,true);}finally{busy(false);}
}
async function signedIn(response) {
  if(state.busy) return;
  state.sessionEpoch++;state.credential=response.credential;busy(true);
  $('loginHint').textContent='Đang kiểm tra quyền sử dụng…';
  try {
    const data=await api('load');
    state.user={email:data.email,name:data.name,externalId:data.externalId};
    $('displayName').textContent=(data.name||data.email||'bạn').trim();
    $('accountEmail').textContent=data.email;
    updateData(data);
    $('loginView').classList.add('hide');$('appView').classList.remove('hide');$('signoutBtn').classList.remove('hide');
    resetForm(); showPane('create');
    // Không chặn giao diện khi OneSignal đang kết nối.
    void initPush(data.externalId);
  }catch(err){state.credential='';$('loginHint').textContent=err.message;notify(err.message,true);}
  finally{busy(false);}
}
async function signout() {
  if(state.busy)return;
  state.sessionEpoch++;
  try {if(state.onesignal)await state.onesignal.logout();}catch(e){console.warn('OneSignal logout:',e.message);}
  if(window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
  state.credential='';state.user=null;state.tasks=[];state.editingId=null;
  $('appView').classList.add('hide');$('signoutBtn').classList.add('hide');$('loginView').classList.remove('hide');
  $('loginHint').textContent='Bạn đã đăng xuất. Đăng nhập lại nếu muốn quản lý công việc.';
  // Không tắt quyền thông báo của trình duyệt; chỉ ngắt tài khoản khỏi thiết bị này.
}
async function start() {
  $('tabCreate').addEventListener('click', () => showPane('create', true));
  $('tabList').addEventListener('click', () => showPane('list', true));
  $('taskForm').addEventListener('submit',saveTask);
  $('dueDate').addEventListener('change',preview);$('taskTime').addEventListener('change',preview);
  $('cancelEdit').addEventListener('click',resetForm);$('reloadBtn').addEventListener('click',refresh);
  $('saveDefaultTime').addEventListener('click',saveDefaultTime);
  $('enablePush').addEventListener('click',enablePush);
  $('signoutBtn').addEventListener('click',signout);
  try {
    const r=await fetch('/api/config',{cache:'no-store'}), cfg=await r.json();
    if(!r.ok)throw new Error(cfg.error||'Chưa cài cấu hình Vercel.');
    state.config=cfg;
    const waitGoogle=async()=>{
      for(let i=0;i<80&&!window.google?.accounts?.id;i++)await new Promise(resolve=>setTimeout(resolve,100));
      if(!window.google?.accounts?.id)throw new Error('Không tải được Google Login. Hãy kiểm tra Internet hoặc tiện ích chặn quảng cáo.');
      window.google.accounts.id.initialize({client_id:cfg.googleClientId,callback:signedIn,auto_select:false});
      window.google.accounts.id.renderButton($('googleButton'),{theme:'outline',size:'large',text:'signin_with',shape:'pill',width:300});
      $('loginHint').textContent='Dùng tài khoản trong danh sách được quản trị viên cấp quyền.';
    };await waitGoogle();
  }catch(err){$('loginHint').textContent=err.message;notify(err.message,true);}
}
start();
