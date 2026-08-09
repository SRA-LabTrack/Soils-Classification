import { Query } from 'appwrite';

const endpoint = (process.env.VITE_APPWRITE_ENDPOINT || '').replace(/\/$/, '');
const projectId = process.env.VITE_APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;
const databaseId = process.env.VITE_APPWRITE_DATABASE_ID || 'soils_database';

const tables = {
  profiles: process.env.VITE_APPWRITE_PROFILES_TABLE_ID || 'profiles',
  farms: process.env.VITE_APPWRITE_FARMS_TABLE_ID || 'farms',
  sensors: process.env.VITE_APPWRITE_SENSORS_TABLE_ID || 'sensor_stations',
  readings: process.env.VITE_APPWRITE_READINGS_TABLE_ID || 'sensor_readings',
  plots: process.env.VITE_APPWRITE_PLOTS_TABLE_ID || 'soil_plots',
  analyses: process.env.VITE_APPWRITE_ANALYSES_TABLE_ID || 'soil_analyses',
  drone: process.env.VITE_APPWRITE_DRONE_TABLE_ID || 'drone_mappings',
};

const uid = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`.slice(0, 36);
const now = () => new Date().toISOString();

function ensureConfig() {
  if (!endpoint || !projectId) throw new Error('Missing Appwrite endpoint/project configuration.');
  if (!apiKey) throw new Error('APPWRITE_API_KEY is blank on the server.');
}

async function appwriteFetch(path, { method = 'GET', body, jwt, key = false, allow404 = false } = {}) {
  ensureConfig();
  const headers = {
    'Content-Type': 'application/json',
    'X-Appwrite-Project': projectId,
    'X-Appwrite-Response-Format': '1.9.5',
  };
  if (key) headers['X-Appwrite-Key'] = apiKey;
  if (jwt) headers['X-Appwrite-JWT'] = jwt;
  const res = await fetch(`${endpoint}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (allow404 && res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(data?.message || `${method} ${path} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function verifyAdmin(jwt) {
  if (!jwt) {
    const err = new Error('Missing admin JWT. Sign in again and retry.');
    err.status = 401;
    throw err;
  }
  const user = await appwriteFetch('/account', { jwt });
  if (!user?.labels?.includes('admin')) {
    const err = new Error('Administrator access required.');
    err.status = 403;
    throw err;
  }
  return user;
}

const perms = (farmerId) => [
  'read("label:admin")',
  'update("label:admin")',
  'delete("label:admin")',
  ...(farmerId ? [`read("user:${farmerId}")`] : []),
];

async function createRow(tableId, rowId, data, permissions) {
  return appwriteFetch(`/tablesdb/${databaseId}/tables/${tableId}/rows`, {
    method: 'POST', key: true, body: { rowId, data, permissions },
  });
}
async function updateRow(tableId, rowId, data, permissions) {
  return appwriteFetch(`/tablesdb/${databaseId}/tables/${tableId}/rows/${rowId}`, {
    method: 'PATCH', key: true, body: { data, ...(permissions ? { permissions } : {}) },
  });
}
async function deleteRow(tableId, rowId) {
  return appwriteFetch(`/tablesdb/${databaseId}/tables/${tableId}/rows/${rowId}`, { method: 'DELETE', key: true, allow404: true });
}
async function getRow(tableId, rowId) {
  return appwriteFetch(`/tablesdb/${databaseId}/tables/${tableId}/rows/${rowId}`, { key: true, allow404: true });
}
async function listRows(tableId, queries = []) {
  const params = new URLSearchParams();
  for (const query of [...queries, Query.limit(500)]) params.append('queries[]', query);
  return appwriteFetch(`/tablesdb/${databaseId}/tables/${tableId}/rows?${params.toString()}`, { key: true });
}
async function deleteRowsWhere(tableId, column, value) {
  const result = await listRows(tableId, [Query.equal(column, [value])]);
  const rows = result?.rows || [];
  if (!rows.length) return;
  await Promise.all(rows.map((row) => deleteRow(tableId, row.$id)));
}

async function createFarmer(payload) {
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!name || !email || password.length < 8) {
    const err = new Error('Farmer name, valid email, and password of at least 8 characters are required.');
    err.status = 400; throw err;
  }
  const farmerId = uid('farmer');
  const farmId = uid('farm');
  await appwriteFetch('/users', { method:'POST', key:true, body:{ userId:farmerId, email, password, name } });
  await appwriteFetch(`/users/${farmerId}/labels`, { method:'PUT', key:true, body:{ labels:['farmer'] } });
  const rowPermissions = perms(farmerId);
  try {
    await createRow(tables.profiles, uid('profile'), {
      user_id: farmerId, full_name:name, email, role:'farmer', active:true, farm_id:farmId,
    }, rowPermissions);
    const centerLat = Number(payload.center_lat ?? 10.4247);
    const centerLng = Number(payload.center_lng ?? 122.9225);
    await createRow(tables.farms, farmId, {
      farmer_id: farmerId,
      farmer_name: name,
      name: String(payload.farm_name || `${name}'s Farm`).trim(),
      location_name: String(payload.location_name || 'Farm location not set').trim(),
      center_lat: Number.isFinite(centerLat) ? centerLat : 10.4247,
      center_lng: Number.isFinite(centerLng) ? centerLng : 122.9225,
      boundary_geojson: '[]',
      area_hectares: 0,
      status: 'Unmapped',
      last_analysis_at: null,
    }, rowPermissions);
  } catch (err) {
    await appwriteFetch(`/users/${farmerId}`, { method:'DELETE', key:true, allow404:true }).catch(()=>{});
    throw err;
  }
  return { farmerId, farmId };
}

async function deleteFarmer(payload) {
  const farmerId = payload.farmer_id;
  const farmId = payload.farm_id;
  if (!farmerId || !farmId) throw Object.assign(new Error('Farmer ID and farm ID are required.'), { status:400 });
  await deleteRowsWhere(tables.readings, 'farm_id', farmId);
  await deleteRowsWhere(tables.analyses, 'farm_id', farmId);
  await deleteRowsWhere(tables.sensors, 'farm_id', farmId);
  await deleteRowsWhere(tables.plots, 'farm_id', farmId);
  await deleteRowsWhere(tables.drone, 'farm_id', farmId).catch(()=>{});
  await deleteRow(tables.farms, farmId);
  const profiles = await listRows(tables.profiles, [Query.equal('user_id', [farmerId])]);
  for (const profile of profiles?.rows || []) await deleteRow(tables.profiles, profile.$id);
  await appwriteFetch(`/users/${farmerId}`, { method:'DELETE', key:true, allow404:true });
  return { deleted:true };
}

async function updateFarmBoundary(payload) {
  const farm = await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  return updateRow(tables.farms, payload.farm_id, {
    boundary_geojson: JSON.stringify(payload.geojson || []),
    center_lat: Number(payload.center_lat),
    center_lng: Number(payload.center_lng),
    area_hectares: Number(payload.area_hectares || 0),
    status: payload.status || 'Mapped',
  }, perms(farm.farmer_id));
}
async function deleteFarmBoundary(payload) {
  const farm = await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  return updateRow(tables.farms, payload.farm_id, { boundary_geojson:'[]', area_hectares:0, status:'Unmapped' }, perms(farm.farmer_id));
}

async function createSensor(payload) {
  const farm = await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  const sensorId = uid('sensor');
  const permission = perms(farm.farmer_id);
  await createRow(tables.sensors, sensorId, {
    farm_id: payload.farm_id,
    sensor_code: String(payload.sensor_code || 'Sensor').trim(),
    latitude: Number(payload.latitude), longitude: Number(payload.longitude),
    coverage_m: Number(payload.coverage_m || 50),
    status: payload.status || 'Online', installed_at: now(), last_seen_at: now(),
  }, permission);
  const readingId = uid('reading');
  await createRow(tables.readings, readingId, {
    farm_id: payload.farm_id, sensor_id:sensorId,
    nitrogen:Number(payload.nitrogen || 0), phosphorus:Number(payload.phosphorus || 0), potassium:Number(payload.potassium || 0),
    ph:Number(payload.ph || 0), organic_matter:Number(payload.organic_matter || 0), moisture:Number(payload.moisture || 0), recorded_at:now(),
  }, permission);
  return { sensorId, readingId };
}
async function updateSensor(payload) {
  const sensor = await getRow(tables.sensors, payload.sensor_id);
  if (!sensor) throw Object.assign(new Error('Sensor not found.'), { status:404 });
  const farm = await getRow(tables.farms, sensor.farm_id);
  const permission = perms(farm?.farmer_id);
  await updateRow(tables.sensors, payload.sensor_id, {
    sensor_code:String(payload.sensor_code || sensor.sensor_code), latitude:Number(payload.latitude ?? sensor.latitude), longitude:Number(payload.longitude ?? sensor.longitude),
    coverage_m:Number(payload.coverage_m ?? sensor.coverage_m), status:payload.status || sensor.status || 'Online', last_seen_at:now(),
  }, permission);
  const readingId = uid('reading');
  await createRow(tables.readings, readingId, {
    farm_id:sensor.farm_id, sensor_id:payload.sensor_id,
    nitrogen:Number(payload.nitrogen || 0), phosphorus:Number(payload.phosphorus || 0), potassium:Number(payload.potassium || 0),
    ph:Number(payload.ph || 0), organic_matter:Number(payload.organic_matter || 0), moisture:Number(payload.moisture || 0), recorded_at:now(),
  }, permission);
  return { readingId };
}
async function deleteSensor(payload) {
  await deleteRowsWhere(tables.readings, 'sensor_id', payload.sensor_id);
  await deleteRow(tables.sensors, payload.sensor_id);
  return { deleted:true };
}

async function createPlot(payload) {
  const farm = await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  const plotId = uid('plot');
  const permission = perms(farm.farmer_id);
  await createRow(tables.plots, plotId, {
    farm_id:payload.farm_id, plot_code:String(payload.plot_code || 'SOIL-PLOT').trim(),
    latitude:Number(payload.latitude), longitude:Number(payload.longitude), coverage_m:Number(payload.coverage_m || 0),
    boundary_geojson:JSON.stringify(payload.geojson || []), sampled_at:payload.sampled_at || now(),
  }, permission);
  const analysisId = uid('analysis');
  await createRow(tables.analyses, analysisId, {
    farm_id:payload.farm_id, plot_id:plotId,
    nitrogen:Number(payload.nitrogen || 0), phosphorus:Number(payload.phosphorus || 0), potassium:Number(payload.potassium || 0),
    ph:Number(payload.ph || 0), organic_matter:Number(payload.organic_matter || 0), classification:payload.classification || 'Pending',
    sampled_at:payload.sampled_at || now(), analyzed_at:payload.analyzed_at || now(), notes:String(payload.notes || ''),
  }, permission);
  return { plotId, analysisId };
}
async function updatePlot(payload) {
  const plot = await getRow(tables.plots, payload.plot_id);
  if (!plot) throw Object.assign(new Error('Soil plot not found.'), { status:404 });
  const farm = await getRow(tables.farms, plot.farm_id);
  const permission = perms(farm?.farmer_id);
  await updateRow(tables.plots, payload.plot_id, {
    plot_code:String(payload.plot_code || plot.plot_code),
    latitude:Number(payload.latitude ?? plot.latitude), longitude:Number(payload.longitude ?? plot.longitude),
    coverage_m:Number(payload.coverage_m ?? plot.coverage_m),
    ...(payload.geojson ? { boundary_geojson:JSON.stringify(payload.geojson) } : {}),
  }, permission);
  const existing = await listRows(tables.analyses, [Query.equal('plot_id', [payload.plot_id]), Query.orderDesc('analyzed_at')]);
  const analysis = existing?.rows?.[0];
  const data = {
    nitrogen:Number(payload.nitrogen || 0), phosphorus:Number(payload.phosphorus || 0), potassium:Number(payload.potassium || 0),
    ph:Number(payload.ph || 0), organic_matter:Number(payload.organic_matter || 0), classification:payload.classification || 'Pending',
    analyzed_at:now(), notes:String(payload.notes || ''),
  };
  if (analysis) await updateRow(tables.analyses, analysis.$id, data, permission);
  else await createRow(tables.analyses, uid('analysis'), { farm_id:plot.farm_id, plot_id:payload.plot_id, sampled_at:now(), ...data }, perms(farm?.farmer_id));
  return { updated:true };
}
async function deletePlot(payload) {
  await deleteRowsWhere(tables.analyses, 'plot_id', payload.plot_id);
  await deleteRow(tables.plots, payload.plot_id);
  return { deleted:true };
}

async function createDroneMapping(payload) {
  const farm = await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  if (!Array.isArray(payload.geojson) || payload.geojson.length < 3) {
    throw Object.assign(new Error('Drone mapping needs at least 3 polygon points.'), { status:400 });
  }
  const id = uid('drone');
  const data = {
    farm_id:payload.farm_id,
    name:String(payload.name || 'Drone Mapping').trim(),
    boundary_geojson:JSON.stringify(payload.geojson),
    center_lat:Number(payload.center_lat || 0),
    center_lng:Number(payload.center_lng || 0),
    area_hectares:Number(payload.area_hectares || 0),
    nitrogen:Number(payload.nitrogen || 0),
    phosphorus:Number(payload.phosphorus || 0),
    potassium:Number(payload.potassium || 0),
    ph:Number(payload.ph || 0),
    organic_matter:Number(payload.organic_matter || 0),
    moisture:Number(payload.moisture || 0),
    classification:String(payload.classification || 'Unclassified'),
    notes:String(payload.notes || ''),
    image_url:String(payload.image_url || ''),
    captured_at:payload.captured_at || now(),
    status:payload.status || 'Mapped',
  };
  try {
    await createRow(tables.drone, id, data, perms(farm.farmer_id));
  } catch (err) {
    if (err.status === 404) throw Object.assign(new Error('The drone_mappings table or one of its columns is missing. Run npm.cmd run setup:appwrite, then retry.'), { status:400 });
    throw err;
  }
  return { droneId:id, row:{ id, ...data } };
}

async function updateDroneMapping(payload) {
  if (!payload.drone_id) throw Object.assign(new Error('Drone mapping ID is required.'), { status:400 });
  const existing = await getRow(tables.drone, payload.drone_id);
  if (!existing) throw Object.assign(new Error('Drone mapping not found.'), { status:404 });
  const data = {
    name:String(payload.name ?? existing.name ?? 'Drone Mapping'),
    center_lat:Number(payload.center_lat ?? existing.center_lat ?? 0),
    center_lng:Number(payload.center_lng ?? existing.center_lng ?? 0),
    area_hectares:Number(payload.area_hectares ?? existing.area_hectares ?? 0),
    nitrogen:Number(payload.nitrogen ?? existing.nitrogen ?? 0),
    phosphorus:Number(payload.phosphorus ?? existing.phosphorus ?? 0),
    potassium:Number(payload.potassium ?? existing.potassium ?? 0),
    ph:Number(payload.ph ?? existing.ph ?? 0),
    organic_matter:Number(payload.organic_matter ?? existing.organic_matter ?? 0),
    moisture:Number(payload.moisture ?? existing.moisture ?? 0),
    classification:String(payload.classification ?? existing.classification ?? 'Unclassified'),
    notes:String(payload.notes ?? existing.notes ?? ''),
    image_url:String(payload.image_url ?? existing.image_url ?? ''),
    captured_at:payload.captured_at || existing.captured_at || now(),
    status:payload.status || existing.status || 'Mapped',
    ...(payload.geojson ? { boundary_geojson:JSON.stringify(payload.geojson) } : {}),
  };
  try {
    const farm = await getRow(tables.farms, existing.farm_id);
    await updateRow(tables.drone, payload.drone_id, data, perms(farm?.farmer_id));
  } catch (err) {
    if (err.status === 404) throw Object.assign(new Error('The drone_mappings table or one of its columns is missing. Run npm.cmd run setup:appwrite, then retry.'), { status:400 });
    throw err;
  }
  return { updated:true, row:{ id:payload.drone_id, farm_id:existing.farm_id, ...data } };
}

async function deleteDroneMapping(payload) {
  if (!payload.drone_id) throw Object.assign(new Error('Drone mapping ID is required.'), { status:400 });
  try {
    const existing = await getRow(tables.drone, payload.drone_id);
    if (!existing) throw Object.assign(new Error('Drone mapping not found.'), { status:404 });
    await deleteRow(tables.drone, payload.drone_id);
  } catch (err) {
    if (err.status === 404) throw Object.assign(new Error('Drone mapping could not be found. If this is an older project, run npm.cmd run setup:appwrite once and refresh.'), { status:400 });
    throw err;
  }
  return { deleted:true, droneId:payload.drone_id };
}

const actions = {
  createFarmer, deleteFarmer, updateFarmBoundary, deleteFarmBoundary,
  createSensor, updateSensor, deleteSensor,
  createPlot, updatePlot, deletePlot,
  createDroneMapping, updateDroneMapping, deleteDroneMapping,
};

export async function handleAdminAction({ jwt, action, payload = {} }) {
  await verifyAdmin(jwt);
  const fn = actions[action];
  if (!fn) throw Object.assign(new Error(`Unknown admin action: ${action}`), { status:400 });
  return fn(payload);
}
