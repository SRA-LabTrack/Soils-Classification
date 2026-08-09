export default function StatusPill({ value='Good' }) {
  const key = value.toLowerCase().replace(/\s+/g,'-');
  return <span className={`status-pill status-${key}`}><i />{value}</span>;
}
