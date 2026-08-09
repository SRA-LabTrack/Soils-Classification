import { useEffect, useMemo, useState } from 'react';
import { Activity, FlaskConical, Gauge, LandPlot, Leaf, MapPin, Plus, RadioTower, ScanLine, Sprout, TestTube2, Trash2 } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { soilDistribution, trendData } from '../data/demoData';
import { listAllDroneMappings, listAllPlots, listAllSensors, listFarms, loadFarmBundle, loadFarmerWorkspace, subscribeFarmChanges } from '../services/dataService';
import { applyDemoAction, getDemoState, DEMO_STORE_KEY } from '../services/demoStore';
import { adminAction } from '../services/adminService';
import AppSidebar from '../components/AppSidebar';
import LayerVisibility from '../components/LayerVisibility';
import MapModeTabs from '../components/MapModeTabs';
import MapToolbar from '../components/MapToolbar';
import MetricCard from '../components/MetricCard';
import Modal from '../components/Modal';
import SensorInspector from '../components/SensorInspector';
import DroneInspector from '../components/DroneInspector';
import SoilMap from '../components/SoilMap';
import StatusPill from '../components/StatusPill';
import SpatialPreview from '../components/SpatialPreview';

const avg=(arr,key)=>arr.length?(arr.reduce((s,x)=>s+(Number(x[key])||0),0)/arr.length):0;
const number=(n,d=0)=>Number(n||0).toFixed(d);
const niceDate=(v)=>v?new Intl.DateTimeFormat('en-PH',{month:'short',day:'numeric',year:'numeric'}).format(new Date(v)):'No record';
const modeVisibility=(mode)=>({farmBoundary:true,sensors:true,sensorCoverage:true,soilPlots:mode==='analysis',droneMapping:mode==='drone'});

function Header({title,subtitle,action}) { return <header className="page-header"><div><span>SOIL MONITORING</span><h1>{title}</h1><p>{subtitle}</p></div><div className="header-actions">{action}<div className="live-chip"><i/> System active</div></div></header> }
function Empty({text,sub='No records are available for this section yet.'}) { return <div className="empty-state"><Sprout size={28}/><b>{text}</b><span>{sub}</span></div> }

function polygonStats(points=[]) {
  if (!points.length) return {center_lat:10.4247,center_lng:122.9225,area_hectares:0};
  const lat0=points.reduce((s,p)=>s+p[0],0)/points.length;
  const lng0=points.reduce((s,p)=>s+p[1],0)/points.length;
  const cos=Math.cos(lat0*Math.PI/180);
  const xy=points.map(([lat,lng])=>[(lng-lng0)*111320*cos,(lat-lat0)*111320]);
  let sum=0; for(let i=0;i<xy.length;i++){const [x1,y1]=xy[i], [x2,y2]=xy[(i+1)%xy.length]; sum+=x1*y2-x2*y1;}
  return {center_lat:lat0,center_lng:lng0,area_hectares:Math.abs(sum)/2/10000};
}

function MapWorkspace({
  farms, sensors, plots, droneMappings, activeFarmId, onFarmClick, admin=false, height=560,
  selectedSensorId, selectedPlotId, selectedDroneId, focusTarget, onSensorClick, onPlotClick, onDroneClick, onDroneDelete,
  drawMode, drawPoints, onMapPoint, drawCoverageM, toolbar, showMapPopups=true,
}) {
  const [mapMode,setMapMode]=useState('farm');
  const [visibility,setVisibility]=useState(modeVisibility('farm'));
  const [visibleSensorIds,setVisibleSensorIds]=useState(sensors.map(s=>s.id));
  const [visiblePlotIds,setVisiblePlotIds]=useState(plots.map(p=>p.id));
  useEffect(()=>setVisibleSensorIds(sensors.map(s=>s.id)),[sensors.map(s=>s.id).join('|')]);
  useEffect(()=>setVisiblePlotIds(plots.map(p=>p.id)),[plots.map(p=>p.id).join('|')]);
  const changeMode=(next)=>{setMapMode(next);setVisibility(v=>({...v,soilPlots:next==='analysis',droneMapping:next==='drone'}));};
  useEffect(()=>{
    if(drawMode==='plot'||selectedPlotId){setMapMode('analysis');setVisibility(v=>({...v,soilPlots:true,droneMapping:false}));return;}
    if(drawMode==='drone'||selectedDroneId){setMapMode('drone');setVisibility(v=>({...v,soilPlots:false,droneMapping:true}));return;}
    if(drawMode==='farm'){setMapMode('farm');setVisibility(v=>({...v,soilPlots:false,droneMapping:false}));}
  },[drawMode,selectedPlotId,selectedDroneId]);
  const sensorToggle=(id,checked)=>setVisibleSensorIds(v=>checked?[...new Set([...v,id])]:v.filter(x=>x!==id));
  const plotToggle=(id,checked)=>setVisiblePlotIds(v=>checked?[...new Set([...v,id])]:v.filter(x=>x!==id));
  return <section className="panel map-panel map-workspace">
    <div className="map-workspace-head"><MapModeTabs value={mapMode} onChange={changeMode}/><LayerVisibility visibility={visibility} onChange={setVisibility} sensors={sensors} visibleSensorIds={visibleSensorIds} onSensorToggle={sensorToggle} plots={plots} visiblePlotIds={visiblePlotIds} onPlotToggle={plotToggle}/></div>
    {admin && toolbar}
    <SoilMap farms={farms} sensors={sensors} plots={plots} droneMappings={droneMappings} height={height} selectedFarmId={activeFarmId} onFarmClick={onFarmClick} visibility={visibility} visibleSensorIds={visibleSensorIds} visiblePlotIds={visiblePlotIds} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSensorClick={onSensorClick} onPlotClick={onPlotClick} onDroneClick={onDroneClick} onDroneDelete={onDroneDelete} canDeleteDrone={admin} drawMode={drawMode} drawPoints={drawPoints} onMapPoint={onMapPoint} drawCoverageM={drawCoverageM} showMapPopups={showMapPopups}/>
  </section>;
}

export default function DashboardPage({ mode='admin' }) {
  const { user, logout }=useAuth();
  const [view,setView]=useState('overview');
  const [farms,setFarms]=useState([]); const [allSensors,setAllSensors]=useState([]); const [allPlots,setAllPlots]=useState([]); const [allDrone,setAllDrone]=useState([]);
  const [activeFarmId,setActiveFarmId]=useState(null); const [bundle,setBundle]=useState(null);
  const [loading,setLoading]=useState(true); const [notice,setNotice]=useState(''); const [busy,setBusy]=useState(false);
  const [selectedSensorId,setSelectedSensorId]=useState(null); const [selectedPlotId,setSelectedPlotId]=useState(null); const [selectedDroneId,setSelectedDroneId]=useState(null); const [focusTarget,setFocusTarget]=useState(null);
  const [drawMode,setDrawMode]=useState(null); const [drawPoints,setDrawPoints]=useState([]); const [pendingShape,setPendingShape]=useState(null); const [modal,setModal]=useState(null);
  const isDemo=!!user?.demo; const isAdmin=mode==='admin';

  const decorate=(rows)=>rows.map(row=>({...row,farm_name:farms.find(f=>f.id===row.farm_id)?.name || farms.find(f=>f.id===row.farm_id)?.farmer_name || ''}));
  const loadLocalDemoBundle=(farmId)=>{const state=getDemoState();return {farm:state.farms.find(f=>f.id===farmId)||state.farms[0],sensors:state.sensors.filter(s=>s.farm_id===farmId),plots:state.plots.filter(p=>p.farm_id===farmId),droneMappings:state.drone.filter(d=>d.farm_id===farmId)}};

  async function refresh({keepFarm=true,showLoading=true}={}) {
    if(showLoading){setLoading(true);setNotice('');}
    try {
      if(isDemo){
        const state=getDemoState();
        const firstFarm=state.farms[0];
        const nextFarms=isAdmin?state.farms:(firstFarm?[firstFarm]:[]);
        const scopedFarmId=firstFarm?.id;
        const nextSensors=isAdmin?state.sensors:state.sensors.filter(s=>s.farm_id===scopedFarmId);
        const nextPlots=isAdmin?state.plots:state.plots.filter(p=>p.farm_id===scopedFarmId);
        const nextDrone=isAdmin?state.drone:state.drone.filter(d=>d.farm_id===scopedFarmId);
        setFarms(nextFarms); setAllSensors(nextSensors); setAllPlots(nextPlots); setAllDrone(nextDrone);
        const farmId=keepFarm&&activeFarmId&&nextFarms.some(f=>f.id===activeFarmId)?activeFarmId:nextFarms[0]?.id;
        setActiveFarmId(farmId||null); setBundle(farmId?loadLocalDemoBundle(farmId):null); return;
      }
      if(!isAdmin){
        const farmerWorkspace=await loadFarmerWorkspace(user?.$id);
        const farmId=farmerWorkspace.farmId;
        const b=farmerWorkspace.bundle;
        setActiveFarmId(farmId||null);
        setBundle(b);
        setFarms(b?.farm?[b.farm]:[]);
        setAllSensors(b?.sensors||[]);
        setAllPlots(b?.plots||[]);
        setAllDrone(b?.droneMappings||[]);
        return;
      }

      const nextFarms=await listFarms(); setFarms(nextFarms);
      const [sensors,plots,drone]=await Promise.all([listAllSensors(),listAllPlots(),listAllDroneMappings()]);
      const farmId=keepFarm&&activeFarmId&&nextFarms.some(f=>f.id===activeFarmId)?activeFarmId:nextFarms[0]?.id;
      setActiveFarmId(farmId||null);
      if(farmId) setBundle(await loadFarmBundle(farmId));
      else setBundle(null);
      setAllSensors(sensors);setAllPlots(plots);setAllDrone(drone);
    } catch(err){console.error(err);setNotice(err.message||'Unable to load Appwrite data.');}
    finally{if(showLoading)setLoading(false);}
  }
  useEffect(()=>{refresh({keepFarm:false});},[isDemo,mode,user?.$id]);

  useEffect(()=>{
    if(isAdmin || !activeFarmId) return undefined;
    let cancelled=false;
    let realtimeCleanup=()=>{};
    let realtimeDebounce=null;
    let fallbackTimer=null;

    const applyBundle=(nextBundle)=>{
      if(cancelled || !nextBundle?.farm) return;
      setBundle(nextBundle);
      setFarms([nextBundle.farm]);
      setAllSensors(nextBundle.sensors||[]);
      setAllPlots(nextBundle.plots||[]);
      setAllDrone(nextBundle.droneMappings||[]);
    };

    const pullLatest=async()=>{
      try{
        const nextBundle=isDemo?loadLocalDemoBundle(activeFarmId):await loadFarmBundle(activeFarmId);
        applyBundle(nextBundle);
      }catch(err){
        if(!cancelled) console.warn('Farmer sync refresh failed:',err);
      }
    };

    const scheduleRealtimePull=()=>{
      clearTimeout(realtimeDebounce);
      realtimeDebounce=setTimeout(pullLatest,160);
    };
    const onFocus=()=>pullLatest();
    const onVisibility=()=>{if(document.visibilityState==='visible')pullLatest();};
    window.addEventListener('focus',onFocus);
    document.addEventListener('visibilitychange',onVisibility);

    if(isDemo){
      const onStorage=(event)=>{if(event.key===DEMO_STORE_KEY)scheduleRealtimePull();};
      window.addEventListener('storage',onStorage);
      realtimeCleanup=()=>window.removeEventListener('storage',onStorage);
    }else{
      subscribeFarmChanges(activeFarmId,scheduleRealtimePull)
        .then((cleanup)=>{if(cancelled)cleanup?.();else realtimeCleanup=cleanup;})
        .catch((err)=>console.warn('Realtime sync unavailable; focus/interval refresh remains active.',err));
      fallbackTimer=setInterval(pullLatest,20000);
    }

    return ()=>{
      cancelled=true;
      clearTimeout(realtimeDebounce);
      clearInterval(fallbackTimer);
      window.removeEventListener('focus',onFocus);
      document.removeEventListener('visibilitychange',onVisibility);
      Promise.resolve(realtimeCleanup?.()).catch(()=>{});
    };
  },[isAdmin,isDemo,activeFarmId,user?.$id]);

  async function openFarm(id, targetView=isAdmin?'farmer':'farm') {
    setActiveFarmId(id); setSelectedSensorId(null);setSelectedPlotId(null);setSelectedDroneId(null);setFocusTarget(null); setView(targetView);
    try{setBundle(isDemo?loadLocalDemoBundle(id):await loadFarmBundle(id));}catch(err){setNotice(err.message);}
  }
  const current=bundle?.farm || farms.find(f=>f.id===activeFarmId) || farms[0];
  const sensors=bundle?.sensors||[]; const plots=bundle?.plots||[]; const droneMappings=bundle?.droneMappings||[];
  const farmNameMap=useMemo(()=>new Map(farms.map(f=>[f.id,`${f.farmer_name} • ${f.name}`])),[farms]);
  const sensorGlobal=useMemo(()=>allSensors.map(s=>({...s,farm_name:farmNameMap.get(s.farm_id)||'Unknown farm'})),[allSensors,farmNameMap]);
  const plotGlobal=useMemo(()=>allPlots.map(p=>({...p,farm_name:farmNameMap.get(p.farm_id)||'Unknown farm'})),[allPlots,farmNameMap]);
  const online=allSensors.filter(s=>s.status!=='Offline').length;

  const ensureWrite=()=>{if(!isAdmin){setNotice('Only administrator accounts can modify map records.');return false;}return true;};
  const localId=(prefix)=>`${prefix}-pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  const closeSpatialUi=()=>{setModal(null);setDrawMode(null);setDrawPoints([]);setPendingShape(null);};

  function syncDemoState(farmId=activeFarmId){
    const state=getDemoState();
    const firstFarm=state.farms[0];
    const nextFarms=isAdmin?state.farms:(firstFarm?[firstFarm]:[]);
    const scopedFarmId=firstFarm?.id;
    const nextSensors=isAdmin?state.sensors:state.sensors.filter(s=>s.farm_id===scopedFarmId);
    const nextPlots=isAdmin?state.plots:state.plots.filter(p=>p.farm_id===scopedFarmId);
    const nextDrone=isAdmin?state.drone:state.drone.filter(d=>d.farm_id===scopedFarmId);
    setFarms(nextFarms);setAllSensors(nextSensors);setAllPlots(nextPlots);setAllDrone(nextDrone);
    const targetFarmId=farmId&&nextFarms.some(f=>f.id===farmId)?farmId:nextFarms[0]?.id;
    setActiveFarmId(targetFarmId||null);
    setBundle(targetFarmId?{farm:state.farms.find(f=>f.id===targetFarmId),sensors:state.sensors.filter(s=>s.farm_id===targetFarmId),plots:state.plots.filter(p=>p.farm_id===targetFarmId),droneMappings:state.drone.filter(d=>d.farm_id===targetFarmId)}:null);
  }

  function applyOptimistic(action,payload,tempId){
    const stamp=new Date().toISOString();
    if(action==='updateFarmBoundary'||action==='deleteFarmBoundary'){
      const patch=action==='updateFarmBoundary'
        ? {boundary:[...(payload.geojson||[])],center_lat:Number(payload.center_lat),center_lng:Number(payload.center_lng),area_hectares:Number(payload.area_hectares||0),status:payload.status||'Mapped'}
        : {boundary:[],area_hectares:0,status:'Unmapped'};
      setFarms(rows=>rows.map(f=>f.id===payload.farm_id?{...f,...patch}:f));
      setBundle(b=>b?.farm?.id===payload.farm_id?{...b,farm:{...b.farm,...patch}}:b);
      return;
    }
    if(action==='createSensor'){
      const row={id:tempId,farm_id:payload.farm_id,sensor_code:payload.sensor_code||'Sensor',latitude:Number(payload.latitude),longitude:Number(payload.longitude),coverage_m:Number(payload.coverage_m||50),status:payload.status||'Online',nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),moisture:Number(payload.moisture||0),recorded_at:stamp};
      setAllSensors(rows=>[...rows,row]);
      setBundle(b=>b?.farm?.id===payload.farm_id?{...b,sensors:[...b.sensors,row]}:b);
      return;
    }
    if(action==='updateSensor'){
      const patch={sensor_code:payload.sensor_code,latitude:Number(payload.latitude),longitude:Number(payload.longitude),coverage_m:Number(payload.coverage_m||50),status:payload.status||'Online',nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),moisture:Number(payload.moisture||0),recorded_at:stamp};
      setAllSensors(rows=>rows.map(row=>row.id===payload.sensor_id?{...row,...patch}:row));
      setBundle(b=>b?{...b,sensors:b.sensors.map(row=>row.id===payload.sensor_id?{...row,...patch}:row)}:b);
      return;
    }
    if(action==='deleteSensor'){
      setAllSensors(rows=>rows.filter(row=>row.id!==payload.sensor_id));
      setBundle(b=>b?{...b,sensors:b.sensors.filter(row=>row.id!==payload.sensor_id)}:b);
      if(selectedSensorId===payload.sensor_id)setSelectedSensorId(null);
      return;
    }
    if(action==='createPlot'){
      const row={id:tempId,farm_id:payload.farm_id,plot_code:payload.plot_code||'Soil Plot',latitude:Number(payload.latitude),longitude:Number(payload.longitude),coverage_m:Number(payload.coverage_m||0),boundary:[...(payload.geojson||[])],nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),classification:payload.classification||'Pending',notes:payload.notes||'',analyzed_at:stamp};
      setAllPlots(rows=>[...rows,row]);
      setBundle(b=>b?.farm?.id===payload.farm_id?{...b,plots:[...b.plots,row]}:b);
      return;
    }
    if(action==='deletePlot'){
      setAllPlots(rows=>rows.filter(row=>row.id!==payload.plot_id));
      setBundle(b=>b?{...b,plots:b.plots.filter(row=>row.id!==payload.plot_id)}:b);
      if(selectedPlotId===payload.plot_id)setSelectedPlotId(null);
      return;
    }
    if(action==='createDroneMapping'){
      const row={id:tempId,farm_id:payload.farm_id,name:payload.name||'Drone Mapping',boundary:[...(payload.geojson||[])],latitude:Number(payload.center_lat||0),longitude:Number(payload.center_lng||0),center_lat:Number(payload.center_lat||0),center_lng:Number(payload.center_lng||0),area_hectares:Number(payload.area_hectares||0),nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),moisture:Number(payload.moisture||0),classification:payload.classification||'Unclassified',notes:payload.notes||'',image_url:payload.image_url||'',captured_at:payload.captured_at||stamp,status:payload.status||'Mapped'};
      setAllDrone(rows=>[...rows,row]);
      setBundle(b=>b?.farm?.id===payload.farm_id?{...b,droneMappings:[...b.droneMappings,row]}:b);
      setSelectedDroneId(tempId);
      setFocusTarget(row);
      return;
    }
    if(action==='updateDroneMapping'){
      const patch={name:payload.name,area_hectares:Number(payload.area_hectares||0),nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),moisture:Number(payload.moisture||0),classification:payload.classification||'Unclassified',notes:payload.notes||'',image_url:payload.image_url||'',captured_at:payload.captured_at,status:payload.status||'Mapped'};
      setAllDrone(rows=>rows.map(row=>row.id===payload.drone_id?{...row,...patch}:row));
      setBundle(b=>b?{...b,droneMappings:b.droneMappings.map(row=>row.id===payload.drone_id?{...row,...patch}:row)}:b);
      return;
    }
    if(action==='deleteDroneMapping'){
      setAllDrone(rows=>rows.filter(row=>row.id!==payload.drone_id));
      setBundle(b=>b?{...b,droneMappings:b.droneMappings.filter(row=>row.id!==payload.drone_id)}:b);
      if(selectedDroneId===payload.drone_id)setSelectedDroneId(null);
    }
  }

  function reconcileTempId(action,tempId,result){
    const realId=action==='createSensor'?result?.sensorId:action==='createPlot'?result?.plotId:action==='createDroneMapping'?result?.droneId:null;
    if(!tempId||!realId)return;
    if(action==='createSensor'){
      setAllSensors(rows=>rows.map(row=>row.id===tempId?{...row,id:realId}:row));
      setBundle(b=>b?{...b,sensors:b.sensors.map(row=>row.id===tempId?{...row,id:realId}:row)}:b);
    } else if(action==='createPlot'){
      setAllPlots(rows=>rows.map(row=>row.id===tempId?{...row,id:realId}:row));
      setBundle(b=>b?{...b,plots:b.plots.map(row=>row.id===tempId?{...row,id:realId}:row)}:b);
    } else if(action==='createDroneMapping'){
      setAllDrone(rows=>rows.map(row=>row.id===tempId?{...row,id:realId}:row));
      setBundle(b=>b?{...b,droneMappings:b.droneMappings.map(row=>row.id===tempId?{...row,id:realId}:row)}:b);
      setSelectedDroneId(id=>id===tempId?realId:id);
      setFocusTarget(target=>target?.id===tempId?{...target,id:realId}:target);
    }
  }

  async function runSpatialAction(action,payload,success,{tempId=null}={}){
    if(!ensureWrite())return;
    const snapshot={farms,allSensors,allPlots,allDrone,bundle,selectedSensorId,selectedPlotId,selectedDroneId,focusTarget};
    closeSpatialUi();
    if(isDemo){
      try{applyDemoAction(action,payload);syncDemoState(payload.farm_id||activeFarmId);setNotice(`${success} Demo changes are saved in this browser.`);}catch(err){setNotice(err.message);}
      return;
    }
    applyOptimistic(action,payload,tempId);
    setBusy(true);
    try{
      const result=await adminAction(action,payload);
      reconcileTempId(action,tempId,result);
      setNotice(success);
    }catch(err){
      setFarms(snapshot.farms);setAllSensors(snapshot.allSensors);setAllPlots(snapshot.allPlots);setAllDrone(snapshot.allDrone);setBundle(snapshot.bundle);
      setSelectedSensorId(snapshot.selectedSensorId);setSelectedPlotId(snapshot.selectedPlotId);setSelectedDroneId(snapshot.selectedDroneId);setFocusTarget(snapshot.focusTarget);
      setNotice(`Appwrite rejected the change, so the map was restored. ${err.message}`);
    }finally{setBusy(false);}
  }

  async function runAction(action,payload,success){
    if(!ensureWrite())return;
    setBusy(true);
    try{
      if(isDemo){applyDemoAction(action,payload);syncDemoState(payload.farm_id||activeFarmId);}
      else {await adminAction(action,payload);await refresh({showLoading:false});}
      setNotice(isDemo?`${success} Demo changes are saved in this browser.`:success);
      setModal(null);setDrawMode(null);setDrawPoints([]);setPendingShape(null);
    }catch(err){setNotice(err.message);}finally{setBusy(false);}
  }

  const startDraw=(kind)=>{if(!ensureWrite())return;if(!activeFarmId){setNotice('Select a farmer/farm first.');return;}setSelectedSensorId(null);setSelectedPlotId(null);setSelectedDroneId(null);setDrawPoints([]);setDrawMode(kind);};
  const cancelDraw=()=>{setDrawMode(null);setDrawPoints([]);setPendingShape(null);};
  const mapPoint=(point)=>setDrawPoints(v=>drawMode==='sensor'?[point]:[...v,point]);
  const continueDraw=()=>{
    if(drawMode==='farm') return saveFarmBoundary();
    setPendingShape({type:drawMode,points:[...drawPoints]}); setModal(drawMode); setDrawMode(null);
  };
  const saveFarmBoundary=()=>{const stats=polygonStats(drawPoints);runSpatialAction('updateFarmBoundary',{farm_id:activeFarmId,geojson:drawPoints,...stats,status:'Mapped'},'Farm boundary saved instantly and synced to Appwrite.');};
  const deleteBoundary=()=>{if(!current?.boundary?.length)return;if(confirm(`Delete the mapped boundary for ${current.name}?`))runSpatialAction('deleteFarmBoundary',{farm_id:current.id},'Farm boundary deleted and synced.');};
  const deleteFarmer=()=>{if(current&&confirm(`Delete ${current.farmer_name}, their login, farm, sensors, plots, analyses, and drone mappings?`))runAction('deleteFarmer',{farmer_id:current.farmer_id,farm_id:current.id},'Farmer and associated farm data deleted.');};

  const clearSpatialSelection=()=>{setSelectedSensorId(null);setSelectedPlotId(null);setSelectedDroneId(null);setFocusTarget(null);};

  async function selectSensor(sensor, openSensorView=false){
    if(!sensor?.id){clearSpatialSelection();return;}
    const target={...sensor,latitude:Number(sensor.latitude),longitude:Number(sensor.longitude)};
    setSelectedSensorId(sensor.id);setSelectedPlotId(null);setSelectedDroneId(null);setFocusTarget(target);if(openSensorView)setView('sensors');
    if(isAdmin && sensor.farm_id && sensor.farm_id!==activeFarmId){setActiveFarmId(sensor.farm_id);try{setBundle(isDemo?loadLocalDemoBundle(sensor.farm_id):await loadFarmBundle(sensor.farm_id));}catch{}}
  }
  async function selectPlot(plot){
    if(!plot?.id){clearSpatialSelection();return;}
    const boundary=plot.boundary||[];
    const latitude=Number(plot.latitude ?? (boundary.length?boundary.reduce((sum,p)=>sum+Number(p[0]||0),0)/boundary.length:0));
    const longitude=Number(plot.longitude ?? (boundary.length?boundary.reduce((sum,p)=>sum+Number(p[1]||0),0)/boundary.length:0));
    const target={...plot,latitude,longitude};
    setSelectedPlotId(plot.id);setSelectedSensorId(null);setSelectedDroneId(null);setFocusTarget(target);
    if(isAdmin && plot.farm_id && plot.farm_id!==activeFarmId){
      setActiveFarmId(plot.farm_id);
      try{setBundle(isDemo?loadLocalDemoBundle(plot.farm_id):await loadFarmBundle(plot.farm_id));}catch{}
    }
  }
  async function selectDrone(drone){
    if(!drone?.id){clearSpatialSelection();return;}
    const boundary=drone.boundary||[];
    const latitude=Number(drone.center_lat ?? drone.latitude ?? (boundary.length?boundary.reduce((sum,p)=>sum+Number(p[0]||0),0)/boundary.length:0));
    const longitude=Number(drone.center_lng ?? drone.longitude ?? (boundary.length?boundary.reduce((sum,p)=>sum+Number(p[1]||0),0)/boundary.length:0));
    const target={...drone,latitude,longitude};
    setSelectedDroneId(drone.id);setSelectedSensorId(null);setSelectedPlotId(null);setFocusTarget(target);
    if(isAdmin && drone.farm_id && drone.farm_id!==activeFarmId){
      setActiveFarmId(drone.farm_id);
      try{setBundle(isDemo?loadLocalDemoBundle(drone.farm_id):await loadFarmBundle(drone.farm_id));}catch{}
    }
  }
  const selectedSensor=(isAdmin?allSensors:sensors).find(s=>s.id===selectedSensorId) || null;
  const selectedPlot=(isAdmin?allPlots:plots).find(p=>p.id===selectedPlotId) || null;
  const selectedDrone=(isAdmin?allDrone:droneMappings).find(d=>d.id===selectedDroneId) || null;

  useEffect(()=>{
    if(isAdmin) return;
    if(selectedSensorId && !sensors.some(s=>s.id===selectedSensorId)) clearSpatialSelection();
    else if(selectedPlotId && !plots.some(p=>p.id===selectedPlotId)) clearSpatialSelection();
    else if(selectedDroneId && !droneMappings.some(d=>d.id===selectedDroneId)) clearSpatialSelection();
  },[isAdmin,selectedSensorId,selectedPlotId,selectedDroneId,sensors.map(s=>s.id).join('|'),plots.map(p=>p.id).join('|'),droneMappings.map(d=>d.id).join('|')]);

  useEffect(()=>{
    if(isAdmin || isDemo || !activeFarmId) return undefined;
    let alive=true;
    loadFarmBundle(activeFarmId).then(next=>{
      if(!alive)return;
      setBundle(next);setFarms(next?.farm?[next.farm]:[]);setAllSensors(next?.sensors||[]);setAllPlots(next?.plots||[]);setAllDrone(next?.droneMappings||[]);
    }).catch(err=>console.warn('Section sync refresh failed:',err));
    return ()=>{alive=false;};
  },[view,isAdmin,isDemo,activeFarmId]);

  const saveSensor=(form)=>runSpatialAction('updateSensor',{sensor_id:form.id,...form},'Sensor readings and coverage updated. The farmer map now uses the new values.');
  const deleteSensor=(sensor)=>{if(confirm(`Delete ${sensor.sensor_code} and all of its readings?`))runSpatialAction('deleteSensor',{sensor_id:sensor.id},'Sensor removed from the map and synced.');};
  const deletePlot=(plot)=>{if(confirm(`Delete ${plot.plot_code} and its soil analysis?`))runSpatialAction('deletePlot',{plot_id:plot.id},'Soil analysis plot removed and synced.');};
  const saveDrone=(form)=>runSpatialAction('updateDroneMapping',{drone_id:form.id,...form},'Drone mapping statistics updated and published.');
  const deleteDrone=(d)=>{if(confirm(`Delete ${d.name}?`))runSpatialAction('deleteDroneMapping',{drone_id:d.id},'Drone mapping removed and synced.');};

  const farmToolbar=<MapToolbar drawMode={drawMode} points={drawPoints} onStart={startDraw} onUndo={()=>setDrawPoints(v=>v.slice(0,-1))} onClear={()=>setDrawPoints([])} onCancel={cancelDraw} onSave={continueDraw} onDeleteBoundary={deleteBoundary} canDeleteBoundary={!!current?.boundary?.length} busy={busy}/>;

  return <div className="app-shell"><AppSidebar role={mode} view={view} setView={setView} farms={farms} activeFarmId={activeFarmId} openFarm={openFarm} user={user} logout={logout}/><main className="main-content">{notice&&<div className="notice-bar"><span>{notice}</span><button onClick={()=>setNotice('')}>×</button></div>}{loading?<div className="loading-screen"><div className="loader"/><b>Loading soil workspace…</b><span>Preparing maps and soil layers</span></div>:<div key={`${mode}-${view}-${activeFarmId||'global'}`} className="view-stage">
    {view==='overview' && isAdmin && <AdminOverview farms={farms} sensors={sensorGlobal} plots={plotGlobal} drone={allDrone} activeFarmId={activeFarmId} openFarm={openFarm} online={online} toolbar={farmToolbar} drawProps={{drawMode,drawPoints,onMapPoint:mapPoint}} selectSensor={selectSensor} onPlot={selectPlot} onDrone={selectDrone} selectedSensor={selectedSensor} selectedDrone={selectedDrone} selectedSensorId={selectedSensorId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSaveSensor={saveSensor} onDeleteSensor={deleteSensor} onSaveDrone={saveDrone} onDeleteDrone={deleteDrone} farmNameMap={farmNameMap} busy={busy} onAddFarmer={()=>setModal('farmer')}/>} 
    {view==='statistics' && isAdmin && <Statistics farms={farms} sensors={allSensors} plots={allPlots} drone={allDrone} activeFarmId={activeFarmId}/>} 
    {view==='sensors' && <SensorPage admin={isAdmin} farms={farms} sensors={isAdmin?sensorGlobal:sensors} plots={isAdmin?plotGlobal:plots} drone={isAdmin?allDrone:droneMappings} activeFarmId={activeFarmId} selectedSensor={selectedSensor} selectedPlot={selectedPlot} selectedDrone={selectedDrone} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSelect={s=>selectSensor(s,false)} onPlot={selectPlot} onDrone={selectDrone} onSave={saveSensor} onDelete={deleteSensor} busy={busy}/>} 
    {(view==='farmer' || (!isAdmin && (view==='farm'||view==='overview'))) && (current?<FarmDetail farm={current} sensors={sensors} plots={plots} drone={droneMappings} userMode={!isAdmin} overview={view==='overview'} admin={isAdmin} toolbar={farmToolbar} drawProps={{drawMode,drawPoints,onMapPoint:mapPoint}} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSensor={s=>selectSensor(s,false)} onPlot={selectPlot} onDrone={selectDrone} selectedSensor={selectedSensor} selectedPlot={selectedPlot} selectedDrone={selectedDrone} onSaveSensor={saveSensor} onSaveDrone={saveDrone} onDeleteSensor={deleteSensor} onDeletePlot={deletePlot} onDeleteDrone={deleteDrone} onDeleteFarmer={deleteFarmer} busy={busy}/>:<Empty text="No farm is assigned to this account"/>)}
    {!isAdmin && view==='analysis' && <AnalysisPage farm={current} sensors={sensors} plots={plots}/>} 
  </div>}

  {modal==='farmer'&&<FarmerModal busy={busy} onClose={()=>setModal(null)} onSave={(data)=>runAction('createFarmer',data,'Farmer account and farm created.')}/>} 
  {modal==='sensor'&&<SensorCreateModal point={pendingShape?.points?.[0]} busy={busy} onClose={()=>{setModal(null);setPendingShape(null)}} onSave={(data)=>{const tempId=localId('sensor');runSpatialAction('createSensor',{farm_id:activeFarmId,latitude:pendingShape.points[0][0],longitude:pendingShape.points[0][1],...data},'Sensor added instantly and synced to Appwrite.',{tempId})}}/>} 
  {modal==='plot'&&<PlotCreateModal points={pendingShape?.points||[]} busy={busy} onClose={()=>{setModal(null);setPendingShape(null)}} onSave={(data)=>{const stats=polygonStats(pendingShape.points);const tempId=localId('plot');runSpatialAction('createPlot',{farm_id:activeFarmId,geojson:pendingShape.points,latitude:stats.center_lat,longitude:stats.center_lng,...data},'Soil analysis plot added instantly and synced to Appwrite.',{tempId}) }}/>} 
  {modal==='drone'&&<DroneCreateModal points={pendingShape?.points||[]} busy={busy} onClose={()=>{setModal(null);setPendingShape(null)}} onSave={(data)=>{const stats=polygonStats(pendingShape.points);const tempId=localId('drone');runSpatialAction('createDroneMapping',{farm_id:activeFarmId,geojson:pendingShape.points,...stats,...data},'Drone mapping added instantly and synced to Appwrite.',{tempId})}}/>} 
  </main></div>;
}

function AdminOverview({
  farms,sensors,plots,drone,activeFarmId,openFarm,online,toolbar,drawProps,
  selectSensor,onPlot,onDrone,selectedSensor,selectedDrone,selectedSensorId,selectedDroneId,focusTarget,
  onSaveSensor,onDeleteSensor,onSaveDrone,onDeleteDrone,farmNameMap,busy,onAddFarmer
}){
  const area=farms.reduce((s,f)=>s+(Number(f.area_hectares)||0),0);
  return <>
    <Header title="Overview" subtitle="Your overall farm network map, soil layers, farmer status, and live field records in one workspace." action={<button className="primary-btn header-btn" onClick={onAddFarmer}><Plus size={15}/>Add farmer</button>}/>
    <div className="metric-grid">
      <MetricCard icon={LandPlot} label="Monitored farms" value={farms.length} note="Registered farmers and boundaries"/>
      <MetricCard icon={RadioTower} label="Active sensors" value={online} suffix={` / ${sensors.length}`} note="Reporting stations" tone="blue"/>
      <MetricCard icon={FlaskConical} label="Soil analysis plots" value={plots.length} note="Laboratory sampling zones" tone="amber"/>
      <MetricCard icon={Activity} label="Coverage area" value={number(area,1)} suffix=" ha" note={`${drone.length} drone mapping areas`} tone="violet"/>
    </div>
    <div className="dashboard-grid two-one overview-map-grid">
      <MapWorkspace
        farms={farms}
        sensors={sensors}
        plots={plots}
        droneMappings={drone}
        activeFarmId={activeFarmId}
        onFarmClick={(f)=>openFarm(f.id)}
        admin
        height={570}
        selectedSensorId={selectedSensorId}
        selectedDroneId={selectedDroneId}
        focusTarget={focusTarget}
        onSensorClick={selectSensor}
        onPlotClick={onPlot}
        onDroneClick={onDrone}
        onDroneDelete={onDeleteDrone}
        drawMode={drawProps.drawMode}
        drawPoints={drawProps.drawPoints}
        onMapPoint={drawProps.onMapPoint}
        toolbar={toolbar}
      />
      <section className="panel overview-farmer-panel">
        <div className="panel-title"><div><span>FARM STATUS</span><h3>Farmers</h3></div><small>{farms.length} total</small></div>
        <div className="farm-table">{farms.map(f=><button key={f.id} onClick={()=>openFarm(f.id)}><div className="farm-icon"><Sprout size={17}/></div><div><b>{f.farmer_name}</b><span>{f.name}</span></div><StatusPill value={f.status||'Good'}/></button>)}</div>
      </section>
    </div>
    <div className="dashboard-grid equal"><TrendChart/><DistributionChart/></div>
    {selectedSensor&&<SensorInspector sensor={selectedSensor} farmName={farmNameMap.get(selectedSensor.farm_id)} editable onSave={onSaveSensor} onDelete={onDeleteSensor} onClose={()=>selectSensor({id:null})} busy={busy}/>}
    {selectedDrone&&<DroneInspector drone={selectedDrone} farmName={farmNameMap.get(selectedDrone.farm_id)} editable onSave={onSaveDrone} onDelete={onDeleteDrone} onClose={()=>onDrone({id:null})} busy={busy}/>}
  </>;
}

function FarmDetail({farm,sensors,plots,drone,userMode,overview,admin,toolbar,drawProps,selectedSensorId,selectedPlotId,selectedDroneId,focusTarget,onSensor,onPlot,onDrone,selectedSensor,selectedPlot,selectedDrone,onSaveSensor,onSaveDrone,onDeleteSensor,onDeletePlot,onDeleteDrone,onDeleteFarmer,busy}){
  const m={n:avg(sensors,'nitrogen'),p:avg(sensors,'phosphorus'),k:avg(sensors,'potassium'),ph:avg(sensors,'ph'),om:avg(sensors,'organic_matter')};
  return <>
    <Header title={userMode?(overview?'My Soil Overview':'My Farm'):farm.farmer_name} subtitle={`${farm.name} • ${farm.location_name || 'Farm location'}`} action={admin?<button className="danger-btn header-btn" onClick={onDeleteFarmer}><Trash2 size={15}/>Delete farmer</button>:null}/>
    <div className="farm-heading"><div><StatusPill value={farm.status||'Good'}/><span>{number(farm.area_hectares,2)} hectares</span><span>{sensors.filter(s=>s.status!=='Offline').length}/{sensors.length} sensors online</span>{userMode&&<span className="sync-badge"><i/> Live synced</span>}</div></div>
    <div className="metric-grid five"><MetricCard icon={Leaf} label="Nitrogen" value={number(m.n,0)} suffix=" mg/kg"/><MetricCard icon={TestTube2} label="Phosphorus" value={number(m.p,0)} suffix=" mg/kg" tone="blue"/><MetricCard icon={Gauge} label="Potassium" value={number(m.k,0)} suffix=" mg/kg" tone="amber"/><MetricCard icon={Activity} label="Average pH" value={number(m.ph,2)} tone="violet"/><MetricCard icon={Sprout} label="Organic material" value={number(m.om,1)} suffix="%"/></div>
    <div className={`map-with-inspector ${userMode?'farmer-preview-layout':''} ${userMode&&(selectedSensor||selectedPlot||selectedDrone)?'has-spatial-preview':''}`}>
      <MapWorkspace farms={[farm]} sensors={sensors} plots={plots} droneMappings={drone} activeFarmId={farm.id} admin={admin} height={overview?500:610} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSensorClick={onSensor} onPlotClick={onPlot} onDroneClick={onDrone} onDroneDelete={onDeleteDrone} drawMode={drawProps.drawMode} drawPoints={drawProps.drawPoints} onMapPoint={drawProps.onMapPoint} toolbar={toolbar} showMapPopups={!userMode}/>
      {userMode
        ? ((selectedSensor||selectedPlot||selectedDrone) ? <div className="farmer-preview-slot"><SpatialPreview sensor={selectedSensor} plot={selectedPlot} drone={selectedDrone} farmName={farm.name} onClose={()=>onSensor(null)}/></div> : null)
        : <>{selectedSensor&&<SensorInspector sensor={selectedSensor} farmName={farm.name} editable onSave={onSaveSensor} onDelete={onDeleteSensor} onClose={()=>onSensor(null)} busy={busy}/>} {selectedDrone&&<DroneInspector drone={selectedDrone} farmName={farm.name} editable onSave={onSaveDrone} onDelete={onDeleteDrone} onClose={()=>onDrone(null)} busy={busy}/>}</>}
    </div>
    <div className="dashboard-grid equal"><SensorList sensors={sensors} onSelect={onSensor} selectedId={selectedSensorId} admin={admin} onDelete={onDeleteSensor}/><PlotAndDroneList plots={plots} drone={drone} admin={admin} onPlot={onPlot} onDrone={onDrone} onDeletePlot={onDeletePlot} onDeleteDrone={onDeleteDrone}/></div>
  </>;
}

function SensorPage({admin,farms,sensors,plots,drone,activeFarmId,selectedSensor,selectedPlot,selectedDrone,selectedSensorId,selectedPlotId,selectedDroneId,focusTarget,onSelect,onPlot,onDrone,onSave,onDelete,busy}){
  const mapFarms=admin?farms:farms.slice(0,1);
  const farmName=selectedSensor?.farm_name || mapFarms.find(f=>f.id===(selectedSensor?.farm_id||selectedPlot?.farm_id||selectedDrone?.farm_id||activeFarmId))?.name || mapFarms[0]?.name;
  return <>
    <Header title={admin?'Sensor Network':'My Sensors'} subtitle={admin?'Select a sensor to jump to its farm, inspect coverage, and edit its NPK, organic material, and pH readings.':'Tap a sensor, soil-analysis plot, or drone mapping to locate it and open a clean read-only preview.'}/>
    <div className="sensor-page-grid">
      <section className="panel sensor-directory"><div className="panel-title"><div><span>FIELD DEVICES</span><h3>{admin?'All Sensors':'Farm Sensors'}</h3></div><small>{sensors.length} sensors</small></div><div className="sensor-cards">{sensors.length?sensors.map(s=><button key={s.id} className={selectedSensorId===s.id?'active':''} onClick={()=>onSelect(s)}><div className="sensor-beacon"><RadioTower size={16}/></div><div><b>{s.sensor_code}</b><span>{admin?s.farm_name:`${s.coverage_m||50}m coverage`}</span></div><StatusPill value={s.status||'Online'}/></button>):<Empty text="No sensors"/>}</div></section>
      <div className="sensor-map-stack">
        <MapWorkspace farms={mapFarms} sensors={sensors} plots={plots} droneMappings={drone} activeFarmId={selectedSensor?.farm_id||selectedPlot?.farm_id||selectedDrone?.farm_id||activeFarmId} height={520} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSensorClick={onSelect} onPlotClick={onPlot} onDroneClick={onDrone} showMapPopups={admin}/>
        {admin
          ? (selectedSensor?<SensorInspector sensor={selectedSensor} farmName={selectedSensor.farm_name} editable onSave={onSave} onDelete={onDelete} onClose={()=>onSelect(null)} busy={busy}/>:<section className="panel"><Empty text="Select a sensor" sub="Its nutrient readings and map location will appear here."/></section>)
          : <SpatialPreview sensor={selectedSensor} plot={selectedPlot} drone={selectedDrone} farmName={farmName} onClose={()=>onSelect(null)}/>} 
      </div>
    </div>
  </>;
}

function SensorList({sensors,onSelect,selectedId,admin,onDelete}){return <section className="panel"><div className="panel-title"><div><span>FIELD DEVICES</span><h3>Sensor Stations</h3></div><small>{sensors.length} stations</small></div><div className="sensor-list">{sensors.length?sensors.map(s=><article key={s.id} className={selectedId===s.id?'selected-row':''} onClick={()=>onSelect?.(s)}><div className={`sensor-beacon ${s.status==='Offline'?'offline':''}`}><RadioTower size={17}/></div><div className="sensor-name"><b>{s.sensor_code}</b><span>{s.coverage_m||50}m coverage square</span></div><div className="mini-reading"><span>N<b>{number(s.nitrogen,0)}</b></span><span>P<b>{number(s.phosphorus,0)}</b></span><span>K<b>{number(s.potassium,0)}</b></span><span>pH<b>{number(s.ph,2)}</b></span><span>OM<b>{number(s.organic_matter,1)}%</b></span></div><StatusPill value={s.status||'Online'}/>{admin&&<button className="icon-danger" onClick={e=>{e.stopPropagation();onDelete?.(s)}}><Trash2 size={14}/></button>}</article>):<Empty text="No sensors recorded"/>}</div></section>}
function PlotAndDroneList({plots,drone,admin,onPlot,onDrone,onDeletePlot,onDeleteDrone}){return <section className="panel"><div className="panel-title"><div><span>SPATIAL RECORDS</span><h3>Plots & Drone Mapping</h3></div><small>{plots.length+drone.length} areas</small></div><div className="plot-list">{plots.map(p=><article key={p.id} onClick={()=>onPlot?.(p)}><div className="plot-icon"><FlaskConical size={18}/></div><div><b>{p.plot_code}</b><span>Soil analysis • {niceDate(p.analyzed_at)}</span><p>{p.notes||'Laboratory observation area'}</p></div><StatusPill value={p.classification||'Good'}/>{admin&&<button className="icon-danger" onClick={e=>{e.stopPropagation();onDeletePlot?.(p)}}><Trash2 size={14}/></button>}</article>)}{drone.map(d=><article key={d.id} onClick={()=>onDrone?.(d)}><div className="plot-icon drone"><ScanLine size={18}/></div><div><b>{d.name}</b><span>Drone mapping • {niceDate(d.captured_at)}</span><p>{d.image_url?'Imagery reference attached':'Mapped flight/survey footprint'}</p></div><StatusPill value={d.status||'Mapped'}/>{admin&&<button className="icon-danger" onClick={e=>{e.stopPropagation();onDeleteDrone?.(d)}}><Trash2 size={14}/></button>}</article>)}{!plots.length&&!drone.length&&<Empty text="No plots or drone mappings"/>}</div></section>}

function Statistics({farms,sensors,plots,drone=[],activeFarmId}){
  const [farmId,setFarmId]=useState(activeFarmId||farms[0]?.id||'');
  useEffect(()=>{
    if(activeFarmId&&farms.some(f=>f.id===activeFarmId))setFarmId(activeFarmId);
    else if(!farms.some(f=>f.id===farmId))setFarmId(farms[0]?.id||'');
  },[activeFarmId,farms.map(f=>f.id).join('|')]);
  const farm=farms.find(f=>f.id===farmId)||farms[0];
  const farmSensors=sensors.filter(s=>s.farm_id===farm?.id);
  const farmPlots=plots.filter(p=>p.farm_id===farm?.id);
  const farmDrone=drone.filter(d=>d.farm_id===farm?.id);
  const online=farmSensors.filter(s=>s.status!=='Offline').length;
  const selector=<label className="farm-stat-select"><span>Farm data</span><select value={farm?.id||''} onChange={e=>setFarmId(e.target.value)}>{farms.map(f=><option key={f.id} value={f.id}>{f.farmer_name} • {f.name}</option>)}</select></label>;
  if(!farm)return <><Header title="Farm Statistics" subtitle="Choose a farm to inspect its soil data."/><Empty text="No farms available"/></>;
  return <>
    <Header title="Farm Statistics" subtitle={`${farm.farmer_name} • ${farm.name}. Every value below belongs only to this farm.`} action={selector}/>
    <div className="metric-grid five">
      <MetricCard icon={Leaf} label="Nitrogen" value={number(avg(farmSensors,'nitrogen'),1)} suffix=" mg/kg" note={`${farmSensors.length} farm sensors`}/>
      <MetricCard icon={TestTube2} label="Phosphorus" value={number(avg(farmSensors,'phosphorus'),1)} suffix=" mg/kg" note="Farm average" tone="blue"/>
      <MetricCard icon={Gauge} label="Potassium" value={number(avg(farmSensors,'potassium'),1)} suffix=" mg/kg" note="Farm average" tone="amber"/>
      <MetricCard icon={Activity} label="Average pH" value={number(avg(farmSensors,'ph'),2)} note="Farm sensors only" tone="violet"/>
      <MetricCard icon={Sprout} label="Organic material" value={number(avg(farmSensors,'organic_matter'),1)} suffix="%" note="Farm average"/>
    </div>
    <div className="metric-grid five farm-stat-summary">
      <MetricCard icon={LandPlot} label="Farm area" value={number(farm.area_hectares,2)} suffix=" ha" note={farm.location_name||'Mapped farm'}/>
      <MetricCard icon={RadioTower} label="Active sensors" value={online} suffix={` / ${farmSensors.length}`} note="This farm only" tone="blue"/>
      <MetricCard icon={FlaskConical} label="Soil analysis plots" value={farmPlots.length} note="This farm only" tone="amber"/>
      <MetricCard icon={ScanLine} label="Drone mappings" value={farmDrone.length} note="Mapped drone observation areas" tone="violet"/>
      <MetricCard icon={MapPin} label="Farm status" value={farm.status||'Unmapped'} note="Current mapped status"/>
    </div>
    <div className="dashboard-grid equal">
      <NutrientBars sensors={farmSensors}/>
      <section className="panel">
        <div className="panel-title"><div><span>FARM SENSOR DATA</span><h3>Sensor-by-Sensor Readings</h3></div><small>{farmSensors.length} sensors</small></div>
        <div className="farm-stat-table">
          {farmSensors.length?farmSensors.map(s=><article key={s.id}><div><b>{s.sensor_code}</b><span>{s.status||'Online'} • {s.coverage_m||50}m coverage</span></div><div className="farm-stat-values"><span>N<b>{number(s.nitrogen,1)}</b></span><span>P<b>{number(s.phosphorus,1)}</b></span><span>K<b>{number(s.potassium,1)}</b></span><span>pH<b>{number(s.ph,2)}</b></span><span>OM<b>{number(s.organic_matter,1)}%</b></span></div></article>):<Empty text="No sensors on this farm" sub="Add a sensor to begin farm-specific statistics."/>}
        </div>
      </section>
    </div>
    <div className="dashboard-grid equal farm-spatial-stat-grid">
      <section className="panel farm-plot-stat-panel">
        <div className="panel-title"><div><span>SOIL ANALYSIS</span><h3>Plots for {farm.name}</h3></div><small>{farmPlots.length} plots</small></div>
        <div className="farm-stat-table">
          {farmPlots.length?farmPlots.map(p=><article key={p.id}><div><b>{p.plot_code}</b><span>{niceDate(p.analyzed_at)} • {p.classification||'Pending'}</span></div><div className="farm-stat-values"><span>N<b>{number(p.nitrogen,1)}</b></span><span>P<b>{number(p.phosphorus,1)}</b></span><span>K<b>{number(p.potassium,1)}</b></span><span>pH<b>{number(p.ph,2)}</b></span><span>OM<b>{number(p.organic_matter,1)}%</b></span></div></article>):<Empty text="No soil-analysis plots on this farm"/>}
        </div>
      </section>
      <section className="panel farm-drone-stat-panel">
        <div className="panel-title"><div><span>DRONE MAPPING</span><h3>Drone observations for {farm.name}</h3></div><small>{farmDrone.length} mappings</small></div>
        <div className="farm-stat-table">
          {farmDrone.length?farmDrone.map(d=><article key={d.id}><div><b>{d.name}</b><span>{niceDate(d.captured_at)} • {d.classification||d.status||'Mapped'} • {number(d.area_hectares,2)} ha</span></div><div className="farm-stat-values"><span>N<b>{number(d.nitrogen,1)}</b></span><span>P<b>{number(d.phosphorus,1)}</b></span><span>K<b>{number(d.potassium,1)}</b></span><span>pH<b>{number(d.ph,2)}</b></span><span>OM<b>{number(d.organic_matter,1)}%</b></span></div></article>):<Empty text="No drone mapping data on this farm" sub="Draw a Drone Mapping area and enter its soil observation values."/>}
        </div>
      </section>
    </div>
  </>;
}
function AnalysisPage({farm,sensors,plots}){return <><Header title="Soil Analysis" subtitle={`${farm?.name||'My Farm'} • field sensors compared with laboratory observation plots.`}/><div className="metric-grid five"><MetricCard icon={Leaf} label="Nitrogen" value={number(avg(sensors,'nitrogen'),0)} suffix=" mg/kg"/><MetricCard icon={TestTube2} label="Phosphorus" value={number(avg(sensors,'phosphorus'),0)} suffix=" mg/kg" tone="blue"/><MetricCard icon={Gauge} label="Potassium" value={number(avg(sensors,'potassium'),0)} suffix=" mg/kg" tone="amber"/><MetricCard icon={Activity} label="pH" value={number(avg(sensors,'ph'),2)} tone="violet"/><MetricCard icon={Sprout} label="Organic material" value={number(avg(sensors,'organic_matter'),1)} suffix="%"/></div><div className="dashboard-grid equal"><NutrientBars sensors={sensors}/><section className="panel"><div className="panel-title"><div><span>LABORATORY</span><h3>Soil Analysis Plots</h3></div><small>{plots.length} plots</small></div><div className="plot-list">{plots.map(p=><article key={p.id}><div className="plot-icon"><FlaskConical size={18}/></div><div><b>{p.plot_code}</b><span>{niceDate(p.analyzed_at)}</span><p>{p.notes||'Soil analysis record'}</p></div><StatusPill value={p.classification||'Good'}/></article>)}</div></section></div><TrendChart/></>}

function FarmerModal({onClose,onSave,busy}){const [f,setF]=useState({name:'',email:'',password:'',farm_name:'',location_name:'',center_lat:'10.4247',center_lng:'122.9225'});const set=(k,v)=>setF(x=>({...x,[k]:v}));return <Modal title="Add Farmer" subtitle="Creates a real Appwrite farmer login and an empty farm workspace." onClose={onClose}><form className="modal-form" onSubmit={e=>{e.preventDefault();onSave(f)}}><div className="form-grid two"><label>Farmer name<input required value={f.name} onChange={e=>set('name',e.target.value)}/></label><label>Email<input type="email" required value={f.email} onChange={e=>set('email',e.target.value)}/></label><label>Password<input type="password" minLength="8" required value={f.password} onChange={e=>set('password',e.target.value)}/></label><label>Farm name<input required value={f.farm_name} onChange={e=>set('farm_name',e.target.value)}/></label><label className="full">Location / barangay<input value={f.location_name} onChange={e=>set('location_name',e.target.value)}/></label><label>Map center latitude<input type="number" step="0.000001" value={f.center_lat} onChange={e=>set('center_lat',e.target.value)}/></label><label>Map center longitude<input type="number" step="0.000001" value={f.center_lng} onChange={e=>set('center_lng',e.target.value)}/></label></div><ModalActions busy={busy} onClose={onClose} label="Create farmer"/></form></Modal>}
function SensorCreateModal({point,onClose,onSave,busy}){const [f,setF]=useState({sensor_code:'Sensor 1',coverage_m:50,status:'Online',nitrogen:'',phosphorus:'',potassium:'',organic_matter:'',ph:'',moisture:''});const set=(k,v)=>setF(x=>({...x,[k]:v}));return <Modal title="Add Sensor" subtitle={`Placed at ${number(point?.[0],6)}, ${number(point?.[1],6)}. Its square coverage will be shown on both maps.`} onClose={onClose}><form className="modal-form" onSubmit={e=>{e.preventDefault();onSave(f)}}><div className="form-grid two"><label>Sensor name<input required value={f.sensor_code} onChange={e=>set('sensor_code',e.target.value)}/></label><label>Coverage square (meters)<input type="number" min="1" value={f.coverage_m} onChange={e=>set('coverage_m',e.target.value)}/></label><label>Nitrogen (mg/kg)<input type="number" step="0.01" value={f.nitrogen} onChange={e=>set('nitrogen',e.target.value)}/></label><label>Phosphorus (mg/kg)<input type="number" step="0.01" value={f.phosphorus} onChange={e=>set('phosphorus',e.target.value)}/></label><label>Potassium (mg/kg)<input type="number" step="0.01" value={f.potassium} onChange={e=>set('potassium',e.target.value)}/></label><label>Organic material (%)<input type="number" step="0.01" value={f.organic_matter} onChange={e=>set('organic_matter',e.target.value)}/></label><label>pH<input type="number" step="0.01" value={f.ph} onChange={e=>set('ph',e.target.value)}/></label><label>Moisture (%)<input type="number" step="0.01" value={f.moisture} onChange={e=>set('moisture',e.target.value)}/></label></div><ModalActions busy={busy} onClose={onClose} label="Add sensor"/></form></Modal>}
function PlotCreateModal({points,onClose,onSave,busy}){const [f,setF]=useState({plot_code:'Plot 1',classification:'Pending',nitrogen:'',phosphorus:'',potassium:'',organic_matter:'',ph:'',notes:''});const set=(k,v)=>setF(x=>({...x,[k]:v}));return <Modal title="Add Soil Analysis Plot" subtitle={`${points.length} polygon points captured. Add the laboratory values for this observed area.`} onClose={onClose}><form className="modal-form" onSubmit={e=>{e.preventDefault();onSave(f)}}><div className="form-grid two"><label>Plot name<input required value={f.plot_code} onChange={e=>set('plot_code',e.target.value)}/></label><label>Classification<select value={f.classification} onChange={e=>set('classification',e.target.value)}><option>Pending</option><option>Good</option><option>Monitor</option><option>Poor</option><option>Critical</option></select></label><label>Nitrogen<input type="number" step="0.01" value={f.nitrogen} onChange={e=>set('nitrogen',e.target.value)}/></label><label>Phosphorus<input type="number" step="0.01" value={f.phosphorus} onChange={e=>set('phosphorus',e.target.value)}/></label><label>Potassium<input type="number" step="0.01" value={f.potassium} onChange={e=>set('potassium',e.target.value)}/></label><label>Organic material (%)<input type="number" step="0.01" value={f.organic_matter} onChange={e=>set('organic_matter',e.target.value)}/></label><label>pH<input type="number" step="0.01" value={f.ph} onChange={e=>set('ph',e.target.value)}/></label><label className="full">Notes<textarea rows="3" value={f.notes} onChange={e=>set('notes',e.target.value)}/></label></div><ModalActions busy={busy} onClose={onClose} label="Create plot"/></form></Modal>}
function DroneCreateModal({points,onClose,onSave,busy}){
  const [f,setF]=useState({
    name:'Drone Mapping 1',
    captured_at:new Date().toISOString().slice(0,16),
    image_url:'',
    status:'Mapped',
    classification:'Unclassified',
    nitrogen:'',
    phosphorus:'',
    potassium:'',
    organic_matter:'',
    ph:'',
    moisture:'',
    notes:'',
  });
  const set=(k,v)=>setF(x=>({...x,[k]:v}));
  return <Modal title="Add Drone Mapping" subtitle={`${points.length} polygon points captured. Add the soil observations represented by this drone-mapped area.`} onClose={onClose}>
    <form className="modal-form" onSubmit={e=>{e.preventDefault();onSave({...f,captured_at:f.captured_at?new Date(f.captured_at).toISOString():new Date().toISOString()})}}>
      <div className="form-grid two">
        <label>Mapping name<input required value={f.name} onChange={e=>set('name',e.target.value)}/></label>
        <label>Classification<select value={f.classification} onChange={e=>set('classification',e.target.value)}><option>Unclassified</option><option>Good</option><option>Monitor</option><option>Poor</option><option>Critical</option></select></label>
        <label>Capture date/time<input type="datetime-local" value={f.captured_at} onChange={e=>set('captured_at',e.target.value)}/></label>
        <label>Status<select value={f.status} onChange={e=>set('status',e.target.value)}><option>Mapped</option><option>Processing</option><option>Archived</option></select></label>
        <label>Nitrogen (mg/kg)<input type="number" step="0.01" value={f.nitrogen} onChange={e=>set('nitrogen',e.target.value)}/></label>
        <label>Phosphorus (mg/kg)<input type="number" step="0.01" value={f.phosphorus} onChange={e=>set('phosphorus',e.target.value)}/></label>
        <label>Potassium (mg/kg)<input type="number" step="0.01" value={f.potassium} onChange={e=>set('potassium',e.target.value)}/></label>
        <label>Organic material (%)<input type="number" step="0.01" value={f.organic_matter} onChange={e=>set('organic_matter',e.target.value)}/></label>
        <label>pH<input type="number" step="0.01" value={f.ph} onChange={e=>set('ph',e.target.value)}/></label>
        <label>Moisture (%)<input type="number" step="0.01" value={f.moisture} onChange={e=>set('moisture',e.target.value)}/></label>
        <label className="full">Drone image / orthomosaic URL (optional)<input value={f.image_url} onChange={e=>set('image_url',e.target.value)} placeholder="https://..."/></label>
        <label className="full">Observation notes<textarea rows="3" value={f.notes} onChange={e=>set('notes',e.target.value)} placeholder="What did the drone survey indicate in this area?"/></label>
      </div>
      <ModalActions busy={busy} onClose={onClose} label="Create mapping"/>
    </form>
  </Modal>;
}
function ModalActions({busy,onClose,label}){return <div className="modal-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary-btn" disabled={busy}>{busy?'Saving…':label}</button></div>}

function TrendChart(){return <section className="panel chart-panel"><div className="panel-title"><div><span>6-MONTH TREND</span><h3>Nutrient Movement</h3></div><small>Trend view</small></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trendData}><defs><linearGradient id="soilArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4bd66d" stopOpacity={.32}/><stop offset="95%" stopColor="#4bd66d" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#dce9df" vertical={false}/><XAxis dataKey="month" stroke="#718578" tickLine={false} axisLine={false}/><YAxis stroke="#718578" tickLine={false} axisLine={false}/><Tooltip contentStyle={{background:'#ffffff',border:'1px solid #cfe1d3',borderRadius:10,color:'#173b24'}}/><Area type="monotone" dataKey="nitrogen" stroke="#229c52" strokeWidth={2.5} fill="url(#soilArea)"/></AreaChart></ResponsiveContainer></div></section>}
function DistributionChart(){const colors=['#229c52','#d4a628','#e68642','#d95d53'];return <section className="panel chart-panel"><div className="panel-title"><div><span>SOIL HEALTH</span><h3>Classification Distribution</h3></div></div><div className="pie-layout"><div className="pie-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={soilDistribution} dataKey="value" innerRadius={58} outerRadius={85} paddingAngle={3}>{soilDistribution.map((_,i)=><Cell key={i} fill={colors[i]}/>)}</Pie><Tooltip contentStyle={{background:'#ffffff',border:'1px solid #cfe1d3',borderRadius:10,color:'#173b24'}}/></PieChart></ResponsiveContainer><div className="pie-center"><b>58%</b><span>Good</span></div></div><div className="pie-legend">{soilDistribution.map((d,i)=><span key={d.name}><i style={{background:colors[i]}}/>{d.name}<b>{d.value}%</b></span>)}</div></div></section>}
function NutrientBars({sensors=[]}){const data=[{name:'Nitrogen',value:avg(sensors,'nitrogen')},{name:'Phosphorus',value:avg(sensors,'phosphorus')},{name:'Potassium',value:avg(sensors,'potassium')},{name:'Organic',value:avg(sensors,'organic_matter')*10}];return <section className="panel chart-panel"><div className="panel-title"><div><span>NUTRIENT INDEX</span><h3>Relative Soil Levels</h3></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid stroke="#dce9df" vertical={false}/><XAxis dataKey="name" stroke="#718578" tickLine={false} axisLine={false}/><YAxis stroke="#718578" tickLine={false} axisLine={false}/><Tooltip contentStyle={{background:'#ffffff',border:'1px solid #cfe1d3',borderRadius:10,color:'#173b24'}}/><Bar dataKey="value" fill="#229c52" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></div></section>}
