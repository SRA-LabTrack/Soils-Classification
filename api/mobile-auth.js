const endpoint=(process.env.APPWRITE_ENDPOINT||process.env.VITE_APPWRITE_ENDPOINT||'https://fra.cloud.appwrite.io/v1').replace(/\/$/,'');
const projectId=process.env.APPWRITE_PROJECT_ID||process.env.VITE_APPWRITE_PROJECT_ID||'6a787625002b311b4896';
const apiKey=process.env.APPWRITE_API_KEY||'';

const attempts=globalThis.__soilsMobileAuthAttempts||(globalThis.__soilsMobileAuthAttempts=new Map());

function sendJson(res,status,data){
  res.status(status);
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Pragma','no-cache');
  return res.json(data);
}

function requestIp(req){
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
  return forwarded||String(req.socket?.remoteAddress||'unknown');
}

function checkLoginThrottle(req,email){
  const key=`${requestIp(req)}:${String(email||'').trim().toLowerCase()}`;
  const now=Date.now();
  const current=attempts.get(key)||{count:0,resetAt:now+15*60*1000};
  if(now>current.resetAt){current.count=0;current.resetAt=now+15*60*1000;}
  current.count+=1;
  attempts.set(key,current);
  if(current.count>8){
    const error=new Error('Too many mobile sign-in attempts. Wait a few minutes and try again.');
    error.status=429;
    throw error;
  }
}

function clearThrottle(req,email){
  attempts.delete(`${requestIp(req)}:${String(email||'').trim().toLowerCase()}`);
}

async function appwrite(path,{method='GET',body=null,key=false,session=''}={}){
  const headers={
    'Content-Type':'application/json',
    'X-Appwrite-Project':projectId,
    'X-Appwrite-Response-Format':'1.9.0',
    'X-SDK-Name':'SOILS Mobile Auth Bridge',
    'X-SDK-Platform':'server',
  };
  if(key){
    if(!apiKey){
      const error=new Error('SOILS mobile authentication is not configured on Vercel. APPWRITE_API_KEY is missing.');
      error.status=503;
      throw error;
    }
    headers['X-Appwrite-Key']=apiKey;
  }
  if(session)headers['X-Appwrite-Session']=session;

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(`${endpoint}${path}`,{
      method,
      headers,
      ...(body!==null?{body:JSON.stringify(body)}:{}),
      signal:controller.signal,
    });
    const text=await response.text();
    let data={};
    try{data=text?JSON.parse(text):{};}catch{data={message:text};}
    if(!response.ok){
      const error=new Error(data?.message||`Appwrite request failed (${response.status})`);
      error.status=response.status;
      error.type=data?.type||'';
      throw error;
    }
    return data;
  }catch(error){
    if(error?.name==='AbortError'){
      const timeout=new Error('Appwrite authentication timed out. Please try again.');
      timeout.status=504;
      throw timeout;
    }
    throw error;
  }finally{
    clearTimeout(timer);
  }
}

async function issueJwt(session){
  const [user,jwt]=await Promise.all([
    appwrite('/account',{session}),
    appwrite('/account/jwts',{method:'POST',body:{duration:3600},session}),
  ]);
  return {
    session,
    jwt:String(jwt?.jwt||''),
    jwtExpiresAt:new Date(Date.now()+55*60*1000).toISOString(),
    user:{
      id:String(user?.$id||user?.id||''),
      email:String(user?.email||''),
      name:String(user?.name||''),
      labels:Array.isArray(user?.labels)?user.labels:[],
    },
  };
}

export default async function handler(req,res){
  if(req.method!=='POST')return sendJson(res,405,{ok:false,error:'Method not allowed'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const action=String(body.action||'login');

    if(action==='login'){
      const email=String(body.email||'').trim().toLowerCase();
      const password=String(body.password||'');
      if(!email||password.length<8){
        return sendJson(res,400,{ok:false,error:'Enter a valid email and a password of at least 8 characters.'});
      }
      checkLoginThrottle(req,email);
      const session=await appwrite('/account/sessions/email',{
        method:'POST',
        body:{email,password},
        key:true,
      });
      const secret=String(session?.secret||'');
      if(!secret){
        const error=new Error('Appwrite created the account session but did not return its server session secret.');
        error.status=502;
        throw error;
      }
      const data=await issueJwt(secret);
      clearThrottle(req,email);
      return sendJson(res,200,{ok:true,data});
    }

    const session=String(body.session||'').trim();
    if(!session)return sendJson(res,401,{ok:false,error:'Mobile session is missing. Sign in again.'});

    if(action==='refresh'){
      const data=await issueJwt(session);
      return sendJson(res,200,{ok:true,data});
    }

    if(action==='logout'){
      await appwrite('/account/sessions/current',{method:'DELETE',session}).catch(()=>{});
      return sendJson(res,200,{ok:true,data:{loggedOut:true}});
    }

    return sendJson(res,400,{ok:false,error:'Unknown mobile auth action.'});
  }catch(error){
    const status=Number(error?.status)||500;
    const message=status===401?'Email or password is incorrect.':(error?.message||'Mobile authentication failed.');
    return sendJson(res,status,{ok:false,error:message,type:error?.type||''});
  }
}
