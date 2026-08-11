import { useState } from 'react';
import { BarChart3, ChevronDown, LayoutDashboard, LogOut, MapPinned, RadioTower, Sprout, UserRound, UsersRound } from 'lucide-react';
import Brand from './Brand';

const adminItems = [
  { key:'overview', label:'Overview', icon:LayoutDashboard },
  { key:'farm', label:'My Farm', icon:MapPinned },
  { key:'statistics', label:'Statistics', icon:BarChart3 },
  { key:'sensors', label:'Sensors', icon:RadioTower },
];

const farmerItems = [
  { key:'overview', label:'Overview', icon:LayoutDashboard },
  { key:'farm', label:'My Farm', icon:MapPinned },
  { key:'sensors', label:'Sensors', icon:RadioTower },
  { key:'analysis', label:'Soil Analysis', icon:BarChart3 },
];

export default function AppTopbar({ role='admin', view, setView, farms=[], activeFarmId, openFarm, user, logout }) {
  const [farmerOpen,setFarmerOpen]=useState(false);
  const items=role==='admin'?adminItems:farmerItems;
  const activeFarm=farms.find(f=>f.id===activeFarmId);
  return <div className="app-topbar-wrap">
    <header className={`app-topbar role-${role}`} aria-label="SOILS workspace toolbar">
      <div className="topbar-brand"><Brand/></div>
      <nav className="topbar-nav" aria-label="Workspace sections">
        {items.map(({key,label,icon:Icon})=><button type="button" key={key} className={view===key?'active':''} onClick={()=>{setFarmerOpen(false);setView(key)}}><Icon size={15}/><span>{label}</span></button>)}
      </nav>
      {role==='admin'&&<div className={`topbar-farm-switch ${farmerOpen?'open':''}`}>
        <button type="button" className={`topbar-farm-trigger ${view==='farmer'?'active':''}`} onClick={()=>setFarmerOpen(v=>!v)} aria-expanded={farmerOpen}>
          <UsersRound size={15}/><span><small>Farmers</small><b>{activeFarm?.farmer_name||`${farms.length} accounts`}</b></span><ChevronDown size={14}/>
        </button>
        {farmerOpen&&<div className="topbar-farm-menu">
          <div className="topbar-menu-head"><span>FARMER ACCOUNTS</span><b>{farms.length}</b></div>
          {farms.length?farms.map((farm,i)=><button type="button" key={farm.id} className={activeFarmId===farm.id?'active':''} onClick={()=>{setFarmerOpen(false);openFarm(farm.id)}}><span className="farmer-avatar"><Sprout size={13}/></span><span><b>{farm.farmer_name||`Farmer ${i+1}`}</b><small>{farm.name}</small></span></button>):<div className="topbar-menu-empty">No farmer accounts yet.</div>}
        </div>}
      </div>}
      <div className="topbar-account"><span className="avatar"><UserRound size={16}/></span><span><b>{user?.name||'User'}</b><small>{role==='admin'?'Administrator':'Farmer account'}</small></span></div>
      <button type="button" className="topbar-signout" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={16}/></button>
    </header>
  </div>;
}
