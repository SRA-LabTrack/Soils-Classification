import { BarChart3, ChevronRight, LayoutDashboard, LogOut, MapPinned, RadioTower, Sprout, UserRound } from 'lucide-react';
import Brand from './Brand';

const main = [
  { key:'overview', label:'Overview', icon:LayoutDashboard },
  { key:'farm', label:'My Farm', icon:MapPinned },
  { key:'statistics', label:'Statistics', icon:BarChart3 },
  { key:'sensors', label:'Sensors', icon:RadioTower },
];

export default function AppSidebar({ role='admin', view, setView, farms=[], activeFarmId, openFarm, user, logout }) {
  const farmerMain = [
    { key:'overview', label:'Overview', icon:LayoutDashboard },
    { key:'farm', label:'My Farm', icon:MapPinned },
    { key:'sensors', label:'Sensors', icon:RadioTower },
    { key:'analysis', label:'Soil Analysis', icon:BarChart3 },
  ];
  const items = role==='admin' ? main : farmerMain;
  return <aside className="sidebar">
    <div className="sidebar-top"><Brand/></div>
    <nav className="sidebar-nav">
      <div className="nav-label">Workspace</div>
      {items.map(({key,label,icon:Icon}) => <button key={key} className={`nav-item ${view===key?'active':''}`} onClick={()=>setView(key)}><Icon size={18}/><span>{label}</span></button>)}
      {role==='admin' && <>
        <div className="nav-label farmer-label">Farmers <span>{farms.length}</span></div>
        <div className="farmer-list">
          {farms.map((farm, i) => <button key={farm.id} className={`farmer-item ${activeFarmId===farm.id?'active':''}`} onClick={()=>openFarm(farm.id)}>
            <div className="farmer-avatar"><Sprout size={14}/></div><div><b>{farm.farmer_name || `Farmer ${i+1}`}</b><small>{farm.name}</small></div><ChevronRight size={15}/>
          </button>)}
        </div>
      </>}
    </nav>
    <div className="sidebar-bottom">
      <div className="account-mini"><div className="avatar"><UserRound size={17}/></div><div><b>{user?.name || 'User'}</b><small>{role==='admin'?'Administrator':'Farmer account'}</small></div></div>
      <button className="logout-btn" onClick={logout}><LogOut size={17}/> Sign out</button>
      <div className="powered">Powered by <strong>Luntian</strong><small className="build-version">SOILS v1.10.18</small></div>
    </div>
  </aside>
}
