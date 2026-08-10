import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, FlaskConical, Gauge, LandPlot, Leaf, MapPin, Plus, RadioTower, ScanLine, Sprout, TestTube2, Trash2 } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { soilDistribution, trendData } from '../data/demoData';
import { subscribeFarmChanges } from '../services/dataService';
import { loadAuthoritativeFarmerWorkspace } from '../services/farmerService';
import { applyDemoAction, getDemoState, DEMO_STORE_KEY } from '../services/demoStore';
import { adminAction } from '../services/adminService';
import AppSidebar from '../components/AppSidebar';
import LayerVisibility from '../components/LayerVisibility';
import MapModeTabs from '../components/MapModeTabs';
import MapToolbar from '../components/MapToolbar';
import MetricCard from '../components/MetricCard';
import Modal from '../components/Modal';
import RecordPreview from '../components/RecordPreview';
import { SensorEditorModal, PlotEditorModal, DroneEditorModal, cleanAngle } from '../components/RecordEditors';
import SoilMap from '../components/SoilMap';
import StatusPill from '../components/StatusPill';

const avg=(arr,key)=>arr.length?(arr.reduce((s,x)=>s+(Number(x[key])||0),0)/arr.length):0;
const number=(n,d=0)=>Number(n||0).toFixed(d);
const niceDate=(v)=>v?new Intl.DateTimeFormat('en-PH',{month:'short',day:'numeric',year:'numeric'}).format(new Date(v)):'No record';
const modeVisibility=(mode)=>({farmBoundary:true,sensors:true,sensorCoverage:true,soilPlots:mode==='analysis',droneMapping:mode==='drone'});
const logicalName=(value='')=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');

function nextNumberedName(rows=[], prefix, key) {
  const used=new Set(rows.map(row=>String(row?.[key]||'').trim().toLowerCase()));
  let i=1;
  while(used.has(`${prefix} ${i}`.toLowerCase())) i+=1;
  return `${prefix} ${i}`;
}

function Header({title,subtitle,action}) { return <header className="page-header"><div><span>SOIL MONITORING</span><h1>{title}</h1><p>{subtitle}</p></div><div className="header-actions">{action}<div className="live-chip"><i/> System active</div></div></header> }
function Empty({text,sub='No records are available for this section yet.'}) { return <div className="empty-state"><Sprout size={28}/><b>{text}</b><span>{sub}</span></div> }

function pointInPolygon(point, polygon=[]) {
  if (!point || polygon.length < 3) return false;
  const [y,x]=point;
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const [yi,xi]=polygon[i], [yj,xj]=polygon[j];
    const intersects=((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi);
    if(intersects)inside=!inside;
  }
  return inside;
}

function polygonStats(points=[]) {
  if (!points.length) return {center_lat:10.4247,center_lng:122.9225,area_hectares:0};
  const lat0=points.reduce((s,p)=>s+p[0],0)/points.length;
  const lng0=points.reduce((s,p)=>s+p[1],0)/points.length;
  const cos=Math.cos(lat0*Math.PI/180);
  const xy=points.map(([lat,lng])=>[(lng-lng0)*111320*cos,(lat-lat0)*111320]);
  let sum=0; for(let i=0;i<xy.length;i++){const [x1,y1]=xy[i], [x2,y2]=xy[(i+1)%xy.length]; sum+=x1*y2-x2*y1;}
  return {center_lat:lat0,center_lng:lng0,area_hectares:Math.abs(sum)/2/10000};
}

function cleanPolygon(points=[]) {
  const out=[];
  for(const point of points||[]) {
    const lat=Number(point?.[0]),lng=Number(point?.[1]);
    if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
    const prev=out[out.length-1];
    if(prev&&Math.abs(prev[0]-lat)<1e-10&&Math.abs(prev[1]-lng)<1e-10)continue;
    out.push([lat,lng]);
  }
  if(out.length>2){const a=out[0],b=out[out.length-1];if(Math.abs(a[0]-b[0])<1e-10&&Math.abs(a[1]-b[1])<1e-10)out.pop();}
  return out;
}
function polygonHasCrossing(points=[]) {
  const p=cleanPolygon(points);
  if(p.length<3)return false;
  const cross=(a,b,c)=>(b[1]-a[1])*(c[0]-a[0])-(b[0]-a[0])*(c[1]-a[1]);
  const onSeg=(a,b,c)=>Math.min(a[0],c[0])-1e-12<=b[0]&&b[0]<=Math.max(a[0],c[0])+1e-12&&Math.min(a[1],c[1])-1e-12<=b[1]&&b[1]<=Math.max(a[1],c[1])+1e-12;
  const hit=(a,b,c,d)=>{const o1=cross(a,b,c),o2=cross(a,b,d),o3=cross(c,d,a),o4=cross(c,d,b),e=1e-12;if(((o1>e&&o2<-e)||(o1<-e&&o2>e))&&((o3>e&&o4<-e)||(o3<-e&&o4>e)))return true;if(Math.abs(o1)<=e&&onSeg(a,c,b))return true;if(Math.abs(o2)<=e&&onSeg(a,d,b))return true;if(Math.abs(o3)<=e&&onSeg(c,a,d))return true;if(Math.abs(o4)<=e&&onSeg(c,b,d))return true;return false;};
  for(let i=0;i<p.length;i++){for(let j=i+1;j<p.length;j++){if(j===i||j===(i+1)%p.length||(i===0&&j===p.length-1))continue;if(hit(p[i],p[(i+1)%p.length],p[j],p[(j+1)%p.length]))return true;}}
  return false;
}

function MapWorkspace({
  farms, sensors, plots, droneMappings, activeFarmId, onFarmClick, admin=false, height=560,
  selectedSensorId, selectedPlotId, selectedDroneId, focusTarget, onSensorClick, onPlotClick, onDroneClick, onDroneDelete,
  drawMode, drawPoints, onMapPoint, drawCoverageM, drawOrientation, onDrawOrientation, toolbar, showMapPopups=true, preview=null, fitRequestKey=0, dataRevision=0,
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
    <div className={`map-workspace-body ${admin?'has-admin-editor':''}`}>
      <div className="map-canvas-shell">
        <SoilMap farms={farms} sensors={sensors} plots={plots} droneMappings={droneMappings} height={height} selectedFarmId={activeFarmId} onFarmClick={onFarmClick} visibility={visibility} visibleSensorIds={visibleSensorIds} visiblePlotIds={visiblePlotIds} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSensorClick={onSensorClick} onPlotClick={onPlotClick} onDroneClick={onDroneClick} onDroneDelete={onDroneDelete} canDeleteDrone={admin} drawMode={drawMode} drawPoints={drawPoints} onMapPoint={onMapPoint} drawCoverageM={drawCoverageM} drawOrientation={drawOrientation} onDrawOrientation={onDrawOrientation} showMapPopups={showMapPopups} fitRequestKey={fitRequestKey} dataRevision={dataRevision}/>
        {preview&&<div className="map-preview-float">{preview}</div>}
      </div>
      {admin && <aside className="map-editor-side">{toolbar}</aside>}
    </div>
  </section>;
}

export default function DashboardPage({ mode='admin' }) {
  const { user, logout }=useAuth();
  const [view,setView]=useState('overview');
  const [farms,setFarms]=useState([]); const [allSensors,setAllSensors]=useState([]); const [allPlots,setAllPlots]=useState([]); const [allDrone,setAllDrone]=useState([]);
  const [activeFarmId,setActiveFarmId]=useState(null); const [bundle,setBundle]=useState(null);
  const [loading,setLoading]=useState(true); const [notice,setNotice]=useState(''); const [busy,setBusy]=useState(false);
  const [selectedSensorId,setSelectedSensorId]=useState(null); const [selectedPlotId,setSelectedPlotId]=useState(null); const [selectedDroneId,setSelectedDroneId]=useState(null); const [focusTarget,setFocusTarget]=useState(null);
  const [drawMode,setDrawMode]=useState(null); const [drawPoints,setDrawPoints]=useState([]); const [placementOrientation,setPlacementOrientation]=useState(0); const [pendingShape,setPendingShape]=useState(null); const [modal,setModal]=useState(null);
  const [editor,setEditor]=useState(null);
  const [farmFitRevision,setFarmFitRevision]=useState(0);
  const [mapRevision,setMapRevision]=useState(0);
  const previousViewRef=useRef('overview');
  const currentViewRef=useRef('overview');
  const farmerSyncSeqRef=useRef(0);
  const farmerBoundarySigRef=useRef('');
  const workspaceLoadSeqRef=useRef(0);
  // Synchronous write latch. React state updates are asynchronous, so relying only
  // on `busy` can allow two submit events to enter before the button disables.
  const spatialActionLockRef=useRef(false);
  const isDemo=!!user?.demo; const isAdmin=mode==='admin';
  const getFarmerWorkspace=async()=>{
    if(isDemo){const state=getDemoState();const farm=state.farms[0];return {farmId:farm?.id||null,bundle:farm?{farm,sensors:state.sensors.filter(s=>s.farm_id===farm.id),plots:state.plots.filter(p=>p.farm_id===farm.id),droneMappings:state.drone.filter(d=>d.farm_id===farm.id)}:null};}
    // Farmer map data has one source of truth: the server-authoritative workspace.
    // Do not fall back to client-side row reads, because older permissions/cache
    // state can make that fallback disagree with the Admin-published records.
    return loadAuthoritativeFarmerWorkspace();
  };

  useEffect(()=>{currentViewRef.current=view;},[view]);

  const decorate=(rows)=>rows.map(row=>({...row,farm_name:farms.find(f=>f.id===row.farm_id)?.name || farms.find(f=>f.id===row.farm_id)?.farmer_name || ''}));
  const loadLocalDemoBundle=(farmId)=>{const state=getDemoState();return {farm:state.farms.find(f=>f.id===farmId)||state.farms[0],sensors:state.sensors.filter(s=>s.farm_id===farmId),plots:state.plots.filter(p=>p.farm_id===farmId),droneMappings:state.drone.filter(d=>d.farm_id===farmId)}};

  async function refresh({keepFarm=true,showLoading=true}={}) {
    const seq=++workspaceLoadSeqRef.current;
    if(showLoading){setLoading(true);setNotice('');}
    try {
      if(isDemo){
        const state=getDemoState();
        if(seq!==workspaceLoadSeqRef.current)return;
        const firstFarm=state.farms[0];
        const nextFarms=isAdmin?state.farms:(firstFarm?[firstFarm]:[]);
        const scopedFarmId=firstFarm?.id;
        const nextSensors=isAdmin?state.sensors:state.sensors.filter(s=>s.farm_id===scopedFarmId);
        const nextPlots=isAdmin?state.plots:state.plots.filter(p=>p.farm_id===scopedFarmId);
        const nextDrone=isAdmin?state.drone:state.drone.filter(d=>d.farm_id===scopedFarmId);
        setFarms(nextFarms); setAllSensors(nextSensors); setAllPlots(nextPlots); setAllDrone(nextDrone);
        const farmId=keepFarm&&activeFarmId&&nextFarms.some(f=>f.id===activeFarmId)?activeFarmId:nextFarms[0]?.id;
        setActiveFarmId(farmId||null); setBundle(farmId?loadLocalDemoBundle(farmId):null); setMapRevision(v=>v+1); return;
      }
      if(!isAdmin){
        const farmerWorkspace=await getFarmerWorkspace();
        if(seq!==workspaceLoadSeqRef.current)return;
        const farmId=farmerWorkspace.farmId;
        const b=farmerWorkspace.bundle;
        setActiveFarmId(farmId||null);
        setBundle(b);
        setFarms(b?.farm?[b.farm]:[]);
        setAllSensors(b?.sensors||[]);
        setAllPlots(b?.plots||[]);
        setAllDrone(b?.droneMappings||[]);
        setMapRevision(v=>v+1);
        return;
      }

      // Fast startup path. Legacy cleanup no longer blocks the first paint.
      const adminWorkspace=await adminAction('getAdminWorkspace',{});
      if(seq!==workspaceLoadSeqRef.current)return;
      const canonicalBundles=adminWorkspace?.bundles||[];
      const nextFarms=adminWorkspace?.farms||canonicalBundles.map(item=>item.farm).filter(Boolean);
      const sensors=canonicalBundles.flatMap(item=>item.sensors||[]);
      const plots=canonicalBundles.flatMap(item=>item.plots||[]);
      const drone=canonicalBundles.flatMap(item=>item.droneMappings||[]);
      setFarms(nextFarms);
      const farmId=keepFarm&&activeFarmId&&nextFarms.some(f=>f.id===activeFarmId)?activeFarmId:nextFarms[0]?.id;
      setActiveFarmId(farmId||null);
      setBundle(farmId?(canonicalBundles.find(item=>item.farm?.id===farmId)||null):null);
      setAllSensors(sensors);setAllPlots(plots);setAllDrone(drone);setMapRevision(v=>v+1);
    } catch(err){
      if(seq===workspaceLoadSeqRef.current){console.error(err);setNotice(err.message||'Unable to load Appwrite data.');}
    } finally {
      if(showLoading && seq===workspaceLoadSeqRef.current)setLoading(false);
    }
  }
  useEffect(()=>{refresh({keepFarm:false});},[isDemo,mode,user?.$id]);

  useEffect(()=>{
    if(!isAdmin || isDemo || loading || !user?.$id) return undefined;
    const key=`soils-maintenance-v11010:${user.$id}`;
    if(sessionStorage.getItem(key)==='done') return undefined;
    let cancelled=false;
    const timer=setTimeout(()=>{
      adminAction('repairAdminWorkspace',{})
        .then(async()=>{
          if(cancelled)return;
          sessionStorage.setItem(key,'done');
          await refresh({keepFarm:true,showLoading:false});
        })
        .catch(err=>console.warn('Background legacy cleanup skipped:',err));
    },1800);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[isAdmin,isDemo,loading,user?.$id]);

  useEffect(()=>{
    if(isAdmin || !activeFarmId) return undefined;
    let cancelled=false;
    let realtimeCleanup=()=>{};
    let realtimeDebounce=null;
    let fallbackTimer=null;

    const applyBundle=(nextBundle)=>{
      if(cancelled || !nextBundle?.farm) return;
      const nextSensors=nextBundle.sensors||[];
      const nextPlots=nextBundle.plots||[];
      const nextDrone=nextBundle.droneMappings||[];
      setBundle({...nextBundle,sensors:nextSensors,plots:nextPlots,droneMappings:nextDrone});
      setFarms([nextBundle.farm]);
      setAllSensors(nextSensors);
      setAllPlots(nextPlots);
      setAllDrone(nextDrone);
      setMapRevision(v=>v+1);
      const boundarySig=JSON.stringify(nextBundle.farm?.boundary||[]);
      const boundaryChanged=farmerBoundarySigRef.current && farmerBoundarySigRef.current!==boundarySig;
      farmerBoundarySigRef.current=boundarySig;
      if(boundaryChanged && currentViewRef.current==='farm') setFarmFitRevision(v=>v+1);
      // If Admin deleted/replaced a record, never keep a Farmer preview/focus
      // pointing at a stale object that no longer exists in the authoritative bundle.
      setSelectedSensorId(id=>id&&nextSensors.some(row=>row.id===id)?id:null);
      setSelectedPlotId(id=>id&&nextPlots.some(row=>row.id===id)?id:null);
      setSelectedDroneId(id=>id&&nextDrone.some(row=>row.id===id)?id:null);
      setFocusTarget(target=>{
        if(!target?.id) return target;
        const fresh=nextSensors.find(row=>row.id===target.id)||nextPlots.find(row=>row.id===target.id)||nextDrone.find(row=>row.id===target.id);
        if(!fresh)return null;
        const boundary=fresh.boundary||[];
        const latitude=Number(fresh.latitude ?? fresh.center_lat ?? (boundary.length?boundary.reduce((sum,p)=>sum+Number(p[0]||0),0)/boundary.length:0));
        const longitude=Number(fresh.longitude ?? fresh.center_lng ?? (boundary.length?boundary.reduce((sum,p)=>sum+Number(p[1]||0),0)/boundary.length:0));
        return {...fresh,latitude,longitude};
      });
    };

    const pullLatest=async()=>{
      const seq=++farmerSyncSeqRef.current;
      try{
        const workspace=await getFarmerWorkspace();
        // Network responses can complete out of order. Only the newest Farmer
        // workspace response is allowed to replace the map.
        if(cancelled || seq!==farmerSyncSeqRef.current) return;
        if(workspace?.farmId && workspace.farmId!==activeFarmId) setActiveFarmId(workspace.farmId);
        applyBundle(workspace?.bundle);
      }catch(err){
        if(!cancelled && seq===farmerSyncSeqRef.current) console.warn('Farmer sync refresh failed:',err);
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
      fallbackTimer=setInterval(pullLatest,2500);
      pullLatest();
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
    try{
      if(isDemo){setBundle(loadLocalDemoBundle(id));return;}
      if(!isAdmin){
        const seq=++farmerSyncSeqRef.current;
        const workspace=await getFarmerWorkspace();
        if(seq!==farmerSyncSeqRef.current)return;
        const next=workspace?.bundle;
        setActiveFarmId(workspace?.farmId||id);setBundle(next);setFarms(next?.farm?[next.farm]:[]);setAllSensors(next?.sensors||[]);setAllPlots(next?.plots||[]);setAllDrone(next?.droneMappings||[]);
        setFarmFitRevision(v=>v+1);
        return;
      }
      const result=await adminAction('getFarmWorkspace',{farm_id:id});
      if(result?.bundle) applyAuthoritativeBundle(id,result.bundle);
    }catch(err){setNotice(err.message);}
  }
  const current=bundle?.farm || farms.find(f=>f.id===activeFarmId) || farms[0];
  const sensors=bundle?.sensors||[]; const plots=bundle?.plots||[]; const droneMappings=bundle?.droneMappings||[];
  const farmNameMap=useMemo(()=>new Map(farms.map(f=>[f.id,`${f.farmer_name} • ${f.name}`])),[farms]);
  const sensorGlobal=useMemo(()=>allSensors.map(s=>({...s,farm_name:farmNameMap.get(s.farm_id)||'Unknown farm'})),[allSensors,farmNameMap]);
  const plotGlobal=useMemo(()=>allPlots.map(p=>({...p,farm_name:farmNameMap.get(p.farm_id)||'Unknown farm'})),[allPlots,farmNameMap]);
  const droneGlobal=useMemo(()=>allDrone.map(d=>({...d,farm_name:farmNameMap.get(d.farm_id)||'Unknown farm'})),[allDrone,farmNameMap]);
  const online=allSensors.filter(s=>s.status!=='Offline').length;

  const ensureWrite=()=>{if(!isAdmin){setNotice('Only administrator accounts can modify map records.');return false;}return true;};
  const localId=(prefix)=>`${prefix}-pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  const closeSpatialUi=()=>{setModal(null);setDrawMode(null);setDrawPoints([]);setPlacementOrientation(0);setPendingShape(null);};

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
      const row={id:tempId,farm_id:payload.farm_id,sensor_code:payload.sensor_code||'Sensor',latitude:Number(payload.latitude),longitude:Number(payload.longitude),coverage_m:Number(payload.coverage_m||50),orientation_deg:Number(payload.orientation_deg||0),status:payload.status||'Online',nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),moisture:Number(payload.moisture||0),recorded_at:stamp};
      setAllSensors(rows=>[...rows,row]);
      setBundle(b=>b?.farm?.id===payload.farm_id?{...b,sensors:[...b.sensors,row]}:b);
      setSelectedSensorId(tempId);setSelectedPlotId(null);setSelectedDroneId(null);setFocusTarget(row);
      return;
    }
    if(action==='updateSensor'){
      const patch={sensor_code:payload.sensor_code,latitude:Number(payload.latitude),longitude:Number(payload.longitude),coverage_m:Number(payload.coverage_m||50),orientation_deg:Number(payload.orientation_deg||0),status:payload.status||'Online',nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),moisture:Number(payload.moisture||0),recorded_at:stamp};
      setAllSensors(rows=>rows.map(row=>row.id===payload.sensor_id?{...row,...patch}:row));
      setBundle(b=>b?{...b,sensors:b.sensors.map(row=>row.id===payload.sensor_id?{...row,...patch}:row)}:b);
      return;
    }
    if(action==='rotateSensor'){
      const angle=cleanAngle(payload.orientation_deg);
      setAllSensors(rows=>rows.map(row=>row.id===payload.sensor_id?{...row,orientation_deg:angle}:row));
      setBundle(b=>b?{...b,sensors:b.sensors.map(row=>row.id===payload.sensor_id?{...row,orientation_deg:angle}:row)}:b);
      setFocusTarget(target=>target?.id===payload.sensor_id?{...target,orientation_deg:angle}:target);
      return;
    }
    if(action==='deleteSensor'){
      const key=logicalName(payload.sensor_code);
      const remove=row=>row.id===payload.sensor_id || (row.farm_id===payload.farm_id && key && logicalName(row.sensor_code)===key);
      setAllSensors(rows=>rows.filter(row=>!remove(row)));
      setBundle(b=>b?{...b,sensors:b.sensors.filter(row=>!remove(row))}:b);
      setSelectedSensorId(null);setFocusTarget(null);setMapRevision(v=>v+1);
      return;
    }
    if(action==='createPlot'){
      const row={id:tempId,farm_id:payload.farm_id,plot_code:payload.plot_code||'Soil Plot',latitude:Number(payload.latitude),longitude:Number(payload.longitude),coverage_m:Number(payload.coverage_m||0),boundary:[...(payload.geojson||[])],nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),classification:payload.classification||'Pending',notes:payload.notes||'',analyzed_at:stamp};
      setAllPlots(rows=>[...rows,row]);
      setBundle(b=>b?.farm?.id===payload.farm_id?{...b,plots:[...b.plots,row]}:b);
      setSelectedPlotId(tempId);setSelectedSensorId(null);setSelectedDroneId(null);setFocusTarget(row);
      return;
    }
    if(action==='updatePlot'){
      const patch={plot_code:payload.plot_code,latitude:Number(payload.latitude),longitude:Number(payload.longitude),coverage_m:Number(payload.coverage_m||0),boundary:payload.geojson?[...(payload.geojson||[])]:undefined,nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),classification:payload.classification||'Pending',notes:payload.notes||'',analyzed_at:stamp};
      setAllPlots(rows=>rows.map(row=>row.id===payload.plot_id?{...row,...Object.fromEntries(Object.entries(patch).filter(([,v])=>v!==undefined))}:row));
      setBundle(b=>b?{...b,plots:b.plots.map(row=>row.id===payload.plot_id?{...row,...Object.fromEntries(Object.entries(patch).filter(([,v])=>v!==undefined))}:row)}:b);
      return;
    }
    if(action==='deletePlot'){
      const key=logicalName(payload.plot_code);
      const remove=row=>row.id===payload.plot_id || (row.farm_id===payload.farm_id && key && logicalName(row.plot_code)===key);
      setAllPlots(rows=>rows.filter(row=>!remove(row)));
      setBundle(b=>b?{...b,plots:b.plots.filter(row=>!remove(row))}:b);
      setSelectedPlotId(null);setFocusTarget(null);setMapRevision(v=>v+1);
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
      const key=logicalName(payload.name);
      const remove=row=>row.id===payload.drone_id || (row.farm_id===payload.farm_id && key && logicalName(row.name)===key);
      setAllDrone(rows=>rows.filter(row=>!remove(row)));
      setBundle(b=>b?{...b,droneMappings:b.droneMappings.filter(row=>!remove(row))}:b);
      setSelectedDroneId(null);setFocusTarget(null);setMapRevision(v=>v+1);
    }
  }

  function reconcileTempId(action,tempId,result){
    const realId=action==='createSensor'?result?.sensorId:action==='createPlot'?result?.plotId:action==='createDroneMapping'?result?.droneId:null;
    if(!tempId||!realId)return;
    if(action==='createSensor'){
      setAllSensors(rows=>rows.map(row=>row.id===tempId?{...row,id:realId}:row));
      setBundle(b=>b?{...b,sensors:b.sensors.map(row=>row.id===tempId?{...row,id:realId}:row)}:b);
      setSelectedSensorId(id=>id===tempId?realId:id);setFocusTarget(t=>t?.id===tempId?{...t,id:realId}:t);
    } else if(action==='createPlot'){
      const exact=result?.row?{...result.row,id:realId}:null;
      setAllPlots(rows=>rows.map(row=>row.id===tempId?(exact?{...row,...exact,id:realId}:{...row,id:realId}):row));
      setBundle(b=>b?{...b,plots:b.plots.map(row=>row.id===tempId?(exact?{...row,...exact,id:realId}:{...row,id:realId}):row)}:b);
      setSelectedPlotId(id=>id===tempId?realId:id);setFocusTarget(t=>t?.id===tempId?(exact?{...t,...exact,id:realId}:{...t,id:realId}):t);
    } else if(action==='createDroneMapping'){
      const exact=result?.row?{...result.row,id:realId}:null;
      setAllDrone(rows=>rows.map(row=>row.id===tempId?(exact?{...row,...exact,id:realId}:{...row,id:realId}):row));
      setBundle(b=>b?{...b,droneMappings:b.droneMappings.map(row=>row.id===tempId?(exact?{...row,...exact,id:realId}:{...row,id:realId}):row)}:b);
      setSelectedDroneId(id=>id===tempId?realId:id);
      setFocusTarget(target=>target?.id===tempId?(exact?{...target,...exact,id:realId}:{...target,id:realId}):target);
    }
  }

  function applyAuthoritativeBundle(farmId,nextBundle){
    if(!farmId||!nextBundle?.farm)return;
    const normalized={farm:nextBundle.farm,sensors:nextBundle.sensors||[],plots:nextBundle.plots||[],droneMappings:nextBundle.droneMappings||[]};
    setFarms(rows=>{const rest=rows.filter(f=>f.id!==farmId);return [...rest,normalized.farm].sort((a,b)=>String(a.farmer_name||'').localeCompare(String(b.farmer_name||'')));});
    setAllSensors(rows=>[...rows.filter(r=>r.farm_id!==farmId),...normalized.sensors]);
    setAllPlots(rows=>[...rows.filter(r=>r.farm_id!==farmId),...normalized.plots]);
    setAllDrone(rows=>[...rows.filter(r=>r.farm_id!==farmId),...normalized.droneMappings]);
    if(activeFarmId===farmId)setBundle(normalized);
    setMapRevision(v=>v+1);
    const liveIds=new Set([...normalized.sensors,...normalized.plots,...normalized.droneMappings].map(row=>row.id));
    setSelectedSensorId(id=>id&&normalized.sensors.some(row=>row.id===id)?id:null);
    setSelectedPlotId(id=>id&&normalized.plots.some(row=>row.id===id)?id:null);
    setSelectedDroneId(id=>id&&normalized.droneMappings.some(row=>row.id===id)?id:null);
    setFocusTarget(target=>{
      if(!target?.id || target.farm_id!==farmId) return target;
      if(!liveIds.has(target.id)) return null;
      const fresh=normalized.sensors.find(row=>row.id===target.id)||normalized.plots.find(row=>row.id===target.id)||normalized.droneMappings.find(row=>row.id===target.id);
      if(!fresh) return null;
      const boundary=fresh.boundary||[];
      return {...fresh,latitude:Number(fresh.latitude??fresh.center_lat??(boundary.length?boundary.reduce((sum,p)=>sum+Number(p[0]||0),0)/boundary.length:0)),longitude:Number(fresh.longitude??fresh.center_lng??(boundary.length?boundary.reduce((sum,p)=>sum+Number(p[1]||0),0)/boundary.length:0))};
    });
  }

  async function reconcileAuthoritativeFarm(farmId){
    if(!farmId||isDemo)return true;
    try{
      const result=await adminAction('getFarmWorkspace',{farm_id:farmId});
      if(result?.bundle)applyAuthoritativeBundle(farmId,result.bundle);
      return true;
    }catch(err){
      console.warn('Authoritative map reconciliation failed after a confirmed write:',err);
      return false;
    }
  }

  async function runSpatialAction(action,payload,success,{tempId=null}={}){
    if(!ensureWrite())return false;
    if(spatialActionLockRef.current){
      setNotice('A map change is already being saved. Please wait for it to finish.');
      return false;
    }
    spatialActionLockRef.current=true;
    const snapshot={farms,allSensors,allPlots,allDrone,bundle,selectedSensorId,selectedPlotId,selectedDroneId,focusTarget};
    closeSpatialUi();
    if(isDemo){
      try{applyDemoAction(action,payload);syncDemoState(payload.farm_id||activeFarmId);setNotice(`${success} Demo changes are saved in this browser.`);setEditor(null);return true;}catch(err){setNotice(err.message);return false;}finally{spatialActionLockRef.current=false;}
    }
    // Plot and Drone creates are rendered only from the exact authoritative row
    // returned by the server. Do not add a temporary polygon first: that old
    // optimistic + authoritative handoff was the source of visible double/ghost
    // plotting when React and the journal reconciled at slightly different times.
    const serverOnlyCreate=action==='createPlot'||action==='createDroneMapping';
    if(!serverOnlyCreate) applyOptimistic(action,payload,tempId);
    setBusy(true);
    try{
      const result=await adminAction(action,payload);
      if(!serverOnlyCreate) reconcileTempId(action,tempId,result);
      const farmId=payload.farm_id||result?.farmId||activeFarmId;
      let reconciled=false;
      if(result?.bundle?.farm){ applyAuthoritativeBundle(farmId,result.bundle); reconciled=true; }
      else reconciled=await reconcileAuthoritativeFarm(farmId);
      setNotice(reconciled?success:`${success} The write is confirmed; the map will reconcile again on the next refresh.`);
      setEditor(null);return true;
    }catch(err){
      setFarms(snapshot.farms);setAllSensors(snapshot.allSensors);setAllPlots(snapshot.allPlots);setAllDrone(snapshot.allDrone);setBundle(snapshot.bundle);
      setSelectedSensorId(snapshot.selectedSensorId);setSelectedPlotId(snapshot.selectedPlotId);setSelectedDroneId(snapshot.selectedDroneId);setFocusTarget(snapshot.focusTarget);
      setNotice(`The save could not be confirmed, so the previous map state was restored. ${err.message}`);return false;
    }finally{spatialActionLockRef.current=false;setBusy(false);}
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

  const startDraw=(kind)=>{
    if(!ensureWrite())return;
    if(!activeFarmId){setNotice('Select a farmer/farm first.');return;}
    if(kind!=='farm' && (!current?.boundary || current.boundary.length<3)){setNotice('Draw and save this farmer’s Farm Boundary first. Sensors, Soil Plots, and Drone Mapping must belong inside that boundary.');return;}
    setSelectedSensorId(null);setSelectedPlotId(null);setSelectedDroneId(null);setFocusTarget(null);
    setPendingShape(null);setPlacementOrientation(0);
    if(kind==='sensor'){const c=polygonStats(current.boundary);setDrawPoints([[c.center_lat,c.center_lng]]);}else setDrawPoints([]);
    setDrawMode(kind);
    setNotice(kind==='plot'?'Soil Plot drawing is active. Click point-by-point inside the green farm boundary.':kind==='drone'?'Drone Mapping drawing is active. Click point-by-point inside the green farm boundary.':kind==='sensor'?'Drag the sensor inside the farm, then drag the ROTATE handle around it with your mouse.':'Farm Boundary drawing is active. Click point-by-point to trace it.');
  };
  const cancelDraw=()=>{setDrawMode(null);setDrawPoints([]);setPlacementOrientation(0);setPendingShape(null);};
  const mapPoint=(point)=>{
    if(['plot','drone'].includes(drawMode) && current?.boundary?.length>=3 && !pointInPolygon(point,current.boundary)){
      setNotice('That point is outside the farmer’s Farm Boundary. Place Sensors, Soil Plots, and Drone Mapping inside the mapped farm.');
      return;
    }
    setDrawPoints(v=>drawMode==='sensor'?[point]:[...v,point]);
  };
  const continueDraw=()=>{
    if(drawMode==='farm') return saveFarmBoundary();
    const points=drawMode==='sensor'?[...drawPoints]:cleanPolygon(drawPoints);
    if(drawMode!=='sensor' && points.length<3){setNotice('Add at least 3 polygon points before continuing.');return;}
    if(drawMode!=='sensor' && polygonHasCrossing(points)){setNotice('This polygon crosses over itself. Use Undo or Clear and trace the boundary around the edge in order.');return;}
    if(drawMode==='sensor' && points.length<1){setNotice('Place the sensor before continuing.');return;}
    if(drawMode==='sensor' && current?.boundary?.length>=3 && !pointInPolygon(points[0],current.boundary)){setNotice('The sensor is outside the farmer’s Farm Boundary. Drag it inside the green boundary before continuing.');return;}
    setPendingShape({draft_id:localId('draft'),type:drawMode,farm_id:activeFarmId,points:points.map(p=>[Number(p[0]),Number(p[1])]),orientation_deg:drawMode==='sensor'?cleanAngle(placementOrientation):0}); setModal(drawMode); setDrawMode(null);
  };
  const saveFarmBoundary=()=>{const points=cleanPolygon(drawPoints);if(points.length<3){setNotice('Add at least 3 farm boundary points before saving.');return;}if(polygonHasCrossing(points)){setNotice('The Farm Boundary crosses over itself. Use Undo or Clear, then trace the outer edge in order.');return;}const stats=polygonStats(points);runSpatialAction('updateFarmBoundary',{farm_id:activeFarmId,geojson:points,...stats,status:'Mapped'},'Farm boundary saved instantly and synced to Appwrite.');};
  const deleteBoundary=()=>{if(!current?.boundary?.length)return;if(confirm(`Delete the mapped boundary for ${current.name}?`))runSpatialAction('deleteFarmBoundary',{farm_id:current.id},'Farm boundary deleted and synced.');};
  const deleteFarmer=()=>{if(current&&confirm(`Delete ${current.farmer_name}, their login, farm, sensors, plots, analyses, and drone mappings?`))runAction('deleteFarmer',{farmer_id:current.farmer_id,farm_id:current.id},'Farmer and associated farm data deleted.');};

  const clearSpatialSelection=()=>{setSelectedSensorId(null);setSelectedPlotId(null);setSelectedDroneId(null);setFocusTarget(null);};

  async function selectSensor(sensor, openSensorView=false){
    if(!sensor?.id){clearSpatialSelection();return;}
    const target={...sensor,latitude:Number(sensor.latitude),longitude:Number(sensor.longitude)};
    setSelectedSensorId(sensor.id);setSelectedPlotId(null);setSelectedDroneId(null);setFocusTarget(target);if(openSensorView)setView('sensors');
    if(isAdmin && sensor.farm_id && sensor.farm_id!==activeFarmId){setActiveFarmId(sensor.farm_id);try{setBundle(isDemo?loadLocalDemoBundle(sensor.farm_id):(await adminAction('getFarmWorkspace',{farm_id:sensor.farm_id}))?.bundle||null);}catch{}}
  }
  async function locateSensor(sensor){
    if(!sensor?.id){clearSpatialSelection();return;}
    const target={...sensor,latitude:Number(sensor.latitude),longitude:Number(sensor.longitude)};
    // Directory clicks are navigation only. Preview selection remains empty until
    // the user clicks the actual sensor pin/coverage on the map.
    setSelectedSensorId(null);setSelectedPlotId(null);setSelectedDroneId(null);setFocusTarget(target);
    if(isAdmin && sensor.farm_id){
      setActiveFarmId(sensor.farm_id);
      if(sensor.farm_id!==activeFarmId){try{setBundle(isDemo?loadLocalDemoBundle(sensor.farm_id):(await adminAction('getFarmWorkspace',{farm_id:sensor.farm_id}))?.bundle||null);}catch{}}
    }
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
      try{setBundle(isDemo?loadLocalDemoBundle(plot.farm_id):(await adminAction('getFarmWorkspace',{farm_id:plot.farm_id}))?.bundle||null);}catch{}
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
      try{setBundle(isDemo?loadLocalDemoBundle(drone.farm_id):(await adminAction('getFarmWorkspace',{farm_id:drone.farm_id}))?.bundle||null);}catch{}
    }
  }
  const selectedSensor=(isAdmin?allSensors:sensors).find(s=>s.id===selectedSensorId) || null;
  const selectedPlot=(isAdmin?allPlots:plots).find(p=>p.id===selectedPlotId) || null;
  const selectedDrone=(isAdmin?droneGlobal:droneMappings).find(d=>d.id===selectedDroneId) || null;

  useEffect(()=>{
    if(isAdmin) return;
    if(selectedSensorId && !sensors.some(s=>s.id===selectedSensorId)) clearSpatialSelection();
    else if(selectedPlotId && !plots.some(p=>p.id===selectedPlotId)) clearSpatialSelection();
    else if(selectedDroneId && !droneMappings.some(d=>d.id===selectedDroneId)) clearSpatialSelection();
  },[isAdmin,selectedSensorId,selectedPlotId,selectedDroneId,sensors.map(s=>s.id).join('|'),plots.map(p=>p.id).join('|'),droneMappings.map(d=>d.id).join('|')]);


  const saveSensor=(form)=>runSpatialAction('updateSensor',{sensor_id:form.id,farm_id:form.farm_id||selectedSensor?.farm_id,...form,orientation_deg:cleanAngle(form.orientation_deg)},'Sensor readings, coverage, and rotation published to the farmer.');
  const rotateSensorQuick=(sensor,delta)=>{
    const orientation_deg=cleanAngle(Number(sensor?.orientation_deg||0)+Number(delta||0));
    return runSpatialAction('rotateSensor',{sensor_id:sensor.id,farm_id:sensor.farm_id,orientation_deg},`Sensor rotated to ${orientation_deg.toFixed(0)}° and synced to the farmer.`);
  };
  const deleteSensor=(sensor)=>{if(confirm(`Delete ${sensor.sensor_code} and all of its readings?`))runSpatialAction('deleteSensor',{sensor_id:sensor.id,farm_id:sensor.farm_id,sensor_code:sensor.sensor_code},'Sensor permanently deleted from Appwrite and synced.');};
  const savePlot=(form)=>runSpatialAction('updatePlot',{plot_id:form.id,farm_id:form.farm_id||selectedPlot?.farm_id,...form},'Soil analysis plot values published to the farmer.');
  const deletePlot=(plot)=>{if(confirm(`Delete ${plot.plot_code} and its soil analysis?`))runSpatialAction('deletePlot',{plot_id:plot.id,farm_id:plot.farm_id,plot_code:plot.plot_code},'Soil analysis plot permanently deleted from Appwrite and synced.');};
  const saveDrone=(form)=>runSpatialAction('updateDroneMapping',{drone_id:form.id,farm_id:form.farm_id||selectedDrone?.farm_id,...form},'Drone mapping statistics updated and published.');
  const deleteDrone=(d)=>{if(confirm(`Delete ${d.name}?`))runSpatialAction('deleteDroneMapping',{drone_id:d.id,farm_id:d.farm_id,name:d.name},'Drone mapping permanently deleted from Appwrite and synced.');};

  const previewFor=(farmName=current?.name)=>{
    if(selectedSensor)return <RecordPreview sensor={selectedSensor} farmName={farmName} editable={isAdmin} onEdit={()=>setEditor({type:'sensor',row:selectedSensor})} onRotate={(row,delta)=>rotateSensorQuick(row,delta)} onDelete={deleteSensor} onClose={()=>selectSensor(null)} busy={busy}/>;
    if(selectedPlot)return <RecordPreview plot={selectedPlot} farmName={farmName} editable={isAdmin} onEdit={()=>setEditor({type:'plot',row:selectedPlot})} onDelete={deletePlot} onClose={()=>selectPlot(null)} busy={busy}/>;
    if(selectedDrone)return <RecordPreview drone={selectedDrone} farmName={farmName} editable={isAdmin} onEdit={()=>setEditor({type:'drone',row:selectedDrone})} onDelete={deleteDrone} onClose={()=>selectDrone(null)} busy={busy}/>;
    return null;
  };

  const farmToolbar=<MapToolbar drawMode={drawMode} points={drawPoints} onStart={startDraw} onUndo={()=>setDrawPoints(v=>v.slice(0,-1))} onClear={()=>setDrawPoints([])} onCancel={cancelDraw} onSave={continueDraw} onDeleteBoundary={deleteBoundary} canDeleteBoundary={!!current?.boundary?.length} busy={busy}/>;

  const navigateView=(nextView)=>{
    const previous=previousViewRef.current;
    previousViewRef.current=nextView;
    // Entering the Sensors directory is navigation-only. Never carry an old map
    // preview into the page. Directory clicks only set focusTarget; the preview
    // opens after the actual pin/coverage is clicked.
    if(nextView==='sensors' && previous!=='sensors') clearSpatialSelection();

    // My Farm is a navigation command, not just a tab switch. Use the boundary
    // already in memory immediately so the map moves without waiting on the API.
    // Then refresh the authoritative Farmer workspace in the background and fit
    // again only if newer boundary data arrives. This also works when My Farm is
    // clicked repeatedly while already on the farm page.
    if(!isAdmin && nextView==='farm'){
      clearSpatialSelection();
      const immediateFarmId=activeFarmId||bundle?.farm?.id||farms[0]?.id||null;
      if(immediateFarmId) setActiveFarmId(immediateFarmId);
      setView('farm');
      setFarmFitRevision(v=>v+1);

      const seq=++farmerSyncSeqRef.current;
      getFarmerWorkspace().then(workspace=>{
        if(seq!==farmerSyncSeqRef.current)return;
        const next=workspace?.bundle;
        const nextFarmId=workspace?.farmId||next?.farm?.id||immediateFarmId;
        setActiveFarmId(nextFarmId||null);
        setBundle(next);
        setFarms(next?.farm?[next.farm]:[]);
        setAllSensors(next?.sensors||[]);
        setAllPlots(next?.plots||[]);
        setAllDrone(next?.droneMappings||[]);
        setMapRevision(v=>v+1);
        setFarmFitRevision(v=>v+1);
      }).catch(err=>setNotice(err.message||'Unable to refresh the Farmer workspace.'));
      return;
    }

    setView(nextView);
  };

  return <div className="app-shell sharp-layout"><AppSidebar role={mode} view={view} setView={navigateView} farms={farms} activeFarmId={activeFarmId} openFarm={openFarm} user={user} logout={logout}/><main className="main-content">{notice&&<div className="notice-bar"><span>{notice}</span><button onClick={()=>setNotice('')}>×</button></div>}{loading?<div className="loading-screen"><div className="loader"/><b>Loading soil workspace…</b><span>Preparing maps and soil layers</span></div>:<div key={`${mode}-${view}-${activeFarmId||'global'}`} className="view-stage">
    {view==='overview' && isAdmin && <AdminOverview farms={farms} sensors={sensorGlobal} plots={plotGlobal} drone={droneGlobal} activeFarmId={activeFarmId} openFarm={openFarm} online={online} toolbar={farmToolbar} drawProps={{drawMode,drawPoints,onMapPoint:mapPoint,drawOrientation:placementOrientation,onDrawOrientation:setPlacementOrientation}} selectSensor={selectSensor} onPlot={selectPlot} onDrone={selectDrone} selectedSensor={selectedSensor} selectedPlot={selectedPlot} selectedDrone={selectedDrone} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSaveSensor={saveSensor} onDeleteSensor={deleteSensor} onSaveDrone={saveDrone} onDeleteDrone={deleteDrone} farmNameMap={farmNameMap} busy={busy} onAddFarmer={()=>setModal('farmer')} mapRevision={mapRevision} preview={previewFor(selectedSensor?.farm_name||selectedPlot?.farm_name||selectedDrone?.farm_name||current?.name)}/>} 
    {view==='statistics' && isAdmin && <Statistics farms={farms} sensors={allSensors} plots={allPlots} drone={allDrone} activeFarmId={activeFarmId}/>} 
    {view==='sensors' && <SensorPage admin={isAdmin} farms={farms} sensors={isAdmin?sensorGlobal:sensors} plots={isAdmin?plotGlobal:plots} drone={isAdmin?droneGlobal:droneMappings} activeFarmId={activeFarmId} selectedSensor={selectedSensor} selectedPlot={selectedPlot} selectedDrone={selectedDrone} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onLocate={locateSensor} onSelect={s=>selectSensor(s,false)} onPlot={selectPlot} onDrone={selectDrone} onSave={saveSensor} onDelete={deleteSensor} onSaveDrone={saveDrone} onDeleteDrone={deleteDrone} busy={busy} mapRevision={mapRevision} preview={previewFor(selectedSensor?.farm_name||selectedPlot?.farm_name||selectedDrone?.farm_name||current?.name)}/>} 
    {(view==='farmer' || (!isAdmin && (view==='farm'||view==='overview'))) && (current?<FarmDetail farm={current} sensors={sensors} plots={plots} drone={droneMappings} userMode={!isAdmin} overview={view==='overview'} admin={isAdmin} toolbar={farmToolbar} drawProps={{drawMode,drawPoints,onMapPoint:mapPoint,drawOrientation:placementOrientation,onDrawOrientation:setPlacementOrientation}} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSensor={s=>selectSensor(s,false)} onPlot={selectPlot} onDrone={selectDrone} selectedSensor={selectedSensor} selectedPlot={selectedPlot} selectedDrone={selectedDrone} onSaveSensor={saveSensor} onSaveDrone={saveDrone} onDeleteSensor={deleteSensor} onDeletePlot={deletePlot} onDeleteDrone={deleteDrone} onDeleteFarmer={deleteFarmer} busy={busy} mapRevision={mapRevision} preview={previewFor(current?.name)} fitRequestKey={farmFitRevision}/>:<Empty text="No farm is assigned to this account"/>)}
    {!isAdmin && view==='analysis' && <AnalysisPage farm={current} sensors={sensors} plots={plots}/>} 
  </div>}

  {modal==='farmer'&&<FarmerModal busy={busy} onClose={()=>setModal(null)} onSave={(data)=>runAction('createFarmer',data,'Farmer account and farm created.')}/>} 
  {modal==='sensor'&&<SensorCreateModal point={pendingShape?.points?.[0]} orientation={pendingShape?.orientation_deg||0} busy={busy} onClose={()=>{setModal(null);setPendingShape(null)}} onSave={(data)=>{const tempId=localId('sensor');runSpatialAction('createSensor',{farm_id:pendingShape?.farm_id||activeFarmId,latitude:pendingShape.points[0][0],longitude:pendingShape.points[0][1],...data,orientation_deg:cleanAngle(pendingShape?.orientation_deg||data.orientation_deg||0)},'Sensor added instantly and synced to Appwrite.',{tempId})}}/>} 
  {modal==='plot'&&<PlotCreateModal key={pendingShape?.draft_id||'plot-create'} defaultName={nextNumberedName(plots,'Plot','plot_code')} points={pendingShape?.points||[]} busy={busy} onClose={()=>{setModal(null);setPendingShape(null)}} onSave={(data)=>{if(!pendingShape?.points?.length)return false;const shape=pendingShape.points.map(p=>[Number(p[0]),Number(p[1])]);const stats=polygonStats(shape);const tempId=localId('plot');return runSpatialAction('createPlot',{farm_id:pendingShape?.farm_id||activeFarmId,geojson:shape,latitude:stats.center_lat,longitude:stats.center_lng,...data},'Soil analysis plot added and saved to Appwrite.',{tempId}) }}/>} 
  {modal==='drone'&&<DroneCreateModal key={pendingShape?.draft_id||'drone-create'} defaultName={nextNumberedName(droneMappings,'Drone Mapping','name')} points={pendingShape?.points||[]} busy={busy} onClose={()=>{setModal(null);setPendingShape(null)}} onSave={(data)=>{if(!pendingShape?.points?.length)return false;const shape=pendingShape.points.map(p=>[Number(p[0]),Number(p[1])]);const stats=polygonStats(shape);const tempId=localId('drone');return runSpatialAction('createDroneMapping',{farm_id:pendingShape?.farm_id||activeFarmId,geojson:shape,...stats,...data},'Drone mapping added and saved to Appwrite.',{tempId})}}/>} 
  {editor?.type==='sensor'&&<SensorEditorModal sensor={editor.row} busy={busy} onClose={()=>setEditor(null)} onSave={saveSensor}/>}
  {editor?.type==='plot'&&<PlotEditorModal plot={editor.row} busy={busy} onClose={()=>setEditor(null)} onSave={savePlot}/>}
  {editor?.type==='drone'&&<DroneEditorModal drone={editor.row} busy={busy} onClose={()=>setEditor(null)} onSave={saveDrone}/>}
  </main></div>;
}

function AdminOverview({
  farms,sensors,plots,drone,activeFarmId,openFarm,online,toolbar,drawProps,
  selectSensor,onPlot,onDrone,selectedSensor,selectedPlot,selectedDrone,selectedSensorId,selectedPlotId,selectedDroneId,focusTarget,
  onSaveSensor,onDeleteSensor,onSaveDrone,onDeleteDrone,farmNameMap,busy,onAddFarmer,mapRevision,preview
}){
  const area=farms.reduce((s,f)=>s+(Number(f.area_hectares)||0),0);
  return <>
    <Header title="Overview" subtitle="Your overall farm network map, soil layers, farmer status, and live field records in one workspace." action={<button className="primary-btn header-btn" onClick={onAddFarmer}><Plus size={15}/>Add farmer</button>}/>
    <div className="metric-grid overview-stat-grid">
      <MetricCard icon={LandPlot} label="Monitored farms" value={farms.length} note="Registered farmers and boundaries"/>
      <MetricCard icon={RadioTower} label="Active sensors" value={online} suffix={` / ${sensors.length}`} note="Reporting stations" tone="blue"/>
      <MetricCard icon={FlaskConical} label="Soil analysis plots" value={plots.length} note="Laboratory sampling zones" tone="amber"/>
      <MetricCard icon={Activity} label="Coverage area" value={number(area,1)} suffix=" ha" note={`${drone.length} drone mapping areas`} tone="violet"/>
    </div>
    <div className="overview-map-grid">
      <MapWorkspace
        farms={farms}
        sensors={sensors}
        plots={plots}
        droneMappings={drone}
        activeFarmId={activeFarmId}
        onFarmClick={(f)=>openFarm(f.id)}
        admin
        height={600}
        selectedSensorId={selectedSensorId}
        selectedPlotId={selectedPlotId}
        selectedDroneId={selectedDroneId}
        focusTarget={focusTarget}
        onSensorClick={selectSensor}
        onPlotClick={onPlot}
        onDroneClick={onDrone}
        onDroneDelete={onDeleteDrone}
        drawMode={drawProps.drawMode}
        drawPoints={drawProps.drawPoints}
        onMapPoint={drawProps.onMapPoint}
        drawOrientation={drawProps.drawOrientation}
        onDrawOrientation={drawProps.onDrawOrientation}
        toolbar={toolbar}
        showMapPopups={false}
        preview={preview}
        dataRevision={mapRevision}
      />
    </div>
    <section className="panel overview-farmer-panel overview-farmer-strip">
      <div className="panel-title"><div><span>FARM STATUS</span><h3>Farmers</h3></div><small>{farms.length} total</small></div>
      <div className="farm-table">{farms.map(f=><button key={f.id} onClick={()=>openFarm(f.id)}><div className="farm-icon"><Sprout size={17}/></div><div><b>{f.farmer_name}</b><span>{f.name}</span></div><StatusPill value={f.status||'Good'}/></button>)}</div>
    </section>
    <div className="dashboard-grid equal"><TrendChart/><DistributionChart/></div>
  </>;
}

function FarmDetail({farm,sensors,plots,drone,userMode,overview,admin,toolbar,drawProps,selectedSensorId,selectedPlotId,selectedDroneId,focusTarget,onSensor,onPlot,onDrone,selectedSensor,selectedPlot,selectedDrone,onSaveSensor,onSaveDrone,onDeleteSensor,onDeletePlot,onDeleteDrone,onDeleteFarmer,busy,mapRevision,preview,fitRequestKey=0}){
  const m={n:avg(sensors,'nitrogen'),p:avg(sensors,'phosphorus'),k:avg(sensors,'potassium'),ph:avg(sensors,'ph'),om:avg(sensors,'organic_matter')};
  return <>
    <Header title={userMode?(overview?'My Soil Overview':'My Farm'):farm.farmer_name} subtitle={`${farm.name} • ${farm.location_name || 'Farm location'}`} action={admin?<button className="danger-btn header-btn" onClick={onDeleteFarmer}><Trash2 size={15}/>Delete farmer</button>:null}/>
    <div className="farm-heading"><div><StatusPill value={farm.status||'Good'}/><span>{number(farm.area_hectares,2)} hectares</span><span>{sensors.filter(s=>s.status!=='Offline').length}/{sensors.length} sensors online</span>{userMode&&<span className="sync-badge"><i/> Live synced</span>}</div></div>
    <div className="metric-grid five"><MetricCard icon={Leaf} label="Nitrogen" value={number(m.n,0)} suffix=" mg/kg"/><MetricCard icon={TestTube2} label="Phosphorus" value={number(m.p,0)} suffix=" mg/kg" tone="blue"/><MetricCard icon={Gauge} label="Potassium" value={number(m.k,0)} suffix=" mg/kg" tone="amber"/><MetricCard icon={Activity} label="Average pH" value={number(m.ph,2)} tone="violet"/><MetricCard icon={Sprout} label="Organic material" value={number(m.om,1)} suffix="%"/></div>
    <div className="map-with-inspector unified-map-preview-layout">
      <MapWorkspace farms={[farm]} sensors={sensors} plots={plots} droneMappings={drone} activeFarmId={farm.id} admin={admin} height={overview?500:610} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSensorClick={onSensor} onPlotClick={onPlot} onDroneClick={onDrone} onDroneDelete={onDeleteDrone} drawMode={drawProps.drawMode} drawPoints={drawProps.drawPoints} onMapPoint={drawProps.onMapPoint} drawOrientation={drawProps.drawOrientation} onDrawOrientation={drawProps.onDrawOrientation} toolbar={toolbar} showMapPopups={false} preview={preview} fitRequestKey={fitRequestKey} dataRevision={mapRevision}/>
    </div>
    <div className="dashboard-grid equal"><SensorList sensors={sensors} onSelect={onSensor} selectedId={selectedSensorId} admin={admin} onDelete={onDeleteSensor}/><PlotAndDroneList plots={plots} drone={drone} admin={admin} onPlot={onPlot} onDrone={onDrone} onDeletePlot={onDeletePlot} onDeleteDrone={onDeleteDrone}/></div>
  </>;
}

function SensorPage({admin,farms,sensors,plots,drone,activeFarmId,selectedSensor,selectedPlot,selectedDrone,selectedSensorId,selectedPlotId,selectedDroneId,focusTarget,onLocate,onSelect,onPlot,onDrone,onSave,onDelete,onSaveDrone,onDeleteDrone,busy,mapRevision,preview}){
  const mapFarms=admin?farms:farms.slice(0,1);
  const farmName=selectedSensor?.farm_name || mapFarms.find(f=>f.id===(selectedSensor?.farm_id||selectedPlot?.farm_id||selectedDrone?.farm_id||activeFarmId))?.name || mapFarms[0]?.name;
  return <>
    <Header title={admin?'Sensor Network':'My Sensors'} subtitle={admin?'Choose a sensor from the list to move the map to it. Click the sensor pin on the map only when you want to open its preview/edit controls.':'Choose a sensor from the list to move the map to it. Click the actual map pin to open its read-only preview.'}/>
    <div className="sensor-page-grid">
      <section className="panel sensor-directory"><div className="panel-title"><div><span>FIELD DEVICES</span><h3>{admin?'All Sensors':'Farm Sensors'}</h3></div><small>{sensors.length} sensors</small></div><div className="sensor-cards">{sensors.length?sensors.map(s=><button key={s.id} className={selectedSensorId===s.id?'active':''} onClick={()=>onLocate?.(s)}><div className="sensor-beacon"><RadioTower size={16}/></div><div><b>{s.sensor_code}</b><span>{admin?s.farm_name:`${s.coverage_m||50}m coverage`}</span></div><StatusPill value={s.status||'Online'}/></button>):<Empty text="No sensors"/>}</div></section>
      <div className="sensor-map-stack">
        <MapWorkspace farms={mapFarms} sensors={sensors} plots={plots} droneMappings={drone} activeFarmId={selectedSensor?.farm_id||selectedPlot?.farm_id||selectedDrone?.farm_id||activeFarmId} height={520} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSensorClick={onSelect} onPlotClick={onPlot} onDroneClick={onDrone} showMapPopups={false} preview={preview} dataRevision={mapRevision}/>
        {!preview&&<section className="panel"><Empty text={focusTarget?.id?'Map centered on selected sensor':'Select a map record'} sub={focusTarget?.id?'Click the actual sensor pin or its coverage square on the map to open the preview.':'Choose a sensor in the directory to locate it, then click a map pin to preview its published data.'}/></section>}
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
function SensorCreateModal({point,orientation=0,onClose,onSave,busy}){const [f,setF]=useState({sensor_code:'Sensor 1',coverage_m:50,orientation_deg:cleanAngle(orientation),status:'Online',nitrogen:'',phosphorus:'',potassium:'',organic_matter:'',ph:'',moisture:''});const set=(k,v)=>setF(x=>({...x,[k]:v}));return <Modal title="Add Sensor" subtitle={`Placed at ${number(point?.[0],6)}, ${number(point?.[1],6)}. Coverage rotation ${cleanAngle(orientation).toFixed(0)}° was set directly on the map with the mouse handle.`} onClose={onClose} wide className="fixed-editor-modal"><form className="modal-form" onSubmit={e=>{e.preventDefault();onSave({...f,orientation_deg:cleanAngle(orientation)})}}><div className="editor-two-column"><section><h4>Station & placement</h4><div className="form-grid two"><label>Sensor name<input required value={f.sensor_code} onChange={e=>set('sensor_code',e.target.value)}/></label><label>Status<select value={f.status} onChange={e=>set('status',e.target.value)}><option>Online</option><option>Offline</option><option>Maintenance</option></select></label><label>Coverage square (meters)<input type="number" min="1" value={f.coverage_m} onChange={e=>set('coverage_m',e.target.value)}/></label></div><div className="placement-rotation-summary"><span>Coverage rotation</span><strong>{cleanAngle(orientation).toFixed(0)}°</strong><small>Set on the satellite map by dragging the ROTATE handle around the sensor.</small></div></section><section><h4>Initial soil readings</h4><div className="form-grid two"><label>Nitrogen (mg/kg)<input type="number" step="0.01" value={f.nitrogen} onChange={e=>set('nitrogen',e.target.value)}/></label><label>Phosphorus (mg/kg)<input type="number" step="0.01" value={f.phosphorus} onChange={e=>set('phosphorus',e.target.value)}/></label><label>Potassium (mg/kg)<input type="number" step="0.01" value={f.potassium} onChange={e=>set('potassium',e.target.value)}/></label><label>Organic material (%)<input type="number" step="0.01" value={f.organic_matter} onChange={e=>set('organic_matter',e.target.value)}/></label><label>pH<input type="number" step="0.01" value={f.ph} onChange={e=>set('ph',e.target.value)}/></label><label>Moisture (%)<input type="number" step="0.01" value={f.moisture} onChange={e=>set('moisture',e.target.value)}/></label></div></section></div><ModalActions busy={busy} onClose={onClose} label="Add sensor"/></form></Modal>}
function PlotCreateModal({points,defaultName='Plot 1',onClose,onSave,busy}){
  const [f,setF]=useState({plot_code:defaultName,classification:'Pending',nitrogen:'',phosphorus:'',potassium:'',organic_matter:'',ph:'',notes:''});
  const [submitting,setSubmitting]=useState(false);
  const submitLock=useRef(false);
  const set=(k,v)=>setF(x=>({...x,[k]:v}));
  const submit=async(e)=>{e.preventDefault();if(submitLock.current||busy)return;submitLock.current=true;setSubmitting(true);try{await onSave(f);}finally{submitLock.current=false;setSubmitting(false);}};
  return <Modal title="Add Soil Analysis Plot" subtitle={`${points.length} polygon points captured. These exact points and values will be published as a new Appwrite record.`} onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="form-grid two"><label>Plot name<input required value={f.plot_code} onChange={e=>set('plot_code',e.target.value)}/></label><label>Classification<select value={f.classification} onChange={e=>set('classification',e.target.value)}><option>Pending</option><option>Good</option><option>Monitor</option><option>Poor</option><option>Critical</option></select></label><label>Nitrogen<input type="number" step="0.01" value={f.nitrogen} onChange={e=>set('nitrogen',e.target.value)}/></label><label>Phosphorus<input type="number" step="0.01" value={f.phosphorus} onChange={e=>set('phosphorus',e.target.value)}/></label><label>Potassium<input type="number" step="0.01" value={f.potassium} onChange={e=>set('potassium',e.target.value)}/></label><label>Organic material (%)<input type="number" step="0.01" value={f.organic_matter} onChange={e=>set('organic_matter',e.target.value)}/></label><label>pH<input type="number" step="0.01" value={f.ph} onChange={e=>set('ph',e.target.value)}/></label><label className="full">Notes<textarea rows="3" value={f.notes} onChange={e=>set('notes',e.target.value)}/></label></div><ModalActions busy={busy||submitting} onClose={onClose} label="Create plot"/></form></Modal>}
function DroneCreateModal({points,defaultName='Drone Mapping 1',onClose,onSave,busy}){
  const [f,setF]=useState({
    name:defaultName,
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
  const [submitting,setSubmitting]=useState(false);
  const submitLock=useRef(false);
  const set=(k,v)=>setF(x=>({...x,[k]:v}));
  const submit=async(e)=>{e.preventDefault();if(submitLock.current||busy)return;submitLock.current=true;setSubmitting(true);try{await onSave({...f,captured_at:f.captured_at?new Date(f.captured_at).toISOString():new Date().toISOString()});}finally{submitLock.current=false;setSubmitting(false);}};
  return <Modal title="Add Drone Mapping" subtitle={`${points.length} polygon points captured. Add the soil observations represented by this drone-mapped area.`} onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
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
      <ModalActions busy={busy||submitting} onClose={onClose} label="Create mapping"/>
    </form>
  </Modal>;
}
function ModalActions({busy,onClose,label}){return <div className="modal-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary-btn" disabled={busy}>{busy?'Saving…':label}</button></div>}

function TrendChart(){return <section className="panel chart-panel"><div className="panel-title"><div><span>6-MONTH TREND</span><h3>Nutrient Movement</h3></div><small>Trend view</small></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trendData}><defs><linearGradient id="soilArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4bd66d" stopOpacity={.32}/><stop offset="95%" stopColor="#4bd66d" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#dce9df" vertical={false}/><XAxis dataKey="month" stroke="#718578" tickLine={false} axisLine={false}/><YAxis stroke="#718578" tickLine={false} axisLine={false}/><Tooltip contentStyle={{background:'#ffffff',border:'1px solid #cfe1d3',borderRadius:10,color:'#173b24'}}/><Area type="monotone" dataKey="nitrogen" stroke="#229c52" strokeWidth={2.5} fill="url(#soilArea)"/></AreaChart></ResponsiveContainer></div></section>}
function DistributionChart(){const colors=['#229c52','#d4a628','#e68642','#d95d53'];return <section className="panel chart-panel"><div className="panel-title"><div><span>SOIL HEALTH</span><h3>Classification Distribution</h3></div></div><div className="pie-layout"><div className="pie-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={soilDistribution} dataKey="value" innerRadius={58} outerRadius={85} paddingAngle={3}>{soilDistribution.map((_,i)=><Cell key={i} fill={colors[i]}/>)}</Pie><Tooltip contentStyle={{background:'#ffffff',border:'1px solid #cfe1d3',borderRadius:10,color:'#173b24'}}/></PieChart></ResponsiveContainer><div className="pie-center"><b>58%</b><span>Good</span></div></div><div className="pie-legend">{soilDistribution.map((d,i)=><span key={d.name}><i style={{background:colors[i]}}/>{d.name}<b>{d.value}%</b></span>)}</div></div></section>}
function NutrientBars({sensors=[]}){const data=[{name:'Nitrogen',value:avg(sensors,'nitrogen')},{name:'Phosphorus',value:avg(sensors,'phosphorus')},{name:'Potassium',value:avg(sensors,'potassium')},{name:'Organic',value:avg(sensors,'organic_matter')*10}];return <section className="panel chart-panel"><div className="panel-title"><div><span>NUTRIENT INDEX</span><h3>Relative Soil Levels</h3></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid stroke="#dce9df" vertical={false}/><XAxis dataKey="name" stroke="#718578" tickLine={false} axisLine={false}/><YAxis stroke="#718578" tickLine={false} axisLine={false}/><Tooltip contentStyle={{background:'#ffffff',border:'1px solid #cfe1d3',borderRadius:10,color:'#173b24'}}/><Bar dataKey="value" fill="#229c52" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></div></section>}
