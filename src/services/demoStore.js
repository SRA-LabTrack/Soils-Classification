import { demoDroneMappings, demoFarms, demoPlots, demoSensors } from '../data/demoData';

export const DEMO_STORE_KEY = 'soils_demo_workspace_v1_3';
const KEY = DEMO_STORE_KEY;
const clone = (value) => JSON.parse(JSON.stringify(value));
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function initialState() {
  return {
    farms: clone(demoFarms),
    sensors: clone(demoSensors),
    plots: clone(demoPlots),
    drone: clone(demoDroneMappings),
  };
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
      if (farm) Object.assign(farm, {
        boundary: clone(payload.geojson || []),
        center_lat: Number(payload.center_lat),
        center_lng: Number(payload.center_lng),
        area_hectares: Number(payload.area_hectares || 0),
        status: payload.status || 'Mapped',
      });
      break;
    }
    case 'deleteFarmBoundary': {
      const farm = farmById(payload.farm_id);
      if (farm) Object.assign(farm, { boundary: [], area_hectares: 0, status: 'Unmapped' });
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
