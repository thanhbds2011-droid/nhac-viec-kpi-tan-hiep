'use strict';
// Version 1.9.3: checking updates is separate from task/realtime revision.
const APP_VERSION='1.9.3-hf5';
let versionCheckTimer=null;
let versionPending='';
let versionUpdateInProgress=false;
function hasUnsavedUserWork(){
  if(state.busy||state.signingOut||state.editingId||pendingImport)return true;
  const title=$('taskTitle'),due=$('dueDate'),dialog=$('confirmDialog');
  return Boolean((title&&title.value.trim())||(due&&due.value)||
    (dialog&&dialog.hasAttribute('open'))||
    ($('importDialog')&&$('importDialog').hasAttribute('open')));
}
function applyPendingVersion(){
  if(!versionPending||versionUpdateInProgress||hasUnsavedUserWork())return false;
  versionUpdateInProgress=true;
  // Unique HTML URL prevents stale app-shell caches. Existing OneSignal worker is untouched.
  location.replace('/?appVersion='+encodeURIComponent(versionPending));
  return true;
}
async function checkAppVersion(){
  if(versionUpdateInProgress||document.hidden||!navigator.onLine)return;
  try{
    const res=await fetch('/api/config?versionCheck='+Date.now(),{cache:'no-store'});
    if(!res.ok)return;
    const cfg=await res.json(),next=String(cfg.appVersion||'');
    if(!next||next===APP_VERSION){versionPending='';return;}
    versionPending=next;
    if(!applyPendingVersion()&&!versionUpdateInProgress)
      notify('Có phiên bản mới. Hãy lưu hoặc hoàn tất thao tác đang làm; ứng dụng sẽ tự cập nhật.',false);
  }catch(_){/* Offline should not interrupt work or push notifications. */}
}
// YC-033: Safari/iOS versions before 14 may not implement replaceChildren.
// Every call in this application clears a container; do not introduce a dependency.
if(typeof Element!=='undefined'&&!Element.prototype.replaceChildren){
  Element.prototype.replaceChildren=function(){
    while(this.firstChild)this.removeChild(this.firstChild);
    for(const child of arguments)this.appendChild(typeof child==='string'?document.createTextNode(child):child);
  };
}
const $ = id => document.getElementById(id);
const state = {
  config:null,credential:'',user:null,tasks:[],defaultTime:'07:30',editingId:null,
  onesignal:null,pushError:'',pushBoundAccount:'',busy:false,pushBusy:false,signingOut:false,sessionEpoch:0,filter:'all',
  revision:0,inbox:[],deletedSourceKeys:[],isAdmin:false,managerConfigured:false,routingEnabled:false,assignments:[],realtime:null,realtimeAttached:false,broadcast:null,localRevisionKey:'',realtimeEpoch:0,lastVersionCheck:0,queuedChanges:[],checkingVersion:false,sessionToken:'',reconcileAfterBusy:false
};
let identityQueue=Promise.resolve();
let pushBindRetryTimer=null;
let pushBindRetryAttempt=0;
function clearPushBindRetry(){
  clearTimeout(pushBindRetryTimer);pushBindRetryTimer=null;pushBindRetryAttempt=0;
}
// Thử lại CHỈ liên kết định danh OneSignal, không tự xin quyền thông báo.
// Một session mới hủy toàn bộ lần retry của account cũ.
function bindPushForCurrentSession(externalId,epoch){
  void initPush(externalId).then(()=>{
    if(epoch===state.sessionEpoch&&state.user?.externalId===externalId){
      clearPushBindRetry();pushState();
    }
  }).catch(()=>{
    if(epoch!==state.sessionEpoch||state.user?.externalId!==externalId)return;
    const delays=[5000,15000,30000,60000];
    if(pushBindRetryAttempt>=delays.length)return;
    const delay=delays[pushBindRetryAttempt++];
    clearTimeout(pushBindRetryTimer);
    pushBindRetryTimer=setTimeout(()=>{
      if(epoch===state.sessionEpoch&&state.user?.externalId===externalId)
        bindPushForCurrentSession(externalId,epoch);
    },delay);
  });
}

let activeMobilePane='list';
const PANE_IDS={create:'createPane',list:'listPane',schedule:'schedulePane',notifications:'notificationsPane',profile:'profilePane',admin:'adminPane'};
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
  if(!state.credential&&!state.sessionToken)throw new Error('Bạn chưa đăng nhập Google.');
  const epoch=state.sessionEpoch,credential=state.credential;
  const r=await fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...(state.sessionToken?{sessionToken:state.sessionToken}:{credential}),action,data}),cache:'no-store'});
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
  $('tabCreate').classList.toggle('hide',activeMobilePane==='create'||activeMobilePane==='admin');
  if(activeMobilePane==='admin'&&state.isAdmin)void refreshAdmin();
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
  if(t._optimistic)return {label:'Đang lưu…',cls:'warn'};
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
  $('soonCount').textContent=state.tasks.filter(t=>{const d=dayDiff(t.dueDate);return d>=0&&d<=3;}).length;
  $('pastCount').textContent=state.tasks.filter(t=>dayDiff(t.dueDate)<0).length;
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
    const type=document.createElement('span');type.className='task-type-label';
    type.textContent=t.workType==='personal'?'Cá nhân':t.workType==='kpi'?'KPI':'Việc cũ';
    meta.append(day,time,type,badge);main.append(title,meta);
    if(t.assignmentKey){const assignment=state.assignments.find(a=>a.key===t.assignmentKey);
      if(assignment){const tag=document.createElement('small');tag.className='task-assignment-label';
        tag.textContent=assignment.unitName+' · '+assignment.label;main.append(tag);}}
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
function renderInbox(){
  const root=$('managerInbox');root.replaceChildren();
  $('inboxCount').textContent=String(state.inbox.length);
  $('appView').classList.toggle('has-inbox',state.inbox.length>0);
  $('headerNoticeDot').classList.toggle('hide',state.inbox.length===0);
  if(!state.inbox.length){root.textContent='Không có công việc nào của nhân viên đang chờ bạn xem xét.';return;}
  for(const notice of state.inbox){
    const el=document.createElement('article');el.className='inbox-item';
    const title=document.createElement('strong');title.textContent=notice.from+' đã hoàn thành công việc';
    const body=document.createElement('p');body.textContent=notice.title;
    if(notice.unitName){body.textContent=notice.title+' · '+notice.unitName;}
    const note=document.createElement('small');note.textContent='Vui lòng vào iCPV để xem xét, chấm điểm.';
    const del=makeButton('Xóa thông báo','Xóa thông báo đã xử lý',()=>void dismissNotification(notice.id),'small secondary');
    el.append(title,body,note,del);root.appendChild(el);
  }
}
async function dismissNotification(id){
  if(state.busy)return;
  await optimisticMutation('dismissNotification',{id},()=>{state.inbox=state.inbox.filter(n=>n.id!==id);});
}
async function refreshAdmin(){
  if(!state.isAdmin||!state.user)return;
  try{
    const r=await api('adminStats');if(!state.user||!state.isAdmin)return;
    const stats=r.adminStats;
    $('adminAccounts').textContent=String(stats.accounts);
    $('adminTasks').textContent=String(stats.totalCreated);
    $('adminNote').textContent=stats.note||'';
  }catch(err){$('adminNote').textContent='Chưa tải được số liệu. '+err.message;}
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
function renderAssignmentOptions(selected=''){
  const select=$('taskAssignment');select.replaceChildren();
  const prior=state.editingId&&state.tasks.find(t=>t.id===state.editingId);
  const historicalWithoutAssignment=!!(prior&&prior.legacyKpi&&!prior.assignmentKey);
  const needs=$('taskType').value==='kpi'&&state.routingEnabled&&!historicalWithoutAssignment;
  const multiple=state.assignments.length>1;
  $('assignmentField').classList.toggle('hide',!needs||!multiple);
  if(!needs)return;
  if(multiple){const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Chọn Phòng/Khu và chức vụ';select.append(placeholder);}
  for(const a of state.assignments){const option=document.createElement('option');option.value=a.key;
    option.textContent=a.unitName+' – '+a.label;select.append(option);}
  select.value=selected||(!multiple&&state.assignments.length===1?state.assignments[0].key:'');
}
function selectedAssignment(){
  const prior=state.editingId&&state.tasks.find(t=>t.id===state.editingId);
  if(prior&&prior.legacyKpi&&!prior.assignmentKey)return ''; // No migration to edit the due date.
  return $('taskType').value==='kpi'&&state.routingEnabled?$('taskAssignment').value:'';
}
function appendImportAssignment(content,original){
  if(!state.routingEnabled)return;
  const selector=document.createElement('select');selector.className='import-assignment';
  selector.setAttribute('aria-label','Phòng/Khu và chức vụ của nhiệm vụ KPI');
  if(state.assignments.length!==1){const placeholder=document.createElement('option');placeholder.value='';
    placeholder.textContent='Chọn Phòng/Khu của nhiệm vụ KPI';selector.append(placeholder);}
  for(const a of state.assignments){const o=document.createElement('option');o.value=a.key;
    o.textContent=a.unitName+' – '+a.label;selector.append(o);}
  selector.value=original?.assignmentKey||((state.assignments.length===1)?state.assignments[0].key:'');
  content.append(selector);
}
function edit(t){
  if(state.busy)return;
  state.editingId=t.id;$('taskTitle').value=t.title;$('dueDate').value=t.dueDate;
  $('dueDate').min=''; // Previously registered due dates are visible; server validates on save.
  $('taskTime').value=t.time;
  $('taskType').querySelector('option[value=legacy]').hidden=true;
  $('taskType').querySelector('option[value=personal]').disabled=!!t.sourceKey||!!t.legacyKpi;
  $('taskType').value=t.workType==='personal'?'personal':'kpi';
  renderAssignmentOptions(t.assignmentKey||'');
  $('formHeading').textContent='Sửa công việc';
  $('saveTask').textContent='Cập nhật';$('cancelEdit').classList.remove('hide');
  showPane('create',true);preview();
}
function resetForm(){
  state.editingId=null;$('taskForm').reset();$('dueDate').min=nowVNDate();
  $('taskTime').value=state.defaultTime;
  $('taskType').querySelector('option[value=legacy]').hidden=true;
  $('taskType').querySelector('option[value=personal]').disabled=false;
  $('taskType').value='personal';renderAssignmentOptions('');
  $('formHeading').textContent='Thêm công việc';
  $('saveTask').textContent='Lưu công việc';$('cancelEdit').classList.add('hide');preview();
}
function paintData(){
  $('defaultTime').value=state.defaultTime;$('defaultTimeLabel').textContent=state.defaultTime;
  renderTasks();renderSchedule();renderInbox();
}
function updateData(data){
  if(Number.isSafeInteger(data.revision)&&data.revision<state.revision)return false;
  if(Array.isArray(data.tasks))state.tasks=data.tasks;
  if(typeof data.defaultTime==='string')state.defaultTime=data.defaultTime;
  if(Array.isArray(data.inbox))state.inbox=data.inbox;
  if(Array.isArray(data.deletedSourceKeys))state.deletedSourceKeys=data.deletedSourceKeys;
  if(typeof data.isAdmin==='boolean')state.isAdmin=data.isAdmin;
  if(typeof data.managerConfigured==='boolean')state.managerConfigured=data.managerConfigured;
  if(typeof data.routingEnabled==='boolean')state.routingEnabled=data.routingEnabled;
  if(Array.isArray(data.assignments))state.assignments=data.assignments;
  if(!state.editingId)renderAssignmentOptions('');
  if(Number.isSafeInteger(data.revision))state.revision=data.revision;
  paintData();return true;
}
function syncIndicator(text){const el=$('syncStatus');if(el)el.textContent=text;}
// Apply one authorized, sequential delta without reloading Sheets; detect gaps.
function applyChange(event){
  if(!event||!Number.isSafeInteger(event.revision)||!event.change)return;
  if(event.revision<=state.revision)return;
  if(state.busy){state.queuedChanges.push(event);return;}
  if(event.revision!==state.revision+1){void checkRevision(true);return;}
  const change=event.change;
  if(change.type==='upsert'&&change.task&&typeof change.task.id==='string'){
    state.tasks=state.tasks.filter(t=>t.id!==change.task.id).concat([change.task]);
  }else if(change.type==='importBatch'&&Array.isArray(change.tasks)){
    const ids=new Set(change.tasks.map(t=>t.id));
    state.tasks=state.tasks.filter(t=>!ids.has(t.id)).concat(change.tasks);
  }else if(change.type==='remove'&&typeof change.id==='string'){
    state.tasks=state.tasks.filter(t=>t.id!==change.id);
    if(state.editingId===change.id){resetForm();showPane('list');}
  }else if(change.type==='inboxChanged'){
    void refresh();return;
  }else if(change.type==='defaultTime'&&typeof change.time==='string'){
    state.defaultTime=change.time;
    if(!state.editingId)$('taskTime').value=change.time;
  }else{void checkRevision(true);return;}
  state.revision=event.revision;paintData();syncIndicator('Đã đồng bộ');
}
function flushChanges(){
  const events=state.queuedChanges.splice(0).sort((a,b)=>a.revision-b.revision);
  for(const event of events)applyChange(event);
}
function receiveChange(event){
  if(!state.user)return;
  applyChange(event);
}
function emitTabChange(event){
  if(state.broadcast){try{state.broadcast.postMessage(event);return;}catch(_){}}
  if(state.localRevisionKey&&Number.isSafeInteger(event?.revision)){
    try{
      // Never persist task titles, notice text, email or a session credential.
      localStorage.setItem(state.localRevisionKey,JSON.stringify({revision:event.revision,nonce:Date.now()+'-'+Math.random()}));
    }catch(_){/* Storage is unavailable; server refresh remains the fallback. */}
  }
}
async function checkRevision(force=false){
  if(!state.user||state.busy||state.checkingVersion)return;
  const now=Date.now();if(!force&&now-state.lastVersionCheck<30000)return;
  state.lastVersionCheck=now;state.checkingVersion=true;
  try{
    const remote=await api('status');
    if(!state.user)return;
    if(Number.isSafeInteger(remote.revision)&&remote.revision!==state.revision){
      if(state.busy){state.reconcileAfterBusy=true;return;}
      syncIndicator('Đang cập nhật…');
      const latest=await api('load');
      if(state.busy){state.reconcileAfterBusy=true;return;}
      updateData(latest);
      syncIndicator('Đã đồng bộ');
    }
  }catch(err){syncIndicator('Chưa đồng bộ · Kiểm tra kết nối');}
  finally{state.checkingVersion=false;}
}
// Cơ chế đối soát giới hạn khi Ably chưa hoạt động (không tải toàn bộ liên tục).
let inboxFallbackTimer=null;
function stopInboxFallback(){clearInterval(inboxFallbackTimer);inboxFallbackTimer=null;}
function startInboxFallback(){
  stopInboxFallback();
  inboxFallbackTimer=setInterval(()=>{
    if(!state.user||document.hidden||state.busy||state.signingOut)return;
    if(state.realtime?.connection?.state==='connected'&&state.realtimeAttached)return;
    void checkRevision();
  },120000);
}
let ablySdkPromise=null;
function loadAblySdk(){
  if(window.Ably)return Promise.resolve(window.Ably);
  if(ablySdkPromise)return ablySdkPromise;
  ablySdkPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdn.ably.com/lib/ably.min-2.js';script.async=true;
    script.onload=()=>window.Ably?resolve(window.Ably):reject(new Error('Không tải được SDK Ably.'));
    script.onerror=()=>reject(new Error('Không thể kết nối máy chủ real-time.'));
    document.head.appendChild(script);
  }).catch(err=>{ablySdkPromise=null;throw err;});return ablySdkPromise;
}
async function connectRealtime(){
  const epoch=state.sessionEpoch,externalId=state.user?.externalId;
  if(!externalId)return;
  state.localRevisionKey='nhac-kpi-revision-'+externalId;
  if(typeof BroadcastChannel==='function'){
    try{
      state.broadcast=new BroadcastChannel('nhac-kpi-'+externalId);
      state.broadcast.onmessage=ev=>{if(epoch===state.sessionEpoch&&state.user?.externalId===externalId)receiveChange(ev.data);};
    }catch(err){state.broadcast=null;console.warn('BroadcastChannel không khả dụng:',err.message);}
  }
  // Browsers without BroadcastChannel use a storage event containing REVISION ONLY.
  // On restricted/private storage the normal server refresh remains available.
  if(!state.config?.realtimeEnabled){syncIndicator('Đồng bộ khi có thay đổi hoặc mở lại ứng dụng');return;}
  try{
    const Ably=await loadAblySdk();
    if(epoch!==state.sessionEpoch||!state.user)return;
    const authCallback=async (_params,callback)=>{
      try{
        if(epoch!==state.sessionEpoch||!state.user)throw new Error('Phiên đã kết thúc.');
        const r=await fetch('/api/realtime',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify(state.sessionToken?{sessionToken:state.sessionToken}:{credential:state.credential}),cache:'no-store'});
        const token=await r.json();
        if(!r.ok)throw new Error(token.error||'Không được phép kết nối.');
        callback(null,token);
      }catch(err){callback(err,null);}
    };
    const client=new Ably.Realtime({authCallback,autoConnect:false});
    state.realtime=client;
    // Channel name is supplied by the verified server to the current account on load.
    const channel=client.channels.get(state.user.realtimeChannel);
    const subscription=channel.subscribe('data.changed',message=>{
      if(epoch===state.sessionEpoch&&state.user?.externalId===externalId)receiveChange(message.data);
    });
    if(subscription&&typeof subscription.catch==='function')subscription.catch(err=>console.warn('Ably subscribe:',err.message));
    channel.on('attached',()=>{
      if(epoch===state.sessionEpoch){state.realtimeAttached=true;void checkRevision(true);}
    });
    channel.on('detached',()=>{if(epoch===state.sessionEpoch)state.realtimeAttached=false;});
    channel.on('failed',()=>{if(epoch===state.sessionEpoch)state.realtimeAttached=false;});
    client.connection.on('connected',()=>{
      if(epoch!==state.sessionEpoch)return;
      syncIndicator('Đã kết nối đa thiết bị');
    });
    client.connection.on('disconnected',()=>syncIndicator('Mất kết nối tạm thời'));
    client.connection.on('suspended',()=>syncIndicator('Đang kết nối lại…'));
    client.connection.on('failed',()=>syncIndicator('Chưa đồng bộ ngay giữa các thiết bị'));
    client.connect();
  }catch(err){syncIndicator('Chưa đồng bộ ngay giữa các thiết bị');console.warn('Realtime:',err.message);}
}
function disconnectRealtime(){
  clearTimeout(pushSyncTimer);
  if(state.broadcast){state.broadcast.close();state.broadcast=null;}
  state.localRevisionKey='';
  if(state.realtime){try{state.realtime.close();}catch(_){}state.realtime=null;}
  stopInboxFallback();state.realtimeAttached=false;state.queuedChanges=[];state.revision=0;state.lastVersionCheck=0;state.reconcileAfterBusy=false;
}
async function refresh(){
  if(state.busy)return;setBusy(true,'reload');
  try{updateData(await api('load'));syncIndicator('Đã đồng bộ');notify('Đã cập nhật danh sách công việc.');}
  catch(err){notify(err.message,true);}finally{setBusy(false,'reload');flushChanges();}
}
// Display a pending local change immediately; the server still owns the final result.
let pushSyncTimer=null;
function kickOneSignalSync(){
  clearTimeout(pushSyncTimer);const epoch=state.sessionEpoch;
  pushSyncTimer=setTimeout(()=>{
    if(epoch===state.sessionEpoch&&state.user)void api('sync').catch(err=>{console.warn('Hẹn đồng bộ OneSignal:',err.message);});
  },250);
}
async function optimisticMutation(action,data,change){
  if(state.busy)return;
  const snapshot={tasks:state.tasks.map(t=>({...t})),inbox:state.inbox.map(n=>({...n})),defaultTime:state.defaultTime,revision:state.revision};
  setBusy(true);
  change();paintData();if(action!=='setDefaultTime')showPane('list',true);
  try{
    const result=await api(action,{...data,expectedRevision:snapshot.revision});
    updateData(result);
    if(action==='save')resetForm();
    if(action==='remove'&&state.editingId===data.id)resetForm();
    if(action==='setDefaultTime'&&!state.editingId)$('taskTime').value=state.defaultTime;
    preview();
    // Other tabs on the same browser work without a provider connection.
    if(result.change)emitTabChange({revision:result.revision,change:result.change});
    if(result.needsSync&&(action==='save'||action==='remove'))kickOneSignalSync();
    notify(result.notice||(action==='remove'?'Đã xóa công việc.':'Đã cập nhật.'));
  }catch(err){
    // Even a timeout can mean the mutation was committed. Re-read once before rollback.
    try{
      const actual=await api('load');
      updateData(actual);
      syncIndicator('Đã đối soát');
      notify('Đã kiểm tra dữ liệu trên máy chủ. '+err.message,true);
    }catch(_){
      if(state.revision<=snapshot.revision){state.tasks=snapshot.tasks;state.inbox=snapshot.inbox;state.defaultTime=snapshot.defaultTime;paintData();}
      syncIndicator('Chưa xác minh được · Làm mới khi có mạng');
      notify(err.message+' Chưa xác nhận kết quả; hãy Làm mới khi có mạng.',true);
    }
  }finally{setBusy(false);flushChanges();applyPendingVersion();
    if(state.reconcileAfterBusy){state.reconcileAfterBusy=false;void checkRevision(true);}
  }
}
async function saveTask(ev){
  ev.preventDefault();if(state.busy)return;
  const title=$('taskTitle').value.trim(),dueDate=$('dueDate').value,time=$('taskTime').value,id=state.editingId||'';
  const workType=$('taskType').value,assignmentKey=selectedAssignment();
  const original=state.editingId&&state.tasks.find(t=>t.id===state.editingId);
  const historicalEdit=!!(original&&original.legacyKpi&&!original.assignmentKey);
  if(workType==='kpi'&&state.routingEnabled&&!assignmentKey&&!historicalEdit){notify('Hãy chọn Phòng/Khu và chức vụ cho công việc KPI.',true);return;}
  if(!title||!dueDate||!time){notify('Hãy nhập tên, ngày đến hạn và giờ nhắc.',true);return;}
  const temporary=id||'pending-'+Date.now();
  await optimisticMutation('save',{id,title,dueDate,time,workType,assignmentKey},()=>{
    state.tasks=state.tasks.filter(t=>t.id!==id);
    state.tasks.push({id:temporary,title,dueDate,time,workType,assignmentKey,pending:4,warning:'',_optimistic:true});
  });
}
// YC-033: Safari below 15.4 has no native dialog API. Preserve the exact
// existing confirmation actions with a keyboard- and touch-accessible fallback.
function openAppDialog(dialog){
  if(typeof dialog.showModal==='function'){dialog.showModal();return;}
  dialog.returnValue='';
  dialog.classList.add('compat-dialog-open');
  dialog.setAttribute('open','');
  dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-modal','true');
  const first=dialog.querySelector('button');
  if(first)first.focus();
}
function closeAppDialog(dialog,result=''){
  if(!dialog.classList.contains('compat-dialog-open')&&typeof dialog.close==='function'){
    dialog.close(result);return;
  }
  dialog.returnValue=result;
  dialog.classList.remove('compat-dialog-open');
  dialog.removeAttribute('open');
  dialog.removeAttribute('aria-modal');
  dialog.dispatchEvent(new Event('close'));
}
function wireLegacyDialogs(){
  const confirm=$('confirmDialog');
  confirm.querySelectorAll('button[value]').forEach(button=>button.addEventListener('click',event=>{
    if(!confirm.classList.contains('compat-dialog-open'))return;
    if(button.value==='confirm'&&!$('completionAssignmentWrap').classList.contains('hide')&&
       !$('completionAssignment').value){event.preventDefault();notify('Hãy chọn Phòng/Khu của nhiệm vụ KPI.',true);return;}
    event.preventDefault();closeAppDialog(confirm,button.value);
  }));
  confirm.querySelector('form').addEventListener('submit',event=>{
    if(event.submitter?.value==='confirm'&&!$('completionAssignmentWrap').classList.contains('hide')&&
       !$('completionAssignment').value){event.preventDefault();notify('Hãy chọn Phòng/Khu của nhiệm vụ KPI.',true);return;}
    if(confirm.classList.contains('compat-dialog-open'))event.preventDefault();
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    const active=document.querySelector('dialog.compat-dialog-open');
    if(active){event.preventDefault();closeAppDialog(active,'cancel');}
  });
}
function openTaskMenu(t){
  if(state.busy)return;
  $('taskMenuTitle').textContent=t.title;
  $('taskMenuMeta').textContent=vnDate(t.dueDate)+' · '+t.time;
  $('menuEdit').onclick=()=>{closeAppDialog($('taskMenu'));edit(t);};
  $('menuDelete').onclick=()=>{closeAppDialog($('taskMenu'));remove(t);};
  openAppDialog($('taskMenu'));
}
async function remove(t){
  if(state.busy)return;
  $('confirmText').textContent=t.workType==='personal'?
    `Bạn đã hoàn thành công việc cá nhân “${t.title}”? Không gửi thông báo chấm KPI.`:state.managerConfigured?
    `Bạn đã hoàn thành KPI “${t.title}” trên iCPV? Hệ thống sẽ nhắc người có thẩm quyền vào chấm điểm theo phân công hợp lệ.`:
    `Bạn đã hoàn thành “${t.title}”? Chưa có thông tin Trưởng phòng nhận thông báo; hãy liên hệ quản trị viên.`;
  const needsAssignment=t.workType!=='personal'&&state.routingEnabled&&t.legacyKpi&&
    !t.assignmentKey&&state.assignments.length>1;
  const wrap=$('completionAssignmentWrap'),selector=$('completionAssignment');
  wrap.classList.toggle('hide',!needsAssignment);
  selector.replaceChildren();
  if(needsAssignment){
    const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Chọn Phòng/Khu';selector.append(placeholder);
    for(const assignment of state.assignments){
      const o=document.createElement('option');o.value=assignment.key;o.textContent=assignment.unitName+' – '+assignment.label;selector.append(o);
    }
  }
  const dialog=$('confirmDialog');openAppDialog(dialog);
  dialog.addEventListener('close',function onClose(){
    dialog.removeEventListener('close',onClose);
    if(!['confirm','discard'].includes(dialog.returnValue)||state.busy){applyPendingVersion();return;}
    if(dialog.returnValue==='confirm'&&needsAssignment&&!selector.value){
      notify('Vui lòng chọn Phòng/Khu tương ứng với nhiệm vụ KPI.',true);return;
    }
    void optimisticMutation('remove',{id:t.id,mode:dialog.returnValue==='discard'?'discard':'completed',
      assignmentKey:dialog.returnValue==='confirm'&&needsAssignment?selector.value:''},
      ()=>{state.tasks=state.tasks.filter(x=>x.id!==t.id);});
  },{once:true});
}
async function saveDefaultTime(){
  if(state.busy)return;
  const time=$('defaultTime').value;
  if(state.defaultTime===time){notify('Giờ mặc định không thay đổi.');return;}
  await optimisticMutation('setDefaultTime',{time},()=>{state.defaultTime=time;});
}
// V1.4.1: Device-specific push diagnostics. Permission is never shared between browsers.
function pushDeviceIssue(){
  if(!window.isSecureContext)return 'Cần mở ứng dụng qua địa chỉ HTTPS chính thức.';
  const ua=String(navigator.userAgent||'');
  const ios=/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua)&&navigator.maxTouchPoints>1);
  const standalone=Boolean(navigator.standalone)||Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches);
  const version=ios?ua.match(/OS (\d+)[_.](\d+)/):null;
  if(version&&(Number(version[1])<16||(Number(version[1])===16&&Number(version[2])<4)))
    return 'iPhone/iPad đang dùng iOS dưới 16.4 nên không hỗ trợ thông báo nền cho ứng dụng web. Bạn vẫn có thể quản lý và xem hạn công việc khi mở ứng dụng.';
  if(ios&&!standalone)return 'iPhone/iPad: mở bằng Safari → Chia sẻ → Thêm vào Màn hình chính; sau đó mở từ biểu tượng đã cài và bấm Bật thông báo. Yêu cầu iOS/iPadOS 16.4 trở lên.';
  if(!('Notification' in window)||!('serviceWorker' in navigator)||!('PushManager' in window))
    return 'Trình duyệt/thiết bị này chưa hỗ trợ Web Push. Hãy dùng Chrome/Edge phiên bản mới, hoặc iPhone/iPad có ứng dụng ở Màn hình chính (iOS 16.4+).';
  if(Notification.permission==='denied')
    return ios?'Thông báo đã bị từ chối. Vào Cài đặt iPhone → Thông báo → Nhắc việc KPI, rồi bật Cho phép thông báo.':
      'Thông báo đã bị chặn. Nhấn biểu tượng điều chỉnh/ổ khóa bên trái địa chỉ website → Cài đặt trang web → Thông báo → Cho phép, sau đó tải lại trang.';
  return '';
}
function pushSnapshot(){
  const o=state.onesignal, sub=o?.User?.PushSubscription;
  const browserPermission=typeof Notification!=='undefined'?Notification.permission:'không hỗ trợ';
  return {browserPermission, sdk:Boolean(o), account:Boolean(state.user&&state.pushBoundAccount===state.user.externalId),
    optedIn:Boolean(sub?.optedIn),subscription:Boolean(sub?.id),
    ready:Boolean(o&&state.user&&state.pushBoundAccount===state.user.externalId&&o.Notifications?.permission&&sub?.optedIn&&sub?.id)};
}
function pushState(){
  if(!state.user)return;
  const snap=pushSnapshot(),issue=pushDeviceIssue();
  const detail=issue||state.pushError||(!snap.sdk?'Đang kết nối dịch vụ thông báo…':
    !snap.account?'Đang liên kết thiết bị với tài khoản…':
    snap.browserPermission!=='granted'?'Thiết bị cần được cấp quyền thông báo.':
    !snap.subscription?'Đã cấp quyền nhưng thiết bị chưa đăng ký xong. Hãy bấm Kiểm tra lại.':
    !snap.optedIn?'Thiết bị đang tắt đăng ký nhận tin. Bấm Bật thông báo để đăng ký lại.':
    'Thiết bị đã sẵn sàng nhận thông báo cho tài khoản này.');
  $('pushDot').className='status-dot '+(snap.ready?'on':'off');
  $('pushStatus').textContent=snap.ready?'Thông báo đã bật trên thiết bị này':issue?'Chưa thể nhận thông báo':
    state.pushError?'Thông báo cần kiểm tra':'Chưa bật thông báo trên thiết bị này';
  $('pushDetail').textContent=detail;
  $('enablePush').textContent='Bật thông báo';
  $('enablePush').closest('.notification-bar').classList.toggle('hide',snap.ready);

}
let sdkInitPromise=null;
let sdkInitStartedAt=0;
let sdkScriptRetried=false;
function retryOneSignalScript(){
  if(sdkScriptRetried||state.onesignal)return;
  sdkScriptRetried=true;
  const script=document.createElement('script');
  script.async=true;
  script.src='https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
  script.setAttribute('data-push-retry','1');
  script.onerror=()=>console.warn('OneSignal: không tải được SDK khi thử lại.');
  document.head.appendChild(script);
}
function sdk(){
  if(state.onesignal)return Promise.resolve(state.onesignal);
  // A stalled CDN must not permanently cache a rejected Promise. Reuse a single SDK init callback.
  if(!sdkInitPromise){
    sdkInitStartedAt=Date.now();
    const initial=new Promise((resolve,reject)=>{
      window.OneSignalDeferred=window.OneSignalDeferred||[];
      window.OneSignalDeferred.push(async o=>{
        try{
          if(!state.config?.oneSignalAppId)throw new Error('Thiếu cấu hình OneSignal App ID. Liên hệ quản trị viên.');
          await o.init({appId:state.config.oneSignalAppId,serviceWorkerPath:'/OneSignalSDKWorker.js',serviceWorkerParam:{scope:'/'}});
          state.onesignal=o;
          o.Notifications.addEventListener('permissionChange',()=>{state.pushError='';pushState();});
          o.User.PushSubscription.addEventListener('change',()=>{state.pushError='';pushState();});
          resolve(o);
        }catch(err){reject(err);}
      });
    });
    // A genuine SDK initialization rejection must be retryable; an ordinary
    // 15-second CDN timeout keeps waiting for its original callback.
    const shared=initial.catch(err=>{if(sdkInitPromise===shared)sdkInitPromise=null;throw err;});
    sdkInitPromise=shared;
  }
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('OneSignal chưa tải xong sau 15 giây. Kiểm tra Internet, trình chặn quảng cáo hoặc tường lửa, sau đó thử lại.')),15000);
    sdkInitPromise.then(o=>{clearTimeout(timeout);resolve(o);},err=>{clearTimeout(timeout);reject(err);});
  });
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
      if(state.pushBoundAccount!==externalId){
        await o.login(externalId); // OneSignal v16 links this device to the authorized account.
      }
      if(epoch!==state.sessionEpoch||!state.user||state.user.externalId!==externalId){
        await o.logout();return;
      }
      state.pushBoundAccount=externalId;
      state.pushError='';pushState();
    });
  }catch(err){
    if(epoch===state.sessionEpoch){
      state.pushBoundAccount='';
      state.pushError='Chưa kết nối được thông báo: '+String(err?.message||err).slice(0,180);
      pushState();
    }
    throw err;
  }
}
function waitForSubscription(o,ms=6000){
  const ready=()=>Boolean(o.User.PushSubscription.id&&o.User.PushSubscription.optedIn);
  if(ready())return Promise.resolve(true);
  return new Promise(resolve=>{
    let timeout;
    const done=()=>{clearTimeout(timeout);o.User.PushSubscription.removeEventListener('change',changed);resolve(ready());};
    const changed=()=>{if(ready())done();};
    o.User.PushSubscription.addEventListener('change',changed);
    timeout=setTimeout(done,ms);
    if(ready())done();
  });
}
async function enablePush(){
  if(state.pushBusy||!state.user||state.signingOut)return;
  const issue=pushDeviceIssue();
  if(issue){state.pushError=issue;pushState();notify(issue,true);return;}
  // Browser activation is transient: ask permission directly within the real user click.
  // Do NOT await SDK login/network before requesting the native permission dialog.
  const o=state.onesignal;
  if(!o){
    // Retry loading once only if the first script stalled; do not spam SDK/CDN requests.
    if(sdkInitStartedAt&&Date.now()-sdkInitStartedAt>=15000)retryOneSignalScript();
    state.pushError='Đang kết nối dịch vụ thông báo. Hãy chờ ít giây rồi thử lại nếu chưa sẵn sàng.';
    pushState();
    void initPush(state.user.externalId).catch(()=>{});
    notify(state.pushError,true);return;
  }
  if(!o.Notifications.isPushSupported()){
    state.pushError='Thiết bị này chưa hỗ trợ nhận thông báo. Vui lòng dùng trình duyệt tương thích.';
    pushState();notify(state.pushError,true);return;
  }
  let permissionRequest=null;
  try{
    if(!o.Notifications.permission&&Notification.permission==='default')permissionRequest=o.Notifications.requestPermission();
  }catch(err){state.pushError=String(err?.message||err);pushState();notify(state.pushError,true);return;}
  state.pushBusy=true;
  $('enablePush').disabled=true;
  $('enablePush').textContent='Đang kiểm tra…';
  const epoch=state.sessionEpoch,externalId=state.user.externalId;
  try{
    if(permissionRequest)await permissionRequest;
    if(epoch!==state.sessionEpoch)throw new Error('Phiên đăng nhập đã thay đổi.');
    if(Notification.permission==='denied')throw new Error(pushDeviceIssue());
    if(!o.Notifications.permission)throw new Error('Trình duyệt chưa cấp quyền thông báo. Hãy bấm Cho phép khi có yêu cầu.');
    await initPush(externalId);
    if(epoch!==state.sessionEpoch)throw new Error('Phiên đăng nhập đã thay đổi.');
    if(!o.User.PushSubscription.optedIn)await o.User.PushSubscription.optIn();
    if(!await waitForSubscription(o))throw new Error('Đã cấp quyền nhưng thiết bị chưa đăng ký nhận thông báo thành công. Vui lòng kiểm tra kết nối hoặc nhờ quản trị viên hỗ trợ.');
    if(epoch!==state.sessionEpoch)throw new Error('Phiên đăng nhập đã thay đổi.');
    state.pushError='';pushState();
    // Device registration does not itself prove scheduled pushes are being delivered.
    const response=await api('sync');updateData(response);
    notify('Thiết bị đã đăng ký nhận thông báo. Hãy thử thông báo kiểm tra trước khi sử dụng chính thức.');
  }catch(err){
    if(epoch===state.sessionEpoch){state.pushError=String(err?.message||err);pushState();}
    notify(String(err?.message||err),true);
  }finally{
    state.pushBusy=false;$('enablePush').disabled=false;pushState();
  }
}
async function signedIn(response){
  if(state.busy||state.signingOut||state.user)return;
  const epoch=++state.sessionEpoch;state.credential=response.credential;state.sessionToken='';setBusy(true);
  $('loginHint').textContent='Đang kiểm tra quyền sử dụng…';
  try{
    const data=await api('load');
    if(epoch!==state.sessionEpoch)return;
    if(data.sessionToken)state.sessionToken=data.sessionToken;
    state.user={email:data.email,name:data.name,externalId:data.externalId,realtimeChannel:data.realtimeChannel};
    window.postMessage({kind:'TAN_HIEP_ICPV_ACCOUNT_CONTEXT_V1',id:data.externalId},location.origin);
    const name=(data.name||data.email||'bạn').trim();
    $('displayName').textContent=name;$('accountEmail').textContent=data.email;
    $('profileName').textContent=name;$('profileEmail').textContent=data.email;
    const initials=name.split(/\s+/).slice(-2).map(s=>s[0]||'').join('').toUpperCase();
    $('profileAvatar').textContent=initials||'NV';
    $('headerUserAvatar').textContent=initials||'NV';$('headerUserName').textContent=name;
    $('headerNoticeBtn').classList.remove('hide');$('headerProfileBtn').classList.remove('hide');
    updateData(data);$('adminShortcut').classList.toggle('hide',!state.isAdmin);$('desktopAdminBtn').classList.toggle('hide',!state.isAdmin);
    $('adminQuickPanel').classList.toggle('hide',!state.isAdmin);$('appView').classList.toggle('is-admin',state.isAdmin);$('loginView').classList.add('hide');$('appView').classList.remove('hide');
    $('signoutBtn').classList.remove('hide');resetForm();showPane('list');
    // Asynchronous login; never block the task list or load a push SDK on unsupported devices.
    state.pushBoundAccount='';state.pushError='';
    if(pushDeviceIssue())pushState();
    else bindPushForCurrentSession(data.externalId,epoch);
    startInboxFallback();void connectRealtime();
    // The Chrome extension delivers staged data only after successful Google login.
    window.postMessage({kind:'TAN_HIEP_ICPV_IMPORT_READY_V1'},location.origin);
  }catch(err){state.credential='';state.sessionToken='';$('loginHint').textContent=err.message;notify(err.message,true);}
  finally{setBusy(false);}
}
async function signout(){
  if(state.busy||state.signingOut)return;
  state.signingOut=true;state.sessionEpoch++;clearPushBindRetry();disconnectRealtime();setBusy(true);
  try{
    // Serialize with an in-progress OneSignal.login to prevent cross-account binding.
    await queueIdentity(async()=>{if(state.onesignal)await state.onesignal.logout();});
  }catch(err){notify('Chưa thể ngắt OneSignal khỏi thiết bị. Hãy kiểm tra trạng thái thông báo trước khi dùng tài khoản khác.',true);}
  if(window.google?.accounts?.id)window.google.accounts.id.disableAutoSelect();
  window.postMessage({kind:'TAN_HIEP_ICPV_ACCOUNT_CONTEXT_V1',id:''},location.origin);
  state.credential='';state.sessionToken='';state.user=null;state.tasks=[];state.inbox=[];state.deletedSourceKeys=[];state.isAdmin=false;state.managerConfigured=false;state.assignments=[];state.routingEnabled=false;state.editingId=null;state.pushBoundAccount='';state.pushError='';
  $('desktopAdminBtn').classList.add('hide');$('adminQuickPanel').classList.add('hide');
  $('headerNoticeBtn').classList.add('hide');$('headerProfileBtn').classList.add('hide');
  $('appView').classList.remove('is-admin','has-inbox');$('appView').classList.add('hide');$('signoutBtn').classList.add('hide');$('loginView').classList.remove('hide');
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
  wireLegacyDialogs();
  window.addEventListener('message',receiveImportFromExtension);
  $('importCancel').addEventListener('click',()=>{pendingImport=null;closeAppDialog($('importDialog'));applyPendingVersion();});
  $('importApply').addEventListener('click',()=>void confirmImport());
  Object.entries(NAV_IDS).forEach(([pane,id])=>$(id).addEventListener('click',()=>showPane(pane,true)));
  $('tabCreate').addEventListener('click',()=>{resetForm();showPane('create',true);});
  $('taskForm').addEventListener('submit',saveTask);
  $('dueDate').addEventListener('change',preview);$('taskTime').addEventListener('change',preview);
  $('taskType').addEventListener('change',()=>renderAssignmentOptions(''));
  $('cancelEdit').addEventListener('click',()=>{resetForm();showPane('list',true);applyPendingVersion();});
  $('backToList').addEventListener('click',()=>{resetForm();showPane('list',true);applyPendingVersion();});
  $('formCancel').addEventListener('click',()=>{resetForm();showPane('list',true);applyPendingVersion();});
  $('reloadBtn').addEventListener('click',refresh);
  $('saveDefaultTime').addEventListener('click',saveDefaultTime);
  $('enablePush').addEventListener('click',enablePush);
  $('signoutBtn').addEventListener('click',signout);$('profileSignout').addEventListener('click',signout);
  $('profileDefaultTime').addEventListener('click',openDefaultSettings);
  $('desktopJobsBtn').addEventListener('click',()=>showPane('list'));
  $('desktopNoticeBtn').addEventListener('click',()=>{showPane('notifications');void refresh();});
  $('desktopAdminBtn').addEventListener('click',()=>{if(state.isAdmin)showPane('admin');});
  $('adminQuickOpen').addEventListener('click',()=>{if(state.isAdmin)showPane('admin',true);});
  $('headerNoticeBtn').addEventListener('click',()=>{showPane('notifications',true);void refresh();});
  $('headerProfileBtn').addEventListener('click',()=>showPane('profile',true));
  $('adminShortcut').addEventListener('click',()=>showPane('admin',true));
  $('adminBack').addEventListener('click',()=>showPane('profile',true));
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden){void checkRevision();void checkAppVersion();}
  });
  window.addEventListener('storage',event=>{
    if(!state.user||!state.localRevisionKey||event.key!==state.localRevisionKey||!event.newValue)return;
    try{
      const message=JSON.parse(event.newValue);
      if(!Number.isSafeInteger(message.revision)||message.revision<=state.revision)return;
      if(state.busy){state.reconcileAfterBusy=true;return;}
      void checkRevision(true); // Always verify actual state from authenticated server.
    }catch(_){}
  });
  window.addEventListener('online',()=>{
    syncIndicator('Đã có mạng · Đang kiểm tra…');void checkRevision(true);void checkAppVersion();
  });
  // Checks occur only while the page is active. 2 minutes is adequate for staggered devices.
  if(!versionCheckTimer)versionCheckTimer=setInterval(()=>void checkAppVersion(),120000);
  $('menuClose').addEventListener('click',()=>closeAppDialog($('taskMenu')));
  document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>setFilter(button.dataset.filter)));
  resetForm();showPane('list');
  // Use the same OneSignal worker and scope, never create a competing PWA worker.
  // If start() begins after load, the old load-only listener never ran on slow devices.
  if('serviceWorker' in navigator){
    const registerWorker=()=>navigator.serviceWorker.register('/OneSignalSDKWorker.js',{scope:'/'})
      .catch(err=>console.warn('Service worker:',err.message));
    if(document.readyState==='complete')void registerWorker();
    else window.addEventListener('load',registerWorker,{once:true});
  }
  try{
    const response=await fetch('/api/config',{cache:'no-store'}),cfg=await response.json();
    if(!response.ok)throw new Error(cfg.error||'Chưa cài cấu hình Vercel.');
    state.config=cfg;
    if(cfg.appVersion&&cfg.appVersion!==APP_VERSION){
      versionPending=cfg.appVersion;
      if(applyPendingVersion())return;
    }
    for(let i=0;i<80&&!window.google?.accounts?.id;i++)await new Promise(resolve=>setTimeout(resolve,100));
    if(!window.google?.accounts?.id)throw new Error('Không tải được Google Login. Hãy kiểm tra kết nối mạng.');
    window.google.accounts.id.initialize({client_id:cfg.googleClientId,callback:signedIn,auto_select:false});
    window.google.accounts.id.renderButton($('googleButton'),{theme:'outline',size:'large',text:'signin_with',shape:'pill',width:300});
    $('loginHint').textContent='Chỉ dành cho tài khoản đã được cấp quyền.';
  }catch(err){$('loginHint').textContent=err.message;notify(err.message,true);}
}
// iCPV review: raw page data only arrives after a user-approved transfer.
let pendingImport=null;
function receiveImportFromExtension(event){
  if(event.source!==window||event.origin!==location.origin||!state.user)return;
  const data=event.data;
  if(!data||data.kind!=='TAN_HIEP_ICPV_IMPORT_PAYLOAD_V1')return;
  if(data.accountId&&data.accountId!==state.user.externalId){
    notify('Dữ liệu được kiểm tra từ tài khoản Nhắc việc khác. Hãy quay lại iCPV sau khi đăng nhập đúng tài khoản.',true);return;
  }
  if(!Array.isArray(data.items)||!data.items.length||data.items.length>30){
    notify('Danh sách chưa hợp lệ hoặc vượt quá 30 nhiệm vụ.',true);return;
  }
  const clean=[];
  for(const input of data.items){
    if(!input||!/^icpv:[a-f0-9]{64}$/.test(input.sourceKey||''))continue;
    clean.push({sourceKey:input.sourceKey,title:String(input.title||'').slice(0,90).trim(),dueDate:String(input.dueDate||'')});
  }
  if(!clean.length){notify('Không đọc được nhiệm vụ để rà soát.',true);return;}
  pendingImport=clean;
  $('importAccount').textContent=state.user.email;
  $('importAccountConfirm').checked=false;
  const list=$('importPreview');list.replaceChildren();
  const known=new Map(state.tasks.filter(t=>t.sourceKey).map(t=>[t.sourceKey,t]));
  const deleted=new Set(state.deletedSourceKeys);
  const active=[...state.tasks].sort((a,b)=>a.title.localeCompare(b.title,'vi'));
  if(state.routingEnabled&&!state.assignments.length){
    notify('Tài khoản chưa có phân công Phòng/Khu hợp lệ để nhập nhiệm vụ KPI.',true);return;
  }
  let initialAdd=0,checkCount=0;
  for(let i=0;i<clean.length;i++){
    const t=clean[i],matched=known.get(t.sourceKey),wasDeleted=deleted.has(t.sourceKey);
    const valid=/^\d{4}-\d{2}-\d{2}$/.test(t.dueDate);
    const same=matched&&matched.dueDate===t.dueDate&&matched.title===t.title;
    const action=(!valid||matched||wasDeleted)?'ignore':'add';
    if(action==='add')initialAdd++;else if(!same)checkCount++;
    const row=document.createElement('div');row.className='import-row';row.dataset.index=String(i);
    const content=document.createElement('div');
    const info=document.createElement('small');
    info.textContent=!valid?'Chưa đọc được thời hạn — cần kiểm tra trên iCPV.':
      wasDeleted?'Công việc từng được xóa — không tự khôi phục.':
      same?'Có thể đã theo dõi — được giữ nguyên.':
      matched?'Thông tin có thể đã thay đổi — bạn tự rà soát.':
      'Chưa tìm thấy mục tương ứng — có thể là công việc mới.';
    const title=document.createElement('input');title.type='text';title.maxLength=90;title.value=t.title;
    title.setAttribute('aria-label','Tên nhiệm vụ dòng '+(i+1));
    const due=document.createElement('input');due.type='date';due.value=valid?t.dueDate:'';
    due.setAttribute('aria-label','Thời hạn dòng '+(i+1));
    const actionSelect=document.createElement('select');actionSelect.className='action-select';
    [['ignore','Bỏ qua'],['add','Thêm thành công việc mới'],['update','Cập nhật một công việc đã có']].forEach(([value,label])=>{
      const option=document.createElement('option');option.value=value;option.textContent=label;actionSelect.append(option);
    });
    actionSelect.value=action;actionSelect.setAttribute('aria-label','Cách xử lý dòng '+(i+1));
    const target=document.createElement('select');target.className='target-select';
    const opt=document.createElement('option');opt.value='';opt.textContent='Chọn công việc đang theo dõi để cập nhật';target.append(opt);
    for(const existing of active){
      const o=document.createElement('option');o.value=existing.id;
      o.textContent=existing.title+' · '+vnDate(existing.dueDate);target.append(o);
    }
    if(matched)target.value=matched.id;
    function refreshAction(){target.classList.toggle('hide',actionSelect.value!=='update');}
    actionSelect.addEventListener('change',refreshAction);refreshAction();
    content.append(info,title,due,actionSelect,target);
    appendImportAssignment(content,matched||null);row.append(content);list.append(row);
  }
  $('importInfo').textContent='Đã đọc '+clean.length+' nhiệm vụ trên trang iCPV đang mở. '+initialAdd+
    ' mục đề xuất thêm; '+checkCount+' mục cần rà soát. Bạn tự quyết định cập nhật, thêm mới hoặc bỏ qua. Các công việc cũ không tự thay đổi.';
  openAppDialog($('importDialog'));
}
async function confirmImport(){
  if(!pendingImport||state.busy)return;
  if(!$('importAccountConfirm').checked){notify('Vui lòng xác nhận tài khoản và quyền sử dụng dữ liệu.',true);return;}
  const decisions=[];
  for(const row of $('importPreview').querySelectorAll('.import-row')){
    const kind=row.querySelector('.action-select').value;
    if(kind==='ignore')continue;
    const original=pendingImport[Number(row.dataset.index)];
    const title=row.querySelector('input[type=text]').value.trim();
    const dueDate=row.querySelector('input[type=date]').value;
    if(!title||!dueDate){notify('Hãy kiểm tra tên và ngày đến hạn của công việc được chọn.',true);return;}
    const targetId=row.querySelector('.target-select').value;
    if(kind==='update'&&!targetId){notify('Hãy chọn công việc đang theo dõi để cập nhật.',true);return;}
    const assignmentKey=row.querySelector('.import-assignment')?.value||'';
    if(state.routingEnabled&&!assignmentKey){notify('Hãy chọn Phòng/Khu và chức vụ cho từng nhiệm vụ KPI.',true);return;}
    decisions.push({sourceKey:original.sourceKey,title,dueDate,kind,targetId:kind==='update'?targetId:'',assignmentKey});
  }
  if(!decisions.length){closeAppDialog($('importDialog'));pendingImport=null;notify('Đã giữ nguyên công việc hiện có.');return;}
  const button=$('importApply');button.disabled=true;
  const old=button.textContent;button.textContent='Đang cập nhật…';setBusy(true);
  let checkAfterFailure=false;
  try{
    const r=await api('reviewIcpv',{decisions,expectedRevision:state.revision});
    updateData(r);
    if(r.change)emitTabChange({revision:r.revision,change:r.change});
    if(r.needsSync)kickOneSignalSync();
    closeAppDialog($('importDialog'));pendingImport=null;
    notify(r.notice||'Đã xử lý các công việc được chọn.');showPane('list',true);
  }catch(err){notify(err.message,true);checkAfterFailure=true;}
  finally{setBusy(false);button.disabled=false;button.textContent=old;flushChanges();
    if(checkAfterFailure)void checkRevision(true);}
}

start();
