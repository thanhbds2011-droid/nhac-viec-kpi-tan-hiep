'use strict';
const $=id=>document.getElementById(id);
const APP='https://nhac-viec-kpi-tan-hiep.vercel.app/';
let activeTab=null,staged=null;
function status(message){$('result').textContent=message;}
async function init(){
  const tabs=await chrome.tabs.query({active:true,currentWindow:true});activeTab=tabs[0];
  if(!activeTab?.url||!activeTab.url.startsWith('https://')){
    $('site').textContent='Hãy chuyển đến tab iCPV HTTPS rồi mở tiện ích.';return;
  }
  const origin=new URL(activeTab.url).origin;
  $('site').textContent='Trang đang mở: '+origin;
  const saved=(await chrome.storage.local.get('approvedOrigin')).approvedOrigin;
  if(saved&&saved!==origin){status('Bạn đã ghim nguồn iCPV khác: '+saved+'. Nếu địa chỉ mới là chính thức, quản trị viên có thể xóa/cài lại tiện ích để thiết lập lại.');return;}
  $('approved').addEventListener('change',()=>{$('scan').disabled=!$('approved').checked;});
}
$('scan').addEventListener('click',async()=>{
  $('scan').disabled=true;$('send').disabled=true;staged=null;$('preview').replaceChildren();status('Đang đọc các cột trên trang…');
  try{
    if(!activeTab?.id)throw Error('Không có tab nguồn.');
    const origin=new URL(activeTab.url).origin;
    const result=await chrome.scripting.executeScript({target:{tabId:activeTab.id},files:['extract.js']});
    const data=result?.[0]?.result;
    if(!data||data.error)throw Error(data?.error||'Không đọc được trang iCPV.');
    if(data.origin!==origin)throw Error('Trang đã điều hướng. Hãy mở lại tiện ích.');
    staged=data;
    await chrome.storage.local.set({approvedOrigin:origin});
    status('Đã nhận '+data.items.length+' nhiệm vụ. '+(data.skippedNames.length?`${data.skippedNames.length} tên trùng đã bỏ qua.`:''));
    const container=$('preview');
    for(const t of data.items){
      const el=document.createElement('div');el.textContent=t.title;
      const sub=document.createElement('small');sub.textContent='Hạn: '+t.dueDate.split('-').reverse().join('/');el.append(sub);container.append(el);
    }
    $('send').disabled=false;
  }catch(err){status(String(err?.message||err));}
  finally{$('scan').disabled=!$('approved').checked;}
});
$('send').addEventListener('click',async()=>{
  if(!staged)return;
  $('send').disabled=true;
  try{
    await chrome.storage.session.set({pendingImport:{items:staged.items,createdAt:Date.now(),source:staged.origin}});
    await chrome.tabs.create({url:APP});
    window.close();
  }catch(err){status('Không mở được Nhắc việc: '+err.message);$('send').disabled=false;}
});
init().catch(err=>status('Không mở được tiện ích: '+err.message));
