'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'../',f),'utf8');
const html=read('public/index.html'),css=read('public/styles.css'),js=read('public/app.js');
test('v1.9: điều hướng header và shortcut đều có đích đã tồn tại',()=>{
  for(const id of ['headerNoticeBtn','headerProfileBtn','headerUserAvatar','headerUserName','headerNoticeDot','adminQuickPanel','adminQuickOpen','soonCount','pastCount'])
    assert.match(html,new RegExp(`id="${id}"`));
  assert.match(js,/\$\('headerNoticeBtn'\)\.addEventListener/);
  assert.match(js,/\$\('adminQuickOpen'\)\.addEventListener/);
  assert.match(js,/if\(state\.isAdmin\)showPane\('admin'/);
});
test('v1.9: 4 tab mobile, safe-area, layout desktop và mobile',()=>{
  for(const id of ['tabList','tabSchedule','tabNotifications','tabProfile','tabCreate','createPane','listPane','notificationsPane','adminPane'])
    assert.match(html,new RegExp(`id="${id}"`));
  assert.match(css,/v1\.9\.0 – VISUAL BASELINE/);
  assert.match(css,/@media\(min-width:721px\)/);
  assert.match(css,/@media\(max-width:720px\)/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/\.overview \.desktop-tools\{display:none!important\}/);
});
test('v1.9: không tạo quyền quản trị giả hoặc số thống kê cứng',()=>{
  assert.match(js,/\$\('adminQuickPanel'\)\.classList\.toggle\('hide',!state\.isAdmin\)/);
  assert.match(js,/const r=await api\('adminStats'\)/);
  assert.match(html,/id="adminAccounts"/);
  assert.match(html,/id="adminTasks"/);
  assert.doesNotMatch(html,/id="adminAccounts">8</);
  assert.doesNotMatch(html,/id="adminTasks">76</);
});
test('v1.9: xác nhận hoàn thành, iCPV, OneSignal và lịch nhắc vẫn đi qua các hàm cũ',()=>{
  for(const fragment of [
    "optimisticMutation('remove'", "optimisticMutation('save'", "api('reviewIcpv'",
    "await o.login(externalId)", "await o.logout()", "function preview()", "function renderInbox()", "function taskStatus(t)"
  ])assert.ok(js.includes(fragment),`Thiếu hàm nghiệp vụ ${fragment}`);
  assert.match(html,/value="discard"/);
  assert.match(html,/value="confirm"[^>]*>Đã hoàn thành, xóa/);
  assert.match(html,/id="enablePush"/);
});
