import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { account, realtime } from '../lib/appwrite';
import { clearFarmerSyncToken } from '../services/farmerService';
import { clearAdminSyncToken } from '../services/adminService';

const AuthContext = createContext(null);
const TAB_IDENTITY_KEY='soils_tab_identity_v11013';

const demoUser=(role)=>({
  $id:`demo-${role}`,
  name:role==='admin'?'Demo Administrator':'Farmer 1',
  email:`${role}@demo.local`,
  labels:[role],
  demo:true,
});
const roleOf=(next)=>next?.labels?.includes('admin')?'admin':next?'farmer':null;

function clearAuthCaches(){clearFarmerSyncToken();clearAdminSyncToken();}
function readPinnedIdentity(){try{return JSON.parse(sessionStorage.getItem(TAB_IDENTITY_KEY)||'null');}catch{return null;}}
function pinIdentity(next){
  if(!next?.$id)return;
  const identity={$id:next.$id,name:next.name||'',email:next.email||'',labels:Array.isArray(next.labels)?next.labels:[],role:roleOf(next),pinnedAt:new Date().toISOString()};
  try{sessionStorage.setItem(TAB_IDENTITY_KEY,JSON.stringify(identity));}catch{}
}
function clearPinnedIdentity(){try{sessionStorage.removeItem(TAB_IDENTITY_KEY);}catch{}}

async function closeCurrentRealSession(){
  try{await realtime.disconnect();}catch{}
  try{await account.deleteSession({sessionId:'current'});}catch{}
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [authNotice,setAuthNotice]=useState('');

  useEffect(() => {
    let alive=true;
    localStorage.removeItem('soils_demo_role');
    const demoRole=sessionStorage.getItem('soils_demo_role');
    if(demoRole==='admin'||demoRole==='farmer'){
      if(alive){const next=demoUser(demoRole);setUser(next);pinIdentity(next);setLoading(false);}
      return ()=>{alive=false;};
    }

    const pinned=readPinnedIdentity();
    // If the device reloads while offline, keep this tab tied to the account that
    // was previously verified here. The dashboard will use its cached workspace
    // and queue new spatial changes until connectivity returns.
    if(typeof navigator!=='undefined' && navigator.onLine===false && pinned?.$id){
      setUser({...pinned,offlineSession:true});
      setAuthNotice('Offline mode: using the last verified account for this tab. Changes will sync when internet returns.');
      setLoading(false);
      return ()=>{alive=false;};
    }

    account.get()
      .then(next=>{
        if(!alive)return;
        if(pinned?.$id && next?.$id!==pinned.$id){
          clearAuthCaches();
          setUser(null);
          setAuthNotice('This browser session was changed by another tab or account. SOILS blocked the account switch so an Admin tab cannot silently become a Farmer tab. Sign in again here, or use Incognito / a separate browser profile for the second account.');
          return;
        }
        setUser(next);pinIdentity(next);
      })
      .catch(()=>{if(alive)setUser(null);})
      .finally(()=>{if(alive)setLoading(false);});
    return ()=>{alive=false;};
  }, []);

  useEffect(()=>{
    if(!user || user?.demo || user?.offlineSession) return undefined;
    let alive=true;
    let checking=false;
    const validate=async()=>{
      if(checking || (typeof navigator!=='undefined' && navigator.onLine===false)) return;
      checking=true;
      try{
        const next=await account.get();
        if(!alive)return;
        const pinned=readPinnedIdentity();
        if((pinned?.$id && next?.$id!==pinned.$id) || next?.$id!==user?.$id){
          // Appwrite web sessions are origin/browser-cookie based. If another tab
          // logs into another account, never adopt it silently in this tab.
          clearAuthCaches();
          setUser(null);
          setAuthNotice('Another tab changed the shared Appwrite login. This tab was signed out locally instead of switching roles. Use Incognito or a separate browser profile when Admin and Farmer must stay signed in at the same time.');
          return;
        }
        setUser(next);pinIdentity(next);
      }catch{
        if(alive){clearAuthCaches();setUser(null);setAuthNotice('Your Appwrite session is no longer valid. Sign in again to continue syncing.');}
      }finally{checking=false;}
    };
    const onFocus=()=>validate();
    const onOnline=()=>validate();
    const onVisibility=()=>{if(document.visibilityState==='visible')validate();};
    window.addEventListener('focus',onFocus);
    window.addEventListener('online',onOnline);
    document.addEventListener('visibilitychange',onVisibility);
    return ()=>{
      alive=false;
      window.removeEventListener('focus',onFocus);
      window.removeEventListener('online',onOnline);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[user?.$id,user?.demo,user?.offlineSession]);

  const login = async (email, password) => {
    setLoading(true);setAuthNotice('');
    clearAuthCaches();
    sessionStorage.removeItem('soils_demo_role');
    localStorage.removeItem('soils_demo_role');
    clearPinnedIdentity();
    setUser(null);
    await closeCurrentRealSession();
    try{
      await account.createEmailPasswordSession({ email, password });
      const next = await account.get();
      if(!next?.$id)throw new Error('Appwrite did not return the signed-in account.');
      if(String(next.email||'').trim().toLowerCase()!==String(email||'').trim().toLowerCase()){
        await closeCurrentRealSession();
        throw new Error('The browser session changed while signing in. SOILS blocked the mismatched account instead of opening the wrong Admin/Farmer dashboard. Try again here, and use Incognito or a separate browser profile for the second account.');
      }
      clearAuthCaches();pinIdentity(next);setUser(next);
      return next;
    }catch(err){
      clearPinnedIdentity();setUser(null);throw err;
    }finally{setLoading(false);}
  };

  const demoLogin = async (role) => {
    setLoading(true);setAuthNotice('');clearAuthCaches();setUser(null);clearPinnedIdentity();
    await closeCurrentRealSession();
    sessionStorage.setItem('soils_demo_role', role);localStorage.removeItem('soils_demo_role');
    const next=demoUser(role);pinIdentity(next);setUser(next);setLoading(false);
  };

  const logout = async () => {
    setLoading(true);setAuthNotice('');clearAuthCaches();
    sessionStorage.removeItem('soils_demo_role');localStorage.removeItem('soils_demo_role');clearPinnedIdentity();
    await closeCurrentRealSession();setUser(null);setLoading(false);
  };

  const role = roleOf(user);
  const value = useMemo(() => ({ user, role, loading, login, demoLogin, logout, authNotice, clearAuthNotice:()=>setAuthNotice('') }), [user, role, loading,authNotice]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
