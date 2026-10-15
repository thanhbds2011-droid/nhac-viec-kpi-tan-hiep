'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const photo=fs.readFileSync(path.join(root,'public/images/landmark-81-hcm.jpg'));
test('YC-042: giữ nguyên ảnh Landmark 81 do người dùng cung cấp',()=>{
  assert.equal(crypto.createHash('sha256').update(photo).digest('hex'), '9fac3566b542457ed50f35e5ff7b555a093cea4b5205fbdd3a217cce67246627');
  assert.ok(css.includes("url('/images/landmark-81-hcm.jpg')"));
  assert.ok(css.includes('background-size:cover,158% auto'));
  assert.ok(css.includes('background-size:cover,auto 100%'));
});
test('YC-042: thay đổi chỉ là CSS, ảnh, đánh phiên bản; giữ cấu trúc và Chrome',()=>{
  assert.ok(html.includes('/icons/logo-tan-hiep.png?v=1.9.3-hf2'));
  assert.ok(html.includes('id="createPane"'));
  assert.ok(html.includes('id="listPane"'));
  assert.ok(html.includes('id="profilePane"'));
  assert.ok(js.includes("const APP_VERSION='1.9.3-hf5'"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'chrome-extension/manifest.json'))).version,'1.1.0');
});
