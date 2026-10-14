'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const code=fs.readFileSync(__dirname+'/../apps-script/Code.gs','utf8');
const HEADERS=['Email đăng nhập','Họ và tên','Trạng thái','Chức danh chính','Đơn vị chính',
  'Phòng/Khu phụ trách hoặc kiêm nhiệm','Chức danh kiêm nhiệm (nếu khác)','Quyền quản trị'];
class Sheet{
  constructor(rows=[]){this.rows=rows.map(r=>[...r]);this.notes={};}
  getLastRow(){return this.rows.length;}
  getMaxRows(){return Math.max(20,this.rows.length+2);}
  setFrozenRows(){return this;}
  setColumnWidth(){return this;}
  getFilter(){return null;}
  getRange(row,col,h=1,w=1){const s=this;return {
    getValue(){return s.rows[row-1]?.[col-1]??'';},
    getDisplayValue(){return String(s.rows[row-1]?.[col-1]??'');},
    getDisplayValues(){return this.getValues().map(r=>r.map(String));},
    getValues(){return Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>s.rows[row+i-1]?.[col+j-1]??''));},
    setValue(v){s.rows[row-1]??=[];s.rows[row-1][col-1]=v;return this;},
    setValues(rows){rows.forEach((r,i)=>{s.rows[row+i-1]??=[];r.forEach((v,j)=>s.rows[row+i-1][col+j-1]=v);});return this;},
    setBackground(){return this;},setFontColor(){return this;},setFontWeight(){return this;},createFilter(){return this;},
    setDataValidation(){return this;},setNote(note){s.notes[`${row}:${col}`]=note;return this;}
  };}
}
function setup(opts={}){
  const base=[HEADERS,
    ['a@example.com','Ông A','Hoạt động','Phó Trưởng phòng/Khu','TCHC','KHTC','Quyền Trưởng phòng/Khu','Không'],
    ['b@example.com','Trưởng TCHC','Hoạt động','Trưởng phòng/Khu','TCHC','','','Không'],
    ['c@example.com','Nhân viên B','Hoạt động','Nhân viên','KHTC','','','Không'],
    ['d@example.com','Ông Nam','Hoạt động','Giám đốc','BGD','TCHC, KHTC','','Không'],
    ['e@example.com','Phó Giám đốc','Hoạt động','Phó Giám đốc','BGD','','','Không'],
    ['f@example.com','Kế toán','Hoạt động','Nhân viên','TCHC','','','Có']
  ];
  const sheets=new Map([
    ['Nhân sự - Phân quyền',new Sheet(opts.rows||base)],
    ['Tài khoản',new Sheet([['Email','Họ tên','Trạng thái','Vai trò','Mã Phòng','Cũ','Quản trị'],
      ['a@example.com','Ông A','Hoạt động','Phó Trưởng phòng/Khu','TCHC','','Không'],
      ['b@example.com','Trưởng','Hoạt động','Trưởng phòng/Khu','TCHC','','Không'],
      ['c@example.com','Nhân viên','Hoạt động','Nhân viên','KHTC','','Không'],
      ['d@example.com','Ông Nam','Hoạt động','Ban Giám đốc','BGD','','Không'],
      ['e@example.com','Phó Giám đốc','Hoạt động','Ban Giám đốc','BGD','','Không']])],
    ['Phân công KPI',new Sheet([['Email','Mã','Chức vụ'],
      ['a@example.com','TCHC','Phó Trưởng phòng/Khu'],['a@example.com','KHTC','Quyền Trưởng phòng/Khu'],
      ['b@example.com','TCHC','Trưởng phòng/Khu'],['d@example.com','TCHC','Ban Giám đốc'],
      ['d@example.com','KHTC','Ban Giám đốc'],['c@example.com','KHTC','Nhân viên']])],
    ['Quản lý Phòng-Khu',new Sheet([['Mã','Tên','Trưởng','Phó1','Phó2','Quyền','BGD'],
      ['TCHC','Phòng TCHC','b@example.com','a@example.com','','','d@example.com'],
      ['KHTC','Phòng KHTC','','','','a@example.com','d@example.com'],
      ['BGD','Ban Giám đốc','','','','','']])],
    ['Access',new Sheet([['Email','Name','Active','Role','Manager']])],
    ['State',new Sheet([['Sub','Email','JSON State','Updated At']])]
  ]);
  if(opts.withoutDraft)sheets.delete('Nhân sự - Phân quyền');
  const props=new Map([['ACCOUNT_SCHEMA','VI'],['KPI_ROUTING_SCHEMA','V2']]);
  if(!opts.inactive)props.set('ADMIN_UNIFIED_SCHEMA','V1');
  const book={getSheetByName:k=>sheets.get(k)||null,insertSheet:k=>{if(sheets.has(k))throw Error('Exists');const sh=new Sheet();sheets.set(k,sh);return sh;}};
  const context=vm.createContext({console,Date,JSON,Object,Number});vm.runInContext(code,context);
  context.book_=()=>book;
  context.PropertiesService={getScriptProperties:()=>({getProperty:k=>props.get(k)||'',setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})};
  context.SpreadsheetApp={flush(){},newDataValidation:()=>({requireValueInList(){return this;},setAllowInvalid(){return this;},build(){return {};}})};
  context.Utilities={getUuid:()=>crypto.randomUUID(),formatDate:(_date,_tz,fmt)=>fmt==='yyyy-MM-dd'?'2026-10-13':'2026-10-13'};
  context.withLock_=fn=>fn();
  context.readState_=(_ss,actor,create)=>{
    const st=sheets.get('State');let at=st.rows.findIndex((r,i)=>i>0&&r[0]===actor.subject);
    if(at<0){if(!create)return null;st.rows.push([actor.subject,actor.email,JSON.stringify(context.newState_()),new Date()]);at=st.rows.length-1;}
    return {row:at+1,profile:context.normalizeState_(JSON.parse(st.rows[at][2]))};
  };
  context.saveState_=(sh,row,p,email)=>{sh.rows[row-1][1]=email;sh.rows[row-1][2]=JSON.stringify(p);};
  const actor=email=>({email,name:email,externalId:'th_'+'a'.repeat(44),subject:'sub-'+email});
  const run=(email,action,data={})=>context.runAction_({actor:actor(email),action,data});
  const add=(email,type,key,title)=>run(email,'save',{title,dueDate:'2027-01-15',time:'07:30',workType:type,assignmentKey:key}).view.tasks.find(t=>t.title===title).id;
  const state=email=>{const r=sheets.get('State').rows.find(r=>r[1]===email);return r?JSON.parse(r[2]):null;};
  return {c:context,sheets,props,run,add,state};
}

test('YC-034: BGD Giám đốc thuộc BGD phụ trách TCHC/KHTC không cần vai trò phụ trách riêng',()=>{
  const h=setup(),valid=h.c.validateUnifiedAdminSheet();
  assert.equal(valid.ok,true,valid.errors.join(' | '));
  const a=h.run('a@example.com','load').view;
  assert.equal(a.assignments.length,2);
  assert.ok(a.assignments.some(x=>x.key==='TCHC::VICE'));
  assert.ok(a.assignments.some(x=>x.key==='KHTC::ACTING'));
  const d=h.run('d@example.com','load').view;
  assert.ok(d.assignments.some(x=>x.key==='TCHC::DIRECTOR'));
  assert.ok(d.assignments.some(x=>x.key==='KHTC::DIRECTOR'));
  assert.equal(d.assignments.some(x=>x.key.startsWith('BGD::')),false);
});
test('YC-034: một Phó phòng A kiêm Quyền phòng B; nhận thông báo đúng từng nhiệm vụ',()=>{
  const h=setup();h.run('b@example.com','load');h.run('d@example.com','load');h.run('a@example.com','load');
  const a=h.add('a@example.com','kpi','TCHC::VICE','KPI công tác A');
  const b=h.add('a@example.com','kpi','KHTC::ACTING','KPI công tác B');
  h.run('a@example.com','remove',{id:a,mode:'completed'});
  assert.equal(h.state('b@example.com').inbox.length,1);
  assert.equal(h.state('d@example.com').inbox.length,0);
  h.run('a@example.com','remove',{id:b,mode:'completed'});
  assert.equal(h.state('d@example.com').inbox.length,1);
  const c=h.add('c@example.com','kpi','KHTC::EMPLOYEE','Nhân viên B hoàn thành');
  h.run('c@example.com','remove',{id:c,mode:'completed'});
  assert.equal(h.state('a@example.com').inbox.length,1);
});
test('YC-034: việc cá nhân hoàn thành chỉ lưu cục bộ, không gửi quản lý',()=>{
  const h=setup();h.run('b@example.com','load');
  const id=h.add('a@example.com','personal','','Nhắc việc cá nhân');
  h.run('a@example.com','remove',{id,mode:'completed'});
  assert.equal(h.state('b@example.com').inbox.length,0);
  assert.equal(h.state('a@example.com').completionOutbox.length,0);
});
test('YC-034: quản trị viên ở cột H không mặc định có quyền chấm KPI',()=>{
  const h=setup();
  assert.equal(h.c.checkAccess_(h.c.book_(),{email:'f@example.com'}).isAdmin,true);
  assert.equal(h.c.approvedRecipient_(h.c.book_(),'f@example.com'),false);
  assert.equal(h.c.checkAccess_(h.c.book_(),{email:'d@example.com'}).isAdmin,false);
});
test('YC-034: thiếu Ban Giám đốc phụ trách, hai Trưởng phòng, trùng email => không cho kích hoạt',()=>{
  const h=setup();const sh=h.sheets.get('Nhân sự - Phân quyền');
  sh.rows[4][5]='TCHC';
  let result=h.c.validateUnifiedAdminSheet();
  assert.equal(result.ok,false);assert.match(result.errors.join('|'),/KHTC/);
  sh.rows[4][5]='TCHC, KHTC';
  sh.rows.push(['head2@example.com','Trưởng trùng','Hoạt động','Trưởng phòng/Khu','TCHC','','','Không']);
  result=h.c.validateUnifiedAdminSheet();assert.equal(result.ok,false);
  assert.match(result.errors.join('|'),/TCHC/);
  sh.rows.push([...sh.rows[1]]);
  result=h.c.validateUnifiedAdminSheet();assert.equal(result.ok,false);
  assert.match(result.errors.join('|'),/email trùng/);
});
test('YC-034: không thể kích hoạt bảng hợp nhất khi dữ liệu chưa hợp lệ, không đổi Property',()=>{
  const h=setup({inactive:true});h.sheets.get('Nhân sự - Phân quyền').rows[4][5]='TCHC';
  assert.throws(()=>h.c.activateUnifiedAdminSheet(),/Chưa thể kích hoạt/);
  assert.equal(h.props.get('ADMIN_UNIFIED_SCHEMA'),undefined);
});
test('YC-034: kích hoạt và rollback không xóa ba tab cũ hoặc State; định tuyến quay về V2',()=>{
  const h=setup({inactive:true});const before=JSON.stringify(h.sheets.get('State').rows);
  assert.match(h.c.activateUnifiedAdminSheet(),/kích hoạt/);
  assert.equal(h.props.get('ADMIN_UNIFIED_SCHEMA'),'V1');
  assert.equal(h.c.routingV2_(),true);
  assert.match(h.c.rollbackUnifiedAdminSheet(),/quay về/);
  assert.equal(h.props.get('ADMIN_UNIFIED_SCHEMA'),undefined);
  assert.equal(h.c.routingV2_(),true);
  assert.equal(h.c.validateKpiRoutingSheets().ok,true);
  assert.equal(JSON.stringify(h.sheets.get('State').rows),before);
  assert.ok(h.sheets.has('Tài khoản'));
  assert.ok(h.sheets.has('Phân công KPI'));
  assert.ok(h.sheets.has('Quản lý Phòng-Khu'));
});
test('YC-034: tạo tab nháp một lần từ dữ liệu cũ, không viết đè và không bật tự động',()=>{
  const h=setup({inactive:true,withoutDraft:true});const old=JSON.stringify(h.sheets.get('Tài khoản').rows);
  assert.match(h.c.prepareUnifiedAdminSheet(),/Đã tạo bản NHÁP/);
  assert.equal(h.props.get('ADMIN_UNIFIED_SCHEMA'),undefined);
  assert.equal(JSON.stringify(h.sheets.get('Tài khoản').rows),old);
  assert.equal(h.sheets.get('Nhân sự - Phân quyền').rows[0][0],'Email đăng nhập');
  assert.equal(h.c.validateUnifiedAdminSheet().ok,true);
  assert.throws(()=>h.c.prepareUnifiedAdminSheet(),/Đã có tab/);
});
