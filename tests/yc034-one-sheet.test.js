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
  assert.equal(d.assignments.map(x=>x.key).join(','),'BGD::DIRECTOR');
  // The Director's department-level authority is still available to the routing catalog.
  const catalog=h.c.assignmentCatalog_(h.c.book_());
  assert.ok(catalog.assignments['d@example.com'].some(x=>x.key==='TCHC::DIRECTOR'));
  assert.ok(catalog.assignments['d@example.com'].some(x=>x.key==='KHTC::DIRECTOR'));
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
test('YC-039: thiếu BGD phụ trách chỉ cảnh báo; trùng Trưởng hoặc trùng email vẫn là lỗi',()=>{
  const h=setup();const sh=h.sheets.get('Nhân sự - Phân quyền');
  sh.rows[4][5]='TCHC';
  let result=h.c.validateUnifiedAdminSheet();
  assert.equal(result.ok,true,result.errors.join('|'));
  assert.match(result.warnings.join('|'),/KHTC.*chưa có Giám đốc/);
  sh.rows[4][5]='TCHC, KHTC';
  sh.rows.push(['head2@example.com','Trưởng trùng','Hoạt động','Trưởng phòng/Khu','TCHC','','','Không']);
  result=h.c.validateUnifiedAdminSheet();assert.equal(result.ok,false);
  assert.match(result.errors.join('|'),/TCHC/);
  sh.rows.push([...sh.rows[1]]);
  result=h.c.validateUnifiedAdminSheet();assert.equal(result.ok,false);
  assert.match(result.errors.join('|'),/email trùng/);
});
test('YC-039: không thể kích hoạt khi trùng BGD phụ trách, không đổi Property',()=>{
  const h=setup({inactive:true});h.sheets.get('Nhân sự - Phân quyền').rows[5][5]='TCHC';
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

test('YC-037: Giám đốc và Phó Giám đốc đều trực tiếp phụ trách Phòng/Khu, Phó Giám đốc → Giám đốc',()=>{
  const h=setup(),sh=h.sheets.get('Nhân sự - Phân quyền');
  sh.rows[4][5]='KHTC';  // Giám đốc phụ trách KHTC.
  sh.rows[5][5]='TCHC';  // Phó Giám đốc phụ trách TCHC.
  const valid=h.c.validateUnifiedAdminSheet();assert.equal(valid.ok,true,valid.errors.join(' | '));
  h.run('d@example.com','load');h.run('e@example.com','load');
  const headTask=h.add('b@example.com','kpi','TCHC::MANAGER','Báo cáo Phòng TCHC');
  h.run('b@example.com','remove',{id:headTask,mode:'completed'});
  assert.equal(h.state('e@example.com').inbox.length,1);
  assert.equal(h.state('d@example.com').inbox.length,0);
  const deputy=h.add('e@example.com','kpi','BGD::DIRECTOR','KPI riêng Phó Giám đốc');
  h.run('e@example.com','remove',{id:deputy,mode:'completed'});
  assert.equal(h.state('d@example.com').inbox.length,1);
  assert.equal(h.state('d@example.com').inbox[0].unit,'BGD');
  const acting=h.add('a@example.com','kpi','KHTC::ACTING','KPI Khu thuộc Giám đốc');
  h.run('a@example.com','remove',{id:acting,mode:'completed'});
  assert.equal(h.state('d@example.com').inbox.length,2);
});

test('YC-037: trùng lãnh đạo BGD phụ trách 1 phòng cảnh báo; không gửi nhầm',()=>{
  const h=setup(),sh=h.sheets.get('Nhân sự - Phân quyền');
  sh.rows[5][5]='TCHC';
  const val=h.c.validateUnifiedAdminSheet();
  assert.equal(val.ok,false);assert.match(val.errors.join(' | '),/TCHC/);
  h.run('d@example.com','load');h.run('e@example.com','load');
  const id=h.add('b@example.com','kpi','TCHC::MANAGER','KPI trùng quản lý');
  h.run('b@example.com','remove',{id,mode:'completed'});
  assert.equal(h.state('d@example.com').inbox.length,0);
  assert.equal(h.state('e@example.com').inbox.length,0);
  assert.equal(h.state('b@example.com').completionOutbox.length,1);
});

test('YC-037: chức danh Ban Giám đốc chung không suy đoán là Giám đốc',()=>{
  const h=setup(),sh=h.sheets.get('Nhân sự - Phân quyền');
  sh.rows[4][3]='Ban Giám đốc';
  const val=h.c.validateUnifiedAdminSheet();
  assert.equal(val.ok,true);assert.match(val.warnings.join(' | '),/ghi rõ/);
  h.run('d@example.com','load');
  const id=h.add('e@example.com','kpi','BGD::DIRECTOR','Công việc P.GĐ');
  const result=h.run('e@example.com','remove',{id,mode:'completed'});
  assert.match(result.view.notice,/chưa xác định/);
  assert.equal(h.state('e@example.com').completionOutbox.length,1);
  assert.equal(h.state('d@example.com').inbox.length,0);
});

test('YC-036/038: việc cũ không ghi đè State khi load, client cũ thiếu mode bị chặn',()=>{
  const h=setup();h.run('d@example.com','load');
  const id=h.add('c@example.com','kpi','KHTC::EMPLOYEE','Công việc lịch sử');
  const old=h.state('c@example.com');const task=old.tasks.find(t=>t.id===id);
  delete task.workType;delete task.assignmentKey;
  const slotIDs=JSON.stringify(task.slots);
  const row=h.sheets.get('State').rows.find(r=>r[1]==='c@example.com');row[2]=JSON.stringify(old);
  const loaded=h.run('c@example.com','load').view.tasks.find(t=>t.id===id);
  assert.equal(loaded.workType,'kpi');assert.equal(loaded.legacyKpi,true);
  assert.equal(JSON.stringify(h.state('c@example.com').tasks.find(t=>t.id===id).slots),slotIDs);
  assert.throws(()=>h.run('c@example.com','remove',{id}),/Phiên bản ứng dụng đã cũ/);
  assert.equal(h.state('c@example.com').tasks.find(t=>t.id===id).deleted,false);
  h.run('a@example.com','load');
  h.run('c@example.com','remove',{id,mode:'completed'});
  assert.equal(h.state('a@example.com').inbox.length,1);
  assert.equal(h.state('c@example.com').completionOutbox.length,0);
});

test('YC-036: không lấy nhầm nhiệm vụ lịch sử người kiêm nhiệm nhiều vai trò',()=>{
  const h=setup();h.run('b@example.com','load');
  const id=h.add('a@example.com','kpi','TCHC::VICE','Nhiệm vụ thiếu phân công');
  const state=h.state('a@example.com');const task=state.tasks.find(x=>x.id===id);
  delete task.assignmentKey;delete task.workType;
  h.sheets.get('State').rows.find(x=>x[1]==='a@example.com')[2]=JSON.stringify(state);
  assert.throws(()=>h.run('a@example.com','remove',{id,mode:'completed'}),/chọn Phòng\/Khu/);
  assert.equal(h.state('a@example.com').tasks.find(x=>x.id===id).deleted,false);
  h.run('a@example.com','remove',{id,mode:'completed',assignmentKey:'TCHC::VICE'});
  assert.equal(h.state('b@example.com').inbox.length,1);
});

test('YC-036: sửa giờ của công việc lịch sử không ép chọn loại hoặc Phòng/Khu',()=>{
  const h=setup();
  const id=h.add('a@example.com','kpi','TCHC::VICE','Sổ công việc lịch sử');
  const profile=h.state('a@example.com');const oldTask=profile.tasks.find(t=>t.id===id);
  delete oldTask.workType;delete oldTask.assignmentKey;
  h.sheets.get('State').rows.find(r=>r[1]==='a@example.com')[2]=JSON.stringify(profile);
  const changed=h.run('a@example.com','save',{id,title:'Sổ công việc lịch sử',dueDate:'2027-01-15',time:'08:30',workType:'kpi'});
  assert.equal(changed.view.tasks.find(t=>t.id===id).workType,'kpi');
  assert.equal(changed.view.tasks.find(t=>t.id===id).legacyKpi,true);
  assert.equal(h.state('a@example.com').tasks.find(t=>t.id===id).assignmentKey,'');
  assert.throws(()=>h.run('a@example.com','save',{id,title:'Sổ công việc lịch sử',dueDate:'2027-01-15',time:'08:30',workType:'personal'}),/lịch sử là KPI/);
});

test('YC-037: Phó Giám đốc hoàn thành KPI cũ mang key Phòng/Khu vẫn lên Giám đốc',()=>{
  const h=setup(),sh=h.sheets.get('Nhân sự - Phân quyền');
  sh.rows[5][5]='TCHC';sh.rows[4][5]='KHTC';
  h.run('d@example.com','load');
  const id=h.add('e@example.com','kpi','BGD::DIRECTOR','Việc KPI Phó Giám đốc đã đăng ký');
  const p=h.state('e@example.com');p.tasks.find(t=>t.id===id).assignmentKey='TCHC::DIRECTOR';
  h.sheets.get('State').rows.find(r=>r[1]==='e@example.com')[2]=JSON.stringify(p);
  h.run('e@example.com','remove',{id,mode:'completed'});
  assert.equal(h.state('d@example.com').inbox.length,1);
});

test('YC-037: Giám đốc hoàn thành KPI riêng không tự chọn người chấm cấp trên',()=>{
  const h=setup();
  const id=h.add('d@example.com','kpi','BGD::DIRECTOR','KPI Giám đốc');
  const result=h.run('d@example.com','remove',{id,mode:'completed'});
  assert.match(result.view.notice,/chưa thiết lập tuyến nhắc/);
  assert.equal(h.state('d@example.com').completionOutbox.length,0);
  assert.equal(h.state('d@example.com').tasks.find(x=>x.id===id).deleted,true);
});


test('YC-039: thiếu Trưởng phòng không chặn các tài khoản hợp lệ; bổ sung muộn phục hồi đúng một sự kiện',()=>{
  const h=setup(),sh=h.sheets.get('Nhân sự - Phân quyền');
  const manager=sh.rows.splice(2,1)[0]; // Chưa thu thập Gmail của Trưởng TCHC.
  const valid=h.c.validateUnifiedAdminSheet();
  assert.equal(valid.ok,true,valid.errors.join(' | '));
  assert.match(valid.warnings.join('|'),/TCHC: chưa có Trưởng phòng/);
  const task=h.add('f@example.com','kpi','TCHC::EMPLOYEE','KPI nhân viên trước khi có trưởng');
  const result=h.run('f@example.com','remove',{id:task,mode:'completed'});
  assert.match(result.view.notice,/chưa xác định/);
  assert.equal(h.state('f@example.com').completionOutbox.length,1);
  assert.equal(h.state('f@example.com').tasks.find(x=>x.id===task).deleted,true);
  sh.rows.push(manager); // Ban quản trị chỉ bổ sung dòng tài khoản, không sửa State.
  assert.equal(h.c.validateUnifiedAdminSheet().ok,true);
  // Người nhận chưa từng đăng nhập => State chưa tồn tại, giữ nguyên hàng chờ.
  const rows=h.sheets.get('State').getRange(2,1,h.sheets.get('State').getLastRow()-1,4).getValues();
  h.c.recoverPendingCompletions_(h.c.book_(),rows,0,8);
  assert.equal(h.state('f@example.com').completionOutbox.length,1);
  h.run('b@example.com','load');
  assert.equal(h.state('b@example.com').inbox.length,1);
  assert.equal(h.state('f@example.com').completionOutbox.length,0);
  h.run('b@example.com','load');
  assert.equal(h.state('b@example.com').inbox.length,1,'Retry must not duplicate');
});

test('YC-039: thiếu BGD phụ trách => vẫn gửi nhân viên cho Trưởng, lưu KPI của Trưởng đến khi phân công',()=>{
  const h=setup(),sh=h.sheets.get('Nhân sự - Phân quyền');
  sh.rows[4][5]='KHTC'; // TCHC chưa có BGD phụ trách.
  const valid=h.c.validateUnifiedAdminSheet();assert.equal(valid.ok,true);
  assert.match(valid.warnings.join('|'),/TCHC: chưa có Giám đốc/);
  h.run('b@example.com','load');
  const employee=h.add('f@example.com','kpi','TCHC::EMPLOYEE','Công việc nhân viên');
  h.run('f@example.com','remove',{id:employee,mode:'completed'});
  assert.equal(h.state('b@example.com').inbox.length,1,'Missing BGD must not stop valid first-level route');
  const headTask=h.add('b@example.com','kpi','TCHC::MANAGER','Công việc Trưởng');
  h.run('b@example.com','remove',{id:headTask,mode:'completed'});
  assert.equal(h.state('b@example.com').completionOutbox.length,1);
  sh.rows[4][5]='KHTC, TCHC';
  h.run('d@example.com','load');
  assert.equal(h.state('d@example.com').inbox.length,1);
  assert.equal(h.state('b@example.com').completionOutbox.length,0);
});

test('YC-039: chưa có Giám đốc => Phó Giám đốc hoàn thành vẫn lưu chờ và chuyển sau khi Giám đốc đăng nhập',()=>{
  const h=setup(),sh=h.sheets.get('Nhân sự - Phân quyền');
  const director=sh.rows.splice(4,1)[0];
  assert.equal(h.c.validateUnifiedAdminSheet().ok,true);
  assert.match(h.c.validateUnifiedAdminSheet().warnings.join('|'),/Ban Giám đốc: chưa có Giám đốc/);
  const task=h.add('e@example.com','kpi','BGD::DIRECTOR','Phó Giám đốc hoàn thành');
  h.run('e@example.com','remove',{id:task,mode:'completed'});
  assert.equal(h.state('e@example.com').completionOutbox.length,1);
  sh.rows.push(director);
  h.run('d@example.com','load');
  assert.equal(h.state('d@example.com').inbox.length,1);
  assert.equal(h.state('e@example.com').completionOutbox.length,0);
});

test('YC-039: nhiều Giám đốc là lỗi, không gửi nhiệm vụ Phó Giám đốc nhầm người',()=>{
  const h=setup(),sh=h.sheets.get('Nhân sự - Phân quyền');
  sh.rows.push(['g@example.com','Giám đốc thứ hai','Hoạt động','Giám đốc','BGD','','','Không']);
  const check=h.c.validateUnifiedAdminSheet();
  assert.equal(check.ok,false);
  assert.match(check.errors.join('|'),/nhiều hơn một Giám đốc/);
  const job=h.add('e@example.com','kpi','BGD::DIRECTOR','Việc Phó Giám đốc');
  const done=h.run('e@example.com','remove',{id:job,mode:'completed'});
  assert.match(done.view.notice,/chưa xác định/);
  assert.equal(h.state('e@example.com').completionOutbox.length,1);
});


test('YC-039: cảnh báo thiếu nhân sự không làm mất State, dữ liệu phòng và tab cũ khi kích hoạt',()=>{
  const h=setup({inactive:true}),sh=h.sheets.get('Nhân sự - Phân quyền');
  sh.rows.splice(2,1);sh.rows[3][5]=''; // thiếu Trưởng TCHC và BGD phụ trách một phòng
  const before=JSON.stringify(h.sheets.get('State').rows);
  const v=h.c.validateUnifiedAdminSheet();
  assert.equal(v.ok,true,v.errors.join('|'));
  assert.ok(v.warnings.length>=2);
  assert.match(h.c.activateUnifiedAdminSheet(),/cảnh báo/);
  assert.equal(h.props.get('ADMIN_UNIFIED_SCHEMA'),'V1');
  assert.equal(JSON.stringify(h.sheets.get('State').rows),before);
  assert.ok(h.sheets.has('Tài khoản')&&h.sheets.has('Quản lý Phòng-Khu'));
});

test('YC-039: người nhận đã từng đăng nhập được khôi phục qua trigger khi bổ sung phân công muộn',()=>{
  const h=setup(),sh=h.sheets.get('Nhân sự - Phân quyền');
  h.run('b@example.com','load'); // Có State từ trước.
  sh.rows[2][2]='Ngừng hoạt động'; // Trưởng tạm chưa có tài khoản hoạt động.
  assert.equal(h.c.validateUnifiedAdminSheet().ok,true);
  assert.match(h.c.validateUnifiedAdminSheet().warnings.join('|'),/TCHC: chưa có Trưởng phòng/);
  const one=h.add('f@example.com','kpi','TCHC::EMPLOYEE','KPI số 1');
  const two=h.add('f@example.com','kpi','TCHC::EMPLOYEE','KPI số 2');
  h.run('f@example.com','remove',{id:one,mode:'completed'});
  h.run('f@example.com','remove',{id:two,mode:'completed'});
  assert.equal(h.state('f@example.com').completionOutbox.length,2);
  sh.rows[2][2]='Hoạt động'; // Bổ sung/kích hoạt lại Gmail hợp lệ.
  const pushed=[];h.c.syncManagerByEmail_=email=>pushed.push(email);
  const rows=h.sheets.get('State').getRange(2,1,h.sheets.get('State').getLastRow()-1,4).getValues();
  h.c.recoverPendingCompletions_(h.c.book_(),rows,0,8);
  assert.equal(h.state('b@example.com').inbox.length,2);
  assert.equal(h.state('f@example.com').completionOutbox.length,0);
  assert.deepEqual(pushed,['b@example.com']);
  h.c.recoverPendingCompletions_(h.c.book_(),rows,0,8);
  assert.equal(h.state('b@example.com').inbox.length,2);
});
