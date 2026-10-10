'use strict';
// Pure on-page scanner. It reads only visible table cells; no iCPV API, credentials or navigation.
(function(root){
  const txt=el=>String(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim();
  const norm=v=>String(v||'').normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/g,' ').trim();
  function iso(value){
    const m=String(value||'').match(/(?:^|\D)(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\D)/);
    if(!m)return '';
    const d=+m[1],mo=+m[2],y=+m[3],dt=new Date(Date.UTC(y,mo-1,d));
    return dt.getUTCFullYear()===y&&dt.getUTCMonth()+1===mo&&dt.getUTCDate()===d?
      `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`:'';
  }
  async function hash(value){
    const arr=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
    return [...new Uint8Array(arr)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function scan(){
    if(location.protocol!=='https:')return {error:'Chỉ hỗ trợ trang HTTPS.'};
    const context=norm(document.body?.innerText?.slice(0,6000));
    if(!/(icpv|quản lý nhiệm vụ)/i.test(context))return {error:'Hãy mở danh sách Quản lý nhiệm vụ iCPV.'};
    const rows=[],grids=[...document.querySelectorAll('table,[role="grid"],[role="table"]')];
    let matched=false;
    for(const grid of grids){
      if(!grid.getClientRects().length)continue;
      let headers=[...grid.querySelectorAll('thead th')];
      if(!headers.length)headers=[...grid.querySelectorAll('[role="columnheader"]')];
      if(!headers.length)continue;
      const head=headers.map(h=>norm(txt(h)));
      const titleCol=head.findIndex(h=>h.includes('tên công việc')||h.includes('tên nhiệm vụ'));
      const dueCol=head.findIndex(h=>h.includes('hạn hoàn thành')||h.includes('thời hạn hoàn thành'));
      if(titleCol<0||dueCol<0)continue;
      matched=true;
      let rs=[...grid.querySelectorAll('tbody tr')];
      if(!rs.length)rs=[...grid.querySelectorAll('[role="row"]')].filter(r=>!r.querySelector('[role="columnheader"]'));
      for(const row of rs){
        if(!row.getClientRects().length)continue;
        let cells=[...row.querySelectorAll(':scope > td, :scope > th')];
        if(!cells.length)cells=[...row.querySelectorAll(':scope > [role="gridcell"], :scope > [role="cell"]')];
        if(!cells.length&&row.cells)cells=[...row.cells];
        if(cells.length<=Math.max(titleCol,dueCol))continue;
        const fullTitle=txt(cells[titleCol]).replace(/\s*(?:Từ kho|Tự kho)\s*$/i,'').trim();
        const dueDate=iso(txt(cells[dueCol]));
        if(fullTitle.length>=4)rows.push({fullTitle,dueDate});
      }
    }
    if(!matched)return {error:'Chưa thấy bảng có cột Tên nhiệm vụ và Hạn hoàn thành.'};
    if(!rows.length)return {error:'Danh sách đang trống hoặc chưa tải xong.'};
    if(rows.length>30)return {error:`Đang hiển thị ${rows.length} nhiệm vụ. Mỗi lượt tối đa 30; vui lòng chia trang.`};
    // Do not drop rows just because they share a title. They may be different jobs.
    const counts=new Map();
    rows.forEach(r=>counts.set(norm(r.fullTitle),(counts.get(norm(r.fullTitle))||0)+1));
    const order=new Map(),items=[];
    for(const row of rows){
      const label=norm(row.fullTitle);const n=(order.get(label)||0)+1;order.set(label,n);
      // Retain the legacy key for unique names. Repeated names get distinct scan keys.
      const suffix=counts.get(label)>1?`\n${row.dueDate}\nrow-${n}`:'';
      items.push({sourceKey:'icpv:'+await hash(location.origin.toLowerCase()+'\n'+label+suffix),
        title:row.fullTitle.slice(0,90).trim(),dueDate:row.dueDate});
    }
    // The digest never saves task names or dates in extension storage.
    const canonical=rows.map(r=>norm(r.fullTitle)+'\t'+r.dueDate).sort().join('\n');
    return {items,count:rows.length,origin:location.origin,digest:await hash(canonical),
      invalid:items.filter(x=>!x.dueDate).length};
  }
  root.TanHiepIcpvReader={scan};
})(globalThis);
