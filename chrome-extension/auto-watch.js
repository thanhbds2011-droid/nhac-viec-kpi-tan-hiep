'use strict';
// Runs only on the iCPV origin explicitly authorized by the extension's user.
(()=>{
  if(globalThis.__tanHiepAutoWatchStarted)return;
  globalThis.__tanHiepAutoWatchStarted=true;
  let timer=null,lastSignature='',noticeRoot=null,account='';
  const permitted=()=>chrome.storage.local.get('autoIcpvOrigin').then(r=>r.autoIcpvOrigin===location.origin);
  function show(message,review){
    if(!noticeRoot){
      noticeRoot=document.createElement('div');noticeRoot.id='tan-hiep-icpv-auto-watch';
      noticeRoot.style.cssText='position:fixed;right:16px;bottom:20px;z-index:2147483646;max-width:330px';
      const root=noticeRoot.attachShadow({mode:'closed'});
      root.innerHTML='<style>*{box-sizing:border-box}section{font:13px/1.45 system-ui,sans-serif;color:#153451;background:white;border:1px solid #b5cdef;border-radius:13px;padding:12px;box-shadow:0 8px 30px #0003}h3{margin:0 0 5px;font-size:14px}p{margin:3px 0 10px}button{border:0;background:#1660c8;color:white;cursor:pointer;padding:7px 10px;border-radius:7px;font:inherit}button:last-child{background:#e9effa;color:#26486a;margin-left:6px}</style><section role="status"><h3>Nhắc việc KPI – Tân Hiệp</h3><p id="note"></p><div id="controls"><button id="review">Xem thay đổi</button><button id="close">Đóng</button></div></section>';
      noticeRoot._ui={note:root.getElementById('note'),controls:root.getElementById('controls'),review:root.getElementById('review')};
      root.getElementById('close').addEventListener('click',()=>{noticeRoot.remove();noticeRoot=null;});
      root.getElementById('review').addEventListener('click',async()=>{
        // Separate, explicit consent BEFORE the raw iCPV titles leave this tab.
        if(!window.confirm('Bạn xác nhận được phép chuyển tên và thời hạn công việc đang hiển thị từ iCPV sang Nhắc việc KPI để rà soát?'))return;
        try{
          const data=await globalThis.TanHiepIcpvReader.scan();
          if(data.error)throw new Error(data.error);
          const response=await chrome.runtime.sendMessage({type:'STAGE_ICPV_REVIEW',items:data.items,origin:location.origin});
          if(!response?.ok)throw new Error(response?.error||'Chưa thể mở Nhắc việc. Vui lòng đăng nhập ứng dụng rồi thử lại.');
          if(noticeRoot){noticeRoot.remove();noticeRoot=null;}
        }catch(err){show(String(err?.message||err),false);}
      });
      document.documentElement.appendChild(noticeRoot);
    }
    noticeRoot._ui.note.textContent=message;
    noticeRoot._ui.controls.style.display=review?'block':'none';
  }
  async function inspect(){
    if(document.hidden||!await permitted())return;
    const response=await chrome.runtime.sendMessage({type:'GET_WATCH_ACCOUNT'});
    const watchAccount=response?.account;
    if(!watchAccount?.id){account='';lastSignature='';if(noticeRoot){noticeRoot.remove();noticeRoot=null;}return;}
    if(account!==watchAccount.id){account=watchAccount.id;lastSignature='';}
    const result=await globalThis.TanHiepIcpvReader.scan();
    if(result.error)return;
    const path=location.pathname+location.search+location.hash;
    const scope=`${account}|${location.origin}|${path}`;
    const signature=scope+'|'+result.digest;
    if(signature===lastSignature)return;
    lastSignature=signature;
    const stored=await chrome.storage.local.get('icpvDigests');
    const snapshots=stored.icpvDigests||{};
    const prev=snapshots[scope];
    if(!prev){
      show('Lần đầu kiểm tra trang này. Bạn có thể xem danh sách và xác nhận những nhiệm vụ cần theo dõi.',true);
    }else if(prev.digest!==result.digest){
      show('Danh sách công việc có thay đổi. Vui lòng rà soát và cập nhật nếu cần. Chỉ kiểm tra trang đang hiển thị.',true);
    }
    snapshots[scope]={digest:result.digest,at:Date.now()};
    // Keep the reference hashes small; never store original task contents here.
    const sorted=Object.entries(snapshots).sort((a,b)=>b[1].at-a[1].at).slice(0,80);
    await chrome.storage.local.set({icpvDigests:Object.fromEntries(sorted)});
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>void inspect().catch(()=>{}),1300);}
  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  document.addEventListener('visibilitychange',schedule);
  window.addEventListener('hashchange',schedule);window.addEventListener('popstate',schedule);
  chrome.runtime.onMessage.addListener(message=>{if(message?.type==='WATCH_CONTEXT_CHANGED')schedule();});
  schedule();
  // A quiet fallback when the host page continuously redraws before the debounce finishes.
  setInterval(()=>{if(!document.hidden)void inspect().catch(()=>{});},15000);
})();
