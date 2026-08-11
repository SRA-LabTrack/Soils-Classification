import 'dotenv/config';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { handleAdminAction, handleFarmerAction } from './server/adminCore.mjs';

const json=(res,status,data)=>{
  res.statusCode=status;
  res.setHeader('Content-Type','application/json');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(data));
};

const readBody=async(req)=>{
  let raw='';
  for await(const chunk of req) raw+=chunk;
  return raw?JSON.parse(raw):{};
};

function soilsLocalApi(){
  return {
    name:'soils-integrated-local-api',
    configureServer(server){
      server.middlewares.use(async(req,res,next)=>{
        const url=(req.url||'').split('?')[0];
        if(!url.startsWith('/api/')) return next();
        try{
          const auth=req.headers.authorization||'';
          const jwt=auth.startsWith('Bearer ')?auth.slice(7):'';
          if(url==='/api/health') return json(res,200,{ok:true,service:'SOILS integrated API',version:'1.10.27'});
          if(url==='/api/farmer' && (req.method==='GET'||req.method==='POST')){
            const body=req.method==='POST'?await readBody(req):{};
            const data=await handleFarmerAction({jwt,action:body.action||'getWorkspace',payload:body.payload||{}});
            return json(res,200,{ok:true,data});
          }
          if(url==='/api/admin' && req.method==='POST'){
            const body=await readBody(req);
            const data=await handleAdminAction({jwt,action:body.action,payload:body.payload||{}});
            return json(res,200,{ok:true,data});
          }
          return json(res,404,{ok:false,error:'SOILS API route not found'});
        }catch(err){
          return json(res,err?.status||500,{ok:false,error:err?.message||'SOILS API request failed'});
        }
      });
    },
  };
}

export default defineConfig({
  plugins:[react(),soilsLocalApi()],
  server:{port:5173,host:'localhost'},
});
