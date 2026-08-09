import { useEffect, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Leaf, LockKeyhole, Mail, MapPin, Sprout } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Brand from '../components/Brand';

export default function LoginPage() {
  const { user, role, login, demoLogin } = useAuth();
  const nav = useNavigate();
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [show,setShow]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  useEffect(()=>{ if(user) nav(role==='admin'?'/admin':'/farm',{replace:true}); },[user,role,nav]);
  const submit=async(e)=>{e.preventDefault();setBusy(true);setError('');try{const next=await login(email,password);nav(next.labels?.includes('admin')?'/admin':'/farm');}catch(err){setError(err?.message||'Unable to sign in.');}finally{setBusy(false)}};
  const demo=(r)=>{demoLogin(r);nav(r==='admin'?'/admin':'/farm')};
  return <div className="login-page">
    <section className="login-visual">
      <div className="visual-grid"/><div className="visual-glow glow-a"/><div className="visual-glow glow-b"/>
      <div className="visual-content"><Brand/><div className="hero-kicker"><Leaf size={15}/> SOIL INTELLIGENCE PLATFORM</div><h1>See what the soil<br/><em>is telling you.</em></h1><p>Map farm boundaries, monitor NPK and pH sensors, compare laboratory plots, and turn field measurements into decisions.</p>
        <div className="hero-points"><span><MapPin size={17}/> Geospatial farm monitoring</span><span><Sprout size={17}/> Nutrient & organic matter insights</span></div>
      </div>
      <div className="farm-orbit"><div className="orbit-shape"><i/><i/><i/><i/></div><div className="orbit-card"><span>Live farm health</span><strong>GOOD</strong><small>6.42 average pH</small></div></div>
    </section>
    <section className="login-panel"><div className="login-box"><div className="mobile-brand"><Brand/></div><div className="login-head"><span>WELCOME BACK</span><h2>Sign in to SOILS</h2><p>Use your Appwrite admin or farmer account.</p></div>
      <form onSubmit={submit}><label>Email address</label><div className="field"><Mail size={18}/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required/></div><label>Password</label><div className="field"><LockKeyhole size={18}/><input type={show?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required minLength={8}/><button type="button" onClick={()=>setShow(!show)}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>{error&&<div className="login-error">{error}</div>}<button className="primary-login" disabled={busy}>{busy?'Signing in…':'Sign in'}<ArrowRight size={18}/></button></form>
      <div className="demo-divider"><span>Local demo workspace • edits persist in this browser</span></div><div className="demo-buttons"><button onClick={()=>demo('admin')}>Demo Admin</button><button onClick={()=>demo('farmer')}>Demo Farmer</button></div>
      <small className="login-note">The API key stays server-only. It is used by the setup/admin API and is never bundled into the React browser app.</small>
    </div></section>
  </div>;
}
