'use strict';
// This bridge only operates on the official application, not on iCPV.
window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin)return;
  if(event.data?.kind==='TAN_HIEP_ICPV_ACCOUNT_CONTEXT_V1'){
    chrome.runtime.sendMessage({type:'ACCOUNT_CONTEXT',id:event.data.id||''},()=>{
      if(!chrome.runtime.lastError&&event.data.id)window.postMessage({kind:'TAN_HIEP_ICPV_IMPORT_READY_V1'},location.origin);
    });
  }
  if(event.data?.kind!=='TAN_HIEP_ICPV_IMPORT_READY_V1')return;
  chrome.runtime.sendMessage({type:'CONSUME_PENDING_ICPV'},response=>{
    if(chrome.runtime.lastError||!response?.ok)return;
    window.postMessage({kind:'TAN_HIEP_ICPV_IMPORT_PAYLOAD_V1',items:response.items,accountId:response.accountId||''},location.origin);
  });
});
