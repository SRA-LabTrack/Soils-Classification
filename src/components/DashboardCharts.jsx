import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { trendData } from '../data/demoData';

const avg=(arr,key)=>arr.length?(arr.reduce((s,x)=>s+(Number(x[key])||0),0)/arr.length):0;

export function TrendChart(){
  return <section className="panel chart-panel"><div className="panel-title"><div><span>6-MONTH TREND</span><h3>Nutrient Movement</h3></div><small>Trend view</small></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trendData}><defs><linearGradient id="soilArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4bd66d" stopOpacity={.32}/><stop offset="95%" stopColor="#4bd66d" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#dce9df" vertical={false}/><XAxis dataKey="month" stroke="#718578" tickLine={false} axisLine={false}/><YAxis stroke="#718578" tickLine={false} axisLine={false}/><Tooltip contentStyle={{background:'#ffffff',border:'1px solid #cfe1d3',borderRadius:0,color:'#173b24'}}/><Area type="monotone" dataKey="nitrogen" stroke="#229c52" strokeWidth={2.5} fill="url(#soilArea)"/></AreaChart></ResponsiveContainer></div></section>;
}

export function NutrientBars({sensors=[]}){
  const data=[{name:'Nitrogen',value:avg(sensors,'nitrogen')},{name:'Phosphorus',value:avg(sensors,'phosphorus')},{name:'Potassium',value:avg(sensors,'potassium')},{name:'Organic',value:avg(sensors,'organic_matter')*10}];
  return <section className="panel chart-panel"><div className="panel-title"><div><span>NUTRIENT INDEX</span><h3>Relative Soil Levels</h3></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid stroke="#dce9df" vertical={false}/><XAxis dataKey="name" stroke="#718578" tickLine={false} axisLine={false}/><YAxis stroke="#718578" tickLine={false} axisLine={false}/><Tooltip contentStyle={{background:'#ffffff',border:'1px solid #cfe1d3',borderRadius:0,color:'#173b24'}}/><Bar dataKey="value" fill="#229c52"/></BarChart></ResponsiveContainer></div></section>;
}
