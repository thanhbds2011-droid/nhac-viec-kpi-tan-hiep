'use strict';
const {OAuth2Client}=require('google-auth-library');
const {verifySession}=require('./session');
const client=new OAuth2Client();
async function identify(input,env){
  if(typeof input.sessionToken==='string'&&input.sessionToken){
    const p=verifySession(input.sessionToken,env.PUSH_ID_SECRET);
    if(!p)throw new Error('SESSION_EXPIRED');
    return {sub:p.sub,email:p.email,name:p.name||'',fromGoogle:false};
  }
  const credential=input.credential;
  if(typeof credential!=='string'||credential.length>5000||credential.length<20)throw new Error('SESSION_EXPIRED');
  const ticket=await client.verifyIdToken({idToken:credential,audience:env.GOOGLE_CLIENT_ID});
  const p=ticket.getPayload();
  if(!p||!p.sub||!p.email||p.email_verified!==true||
    !['accounts.google.com','https://accounts.google.com'].includes(p.iss))throw new Error('SESSION_EXPIRED');
  return {sub:String(p.sub),email:p.email.toLowerCase(),name:String(p.name||'').slice(0,100),fromGoogle:true};
}
module.exports={identify};
