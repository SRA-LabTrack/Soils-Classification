import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Crosshair, Eye, LocateFixed, MapPinned, Plus, RotateCcw, Save, Trash2, Undo2, X } from 'lucide-react';

const fmt=(value)=>Number(value).toFixed(7);

function previewStats(points=[]){
  if(!points.length)return null;
  const clean=points.map(p=>[Number(p?.[0]),Number(p?.[1])]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(!clean.length)return null;
  const latitude=clean.reduce((sum,p)=>sum+p[0],0)/clean.length;
  const longitude=clean.reduce((sum,p)=>sum+p[1],0)/clean.length;
  if(clean.length<3)return {latitude,longitude,area:0};
  const cos=Math.cos(latitude*Math.PI/180);
  const xy=clean.map(([lat,lng])=>[(lng-longitude)*111320*cos,(lat-latitude)*111320]);
  let twiceArea=0;
  for(let i=0;i<xy.length;i++){
    const [x1,y1]=xy[i];const [x2,y2]=xy[(i+1)%xy.length];
    twiceArea+=x1*y2-x2*y1;
  }
  return {latitude,longitude,area:Math.abs(twiceArea)/2/10000};
}

function parseCoordinatePair(text=''){
  const matches=String(text).replace(/[−–—]/g,'-').match(/[-+]?\d{1,3}(?:\.\d+)?/g);
  if(!matches||matches.length<2)return null;
  const latitude=Number(matches[0]);
  const longitude=Number(matches[1]);
  if(!Number.isFinite(latitude)||latitude<-90||latitude>90||!Number.isFinite(longitude)||longitude<-180||longitude>180)return null;
  return [latitude,longitude];
}

async function copyText(text){
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return;}
  const node=document.createElement('textarea');
  node.value=text;node.setAttribute('readonly','');node.style.position='fixed';node.style.opacity='0';
  document.body.appendChild(node);node.select();document.execCommand('copy');document.body.removeChild(node);
}

export default function MapToolbar({ drawMode, points = [], onStart, onUndo, onClear, onCancel, onSave, onGpsPoint, onDeleteBoundary, canDeleteBoundary=false, busy=false, requestOnly=false }) {
  const [lat,setLat]=useState('');
  const [lng,setLng]=useState('');
  const [gpsBusy,setGpsBusy]=useState(false);
  const [gpsError,setGpsError]=useState('');
  const [copiedKey,setCopiedKey]=useState('');
  const [collapsed,setCollapsed]=useState(true);
  const stats=useMemo(()=>previewStats(points),[points]);
  useEffect(()=>{setLat('');setLng('');setGpsError('');setCopiedKey('');if(drawMode)setCollapsed(false);},[drawMode]);
  useEffect(()=>{const ping=()=>window.dispatchEvent(new CustomEvent('soils:map-overlay-reflow'));requestAnimationFrame(ping);const timer=window.setTimeout(ping,180);return ()=>window.clearTimeout(timer);},[collapsed,drawMode]);

  const applyPair=(pair)=>{
    if(!pair)return false;
    setLat(fmt(pair[0]));
    setLng(fmt(pair[1]));
    setGpsError('');
    return true;
  };
  const pasteCoordinatePair=(event)=>{
    const text=event.clipboardData?.getData('text')||'';
    const pair=parseCoordinatePair(text);
    if(!pair)return;
    event.preventDefault();
    applyPair(pair);
  };
  const addCoordinate=()=>{
    const latitude=Number(lat),longitude=Number(lng);
    if(!Number.isFinite(latitude)||latitude<-90||latitude>90||!Number.isFinite(longitude)||longitude<-180||longitude>180){
      setGpsError('Enter a valid latitude (-90 to 90) and longitude (-180 to 180).');return;
    }
    setGpsError('');onGpsPoint?.([latitude,longitude]);
    if(drawMode!=='sensor'){setLat('');setLng('');}
  };
  const useDeviceGps=()=>{
    if(!navigator.geolocation){setGpsError('Device GPS is not available in this browser.');return;}
    setGpsBusy(true);setGpsError('');
    navigator.geolocation.getCurrentPosition(
      pos=>{const latitude=Number(pos.coords.latitude.toFixed(7)),longitude=Number(pos.coords.longitude.toFixed(7));applyPair([latitude,longitude]);onGpsPoint?.([latitude,longitude]);setGpsBusy(false);},
      err=>{setGpsError(err?.message||'Could not read this device GPS location.');setGpsBusy(false);},
      {enableHighAccuracy:true,timeout:10000,maximumAge:15000},
    );
  };
  const copyPair=async(point,key)=>{
    try{
      await copyText(`${fmt(point[0])}, ${fmt(point[1])}`);
      setCopiedKey(key);
      window.setTimeout(()=>setCopiedKey(current=>current===key?'':current),1300);
    }catch{
      setGpsError('Clipboard access was blocked. Select the coordinates and copy them manually.');
    }
  };

  if (drawMode) {
    const polygonMode=drawMode!=='sensor';
    const title=requestOnly ? (drawMode==='sensor'?'Request sensor position':drawMode==='plot'?'Request soil plot area':'Request drone mapping area') : (drawMode === 'farm' ? 'Drawing farm boundary' : drawMode === 'plot' ? 'Plotting soil analysis' : drawMode === 'drone' ? 'Plotting drone mapping' : 'Sensor placement');
    if(collapsed)return <div className="map-edit-toolbar drawing is-collapsed"><button type="button" className="map-editor-collapse-row" onClick={()=>setCollapsed(false)} aria-label="Expand admin map editor"><span><b>{title}</b><small>{drawMode === 'sensor' ? 'GPS position' : `${points.length} point${points.length === 1 ? '' : 's'}`}</small></span><ChevronLeft size={15}/></button></div>;
    return <div className="map-edit-toolbar drawing">
      <div className="map-editor-toolbar-head"><div className="toolbar-copy"><b>{title}</b><small>{drawMode === 'sensor' ? 'GPS position' : `${points.length} point${points.length === 1 ? '' : 's'} selected`}</small></div><button type="button" className="map-editor-collapse-btn" onClick={()=>setCollapsed(true)} aria-label="Collapse admin map editor"><ChevronRight size={15}/></button></div>
      <div className="gps-coordinate-entry">
        <span><Crosshair size={14}/> GPS coordinates</span>
        <div className="gps-coordinate-fields">
          <input aria-label="Latitude" type="number" step="0.0000001" min="-90" max="90" placeholder="Latitude" value={lat} onPaste={pasteCoordinatePair} onChange={e=>setLat(e.target.value)}/>
          <input aria-label="Longitude" type="number" step="0.0000001" min="-180" max="180" placeholder="Longitude" value={lng} onPaste={pasteCoordinatePair} onChange={e=>setLng(e.target.value)}/>
        </div>
        <small className="gps-paste-hint">Paste a copied pair into either box. Latitude and longitude fill automatically.</small>
        <div className="gps-coordinate-actions">
          <button type="button" disabled={busy} onClick={addCoordinate}>{drawMode==='sensor'?'Apply sensor GPS':'Add GPS point'}</button>
          <button type="button" disabled={busy||gpsBusy} onClick={useDeviceGps}><LocateFixed size={14}/>{gpsBusy?'Locating…':'Use device GPS'}</button>
        </div>
        {gpsError&&<small className="gps-error">{gpsError}</small>}
      </div>

      <div className={`coordinate-preview ${polygonMode?'is-polygon':'is-sensor'}`}>
        <div className="coordinate-preview-head">
          <span><Eye size={14}/>Coordinate preview</span>
          <small>{points.length} {points.length===1?'coordinate':'coordinates'}</small>
        </div>
        {points.length ? <>
          <div className="coordinate-preview-list">
            {points.map((point,index)=>{const key=`point-${index}`;return <div className="coordinate-preview-row" key={`${point?.[0]}-${point?.[1]}-${index}`}>
              <b>{drawMode==='sensor'?'GPS':`P${index+1}`}</b>
              <span>{fmt(point[0])}</span>
              <span>{fmt(point[1])}</span>
              <button type="button" className="coordinate-copy-btn" onClick={()=>copyPair(point,key)} aria-label={`Copy ${drawMode==='sensor'?'sensor GPS':`point ${index+1}`} latitude and longitude`}>{copiedKey===key?<><Check size={11}/>Copied</>:<><Copy size={11}/>Copy</>}</button>
            </div>})}
          </div>
          {stats&&<div className="coordinate-preview-summary">
            <div><span><MapPinned size={12}/>Preview center</span><div className="coordinate-summary-value"><b>{fmt(stats.latitude)}, {fmt(stats.longitude)}</b><button type="button" className="coordinate-copy-btn summary-copy" onClick={()=>copyPair([stats.latitude,stats.longitude],'center')}>{copiedKey==='center'?<><Check size={11}/>Copied</>:<><Copy size={11}/>Copy</>}</button></div></div>
            {polygonMode&&points.length>=3&&<div><span>Approx. polygon area</span><b>{stats.area.toFixed(3)} ha</b></div>}
          </div>}
        </> : <div className="coordinate-preview-empty">Add a point to preview its exact latitude and longitude here before saving.</div>}
      </div>

      <div className="toolbar-actions">
        {polygonMode && <button disabled={!points.length || busy} onClick={onUndo}><Undo2 size={14}/>Undo</button>}
        <button disabled={!points.length || busy} onClick={onClear}><RotateCcw size={14}/>Clear</button>
        <button disabled={busy} onClick={onCancel}><X size={14}/>Cancel</button>
        <button className="primary-btn compact-btn" disabled={busy || (drawMode === 'sensor' ? points.length < 1 : points.length < 3)} onClick={onSave}><Save size={14}/>{requestOnly?'Review request':drawMode==='plot'||drawMode==='drone'?'Finish plotting':drawMode==='farm'?'Save boundary':'Continue'}</button>
      </div>
    </div>;
  }
  const editorTitle=requestOnly?'Request map placement':'Admin map editor';
  const editorSub=requestOnly?'Pending Admin approval':'Map records';
  if(collapsed)return <div className="map-edit-toolbar is-collapsed"><button type="button" className="map-editor-collapse-row" onClick={()=>setCollapsed(false)} aria-label={`Expand ${requestOnly?'request map editor':'admin map editor'}`}><span><b>{editorTitle}</b><small>{editorSub}</small></span><ChevronLeft size={15}/></button></div>;
  return <div className={`map-edit-toolbar ${requestOnly?'farmer-request-toolbar':''}`}><div className="map-editor-toolbar-head"><div><b>{editorTitle}</b><small>{editorSub}</small></div><button type="button" className="map-editor-collapse-btn" onClick={()=>setCollapsed(true)} aria-label={`Collapse ${requestOnly?'request map editor':'admin map editor'}`}><ChevronRight size={15}/></button></div><div className="toolbar-actions">{!requestOnly&&<button onClick={() => onStart?.('farm')}><Plus size={14}/>Farm boundary</button>}<button onClick={() => onStart?.('sensor')}><Plus size={14}/>{requestOnly?'Request sensor':'Sensor'}</button><button onClick={() => onStart?.('plot')}><Plus size={14}/>{requestOnly?'Request soil plot':'Soil plot'}</button><button onClick={() => onStart?.('drone')}><Plus size={14}/>{requestOnly?'Request drone map':'Drone mapping'}</button>{!requestOnly&&canDeleteBoundary && <button className="danger-ghost" onClick={onDeleteBoundary}><Trash2 size={14}/>Delete boundary</button>}</div></div>;
}
