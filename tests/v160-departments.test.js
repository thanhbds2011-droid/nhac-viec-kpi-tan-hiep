'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../apps-script/Code.gs','utf8');

class Sheet{
  constructor(name,values=[]){this.name=name;this.values=values.map(r=>[...r]);this.hidden=false;this.protections=[];this.validations=[];}
  getName(){return this.name;}
  getLastRow(){return this.values.length;}
  getLastColumn(){return Math.max(1,...this.values.map(x=>x.length));}
  getMaxRows(){return 1000;}
  getRange(row,col,height=1,width=1){
    const self=this;
    return {
      getValue(){return self.values[row-1]?.[col-1]??'';},
      getDisplayValue(){return String(self.values[row-1]?.[col-1]??'');},
      setValue(value){self.values[row-1]??=[];self.values[row-1][col-1]=value;return this;},
      getDisplayValues(){return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>String(self.values[row+i-1]?.[col+j-1]??'')));},
      getValues(){return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>self.values[row+i-1]?.[col+j-1]??''));},
      setValues(values){values.forEach((cells,i)=>{const r=row+i-1;self.values[r]??=[];cells.forEach((v,j)=>{self.values[r][col+j-1]=v;});});return this;},
      setBackground(){return this;},setFontColor(){return this;},setFontWeight(){return this;},setNote(){return this;},
      setDataValidation(v){self.validations.push(v);return this;},
    };
  }
  setFrozenRows(){return this;}
  setColumnWidth(){return this;}
  getFilter(){return {existing:true};}
  hideColumns(){return this;}
  getProtections(){return this.protections;}
  protect(){const p={setDescription(){return this;},setWarningOnly(){return this;}};this.protections.push(p);return p;}
  hideSheet(){this.hidden=true;}
  showSheet(){this.hidden=false;}
}
const accounts=[
  ['a@example.com','Nhân viên A','Hoạt động','Nhân viên','TCHC'],
  ['b@example.com','Trưởng TCHC','Hoạt động','Trưởng phòng/Khu','TCHC'],
  ['p@example.com','Phó TCHC','Hoạt động','Phó Trưởng phòng/Khu','TCHC'],
  ['c@example.com','Nhân viên C','Hoạt động','Nhân viên','KHTC'],
  ['d@example.com','Trưởng KHTC','Hoạt động','Trưởng phòng/Khu','KHTC'],
  ['root@example.com','Quản trị','Hoạt động','Quản trị viên',''],
];
const departments=[
  ['TCHC','Tổ chức – Hành chính','b@example.com','p@example.com',''],
  ['KHTC','Kế hoạch – Tài chính','d@example.com','',''],
];
function setup({prepared=true,active=true,accessRows=null}={}){
  const legacy=new Sheet('Access', [['Email','Họ tên','Active','Role','Email Trưởng phòng'],...(accessRows||[
    ['a@example.com','Nhân viên A','YES','EMPLOYEE','b@example.com'],
    ['b@example.com','Trưởng TCHC','YES','MANAGER','']])]);
  const state=new Sheet('State',[['Google Sub','Email','JSON State','Updated At'],['sub-a','a@example.com','{"tasks":[]}','2026-10-09']]);
  const map=new Map([['Access',legacy],['State',state]]);
  if(prepared){
    map.set('Tài khoản',new Sheet('Tài khoản', [['Email đăng nhập','Họ và tên','Trạng thái','Vai trò','Mã Phòng/Khu'],...accounts]));
    map.set('Quản lý Phòng-Khu',new Sheet('Quản lý Phòng-Khu', [['Mã Phòng/Khu','Tên Phòng/Khu','Email Trưởng phòng/Khu','Email Phó thứ nhất','Email Phó thứ hai'],...departments]));
  }
  const props=new Map([['ACCOUNT_SCHEMA',active?'VI':'LEGACY']]);
  const sheetObject={getSheetByName:n=>map.get(n)||null,insertSheet(n){const s=new Sheet(n);map.set(n,s);return s;}};
  const context=vm.createContext({Date,console,JSON,Object,Number,Logger:{log(){}}});
  vm.runInContext(source,context);
  context.book_=()=>sheetObject;
  context.prop_=key=>props.get(key)||'';
  context.PropertiesService={getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})};
  context.SpreadsheetApp={flush(){},ProtectionType:{SHEET:'sheet'},newDataValidation(){return {requireValueInList(){return this;},requireValueInRange(){return this;},setAllowInvalid(){return this;},build(){return {};}};}};
  context.withLock_=fn=>fn();
  return {context,map,props,state,legacy};
}
test('Việt hóa: vai trò Phó Trưởng phòng không bị nhận nhầm thành Trưởng phòng',()=>{
  const {context:c}=setup();
  assert.equal(c.roleKind_('Phó Trưởng phòng/Khu'),'VICE');
  assert.equal(c.isManagerRole_('Phó Trưởng phòng/Khu'),false);
  assert.equal(c.isManagerRole_('Trưởng phòng/Khu'),true);
  assert.equal(c.isAdmin_('Quản trị viên'),true);
  assert.equal(c.enabled_('Hoạt động'),true);
  assert.equal(c.enabled_('Ngừng hoạt động'),false);
  assert.equal(c.roleKind_('USER'),'EMPLOYEE');
});
test('Một Trưởng phòng nhận thông báo của nhiều nhân viên cùng đơn vị',()=>{
  const {context:c,map}=setup();
  map.get('Tài khoản').values.push(['e@example.com','Nhân viên E','Hoạt động','Nhân viên','TCHC']);
  const rows=c.accessRows_({getSheetByName:n=>map.get(n)});
  assert.equal(rows.find(r=>r[0]==='a@example.com')[4],'b@example.com');
  assert.equal(rows.find(r=>r[0]==='e@example.com')[4],'b@example.com');
  assert.equal(rows.find(r=>r[0]==='c@example.com')[4],'d@example.com');
  assert.equal(c.findActiveManager_(c.book_(),'b@example.com').email,'b@example.com');
});
test('Phòng 30 nhân viên chỉ cần một email Trưởng phòng',()=>{
  const {context:c,map}=setup();
  for(let i=0;i<30;i++)map.get('Tài khoản').values.push([`worker${i}@example.com`,'Nhân viên '+i,'Hoạt động','Nhân viên','TCHC']);
  const rows=c.accessRows_({getSheetByName:n=>map.get(n)});
  assert.equal(rows.filter(r=>String(r[0]).startsWith('worker')).length,30);
  assert.equal(rows.filter(r=>String(r[0]).startsWith('worker')).every(r=>r[4]==='b@example.com'),true);
});
test('Khi thay trưởng phòng, chỉ các sự kiện phát sinh về sau theo người mới',()=>{
  const {context:c,map}=setup();
  map.get('Tài khoản').values.push(['new@example.com','Trưởng mới','Hoạt động','Trưởng phòng/Khu','TCHC']);
  map.get('Tài khoản').values[2][3]='Nhân viên'; // b@example.com thôi giữ vai trò MANAGER
  map.get('Quản lý Phòng-Khu').values[1][2]='new@example.com';
  const row=c.accessRows_({getSheetByName:n=>map.get(n)}).find(r=>r[0]==='a@example.com');
  assert.equal(row[4],'new@example.com');
});
test('Fail-closed: sai đơn vị, phó trưởng, tài khoản bị khóa hoặc mã Phòng/Khu trùng',()=>{
  for(const mutation of [
    (map)=>map.get('Quản lý Phòng-Khu').values[1][2]='p@example.com',
    (map)=>map.get('Tài khoản').values[2][2]='Ngừng hoạt động',
    (map)=>map.get('Tài khoản').values[2][4]='KHTC',
    (map)=>map.get('Quản lý Phòng-Khu').values.push(['TCHC','Bản trùng','b@example.com','','']),
  ]){
    const {context:c,map}=setup();mutation(map);
    const row=c.accessRows_({getSheetByName:n=>map.get(n)}).find(r=>r[0]==='a@example.com');
    assert.equal(row[4],'');
  }
});
test('Tài khoản trùng email không được sử dụng, không thể nhận sai thông báo',()=>{
  const {context:c,map}=setup();map.get('Tài khoản').values.push(['a@example.com','Đăng ký trùng','Hoạt động','Nhân viên','TCHC']);
  const row=c.accessRows_({getSheetByName:n=>map.get(n)}).find(r=>r[0]==='a@example.com');
  assert.equal(c.enabled_(row[2]),false);
  assert.throws(()=>c.checkAccess_(c.book_(), {email:'a@example.com'}),/chưa được kích hoạt/);
});
test('Kiểm tra trước kích hoạt phát hiện lỗi và cho phép cấu hình đúng',()=>{
  const {context:c,map}=setup();
  assert.equal(c.validateVietnameseAdminSheets().ok,true);
  map.get('Tài khoản').values[1][4]='KHONG_CO';
  const val=c.validateVietnameseAdminSheets();
  assert.equal(val.ok,false);
  assert.match(val.errors.join(' '),/mã Phòng\/Khu không tồn tại/);
});
test('Kích hoạt sau kiểm tra; giữ nguyên JSON State và Access dự phòng; có thể rollback',()=>{
  const {context:c,map,props,legacy,state}=setup({active:false});
  const snapshot=JSON.stringify(state.values);
  const result=c.activateVietnameseAdminSheets();
  assert.match(result,/Đã kích hoạt/);
  assert.equal(props.get('ACCOUNT_SCHEMA'),'VI');
  assert.equal(legacy.hidden,true);
  assert.equal(JSON.stringify(state.values),snapshot);
  const revert=c.rollbackVietnameseAdminSheets();
  assert.match(revert,/Access cũ/);
  assert.equal(props.get('ACCOUNT_SCHEMA'),'LEGACY');
  assert.equal(legacy.hidden,false);
  assert.equal(JSON.stringify(state.values),snapshot);
});
test('Không kích hoạt khi thiếu mã đơn vị, không đổi chế độ đăng nhập',()=>{
  const {context:c,map,props}=setup({active:false});
  map.get('Tài khoản').values[1][4]='';
  assert.throws(()=>c.activateVietnameseAdminSheets(),/Chưa thể kích hoạt/);
  assert.equal(props.get('ACCOUNT_SCHEMA'),'LEGACY');
});
test('Chuẩn bị chỉ sao chép, không xóa Access và không sửa State',()=>{
  const {context:c,map,state,legacy}=setup({prepared:false,active:false});
  const baseline=JSON.stringify(state.values),acc=JSON.stringify(legacy.values);
  const result=c.prepareVietnameseAdminSheets();
  assert.match(result,/Đã tạo tab/);
  assert.equal(JSON.stringify(state.values),baseline);
  assert.equal(JSON.stringify(legacy.values),acc);
  const copy=map.get('Tài khoản');
  assert.equal(copy.values[1][4],'');
  assert.equal(copy.values[1][5],'b@example.com');
  assert.ok(copy.validations.length>=3);
  assert.throws(()=>c.prepareVietnameseAdminSheets(),/Đã có tab chuẩn bị/);
});
test('Mặc định chưa kích hoạt vẫn đọc Access v1.5.0, không đổi dữ liệu',()=>{
  const {context:c}=setup({active:false});
  const r=c.accessRows_(c.book_());
  assert.equal(r[0][4],'b@example.com');
});
function userFlowSetup(){
  const h=setup();
  const c=h.context,st=h.state,crypto=require('node:crypto');
  st.values.splice(1); // Dữ liệu đầu vào sạch, mỗi Google Sub chỉ có một dòng.
  c.Utilities={getUuid:()=>crypto.randomUUID(),formatDate:()=> '2026-10-09'};
  c.readState_=(_ss,actor,create)=>{
    let ix=st.values.findIndex((r,i)=>i>0&&r[0]===actor.subject);
    if(ix===-1){
      if(!create)return null;
      st.values.push([actor.subject,actor.email,JSON.stringify(c.newState_()),new Date()]);
      ix=st.values.length-1;
    }
    return {row:ix+1,profile:c.normalizeState_(JSON.parse(st.values[ix][2]))};
  };
  const actor=e=>({subject:'sub-'+e,email:e,name:e,externalId:'th_'+e[0].repeat(44)});
  const action=(email,name,data={})=>c.runAction_({actor:actor(email),action:name,data});
  return {...h,action,getState(email){const row=st.values.find(r=>r[1]===email);return row?JSON.parse(row[2]):null;}};
}
test('Luồng V1.6 thật: A của TCHC xóa, B nhận; C của KHTC xóa, D nhận; không phát nhầm',()=>{
  const h=userFlowSetup();
  h.action('b@example.com','load');h.action('d@example.com','load');
  const xa=h.action('a@example.com','save',{title:'Việc A',dueDate:'2027-05-01',time:'07:30'});
  const xc=h.action('c@example.com','save',{title:'Việc C',dueDate:'2027-05-01',time:'07:30'});
  h.action('a@example.com','remove',{id:xa.view.tasks[0].id,mode:'completed'});
  h.action('c@example.com','remove',{id:xc.view.tasks[0].id,mode:'completed'});
  assert.equal(h.getState('b@example.com').inbox.length,1);
  assert.equal(h.getState('d@example.com').inbox.length,1);
  assert.equal(h.getState('b@example.com').inbox[0].title,'Việc A');
  assert.equal(h.getState('d@example.com').inbox[0].title,'Việc C');
  const notice=h.action('b@example.com','load').view.inbox[0];
  h.action('b@example.com','dismissNotification',{id:notice.id});
  assert.equal(h.action('b@example.com','load').view.inbox.length,0);
});
test('V1.6: Phó Trưởng phòng hoàn thành chuyển đúng Trưởng phòng, không bị coi là Trưởng phòng',()=>{
  const h=userFlowSetup();h.action('b@example.com','load');
  const x=h.action('p@example.com','save',{title:'Việc của Phó',dueDate:'2027-05-01',time:'07:30'});
  h.action('p@example.com','remove',{id:x.view.tasks[0].id,mode:'completed'});
  assert.equal(h.getState('b@example.com').inbox.length,1);
});
test('V1.6: Người quản lý sai vai trò thì nhân viên vẫn xóa được nhưng không báo nhầm',()=>{
  const h=userFlowSetup();
  h.map.get('Quản lý Phòng-Khu').values[1][2]='p@example.com';
  const x=h.action('a@example.com','save',{title:'Việc A',dueDate:'2027-05-01',time:'07:30'});
  const result=h.action('a@example.com','remove',{id:x.view.tasks[0].id,mode:'completed'});
  assert.match(result.view.notice,/Chưa có Trưởng phòng/);
  assert.equal(h.getState('a@example.com').completionOutbox.length,0);
});


test('v1.8: thêm cột G không sửa A:F, không sửa State, giữ quyền quản trị legacy',()=>{
  const {context:c,map,state}=setup();
  const sh=map.get('Tài khoản');
  const before=sh.values.map(r=>Array.from({length:6},(_,i)=>r[i]??''));const savedState=JSON.stringify(state.values);
  const result=c.prepareAdminPermissionColumn();
  assert.match(result,/Quyền quản trị/);
  assert.equal(sh.values[0][6],'Quyền quản trị');
  assert.equal(sh.values[1][6],'Không');
  assert.equal(sh.values[6][6],'Có');
  assert.deepEqual(sh.values.map(r=>Array.from({length:6},(_,i)=>r[i]??'')),before);
  assert.equal(JSON.stringify(state.values),savedState);
  const after=JSON.stringify(sh.values);c.prepareAdminPermissionColumn();
  assert.equal(JSON.stringify(sh.values),after);
});
test('v1.8: nhân viên kiêm quản trị, phó kiêm quản trị, trưởng kiêm quản trị được nhận diện độc lập',()=>{
  const {context:c,map}=setup();
  c.prepareAdminPermissionColumn();
  const sh=map.get('Tài khoản');
  sh.values[1][6]='Có';sh.values[3][6]='Có';sh.values[2][6]='Có';
  const actor=email=>({email,name:email});
  const a=c.checkAccess_(c.book_(),actor('a@example.com'));
  const manager=c.checkAccess_(c.book_(),actor('b@example.com'));
  const vice=c.checkAccess_(c.book_(),actor('p@example.com'));
  assert.equal(a.role,'Nhân viên');assert.equal(a.isAdmin,true);
  assert.equal(a.managerEmail,'b@example.com');
  assert.equal(manager.isAdmin,true);assert.equal(c.roleKind_(manager.role),'MANAGER');
  assert.equal(vice.isAdmin,true);assert.equal(c.roleKind_(vice.role),'VICE');
  assert.equal(c.isManagerRole_(vice.role),false);
  sh.values[1][6]='Không';
  assert.equal(c.checkAccess_(c.book_(),actor('a@example.com')).isAdmin,false);
  sh.values[6][6]='Không';
  assert.equal(c.checkAccess_(c.book_(),actor('root@example.com')).isAdmin,false);
});
test('v1.8: G sai không cấp quyền quản trị và kiểm tra cấu hình báo lỗi',()=>{
  const {context:c,map}=setup();c.prepareAdminPermissionColumn();
  const user=map.get('Tài khoản').values[1];user[6]='Cóooo';
  assert.equal(c.checkAccess_(c.book_(),{email:'a@example.com'}).isAdmin,false);
  assert.match(c.validateVietnameseAdminSheets().errors.join(' '),/quyền quản trị/);
});
