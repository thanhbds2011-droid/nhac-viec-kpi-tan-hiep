'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../apps-script/Code.gs'),'utf8');

function dayString(date,_zone,format){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(date).map(v=>[v.type,v.value]));
  return format==='yyyy-MM-dd'?`${parts.year}-${parts.month}-${parts.day}`:`${parts.hour}:${parts.minute}`;
}
function setup(start='2026-10-10T02:00:00Z',time='07:30'){
  let clock=Date.parse(start),reminder=time,stored;
  class Clock extends Date{
    constructor(...args){super(...(args.length?args:[clock]));}
    static now(){return clock;}
  }
  const c=vm.createContext({Date:Clock,console,JSON,Object,Number});vm.runInContext(source,c);
  c.prop_=name=>name==='MANAGER_REMINDER_TIME'?reminder:'';
  let seq=0;
  c.Utilities={formatDate:dayString,getUuid:()=>`generated-key-${++seq}`};
  stored=c.newState_();stored.externalId='th_'+'b'.repeat(44);
  stored.inbox=[{id:'notice-1',from:'Nhân viên A',title:'Báo cáo',
    at:'2026-10-09T07:00:00Z',pushSent:true,initialPushDay:'2026-10-09',dismissed:false,nextRetryAt:0}];
  const sh={getRange:()=>({getValue:()=>JSON.stringify(stored)})};
  c.saveState_=(_sh,_row,p)=>{stored=JSON.parse(JSON.stringify(p));};
  const claim=()=>c.claimManagerAlerts_(sh,2,'b@example.com',4);
  const finish=(jobs,id='sent')=>c.finishJobs_(sh,2,'b@example.com',jobs.map(j=>({key:j.key,
    leaseUntil:j.slot.leaseUntil,kind:j.kind,sendDay:j.sendDay,id,error:id==='error'?'OneSignal unavailable':''})));
  return {c,claim,finish,get state(){return stored;},advance(iso){clock=Date.parse(iso);},setTime(v){reminder=v;}};
}
test('v1.8: chưa khai báo giờ thì không tự ý bật nhắc hằng ngày',()=>{
  const h=setup(undefined,'');assert.equal(h.claim().length,0);
});
test('v1.8: chỉ nhắc sau thời điểm cấu hình và từ ngày kế tiếp thông báo đầu tiên',()=>{
  const h=setup('2026-10-10T00:00:00Z'); // 07:00 Việt Nam
  assert.equal(h.claim().length,0);
  h.advance('2026-10-10T00:31:00Z');const jobs=h.claim();
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].kind,'managerReminder');
  assert.equal(jobs[0].sendDay,'2026-10-10');
  assert.match(jobs[0].idempotencyKey,/generated-key/);
  h.finish(jobs);
  assert.equal(h.state.inbox[0].lastReminderDay,'2026-10-10');
  assert.equal(h.claim().length,0);
  h.advance('2026-10-11T00:31:00Z');
  const tomorrow=h.claim();assert.equal(tomorrow.length,1);
  assert.notEqual(tomorrow[0].idempotencyKey,jobs[0].idempotencyKey);
});
test('v1.8: chưa xóa thì tiếp tục mỗi ngày, đã xóa thì dừng ngay',()=>{
  const h=setup();let jobs=h.claim();h.finish(jobs);
  h.advance('2026-10-11T02:00:00Z');jobs=h.claim();assert.equal(jobs.length,1);
  h.state.inbox[0].dismissed=true;
  h.finish(jobs); // kết quả API đến muộn sau khi người dùng xóa
  assert.equal(h.state.inbox[0].lastReminderDay,'2026-10-10');
  h.advance('2026-10-12T02:00:00Z');assert.equal(h.claim().length,0);
});
test('v1.8: lỗi mạng thử lại trong ngày dùng lại một khóa gửi để tránh trùng',()=>{
  const h=setup();const first=h.claim();h.finish(first,'error');
  assert.equal(h.claim().length,0);
  h.advance('2026-10-10T04:15:00Z'); // 11:15 giờ Việt Nam
  const second=h.claim();assert.equal(second.length,1);
  assert.equal(second[0].idempotencyKey,first[0].idempotencyKey);
  h.finish(second);assert.equal(h.state.inbox[0].lastReminderDay,'2026-10-10');
});
test('v1.8: cùng ngày có nhiều công việc sẽ gửi độc lập, không gộp',()=>{
  const h=setup();h.state.inbox.push({id:'notice-2',from:'Nhân viên C',title:'Kế hoạch',at:'2026-10-09T10:00:00Z',
    pushSent:true,initialPushDay:'2026-10-09',dismissed:false,nextRetryAt:0});
  const jobs=h.claim();assert.equal(jobs.length,2);
  assert.notEqual(jobs[0].idempotencyKey,jobs[1].idempotencyKey);
  h.finish(jobs);assert.equal(h.state.inbox[0].lastReminderDay,'2026-10-10');
  assert.equal(h.state.inbox[1].lastReminderDay,'2026-10-10');
});
test('v1.8: sự kiện vừa hoàn thành vẫn gửi ngay, không bị giờ nhắc lại chặn',()=>{
  const h=setup('2026-10-10T00:00:00Z','');
  h.state.inbox[0].pushSent=false;
  assert.equal(h.claim()[0].kind,'manager');
});
test('v1.8: giao diện ẩn khung kỹ thuật nhưng còn nút cấp quyền trên thiết bị chưa đăng ký',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  assert.doesNotMatch(html,/Thông báo nhắc việc trên thiết bị|Kiểm tra trạng thái thiết bị|enablePushAlt|pushDiagnostics/);
  assert.match(html,/id="managerInbox"/);
  assert.match(html,/id="enablePush"/);
  assert.match(js,/snap\.ready\)/);
});
