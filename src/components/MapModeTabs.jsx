import { LandPlot, FlaskConical, ScanLine } from 'lucide-react';

const modes=[
  {key:'farm',label:'Farm Boundary',icon:LandPlot},
  {key:'analysis',label:'Soil Analysis Plot',icon:FlaskConical},
  {key:'drone',label:'Drone Mapping',icon:ScanLine},
];
export default function MapModeTabs({value,onChange}){
  return <div className="map-mode-tabs">{modes.map(({key,label,icon:Icon})=><button key={key} className={value===key?'active':''} onClick={()=>onChange(key)}><Icon size={15}/><span>{label}</span></button>)}</div>;
}
