import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function Modal({title,subtitle,onClose,children,wide=false,className='',kicker='ADMIN CONTROL'}){
  const content=<div className="modal-backdrop portal-modal-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&onClose?.()}>
    <div className={`modal-card portal-modal-card ${wide?'wide':''} ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><div><span>{kicker}</span><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div><button type="button" onClick={onClose} aria-label="Close"><X size={18}/></button></div>
      {children}
    </div>
  </div>;
  return createPortal(content,document.body);
}
