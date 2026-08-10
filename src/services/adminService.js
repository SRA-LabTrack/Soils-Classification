import { account } from '../lib/appwrite';

let jwtCache = { token:null, expiresAt:0 };

export function clearAdminSyncToken() {
  jwtCache = { token:null, expiresAt:0 };
}

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
  const timeout = setTimeout(() => controller.abort(), action === 'repairAdminWorkspace' ? 60000 : 20000);
  try {
    return await fetch('/api/admin', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}`, 'Cache-Control':'no-cache' },
      body:JSON.stringify({ action, payload }),
      cache:'no-store',
      signal:controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('The SOILS admin request timed out. The page will stay usable; try the action again.');
    }
    throw new Error(`The integrated SOILS API could not be reached (${err?.message || 'network error'}). Run "npm.cmd run dev" and keep that CMD window open.`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function adminAction(action, payload = {}) {
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
    throw new Error(data.error || `Admin action failed (${res.status})`);
  }
  return data.data;
}
