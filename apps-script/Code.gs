/**
 * NHẮC VIỆC KPI – TÂN HIỆP | production v1.2.0
 * Google Sheets Access/State unchanged. Single OneSignal application.
 * Never call OneSignal while holding the shared script lock.
 * Durable claim + idempotency key protects concurrent edits and uncertain responses.
 * Time zone: Asia/Ho_Chi_Minh.
 */
var SHEET_ACCESS='Access';
var SHEET_STATE='State';
var VN_ZONE='Asia/Ho_Chi_Minh';
var DAYS_AHEAD=7;
var MAX_ACTIVE=50;
var MAX_JSON_CHARS=45000;
var CLOCK_MS=3600000;
var DAY_MS=86400000;
var CLAIM_MS=8*60*1000;
var SCRIPT_LOCK_MS=6500;

function setupProject() {
  var props=PropertiesService.getScriptProperties();
  ['SHEET_ID','SHARED_SECRET','ONESIGNAL_APP_ID','ONESIGNAL_REST_API_KEY','WEB_URL'].forEach(function(k){
    if(!props.getProperty(k))throw new Error('Chưa đặt Script Property: '+k);
  });
  var ss=SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  var a=ss.getSheetByName(SHEET_ACCESS)||ss.insertSheet(SHEET_ACCESS);
  var s=ss.getSheetByName(SHEET_STATE)||ss.insertSheet(SHEET_STATE);
  if(a.getLastRow()===0)a.appendRow(['Email','Họ tên','Active','Role']);
  if(s.getLastRow()===0)s.appendRow(['Google Sub','Email','JSON State','Updated At']);
  a.setFrozenRows(1);s.setFrozenRows(1);
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='syncScheduledNotifications';}))
    ScriptApp.newTrigger('syncScheduledNotifications').timeBased().everyHours(1).create();
}

function jsonOutput_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function fail_(code,msg){var e=new Error(msg);e.clientCode=code;e.clientMessage=msg;return e;}
function prop_(key){return PropertiesService.getScriptProperties().getProperty(key)||'';}
function b64u_(bytes){return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g,'');}
function validateEnvelope_(o){
  if(!o||!Number.isFinite(Number(o.ts))||!/^[0-9a-f-]{36}$/.test(String(o.nonce||''))||
    !/^[A-Za-z0-9_-]+$/.test(String(o.encoded||''))||!/^[A-Za-z0-9_-]+$/.test(String(o.signature||'')))
    throw fail_('BAD_REQUEST','Cấu trúc yêu cầu không hợp lệ.');
  if(Math.abs(Date.now()-Number(o.ts))>120000)throw fail_('FORBIDDEN','Yêu cầu đã quá hạn.');
  var expected=b64u_(Utilities.computeHmacSha256Signature(String(o.ts)+'.'+o.nonce+'.'+o.encoded,prop_('SHARED_SECRET')));
  if(expected.length!==o.signature.length)throw fail_('FORBIDDEN','Chữ ký không hợp lệ.');
  var diff=0;for(var i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^o.signature.charCodeAt(i);
  if(diff)throw fail_('FORBIDDEN','Chữ ký không hợp lệ.');
  var cache=CacheService.getScriptCache(), key='v1_nonce_'+o.nonce;
  if(cache.get(key))throw fail_('FORBIDDEN','Yêu cầu trùng lặp.');
  cache.put(key,'1',150);
  var data=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(o.encoded)).getDataAsString('UTF-8'));
  if(!data||!data.actor||!/^[A-Za-z0-9_-]{5,140}$/.test(String(data.actor.subject||''))||
    !/^th_[a-f0-9]{44}$/.test(String(data.actor.externalId||''))||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.actor.email||'')))
    throw fail_('FORBIDDEN','Thông tin xác thực không hợp lệ.');
  return data;
}
function book_(){return SpreadsheetApp.openById(prop_('SHEET_ID'));}
function withLock_(callback,waitMs){
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(waitMs===undefined?SCRIPT_LOCK_MS:waitMs))throw fail_('BUSY','Hệ thống đang xử lý nhiều yêu cầu. Vui lòng thử lại.');
  try{return callback();}finally{lock.releaseLock();}
}
function accessRows_(ss){
  var sh=ss.getSheetByName(SHEET_ACCESS);
  if(!sh||sh.getLastRow()<2)return [];
  return sh.getRange(2,1,sh.getLastRow()-1,4).getDisplayValues();
}
function enabled_(s){return ['YES','TRUE','1','CÓ','CO','ACTIVE'].indexOf(String(s).trim().toUpperCase())!==-1;}
function checkAccess_(ss,actor){
  var email=String(actor.email).trim().toLowerCase();
  var entries=accessRows_(ss);
  for(var i=0;i<entries.length;i++){
    if(String(entries[i][0]).trim().toLowerCase()!==email)continue;
    if(!enabled_(entries[i][2]))throw fail_('FORBIDDEN','Tài khoản chưa được kích hoạt hoặc đã bị thu hồi quyền.');
    return {email:email,name:String(entries[i][1]).trim()||String(actor.name||'').slice(0,80)||email};
  }
  throw fail_('FORBIDDEN','Tài khoản Google này chưa có trong danh sách Access.');
}
function stateSheet_(ss){var sh=ss.getSheetByName(SHEET_STATE);if(!sh)throw new Error('Chưa chạy setupProject.');return sh;}
function newState_(){return {defaultTime:'07:30',externalId:'',tasks:[],cancellations:[]};}
function normalizeState_(value){
  if(!Array.isArray(value.tasks))value.tasks=[];
  if(!Array.isArray(value.cancellations))value.cancellations=[];
  if(!validTime_(value.defaultTime))value.defaultTime='07:30';
  return value;
}
function readState_(ss,actor,create){
  var sh=stateSheet_(ss);
  var found=sh.getRange('A:A').createTextFinder(String(actor.subject)).matchEntireCell(true).findNext();
  if(!found){
    if(!create)return null;
    var row=sh.getLastRow()+1,fresh=newState_();
    sh.getRange(row,1,1,4).setValues([[String(actor.subject),String(actor.email),JSON.stringify(fresh),new Date()]]);
    return {row:row,profile:fresh};
  }
  var rowIndex=found.getRow(),content=String(sh.getRange(rowIndex,3).getValue()||'');
  return {row:rowIndex,profile:normalizeState_(content?JSON.parse(content):newState_())};
}
function saveState_(sheet,row,profile,email){
  var content=JSON.stringify(profile);
  if(content.length>MAX_JSON_CHARS)throw fail_('BAD_REQUEST','Dữ liệu vượt giới hạn cho phép. Liên hệ quản trị viên.');
  sheet.getRange(row,2,1,3).setValues([[email,content,new Date()]]);
}
function validDay_(s){
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  var dt=new Date(s+'T00:00:00Z');return !isNaN(dt.getTime())&&dt.toISOString().slice(0,10)===s;
}
function validTime_(s){return typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);}
function dateMs_(day,time,daysBefore){
  return Date.UTC(+day.slice(0,4),+day.slice(5,7)-1,+day.slice(8,10)-daysBefore,+time.slice(0,2)-7,+time.slice(3,5),0,0);
}
function vnToday_(){return Utilities.formatDate(new Date(),VN_ZONE,'yyyy-MM-dd');}
function vnDay_(s){return s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4);}
function publicView_(profile,info,ext){
  var now=Date.now(),horizon=now+DAYS_AHEAD*DAY_MS;
  return {email:info.email,name:info.name,externalId:ext,defaultTime:profile.defaultTime,
    tasks:profile.tasks.filter(function(t){return !t.deleted;}).map(function(t){
      var pending=(t.slots||[]).filter(function(s){return !s.id&&s.at>now&&s.at<=horizon;}).length;
      return {id:t.id,title:t.title,dueDate:t.dueDate,time:t.time,pending:pending,
        warning:profile.cancellations.length?'Một số lịch cũ đang chờ hủy.':(t.lastError||'')};
    })};
}
function slotsFor_(task){return [3,2,1,0].map(function(offset){return {
  key:Utilities.getUuid(),at:dateMs_(task.dueDate,task.time,offset),id:'',offset:offset,nextRetryAt:0
};});}
function prepareCancellation_(profile,task){
  var now=Date.now();
  (task.slots||[]).forEach(function(s){
    // Never submitted = nothing to cancel. An in-flight/uncertain request MUST be reconciled.
    if(s.at>now+30000&&(s.id||s.attempted||s.nextRetryAt))
      profile.cancellations.push(Object.assign({},s,{title:task.title,dueDate:task.dueDate,externalId:profile.externalId}));
  });
  task.slots=[];task.lastError='';
}
function runAction_(req){
  var ss=book_(),info=checkAccess_(ss,req.actor),item=readState_(ss,req.actor,true);
  var p=item.profile,sh=stateSheet_(ss),action=String(req.action||''),d=req.data||{};
  var dirty=false;
  if(p.externalId!==req.actor.externalId){p.externalId=req.actor.externalId;dirty=true;}
  if(action==='load'||action==='sync'){
    if(dirty)saveState_(sh,item.row,p,info.email);
    return {view:publicView_(p,info,req.actor.externalId),sync:action==='sync'};
  }
  if(action==='setDefaultTime'){
    if(!validTime_(d.time))throw fail_('BAD_REQUEST','Giờ không hợp lệ.');
    if(p.defaultTime!==d.time){p.defaultTime=d.time;dirty=true;}
    if(dirty)saveState_(sh,item.row,p,info.email);
    return {view:publicView_(p,info,req.actor.externalId),sync:false};
  }
  if(action==='save'){
    var title=String(d.title||'').trim(),due=String(d.dueDate||''),time=String(d.time||'');
    if(!title||title.length>90||!validDay_(due)||!validTime_(time))throw fail_('BAD_REQUEST','Kiểm tra lại tên, ngày và giờ công việc.');
    if(due<vnToday_()||dateMs_(due,time,0)<=Date.now()+30000)throw fail_('BAD_REQUEST','Ngày/giờ đến hạn phải còn ở tương lai.');
    if(dateMs_(due,time,0)>Date.now()+3*366*DAY_MS)throw fail_('BAD_REQUEST','Chỉ được đăng ký tối đa 3 năm trong tương lai.');
    var existing=d.id?p.tasks.find(function(t){return t.id===d.id&&!t.deleted;}):null;
    if(d.id&&!existing)throw fail_('BAD_REQUEST','Không tìm thấy công việc cần sửa.');
    if(p.tasks.some(function(t){return !t.deleted&&t.id!==(existing&&existing.id)&&
      t.title.toLowerCase()===title.toLowerCase()&&t.dueDate===due&&t.time===time;}))
      throw fail_('CONFLICT','Bạn đã đăng ký công việc này với cùng ngày và giờ.');
    if(!existing&&p.tasks.filter(function(t){return !t.deleted&&t.dueDate>=vnToday_();}).length>=MAX_ACTIVE)
      throw fail_('BAD_REQUEST','Tài khoản đang có quá nhiều lịch nhắc (50). Hãy xóa những lịch không cần thiết.');
    if(existing&&existing.title===title&&existing.dueDate===due&&existing.time===time){
      if(dirty)saveState_(sh,item.row,p,info.email);
      return {view:publicView_(p,info,req.actor.externalId),sync:false};
    }
    if(existing)prepareCancellation_(p,existing);
    var task=existing||{id:Utilities.getUuid()};
    task.title=title;task.dueDate=due;task.time=time;task.deleted=false;task.lastError='';task.slots=slotsFor_(task);
    if(!existing)p.tasks.push(task);
    saveState_(sh,item.row,p,info.email);
    var view=publicView_(p,info,req.actor.externalId);
    view.notice='Đã lưu công việc. Lịch nhắc được xử lý tự động.';
    return {view:view,sync:true};
  }
  if(action==='remove'){
    var target=p.tasks.find(function(t){return t.id===d.id&&!t.deleted;});
    if(!target)throw fail_('BAD_REQUEST','Không tìm thấy công việc cần xóa.');
    prepareCancellation_(p,target);target.deleted=true;
    saveState_(sh,item.row,p,info.email);
    var out=publicView_(p,info,req.actor.externalId);
    out.notice=p.cancellations.length?'Đã ẩn công việc. Một số lệnh hủy sẽ được thử lại tự động.':'Đã xóa công việc.';
    return {view:out,sync:true};
  }
  throw fail_('BAD_REQUEST','Hành động không được hỗ trợ.');
}
function oneSignal_(method,path,body){
  var opts={method:method,headers:{Authorization:'Key '+prop_('ONESIGNAL_REST_API_KEY')},muteHttpExceptions:true};
  if(body){opts.contentType='application/json';opts.payload=JSON.stringify(body);}
  var resp=UrlFetchApp.fetch('https://api.onesignal.com'+path,opts);
  var code=resp.getResponseCode(),raw=resp.getContentText(),out={};
  try{out=JSON.parse(raw);}catch(_){}
  if(code<200||code>=300){
    if(method==='delete'&&code===404)return {success:true};
    throw new Error('OneSignal HTTP '+code+': '+String(out.errors||out.message||raw).slice(0,140));
  }
  return out;
}
function createNotification_(slot,task,externalId){
  var label=slot.offset===0?'Hôm nay đến hạn':'Còn '+slot.offset+' ngày đến hạn';
  return oneSignal_('post','/notifications',{
    app_id:prop_('ONESIGNAL_APP_ID'),target_channel:'push',include_aliases:{external_id:[externalId]},
    headings:{en:'Nhắc việc KPI'},contents:{en:label+' ('+vnDay_(task.dueDate)+'): '+task.title.slice(0,48)},
    url:prop_('WEB_URL'),send_after:new Date(slot.at).toISOString(),idempotency_key:slot.key
  });
}
function cancelNotification_(id){
  return oneSignal_('delete','/notifications/'+encodeURIComponent(id)+'?app_id='+encodeURIComponent(prop_('ONESIGNAL_APP_ID')));
}
function findSlot_(p,key){
  for(var i=0;i<p.cancellations.length;i++)if(p.cancellations[i].key===key)return {slot:p.cancellations[i],type:'cancel',parent:null};
  for(var j=0;j<p.tasks.length;j++)for(var k=0;k<(p.tasks[j].slots||[]).length;k++)
    if(p.tasks[j].slots[k].key===key)return {slot:p.tasks[j].slots[k],type:'create',parent:p.tasks[j]};
  return null;
}
/* Reserve up to maxCount operations in ONE short lock, before contacting OneSignal.
 * Record 'attempted' durably: any concurrent edit queues reconciliation instead of losing a live push.
 */
function claimJobs_(sh,row,email,maxCount,force){
  var content=String(sh.getRange(row,3).getValue()||''),p=normalizeState_(content?JSON.parse(content):newState_());
  var now=Date.now(),horizon=now+DAYS_AHEAD*DAY_MS, jobs=[],changed=false,hasCancellation=false;
  for(var i=p.cancellations.length-1;i>=0;i--){
    if(p.cancellations[i].at<=now+30000){p.cancellations.splice(i,1);changed=true;}
  }
  for(var a=0;a<p.cancellations.length&&jobs.length<maxCount;a++){
    var c=p.cancellations[a];hasCancellation=true;
    if(c.leaseUntil&&c.leaseUntil>now)continue;
    if(c.nextRetryAt&&c.nextRetryAt>now&&!force)continue;
    if(!c.id&&!c.attempted&&!c.nextRetryAt){p.cancellations.splice(a--,1);changed=true;continue;}
    c.attempted=true;c.leaseUntil=now+CLAIM_MS;changed=true;
    jobs.push({key:c.key,kind:c.id?'cancel':'reconcile',slot:JSON.parse(JSON.stringify(c)),task:{title:c.title,dueDate:c.dueDate},externalId:c.externalId});
  }
  if(p.cancellations.length)hasCancellation=true;
  if(!hasCancellation){
    for(var j=0;j<p.tasks.length&&jobs.length<maxCount;j++){
      var t=p.tasks[j];if(t.deleted)continue;
      for(var k=0;k<(t.slots||[]).length&&jobs.length<maxCount;k++){
        var s=t.slots[k];
        if(s.id||s.at<=now+60000||s.at>horizon||(s.leaseUntil&&s.leaseUntil>now)||
          (s.nextRetryAt&&s.nextRetryAt>now&&!force))continue;
        s.attempted=true;s.leaseUntil=now+CLAIM_MS;changed=true;
        jobs.push({key:s.key,kind:'create',slot:JSON.parse(JSON.stringify(s)),task:{title:t.title,dueDate:t.dueDate},externalId:p.externalId});
      }
    }
  }
  if(changed)saveState_(sh,row,p,email);
  return jobs;
}
/* Finalize against CURRENT state: edits/deletes may have moved the slot to cancellations. */
function finishJobs_(sh,row,email,results){
  var content=String(sh.getRange(row,3).getValue()||''),p=normalizeState_(content?JSON.parse(content):newState_());
  var now=Date.now(),changed=false;
  results.forEach(function(r){
    var found=findSlot_(p,r.key);if(!found)return;
    var s=found.slot;
    if(s.leaseUntil!==r.leaseUntil)return; // A different worker owns this lease.
    s.leaseUntil=0;changed=true;
    if(r.error){
      s.nextRetryAt=now+(r.kind==='cancel'||r.kind==='reconcile'?3:2)*CLOCK_MS;
      if(found.parent)found.parent.lastError='Chưa lên lịch được: '+String(r.error).slice(0,90);
      return;
    }
    if(r.kind==='cancel'){
      if(found.type==='cancel')p.cancellations=p.cancellations.filter(function(x){return x.key!==r.key;});
      return;
    }
    if(r.id){s.id=r.id;s.nextRetryAt=0;if(found.parent)found.parent.lastError='';}
    else {
      // Confirmed API response without an ID: no scheduled push to cancel.
      s.nextRetryAt=now+6*CLOCK_MS;
      if(found.parent)found.parent.lastError='Chưa có thiết bị nhận push hợp lệ; hãy bật thông báo.';
      if(found.type==='cancel')p.cancellations=p.cancellations.filter(function(x){return x.key!==r.key;});
      return;
    }
    // A previously in-flight create may now live in the cancellation queue.
    if(found.type==='cancel')s.nextRetryAt=0;
  });
  if(changed)saveState_(sh,row,p,email);
}
function performJobs_(jobs){
  return jobs.map(function(j){
    var result={key:j.key,leaseUntil:j.slot.leaseUntil,kind:j.kind,id:'',error:''};
    try{
      if(j.kind==='cancel')cancelNotification_(j.slot.id);
      else {
        var response=createNotification_(j.slot,j.task,j.externalId);
        result.id=String(response.id||'');
      }
    }catch(err){result.error=String(err.message||err);console.error('OneSignal '+j.kind+': '+result.error);}
    return result;
  });
}
/* For interactive requests: only one short reserved batch; preserve limited API budget.
 * The hourly trigger handles pending retries/remaining slots.
 */
function syncAccount_(actor,maxCalls,force){
  var jobContext=withLock_(function(){
    var ss=book_(),info=checkAccess_(ss,actor),item=readState_(ss,actor,false);
    if(!item)return null;
    return {row:item.row,email:info.email,jobs:claimJobs_(stateSheet_(ss),item.row,info.email,maxCalls,force)};
  });
  if(!jobContext||!jobContext.jobs.length)return;
  var results=performJobs_(jobContext.jobs); // No script lock while calling network!
  withLock_(function(){
    var ss=book_();finishJobs_(stateSheet_(ss),jobContext.row,jobContext.email,results);
  });
}
function doPost(e){
  try{
    if(!e||!e.postData||!e.postData.contents||e.postData.contents.length>16000)
      throw fail_('BAD_REQUEST','Yêu cầu trống hoặc quá lớn.');
    var envelope=JSON.parse(e.postData.contents),request;
    var result=withLock_(function(){
      request=validateEnvelope_(envelope); // HMAC nonce check is atomic with the user action.
      return runAction_(request);
    });
    // Always commit the user's action before attempting network I/O.
    if(result.sync){
      try{syncAccount_(request.actor,4,request.action==='sync');}catch(syncErr){console.error('Deferred sync:',syncErr.message||syncErr);}
      // The latest view can be refreshed with a read. Avoid a duplicate Sheets read on each write;
      // hourly sync retries in the background. Frontend explicitly labels pending work.
    }
    return jsonOutput_({ok:true,result:result.view});
  }catch(err){
    console.error('doPost:',err&&err.stack||err);
    return jsonOutput_({ok:false,code:err&&err.clientCode||'SERVER',error:err&&err.clientMessage||'Không thể xử lý. Vui lòng thử lại hoặc liên hệ quản trị viên.'});
  }
}
/** A single hourly trigger, fair circular iteration. No per-user triggers. */
function syncScheduledNotifications(){
  var start=Date.now(),ss=book_(),sh=stateSheet_(ss),last=sh.getLastRow();
  if(last<2)return;
  var rows=sh.getRange(2,1,last-1,4).getValues(),allowed={};
  accessRows_(ss).forEach(function(r){if(enabled_(r[2]))allowed[String(r[0]).trim().toLowerCase()]=true;});
  var props=PropertiesService.getScriptProperties();
  var n=rows.length,cursor=Number(props.getProperty('SYNC_CURSOR')||'0');
  if(!isFinite(cursor)||cursor<0)cursor=0;
  cursor=cursor%n;
  var budget=35,processed=0;
  for(var step=0;step<n&&budget>0&&Date.now()-start<220000;step++){
    var idx=(cursor+step)%n,src=rows[idx];processed=step+1;
    if(!src||!src[2])continue;
    var row=idx+2,email=String(src[1]||'').trim().toLowerCase(),claimed=[];
    var snapshot;
    try{snapshot=normalizeState_(JSON.parse(String(src[2])));}catch(parseErr){console.error('JSON lỗi dòng '+row);continue;}
    var now=Date.now(),horizon=now+DAYS_AHEAD*DAY_MS;
    var needCancel=snapshot.cancellations.some(function(c){return c.at<=now+30000 || (
      (!c.leaseUntil||c.leaseUntil<=now)&&(!c.nextRetryAt||c.nextRetryAt<=now));});
    var needCreate=!snapshot.cancellations.length&&snapshot.tasks.some(function(t){return !t.deleted&&(t.slots||[]).some(function(s){
      return !s.id&&s.at>now+60000&&s.at<=horizon&&(!s.leaseUntil||s.leaseUntil<=now)&&(!s.nextRetryAt||s.nextRetryAt<=now);
    });});
    var needRevoke=!allowed[email]&&snapshot.tasks.some(function(t){return !t.deleted;});
    var needClean=!snapshot.cancellations.length&&snapshot.tasks.some(function(t){
      return t.deleted||dateMs_(t.dueDate,t.time,0)<=now-30*DAY_MS;
    });
    if(!needCancel&&!needCreate&&!needRevoke&&!needClean)continue;
    try{
      claimed=withLock_(function(){
        var raw=String(sh.getRange(row,3).getValue()||'');if(!raw)return [];
        var p=normalizeState_(JSON.parse(raw)),changed=false;
        if(!allowed[email])p.tasks.forEach(function(t){if(!t.deleted){prepareCancellation_(p,t);t.deleted=true;changed=true;}});
        if(!p.cancellations.length){
          var oldLength=p.tasks.length;
          p.tasks=p.tasks.filter(function(t){return !t.deleted&&dateMs_(t.dueDate,t.time,0)>Date.now()-30*DAY_MS;});
          if(oldLength!==p.tasks.length)changed=true;
        }
        if(changed)saveState_(sh,row,p,email);
        return claimJobs_(sh,row,email,Math.min(budget,4),false);
      },1800);
      if(!claimed.length)continue;
      var results=performJobs_(claimed);budget-=claimed.length;
      withLock_(function(){finishJobs_(sh,row,email,results);},1800);
    }catch(err){console.error('Trigger row '+row+': '+String(err.message||err));}
  }
  // Advance even when there is no pending work, to rotate load across 140 users.
  props.setProperty('SYNC_CURSOR',String((cursor+processed)%n));
}
