'use strict';
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Phương thức không hỗ trợ.' });
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const oneSignalAppId = process.env.ONESIGNAL_APP_ID;
  if (!googleClientId || !oneSignalAppId) {
    return res.status(503).json({ error: 'Chưa cài GOOGLE_CLIENT_ID hoặc ONESIGNAL_APP_ID trên Vercel.' });
  }
  return res.status(200).json({ googleClientId, oneSignalAppId, realtimeEnabled: Boolean(process.env.ABLY_API_KEY) });
};
