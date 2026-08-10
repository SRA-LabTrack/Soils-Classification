import { account } from '../lib/appwrite';

let jwtCache={token:null,expiresAt:0};

export function clearFarmerSyncToken(){jwtCache={token:null,expiresAt:0};}

async function getJWT(force=false){
  if(!force&&jwtCache.token&&Date.now()<jwtCache.expiresAt)return jwtCache.token;
  const token=await account.createJWT();
  jwtCache={token:token.jwt,expiresAt:Date.now()+9*60*1000};
  return jwtCache.token;
}

async function request(token){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    return await fetch(`/api/farmer?sync=${Date.now()}`,{
      method:'POST',
      headers:{Authorization:`Bearer ${token}`,'Cache-Control':'no-cache','Content-Type':'application/json'},
      body:'{}',
      cache:'no-store',
      signal:controller.signal,
    });
  }finally{
    clearTimeout(timeout);
  }
}

export async function loadAuthoritativeFarmerWorkspace(){
  let token=await getJWT();
  let res;
  try{res=await request(token);}
  catch(err){
    if(err?.name==='AbortError') throw new Error('Farmer workspace sync timed out. The last loaded map is still available; retry in a moment.');
    throw new Error(`The integrated SOILS farmer sync API could not be reached. Run "npm.cmd run dev" and keep it open. ${err?.message||''}`.trim());
  }
  if(res.status===401){
    clearFarmerSyncToken();
    token=await getJWT(true);
    res=await request(token);
  }
  const text=await res.text();
  let payload={};try{payload=text?JSON.parse(text):{};}catch{payload={error:text};}
  if(!res.ok||!payload.ok)throw new Error(payload.error||`Farmer sync failed (${res.status})`);
  return payload.data;
}
