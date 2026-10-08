'use strict';
const $ = (id) => document.getElementById(id);
const state = { config: null, credential: '', user: null, tasks: [], defaultTime: '07:30', editingId: null, onesignal: null, busy: false, sessionEpoch: 0 };
const VN = 'vi-VN';
function pad2(n) { return String(n).padStart(2, '0'); }
function vnDate(d) { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; }
function dateOffset(iso, daysBefore) {
  const [year, month, day] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day - daysBefore));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth()+1)}-${pad2(dt.getUTCDate())}`;
}
function nowVNDate() {
  const v = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  // Intl's locale may format as yyyy-mm-dd on modern engines
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
function preview() {
  const date = $('dueDate').value, time = $('taskTime').value;
  if (!date || !time) return $('datePreview').textContent = 'Chọn ngày và giờ để xem 4 lượt nhắc.';
  const days = [3, 2, 1, 0].map(n => vnDate(dateOffset(date, n)));
  $('datePreview').textContent = `Nhận thông báo lúc ${time} trong các ngày ${days.join(' • ')} (giờ Việt Nam). Bao gồm cuối tuần và lễ, Tết.`;
}
function makeButton(label, title, handler) {
  const b = document.createElement('button'); b.type='button'; b.textContent=label; b.title=title;
  b.addEventListener('click', handler); return b;
}
function renderTasks() {
  const tasks = [...state.tasks].sort((a,b) => a.dueDate.localeCompare(b.dueDate) || a.time.localeCompare(b.time));
  $('taskCount').textContent = tasks.filter(t=>t.dueDate >= nowVNDate()).length;
  const box = $('taskList'); box.replaceChildren();
  if (!tasks.length) { const e=document.createElement('div');e.className='empty';e.textContent='Bạn chưa đăng ký công việc. Hãy thêm lịch nhắc đầu tiên.';box.appendChild(e);return; }
  for (const t of tasks) {
    const item=document.createElement('article');item.className='task';
    const main=document.createElement('div'); main.style.minWidth='0';
    const h=document.createElement('h3');h.textContent=t.title;
    const meta=document.createElement('div');meta.className='task-meta';
    const d=document.createElement('span');d.textContent='📅 Hạn '+vnDate(t.dueDate);
    const tm=document.createElement('span');tm.textContent='⏰ '+t.time;
    const badge=document.createElement('span');badge.className='pill';
    if(t.dueDate < nowVNDate()) {badge.classList.add('done');badge.textContent='Đã qua hạn';}
    else if (t.pending > 0) {badge.classList.add('warn');badge.textContent='Đang xếp lịch';}
    else {badge.classList.add('ok');badge.textContent='Đã đăng ký';}
    meta.append(d,tm,badge);main.append(h,meta);
    if (t.warning) {const warn=document.createElement('p');warn.style.margin='10px 0 0';warn.textContent='⚠ '+t.warning;main.appendChild(warn);}
    const actions=document.createElement('div');actions.className='task-actions';
    actions.append(makeButton('✎','Sửa',()=>edit(t)),makeButton('✕','Xóa',()=>remove(t)));
    item.append(main,actions);box.appendChild(item);
  }
}
function edit(t) {
  state.editingId=t.id; $('taskTitle').value=t.title; $('dueDate').value=t.dueDate; $('taskTime').value=t.time;
  $('formHeading').textContent='Sửa công việc'; $('saveTask').textContent='Lưu thay đổi'; $('cancelEdit').classList.remove('hide');
  preview(); document.querySelector('.form-panel').scrollIntoView({behavior:'smooth',block:'start'});
}
function resetForm() {
  state.editingId=null; $('taskForm').reset(); $('dueDate').min=nowVNDate(); $('taskTime').value=state.defaultTime;
  $('formHeading').textContent='Thêm công việc'; $('saveTask').textContent='＋ Lưu lịch nhắc';
  $('cancelEdit').classList.add('hide');preview();
}
function updateData(data) {
  if(Array.isArray(data.tasks)) state.tasks=data.tasks;
  if(typeof data.defaultTime==='string') state.defaultTime=data.defaultTime;
  $('defaultTime').value=state.defaultTime;
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
    updateData(data);resetForm();notify(data.notice || 'Đã lưu công việc và chuẩn bị lịch nhắc.');
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
  $('pushStatus').textContent=enabled?'Thiết bị này đã bật thông báo':'Thiết bị này chưa bật thông báo';
  $('pushDetail').textContent=enabled?'Có thể nhận thông báo ngay cả khi đóng ứng dụng.':
    'Hãy cho phép web push. Trên iPhone cần thêm ứng dụng vào Màn hình chính.';
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
    $('displayName').textContent=(data.name||data.email||'bạn').split(' ')[0]||'bạn';
    $('accountEmail').textContent=data.email;
    updateData(data);
    $('loginView').classList.add('hide');$('appView').classList.remove('hide');$('signoutBtn').classList.remove('hide');
    resetForm();
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
