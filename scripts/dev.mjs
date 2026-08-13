import { createServer as createViteServer } from 'vite';

try{
  const vite=await createViteServer({server:{host:'localhost',port:5173}});
  await vite.listen();
  console.log('\nSOILS v1.10.31');
  console.log('Integrated Admin/Farmer API: /api/admin and /api/farmer');
  console.log('There is no separate port 8787 process anymore.');
  vite.printUrls();
}catch(err){
  console.error('\nSOILS could not start:',err?.message||err);
  process.exit(1);
}
