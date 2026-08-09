import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { account, realtime } from '../lib/appwrite';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const demoRole = localStorage.getItem('soils_demo_role');
    if (demoRole) {
      setUser({ $id: `demo-${demoRole}`, name: demoRole === 'admin' ? 'Demo Administrator' : 'Farmer 1', email: `${demoRole}@demo.local`, labels:[demoRole], demo:true });
      setLoading(false);
      return;
    }
    account.get().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    await account.createEmailPasswordSession({ email, password });
    const next = await account.get();
    localStorage.removeItem('soils_demo_role');
    setUser(next);
    return next;
  };

  const demoLogin = (role) => {
    localStorage.setItem('soils_demo_role', role);
    setUser({ $id:`demo-${role}`, name:role === 'admin' ? 'Demo Administrator' : 'Farmer 1', email:`${role}@demo.local`, labels:[role], demo:true });
  };

  const logout = async () => {
    const wasDemo = user?.demo;
    localStorage.removeItem('soils_demo_role');
    if (!wasDemo) { try { await account.deleteSession({ sessionId:'current' }); } catch {} }
    try { await realtime.disconnect(); } catch {}
    setUser(null);
  };

  const role = user?.labels?.includes('admin') ? 'admin' : user ? 'farmer' : null;
  const value = useMemo(() => ({ user, role, loading, login, demoLogin, logout }), [user, role, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
