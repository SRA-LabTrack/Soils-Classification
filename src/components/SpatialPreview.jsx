import { Activity, FlaskConical, RadioTower, ScanLine, Sprout, X } from 'lucide-react';
import StatusPill from './StatusPill';

const metrics = [
  ['nitrogen', 'Nitrogen', 'N', 'mg/kg'],
  ['phosphorus', 'Phosphorus', 'P', 'mg/kg'],
  ['potassium', 'Potassium', 'K', 'mg/kg'],
  ['ph', 'pH', 'pH', ''],
  ['organic_matter', 'Organic material', 'OM', '%'],
  ['moisture', 'Moisture', 'H₂O', '%'],
];

const value = (row, key) => {
  const raw = row?.[key];
  if (raw === undefined || raw === null || raw === '') return '—';
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  return key === 'ph' ? n.toFixed(2) : key === 'organic_matter' || key === 'moisture' ? n.toFixed(1) : n.toFixed(0);
};

const dateText = (raw) => {
  if (!raw) return 'No timestamp';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 'No timestamp' : d.toLocaleString();
};

export default function SpatialPreview({ sensor, plot, drone, farmName, onClose }) {
  const kind = sensor ? 'sensor' : plot ? 'plot' : drone ? 'drone' : null;
  const row = sensor || plot || drone;
  if (!row || !kind) {
    return <aside className="farmer-spatial-preview is-empty">
      <div className="preview-empty-icon"><Sprout size={22}/></div>
      <b>Select a map record</b>
      <span>Tap a sensor, soil-analysis plot, or drone-mapping area to preview its published soil information.</span>
    </aside>;
  }

  const isSensor = kind === 'sensor';
  const isPlot = kind === 'plot';
  const Icon = isSensor ? RadioTower : isPlot ? FlaskConical : ScanLine;
  const title = isSensor ? row.sensor_code : isPlot ? row.plot_code : row.name;
  const eyebrow = isSensor ? 'SOIL SENSOR' : isPlot ? 'SOIL ANALYSIS PLOT' : 'DRONE MAPPING';
  const status = isSensor ? (row.status || 'Online') : (row.classification || row.status || 'Mapped');
  const timestamp = isSensor ? row.recorded_at : isPlot ? row.analyzed_at : row.captured_at;

  return <aside key={`${kind}-${row.id}-${timestamp || ''}`} className={`farmer-spatial-preview preview-${kind}`}>
    <div className="farmer-preview-glow"/>
    <div className="farmer-preview-head">
      <div className="farmer-preview-icon"><Icon size={19}/></div>
      <div className="farmer-preview-title"><span>{eyebrow}</span><h3>{title || 'Field record'}</h3><small>{farmName || 'My Farm'}</small></div>
      <button className="preview-close" onClick={onClose} aria-label="Close preview"><X size={17}/></button>
    </div>

    <div className="farmer-preview-status">
      <StatusPill value={status}/>
      {isSensor && <span>{row.coverage_m || 50}m × {row.coverage_m || 50}m coverage</span>}
      {isPlot && <span>Laboratory observation area</span>}
      {kind === 'drone' && <span>{Number(row.area_hectares || 0).toFixed(2)} ha mapped</span>}
    </div>

    <div className="farmer-preview-metrics">
      {metrics.map(([key,label,short,unit]) => <article key={key}>
        <div className="preview-metric-top"><span>{short}</span><Activity size={12}/></div>
        <b>{value(row,key)}{value(row,key) !== '—' && unit ? <small> {unit}</small> : null}</b>
        <em>{label}</em>
      </article>)}
    </div>

    <div className="farmer-preview-meta">
      <div><span>{isSensor ? 'Latest reading' : isPlot ? 'Last analysis' : 'Capture date'}</span><b>{dateText(timestamp)}</b></div>
      {row.latitude !== undefined && row.longitude !== undefined && <div><span>Location</span><b>{Number(row.latitude).toFixed(6)}, {Number(row.longitude).toFixed(6)}</b></div>}
      {row.notes && <div className="preview-notes"><span>Notes</span><p>{row.notes}</p></div>}
    </div>
  </aside>;
}
