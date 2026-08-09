export default function MetricCard({ icon:Icon, label, value, suffix, note, tone='green' }) {
  return <div className="metric-card">
    <div className={`metric-icon tone-${tone}`}>{Icon && <Icon size={19}/>}</div>
    <div className="metric-copy"><span>{label}</span><strong>{value}{suffix && <small>{suffix}</small>}</strong>{note && <em>{note}</em>}</div>
  </div>;
}
