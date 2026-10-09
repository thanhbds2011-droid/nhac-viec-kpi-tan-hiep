'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const device=app.slice(app.indexOf('function pushDeviceIssue(){'),app.indexOf('function pushSnapshot(){'));
const snapshot=app.slice(app.indexOf('function pushSnapshot(){'),app.indexOf('function pushState(){'));
const enable=app.slice(app.indexOf('async function enablePush(){'),app.indexOf('async function signedIn(response){'));
function browser({agent='Mozilla/5.0 Chrome/122',standalone=false,permission='default',secure=true,push=true}={}){
  const ctx={
    window:{isSecureContext:secure,matchMedia:()=>({matches:standalone}),PushManager:push?function PushManager(){}:undefined},
    navigator:{userAgent:agent,serviceWorker:{},standalone,maxTouchPoints:0},
    Notification:{permission},
  };
  ctx.window.Notification=ctx.Notification;
  if(push)ctx.window.PushManager=function PushManager(){};
  else delete ctx.window.PushManager;
  vm.createContext(ctx);vm.runInContext(device,ctx);
  return ctx;
}
test('push readiness requires HTTPS and a browser that supports service workers',()=>{
  assert.match(vm.runInContext('pushDeviceIssue()',browser({secure:false})),/HTTPS/);
  assert.match(vm.runInContext('pushDeviceIssue()',browser({push:false})),/Web Push/);
});
test('iPhone must open installed PWA, not ordinary Safari tab',()=>{
  const iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
  assert.match(vm.runInContext('pushDeviceIssue()',browser({agent:iphone})),/Màn hình chính/);
  assert.equal(vm.runInContext('pushDeviceIssue()',browser({agent:iphone,standalone:true,permission:'default'})),'');
});
test('denied push permission must give actionable site-settings steps',()=>{
  const b=browser({permission:'denied'});
  assert.match(vm.runInContext('pushDeviceIssue()',b),/Cài đặt trang web/);
  assert.match(vm.runInContext('pushDeviceIssue()',browser({permission:'denied',agent:'iPhone',standalone:true})),/Cài đặt iPhone/);
});
test('multi-device readiness is per-device and requires same signed-in account',()=>{
  const b=browser({permission:'granted'});
  b.state={user:{externalId:'account-A'},pushBoundAccount:'account-A',onesignal:{Notifications:{permission:true},User:{PushSubscription:{optedIn:true,id:'sub1'}}}};
  vm.runInContext(snapshot,b);
  assert.equal(vm.runInContext('pushSnapshot().ready',b),true);
  b.state.user.externalId='account-B';
  assert.equal(vm.runInContext('pushSnapshot().ready',b),false);
  b.state.user.externalId='account-A';b.state.onesignal.User.PushSubscription.id='';
  assert.equal(vm.runInContext('pushSnapshot().ready',b),false);
});
test('enablePush invokes native prompt immediately, before waiting for login',async()=>{
  const b=browser();
  b.state={user:{externalId:'account-A'},pushBusy:false,signingOut:false,sessionEpoch:2,pushError:'',pushBoundAccount:'account-A',onesignal:{
    Notifications:{permission:false,isPushSupported:()=>true,requestPermission:()=>{events.push('prompt');b.Notification.permission='granted';b.state.onesignal.Notifications.permission=true;return Promise.resolve();}},
    User:{PushSubscription:{id:'sub-A',optedIn:true}}
  }};
  const events=[];
  b.$=id=>elements[id]||(elements[id]={disabled:false,textContent:'',className:''});
  const elements={};
  b.setTimeout=setTimeout;b.clearTimeout=clearTimeout;
  b.notify=()=>{};b.updateData=()=>{};b.api=async action=>{events.push(action);return {}};
  vm.runInContext(enable,b);
  vm.runInContext('initPush=async()=>{events.push("login");};pushState=()=>{};waitForSubscription=async()=>true;',b);
  b.events=events;
  const promise=vm.runInContext('enablePush()',b);
  assert.equal(events[0],'prompt');
  await promise;
  assert.deepEqual(events,['prompt','login','sync']);
  assert.equal(b.state.pushBusy,false);
});
test('permission denial returns help instead of attempting to request repeatedly',async()=>{
  const b=browser({permission:'denied'});
  let calls=0;
  b.state={user:{externalId:'account-A'},pushBusy:false,signingOut:false,pushError:'',onesignal:{Notifications:{requestPermission(){calls++}}}};
  b.$=()=>({});b.notify=()=>{};b.updateData=()=>{};
  b.setTimeout=setTimeout;b.clearTimeout=clearTimeout;
  vm.runInContext(enable,b);
  vm.runInContext('pushState=()=>{};',b);
  await vm.runInContext('enablePush()',b);
  assert.equal(calls,0);
  assert.match(b.state.pushError,/Cài đặt trang web/);
});
test('one SDK initialization is shared across concurrent device requests',async()=>{
  const sdkSource=app.slice(app.indexOf('let sdkInitPromise=null;'),app.indexOf('function queueIdentity(op){'));
  const callbacks=[],events=[];
  const ctx={
    window:{OneSignalDeferred:callbacks},
    state:{config:{oneSignalAppId:'dummy-app'},onesignal:null,pushError:''},
    pushState:()=>{},setTimeout,clearTimeout,
  };
  vm.createContext(ctx);vm.runInContext(sdkSource,ctx);
  const a=vm.runInContext('sdk()',ctx),b=vm.runInContext('sdk()',ctx);
  assert.equal(callbacks.length,1);
  const mock={init:async()=>events.push('init'), Notifications:{addEventListener:()=>events.push('permission-hook')},
    User:{PushSubscription:{addEventListener:()=>events.push('subscription-hook')}}};
  await callbacks[0](mock);
  assert.equal(await a,mock);assert.equal(await b,mock);
  assert.deepEqual(events,['init','permission-hook','subscription-hook']);
});
test('same authorized user binds only once, switching accounts calls OneSignal login again',async()=>{
  const functions=app.slice(app.indexOf('function queueIdentity(op){'),app.indexOf('function waitForSubscription(o,'));
  const events=[];
  const o={login:async id=>events.push('login:'+id),logout:async()=>events.push('logout')};
  const ctx={state:{sessionEpoch:1,user:{externalId:'A'},pushBoundAccount:'',pushError:''},
    sdk:async()=>o,pushState:()=>{},identityQueue:Promise.resolve()};
  vm.createContext(ctx);vm.runInContext(functions,ctx);
  await vm.runInContext('initPush("A")',ctx);
  await vm.runInContext('initPush("A")',ctx);
  ctx.state.user.externalId='B';ctx.state.pushBoundAccount='';
  await vm.runInContext('initPush("B")',ctx);
  assert.deepEqual(events,['login:A','login:B']);
});
