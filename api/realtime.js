'use strict';
const crypto=require('node:crypto');
const {identify}=require('../server/identity');
const {makeTokenRequest}=require('../server/realtime');
function reply(res,status,obj){res.setHeader('Cache-Control','no-store');return res.status(status).json(obj);}
module.exports=async (req,res)=>{
  if(req.method!=='POST')return reply(res,405,{error:'Chỉ hỗ trợ POST.'});
  const env=process.env;
  if(!env.ABLY_API_KEY)return reply(res,503,{error:'Đồng bộ real-time chưa được cấu hình.'});
  if(!env.GOOGLE_CLIENT_ID||!env.PUSH_ID_SECRET||!env.APPS_SCRIPT_URL||!env.APPS_SCRIPT_SHARED_SECRET)
    return reply(res,503,{error:'Máy chủ thiếu cấu hình.'});
  try{
    let p;try{p=await identify(req.body||{},env);}catch{return reply(res,401,{error:'Phiên hết hạn. Vui lòng đăng nhập lại.'});}
    // The Ably token must only be issued to an ACTIVE member of Sheets Access.
    const ts=Date.now(),nonce=crypto.randomUUID(),externalId='th_'+crypto.createHmac('sha256',env.PUSH_ID_SECRET).update(p.sub).digest('hex').slice(0,44);
    const payload={action:'authorize',actor:{subject:p.sub,email:p.email.toLowerCase(),name:String(p.name||'').slice(0,100),externalId},data:{}};
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature=crypto.createHmac('sha256',env.APPS_SCRIPT_SHARED_SECRET).update(`${ts}.${nonce}.${encoded}`).digest('base64url');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
    let upstream;
    try {upstream=await fetch(env.APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},
      body:JSON.stringify({ts,nonce,encoded,signature}),redirect:'follow',signal:controller.signal});}
    finally{clearTimeout(timer);}
    const raw=await upstream.text();let auth;
    try{auth=JSON.parse(raw);}catch{throw new Error('Apps Script không trả dữ liệu JSON.');}
    if(!auth.ok){const status=auth.code==='FORBIDDEN'?403:502;return reply(res,status,{error:auth.error||'Không được cấp quyền.'});}
    return reply(res,200,makeTokenRequest(p.sub,env));
  }catch(err){console.error('Realtime auth:',err.message);return reply(res,503,{error:'Chưa thể xác thực kênh đồng bộ. Thử lại khi có mạng.'});}
};
