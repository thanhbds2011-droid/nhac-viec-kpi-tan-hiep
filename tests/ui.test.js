'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const css = fs.readFileSync(path.join(__dirname,'../public/styles.css'),'utf8');
const js = fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);

test('một tiêu đề ứng dụng chính, không trùng trong form/danh sách', ()=>{
  assert.equal((html.match(/NHẮC VIỆC KPI/g)||[]).length,1);
  assert.match(html, /<h2 id="formHeading">Thêm công việc<\/h2>/);
  assert.match(html, /<h2>Công việc của tôi<\/h2>/);
});
test('mọi id truy cập qua $() có trong HTML và không trùng nhau',()=>{
  assert.equal(new Set(ids).size,ids.length,'Có id HTML bị lặp');
  const refs=[...js.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
  const missing=refs.filter(id=>!ids.includes(id));
  assert.deepEqual(missing,[]);
});
test('giữ các API và định danh OneSignal ban đầu',()=>{
  for(const expected of ["api('load')","optimisticMutation('save'","optimisticMutation('remove'","optimisticMutation('setDefaultTime'","api('sync')",'await o.login(externalId)','await o.logout()'])
    assert.ok(js.includes(expected),'Thiếu '+expected);
});
test('bố cục responsive và hai nút mobile có id riêng',()=>{
  assert.match(css,/@media\(max-width:720px\)/);
  assert.match(css,/@media\(max-width:420px\)/);
  for(const id of ['tabCreate','tabList','createPane','listPane','datePreview','enablePush','defaultTime'])
    assert.ok(ids.includes(id));
});
test('chuyển 5 chế độ giao diện mobile không gọi API',()=>{
  const defs=js.slice(js.indexOf('const PANE_IDS='),js.indexOf('function pad2('));
  const snippet=js.slice(js.indexOf('function showPane('),js.indexOf('function preview()'));
  const classes=()=>{const set=new Set();return{toggle(key,yes){if(yes)set.add(key);else set.delete(key);},has(key){return set.has(key);}}};
  const elements=Object.fromEntries(['appView','createPane','listPane','schedulePane','notificationsPane','profilePane',
    'tabCreate','tabList','tabSchedule','tabNotifications','tabProfile','adminPane'].map(id=>[id,{dataset:{},classList:classes(),setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];}}]));
  const ctx={$:id=>elements[id],window:{matchMedia:()=>({matches:false}),scrollTo(){}},api(){throw Error('Không được phép gọi API');}};
  vm.createContext(ctx);vm.runInContext(defs+snippet,ctx);
  for(const name of ['list','create','schedule','notifications','profile']){
    vm.runInContext(`showPane('${name}')`,ctx);
    assert.equal(elements[name==='create'?'createPane':(name==='list'?'listPane':name==='schedule'?'schedulePane':name==='notifications'?'notificationsPane':'profilePane')].classList.has('is-mobile-active'),true);
  }
});
test('PWA standalone, iOS apple icon, đủ icon chuẩn Android',()=>{
  const m=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/manifest.webmanifest'),'utf8'));
  assert.equal(m.display,'standalone');assert.equal(m.id,'/');
  assert.match(html,/apple-mobile-web-app-capable/);
  assert.match(html,/apple-touch-icon/);
  for(const [file,dim] of [['icon-192.png',192],['icon-512.png',512],['icon-maskable-512.png',512],['apple-touch-icon.png',180]]){
    const buffer=fs.readFileSync(path.join(__dirname,'../public/icons/',file));
    assert.equal(buffer.readUInt32BE(16),dim);assert.equal(buffer.readUInt32BE(20),dim);
  }
});
test('có Sửa/Xóa, xác nhận xóa và 4 tab đã duyệt',()=>{
  for(const id of ['taskMenu','menuEdit','menuDelete','confirmDialog','tabList','tabSchedule','tabNotifications','tabProfile'])
    assert.ok(ids.includes(id),'Thiếu '+id);
  assert.ok(js.includes('showModal()'));
});
test('hiển thị đủ 4 ngày dương lịch trước hạn và đúng hạn',()=>{
  const helpers=js.slice(js.indexOf('function pad2('),js.indexOf('function nowVNDate()'));
  const snippet=js.slice(js.indexOf('function preview()'),js.indexOf('function makeButton('));
  const children=[];
  const box={replaceChildren(){children.length=0;},classList:{toggle(){}},appendChild(el){children.push(el);}};
  const fields={dueDate:{value:'2026-12-15'},taskTime:{value:'07:30'},datePreview:box};
  const ctx={ $:id=>fields[id],document:{createElement(tag){return{tag,className:'',classList:{add(){}},append(...v){this.children=v},textContent:'',title:''}}} };
  vm.createContext(ctx);vm.runInContext(helpers+snippet+'\npreview();',ctx);
  assert.equal(children.length,4);
  assert.deepEqual(children.map(x=>x.children[1].textContent),['12/12','13/12','14/12','15/12']);
});
