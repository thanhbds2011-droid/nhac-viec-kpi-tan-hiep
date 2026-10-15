'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f));
const html=read('public/index.html').toString();
const css=read('public/styles.css').toString();
const mf=JSON.parse(read('public/manifest.webmanifest').toString());
const version='1.9.3-hf2';
const pngDimension=buffer=>[buffer.readUInt32BE(16),buffer.readUInt32BE(20)];
test('YC-040: logo trên header và trang đăng nhập; giữ chuông thông báo chức năng',()=>{
  assert.match(html, /class="brand-icon logo-brand"[^>]*><img class="brand-logo"/);
  assert.match(html, /class="login-symbol logo-login"[^>]*><img class="login-logo"/);
  assert.match(html, /id="headerNoticeBtn"[^>]*>.*?🔔/);
  assert.match(css, /\.brand-icon\.logo-brand/);
  assert.match(css, /\.login-symbol\.logo-login/);
  const img=read('public/icons/logo-tan-hiep.png');
  assert.equal(img.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
});
test('YC-040: favicon/PWA icon đều là logo mới và đúng kích thước',()=>{
  const svg=read('public/favicon.svg').toString();
  assert.match(svg,/data:image\/png;base64,/);
  assert.match(html,/favicon\.svg\?v=1\.9\.3-hf2/);
  for(const [file,expected] of [['icon-192.png',192],['icon-512.png',512],['icon-maskable-512.png',512],['apple-touch-icon.png',180]]){
    assert.deepEqual(pngDimension(read('public/icons/'+file)),[expected,expected]);
  }
  assert.ok(mf.icons.every(x=>x.src.includes('?v='+version)));
  assert.match(html,/manifest\.webmanifest\?v=1\.9\.3-hf2/);
  assert.match(html,/apple-touch-icon\.png\?v=1\.9\.3-hf2/);
});
test('YC-040: giữ tự kiểm tra bản web mới; không thay mã quản lý công việc và Chrome Extension',()=>{
  assert.match(read('api/config.js').toString(),/appVersion: '1\.9\.3-hf4'/);
  assert.match(read('public/app.js').toString(),/const APP_VERSION='1\.9\.3-hf4'/);
  assert.match(read('chrome-extension/manifest.json').toString(),/"version": "1\.1\.0"/);
});
