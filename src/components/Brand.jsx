import { Sprout } from 'lucide-react';
export default function Brand({ compact=false }) {
  return <div className={`brand ${compact ? 'compact' : ''}`}>
    <div className="brand-mark"><Sprout size={21}/></div>
    {!compact && <div><strong>SOILS</strong><span>Classification</span></div>}
  </div>;
}
