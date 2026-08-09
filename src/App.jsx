import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';

function Guard({ role, children }) {
  const { user, role:currentRole, loading }=useAuth();
  if(loading) return <div className="loading-screen fullscreen"><div className="loader"/><b>Starting SOILS…</b></div>;
  if(!user) return <Navigate to="/login" replace/>;
  if(role && currentRole!==role) return <Navigate to={currentRole==='admin'?'/admin':'/farm'} replace/>;
  return children;
}

export default function App(){return <Routes>
  <Route path="/login" element={<LoginPage/>}/>
  <Route path="/admin/*" element={<Guard role="admin"><DashboardPage mode="admin"/></Guard>}/>
  <Route path="/farm/*" element={<Guard role="farmer"><DashboardPage mode="farmer"/></Guard>}/>
  <Route path="*" element={<Navigate to="/login" replace/>}/>
</Routes>}
