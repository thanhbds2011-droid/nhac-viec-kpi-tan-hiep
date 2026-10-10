(async()=>{
  'use strict';
  if(!globalThis.TanHiepIcpvReader)return {error:'Tiện ích chưa nạp bộ đọc iCPV. Hãy thử lại.'};
  return globalThis.TanHiepIcpvReader.scan();
})();
