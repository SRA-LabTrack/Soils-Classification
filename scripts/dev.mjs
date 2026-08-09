import 'dotenv/config';
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import { handleAdminAction } from '../server/adminCore.mjs';

const apiPort = 8787;
const apiServer = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.url !== '/api/admin' || req.method !== 'POST') {
    res.writeHead(404, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Not found'}));
  }
  try {
    let raw=''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const auth = req.headers.authorization || '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const data = await handleAdminAction({ jwt, action:body.action, payload:body.payload || {} });
    res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true,data}));
  } catch (err) {
    res.writeHead(err.status || 500, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:err.message || 'Admin request failed'}));
  }
});

apiServer.listen(apiPort, '127.0.0.1', async () => {
  console.log(`SOILS admin API: http://127.0.0.1:${apiPort}`);
  const vite = await createViteServer({ server:{ host:'localhost', port:5173, proxy:{ '/api':`http://127.0.0.1:${apiPort}` } } });
  await vite.listen();
  vite.printUrls();
});

const stop = () => apiServer.close(() => process.exit(0));
process.on('SIGINT', stop); process.on('SIGTERM', stop);
