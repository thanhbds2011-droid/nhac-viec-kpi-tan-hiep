'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8');
const sub=n=>'google-sub-'+n;
const external=n=>'th_'+n.repeat(44);
function setup(){
  const context=vm.createContext({Date,console,JSON,Object,Number});vm.runInContext(source,context);
  const acc=[
    ['a@example.com','Nhân viên A','YES','EMPLOYEE','b@example.com'],
    ['b@example.com','Trưởng phòng B','YES','MANAGER',''],
    ['c@example.com','Nhân viên C','YES','EMPLOYEE','d@example.com'],
    ['d@example.com','Trưởng phòng D','YES','MANAGER',''],
    ['root@example.com','Quản trị viên','YES','ADMIN',''],
    ['z@example.com','Nhân viên Z','NO','EMPLOYEE','']
  ];
  const rows=[];
  function state(name){return context.normalizeState_(JSON.parse(rows.find(r=>r[1]===name)?.[2]||'{}'));}
  function set(name,profile){let row=rows.find(r=>r[1]===name);if(!row){row=[sub(name),name,'',new Date()];rows.push(row);}row[2]=JSON.stringify(profile);}
  function getRange(r,c,n=1,w=1){return{
    getValues(){return Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>rows[r-2+i]?.[c-1+j]||''));},
    getDisplayValues(){return this.getValues().map(a=>a.map(String));},
    getValue(){return rows[r-2]?.[c-1]||'';},
    setValues(v){v.forEach((cells,i)=>{const target=rows[r-2+i];assert.ok(target,'row missing');cells.forEach((value,j)=>target[c-1+j]=value);});},
    createTextFinder(key){return{matchEntireCell(){return this;},findNext(){let i=rows.findIndex(v=>v[c-1]===key);return i>=0?{getRow(){return i+2;}}:null;}};}
  };}
  const sheet={getLastRow(){return rows.length+1;},getRange};
  context.book_=()=>({});context.stateSheet_=()=>sheet;context.accessRows_=()=>acc;
  context.checkAccess_=(_ss,actor)=>{
    const row=acc.find(r=>r[0]===actor.email);if(!row||row[2]!=='YES')throw Error('Forbidden');
    return {email:row[0],name:row[1],role:row[3],managerEmail:row[4],isAdmin:row[5]===true||row[3]==='ADMIN'};
  };
  context.Utilities={getUuid:()=>crypto.randomUUID(),formatDate:()=> '2026-10-09'};
  // Stub state reader to focus on integration with manager State storage and inbox.
  context.readState_=(_ss,actor,create)=>{
    let idx=rows.findIndex(r=>r[0]===actor.subject);
    if(idx<0){if(!create)return null;rows.push([actor.subject,actor.email,JSON.stringify(context.newState_()),new Date()]);idx=rows.length-1;}
    return {row:idx+2,profile:context.normalizeState_(JSON.parse(rows[idx][2]))};
  };
  const actor=email=>({subject:sub(email),email,name:email,externalId:external(email[0])});
  const call=(email,action,data={})=>context.runAction_({actor:actor(email),action,data});
  return {context,rows,acc,sheet,actor,state,call,set};
}
test('Một công việc đã hoàn thành: lưu một thông báo đúng Trưởng phòng; không gửi sang người khác',()=>{
  const h=setup();h.call('b@example.com','load');h.call('d@example.com','load');
  const a=h.call('a@example.com','save',{title:'Việc của A',dueDate:'2027-05-01',time:'07:30'});
  const result=h.call('a@example.com','remove',{id:a.view.tasks[0].id,mode:'completed'});
  assert.equal(result.changed,true);
  assert.equal(h.state('b@example.com').inbox.length,1);
  assert.equal(h.state('d@example.com').inbox.length,0);
  assert.equal(h.state('a@example.com').completionOutbox.length,0);
  assert.equal(h.state('b@example.com').inbox[0].title,'Việc của A');
});
test('Không thể xóa hai lần cùng một công việc, tránh thông báo hoàn thành trùng',()=>{
  const h=setup();h.call('b@example.com','load');
  const x=h.call('a@example.com','save',{title:'A',dueDate:'2027-05-01',time:'07:30'});
  const id=x.view.tasks[0].id;h.call('a@example.com','remove',{id,mode:'completed'});
  assert.throws(()=>h.call('a@example.com','remove',{id}),/Không tìm thấy công việc/);
  assert.equal(h.state('b@example.com').inbox.length,1);
});
test('Xóa do nhập nhầm không gửi thông báo Trưởng phòng',()=>{
  const h=setup();h.call('b@example.com','load');
  const x=h.call('a@example.com','save',{title:'Nhập nhầm',dueDate:'2027-05-01',time:'07:30'});
  h.call('a@example.com','remove',{id:x.view.tasks[0].id,mode:'discard'});
  assert.equal(h.state('b@example.com').inbox.length,0);
  assert.equal(h.state('a@example.com').completionOutbox.length,0);
});
test('Trưởng phòng chưa đăng nhập: giữ hộp thư đi; khi đăng nhập lần đầu tự nhận thông báo',()=>{
  const h=setup();const x=h.call('a@example.com','save',{title:'Việc chờ',dueDate:'2027-05-01',time:'07:30'});
  h.call('a@example.com','remove',{id:x.view.tasks[0].id,mode:'completed'});
  assert.equal(h.state('a@example.com').completionOutbox.length,1);
  const result=h.call('b@example.com','load');
  assert.equal(result.view.inbox.length,1);
  assert.equal(h.state('a@example.com').completionOutbox.length,0);
  assert.equal(result.managerPushEmail,'b@example.com');
});
test('Trưởng phòng xóa thông báo chỉ đánh dấu đã xử lý; không chuyển ngược lên tài khoản khác',()=>{
  const h=setup();h.call('b@example.com','load');
  const x=h.call('a@example.com','save',{title:'Hoàn thành',dueDate:'2027-05-01',time:'07:30'});
  h.call('a@example.com','remove',{id:x.view.tasks[0].id,mode:'completed'});
  const first=h.call('b@example.com','load');
  const r=h.call('b@example.com','dismissNotification',{id:first.view.inbox[0].id,expectedRevision:first.view.revision});
  assert.equal(r.view.inbox.length,0);
  assert.equal(h.state('b@example.com').inbox[0].dismissed,true);
  assert.equal(h.call('b@example.com','load').view.inbox.length,0);
  assert.equal(h.state('b@example.com').completionOutbox.length,0);
});
test('Tổng quan chỉ quản trị viên, số liệu lũy kế không giảm khi xóa',()=>{
  const h=setup();
  assert.throws(()=>h.call('a@example.com','adminStats'),/không có quyền/);
  const x=h.call('a@example.com','save',{title:'Việc A',dueDate:'2027-05-01',time:'07:30'});
  h.call('a@example.com','remove',{id:x.view.tasks[0].id,mode:'discard'});
  const summary=h.call('root@example.com','adminStats').view.adminStats;
  assert.equal(summary.accounts,6);
  assert.equal(summary.totalCreated,1);
});
test('iCPV chỉ bổ sung còn thiếu, không ghi đè thời hạn và giữ dấu nguồn đã xóa',()=>{
  const h=setup(),key='icpv:'+ 'a'.repeat(64),key2='icpv:'+ 'b'.repeat(64);
  let r=h.call('a@example.com','importTasks',{items:[
    {sourceKey:key,title:'Việc 1',dueDate:'2027-05-01'},
    {sourceKey:key2,title:'Việc 2',dueDate:'2026-10-08'}]});
  assert.equal(r.view.importSummary.added,1);
  assert.equal(r.view.importSummary.skipped,1);
  r=h.call('a@example.com','importTasks',{items:[
    {sourceKey:key,title:'Việc 1',dueDate:'2027-05-01'},
    {sourceKey:key2,title:'Việc 2',dueDate:'2027-05-04'}]});
  assert.equal(r.view.importSummary.added,1);
  assert.equal(r.view.importSummary.unchanged,1);
  assert.equal(h.state('a@example.com').totalCreated,2);
  const id=r.view.tasks.find(t=>t.sourceKey===key).id;
  h.call('a@example.com','remove',{id,mode:'discard'});
  // Simulate old-task cleanup without losing the tombstone.
  const p=h.state('a@example.com');p.tasks=p.tasks.filter(t=>!t.deleted);h.set('a@example.com',p);
  r=h.call('a@example.com','importTasks',{items:[{sourceKey:key,title:'Việc 1',dueDate:'2027-05-01'}]});
  assert.equal(r.view.importSummary.added,0);
  assert.equal(r.view.importSummary.skipped,1);
});
test('Thông báo quản lý OneSignal nhắm tới một External ID, không broadcast',()=>{
  const h=setup();let body;
  h.context.prop_=k=>k==='WEB_URL'?'https://example.com':'appId';
  h.context.oneSignal_=(method,path,data)=>{assert.equal(method,'post');body=data;return {id:'sent'};};
  const result=h.context.createManagerNotification_({id:'abc',from:'A',title:'Báo cáo'},external('b'));
  assert.equal(result.id,'sent');
  assert.equal(body.include_aliases.external_id.length,1);
  assert.equal(body.include_aliases.external_id[0],external('b'));
  assert.equal(body.idempotency_key,'abc');
});
test('Sau đổi Trưởng phòng khi sự kiện còn chờ, chỉ người quản lý hiện hành nhận',()=>{
  const h=setup();
  const x=h.call('a@example.com','save',{title:'Việc chưa chuyển',dueDate:'2027-05-01',time:'07:30'});
  h.call('a@example.com','remove',{id:x.view.tasks[0].id,mode:'completed'});
  assert.equal(h.state('a@example.com').completionOutbox.length,1);
  h.acc[0][4]='d@example.com';
  const old=h.call('b@example.com','load');
  assert.equal(old.view.inbox.length,0);
  const current=h.call('d@example.com','load');
  assert.equal(current.view.inbox.length,1);
});
test('Giao diện cũ không tạo thông báo hoàn thành khi API remove chưa có mode',()=>{
  const h=setup();h.call('b@example.com','load');
  const x=h.call('a@example.com','save',{title:'Việc cũ',dueDate:'2027-05-01',time:'07:30'});
  h.call('a@example.com','remove',{id:x.view.tasks[0].id});
  assert.equal(h.state('b@example.com').inbox.length,0);
});


test('v1.8: nhân viên kiêm quản trị vẫn thông báo Trưởng phòng khi hoàn thành, xem được tổng quan',()=>{
  const h=setup();h.acc[0][5]=true;
  h.call('b@example.com','load');
  const a=h.call('a@example.com','load');
  assert.equal(a.view.isAdmin,true);
  assert.equal(a.view.managerConfigured,true);
  const stats=h.call('a@example.com','adminStats').view.adminStats;
  assert.equal(stats.accounts,6);
  const job=h.call('a@example.com','save',{title:'Đầu việc kiêm quản trị',dueDate:'2027-05-01',time:'07:30'});
  h.call('a@example.com','remove',{id:job.view.tasks[0].id,mode:'completed'});
  assert.equal(h.state('b@example.com').inbox.length,1);
  assert.equal(h.state('b@example.com').inbox[0].title,'Đầu việc kiêm quản trị');
});
test('v1.8: Trưởng phòng kiêm quản trị nhận thông báo từ nhân viên nhưng không gửi lên cấp trên khi xóa việc cá nhân',()=>{
  const h=setup();h.acc[1][5]=true;
  const before=h.call('b@example.com','load');assert.equal(before.view.isAdmin,true);
  const a=h.call('a@example.com','save',{title:'Nhân viên hoàn thành',dueDate:'2027-05-01',time:'07:30'});
  h.call('a@example.com','remove',{id:a.view.tasks[0].id,mode:'completed'});
  assert.equal(h.state('b@example.com').inbox.length,1);
  const b=h.call('b@example.com','save',{title:'Việc riêng Trưởng phòng',dueDate:'2027-05-01',time:'07:30'});
  h.call('b@example.com','remove',{id:b.view.tasks[0].id,mode:'completed'});
  assert.equal(h.state('b@example.com').inbox.length,1);
});
