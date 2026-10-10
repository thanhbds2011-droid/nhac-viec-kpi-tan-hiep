'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const KEY1='icpv:'+ 'a'.repeat(64),KEY2='icpv:'+ 'b'.repeat(64);
function harness(){
  const ctx=vm.createContext({Date,console,JSON,Object,Number});
  vm.runInContext(fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8'),ctx);
  const profile=ctx.newState_();profile.externalId='th_'+ 'a'.repeat(44);
  let writes=0;let counter=0;
  ctx.book_=()=>({});ctx.checkAccess_=()=>({email:'a@example.com',name:'A'});
  ctx.readState_=()=>({row:2,profile});ctx.stateSheet_=()=>({});
  ctx.saveState_=()=>{writes++;};
  ctx.Utilities={getUuid:()=>String(++counter),formatDate:()=> '2026-10-09'};
  const actor={subject:'google-sub-a',email:'a@example.com',name:'A',externalId:profile.externalId};
  const run=(items,expectedRevision=profile.revision)=>ctx.runAction_({action:'importTasks',data:{items,expectedRevision},actor});
  return {ctx,profile,run,writes:()=>writes};
}
test('Import vào Sheet đúng một lần; gửi sự kiện batch; không tạo lại nhiệm vụ sau khi nhập lại',()=>{
 const h=harness(),item={sourceKey:KEY1,title:'Báo cáo quý IV',dueDate:'2026-12-15'};
 const first=h.run([item]);
 assert.equal(first.changed,true);assert.equal(first.view.importSummary.added,1);
 assert.equal(first.change.type,'importBatch');assert.equal(h.profile.revision,1);
 assert.equal(h.writes(),1);assert.equal(h.profile.tasks[0].time,'07:30');
 const second=h.run([item]);
 assert.equal(second.changed,false);assert.equal(second.view.importSummary.unchanged,1);
 assert.equal(h.writes(),1);assert.equal(h.profile.tasks.length,1);
});
test('Khi iCPV đổi hạn, không ghi đè tên riêng, giờ riêng, thời hạn của người dùng',()=>{
 const h=harness();h.run([{sourceKey:KEY1,title:'Tên gốc',dueDate:'2026-12-15'}]);
 h.profile.tasks[0].title='Tên tôi đã rút gọn';h.profile.tasks[0].time='19:00';
 const r=h.run([{sourceKey:KEY1,title:'Tên gốc',dueDate:'2026-12-22'}]);
 assert.equal(r.view.importSummary.updated,0);
 assert.equal(r.view.importSummary.skipped,1);
 assert.equal(h.profile.tasks[0].time,'19:00');
 assert.equal(h.profile.tasks[0].title,'Tên tôi đã rút gọn');
 assert.equal(h.profile.tasks[0].dueDate,'2026-12-15');
 assert.equal(h.profile.revision,1);assert.equal(h.writes(),1);
});
test('Không hồi sinh task xóa và không chiếm task thủ công cùng tên',()=>{
 const h=harness();
 h.run([{sourceKey:KEY1,title:'Việc A',dueDate:'2026-12-15'}]);
 h.profile.tasks[0].deleted=true;
 const r=h.run([{sourceKey:KEY1,title:'Việc A',dueDate:'2026-12-20'}]);
 assert.equal(r.view.importSummary.skipped,1);assert.equal(h.profile.tasks.length,1);
 const h2=harness();h2.profile.tasks.push({id:'manual',title:'Việc B',dueDate:'2026-12-17',time:'07:30',deleted:false});
 const r2=h2.run([{sourceKey:KEY2,title:'Việc B',dueDate:'2026-12-20'}]);
 assert.equal(r2.view.importSummary.skipped,1);assert.equal(h2.profile.tasks.length,1);
});
test('Từ chối dữ liệu sai, hạn đã qua, file trùng key, giới hạn 30',()=>{
 const h=harness();
 const r=h.run([{sourceKey:KEY1,title:'Đã qua hạn',dueDate:'2026-10-08'},
 {sourceKey:'bad',title:'Không hợp lệ',dueDate:'2026-12-15'},
 {sourceKey:KEY2,title:'Nhiệm vụ hợp lệ',dueDate:'2026-12-20'},
 {sourceKey:KEY2,title:'Trùng nguồn',dueDate:'2026-12-21'}]);
 assert.equal(r.view.importSummary.added,1);assert.equal(r.view.importSummary.skipped,3);
 assert.throws(()=>h.run(Array(31).fill({sourceKey:KEY1,title:'A',dueDate:'2026-12-20'})),/30 nhiệm vụ/);
 assert.throws(()=>h.run([{sourceKey:KEY1,title:'A',dueDate:'2026-12-20'}],0),/thiết bị khác/);
});
test('Extractor: giữ hai công việc trùng tên nhưng khác đầu việc; đọc đúng hạn',async()=>{
 const cell=s=>({innerText:s});
 const tr=(cells)=>({getClientRects:()=>[1],querySelectorAll:q=>q.startsWith(':scope > td')?cells:[]});
 const table={getClientRects:()=>[1],querySelectorAll:q=>{
   if(q==='thead th')return [cell('STT'),cell('Tên công việc'),cell('Ngày tạo'),cell('Hạn hoàn thành')];
   if(q==='tbody tr')return [
     tr([cell('1'),cell('Tham mưu văn bản về Quỹ Vì người nghèo Từ kho'),cell('06/10/2026'),cell('15/12/2026')]),
     tr([cell('2'),cell('Báo cáo quý IV'),cell('06/10/2026'),cell('20/12/2026')]),
     tr([cell('3'),cell('Báo cáo quý IV'),cell('06/10/2026'),cell('21/12/2026')])
   ];return [];
 }};
 const ctx={location:{protocol:'https:',origin:'https://example.icpv.gov.vn'},
 document:{body:{innerText:'iCPV - TP.HCM | Quản lý nhiệm vụ'},querySelectorAll:q=>q==='table,[role="grid"],[role="table"]'?[table]:[]},
 crypto:crypto.webcrypto,TextEncoder,Date,Uint8Array,Number,Map,String};
 const result=await vm.runInNewContext(fs.readFileSync(path.join(root,'chrome-extension/icpv-reader.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'chrome-extension/extract.js'),'utf8'),ctx);
 assert.equal(result.count,3);assert.equal(result.items.length,3);
 assert.equal(result.items[0].dueDate,'2026-12-15');
 assert.equal(result.items[0].title,'Tham mưu văn bản về Quỹ Vì người nghèo');
 assert.notEqual(result.items[1].sourceKey,result.items[2].sourceKey);
 assert.match(result.items[0].sourceKey,/^icpv:[a-f0-9]{64}$/);
});
test('Quyền tiện ích giới hạn website đích, không tự lấy cookie hoặc gọi API iCPV',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'chrome-extension/manifest.json'),'utf8'));
 assert.deepEqual(manifest.host_permissions,['https://nhac-viec-kpi-tan-hiep.vercel.app/*']);
 assert.deepEqual(manifest.permissions,['activeTab','scripting','storage']);
 const contents=fs.readFileSync(path.join(root,'chrome-extension/extract.js'),'utf8');
 assert.doesNotMatch(contents,/document\.cookie|localStorage|getAllCookies|fetch\(/);
});
