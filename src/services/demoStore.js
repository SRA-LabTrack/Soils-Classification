export const DEMO_STORE_KEY = 'soils_demo_workspace_v3_clean';
const KEY = DEMO_STORE_KEY;
const clone = (value) => JSON.parse(JSON.stringify(value));
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;


function polygonStats(points=[]){
  if(!points.length)return {center_lat:10.4247,center_lng:122.9225,area_hectares:0};
  const lat0=points.reduce((s,p)=>s+Number(p[0]),0)/points.length,lng0=points.reduce((s,p)=>s+Number(p[1]),0)/points.length;
  const cos=Math.cos(lat0*Math.PI/180);const xy=points.map(([lat,lng])=>[(lng-lng0)*111320*cos,(lat-lat0)*111320]);let sum=0;
  for(let i=0;i<xy.length;i++){const [x1,y1]=xy[i],[x2,y2]=xy[(i+1)%xy.length];sum+=x1*y2-x2*y1;}
  return {center_lat:lat0,center_lng:lng0,area_hectares:Math.abs(sum)/2/10000};
}
function multiStats(boundaries=[]){const parts=boundaries.filter(p=>p?.length>=3).map(polygonStats);if(!parts.length)return {center_lat:10.4247,center_lng:122.9225,area_hectares:0};const total=parts.reduce((s,x)=>s+x.area_hectares,0),weights=total?parts.map(x=>x.area_hectares):parts.map(()=>1),denom=weights.reduce((s,x)=>s+x,0)||1;return {center_lat:parts.reduce((s,x,i)=>s+x.center_lat*weights[i],0)/denom,center_lng:parts.reduce((s,x,i)=>s+x.center_lng*weights[i],0)/denom,area_hectares:total};}
const polygonKey=(poly=[])=>JSON.stringify((poly||[]).map(p=>[Number(Number(p?.[0]).toFixed(7)),Number(Number(p?.[1]).toFixed(7))]));

function initialState() {
  return { farms: [], sensors: [], plots: [], drone: [] };
}

export function getDemoState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.farms) && Array.isArray(parsed?.sensors) && Array.isArray(parsed?.plots) && Array.isArray(parsed?.drone)) return parsed;
    }
  } catch {}
  const fresh = initialState();
  try { localStorage.setItem(KEY, JSON.stringify(fresh)); } catch {}
  return fresh;
}

function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  return state;
}

export function resetDemoState() {
  const fresh = initialState();
  save(fresh);
  return fresh;
}

export function applyDemoAction(action, payload = {}) {
  const state = getDemoState();
  const farmById = (id) => state.farms.find((f) => f.id === id);

  switch (action) {
    case 'createFarmer': {
      const farmId = uid('farm');
      const farmerId = uid('farmer');
      state.farms.push({
        id: farmId,
        farmer_id: farmerId,
        farmer_name: payload.name || 'New Farmer',
        name: payload.farm_name || `${payload.name || 'New Farmer'} Farm`,
        location_name: payload.location_name || 'Farm location',
        center_lat: Number(payload.center_lat || 10.4247),
        center_lng: Number(payload.center_lng || 122.9225),
        area_hectares: 0,
        status: 'Unmapped',
        boundaries: [],
        boundary: [],
      });
      break;
    }
    case 'deleteFarmer': {
      state.farms = state.farms.filter((f) => f.id !== payload.farm_id);
      state.sensors = state.sensors.filter((s) => s.farm_id !== payload.farm_id);
      state.plots = state.plots.filter((p) => p.farm_id !== payload.farm_id);
      state.drone = state.drone.filter((d) => d.farm_id !== payload.farm_id);
      break;
    }
    case 'updateFarmBoundary': {
      const farm = farmById(payload.farm_id);
      if (farm) {
        const existing=farm.boundaries?.length?farm.boundaries:(farm.boundary?.length?[farm.boundary]:[]);
        const boundaries=payload.replace===true?[clone(payload.geojson||[])]:[...existing,clone(payload.geojson||[])];
        Object.assign(farm,{boundaries,boundary:boundaries[0]||[],...multiStats(boundaries),status:payload.status||'Mapped'});
      }
      break;
    }
    case 'deleteFarmBoundary': {
      const farm = farmById(payload.farm_id);
      if (farm) {
        const existing=farm.boundaries?.length?farm.boundaries:(farm.boundary?.length?[farm.boundary]:[]);
        let boundaries=[];
        if(payload.delete_all===true) boundaries=[];
        else {
          const targetKey=payload.geojson?.length?polygonKey(payload.geojson):'';
          let index=targetKey?existing.findIndex(poly=>polygonKey(poly)===targetKey):-1;
          const requested=Number(payload.boundary_index);
          if(index<0&&Number.isInteger(requested)&&requested>=0&&requested<existing.length) index=requested;
          boundaries=index>=0?existing.filter((_,i)=>i!==index):existing;
        }
        const stats=boundaries.length?multiStats(boundaries):{center_lat:Number(farm.center_lat)||10.4247,center_lng:Number(farm.center_lng)||122.9225,area_hectares:0};
        Object.assign(farm,{boundaries,boundary:boundaries[0]||[],...stats,status:boundaries.length?'Mapped':'Unmapped'});
      }
      break;
    }
    case 'createSensor': {
      state.sensors.push({
        id: uid('sensor'),
        farm_id: payload.farm_id,
        sensor_code: payload.sensor_code || `Sensor ${state.sensors.length + 1}`,
        latitude: Number(payload.latitude),
        longitude: Number(payload.longitude),
        coverage_m: Number(payload.coverage_m || 50),
        orientation_deg: Number(payload.orientation_deg || 0),
        status: payload.status || 'Online',
        nitrogen: Number(payload.nitrogen || 0),
        phosphorus: Number(payload.phosphorus || 0),
        potassium: Number(payload.potassium || 0),
        organic_matter: Number(payload.organic_matter || 0),
        ph: Number(payload.ph || 0),
        moisture: Number(payload.moisture || 0),
        recorded_at: new Date().toISOString(),
      });
      break;
    }
    case 'updateSensor': {
      const sensor = state.sensors.find((s) => s.id === payload.sensor_id);
      if (sensor) Object.assign(sensor, {
        sensor_code: payload.sensor_code ?? sensor.sensor_code,
        latitude: Number(payload.latitude ?? sensor.latitude),
        longitude: Number(payload.longitude ?? sensor.longitude),
        coverage_m: Number(payload.coverage_m ?? sensor.coverage_m),
        orientation_deg: Number(payload.orientation_deg ?? sensor.orientation_deg ?? 0),
        status: payload.status ?? sensor.status,
        nitrogen: Number(payload.nitrogen ?? sensor.nitrogen),
        phosphorus: Number(payload.phosphorus ?? sensor.phosphorus),
        potassium: Number(payload.potassium ?? sensor.potassium),
        organic_matter: Number(payload.organic_matter ?? sensor.organic_matter),
        ph: Number(payload.ph ?? sensor.ph),
        moisture: Number(payload.moisture ?? sensor.moisture),
        recorded_at: new Date().toISOString(),
      });
      break;
    }
    case 'rotateSensor': {
      const sensor = state.sensors.find((s) => s.id === payload.sensor_id);
      if (sensor) sensor.orientation_deg = ((Number(payload.orientation_deg ?? sensor.orientation_deg ?? 0) % 360) + 360) % 360;
      break;
    }
    case 'deleteSensor':
      state.sensors = state.sensors.filter((s) => s.id !== payload.sensor_id);
      break;
    case 'createPlot': {
      state.plots.push({
        id: uid('plot'),
        farm_id: payload.farm_id,
        plot_code: payload.plot_code || `Plot ${state.plots.length + 1}`,
        latitude: Number(payload.latitude),
        longitude: Number(payload.longitude),
        coverage_m: Number(payload.coverage_m || 0),
        boundary: clone(payload.geojson || []),
        nitrogen: Number(payload.nitrogen || 0),
        phosphorus: Number(payload.phosphorus || 0),
        potassium: Number(payload.potassium || 0),
        organic_matter: Number(payload.organic_matter || 0),
        ph: Number(payload.ph || 0),
        classification: payload.classification || 'Pending',
        notes: payload.notes || '',
        analyzed_at: new Date().toISOString(),
      });
      break;
    }
    case 'updatePlot': {
      const plot = state.plots.find((p) => p.id === payload.plot_id);
      if (plot) Object.assign(plot, payload.geojson ? { boundary: clone(payload.geojson) } : {}, payload, { id: plot.id, farm_id: plot.farm_id, analyzed_at: new Date().toISOString() });
      break;
    }
    case 'deletePlot':
      state.plots = state.plots.filter((p) => p.id !== payload.plot_id);
      break;
    case 'createDroneMapping':
      state.drone.push({
        id: uid('drone'),
        farm_id: payload.farm_id,
        name: payload.name || 'Drone Mapping',
        boundary: clone(payload.geojson || []),
        center_lat: Number(payload.center_lat || 0),
        center_lng: Number(payload.center_lng || 0),
        area_hectares: Number(payload.area_hectares || 0),
        nitrogen: Number(payload.nitrogen || 0),
        phosphorus: Number(payload.phosphorus || 0),
        potassium: Number(payload.potassium || 0),
        organic_matter: Number(payload.organic_matter || 0),
        ph: Number(payload.ph || 0),
        moisture: Number(payload.moisture || 0),
        classification: payload.classification || 'Unclassified',
        notes: payload.notes || '',
        image_url: payload.image_url || '',
        captured_at: payload.captured_at || new Date().toISOString(),
        status: payload.status || 'Mapped',
      });
      break;
    case 'updateDroneMapping': {
      const drone = state.drone.find((d) => d.id === payload.drone_id);
      if (drone) Object.assign(drone, {
        name: payload.name ?? drone.name,
        center_lat: Number(payload.center_lat ?? drone.center_lat ?? 0),
        center_lng: Number(payload.center_lng ?? drone.center_lng ?? 0),
        area_hectares: Number(payload.area_hectares ?? drone.area_hectares ?? 0),
        nitrogen: Number(payload.nitrogen ?? drone.nitrogen ?? 0),
        phosphorus: Number(payload.phosphorus ?? drone.phosphorus ?? 0),
        potassium: Number(payload.potassium ?? drone.potassium ?? 0),
        organic_matter: Number(payload.organic_matter ?? drone.organic_matter ?? 0),
        ph: Number(payload.ph ?? drone.ph ?? 0),
        moisture: Number(payload.moisture ?? drone.moisture ?? 0),
        classification: payload.classification ?? drone.classification,
        notes: payload.notes ?? drone.notes,
        image_url: payload.image_url ?? drone.image_url,
        captured_at: payload.captured_at ?? drone.captured_at,
        status: payload.status ?? drone.status,
        ...(payload.geojson ? { boundary: clone(payload.geojson) } : {}),
      });
      break;
    }
    case 'deleteDroneMapping':
      state.drone = state.drone.filter((d) => d.id !== payload.drone_id);
      break;
    default:
      throw new Error(`Unknown demo action: ${action}`);
  }

  return save(state);
}
