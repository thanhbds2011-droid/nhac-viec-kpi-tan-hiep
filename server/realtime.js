'use strict';
const crypto = require('node:crypto');
function realtimeChannel(subject, secret) {
  if (!subject || !secret) throw new Error('Missing channel identity');
  const digest = crypto.createHmac('sha256', secret).update('realtime:v1:' + subject).digest('hex');
  return 'private:task:' + digest.slice(0, 48);
}
// Ably signed TokenRequest. No API key is sent to the browser.
function makeTokenRequest(subject, env, now=Date.now(), nonce=crypto.randomBytes(16).toString('hex')) {
  const [keyName, keySecret] = String(env.ABLY_API_KEY||'').split(':');
  if (!keyName || !keySecret) throw new Error('ABLY_API_KEY is missing or invalid');
  const channel = realtimeChannel(subject, env.PUSH_ID_SECRET);
  const ttl=15*60*1000;
  const clientId='th_'+crypto.createHmac('sha256',env.PUSH_ID_SECRET).update(subject).digest('hex').slice(0,44);
  const capability=JSON.stringify({[channel]:['subscribe']});
  const canonical=[keyName,ttl,capability,clientId,now,nonce].join('\n')+'\n';
  const mac=crypto.createHmac('sha256',keySecret).update(canonical).digest('base64');
  return {keyName,ttl,capability,clientId,timestamp:now,nonce,mac};
}
async function publishChange(subject, event, env) {
  const channel=realtimeChannel(subject,env.PUSH_ID_SECRET);
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),1500);
  try {
    const r=await fetch('https://rest.ably.io/channels/'+encodeURIComponent(channel)+'/messages',{
      method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.ABLY_API_KEY).toString('base64'),
        'Content-Type':'application/json'},
      body:JSON.stringify({name:'data.changed',data:event}),signal:controller.signal
    });
    if (!r.ok) throw new Error('Ably HTTP '+r.status);
  } finally {clearTimeout(timeout);}
}
module.exports={makeTokenRequest,publishChange,realtimeChannel};
