/**
 * NHẮC VIỆC KPI – TÂN HIỆP | V1.9.2-HF2 / YC-034
 * Single editable administrator tab, old account tabs and State preserved. Single OneSignal application.
 * Never call OneSignal while holding the shared script lock.
 * Durable claim + idempotency key protects concurrent edits and uncertain responses.
 * Time zone: Asia/Ho_Chi_Minh.
 */
var SHEET_ACCESS='Access'; // Bản gốc giữ lại để sao lưu và quay lại khi cần.
var SHEET_USERS='Tài khoản';
var SHEET_DEPARTMENTS='Quản lý Phòng-Khu'; // Không dùng dấu / trong tên tab.
var SHEET_STATE='State';
var SHEET_KPI_ASSIGNMENTS='Phân công KPI';
var SHEET_UNIFIED='Nhân sự - Phân quyền';
var UNIFIED_SCHEMA_KEY='ADMIN_UNIFIED_SCHEMA'; // V1: bật bằng quản trị viên sau kiểm tra toàn bộ
var UNIFIED_HEADERS=['Email đăng nhập','Họ và tên','Trạng thái','Chức danh chính','Đơn vị chính',
  'Phòng/Khu phụ trách hoặc kiêm nhiệm','Chức danh kiêm nhiệm (nếu khác)','Quyền quản trị'];
var KPI_ROUTING_KEY='KPI_ROUTING_SCHEMA'; // V2 only after explicit admin validation/activation

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
  var a=ss.getSheetByName(isUnifiedSchema_()?SHEET_UNIFIED:isVietnameseSchema_()?SHEET_USERS:SHEET_ACCESS);
  if(!a){
    if(isUnifiedSchema_())throw new Error('Không tìm thấy tab Nhân sự - Phân quyền. Dừng để bảo vệ tài khoản.');
    if(isVietnameseSchema_())throw new Error('Không tìm thấy tab Tài khoản. Không tự tạo bảng mới.');
    a=ss.insertSheet(SHEET_ACCESS); // Giữ tương thích hành vi setupProject v1.5.0 trên hệ thống mới.
  }
  var s=ss.getSheetByName(SHEET_STATE)||ss.insertSheet(SHEET_STATE);
  if(a.getLastRow()===0){
    if(isUnifiedSchema_())throw new Error('Tab quản trị hợp nhất chưa có dữ liệu. Không tự tạo tài khoản.');
    a.appendRow(['Email','Họ tên','Active','Role']);
  }
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
  if(isUnifiedSchema_())throw new Error('Đã dùng tab quản trị hợp nhất.');
  if(isVietnameseSchema_())throw new Error('Bảng tiếng Việt đã kích hoạt. Không chuẩn bị lại.');
  var ss=book_(),legacy=ss.getSheetByName(SHEET_ACCESS);
  if(!legacy)throw new Error('Không thấy Access cũ. Dừng chuyển đổi để bảo vệ tài khoản.');
  if(ss.getSheetByName(SHEET_USERS)||ss.getSheetByName(SHEET_DEPARTMENTS))
    throw new Error('Đã có tab chuẩn bị. Không ghi đè; hãy kiểm tra và tiếp tục cấu hình hiện có.');
  var users=ss.insertSheet(SHEET_USERS),dept=ss.insertSheet(SHEET_DEPARTMENTS);
  var count=Math.max(0,legacy.getLastRow()-1),old=count?legacy.getRange(2,1,count,5).getDisplayValues():[];
  users.getRange(1,1,1,7).setValues([['Email đăng nhập','Họ và tên','Trạng thái','Vai trò','Mã Phòng/Khu','Email quản lý cũ (đối chiếu)','Quyền quản trị']]);
  if(old.length){
    users.getRange(2,1,old.length,7).setValues(old.map(function(r){return [r[0],r[1],enabled_(r[2])?'Hoạt động':'Ngừng hoạt động',roleLabel_(r[3]),'',r[4]||'',isAdmin_(r[3])?'Có':'Không'];}));
  }
  dept.getRange(1,1,1,5).setValues([['Mã Phòng/Khu','Tên Phòng/Khu','Email Trưởng phòng/Khu','Email Phó thứ nhất (tùy chọn)','Email Phó thứ hai (tùy chọn)']]);
  configureAdminView_(users,[270,220,160,190,160,280,150]);
  configureAdminView_(dept,[140,250,290,260,260]);
  users.getRange(2,3,users.getMaxRows()-1,1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Hoạt động','Ngừng hoạt động'],true).setAllowInvalid(false).build());
  users.getRange(2,4,users.getMaxRows()-1,1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Nhân viên','Phó Trưởng phòng/Khu','Trưởng phòng/Khu','Quản trị viên'],true).setAllowInvalid(false).build());
  users.getRange(2,5,users.getMaxRows()-1,1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(dept.getRange(2,1,dept.getMaxRows()-1,1),true).setAllowInvalid(false).build());
  users.getRange(1,5).setNote('Nhập đúng mã đã khai báo tại tab Quản lý Phòng-Khu. Không nhập email Trưởng phòng vào đây.');
  users.getRange(1,6).setNote('Giữ lại email quản lý từ cột E của Access cũ để đối chiếu. Không dùng cột này để gửi thông báo.');
  users.getRange(1,7).setNote('Có: xem số liệu tổng quan; Không: chỉ sử dụng quyền nghiệp vụ của vai trò tại cột D.');
  users.getRange(2,7,users.getMaxRows()-1,1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Có','Không'],true).setAllowInvalid(false).build());
  if(users.hideColumns)users.hideColumns(6);
  dept.getRange(1,3).setNote('Một email Trưởng phòng/Khu có thể quản lý tất cả tài khoản cùng mã Phòng/Khu. Email phải có trong tab Tài khoản và có đúng vai trò Trưởng phòng/Khu.');
  // Không sửa tab State, không tự chuyển chế độ, Access cũ vẫn đang cấp quyền khi chuẩn bị.
  SpreadsheetApp.flush();
  return 'Đã tạo tab Tài khoản và Quản lý Phòng-Khu. Access và State còn nguyên. Hãy điền mã đơn vị và kiểm tra trước khi kích hoạt.';
}
/**
 * Chỉ thêm cột G (quyền quản trị) vào tab tiếng Việt hiện có.
 * Giữ nguyên A:F, các tài khoản, Phòng/Khu và toàn bộ State.
 * Chạy duy nhất một lần sau khi deploy; gọi lại an toàn.
 */
function prepareAdminPermissionColumn(){
  if(isUnifiedSchema_())throw new Error('Cột Quyền quản trị đã nằm trong tab hợp nhất.');
  var ss=book_(),users=ss.getSheetByName(SHEET_USERS);
  if(!users)throw new Error('Chưa có tab Tài khoản. Không tự tạo dữ liệu.');
  var header=String(users.getRange(1,7).getDisplayValue?users.getRange(1,7).getDisplayValue():users.getRange(1,7).getValue()||'').trim();
  if(header&&header!=='Quyền quản trị')throw new Error('Cột G đang có nội dung khác. Không được ghi đè.');
  var last=users.getLastRow(),values=last>1?users.getRange(2,1,last-1,7).getDisplayValues():[];
  values.forEach(function(r,i){
    var email=String(r[0]||'').trim();if(!email||String(r[6]||'').trim())return;
    users.getRange(i+2,7).setValue(isAdmin_(r[3])?'Có':'Không');
  });
  users.getRange(1,7).setValue('Quyền quản trị');
  users.getRange(1,7).setBackground('#1e3a5f').setFontColor('#ffffff').setFontWeight('bold');
  users.setColumnWidth(7,155);
  users.getRange(1,7).setNote('Có: thêm quyền xem tổng quan; Không: chỉ thực hiện nghiệp vụ theo vai trò ở cột D.');
  users.getRange(2,7,users.getMaxRows()-1,1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Có','Không'],true).setAllowInvalid(false).build());
  SpreadsheetApp.flush();
  return 'Đã chuẩn bị cột G – Quyền quản trị. Các cột A:F và State không thay đổi.';
}
function adminPermission_(flag,role){
  var key=textKey_(flag);
  if(['CO','YES','TRUE','1'].indexOf(key)!==-1)return true;
  if(['KHONG','NO','FALSE','0'].indexOf(key)!==-1)return false;
  if(key)return false; // Dữ liệu không hợp lệ không được cấp quyền.
  // Tương thích tài khoản Quản trị viên cũ cho đến khi được cấp cờ riêng.
  return isAdmin_(role);
}
function accountIsAdmin_(info){return typeof info.isAdmin==='boolean'?info.isAdmin:isAdmin_(info.role);}
function roleLabel_(role){
  var kind=roleKind_(role);
  return kind==='DIRECTOR'?'Ban Giám đốc':kind==='ACTING'?'Quyền Trưởng phòng/Khu':kind==='MANAGER'?'Trưởng phòng/Khu':kind==='VICE'?'Phó Trưởng phòng/Khu':kind==='ADMIN'?'Quản trị viên':kind==='EMPLOYEE'?'Nhân viên':String(role||'');
}
function validateVietnameseAdminSheets(){
  if(isUnifiedSchema_())return validateUnifiedAdminSheet();
  var ss=book_(),u=ss.getSheetByName(SHEET_USERS),d=ss.getSheetByName(SHEET_DEPARTMENTS),problems=[];
  if(!u||!d)return {ok:false,errors:['Thiếu tab Tài khoản hoặc Quản lý Phòng-Khu. Chạy hàm chuẩn bị trước.']};
  var users=u.getLastRow()>1?u.getRange(2,1,u.getLastRow()-1,7).getDisplayValues():[];
  var units=d.getLastRow()>1?d.getRange(2,1,d.getLastRow()-1,7).getDisplayValues():[];
  var emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/,byEmail={},byUnit={};
  users.forEach(function(r,i){
    if(!r.some(function(v){return String(v).trim();}))return;
    var email=String(r[0]||'').trim().toLowerCase(),kind=roleKind_(r[3]);
    if(!emailPattern.test(email))problems.push('Tài khoản dòng '+(i+2)+': email không hợp lệ.');
    if(byEmail[email])problems.push('Tài khoản dòng '+(i+2)+': email bị trùng.');
    byEmail[email]={email:email,role:kind,active:enabled_(r[2]),unit:String(r[4]||'').trim()};
    if(!kind)problems.push('Tài khoản dòng '+(i+2)+': vai trò chưa hợp lệ.');
    if(String(r[6]||'').trim()&&!['CO','KHONG'].includes(textKey_(r[6])))
      problems.push('Tài khoản dòng '+(i+2)+': quyền quản trị chỉ nhận Có hoặc Không.');
    if(['HOAT DONG','NGUNG HOAT DONG'].indexOf(textKey_(r[2]))===-1)
      problems.push('Tài khoản dòng '+(i+2)+': trạng thái phải là Hoạt động hoặc Ngừng hoạt động.');
    if(enabled_(r[2])&&kind!=='ADMIN'&&kind!=='DIRECTOR'&&!String(r[4]||'').trim())
      problems.push('Tài khoản dòng '+(i+2)+': chưa chọn mã Phòng/Khu.');
  });
  units.forEach(function(r,i){
    if(!r.some(function(v){return String(v).trim();}))return;
    var key=String(r[0]||'').trim(),manager=String(r[2]||'').trim().toLowerCase();
    if(!key||!String(r[1]||'').trim())problems.push('Phòng/Khu dòng '+(i+2)+': thiếu mã hoặc tên.');
    if(byUnit[key])problems.push('Phòng/Khu dòng '+(i+2)+': mã Phòng/Khu bị trùng.');
    byUnit[key]=true;
    // BGD là nhóm lãnh đạo, không bắt buộc Trưởng/Phó phòng hay Ban Giám đốc phụ trách.
    // Các cột C/D/E của dòng BGD có thể chứa dữ liệu lịch sử; không dùng để định tuyến KPI.
    if(isLeadershipUnit_(key))return;
    var m=byEmail[manager];
    if(routingV2_()&&!manager){
      var acting=String(r[5]||'').trim().toLowerCase();
      var deputyHead=byEmail[acting];
      if(!acting||!deputyHead||!deputyHead.active)problems.push('Phòng/Khu '+key+': Quyền Trưởng phòng chưa hợp lệ.');
    }else if(!m||!m.active||m.role!=='MANAGER'||m.unit!==key)
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
    if(a.active&&a.role!=='ADMIN'&&a.role!=='DIRECTOR'&&!byUnit[a.unit])problems.push('Tài khoản '+email+': mã Phòng/Khu không tồn tại.');
  });
  if(!users.length||!units.length)problems.push('Chưa nhập đủ danh sách tài khoản hoặc Phòng/Khu.');
  return {ok:problems.length===0,errors:problems,accounts:Object.keys(byEmail).length,units:Object.keys(byUnit).length};
}
function activateVietnameseAdminSheets(){
  if(isUnifiedSchema_())throw new Error('Đang dùng tab quản trị hợp nhất.');
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
  if(isUnifiedSchema_())throw new Error('Trước tiên dùng rollbackUnifiedAdminSheet.');
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
  // Một thao tác an toàn dành cho người quản trị; giữ tất cả hàm bảo trì/rollback
  // trong trình biên tập Apps Script, không đưa lên menu cho người dùng cuối.
  try{SpreadsheetApp.getUi().createMenu('Nhắc việc KPI')
    .addItem('Kiểm tra nhân sự và phân quyền','inspectUnifiedAdminSheet')
    .addToUi();}catch(_e){}
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
  if(['BAN GIAM DOC','GIAM DOC','PHO GIAM DOC','DIRECTOR'].indexOf(r)!==-1)return 'DIRECTOR';
  if(['QUYEN TRUONG PHONG','QUYEN TRUONG KHU','QUYEN TRUONG PHONG KHU','ACTING_MANAGER','ACTING'].indexOf(r)!==-1)return 'ACTING';
  if(['VICE_MANAGER','DEPUTY_MANAGER','PHO TRUONG PHONG','PHO TRUONG KHU','PHO TRUONG PHONG KHU','PHO PHONG','PHO KHU','VICE'].indexOf(r)!==-1)return 'VICE';
  if(['MANAGER','LEADER','HEAD','LANH DAO','TRUONG PHONG','TRUONG KHU','TRUONG PHONG KHU'].indexOf(r)!==-1)return 'MANAGER';
  if(['EMPLOYEE','USER','NHAN VIEN'].indexOf(r)!==-1)return 'EMPLOYEE';
  return '';
}
function isVietnameseSchema_(){return prop_(ACCOUNT_SCHEMA_KEY)==='VI';}
function isUnifiedSchema_(){return prop_(UNIFIED_SCHEMA_KEY)==='V1';}
/** YC-034: one admin sheet, one person/email/row; State stays separately unchanged.
 * Columns A:H are validated by exact labels. Column F accepts comma/semicolon-separated
 * department codes. Director+BGD+F determines 'BGD phụ trách' without an extra role column.
 * For a staff member with another post, G describes the role in EVERY additional unit in F;
 * empty G means the same post as the primary one. No privileged status is inferred from F alone.
 */
function unifiedUnits_(raw){
  return String(raw||'').split(/[,;|\n]+/).map(function(x){return x.trim().toUpperCase();}).filter(Boolean);
}
function unifiedModel_(ss){
  var sh=ss.getSheetByName(SHEET_UNIFIED),errors=[],people=[],assignments=[],departments=[],seen={},roles={};
  if(!sh)return {people:[],departments:[],assignments:[],errors:['Thiếu tab '+SHEET_UNIFIED+'.']};
  var headers=sh.getRange(1,1,1,8).getDisplayValues()[0];
  UNIFIED_HEADERS.forEach(function(h,i){if(String(headers[i]||'').trim()!==h)errors.push('Sai tiêu đề cột '+String.fromCharCode(65+i)+': yêu cầu '+h+'.');});
  if(errors.length)return {people:[],departments:[],assignments:[],errors:errors};
  var rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,8).getDisplayValues():[];
  var all={},byUnit={},dup={},emailReg=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  rows.forEach(function(r,i){
    if(!r.some(function(v){return String(v).trim();}))return;
    var n=i+2,email=String(r[0]||'').trim().toLowerCase(),name=String(r[1]||'').trim(),
      status=String(r[2]||'').trim(),title=String(r[3]||'').trim(),unit=String(r[4]||'').trim().toUpperCase(),
      extra=unifiedUnits_(r[5]),other=String(r[6]||'').trim(),admin=String(r[7]||'').trim(),role=roleKind_(title),
      extraRole=other?roleKind_(other):role;
    if(!emailReg.test(email))errors.push('Dòng '+n+': email đăng nhập không hợp lệ.');
    if(seen[email]){errors.push('Dòng '+n+': email trùng dòng '+seen[email]+'.');dup[email]=true;}
    seen[email]=n;
    if(!name)errors.push('Dòng '+n+': thiếu họ và tên.');
    if(['HOAT DONG','NGUNG HOAT DONG'].indexOf(textKey_(status))<0)errors.push('Dòng '+n+': trạng thái không hợp lệ.');
    if(!role)errors.push('Dòng '+n+': chức danh chính không hợp lệ.');
    if((role!=='ADMIN'&&!unit)||(unit&&!/^[A-Z0-9_-]+$/.test(unit)))errors.push('Dòng '+n+': mã đơn vị chính không hợp lệ.');
    if(!['CO','KHONG'].includes(textKey_(admin)))errors.push('Dòng '+n+': Quyền quản trị phải là Có hoặc Không.');
    if(other&&!extra.length)errors.push('Dòng '+n+': có chức danh kiêm nhiệm nhưng thiếu Phòng/Khu kiêm nhiệm.');
    if(other&&(!extraRole||extraRole==='ADMIN'||extraRole==='DIRECTOR'))
      errors.push('Dòng '+n+': chức danh kiêm nhiệm không hợp lệ.');
    if(role==='DIRECTOR'&&unit!=='BGD')errors.push('Dòng '+n+': Giám đốc/Phó Giám đốc phải có đơn vị chính BGD.');
    if(role==='DIRECTOR'&&other)errors.push('Dòng '+n+': thành viên BGD không cần nhập chức danh phụ trách ở cột G.');
    if(role==='ADMIN'&&(extra.length||other))errors.push('Dòng '+n+': Quản trị viên độc lập không có chức vụ nghiệp vụ.');
    if(role!=='DIRECTOR'&&role!=='ADMIN'&&unit==='BGD')errors.push('Dòng '+n+': BGD chỉ dành cho chức danh Ban Giám đốc.');
    var unitSet={};unitSet[unit]=true;
    extra.forEach(function(code){
      if(!/^[A-Z0-9_-]+$/.test(code)||code==='BGD')errors.push('Dòng '+n+': mã Phòng/Khu phụ trách/kiêm nhiệm sai: '+code+'.');
      if(unitSet[code])errors.push('Dòng '+n+': Phòng/Khu '+code+' bị lặp.');
      unitSet[code]=true;
    });
    var active=enabled_(status);
    all[email]={name:name,active:active,title:title,role:role,unit:unit,extra:extra,extraRole:extraRole,admin:admin};
    people.push([email,name,active?'Hoạt động':'Ngừng hoạt động',title,'',unit,admin]);
    if(!active||!role||role==='ADMIN')return;
    var specs=role==='DIRECTOR'?extra.map(function(code){return {unit:code,role:'DIRECTOR'};}):
      [{unit:unit,role:role}].concat(extra.map(function(code){return {unit:code,role:extraRole};}));
    specs.forEach(function(spec){
      if(!spec.unit||spec.unit==='BGD'||!spec.role)return;
      var d=byUnit[spec.unit]||(byUnit[spec.unit]={unit:spec.unit,head:[],acting:[],director:[],vice:[],employee:[]});
      var part=spec.role==='MANAGER'?'head':spec.role.toLowerCase();if(d[part])d[part].push(email);
      assignments.push([email,spec.unit,roleLabel_(spec.role)]);
    });
  });
  if(!rows.length)errors.push('Tab quản trị chưa có tài khoản.');
  Object.keys(dup).forEach(function(email){
    // Deny duplicated accounts, even if edits occur after activation.
    people.forEach(function(r){if(r[0]===email)r[2]='Ngừng hoạt động';});
    assignments=assignments.filter(function(r){return r[0]!==email;});
    Object.keys(byUnit).forEach(function(code){var d=byUnit[code];['head','acting','director','vice','employee'].forEach(function(k){d[k]=d[k].filter(function(e){return e!==email;});});});
  });
  var leadership=[];
  Object.keys(all).forEach(function(email){if(all[email].active&&all[email].role==='DIRECTOR'&&!dup[email])leadership.push(email);});
  if(leadership.length)departments.push(['BGD','Ban Giám đốc','','','','','']);
  Object.keys(byUnit).sort().forEach(function(key){
    var d=byUnit[key],head=d.head||[],acting=d.acting||[],director=d.director||[],vice=d.vice||[];
    if(head.length+acting.length!==1)errors.push('Phòng/Khu '+key+': cần đúng một Trưởng phòng hoặc Quyền Trưởng phòng.');
    if(director.length!==1)errors.push('Phòng/Khu '+key+': cần đúng một Giám đốc/Phó Giám đốc phụ trách.');
    if(head.length>1||acting.length>1||director.length>1||vice.length>2)
      errors.push('Phòng/Khu '+key+': phân công nhiều người cùng thẩm quyền chưa hợp lệ.');
    if((head[0]||acting[0])===director[0])errors.push('Phòng/Khu '+key+': người đứng đầu không được tự chấm chính mình.');
    departments.push([key,key,head.length===1?head[0]:'',vice[0]||'',vice[1]||'',acting.length===1?acting[0]:'',director.length===1?director[0]:'']);
  });
  // During migration the unit name may be a code. No old admin sheet is consulted in unified mode.
  var headByUnit={};departments.forEach(function(d){if(d[0]!=='BGD')headByUnit[d[0]]=d[5]||d[2]||'';});
  people.forEach(function(r){r[4]=headByUnit[r[5]]||'';});
  return {people:people,departments:departments,assignments:assignments,errors:errors};
}
/** Draft creation is explicit. Never edits 3 old tabs or State, never activates itself. */
function prepareUnifiedAdminSheet(){
  if(isUnifiedSchema_())throw new Error('Đã kích hoạt tab quản trị hợp nhất.');
  var ss=book_(),users=ss.getSheetByName(SHEET_USERS),departments=ss.getSheetByName(SHEET_DEPARTMENTS);
  if(ss.getSheetByName(SHEET_UNIFIED))throw new Error('Đã có tab '+SHEET_UNIFIED+'. Không ghi đè.');
  if(!users||!departments)throw new Error('Thiếu Tài khoản hoặc Quản lý Phòng-Khu để chuẩn bị dữ liệu.');
  var assignments=kpiRows_(ss),oldDept=managementRows_(ss),oldUsers=users.getLastRow()>1?
    users.getRange(2,1,users.getLastRow()-1,7).getDisplayValues():[];
  var directors={},rolesByEmail={};
  oldDept.forEach(function(r){var code=String(r[0]||'').trim(),d=String(r[6]||'').trim().toLowerCase();
    if(code&&d&&!isLeadershipUnit_(code)){if(!directors[d])directors[d]=[];directors[d].push(code);}
  });
  assignments.forEach(function(r){var email=String(r[0]||'').trim().toLowerCase(),code=String(r[1]||'').trim(),role=roleKind_(r[2]);
    if(!email||!code||!role)return;
    if(!rolesByEmail[email])rolesByEmail[email]=[];
    rolesByEmail[email].push({unit:code,role:role});
  });
  var problems=[],result=[],emails={};
  oldUsers.forEach(function(r,i){
    if(!String(r[0]||'').trim())return;
    var email=String(r[0]||'').trim().toLowerCase(),role=roleKind_(r[3]),unit=String(r[4]||'').trim().toUpperCase(),extra=[],extraRole='';
    if(emails[email])problems.push('Tài khoản dòng '+(i+2)+' có email trùng.');emails[email]=true;
    if(role==='DIRECTOR'){unit='BGD';extra=directors[email]||[];}
    else{
      var entries=(rolesByEmail[email]||[]).filter(function(a){return a.unit!==unit;});
      var distinct={};entries.forEach(function(a){distinct[a.role]=true;});
      var kinds=Object.keys(distinct);
      if(kinds.length>1)problems.push('Người '+email+' có nhiều chức vụ kiêm nhiệm khác nhau; một cột G không biểu diễn được. Dừng để xin phương án bổ sung.');
      extra=entries.map(function(a){return a.unit;});
      if(kinds.length&&kinds[0]!==role)extraRole=roleLabel_(kinds[0]);
    }
    result.push([email,r[1],r[2],r[3],unit,extra.join(', '),extraRole,r[6]||'Không']);
  });
  if(problems.length)throw new Error('Chưa tạo tab mới: '+problems.join(' | '));
  var sh=ss.insertSheet(SHEET_UNIFIED);
  sh.getRange(1,1,1,8).setValues([UNIFIED_HEADERS]);
  if(result.length)sh.getRange(2,1,result.length,8).setValues(result);
  configureAdminView_(sh,[270,220,155,225,150,250,245,150]);
  var count=sh.getMaxRows()-1;
  if(count>0){
    sh.getRange(2,3,count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Hoạt động','Ngừng hoạt động'],true).setAllowInvalid(false).build());
    sh.getRange(2,4,count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(
      ['Nhân viên','Phó Trưởng phòng/Khu','Trưởng phòng/Khu','Quyền Trưởng phòng/Khu','Giám đốc','Phó Giám đốc','Ban Giám đốc','Quản trị viên'],true).setAllowInvalid(false).build());
    sh.getRange(2,7,count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(
      ['Nhân viên','Phó Trưởng phòng/Khu','Trưởng phòng/Khu','Quyền Trưởng phòng/Khu'],true).setAllowInvalid(false).build());
    sh.getRange(2,8,count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Có','Không'],true).setAllowInvalid(false).build());
  }
  sh.getRange(1,6).setNote('Mã đơn vị phụ trách/kiêm nhiệm; nhiều mã phân cách bằng dấu phẩy. Ví dụ TCHC, KHU1. Thành viên BGD KHÔNG cần nhập vai trò tại từng phòng.');
  sh.getRange(1,7).setNote('Chỉ chọn khi kiêm nhiệm chức danh KHÁC chức danh chính. Chức danh này áp dụng cho tất cả mã phòng ở cột F.');
  sh.getRange(1,8).setNote('Quyền xem tổng quan ứng dụng, độc lập chức vụ.');
  SpreadsheetApp.flush();
  return 'Đã tạo bản NHÁP Nhân sự - Phân quyền với '+result.length+' tài khoản. Ba tab cũ và State giữ nguyên. Kiểm tra chức danh Giám đốc/Phó Giám đốc và phân công F trước khi kích hoạt.';
}
function validateUnifiedAdminSheet(){
  var result=unifiedModel_(book_());
  return {ok:!result.errors.length,errors:result.errors,accounts:result.people.length,units:result.departments.length,departments:result.departments.length,assignments:result.assignments.length};
}
function inspectUnifiedAdminSheet(){
  var v=validateUnifiedAdminSheet(),message=v.ok?'Hợp lệ: '+v.accounts+' tài khoản, '+v.assignments+' phân công, '+v.departments+' đơn vị.':
    'Cần sửa '+v.errors.length+' vấn đề:\n'+v.errors.join('\n');
  Logger.log(message);
  try{SpreadsheetApp.getUi().alert('Kiểm tra nhân sự và phân quyền',message,SpreadsheetApp.getUi().ButtonSet.OK);}catch(_ignored){}
  return v;
}
function activateUnifiedAdminSheet(){
  return withLock_(function(){
    var v=validateUnifiedAdminSheet();
    if(!v.ok)throw new Error('Chưa thể kích hoạt: '+v.errors.slice(0,12).join(' | '));
    PropertiesService.getScriptProperties().setProperty(UNIFIED_SCHEMA_KEY,'V1');
    return 'Đã kích hoạt một tab Nhân sự - Phân quyền. Ba tab cũ/Access và State được giữ nguyên để khôi phục.';
  });
}
function rollbackUnifiedAdminSheet(){
  return withLock_(function(){
    PropertiesService.getScriptProperties().deleteProperty(UNIFIED_SCHEMA_KEY);
    return 'Đã quay về cấu hình quản trị trước khi hợp nhất. Tab hợp nhất, ba tab cũ và State đều được giữ nguyên.';
  });
}
function managementRows_(ss){
  if(isUnifiedSchema_())return unifiedModel_(ss).departments;
  var sh=ss.getSheetByName(SHEET_DEPARTMENTS);
  return sh&&sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,7).getDisplayValues():[];
}
/** YC-028: This schema is dormant until the administrator explicitly activates it. */
function routingV2_(){
  if(typeof PropertiesService==='undefined')return false; // Old VM fixtures have no Script Properties.
  return isUnifiedSchema_()||(isVietnameseSchema_()&&prop_(KPI_ROUTING_KEY)==='V2');
}
/** BGD là nhóm lãnh đạo cấp đơn vị, không phải Phòng/Khu gửi KPI lên người đứng đầu. */
function isLeadershipUnit_(unit){return textKey_(unit)==='BGD';}
function kpiAssignmentKey_(unit,role){return String(unit||'').trim()+'::'+String(role||'').trim();}
function kpiRows_(ss){
  if(isUnifiedSchema_())return unifiedModel_(ss).assignments;
  var sh=ss.getSheetByName(SHEET_KPI_ASSIGNMENTS);
  return sh&&sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,3).getDisplayValues():[];
}
function assignmentCatalog_(ss){
  if(!routingV2_())return null;
  var departments={},emailAssignments={};
  managementRows_(ss).forEach(function(r){
    var unit=String(r[0]||'').trim();if(!unit)return;
    if(departments[unit]){departments[unit].invalid=true;return;}
    departments[unit]={unit:unit,name:String(r[1]||unit),head:String(r[2]||'').trim().toLowerCase(),
      acting:String(r[5]||'').trim().toLowerCase(),director:String(r[6]||'').trim().toLowerCase()};
  });
  kpiRows_(ss).forEach(function(r){
    var email=String(r[0]||'').trim().toLowerCase(),unit=String(r[1]||'').trim(),role=roleKind_(r[2]);
    if(!email||!unit||!role)return;
    if(!emailAssignments[email])emailAssignments[email]=[];
    emailAssignments[email].push({key:kpiAssignmentKey_(unit,role),unit:unit,role:role,
      label:roleLabel_(r[2]),unitName:departments[unit]?departments[unit].name:unit});
  });
  return {departments:departments,assignments:emailAssignments};
}
function activeEmailMap_(ss){
  var map={};accessRows_(ss).forEach(function(r){
    var email=String(r[0]||'').trim().toLowerCase();
    if(!email)return;
    if(map[email])map[email].active=false; // ambiguous duplicate fails closed
    else map[email]={active:enabled_(r[2]),name:String(r[1]||'').trim(),role:roleKind_(r[3]),unit:String(r[5]||'').trim()};
  });
  return map;
}
function approvedRecipient_(ss,email){
  var normalized=String(email||'').trim().toLowerCase();if(!normalized)return false;
  if(!routingV2_())return !!findActiveManager_(ss,normalized);
  var active=activeEmailMap_(ss);if(!active[normalized]||!active[normalized].active)return false;
  var catalog=assignmentCatalog_(ss);
  return Object.keys(catalog.departments).some(function(unit){
    var d=catalog.departments[unit];return !isLeadershipUnit_(unit)&&!d.invalid&&!(d.head&&d.acting)&&
      (d.head===normalized||d.acting===normalized||d.director===normalized);
  });
}
function routingRecipient_(ss,sourceEmail,assignmentKey,catalog,active){
  var list=(catalog&&catalog.assignments[String(sourceEmail||'').toLowerCase()])||[];
  var assigned=list.filter(function(a){return a.key===assignmentKey;});
  if(assigned.length!==1)return null;
  var a=assigned[0],dept=catalog.departments[a.unit];
  if(!dept||isLeadershipUnit_(a.unit)||dept.invalid||(dept.head&&dept.acting)||(!dept.head&&!dept.acting))return null;
  var recipient=['EMPLOYEE','VICE'].indexOf(a.role)!==-1?(dept.acting||dept.head):
    ['MANAGER','ACTING'].indexOf(a.role)!==-1?dept.director:'';
  if(!recipient||recipient===String(sourceEmail||'').toLowerCase()||!active[recipient]||!active[recipient].active)return null;

  var destList=catalog.assignments[recipient]||[];
  var wantRole=['EMPLOYEE','VICE'].indexOf(a.role)!==-1?(dept.acting?'ACTING':'MANAGER'):'DIRECTOR';
  if(wantRole==='DIRECTOR'&&active[recipient].role!=='DIRECTOR')return null;
  if(!destList.some(function(x){return x.unit===a.unit&&x.role===wantRole;}))return null;
  return {email:recipient,name:active[recipient].name,unit:a.unit,unitName:dept.name,role:a.role};
}
function routeForTask_(ss,info,task,catalog,active){
  if(routingV2_())return routingRecipient_(ss,info.email,task.assignmentKey,catalog||assignmentCatalog_(ss),active||activeEmailMap_(ss));
  if(task.assignmentKey)return null; // Fail closed after rolling V2 back; never reroute a V2 task to legacy manager.
  if(isManagerRole_(info.role)||!info.managerEmail)return null;
  var old=findActiveManager_(ss,info.managerEmail);
  return old?{email:old.email,name:old.name,unit:info.unit,unitName:info.unit,role:roleKind_(info.role)}:null;
}
function assignmentForSave_(info,key,type,existing){
  if(type!=='kpi')return '';
  var assignments=info.assignments||[];
  if(!routingV2_())return existing&&existing.assignmentKey?existing.assignmentKey:''; // Keep V2 context during rollback; never misroute.
  if(existing&&existing.assignmentKey&&!key)key=existing.assignmentKey;
  if(!key&&assignments.length===1)key=assignments[0].key;
  if(!key||!assignments.some(function(a){return a.key===key;}))
    throw fail_('BAD_REQUEST','Hãy chọn Phòng/Khu và chức vụ hợp lệ cho công việc KPI.');
  return key;
}
/** Administrator runs manually. Does not touch account or task data or activate itself. */
function prepareKpiRoutingSheets(){
  if(isUnifiedSchema_())throw new Error('Đã dùng tab quản trị hợp nhất.');
  if(!isVietnameseSchema_())throw new Error('Cần kích hoạt bảng Tài khoản tiếng Việt trước.');
  if(routingV2_())throw new Error('Cơ chế phân quyền mới đã kích hoạt.');
  var ss=book_(),d=ss.getSheetByName(SHEET_DEPARTMENTS),u=ss.getSheetByName(SHEET_USERS);
  if(!d||!u)throw new Error('Thiếu Tài khoản hoặc Quản lý Phòng-Khu.');
  var f=String(d.getRange(1,6).getDisplayValue()||''),g=String(d.getRange(1,7).getDisplayValue()||'');
  if((f&&f!=='Email Quyền Trưởng phòng/Khu')||(g&&g!=='Email Ban Giám đốc phụ trách'))
    throw new Error('Cột F/G đã có thông tin khác, không ghi đè.');
  if(ss.getSheetByName(SHEET_KPI_ASSIGNMENTS))throw new Error('Đã có bảng Phân công KPI; không tạo đè.');
  d.getRange(1,6,1,2).setValues([['Email Quyền Trưởng phòng/Khu','Email Ban Giám đốc phụ trách']]);
  var a=ss.insertSheet(SHEET_KPI_ASSIGNMENTS);
  a.getRange(1,1,1,3).setValues([['Email đăng nhập','Mã Phòng/Khu','Chức vụ tại Phòng/Khu']]);
  var rows=u.getLastRow()>1?u.getRange(2,1,u.getLastRow()-1,7).getDisplayValues():[];
  var initial=rows.filter(function(r){return r[0]&&r[4]&&enabled_(r[2])&&roleKind_(r[3])!=='ADMIN';}).map(function(r){return [r[0],r[4],roleLabel_(r[3])];});
  if(initial.length)a.getRange(2,1,initial.length,3).setValues(initial);
  configureAdminView_(a,[280,175,260]);
  SpreadsheetApp.flush();
  return 'Đã chuẩn bị Phân công KPI và cột F/G của Quản lý Phòng-Khu, chưa kích hoạt. Hãy điền Ban Giám đốc và kiểm tra trước.';
}
/**
 * Chỉ người quản trị tự chạy sau khi sao lưu, để CÓ THỂ chọn vai trò mới trong Sheet.
 * Không sửa giá trị tài khoản, phân công, trạng thái hay State; không bật phân quyền V2.
 */
function prepareKpiRoleDropdowns(){
  if(isUnifiedSchema_())throw new Error('Đã dùng tab Nhân sự - Phân quyền; cấu hình vai trò ở tab hợp nhất.');
  if(!isVietnameseSchema_())throw new Error('Cần sử dụng tab Tài khoản tiếng Việt.');
  var ss=book_(),users=ss.getSheetByName(SHEET_USERS),assignments=ss.getSheetByName(SHEET_KPI_ASSIGNMENTS);
  if(!users||!assignments)throw new Error('Thiếu Tài khoản hoặc Phân công KPI. Hãy kiểm tra tab hiện có.');
  if(String(users.getRange(1,4).getDisplayValue()||'').trim()!=='Vai trò'||
     String(assignments.getRange(1,3).getDisplayValue()||'').trim()!=='Chức vụ tại Phòng/Khu')
    throw new Error('Tiêu đề cột chức vụ không đúng. Không thay đổi xác thực dữ liệu.');
  var list=['Nhân viên','Phó Trưởng phòng/Khu','Trưởng phòng/Khu',
    'Quyền Trưởng phòng/Khu','Ban Giám đốc','Quản trị viên'];
  var rule=SpreadsheetApp.newDataValidation().requireValueInList(list,true).setAllowInvalid(false).build();
  if(users.getMaxRows()>1)users.getRange(2,4,users.getMaxRows()-1,1).setDataValidation(rule);
  if(assignments.getMaxRows()>1)assignments.getRange(2,3,assignments.getMaxRows()-1,1).setDataValidation(rule);
  SpreadsheetApp.flush();
  return 'Đã cho phép chọn Ban Giám đốc/Quyền Trưởng phòng trong Tài khoản và Phân công KPI. Chưa đổi bất kỳ giá trị hoặc kích hoạt V2.';
}
function validateKpiRoutingSheets(){
  if(isUnifiedSchema_())return validateUnifiedAdminSheet();
  var ss=book_(),departments=managementRows_(ss),rows=kpiRows_(ss),active=activeEmailMap_(ss),errors=[];
  if(!ss.getSheetByName(SHEET_KPI_ASSIGNMENTS))return {ok:false,errors:['Chưa có tab Phân công KPI.']};
  if(!departments.length||!rows.length)errors.push('Thiếu Phòng/Khu hoặc phân công chức vụ.');
  var assignments={},departmentsByKey={};
  rows.forEach(function(r,i){
    var email=String(r[0]||'').trim().toLowerCase(),unit=String(r[1]||'').trim(),role=roleKind_(r[2]);
    if(!email||!unit||!['EMPLOYEE','VICE','MANAGER','ACTING','DIRECTOR'].includes(role)){
      errors.push('Phân công dòng '+(i+2)+': thiếu hoặc sai email, Phòng/Khu, chức vụ.');return;
    }
    if(!active[email]||!active[email].active)errors.push('Phân công dòng '+(i+2)+': email không thuộc tài khoản đang hoạt động.');
    if(role==='DIRECTOR'&&active[email]&&active[email].role!=='DIRECTOR')
      errors.push('Phân công dòng '+(i+2)+': vai trò Ban Giám đốc chưa được khai báo ở tab Tài khoản.');
    if(isLeadershipUnit_(unit)&&role!=='DIRECTOR')
      errors.push('Phân công dòng '+(i+2)+': đơn vị BGD chỉ dùng khai báo thành viên Ban Giám đốc.');
    var key=email+'::'+unit;if(assignments[key])errors.push('Phân công dòng '+(i+2)+': một người có nhiều chức vụ trong cùng Phòng/Khu.');
    assignments[key]=role;
  });
  departments.forEach(function(d,i){
    var unit=String(d[0]||'').trim(),head=String(d[2]||'').trim().toLowerCase(),acting=String(d[5]||'').trim().toLowerCase(),director=String(d[6]||'').trim().toLowerCase();
    if(!unit||departmentsByKey[unit])errors.push('Phòng/Khu dòng '+(i+2)+': mã trùng hoặc trống.');
    departmentsByKey[unit]=true;
    // BGD là đơn vị tổ chức lãnh đạo, không tạo vòng thông báo BGD -> BGD.
    // Các ô C/D/E cũ giữ nguyên, riêng F/G không bắt buộc nhập và sẽ bị bỏ qua.
    if(isLeadershipUnit_(unit))return;
    if(!!head===!!acting)errors.push('Phòng/Khu '+unit+': phải có đúng một Trưởng hoặc Quyền Trưởng phòng.');
    if(!director)errors.push('Phòng/Khu '+unit+': thiếu Ban Giám đốc phụ trách.');
    if(head&&assignments[head+'::'+unit]!=='MANAGER')errors.push('Phòng/Khu '+unit+': Trưởng phòng không có phân công hợp lệ.');
    if(acting&&assignments[acting+'::'+unit]!=='ACTING')errors.push('Phòng/Khu '+unit+': Quyền Trưởng phòng không có phân công hợp lệ.');
    if(director&&(!active[director]||!active[director].active||active[director].role!=='DIRECTOR'))
      errors.push('Phòng/Khu '+unit+': cột G phải là email Ban Giám đốc đang hoạt động trong Tài khoản.');
    if(director&&assignments[director+'::'+unit]!=='DIRECTOR')
      errors.push('Phòng/Khu '+unit+': Ban Giám đốc chưa có phân công tương ứng trong tab Phân công KPI.');
    if((head||acting)===director)errors.push('Phòng/Khu '+unit+': người đứng đầu không được tự chấm chính mình.');
  });
  rows.forEach(function(r,i){var unit=String(r[1]||'').trim();if(!departmentsByKey[unit])errors.push('Phân công dòng '+(i+2)+': mã Phòng/Khu không tồn tại.');});
  return {ok:!errors.length,errors:errors,assignments:rows.length,departments:departments.length};
}
function inspectKpiRoutingSheets(){
  var validation=validateKpiRoutingSheets();
  var message=validation.ok?'Hợp lệ: '+validation.assignments+' phân công, '+validation.departments+' Phòng/Khu.':
    'Có '+validation.errors.length+' vấn đề cần xử lý:\n'+validation.errors.join('\n');
  Logger.log(message);
  try{SpreadsheetApp.getUi().alert('Kiểm tra phân công KPI',message,SpreadsheetApp.getUi().ButtonSet.OK);}catch(_ignored){}
  return validation;
}
function activateKpiRoutingSheets(){
  if(isUnifiedSchema_())throw new Error('Đang dùng một tab Nhân sự - Phân quyền; không kích hoạt V2 riêng.');
  return withLock_(function(){
    if(!isVietnameseSchema_())throw new Error('Chưa sử dụng tab Tài khoản tiếng Việt.');
    var result=validateKpiRoutingSheets();
    if(!result.ok)throw new Error('Chưa thể kích hoạt: '+result.errors.slice(0,12).join(' | '));
    PropertiesService.getScriptProperties().setProperty(KPI_ROUTING_KEY,'V2');
    return 'Đã kích hoạt phân công KPI V2. Không thay đổi dữ liệu công việc cũ.';
  });
}
function rollbackKpiRoutingSheets(){
  if(isUnifiedSchema_())throw new Error('Dùng rollbackUnifiedAdminSheet để quay lại cấu hình cũ.');
  return withLock_(function(){PropertiesService.getScriptProperties().deleteProperty(KPI_ROUTING_KEY);
    return 'Đã tắt định tuyến KPI V2. Bảng phân công và State vẫn được giữ nguyên.';});
}
function accessRows_(ss){
  if(isUnifiedSchema_()){
    return unifiedModel_(ss).people.map(function(r){return [r[0],r[1],r[2],r[3],r[4],r[5],r[6]];});
  }
  var vietnamese=isVietnameseSchema_(),sh=ss.getSheetByName(vietnamese?SHEET_USERS:SHEET_ACCESS);
  if(!sh)throw new Error('Không tìm thấy tab tài khoản phù hợp. Vui lòng liên hệ quản trị viên.');
  if(sh.getLastRow()<2)return [];
  if(!vietnamese)return sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()>=5?5:4).getDisplayValues();
  // Trả cùng định dạng Access v1.5.0: email, tên, hoạt động, vai trò, email quản lý, mã phòng.
  // Không sử dụng email do người dùng tự gửi lên; người nhận chỉ được tra từ cấu hình được kiểm tra.
  var people=sh.getRange(2,1,sh.getLastRow()-1,7).getDisplayValues();
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
    return [r[0],r[1],duplicateEmail[email]?'Ngừng hoạt động':r[2],r[3],ambiguous[unit]?'':(managers[unit]||''),unit,r[6]||''];
  });
}
function checkAccess_(ss,actor){
  var email=String(actor.email).trim().toLowerCase();
  var entries=accessRows_(ss);
  for(var i=0;i<entries.length;i++){
    if(String(entries[i][0]).trim().toLowerCase()!==email)continue;
    if(!enabled_(entries[i][2]))throw fail_('FORBIDDEN','Tài khoản chưa được kích hoạt hoặc đã bị thu hồi quyền.');
    var catalog=assignmentCatalog_(ss);
    return {email:email,name:String(entries[i][1]).trim()||String(actor.name||'').slice(0,80)||email,role:String(entries[i][3]||'').trim(),managerEmail:String(entries[i][4]||'').trim().toLowerCase(),unit:String(entries[i][5]||'').trim(),isAdmin:adminPermission_(entries[i][6],entries[i][3]),assignments:catalog?(catalog.assignments[email]||[]):[],routingEnabled:!!catalog};
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
  return {email:info.email,name:info.name,externalId:ext,defaultTime:profile.defaultTime,revision:profile.revision,isAdmin:accountIsAdmin_(info),managerConfigured:!!info.managerEmail&&!isManagerRole_(info.role)||!!info.routingEnabled,
    routingEnabled:!!info.routingEnabled,assignments:info.assignments||[],
    deletedSourceKeys:profile.deletedSourceKeys,
    inbox:profile.inbox.filter(function(n){return !n.dismissed;}).map(function(n){return {id:n.id,from:n.from,title:n.title,at:n.at,unit:n.unit||'',unitName:n.unitName||''};}),
    tasks:profile.tasks.filter(function(t){return !t.deleted;}).map(function(t){
      var pending=(t.slots||[]).filter(function(s){return !s.id&&s.at>now&&s.at<=horizon;}).length;
      return {id:t.id,title:t.title,dueDate:t.dueDate,time:t.time,sourceKey:t.sourceKey||'',workType:t.workType||'legacy',assignmentKey:t.assignmentKey||'',pending:pending,
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
/** Deliver an individual completion in O(one source + one target) Sheets rows. */
function deliverSingleCompletion_(ss,sourceRow,sourceEmail,completionId,recipientEmail){
  if(!recipientEmail||!approvedRecipient_(ss,recipientEmail))return false;
  var sh=stateSheet_(ss),recipientRow=stateRowByEmail_(sh,recipientEmail);
  if(!recipientRow)return false; // Await manager's first authenticated login.
  var sender=normalizeState_(JSON.parse(String(sh.getRange(sourceRow,3).getValue())));
  var event=sender.completionOutbox.find(function(x){return x.id===completionId;});
  if(!event)return false;
  if(routingV2_()){
    var current=routingRecipient_(ss,sourceEmail,event.assignmentKey,assignmentCatalog_(ss),activeEmailMap_(ss));
    if(!current||current.email!==recipientEmail)return false;
  }else if(!findActiveManager_(ss,recipientEmail))return false;
  var raw=sh.getRange(recipientRow,3).getValue();
  var recipient=normalizeState_(raw?JSON.parse(String(raw)):newState_());
  if(!recipient.inbox.some(function(x){return x.id===completionId;})){
    recipient.inbox.push({id:event.id,from:event.from,title:event.title,at:event.at,
      unit:event.unit||'',unitName:event.unitName||'',pushSent:false,nextRetryAt:0});
    bumpRevision_(recipient);saveState_(sh,recipientRow,recipient,recipientEmail);
  }
  sender.completionOutbox=sender.completionOutbox.filter(function(x){return x.id!==completionId;});
  saveState_(sh,sourceRow,sender,sourceEmail);
  return true;
}
function deliverOutbox_(ss,managerEmail){
  managerEmail=String(managerEmail||'').toLowerCase();
  if(!managerEmail||!approvedRecipient_(ss,managerEmail))return false;
  var sh=stateSheet_(ss),targetRow=stateRowByEmail_(sh,managerEmail);if(!targetRow)return false;
  var raw=sh.getRange(targetRow,3).getValue(),recipient=normalizeState_(raw?JSON.parse(String(raw)):newState_());
  var last=sh.getLastRow(),rows=sh.getRange(2,2,last-1,2).getValues(),delivered=false;
  var access=accessRows_(ss),catalog=assignmentCatalog_(ss),active=catalog?activeEmailMap_(ss):null;
  for(var i=0;i<rows.length;i++){
    var row=i+2,sourceEmail=String(rows[i][0]||'').trim().toLowerCase();
    if(sourceEmail===managerEmail||!rows[i][1])continue;
    var sourceAccess=access.find(function(a){return String(a[0]||'').trim().toLowerCase()===sourceEmail&&enabled_(a[2]);});
    if(!sourceAccess)continue;
    var source;
    try{source=normalizeState_(JSON.parse(String(rows[i][1])));}catch(err){continue;}
    if(!source.completionOutbox.length)continue;
    var transferred={},recipientDirty=false;
    source.completionOutbox.forEach(function(e){
      var target='';
      if(catalog&&e.assignmentKey){
        var route=routingRecipient_(ss,sourceEmail,e.assignmentKey,catalog,active);
        target=route?route.email:'';
      }else if(e.assignmentKey||catalog&&e.routePending){
        target=''; // Never route V2 events through Access after rollback.
      }else{
        // Legacy events keep their original Access-based routing semantics.
        target=String(sourceAccess[4]||'').trim().toLowerCase();
      }
      if(target!==managerEmail)return;
      if(!recipient.inbox.some(function(m){return m.id===e.id;})){
        recipient.inbox.push({id:e.id,from:e.from,title:e.title,at:e.at,unit:e.unit||'',unitName:e.unitName||'',pushSent:false,nextRetryAt:0});
        delivered=true;recipientDirty=true;
      }
      transferred[e.id]=true;
    });
    if(Object.keys(transferred).length){
      if(recipientDirty){bumpRevision_(recipient);saveState_(sh,targetRow,recipient,managerEmail);}
      source.completionOutbox=source.completionOutbox.filter(function(e){return !transferred[e.id];});
      saveState_(sh,row,source,sourceEmail);
    }
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
    if(!accountIsAdmin_(info))throw fail_('FORBIDDEN','Bạn không có quyền xem tổng quan quản trị.');
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
    if(approvedRecipient_(ss,info.email)){
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
    var requestedType=String(d.workType||'');
    var type=existing&&(!requestedType||requestedType==='legacy')?(existing.workType||'legacy'):(requestedType||'legacy');
    if(['personal','kpi','legacy'].indexOf(type)===-1)
      throw fail_('BAD_REQUEST','Loại công việc không hợp lệ.');
    if(existing&&existing.source==='icpv'&&type==='personal')throw fail_('BAD_REQUEST','Không thể chuyển nhiệm vụ iCPV sang công việc cá nhân.');
    var assignmentKey=assignmentForSave_(info,d.assignmentKey||'',type,existing);
    if(d.id&&!existing)throw fail_('BAD_REQUEST','Không tìm thấy công việc cần sửa.');
    if(!existing&&p.tasks.filter(function(t){return !t.deleted&&t.dueDate>=vnToday_();}).length>=MAX_ACTIVE)
      throw fail_('BAD_REQUEST','Tài khoản đang có quá nhiều lịch nhắc (50). Hãy xóa những lịch không cần thiết.');
    if(existing&&existing.title===title&&existing.dueDate===due&&existing.time===time&&(existing.workType||'legacy')===type&&(existing.assignmentKey||'')===assignmentKey){
      if(dirty)saveState_(sh,item.row,p,info.email);
      return {view:publicView_(p,info,req.actor.externalId),sync:false,changed:false};
    }
    if(existing)prepareCancellation_(p,existing);
    var task=existing||{id:Utilities.getUuid()};
    task.title=title;task.dueDate=due;task.time=time;task.workType=type;task.assignmentKey=assignmentKey;
    task.deleted=false;task.lastError='';task.slots=slotsFor_(task);
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
      var keyAssignment=assignmentForSave_(info,String(source.assignmentKey||''),'kpi',null);
      var task={id:Utilities.getUuid(),source:'icpv',sourceKey:key,workType:'kpi',assignmentKey:keyAssignment,title:title,
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
  // v1.7: deliberate review of the CURRENT visible iCPV page. Never auto-merge by title.
  if(action==='reviewIcpv'){
    requireRevision_(d,p);
    if(!Array.isArray(d.decisions)||!d.decisions.length||d.decisions.length>30)
      throw fail_('BAD_REQUEST','Hãy chọn từ 1 đến 30 công việc để xử lý.');
    var today=vnToday_(),now=Date.now(),limit=now+3*366*DAY_MS;
    var touched={},seenSource={},summary={added:0,updated:0,unchanged:0,skipped:0,notes:[]};
    var planned=[];
    // Validate the entire batch before mutating the account: all-or-nothing behavior.
    d.decisions.forEach(function(x,i){
      var kind=String(x&&x.kind||''),key=String(x&&x.sourceKey||'');
      var title=String(x&&x.title||'').trim(),due=String(x&&x.dueDate||'');
      if(['add','update'].indexOf(kind)===-1||!/^icpv:[a-f0-9]{64}$/.test(key)||
         !title||title.length>90||!validDay_(due))
        throw fail_('BAD_REQUEST','Nhiệm vụ được chọn tại dòng '+(i+1)+' không hợp lệ.');
      if(seenSource[key])throw fail_('BAD_REQUEST','Một nhiệm vụ đang được chọn nhiều lần.');
      seenSource[key]=true;
      var target=null,time=p.defaultTime;
      if(kind==='update'){
        target=p.tasks.find(function(t){return !t.deleted&&t.id===x.targetId;});
        if(!target||touched[target.id])throw fail_('BAD_REQUEST','Hãy chọn đúng công việc đang theo dõi để cập nhật.');
        touched[target.id]=true;time=target.time;
      }
      if(due<today||dateMs_(due,time,0)<=now+30000||dateMs_(due,time,0)>limit)
        throw fail_('BAD_REQUEST','Thời hạn công việc ở dòng '+(i+1)+' đã quá hoặc không hợp lệ.');
      var keyAssignment=assignmentForSave_(info,String(x.assignmentKey||''),'kpi',target);
       planned.push({kind:kind,key:key,title:title,due:due,time:time,target:target,assignmentKey:keyAssignment});
    });
    var active=p.tasks.filter(function(t){return !t.deleted&&t.dueDate>=today;}).length;
    var added=planned.filter(function(x){return x.kind==='add';}).length;
    if(active+added>MAX_ACTIVE)throw fail_('BAD_REQUEST','Tài khoản sẽ vượt giới hạn 50 công việc chưa quá hạn.');
    var changedTasks=[];
    planned.forEach(function(x){
      if(x.kind==='update'){
        var t=x.target;
        if(t.title===x.title&&t.dueDate===x.due&&(t.workType||'legacy')==='kpi'&&(t.assignmentKey||'')===x.assignmentKey){
          if(t.sourceKey!==x.key||t.source!=='icpv'){
            t.source='icpv';t.sourceKey=x.key;t.workType='kpi';t.assignmentKey=x.assignmentKey;changedTasks.push(t);summary.updated++;
          }else summary.unchanged++;
          return;
        }
        prepareCancellation_(p,t);t.title=x.title;t.dueDate=x.due;t.slots=slotsFor_(t);t.lastError='';
        // Only explicitly chosen items are linked to the new source description.
        t.source='icpv';t.sourceKey=x.key;t.workType='kpi';t.assignmentKey=x.assignmentKey;
         summary.updated++;changedTasks.push(t);
      }else{
        var already=p.tasks.some(function(t){return !t.deleted&&t.source==='icpv'&&t.sourceKey===x.key;});
        // Explicit ADD is allowed even with the same name/key: use a separate manual copy
        // rather than silently merging it into an existing iCPV-linked job.
        var task={id:Utilities.getUuid(),source:already?'manual':'icpv',
          sourceKey:already?'':x.key,workType:'kpi',assignmentKey:x.assignmentKey,title:x.title,dueDate:x.due,time:x.time,
          deleted:false,lastError:'',slots:[]};
        task.slots=slotsFor_(task);p.tasks.push(task);p.totalCreated++;
        summary.added++;changedTasks.push(task);
      }
    });
    if(changedTasks.length){bumpRevision_(p);saveState_(sh,item.row,p,info.email);}
    else if(dirty)saveState_(sh,item.row,p,info.email);
    var reviewView=publicView_(p,info,req.actor.externalId);
    reviewView.importSummary=summary;
    reviewView.notice='Đã thêm '+summary.added+' công việc, cập nhật '+summary.updated+' công việc. '+summary.unchanged+' công việc giữ nguyên.';
    return {view:reviewView,sync:changedTasks.length>0,urgentSync:false,
      changed:changedTasks.length>0,change:changedTasks.length?{
        type:'importBatch',tasks:reviewView.tasks.filter(function(t){
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
    if(completed&&routingV2_()&&(!target.workType||target.workType==='legacy'))
      throw fail_('BAD_REQUEST','Công việc cũ chưa phân loại. Hãy mở Sửa, chọn KPI hoặc Cá nhân và Phòng/Khu (nếu cần) trước khi đánh dấu hoàn thành.');
    var isKpi=completed&&(target.workType==='kpi'||((!target.workType||target.workType==='legacy')&&!isManagerRole_(info.role)));
    var route=isKpi?routeForTask_(ss,info,target):null;
    var manager=route?{email:route.email,name:route.name}:null;
    prepareCancellation_(p,target);target.deleted=true;bumpRevision_(p);
    if(target.source==='icpv'&&target.sourceKey&&p.deletedSourceKeys.indexOf(target.sourceKey)===-1)
      p.deletedSourceKeys.push(target.sourceKey);
    var completionId='';
    if(isKpi&&(manager||target.workType==='kpi')){
      completionId=Utilities.getUuid();
      // Durable even when the administrator has not configured a valid approver.
      p.completionOutbox.push({id:completionId,from:info.name,title:target.title.slice(0,90),
        at:new Date().toISOString(),assignmentKey:target.assignmentKey||'',
        unit:route?route.unit:info.unit,unitName:route?route.unitName:'',
        routePending:!manager,managerEmail:manager?manager.email:''});
    }
    var urgentCancel=p.cancellations.some(function(c){return c.at>Date.now()+30000&&c.at<=Date.now()+90*60000;});
    saveState_(sh,item.row,p,info.email);
    var deliveredToManager=false;
    if(manager&&completionId){try{deliveredToManager=deliverSingleCompletion_(ss,item.row,info.email,completionId,manager.email);}
      catch(err){console.error('Manager delivery:',err.message||err);}}
    var out=publicView_(p,info,req.actor.externalId);
    out.notice=!completed?(d.mode==='discard'?'Đã xóa công việc nhập nhầm.':'Đã xóa công việc.'):!isKpi?
       'Đã hoàn thành công việc cá nhân. Không gửi thông báo chấm điểm.':manager?
      (deliveredToManager?'Đã chuyển thông báo chờ người quản lý xem xét.':'Đã ghi nhận hoàn thành KPI; thông báo đang chờ chuyển đến người quản lý.'):
       (target.workType==='kpi'?'Đã ghi nhận hoàn thành KPI; chưa xác định được người chấm điểm. Sự kiện được lưu để xử lý.':'Đã xóa công việc. Chưa có Trưởng phòng được cấu hình để nhận thông báo.');
    return {view:out,sync:true,urgentSync:urgentCancel,changed:true,managerPushEmail:deliveredToManager?manager.email:'',
      pendingDelivery:manager&&completionId&&!deliveredToManager?{
        sourceRow:item.row,sourceEmail:info.email,recipientEmail:manager.email,completionId:completionId}:null,
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
function createManagerNotification_(notice,externalId,idempotencyKey,isReminder){
  return oneSignal_('post','/notifications',{
    app_id:prop_('ONESIGNAL_APP_ID'),target_channel:'push',include_aliases:{external_id:[externalId]},
    headings:{en:isReminder?'Nhắc chấm điểm công việc':'Nhân viên đã hoàn thành công việc'},
    contents:{en:(isReminder?'Công việc chờ chấm điểm: ':'')+notice.from+' đã hoàn thành: '+notice.title.slice(0,60)+(notice.unitName?' ['+notice.unitName+']':'')+'. Vui lòng vào iCPV chấm điểm.'},
    url:prop_('WEB_URL'),idempotency_key:idempotencyKey||notice.id
  });
}
/** Không tự đặt giờ mặc định: chỉ nhắc lại khi người quản trị đã xác nhận và đặt thuộc tính. */
function managerReminderTime_(){var value=String(prop_('MANAGER_REMINDER_TIME')||'').trim();return validTime_(value)?value:'';}
function managerAlertKind_(message,now){
  if(message.dismissed||(message.leaseUntil&&message.leaseUntil>now))return '';
  if(!message.pushSent)return !message.nextRetryAt||message.nextRetryAt<=now?'manager':'';
  var time=managerReminderTime_();if(!time)return '';
  var today=Utilities.formatDate(new Date(now),VN_ZONE,'yyyy-MM-dd');
  var hhmm=Utilities.formatDate(new Date(now),VN_ZONE,'HH:mm');
  var first=message.initialPushDay||(message.at?Utilities.formatDate(new Date(message.at),VN_ZONE,'yyyy-MM-dd'):today);
  if(today<=first||hhmm<time||message.lastReminderDay===today)return '';
  if(message.dailyAttemptDay===today&&message.nextRetryAt&&message.nextRetryAt>now)return '';
  return 'managerReminder';
}
function reserveManagerJob_(message,kind,now,externalId){
  message.leaseUntil=now+CLAIM_MS;
  var day='';
  if(kind==='managerReminder'){
    day=Utilities.formatDate(new Date(now),VN_ZONE,'yyyy-MM-dd');
    if(message.dailyAttemptDay!==day){
      message.dailyAttemptDay=day;
      message.dailyAttemptKey=Utilities.getUuid();
      message.nextRetryAt=0;
    }
  }
  return {key:message.id,kind:kind,slot:JSON.parse(JSON.stringify(message)),externalId:externalId,
    idempotencyKey:kind==='managerReminder'?message.dailyAttemptKey:message.id,sendDay:day};
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
    var hasManagerPending=p.externalId&&p.inbox.some(function(m){
      return !!managerAlertKind_(m,now);
    });
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
      if(!p.externalId)continue;
      var kind=managerAlertKind_(m,now);if(!kind)continue;
      changed=true;jobs.push(reserveManagerJob_(m,kind,now,p.externalId));
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
      if(r.kind==='manager'||r.kind==='managerReminder'){
        if(found.type==='manager'&&!s.dismissed){
          if(r.kind==='manager'){
            if(r.id){s.pushSent=true;s.initialPushDay=Utilities.formatDate(new Date(now),VN_ZONE,'yyyy-MM-dd');s.nextRetryAt=0;}
            else s.nextRetryAt=now+6*CLOCK_MS;
          }else if(s.dailyAttemptDay===r.sendDay){
            if(r.id){s.lastReminderDay=r.sendDay;s.nextRetryAt=0;}
            else s.nextRetryAt=now+2*CLOCK_MS;
          }
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
/** YC-032: send independent notifications concurrently at the provider request layer.
 * The existing idempotency keys protect retries after an uncertain batch response.
 * Unit tests and older environments safely use the individual-request fallback.
 */
function performJobs_(jobs){
  if(!jobs.length)return [];
  if(typeof UrlFetchApp!=='undefined'&&typeof UrlFetchApp.fetchAll==='function'&&jobs.length>1){
    try{
      var apiRequests=jobs.map(function(j){
        var method=j.kind==='cancel'?'delete':'post',path='',body=null;
        if(j.kind==='cancel')path='/notifications/'+encodeURIComponent(j.slot.id)+'?app_id='+encodeURIComponent(prop_('ONESIGNAL_APP_ID'));
        else if(j.kind==='manager'||j.kind==='managerReminder'){
          path='/notifications';body={app_id:prop_('ONESIGNAL_APP_ID'),target_channel:'push',
            include_aliases:{external_id:[j.externalId]},
            headings:{en:j.kind==='managerReminder'?'Nhắc chấm điểm công việc':'Nhân viên đã hoàn thành công việc'},
            contents:{en:(j.kind==='managerReminder'?'Công việc chờ chấm điểm: ':'')+j.slot.from+' đã hoàn thành: '+j.slot.title.slice(0,60)+(j.slot.unitName?' ['+j.slot.unitName+']':'')+'. Vui lòng vào iCPV chấm điểm.'},
            url:prop_('WEB_URL'),idempotency_key:j.idempotencyKey||j.slot.id};
        }else{
          path='/notifications';var offset=j.slot.offset,day=j.task.dueDate;
          body={app_id:prop_('ONESIGNAL_APP_ID'),target_channel:'push',
            include_aliases:{external_id:[j.externalId]},headings:{en:'Nhắc việc KPI'},
            contents:{en:(offset===0?'Hôm nay đến hạn':'Còn '+offset+' ngày đến hạn')+' ('+vnDay_(day)+'): '+j.task.title.slice(0,48)},
            url:prop_('WEB_URL'),send_after:new Date(j.slot.at).toISOString(),idempotency_key:j.slot.key};
        }
        var opts={url:'https://api.onesignal.com'+path,method:method,
          headers:{Authorization:'Key '+prop_('ONESIGNAL_REST_API_KEY')},muteHttpExceptions:true};
        if(body){opts.contentType='application/json';opts.payload=JSON.stringify(body);}
        return opts;
      });
      var responses=UrlFetchApp.fetchAll(apiRequests);
      if(!responses||responses.length!==jobs.length)throw new Error('OneSignal trả thiếu kết quả cho lô thông báo.');
      return jobs.map(function(j,i){
        var result={key:j.key,leaseUntil:j.slot.leaseUntil,kind:j.kind,sendDay:j.sendDay||'',id:'',error:''};
        var code=responses[i].getResponseCode(),raw=responses[i].getContentText(),parsed={};
        try{parsed=JSON.parse(raw);}catch(_ignored){}
        if((code>=200&&code<300)||(j.kind==='cancel'&&code===404))result.id=String(parsed.id||'');
        else result.error='OneSignal HTTP '+code+': '+String(parsed.errors||parsed.message||raw).slice(0,140);
        return result;
      });
    }catch(batchError){
      console.error('OneSignal batch uncertain; reconcile with idempotency keys:',batchError.message||batchError);
      // Retry using identical keys. A prior accepted POST will not create another reminder.
    }
  }
  return jobs.map(function(j){
    var result={key:j.key,leaseUntil:j.slot.leaseUntil,kind:j.kind,sendDay:j.sendDay||'',id:'',error:''};
    try{
      if(j.kind==='manager'||j.kind==='managerReminder')result.id=String(createManagerNotification_(j.slot,j.externalId,j.idempotencyKey,j.kind==='managerReminder').id||'');
      else if(j.kind==='cancel')cancelNotification_(j.slot.id);
      else {var response=createNotification_(j.slot,j.task,j.externalId);result.id=String(response.id||'');}
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
    var kind=managerAlertKind_(m,now);if(!kind)continue;
    changed=true;jobs.push(reserveManagerJob_(m,kind,now,p.externalId));
  }
  if(changed)saveState_(sh,row,p,email);
  return jobs;
}
function managerRealtimeHint_(ss,email){
  var sh=stateSheet_(ss),row=stateRowByEmail_(sh,email);
  if(!row||!approvedRecipient_(ss,email))return null;
  var subject=String(sh.getRange(row,1).getValue()||'');
  var raw=String(sh.getRange(row,3).getValue()||'');
  if(!subject||!raw)return null;
  var p=normalizeState_(JSON.parse(raw));
  if(!p.inbox.some(function(x){return !x.dismissed;}))return null;
  return {subject:subject,revision:p.revision};
}
function syncManagerByEmail_(email,maxCalls){
  var context=withLock_(function(){
    var ss=book_(),sh=stateSheet_(ss),row=stateRowByEmail_(sh,email);
    if(!row||!approvedRecipient_(ss,email))return null;
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
    // Nếu thao tác chuyển từ outbox vào inbox bị lỗi thoáng qua, thử lại sau
    // khi transaction của nhân viên đã được COMMIT. Không mất dữ liệu nếu vẫn lỗi.
    if(result.pendingDelivery&&!result.managerPushEmail){
      try{
        var retryDelivered=withLock_(function(){
          var a=result.pendingDelivery;
          return deliverSingleCompletion_(book_(),a.sourceRow,a.sourceEmail,a.completionId,a.recipientEmail);
        });
        if(retryDelivered)result.managerPushEmail=result.pendingDelivery.recipientEmail;
      }catch(deliveryErr){console.error('Completion delivery deferred:',deliveryErr.message||deliveryErr);}
    }
    // Push người quản lý không chờ việc hủy lịch nhắc của nhân viên.
    // Realtime là tín hiệu THAY ĐỔI không chứa nội dung công việc, chỉ phát
    // sau khi thông báo đã được đưa vào inbox có State xác thực.
    var managerRealtime=null;
    if(result.managerPushEmail){
      try{syncManagerByEmail_(result.managerPushEmail,2);}catch(managerErr){console.error('Deferred manager push:',managerErr.message||managerErr);}
      try{managerRealtime=withLock_(function(){return managerRealtimeHint_(book_(),result.managerPushEmail);});}
      catch(realtimeErr){console.error('Manager change signal deferred:',realtimeErr.message||realtimeErr);}
    }
    return jsonOutput_({ok:true,result:result.view,changed:!!result.changed,change:result.change||null,
      needsSync:!!result.sync&&!syncedInline,
      // Internal server-only routing metadata. api/data.js MUST NOT send this to browser.
      managerRealtime:managerRealtime});
  }catch(err){
    console.error('doPost:',err&&err.stack||err);
    return jsonOutput_({ok:false,code:err&&err.clientCode||'SERVER',error:err&&err.clientMessage||'Không thể xử lý. Vui lòng thử lại hoặc liên hệ quản trị viên.'});
  }
}
/** YC-032: bounded retry of durable completion events even when the manager PWA is closed.
 * No new trigger or database: sender outboxes already persist in State.
 * If a manager has never signed in there is no authenticated State/subscription yet;
 * their first login performs delivery, and these events remain queued until then.
 */
function recoverPendingCompletions_(ss,rows,startIndex,maxRecipients){
  var catalog=assignmentCatalog_(ss),active=catalog?activeEmailMap_(ss):null;
  var access=accessRows_(ss),bySource={},present={},candidates=[];
  access.forEach(function(r){bySource[String(r[0]||'').trim().toLowerCase()]=r;});
  rows.forEach(function(r){if(r&&r[1])present[String(r[1]).trim().toLowerCase()]=true;});
  for(var n=0;n<rows.length&&candidates.length<maxRecipients;n++){
    var src=rows[(startIndex+n)%rows.length];if(!src||!src[2])continue;
    var sourceEmail=String(src[1]||'').trim().toLowerCase(),accessRow=bySource[sourceEmail];
    if(!accessRow||!enabled_(accessRow[2]))continue;
    var profile;try{profile=normalizeState_(JSON.parse(String(src[2])));}catch(_err){continue;}
    profile.completionOutbox.forEach(function(e){
      if(candidates.length>=maxRecipients)return;
      var dest='';
      if(catalog&&e.assignmentKey){
        var current=routingRecipient_(ss,sourceEmail,e.assignmentKey,catalog,active);
        dest=current?current.email:'';
      }else if(!e.assignmentKey&&!e.routePending){dest=String(accessRow[4]||'').trim().toLowerCase();}
      if(dest&&present[dest]&&candidates.indexOf(dest)===-1)candidates.push(dest);
    });
  }
  candidates.forEach(function(email){
    var delivered=false;
    try{delivered=withLock_(function(){return deliverOutbox_(ss,email);},1800);}
    catch(err){console.error('Lỗi khôi phục thông báo chấm KPI: '+String(err.message||err));}
    if(delivered){try{syncManagerByEmail_(email,2);}catch(err){console.error('Push người quản lý sẽ thử lại: '+String(err.message||err));}}
  });
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
  // Recover manager inbox events before the normal due-date sweep. Bounded to protect quota.
  try{recoverPendingCompletions_(ss,rows,cursor,8);}catch(recoverErr){console.error('Outbox retry:',recoverErr.message||recoverErr);}
  var budget=70,processed=0; // YC-032: bounded fair backup; primary scheduling happens on save/sync.
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
      var needManager=allowed[email]&&snapshot.inbox.some(function(m){return !!managerAlertKind_(m,now);});
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
