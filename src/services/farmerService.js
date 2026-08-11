import { account } from '../lib/appwrite';

let jwtCache={token:null,expiresAt:0};
const responseCache=new Map();
const inFlight=new Map();
const cacheTTL=(action)=>action==='getWorkspace'?15000:action==='listSupportMessages'?5000:0;
const keyFor=(action,payload)=>`${action}:${JSON.stringify(payload||{})}`;

export function clearFarmerSyncToken(){jwtCache={token:null,expiresAt:0};responseCache.clear();inFlight.clear();}
export function clearFarmerResponseCache(){responseCache.clear();}

async function getJWT(force=false){
  if(!force&&jwtCache.token&&Date.now()<jwtCache.expiresAt)return jwtCache.token;
  if(typeof navigator!=='undefined'&&navigator.onLine===false)throw new Error('Offline. Farmer data will use the last cached workspace.');
  const token=await Promise.race([
    account.createJWT(),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('Farmer session token timed out. Sign in again and retry.')),10000)),
  ]);
  jwtCache={token:token.jwt,expiresAt:Date.now()+9*60*1000};
  return jwtCache.token;
}

async function request(action='getWorkspace',payload={},token){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),18000);
  try{
    return await fetch('/api/farmer',{
      method:'POST',
      headers:{Authorization:`Bearer ${token}`,'Cache-Control':'no-cache','Content-Type':'application/json'},
      body:JSON.stringify({action,payload}),
      cache:'no-store',
      signal:controller.signal,
    });
  }finally{clearTimeout(timeout);}
}

async function executeFarmerAction(action,payload){
  if(typeof navigator!=='undefined'&&navigator.onLine===false)throw new Error('Offline. Farmer sync will resume when internet returns.');
  let token=await getJWT();
  let res;
  try{res=await request(action,payload,token);}
  catch(err){
    if(err?.name==='AbortError')throw new Error(action==='createSpatialRequest'?'The approval request timed out before Appwrite confirmed it. Please retry once.':'Farmer sync timed out. The cached workspace remains available.');
    throw new Error(`The SOILS farmer sync API could not be reached. ${err?.message||''}`.trim());
  }
  if(res.status===401){clearFarmerSyncToken();token=await getJWT(true);res=await request(action,payload,token);}
  const text=await res.text();let data={};try{data=text?JSON.parse(text):{};}catch{data={error:text};}
  if(!res.ok||!data.ok){const error=new Error(data.error||`Farmer request failed (${res.status})`);error.status=res.status;throw error;}
  return data.data;
}

export async function farmerAction(action='getWorkspace',payload={}, {force=false}={}){
  const ttl=cacheTTL(action);const key=keyFor(action,payload);
  if(ttl&&!force){
    const cached=responseCache.get(key);if(cached&&Date.now()<cached.expiresAt)return cached.data;
    if(inFlight.has(key))return inFlight.get(key);
  }
  const promise=executeFarmerAction(action,payload);if(ttl)inFlight.set(key,promise);
  try{
    const data=await promise;
    if(ttl)responseCache.set(key,{data,expiresAt:Date.now()+ttl});else responseCache.clear();
    return data;
  }finally{if(ttl)inFlight.delete(key);}
}

export async function loadAuthoritativeFarmerWorkspace(options={}){return farmerAction('getWorkspace',{},options);}
export async function listFarmerSupportMessages(options={}){return farmerAction('listSupportMessages',{},options);}
export async function sendFarmerSupportMessage(message){return farmerAction('sendSupportMessage',{message},{force:true});}
export async function createFarmerSpatialRequest(payload){return farmerAction('createSpatialRequest',payload,{force:true});}
