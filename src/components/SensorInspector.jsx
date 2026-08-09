import { useEffect, useState } from 'react';
import { Pencil, RadioTower, Save, Trash2, X } from 'lucide-react';
import StatusPill from './StatusPill';

const fields=[
  ['nitrogen','Nitrogen','mg/kg'],['phosphorus','Phosphorus','mg/kg'],['potassium','Potassium','mg/kg'],
  ['organic_matter','Organic material','%'],['ph','pH',''],['moisture','Moisture','%'],
];

export default function SensorInspector({sensor,farmName,editable=false,onSave,onDelete,onClose,busy=false}){
  const [form,setForm]=useState(sensor||{});
  const [editing,setEditing]=useState(false);

  useEffect(()=>{
    setForm(sensor||{});
    setEditing(false);
  },[sensor?.id,sensor?.recorded_at]);

  if(!sensor)return null;
  const set=(key,value)=>setForm(v=>({...v,[key]:value}));
  const cancelEdit=()=>{setForm(sensor||{});setEditing(false)};
  const save=async()=>{await onSave?.({...sensor,...form});setEditing(false)};

  return <aside className="sensor-inspector">
    <div className="inspector-head">
      <div className="sensor-inspector-icon"><RadioTower size={19}/></div>
      <div><span>{farmName||'Farm sensor'}</span><h3>{sensor.sensor_code}</h3></div>
      <button onClick={onClose} aria-label="Close sensor preview"><X size={17}/></button>
    </div>

    <div className="inspector-status">
      <StatusPill value={sensor.status||'Online'}/>
      <small>Coverage {sensor.coverage_m||50}m × {sensor.coverage_m||50}m</small>
    </div>

    {editable && !editing && <div className="sensor-preview-banner">
      <div><b>Sensor preview</b><span>Review the published values first. Editing is only enabled when you choose Edit Sensor.</span></div>
      <button className="primary-btn compact-btn" onClick={()=>setEditing(true)}><Pencil size={14}/> Edit Sensor</button>
    </div>}

    {editable&&editing&&<div className="form-grid two sensor-admin-fields">
      <label>Sensor name<input value={form.sensor_code||''} onChange={e=>set('sensor_code',e.target.value)}/></label>
      <label>Status<select value={form.status||'Online'} onChange={e=>set('status',e.target.value)}><option>Online</option><option>Offline</option><option>Maintenance</option></select></label>
      <label>Coverage (m)<input type="number" min="1" value={form.coverage_m??50} onChange={e=>set('coverage_m',e.target.value)}/></label>
      <label>Latitude<input type="number" step="0.000001" value={form.latitude??''} onChange={e=>set('latitude',e.target.value)}/></label>
      <label>Longitude<input type="number" step="0.000001" value={form.longitude??''} onChange={e=>set('longitude',e.target.value)}/></label>
    </div>}

    <div className="sensor-reading-grid">
      {fields.map(([key,label,unit])=><label key={key}>
        <span>{label}</span>
        {editable&&editing
          ? <input type="number" step="0.01" value={form[key]??''} onChange={e=>set(key,e.target.value)}/>
          : <strong>{sensor[key]??'—'} <small>{unit}</small></strong>}
      </label>)}
    </div>

    <div className="inspector-meta"><span>Last reading</span><b>{sensor.recorded_at?new Date(sensor.recorded_at).toLocaleString():'No timestamp'}</b></div>

    {editable && !editing && <div className="inspector-actions preview-actions">
      <button className="danger-btn" disabled={busy} onClick={()=>onDelete?.(sensor)}><Trash2 size={15}/> Delete sensor</button>
      <button className="primary-btn" disabled={busy} onClick={()=>setEditing(true)}><Pencil size={15}/> Edit Sensor</button>
    </div>}

    {editable&&editing&&<div className="inspector-actions">
      <button disabled={busy} onClick={cancelEdit}><X size={15}/> Cancel edit</button>
      <button className="primary-btn" disabled={busy} onClick={save}><Save size={15}/> Save & publish</button>
    </div>}
  </aside>;
}
