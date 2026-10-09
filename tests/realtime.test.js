'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {makeTokenRequest,realtimeChannel}=require('../server/realtime');
const {signSession,verifySession}=require('../server/session');
const env={ABLY_API_KEY:'abc.xyz:aaaaaaaaaaaaaaaaaaaaa',PUSH_ID_SECRET:'secret-for-tests-only'};
test('Ably cấp quyền đúng 1 kênh và chỉ được subscribe, không publish',()=>{
  const a=makeTokenRequest('subject-A',env,1000000000000,'abcdef1234567890abcdef1234567890');
  const b=makeTokenRequest('subject-B',env);
  const capability=JSON.parse(a.capability);
  assert.deepEqual(Object.keys(capability),[realtimeChannel('subject-A',env.PUSH_ID_SECRET)]);
  assert.deepEqual(Object.values(capability)[0],['subscribe']);
  assert.notEqual(Object.keys(JSON.parse(b.capability))[0],Object.keys(capability)[0]);
  assert.equal(a.ttl,15*60*1000);
  const signing=[a.keyName,a.ttl,a.capability,a.clientId,a.timestamp,a.nonce].join('\n')+'\n';
  assert.equal(a.mac,crypto.createHmac('sha256',env.ABLY_API_KEY.split(':')[1]).update(signing).digest('base64'));
});
test('Phiên 8 giờ: chữ ký hợp lệ, token giả/tái sửa dữ liệu/hết hạn bị từ chối',()=>{
  const actor={sub:'google-123',email:'abc@example.com',name:'A'};
  const token=signSession(actor,env.PUSH_ID_SECRET,1000000000);
  assert.equal(verifySession(token,env.PUSH_ID_SECRET,1000000001).sub,actor.sub);
  assert.equal(verifySession(token,env.PUSH_ID_SECRET,1000000000+8*3600000),null);
  assert.equal(verifySession(token+'x',env.PUSH_ID_SECRET,1000000001),null);
  assert.equal(verifySession(token,'another-secret',1000000001),null);
});
test('Dữ liệu State phiên bản 1.2 không revision tự tương thích revision 0',()=>{
  const ctx=vm.createContext({Date,console,JSON,Object,Number});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps-script/Code.gs'),'utf8'),ctx);
  const old={defaultTime:'07:30',tasks:[{id:'task-1',title:'A'}],cancellations:[]};
  const normalized=ctx.normalizeState_(old);
  assert.equal(normalized.revision,0);
  assert.equal(normalized.tasks[0].id,'task-1');
  ctx.bumpRevision_(normalized);
  assert.equal(normalized.revision,1);
  assert.throws(()=>ctx.requireRevision_({expectedRevision:0},normalized),/thay đổi trên thiết bị khác/);
  assert.doesNotThrow(()=>ctx.requireRevision_({expectedRevision:1},normalized));
  assert.doesNotThrow(()=>ctx.requireRevision_({},normalized),'Hỗ trợ tạm thời client v1.2 đang mở');
});
test('Chuyển sự kiện liên tiếp không đọc lại API, bỏ qua sự kiện cũ, gap yêu cầu đối soát',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  const snippet=source.slice(source.indexOf('function applyChange('),source.indexOf('function flushChanges()'));
  const tasks=[{id:'x',title:'Cũ',dueDate:'2026-12-12',time:'07:30'}];
  const ctx={state:{tasks,revision:2,defaultTime:'07:30',busy:false,queuedChanges:[],editingId:null},
    paintData(){ctx.paints++;},syncIndicator(){},checkRevision(){ctx.checks++;},resetForm(){},showPane(){},
    $:()=>({value:''}),paints:0,checks:0};
  vm.createContext(ctx);vm.runInContext(snippet,ctx);
  vm.runInContext(`applyChange({revision:3,change:{type:'upsert',task:{id:'x',title:'Mới',dueDate:'2026-12-12',time:'08:00'}}})`,ctx);
  assert.equal(ctx.state.tasks[0].time,'08:00');assert.equal(ctx.state.revision,3);assert.equal(ctx.checks,0);
  vm.runInContext(`applyChange({revision:3,change:{type:'remove',id:'x'}})`,ctx);
  assert.equal(ctx.state.tasks.length,1,'Không áp dụng sự kiện trùng');
  vm.runInContext(`applyChange({revision:5,change:{type:'remove',id:'x'}})`,ctx);
  assert.equal(ctx.checks,1,'Gap phải đối soát');
  vm.runInContext(`applyChange({revision:4,change:{type:'remove',id:'x'}})`,ctx);
  assert.equal(ctx.state.tasks.length,0);
});
test('Không tự phát sự kiện sau OneSignal claim/finish; version chỉ tăng do người dùng',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../apps-script/Code.gs'),'utf8');
  const functions=src.slice(src.indexOf('function claimJobs_('),src.indexOf('function performJobs_('));
  assert.doesNotMatch(functions,/bumpRevision_/);
  assert.match(src,/requireRevision_\(d,p\)/);
});
function backendActionHarness(){
  const ctx=vm.createContext({Date,console,JSON,Object,Number});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps-script/Code.gs'),'utf8'),ctx);
  const profile=ctx.newState_();profile.externalId='th_'+ 'a'.repeat(44);
  let writes=0;
  ctx.book_=()=>({});
  ctx.checkAccess_=()=>({email:'a@example.com',name:'Viên chức A',managerEmail:''});
  ctx.accessRows_=()=>[];
  ctx.readState_=()=>({row:2,profile});
  ctx.stateSheet_=()=>({});
  ctx.saveState_=()=>{writes++;};
  ctx.Utilities={getUuid:()=>crypto.randomUUID(),formatDate:()=> '2026-10-09'};
  const actor={subject:'subA',email:'a@example.com',externalId:profile.externalId,name:'A'};
  return {ctx,profile,actor,writes:()=>writes,
    run:(action,data={})=>ctx.runAction_({action,data,actor})};
}
test('Ghi đúng 1 revision mỗi mutation, tạo/sửa/xóa + đồng bộ không làm tăng ngoài ý muốn',()=>{
  const h=backendActionHarness();
  const added=h.run('save',{title:'Báo cáo',dueDate:'2027-01-15',time:'07:30',expectedRevision:0});
  assert.equal(added.changed,true);assert.equal(h.profile.revision,1);
  const id=added.view.tasks[0].id;
  assert.equal(added.change.task.id,id);
  assert.equal(h.run('load').changed,false);assert.equal(h.profile.revision,1);
  assert.equal(h.run('save',{id,title:'Báo cáo',dueDate:'2027-01-15',time:'07:30',expectedRevision:1}).changed,false);
  assert.equal(h.profile.revision,1,'No-op không gửi sự kiện');
  assert.throws(()=>h.run('remove',{id,expectedRevision:0}),/thiết bị khác/);
  const edited=h.run('save',{id,title:'Báo cáo mới',dueDate:'2027-01-15',time:'09:00',expectedRevision:1});
  assert.equal(edited.view.revision,2);
  assert.equal(h.run('setDefaultTime',{time:'08:30',expectedRevision:2}).view.revision,3);
  const removed=h.run('remove',{id,expectedRevision:3});
  assert.equal(removed.view.revision,4);assert.equal(removed.view.tasks.length,0);
  assert.equal(removed.change.type,'remove');
});
test('API authorize chỉ kiểm Access, không đọc hay tự tạo dữ liệu State',()=>{
  const h=backendActionHarness();let reads=0;
  h.ctx.readState_=()=>{reads++;throw Error('Must not read State');};
  const auth=h.run('authorize');
  assert.equal(auth.view.authorized,true);assert.equal(reads,0);
});
