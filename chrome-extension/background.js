'use strict';
const APP='https://nhac-viec-kpi-tan-hiep.vercel.app/';
const SCRIPT_ID='tan-hiep-icpv-auto-watch';
const watchFiles=['icpv-reader.js','auto-watch.js'];
const goodId=id=>/^th_[a-f0-9]{44}$/.test(String(id||''));
const goodOrigin=o=>{
  try{const u=new URL(o);return u.protocol==='https:'&&u.origin===o;}catch(_){return false;}
};
async function registerWatch(origin){
  const entries=await chrome.scripting.getRegisteredContentScripts({ids:[SCRIPT_ID]});
  if(entries.length)await chrome.scripting.unregisterContentScripts({ids:[SCRIPT_ID]});
  await chrome.scripting.registerContentScripts([{id:SCRIPT_ID,matches:[origin+'/*'],js:watchFiles,runAt:'document_idle',persistAcrossSessions:true}]);
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  const type=message?.type;
  if(!['CONSUME_PENDING_ICPV','ACCOUNT_CONTEXT','STAGE_ICPV_REVIEW','ENABLE_ICPV_AUTO','GET_WATCH_ACCOUNT'].includes(type))return false;
  (async()=>{
    if(type==='GET_WATCH_ACCOUNT'){
      const {autoIcpvOrigin}=await chrome.storage.local.get('autoIcpvOrigin');
      if(!sender.tab?.url||!autoIcpvOrigin||!sender.url?.startsWith(autoIcpvOrigin+'/'))return {ok:false};
      const {watchAccount}=await chrome.storage.session.get('watchAccount');
      return {ok:true,account:watchAccount&&Date.now()-watchAccount.at<=12*3600000?watchAccount:null};
    }
    if(type==='ACCOUNT_CONTEXT'){
      // Identity is relayed only by the bridge on the exact official application origin.
      if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(APP))throw Error('Nguồn xác thực không hợp lệ.');
      if(message.id&&goodId(message.id)){
        const {pendingImport}=await chrome.storage.session.get('pendingImport');
        if(pendingImport?.accountId&&pendingImport.accountId!==message.id)await chrome.storage.session.remove('pendingImport');
        await chrome.storage.session.set({watchAccount:{id:message.id,at:Date.now()}});
      }
      else if(!message.id)await chrome.storage.session.remove('watchAccount');
      else throw Error('Tài khoản không hợp lệ.');
      // Wake already-open iCPV tabs when Google identity becomes available/changes.
      const {autoIcpvOrigin}=await chrome.storage.local.get('autoIcpvOrigin');
      if(autoIcpvOrigin){
        const tabs=await chrome.tabs.query({url:autoIcpvOrigin+'/*'});
        await Promise.all(tabs.map(t=>chrome.tabs.sendMessage(t.id,{type:'WATCH_CONTEXT_CHANGED'}).catch(()=>{})));
      }
      return {ok:true};
    }
    if(type==='CONSUME_PENDING_ICPV'){
      if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(APP))throw Error('Trang nhận dữ liệu không hợp lệ.');
      const {pendingImport}=await chrome.storage.session.get('pendingImport');
      if(!pendingImport||!Array.isArray(pendingImport.items)||Date.now()-pendingImport.createdAt>900000||Date.now()<pendingImport.createdAt)return {ok:false};
      // Bind the transfer to the same authorized Nhắc việc account that opened it.
      const {watchAccount}=await chrome.storage.session.get('watchAccount');
      if(pendingImport.accountId&&pendingImport.accountId!==watchAccount?.id)return {ok:false};
      await chrome.storage.session.remove('pendingImport');
      return {ok:true,items:pendingImport.items,source:pendingImport.source,accountId:pendingImport.accountId||''};
    }
    if(type==='STAGE_ICPV_REVIEW'){
      const {autoIcpvOrigin}=await chrome.storage.local.get('autoIcpvOrigin');
      const {watchAccount}=await chrome.storage.session.get('watchAccount');
      if(!sender.tab?.url||!autoIcpvOrigin||!sender.url?.startsWith(autoIcpvOrigin+'/')||message.origin!==autoIcpvOrigin||
        !watchAccount?.id||Date.now()-watchAccount.at>12*3600000)throw Error('Hãy đăng nhập Nhắc việc đúng tài khoản trước khi chuyển dữ liệu.');
      if(!Array.isArray(message.items)||!message.items.length||message.items.length>30||
         message.items.some(x=>!/^icpv:[a-f0-9]{64}$/.test(x?.sourceKey)||typeof x.title!=='string'||x.title.length>90||!(x.dueDate===''||/^\d{4}-\d{2}-\d{2}$/.test(x.dueDate))))throw Error('Danh sách nhiệm vụ không hợp lệ.');
      await chrome.storage.session.set({pendingImport:{items:message.items,createdAt:Date.now(),source:message.origin,accountId:watchAccount.id}});
      await chrome.tabs.create({url:APP});return {ok:true};
    }
    if(type==='ENABLE_ICPV_AUTO'){
      const {approvedOrigin}=await chrome.storage.local.get('approvedOrigin');
      if(!goodOrigin(message.origin)||approvedOrigin!==message.origin)throw Error('Hãy xác nhận đúng trang iCPV trước.');
      const allowed=await chrome.permissions.contains({origins:[message.origin+'/*']});
      if(!allowed)throw Error('Chưa cấp quyền truy cập trang iCPV.');
      await registerWatch(message.origin);
      await chrome.storage.local.set({autoIcpvOrigin:message.origin});
      return {ok:true};
    }
  })().then(reply).catch(e=>reply({ok:false,error:String(e.message||e)}));
  return true;
});
