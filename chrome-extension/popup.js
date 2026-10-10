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
  const {autoIcpvOrigin}=await chrome.storage.local.get('autoIcpvOrigin');
  $('watchStatus').textContent=autoIcpvOrigin===origin?'Đã bật tự kiểm tra cho trang này. Nhắc việc cần được đăng nhập trên trình duyệt.':'Bật một lần để được báo khi danh sách đang mở thay đổi.';
  $('watch').disabled=false;
  $('watch').textContent=autoIcpvOrigin===origin?'Kiểm tra tự động đã bật':'Bật kiểm tra tự động khi mở iCPV';
  $('watch').addEventListener('click',()=>void enableWatch(origin));
  $('approved').addEventListener('change',()=>{$('scan').disabled=!$('approved').checked;});
}
$('scan').addEventListener('click',async()=>{
  $('scan').disabled=true;$('send').disabled=true;staged=null;$('preview').replaceChildren();status('Đang đọc các cột trên trang…');
  try{
    if(!activeTab?.id)throw Error('Không có tab nguồn.');
    const origin=new URL(activeTab.url).origin;
    const result=await chrome.scripting.executeScript({target:{tabId:activeTab.id},files:['icpv-reader.js','extract.js']});
    const data=result?.[0]?.result;
    if(!data||data.error)throw Error(data?.error||'Không đọc được trang iCPV.');
    if(data.origin!==origin)throw Error('Trang đã điều hướng. Hãy mở lại tiện ích.');
    staged=data;
    await chrome.storage.local.set({approvedOrigin:origin});
    status('Đã đọc '+data.items.length+' nhiệm vụ trên trang đang mở. Kiểm tra và lựa chọn sau khi mở Nhắc việc.');
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
async function enableWatch(origin){
  if(!$('approved').checked){status('Trước tiên hãy xác nhận quyền sử dụng dữ liệu trên trang iCPV.');return;}
  try{
    // A user click requests permission for ONE pinned HTTPS origin only.
    const granted=await chrome.permissions.request({origins:[origin+'/*']});
    if(!granted)throw Error('Bạn chưa cho phép tiện ích đọc trang iCPV này.');
    await chrome.storage.local.set({approvedOrigin:origin});
    const res=await chrome.runtime.sendMessage({type:'ENABLE_ICPV_AUTO',origin});
    if(!res?.ok)throw Error(res?.error||'Không kích hoạt được.');
    $('watch').disabled=true;$('watch').textContent='Kiểm tra tự động đã bật';
    $('watchStatus').textContent='Đã bật. Hãy tải lại trang iCPV và đăng nhập Nhắc việc để bắt đầu theo dõi.';
    status('Đã bật kiểm tra tự động cho đúng trang iCPV bạn chọn.');
  }catch(err){status(String(err.message||err));}
}
init().catch(err=>status('Không mở được tiện ích: '+err.message));
