/**
 * NHẮC VIỆC KPI – TÂN HIỆP | production v1.6.0
 * Google Sheets Access/State unchanged. Single OneSignal application.
 * Never call OneSignal while holding the shared script lock.
 * Durable claim + idempotency key protects concurrent edits and uncertain responses.
 * Time zone: Asia/Ho_Chi_Minh.
 */
var SHEET_ACCESS='Access'; // Bản gốc giữ lại để sao lưu và quay lại khi cần.
var SHEET_USERS='Tài khoản';
var SHEET_DEPARTMENTS='Quản lý Phòng-Khu'; // Không dùng dấu / trong tên tab.
var SHEET_STATE='State';
var ACCOUNT_SCHEMA_KEY='ACCOUNT_SCHEMA'; // LEGACY / VI; mặc định LEGACY.
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
  var a=ss.getSheetByName(isVietnameseSchema_()?SHEET_USERS:SHEET_ACCESS);
  if(!a){
    if(isVietnameseSchema_())throw new Error('Không tìm thấy tab Tài khoản. Không tự tạo bảng mới.');
    a=ss.insertSheet(SHEET_ACCESS); // Giữ tương thích hành vi setupProject v1.5.0 trên hệ thống mới.
  }
  var s=ss.getSheetByName(SHEET_STATE)||ss.insertSheet(SHEET_STATE);
  if(a.getLastRow()===0)a.appendRow(['Email','Họ tên','Active','Role']);
  if(s.getLastRow()===0)s.appendRow(['Google Sub','Email','JSON State','Updated At']);
  a.setFrozenRows(1);s.setFrozenRows(1);
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='syncScheduledNotifications';}))
    ScriptApp.newTrigger('syncScheduledNotifications').timeBased().everyHours(1).create();
}

/**
 * Quy trình nâng cấp V1.6.0 chỉ chạy do người quản trị chủ động:
 * (1) prepareVietnameseAdminSheets, điền mã Phòng/Khu; (2) validateVietnameseAdminSheets;
 * (3) activateVietnameseAdminSheets. Không bao giờ tự kích hoạt khi deploy.
 */
function configureAdminView_(sheet,widths){
  sheet.setFrozenRows(1);
  var h=sheet.getRange(1,1,1,widths.length);
  h.setBackground('#1e3a5f').setFontColor('#ffffff').setFontWeight('bold');
  widths.forEach(function(w,i){sheet.setColumnWidth(i+1,w);});
  if(!sheet.getFilter())sheet.getRange(1,1,Math.max(sheet.getLastRow(),2),widths.length).createFilter();
}
function prepareVietnameseAdminSheets(){
  if(isVietnameseSchema_())throw new Error('Bảng tiếng Việt đã kích hoạt. Không chuẩn bị lại.');
  var ss=book_(),legacy=ss.getSheetByName(SHEET_ACCESS);
  if(!legacy)throw new Error('Không thấy Access cũ. Dừng chuyển đổi để bảo vệ tài khoản.');
  if(ss.getSheetByName(SHEET_USERS)||ss.getSheetByName(SHEET_DEPARTMENTS))
    throw new Error('Đã có tab chuẩn bị. Không ghi đè; hãy kiểm tra và tiếp tục cấu hình hiện có.');
  var users=ss.insertSheet(SHEET_USERS),dept=ss.insertSheet(SHEET_DEPARTMENTS);
  var count=Math.max(0,legacy.getLastRow()-1),old=count?legacy.getRange(2,1,count,5).getDisplayValues():[];
  users.getRange(1,1,1,6).setValues([['Email đăng nhập','Họ và tên','Trạng thái','Vai trò','Mã Phòng/Khu','Email quản lý cũ (đối chiếu)']]);
  if(old.length){
    users.getRange(2,1,old.length,6).setValues(old.map(function(r){return [r[0],r[1],enabled_(r[2])?'Hoạt động':'Ngừng hoạt động',roleLabel_(r[3]),'',r[4]||''];}));
  }
  dept.getRange(1,1,1,5).setValues([['Mã Phòng/Khu','Tên Phòng/Khu','Email Trưởng phòng/Khu','Email Phó thứ nhất (tùy chọn)','Email Phó thứ hai (tùy chọn)']]);
  configureAdminView_(users,[270,220,160,190,160,280]);
  configureAdminView_(dept,[140,250,290,260,260]);
  users.getRange(2,3,users.getMaxRows()-1,1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Hoạt động','Ngừng hoạt động'],true).setAllowInvalid(false).build());
  users.getRange(2,4,users.getMaxRows()-1,1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Nhân viên','Phó Trưởng phòng/Khu','Trưởng phòng/Khu','Quản trị viên'],true).setAllowInvalid(false).build());
  users.getRange(2,5,users.getMaxRows()-1,1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(dept.getRange(2,1,dept.getMaxRows()-1,1),true).setAllowInvalid(false).build());
  users.getRange(1,5).setNote('Nhập đúng mã đã khai báo tại tab Quản lý Phòng-Khu. Không nhập email Trưởng phòng vào đây.');
  users.getRange(1,6).setNote('Giữ lại email quản lý từ cột E của Access cũ để đối chiếu. Không dùng cột này để gửi thông báo.');
  if(users.hideColumns)users.hideColumns(6);
  dept.getRange(1,3).setNote('Một email Trưởng phòng/Khu có thể quản lý tất cả tài khoản cùng mã Phòng/Khu. Email phải có trong tab Tài khoản và có đúng vai trò Trưởng phòng/Khu.');
  // Không sửa tab State, không tự chuyển chế độ, Access cũ vẫn đang cấp quyền khi chuẩn bị.
  SpreadsheetApp.flush();
  return 'Đã tạo tab Tài khoản và Quản lý Phòng-Khu. Access và State còn nguyên. Hãy điền mã đơn vị và kiểm tra trước khi kích hoạt.';
}
function roleLabel_(role){
  var kind=roleKind_(role);
  return kind==='MANAGER'?'Trưởng phòng/Khu':kind==='VICE'?'Phó Trưởng phòng/Khu':kind==='ADMIN'?'Quản trị viên':kind==='EMPLOYEE'?'Nhân viên':String(role||'');
}
function validateVietnameseAdminSheets(){
  var ss=book_(),u=ss.getSheetByName(SHEET_USERS),d=ss.getSheetByName(SHEET_DEPARTMENTS),problems=[];
  if(!u||!d)return {ok:false,errors:['Thiếu tab Tài khoản hoặc Quản lý Phòng-Khu. Chạy hàm chuẩn bị trước.']};
  var users=u.getLastRow()>1?u.getRange(2,1,u.getLastRow()-1,5).getDisplayValues():[];
  var units=d.getLastRow()>1?d.getRange(2,1,d.getLastRow()-1,5).getDisplayValues():[];
  var emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/,byEmail={},byUnit={};
  users.forEach(function(r,i){
    if(!r.some(function(v){return String(v).trim();}))return;
    var email=String(r[0]||'').trim().toLowerCase(),kind=roleKind_(r[3]);
    if(!emailPattern.test(email))problems.push('Tài khoản dòng '+(i+2)+': email không hợp lệ.');
    if(byEmail[email])problems.push('Tài khoản dòng '+(i+2)+': email bị trùng.');
    byEmail[email]={email:email,role:kind,active:enabled_(r[2]),unit:String(r[4]||'').trim()};
    if(!kind)problems.push('Tài khoản dòng '+(i+2)+': vai trò chưa hợp lệ.');
    if(['HOAT DONG','NGUNG HOAT DONG'].indexOf(textKey_(r[2]))===-1)
      problems.push('Tài khoản dòng '+(i+2)+': trạng thái phải là Hoạt động hoặc Ngừng hoạt động.');
    if(enabled_(r[2])&&kind!=='ADMIN'&&!String(r[4]||'').trim())
      problems.push('Tài khoản dòng '+(i+2)+': chưa chọn mã Phòng/Khu.');
  });
  units.forEach(function(r,i){
    if(!r.some(function(v){return String(v).trim();}))return;
    var key=String(r[0]||'').trim(),manager=String(r[2]||'').trim().toLowerCase();
    if(!key||!String(r[1]||'').trim())problems.push('Phòng/Khu dòng '+(i+2)+': thiếu mã hoặc tên.');
    if(byUnit[key])problems.push('Phòng/Khu dòng '+(i+2)+': mã Phòng/Khu bị trùng.');
    byUnit[key]=true;
    var m=byEmail[manager];
    if(!m||!m.active||m.role!=='MANAGER'||m.unit!==key)
      problems.push('Phòng/Khu '+(key||i+2)+': email Trưởng phòng không hợp lệ, chưa kích hoạt hoặc sai đơn vị/vai trò.');
    [3,4].forEach(function(j){
      var deputy=String(r[j]||'').trim().toLowerCase();if(!deputy)return;
      var p=byEmail[deputy];
      if(!p||!p.active||p.role!=='VICE'||p.unit!==key||deputy===manager)
        problems.push('Phòng/Khu '+key+': email Phó Trưởng phòng/Khu không hợp lệ.');
    });
    if(r[3]&&String(r[3]).trim().toLowerCase()===String(r[4]||'').trim().toLowerCase())
      problems.push('Phòng/Khu '+key+': trùng email hai Phó Trưởng phòng.');
  });
  Object.keys(byEmail).forEach(function(email){
    var a=byEmail[email];
    if(a.active&&a.role!=='ADMIN'&&!byUnit[a.unit])problems.push('Tài khoản '+email+': mã Phòng/Khu không tồn tại.');
  });
  if(!users.length||!units.length)problems.push('Chưa nhập đủ danh sách tài khoản hoặc Phòng/Khu.');
  return {ok:problems.length===0,errors:problems,accounts:Object.keys(byEmail).length,units:Object.keys(byUnit).length};
}
function activateVietnameseAdminSheets(){
  return withLock_(function(){
    if(isVietnameseSchema_())return 'Đã sử dụng giao diện tiếng Việt; không cần kích hoạt lại.';
    var ss=book_(),check=validateVietnameseAdminSheets();
    if(!check.ok)throw new Error('Chưa thể kích hoạt. Có '+check.errors.length+' vấn đề: '+check.errors.slice(0,12).join(' | '));
    PropertiesService.getScriptProperties().setProperty(ACCOUNT_SCHEMA_KEY,'VI');
    var old=ss.getSheetByName(SHEET_ACCESS);
    try{if(old&&old.hideSheet)old.hideSheet();}catch(e){console.error('Không ẩn được Access dự phòng:',e);}
    var state=ss.getSheetByName(SHEET_STATE);
    try{if(state&&state.getProtections&&state.protect&&state.getProtections(SpreadsheetApp.ProtectionType.SHEET).length===0)
      state.protect().setDescription('Dữ liệu nhiệm vụ - không chỉnh sửa trực tiếp').setWarningOnly(true);
    }catch(e){console.error('Không bật được cảnh báo bảo vệ State:',e);}
    return 'Đã kích hoạt. '+check.accounts+' tài khoản, '+check.units+' Phòng/Khu. Không thay đổi State.';
  });
}
function rollbackVietnameseAdminSheets(){
  return withLock_(function(){
    var ss=book_(),old=ss.getSheetByName(SHEET_ACCESS);
    if(!old)throw new Error('Không tìm thấy Access cũ. Dừng khôi phục.');
    PropertiesService.getScriptProperties().setProperty(ACCOUNT_SCHEMA_KEY,'LEGACY');
    if(old.showSheet)old.showSheet();
    return 'Đã chuyển về cách đọc Access cũ. Các chỉnh sửa chỉ thực hiện trong Tài khoản sau nâng cấp sẽ không tự sao chép về Access.';
  });
}
function inspectVietnameseAdminSheets(){
  var result=validateVietnameseAdminSheets();
  var message=result.ok?'Đã hợp lệ: '+result.accounts+' tài khoản và '+result.units+' Phòng/Khu.':
    'Có '+result.errors.length+' vấn đề cần sửa:\\n'+result.errors.join('\\n');
  Logger.log(message);
  try{SpreadsheetApp.getUi().alert('Kiểm tra cấu hình',message,SpreadsheetApp.getUi().ButtonSet.OK);}catch(_e){}
  return result;
}
function onOpen(){
  // Menu chỉ xuất hiện nếu Apps Script được gắn trực tiếp với Google Sheets.
  try{SpreadsheetApp.getUi().createMenu('Nhắc việc KPI')
    .addItem('1. Chuẩn bị bảng tiếng Việt','prepareVietnameseAdminSheets')
    .addItem('2. Kiểm tra phân quyền','inspectVietnameseAdminSheets')
    .addItem('3. Kích hoạt phân quyền','activateVietnameseAdminSheets')
    .addItem('4. Quay lại Access cũ','rollbackVietnameseAdminSheets').addToUi();}catch(_e){}
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
function textKey_(s){return String(s||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toUpperCase().replace(/[\/-]/g,' ').replace(/\s+/g,' ');}
function enabled_(s){return ['YES','TRUE','1','CO','ACTIVE','HOAT DONG'].indexOf(textKey_(s))!==-1;}
function roleKind_(role){
  var r=textKey_(role);
  if(['ADMIN','ADMINISTRATOR','QUAN TRI','QUAN TRI VIEN'].indexOf(r)!==-1)return 'ADMIN';
  if(['VICE_MANAGER','DEPUTY_MANAGER','PHO TRUONG PHONG','PHO TRUONG KHU','PHO TRUONG PHONG KHU','PHO PHONG','PHO KHU'].indexOf(r)!==-1)return 'VICE';
  if(['MANAGER','LEADER','HEAD','LANH DAO','TRUONG PHONG','TRUONG KHU','TRUONG PHONG KHU'].indexOf(r)!==-1)return 'MANAGER';
  if(['EMPLOYEE','USER','NHAN VIEN'].indexOf(r)!==-1)return 'EMPLOYEE';
  return '';
}
function isVietnameseSchema_(){return prop_(ACCOUNT_SCHEMA_KEY)==='VI';}
function managementRows_(ss){
  var sh=ss.getSheetByName(SHEET_DEPARTMENTS);
  return sh&&sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,5).getDisplayValues():[];
}
function accessRows_(ss){
  var vietnamese=isVietnameseSchema_(),sh=ss.getSheetByName(vietnamese?SHEET_USERS:SHEET_ACCESS);
  if(!sh)throw new Error('Không tìm thấy tab tài khoản phù hợp. Vui lòng liên hệ quản trị viên.');
  if(sh.getLastRow()<2)return [];
  if(!vietnamese)return sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()>=5?5:4).getDisplayValues();
  // Trả cùng định dạng Access v1.5.0: email, tên, hoạt động, vai trò, email quản lý, mã phòng.
  // Không sử dụng email do người dùng tự gửi lên; người nhận chỉ được tra từ cấu hình được kiểm tra.
  var people=sh.getRange(2,1,sh.getLastRow()-1,5).getDisplayValues();
  var byEmail={},duplicateEmail={};
  people.forEach(function(r){
    var e=String(r[0]||'').trim().toLowerCase();
    if(!e)return;
    if(byEmail[e])duplicateEmail[e]=true;
    byEmail[e]=r;
  });
  var managers={},ambiguous={};
  managementRows_(ss).forEach(function(d){
    var unit=String(d[0]||'').trim(),email=String(d[2]||'').trim().toLowerCase();
    if(!unit)return;
    if(Object.prototype.hasOwnProperty.call(managers,unit)){ambiguous[unit]=true;return;}
    var m=byEmail[email];
    // Cấm gửi nếu thiếu tài khoản, bị khóa, sai chức vụ, sai Phòng/Khu hoặc trùng email.
    managers[unit]=m&&!duplicateEmail[email]&&enabled_(m[2])&&roleKind_(m[3])==='MANAGER'&&String(m[4]||'').trim()===unit?email:'';
  });
  return people.map(function(r){
    var unit=String(r[4]||'').trim(),email=String(r[0]||'').trim().toLowerCase();
    return [r[0],r[1],duplicateEmail[email]?'Ngừng hoạt động':r[2],r[3],ambiguous[unit]?'':(managers[unit]||''),unit];
  });
}
function checkAccess_(ss,actor){
  var email=String(actor.email).trim().toLowerCase();
  var entries=accessRows_(ss);
  for(var i=0;i<entries.length;i++){
    if(String(entries[i][0]).trim().toLowerCase()!==email)continue;
    if(!enabled_(entries[i][2]))throw fail_('FORBIDDEN','Tài khoản chưa được kích hoạt hoặc đã bị thu hồi quyền.');
    return {email:email,name:String(entries[i][1]).trim()||String(actor.name||'').slice(0,80)||email,role:String(entries[i][3]||'').trim(),managerEmail:String(entries[i][4]||'').trim().toLowerCase(),unit:String(entries[i][5]||'').trim()};
  }
  throw fail_('FORBIDDEN','Tài khoản Google này chưa có trong danh sách Access.');
}
function stateSheet_(ss){var sh=ss.getSheetByName(SHEET_STATE);if(!sh)throw new Error('Chưa chạy setupProject.');return sh;}
function newState_(){return {defaultTime:'07:30',externalId:'',tasks:[],cancellations:[],revision:0,totalCreated:0,inbox:[],completionOutbox:[],deletedSourceKeys:[]};}
function normalizeState_(value){
  if(!Array.isArray(value.tasks))value.tasks=[];
  if(!Array.isArray(value.cancellations))value.cancellations=[];
  if(!validTime_(value.defaultTime))value.defaultTime='07:30';
  if(!Number.isSafeInteger(value.revision)||value.revision<0)value.revision=0;
  if(!Number.isSafeInteger(value.totalCreated)||value.totalCreated<0)value.totalCreated=value.tasks.length;
  if(!Array.isArray(value.inbox))value.inbox=[];
  if(!Array.isArray(value.completionOutbox))value.completionOutbox=[];
  if(!Array.isArray(value.deletedSourceKeys))value.deletedSourceKeys=[];
  return value;
}
function readState_(ss,actor,create){
  var sh=stateSheet_(ss);
  var last=sh.getLastRow();
  var found=last<2?null:sh.getRange(2,1,last-1,1).createTextFinder(String(actor.subject)).matchEntireCell(true).findNext();
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
  return {email:info.email,name:info.name,externalId:ext,defaultTime:profile.defaultTime,revision:profile.revision,isAdmin:isAdmin_(info.role),managerConfigured:!!info.managerEmail&&!isManagerRole_(info.role),
    deletedSourceKeys:profile.deletedSourceKeys,
    inbox:profile.inbox.filter(function(n){return !n.dismissed;}).map(function(n){return {id:n.id,from:n.from,title:n.title,at:n.at};}),
    tasks:profile.tasks.filter(function(t){return !t.deleted;}).map(function(t){
      var pending=(t.slots||[]).filter(function(s){return !s.id&&s.at>now&&s.at<=horizon;}).length;
      return {id:t.id,title:t.title,dueDate:t.dueDate,time:t.time,sourceKey:t.sourceKey||'',pending:pending,
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
/* Only user-facing mutations increment revision. OneSignal internal bookkeeping does not. */
function bumpRevision_(p){p.revision+=1;}
function requireRevision_(data,p){
  // Older v1.2 browser sessions may temporarily omit the field during rollout.
  if(data.expectedRevision===undefined)return;
  if(!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision!==p.revision)
    throw fail_('CONFLICT','Dữ liệu đã được thay đổi trên thiết bị khác. Vui lòng đồng bộ trước khi tiếp tục.');
}
// YC-008/013: manager and admin access are decided exclusively from Access, not client data.
function isAdmin_(role){return roleKind_(role)==='ADMIN';}
function isManagerRole_(role){return isAdmin_(role)||roleKind_(role)==='MANAGER';} // PHÓ TRƯỞNG không phải Trưởng phòng.
function findActiveManager_(ss,email){
  if(!email)return null;
  var entries=accessRows_(ss),match=entries.find(function(r){return String(r[0]||'').trim().toLowerCase()===email&&enabled_(r[2])&&roleKind_(r[3])==='MANAGER';});
  return match?{email:email,name:String(match[1]||'').trim()||email}:null;
}
function stateRowByEmail_(sh,email){
  var last=sh.getLastRow();if(last<2)return 0;
  var rows=sh.getRange(2,2,last-1,1).getDisplayValues();
  for(var i=0;i<rows.length;i++)if(String(rows[i][0]).trim().toLowerCase()===email)return i+2;
  return 0;
}
// Called under script lock. Source outbox is saved BEFORE any cross-account operation;
// idempotent manager inbox insertion prevents duplicates after uncertain writes.
function deliverOutbox_(ss,managerEmail){
  if(!managerEmail||!findActiveManager_(ss,managerEmail))return false;
  var sh=stateSheet_(ss),targetRow=stateRowByEmail_(sh,managerEmail);if(!targetRow)return false;
  var raw=sh.getRange(targetRow,3).getValue(),recipient=normalizeState_(raw?JSON.parse(String(raw)):newState_());
  var last=sh.getLastRow(),rows=sh.getRange(2,2,last-1,2).getValues(),inboxDirty=false,delivered=false,access=accessRows_(ss);
  for(var i=0;i<rows.length;i++){
    var row=i+2,sourceEmail=String(rows[i][0]||'').trim().toLowerCase();
    if(sourceEmail===managerEmail||!rows[i][1])continue;
    // Always enforce the CURRENT administrator-approved relationship at delivery time.
    var sourceAccess=access.find(function(a){return String(a[0]||'').trim().toLowerCase()===sourceEmail&&enabled_(a[2]);});
    if(!sourceAccess||String(sourceAccess[4]||'').trim().toLowerCase()!==managerEmail)continue;
    var source;
    try{source=normalizeState_(JSON.parse(String(rows[i][1])));}catch(err){continue;}
    var pending=source.completionOutbox; // Pending events follow the current approved manager if reassigned.
    if(!pending.length)continue;
    pending.forEach(function(e){
      if(!recipient.inbox.some(function(m){return m.id===e.id;})){
        recipient.inbox.push({id:e.id,from:e.from,title:e.title,at:e.at,pushSent:false,nextRetryAt:0});inboxDirty=true;
      }
    });
    if(inboxDirty){bumpRevision_(recipient);saveState_(sh,targetRow,recipient,managerEmail);inboxDirty=false;delivered=true;}
    // Re-read current State within the lock; never overwrite other in-flight edits.
    var transferred={};pending.forEach(function(e){transferred[e.id]=true;});
    source.completionOutbox=source.completionOutbox.filter(function(e){return !transferred[e.id];});
    saveState_(sh,row,source,sourceEmail);
  }
  return delivered;
}
function adminStats_(ss){
  var accounts=accessRows_(ss),unique={};
  accounts.forEach(function(r){var e=String(r[0]||'').trim().toLowerCase();if(e)unique[e]=true;});
  var sh=stateSheet_(ss),last=sh.getLastRow(),total=0;
  if(last>1)sh.getRange(2,3,last-1,1).getValues().forEach(function(r){
    try{if(r[0])total+=normalizeState_(JSON.parse(String(r[0]))).totalCreated;}catch(err){}
  });
  return {accounts:Object.keys(unique).length,totalCreated:total,
    note:'Tổng đầu việc được tính từ dữ liệu còn lưu khi nâng cấp và các công việc đăng ký sau đó.'};
}
function runAction_(req){
  var action=String(req.action||''),d=req.data||{};
  var ss=book_(),info=checkAccess_(ss,req.actor);
  // Token refresh: verify Access without loading or creating a State row.
  if(action==='authorize')return {view:{authorized:true},sync:false,changed:false};
  if(action==='adminStats'){
    if(!isAdmin_(info.role))throw fail_('FORBIDDEN','Bạn không có quyền xem tổng quan quản trị.');
    return {view:{adminStats:adminStats_(ss)},sync:false,changed:false};
  }
  var item=readState_(ss,req.actor,action!=='status');
  if(action==='status')return {view:{revision:item?item.profile.revision:0},sync:false,changed:false};
  var p=item.profile,sh=stateSheet_(ss),dirty=false;
  if(p.externalId!==req.actor.externalId){p.externalId=req.actor.externalId;dirty=true;}
  if(action==='load'||action==='sync'){
    if(dirty)saveState_(sh,item.row,p,info.email);
    var deliveredForManager=false;
    // First manager login creates their State row; deliver queued events on subsequent loads too.
    if(roleKind_(info.role)==='MANAGER'&&accessRows_(ss).some(function(r){return String(r[4]||'').trim().toLowerCase()===info.email&&String(r[0]||'').trim().toLowerCase()!==info.email;})){
      try{deliveredForManager=deliverOutbox_(ss,info.email);var updated=readState_(ss,req.actor,false);if(updated)p=updated.profile;}
      catch(err){console.error('Deliver inbox:',err.message||err);}
    }
    return {view:publicView_(p,info,req.actor.externalId),sync:action==='sync',changed:false,
      managerPushEmail:deliveredForManager?info.email:''};
  }
  if(action==='setDefaultTime'){
    if(!validTime_(d.time))throw fail_('BAD_REQUEST','Giờ không hợp lệ.');
    requireRevision_(d,p);
    var timeChanged=p.defaultTime!==d.time;
    if(timeChanged){p.defaultTime=d.time;dirty=true;bumpRevision_(p);}
    if(dirty)saveState_(sh,item.row,p,info.email);
    return {view:publicView_(p,info,req.actor.externalId),sync:false,changed:timeChanged,
      change:timeChanged?{type:'defaultTime',time:p.defaultTime}:null};
  }
  if(action==='save'){
    var title=String(d.title||'').trim(),due=String(d.dueDate||''),time=String(d.time||'');
    if(!title||title.length>90||!validDay_(due)||!validTime_(time))throw fail_('BAD_REQUEST','Kiểm tra lại tên, ngày và giờ công việc.');
    if(due<vnToday_()||dateMs_(due,time,0)<=Date.now()+30000)throw fail_('BAD_REQUEST','Ngày/giờ đến hạn phải còn ở tương lai.');
    if(dateMs_(due,time,0)>Date.now()+3*366*DAY_MS)throw fail_('BAD_REQUEST','Chỉ được đăng ký tối đa 3 năm trong tương lai.');
    requireRevision_(d,p);
    var existing=d.id?p.tasks.find(function(t){return t.id===d.id&&!t.deleted;}):null;
    if(d.id&&!existing)throw fail_('BAD_REQUEST','Không tìm thấy công việc cần sửa.');
    if(p.tasks.some(function(t){return !t.deleted&&t.id!==(existing&&existing.id)&&
      t.title.toLowerCase()===title.toLowerCase()&&t.dueDate===due&&t.time===time;}))
      throw fail_('CONFLICT','Bạn đã đăng ký công việc này với cùng ngày và giờ.');
    if(!existing&&p.tasks.filter(function(t){return !t.deleted&&t.dueDate>=vnToday_();}).length>=MAX_ACTIVE)
      throw fail_('BAD_REQUEST','Tài khoản đang có quá nhiều lịch nhắc (50). Hãy xóa những lịch không cần thiết.');
    if(existing&&existing.title===title&&existing.dueDate===due&&existing.time===time){
      if(dirty)saveState_(sh,item.row,p,info.email);
      return {view:publicView_(p,info,req.actor.externalId),sync:false,changed:false};
    }
    if(existing)prepareCancellation_(p,existing);
    var task=existing||{id:Utilities.getUuid()};
    task.title=title;task.dueDate=due;task.time=time;task.deleted=false;task.lastError='';task.slots=slotsFor_(task);
    if(!existing){p.tasks.push(task);p.totalCreated++;}
    bumpRevision_(p);
    saveState_(sh,item.row,p,info.email);
    var view=publicView_(p,info,req.actor.externalId);
    view.notice='Đã lưu công việc. Lịch nhắc được xử lý tự động.';
    var changedTask=view.tasks.find(function(t){return t.id===task.id;});
    var urgent=task.slots.some(function(slot){return slot.at>Date.now()+30000&&slot.at<=Date.now()+90*60000;});
    return {view:view,sync:true,urgentSync:urgent,changed:true,change:{type:'upsert',task:changedTask}};
  }
  if(action==='importTasks'){
    requireRevision_(d,p);
    if(!Array.isArray(d.items)||!d.items.length||d.items.length>30)
      throw fail_('BAD_REQUEST','Mỗi lần chỉ nhập từ 1 đến 30 nhiệm vụ.');
    var seen={},summary={added:0,updated:0,unchanged:0,skipped:0,notes:[]},changedTasks=[];
    var today=vnToday_(),now=Date.now(),maxDue=now+3*366*DAY_MS;
    for(var index=0;index<d.items.length;index++){
      var source=d.items[index]||{},key=String(source.sourceKey||'');
      var title=String(source.title||'').trim(),due=String(source.dueDate||'');
      var note=function(reason){summary.skipped++;summary.notes.push('Dòng '+(index+1)+': '+reason);};
      if(!/^icpv:[a-f0-9]{64}$/.test(key)||!title||title.length>90||!validDay_(due)){
        note('Thông tin nhiệm vụ không hợp lệ.');continue;
      }
      if(seen[key]){note('Tên nhiệm vụ bị trùng trong lần nhập.');continue;}
      seen[key]=true;
      // Deletion is deliberate: importing the same source never silently restores it.
      var matched=p.tasks.find(function(t){return t.source==='icpv'&&t.sourceKey===key;});
      if((matched&&matched.deleted)||p.deletedSourceKeys.indexOf(key)!==-1){note('Nhiệm vụ đã được xóa trong Nhắc việc.');continue;}
      var time=matched?matched.time:p.defaultTime;
      if(due<today||dateMs_(due,time,0)<=now+30000||dateMs_(due,time,0)>maxDue){
        note('Hạn đã qua hoặc vượt giới hạn ba năm.');continue;
      }
      if(matched){
        if(matched.dueDate===due){summary.unchanged++;continue;}
        // The user's individually edited deadline and reminders must not be overwritten.
        note('Thời hạn iCPV đã thay đổi; kiểm tra và sửa trong Nhắc việc nếu cần.');continue;
      }
      // Never automatically claim a manually created task with the same title.
      if(p.tasks.some(function(t){return !t.deleted&&t.title.toLowerCase()===title.toLowerCase();})){
        note('Đã có công việc cùng tên; cần đối chiếu thủ công.');continue;
      }
      if(p.tasks.filter(function(t){return !t.deleted&&t.dueDate>=today;}).length>=MAX_ACTIVE){
        note('Đã đạt giới hạn 50 công việc chưa quá hạn.');continue;
      }
      var task={id:Utilities.getUuid(),source:'icpv',sourceKey:key,title:title,
        dueDate:due,time:time,deleted:false,lastError:''};
      task.slots=slotsFor_(task);p.tasks.push(task);p.totalCreated++;
      summary.added++;changedTasks.push(task);
    }
    if(changedTasks.length){
      bumpRevision_(p);saveState_(sh,item.row,p,info.email);
    }else if(dirty)saveState_(sh,item.row,p,info.email);
    var importView=publicView_(p,info,req.actor.externalId);
    importView.importSummary=summary;
    importView.notice='Đã thêm '+summary.added+' công việc mới; '+summary.unchanged+' công việc đã có; '+summary.skipped+' cần kiểm tra.';
    // Do not call OneSignal while answering a multi-item import: browser requests
    // one separate sync; the hourly trigger remains the durable fallback.
    return {view:importView,sync:changedTasks.length>0,urgentSync:false,
      changed:changedTasks.length>0,change:changedTasks.length?{
        type:'importBatch',tasks:importView.tasks.filter(function(t){
          return changedTasks.some(function(c){return c.id===t.id;});
        })}:null};
  }
  if(action==='dismissNotification'){
    requireRevision_(d,p);
    var msg=p.inbox.find(function(n){return n.id===d.id&&!n.dismissed;});
    if(!msg)throw fail_('BAD_REQUEST','Không tìm thấy thông báo cần xóa.');
    msg.dismissed=true;bumpRevision_(p);saveState_(sh,item.row,p,info.email);
    return {view:publicView_(p,info,req.actor.externalId),sync:false,changed:true,
      change:{type:'inboxChanged'}};
  }
  if(action==='remove'){
    requireRevision_(d,p);
    var target=p.tasks.find(function(t){return t.id===d.id&&!t.deleted;});
    if(!target)throw fail_('BAD_REQUEST','Không tìm thấy công việc cần xóa.');
    // mode=discard is a deliberately explicit exception for accidental/manual entries.
    var completed=d.mode==='completed'; // Older cached v1.4 clients remain deletion-only during rollout.
    var manager=completed&&!isManagerRole_(info.role)&&info.managerEmail!==info.email?findActiveManager_(ss,info.managerEmail):null;
    prepareCancellation_(p,target);target.deleted=true;bumpRevision_(p);
    if(target.source==='icpv'&&target.sourceKey&&p.deletedSourceKeys.indexOf(target.sourceKey)===-1)
      p.deletedSourceKeys.push(target.sourceKey);
    if(manager){
      p.completionOutbox.push({id:Utilities.getUuid(),from:info.name,title:target.title.slice(0,90),
        at:new Date().toISOString(),managerEmail:manager.email});
    }
    var urgentCancel=p.cancellations.some(function(c){return c.at>Date.now()+30000&&c.at<=Date.now()+90*60000;});
    saveState_(sh,item.row,p,info.email);
    if(manager){try{deliverOutbox_(ss,manager.email);}catch(err){console.error('Manager delivery:',err.message||err);}}
    var out=publicView_(p,info,req.actor.externalId);
    out.notice=!completed?(d.mode==='discard'?'Đã xóa công việc nhập nhầm.':'Đã xóa công việc.'):manager?
      'Đã ghi nhận hoàn thành. Thông tin đã được chuyển đến Trưởng phòng.':
      'Đã xóa công việc. Chưa có Trưởng phòng được cấu hình để nhận thông báo.';
    return {view:out,sync:true,urgentSync:urgentCancel,changed:true,managerPushEmail:manager?manager.email:'',
      change:{type:'remove',id:target.id}};
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
function createManagerNotification_(notice,externalId){
  return oneSignal_('post','/notifications',{
    app_id:prop_('ONESIGNAL_APP_ID'),target_channel:'push',include_aliases:{external_id:[externalId]},
    headings:{en:'Nhân viên đã hoàn thành công việc'},
    contents:{en:notice.from+' đã hoàn thành: '+notice.title.slice(0,65)+'. Vui lòng vào iCPV chấm điểm.'},
    url:prop_('WEB_URL'),idempotency_key:notice.id
  });
}
function findSlot_(p,key){
  for(var h=0;h<p.inbox.length;h++)if(p.inbox[h].id===key)return {slot:p.inbox[h],type:'manager',parent:null};
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
    // Preserve the existing due-date scheduler: leave one slot for manager alerts.
    var dueBudget=maxCount;
    var hasManagerPending=p.externalId&&p.inbox.some(function(m){return !m.dismissed&&!m.pushSent&&
      (!m.leaseUntil||m.leaseUntil<=now)&&(!m.nextRetryAt||m.nextRetryAt<=now||force);});
    if(hasManagerPending)dueBudget=Math.max(0,maxCount-1);
    for(var j=0;j<p.tasks.length&&jobs.length<dueBudget;j++){
      var t=p.tasks[j];if(t.deleted)continue;
      for(var k=0;k<(t.slots||[]).length&&jobs.length<dueBudget;k++){
        var s=t.slots[k];
        if(s.id||s.at<=now+60000||s.at>horizon||(s.leaseUntil&&s.leaseUntil>now)||
          (s.nextRetryAt&&s.nextRetryAt>now&&!force))continue;
        s.attempted=true;s.leaseUntil=now+CLAIM_MS;changed=true;
        jobs.push({key:s.key,kind:'create',slot:JSON.parse(JSON.stringify(s)),task:{title:t.title,dueDate:t.dueDate},externalId:p.externalId});
      }
    }
    // Reserve at most one manager push in each shared batch; due-date jobs retain priority.
    for(var h=0;h<p.inbox.length&&jobs.length<maxCount;h++){
      var m=p.inbox[h];
      if(m.dismissed||m.pushSent||!p.externalId||(m.leaseUntil&&m.leaseUntil>now)||
        (m.nextRetryAt&&m.nextRetryAt>now&&!force))continue;
      m.leaseUntil=now+CLAIM_MS;changed=true;
      jobs.push({key:m.id,kind:'manager',slot:JSON.parse(JSON.stringify(m)),externalId:p.externalId});
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
      if(r.kind==='manager'){
        if(found.type==='manager'){
          if(r.id)s.pushSent=true;
          else s.nextRetryAt=now+6*CLOCK_MS;
        }
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
      if(j.kind==='manager')result.id=String(createManagerNotification_(j.slot,j.externalId).id||'');
      else if(j.kind==='cancel')cancelNotification_(j.slot.id);
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
// Only claim manager completion alerts here; an unrelated due-date cancellation
// must not postpone a newly completed employee task. Normal due-date processing is unchanged.
function claimManagerAlerts_(sh,row,email,maxCount){
  var raw=String(sh.getRange(row,3).getValue()||''),p=normalizeState_(raw?JSON.parse(raw):newState_());
  if(!p.externalId)return [];
  var now=Date.now(),jobs=[],changed=false;
  for(var i=0;i<p.inbox.length&&jobs.length<maxCount;i++){
    var m=p.inbox[i];
    if(m.dismissed||m.pushSent||(m.leaseUntil&&m.leaseUntil>now)||
      (m.nextRetryAt&&m.nextRetryAt>now))continue;
    m.leaseUntil=now+CLAIM_MS;changed=true;
    jobs.push({key:m.id,kind:'manager',slot:JSON.parse(JSON.stringify(m)),externalId:p.externalId});
  }
  if(changed)saveState_(sh,row,p,email);
  return jobs;
}
function syncManagerByEmail_(email,maxCalls){
  var context=withLock_(function(){
    var ss=book_(),sh=stateSheet_(ss),row=stateRowByEmail_(sh,email);
    if(!row||!findActiveManager_(ss,email))return null;
    return {row:row,jobs:claimManagerAlerts_(sh,row,email,maxCalls)};
  });
  if(!context||!context.jobs.length)return;
  var result=performJobs_(context.jobs);
  withLock_(function(){var ss=book_();finishJobs_(stateSheet_(ss),context.row,email,result);});
}
function doPost(e){
  try{
    if(!e||!e.postData||!e.postData.contents||e.postData.contents.length>62000)
      throw fail_('BAD_REQUEST','Yêu cầu trống hoặc quá lớn.');
    var envelope=JSON.parse(e.postData.contents),request;
    var result=withLock_(function(){
      request=validateEnvelope_(envelope); // HMAC nonce check is atomic with the user action.
      return runAction_(request);
    });
    // Always commit the user's action before attempting network I/O.
    var syncedInline=false;
    if(result.sync&&(request.action==='sync'||result.urgentSync)){
      try{syncAccount_(request.actor,4,request.action==='sync');syncedInline=true;}catch(syncErr){console.error('Deferred sync:',syncErr.message||syncErr);}
      // The latest view can be refreshed with a read. Avoid a duplicate Sheets read on each write;
      // hourly sync retries in the background. Frontend explicitly labels pending work.
      // Nonurgent user mutations are queued for a separate nonblocking sync request.
    }
    // Manager completion alerts must not depend on the EMPLOYEE's urgent due-date cancellation.
    // The completion event and target inbox were committed above, under lock. Deliver to the
    // manager immediately when possible; the existing hourly trigger remains the retry fallback.
    if(result.managerPushEmail){
      try{syncManagerByEmail_(result.managerPushEmail,2);}catch(managerErr){console.error('Deferred manager push:',managerErr.message||managerErr);}
    }
    return jsonOutput_({ok:true,result:result.view,changed:!!result.changed,change:result.change||null,
      needsSync:!!result.sync&&!syncedInline});
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
      var needManager=allowed[email]&&snapshot.inbox.some(function(m){return !m.dismissed&&!m.pushSent&&
        (!m.leaseUntil||m.leaseUntil<=now)&&(!m.nextRetryAt||m.nextRetryAt<=now);});
      var needRevoke=!allowed[email]&&snapshot.tasks.some(function(t){return !t.deleted;});
    var needClean=!snapshot.cancellations.length&&snapshot.tasks.some(function(t){
      return t.deleted||dateMs_(t.dueDate,t.time,0)<=now-30*DAY_MS;
    });
      if(!needCancel&&!needCreate&&!needManager&&!needRevoke&&!needClean)continue;
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
