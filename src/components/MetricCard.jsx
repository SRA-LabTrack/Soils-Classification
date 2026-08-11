export default function MetricCard({ icon:Icon, label, value, suffix, note, tone='green', onClick, active=false, detail }) {
  const content=<>
    <div className={`metric-icon tone-${tone}`}>{Icon && <Icon size={19}/>}</div>
    <div className="metric-copy"><span>{label}</span><strong>{value}{suffix && <small>{suffix}</small>}</strong>{note && <em>{note}</em>}{detail&&<small className="metric-detail">{detail}</small>}</div>
    {onClick&&<span className="metric-select-indicator" aria-hidden="true"/>}
  </>;
  if(onClick) return <button type="button" className={`metric-card metric-card-button ${active?'is-active':''}`} onClick={onClick} aria-pressed={active}>{content}</button>;
  return <div className="metric-card">{content}</div>;
}
