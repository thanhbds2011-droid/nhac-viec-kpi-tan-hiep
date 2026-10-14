'use strict';

import { downloadXlsx } from './excel-export.js';

let activeReport = null;
let initialized = false;

function $(id) { return document.getElementById(id); }
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function closeReportPreview() {
  const layer = $('reportPreviewLayer');
  if (!layer || layer.hidden) return;
  layer.hidden = true;
  activeReport = null;
  document.body.classList.remove('report-preview-open');
}

function exportCurrentReport() {
  if (!activeReport) return;
  try {
    downloadXlsx(activeReport);
  } catch (error) {
    const status = $('reportPreviewStatus');
    if (status) {
      status.hidden = false;
      status.textContent = error && error.message ? error.message : 'Không thể tạo file Excel.';
    }
  }
}

function init() {
  if (initialized) return;
  initialized = true;
  $('reportPreviewClose')?.addEventListener('click', closeReportPreview);
  $('reportPreviewCloseBottom')?.addEventListener('click', closeReportPreview);
  $('reportPreviewExport')?.addEventListener('click', exportCurrentReport);
  $('reportPreviewLayer')?.addEventListener('click', (event) => {
    if (event.target === $('reportPreviewLayer')) closeReportPreview();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('reportPreviewLayer')?.hidden) closeReportPreview();
  });
}

export function openReportPreview(config) {
  init();
  const columns = Array.isArray(config && config.columns) ? config.columns : [];
  const rows = Array.isArray(config && config.rows) ? config.rows : [];
  if (!columns.length) throw new Error('Chưa có cấu trúc báo cáo để hiển thị.');
  activeReport = {
    filename: config.filename || 'Bao-cao.xlsx',
    sheetName: config.sheetName || 'Báo cáo',
    title: config.title || 'Báo cáo',
    subtitle: config.subtitle || '',
    columns,
    rows
  };

  if ($('reportPreviewTitle')) $('reportPreviewTitle').textContent = activeReport.title;
  if ($('reportPreviewSubtitle')) {
    $('reportPreviewSubtitle').textContent = activeReport.subtitle;
    $('reportPreviewSubtitle').hidden = !activeReport.subtitle;
  }
  if ($('reportPreviewCount')) $('reportPreviewCount').textContent = `${rows.length.toLocaleString('vi-VN')} dòng`;
  if ($('reportPreviewStatus')) { $('reportPreviewStatus').hidden = true; $('reportPreviewStatus').textContent = ''; }

  const table = $('reportPreviewTable');
  if (table) {
    if (!rows.length) {
      table.innerHTML = `<div class="report-preview-empty"><strong>Chưa có dữ liệu trong phạm vi đã chọn.</strong></div>`;
    } else {
      const head = columns.map((column) => `<th>${esc(column.label)}</th>`).join('');
      const body = rows.map((row) => `<tr>${columns.map((column) => `<td data-label="${esc(column.label)}">${esc(row[column.key] == null || row[column.key] === '' ? '—' : row[column.key])}</td>`).join('')}</tr>`).join('');
      table.innerHTML = `<div class="report-preview-table-wrap"><table class="report-preview-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }
  }
  const exportButton = $('reportPreviewExport');
  if (exportButton) exportButton.disabled = !rows.length;
  const layer = $('reportPreviewLayer');
  if (layer) layer.hidden = false;
  document.body.classList.add('report-preview-open');
  requestAnimationFrame(() => $('reportPreviewClose')?.focus());
}

export { closeReportPreview };
