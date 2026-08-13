import { ChevronDown, Eye, EyeOff, FlaskConical, LandPlot, RadioTower, ScanLine, SquareDashed } from 'lucide-react';
import { useState } from 'react';

const layerDefs = [
  ['farmBoundary', 'Farm boundary', LandPlot],
  ['sensors', 'Sensor pins', RadioTower],
  ['sensorCoverage', 'Sensor coverage', SquareDashed],
  ['soilPlots', 'Soil analysis plots', FlaskConical],
  ['droneMapping', 'Drone mapping', ScanLine],
];

export default function LayerVisibility({ visibility, onChange, sensors = [], visibleSensorIds = [], onSensorToggle, plots = [], visiblePlotIds = [], onPlotToggle }) {
  const [open, setOpen] = useState(false);
  const allSensorsVisible = sensors.length > 0 && sensors.every(s => visibleSensorIds.includes(s.id));
  const allPlotsVisible = plots.length > 0 && plots.every(p => visiblePlotIds.includes(p.id));

  const toggleLayer = key => onChange?.({ ...visibility, [key]: !visibility[key] });
  return <div className={`visibility-control ${open ? 'open' : ''}`}>
    <button className="visibility-trigger" onClick={() => setOpen(v => !v)}>
      <Eye size={15}/><span>Visibility</span><ChevronDown size={14}/>
    </button>
    {open && <div className="visibility-popover">
      <div className="visibility-title"><div><b>Map visibility</b><small>Show or hide map layers and pins</small></div><EyeOff size={15}/></div>
      <div className="visibility-section">
        {layerDefs.map(([key,label,Icon]) => <label key={key} className="check-row"><input type="checkbox" checked={!!visibility[key]} onChange={() => toggleLayer(key)}/><span className="fake-check"/><Icon size={14}/><span>{label}</span></label>)}
      </div>
      {!!sensors.length && <div className="visibility-section sublist"><div className="visibility-subhead"><b>Sensor pins</b><button onClick={() => sensors.forEach(s => onSensorToggle?.(s.id, !allSensorsVisible))}>{allSensorsVisible ? 'Hide all' : 'Show all'}</button></div>{sensors.map(s => <label key={s.id} className="check-row compact"><input type="checkbox" checked={visibleSensorIds.includes(s.id)} onChange={e => onSensorToggle?.(s.id, e.target.checked)}/><span className="fake-check"/><span>{s.sensor_code}</span><small>{s.farm_name || ''}</small></label>)}</div>}
      {!!plots.length && <div className="visibility-section sublist"><div className="visibility-subhead"><b>Analysis plots</b><button onClick={() => plots.forEach(p => onPlotToggle?.(p.id, !allPlotsVisible))}>{allPlotsVisible ? 'Hide all' : 'Show all'}</button></div>{plots.map(p => <label key={p.id} className="check-row compact"><input type="checkbox" checked={visiblePlotIds.includes(p.id)} onChange={e => onPlotToggle?.(p.id, e.target.checked)}/><span className="fake-check"/><span>{p.plot_code}</span><small>{p.farm_name || ''}</small></label>)}</div>}
    </div>}
  </div>;
}
