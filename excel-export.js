'use strict';

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index) {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function utf8Bytes(text) { return new TextEncoder().encode(text); }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeU16(view, offset, value) { view.setUint16(offset, value, true); }
function writeU32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

function zipStore(files) {
  const encoded = files.map((file) => ({ name: utf8Bytes(file.name), data: utf8Bytes(file.data) }));
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  encoded.forEach((file) => {
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + file.name.length + file.data.length);
    const lv = new DataView(local.buffer);
    writeU32(lv, 0, 0x04034b50);
    writeU16(lv, 4, 20);
    writeU16(lv, 6, 0x0800);
    writeU16(lv, 8, 0);
    writeU16(lv, 10, 0);
    writeU16(lv, 12, 0);
    writeU32(lv, 14, crc);
    writeU32(lv, 18, file.data.length);
    writeU32(lv, 22, file.data.length);
    writeU16(lv, 26, file.name.length);
    writeU16(lv, 28, 0);
    local.set(file.name, 30);
    local.set(file.data, 30 + file.name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + file.name.length);
    const cv = new DataView(central.buffer);
    writeU32(cv, 0, 0x02014b50);
    writeU16(cv, 4, 20);
    writeU16(cv, 6, 20);
    writeU16(cv, 8, 0x0800);
    writeU16(cv, 10, 0);
    writeU16(cv, 12, 0);
    writeU16(cv, 14, 0);
    writeU32(cv, 16, crc);
    writeU32(cv, 20, file.data.length);
    writeU32(cv, 24, file.data.length);
    writeU16(cv, 28, file.name.length);
    writeU16(cv, 30, 0);
    writeU16(cv, 32, 0);
    writeU16(cv, 34, 0);
    writeU16(cv, 36, 0);
    writeU32(cv, 38, 0);
    writeU32(cv, 42, localOffset);
    central.set(file.name, 46);
    centralParts.push(central);
    localOffset += local.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  writeU32(ev, 0, 0x06054b50);
  writeU16(ev, 4, 0);
  writeU16(ev, 6, 0);
  writeU16(ev, 8, files.length);
  writeU16(ev, 10, files.length);
  writeU32(ev, 12, centralSize);
  writeU32(ev, 16, localOffset);
  writeU16(ev, 20, 0);

  const size = localOffset + centralSize + end.length;
  const out = new Uint8Array(size);
  let offset = 0;
  [...localParts, ...centralParts, end].forEach((part) => { out.set(part, offset); offset += part.length; });
  return out;
}

function worksheetXml(columns, rows, title, subtitle) {
  const matrix = [];
  if (title) matrix.push([{ value: title, style: 2 }]);
  if (subtitle) matrix.push([{ value: subtitle, style: 3 }]);
  if (title || subtitle) matrix.push([]);
  matrix.push(columns.map((column) => ({ value: column.label, style: 1 })));
  rows.forEach((row) => matrix.push(columns.map((column) => ({ value: row[column.key] == null ? '' : row[column.key], style: 0 }))));

  const colWidths = columns.map((column) => Math.min(50, Math.max(10, Number(column.width || 0) || column.label.length + 3)));
  const colsXml = colWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const rowXml = matrix.map((cells, rIndex) => {
    const cellXml = cells.map((cell, cIndex) => {
      const ref = `${columnName(cIndex)}${rIndex + 1}`;
      const value = cell && typeof cell === 'object' ? cell.value : cell;
      const style = cell && typeof cell === 'object' ? Number(cell.style || 0) : 0;
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rIndex + 1}">${cellXml}</row>`;
  }).join('');

  const maxColumn = columnName(Math.max(0, columns.length - 1));
  const maxRow = Math.max(1, matrix.length);
  const headerRow = (title ? 1 : 0) + (subtitle ? 1 : 0) + ((title || subtitle) ? 1 : 0) + 1;
  const mergeXml = title && columns.length > 1 ? `<mergeCells count="1"><mergeCell ref="A1:${maxColumn}1"/></mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${maxColumn}${maxRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${colsXml}</cols><sheetData>${rowXml}</sheetData>${mergeXml}<autoFilter ref="A${headerRow}:${maxColumn}${maxRow}"/></worksheet>`;
}

export function downloadXlsx({ filename, sheetName = 'Báo cáo', title = '', subtitle = '', columns = [], rows = [] }) {
  if (!columns.length) throw new Error('Không có cột dữ liệu để xuất Excel.');
  const safeSheet = String(sheetName || 'Báo cáo').replace(/[\\/*?:\[\]]/g, ' ').slice(0, 31) || 'Báo cáo';
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(safeSheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="16"/><name val="Aptos Display"/></font><font><i/><sz val="11"/><color rgb="FF666666"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFCE6F2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE6D7DF"/></left><right style="thin"><color rgb="FFE6D7DF"/></right><top style="thin"><color rgb="FFE6D7DF"/></top><bottom style="thin"><color rgb="FFE6D7DF"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    { name: 'xl/worksheets/sheet1.xml', data: worksheetXml(columns, rows, title, subtitle) }
  ];
  const zip = zipStore(files);
  const blob = new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = String(filename || 'Bao-cao.xlsx').replace(/[^\p{L}\p{N}._-]+/gu, '-');
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
