'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const key=i=>'icpv:'+String(i).padStart(64,'a');
function harness(){
 const ctx=vm.createContext({Date,console,JSON,Object,Number});
 vm.runInContext(fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8'),ctx);
 const profile=ctx.newState_();profile.externalId='th_'+'a'.repeat(44);
 let seq=0,writes=0;
 ctx.book_=()=>({});ctx.checkAccess_=()=>({email:'a@example.com',name:'A',role:'USER'});
 ctx.readState_=()=>({row:2,profile});ctx.stateSheet_=()=>({});
 ctx.saveState_=()=>{writes++;};
 ctx.Utilities={getUuid:()=>`uuid-${++seq}`,formatDate:()=> '2026-10-09'};
 const actor={subject:'google-sub-a',email:'a@example.com',name:'A',externalId:profile.externalId};
 const run=(decisions,rev=profile.revision)=>ctx.runAction_({action:'reviewIcpv',data:{decisions,expectedRevision:rev},actor});
 return {ctx,profile,run,writes:()=>writes};
}
const add=(n,title,due='2026-12-15')=>({kind:'add',sourceKey:key(n),title,dueDate:due});
test('v1.7: two genuinely distinct tasks with the same title/date remain independent after review',()=>{
 const h=harness(),r=h.run([add(1,'Báo cáo quý IV'),add(2,'Báo cáo quý IV')]);
 assert.equal(r.view.importSummary.added,2);assert.equal(h.profile.tasks.length,2);
 assert.notEqual(h.profile.tasks[0].id,h.profile.tasks[1].id);
 assert.equal(h.profile.tasks[0].title,h.profile.tasks[1].title);
 assert.equal(h.profile.revision,1);assert.equal(h.writes(),1);
});
test('v1.7: one selected task is updated, its reminder time preserved, other tasks unchanged',()=>{
 const h=harness();h.run([add(1,'Việc cũ','2026-12-15'),add(2,'Việc khác','2026-12-17')]);
 const first=h.profile.tasks[0],second=h.profile.tasks[1];
 first.time='19:00';const secondSlots=second.slots.map(x=>x.key);
 const result=h.run([{kind:'update',targetId:first.id,sourceKey:key(3),title:'Tên sau sửa',dueDate:'2026-12-25'}]);
 assert.equal(result.view.importSummary.updated,1);
 assert.equal(first.title,'Tên sau sửa');assert.equal(first.dueDate,'2026-12-25');assert.equal(first.time,'19:00');
 assert.equal(first.sourceKey,key(3));assert.deepEqual(second.slots.map(x=>x.key),secondSlots);
 assert.equal(second.dueDate,'2026-12-17');
});
test('v1.7: invalid item rejects entire batch, no earlier task is mutated',()=>{
 const h=harness();h.run([add(1,'Công việc đang theo dõi')]);
 const first=h.profile.tasks[0],rev=h.profile.revision,writes=h.writes();
 assert.throws(()=>h.run([{kind:'update',targetId:first.id,sourceKey:key(1),title:'Đổi tên',dueDate:'2026-12-20'},
  {kind:'add',sourceKey:key(2),title:'Sai thời hạn',dueDate:'2026-01-01'}]),/thời hạn/i);
 assert.equal(first.title,'Công việc đang theo dõi');assert.equal(h.profile.tasks.length,1);
 assert.equal(h.profile.revision,rev);assert.equal(h.writes(),writes);
});
test('v1.7: user cannot accidentally update same task twice in one review; obsolete revision cannot duplicate',()=>{
 const h=harness();h.run([add(1,'A')]);const rev=h.profile.revision,id=h.profile.tasks[0].id;
 assert.throws(()=>h.run([{kind:'update',targetId:id,sourceKey:key(2),title:'B',dueDate:'2026-12-21'},
  {kind:'update',targetId:id,sourceKey:key(3),title:'C',dueDate:'2026-12-22'}]),/chọn đúng công việc/);
 h.run([add(4,'D')]);
 assert.throws(()=>h.run([add(5,'E')],rev),/thiết bị khác/);
});
test('v1.7: explicitly adding a previously deleted source is not automatic restoration',()=>{
 const h=harness();h.profile.deletedSourceKeys.push(key(1));
 assert.equal(h.run([add(1,'Việc cần chủ động thêm lại')]).view.importSummary.added,1);
 assert.equal(h.profile.tasks.length,1);
});
test('v1.7: explicitly choosing update with unchanged text can re-link source, without re-creating reminders',()=>{
 const h=harness();h.run([add(1,'Việc A')]);const task=h.profile.tasks[0],slots=task.slots.map(s=>s.key);
 const r=h.run([{kind:'update',targetId:task.id,sourceKey:key(2),title:'Việc A',dueDate:'2026-12-15'}]);
 assert.equal(r.view.importSummary.updated,1);assert.equal(task.sourceKey,key(2));
 assert.deepEqual(task.slots.map(s=>s.key),slots);
});
test('v1.7: scanner hashes whole visible set, including identical task names and different due dates',async()=>{
 const cell=s=>({innerText:s});
 const row=cells=>({getClientRects:()=>[1],querySelectorAll:q=>q.startsWith(':scope > td')?cells:[]});
 let due='20/12/2026';
 const table={getClientRects:()=>[1],querySelectorAll:q=>{
  if(q==='thead th')return [cell('Tên công việc'),cell('Hạn hoàn thành')];
  if(q==='tbody tr')return [row([cell('Báo cáo hàng tháng'),cell(due)]),row([cell('Báo cáo hàng tháng'),cell('25/12/2026')])];return [];
 }};
 const ctx={location:{protocol:'https:',origin:'https://icpv.thanhuytphcm.vn'},
  document:{body:{innerText:'Quản lý nhiệm vụ iCPV'},querySelectorAll:q=>q==='table,[role="grid"],[role="table"]'?[table]:[]},
  crypto:crypto.webcrypto,TextEncoder,Date,Uint8Array,Number,Map,String};
 vm.runInNewContext(fs.readFileSync(path.join(root,'chrome-extension/icpv-reader.js'),'utf8'),ctx);
 const first=await ctx.TanHiepIcpvReader.scan();
 assert.equal(first.items.length,2);assert.notEqual(first.items[0].sourceKey,first.items[1].sourceKey);
 due='21/12/2026';const updated=await ctx.TanHiepIcpvReader.scan();
 assert.notEqual(first.digest,updated.digest);
});
test('v1.7: only the explicitly authorized origin receives automatic watching; no iCPV API or cookie access',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'chrome-extension/manifest.json'),'utf8'));
 assert.deepEqual(manifest.host_permissions,['https://nhac-viec-kpi-tan-hiep.vercel.app/*']);
 assert.ok(manifest.optional_host_permissions.length===1);
 assert.ok(!manifest.content_scripts.some(x=>x.matches.some(u=>u.includes('icpv'))));
 const worker=fs.readFileSync(path.join(root,'chrome-extension/background.js'),'utf8');
 assert.match(worker,/permissions\.contains/);assert.match(worker,/approvedOrigin/);
 const watch=fs.readFileSync(path.join(root,'chrome-extension/auto-watch.js'),'utf8');
 assert.doesNotMatch(watch,/document\.cookie|localStorage|fetch\(/);
 assert.match(watch,/confirm\(/);
});
test('v1.7: new review action is allowed by Vercel API and client, while other workflows remain present',()=>{
 const server=fs.readFileSync(path.join(root,'api/data.js'),'utf8');
 const ui=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
 assert.match(server,/'reviewIcpv'/);assert.match(ui,/api\('reviewIcpv'/);
 assert.match(ui,/api\('load'/);assert.match(ui,/optimisticMutation\('remove'/);
 assert.match(ui,/TAN_HIEP_ICPV_ACCOUNT_CONTEXT_V1/);
});
