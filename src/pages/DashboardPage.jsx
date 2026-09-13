import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Check, ChevronDown, ChevronLeft, ChevronRight, Cloud, CloudOff, Database, FlaskConical, Gauge, LandPlot, Leaf, MapPin, Plus, RadioTower, RefreshCw, ScanLine, Sprout, TestTube2, Trash2, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { subscribeFarmChanges } from '../services/dataService';
import { createFarmerSpatialRequest, loadAuthoritativeFarmerWorkspace } from '../services/farmerService';
import { applyDemoAction, getDemoState, DEMO_STORE_KEY } from '../services/demoStore';
import { adminAction } from '../services/adminService';
import { createMutationId, enqueueMutation, flushPendingMutations, isLikelyNetworkError, loadWorkspaceCache, pendingMutationCount, saveWorkspaceCache, subscribePendingMutations } from '../services/offlineSync';
import AppTopbar from '../components/AppTopbar';
import LayerVisibility from '../components/LayerVisibility';
import MapModeTabs from '../components/MapModeTabs';
import MapToolbar from '../components/MapToolbar';
import MetricCard from '../components/MetricCard';
import Modal from '../components/Modal';
import RecordPreview from '../components/RecordPreview';
import { SensorEditorModal, PlotEditorModal, DroneEditorModal, cleanAngle } from '../components/RecordEditors';
import SoilMap from '../components/SoilMap';
import StatusPill from '../components/StatusPill';
import SupportChat from '../components/SupportChat';


const LazyNutrientBars=lazy(()=>import('../components/DashboardCharts').then(module=>({default:module.NutrientBars})));
const LazyTrendChart=lazy(()=>import('../components/DashboardCharts').then(module=>({default:module.TrendChart})));
function ChartFallback(){return <section className="panel chart-panel chart-loading"><div className="loader"/><small>Loading chart…</small></section>;}
const avg=(arr,key)=>arr.length?(arr.reduce((s,x)=>s+(Number(x[key])||0),0)/arr.length):0;
const number=(n,d=0)=>Number(n||0).toFixed(d);
const niceDate=(v)=>v?new Intl.DateTimeFormat('en-PH',{month:'short',day:'numeric',year:'numeric'}).format(new Date(v)):'No record';
const modeVisibility=()=>({farmBoundary:true,sensors:true,sensorCoverage:true,soilPlots:true,droneMapping:true});

function nextNumberedName(rows=[], prefix, key) {
  const used=new Set(rows.map(row=>String(row?.[key]||'').trim().toLowerCase()));
  let i=1;
  while(used.has(`${prefix} ${i}`.toLowerCase())) i+=1;
  return `${prefix} ${i}`;
}

function Header({title,subtitle,action}) { return <header className="page-header"><div><span>SOIL MONITORING</span><h1>{title}</h1><p>{subtitle}</p></div><div className="header-actions">{action}<div className="live-chip"><i/> System active</div></div></header> }
function Empty({text,sub='No records are available for this section yet.'}) { return <div className="empty-state"><Sprout size={28}/><b>{text}</b><span>{sub}</span></div> }

function coordText(row){
  const lat=Number(row?.latitude??row?.center_lat),lng=Number(row?.longitude??row?.center_lng);
  return Number.isFinite(lat)&&Number.isFinite(lng)?`${lat.toFixed(6)}, ${lng.toFixed(6)}`:'Mapped record';
}

function SourceDropdown({title='View sources',items=[],empty='No source records are available for this statistic.'}){
  const [open,setOpen]=useState(false);
  return <div className={`source-dropdown ${open?'open':''}`}>
    <button type="button" className="source-dropdown-trigger" onClick={()=>setOpen(v=>!v)} aria-expanded={open}><Database size={13}/><span>{title}</span><b>{items.length}</b><ChevronDown size={13}/></button>
    {open&&<div className="source-dropdown-menu section-transition-in">
      <div className="source-dropdown-head"><span>DATA SOURCES</span><small>{items.length} record{items.length===1?'':'s'}</small></div>
      <div className="source-dropdown-list">{items.length?items.map((item,i)=><div key={item.id||`${item.title}-${i}`} className={`source-dropdown-row ${item.active?'active':''}`}><button type="button" className="source-dropdown-main" onClick={()=>{item.onClick?.();setOpen(false)}}><div><b>{item.title}</b><span>{item.meta||'Published SOILS record'}</span></div>{item.value&&<strong>{item.value}</strong>}</button>{item.onDelete&&<button type="button" className="source-dropdown-delete" title={item.deleteTitle||`Delete ${item.title}`} aria-label={item.deleteTitle||`Delete ${item.title}`} onClick={(event)=>{event.preventDefault();event.stopPropagation();item.onDelete?.();}}><Trash2 size={14}/></button>}</div>):<p>{empty}</p>}</div>
    </div>}
  </div>;
}

function TraceableMetric({icon:Icon,label,value,suffix,note,tone='green',sources=[],sourceTitle='View sources',active=false,onActivate}){
  return <article className={`traceable-metric trace-tone-${tone} ${active?'is-active':''}`}>
    <button type="button" className="traceable-metric-main" onClick={onActivate} disabled={!onActivate}>
      <span className={`metric-icon tone-${tone}`}>{Icon&&<Icon size={18}/>}</span>
      <span className="traceable-metric-copy"><span>{label}</span><strong>{value}{suffix&&<small>{suffix}</small>}</strong>{note&&<em>{note}</em>}</span>
    </button>
    <SourceDropdown title={sourceTitle} items={sources}/>
  </article>;
}

function SyncStatus({online=true,pending=0,syncing=false,lastSyncedAt,onSync,admin=false}){
  let time='Not synced yet';
  if(lastSyncedAt){try{time=`Last synced ${new Intl.DateTimeFormat('en-PH',{hour:'numeric',minute:'2-digit'}).format(new Date(lastSyncedAt))}`;}catch{}}
  return <div className={`sync-status-strip ${online?'is-online':'is-offline'} ${pending?'has-pending':''}`}>
    <div className="sync-status-main">{online?<Cloud size={17}/>:<CloudOff size={17}/>}<div><strong>{online?'Online':'Offline mode'}</strong><span>{online?time:'Changes stay on this device until internet returns.'}</span></div></div>
    <div className="sync-status-actions">{admin&&pending>0&&<span className="pending-sync-badge">{pending} waiting</span>}{admin&&pending>0&&online&&<button type="button" disabled={syncing} onClick={onSync}><RefreshCw size={14} className={syncing?'spin':''}/>{syncing?'Syncing…':'Sync now'}</button>}</div>
  </div>;
}

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

const farmBoundaries=(farm)=>farm?.boundaries?.length?farm.boundaries:(farm?.boundary?.length?[farm.boundary]:[]);
const polygonSignature=(poly=[])=>JSON.stringify(cleanPolygon(poly).map(([lat,lng])=>[Number(lat.toFixed(7)),Number(lng.toFixed(7))]));
const farmHasBoundary=(farm)=>farmBoundaries(farm).some(poly=>Array.isArray(poly)&&poly.length>=3);
const pointInFarm=(point,farm)=>farmBoundaries(farm).some(poly=>pointInPolygon(point,poly));
function workspaceSignature(bundle){
  if(!bundle?.farm)return '';
  const rowSig=(row)=>`${row?.id||row?.$id||''}:${row?.$updatedAt||row?.updated_at||row?.recorded_at||row?.analyzed_at||row?.captured_at||''}`;
  const farm=bundle.farm;
  return [
    rowSig(farm),
    JSON.stringify(farmBoundaries(farm)),
    ...(bundle.sensors||[]).map(rowSig).sort(),
    ...(bundle.plots||[]).map(row=>`${rowSig(row)}:${row?.boundary_geojson||JSON.stringify(row?.boundary||[])}`).sort(),
    ...(bundle.droneMappings||[]).map(row=>`${rowSig(row)}:${row?.boundary_geojson||JSON.stringify(row?.boundary||[])}`).sort(),
    ...(bundle.requests||[]).map(row=>`${rowSig(row)}:${row?.status||'pending'}:${row?.geometry_geojson||JSON.stringify(row?.boundary||[row?.latitude,row?.longitude])}`).sort(),
  ].join('|');
}

function multiPolygonStats(boundaries=[]){
  const valid=(boundaries||[]).map(cleanPolygon).filter(poly=>poly.length>=3);
  if(!valid.length)return {center_lat:10.4247,center_lng:122.9225,area_hectares:0};
  const parts=valid.map(polygonStats);const total=parts.reduce((sum,x)=>sum+x.area_hectares,0);
  const weights=total>0?parts.map(x=>x.area_hectares):parts.map(()=>1);const denom=weights.reduce((s,x)=>s+x,0)||1;
  return {center_lat:parts.reduce((s,x,i)=>s+x.center_lat*weights[i],0)/denom,center_lng:parts.reduce((s,x,i)=>s+x.center_lng*weights[i],0)/denom,area_hectares:total};
}

function mapSectionTargets({farms=[],sensors=[],plots=[],drone=[]}={}){
  const farmTargets=farms.flatMap((farm)=>{
    const boundaries=farmBoundaries(farm);
    if(!boundaries.length)return [{kind:'farm',id:`farm-${farm.id}`,row:farm,boundaryIndex:0,boundary:[],title:farm.farmer_name||farm.name,meta:`${farm.name} • ${farm.location_name||'Farm location'}`,value:`${number(farm.area_hectares,2)} ha`}];
    return boundaries.map((boundary,boundaryIndex)=>{const stats=polygonStats(boundary);return {kind:'farm',id:`farm-${farm.id}-boundary-${boundaryIndex}`,row:farm,boundaryIndex,boundary,title:boundaries.length>1?`${farm.farmer_name||farm.name} • Boundary ${boundaryIndex+1}`:(farm.farmer_name||farm.name),meta:`${farm.name} • ${farm.location_name||'Farm location'}`,value:`${number(stats.area_hectares,2)} ha`};});
  });
  return {
    farms:farmTargets,
    sensors:sensors.map(row=>{const id=row.id||row.$id;return {kind:'sensor',id:`sensor-${id}`,row:{...row,id},title:row.sensor_code||'Sensor',meta:`${row.farm_name||'Farm'} • ${coordText(row)}`,value:row.status||'Online'};}),
    plots:plots.map(row=>{const id=row.id||row.$id;return {kind:'plot',id:`plot-${id}`,row:{...row,id},boundary:row.boundary||[],title:row.plot_code||'Soil Plot',meta:`${row.farm_name||'Farm'} • ${row.classification||'Pending'}`,value:`pH ${number(row.ph,2)}`};}),
    drone:drone.map(row=>{const id=row.id||row.$id;return {kind:'drone',id:`drone-${id}`,row:{...row,id},boundary:row.boundary||[],title:row.name||'Drone Mapping',meta:`${row.farm_name||'Farm'} • ${row.classification||row.status||'Mapped'}`,value:`${number(row.area_hectares,2)} ha`};}),
  };
}

function clampOverlay(value,min,max){return Math.min(Math.max(value,min),max);}
function overlapArea(a,b,pad=7){
  const left=Math.max(a.left,b.left-pad),right=Math.min(a.right,b.right+pad);
  const top=Math.max(a.top,b.top-pad),bottom=Math.min(a.bottom,b.bottom+pad);
  return Math.max(0,right-left)*Math.max(0,bottom-top);
}
function DraggableMapOverlay({className='',storageKey='map-overlay',children,collapsible=false,collapseLabel='Map tools',defaultCollapsed=false}){
  const nodeRef=useRef(null);
  const dragRef=useRef(null);
  const offsetRef=useRef({x:0,y:0});
  const arrangeFrameRef=useRef(0);
  const reflowTimersRef=useRef([]);
  const [dragging,setDragging]=useState(false);
  const [collapsed,setCollapsed]=useState(()=>{
    if(!collapsible)return false;
    try{const saved=localStorage.getItem(`soils:overlay-collapsed:v11036:${storageKey}`);if(saved!==null)return saved==='1';}catch{}
    return Boolean(defaultCollapsed);
  });
  const [offset,setOffset]=useState(()=>{
    try{const raw=localStorage.getItem(`soils:overlay:v11036:${storageKey}`);const parsed=raw?JSON.parse(raw):null;const next={x:Number(parsed?.x)||0,y:Number(parsed?.y)||0};offsetRef.current=next;return next;}catch{return {x:0,y:0};}
  });
  const persist=(next)=>{try{localStorage.setItem(`soils:overlay:v11036:${storageKey}`,JSON.stringify(next));}catch{}};
  const persistCollapsed=(next)=>{try{localStorage.setItem(`soils:overlay-collapsed:v11036:${storageKey}`,next?'1':'0');}catch{}};
  const setOverlayOffset=(next,{save=false}={})=>{offsetRef.current=next;setOffset(next);if(save)persist(next);};

  const arrangeWithoutOverlap=()=>{
    const node=nodeRef.current;
    const shell=node?.closest('.map-canvas-shell');
    if(!node||!shell||dragRef.current)return;
    const bounds=shell.getBoundingClientRect();
    const rect=node.getBoundingClientRect();
    if(bounds.width<40||bounds.height<40||rect.width<2||rect.height<2)return;

    const padding=8;
    const currentOffset=offsetRef.current;
    const width=Math.min(rect.width,Math.max(1,bounds.width-padding*2));
    const height=Math.min(rect.height,Math.max(1,bounds.height-padding*2));
    const minLeft=bounds.left+padding;
    const maxLeft=Math.max(minLeft,bounds.right-padding-width);
    const minTop=bounds.top+padding;
    const maxTop=Math.max(minTop,bounds.bottom-padding-height);

    const blockers=[...shell.querySelectorAll('.draggable-map-overlay,.draggable-map-legend,.map-preview-float,.leaflet-control-zoom')]
      .filter(other=>other!==node&&other instanceof HTMLElement)
      .map(other=>({style:getComputedStyle(other),rect:other.getBoundingClientRect()}))
      .filter(item=>item.style.display!=='none'&&item.style.visibility!=='hidden'&&Number(item.style.opacity)!==0&&item.rect.width>3&&item.rect.height>3)
      .map(item=>item.rect);

    const makeRect=(left,top)=>({left,top,right:left+width,bottom:top+height,width,height});
    const candidates=[];
    const add=(left,top)=>{
      left=clampOverlay(left,minLeft,maxLeft);
      top=clampOverlay(top,minTop,maxTop);
      if(!candidates.some(item=>Math.abs(item.left-left)<1&&Math.abs(item.top-top)<1))candidates.push({left,top});
    };

    add(clampOverlay(rect.left,minLeft,maxLeft),clampOverlay(rect.top,minTop,maxTop));
    add(minLeft,minTop);add(maxLeft,minTop);add(minLeft,maxTop);add(maxLeft,maxTop);
    add((minLeft+maxLeft)/2,minTop);add((minLeft+maxLeft)/2,maxTop);
    add(minLeft,(minTop+maxTop)/2);add(maxLeft,(minTop+maxTop)/2);

    // Candidate slots directly beside every other floating control. These are
    // much better than a coarse grid when a minimized control is opened at an edge.
    for(const blocker of blockers){
      add(blocker.right+padding,blocker.top);
      add(blocker.left-width-padding,blocker.top);
      add(blocker.left,blocker.bottom+padding);
      add(blocker.left,blocker.top-height-padding);
      add(blocker.right+padding,blocker.bottom-height);
      add(blocker.left-width-padding,blocker.bottom-height);
    }

    const step=Math.max(24,Math.min(46,Math.round(Math.min(width,height)/2)));
    for(let top=minTop;top<=maxTop+1;top+=step){
      for(let left=minLeft;left<=maxLeft+1;left+=step)add(left,top);
      add(maxLeft,top);
    }

    let best=null;
    for(const candidate of candidates){
      const candidateRect=makeRect(candidate.left,candidate.top);
      const overlap=blockers.reduce((sum,blocker)=>sum+overlapArea(candidateRect,blocker,8),0);
      const distance=Math.hypot(candidate.left-rect.left,candidate.top-rect.top);
      const score=overlap*100000+distance;
      if(!best||score<best.score)best={...candidate,score,overlap};
      if(overlap===0&&distance<2){best={...candidate,score,overlap};break;}
    }
    if(!best)return;

    const dx=best.left-rect.left,dy=best.top-rect.top;
    if(Math.abs(dx)<1&&Math.abs(dy)<1)return;
    const next={x:currentOffset.x+dx,y:currentOffset.y+dy};
    setOverlayOffset(next,{save:true});
  };

  const scheduleArrange=()=>{
    cancelAnimationFrame(arrangeFrameRef.current);
    arrangeFrameRef.current=requestAnimationFrame(()=>requestAnimationFrame(arrangeWithoutOverlap));
  };
  const scheduleArrangeSeries=()=>{
    scheduleArrange();
    for(const timer of reflowTimersRef.current)window.clearTimeout(timer);
    reflowTimersRef.current=[60,160,320,520].map(delay=>window.setTimeout(scheduleArrange,delay));
  };

  useEffect(()=>{
    const node=nodeRef.current;
    const shell=node?.closest('.map-canvas-shell');
    if(!node||!shell)return undefined;
    let observer=null;
    if(typeof ResizeObserver!=='undefined'){
      observer=new ResizeObserver(()=>scheduleArrangeSeries());
      observer.observe(node);
      observer.observe(shell);
    }
    const onReflow=()=>scheduleArrangeSeries();
    const onVisibility=()=>{if(document.visibilityState==='visible')scheduleArrangeSeries();};
    scheduleArrangeSeries();
    window.addEventListener('resize',onReflow);
    window.addEventListener('orientationchange',onReflow);
    window.addEventListener('pageshow',onReflow);
    window.addEventListener('soils:map-overlay-reflow',onReflow);
    document.addEventListener('visibilitychange',onVisibility);
    return ()=>{
      observer?.disconnect();
      cancelAnimationFrame(arrangeFrameRef.current);
      for(const timer of reflowTimersRef.current)window.clearTimeout(timer);
      window.removeEventListener('resize',onReflow);
      window.removeEventListener('orientationchange',onReflow);
      window.removeEventListener('pageshow',onReflow);
      window.removeEventListener('soils:map-overlay-reflow',onReflow);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[storageKey,collapsed]);

  const beginDrag=(event)=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;
    const node=nodeRef.current;const shell=node?.closest('.map-canvas-shell');
    if(!node||!shell)return;
    event.preventDefault();event.stopPropagation();
    const rect=node.getBoundingClientRect();const bounds=shell.getBoundingClientRect();
    dragRef.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,startOffset:{...offsetRef.current},rect,bounds};
    event.currentTarget.setPointerCapture?.(event.pointerId);setDragging(true);
  };
  const moveDrag=(event)=>{
    const drag=dragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;
    event.preventDefault();event.stopPropagation();
    const baseLeft=drag.rect.left-drag.startOffset.x,baseTop=drag.rect.top-drag.startOffset.y;
    const minX=drag.bounds.left+6-baseLeft,maxX=drag.bounds.right-6-(baseLeft+drag.rect.width);
    const minY=drag.bounds.top+6-baseTop,maxY=drag.bounds.bottom-6-(baseTop+drag.rect.height);
    setOverlayOffset({
      x:clampOverlay(drag.startOffset.x+(event.clientX-drag.startX),Math.min(minX,maxX),Math.max(minX,maxX)),
      y:clampOverlay(drag.startOffset.y+(event.clientY-drag.startY),Math.min(minY,maxY),Math.max(minY,maxY)),
    });
  };
  const endDrag=(event)=>{
    const drag=dragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;
    event.preventDefault();event.stopPropagation();dragRef.current=null;setDragging(false);
    persist(offsetRef.current);
    scheduleArrangeSeries();
    try{event.currentTarget.releasePointerCapture?.(event.pointerId);}catch{}
  };
  const resetPosition=(event)=>{event.preventDefault();event.stopPropagation();setOverlayOffset({x:0,y:0},{save:true});scheduleArrangeSeries();};
  const toggleCollapsed=(event)=>{
    event.preventDefault();event.stopPropagation();
    const expanding=collapsed;
    // On phones, a tiny minimized chip can be dragged flush against an edge.
    // Reset its transform before expansion, then let the collision solver dock it.
    if(expanding&&window.matchMedia?.('(max-width: 820px)')?.matches)setOverlayOffset({x:0,y:0},{save:true});
    const next=!collapsed;
    setCollapsed(next);persistCollapsed(next);
    window.dispatchEvent(new CustomEvent('soils:map-overlay-reflow'));
    scheduleArrangeSeries();
  };

  return <div ref={nodeRef} className={`${className} draggable-map-overlay ${dragging?'is-dragging':''} ${collapsed?'is-collapsed':''}`.trim()} style={{'--overlay-drag-x':`${offset.x}px`,'--overlay-drag-y':`${offset.y}px`}}>
    <button type="button" className="map-overlay-drag-handle" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={resetPosition} title="Drag to move. Double-click to reset position." aria-label="Drag this map control"><span className="drag-grip-glyph" aria-hidden="true">⋮⋮</span><span>Drag</span></button>
    {!collapsed&&children}
    {collapsible&&<button type="button" className="map-overlay-collapse-toggle" onClick={toggleCollapsed} aria-expanded={!collapsed} title={collapsed?`Open ${collapseLabel}`:`Collapse ${collapseLabel}`}><span>{collapsed?collapseLabel:'Hide'}</span>{collapsed?<ChevronRight size={14}/>:<ChevronLeft size={14}/>}</button>}
  </div>;
}

function MapSectionCycleControl({farms=[],sensors=[],plots=[],drone=[],section='farms',onSectionChange,onFocus,onDeletePlotSource=null,collapsed=false,onCollapsedChange}){
  const cycleRef=useRef({farms:-1,sensors:-1,plots:-1,drone:-1});
  const targets=mapSectionTargets({farms,sensors,plots,drone});
  const signature=[...targets.farms,...targets.sensors,...targets.plots,...targets.drone].map(item=>item.id).join('|');
  useEffect(()=>{for(const key of ['farms','sensors','plots','drone']){if(cycleRef.current[key]>=targets[key].length)cycleRef.current[key]=-1;}},[signature]);
  const meta={
    farms:{eyebrow:'FARM NETWORK',title:'Mapped Farms',copy:'Click Farms repeatedly to move smoothly through every mapped farm boundary.'},
    sensors:{eyebrow:'FIELD DEVICES',title:'Sensor Network',copy:'Click Sensors repeatedly to move through every Sensor pin.'},
    plots:{eyebrow:'SOIL ANALYSIS',title:'Soil Analysis Plots',copy:'Click Soil plots repeatedly to move through every plotted soil-analysis area.'},
    drone:{eyebrow:'AERIAL COVERAGE',title:'Drone Mapping',copy:'Click Drone mapping repeatedly to move through every mapped drone survey area.'},
  }[section]||{eyebrow:'MAP RECORDS',title:'Map records',copy:'Choose a section to focus its mapped records.'};
  const options=[
    {id:'farms',label:'Farms',value:targets.farms.length},
    {id:'sensors',label:'Sensors',value:targets.sensors.length},
    {id:'plots',label:'Soil plots',value:targets.plots.length},
    {id:'drone',label:'Drone mapping',value:targets.drone.length},
  ];
  const activate=(id)=>{
    const list=targets[id]||[];
    const same=section===id;
    onSectionChange?.(id);
    if(!list.length)return;
    const next=same?((cycleRef.current[id]+1+list.length)%list.length):0;
    cycleRef.current[id]=next;
    onFocus?.(list[next],{section:id,index:next,total:list.length});
  };
  const sources=(targets[section]||[]).map((item,index)=>({id:item.id,title:item.title,meta:item.meta,value:item.value,onClick:()=>{cycleRef.current[section]=index;onFocus?.({...item,focusOnly:true},{section,index,total:(targets[section]||[]).length,sourceOnly:true});},onDelete:section==='plots'&&onDeletePlotSource?()=>onDeletePlotSource(item.row):undefined,deleteTitle:section==='plots'?'Remove this Soil Plot source':undefined}));
  const currentIndex=cycleRef.current[section];
  const currentTotal=(targets[section]||[]).length;
  const setNavigatorCollapsed=(next)=>{onCollapsedChange?.(next);requestAnimationFrame(()=>window.dispatchEvent(new CustomEvent('soils:map-overlay-reflow')));window.setTimeout(()=>window.dispatchEvent(new CustomEvent('soils:map-overlay-reflow')),180);};
  return <div className={`overview-map-control map-cycle-control ${collapsed?'is-collapsed':''}`}>
    {collapsed
      ?<button type="button" className="overview-map-control-collapsed" onClick={()=>setNavigatorCollapsed(false)} aria-label="Expand map record navigator"><span><small>{meta.eyebrow}</small><b>{meta.title}</b></span><ChevronRight size={15}/></button>
      :<>
        <div className="overview-map-control-head"><div key={`map-cycle-${section}`} className="overview-focus-copy section-transition-in"><span>{meta.eyebrow}</span><h3>{meta.title}</h3><p>{meta.copy}</p>{currentTotal>0&&currentIndex>=0&&<small className="map-cycle-progress">Viewing {currentIndex+1} of {currentTotal}</small>}</div><button type="button" className="overview-map-collapse-btn" onClick={()=>setNavigatorCollapsed(true)} aria-label="Collapse map record navigator"><ChevronLeft size={15}/></button></div>
        <div className="overview-map-control-body"><div className="overview-section-switcher" aria-label="Map record sections">{options.map(item=><button type="button" key={item.id} className={section===item.id?'active':''} onClick={()=>activate(item.id)} title={`Focus ${item.label}. Click again for the next record.`}><span>{item.label}</span><b>{item.value}</b></button>)}</div><SourceDropdown title="View section sources" items={sources}/></div>
      </>}
  </div>;
}

function MapDisplaySelector({value,onChange,hasSection=false,hasEditor=false,editorLabel='Map editor'}){
  const [open,setOpen]=useState(false);
  const selectedCount=[Boolean(value?.tools),Boolean(hasEditor&&value?.editor),Boolean(hasSection&&value?.section),Boolean(value?.legend)].filter(Boolean).length;
  const setFlag=(key,checked)=>onChange?.({...value,[key]:checked});
  const setAll=(checked)=>onChange?.({tools:checked,editor:checked&&hasEditor,section:checked&&hasSection,legend:checked});
  return <div className={'map-display-selector '+(open?'is-open':'')}>
    <button type="button" className="map-display-selector-toggle" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
      <span><small>MAP DISPLAY</small><b>{selectedCount?(selectedCount+' shown'):'None'}</b></span>
      <ChevronDown size={15}/>
    </button>
    {open&&<div className="map-display-selector-menu">
      <div className="map-display-selector-head"><div><span>MAP INTERFACE</span><b>Choose visible controls</b></div><button type="button" onClick={()=>setOpen(false)} aria-label="Close map display menu">×</button></div>
      <div className="map-display-quick">
        <button type="button" className={selectedCount===0?'active':''} onClick={()=>setAll(false)}>None</button>
        <button type="button" onClick={()=>setAll(true)}>All</button>
      </div>
      <label><input type="checkbox" checked={Boolean(value?.tools)} onChange={e=>setFlag('tools',e.target.checked)}/><span><b>Map tools</b><small>Farm Boundary, Soil Plot, Drone Mapping and Visibility</small></span></label>
      {hasEditor&&<label><input type="checkbox" checked={Boolean(value?.editor)} onChange={e=>setFlag('editor',e.target.checked)}/><span><b>{editorLabel}</b><small>Placement, GPS and drawing controls</small></span></label>}
      {hasSection&&<label><input type="checkbox" checked={Boolean(value?.section)} onChange={e=>setFlag('section',e.target.checked)}/><span><b>Mapped farms</b><small>Farm Network / map record navigator</small></span></label>}
      <label><input type="checkbox" checked={Boolean(value?.legend)} onChange={e=>setFlag('legend',e.target.checked)}/><span><b>Legend</b><small>Sensor, coverage, plot, drone and boundary keys</small></span></label>
    </div>}
  </div>;
}


function MapWorkspace({
  farms, sensors, plots, droneMappings, requests=[], activeFarmId, onFarmClick, admin=false, height=560,
  selectedSensorId, selectedPlotId, selectedDroneId, focusTarget, onSensorClick, onPlotClick, onDroneClick, onDroneDelete,
  drawMode, drawPoints, onMapPoint, drawCoverageM, drawOrientation, onDrawOrientation, toolbar, sectionControl=null, showMapPopups=true, preview=null, fitRequestKey=0, fitBoundaryIndex=null, dataRevision=0, modeHint=null, embedded=false, overlayScope='workspace',
}) {
  const overlayStorageScope=(admin?'admin':'farmer')+'-'+overlayScope;
  const displayStorageKey='soils:map-display:v11039:'+overlayStorageScope;
  const [mapDisplay,setMapDisplay]=useState(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem(displayStorageKey)||'null');
      if(saved&&typeof saved==='object')return {
        tools:Boolean(saved.tools),
        editor:Boolean(saved.editor),
        section:Boolean(saved.section),
        legend:Boolean(saved.legend),
      };
    }catch{}
    return {tools:false,editor:false,section:false,legend:false};
  });
  const updateMapDisplay=(next)=>{
    const clean={tools:Boolean(next?.tools),editor:Boolean(next?.editor),section:Boolean(next?.section),legend:Boolean(next?.legend)};
    setMapDisplay(clean);
    try{localStorage.setItem(displayStorageKey,JSON.stringify(clean));}catch{}
    requestAnimationFrame(()=>window.dispatchEvent(new CustomEvent('soils:map-overlay-reflow')));
    window.setTimeout(()=>window.dispatchEvent(new CustomEvent('soils:map-overlay-reflow')),180);
  };
  const editorForcedVisible=Boolean(drawMode);
  const showMapTools=Boolean(mapDisplay.tools);
  const showMapEditor=Boolean(toolbar)&&(Boolean(mapDisplay.editor)||editorForcedVisible);
  const showMapSection=Boolean(sectionControl)&&Boolean(mapDisplay.section);
  const showMapLegend=Boolean(mapDisplay.legend);
  const [mapMode,setMapMode]=useState('farm');
  const [visibility,setVisibility]=useState(modeVisibility('farm'));
  const [visibleSensorIds,setVisibleSensorIds]=useState(sensors.map(s=>s.id));
  const [visiblePlotIds,setVisiblePlotIds]=useState(plots.map(p=>p.id));
  // Pin visibility is ID-based. Whenever authoritative data adds a record, keep
  // every current record visible by default instead of carrying a stale one-item
  // visibility list from the previous render.
  useEffect(()=>setVisibleSensorIds(sensors.map(s=>s.id)),[sensors.map(s=>s.id).join('|')]);
  useEffect(()=>setVisiblePlotIds(plots.map(p=>p.id)),[plots.map(p=>p.id).join('|')]);
  const changeMode=(next)=>{setMapMode(next);setVisibility(v=>({...v,farmBoundary:true,sensors:true,sensorCoverage:true,soilPlots:true,droneMapping:true}));};
  useEffect(()=>{if(modeHint&&['farm','analysis','drone'].includes(modeHint))changeMode(modeHint);},[modeHint]);
  useEffect(()=>{
    if(drawMode==='plot'||selectedPlotId){setMapMode('analysis');setVisibility(v=>({...v,soilPlots:true}));return;}
    if(drawMode==='drone'||selectedDroneId){setMapMode('drone');setVisibility(v=>({...v,droneMapping:true}));return;}
    if(drawMode==='farm'){setMapMode('farm');setVisibility(v=>({...v,farmBoundary:true}));}
  },[drawMode,selectedPlotId,selectedDroneId]);
  const sensorToggle=(id,checked)=>setVisibleSensorIds(v=>checked?[...new Set([...v,id])]:v.filter(x=>x!==id));
  const plotToggle=(id,checked)=>setVisiblePlotIds(v=>checked?[...new Set([...v,id])]:v.filter(x=>x!==id));

  /* v1.10.39 display availability reflow */
  useEffect(()=>{
    const fire=()=>window.dispatchEvent(new CustomEvent('soils:map-overlay-reflow'));
    const frame=requestAnimationFrame(()=>requestAnimationFrame(fire));
    const timer=window.setTimeout(fire,160);
    return ()=>{cancelAnimationFrame(frame);window.clearTimeout(timer);};
  },[mapDisplay.tools,mapDisplay.editor,mapDisplay.section,mapDisplay.legend,editorForcedVisible]);

  /* v1.10.38 preview-driven map overlay reflow */
  useEffect(()=>{
    const fire=()=>window.dispatchEvent(new CustomEvent('soils:map-overlay-reflow'));
    const frame=requestAnimationFrame(()=>requestAnimationFrame(fire));
    const timer=window.setTimeout(fire,220);
    return ()=>{cancelAnimationFrame(frame);window.clearTimeout(timer);};
  },[Boolean(preview),selectedSensorId,selectedPlotId,selectedDroneId]);
  return <section className={`${embedded?'':'panel '}map-panel map-workspace ${embedded?'is-embedded':''}`.trim()}>
    <div className={`map-workspace-body ${admin?'has-admin-editor':''}`}>
      <div className={`map-canvas-shell ${preview?'has-record-preview':''}`.trim()}>
        <SoilMap farms={farms} sensors={sensors} plots={plots} droneMappings={droneMappings} requests={requests} height={height} selectedFarmId={activeFarmId} onFarmClick={onFarmClick} visibility={visibility} visibleSensorIds={visibleSensorIds} visiblePlotIds={visiblePlotIds} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSensorClick={onSensorClick} onPlotClick={onPlotClick} onDroneClick={onDroneClick} onDroneDelete={onDroneDelete} canDeleteDrone={admin} drawMode={drawMode} drawPoints={drawPoints} onMapPoint={onMapPoint} drawCoverageM={drawCoverageM} drawOrientation={drawOrientation} onDrawOrientation={onDrawOrientation} showMapPopups={showMapPopups} fitRequestKey={fitRequestKey} fitBoundaryIndex={fitBoundaryIndex} dataRevision={dataRevision} legendStorageKey={`legend-${overlayStorageScope}`} showLegend={showMapLegend}/>
        <MapDisplaySelector value={mapDisplay} onChange={updateMapDisplay} hasSection={Boolean(sectionControl)} hasEditor={Boolean(toolbar)} editorLabel={admin?'Map editor':'Request map placement'}/>
        {showMapTools&&<DraggableMapOverlay className={`map-workspace-head map-overlay-head ${embedded&&modeHint?'overview-controlled':''}`} storageKey={`head-${overlayStorageScope}`} collapsible collapseLabel="Map tools" defaultCollapsed={true}>{!(embedded&&modeHint)&&<MapModeTabs value={mapMode} onChange={changeMode}/>}<LayerVisibility visibility={visibility} onChange={setVisibility} sensors={sensors} visibleSensorIds={visibleSensorIds} onSensorToggle={sensorToggle} plots={plots} visiblePlotIds={visiblePlotIds} onPlotToggle={plotToggle}/></DraggableMapOverlay>}
        {showMapSection&&<DraggableMapOverlay className="map-section-overlay" storageKey={`section-${overlayStorageScope}`}>{sectionControl}</DraggableMapOverlay>}
        {showMapEditor&&<DraggableMapOverlay className="map-editor-side map-editor-overlay" storageKey={`editor-${overlayStorageScope}`}>{toolbar}</DraggableMapOverlay>}
        {preview&&<div className="map-preview-float">{preview}</div>}
      </div>
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
  const [activeSpatialRequest,setActiveSpatialRequest]=useState(null);
  const [requestReviewBusy,setRequestReviewBusy]=useState(false);
  const [requestReviewError,setRequestReviewError]=useState('');
  const [farmFitRevision,setFarmFitRevision]=useState(0);
  const [farmBoundaryIndex,setFarmBoundaryIndex]=useState(0);
  const [mapRevision,setMapRevision]=useState(0);
  const [isOnline,setIsOnline]=useState(()=>typeof navigator==='undefined'?true:navigator.onLine!==false);
  const [pendingSyncCount,setPendingSyncCount]=useState(0);
  const [offlineSyncing,setOfflineSyncing]=useState(false);
  const [lastSyncedAt,setLastSyncedAt]=useState(null);
  const previousViewRef=useRef('overview');
  const currentViewRef=useRef('overview');
  const farmerSyncSeqRef=useRef(0);
  const farmerBoundarySigRef=useRef('');
  const farmerDataSigRef=useRef('');
  const workspaceLoadSeqRef=useRef(0);
  const offlineSyncLockRef=useRef(false);
  const cacheSaveTimerRef=useRef(null);
  // Synchronous write latch. React state updates are asynchronous, so relying only
  // on `busy` can allow two submit events to enter before the button disables.
  const spatialActionLockRef=useRef(false);
  const focusRequestRef=useRef(0);
  // Guard against a stale/in-flight workspace response resurrecting a record
  // immediately after a confirmed/optimistic delete. This is intentionally local
  // to the current Admin session; a fresh page load still trusts Appwrite.
  const deletedSpatialIdsRef=useRef(new Set());
  const spatialDeleteId=(action,payload={})=>action==='deleteSensor'?payload.sensor_id:action==='deletePlot'?payload.plot_id:action==='deleteDroneMapping'?payload.drone_id:'';
  const markSpatialDeleted=(id)=>{if(id)deletedSpatialIdsRef.current.add(String(id));};
  const unmarkSpatialDeleted=(id)=>{if(id)deletedSpatialIdsRef.current.delete(String(id));};
  const withoutDeleted=(rows=[])=>rows.filter(row=>!deletedSpatialIdsRef.current.has(String(row?.id||row?.$id||'')));
  // Browser-only optimistic rows must never become part of the published workspace.
  // They are transient UI feedback while a write is in flight. Persisting them
  // in the workspace cache is what allowed old failed Plot creates to come back
  // after refresh as a generic "Soil Plot • Pending • pH 0.00" ghost.
  const isLocalPendingRow=(row)=>!!row?.pending_sync || String(row?.id||row?.$id||'').startsWith('pending-');
  const confirmedRows=(rows=[])=>withoutDeleted(rows).filter(row=>!isLocalPendingRow(row));
  // A Soil Plot is a spatial record. If it has no real polygon, it is an orphan
  // database/cache row and must never be surfaced as a plotted source. This is
  // deliberately geometry-based rather than checking Pending/pH 0, because a
  // legitimate new plot may still be Pending with blank lab values.
  const hasValidPlotGeometry=(row)=>{
    const points=Array.isArray(row?.boundary)?row.boundary:[];
    return points.filter(point=>Array.isArray(point)&&point.length>=2&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1]))).length>=3;
  };
  const publishedPlots=(rows=[])=>confirmedRows(rows).filter(hasValidPlotGeometry);
  const confirmedBundle=(item)=>item?.farm?{...item,sensors:confirmedRows(item.sensors||[]),plots:publishedPlots(item.plots||[]),droneMappings:confirmedRows(item.droneMappings||[]),requests:Array.isArray(item.requests)?item.requests:[]}:item;
  const isDemo=!!user?.demo; const isAdmin=mode==='admin';
  const getFarmerWorkspace=async({force=false}={})=>{
    if(isDemo){const state=getDemoState();const farm=state.farms[0];return {farmId:farm?.id||null,bundle:farm?{farm,sensors:state.sensors.filter(s=>s.farm_id===farm.id),plots:state.plots.filter(p=>p.farm_id===farm.id),droneMappings:state.drone.filter(d=>d.farm_id===farm.id)}:null};}
    // Farmer map data has one source of truth: the server-authoritative workspace.
    // Do not fall back to client-side row reads, because older permissions/cache
    // state can make that fallback disagree with the Admin-published records.
    return loadAuthoritativeFarmerWorkspace({force});
  };

  const workspaceRole=isAdmin?'admin':'farmer';

  function hydrateWorkspaceCache(){
    if(isDemo||!user?.$id)return false;
    const cached=loadWorkspaceCache(workspaceRole,user.$id)?.data;
    if(!cached)return false;
    if(isAdmin){
      const cachedBundles=(Array.isArray(cached.bundles)?cached.bundles:[]).map(confirmedBundle);
      const cachedFarms=Array.isArray(cached.farms)?cached.farms:cachedBundles.map(item=>item?.farm).filter(Boolean);
      const farmId=(cached.activeFarmId&&cachedFarms.some(f=>f.id===cached.activeFarmId))?cached.activeFarmId:cachedFarms[0]?.id||null;
      setFarms(cachedFarms);setAllSensors(cachedBundles.flatMap(item=>item?.sensors||[]));setAllPlots(cachedBundles.flatMap(item=>item?.plots||[]));setAllDrone(cachedBundles.flatMap(item=>item?.droneMappings||[]));
      setActiveFarmId(farmId);setBundle(farmId?cachedBundles.find(item=>item?.farm?.id===farmId)||null:null);
      if(cached.syncedAt)setLastSyncedAt(cached.syncedAt);
      setMapRevision(v=>v+1);setLoading(false);
      return cachedFarms.length>0||cachedBundles.length>0;
    }
    const next=confirmedBundle(cached.bundle);
    if(!next?.farm)return false;
    setActiveFarmId(cached.farmId||next.farm.id||null);setBundle(next);setFarms([next.farm]);setAllSensors(next.sensors||[]);setAllPlots(next.plots||[]);setAllDrone(next.droneMappings||[]);
    farmerBoundarySigRef.current=JSON.stringify(farmBoundaries(next.farm));
    farmerDataSigRef.current=workspaceSignature(next);
    if(cached.syncedAt)setLastSyncedAt(cached.syncedAt);
    setMapRevision(v=>v+1);setLoading(false);
    return true;
  }

  function saveCurrentWorkspaceCache(){
    if(isDemo||!user?.$id)return;
    const syncedAt=lastSyncedAt||new Date().toISOString();
    if(isAdmin){
      const bundles=farms.map(farm=>{
        if(bundle?.farm?.id===farm.id)return confirmedBundle(bundle);
        return {farm,sensors:confirmedRows(allSensors.filter(row=>row.farm_id===farm.id)),plots:confirmedRows(allPlots.filter(row=>row.farm_id===farm.id)),droneMappings:confirmedRows(allDrone.filter(row=>row.farm_id===farm.id))};
      });
      saveWorkspaceCache('admin',user.$id,{farms,bundles,activeFarmId,syncedAt});
    }else if(bundle?.farm){
      saveWorkspaceCache('farmer',user.$id,{farmId:activeFarmId||bundle.farm.id,bundle:confirmedBundle(bundle),syncedAt});
    }
  }

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
        const syncedAt=farmerWorkspace?.syncedAt||new Date().toISOString();
        setLastSyncedAt(syncedAt);
        if(b?.farm){
          farmerDataSigRef.current=workspaceSignature(b);
          farmerBoundarySigRef.current=JSON.stringify(farmBoundaries(b.farm));
          saveWorkspaceCache('farmer',user.$id,{farmId:farmId||b.farm.id,bundle:confirmedBundle(b),syncedAt});
        }
        setMapRevision(v=>v+1);
        return;
      }

      // Fast startup path. Legacy cleanup no longer blocks the first paint.
      const adminWorkspace=await adminAction('getAdminWorkspace',{});
      if(seq!==workspaceLoadSeqRef.current)return;
      const canonicalBundles=(adminWorkspace?.bundles||[]).map(item=>({...item,sensors:confirmedRows(item.sensors||[]),plots:publishedPlots(item.plots||[]),droneMappings:confirmedRows(item.droneMappings||[])}));
      const nextFarms=adminWorkspace?.farms||canonicalBundles.map(item=>item.farm).filter(Boolean);
      const sensors=canonicalBundles.flatMap(item=>item.sensors||[]);
      const plots=canonicalBundles.flatMap(item=>item.plots||[]);
      const drone=canonicalBundles.flatMap(item=>item.droneMappings||[]);
      setFarms(nextFarms);
      const farmId=keepFarm&&activeFarmId&&nextFarms.some(f=>f.id===activeFarmId)?activeFarmId:nextFarms[0]?.id;
      setActiveFarmId(farmId||null);
      setBundle(farmId?(canonicalBundles.find(item=>item.farm?.id===farmId)||null):null);
      setAllSensors(sensors);setAllPlots(plots);setAllDrone(drone);
      const syncedAt=adminWorkspace?.syncedAt||new Date().toISOString();
      setLastSyncedAt(syncedAt);
      saveWorkspaceCache('admin',user.$id,{farms:nextFarms,bundles:canonicalBundles,activeFarmId:farmId||null,syncedAt});
      setMapRevision(v=>v+1);
    } catch(err){
      if(seq===workspaceLoadSeqRef.current){
        console.error(err);
        if(isLikelyNetworkError(err))setNotice('SOILS is offline. Showing the last saved workspace; new Admin map changes will wait locally and sync after reconnection.');
        else setNotice(err.message||'Unable to load Appwrite data.');
      }
    } finally {
      if(showLoading && seq===workspaceLoadSeqRef.current)setLoading(false);
    }
  }
  useEffect(()=>{
    const cachedLoaded=hydrateWorkspaceCache();
    if(!isDemo && typeof navigator!=='undefined' && navigator.onLine===false){
      if(!cachedLoaded){setLoading(false);setNotice('No cached workspace is available yet. Connect to the internet once to download this account’s farm data.');}
      return;
    }
    refresh({keepFarm:false,showLoading:!cachedLoaded});
  },[isDemo,mode,user?.$id]);

  // Cache the latest rendered workspace after local/offline edits as well as
  // server refreshes. A short debounce avoids excessive localStorage writes.
  useEffect(()=>{
    if(isDemo||!user?.$id||loading)return undefined;
    clearTimeout(cacheSaveTimerRef.current);
    cacheSaveTimerRef.current=setTimeout(saveCurrentWorkspaceCache,500);
    return ()=>clearTimeout(cacheSaveTimerRef.current);
  },[isDemo,user?.$id,loading,farms,allSensors,allPlots,allDrone,bundle,activeFarmId,lastSyncedAt]);

  useEffect(()=>{
    const update=()=>setIsOnline(typeof navigator==='undefined'?true:navigator.onLine!==false);
    window.addEventListener('online',update);window.addEventListener('offline',update);update();
    return ()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
  },[]);

  useEffect(()=>{
    if(!isAdmin||isDemo||!user?.$id){setPendingSyncCount(0);return undefined;}
    const update=()=>setPendingSyncCount(pendingMutationCount(user.$id));
    update();
    return subscribePendingMutations(update);
  },[isAdmin,isDemo,user?.$id]);

  useEffect(()=>{
    if(!isAdmin||isDemo||!user?.$id||!isOnline||pendingSyncCount<1)return undefined;
    const timer=setTimeout(()=>syncPendingChanges({silent:true}),500);
    return ()=>clearTimeout(timer);
  },[isAdmin,isDemo,user?.$id,isOnline,pendingSyncCount]);

  useEffect(()=>{
    if(isAdmin || !activeFarmId) return undefined;
    let cancelled=false;
    let realtimeCleanup=()=>{};
    let realtimeDebounce=null;
    let fallbackTimer=null;

    const applyBundle=(nextBundle,syncedAt=new Date().toISOString())=>{
      if(cancelled || !nextBundle?.farm) return;
      const nextSensors=confirmedRows(nextBundle.sensors||[]);
      const nextPlots=publishedPlots(nextBundle.plots||[]);
      const nextDrone=confirmedRows(nextBundle.droneMappings||[]);
      const nextNormalized={...nextBundle,sensors:nextSensors,plots:nextPlots,droneMappings:nextDrone};
      const dataSig=workspaceSignature(nextNormalized);
      if(dataSig&&dataSig===farmerDataSigRef.current){
        setLastSyncedAt(syncedAt);
        return;
      }
      farmerDataSigRef.current=dataSig;
      setBundle(nextNormalized);
      setFarms([nextBundle.farm]);
      setAllSensors(nextSensors);
      setAllPlots(nextPlots);
      setAllDrone(nextDrone);
      setLastSyncedAt(syncedAt);
      if(!isDemo&&user?.$id)saveWorkspaceCache('farmer',user.$id,{farmId:nextBundle.farm.id,bundle:confirmedBundle(nextNormalized),syncedAt});
      setMapRevision(v=>v+1);
      const boundarySig=JSON.stringify(farmBoundaries(nextBundle.farm));
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

    let lastPullAt=0;
    const pullLatest=async(force=false)=>{
      if(!isDemo){
        if(typeof navigator!=='undefined'&&navigator.onLine===false)return;
        if(document.visibilityState!=='visible'&&!force)return;
        if(!force&&Date.now()-lastPullAt<12000)return;
      }
      lastPullAt=Date.now();
      const seq=++farmerSyncSeqRef.current;
      try{
        // Farmer refreshes always come from the server-authoritative bundle.
        // Direct browser table reads can be permission-filtered on legacy rows,
        // which made a newly-visible Plot/Drone/Sensor replace older records.
        // Realtime keeps this event-driven, so correctness does not require
        // aggressive polling or extra Appwrite reads.
        const workspace=await getFarmerWorkspace({force});
        if(cancelled || seq!==farmerSyncSeqRef.current) return;
        if(workspace?.farmId && workspace.farmId!==activeFarmId) setActiveFarmId(workspace.farmId);
        applyBundle(workspace?.bundle,workspace?.syncedAt||new Date().toISOString());
      }catch(err){
        if(!cancelled && seq===farmerSyncSeqRef.current) console.warn('Farmer authoritative sync refresh failed:',err);
      }
    };

    const scheduleRealtimePull=()=>{
      clearTimeout(realtimeDebounce);
      realtimeDebounce=setTimeout(()=>pullLatest(true),180);
    };
    const onFocus=()=>pullLatest(true);
    const onVisibility=()=>{if(document.visibilityState==='visible')pullLatest(true);};
    window.addEventListener('focus',onFocus);
    document.addEventListener('visibilitychange',onVisibility);

    if(isDemo){
      const onStorage=(event)=>{if(event.key===DEMO_STORE_KEY)scheduleRealtimePull();};
      window.addEventListener('storage',onStorage);
      realtimeCleanup=()=>window.removeEventListener('storage',onStorage);
    }else if(isOnline){
      const startFallback=(delay)=>{clearInterval(fallbackTimer);fallbackTimer=setInterval(()=>pullLatest(false),delay);};
      // Realtime is the primary sync path. The long fallback is only a safety
      // net, cutting the old 5-second polling load by more than 90% while still
      // recovering automatically if a realtime event is missed.
      startFallback(300000);
      subscribeFarmChanges(activeFarmId,scheduleRealtimePull)
        .then((cleanup)=>{if(cancelled)cleanup?.();else realtimeCleanup=cleanup;})
        .catch((err)=>{console.warn('Realtime journal unavailable; using a low-frequency authoritative server fallback.',err);startFallback(60000);});
    }

    return ()=>{
      cancelled=true;
      clearTimeout(realtimeDebounce);
      clearInterval(fallbackTimer);
      window.removeEventListener('focus',onFocus);
      document.removeEventListener('visibilitychange',onVisibility);
      Promise.resolve(realtimeCleanup?.()).catch(()=>{});
    };
  },[isAdmin,isDemo,activeFarmId,user?.$id,isOnline]);

  async function openFarm(id, targetView=isAdmin?'farmer':'farm') {
    setFarmBoundaryIndex(0);
    setActiveFarmId(id); setSelectedSensorId(null);setSelectedPlotId(null);setSelectedDroneId(null);setFocusTarget(null); setView(targetView);
    try{
      if(isDemo){setBundle(loadLocalDemoBundle(id));return;}
      if(!isOnline){
        if(isAdmin){const farm=farms.find(f=>f.id===id);if(farm)setBundle({farm,sensors:allSensors.filter(row=>row.farm_id===id),plots:allPlots.filter(row=>row.farm_id===id),droneMappings:allDrone.filter(row=>row.farm_id===id)});}
        setFarmFitRevision(v=>v+1);return;
      }
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
  const scopedBundle=bundle?.farm?.id && (!activeFarmId||bundle.farm.id===activeFarmId)?bundle:null;
  const current=scopedBundle?.farm || farms.find(f=>f.id===activeFarmId) || farms[0];
  const sensors=scopedBundle?.sensors || (isAdmin&&activeFarmId?allSensors.filter(row=>row.farm_id===activeFarmId):allSensors);
  const plots=scopedBundle?.plots || (isAdmin&&activeFarmId?allPlots.filter(row=>row.farm_id===activeFarmId):allPlots);
  const droneMappings=scopedBundle?.droneMappings || (isAdmin&&activeFarmId?allDrone.filter(row=>row.farm_id===activeFarmId):allDrone);
  const spatialRequests=Array.isArray(scopedBundle?.requests)?scopedBundle.requests:[];
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
      const makePatch=(farm)=>{
        if(action==='deleteFarmBoundary'){
          const existing=farmBoundaries(farm);
          let boundaries=[];
          if(payload.delete_all===true) boundaries=[];
          else {
            const targetSig=payload.geojson?.length?polygonSignature(payload.geojson):'';
            const requestedIndex=Number(payload.boundary_index);
            let removed=false;
            boundaries=existing.filter((poly,index)=>{
              const exact=targetSig&&polygonSignature(poly)===targetSig;
              const indexed=Number.isInteger(requestedIndex)&&requestedIndex>=0&&index===requestedIndex;
              if(!removed&&(exact||(!targetSig&&indexed))){removed=true;return false;}
              return true;
            });
            if(!removed&&Number.isInteger(requestedIndex)&&requestedIndex>=0&&requestedIndex<existing.length)boundaries=existing.filter((_,index)=>index!==requestedIndex);
          }
          const stats=boundaries.length?multiPolygonStats(boundaries):{center_lat:Number(farm.center_lat)||10.4247,center_lng:Number(farm.center_lng)||122.9225,area_hectares:0};
          return {boundaries,boundary:boundaries[0]||[],...stats,status:boundaries.length?'Mapped':'Unmapped'};
        }
        const incoming=cleanPolygon(payload.geojson||[]);
        const existing=farmBoundaries(farm);
        const boundaries=payload.replace===true?[incoming]:[...existing,incoming];
        const stats=multiPolygonStats(boundaries);
        return {boundaries,boundary:boundaries[0]||[],...stats,status:payload.status||'Mapped'};
      };
      setFarms(rows=>rows.map(f=>f.id===payload.farm_id?{...f,...makePatch(f)}:f));
      setBundle(b=>b?.farm?.id===payload.farm_id?{...b,farm:{...b.farm,...makePatch(b.farm)}}:b);
      return;
    }
    if(action==='createSensor'){
      const row={id:tempId,farm_id:payload.farm_id,sensor_code:payload.sensor_code||'Sensor',latitude:Number(payload.latitude),longitude:Number(payload.longitude),coverage_m:Number(payload.coverage_m||50),orientation_deg:Number(payload.orientation_deg||0),status:payload.status||'Online',nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),moisture:Number(payload.moisture||0),recorded_at:stamp,pending_sync:true};
      setAllSensors(rows=>[...rows.filter(item=>item.id!==row.id),row]);
      setBundle(b=>b?.farm?.id===payload.farm_id?{...b,sensors:[...b.sensors.filter(item=>item.id!==row.id),row]}:b);
      setSelectedSensorId(tempId);setSelectedPlotId(null);setSelectedDroneId(null);setFocusTarget(row);
      return;
    }
    if(action==='updateSensor'){
      const patch={sensor_code:payload.sensor_code,latitude:Number(payload.latitude),longitude:Number(payload.longitude),coverage_m:Number(payload.coverage_m||50),orientation_deg:Number(payload.orientation_deg||0),status:payload.status||'Online',nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),moisture:Number(payload.moisture||0),recorded_at:stamp,pending_sync:true};
      setAllSensors(rows=>rows.map(row=>row.id===payload.sensor_id?{...row,...patch}:row));
      setBundle(b=>b?{...b,sensors:b.sensors.map(row=>row.id===payload.sensor_id?{...row,...patch}:row)}:b);
      return;
    }
    if(action==='rotateSensor'){
      const angle=cleanAngle(payload.orientation_deg);
      setAllSensors(rows=>rows.map(row=>row.id===payload.sensor_id?{...row,orientation_deg:angle,pending_sync:true}:row));
      setBundle(b=>b?{...b,sensors:b.sensors.map(row=>row.id===payload.sensor_id?{...row,orientation_deg:angle,pending_sync:true}:row)}:b);
      setFocusTarget(target=>target?.id===payload.sensor_id?{...target,orientation_deg:angle,pending_sync:true}:target);
      return;
    }
    if(action==='deleteSensor'){
      const remove=row=>row.id===payload.sensor_id;
      setAllSensors(rows=>rows.filter(row=>!remove(row)));
      setBundle(b=>b?{...b,sensors:b.sensors.filter(row=>!remove(row))}:b);
      setSelectedSensorId(null);setFocusTarget(null);setMapRevision(v=>v+1);
      return;
    }
    if(action==='createPlot'){
      const row={id:tempId,farm_id:payload.farm_id,plot_code:payload.plot_code||'Soil Plot',latitude:Number(payload.latitude),longitude:Number(payload.longitude),coverage_m:Number(payload.coverage_m||0),boundary:[...(payload.geojson||[])],nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),classification:payload.classification||'Pending',notes:payload.notes||'',analyzed_at:stamp,pending_sync:true};
      setAllPlots(rows=>[...rows.filter(item=>item.id!==row.id),row]);
      setBundle(b=>b?.farm?.id===payload.farm_id?{...b,plots:[...b.plots.filter(item=>item.id!==row.id),row]}:b);
      setSelectedPlotId(tempId);setSelectedSensorId(null);setSelectedDroneId(null);setFocusTarget(row);
      return;
    }
    if(action==='updatePlot'){
      const patch={plot_code:payload.plot_code,latitude:Number(payload.latitude),longitude:Number(payload.longitude),coverage_m:Number(payload.coverage_m||0),boundary:payload.geojson?[...(payload.geojson||[])]:undefined,nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),classification:payload.classification||'Pending',notes:payload.notes||'',analyzed_at:stamp,pending_sync:true};
      setAllPlots(rows=>rows.map(row=>row.id===payload.plot_id?{...row,...Object.fromEntries(Object.entries(patch).filter(([,v])=>v!==undefined))}:row));
      setBundle(b=>b?{...b,plots:b.plots.map(row=>row.id===payload.plot_id?{...row,...Object.fromEntries(Object.entries(patch).filter(([,v])=>v!==undefined))}:row)}:b);
      return;
    }
    if(action==='deletePlot'){
      const remove=row=>row.id===payload.plot_id;
      setAllPlots(rows=>rows.filter(row=>!remove(row)));
      setBundle(b=>b?{...b,plots:b.plots.filter(row=>!remove(row))}:b);
      setSelectedPlotId(null);setFocusTarget(null);setMapRevision(v=>v+1);
      return;
    }
    if(action==='createDroneMapping'){
      const row={id:tempId,farm_id:payload.farm_id,name:payload.name||'Drone Mapping',boundary:[...(payload.geojson||[])],latitude:Number(payload.center_lat||0),longitude:Number(payload.center_lng||0),center_lat:Number(payload.center_lat||0),center_lng:Number(payload.center_lng||0),area_hectares:Number(payload.area_hectares||0),nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),moisture:Number(payload.moisture||0),classification:payload.classification||'Unclassified',notes:payload.notes||'',image_url:payload.image_url||'',captured_at:payload.captured_at||stamp,status:payload.status||'Mapped',pending_sync:true};
      setAllDrone(rows=>[...rows.filter(item=>item.id!==row.id),row]);
      setBundle(b=>b?.farm?.id===payload.farm_id?{...b,droneMappings:[...b.droneMappings.filter(item=>item.id!==row.id),row]}:b);
      setSelectedDroneId(tempId);
      setFocusTarget(row);
      return;
    }
    if(action==='updateDroneMapping'){
      const patch={name:payload.name,area_hectares:Number(payload.area_hectares||0),nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),organic_matter:Number(payload.organic_matter||0),ph:Number(payload.ph||0),moisture:Number(payload.moisture||0),classification:payload.classification||'Unclassified',notes:payload.notes||'',image_url:payload.image_url||'',captured_at:payload.captured_at,status:payload.status||'Mapped',pending_sync:true};
      setAllDrone(rows=>rows.map(row=>row.id===payload.drone_id?{...row,...patch}:row));
      setBundle(b=>b?{...b,droneMappings:b.droneMappings.map(row=>row.id===payload.drone_id?{...row,...patch}:row)}:b);
      return;
    }
    if(action==='deleteDroneMapping'){
      const remove=row=>row.id===payload.drone_id;
      setAllDrone(rows=>rows.filter(row=>!remove(row)));
      setBundle(b=>b?{...b,droneMappings:b.droneMappings.filter(row=>!remove(row))}:b);
      setSelectedDroneId(null);setFocusTarget(null);setMapRevision(v=>v+1);
    }
  }

  function reconcileTempId(action,tempId,result){
    const realId=action==='createSensor'?result?.sensorId:action==='createPlot'?result?.plotId:action==='createDroneMapping'?result?.droneId:null;
    if(!tempId||!realId)return;
    if(action==='createSensor'){
      const exact=result?.row?{...result.row,id:realId}:null;
      setAllSensors(rows=>rows.map(row=>row.id===tempId?(exact?{...row,...exact,id:realId}:{...row,id:realId}):row));
      setBundle(b=>b?{...b,sensors:b.sensors.map(row=>row.id===tempId?(exact?{...row,...exact,id:realId}:{...row,id:realId}):row)}:b);
      setSelectedSensorId(id=>id===tempId?realId:id);setFocusTarget(t=>t?.id===tempId?(exact?{...t,...exact,id:realId}:{...t,id:realId}):t);
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

  function mergeConfirmedRow(action,row,farmId){
    if(!row?.id)return;
    unmarkSpatialDeleted(row.id);
    const merge=(rows)=>{const map=new Map(rows.map(item=>[item.id,item]));map.set(row.id,{...map.get(row.id),...row,id:row.id});return [...map.values()];};
    if(action.includes('Sensor')||action==='rotateSensor'){
      setAllSensors(merge);setBundle(b=>b?.farm?.id===farmId?{...b,sensors:merge(b.sensors||[])}:b);
      setFocusTarget(t=>t?.id===row.id?{...t,...row}:t);return;
    }
    if(action.includes('Plot')){
      setAllPlots(merge);setBundle(b=>b?.farm?.id===farmId?{...b,plots:merge(b.plots||[])}:b);
      setFocusTarget(t=>t?.id===row.id?{...t,...row}:t);return;
    }
    if(action.includes('Drone')){
      setAllDrone(merge);setBundle(b=>b?.farm?.id===farmId?{...b,droneMappings:merge(b.droneMappings||[])}:b);
      setFocusTarget(t=>t?.id===row.id?{...t,...row}:t);
    }
  }

  function applyConfirmedDelete(action,ids=[]){
    const dead=new Set((ids||[]).filter(Boolean).map(String));if(!dead.size)return;
    for(const id of dead)markSpatialDeleted(id);
    if(action==='deleteSensor'){
      setAllSensors(rows=>rows.filter(row=>!dead.has(String(row.id||row.$id||''))));setBundle(b=>b?{...b,sensors:(b.sensors||[]).filter(row=>!dead.has(String(row.id||row.$id||'')))}:b);
      setSelectedSensorId(id=>dead.has(String(id||''))?null:id);setFocusTarget(t=>dead.has(String(t?.id||''))?null:t);return;
    }
    if(action==='deletePlot'){
      setAllPlots(rows=>rows.filter(row=>!dead.has(String(row.id||row.$id||''))));setBundle(b=>b?{...b,plots:(b.plots||[]).filter(row=>!dead.has(String(row.id||row.$id||'')))}:b);
      setSelectedPlotId(id=>dead.has(String(id||''))?null:id);setFocusTarget(t=>dead.has(String(t?.id||''))?null:t);return;
    }
    if(action==='deleteDroneMapping'){
      setAllDrone(rows=>rows.filter(row=>!dead.has(String(row.id||row.$id||''))));setBundle(b=>b?{...b,droneMappings:(b.droneMappings||[]).filter(row=>!dead.has(String(row.id||row.$id||'')))}:b);
      setSelectedDroneId(id=>dead.has(String(id||''))?null:id);setFocusTarget(t=>dead.has(String(t?.id||''))?null:t);
    }
  }

  function applySpatialServerResult(action,payload,result,tempId=null){
    const farmId=result?.farmId||payload?.farm_id||activeFarmId;
    if(tempId)reconcileTempId(action,tempId,result);
    if(result?.row)mergeConfirmedRow(action,{...result.row,id:result.row.id||result.row.$id},farmId);
    const confirmedDeletes=result?.deletedIds?.length?result.deletedIds:[spatialDeleteId(action,payload)].filter(Boolean);
    if(confirmedDeletes.length)applyConfirmedDelete(action,confirmedDeletes);
    // Farm boundary writes intentionally still return a complete farm bundle.
    // Sensor/Plot/Drone mutations are merge-only so one type can never erase
    // another type from the rendered workspace.
    if((action==='updateFarmBoundary'||action==='deleteFarmBoundary')&&result?.bundle?.farm)applyAuthoritativeBundle(farmId,result.bundle);
    setMapRevision(v=>v+1);
    return farmId;
  }

  function applyAuthoritativeBundle(farmId,nextBundle){
    if(!farmId||!nextBundle?.farm)return;
    const normalized={farm:nextBundle.farm,sensors:withoutDeleted(nextBundle.sensors||[]),plots:withoutDeleted(nextBundle.plots||[]),droneMappings:withoutDeleted(nextBundle.droneMappings||[])};
    setFarms(rows=>{const rest=rows.filter(f=>f.id!==farmId);return [...rest,normalized.farm].sort((a,b)=>String(a.farmer_name||'').localeCompare(String(b.farmer_name||'')));});
    setAllSensors(rows=>[...rows.filter(r=>r.farm_id!==farmId),...normalized.sensors]);
    setAllPlots(rows=>[...rows.filter(r=>r.farm_id!==farmId),...normalized.plots]);
    setAllDrone(rows=>[...rows.filter(r=>r.farm_id!==farmId),...normalized.droneMappings]);
    if(activeFarmId===farmId)setBundle(previous=>({...normalized,requests:Array.isArray(nextBundle.requests)?nextBundle.requests:(previous?.requests||[])}));
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

  async function syncPendingChanges({silent=false}={}){
    if(!isAdmin||isDemo||!user?.$id)return {synced:0,remaining:0};
    if(!isOnline){if(!silent)setNotice('Still offline. Pending changes are safe on this device and will sync after reconnection.');return {synced:0,remaining:pendingMutationCount(user.$id),offline:true};}
    if(offlineSyncLockRef.current)return {synced:0,remaining:pendingMutationCount(user.$id),busy:true};
    offlineSyncLockRef.current=true;setOfflineSyncing(true);
    const before=pendingMutationCount(user.$id);
    try{
      const result=await flushPendingMutations(user.$id,adminAction,{
        onApplied:async(item,response)=>{
          applySpatialServerResult(item.action,item.payload,response,item.meta?.tempId||null);
        },
        onBlocked:(item,error)=>{
          console.warn('Offline mutation is waiting for attention:',item,error);
        },
      });
      setPendingSyncCount(result.remaining||0);
      if(result.synced>0){
        const stamp=new Date().toISOString();setLastSyncedAt(stamp);
        setNotice(result.remaining?`${result.synced} offline change${result.synced===1?'':'s'} synced. ${result.remaining} still waiting.`:`${result.synced} offline change${result.synced===1?'':'s'} synced to Appwrite and the Farmer workspace.`);
      }else if(!silent&&before===0)setNotice('Everything is already synced.');
      else if(!silent&&result.remaining>0)setNotice(`${result.remaining} change${result.remaining===1?' is':'s are'} still waiting to sync.`);
      return result;
    }catch(error){
      if(!silent)setNotice(`Offline sync paused. ${error?.message||error}`);
      return {synced:0,remaining:pendingMutationCount(user.$id),error};
    }finally{offlineSyncLockRef.current=false;setOfflineSyncing(false);setPendingSyncCount(pendingMutationCount(user.$id));}
  }


  async function runSpatialAction(action,payload,success,{tempId=null}={}){
    if(!ensureWrite())return false;
    if(spatialActionLockRef.current||offlineSyncLockRef.current){
      setNotice(offlineSyncLockRef.current?'Queued offline changes are syncing. Please wait a moment before adding another map change.':'A map change is already being saved. Please wait for it to finish.');
      return false;
    }
    spatialActionLockRef.current=true;
    const snapshot={farms,allSensors,allPlots,allDrone,bundle,selectedSensorId,selectedPlotId,selectedDroneId,focusTarget};
    const isCreateFlow=['createSensor','createPlot','createDroneMapping'].includes(action);
    // Keep create modals + their GPS/polygon draft alive until Appwrite confirms
    // the write. Older builds closed them before the request, so a Plot/Drone
    // schema or network error looked like the Add button simply did nothing and
    // forced the user to redraw the whole shape before retrying.
    if(!isCreateFlow)closeSpatialUi();
    if(isDemo){
      try{applyDemoAction(action,payload);syncDemoState(payload.farm_id||activeFarmId);setNotice(`${success} Demo changes are saved in this browser.`);setEditor(null);if(isCreateFlow)closeSpatialUi();return true;}catch(err){setNotice(err.message);return false;}finally{spatialActionLockRef.current=false;}
    }

    const mutationId=payload?.mutation_id||createMutationId(action);
    const requestPayload={...payload,mutation_id:mutationId};
    const deleteId=spatialDeleteId(action,requestPayload);
    if(deleteId)markSpatialDeleted(deleteId);
    const optimisticTempId=tempId||`pending-${mutationId}`;
    let optimisticApplied=false;
    const applyLocal=()=>{if(optimisticApplied)return;applyOptimistic(action,requestPayload,optimisticTempId);optimisticApplied=true;};

    // Every map mutation is reflected immediately, including GPS-created Soil
    // Plots and Drone Mapping polygons. The server response replaces the pending
    // row with the deterministic Appwrite row, while a failed save restores the
    // pre-action snapshot. This keeps the UI responsive without creating ghosts.
    applyLocal();

    if(!isOnline){
      try{
        enqueueMutation(user.$id,action,requestPayload,{tempId:optimisticTempId,farmId:requestPayload.farm_id});
        setPendingSyncCount(pendingMutationCount(user.$id));
        // Keep the queued write, but restore the published map. A local-only
        // placeholder must not masquerade as a saved Sensor/Plot/Drone record.
        setFarms(snapshot.farms);setAllSensors(snapshot.allSensors);setAllPlots(snapshot.allPlots);setAllDrone(snapshot.allDrone);setBundle(snapshot.bundle);
        setSelectedSensorId(snapshot.selectedSensorId);setSelectedPlotId(snapshot.selectedPlotId);setSelectedDroneId(snapshot.selectedDroneId);setFocusTarget(snapshot.focusTarget);
        setNotice(`Saved to the offline queue. It will appear on the map only after Appwrite confirms the write. ${pendingMutationCount(user.$id)} change${pendingMutationCount(user.$id)===1?' is':'s are'} waiting for internet.`);
        setEditor(null);if(isCreateFlow)closeSpatialUi();return true;
      }catch(err){
        if(deleteId)unmarkSpatialDeleted(deleteId);
        setFarms(snapshot.farms);setAllSensors(snapshot.allSensors);setAllPlots(snapshot.allPlots);setAllDrone(snapshot.allDrone);setBundle(snapshot.bundle);
        setNotice(`Could not save this change to the offline queue. ${err.message}`);return false;
      }finally{spatialActionLockRef.current=false;setBusy(false);}
    }

    setBusy(true);
    try{
      const result=await adminAction(action,requestPayload);
      applySpatialServerResult(action,requestPayload,result,optimisticTempId);
      const stamp=new Date().toISOString();setLastSyncedAt(stamp);
      setNotice(result?.warning?`${success} ${result.warning}`:success);
      setEditor(null);if(isCreateFlow)closeSpatialUi();return true;
    }catch(err){
      if(isLikelyNetworkError(err)){
        try{
          enqueueMutation(user.$id,action,requestPayload,{tempId:optimisticTempId,farmId:requestPayload.farm_id});
          setPendingSyncCount(pendingMutationCount(user.$id));
          setFarms(snapshot.farms);setAllSensors(snapshot.allSensors);setAllPlots(snapshot.allPlots);setAllDrone(snapshot.allDrone);setBundle(snapshot.bundle);
          setSelectedSensorId(snapshot.selectedSensorId);setSelectedPlotId(snapshot.selectedPlotId);setSelectedDroneId(snapshot.selectedDroneId);setFocusTarget(snapshot.focusTarget);
          setNotice(`Connection was lost while saving. The change is queued locally and will appear only after Appwrite confirms it.`);
          setEditor(null);if(isCreateFlow)closeSpatialUi();return true;
        }catch(queueError){
          setNotice(`Connection failed and SOILS could not queue the change locally. ${queueError.message}`);
        }
      }
      if(deleteId)unmarkSpatialDeleted(deleteId);
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
    if(!isAdmin){
      if(!['sensor','plot','drone'].includes(kind)){setNotice('Farmers can request Sensors, Soil Plots, or Drone Mapping. Farm Boundaries remain Admin-managed.');return;}
      if(!activeFarmId||!current){setNotice('No assigned farm is available for this request.');return;}
      if(!farmHasBoundary(current)){setNotice('Your Farm Boundary must be mapped by the administrator before you can request a Sensor, Soil Plot, or Drone Mapping area.');return;}
    }else if(!ensureWrite())return;
    if(!activeFarmId){setNotice('Select a farmer/farm first.');return;}
    if(kind!=='farm' && !farmHasBoundary(current)){setNotice('Draw and save this farmer’s Farm Boundary first. Sensors, Soil Plots, and Drone Mapping must belong inside that boundary.');return;}
    setSelectedSensorId(null);setSelectedPlotId(null);setSelectedDroneId(null);setFocusTarget(null);
    setPendingShape(null);setPlacementOrientation(0);
    if(kind==='sensor'){const c=multiPolygonStats(farmBoundaries(current));setDrawPoints([[c.center_lat,c.center_lng]]);}else setDrawPoints([]);
    setDrawMode(kind);
    setNotice(!isAdmin?(kind==='sensor'?'Place the Sensor you want to request. It will be sent to Admin for approval.':kind==='plot'?'Plot the Soil Analysis area you want to request, then submit it for Admin approval.':'Plot the Drone Mapping area you want to request, then submit it for Admin approval.'):(kind==='plot'?'Soil Plot plotting is active. Add map or GPS points, then click Finish plotting.':kind==='drone'?'Drone Mapping plotting is active. Add map or GPS points, then click Finish plotting.':kind==='sensor'?'Sensor placement is active.':'Farm Boundary drawing is active. New boundaries are added without replacing saved boundaries.'));
  };
  const cancelDraw=()=>{setDrawMode(null);setDrawPoints([]);setPlacementOrientation(0);setPendingShape(null);};
  const mapPoint=(point)=>{
    if(['sensor','plot','drone'].includes(drawMode) && farmHasBoundary(current) && !pointInFarm(point,current)){
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
    if(drawMode==='sensor' && farmHasBoundary(current) && !pointInFarm(points[0],current)){setNotice('The sensor is outside the farmer’s Farm Boundary. Drag it inside the green boundary before continuing.');return;}
    const nextShape={draft_id:localId('draft'),type:drawMode,farm_id:activeFarmId,points:points.map(p=>[Number(p[0]),Number(p[1])]),orientation_deg:drawMode==='sensor'?cleanAngle(placementOrientation):0};
    setPendingShape(nextShape);setModal(isAdmin?drawMode:`request-${drawMode}`);setDrawMode(null);
  };
  const saveFarmBoundary=()=>{const points=cleanPolygon(drawPoints);if(points.length<3){setNotice('Add at least 3 farm boundary points before saving.');return;}if(polygonHasCrossing(points)){setNotice('The Farm Boundary crosses over itself. Use Undo or Clear, then trace the outer edge in order.');return;}const nextCount=farmBoundaries(current).length+1;runSpatialAction('updateFarmBoundary',{farm_id:activeFarmId,geojson:points,append:true,status:'Mapped'},`Farm Boundary ${nextCount} added and synced without replacing earlier boundaries.`);};
  const deleteBoundaryAt=(index)=>{const boundaries=farmBoundaries(current);const target=boundaries[index];if(!target)return false;const remaining=Math.max(0,boundaries.length-1);return runSpatialAction('deleteFarmBoundary',{farm_id:current.id,boundary_index:index,geojson:target},remaining?`Farm Boundary ${index+1} deleted. ${remaining} boundar${remaining===1?'y remains':'ies remain'}.`:'The last farm boundary was deleted.');};
  const deleteBoundary=()=>{const boundaries=farmBoundaries(current);if(!boundaries.length)return;if(boundaries.length===1){if(confirm(`Delete Farm Boundary 1 for ${current.name}?`))deleteBoundaryAt(0);return;}setModal('deleteBoundary');};
  const deleteFarmer=()=>{if(current&&confirm(`Delete ${current.farmer_name}, their login, farm, sensors, plots, analyses, and drone mappings?`))runAction('deleteFarmer',{farmer_id:current.farmer_id,farm_id:current.id},'Farmer and associated farm data deleted.');};

  async function submitFarmerMapRequest(form={}){
    if(isAdmin||!pendingShape?.type||busy)return false;
    setBusy(true);
    try{
      const result=await createFarmerSpatialRequest({client_request_id:pendingShape.draft_id,farm_id:pendingShape.farm_id||activeFarmId,request_type:pendingShape.type,points:pendingShape.points||[],orientation_deg:pendingShape.orientation_deg||0,coverage_m:Number(form.coverage_m||50),title:form.title,notes:form.notes});
      if(result?.request)setBundle(currentBundle=>currentBundle?{...currentBundle,requests:[...(currentBundle.requests||[]).filter(row=>row.id!==result.request.id),result.request]}:currentBundle);
      setNotice(result?.notificationWarning?`Request saved for Admin approval. ${result.notificationWarning}`:'Request sent for Admin approval. The Admin can open it directly from Support Inbox and jump to this exact map position.');
      closeSpatialUi();return true;
    }catch(error){setNotice(error.message||'The map request could not be sent.');return false;}
    finally{setBusy(false);}
  }

  const clearSpatialSelection=()=>{setSelectedSensorId(null);setSelectedPlotId(null);setSelectedDroneId(null);setFocusTarget(null);};

  async function focusMapTarget(target,options={}){
    const sourceOnly=Boolean(options?.sourceOnly||target?.focusOnly);
    const item=target?.row?target:{row:target,kind:'sensor'};
    const row=item?.row;if(!row)return false;
    const kind=item.kind||'sensor';
    let farmId=kind==='farm'?(row.id||row.$id):row.farm_id;
    let boundary=item.boundary||row.boundary||[];
    let latitude=Number(row.latitude??row.center_lat);
    let longitude=Number(row.longitude??row.center_lng);
    let focusId=row.id||row.$id||`${kind}-focus`;
    if(kind==='farm'){
      const boundaries=farmBoundaries(row);
      const index=boundaries.length?Math.max(0,Math.min(Number(item.boundaryIndex||0),boundaries.length-1)):0;
      boundary=boundaries[index]||[];
      const stats=boundary.length?polygonStats(boundary):{center_lat:Number(row.center_lat),center_lng:Number(row.center_lng)};
      latitude=Number(stats.center_lat);longitude=Number(stats.center_lng);focusId=`${row.id||row.$id}-boundary-${index}`;
    }else if(kind==='plot'||kind==='drone'){
      boundary=cleanPolygon(boundary);
      if(boundary.length){const stats=polygonStats(boundary);latitude=stats.center_lat;longitude=stats.center_lng;}
    }
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return false;
    // Section navigation is also a real selection command. Keeping the target
    // selected makes the polygon/pin visibly highlight while the camera flies,
    // and prevents the Soil Plot cycle from feeling like a no-op when a large
    // floating map control happens to cover part of the polygon.
    const recordId=row.id||row.$id||null;
    // Source-dropdown navigation only moves/highlights the map. It deliberately
    // clears record selection so RecordPreview does not cover the mobile map.
    if(sourceOnly){setSelectedSensorId(null);setSelectedPlotId(null);setSelectedDroneId(null);}
    else if(kind==='sensor'){setSelectedSensorId(recordId);setSelectedPlotId(null);setSelectedDroneId(null);}
    else if(kind==='plot'){setSelectedSensorId(null);setSelectedPlotId(recordId);setSelectedDroneId(null);}
    else if(kind==='drone'){setSelectedSensorId(null);setSelectedPlotId(null);setSelectedDroneId(recordId);}
    else clearSpatialSelection();
    if(farmId)setActiveFarmId(farmId);
    setFocusTarget({...row,id:focusId,farm_id:farmId||row.farm_id,latitude,longitude,boundary,focus_kind:kind,focus_seq:++focusRequestRef.current});
    if(isAdmin&&farmId&&bundle?.farm?.id!==farmId){
      try{
        const next=isDemo?loadLocalDemoBundle(farmId):(await adminAction('getFarmWorkspace',{farm_id:farmId}))?.bundle;
        if(next?.farm)setBundle(next);
      }catch(error){console.warn('Map focus workspace refresh skipped:',error?.message||error);}
    }
    return true;
  }

  async function selectSensor(sensor, openSensorView=false){
    if(!sensor?.id){clearSpatialSelection();return;}
    const target={...sensor,latitude:Number(sensor.latitude),longitude:Number(sensor.longitude),focus_seq:++focusRequestRef.current};
    setSelectedSensorId(sensor.id);setSelectedPlotId(null);setSelectedDroneId(null);setFocusTarget(target);if(openSensorView)setView('sensors');
    if(isAdmin && sensor.farm_id && sensor.farm_id!==activeFarmId){setActiveFarmId(sensor.farm_id);try{setBundle(isDemo?loadLocalDemoBundle(sensor.farm_id):(await adminAction('getFarmWorkspace',{farm_id:sensor.farm_id}))?.bundle||null);}catch{}}
  }
  async function locateSensor(sensor){
    if(!sensor?.id){clearSpatialSelection();return;}
    const target={...sensor,latitude:Number(sensor.latitude),longitude:Number(sensor.longitude),focus_seq:++focusRequestRef.current};
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
    const target={...plot,latitude,longitude,focus_seq:++focusRequestRef.current};
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
    const target={...drone,latitude,longitude,focus_seq:++focusRequestRef.current};
    setSelectedDroneId(drone.id);setSelectedSensorId(null);setSelectedPlotId(null);setFocusTarget(target);
    if(isAdmin && drone.farm_id && drone.farm_id!==activeFarmId){
      setActiveFarmId(drone.farm_id);
      try{setBundle(isDemo?loadLocalDemoBundle(drone.farm_id):(await adminAction('getFarmWorkspace',{farm_id:drone.farm_id}))?.bundle||null);}catch{}
    }
  }
  async function openAdminSpatialRequest(request){
    if(!isAdmin||!request)return false;
    const farmId=String(request.farm_id||'');
    setRequestReviewError('');
    setActiveSpatialRequest(request);
    setView('overview');
    clearSpatialSelection();
    if(farmId){
      setActiveFarmId(farmId);
      if(bundle?.farm?.id!==farmId){
        try{const result=await adminAction('getFarmWorkspace',{farm_id:farmId},{force:true});if(result?.bundle)applyAuthoritativeBundle(farmId,result.bundle);}catch(error){setNotice(error.message||'The requested farm could not be opened.');}
      }
    }
    const boundary=cleanPolygon(request.boundary||[]);
    const latitude=Number(request.latitude??request.center_lat??(boundary.length?polygonStats(boundary).center_lat:NaN));
    const longitude=Number(request.longitude??request.center_lng??(boundary.length?polygonStats(boundary).center_lng:NaN));
    if(Number.isFinite(latitude)&&Number.isFinite(longitude))setFocusTarget({...request,id:`request-${request.id||request.$id}`,farm_id:farmId,latitude,longitude,boundary,focus_kind:'request',focus_seq:++focusRequestRef.current});
    setNotice(`Reviewing ${request.request_type==='sensor'?'Sensor':request.request_type==='plot'?'Soil Plot':'Drone Mapping'} request from ${request.farmer_name||'Farmer'}.`);
    return true;
  }

  async function recoverSpatialReview(requestId,farmId){
    try{
      const threads=await adminAction('getSupportThreads',{}, {force:true});
      const requests=(Array.isArray(threads)?threads:[]).flatMap(thread=>(thread.messages||[]).map(message=>message.request).filter(Boolean));
      const recovered=requests.find(request=>String(request.id||request.$id)===String(requestId));
      if(!recovered||String(recovered.status||'pending').toLowerCase()==='pending')return false;
      const status=String(recovered.status||'').toLowerCase();
      patchLocalSpatialRequest(requestId,recovered);
      setFocusTarget(target=>target?.focus_kind==='request'?null:target);
      if(status==='approved')setActiveSpatialRequest(recovered);else setActiveSpatialRequest(null);
      if(status==='approved'&&farmId){
        const workspace=await adminAction('getFarmWorkspace',{farm_id:farmId},{force:true});
        if(workspace?.bundle)applyAuthoritativeBundle(farmId,workspace.bundle);
      }
      setNotice(status==='approved'?'Approval was confirmed in Appwrite and the published record was recovered.':'The rejection was confirmed in Appwrite and removed from the map.');
      return true;
    }catch{return false;}
  }

  function patchLocalSpatialRequest(requestId,patch){
    if(!requestId)return;
    setBundle(previous=>{
      if(!previous?.farm||String(previous.farm.id)!==String(activeSpatialRequest?.farm_id||activeFarmId))return previous;
      const rows=Array.isArray(previous.requests)?previous.requests:[];
      const status=String(patch?.status||'').toLowerCase();
      // Approved/rejected requests are review history, not live map layers. Remove
      // them from the active bundle immediately so no request overlay can linger
      // while the authoritative refresh runs in the background.
      if(['approved','rejected'].includes(status))return {...previous,requests:rows.filter(row=>String(row.id||row.$id)!==String(requestId))};
      return {...previous,requests:rows.map(row=>String(row.id||row.$id)===String(requestId)?{...row,...patch}:row)};
    });
    setMapRevision(value=>value+1);
  }

  async function reviewActiveSpatialRequest(decision){
    if(!isAdmin||!activeSpatialRequest?.id||requestReviewBusy)return;
    const originalRequest={...activeSpatialRequest};
    const requestId=originalRequest.id;const requestFarmId=originalRequest.farm_id;
    const transientStatus=decision==='approve'?'approving':'rejecting';
    setRequestReviewBusy(true);
    setRequestReviewError('');

    setActiveSpatialRequest({...originalRequest,status:transientStatus});
    patchLocalSpatialRequest(requestId,{status:transientStatus});
    setFocusTarget(target=>target?.focus_kind==='request'?null:target);
    try{
      const result=await adminAction('reviewSpatialRequest',{request_id:requestId,decision},{force:true});
      const finalStatus=decision==='approve'?'approved':'rejected';
      const nextRequest={...originalRequest,...(result?.request||{}),status:result?.request?.status||finalStatus};
      patchLocalSpatialRequest(requestId,nextRequest);
      setFocusTarget(target=>target?.focus_kind==='request'?null:target);

      if(decision==='approve'&&result?.entity){
        const action=result.entityType==='sensor'?'createSensor':result.entityType==='plot'?'createPlot':'createDroneMapping';
        const exact={...result.entity,id:result.entity.id||result.entity.$id,farm_id:nextRequest.farm_id};
        mergeConfirmedRow(action,exact,nextRequest.farm_id);
        if(result.entityType==='sensor')setFocusTarget({...exact,focus_kind:'sensor',focus_seq:++focusRequestRef.current});
        else setFocusTarget({...exact,boundary:cleanPolygon(exact.boundary||[]),focus_kind:result.entityType,focus_seq:++focusRequestRef.current});
      }

      // A completed review is no longer a pending map object. Close the review
      // card for BOTH decisions and let the real approved record remain focused.
      setActiveSpatialRequest(null);
      if(nextRequest.farm_id){
        adminAction('getFarmWorkspace',{farm_id:nextRequest.farm_id},{force:true}).then(workspace=>{
          if(workspace?.bundle)applyAuthoritativeBundle(nextRequest.farm_id,workspace.bundle);
        }).catch(()=>{});
      }
      const baseNotice=decision==='approve'?'Farmer request approved. The requested location is now a published Admin map record.':'Farmer request rejected and removed from the map.';
      setNotice(result?.statusWarning?`${baseNotice} ${result.statusWarning}`:baseNotice);
    }catch(error){
      const message=error.message||'The request could not be reviewed.';
      setRequestReviewError(message);
      setNotice(message);
      // Before restoring Pending, ask the backend whether the deterministic real
      // record was actually committed. This catches the common Appwrite case in
      // which the response fails after the database write succeeded.
      const recovered=await recoverSpatialReview(requestId,requestFarmId);
      if(!recovered){
        setActiveSpatialRequest(originalRequest);
        patchLocalSpatialRequest(requestId,{status:'pending'});
        const boundary=cleanPolygon(originalRequest.boundary||[]);
        const latitude=Number(originalRequest.latitude??originalRequest.center_lat??(boundary.length?polygonStats(boundary).center_lat:NaN));
        const longitude=Number(originalRequest.longitude??originalRequest.center_lng??(boundary.length?polygonStats(boundary).center_lng:NaN));
        if(Number.isFinite(latitude)&&Number.isFinite(longitude))setFocusTarget({...originalRequest,id:`request-${requestId}`,farm_id:requestFarmId,latitude,longitude,boundary,focus_kind:'request',focus_seq:++focusRequestRef.current});
      }else{
        setActiveSpatialRequest(null);
        setRequestReviewError('');
      }
    }finally{setRequestReviewBusy(false);}
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


  const saveSensor=(form)=>{const sensorId=form.id||form.$id||selectedSensor?.id||selectedSensor?.$id;const farmId=form.farm_id||selectedSensor?.farm_id;const farm=farms.find(item=>item.id===farmId)||current;const point=[Number(form.latitude),Number(form.longitude)];if(!Number.isFinite(point[0])||!Number.isFinite(point[1])){setNotice('Enter a valid sensor GPS latitude and longitude.');return false;}if(farmHasBoundary(farm)&&!pointInFarm(point,farm)){setNotice('The sensor GPS coordinate must stay inside this farmer’s Farm Boundary.');return false;}return runSpatialAction('updateSensor',{sensor_id:sensorId,farm_id:farmId,...form,latitude:point[0],longitude:point[1],orientation_deg:cleanAngle(form.orientation_deg)},'Sensor readings, GPS position, coverage, and rotation published to the farmer.');};
  const rotateSensorQuick=(sensor,delta)=>{
    const orientation_deg=cleanAngle(Number(sensor?.orientation_deg||0)+Number(delta||0));
    return runSpatialAction('rotateSensor',{sensor_id:sensor.id||sensor.$id,farm_id:sensor.farm_id,orientation_deg},`Sensor rotated to ${orientation_deg.toFixed(0)}° and synced to the farmer.`);
  };
  const deleteSensor=(sensor)=>{const id=sensor?.id||sensor?.$id;if(!id){setNotice('This Sensor has no Appwrite record ID, so it cannot be deleted until the workspace refreshes.');return false;}if(!confirm(`Delete ${sensor.sensor_code} and all of its readings?`))return false;return runSpatialAction('deleteSensor',{sensor_id:id,farm_id:sensor.farm_id,sensor_code:sensor.sensor_code},'Sensor permanently deleted from Appwrite and synced.');};
  const savePlot=(form)=>runSpatialAction('updatePlot',{plot_id:form.id||form.$id,farm_id:form.farm_id||selectedPlot?.farm_id,...form},'Soil analysis plot values published to the farmer.');
  const deletePlot=(plot)=>{const id=plot?.id||plot?.$id;if(!id){setNotice('This Soil Plot has no Appwrite record ID, so it cannot be deleted until the workspace refreshes.');return false;}if(!confirm(`Delete ${plot.plot_code} and its soil analysis?`))return false;return runSpatialAction('deletePlot',{plot_id:id,farm_id:plot.farm_id,plot_code:plot.plot_code},'Soil analysis plot permanently deleted from Appwrite and synced.');};
  const saveDrone=(form)=>runSpatialAction('updateDroneMapping',{drone_id:form.id||form.$id,farm_id:form.farm_id||selectedDrone?.farm_id,...form},'Drone mapping statistics updated and published.');
  const deleteDrone=(d)=>{const id=d?.id||d?.$id;if(!id){setNotice('This Drone Mapping has no Appwrite record ID, so it cannot be deleted until the workspace refreshes.');return false;}if(!confirm(`Delete ${d.name}?`))return false;return runSpatialAction('deleteDroneMapping',{drone_id:id,farm_id:d.farm_id,name:d.name},'Drone mapping permanently deleted from Appwrite and synced.');};

  const previewFor=(farmName=current?.name)=>{
    if(selectedSensor)return <RecordPreview sensor={selectedSensor} farmName={farmName} editable={isAdmin} onEdit={()=>setEditor({type:'sensor',row:selectedSensor})} onRotate={(row,delta)=>rotateSensorQuick(row,delta)} onDelete={deleteSensor} onClose={()=>selectSensor(null)} busy={busy}/>;
    if(selectedPlot)return <RecordPreview plot={selectedPlot} farmName={farmName} editable={isAdmin} onEdit={()=>setEditor({type:'plot',row:selectedPlot})} onDelete={deletePlot} onClose={()=>selectPlot(null)} busy={busy}/>;
    if(selectedDrone)return <RecordPreview drone={selectedDrone} farmName={farmName} editable={isAdmin} onEdit={()=>setEditor({type:'drone',row:selectedDrone})} onDelete={deleteDrone} onClose={()=>selectDrone(null)} busy={busy}/>;
    return null;
  };

  const farmToolbar=<MapToolbar requestOnly={!isAdmin} drawMode={drawMode} points={drawPoints} onStart={startDraw} onUndo={()=>setDrawPoints(v=>v.slice(0,-1))} onClear={()=>setDrawPoints([])} onCancel={cancelDraw} onSave={continueDraw} onGpsPoint={mapPoint} onDeleteBoundary={deleteBoundary} canDeleteBoundary={isAdmin&&farmHasBoundary(current)} busy={busy}/>;

  const navigateView=(nextView)=>{
    const previous=previousViewRef.current;
    previousViewRef.current=nextView;
    // Entering the Sensors directory is navigation-only. Never carry an old map
    // preview into the page. Directory clicks only set focusTarget; the preview
    // opens after the actual pin/coverage is clicked.
    if(nextView==='sensors' && previous!=='sensors') clearSpatialSelection();

    // My Farm is also a camera command. The first click opens Boundary 1; each
    // repeated click advances to the next saved boundary, then wraps to Boundary 1.
    if(nextView==='farm'){
      clearSpatialSelection();
      const boundaries=farmBoundaries(current);
      setFarmBoundaryIndex(index=>previous==='farm'&&boundaries.length?((index+1)%boundaries.length):0);
      const immediateFarmId=activeFarmId||bundle?.farm?.id||farms[0]?.id||null;
      if(immediateFarmId)setActiveFarmId(immediateFarmId);
      setView('farm');
      setFarmFitRevision(v=>v+1);
      if(isAdmin||!isOnline)return;

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

  return <div className="app-shell sharp-layout"><AppTopbar role={mode} view={view} setView={navigateView} farms={farms} activeFarmId={activeFarmId} openFarm={openFarm} user={user} logout={logout}/><main className="main-content">{notice&&<div className="notice-bar"><span>{notice}</span><button onClick={()=>setNotice('')}>×</button></div>}<SyncStatus online={isOnline} pending={pendingSyncCount} syncing={offlineSyncing} lastSyncedAt={lastSyncedAt} onSync={()=>syncPendingChanges()} admin={isAdmin&&!isDemo}/>{loading?<div className="loading-screen"><div className="loader"/><b>Loading soil workspace…</b><span>Preparing maps and soil layers</span></div>:<div key={`${mode}-${view}-${activeFarmId||'global'}`} className="view-stage">
    {view==='overview' && isAdmin && <AdminOverview farms={farms} sensors={sensorGlobal} plots={plotGlobal} drone={droneGlobal} activeFarmId={activeFarmId} openFarm={openFarm} online={online} toolbar={farmToolbar} drawProps={{drawMode,drawPoints,onMapPoint:mapPoint,drawOrientation:placementOrientation,onDrawOrientation:setPlacementOrientation}} selectSensor={selectSensor} onPlot={selectPlot} onDrone={selectDrone} onFocusMap={focusMapTarget} selectedSensor={selectedSensor} selectedPlot={selectedPlot} selectedDrone={selectedDrone} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSaveSensor={saveSensor} onDeleteSensor={deleteSensor} onSaveDrone={saveDrone} onDeleteDrone={deleteDrone} onDeletePlot={deletePlot} farmNameMap={farmNameMap} busy={busy} onAddFarmer={()=>setModal('farmer')} mapRevision={mapRevision} preview={previewFor(selectedSensor?.farm_name||selectedPlot?.farm_name||selectedDrone?.farm_name||current?.name)}/>} 
    {view==='statistics' && isAdmin && <Statistics farms={farms} sensors={allSensors} plots={allPlots} drone={allDrone} activeFarmId={activeFarmId} onSensor={s=>selectSensor(s,false)} onPlot={selectPlot} onDrone={selectDrone} onFocusMap={focusMapTarget} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} preview={previewFor(selectedSensor?.farm_name||selectedPlot?.farm_name||selectedDrone?.farm_name||current?.name)} mapRevision={mapRevision}/>} 
    {view==='sensors' && <SensorPage admin={isAdmin} farms={farms} sensors={isAdmin?sensorGlobal:sensors} plots={isAdmin?plotGlobal:plots} drone={isAdmin?droneGlobal:droneMappings} activeFarmId={activeFarmId} selectedSensor={selectedSensor} selectedPlot={selectedPlot} selectedDrone={selectedDrone} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onLocate={locateSensor} onSelect={s=>selectSensor(s,false)} onPlot={selectPlot} onDrone={selectDrone} onFocusMap={focusMapTarget} onSave={saveSensor} onDelete={deleteSensor} onSaveDrone={saveDrone} onDeleteDrone={deleteDrone} busy={busy} mapRevision={mapRevision} preview={previewFor(selectedSensor?.farm_name||selectedPlot?.farm_name||selectedDrone?.farm_name||current?.name)}/>} 
    {(view==='farmer' || view==='farm' || (!isAdmin && view==='overview')) && (current?<FarmDetail farm={current} sensors={sensors} plots={plots} drone={droneMappings} requests={spatialRequests} userMode={!isAdmin} overview={view==='overview'} admin={isAdmin} toolbar={farmToolbar} drawProps={{drawMode,drawPoints,onMapPoint:mapPoint,drawOrientation:placementOrientation,onDrawOrientation:setPlacementOrientation}} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSensor={s=>selectSensor(s,false)} onPlot={selectPlot} onDrone={selectDrone} onFocusMap={focusMapTarget} selectedSensor={selectedSensor} selectedPlot={selectedPlot} selectedDrone={selectedDrone} onSaveSensor={saveSensor} onSaveDrone={saveDrone} onDeleteSensor={deleteSensor} onDeletePlot={deletePlot} onDeleteDrone={deleteDrone} onDeleteFarmer={deleteFarmer} busy={busy} mapRevision={mapRevision} preview={previewFor(current?.name)} fitRequestKey={farmFitRevision} fitBoundaryIndex={farmBoundaryIndex}/>:<Empty text="No farm is assigned to this account"/>)}
    {!isAdmin && view==='analysis' && <AnalysisPage farm={current} sensors={sensors} plots={plots} onSensor={s=>selectSensor(s,false)} onPlot={selectPlot} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId}/>} 
  </div>}

  {modal==='farmer'&&<FarmerModal busy={busy} onClose={()=>setModal(null)} onSave={(data)=>runAction('createFarmer',data,'Farmer account and farm created.')}/>} 
  {modal==='deleteBoundary'&&current&&<BoundaryDeleteModal farm={current} busy={busy} onClose={()=>setModal(null)} onDelete={deleteBoundaryAt}/>} 
  {modal==='sensor'&&<SensorCreateModal defaultName={nextNumberedName(sensors,'Sensor','sensor_code')} point={pendingShape?.points?.[0]} orientation={pendingShape?.orientation_deg||0} busy={busy} onClose={()=>{setModal(null);setPendingShape(null)}} onSave={(data)=>{const latitude=Number(data.latitude),longitude=Number(data.longitude);if(!Number.isFinite(latitude)||latitude<-90||latitude>90||!Number.isFinite(longitude)||longitude<-180||longitude>180){setNotice('Enter a valid sensor GPS latitude and longitude.');return false;}if(farmHasBoundary(current)&&!pointInFarm([latitude,longitude],current)){setNotice('The sensor GPS coordinate is outside this farmer’s Farm Boundary.');return false;}const tempId=localId('sensor');return runSpatialAction('createSensor',{farm_id:pendingShape?.farm_id||activeFarmId,...data,latitude,longitude,orientation_deg:cleanAngle(pendingShape?.orientation_deg||data.orientation_deg||0)},'Sensor added and synced to Appwrite.',{tempId})}}/>} 
  {modal==='plot'&&<PlotCreateModal key={pendingShape?.draft_id||'plot-create'} defaultName={nextNumberedName(plots,'Plot','plot_code')} points={pendingShape?.points||[]} busy={busy} onClose={()=>{setModal(null);setPendingShape(null)}} onSave={(data)=>{if(!pendingShape?.points?.length)return false;const shape=pendingShape.points.map(p=>[Number(p[0]),Number(p[1])]);const stats=polygonStats(shape);const tempId=localId('plot');return runSpatialAction('createPlot',{farm_id:pendingShape?.farm_id||activeFarmId,geojson:shape,latitude:stats.center_lat,longitude:stats.center_lng,...data},'Soil analysis plot added and saved to Appwrite.',{tempId}) }}/>} 
  {modal==='drone'&&<DroneCreateModal key={pendingShape?.draft_id||'drone-create'} defaultName={nextNumberedName(droneMappings,'Drone Mapping','name')} points={pendingShape?.points||[]} busy={busy} onClose={()=>{setModal(null);setPendingShape(null)}} onSave={(data)=>{if(!pendingShape?.points?.length)return false;const shape=pendingShape.points.map(p=>[Number(p[0]),Number(p[1])]);const stats=polygonStats(shape);const tempId=localId('drone');return runSpatialAction('createDroneMapping',{farm_id:pendingShape?.farm_id||activeFarmId,geojson:shape,...stats,...data},'Drone mapping added and saved to Appwrite.',{tempId})}}/>} 
  {modal?.startsWith('request-')&&pendingShape&&<SpatialRequestModal type={pendingShape.type} points={pendingShape.points||[]} orientation={pendingShape.orientation_deg||0} busy={busy} onClose={()=>{setModal(null);setPendingShape(null)}} onSave={submitFarmerMapRequest}/>} 
  {editor?.type==='sensor'&&<SensorEditorModal sensor={editor.row} busy={busy} onClose={()=>setEditor(null)} onSave={saveSensor}/>}
  {editor?.type==='plot'&&<PlotEditorModal plot={editor.row} busy={busy} onClose={()=>setEditor(null)} onSave={savePlot}/>}
  {editor?.type==='drone'&&<DroneEditorModal drone={editor.row} busy={busy} onClose={()=>setEditor(null)} onSave={saveDrone}/>}
  </main><SupportChat user={user} admin={isAdmin} onOpenSpatialRequest={openAdminSpatialRequest}/>{isAdmin&&activeSpatialRequest&&<SpatialRequestReviewCard request={activeSpatialRequest} busy={requestReviewBusy} error={requestReviewError} onApprove={()=>reviewActiveSpatialRequest('approve')} onReject={()=>reviewActiveSpatialRequest('reject')} onClose={()=>setActiveSpatialRequest(null)}/>}</div>;
}

function AdminOverview({
  farms,sensors,plots,drone,activeFarmId,openFarm,online,toolbar,drawProps,
  selectSensor,onPlot,onDrone,onFocusMap,selectedSensor,selectedPlot,selectedDrone,selectedSensorId,selectedPlotId,selectedDroneId,focusTarget,
  onSaveSensor,onDeleteSensor,onSaveDrone,onDeleteDrone,onDeletePlot,farmNameMap,busy,onAddFarmer,mapRevision,preview
}){
  const [section,setSection]=useState('farms');
  const [sectionPanelCollapsed,setSectionPanelCollapsed]=useState(true);
  useEffect(()=>{if(drawProps.drawMode)setSectionPanelCollapsed(true);},[drawProps.drawMode]);
  const area=farms.reduce((sum,farm)=>sum+(Number(farm.area_hectares)||0),0);
  const modeHint=section==='plots'?'analysis':section==='drone'?'drone':'farm';
  const sectionControl=<MapSectionCycleControl farms={farms} sensors={sensors} plots={plots} drone={drone} section={section} onSectionChange={setSection} onFocus={onFocusMap} onDeletePlotSource={onDeletePlot} collapsed={sectionPanelCollapsed} onCollapsedChange={setSectionPanelCollapsed}/>;
  return <>
    <Header title="Overview" subtitle="One sharp-edged workspace. Select a section, then click any record to reveal the map pin or polygon that owns its data." action={<button className="primary-btn header-btn" onClick={onAddFarmer}><Plus size={15}/>Add farmer</button>}/>
    <section className="panel overview-unified-section">
      <div className="overview-map-grid overview-unified-map">
        <MapWorkspace
          farms={farms}
          sensors={sensors}
          plots={plots}
          droneMappings={drone}
          activeFarmId={activeFarmId}
          onFarmClick={(f)=>openFarm(f.id)}
          admin
          embedded
          overlayScope="overview"
          modeHint={modeHint}
          height={590}
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
          sectionControl={sectionControl}
          showMapPopups={false}
          preview={preview}
          dataRevision={mapRevision}
        />
      </div>

      <div key={`overview-details-${section}`} className="overview-detail-stage section-transition-in">
        {section==='farms'&&<>
          <div className="overview-detail-title"><div><span>FARM STATUS</span><h4>Farmers</h4></div><small>{farms.length} total</small></div>
          <div className="farm-table overview-detail-grid">{farms.length?farms.map(f=><button key={f.id} onClick={()=>openFarm(f.id)}><div className="farm-icon"><Sprout size={17}/></div><div><b>{f.farmer_name}</b><span>{f.name}</span></div><StatusPill value={f.status||'Good'}/></button>):<Empty text="No farms registered"/>}</div>
        </>}
        {section==='sensors'&&<>
          <div className="overview-detail-title"><div><span>FIELD DEVICES</span><h4>Sensor Stations</h4></div><small>{sensors.length} stations</small></div>
          <div className="overview-record-grid">{sensors.length?sensors.map(s=><article key={s.id} className={selectedSensorId===s.id?'selected-row':''} onClick={()=>selectSensor?.(s)}><div className={`sensor-beacon ${s.status==='Offline'?'offline':''}`}><RadioTower size={17}/></div><div><b>{s.sensor_code}</b><span>{s.farm_name||farmNameMap?.[s.farm_id]||'Farm'} • {s.coverage_m||50}m coverage</span></div><div className="overview-inline-reading"><span>N <b>{number(s.nitrogen,0)}</b></span><span>P <b>{number(s.phosphorus,0)}</b></span><span>K <b>{number(s.potassium,0)}</b></span><span>pH <b>{number(s.ph,2)}</b></span></div><StatusPill value={s.status||'Online'}/>{<button className="icon-danger" onClick={e=>{e.stopPropagation();onDeleteSensor?.(s)}}><Trash2 size={14}/></button>}</article>):<Empty text="No sensors recorded"/>}</div>
        </>}
        {section==='plots'&&<>
          <div className="overview-detail-title"><div><span>SOIL ANALYSIS</span><h4>Sampling Plots</h4></div><small>{plots.length} plots</small></div>
          <div className="overview-record-grid">{plots.length?plots.map(p=><article key={p.id} className={selectedPlotId===p.id?'selected-row':''} onClick={()=>onPlot?.(p)}><div className="plot-icon"><FlaskConical size={18}/></div><div><b>{p.plot_code}</b><span>{p.farm_name||farmNameMap?.[p.farm_id]||'Farm'} • {niceDate(p.analyzed_at)}</span><p>{p.notes||'Laboratory observation area'}</p></div><div className="overview-inline-reading"><span>N <b>{number(p.nitrogen,1)}</b></span><span>P <b>{number(p.phosphorus,1)}</b></span><span>K <b>{number(p.potassium,1)}</b></span><span>pH <b>{number(p.ph,2)}</b></span></div><StatusPill value={p.classification||'Good'}/><button className="icon-danger" onClick={e=>{e.stopPropagation();onDeletePlot?.(p)}}><Trash2 size={14}/></button></article>):<Empty text="No soil analysis plots"/>}</div>
        </>}
        {section==='drone'&&<>
          <div className="overview-detail-title"><div><span>AERIAL COVERAGE</span><h4>Drone Mapping</h4></div><small>{drone.length} mappings</small></div>
          <div className="overview-record-grid">{drone.length?drone.map(d=><article key={d.id} className={selectedDroneId===d.id?'selected-row':''} onClick={()=>onDrone?.(d)}><div className="plot-icon drone"><ScanLine size={18}/></div><div><b>{d.name}</b><span>{d.farm_name||farmNameMap?.[d.farm_id]||'Farm'} • {niceDate(d.captured_at)}</span><p>{Number(d.area_hectares||0).toFixed(2)} ha mapped</p></div><div className="overview-inline-reading"><span>N <b>{number(d.nitrogen,1)}</b></span><span>P <b>{number(d.phosphorus,1)}</b></span><span>K <b>{number(d.potassium,1)}</b></span><span>pH <b>{number(d.ph,2)}</b></span></div><StatusPill value={d.status||d.classification||'Mapped'}/><button className="icon-danger" onClick={e=>{e.stopPropagation();onDeleteDrone?.(d)}}><Trash2 size={14}/></button></article>):<Empty text="No drone mappings"/>}</div>
        </>}
      </div>
    </section>
  </>;
}

function FarmDetail({farm,sensors,plots,drone,requests=[],userMode,overview,admin,toolbar,drawProps,selectedSensorId,selectedPlotId,selectedDroneId,focusTarget,onSensor,onPlot,onDrone,onFocusMap,selectedSensor,selectedPlot,selectedDrone,onSaveSensor,onSaveDrone,onDeleteSensor,onDeletePlot,onDeleteDrone,onDeleteFarmer,busy,mapRevision,preview,fitRequestKey=0,fitBoundaryIndex=0}){
  const [mapSection,setMapSection]=useState('farms');
  const [mapSectionCollapsed,setMapSectionCollapsed]=useState(true);
  const [overviewCollapsed,setOverviewCollapsed]=useState(()=>Boolean(userMode&&overview));
  const [adminStatsCollapsed,setAdminStatsCollapsed]=useState(()=>Boolean(admin&&typeof window!=='undefined'&&window.matchMedia?.('(max-width: 820px)')?.matches));
  useEffect(()=>{if(drawProps.drawMode)setMapSectionCollapsed(true);},[drawProps.drawMode]);
  const mapModeHint=mapSection==='plots'?'analysis':mapSection==='drone'?'drone':'farm';
  const mapSectionControl=<MapSectionCycleControl farms={[farm]} sensors={sensors} plots={plots} drone={drone} section={mapSection} onSectionChange={setMapSection} onFocus={onFocusMap} onDeletePlotSource={admin?onDeletePlot:null} collapsed={mapSectionCollapsed} onCollapsedChange={setMapSectionCollapsed}/>;
  const m={n:avg(sensors,'nitrogen'),p:avg(sensors,'phosphorus'),k:avg(sensors,'potassium'),ph:avg(sensors,'ph'),om:avg(sensors,'organic_matter')};
  const onlineSensors=sensors.filter(s=>s.status!=='Offline');
  const focusSourceOnly=(kind,row,boundaryIndex=0)=>{
    if(!row||!onFocusMap)return;
    const groups=mapSectionTargets({
      farms:kind==='farm'?[row]:[],
      sensors:kind==='sensor'?[row]:[],
      plots:kind==='plot'?[row]:[],
      drone:kind==='drone'?[row]:[],
    });
    const key=kind==='farm'?'farms':kind==='sensor'?'sensors':kind==='plot'?'plots':'drone';
    const list=groups[key]||[];
    const target=kind==='farm'?(list[boundaryIndex]||list[0]):list[0];
    if(target)onFocusMap({...target,focusOnly:true},{sourceOnly:true,section:key,index:Math.max(0,boundaryIndex),total:list.length});
  };
  const sensorSources=(key,digits=1,suffix='')=>sensors.map(s=>({id:s.id,title:s.sensor_code,meta:`Sensor pin • ${coordText(s)}`,value:`${number(s[key],digits)}${suffix}`,onClick:()=>focusSourceOnly('sensor',s),active:selectedSensorId===s.id}));
  const sensorCountSources=sensors.map(s=>({id:s.id,title:s.sensor_code,meta:`${s.status||'Online'} • ${coordText(s)}`,value:`${s.coverage_m||50}m`,onClick:()=>focusSourceOnly('sensor',s),active:selectedSensorId===s.id}));
  const plotSources=plots.map(p=>({id:p.id,title:p.plot_code,meta:`${p.classification||'Pending'} • ${niceDate(p.analyzed_at)}`,value:`pH ${number(p.ph,2)}`,onClick:()=>focusSourceOnly('plot',p),onDelete:admin?()=>onDeletePlot?.(p):undefined,deleteTitle:'Remove this Soil Plot source',active:selectedPlotId===p.id}));
  const droneSources=drone.map(d=>({id:d.id,title:d.name,meta:`${d.classification||d.status||'Mapped'} • ${niceDate(d.captured_at)}`,value:`${number(d.area_hectares,2)} ha`,onClick:()=>focusSourceOnly('drone',d),active:selectedDroneId===d.id}));
  const boundaries=farmBoundaries(farm);
  const visibleBoundaryIndex=boundaries.length?((Number(fitBoundaryIndex||0)%boundaries.length)+boundaries.length)%boundaries.length:0;
  const farmSource=boundaries.map((poly,index)=>({id:`${farm.id}-boundary-${index}`,title:`Farm Boundary ${index+1}`,meta:farm.location_name||'Mapped farm location',value:`${number(polygonStats(poly).area_hectares,2)} ha`,onClick:()=>focusSourceOnly('farm',farm,index)}));
  return <div className={`farm-detail-page ${userMode&&overview?'farmer-map-first':''} ${admin?'admin-map-first':''} ${admin&&adminStatsCollapsed?'admin-stats-collapsed':''}`.trim()}>
    <Header title={userMode?(overview?'My Soil Overview':'My Farm'):farm.farmer_name} subtitle={`${farm.name} • ${farm.location_name || 'Farm location'} • ${boundaries.length} boundar${boundaries.length===1?'y':'ies'}`} action={admin?<button className="danger-btn header-btn" onClick={onDeleteFarmer}><Trash2 size={15}/>Delete farmer</button>:null}/>
    <div className="farm-heading"><div><StatusPill value={farm.status||'Good'}/><span>{number(farm.area_hectares,2)} hectares</span><span>{onlineSensors.length}/{sensors.length} sensors online</span>{!overview&&boundaries.length>1&&<span className="boundary-cycle-badge">Viewing Boundary {visibleBoundaryIndex+1} of {boundaries.length}</span>}{userMode&&<span className="sync-badge"><i/> Live synced</span>}</div></div>
    {admin&&<section className="admin-farm-stats-toggle">
      <button type="button" onClick={()=>setAdminStatsCollapsed(v=>!v)} aria-expanded={!adminStatsCollapsed}>
        <span><small>FARM STATISTICS</small><b>{adminStatsCollapsed?'Show farm statistics':'Hide farm statistics'}</b><em>{sensors.length} sensor${sensors.length===1?'':'s'} • {plots.length} plot${plots.length===1?'':'s'} • {drone.length} drone map${drone.length===1?'':'s'}</em></span>
        <ChevronDown size={17}/>
      </button>
    </section>}
    {userMode&&overview
      ?<section className={`farmer-overview-collapse ${overviewCollapsed?'is-collapsed':''}`}>
        <button type="button" className="farmer-overview-collapse-toggle" onClick={()=>setOverviewCollapsed(v=>!v)} aria-expanded={!overviewCollapsed}>
          <span><small>SOIL SUMMARY</small><b>{overviewCollapsed?'Show full overview':'Hide overview cards'}</b><em>{sensors.length} sensor${sensors.length===1?'':'s'} • {plots.length} plot${plots.length===1?'':'s'} • {drone.length} drone map${drone.length===1?'':'s'}</em></span>
          <ChevronDown size={17}/>
        </button>
        {overviewCollapsed
          ?<div className="farmer-overview-compact">
            <span><small>N</small><b>{number(m.n,0)}</b><em>mg/kg</em></span>
            <span><small>pH</small><b>{number(m.ph,2)}</b></span>
            <span><small>Sensors</small><b>{onlineSensors.length}/{sensors.length}</b></span>
            <span><small>Area</small><b>{number(farm.area_hectares,1)}</b><em>ha</em></span>
          </div>
          :<div className="farmer-overview-expanded">
            <div className="metric-grid five traceable-metric-grid"><TraceableMetric icon={Leaf} label="Nitrogen" value={number(m.n,0)} suffix=" mg/kg" note="Sensor average" sources={sensorSources('nitrogen',1,' mg/kg')}/><TraceableMetric icon={TestTube2} label="Phosphorus" value={number(m.p,0)} suffix=" mg/kg" note="Sensor average" tone="blue" sources={sensorSources('phosphorus',1,' mg/kg')}/><TraceableMetric icon={Gauge} label="Potassium" value={number(m.k,0)} suffix=" mg/kg" note="Sensor average" tone="amber" sources={sensorSources('potassium',1,' mg/kg')}/><TraceableMetric icon={Activity} label="Average pH" value={number(m.ph,2)} note="Sensor average" tone="violet" sources={sensorSources('ph',2,'')}/><TraceableMetric icon={Sprout} label="Organic material" value={number(m.om,1)} suffix="%" note="Sensor average" sources={sensorSources('organic_matter',1,'%')}/></div>
            <div className="farm-source-summary-grid"><TraceableMetric icon={LandPlot} label="Farm area" value={number(farm.area_hectares,2)} suffix=" ha" note="Farm Boundary source" sources={farmSource}/><TraceableMetric icon={RadioTower} label="Active sensors" value={onlineSensors.length} suffix={` / ${sensors.length}`} note="Farmer-owned pins" tone="blue" sources={sensorCountSources}/><TraceableMetric icon={FlaskConical} label="Soil plots" value={plots.length} note="Farmer-owned polygons" tone="amber" sources={plotSources}/><TraceableMetric icon={ScanLine} label="Drone mappings" value={drone.length} note="Farmer-owned survey areas" tone="violet" sources={droneSources}/></div>
          </div>}
      </section>
      :<>
        <div className="metric-grid five traceable-metric-grid"><TraceableMetric icon={Leaf} label="Nitrogen" value={number(m.n,0)} suffix=" mg/kg" note="Sensor average" sources={sensorSources('nitrogen',1,' mg/kg')}/><TraceableMetric icon={TestTube2} label="Phosphorus" value={number(m.p,0)} suffix=" mg/kg" note="Sensor average" tone="blue" sources={sensorSources('phosphorus',1,' mg/kg')}/><TraceableMetric icon={Gauge} label="Potassium" value={number(m.k,0)} suffix=" mg/kg" note="Sensor average" tone="amber" sources={sensorSources('potassium',1,' mg/kg')}/><TraceableMetric icon={Activity} label="Average pH" value={number(m.ph,2)} note="Sensor average" tone="violet" sources={sensorSources('ph',2,'')}/><TraceableMetric icon={Sprout} label="Organic material" value={number(m.om,1)} suffix="%" note="Sensor average" sources={sensorSources('organic_matter',1,'%')}/></div>
        <div className="farm-source-summary-grid"><TraceableMetric icon={LandPlot} label="Farm area" value={number(farm.area_hectares,2)} suffix=" ha" note="Farm Boundary source" sources={farmSource}/><TraceableMetric icon={RadioTower} label="Active sensors" value={onlineSensors.length} suffix={` / ${sensors.length}`} note="Farmer-owned pins" tone="blue" sources={sensorCountSources}/><TraceableMetric icon={FlaskConical} label="Soil plots" value={plots.length} note="Farmer-owned polygons" tone="amber" sources={plotSources}/><TraceableMetric icon={ScanLine} label="Drone mappings" value={drone.length} note="Farmer-owned survey areas" tone="violet" sources={droneSources}/></div>
      </>}
    <div className="map-with-inspector unified-map-preview-layout">
      <MapWorkspace overlayScope={overview?'overview':`farm-${farm.id}`} farms={[farm]} sensors={sensors} plots={plots} droneMappings={drone} requests={requests} activeFarmId={farm.id} admin={admin} height={overview?500:610} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSensorClick={onSensor} onPlotClick={onPlot} onDroneClick={onDrone} onDroneDelete={onDeleteDrone} drawMode={drawProps.drawMode} drawPoints={drawProps.drawPoints} onMapPoint={drawProps.onMapPoint} drawOrientation={drawProps.drawOrientation} onDrawOrientation={drawProps.onDrawOrientation} toolbar={toolbar} sectionControl={mapSectionControl} modeHint={mapModeHint} showMapPopups={false} preview={preview} fitRequestKey={fitRequestKey} fitBoundaryIndex={fitBoundaryIndex} dataRevision={mapRevision}/>
    </div>
    <div className="dashboard-grid equal"><SensorList sensors={sensors} onSelect={onSensor} selectedId={selectedSensorId} admin={admin} onDelete={onDeleteSensor}/><PlotAndDroneList plots={plots} drone={drone} admin={admin} onPlot={onPlot} onDrone={onDrone} onDeletePlot={onDeletePlot} onDeleteDrone={onDeleteDrone}/></div>
  </div>;
}

function SensorPage({admin,farms,sensors,plots,drone,activeFarmId,selectedSensor,selectedPlot,selectedDrone,selectedSensorId,selectedPlotId,selectedDroneId,focusTarget,onLocate,onSelect,onPlot,onDrone,onFocusMap,onSave,onDelete,onSaveDrone,onDeleteDrone,busy,mapRevision,preview}){
  const mapFarms=admin?farms:farms.slice(0,1);
  const [mapSection,setMapSection]=useState('sensors');
  const [mapSectionCollapsed,setMapSectionCollapsed]=useState(true);
  const mapModeHint=mapSection==='plots'?'analysis':mapSection==='drone'?'drone':'farm';
  const mapSectionControl=<MapSectionCycleControl farms={mapFarms} sensors={sensors} plots={plots} drone={drone} section={mapSection} onSectionChange={setMapSection} onFocus={onFocusMap} collapsed={mapSectionCollapsed} onCollapsedChange={setMapSectionCollapsed}/>;
  const farmName=selectedSensor?.farm_name || mapFarms.find(f=>f.id===(selectedSensor?.farm_id||selectedPlot?.farm_id||selectedDrone?.farm_id||activeFarmId))?.name || mapFarms[0]?.name;
  return <>
    <Header title={admin?'Sensor Network':'My Sensors'} subtitle={admin?'Choose a sensor from the list to move the map to it. Click the sensor pin on the map only when you want to open its preview/edit controls.':'Choose a sensor from the list to move the map to it. Click the actual map pin to open its read-only preview.'}/>
    <div className="sensor-page-grid sensor-page-right-rail">
      <div className="sensor-map-stack">
        <MapWorkspace overlayScope="sensors" farms={mapFarms} sensors={sensors} plots={plots} droneMappings={drone} activeFarmId={selectedSensor?.farm_id||selectedPlot?.farm_id||selectedDrone?.farm_id||activeFarmId} height={520} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSensorClick={onSelect} onPlotClick={onPlot} onDroneClick={onDrone} sectionControl={mapSectionControl} modeHint={mapModeHint} showMapPopups={false} preview={preview} dataRevision={mapRevision}/>
      </div>
      <section className="panel sensor-directory sensor-directory-right"><div className="panel-title"><div><span>FIELD DEVICES</span><h3>{admin?'All Sensors':'Farm Sensors'}</h3></div><small>{sensors.length} sensors</small></div><div className="sensor-cards">{sensors.length?sensors.map(s=><button key={s.id} className={selectedSensorId===s.id?'active':''} onClick={()=>onLocate?.(s)}><div className="sensor-beacon"><RadioTower size={16}/></div><div><b>{s.sensor_code}</b><span>{admin?s.farm_name:`${s.coverage_m||50}m coverage`}</span></div><StatusPill value={s.status||'Online'}/></button>):<Empty text="No sensors"/>}</div></section>
    </div>
  </>;
}

function SensorList({sensors,onSelect,selectedId,admin,onDelete}){return <section className="panel"><div className="panel-title"><div><span>FIELD DEVICES</span><h3>Sensor Stations</h3></div><small>{sensors.length} stations</small></div><div className="sensor-list">{sensors.length?sensors.map(s=><article key={s.id} className={selectedId===s.id?'selected-row':''} onClick={()=>onSelect?.(s)}><div className={`sensor-beacon ${s.status==='Offline'?'offline':''}`}><RadioTower size={17}/></div><div className="sensor-name"><b>{s.sensor_code}</b><span>{s.coverage_m||50}m coverage square</span></div><div className="mini-reading"><span>N<b>{number(s.nitrogen,0)}</b></span><span>P<b>{number(s.phosphorus,0)}</b></span><span>K<b>{number(s.potassium,0)}</b></span><span>pH<b>{number(s.ph,2)}</b></span><span>OM<b>{number(s.organic_matter,1)}%</b></span></div><StatusPill value={s.status||'Online'}/>{admin&&<button className="icon-danger" onClick={e=>{e.stopPropagation();onDelete?.(s)}}><Trash2 size={14}/></button>}</article>):<Empty text="No sensors recorded"/>}</div></section>}
function PlotAndDroneList({plots,drone,admin,onPlot,onDrone,onDeletePlot,onDeleteDrone}){return <section className="panel"><div className="panel-title"><div><span>SPATIAL RECORDS</span><h3>Plots & Drone Mapping</h3></div><small>{plots.length+drone.length} areas</small></div><div className="plot-list">{plots.map(p=><article key={p.id} onClick={()=>onPlot?.(p)}><div className="plot-icon"><FlaskConical size={18}/></div><div><b>{p.plot_code}</b><span>Soil analysis • {niceDate(p.analyzed_at)}</span><p>{p.notes||'Laboratory observation area'}</p></div><StatusPill value={p.classification||'Good'}/>{admin&&<button className="icon-danger" onClick={e=>{e.stopPropagation();onDeletePlot?.(p)}}><Trash2 size={14}/></button>}</article>)}{drone.map(d=><article key={d.id} onClick={()=>onDrone?.(d)}><div className="plot-icon drone"><ScanLine size={18}/></div><div><b>{d.name}</b><span>Drone mapping • {niceDate(d.captured_at)}</span><p>{d.image_url?'Imagery reference attached':'Mapped flight/survey footprint'}</p></div><StatusPill value={d.status||'Mapped'}/>{admin&&<button className="icon-danger" onClick={e=>{e.stopPropagation();onDeleteDrone?.(d)}}><Trash2 size={14}/></button>}</article>)}{!plots.length&&!drone.length&&<Empty text="No plots or drone mappings"/>}</div></section>}

function Statistics({farms,sensors,plots,drone=[],activeFarmId,onSensor,onPlot,onDrone,onFocusMap,selectedSensorId,selectedPlotId,selectedDroneId,focusTarget,preview,mapRevision=0}){
  const [farmId,setFarmId]=useState(activeFarmId||farms[0]?.id||'');
  const [section,setSection]=useState('nitrogen');
  useEffect(()=>{
    if(activeFarmId&&farms.some(f=>f.id===activeFarmId))setFarmId(activeFarmId);
    else if(!farms.some(f=>f.id===farmId))setFarmId(farms[0]?.id||'');
  },[activeFarmId,farms.map(f=>f.id).join('|')]);
  const farm=farms.find(f=>f.id===farmId)||farms[0];
  const farmSensors=sensors.filter(s=>s.farm_id===farm?.id);
  const farmPlots=plots.filter(p=>p.farm_id===farm?.id);
  const farmDrone=drone.filter(d=>d.farm_id===farm?.id);
  const online=farmSensors.filter(s=>s.status!=='Offline').length;
  const focusStatisticSource=(kind,row,boundaryIndex=0)=>{
    if(!row||!onFocusMap)return;
    const groups=mapSectionTargets({
      farms:kind==='farm'?[row]:[],
      sensors:kind==='sensor'?[row]:[],
      plots:kind==='plot'?[row]:[],
      drone:kind==='drone'?[row]:[],
    });
    const key=kind==='farm'?'farms':kind==='sensor'?'sensors':kind==='plot'?'plots':'drone';
    const list=groups[key]||[];
    const target=kind==='farm'?(list[boundaryIndex]||list[0]):list[0];
    if(target)onFocusMap({...target,focusOnly:true},{sourceOnly:true,section:key,index:Math.max(0,boundaryIndex),total:list.length});
  };
  const selector=<label className="farm-stat-select"><span>Farm data</span><select value={farm?.id||''} onChange={e=>{setFarmId(e.target.value);setSection('nitrogen')}}>{farms.map(f=><option key={f.id} value={f.id}>{f.farmer_name} • {f.name}</option>)}</select></label>;
  if(!farm)return <><Header title="Farm Statistics" subtitle="Choose a farm to inspect its soil data."/><Empty text="No farms available"/></>;

  const nutrientMeta={
    nitrogen:{label:'Nitrogen',key:'nitrogen',digits:1,suffix:' mg/kg',icon:Leaf,tone:'green'},
    phosphorus:{label:'Phosphorus',key:'phosphorus',digits:1,suffix:' mg/kg',icon:TestTube2,tone:'blue'},
    potassium:{label:'Potassium',key:'potassium',digits:1,suffix:' mg/kg',icon:Gauge,tone:'amber'},
    ph:{label:'Average pH',key:'ph',digits:2,suffix:'',icon:Activity,tone:'violet'},
    organic:{label:'Organic material',key:'organic_matter',digits:1,suffix:'%',icon:Sprout,tone:'green'},
  };
  const activeNutrient=nutrientMeta[section];
  const modeHint=section==='plots'?'analysis':section==='drone'?'drone':'farm';

  const detailTitle=activeNutrient?`${activeNutrient.label} by sensor`:section==='sensors'?'Active sensor pins':section==='plots'?'Soil-analysis plot pins':section==='drone'?'Drone mapping areas':section==='area'?'Farm boundary':section==='status'?'Farm mapping status':'Statistics detail';
  const detailCopy=activeNutrient?'Each row is the exact Sensor pin contributing to this farm average. Click one to focus it on the map.':section==='sensors'?'Click a Sensor to focus its exact GPS pin and open its published readings.':section==='plots'?'Click a Soil Plot to focus the polygon that owns these analysis values.':section==='drone'?'Click a Drone Mapping record to focus its survey polygon and soil observations.':section==='area'?'This value comes from the mapped Farm Boundary polygon shown on the map.':'This status belongs to the selected farm boundary.';

  const nutrientSourceItems=(metricId,key,digits,suffix='')=>farmSensors.map(s=>({id:s.id,title:s.sensor_code,meta:`Sensor pin • ${coordText(s)}`,value:`${number(s[key],digits)}${suffix}`,active:selectedSensorId===s.id,onClick:()=>{setSection(metricId);focusStatisticSource('sensor',s)}}));
  const activeSensorSources=farmSensors.map(s=>({id:s.id,title:s.sensor_code,meta:`${s.status||'Online'} • ${coordText(s)}`,value:`${s.coverage_m||50}m`,active:selectedSensorId===s.id,onClick:()=>{setSection('sensors');focusStatisticSource('sensor',s)}}));
  const plotSourceItems=farmPlots.map(p=>({id:p.id,title:p.plot_code,meta:`${p.classification||'Pending'} • ${niceDate(p.analyzed_at)}`,value:`pH ${number(p.ph,2)}`,active:selectedPlotId===p.id,onClick:()=>{setSection('plots');focusStatisticSource('plot',p)}}));
  const droneSourceItems=farmDrone.map(d=>({id:d.id,title:d.name,meta:`${d.classification||d.status||'Mapped'} • ${niceDate(d.captured_at)}`,value:`${number(d.area_hectares,2)} ha`,active:selectedDroneId===d.id,onClick:()=>{setSection('drone');focusStatisticSource('drone',d)}}));
  const boundarySource=farmBoundaries(farm).map((poly,index)=>({id:`${farm.id}-boundary-${index}`,title:`Farm Boundary ${index+1}`,meta:farm.location_name||'Mapped farm location',value:`${number(polygonStats(poly).area_hectares,2)} ha`,onClick:()=>{setSection('area');focusStatisticSource('farm',farm,index)}}));
  const statusSource=[{id:`${farm.id}-status`,title:farm.status||'Unmapped',meta:`${farm.name} • Farm Boundary status`,value:'Farm',onClick:()=>{setSection('status');focusStatisticSource('farm',farm,0)}}];

  return <>
    <Header title="Farm Statistics" subtitle={`${farm.farmer_name} • ${farm.name}. Click any statistic to see exactly which map record supplies it.`} action={selector}/>
    <div className="metric-grid five statistics-selector-grid traceable-metric-grid">
      <TraceableMetric icon={Leaf} label="Nitrogen" value={number(avg(farmSensors,'nitrogen'),1)} suffix=" mg/kg" note={`${farmSensors.length} farm sensors`} active={section==='nitrogen'} onActivate={()=>setSection('nitrogen')} sources={nutrientSourceItems('nitrogen','nitrogen',1,' mg/kg')}/>
      <TraceableMetric icon={TestTube2} label="Phosphorus" value={number(avg(farmSensors,'phosphorus'),1)} suffix=" mg/kg" note="Farm average" tone="blue" active={section==='phosphorus'} onActivate={()=>setSection('phosphorus')} sources={nutrientSourceItems('phosphorus','phosphorus',1,' mg/kg')}/>
      <TraceableMetric icon={Gauge} label="Potassium" value={number(avg(farmSensors,'potassium'),1)} suffix=" mg/kg" note="Farm average" tone="amber" active={section==='potassium'} onActivate={()=>setSection('potassium')} sources={nutrientSourceItems('potassium','potassium',1,' mg/kg')}/>
      <TraceableMetric icon={Activity} label="Average pH" value={number(avg(farmSensors,'ph'),2)} note="Farm sensors only" tone="violet" active={section==='ph'} onActivate={()=>setSection('ph')} sources={nutrientSourceItems('ph','ph',2,'')}/>
      <TraceableMetric icon={Sprout} label="Organic material" value={number(avg(farmSensors,'organic_matter'),1)} suffix="%" note="Farm average" active={section==='organic'} onActivate={()=>setSection('organic')} sources={nutrientSourceItems('organic','organic_matter',1,'%')}/>
    </div>
    <div className="metric-grid five farm-stat-summary statistics-selector-grid traceable-metric-grid">
      <TraceableMetric icon={LandPlot} label="Farm area" value={number(farm.area_hectares,2)} suffix=" ha" note={farm.location_name||'Mapped farm'} active={section==='area'} onActivate={()=>setSection('area')} sources={boundarySource}/>
      <TraceableMetric icon={RadioTower} label="Active sensors" value={online} suffix={` / ${farmSensors.length}`} note="This farm only" tone="blue" active={section==='sensors'} onActivate={()=>setSection('sensors')} sources={activeSensorSources}/>
      <TraceableMetric icon={FlaskConical} label="Soil analysis plots" value={farmPlots.length} note="This farm only" tone="amber" active={section==='plots'} onActivate={()=>setSection('plots')} sources={plotSourceItems}/>
      <TraceableMetric icon={ScanLine} label="Drone mappings" value={farmDrone.length} note="Mapped drone observation areas" tone="violet" active={section==='drone'} onActivate={()=>setSection('drone')} sources={droneSourceItems}/>
      <TraceableMetric icon={MapPin} label="Farm status" value={farm.status||'Unmapped'} note="Current mapped status" active={section==='status'} onActivate={()=>setSection('status')} sources={statusSource}/>
    </div>

    <section className="panel statistics-drilldown-panel">
      <div className="overview-detail-title"><div><span>STATISTIC SOURCE</span><h4>{detailTitle}</h4><p>{detailCopy}</p></div><small>{activeNutrient||section==='sensors'?`${farmSensors.length} sensors`:section==='plots'?`${farmPlots.length} plots`:section==='drone'?`${farmDrone.length} mappings`:'1 farm'}</small></div>
      <div className="statistics-map-grid">
        <MapWorkspace overlayScope="statistics" farms={[farm]} sensors={farmSensors} plots={farmPlots} droneMappings={farmDrone} activeFarmId={farm.id} embedded modeHint={modeHint} height={500} selectedSensorId={selectedSensorId} selectedPlotId={selectedPlotId} selectedDroneId={selectedDroneId} focusTarget={focusTarget} onSensorClick={onSensor} onPlotClick={onPlot} onDroneClick={onDrone} showMapPopups={false} preview={preview} dataRevision={mapRevision}/>
        <div className="statistics-source-list section-transition-in" key={`${farm.id}-${section}`}>
          {activeNutrient && (farmSensors.length?farmSensors.map(s=><button type="button" key={s.id} className={selectedSensorId===s.id?'active':''} onClick={()=>focusStatisticSource('sensor',s)}><div><b>{s.sensor_code}</b><span>Sensor pin • {Number(s.latitude).toFixed(6)}, {Number(s.longitude).toFixed(6)}</span></div><strong>{number(s[activeNutrient.key],activeNutrient.digits)}{activeNutrient.suffix}</strong></button>):<Empty text="No sensor pins contribute to this statistic"/>)}
          {section==='sensors' && (farmSensors.length?farmSensors.map(s=><button type="button" key={s.id} className={selectedSensorId===s.id?'active':''} onClick={()=>focusStatisticSource('sensor',s)}><div><b>{s.sensor_code}</b><span>{s.status||'Online'} • {Number(s.latitude).toFixed(6)}, {Number(s.longitude).toFixed(6)}</span></div><strong>{s.coverage_m||50}m</strong></button>):<Empty text="No sensors on this farm"/>)}
          {section==='plots' && (farmPlots.length?farmPlots.map(p=><button type="button" key={p.id} className={selectedPlotId===p.id?'active':''} onClick={()=>focusStatisticSource('plot',p)}><div><b>{p.plot_code}</b><span>{p.classification||'Pending'} • {niceDate(p.analyzed_at)}</span></div><strong>pH {number(p.ph,2)}</strong></button>):<Empty text="No soil-analysis plots on this farm"/>)}
          {section==='drone' && (farmDrone.length?farmDrone.map(d=><button type="button" key={d.id} className={selectedDroneId===d.id?'active':''} onClick={()=>focusStatisticSource('drone',d)}><div><b>{d.name}</b><span>{d.classification||d.status||'Mapped'} • {niceDate(d.captured_at)}</span></div><strong>{number(d.area_hectares,2)} ha</strong></button>):<Empty text="No drone mapping data on this farm"/>)}
          {section==='area' && <div className="statistics-farm-source"><LandPlot size={22}/><div><b>{farm.name}</b><span>{farm.location_name||'Mapped farm location'}</span><p>{number(farm.area_hectares,2)} hectares calculated from the Farm Boundary.</p></div></div>}
          {section==='status' && <div className="statistics-farm-source"><MapPin size={22}/><div><b>{farm.status||'Unmapped'}</b><span>{farm.name}</span><p>The status belongs to this farm boundary and its current mapping state.</p></div></div>}
        </div>
      </div>
    </section>

    <div className="dashboard-grid equal">
      <Suspense fallback={<ChartFallback/>}><LazyNutrientBars sensors={farmSensors}/></Suspense>
      <section className="panel">
        <div className="panel-title"><div><span>FARM SENSOR DATA</span><h3>Sensor-by-Sensor Readings</h3></div><small>{farmSensors.length} sensors</small></div>
        <div className="farm-stat-table clickable-stat-table">
          {farmSensors.length?farmSensors.map(s=><article key={s.id} className={selectedSensorId===s.id?'selected-row':''} onClick={()=>focusStatisticSource('sensor',s)}><div><b>{s.sensor_code}</b><span>{s.status||'Online'} • {s.coverage_m||50}m coverage</span></div><div className="farm-stat-values"><span>N<b>{number(s.nitrogen,1)}</b></span><span>P<b>{number(s.phosphorus,1)}</b></span><span>K<b>{number(s.potassium,1)}</b></span><span>pH<b>{number(s.ph,2)}</b></span><span>OM<b>{number(s.organic_matter,1)}%</b></span></div></article>):<Empty text="No sensors on this farm" sub="Add a sensor to begin farm-specific statistics."/>}
        </div>
      </section>
    </div>
    <div className="dashboard-grid equal farm-spatial-stat-grid">
      <section className="panel farm-plot-stat-panel">
        <div className="panel-title"><div><span>SOIL ANALYSIS</span><h3>Plots for {farm.name}</h3></div><small>{farmPlots.length} plots</small></div>
        <div className="farm-stat-table clickable-stat-table">
          {farmPlots.length?farmPlots.map(p=><article key={p.id} className={selectedPlotId===p.id?'selected-row':''} onClick={()=>onPlot?.(p)}><div><b>{p.plot_code}</b><span>{niceDate(p.analyzed_at)} • {p.classification||'Pending'}</span></div><div className="farm-stat-values"><span>N<b>{number(p.nitrogen,1)}</b></span><span>P<b>{number(p.phosphorus,1)}</b></span><span>K<b>{number(p.potassium,1)}</b></span><span>pH<b>{number(p.ph,2)}</b></span><span>OM<b>{number(p.organic_matter,1)}%</b></span></div></article>):<Empty text="No soil-analysis plots on this farm"/>}
        </div>
      </section>
      <section className="panel farm-drone-stat-panel">
        <div className="panel-title"><div><span>DRONE MAPPING</span><h3>Drone observations for {farm.name}</h3></div><small>{farmDrone.length} mappings</small></div>
        <div className="farm-stat-table clickable-stat-table">
          {farmDrone.length?farmDrone.map(d=><article key={d.id} className={selectedDroneId===d.id?'selected-row':''} onClick={()=>onDrone?.(d)}><div><b>{d.name}</b><span>{niceDate(d.captured_at)} • {d.classification||d.status||'Mapped'} • {number(d.area_hectares,2)} ha</span></div><div className="farm-stat-values"><span>N<b>{number(d.nitrogen,1)}</b></span><span>P<b>{number(d.phosphorus,1)}</b></span><span>K<b>{number(d.potassium,1)}</b></span><span>pH<b>{number(d.ph,2)}</b></span><span>OM<b>{number(d.organic_matter,1)}%</b></span></div></article>):<Empty text="No drone mapping data on this farm" sub="Draw a Drone Mapping area and enter its soil observation values."/>}
        </div>
      </section>
    </div>
  </>;
}
function AnalysisPage({farm,sensors,plots,onSensor,onPlot,selectedSensorId,selectedPlotId}){
  const source=(key,digits=1,suffix='')=>sensors.map(s=>({id:s.id,title:s.sensor_code,meta:`Sensor pin • ${coordText(s)}`,value:`${number(s[key],digits)}${suffix}`,active:selectedSensorId===s.id,onClick:()=>onSensor?.(s)}));
  const plotSources=plots.map(p=>({id:p.id,title:p.plot_code,meta:`${p.classification||'Pending'} • ${niceDate(p.analyzed_at)}`,value:`pH ${number(p.ph,2)}`,active:selectedPlotId===p.id,onClick:()=>onPlot?.(p)}));
  return <><Header title="Soil Analysis" subtitle={`${farm?.name||'My Farm'} • every average can be traced back to its Sensor pins.`}/><div className="metric-grid five traceable-metric-grid"><TraceableMetric icon={Leaf} label="Nitrogen" value={number(avg(sensors,'nitrogen'),0)} suffix=" mg/kg" note="Sensor average" sources={source('nitrogen',1,' mg/kg')}/><TraceableMetric icon={TestTube2} label="Phosphorus" value={number(avg(sensors,'phosphorus'),0)} suffix=" mg/kg" note="Sensor average" tone="blue" sources={source('phosphorus',1,' mg/kg')}/><TraceableMetric icon={Gauge} label="Potassium" value={number(avg(sensors,'potassium'),0)} suffix=" mg/kg" note="Sensor average" tone="amber" sources={source('potassium',1,' mg/kg')}/><TraceableMetric icon={Activity} label="pH" value={number(avg(sensors,'ph'),2)} note="Sensor average" tone="violet" sources={source('ph',2,'')}/><TraceableMetric icon={Sprout} label="Organic material" value={number(avg(sensors,'organic_matter'),1)} suffix="%" note="Sensor average" sources={source('organic_matter',1,'%')}/></div><div className="dashboard-grid equal"><Suspense fallback={<ChartFallback/>}><LazyNutrientBars sensors={sensors}/></Suspense><section className="panel"><div className="panel-title"><div><span>LABORATORY</span><h3>Soil Analysis Plots</h3></div><SourceDropdown title="View plot sources" items={plotSources}/></div><div className="plot-list">{plots.map(p=><article key={p.id} className={selectedPlotId===p.id?'selected-row':''} onClick={()=>onPlot?.(p)}><div className="plot-icon"><FlaskConical size={18}/></div><div><b>{p.plot_code}</b><span>{niceDate(p.analyzed_at)}</span><p>{p.notes||'Soil analysis record'}</p></div><StatusPill value={p.classification||'Good'}/></article>)}</div></section></div><Suspense fallback={<ChartFallback/>}><LazyTrendChart/></Suspense></>}

function SpatialRequestModal({type,points=[],orientation=0,onClose,onSave,busy}){
  const label=type==='sensor'?'Sensor':type==='plot'?'Soil Analysis Plot':'Drone Mapping';
  const stats=points.length?polygonStats(points):null;
  const [form,setForm]=useState({title:`${label} request`,notes:'',coverage_m:50});
  const set=(key,value)=>setForm(current=>({...current,[key]:value}));
  const submit=async(event)=>{event.preventDefault();await onSave?.(form);};
  return <Modal kicker="FARMER REQUEST" title={`Request ${label}`} subtitle="This placement will be sent to the administrator for verification. It will not become a real map record until approved." onClose={onClose}>
    <form className="modal-form spatial-request-form" onSubmit={submit}>
      <div className="request-location-summary"><MapPin size={17}/><div><b>{type==='sensor'?'Requested GPS position':'Requested mapped area'}</b><span>{stats?`${Number(stats.center_lat).toFixed(7)}, ${Number(stats.center_lng).toFixed(7)}`:'Coordinates captured on the map'}</span>{type!=='sensor'&&stats&&<small>{points.length} polygon points • approx. {number(stats.area_hectares,3)} ha</small>}</div></div>
      <div className="form-grid two"><label className="full">Request label<input required value={form.title} onChange={e=>set('title',e.target.value)} maxLength={128}/></label>{type==='sensor'&&<label>Requested coverage (meters)<input type="number" min="1" value={form.coverage_m} onChange={e=>set('coverage_m',e.target.value)}/></label>}<label className="full">Reason / notes<textarea rows="4" value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Tell the administrator why you want this location mapped or monitored."/></label></div>
      <div className="request-approval-note"><span>ADMIN APPROVAL REQUIRED</span><p>The request will appear as a clickable item in Support Inbox. The administrator can jump directly to this exact location and approve or reject it.</p></div>
      <ModalActions busy={busy} onClose={onClose} label="Send for approval"/>
    </form>
  </Modal>;
}

function SpatialRequestReviewCard({request,busy,error='',onApprove,onReject,onClose}){
  const type=request.request_type==='sensor'?'Sensor':request.request_type==='plot'?'Soil Plot':'Drone Mapping';
  const status=String(request.status||'pending').toLowerCase();
  const reviewing=busy&&['approving','rejecting'].includes(status);
  const lat=Number(request.latitude??request.center_lat),lng=Number(request.longitude??request.center_lng);
  return <aside className={`spatial-request-review-card status-${status}`}>
    <div className="request-review-head"><div><span>FARMER MAP REQUEST</span><b>{request.title||`${type} request`}</b></div><button type="button" onClick={onClose} aria-label="Close request review"><XCircle size={17}/></button></div>
    <div className="request-review-meta"><span>{type}</span><span>{Number.isFinite(lat)&&Number.isFinite(lng)?`${lat.toFixed(6)}, ${lng.toFixed(6)}`:'Mapped request area'}</span><strong>{status}</strong></div>
    {request.notes&&<p>{request.notes}</p>}
    {error&&<div className="request-review-error"><XCircle size={14}/><span>{error}</span></div>}
    {(status==='pending'||reviewing)?<div className="request-review-actions"><button type="button" className="request-reject-btn" disabled={busy} onClick={onReject}><XCircle size={15}/>{busy&&status==='rejecting'?'Rejecting…':'Reject'}</button><button type="button" className="primary-btn" disabled={busy} onClick={onApprove}><Check size={15}/>{busy&&status==='approving'?'Approving…':'Approve request'}</button></div>:<div className="request-reviewed-state"><Check size={15}/><span>This request is {status}. The decision was sent back to the Farmer.</span></div>}
  </aside>;
}

function BoundaryDeleteModal({farm,onClose,onDelete,busy}){
  const boundaries=farmBoundaries(farm);
  const [selected,setSelected]=useState(0);
  useEffect(()=>{if(selected>=boundaries.length)setSelected(Math.max(0,boundaries.length-1));},[boundaries.length,selected]);
  const target=boundaries[selected];
  const targetStats=target?.length?polygonStats(target):null;
  return <Modal title="Delete Farm Boundary" subtitle={`Choose exactly which mapped boundary to remove from ${farm.name}. Other boundaries stay untouched.`} onClose={onClose} className="boundary-delete-modal">
    <div className="boundary-delete-list">{boundaries.map((poly,index)=>{const stats=polygonStats(poly);return <button type="button" key={`${polygonSignature(poly)}-${index}`} className={selected===index?'active':''} onClick={()=>setSelected(index)}><span className="boundary-delete-number">{index+1}</span><div><b>Farm Boundary {index+1}</b><span>{number(stats.area_hectares,3)} ha • {stats.center_lat.toFixed(6)}, {stats.center_lng.toFixed(6)}</span><small>{poly.length} mapped points</small></div><i aria-hidden="true"/></button>})}</div>
    {targetStats&&<div className="boundary-delete-warning"><Trash2 size={16}/><div><b>Selected: Farm Boundary {selected+1}</b><span>{number(targetStats.area_hectares,3)} ha will be removed. {Math.max(0,boundaries.length-1)} other boundar{boundaries.length-1===1?'y':'ies'} will remain.</span></div></div>}
    <div className="modal-actions"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="danger-btn" disabled={busy||!target} onClick={()=>onDelete?.(selected)}><Trash2 size={14}/>{busy?'Deleting…':`Delete Boundary ${selected+1}`}</button></div>
  </Modal>;
}

function FarmerModal({onClose,onSave,busy}){const [f,setF]=useState({name:'',email:'',password:'',farm_name:'',location_name:'',center_lat:'10.4247',center_lng:'122.9225'});const set=(k,v)=>setF(x=>({...x,[k]:v}));return <Modal title="Add Farmer" subtitle="Creates a real Appwrite farmer login and an empty farm workspace." onClose={onClose}><form className="modal-form" onSubmit={e=>{e.preventDefault();onSave(f)}}><div className="form-grid two"><label>Farmer name<input required value={f.name} onChange={e=>set('name',e.target.value)}/></label><label>Email<input type="email" required value={f.email} onChange={e=>set('email',e.target.value)}/></label><label>Password<input type="password" minLength="8" required value={f.password} onChange={e=>set('password',e.target.value)}/></label><label>Farm name<input required value={f.farm_name} onChange={e=>set('farm_name',e.target.value)}/></label><label className="full">Location / barangay<input value={f.location_name} onChange={e=>set('location_name',e.target.value)}/></label><label>Map center latitude<input type="number" step="0.000001" value={f.center_lat} onChange={e=>set('center_lat',e.target.value)}/></label><label>Map center longitude<input type="number" step="0.000001" value={f.center_lng} onChange={e=>set('center_lng',e.target.value)}/></label></div><ModalActions busy={busy} onClose={onClose} label="Create farmer"/></form></Modal>}
function SensorCreateModal({point,orientation=0,defaultName='Sensor 1',onClose,onSave,busy}){
  const [f,setF]=useState({sensor_code:defaultName,latitude:String(point?.[0]??''),longitude:String(point?.[1]??''),coverage_m:50,orientation_deg:cleanAngle(orientation),status:'Online',nitrogen:'',phosphorus:'',potassium:'',organic_matter:'',ph:'',moisture:''});
  const [submitting,setSubmitting]=useState(false);
  const submitLock=useRef(false);
  const set=(k,v)=>setF(x=>({...x,[k]:v}));
  useEffect(()=>{if(point?.length>=2)setF(x=>({...x,latitude:String(Number(point[0]).toFixed(7)),longitude:String(Number(point[1]).toFixed(7))}));},[point?.[0],point?.[1]]);
  const pastePair=(event)=>{const matches=(event.clipboardData?.getData('text')||'').replace(/[−–—]/g,'-').match(/[-+]?\d{1,3}(?:\.\d+)?/g);if(!matches||matches.length<2)return;const latitude=Number(matches[0]),longitude=Number(matches[1]);if(!Number.isFinite(latitude)||latitude<-90||latitude>90||!Number.isFinite(longitude)||longitude<-180||longitude>180)return;event.preventDefault();setF(x=>({...x,latitude:latitude.toFixed(7),longitude:longitude.toFixed(7)}));};
  const submit=async(e)=>{e.preventDefault();if(submitLock.current||busy)return;submitLock.current=true;setSubmitting(true);try{await onSave({...f,latitude:Number(f.latitude),longitude:Number(f.longitude),orientation_deg:cleanAngle(orientation)});}finally{submitLock.current=false;setSubmitting(false);}};
  return <Modal title="Add Sensor" subtitle="Use the map placement or enter the exact GPS latitude and longitude below. Paste a copied coordinate pair into either GPS field to fill both automatically." onClose={onClose} wide className="fixed-editor-modal sensor-create-modal">
    <form className="modal-form" onSubmit={submit}>
      <div className="editor-two-column">
        <section><h4>Station & GPS placement</h4><div className="form-grid two">
          <label>Sensor name<input required value={f.sensor_code} onChange={e=>set('sensor_code',e.target.value)}/></label>
          <label>Status<select value={f.status} onChange={e=>set('status',e.target.value)}><option>Online</option><option>Offline</option><option>Maintenance</option></select></label>
          <label>GPS latitude<input required type="number" step="0.0000001" min="-90" max="90" value={f.latitude} onPaste={pastePair} onChange={e=>set('latitude',e.target.value)}/></label>
          <label>GPS longitude<input required type="number" step="0.0000001" min="-180" max="180" value={f.longitude} onPaste={pastePair} onChange={e=>set('longitude',e.target.value)}/></label>
          <label>Coverage square (meters)<input type="number" min="1" value={f.coverage_m} onChange={e=>set('coverage_m',e.target.value)}/></label>
        </div><div className="placement-rotation-summary"><span>Coverage rotation</span><strong>{cleanAngle(orientation).toFixed(0)}°</strong><small>Set on the satellite map by dragging the ROTATE handle around the sensor.</small></div></section>
        <section><h4>Initial soil readings</h4><div className="form-grid two">
          <label>Nitrogen (mg/kg)<input type="number" step="0.01" value={f.nitrogen} onChange={e=>set('nitrogen',e.target.value)}/></label>
          <label>Phosphorus (mg/kg)<input type="number" step="0.01" value={f.phosphorus} onChange={e=>set('phosphorus',e.target.value)}/></label>
          <label>Potassium (mg/kg)<input type="number" step="0.01" value={f.potassium} onChange={e=>set('potassium',e.target.value)}/></label>
          <label>Organic material (%)<input type="number" step="0.01" value={f.organic_matter} onChange={e=>set('organic_matter',e.target.value)}/></label>
          <label>pH<input type="number" step="0.01" value={f.ph} onChange={e=>set('ph',e.target.value)}/></label>
          <label>Moisture (%)<input type="number" step="0.01" value={f.moisture} onChange={e=>set('moisture',e.target.value)}/></label>
        </div></section>
      </div>
      <ModalActions busy={busy||submitting} onClose={onClose} label="Add sensor"/>
    </form>
  </Modal>;
}
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


/* v1.10.37 source-dropdown focus-only behavior */
