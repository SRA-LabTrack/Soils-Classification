import { useEffect, useState } from 'react';
import { Compass, Pencil, RadioTower, RotateCw, Save, Trash2, X } from 'lucide-react';
import StatusPill from './StatusPill';

const fields=[
  ['nitrogen','Nitrogen','mg/kg'],['phosphorus','Phosphorus','mg/kg'],['potassium','Potassium','mg/kg'],
  ['organic_matter','Organic material','%'],['ph','pH',''],['moisture','Moisture','%'],
];

const cleanAngle=(value)=>{
  const n=Number(value||0);
  return ((n%360)+360)%360;
};

function SensorEditModal({sensor,form,setForm,onCancel,onSave,busy}){
  const set=(key,value)=>setForm(v=>({...v,[key]:value}));
  const angle=cleanAngle(form.orientation_deg);
  return <div className="sensor-edit-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&onCancel?.()}>
    <section className="sensor-edit-modal" role="dialog" aria-modal="true" aria-label={`Edit ${sensor.sensor_code}`}>
      <div className="sensor-edit-head">
        <div className="sensor-edit-title"><div className="sensor-inspector-icon"><RadioTower size={19}/></div><div><span>ADMIN SENSOR EDITOR</span><h3>Edit {sensor.sensor_code}</h3><p>Update published soil readings, coverage, position, and sensor orientation.</p></div></div>
        <button onClick={onCancel} aria-label="Close sensor editor"><X size={18}/></button>
      </div>

      <div className="sensor-edit-layout">
        <div className="sensor-edit-column">
          <h4>Station & placement</h4>
          <div className="form-grid two sensor-admin-fields landscape-fields">
            <label>Sensor name<input value={form.sensor_code||''} onChange={e=>set('sensor_code',e.target.value)}/></label>
            <label>Status<select value={form.status||'Online'} onChange={e=>set('status',e.target.value)}><option>Online</option><option>Offline</option><option>Maintenance</option></select></label>
            <label>Coverage (m)<input type="number" min="1" value={form.coverage_m??50} onChange={e=>set('coverage_m',e.target.value)}/></label>
            <label>Latitude<input type="number" step="0.000001" value={form.latitude??''} onChange={e=>set('latitude',e.target.value)}/></label>
            <label>Longitude<input type="number" step="0.000001" value={form.longitude??''} onChange={e=>set('longitude',e.target.value)}/></label>
            <label>Orientation (°)<input type="number" min="0" max="359.99" step="1" value={form.orientation_deg??0} onChange={e=>set('orientation_deg',e.target.value)}/></label>
          </div>
          <div className="orientation-control">
            <div className="orientation-dial"><div className="orientation-arrow" style={{transform:`rotate(${angle}deg)`}}><span/></div><b>N</b></div>
            <div><div className="orientation-label"><RotateCw size={14}/><span>Rotate coverage footprint</span><strong>{angle.toFixed(0)}°</strong></div><input aria-label="Sensor orientation" type="range" min="0" max="359" step="1" value={angle} onChange={e=>set('orientation_deg',e.target.value)}/><small>0° points north. Drag the slider or type an angle. The same rotation appears on the Farmer map.</small></div>
          </div>
        </div>

        <div className="sensor-edit-column">
          <h4>Published soil readings</h4>
          <div className="sensor-reading-grid edit-reading-grid">
            {fields.map(([key,label,unit])=><label key={key}><span>{label}</span><div className="input-with-unit"><input type="number" step="0.01" value={form[key]??''} onChange={e=>set(key,e.target.value)}/>{unit&&<em>{unit}</em>}</div></label>)}
          </div>
        </div>
      </div>

      <div className="sensor-edit-actions"><button disabled={busy} onClick={onCancel}><X size={15}/>Cancel</button><button className="primary-btn" disabled={busy} onClick={onSave}><Save size={15}/>{busy?'Saving…':'Save & publish'}</button></div>
    </section>
  </div>;
}

export default function SensorInspector({sensor,farmName,editable=false,inline=false,onSave,onDelete,onClose,busy=false}){
  const [form,setForm]=useState(sensor||{});
  const [editing,setEditing]=useState(false);

  useEffect(()=>{
    setForm(sensor||{});
    setEditing(false);
  },[sensor?.id,sensor?.recorded_at,sensor?.orientation_deg]);

  if(!sensor)return null;
  const save=async()=>{await onSave?.({...sensor,...form,orientation_deg:cleanAngle(form.orientation_deg)});setEditing(false)};
  const orientation=cleanAngle(sensor.orientation_deg);

  return <>
    <aside className={`sensor-inspector sensor-preview-only ${inline?'inline-sensor-preview':''}`}>
      <div className="inspector-head">
        <div className="sensor-inspector-icon"><RadioTower size={19}/></div>
        <div><span>{farmName||'Farm sensor'}</span><h3>{sensor.sensor_code}</h3></div>
        <button onClick={onClose} aria-label="Close sensor preview"><X size={17}/></button>
      </div>

      <div className="inspector-status">
        <StatusPill value={sensor.status||'Online'}/>
        <small>Coverage {sensor.coverage_m||50}m × {sensor.coverage_m||50}m</small>
      </div>

      <div className="sensor-preview-banner compact-preview-banner">
        <div><b>Sensor preview</b><span>{editable?'Review the published values. Editing stays locked until you choose Edit Sensor.':'Read-only values published by the administrator for this farm.'}</span></div>
        {editable&&<button className="primary-btn compact-btn" onClick={()=>setEditing(true)}><Pencil size={14}/> Edit Sensor</button>}
      </div>

      <div className="sensor-reading-grid preview-reading-grid">
        {fields.map(([key,label,unit])=><label key={key}><span>{label}</span><strong>{sensor[key]??'—'} <small>{unit}</small></strong></label>)}
      </div>

      <div className="sensor-orientation-preview"><div className="mini-compass"><Compass size={15}/><i style={{transform:`rotate(${orientation}deg)`}}/></div><div><span>Sensor orientation</span><b>{orientation.toFixed(0)}°</b><small>Coverage footprint rotates with this heading</small></div></div>

      <div className="inspector-meta"><span>Last reading</span><b>{sensor.recorded_at?new Date(sensor.recorded_at).toLocaleString():'No timestamp'}</b></div>

      {editable&&<div className="inspector-actions preview-actions single-edit-row"><button className="danger-btn" disabled={busy} onClick={()=>onDelete?.(sensor)}><Trash2 size={15}/> Delete sensor</button></div>}
    </aside>

    {editable&&editing&&<SensorEditModal sensor={sensor} form={form} setForm={setForm} onCancel={()=>{setForm(sensor||{});setEditing(false)}} onSave={save} busy={busy}/>} 
  </>;
}
