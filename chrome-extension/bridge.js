'use strict';
// Only this extension's installed bridge can request staged items from its worker.
window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||
    event.data?.kind!=='TAN_HIEP_ICPV_IMPORT_READY_V1')return;
  chrome.runtime.sendMessage({type:'CONSUME_PENDING_ICPV'},response=>{
    if(chrome.runtime.lastError||!response?.ok)return;
    window.postMessage({kind:'TAN_HIEP_ICPV_IMPORT_PAYLOAD_V1',items:response.items},location.origin);
  });
});
