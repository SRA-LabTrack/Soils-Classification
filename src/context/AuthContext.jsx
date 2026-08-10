import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { account, realtime } from '../lib/appwrite';
import { clearFarmerSyncToken } from '../services/farmerService';
import { clearAdminSyncToken } from '../services/adminService';

const AuthContext = createContext(null);

const demoUser=(role)=>({
  $id:`demo-${role}`,
  name:role==='admin'?'Demo Administrator':'Farmer 1',
  email:`${role}@demo.local`,
  labels:[role],
  demo:true,
});

function clearAuthCaches(){
  clearFarmerSyncToken();
  clearAdminSyncToken();
}

async function closeCurrentRealSession(){
  try{await realtime.disconnect();}catch{}
  try{await account.deleteSession({sessionId:'current'});}catch{}
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive=true;
    localStorage.removeItem('soils_demo_role');
    const demoRole=sessionStorage.getItem('soils_demo_role');
    if(demoRole==='admin'||demoRole==='farmer'){
      if(alive){setUser(demoUser(demoRole));setLoading(false);}
      return ()=>{alive=false;};
    }

    account.get()
      .then(next=>{if(alive)setUser(next);})
      .catch(()=>{if(alive)setUser(null);})
      .finally(()=>{if(alive)setLoading(false);});
    return ()=>{alive=false;};
  }, []);

  useEffect(()=>{
    if(!user || user?.demo) return undefined;
    let alive=true;
    let checking=false;
    const validate=async()=>{
      if(checking) return;
      checking=true;
      try{
        const next=await account.get();
        if(!alive)return;
        if(next?.$id!==user?.$id){
          clearAuthCaches();
          setUser(next||null);
        }
      }catch{
        if(alive){clearAuthCaches();setUser(null);}
      }finally{checking=false;}
    };
    const onFocus=()=>validate();
    const onVisibility=()=>{if(document.visibilityState==='visible')validate();};
    window.addEventListener('focus',onFocus);
    document.addEventListener('visibilitychange',onVisibility);
    return ()=>{
      alive=false;
      window.removeEventListener('focus',onFocus);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[user?.$id,user?.demo]);

  const login = async (email, password) => {
    setLoading(true);
    clearAuthCaches();
    sessionStorage.removeItem('soils_demo_role');
    localStorage.removeItem('soils_demo_role');
    setUser(null);
    await closeCurrentRealSession();

    try{
      await account.createEmailPasswordSession({ email, password });
      const next = await account.get();
      clearAuthCaches();
      setUser(next);
      return next;
    }catch(err){
      setUser(null);
      throw err;
    }finally{
      setLoading(false);
    }
  };

  const demoLogin = async (role) => {
    setLoading(true);
    clearAuthCaches();
    setUser(null);
    await closeCurrentRealSession();
    sessionStorage.setItem('soils_demo_role', role);
    localStorage.removeItem('soils_demo_role');
    setUser(demoUser(role));
    setLoading(false);
  };

  const logout = async () => {
    setLoading(true);
    clearAuthCaches();
    sessionStorage.removeItem('soils_demo_role');
    localStorage.removeItem('soils_demo_role');
    await closeCurrentRealSession();
    setUser(null);
    setLoading(false);
  };

  const role = user?.labels?.includes('admin') ? 'admin' : user ? 'farmer' : null;
  const value = useMemo(() => ({ user, role, loading, login, demoLogin, logout }), [user, role, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
