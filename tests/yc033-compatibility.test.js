'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
function section(a,b){const start=js.indexOf(a),end=js.indexOf(b,start);assert.ok(start>=0&&end>start);return js.slice(start,end);}

test('YC-033: Safari fallback giữ nguyên các thao tác xác nhận, cancel và đóng hộp thoại',()=>{
  const program=section('function openAppDialog(dialog){','function openTaskMenu(t){');
  const events=[],attributes=new Set();
  const dialog={classList:{classes:new Set(),add(c){this.classes.add(c);},remove(c){this.classes.delete(c);},contains(c){return this.classes.has(c);}},
    setAttribute(k){attributes.add(k);},removeAttribute(k){attributes.delete(k);},
    querySelector:()=>({focus(){events.push('focus');}}),dispatchEvent(e){events.push(e.type);}};
  const ctx={Event:class Event{constructor(type){this.type=type;}},document:{},console};
  vm.createContext(ctx);vm.runInContext(program,ctx);
  ctx.dialog=dialog;
  vm.runInContext('openAppDialog(dialog)',ctx);
  assert.equal(attributes.has('open'),true);
  assert.equal(attributes.has('aria-modal'),true);
  assert.deepEqual(events,['focus']);
  vm.runInContext('closeAppDialog(dialog,"confirm")',ctx);
  assert.equal(dialog.returnValue,'confirm');
  assert.equal(attributes.has('open'),false);
  assert.deepEqual(events,['focus','close']);
  vm.runInContext('openAppDialog(dialog)',ctx);
  vm.runInContext('closeAppDialog(dialog,"discard")',ctx);
  assert.equal(dialog.returnValue,'discard');
});

test('YC-033: trình duyệt hỗ trợ dialog không đổi sang fallback',()=>{
  const program=section('function openAppDialog(dialog){','function openTaskMenu(t){');
  const events=[];
  const dialog={showModal(){events.push('open');},close(value){events.push('close:'+value);},classList:{contains:()=>false}};
  const ctx={document:{},Event:class{}};vm.createContext(ctx);vm.runInContext(program,ctx);
  ctx.dialog=dialog;vm.runInContext('openAppDialog(dialog);closeAppDialog(dialog,"confirm")',ctx);
  assert.deepEqual(events,['open','close:confirm']);
});

test('YC-033: thiếu BroadcastChannel vẫn gửi revision, không ghi thông tin công việc trong localStorage',()=>{
  const program=section('function emitTabChange(event){','async function checkRevision(force=false){');
  const writes=[];
  const ctx={state:{broadcast:null,localRevisionKey:'nhac-kpi-revision-th_example'},localStorage:{setItem(...parts){writes.push(parts);}},Date,Math,Number};
  vm.createContext(ctx);vm.runInContext(program,ctx);
  ctx.event={revision:12,change:{type:'upsert',task:{title:'Nội dung riêng tư',id:'secret'}}};
  vm.runInContext('emitTabChange(event)',ctx);
  assert.equal(writes.length,1);
  assert.match(writes[0][0],/^nhac-kpi-revision-/);
  const value=JSON.parse(writes[0][1]);
  assert.equal(value.revision,12);assert.equal('change' in value,false);
  assert.equal(writes[0][1].includes('Nội dung riêng tư'),false);
});

test('YC-033: người dùng cùng thiết bị nhưng khác tài khoản không dùng chung key đồng bộ',()=>{
  assert.match(js,/state\.localRevisionKey='nhac-kpi-revision-'\+externalId/);
  assert.match(js,/event\.key!==state\.localRevisionKey/);
  assert.match(js,/state\.localRevisionKey='';/);
});

test('YC-033: nhận trạng thái dự phòng qua storage vẫn phải xác minh từ máy chủ',()=>{
  assert.match(js,/void checkRevision\(true\); \/\/ Always verify actual state from authenticated server/);
  assert.match(js,/if\(state\.busy\)\{state\.reconcileAfterBusy=true;return;\}/);
});

test('YC-033: trình duyệt iOS cũ vẫn hiện công việc, cảnh báo giới hạn Push',()=>{
  const fn=section('function pushDeviceIssue(){','function pushSnapshot(){');
  const ctx={
    window:{isSecureContext:true,matchMedia:()=>({matches:true}),Notification:{permission:'default'},PushManager:function(){}},
    navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X)',maxTouchPoints:0,standalone:true,serviceWorker:{}},
    Notification:{permission:'default'}
  };
  vm.createContext(ctx);vm.runInContext(fn,ctx);
  assert.match(vm.runInContext('pushDeviceIssue()',ctx),/iOS dưới 16\.4/);
});

test('YC-033: không bắt chờ SDK OneSignal khi đăng xuất hoặc tải công việc',()=>{
  assert.match(js,/if\(state\.onesignal\)await state\.onesignal\.logout\(\)/);
  assert.match(js,/if\(pushDeviceIssue\(\)\)pushState\(\);\s*else bindPushForCurrentSession/);
});

test('YC-033: SDK chỉ thử tải lại một lần khi người dùng yêu cầu',()=>{
  const program=section('let sdkInitPromise=null;','function queueIdentity(op){');
  const appended=[];
  const ctx={state:{onesignal:null},document:{createElement:()=>({setAttribute(){}}),head:{appendChild:(e)=>appended.push(e)}},window:{},console};
  vm.createContext(ctx);vm.runInContext(program,ctx);
  vm.runInContext('retryOneSignalScript();retryOneSignalScript()',ctx);
  assert.equal(appended.length,1);
  assert.match(appended[0].src,/cdn\.onesignal\.com/);
});

test('YC-033: màn hình mới vẫn theo bản V1.9.0, thêm fallback viewport và phiên bản asset nhất quán',()=>{
  assert.match(css,/min-height:100vh;min-height:100dvh/);
  assert.match(css,/dialog\.compat-dialog-open/);
  assert.match(css,/@media\(max-width:720px\)/);
  assert.match(html,/\/styles\.css\?v=1\.9\.3/);
  assert.match(html,/\/app\.js\?v=1\.9\.3/);
  assert.match(html,/Phiên bản 1\.9\.3/);
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.version,'1.9.3');
});

test('YC-033: OneSignal worker, các API không sửa và Extension giữ baseline; api/data.js đổi có kiểm thử YC-035',()=>{
  const crypto=require('node:crypto');
  // SHA-256 of unchanged baseline files in the source ZIP V1.9.0.
  const sha={
    'api/realtime.js':'65de03810884bce2e3a462b1ca1f582a6c928a62dca6a1759a69da77fbd65ac2',
    'api/config.js':'48ce2616c19e762664dbda7a9c10099515c7f5faf5154ecfc12695ff36487fd8',
    'public/OneSignalSDKWorker.js':'6b27ed7a2672ed900351d4d67b6693e3dc943ca6eff4767dc6a257b9df736dbe',
    'chrome-extension/background.js':'2f933f581e1023cde70dade4f48b6a67b6136e91dead4eb7340b88d6f7a1ced3'
  };
  for(const [file,expected] of Object.entries(sha)){
    const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
    assert.equal(actual,expected,'Không được thay đổi nghiệp vụ baseline: '+file);
  }
});

test('YC-033: lỗi khởi tạo SDK thật sự cho phép thử lại thay vì kẹt Promise vĩnh viễn',async()=>{
  const program=section('let sdkInitPromise=null;','function queueIdentity(op){');
  const callbacks=[];
  const ctx={window:{OneSignalDeferred:callbacks},state:{config:{oneSignalAppId:'demo'},onesignal:null},
    setTimeout,clearTimeout,pushState(){},console};
  vm.createContext(ctx);vm.runInContext(program,ctx);
  const first=vm.runInContext('sdk()',ctx);
  await callbacks[0]({init:async()=>{throw Error('device-init-error')}});
  await assert.rejects(first,/device-init-error/);
  const second=vm.runInContext('sdk()',ctx);
  assert.equal(callbacks.length,2);
  const device={init:async()=>{},Notifications:{addEventListener(){}},User:{PushSubscription:{addEventListener(){}}}};
  await callbacks[1](device);
  assert.equal(await second,device);
});
