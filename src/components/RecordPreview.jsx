import { Activity, Compass, FlaskConical, Pencil, RadioTower, RotateCcw, RotateCw, ScanLine, Trash2, X } from 'lucide-react';
import StatusPill from './StatusPill';

const fields=[
  ['nitrogen','Nitrogen','N','mg/kg'],['phosphorus','Phosphorus','P','mg/kg'],['potassium','Potassium','K','mg/kg'],
  ['ph','pH','pH',''],['organic_matter','Organic material','OM','%'],['moisture','Moisture','H₂O','%'],
];
const fmt=(row,key)=>{const raw=row?.[key];if(raw===undefined||raw===null||raw==='')return '—';const n=Number(raw);if(!Number.isFinite(n))return String(raw);return key==='ph'?n.toFixed(2):(key==='organic_matter'||key==='moisture'?n.toFixed(1):n.toFixed(0));};
const dateText=(raw)=>{if(!raw)return 'No timestamp';const d=new Date(raw);return Number.isNaN(d.getTime())?'No timestamp':d.toLocaleString();};
const cleanAngle=(v)=>((Number(v||0)%360)+360)%360;

export default function RecordPreview({sensor,plot,drone,farmName,editable=false,onEdit,onRotate,onDelete,onClose,busy=false}){
  const kind=sensor?'sensor':plot?'plot':drone?'drone':null;
  const row=sensor||plot||drone;
  if(!row||!kind)return null;
  const Icon=kind==='sensor'?RadioTower:kind==='plot'?FlaskConical:ScanLine;
  const title=kind==='sensor'?row.sensor_code:kind==='plot'?row.plot_code:row.name;
  const eyebrow=kind==='sensor'?'SOIL SENSOR':kind==='plot'?'SOIL ANALYSIS PLOT':'DRONE MAPPING';
  const status=kind==='sensor'?(row.status||'Online'):(row.classification||row.status||'Mapped');
  const timestamp=kind==='sensor'?row.recorded_at:kind==='plot'?row.analyzed_at:row.captured_at;
  const angle=cleanAngle(row.orientation_deg);
  return <aside className={`record-preview-card record-preview-${kind}`}>
    <div className="record-preview-head">
      <div className="record-preview-icon"><Icon size={18}/></div>
      <div><span>{eyebrow}</span><h3>{title||'Field record'}</h3><small>{farmName||'Farm'}</small></div>
      <button className="record-preview-close" onClick={onClose} aria-label="Close preview"><X size={17}/></button>
    </div>
    <div className="record-preview-status"><StatusPill value={status}/><span>{kind==='sensor'?`${row.coverage_m||50}m × ${row.coverage_m||50}m coverage`:kind==='plot'?'Laboratory observation area':`${Number(row.area_hectares||0).toFixed(2)} ha mapped`}</span></div>
    <div className="record-preview-grid">{fields.map(([key,label,short,unit])=><article key={key}><div><span>{short}</span><Activity size={11}/></div><b>{fmt(row,key)}{fmt(row,key)!=='—'&&unit?<small> {unit}</small>:null}</b><em>{label}</em></article>)}</div>
    {kind==='sensor'&&<div className="record-preview-orientation"><div className="mini-compass"><Compass size={15}/><i style={{transform:`rotate(${angle}deg)`}}/></div><div><span>Coverage rotation</span><b>{angle.toFixed(0)}°</b><small>Rotation of the sensor proximity square</small>{editable&&<div className="preview-rotate-buttons"><button type="button" disabled={busy} onClick={()=>onRotate?.(row,-15)}><RotateCcw size={13}/>Left</button><button type="button" disabled={busy} onClick={()=>onRotate?.(row,15)}><RotateCw size={13}/>Right</button></div>}</div></div>}
    <div className="record-preview-meta"><span>{kind==='sensor'?'Latest reading':kind==='plot'?'Last analysis':'Capture date'}</span><b>{dateText(timestamp)}</b>{row.notes&&<p>{row.notes}</p>}</div>
    {editable&&<div className="record-preview-actions"><button className="danger-ghost" disabled={busy} onClick={()=>onDelete?.(row)}><Trash2 size={14}/>Delete</button><button className="primary-btn" disabled={busy} onClick={()=>onEdit?.(row)}><Pencil size={14}/>Edit {kind==='sensor'?'Sensor':kind==='plot'?'Plot':'Mapping'}</button></div>}
  </aside>;
}
