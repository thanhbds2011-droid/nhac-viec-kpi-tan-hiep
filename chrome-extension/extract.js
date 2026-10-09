(async () => {
  'use strict';
  // Script runs ONLY when a user clicks the extension, not automatically on iCPV.
  const text = (element) => String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  const normalized = (value) => String(value || '').normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim();
  function dateISO(value) {
    const m = String(value || '').match(/(?:^|\D)(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\D)/);
    if (!m) return '';
    const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
    const dt = new Date(Date.UTC(yyyy,mm-1,dd));
    if (dt.getUTCFullYear() !== yyyy || dt.getUTCMonth()+1 !== mm || dt.getUTCDate() !== dd) return '';
    return `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  }
  async function fingerprint(rawTitle) {
    const value = `${location.origin.toLowerCase()}\n${normalized(rawTitle)}`;
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return 'icpv:' + [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  if (location.protocol !== 'https:') return {error:'Chỉ đọc trang HTTPS.'};
  const context = normalized(document.body.innerText.slice(0,6000));
  if (!/(icpv|quản lý nhiệm vụ)/i.test(context)) return {error:'Trang này chưa có dấu hiệu là mục Quản lý nhiệm vụ iCPV.'};
  const grids = [...document.querySelectorAll('table,[role="grid"],[role="table"]')];
  const found = [];
  for (const grid of grids) {
    if (grid.getClientRects().length===0) continue;
    let head = [...grid.querySelectorAll('thead th')];
    if (!head.length) head=[...grid.querySelectorAll('[role="columnheader"]')];
    if (!head.length) continue;
    const headers=head.map(x=>normalized(text(x)));
    const titleCol=headers.findIndex(h=>h.includes('tên công việc')||h.includes('tên nhiệm vụ'));
    const dateCol=headers.findIndex(h=>h.includes('hạn hoàn thành')||h.includes('thời hạn hoàn thành'));
    if (titleCol<0||dateCol<0) continue;
    let rows=[...grid.querySelectorAll('tbody tr')];
    if (!rows.length) rows=[...grid.querySelectorAll('[role="row"]')].filter(row=>!row.querySelector('[role="columnheader"]'));
    for(const row of rows) {
      if(row.getClientRects().length===0)continue;
      let cells=[...row.querySelectorAll(':scope > td, :scope > th')];
      if(!cells.length)cells=[...row.querySelectorAll(':scope > [role="gridcell"], :scope > [role="cell"]')];
      if(!cells.length&&row.tagName.toLowerCase()==='tr')cells=[...row.cells];
      if(cells.length<=Math.max(titleCol,dateCol))continue;
      const title=text(cells[titleCol]).replace(/\s*(?:Từ kho|Tự kho)\s*$/i,'').trim();
      const dueDate=dateISO(text(cells[dateCol]));
      if(title.length<4||!dueDate)continue;
      found.push({fullTitle:title,dueDate});
    }
  }
  if(!found.length) return {error:'Không đọc được bảng có cột “Tên công việc” và “Hạn hoàn thành”. Hãy mở danh sách đã duyệt, chờ tải xong và thử lại. Có thể cần hiệu chỉnh bộ đọc theo HTML thực tế.'};
  if(found.length>30) return {error:`Đang hiển thị ${found.length} dòng. Mỗi lượt hỗ trợ tối đa 30; hãy chia trang hoặc lọc trước khi đồng bộ.`};
  const byTitle=new Map();
  for(const item of found) {
    const id=normalized(item.fullTitle);
    if(!byTitle.has(id))byTitle.set(id,[]);
    byTitle.get(id).push(item);
  }
  const items=[],ambiguous=[];
  for(const group of byTitle.values()) {
    if(group.length>1){ambiguous.push(group[0].fullTitle.slice(0,70));continue;}
    const item=group[0];
    items.push({sourceKey:await fingerprint(item.fullTitle),
      title:item.fullTitle.slice(0,90).trim(),dueDate:item.dueDate});
  }
  if(!items.length)return {error:'Các nhiệm vụ đang hiển thị đều trùng tên; không thể ghép thời hạn an toàn.'};
  return {items,skippedNames:ambiguous,count:found.length,origin:location.origin};
})();
