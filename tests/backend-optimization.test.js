'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync(__dirname+'/../apps-script/Code.gs','utf8');
function setup(){
  const ctx=vm.createContext({Date,console,JSON,Object,Number});
  vm.runInContext(code,ctx);
  const profile={defaultTime:'07:30',externalId:'th_owner_A',tasks:[],cancellations:[]};
  const sheet={writes:0,profile,
    getRange(row,col){
      assert.equal(row,2);
      return {getValue:()=>JSON.stringify(sheet.profile),setValues(values){
        assert.equal(col,2);sheet.profile=JSON.parse(values[0][1]);sheet.writes++;
      }};
    }
  };
  return {ctx,sheet,profile};
}
function slot(at,props={}){
  return {key:'118725bb-aeb1-4fd9-ac96-0b21183e235a',at,offset:0,id:'',nextRetryAt:0,...props};
}
test('xóa công việc chưa từng lên lịch: không tạo yêu cầu hủy',()=>{
  const {ctx}=setup();const p={externalId:'th_owner_A',cancellations:[]};
  const t={title:'Báo cáo',dueDate:'2026-12-15',slots:[slot(Date.now()+5*86400000)]};
  ctx.prepareCancellation_(p,t);
  assert.equal(p.cancellations.length,0);assert.equal(t.slots.length,0);
});
test('lịch có ID cũ vẫn được giữ để hủy',()=>{
  const {ctx}=setup();const p={externalId:'th_owner_A',cancellations:[]};
  const t={title:'Báo cáo',dueDate:'2026-12-15',slots:[slot(Date.now()+5*86400000,{id:'one-999'})]};
  ctx.prepareCancellation_(p,t);assert.equal(p.cancellations.length,1);
  assert.equal(p.cancellations[0].id,'one-999');
});
test('đã claim rồi sửa: lưu lease và idempotency key để hủy kết quả in-flight',()=>{
  const {ctx,sheet}=setup();
  sheet.profile.tasks=[{id:'job1',title:'Hạn cũ',dueDate:'2027-01-15',time:'07:30',slots:[slot(Date.now()+3*86400000)]}];
  const claims=ctx.claimJobs_(sheet,2,'one@example.com',4,false);
  assert.equal(claims.length,1);assert.equal(sheet.writes,1);
  ctx.prepareCancellation_(sheet.profile,sheet.profile.tasks[0]);
  assert.equal(sheet.profile.cancellations.length,1);
  assert.equal(sheet.profile.cancellations[0].leaseUntil,claims[0].slot.leaseUntil);
  const result={key:claims[0].key,leaseUntil:claims[0].slot.leaseUntil,kind:'create',id:'scheduled-123',error:''};
  ctx.finishJobs_(sheet,2,'one@example.com',[result]);
  assert.equal(sheet.profile.cancellations[0].id,'scheduled-123');
  assert.equal(sheet.profile.cancellations[0].nextRetryAt,0);
  const cancels=ctx.claimJobs_(sheet,2,'one@example.com',4,false);
  assert.equal(cancels[0].kind,'cancel');
  ctx.finishJobs_(sheet,2,'one@example.com',[{key:cancels[0].key,leaseUntil:cancels[0].slot.leaseUntil,kind:'cancel',id:'',error:''}]);
  assert.equal(sheet.profile.cancellations.length,0);
});
test('khóa lease: không claim lặp cùng 1 slot',()=>{
  const {ctx,sheet}=setup();
  sheet.profile.tasks=[{title:'A',dueDate:'2027-01-15',slots:[slot(Date.now()+2*86400000)]}];
  const first=ctx.claimJobs_(sheet,2,'x@x.com',3,false);
  const again=ctx.claimJobs_(sheet,2,'x@x.com',3,false);
  assert.equal(first.length,1);assert.equal(again.length,0);
  assert.equal(sheet.writes,1,'Không ghi nếu không có việc mới');
});
test('sync thủ công có thể thử lại khi hết quyền push rồi kích hoạt lại',()=>{
  const {ctx,sheet}=setup();
  sheet.profile.tasks=[{title:'A',dueDate:'2027-01-15',slots:[slot(Date.now()+3*86400000,{nextRetryAt:Date.now()+2*3600000})]}];
  assert.equal(ctx.claimJobs_(sheet,2,'x@x.com',3,false).length,0);
  assert.equal(ctx.claimJobs_(sheet,2,'x@x.com',3,true).length,1);
});
test('sửa ngoài cửa sổ 7 ngày không làm tạo/hủy OneSignal',()=>{
  const {ctx,sheet}=setup();
  sheet.profile.tasks=[{title:'Xa',dueDate:'2027-01-15',slots:[slot(Date.now()+15*86400000)]}];
  assert.equal(ctx.claimJobs_(sheet,2,'x@x.com',4,false).length,0);
  ctx.prepareCancellation_(sheet.profile,sheet.profile.tasks[0]);
  assert.equal(sheet.profile.cancellations.length,0);
});
test('batch 4 lịch: chỉ ghi claim một lần và kết quả một lần trong mô phỏng',()=>{
  const {ctx,sheet}=setup(),base=Date.now()+5*86400000;
  sheet.profile.tasks=[{title:'Hồ sơ quý',dueDate:'2027-01-15',slots:[0,1,2,3].map((i)=>slot(base-i*86400000,{key:'uuid-'+i,offset:i}))}];
  const claims=ctx.claimJobs_(sheet,2,'x@x.com',4,false);
  assert.equal(claims.length,4);
  assert.equal(sheet.writes,1);
  ctx.finishJobs_(sheet,2,'x@x.com',claims.map((j,i)=>({key:j.key,leaseUntil:j.slot.leaseUntil,kind:'create',id:'push-'+i,error:''})));
  assert.equal(sheet.writes,2);
  assert.equal(sheet.profile.tasks[0].slots.filter(s=>s.id).length,4);
});
test('dữ liệu lỗi mạng của bản cũ vẫn phải đối soát khi xóa',()=>{
  const {ctx}=setup(),p={externalId:'th_owner_A',cancellations:[]};
  const old={title:'Việc cũ',dueDate:'2027-01-15',slots:[slot(Date.now()+5*86400000,{nextRetryAt:Date.now()+2*3600000})]};
  ctx.prepareCancellation_(p,old);
  assert.equal(p.cancellations.length,1);
  assert.equal(p.cancellations[0].id,'');
});
