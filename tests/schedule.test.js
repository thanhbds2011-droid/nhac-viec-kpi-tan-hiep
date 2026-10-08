'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../apps-script/Code.gs','utf8');
const context=vm.createContext({Date,console});
vm.runInContext(src,context);
test('4 lịch nhắc: ngày 12/13/14/15 tháng 12/2026 lúc 07:30 Việt Nam',()=>{
  const due='2026-12-15',time='07:30';
  const expected=['2026-12-12T00:30:00.000Z','2026-12-13T00:30:00.000Z',
    '2026-12-14T00:30:00.000Z','2026-12-15T00:30:00.000Z'];
  assert.deepEqual([3,2,1,0].map(i=>new Date(context.dateMs_(due,time,i)).toISOString()),expected);
});
test('qua Tết, cuối tháng và năm mới vẫn liên tục, không loại ngày lễ',()=>{
  const expected=['2026-12-29','2026-12-30','2026-12-31','2027-01-01'];
  assert.deepEqual([3,2,1,0].map(i=>new Date(context.dateMs_('2027-01-01','20:15',i)).toISOString().slice(0,10)),expected);
});
test('giờ 00:00 tại Việt Nam tương ứng 17:00 UTC hôm trước',()=>{
  assert.equal(new Date(context.dateMs_('2026-12-15','00:00',0)).toISOString(),'2026-12-14T17:00:00.000Z');
});
test('đầu vào ngày, giờ được kiểm tra nghiêm ngặt',()=>{
  assert.equal(context.validDay_('2026-02-30'),false);
  assert.equal(context.validDay_('2028-02-29'),true);
  assert.equal(context.validTime_('23:59'),true);
  assert.equal(context.validTime_('24:00'),false);
  assert.equal(context.validTime_('7:30'),false);
});
test('không tự động gộp nhiệm vụ của A, B và C',()=>{
  const objA={id:'task1',externalId:'th_a',dueDate:'2026-12-15'};
  const objB={id:'task1',externalId:'th_b',dueDate:'2026-12-15'};
  assert.notEqual(objA.externalId,objB.externalId);
});

test('OneSignal một App ID nhưng payload chỉ nhắm external_id của đúng một người',()=>{
  const calls=[];
  context.prop_ = k => ({ONESIGNAL_APP_ID:'one-shared-app',WEB_URL:'https://example.vercel.app'})[k];
  context.oneSignal_ = (method,path,payload)=>{calls.push({method,path,payload});return {id:'message-123'};};
  const slot={offset:2,at:context.dateMs_('2026-12-15','07:30',2),key:'f5dcfd44-6810-4f85-9c52-91e5391d9c27'};
  const task={title:'Kiểm tra minh chứng',dueDate:'2026-12-15'};
  context.createNotification_(slot,task,'th_user_A');
  context.createNotification_(slot,task,'th_user_B');
  assert.equal(calls.length,2);
  assert.equal(calls[0].payload.app_id,calls[1].payload.app_id);
  assert.equal(calls[0].payload.target_channel,'push');
  assert.equal(calls[0].payload.include_aliases.external_id.join(','),'th_user_A');
  assert.equal(calls[1].payload.include_aliases.external_id.join(','),'th_user_B');
  assert.equal(calls[0].payload.send_after,'2026-12-13T00:30:00.000Z');
  assert.equal(calls[0].payload.included_segments,undefined);
});

test('sửa việc sẽ giữ thông tin thông báo cũ để hủy trước khi lên lịch mới',()=>{
  const at=Date.now()+86400000;
  const profile={externalId:'th_owner_A',cancellations:[]};
  const task={title:'Tên việc cũ',dueDate:'2026-12-15',slots:[{id:'old_message',key:'old_key',offset:3,at}]};
  context.prepareCancellation_(profile,task);
  assert.equal(profile.cancellations.length,1);
  assert.equal(profile.cancellations[0].id,'old_message');
  assert.equal(profile.cancellations[0].title,'Tên việc cũ');
  assert.equal(profile.cancellations[0].externalId,'th_owner_A');
  assert.equal(task.slots.length,0);
});
