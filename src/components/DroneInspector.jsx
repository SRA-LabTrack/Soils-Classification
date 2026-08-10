import { useEffect, useState } from 'react';
import { Pencil, Save, ScanLine, Trash2, X } from 'lucide-react';
import StatusPill from './StatusPill';

const fields=[
  ['nitrogen','Nitrogen','mg/kg'],['phosphorus','Phosphorus','mg/kg'],['potassium','Potassium','mg/kg'],
  ['organic_matter','Organic material','%'],['ph','pH',''],['moisture','Moisture','%'],
];

export default function DroneInspector({drone,farmName,editable=false,inline=false,onSave,onDelete,onClose,busy=false}){
  const [form,setForm]=useState(drone||{});
  const [editing,setEditing]=useState(false);

  useEffect(()=>{
    setForm(drone||{});
    setEditing(false);
  },[drone?.id,drone?.captured_at]);

  if(!drone)return null;
  const set=(key,value)=>setForm(v=>({...v,[key]:value}));
  const cancelEdit=()=>{setForm(drone||{});setEditing(false)};
  const save=async()=>{await onSave?.({...drone,...form});setEditing(false)};

  return <aside className={`sensor-inspector drone-inspector ${inline?'inline-spatial-inspector':''}`}>
    <div className="inspector-head">
      <div className="sensor-inspector-icon drone-inspector-icon"><ScanLine size={19}/></div>
      <div><span>{farmName||'Farm drone mapping'}</span><h3>{drone.name}</h3></div>
      <button onClick={onClose} aria-label="Close drone mapping preview"><X size={17}/></button>
    </div>

    <div className="inspector-status">
      <StatusPill value={drone.classification||drone.status||'Mapped'}/>
      <small>{Number(drone.area_hectares||0).toFixed(2)} ha mapped • {drone.captured_at?new Date(drone.captured_at).toLocaleDateString():'No capture date'}</small>
    </div>

    {editable&&!editing&&<div className="sensor-preview-banner drone-preview-banner">
      <div><b>Drone mapping preview</b><span>These values are published with the mapped drone observation area.</span></div>
      <button className="primary-btn compact-btn" onClick={()=>setEditing(true)}><Pencil size={14}/> Edit Mapping</button>
    </div>}

    {editable&&editing&&<div className="form-grid two sensor-admin-fields">
      <label>Mapping name<input value={form.name||''} onChange={e=>set('name',e.target.value)}/></label>
      <label>Classification<select value={form.classification||'Unclassified'} onChange={e=>set('classification',e.target.value)}><option>Unclassified</option><option>Good</option><option>Monitor</option><option>Poor</option><option>Critical</option></select></label>
      <label>Status<select value={form.status||'Mapped'} onChange={e=>set('status',e.target.value)}><option>Mapped</option><option>Processing</option><option>Archived</option></select></label>
      <label>Image / orthomosaic URL<input value={form.image_url||''} onChange={e=>set('image_url',e.target.value)}/></label>
      <label className="full">Notes<textarea rows="3" value={form.notes||''} onChange={e=>set('notes',e.target.value)}/></label>
    </div>}

    <div className="sensor-reading-grid drone-reading-grid">
      {fields.map(([key,label,unit])=><label key={key}>
        <span>{label}</span>
        {editable&&editing
          ? <input type="number" step="0.01" value={form[key]??''} onChange={e=>set(key,e.target.value)}/>
          : <strong>{drone[key]??'—'} <small>{unit}</small></strong>}
      </label>)}
    </div>

    {drone.notes&&<div className="drone-notes"><span>Observation notes</span><p>{drone.notes}</p></div>}

    {editable&&!editing&&<div className="inspector-actions preview-actions single-edit-row">
      <button className="danger-btn" disabled={busy} onClick={()=>onDelete?.(drone)}><Trash2 size={15}/> Delete mapping</button>
    </div>}

    {editable&&editing&&<div className="inspector-actions">
      <button disabled={busy} onClick={cancelEdit}><X size={15}/> Cancel edit</button>
      <button className="primary-btn" disabled={busy} onClick={save}><Save size={15}/> Save & publish</button>
    </div>}
  </aside>;
}
