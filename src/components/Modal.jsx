import { X } from 'lucide-react';
export default function Modal({title,subtitle,onClose,children,wide=false}){
  return <div className="modal-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&onClose?.()}><div className={`modal-card ${wide?'wide':''}`}><div className="modal-head"><div><span>ADMIN CONTROL</span><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div><button onClick={onClose}><X size={18}/></button></div>{children}</div></div>;
}
