'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../apps-script/Code.gs'),'utf8');

function harness(action,result,options={}){
  const errors=[];
  const ctx=vm.createContext({console:{error:(...a)=>errors.push(a.join(' ')),log:()=>{}},Date,JSON,Object,Number});
  vm.runInContext(code,ctx);
  const calls=[];
  ctx.validateEnvelope_=()=>({actor:{email:'employee@example.com'},action});
  ctx.withLock_=cb=>cb();
  ctx.runAction_=()=>result;
  ctx.syncAccount_=()=>{
    calls.push('employeeSync');
    if(options.syncThrows)throw Error('employee sync temporarily failed');
  };
  ctx.syncManagerByEmail_=(email,max)=>calls.push(['managerPush',email,max]);
  ctx.jsonOutput_=object=>object;
  const output=ctx.doPost({postData:{contents:'{}'}});
  return {output,calls,errors};
}

test('REGRESSION: nhân viên xóa hoàn thành nhưng không có lịch khẩn vẫn gửi ngay đến Trưởng phòng',()=>{
  const h=harness('remove',{sync:true,urgentSync:false,managerPushEmail:'manager@example.com',view:{notice:'Đã hoàn thành'},changed:true});
  assert.equal(h.output.ok,true);
  assert.equal(h.output.needsSync,true);
  assert.deepEqual(h.calls,[['managerPush','manager@example.com',2]]);
});

test('Không gửi nhầm khi xóa do nhập sai hoặc chưa xác định người quản lý',()=>{
  const h=harness('remove',{sync:true,urgentSync:false,managerPushEmail:'',view:{notice:'Đã xóa'},changed:true});
  assert.equal(h.output.ok,true);
  assert.deepEqual(h.calls,[]);
});

test('Lịch hủy khẩn vẫn được xử lý trước, gửi thông báo Trưởng phòng đúng một lần',()=>{
  const h=harness('remove',{sync:true,urgentSync:true,managerPushEmail:'manager@example.com',view:{},changed:true});
  assert.equal(h.output.ok,true);
  assert.deepEqual(h.calls,['employeeSync',['managerPush','manager@example.com',2]]);
});

test('Thông báo đến từ hộp thư chờ cũng có thể gửi khi Trưởng phòng tải lần đầu',()=>{
  const h=harness('load',{sync:false,urgentSync:false,managerPushEmail:'manager@example.com',view:{},changed:false});
  assert.equal(h.output.ok,true);
  assert.deepEqual(h.calls,[['managerPush','manager@example.com',2]]);
});

test('Nếu gửi lịch nhân viên lỗi, thông báo Trưởng phòng vẫn được thử và dữ liệu hoàn thành vẫn lưu',()=>{
  const h=harness('remove',{sync:true,urgentSync:true,managerPushEmail:'manager@example.com',view:{},changed:true},{syncThrows:true});
  assert.equal(h.output.ok,true);
  assert.deepEqual(h.calls,['employeeSync',['managerPush','manager@example.com',2]]);
  assert.equal(h.errors.some(s=>s.includes('Deferred sync:')),true);
});

test('Thông báo mới cho Trưởng phòng không bị lịch hủy công việc cá nhân chặn lại',()=>{
  const ctx=vm.createContext({console,Date,JSON,Object,Number});
  vm.runInContext(code,ctx);
  const now=Date.now();
  const state=ctx.newState_();
  state.externalId='th_'+'a'.repeat(44);
  state.cancellations=[{id:'existing-cancel',key:'cancel',at:now+3600000}];
  state.inbox=[{id:'completed-abc',from:'Nhân viên',title:'Báo cáo',at:new Date().toISOString(),pushSent:false}];
  let stored=null;
  const sh={getRange:()=>({getValue:()=>JSON.stringify(state)})};
  ctx.saveState_=(_sh,_row,profile,email)=>{assert.equal(email,'manager@example.com');stored=profile;};
  const jobs=ctx.claimManagerAlerts_(sh,2,'manager@example.com',2);
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].kind,'manager');
  assert.equal(jobs[0].key,'completed-abc');
  assert.equal(jobs[0].externalId,state.externalId);
  assert.equal(stored.cancellations.length,1);
  assert.equal(stored.cancellations[0].id,'existing-cancel');
});
