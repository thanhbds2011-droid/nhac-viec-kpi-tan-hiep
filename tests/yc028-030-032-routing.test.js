'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const code=fs.readFileSync(__dirname+'/../apps-script/Code.gs','utf8');

class Sheet{
  constructor(rows=[]){this.rows=rows.map(row=>[...row]);}
  getLastRow(){return this.rows.length;}
  getRange(row,col,h=1,w=1){const self=this;return {
    getValue(){return self.rows[row-1]?.[col-1]??'';},
    getDisplayValue(){return String(self.rows[row-1]?.[col-1]??'');},
    getValues(){return Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>self.rows[row+i-1]?.[col+j-1]??''));},
    getDisplayValues(){return this.getValues().map(r=>r.map(String));},
    setValues(input){input.forEach((r,i)=>{const j=row+i-1;self.rows[j]??=[];r.forEach((v,k)=>self.rows[j][col+k-1]=v);});return this;},
    setValue(value){self.rows[row-1]??=[];self.rows[row-1][col-1]=value;return this;}
  };}
}
function setup(){
  const accounts=[
    ['a@example.com','Ông A','Hoạt động','Phó Trưởng phòng/Khu','TCHC','','Không'],
    ['b@example.com','Trưởng A','Hoạt động','Trưởng phòng/Khu','TCHC','','Không'],
    ['d@example.com','Giám đốc phụ trách','Hoạt động','Ban Giám đốc','','','Không'],
    ['e@example.com','Nhân viên B','Hoạt động','Nhân viên','KHTC','','Không'],
  ];
  const assignments=[
    ['a@example.com','TCHC','Phó Trưởng phòng/Khu'],
    ['a@example.com','KHTC','Quyền Trưởng phòng/Khu'],
    ['b@example.com','TCHC','Trưởng phòng/Khu'],
    ['d@example.com','TCHC','Ban Giám đốc'],
    ['d@example.com','KHTC','Ban Giám đốc'],
    ['e@example.com','KHTC','Nhân viên'],
  ];
  const ss=new Map([
    ['Tài khoản',new Sheet([['Email','Họ tên','Trạng thái','Vai trò','Mã','Đối chiếu','Quản trị'],...accounts])],
    ['Quản lý Phòng-Khu',new Sheet([
      ['Mã','Tên','Trưởng','Phó 1','Phó 2','Quyền Trưởng','Ban Giám đốc'],
      ['TCHC','Phòng A','b@example.com','','','','d@example.com'],
      ['KHTC','Phòng B','','','','a@example.com','d@example.com']
    ])],
    ['Phân công KPI',new Sheet([['Email','Mã','Vai trò'],...assignments])],
    ['Access',new Sheet([['Email','Họ tên','Active','Role','Manager']])],
    ['State',new Sheet([['Sub','Email','State','Updated']])]
  ]);
  const props=new Map([['ACCOUNT_SCHEMA','VI'],['KPI_ROUTING_SCHEMA','V2']]);
  const book={getSheetByName:k=>ss.get(k)||null};
  const c=vm.createContext({Date,JSON,Object,Number,console});
  vm.runInContext(code,c);
  c.book_=()=>book;
  c.PropertiesService={getScriptProperties:()=>({getProperty:k=>props.get(k)||'',setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})};
  c.Utilities={getUuid:()=>crypto.randomUUID(),formatDate:(_date,_tz,fmt)=>fmt==='yyyy-MM-dd'?'2026-10-13':'2026-10-13',getCurrentTime:()=>Date.now()};
  c.withLock_=fn=>fn();
  c.readState_=(_ss,actor,create)=>{
    const st=ss.get('State');let at=st.rows.findIndex((r,i)=>i>0&&r[0]===actor.subject);
    if(at<0){if(!create)return null;st.rows.push([actor.subject,actor.email,JSON.stringify(c.newState_()),new Date()]);at=st.rows.length-1;}
    return {row:at+1,profile:c.normalizeState_(JSON.parse(st.rows[at][2]))};
  };
  c.saveState_=(sheet,row,profile,email)=>{sheet.rows[row-1][1]=email;sheet.rows[row-1][2]=JSON.stringify(profile);};
  const actor=email=>({email,name:email,externalId:'th_'+'a'.repeat(44),subject:'subject-'+email});
  const run=(email,action,data={})=>c.runAction_({actor:actor(email),action,data});
  const state=email=>{
    const row=ss.get('State').rows.find(r=>r[1]===email);return row?JSON.parse(row[2]):null;
  };
  function add(email,workType,assignmentKey,title='Việc thử nghiệm'){
    const result=run(email,'save',{title,dueDate:'2027-01-15',time:'07:30',workType,assignmentKey});
    return result.view.tasks.find(t=>t.title===title).id;
  }
  const completion=(email,id)=>run(email,'remove',{id,mode:'completed'});
  return {c,ss,props,actor,run,state,add,completion};
}

test('YC-028: xác thực phân công Phó A, Quyền B và Ban Giám đốc; khóa phân công sai',()=>{
  const h=setup();
  assert.equal(h.c.validateKpiRoutingSheets().ok,true);
  const a=h.run('a@example.com','load').view.assignments;
  assert.equal(a.length,2);
  assert.equal(a.some(x=>x.key==='TCHC::VICE'),true);
  assert.equal(a.some(x=>x.key==='KHTC::ACTING'),true);
  assert.throws(()=>h.add('a@example.com','kpi','NOT_ALLOWED'),/Phòng\/Khu/);
  h.ss.get('Quản lý Phòng-Khu').rows[2][2]='b@example.com';
  assert.equal(h.c.validateKpiRoutingSheets().ok,false,'Không thể đồng thời có Trưởng và Quyền Trưởng');
});

test('YC-028: một email kiêm nhiệm; việc KPI Phó A gửi Trưởng A, Quyền B gửi Ban Giám đốc',()=>{
  const h=setup();
  h.run('b@example.com','load');h.run('d@example.com','load');
  const a=h.add('a@example.com','kpi','TCHC::VICE','KPI Phòng A');
  const b=h.add('a@example.com','kpi','KHTC::ACTING','KPI Phòng B');
  h.completion('a@example.com',a);
  assert.equal(h.state('b@example.com').inbox.length,1);
  assert.equal(h.state('b@example.com').inbox[0].title,'KPI Phòng A');
  assert.equal(h.state('d@example.com').inbox.length,0);
  h.completion('a@example.com',b);
  assert.equal(h.state('b@example.com').inbox.length,1);
  assert.equal(h.state('d@example.com').inbox.length,1);
  assert.equal(h.state('d@example.com').inbox[0].unitName,'Phòng B');
});

test('YC-028: nhân viên Phòng B hoàn thành => Quyền Trưởng phòng B nhận',()=>{
  const h=setup();h.run('a@example.com','load');
  const id=h.add('e@example.com','kpi','KHTC::EMPLOYEE');
  h.completion('e@example.com',id);
  assert.equal(h.state('a@example.com').inbox.length,1);
  assert.equal(h.state('a@example.com').inbox[0].unit,'KHTC');
});

test('YC-030 phương án C: cá nhân không gửi ai, KPI thủ công có gửi, xóa nhập nhầm không gửi',()=>{
  const h=setup();h.run('b@example.com','load');
  const personal=h.add('a@example.com','personal','','Việc cá nhân');
  h.completion('a@example.com',personal);
  assert.equal(h.state('b@example.com').inbox.length,0);
  assert.equal(h.state('a@example.com').completionOutbox.length,0);
  const kpi=h.add('a@example.com','kpi','TCHC::VICE','KPI thủ công');
  h.completion('a@example.com',kpi);
  assert.equal(h.state('b@example.com').inbox.length,1);
  const unused=h.add('a@example.com','kpi','TCHC::VICE','Nhập nhầm');
  h.run('a@example.com','remove',{id:unused,mode:'discard'});
  assert.equal(h.state('b@example.com').inbox.length,1);
});

test('YC-028/032: chưa có State người quản lý thì lưu chờ, lần đầu họ đăng nhập nhận được',()=>{
  const h=setup();
  const id=h.add('a@example.com','kpi','KHTC::ACTING');
  const out=h.completion('a@example.com',id);
  assert.match(out.view.notice,/Đã ghi nhận/);
  assert.equal(h.state('a@example.com').completionOutbox.length,1);
  h.run('d@example.com','load');
  assert.equal(h.state('a@example.com').completionOutbox.length,0);
  assert.equal(h.state('d@example.com').inbox.length,1);
});

test('YC-028: không có lãnh đạo hợp lệ, lưu sự kiện KPI nhưng không gửi nhầm',()=>{
  const h=setup();h.run('b@example.com','load');
  h.ss.get('Quản lý Phòng-Khu').rows[1][6]='invalid@example.com';
  const id=h.add('b@example.com','kpi','TCHC::MANAGER');
  const done=h.completion('b@example.com',id);
  assert.match(done.view.notice,/chưa xác định/);
  assert.equal(h.state('b@example.com').completionOutbox.length,1);
});

test('YC-030: legacy không có workType giữ luồng V1.8; client mới chọn cá nhân',()=>{
  const h=setup();
  // In V2, legacy task keeps legacy routing without automatic migration.
  const old=h.run('a@example.com','save',{title:'Việc cũ',dueDate:'2027-01-15',time:'07:30'}).view.tasks[0];
  assert.equal(old.workType,'legacy');
  const personal=h.add('a@example.com','personal','','Việc mới');
  assert.equal(h.state('a@example.com').tasks.find(t=>t.id===personal).workType,'personal');
});

test('YC-032: OneSignal đồng thời nhiều người, mỗi request mang External ID và idempotency riêng',()=>{
  const h=setup(),c=h.c,batches=[];
  c.prop_=k=>({ONESIGNAL_APP_ID:'demo',ONESIGNAL_REST_API_KEY:'secret',WEB_URL:'https://example.com'}[k]||'');
  c.UrlFetchApp={fetchAll(req){batches.push(req);return req.map((x,i)=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({id:'push-'+i})}));}};
  const now=Date.now()+3600e3;
  const job=(key,ext)=>({kind:'create',key,slot:{key,at:now,offset:0,leaseUntil:17},task:{title:key,dueDate:'2027-01-15'},externalId:ext});
  const results=c.performJobs_([job('A','external-A'),job('B','external-B'),job('C','external-C')]);
  assert.equal(batches.length,1);
  assert.equal(batches[0].length,3);
  assert.deepEqual(batches[0].map(x=>JSON.parse(x.payload).include_aliases.external_id[0]),['external-A','external-B','external-C']);
  assert.equal(results.length,3);
  assert.equal(results.every(x=>!x.error),true);
  assert.equal(new Set(batches[0].map(x=>JSON.parse(x.payload).idempotency_key)).size,3);
});

test('YC-032: một request OneSignal lỗi không làm mất kết quả của các request còn lại',()=>{
  const h=setup(),c=h.c;
  c.prop_=k=>({ONESIGNAL_APP_ID:'demo',ONESIGNAL_REST_API_KEY:'secret',WEB_URL:'https://example.com'}[k]||'');
  c.UrlFetchApp={fetchAll(requests){return requests.map((_,i)=>({getResponseCode:()=>i===0?503:200,getContentText:()=>i===0?'timeout':JSON.stringify({id:'ok-'+i})}));}};
  const now=Date.now()+3600e3;
  const jobs=['A','B','C'].map(key=>({kind:'create',key,slot:{key,at:now,offset:0,leaseUntil:17},task:{title:key,dueDate:'2027-01-15'},externalId:key}));
  const output=c.performJobs_(jobs);
  assert.match(output[0].error,/503/);
  assert.equal(output[1].id,'ok-1');assert.equal(output[2].id,'ok-2');
});

test('YC-032: giả lập 140 tài khoản với lịch cùng phút; 140 định danh đích không bị gộp',()=>{
  const h=setup(),c=h.c,requests=[];
  c.prop_=k=>({ONESIGNAL_APP_ID:'demo',ONESIGNAL_REST_API_KEY:'secret',WEB_URL:'https://example.com'}[k]||'');
  c.UrlFetchApp={fetchAll(batch){requests.push(...batch);return batch.map((_,i)=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({id:'accepted-'+i})}));}};
  const moment=Date.now()+3600000;
  for(let start=0;start<140;start+=4){
    const jobs=Array.from({length:4},(_,i)=>{
      const user=start+i;
      return {kind:'create',key:'reminder-'+user,
        slot:{key:'reminder-'+user,at:moment,offset:0,leaseUntil:17},
        task:{title:'Công việc '+user,dueDate:'2027-01-15'},externalId:'external-'+user};
    });
    const output=c.performJobs_(jobs);
    assert.equal(output.length,4);
    assert.equal(output.every(x=>!x.error),true);
  }
  assert.equal(requests.length,140);
  assert.equal(new Set(requests.map(x=>JSON.parse(x.payload).include_aliases.external_id[0])).size,140);
  assert.equal(new Set(requests.map(x=>JSON.parse(x.payload).idempotency_key)).size,140);
});

test('YC-028: sau rollback V2, nhiệm vụ có mã phân công không bị gửi theo người quản lý cũ',()=>{
  const h=setup();h.run('b@example.com','load');
  const id=h.add('a@example.com','kpi','TCHC::VICE');
  h.props.delete('KPI_ROUTING_SCHEMA');
  h.completion('a@example.com',id);
  assert.equal(h.state('b@example.com').inbox.length,0);
  assert.equal(h.state('a@example.com').completionOutbox.length,1);
});

test('YC-030: sau kích hoạt V2, công việc chưa phân loại phải chọn trước khi hoàn thành, dữ liệu không mất',()=>{
  const h=setup();
  const old=h.run('a@example.com','save',{title:'Nhiệm vụ trước nâng cấp',dueDate:'2027-01-15',time:'07:30'}).view.tasks[0];
  assert.throws(()=>h.completion('a@example.com',old.id),/chưa phân loại/);
  assert.equal(h.state('a@example.com').tasks.find(t=>t.id===old.id).deleted,false);
  h.run('a@example.com','save',{id:old.id,title:old.title,dueDate:old.dueDate,time:old.time,workType:'personal'});
  const done=h.completion('a@example.com',old.id);
  assert.match(done.view.notice,/cá nhân/);
});

test('YC-032: trigger khôi phục sự kiện hoàn thành đang chờ, không cần lãnh đạo mở ứng dụng lại',()=>{
  const h=setup();
  const id=h.add('a@example.com','kpi','KHTC::ACTING');
  h.completion('a@example.com',id);
  assert.equal(h.state('a@example.com').completionOutbox.length,1);
  // Đã có State nhận Push, nhưng yêu cầu ban đầu đến khi người quản lý chưa đăng nhập.
  h.c.readState_(h.c.book_(),h.actor('d@example.com'),true);
  const notified=[];h.c.syncManagerByEmail_=email=>notified.push(email);
  const rows=h.ss.get('State').getRange(2,1,h.ss.get('State').getLastRow()-1,4).getValues();
  h.c.recoverPendingCompletions_(h.c.book_(),rows,0,8);
  assert.equal(h.state('a@example.com').completionOutbox.length,0);
  assert.equal(h.state('d@example.com').inbox.length,1);
  assert.deepEqual(notified,['d@example.com']);
});

test('YC-028/030: nhập từ iCPV mặc định KPI, người kiêm nhiệm phải chọn Phòng/Khu khi nhập',()=>{
  const h=setup();h.run('d@example.com','load');
  const item={kind:'add',sourceKey:'icpv:'+'b'.repeat(64),title:'Nhiệm vụ iCPV Phòng B',dueDate:'2027-01-15'};
  assert.throws(()=>h.run('a@example.com','reviewIcpv',{decisions:[item]}),/chọn Phòng\/Khu/);
  const result=h.run('a@example.com','reviewIcpv',{decisions:[{...item,assignmentKey:'KHTC::ACTING'}]});
  assert.equal(result.view.tasks.length,1);
  assert.equal(result.view.tasks[0].workType,'kpi');
  h.completion('a@example.com',result.view.tasks[0].id);
  assert.equal(h.state('d@example.com').inbox.length,1);
});

test('YC-028 hotfix: nhóm BGD được bỏ qua khi kiểm tra đầu mối Phòng/Khu, giữ dữ liệu cũ C/D/E',()=>{
  const h=setup();
  const accounts=h.ss.get('Tài khoản').rows;
  accounts.push(['f@example.com','Phó Giám đốc','Hoạt động','Ban Giám đốc','BGD','','Không']);
  const director=accounts.find(r=>r[0]==='d@example.com'); director[4]='BGD';
  h.ss.get('Quản lý Phòng-Khu').rows.push(['BGD','Ban Giám đốc','d@example.com','f@example.com','','','']);
  h.ss.get('Phân công KPI').rows.push(['d@example.com','BGD','Ban Giám đốc']);
  h.ss.get('Phân công KPI').rows.push(['f@example.com','BGD','Ban Giám đốc']);
  assert.equal(h.c.validateKpiRoutingSheets().ok,true);
  assert.equal(h.c.validateVietnameseAdminSheets().ok,true);
  assert.equal(h.c.routingRecipient_(h.c.book_(),'d@example.com','BGD::DIRECTOR',h.c.assignmentCatalog_(h.c.book_()),h.c.activeEmailMap_(h.c.book_())),null);
});

test('YC-028 hotfix: cột G đổi người phụ trách phải đi theo phân công hợp lệ, không cố định email trong code',()=>{
  const h=setup();
  h.ss.get('Tài khoản').rows.push(['f@example.com','Phó Giám đốc mới','Hoạt động','Ban Giám đốc','BGD','','Không']);
  h.ss.get('Phân công KPI').rows.push(['f@example.com','TCHC','Ban Giám đốc']);
  h.ss.get('Quản lý Phòng-Khu').rows[1][6]='f@example.com';
  assert.equal(h.c.validateKpiRoutingSheets().ok,true);
  h.run('d@example.com','load');h.run('f@example.com','load');
  const id=h.add('b@example.com','kpi','TCHC::MANAGER','KPI sau khi đổi BGĐ');
  h.completion('b@example.com',id);
  assert.equal(h.state('f@example.com').inbox.length,1);
  assert.equal(h.state('d@example.com').inbox.length,0);
});

test('YC-028 hotfix: cột G sai chức vụ hoặc thiếu phân công đều bị chặn',()=>{
  const h=setup();
  h.ss.get('Quản lý Phòng-Khu').rows[1][6]='a@example.com';
  const v=h.c.validateKpiRoutingSheets();
  assert.equal(v.ok,false);
  assert.equal(v.errors.some(e=>e.includes('cột G phải là email Ban Giám đốc')),true);
  h.ss.get('Quản lý Phòng-Khu').rows[1][6]='d@example.com';
  h.ss.get('Phân công KPI').rows=h.ss.get('Phân công KPI').rows.filter(r=>!(r[0]==='d@example.com'&&r[1]==='TCHC'));
  const w=h.c.validateKpiRoutingSheets();
  assert.equal(w.ok,false);
  assert.equal(w.errors.some(e=>e.includes('chưa có phân công tương ứng')),true);
});

test('YC-028 hotfix: khai Ban Giám đốc trong Phân công KPI khi Tài khoản chưa là Ban Giám đốc bị phát hiện',()=>{
  const h=setup();
  h.ss.get('Tài khoản').rows.find(r=>r[0]==='d@example.com')[3]='Phó Trưởng phòng/Khu';
  const result=h.c.validateKpiRoutingSheets();
  assert.equal(result.ok,false);
  assert.equal(result.errors.some(e=>e.includes('chưa được khai báo ở tab Tài khoản')),true);
});

test('YC-028 hotfix: chức vụ khác Ban Giám đốc không được phân công tại nhóm BGD',()=>{
  const h=setup();
  h.ss.get('Quản lý Phòng-Khu').rows.push(['BGD','Ban Giám đốc','d@example.com','','','','']);
  h.ss.get('Phân công KPI').rows.push(['a@example.com','BGD','Nhân viên']);
  const result=h.c.validateKpiRoutingSheets();
  assert.equal(result.ok,false);
  assert.equal(result.errors.some(e=>e.includes('đơn vị BGD chỉ dùng khai báo thành viên')),true);
});

test('YC-028 hotfix: quản trị viên chỉ thay dropdown cho 2 cột chức vụ, không sửa dữ liệu hiện có',()=>{
  const h=setup();
  const users=h.ss.get('Tài khoản'),assignments=h.ss.get('Phân công KPI');
  assignments.rows[0][2]='Chức vụ tại Phòng/Khu'; // fixture: tiêu đề thật trong Google Sheets
  const beforeUsers=JSON.stringify(users.rows),beforeAssignments=JSON.stringify(assignments.rows);
  const calls=[];
  for(const sheet of [users,assignments]){
    sheet.getMaxRows=()=>Math.max(sheet.rows.length+10,20);
    const original=sheet.getRange.bind(sheet);
    sheet.getRange=(r,col,height=1,width=1)=>{
      const range=original(r,col,height,width);
      range.setDataValidation=rule=>{calls.push({sheet,r,col,height,width,rule});return range;};
      return range;
    };
  }
  h.c.SpreadsheetApp={
    newDataValidation:()=>({requireValueInList(list,show){this.list=list;this.show=show;return this;},setAllowInvalid(value){this.allowInvalid=value;return this;},build(){return {list:this.list,show:this.show,allowInvalid:this.allowInvalid};}}),
    flush:()=>{}
  };
  const message=h.c.prepareKpiRoleDropdowns();
  assert.match(message,/Chưa đổi bất kỳ giá trị/);
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(x=>x.col),[4,3]);
  assert.equal(calls[0].rule.list.includes('Ban Giám đốc'),true);
  assert.equal(calls[0].rule.list.includes('Quyền Trưởng phòng\/Khu'),true);
  assert.equal(JSON.stringify(users.rows),beforeUsers);
  assert.equal(JSON.stringify(assignments.rows),beforeAssignments);
});
