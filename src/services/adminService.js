import { account } from '../lib/appwrite';

let jwtCache = { token:null, expiresAt:0 };

async function getAdminJWT(force=false) {
  if (!force && jwtCache.token && Date.now() < jwtCache.expiresAt) return jwtCache.token;
  try {
    const token = await account.createJWT();
    jwtCache = { token:token.jwt, expiresAt:Date.now() + 10 * 60 * 1000 };
    return jwtCache.token;
  } catch (err) {
    jwtCache = { token:null, expiresAt:0 };
    throw new Error(`Could not create the admin session token. Sign out and sign in again. ${err?.message || ''}`.trim());
  }
}

async function sendAdminAction(action, payload, token) {
  try {
    return await fetch('/api/admin', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
      body:JSON.stringify({ action, payload }),
    });
  } catch {
    throw new Error('The SOILS admin API is not reachable. Start the project with "npm.cmd run dev" (not vite by itself), then try again.');
  }
}

export async function adminAction(action, payload = {}) {
  let token = await getAdminJWT();
  let res = await sendAdminAction(action, payload, token);

  // A cached JWT may expire while the app is open. Refresh once automatically.
  if (res.status === 401) {
    jwtCache = { token:null, expiresAt:0 };
    token = await getAdminJWT(true);
    res = await sendAdminAction(action, payload, token);
  }

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error:text }; }
  if (!res.ok || !data.ok) {
    const detail = data.error || `Admin action failed (${res.status})`;
    throw new Error(`${detail}${res.status === 404 ? ' Make sure npm.cmd run dev is running the bundled admin API.' : ''}`);
  }
  return data.data;
}
