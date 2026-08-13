import { account } from '../lib/appwrite';

let jwtCache = { token:null, expiresAt:0 };
const responseCache=new Map();
const inFlight=new Map();

const cacheTTL=(action)=>action==='getAdminWorkspace'?15000:action==='getFarmWorkspace'?10000:action==='getSupportThreads'?5000:0;
const requestKey=(action,payload)=>`${action}:${JSON.stringify(payload||{})}`;

export function clearAdminSyncToken() {
  jwtCache = { token:null, expiresAt:0 };
  responseCache.clear();
  inFlight.clear();
}

export function clearAdminResponseCache(){responseCache.clear();}

async function getAdminJWT(force=false) {
  if (!force && jwtCache.token && Date.now() < jwtCache.expiresAt) return jwtCache.token;
  try {
    const token = await account.createJWT();
    jwtCache = { token:token.jwt, expiresAt:Date.now() + 9 * 60 * 1000 };
    return jwtCache.token;
  } catch (err) {
    clearAdminSyncToken();
    throw new Error(`Could not create the admin session token. Sign out and sign in again. ${err?.message || ''}`.trim());
  }
}

async function sendAdminAction(action, payload, token) {
  const controller = new AbortController();
  const timeoutMs=action==='repairAdminWorkspace'?60000:action==='reviewSpatialRequest'?22000:action==='getAdminWorkspace'?12000:15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch('/api/admin', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}`, 'Cache-Control':'no-cache' },
      body:JSON.stringify({ action, payload }),
      cache:'no-store',
      signal:controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('The SOILS admin request timed out. The page will stay usable; try the action again.');
    throw new Error(`The integrated SOILS API could not be reached (${err?.message || 'network error'}). Run "npm.cmd run dev" and keep that CMD window open.`);
  } finally { clearTimeout(timeout); }
}

async function executeAdminAction(action,payload){
  let token = await getAdminJWT();
  let res = await sendAdminAction(action, payload, token);
  if (res.status === 401) {
    clearAdminSyncToken();
    token = await getAdminJWT(true);
    res = await sendAdminAction(action, payload, token);
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error:text }; }
  if (!res.ok || !data.ok) {
    const error=new Error(data.error || `Admin action failed (${res.status})`);
    error.status=res.status;
    throw error;
  }
  return data.data;
}

export async function adminAction(action, payload = {}, {force=false}={}) {
  const ttl=cacheTTL(action);
  const key=requestKey(action,payload);
  if(ttl&&!force){
    const cached=responseCache.get(key);
    if(cached&&Date.now()<cached.expiresAt)return cached.data;
    if(inFlight.has(key))return inFlight.get(key);
  }
  const promise=executeAdminAction(action,payload);
  if(ttl)inFlight.set(key,promise);
  try{
    const data=await promise;
    if(ttl)responseCache.set(key,{data,expiresAt:Date.now()+ttl});
    else responseCache.clear(); // any mutation invalidates snapshot caches
    return data;
  }finally{if(ttl)inFlight.delete(key);}
}
