'use strict';
const crypto=require('node:crypto');
const PURPOSE='nhac-kpi-session-v1.';
function signSession(actor,secret,now=Date.now()){
  if(!secret)throw new Error('Missing PUSH_ID_SECRET');
  const body=Buffer.from(JSON.stringify({sub:actor.sub,email:actor.email,name:String(actor.name||'').slice(0,100),
    iat:now,exp:now+8*60*60*1000})).toString('base64url');
  const sig=crypto.createHmac('sha256',secret).update(PURPOSE+body).digest('base64url');
  return body+'.'+sig;
}
function verifySession(token,secret,now=Date.now()){
  if(typeof token!=='string'||token.length>1500||!secret)return null;
  const parts=token.split('.');if(parts.length!==2)return null;
  const [body,signature]=parts;
  if(!/^[a-zA-Z0-9_-]+$/.test(body)||!/^[a-zA-Z0-9_-]+$/.test(signature))return null;
  const expected=crypto.createHmac('sha256',secret).update(PURPOSE+body).digest();
  let received;try{received=Buffer.from(signature,'base64url');}catch{return null;}
  if(expected.length!==received.length||!crypto.timingSafeEqual(expected,received))return null;
  let obj;try{obj=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));}catch{return null;}
  if(!obj||typeof obj.sub!=='string'||typeof obj.email!=='string'||!Number.isSafeInteger(obj.iat)||
    !Number.isSafeInteger(obj.exp)||obj.exp<=now||obj.iat>now+60000||obj.exp-obj.iat>8*60*60*1000)
    return null;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(obj.email)||!obj.sub)return null;
  return obj;
}
module.exports={signSession,verifySession};
