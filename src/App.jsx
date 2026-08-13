import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
const DashboardPage=lazy(()=>import('./pages/DashboardPage'));

function Guard({ role, children }) {
  const { user, role:currentRole, loading }=useAuth();
  if(loading) return <div className="loading-screen fullscreen"><div className="loader"/><b>Starting SOILS…</b></div>;
  if(!user) return <Navigate to="/login" replace/>;
  if(role && currentRole!==role) return <Navigate to={currentRole==='admin'?'/admin':'/farm'} replace/>;
  return children;
}
function HomeRedirect(){
  const {user,role,loading}=useAuth();
  if(loading)return <div className="loading-screen fullscreen"><div className="loader"/><b>Starting SOILS…</b></div>;
  if(!user)return <Navigate to="/login" replace/>;
  return <Navigate to={role==='admin'?'/admin':'/farm'} replace/>;
}

export default function App(){return <Routes>
  <Route path="/login" element={<LoginPage/>}/>
  <Route path="/admin/*" element={<Guard role="admin"><Suspense fallback={<div className="loading-screen fullscreen"><div className="loader"/><b>Loading farm workspace…</b></div>}><DashboardPage mode="admin"/></Suspense></Guard>}/>
  <Route path="/farm/*" element={<Guard role="farmer"><Suspense fallback={<div className="loading-screen fullscreen"><div className="loader"/><b>Loading farm workspace…</b></div>}><DashboardPage mode="farmer"/></Suspense></Guard>}/>
  <Route path="/" element={<HomeRedirect/>}/>
  <Route path="*" element={<HomeRedirect/>}/>
</Routes>}
