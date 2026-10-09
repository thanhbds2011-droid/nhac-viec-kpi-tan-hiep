'use strict';
const APP='https://nhac-viec-kpi-tan-hiep.vercel.app/';
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type!=='CONSUME_PENDING_ICPV')return false;
  // Only the content script in the official Nhắc việc site can receive staged data.
  if(!sender.url?.startsWith(APP)||sender.id!==chrome.runtime.id){
    reply({ok:false});return false;
  }
  (async()=>{
    const stored=(await chrome.storage.session.get('pendingImport')).pendingImport;
    if(!stored||!Array.isArray(stored.items)||Date.now()-stored.createdAt>900000||Date.now()<stored.createdAt){
      await chrome.storage.session.remove('pendingImport');reply({ok:false});return;
    }
    await chrome.storage.session.remove('pendingImport');
    reply({ok:true,items:stored.items});
  })().catch(()=>reply({ok:false}));
  return true;
});
