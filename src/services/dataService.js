import { APPWRITE, Query, tablesDB, realtime, Channel } from '../lib/appwrite';

export const parseBoundaries = (value, fallback=[]) => {
  if (!value) {
    if (Array.isArray(fallback?.[0]?.[0])) return fallback;
    return Array.isArray(fallback) && fallback.length ? [fallback] : [];
  }
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed?.type === 'MultiPolygon') {
      return (parsed.coordinates || []).map(poly => (poly?.[0] || []).map(([lng,lat]) => [lat,lng])).filter(poly=>poly.length>=3);
    }
    if (parsed?.type === 'Polygon') {
      const poly=(parsed.coordinates?.[0] || []).map(([lng,lat]) => [lat,lng]);
      return poly.length ? [poly] : [];
    }
    if (Array.isArray(parsed)) {
      if (parsed.length && Array.isArray(parsed[0]) && parsed[0].length>=2 && Number.isFinite(Number(parsed[0][0])) && Number.isFinite(Number(parsed[0][1]))) return [parsed];
      if (parsed.length && Array.isArray(parsed[0]) && Array.isArray(parsed[0][0])) return parsed;
    }
  } catch {}
  if (Array.isArray(fallback?.[0]?.[0])) return fallback;
  return Array.isArray(fallback) && fallback.length ? [fallback] : [];
};

export const parseBoundary = (value, fallback=[]) => parseBoundaries(value,fallback)[0] || [];


// v1.10.26 clean generation. Existing Sensor / Soil Plot / Drone rows created
// before this overhaul are intentionally archived out of the active workspace.
// New rows created after the cutoff remain fully visible and synchronized.
export const SPATIAL_RESET_AT='2026-08-11T06:08:00.000Z';
const spatialResetMs=Date.parse(SPATIAL_RESET_AT);
export const isCurrentSpatialRow=(row)=>{
  const created=Date.parse(row?.$createdAt||row?.created_at||'');
  return !Number.isFinite(created) || created>=spatialResetMs;
};
const currentSpatialRows=(rows=[])=>rows.filter(isCurrentSpatialRow);

const normalizeFarm = (row) => {
  const boundaries=parseBoundaries(row.boundary_geojson, row.boundaries || row.boundary || []);
  return { ...row, id:row.$id || row.id, boundaries, boundary:boundaries[0] || [] };
};

const uniqueById = (rows=[]) => {
  const seen=new Set();
  return rows.filter((row)=>{
    const id=row?.$id || row?.id;
    if(!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const boundaryCenter = (boundary=[]) => {
  if (!boundary.length) return { latitude:0, longitude:0 };
  return {
    latitude: boundary.reduce((sum,p)=>sum+Number(p[0]||0),0)/boundary.length,
    longitude: boundary.reduce((sum,p)=>sum+Number(p[1]||0),0)/boundary.length,
  };
};

const normalizeDrone = (row) => {
  const boundary=parseBoundary(row.boundary_geojson, row.boundary || []);
  const center=boundaryCenter(boundary);
  return {
    ...row,
    id:row.$id || row.id,
    boundary,
    latitude:Number(row.center_lat ?? row.latitude ?? center.latitude),
    longitude:Number(row.center_lng ?? row.longitude ?? center.longitude),
    center_lat:Number(row.center_lat ?? row.latitude ?? center.latitude),
    center_lng:Number(row.center_lng ?? row.longitude ?? center.longitude),
  };
};

export async function listFarms() {
  const result = await tablesDB.listRows({
    databaseId: APPWRITE.databaseId,
    tableId: APPWRITE.tables.farms,
    queries: [Query.orderAsc('farmer_name'), Query.limit(200)],
    ttl: 0,
    total: false,
  });
  return uniqueById(result.rows).map(normalizeFarm);
}

export async function listAllSensors() {
  const sensors = await tablesDB.listRows({ databaseId:APPWRITE.databaseId, tableId:APPWRITE.tables.sensors, queries:[Query.limit(500)], ttl:0, total:false });
  const rows=currentSpatialRows(uniqueById(sensors.rows));
  const needsLegacyReadings=rows.some(row=>!Object.prototype.hasOwnProperty.call(row,'recorded_at'));
  if(!needsLegacyReadings)return rows.map(sensor=>({...sensor,id:sensor.$id||sensor.id}));
  const readings=await tablesDB.listRows({ databaseId:APPWRITE.databaseId, tableId:APPWRITE.tables.readings, queries:[Query.orderDesc('recorded_at'), Query.limit(500)], ttl:0, total:false });
  const latest = new Map();
  for (const reading of readings.rows) if (!latest.has(reading.sensor_id)) latest.set(reading.sensor_id, reading);
  return rows.map((sensor) => ({ ...sensor, id:sensor.$id||sensor.id, ...latest.get(sensor.$id||sensor.id) }));
}

export async function listAllPlots() {
  const plots = await tablesDB.listRows({ databaseId:APPWRITE.databaseId, tableId:APPWRITE.tables.plots, queries:[Query.limit(500)], ttl:0, total:false });
  // Defensive fallback for any direct Appwrite read path: a Soil Plot without a
  // valid polygon is an orphan record, not a map source.
  const rows=currentSpatialRows(uniqueById(plots.rows)).filter(row=>parseBoundary(row.boundary_geojson).length>=3);
  const needsLegacyAnalyses=rows.some(row=>!Object.prototype.hasOwnProperty.call(row,'analyzed_at'));
  if(!needsLegacyAnalyses)return rows.map(plot=>({ ...plot,id:plot.$id||plot.id,boundary:parseBoundary(plot.boundary_geojson) }));
  const analyses=await tablesDB.listRows({ databaseId:APPWRITE.databaseId, tableId:APPWRITE.tables.analyses, queries:[Query.orderDesc('analyzed_at'), Query.limit(500)], ttl:0, total:false });
  const latest = new Map();
  for (const row of analyses.rows) if (!latest.has(row.plot_id)) latest.set(row.plot_id, row);
  return rows.map((plot)=>({ ...plot, id:plot.$id||plot.id, boundary:parseBoundary(plot.boundary_geojson), ...latest.get(plot.$id||plot.id) }));
}

export async function listAllDroneMappings() {
  const result = await tablesDB.listRows({ databaseId:APPWRITE.databaseId, tableId:APPWRITE.tables.drone, queries:[Query.limit(500)], ttl:0, total:false }).catch(()=>({rows:[]}));
  return currentSpatialRows(uniqueById(result.rows)).map(normalizeDrone);
}


export async function getAssignedFarmId(userId) {
  if (!userId) return null;
  try {
    const profiles = await tablesDB.listRows({
      databaseId: APPWRITE.databaseId,
      tableId: APPWRITE.tables.profiles,
      queries: [Query.equal('user_id', [userId]), Query.limit(1)],
      ttl: 0,
      total: false,
    });
    const profileFarmId = profiles.rows?.[0]?.farm_id;
    if (profileFarmId) return profileFarmId;
  } catch {}

  const farms = await tablesDB.listRows({
    databaseId: APPWRITE.databaseId,
    tableId: APPWRITE.tables.farms,
    queries: [Query.equal('farmer_id', [userId]), Query.limit(1)],
    ttl: 0,
    total: false,
  });
  return farms.rows?.[0]?.$id || null;
}

export async function loadFarmerWorkspace(userId) {
  const farmId = await getAssignedFarmId(userId);
  if (!farmId) return { farmId:null, bundle:null };
  return { farmId, bundle:await loadFarmBundle(farmId) };
}

export async function subscribeFarmChanges(farmId, onChange) {
  if (!farmId || typeof onChange !== 'function') return () => {};

  // Every Admin spatial mutation writes one compact journal row. Subscribe only
  // to that farm-scoped journal instead of six child tables, which prevents
  // duplicate callbacks and keeps Appwrite Realtime message usage low.
  const changeChannel = Channel.tablesdb(APPWRITE.databaseId).table(APPWRITE.tables.changes).row();
  let subscription=null;
  try {
    subscription=await realtime.subscribe(changeChannel,onChange,[Query.equal('farm_id',[farmId])]);
  } catch (error) {
    try { await subscription?.unsubscribe?.(); } catch {}
    throw error;
  }
  return async () => { try { await subscription?.unsubscribe?.(); } catch {} };
}


export async function subscribeSupportChanges(farmerId, onChange, {admin=false}={}) {
  if (typeof onChange !== 'function') return () => {};
  const supportChannel=Channel.tablesdb(APPWRITE.databaseId).table(APPWRITE.tables.support).row();
  const requestChannel=Channel.tablesdb(APPWRITE.databaseId).table(APPWRITE.tables.requests).row();
  const subscriptions=[];
  const errors=[];
  if(admin){
    // Subscribe independently so a missing/partially migrated support table does
    // not prevent spatial request notifications, and vice versa.
    for(const channel of [supportChannel,requestChannel]){
      try{subscriptions.push(await realtime.subscribe(channel,onChange,[]));}
      catch(error){errors.push(error);}
    }
    if(!subscriptions.length)throw errors[0]||new Error('Support Realtime could not connect.');
  }else{
    try{
      const queries=farmerId?[Query.equal('farmer_id',[farmerId])]:[];
      subscriptions.push(await realtime.subscribe(supportChannel,onChange,queries));
    }catch(error){throw error;}
  }
  return async () => { for(const subscription of subscriptions){try{await subscription?.unsubscribe?.();}catch{}} };
}

const farmBundleRequests = new Map();

async function fetchFarmBundle(farmId) {
  // Current rows carry their latest nutrient snapshot, so the common path is
  // only four Appwrite reads (farm + sensors + plots + drone). Older databases
  // transparently fall back to the history tables until setup migrates them.
  const [farm, sensorsResult, plotsResult, droneResult] = await Promise.all([
    tablesDB.getRow({ databaseId: APPWRITE.databaseId, tableId: APPWRITE.tables.farms, rowId: farmId }),
    tablesDB.listRows({ databaseId: APPWRITE.databaseId, tableId: APPWRITE.tables.sensors, queries: [Query.equal('farm_id', [farmId]), Query.limit(200)], ttl: 0, total:false }),
    tablesDB.listRows({ databaseId: APPWRITE.databaseId, tableId: APPWRITE.tables.plots, queries: [Query.equal('farm_id', [farmId]), Query.limit(200)], ttl: 0, total:false }),
    tablesDB.listRows({ databaseId: APPWRITE.databaseId, tableId: APPWRITE.tables.drone, queries: [Query.equal('farm_id', [farmId]), Query.limit(200)], ttl: 0, total:false }).catch(() => ({rows:[]})),
  ]);

  const sensorRows=currentSpatialRows(uniqueById(sensorsResult.rows));
  const plotRowsRaw=currentSpatialRows(uniqueById(plotsResult.rows)).filter(row=>parseBoundary(row.boundary_geojson).length>=3);
  const needsLegacyReadings=sensorRows.some(row=>!Object.prototype.hasOwnProperty.call(row,'recorded_at'));
  const needsLegacyAnalyses=plotRowsRaw.some(row=>!Object.prototype.hasOwnProperty.call(row,'analyzed_at'));
  const [readingsResult,analysesResult]=await Promise.all([
    needsLegacyReadings?tablesDB.listRows({ databaseId: APPWRITE.databaseId, tableId: APPWRITE.tables.readings, queries: [Query.equal('farm_id', [farmId]), Query.orderDesc('recorded_at'), Query.limit(500)], ttl: 0, total:false }):Promise.resolve({rows:[]}),
    needsLegacyAnalyses?tablesDB.listRows({ databaseId: APPWRITE.databaseId, tableId: APPWRITE.tables.analyses, queries: [Query.equal('farm_id', [farmId]), Query.orderDesc('analyzed_at'), Query.limit(500)], ttl: 0, total:false }):Promise.resolve({rows:[]}),
  ]);

  const latestReading = new Map();
  for (const reading of readingsResult.rows) if (!latestReading.has(reading.sensor_id)) latestReading.set(reading.sensor_id, reading);
  const latestAnalysis = new Map();
  for (const analysis of analysesResult.rows) if (!latestAnalysis.has(analysis.plot_id)) latestAnalysis.set(analysis.plot_id, analysis);

  const plots=plotRowsRaw;
  return {
    farm: normalizeFarm(farm),
    sensors: sensorRows.map((sensor) => ({ ...sensor, id:sensor.$id||sensor.id, ...latestReading.get(sensor.$id||sensor.id) })),
    plots: plots.map((plot) => ({ ...plot, id:plot.$id||plot.id, boundary:parseBoundary(plot.boundary_geojson), ...latestAnalysis.get(plot.$id||plot.id) })),
    droneMappings: currentSpatialRows(uniqueById(droneResult.rows)).map(normalizeDrone),
  };
}

export async function loadFarmBundle(farmId) {
  if (!farmId) return null;
  const existing=farmBundleRequests.get(farmId);
  if (existing) return existing;
  const request=fetchFarmBundle(farmId);
  farmBundleRequests.set(farmId,request);
  try {
    return await request;
  } finally {
    if (farmBundleRequests.get(farmId)===request) farmBundleRequests.delete(farmId);
  }
}
