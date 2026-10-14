'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const gs=fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8');
const client=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const {signSession}=require('../server/session');
const {realtimeChannel}=require('../server/realtime');

function scriptCtx(){const ctx=vm.createContext({Date,JSON,Object,Number,console});vm.runInContext(gs,ctx);return ctx;}

test('YC-035: menu Sheets chỉ còn Kiểm tra nhân sự và phân quyền; giữ hàm rollback trong code',()=>{
  const ctx=scriptCtx(),items=[],menus=[];
  ctx.SpreadsheetApp={getUi:()=>({createMenu(name){menus.push(name);return {addItem(name,method){items.push({name,method});return this;},addToUi(){return this;}};}})};
  ctx.onOpen();
  assert.deepEqual(menus,['Nhắc việc KPI']);
  assert.deepEqual(items,[{name:'Kiểm tra nhân sự và phân quyền',method:'inspectUnifiedAdminSheet'}]);
  for(const name of ['rollbackUnifiedAdminSheet','activateUnifiedAdminSheet','prepareUnifiedAdminSheet',
    'rollbackKpiRoutingSheets','inspectUnifiedAdminSheet'])assert.equal(typeof ctx[name],'function');
});

test('YC-035: realtime hint lấy định danh kênh và revision của C đã có inbox; không lộ công việc',()=>{
  const ctx=scriptCtx();
  const p=ctx.newState_();p.revision=12;p.inbox=[{id:'notice_1',title:'Dữ liệu riêng',dismissed:false}];
  ctx.stateSheet_=()=>({});ctx.stateRowByEmail_=()=>4;ctx.approvedRecipient_=()=>true;
  ctx.stateSheet_=()=>({getRange(row,col){assert.equal(row,4);return {getValue:()=>col===1?'google-sub-C':JSON.stringify(p)};}});
  const signal=ctx.managerRealtimeHint_({},'c@example.com');
  assert.deepEqual({...signal},{subject:'google-sub-C',revision:12});
  assert.equal(JSON.stringify(signal).includes('Dữ liệu riêng'),false);
  ctx.approvedRecipient_=()=>false;
  assert.equal(ctx.managerRealtimeHint_({},'c@example.com'),null);
});

test('YC-035: nếu chuyển vào inbox lúc B hoàn thành thất bại tạm thời, doPost thử lại và gửi Push C',()=>{
  const ctx=scriptCtx(),calls=[];
  ctx.validateEnvelope_=()=>({actor:{email:'b@example.com'},action:'remove'});
  ctx.withLock_=fn=>fn();ctx.book_=()=>({});
  ctx.runAction_=()=>({view:{notice:'Đã hoàn thành KPI'},sync:true,urgentSync:false,changed:true,
    pendingDelivery:{sourceRow:2,sourceEmail:'b@example.com',recipientEmail:'c@example.com',completionId:'event1'},
    managerPushEmail:'',change:{type:'remove',id:'job1'}});
  ctx.deliverSingleCompletion_=(_ss,row,from,event,to)=>{calls.push(['deliver',row,from,event,to]);return true;};
  ctx.syncManagerByEmail_=(email)=>calls.push(['push',email]);
  ctx.managerRealtimeHint_=()=>({subject:'sub-C',revision:5});
  ctx.jsonOutput_=v=>v;
  const result=ctx.doPost({postData:{contents:'{}'}});
  assert.equal(result.ok,true);assert.equal(result.managerRealtime.subject,'sub-C');
  assert.deepEqual(calls,[['deliver',2,'b@example.com','event1','c@example.com'],['push','c@example.com']]);
});

test('YC-035: sau khi B hoàn thành, Vercel chỉ phát inboxChanged vào kênh C, không tiết lộ subject C cho B',async()=>{
  const envKeys=['GOOGLE_CLIENT_ID','APPS_SCRIPT_URL','APPS_SCRIPT_SHARED_SECRET','PUSH_ID_SECRET','ABLY_API_KEY'];
  const old=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));const origFetch=global.fetch;
  Object.assign(process.env,{GOOGLE_CLIENT_ID:'test-id',APPS_SCRIPT_URL:'https://script.google.com/macros/s/test/exec',
    APPS_SCRIPT_SHARED_SECRET:'script-secret',PUSH_ID_SECRET:'push-secret',ABLY_API_KEY:'abc.def:abcdefgh'});
  const pub=[];
  global.fetch=async(url,opts)=>{
    if(String(url).includes('script.google.com'))return {ok:true,text:async()=>JSON.stringify({
      ok:true,result:{email:'b@example.com',revision:4,tasks:[],inbox:[]},
      changed:true,change:{type:'remove',id:'done'},managerRealtime:{subject:'sub-C',revision:11}})};
    if(String(url).includes('rest.ably.io')){pub.push({url:String(url),body:JSON.parse(opts.body)});return {ok:true};}
    throw Error('Unexpected URL '+url);
  };
  try{
    // Không cần Google OAuth thực cho bài thử bằng phiên HMAC đã ký;
    // thay module OAuth của môi trường serverless bằng stub trong test duy nhất này.
    const Module=require('node:module'),oldLoad=Module._load;
    let api;
    try{
      Module._load=function(name,parent,isMain){
        if(name==='google-auth-library')return {OAuth2Client:class {}};
        return oldLoad.apply(this,arguments);
      };
      api=require('../api/data');
    }finally{Module._load=oldLoad;}

    const req={method:'POST',headers:{'content-length':'0'},body:{action:'remove',data:{},
      sessionToken:signSession({sub:'sub-B',email:'b@example.com',name:'B'},'push-secret')}};
    let status,reply;const res={setHeader(){return this;},status(x){status=x;return this;},json(v){reply=v;return this;}};
    await api(req,res);
    assert.equal(status,200);
    assert.equal(pub.length,2);
    assert.ok(pub.some(p=>p.url.includes(encodeURIComponent(realtimeChannel('sub-B','push-secret')))));
    const target=pub.find(p=>p.url.includes(encodeURIComponent(realtimeChannel('sub-C','push-secret'))));
    assert.ok(target);
    assert.deepEqual(target.body.data,{revision:11,change:{type:'inboxChanged'}});
    assert.equal(JSON.stringify(reply).includes('sub-C'),false);
    assert.equal(JSON.stringify(reply).includes('managerRealtime'),false);
  }finally{
    global.fetch=origFetch;
    for(const k of envKeys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
  }
});

test('YC-035: frontend phiên mới tự nối OneSignal, thử lại hữu hạn và hủy retry sau đăng xuất',()=>{
  assert.match(client,/else bindPushForCurrentSession\(data\.externalId,epoch\)/);
  assert.match(client,/const delays=\[5000,15000,30000,60000\]/);
  assert.match(client,/state\.sessionEpoch\+\+;clearPushBindRetry\(\);disconnectRealtime\(\)/);
  assert.match(client,/function startInboxFallback\(\)/);
  assert.match(client,/if\(state\.realtime\?\.connection\?\.state==='connected'&&state\.realtimeAttached\)return/);
  assert.match(client,/120000\)/);
});
