'use strict';
const $ = id => document.getElementById(id);
const state = {
  config:null,credential:'',user:null,tasks:[],defaultTime:'07:30',editingId:null,
  onesignal:null,busy:false,pushBusy:false,signingOut:false,sessionEpoch:0,filter:'all'
};
let sdkPromise=null;
let identityQueue=Promise.resolve();
let activeMobilePane='list';
const PANE_IDS={create:'createPane',list:'listPane',schedule:'schedulePane',notifications:'notificationsPane',profile:'profilePane'};
const NAV_IDS={list:'tabList',schedule:'tabSchedule',notifications:'tabNotifications',profile:'tabProfile'};
function pad2(n){return String(n).padStart(2,'0');}
function vnDate(d){const [y,m,day]=d.split('-');return `${day}/${m}/${y}`;}
function dateOffset(iso,daysBefore){
  const [y,m,d]=iso.split('-').map(Number),dt=new Date(Date.UTC(y,m-1,d-daysBefore));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth()+1)}-${pad2(dt.getUTCDate())}`;
}
function nowVNDate(){
  const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;
}
function dayDiff(date){return Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(nowVNDate()+'T00:00:00Z'))/86400000);}
function notify(message,error=false){
  const el=$('toast');el.textContent=message;el.classList.toggle('error',error);el.classList.remove('hide');
  clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.classList.add('hide'),5000);
}
function setBusy(on,which=''){
  state.busy=on;
  $('saveTask').disabled=on;$('saveDefaultTime').disabled=on;
  $('reloadBtn').disabled=on;$('signoutBtn').disabled=on;
  $('profileSignout').disabled=on;
  $('saveTask').textContent=on?'Đang lưu…':(state.editingId?'Cập nhật':'Lưu công việc');
  document.querySelectorAll('.task-actions button').forEach(b=>b.disabled=on);
  if(which==='reload')$('reloadBtn').textContent=on?'Đang tải…':'↻ Làm mới';
}
async function api(action,data={}){
  if(!state.credential)throw new Error('Bạn chưa đăng nhập Google.');
  const epoch=state.sessionEpoch,credential=state.credential;
  const r=await fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({credential,action,data}),cache:'no-store'});
  const json=await r.json().catch(()=>({error:'Máy chủ trả về dữ liệu không hợp lệ.'}));
  if(epoch!==state.sessionEpoch)throw new Error('Phiên đăng nhập đã thay đổi.');
  if(!r.ok||!json.ok)throw new Error(json.error||'Không thể xử lý yêu cầu.');
  return json;
}
function showPane(name,scroll=false){
  activeMobilePane=PANE_IDS[name]?name:'list';
  $('appView').dataset.pane=activeMobilePane;
  Object.entries(PANE_IDS).forEach(([n,id])=>$(id).classList.toggle('is-mobile-active',activeMobilePane===n));
  Object.entries(NAV_IDS).forEach(([n,id])=>{
    const button=$(id),selected=n===activeMobilePane;
    button.classList.toggle('is-active',selected);
    if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  $('tabCreate').classList.toggle('hide',activeMobilePane==='create');
  if(scroll&&window.matchMedia('(max-width:720px)').matches)window.scrollTo({top:0,behavior:'auto'});
}
function preview(){
  const date=$('dueDate').value,time=$('taskTime').value,box=$('datePreview');box.replaceChildren();
  box.classList.toggle('has-dates',Boolean(date&&time));
  if(!date||!time){box.textContent='Chọn ngày và giờ để xem lịch nhắc.';return;}
  for(const [offset,label] of [[3,'Trước 3 ngày'],[2,'Trước 2 ngày'],[1,'Trước 1 ngày'],[0,'Đúng hạn']]){
    const item=document.createElement('div');item.className='preview-chip';
    if(offset===0)item.classList.add('is-today');
    const cap=document.createElement('span');cap.textContent=label;
    const day=document.createElement('strong');day.textContent=vnDate(dateOffset(date,offset)).slice(0,5);
    day.title=vnDate(dateOffset(date,offset))+' · '+time;
    item.append(cap,day);box.appendChild(item);
  }
}
function makeButton(label,title,handler,cls=''){
  const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;
  b.className=cls;b.setAttribute('aria-label',title);b.addEventListener('click',handler);return b;
}
function taskStatus(t){
  const days=dayDiff(t.dueDate);
  if(days<0)return {label:'Đã quá hạn',cls:'done'};
  if(t.warning)return {label:'Cần kiểm tra lịch',cls:'warn'};
  if(t.pending>0)return {label:'Đang xếp lịch',cls:'warn'};
  return {label:days===0?'Đến hạn hôm nay':days===1?'Còn 1 ngày':`Còn ${days} ngày`,cls:days<=3?'soon':'ok'};
}
function visibleTasks(){
  return [...state.tasks].filter(t=>{
    const days=dayDiff(t.dueDate);
    return state.filter==='all'||(state.filter==='soon'&&days>=0&&days<=3)||(state.filter==='past'&&days<0);
  }).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.time.localeCompare(b.time));
}
function renderTasks(){
  const count=state.tasks.filter(t=>dayDiff(t.dueDate)>=0).length;
  $('taskCount').textContent=count;$('mobileCount').textContent=state.tasks.length;
  const box=$('taskList');box.replaceChildren();
  const tasks=visibleTasks();
  if(!tasks.length){
    const empty=document.createElement('div');empty.className='empty';
    const txt=document.createElement('span');txt.textContent=state.filter==='all'?'Bạn chưa có công việc nào.':'Không có công việc trong nhóm này.';
    empty.append(txt);
    if(state.filter==='all')empty.append(makeButton('＋ Thêm công việc','Thêm công việc',()=>{resetForm();showPane('create',true);},'empty-add'));
    box.append(empty);return;
  }
  for(const t of tasks){
    const item=document.createElement('article');item.className='task';
    const main=document.createElement('div');main.className='task-content';
    const title=document.createElement('h3');title.textContent=t.title;
    const meta=document.createElement('div');meta.className='task-meta';
    const day=document.createElement('span');day.className='date';day.textContent='▦ '+vnDate(t.dueDate);
    const time=document.createElement('span');time.className='time';time.textContent='◷ '+t.time;
    const st=taskStatus(t),badge=document.createElement('span');badge.className='pill '+st.cls;badge.textContent=st.label;
    meta.append(day,time,badge);main.append(title,meta);
    if(t.warning){const w=document.createElement('p');w.className='task-warning';w.textContent='⚠ '+t.warning;main.append(w);}
    const actions=document.createElement('div');actions.className='task-actions';
    actions.append(
      makeButton('✎ Sửa','Sửa công việc '+t.title,()=>edit(t),'edit-action'),
      makeButton('Xóa','Xóa công việc '+t.title,()=>remove(t),'delete-btn desktop-delete'),
      makeButton('⋯','Tùy chọn sửa hoặc xóa '+t.title,()=>openTaskMenu(t),'more-action')
    );
    item.append(main,actions);box.append(item);
  }
}
function renderSchedule(){
  const box=$('scheduleList');box.replaceChildren();
  const tasks=[...state.tasks].sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  if(!tasks.length){box.textContent='Chưa có lịch nhắc. Vui lòng đăng ký công việc trước.';return;}
  for(const t of tasks){
    const card=document.createElement('article');card.className='schedule-card';
    const title=document.createElement('h3');title.textContent=t.title;
    const sub=document.createElement('p');sub.textContent='Hạn '+vnDate(t.dueDate)+' · '+t.time;
    card.append(title,sub);
    for(const [off,label] of [[3,'Trước 3 ngày'],[2,'Trước 2 ngày'],[1,'Trước 1 ngày'],[0,'Đúng hạn']]){
      const row=document.createElement('div');row.className='schedule-row';
      const l=document.createElement('span');l.textContent='🔔 '+label;
      const r=document.createElement('span');const when=dateOffset(t.dueDate,off);
      r.textContent=vnDate(when)+' · '+t.time+(when<nowVNDate()?' · Đã qua':'');
      row.append(l,r);card.append(row);
    }
    box.append(card);
  }
}
function edit(t){
  if(state.busy)return;
  state.editingId=t.id;$('taskTitle').value=t.title;$('dueDate').value=t.dueDate;
  $('dueDate').min=''; // Previously registered due dates are visible; server validates on save.
  $('taskTime').value=t.time;$('formHeading').textContent='Sửa công việc';
  $('saveTask').textContent='Cập nhật';$('cancelEdit').classList.remove('hide');
  showPane('create',true);preview();
}
function resetForm(){
  state.editingId=null;$('taskForm').reset();$('dueDate').min=nowVNDate();
  $('taskTime').value=state.defaultTime;$('formHeading').textContent='Thêm công việc';
  $('saveTask').textContent='Lưu công việc';$('cancelEdit').classList.add('hide');preview();
}
function updateData(data){
  if(Array.isArray(data.tasks))state.tasks=data.tasks;
  if(typeof data.defaultTime==='string')state.defaultTime=data.defaultTime;
  $('defaultTime').value=state.defaultTime;$('defaultTimeLabel').textContent=state.defaultTime;
  renderTasks();renderSchedule();
  $('notificationSummary').textContent=`Đang theo dõi ${state.tasks.filter(t=>dayDiff(t.dueDate)>=0).length} công việc chưa quá hạn.`;
}
async function refresh(){
  if(state.busy)return;setBusy(true,'reload');
  try{updateData(await api('load'));notify('Đã cập nhật danh sách công việc.');}
  catch(err){notify(err.message,true);}finally{setBusy(false,'reload');}
}
async function saveTask(ev){
  ev.preventDefault();if(state.busy)return;
  const title=$('taskTitle').value.trim(),dueDate=$('dueDate').value,time=$('taskTime').value;
  if(!title||!dueDate||!time){notify('Hãy nhập tên, ngày đến hạn và giờ nhắc.',true);return;}
  setBusy(true);
  try{
    const data=await api('save',{id:state.editingId||'',title,dueDate,time});
    updateData(data);resetForm();showPane('list',true);
    notify(data.notice||'Đã lưu. Nếu lịch đang xếp, hệ thống sẽ tiếp tục đồng bộ.');
  }catch(err){notify(err.message+' Nếu yêu cầu hết thời gian chờ, bấm Làm mới để kiểm tra trước khi lưu lại.',true);}
  finally{setBusy(false);}
}
function openTaskMenu(t){
  if(state.busy)return;
  $('taskMenuTitle').textContent=t.title;
  $('taskMenuMeta').textContent=vnDate(t.dueDate)+' · '+t.time;
  $('menuEdit').onclick=()=>{$('taskMenu').close();edit(t);};
  $('menuDelete').onclick=()=>{$('taskMenu').close();remove(t);};
  $('taskMenu').showModal();
}
async function remove(t){
  if(state.busy)return;
  $('confirmText').textContent=`Xóa “${t.title}” và yêu cầu hủy các lượt nhắc chưa gửi?`;
  const dialog=$('confirmDialog');
  dialog.showModal();
  dialog.addEventListener('close',async function onClose(){
    dialog.removeEventListener('close',onClose);
    if(dialog.returnValue!=='confirm'||state.busy)return;
    setBusy(true);
    try{
      const data=await api('remove',{id:t.id});updateData(data);
      if(state.editingId===t.id)resetForm();notify(data.notice||'Đã xóa công việc.');
    }catch(err){notify(err.message+' Hãy Làm mới để kiểm tra trước khi xóa lại.',true);}
    finally{setBusy(false);}
  },{once:true});
}
async function saveDefaultTime(){
  if(state.busy)return;
  if(state.defaultTime===$('defaultTime').value){notify('Giờ mặc định không thay đổi.');return;}
  setBusy(true);
  try{
    const result=await api('setDefaultTime',{time:$('defaultTime').value});updateData(result);
    if(!state.editingId)$('taskTime').value=state.defaultTime;
    preview();notify('Đã lưu giờ mặc định.');
  }catch(err){notify(err.message,true);}finally{setBusy(false);}
}
function pushState(){
  const o=state.onesignal,enabled=Boolean(o&&o.Notifications.permission&&o.User.PushSubscription.optedIn&&o.User.PushSubscription.id);
  $('pushDot').className='status-dot '+(enabled?'on':'off');
  $('pushStatus').textContent=enabled?'Thông báo đã bật':'Chưa bật thông báo';
  $('pushDetail').textContent=enabled?'Thiết bị đã đăng ký nhận thông báo.':'iPhone: mở từ biểu tượng ở Màn hình chính để cấp quyền.';
  $('enablePush').textContent=enabled?'Kiểm tra lại':'Bật thông báo';
}
function sdk(){
  if(sdkPromise)return sdkPromise;
  sdkPromise=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('OneSignal tải quá lâu. Vui lòng mở lại ứng dụng để thử lại.')),15000);
    const resolved=o=>{clearTimeout(timeout);resolve(o);};
    const failed=err=>{clearTimeout(timeout);reject(err);};
    window.OneSignalDeferred=window.OneSignalDeferred||[];
    window.OneSignalDeferred.push(async o=>{
      try{
        await o.init({appId:state.config.oneSignalAppId,serviceWorkerPath:'/OneSignalSDKWorker.js',serviceWorkerParam:{scope:'/'}});
        state.onesignal=o;
        o.Notifications.addEventListener('permissionChange',pushState);
        o.User.PushSubscription.addEventListener('change',pushState);
        resolved(o);
      }catch(err){failed(err);}
    });
  });
  return sdkPromise;
}
function queueIdentity(op){
  identityQueue=identityQueue.catch(()=>{}).then(op);
  return identityQueue;
}
async function initPush(externalId){
  const epoch=state.sessionEpoch;
  try{
    await queueIdentity(async()=>{
      const o=await sdk();
      if(epoch!==state.sessionEpoch||!state.user)return;
      await o.login(externalId);
      if(epoch!==state.sessionEpoch||!state.user)await o.logout();
      else pushState();
    });
  }catch(err){
    $('pushStatus').textContent='Chưa kết nối được OneSignal';
    $('pushDetail').textContent=String(err.message||err);
    $('pushDot').className='status-dot off';
  }
}
async function enablePush(){
  if(state.pushBusy||!state.user||state.signingOut)return;
  state.pushBusy=true;
  $('enablePush').disabled=true;$('enablePushAlt').disabled=true;
  $('enablePush').textContent='Đang kiểm tra…';
  const epoch=state.sessionEpoch;
  try{
    await initPush(state.user.externalId);
    if(epoch!==state.sessionEpoch)throw new Error('Phiên đăng nhập đã thay đổi.');
    const o=state.onesignal;if(!o)throw new Error('OneSignal chưa sẵn sàng. Vui lòng mở lại ứng dụng.');
    if(!o.Notifications.isPushSupported())throw new Error('Thiết bị/trình duyệt chưa hỗ trợ web push. iPhone cần iOS 16.4+ và ứng dụng cài ra Màn hình chính.');
    if(!o.Notifications.permission)await o.Notifications.requestPermission();
    if(o.Notifications.permission&&!o.User.PushSubscription.optedIn)await o.User.PushSubscription.optIn();
    pushState();
    if(o.Notifications.permission&&o.User.PushSubscription.optedIn){
      // Only a direct tap triggers this explicit recheck. No polling or fixed delay.
      const response=await api('sync');updateData(response);
      notify('Đã yêu cầu kiểm tra lại lịch nhắc.');
    }else notify('Thiết bị chưa cấp quyền nhận thông báo.',true);
  }catch(err){notify(err.message,true);}finally{
    state.pushBusy=false;$('enablePush').disabled=false;$('enablePushAlt').disabled=false;pushState();
  }
}
async function signedIn(response){
  if(state.busy||state.signingOut||state.user)return;
  const epoch=++state.sessionEpoch;state.credential=response.credential;setBusy(true);
  $('loginHint').textContent='Đang kiểm tra quyền sử dụng…';
  try{
    const data=await api('load');
    if(epoch!==state.sessionEpoch)return;
    state.user={email:data.email,name:data.name,externalId:data.externalId};
    const name=(data.name||data.email||'bạn').trim();
    $('displayName').textContent=name;$('accountEmail').textContent=data.email;
    $('profileName').textContent=name;$('profileEmail').textContent=data.email;
    const initials=name.split(/\s+/).slice(-2).map(s=>s[0]||'').join('').toUpperCase();
    $('profileAvatar').textContent=initials||'NV';
    updateData(data);$('loginView').classList.add('hide');$('appView').classList.remove('hide');
    $('signoutBtn').classList.remove('hide');resetForm();showPane('list');
    // Asynchronous login; never block the task list while SDK loads.
    void initPush(data.externalId);
  }catch(err){state.credential='';$('loginHint').textContent=err.message;notify(err.message,true);}
  finally{setBusy(false);}
}
async function signout(){
  if(state.busy||state.signingOut)return;
  state.signingOut=true;state.sessionEpoch++;setBusy(true);
  try{
    // Serialize with an in-progress OneSignal.login to prevent cross-account binding.
    await queueIdentity(async()=>{if(sdkPromise){const o=await sdk();await o.logout();}});
  }catch(err){notify('Chưa thể ngắt OneSignal khỏi thiết bị. Hãy kiểm tra trạng thái thông báo trước khi dùng tài khoản khác.',true);}
  if(window.google?.accounts?.id)window.google.accounts.id.disableAutoSelect();
  state.credential='';state.user=null;state.tasks=[];state.editingId=null;
  $('appView').classList.add('hide');$('signoutBtn').classList.add('hide');$('loginView').classList.remove('hide');
  $('loginHint').textContent='Bạn đã đăng xuất. Đăng nhập lại để quản lý công việc.';
  state.signingOut=false;setBusy(false);
}
function openDefaultSettings(){showPane('create',true);$('defaultSettings').open=true;}
function setFilter(name){
  state.filter=name;document.querySelectorAll('[data-filter]').forEach(button=>{
    const selected=button.dataset.filter===name;button.classList.toggle('is-active',selected);
    button.setAttribute('aria-pressed',String(selected));
  });renderTasks();
}
async function start(){
  Object.entries(NAV_IDS).forEach(([pane,id])=>$(id).addEventListener('click',()=>showPane(pane,true)));
  $('tabCreate').addEventListener('click',()=>{resetForm();showPane('create',true);});
  $('taskForm').addEventListener('submit',saveTask);
  $('dueDate').addEventListener('change',preview);$('taskTime').addEventListener('change',preview);
  $('cancelEdit').addEventListener('click',()=>{resetForm();showPane('list',true);});
  $('backToList').addEventListener('click',()=>{resetForm();showPane('list',true);});
  $('formCancel').addEventListener('click',()=>{resetForm();showPane('list',true);});
  $('reloadBtn').addEventListener('click',refresh);
  $('saveDefaultTime').addEventListener('click',saveDefaultTime);
  $('enablePush').addEventListener('click',enablePush);
  $('enablePushAlt').addEventListener('click',enablePush);
  $('signoutBtn').addEventListener('click',signout);$('profileSignout').addEventListener('click',signout);
  $('profileDefaultTime').addEventListener('click',openDefaultSettings);
  $('profilePush').addEventListener('click',()=>showPane('notifications',true));
  $('menuClose').addEventListener('click',()=>$('taskMenu').close());
  document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>setFilter(button.dataset.filter)));
  resetForm();showPane('list');
  // Use the exact same OneSignal worker and scope for PWA install; never register a competing worker.
  if('serviceWorker' in navigator)window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/OneSignalSDKWorker.js',{scope:'/'}).catch(err=>console.warn('Service worker:',err.message));
  },{once:true});
  try{
    const response=await fetch('/api/config',{cache:'no-store'}),cfg=await response.json();
    if(!response.ok)throw new Error(cfg.error||'Chưa cài cấu hình Vercel.');
    state.config=cfg;
    for(let i=0;i<80&&!window.google?.accounts?.id;i++)await new Promise(resolve=>setTimeout(resolve,100));
    if(!window.google?.accounts?.id)throw new Error('Không tải được Google Login. Hãy kiểm tra kết nối mạng.');
    window.google.accounts.id.initialize({client_id:cfg.googleClientId,callback:signedIn,auto_select:false});
    window.google.accounts.id.renderButton($('googleButton'),{theme:'outline',size:'large',text:'signin_with',shape:'pill',width:300});
    $('loginHint').textContent='Chỉ dành cho tài khoản đã được cấp quyền.';
  }catch(err){$('loginHint').textContent=err.message;notify(err.message,true);}
}
start();
