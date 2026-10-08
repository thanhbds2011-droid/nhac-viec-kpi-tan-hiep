/**
 * NHẮC VIỆC KPI - TÂN HIỆP / Apps Script backend
 * - 01 OneSignal app; mỗi Google sub có External ID riêng do API Vercel tạo.
 * - Mỗi tài khoản một ô JSON: chỉ đọc/ghi trạng thái tài khoản đó khi thao tác.
 * - Lịch OneSignal được đặt trước; trigger mỗi giờ chỉ lập lịch bổ sung / thử lại.
 * - Tuyệt đối không đặt bí mật trong GitHub hoặc mã trình duyệt.
 * Script timezone: Asia/Ho_Chi_Minh.
 */
var SHEET_ACCESS = 'Access';
var SHEET_STATE = 'State';
var VN_ZONE = 'Asia/Ho_Chi_Minh';
var DAYS_AHEAD = 7;
var MAX_ACTIVE = 50;
var MAX_JSON_CHARS = 45000;
var CLOCK_MS = 3600000;
var DAY_MS = 86400000;

/** Chạy một lần từ Editor sau khi điền Script Properties. */
function setupProject() {
  var props = PropertiesService.getScriptProperties();
  ['SHEET_ID', 'SHARED_SECRET', 'ONESIGNAL_APP_ID', 'ONESIGNAL_REST_API_KEY', 'WEB_URL']
    .forEach(function(k) { if (!props.getProperty(k)) throw new Error('Chưa đặt Script Property: ' + k); });
  var ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  var a = ss.getSheetByName(SHEET_ACCESS) || ss.insertSheet(SHEET_ACCESS);
  var s = ss.getSheetByName(SHEET_STATE) || ss.insertSheet(SHEET_STATE);
  if (a.getLastRow() === 0) a.appendRow(['Email', 'Họ tên', 'Active', 'Role']);
  if (s.getLastRow() === 0) s.appendRow(['Google Sub', 'Email', 'JSON State', 'Updated At']);
  a.setFrozenRows(1); s.setFrozenRows(1);
  var present = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === 'syncScheduledNotifications';
  });
  if (!present) ScriptApp.newTrigger('syncScheduledNotifications').timeBased().everyHours(1).create();
  Logger.log('Sẵn sàng. Thêm tài khoản vào Access! Chỉ cần một trigger syncScheduledNotifications.');
}

/** Web app - chỉ nhận thông điệp đã ký bởi API Vercel. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    if (!e || !e.postData || !e.postData.contents || e.postData.contents.length > 16000) {
      throw fail_('BAD_REQUEST', 'Yêu cầu trống hoặc quá lớn.');
    }
    lock.waitLock(28000);
    var envelope = JSON.parse(e.postData.contents);
    var data = validateEnvelope_(envelope);
    var result = runAction_(data);
    return jsonOutput_({ok: true, result: result});
  } catch (err) {
    console.error('doPost', err && err.stack || err);
    return jsonOutput_({ok: false, code: err && err.clientCode || 'SERVER', error: err && err.clientMessage || 'Không thể xử lý. Vui lòng thử lại hoặc liên hệ quản trị viên.'});
  } finally { try { lock.releaseLock(); } catch (_) {} }
}
function jsonOutput_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(code, msg) { var e = new Error(msg); e.clientCode = code; e.clientMessage = msg; return e; }
function prop_(key) { return PropertiesService.getScriptProperties().getProperty(key) || ''; }
function b64u_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, ''); }
function validateEnvelope_(o) {
  if (!o || !Number.isFinite(Number(o.ts)) || !/^[0-9a-f-]{36}$/.test(String(o.nonce || '')) ||
      !/^[A-Za-z0-9_-]+$/.test(String(o.encoded || '')) || !/^[A-Za-z0-9_-]+$/.test(String(o.signature || ''))) {
    throw fail_('BAD_REQUEST', 'Cấu trúc yêu cầu không hợp lệ.');
  }
  if (Math.abs(Date.now() - Number(o.ts)) > 120000) throw fail_('FORBIDDEN', 'Yêu cầu đã quá hạn.');
  var signText = String(o.ts) + '.' + o.nonce + '.' + o.encoded;
  var computed = b64u_(Utilities.computeHmacSha256Signature(signText, prop_('SHARED_SECRET')));
  // So sánh cố định chiều dài, không dùng ==.
  if (computed.length !== o.signature.length) throw fail_('FORBIDDEN', 'Chữ ký không hợp lệ.');
  var diff = 0;
  for (var i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ o.signature.charCodeAt(i);
  if (diff !== 0) throw fail_('FORBIDDEN', 'Chữ ký không hợp lệ.');
  var nonceKey = 'v1_nonce_' + o.nonce;
  var cache = CacheService.getScriptCache();
  if (cache.get(nonceKey)) throw fail_('FORBIDDEN', 'Yêu cầu trùng lặp.');
  cache.put(nonceKey, '1', 150);
  var data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(o.encoded)).getDataAsString('UTF-8'));
  if (!data || !data.actor || !/^[A-Za-z0-9_-]{5,140}$/.test(String(data.actor.subject || '')) ||
      !/^th_[a-f0-9]{44}$/.test(String(data.actor.externalId || '')) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.actor.email || ''))) {
    throw fail_('FORBIDDEN', 'Thông tin xác thực không hợp lệ.');
  }
  return data;
}
function book_() { return SpreadsheetApp.openById(prop_('SHEET_ID')); }
function checkAccess_(ss, actor) {
  var sheet = ss.getSheetByName(SHEET_ACCESS);
  if (!sheet || sheet.getLastRow() < 2) throw fail_('FORBIDDEN', 'Chưa có tài khoản được cấp quyền.');
  var entries = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getDisplayValues();
  var email = String(actor.email).toLowerCase();
  for (var i = 0; i < entries.length; i++) {
    if (String(entries[i][0]).trim().toLowerCase() !== email) continue;
    var active = String(entries[i][2]).trim().toUpperCase();
    if (['YES','TRUE','1','CÓ','CO','ACTIVE'].indexOf(active) === -1) {
      throw fail_('FORBIDDEN', 'Tài khoản chưa được kích hoạt hoặc đã bị thu hồi quyền.');
    }
    return { email: email, name: String(entries[i][1]).trim() || String(actor.name || '').slice(0,80) || email };
  }
  throw fail_('FORBIDDEN', 'Tài khoản Google này chưa có trong danh sách Access.');
}
function stateSheet_(ss) { var sh = ss.getSheetByName(SHEET_STATE); if(!sh)throw new Error('Chưa chạy setupProject'); return sh; }
function newState_() { return { defaultTime:'07:30', externalId:'', tasks:[], cancellations:[] }; }
function readState_(ss, actor) {
  var sh = stateSheet_(ss);
  var finder = sh.getRange('A:A').createTextFinder(String(actor.subject)).matchEntireCell(true).findNext();
  if (!finder) {
    var row = sh.getLastRow() + 1;
    var fresh = newState_();
    sh.getRange(row,1,1,4).setValues([[String(actor.subject),String(actor.email),JSON.stringify(fresh),new Date()]]);
    return {row:row,profile:fresh};
  }
  var rowIndex=finder.getRow();
  var content=String(sh.getRange(rowIndex,3).getValue()||'');
  var value=content ? JSON.parse(content) : newState_();
  if (!Array.isArray(value.tasks))value.tasks=[];
  if (!Array.isArray(value.cancellations))value.cancellations=[];
  if (!validTime_(value.defaultTime))value.defaultTime='07:30';
  return {row:rowIndex,profile:value};
}
function saveState_(sheet, row, profile, email) {
  var json=JSON.stringify(profile);
  if (json.length > MAX_JSON_CHARS) throw fail_('BAD_REQUEST','Số lượng dữ liệu vượt giới hạn. Liên hệ quản trị viên.');
  sheet.getRange(row,2,1,3).setValues([[email,json,new Date()]]);
}
function validDay_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var dt = new Date(s+'T00:00:00Z'); return !isNaN(dt.getTime()) && dt.toISOString().slice(0,10)===s;
}
function validTime_(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
function dateMs_(day,time,daysBefore) {
  var y=Number(day.slice(0,4)),m=Number(day.slice(5,7)),d=Number(day.slice(8,10));
  var h=Number(time.slice(0,2)),mi=Number(time.slice(3,5));
  return Date.UTC(y,m-1,d-daysBefore,h-7,mi,0,0);
}
function vnToday_() { return Utilities.formatDate(new Date(),VN_ZONE,'yyyy-MM-dd'); }
function vnDay_(s) { return s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4); }
function publicView_(profile, info, ext) {
  var now=Date.now(), horizon=now+DAYS_AHEAD*DAY_MS;
  return {
    email:info.email, name:info.name, externalId:ext, defaultTime:profile.defaultTime,
    tasks:profile.tasks.filter(function(t){return !t.deleted;}).map(function(t){
      var pending=(t.slots||[]).filter(function(s){return !s.id && s.at>now && s.at<=horizon;}).length;
      return {id:t.id,title:t.title,dueDate:t.dueDate,time:t.time,pending:pending,warning:profile.cancellations.length?'Đang chờ hủy một số thông báo cũ.':(t.lastError||'')};
    })
  };
}
function prepareCancellation_(profile, task) {
  (task.slots || []).forEach(function(s){
    if (s.at > Date.now() + 30000) profile.cancellations.push(Object.assign({}, s, {title:task.title,dueDate:task.dueDate,externalId:profile.externalId}));
  });
  task.slots=[]; task.lastError='';
}
function slotsFor_(task) {
  return [3,2,1,0].map(function(offset){return {
    key:Utilities.getUuid(),at:dateMs_(task.dueDate,task.time,offset),
    id:'',offset:offset,nextRetryAt:0
  };});
}
function runAction_(req) {
  var ss=book_(), info=checkAccess_(ss,req.actor), item=readState_(ss,req.actor);
  var sh=stateSheet_(ss), p=item.profile, action=String(req.action||''), d=req.data||{};
  if(p.externalId!==req.actor.externalId){p.externalId=req.actor.externalId;saveState_(sh,item.row,p,info.email);}
  if (action==='load')return publicView_(p,info,req.actor.externalId);
  if (action==='setDefaultTime') {
    if (!validTime_(d.time))throw fail_('BAD_REQUEST','Giờ không hợp lệ.');
    p.defaultTime=d.time; saveState_(sh,item.row,p,info.email);
    return publicView_(p,info,req.actor.externalId);
  }
  if(action==='save') {
    var title=String(d.title||'').trim(),due=String(d.dueDate||''),time=String(d.time||'');
    if(!title||title.length>90||!validDay_(due)||!validTime_(time))throw fail_('BAD_REQUEST','Kiểm tra lại tên, ngày và giờ công việc.');
    if(due<vnToday_() || dateMs_(due,time,0)<=Date.now()+30000)throw fail_('BAD_REQUEST','Ngày/giờ đến hạn phải còn ở tương lai.');
    if(dateMs_(due,time,0)>Date.now()+3*366*DAY_MS)throw fail_('BAD_REQUEST','Chỉ được đăng ký tối đa 3 năm trong tương lai.');
    var existing=d.id ? p.tasks.find(function(x){return x.id===d.id && !x.deleted;}) : null;
    if(d.id && !existing)throw fail_('BAD_REQUEST','Không tìm thấy công việc cần sửa.');
    if(p.tasks.some(function(x){return !x.deleted && x.id!==(existing&&existing.id) &&
        x.title.toLowerCase()===title.toLowerCase() && x.dueDate===due && x.time===time;})){
      throw fail_('CONFLICT','Bạn đã đăng ký công việc này với cùng ngày và giờ.');
    }
    if(!existing && p.tasks.filter(function(x){return !x.deleted && x.dueDate>=vnToday_();}).length>=MAX_ACTIVE)
      throw fail_('BAD_REQUEST','Tài khoản đang có quá nhiều lịch nhắc (50). Hãy xóa những lịch không cần thiết.');
    if(existing && existing.title===title && existing.dueDate===due && existing.time===time)
      return publicView_(p,info,req.actor.externalId);
    if(existing)prepareCancellation_(p,existing);
    var task=existing||{id:Utilities.getUuid()};
    task.title=title;task.dueDate=due;task.time=time;task.deleted=false;task.lastError='';
    task.slots=slotsFor_(task);
    if(!existing)p.tasks.push(task);
    saveState_(sh,item.row,p,info.email);
    syncState_(sh,item.row,p,info.email,9,false);
    var v=publicView_(p,info,req.actor.externalId);
    v.notice='Đã lưu. Các thông báo sẽ được lên lịch tự động; kiểm tra trạng thái bật push trên thiết bị.';
    return v;
  }
  if(action==='remove') {
    var target=p.tasks.find(function(x){return x.id===d.id && !x.deleted;});
    if(!target)throw fail_('BAD_REQUEST','Không tìm thấy lịch cần xóa.');
    prepareCancellation_(p,target);target.deleted=true;
    saveState_(sh,item.row,p,info.email);
    syncState_(sh,item.row,p,info.email,9,false);
    var out=publicView_(p,info,req.actor.externalId);
    out.notice=p.cancellations.length?'Đã ẩn lịch. Một số lệnh hủy đang chờ thử lại.':'Đã xóa lịch và xử lý hủy thông báo tương lai.';
    return out;
  }
  if(action==='sync') {
    syncState_(sh,item.row,p,info.email,10,true);
    return publicView_(p,info,req.actor.externalId);
  }
  throw fail_('BAD_REQUEST','Hành động không được hỗ trợ.');
}

function oneSignal_(method,path,body) {
  var api='https://api.onesignal.com'+path;
  var opts={method:method,headers:{Authorization:'Key '+prop_('ONESIGNAL_REST_API_KEY')},muteHttpExceptions:true};
  if(body){opts.contentType='application/json';opts.payload=JSON.stringify(body);}
  var resp=UrlFetchApp.fetch(api,opts);
  var code=resp.getResponseCode(), text=resp.getContentText(), out={};
  try{out=JSON.parse(text);}catch(_){}
  if (code<200 || code>=300) {
    if(method==='delete' && code===404)return {success:true};
    throw new Error('OneSignal HTTP '+code+': '+String(out.errors||out.message||text).slice(0,140));
  }
  return out;
}
function createNotification_(slot,task,externalId) {
  var remaining=slot.offset===0?'Hôm nay đến hạn':('Còn '+slot.offset+' ngày đến hạn');
  var title='Nhắc việc KPI';
  // Cố tình không gửi thông tin dài/nhạy cảm qua màn hình khóa.
  var body=remaining+' ('+vnDay_(task.dueDate)+'): '+task.title.slice(0,48);
  return oneSignal_('post','/notifications',{
    app_id:prop_('ONESIGNAL_APP_ID'),
    target_channel:'push',include_aliases:{external_id:[externalId]},
    headings:{en:title},contents:{en:body},
    url:prop_('WEB_URL'),
    send_after:new Date(slot.at).toISOString(),
    idempotency_key:slot.key
  });
}
function cancelNotification_(id) {
  return oneSignal_('delete','/notifications/'+encodeURIComponent(id)+'?app_id='+encodeURIComponent(prop_('ONESIGNAL_APP_ID')));
}
/** Chỉ gọi trong lúc giữ LockService (API hoặc trigger). Mỗi lần ghi lại trạng thái, kể cả trước khi gọi bên thứ ba. */
function syncState_(sheet,row,p,email,maxCalls,force) {
  var used=0,now=Date.now(),horizon=now+DAYS_AHEAD*DAY_MS;
  // Bắt buộc xử lý hủy trước: tránh lịch cũ và mới cùng tồn tại.
  for(var k=0;k<p.cancellations.length && used<maxCalls;) {
    var old=p.cancellations[k];
    if(old.at<=Date.now()+30000) {p.cancellations.splice(k,1);saveState_(sheet,row,p,email);continue;}
    try {
      if(!old.id) {
        if(old.nextRetryAt && old.nextRetryAt>Date.now() && !force)break;
        var original=createNotification_(old,old,old.externalId);used++;
        if(!original.id) { p.cancellations.splice(k,1);saveState_(sheet,row,p,email);continue; }
        old.id=original.id;saveState_(sheet,row,p,email);
      }
      cancelNotification_(old.id);used++;
      p.cancellations.splice(k,1);saveState_(sheet,row,p,email);
    }catch(err){console.error('Cancel:',err);old.nextRetryAt=Date.now()+3*CLOCK_MS;saveState_(sheet,row,p,email);return used;}
  }
  if(p.cancellations.length)return used;
  for(var a=0;a<p.tasks.length && used<maxCalls;a++){
    var t=p.tasks[a];if(t.deleted)continue;
    for(var j=0;j<t.slots.length && used<maxCalls;j++){
      var s=t.slots[j];
      if(s.id || s.at<=Date.now()+60000 || s.at>horizon)continue;
      if(s.nextRetryAt && s.nextRetryAt>Date.now() && !force)continue;
      // Lưu UUID idempotency từ lúc đăng ký, trước cả API call.
      try{
        var result=createNotification_(s,t,p.externalId);used++;
        if(!result.id){
          t.lastError='Chưa có thiết bị nhận push hợp lệ; hãy bật thông báo trên điện thoại.';
          s.nextRetryAt=Date.now()+6*CLOCK_MS;
          saveState_(sheet,row,p,email);break;
        }
        s.id=result.id;s.nextRetryAt=0;t.lastError='';
        saveState_(sheet,row,p,email);
      }catch(err){
        console.error('Create:',err);used++;
        t.lastError='Chưa lên lịch được: '+String(err.message||err).slice(0,90);
        s.nextRetryAt=Date.now()+2*CLOCK_MS;
        saveState_(sheet,row,p,email);break;
      }
    }
  }
  return used;
}
/** Một trigger duy nhất, chạy mỗi giờ. KHÔNG tạo trigger cho từng nhân viên/công việc. */
function syncScheduledNotifications() {
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(1000)){console.log('Đang có yêu cầu khác, bỏ qua lượt đồng bộ này.');return;}
  try {
    var sh=stateSheet_(book_()),last=sh.getLastRow();
    if(last<2)return;
    // Trigger chỉ đọc một lần tất cả các tài khoản (~140 dòng), không polling từ trình duyệt.
    var rows=sh.getRange(2,1,last-1,4).getValues(),budget=35,started=Date.now();
    // Kiểm tra lại Access mỗi giờ: tài khoản bị vô hiệu hóa phải hủy lịch đã hẹn.
    var accessSheet=book_().getSheetByName(SHEET_ACCESS);
    var permissions=accessSheet.getLastRow()<2?[]:accessSheet.getRange(2,1,accessSheet.getLastRow()-1,4).getDisplayValues();
    var allowed={};
    permissions.forEach(function(r){
      if(['YES','TRUE','1','CÓ','CO','ACTIVE'].indexOf(String(r[2]).trim().toUpperCase())!==-1)
        allowed[String(r[0]).trim().toLowerCase()]=true;
    });
    for(var i=0;i<rows.length && budget>0 && Date.now()-started<240000;i++){
      var json=String(rows[i][2]||'');if(!json)continue;
      var p;
      try{p=JSON.parse(json);}catch(err){console.error('JSON không hợp lệ dòng '+(i+2));continue;}
      if(!Array.isArray(p.tasks))continue;
      if(!Array.isArray(p.cancellations))p.cancellations=[];
      if(!allowed[String(rows[i][1]).trim().toLowerCase()]){
        var changed=false;
        p.tasks.forEach(function(t){if(!t.deleted){prepareCancellation_(p,t);t.deleted=true;changed=true;}});
        if(changed)saveState_(sh,i+2,p,String(rows[i][1]));
      }
      var needs=false;
      if(p.cancellations.length)needs=true;
      else p.tasks.forEach(function(t){if(t.deleted)return;(t.slots||[]).forEach(function(s){
        if(!s.id && s.at>Date.now()+60000 && s.at<Date.now()+DAYS_AHEAD*DAY_MS && (!s.nextRetryAt||s.nextRetryAt<=Date.now()))needs=true;
      });});
      if(needs)budget-=syncState_(sh,i+2,p,String(rows[i][1]),budget,false);
      // Loại bỏ việc đã kết thúc quá 30 ngày để Google Sheets không phình to.
      if(!p.cancellations.length){
        var original=p.tasks.length;
        p.tasks=p.tasks.filter(function(t){return t.deleted?false:dateMs_(t.dueDate,t.time,0)>Date.now()-30*DAY_MS;});
        if(p.tasks.length!==original)saveState_(sh,i+2,p,String(rows[i][1]));
      }
    }
  }catch(err){console.error('syncScheduledNotifications:',err.stack||err);throw err;}
  finally{lock.releaseLock();}
}
