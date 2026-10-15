 'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const release='1.9.3-hf4';
const background='linear-gradient(115deg,#cc0b19 0%,#e63211 34%,#f87518 70%,#ffca43 100%)';
test('YC-041: đúng nền đỏ–cam–vàng trên desktop và mobile',()=>{
  assert.ok(css.includes('body{background:'+background+';background-attachment:fixed;color:#17345b}'));
  assert.match(css,new RegExp('@media\\(max-width:720px\\)\\{\\s+body\\{background:linear-gradient\\(115deg'));
  assert.ok(css.includes('  body{background:'+background+';background-attachment:fixed}'));
});
test('YC-041: tất cả CSS ngoài hai thuộc tính nền phải giữ nguyên tuyệt đối',()=>{
  const reversed=css.replaceAll(';background-attachment:fixed','').replace('body{background:'+background+';color:#17345b}',
    'body{background:linear-gradient(180deg,#edf4ff 0,#f4f7ff 320px,#f2f6fe 100%);color:#17345b}')
    .replace('  body{background:'+background+'}', '  body{background:#f2f6ff}');
  assert.equal(crypto.createHash('sha256').update(reversed).digest('hex'), '9574bcce11fa719127a19c8119bd31b42120ca1ec6422f1a435410bb65931a89');
});
test('YC-041: kiểm tra cập nhật phiên bản đang bật; logo và iCPV không đổi',()=>{
  assert.ok(html.includes('/styles.css?v='+release));
  assert.ok(html.includes('/app.js?v='+release));
  assert.ok(html.includes('Phiên bản 1.9.3-HF4'));
  assert.ok(js.includes("const APP_VERSION='"+release+"'"));
  assert.ok(fs.readFileSync(path.join(root,'api/config.js'),'utf8').includes("appVersion: '"+release+"'"));
  assert.ok(html.includes('/icons/logo-tan-hiep.png?v=1.9.3-hf2'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'chrome-extension/manifest.json'),'utf8')).version,'1.1.0');
});

test('YC-041 HF4: cả hai trang dùng gradient cố định theo viewport, không tùy độ dài trang',()=>{
  assert.equal((css.match(/background-attachment:fixed/g)||[]).length,2);
  assert.ok(css.includes('body{background:'+background+';background-attachment:fixed;color:#17345b}'));
  assert.ok(css.includes('  body{background:'+background+';background-attachment:fixed}'));
  assert.match(css,/\.topbar\{min-height:86px;[^\n]*background:linear-gradient\(105deg,#0a4fb6,#1565d7 55%,#0649af\)/);
});
