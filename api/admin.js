import { handleAdminAction } from '../server/adminCore.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });
  try {
    const auth = req.headers.authorization || '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const data = await handleAdminAction({ jwt, action:body.action, payload:body.payload || {} });
    return res.status(200).json({ ok:true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ ok:false, error:err.message || 'Admin request failed' });
  }
}
