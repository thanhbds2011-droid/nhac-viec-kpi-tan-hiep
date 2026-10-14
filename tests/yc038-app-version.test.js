'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const gs=fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8');
const vercel=JSON.parse(fs.readFileSync(path.join(root,'vercel.json')));
const cfg=require('../api/config');
test('YC-038: công bố nhất quán phiên bản app / CSS / JS',()=>{
  const req={method:'GET'};let code,json;
  cfg(req,{setHeader(){return this;},status(n){code=n;return this;},json(v){json=v;return this;}});
  // API config can return 503 in local tests without secrets; inspect source to confirm field.
  assert.match(fs.readFileSync(path.join(root,'api/config.js'),'utf8'),/appVersion: '1\.9\.3-hf3'/);
  assert.match(js,/const APP_VERSION='1\.9\.3-hf3'/);
  assert.match(html,/\/app\.js\?v=1\.9\.3-hf3/);
  assert.match(html,/\/styles\.css\?v=1\.9\.3-hf3/);
  assert.match(js,/visibilitychange/);assert.match(js,/versionCheck/);
  assert.match(js,/hasUnsavedUserWork/);assert.match(js,/location\.replace/);
  assert.ok(vercel.headers.some(h=>h.source==='/'&&h.headers.some(x=>x.key==='Cache-Control')));
});
test('YC-038: giữ worker Push hiện tại, Chrome extension chưa sửa',()=>{
  const baseline=path.resolve(root,'../_inspect_kpi'); // Optional local comparison for release audit.
  assert.match(js,/register\('\/OneSignalSDKWorker\.js',\{scope:'\/'\}\)/);
  assert.match(gs,/Phiên bản ứng dụng đã cũ/);
  assert.match(fs.readFileSync(path.join(root,'chrome-extension/manifest.json'),'utf8'),/"version": "1\.1\.0"/);
});

test('YC-038: tự nạp bản mới khi an toàn; hoãn khi đang sửa công việc',async()=>{
  const vm=require('node:vm');
  const program=js.slice(0,js.indexOf('// YC-033'));
  const redirects=[],messages=[];
  const fields={
    taskTitle:{value:''},dueDate:{value:''},
    confirmDialog:{hasAttribute:()=>false},importDialog:{hasAttribute:()=>false}
  };
  const state={busy:false,signingOut:false,editingId:null};
  const ctx={state,pendingImport:null,$:id=>fields[id],
    navigator:{onLine:true},document:{hidden:false},Date,encodeURIComponent,
    location:{replace:u=>redirects.push(u)},
    fetch:async()=>({ok:true,json:async()=>({appVersion:'1.9.4'})}),
    notify:m=>messages.push(m)
  };
  vm.createContext(ctx);vm.runInContext(program,ctx);
  fields.taskTitle.value='Chưa lưu';
  await vm.runInContext('checkAppVersion()',ctx);
  assert.equal(redirects.length,0);
  assert.ok(messages.some(s=>s.includes('Có phiên bản mới')));
  fields.taskTitle.value='';
  assert.equal(vm.runInContext('applyPendingVersion()',ctx),true);
  assert.deepEqual(redirects,['/?appVersion=1.9.4']);
});
