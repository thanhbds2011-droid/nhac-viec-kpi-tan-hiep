'use strict';
const crypto = require('node:crypto');
const {identify}=require('../server/identity');
const {signSession}=require('../server/session');
function reply(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(code).json(obj);
}
function b64url(str) { return Buffer.from(str, 'utf8').toString('base64url'); }
function safeString(v) { return typeof v === 'string' ? v.trim() : ''; }
module.exports = async (req, res) => {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Chỉ hỗ trợ POST.' });
  const { GOOGLE_CLIENT_ID, APPS_SCRIPT_URL, APPS_SCRIPT_SHARED_SECRET, PUSH_ID_SECRET } = process.env;
  if (![GOOGLE_CLIENT_ID, APPS_SCRIPT_URL, APPS_SCRIPT_SHARED_SECRET, PUSH_ID_SECRET].every(Boolean)) {
    return reply(res, 503, { error: 'Máy chủ chưa được cấu hình đầy đủ.' });
  }
  try {
    const reqSize = Number(req.headers['content-length'] || 0);
    if (reqSize > 38000) return reply(res, 413, { error: 'Dữ liệu yêu cầu quá lớn.' });
    const { credential, sessionToken, action, data } = req.body || {};
    if (!['load', 'save', 'remove', 'setDefaultTime', 'sync', 'status', 'importTasks'].includes(action)) {
      return reply(res, 400, { error: 'Hành động không hợp lệ.' });
    }
    const p = await identify({credential,sessionToken},process.env);
    const externalId = 'th_' + crypto.createHmac('sha256', PUSH_ID_SECRET)
      .update(String(p.sub)).digest('hex').slice(0, 44);
    const payload = {
      action,
      actor: {
        subject: String(p.sub),
        email: String(p.email).toLowerCase(),
        name: safeString(p.name).slice(0, 100),
        externalId
      },
      data: data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    };
    const ts = Date.now();
    const nonce = crypto.randomUUID();
    const encoded = b64url(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', APPS_SCRIPT_SHARED_SECRET)
      .update(`${ts}.${nonce}.${encoded}`).digest('base64url');
    const aborter = new AbortController();
    const timer = setTimeout(() => aborter.abort(), 25000);
    let upstream;
    try {
      upstream = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ ts, nonce, encoded, signature }),
        redirect: 'follow', signal: aborter.signal
      });
    } finally { clearTimeout(timer); }
    const responseText = await upstream.text();
    let upstreamData;
    try { upstreamData = JSON.parse(responseText); }
    catch (_) { throw new Error('Apps Script chưa công khai đúng bản triển khai hoặc đang trả về trang HTML.'); }
    if (!upstream.ok) throw new Error('Apps Script trả về HTTP ' + upstream.status);
    if (upstreamData.ok !== true) {
      const status = upstreamData.code === 'FORBIDDEN' ? 403 :
        upstreamData.code === 'CONFLICT' ? 409 :
        upstreamData.code === 'BAD_REQUEST' ? 400 : 502;
      return reply(res, status, { error: upstreamData.error || 'Lỗi nghiệp vụ Apps Script.' });
    }
    // Publish a small event only after Apps Script confirms a committed user mutation.
    // Never undo an accepted Google Sheets write because the realtime provider failed.
    const { publishChange } = require('../server/realtime');
    const { realtimeChannel } = require('../server/realtime');
    const payloadOut = { ok: true, ...upstreamData.result, externalId,
      realtimeChannel: process.env.ABLY_API_KEY ? realtimeChannel(p.sub, PUSH_ID_SECRET) : '' };
    if (p.fromGoogle)payloadOut.sessionToken=signSession(p,PUSH_ID_SECRET);
    if (upstreamData.changed)payloadOut.change=upstreamData.change;
    if (upstreamData.needsSync)payloadOut.needsSync=true;
    if (upstreamData.changed && upstreamData.change && process.env.ABLY_API_KEY) {
      const event = { revision: upstreamData.result.revision, change: upstreamData.change };
      try { await publishChange(p.sub, event, process.env); }
      catch (err) { console.error('Realtime publication failed:', err.message); }
    }
    return reply(res, 200, payloadOut);
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED')return reply(res,401,{error:'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.'});
    if (err.name === 'AbortError') return reply(res, 504, { error: 'Máy chủ hết thời gian chờ Apps Script. Kiểm tra lại lịch trước khi thử lưu.' });
    if (String(err.message || '').includes('Wrong number of segments') ||
        String(err.message || '').includes('Token used too late') ||
        String(err.message || '').includes('Invalid token') ||
        String(err.message || '').includes('audience') ||
        String(err.message || '').includes('Signature')) {
      return reply(res, 401, { error: 'Phiên Google hết hạn. Vui lòng đăng nhập lại.' });
    }
    console.error('Request failed:', err.message);
    return reply(res, 502, { error: 'Không thể hoàn tất yêu cầu: ' + String(err.message || 'lỗi không xác định').slice(0, 160) });
  }
};
