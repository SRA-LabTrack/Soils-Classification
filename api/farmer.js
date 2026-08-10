import { handleFarmerWorkspace } from '../server/adminCore.mjs';

export default async function handler(req,res){
  if(req.method!=='GET' && req.method!=='POST') return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const auth=req.headers.authorization||'';
    const jwt=auth.startsWith('Bearer ')?auth.slice(7):'';
    const data=await handleFarmerWorkspace({jwt});
    res.setHeader('Cache-Control','no-store, max-age=0');
    return res.status(200).json({ok:true,data});
  }catch(err){
    return res.status(err.status||500).json({ok:false,error:err.message||'Farmer workspace request failed'});
  }
}
