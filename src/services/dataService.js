import { APPWRITE, Query, tablesDB, realtime, Channel } from '../lib/appwrite';

export const parseBoundary = (value, fallback=[]) => {
  if (!value) return fallback;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed?.type === 'Polygon') return parsed.coordinates[0].map(([lng, lat]) => [lat, lng]);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return fallback;
};

const normalizeFarm = (row) => ({ ...row, id:row.$id || row.id, boundary:parseBoundary(row.boundary_geojson, row.boundary || []) });

const uniqueById = (rows=[]) => {
  const seen=new Set();
  return rows.filter((row)=>{
    const id=row?.$id || row?.id;
    if(!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const latestByKey = (rows=[], keyFn) => {
  const map=new Map();
  for(const row of rows){
    const key=keyFn(row);
    if(!key){ map.set(`id:${row?.$id||row?.id||Math.random()}`,row); continue; }
    const prev=map.get(key);
    const stamp=Date.parse(row?.$updatedAt||row?.$createdAt||0)||0;
    const prevStamp=Date.parse(prev?.$updatedAt||prev?.$createdAt||0)||0;
    if(!prev || stamp>=prevStamp) map.set(key,row);
  }
  return [...map.values()];
};

const recordNameKey=(row,field)=>{
  const name=String(row?.[field]||'').trim().toLowerCase().replace(/\s+/g,' ');
  return name ? `${row?.farm_id||''}::${name}` : `id:${row?.$id||row?.id||Math.random()}`;
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
  const [sensors, readings] = await Promise.all([
    tablesDB.listRows({ databaseId:APPWRITE.databaseId, tableId:APPWRITE.tables.sensors, queries:[Query.limit(500)], ttl:0, total:false }),
    tablesDB.listRows({ databaseId:APPWRITE.databaseId, tableId:APPWRITE.tables.readings, queries:[Query.orderDesc('recorded_at'), Query.limit(500)], ttl:0, total:false }),
  ]);
  const latest = new Map();
  for (const reading of readings.rows) if (!latest.has(reading.sensor_id)) latest.set(reading.sensor_id, reading);
  return uniqueById(sensors.rows).map((sensor) => ({ ...sensor, id:sensor.$id, ...latest.get(sensor.$id) }));
}

export async function listAllPlots() {
  const [plots, analyses] = await Promise.all([
    tablesDB.listRows({ databaseId:APPWRITE.databaseId, tableId:APPWRITE.tables.plots, queries:[Query.limit(500)], ttl:0, total:false }),
    tablesDB.listRows({ databaseId:APPWRITE.databaseId, tableId:APPWRITE.tables.analyses, queries:[Query.orderDesc('analyzed_at'), Query.limit(500)], ttl:0, total:false }),
  ]);
  const latest = new Map();
  for (const row of analyses.rows) if (!latest.has(row.plot_id)) latest.set(row.plot_id, row);
  const valid=uniqueById(plots.rows).filter((plot)=>latest.has(plot.$id));
  return latestByKey(valid,(row)=>recordNameKey(row,'plot_code')).map((plot)=>({ ...plot, id:plot.$id, boundary:parseBoundary(plot.boundary_geojson), ...latest.get(plot.$id) }));
}

export async function listAllDroneMappings() {
  const result = await tablesDB.listRows({ databaseId:APPWRITE.databaseId, tableId:APPWRITE.tables.drone, queries:[Query.limit(500)], ttl:0, total:false }).catch(()=>({rows:[]}));
  return latestByKey(uniqueById(result.rows),(row)=>recordNameKey(row,'name')).map(normalizeDrone);
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

  const farmChannel = Channel.tablesdb(APPWRITE.databaseId).table(APPWRITE.tables.farms).row(farmId);
  const scopedChannels = [
    APPWRITE.tables.sensors,
    APPWRITE.tables.readings,
    APPWRITE.tables.plots,
    APPWRITE.tables.analyses,
    APPWRITE.tables.drone,
  ].map((tableId) => Channel.tablesdb(APPWRITE.databaseId).table(tableId).row());

  const subscriptions = [];
  try {
    subscriptions.push(await realtime.subscribe(farmChannel, onChange));
    subscriptions.push(await realtime.subscribe(scopedChannels, onChange, [Query.equal('farm_id', [farmId])]));
  } catch (error) {
    for (const subscription of subscriptions) {
      try { await subscription?.unsubscribe?.(); } catch {}
    }
    throw error;
  }

  return async () => {
    for (const subscription of subscriptions) {
      try { await subscription?.unsubscribe?.(); } catch {}
    }
  };
}

export async function loadFarmBundle(farmId) {
  const [farm, sensorsResult, readingsResult, plotsResult, analysesResult, droneResult] = await Promise.all([
    tablesDB.getRow({ databaseId: APPWRITE.databaseId, tableId: APPWRITE.tables.farms, rowId: farmId }),
    tablesDB.listRows({ databaseId: APPWRITE.databaseId, tableId: APPWRITE.tables.sensors, queries: [Query.equal('farm_id', [farmId]), Query.limit(200)], ttl: 0, total:false }),
    tablesDB.listRows({ databaseId: APPWRITE.databaseId, tableId: APPWRITE.tables.readings, queries: [Query.equal('farm_id', [farmId]), Query.orderDesc('recorded_at'), Query.limit(500)], ttl: 0, total:false }),
    tablesDB.listRows({ databaseId: APPWRITE.databaseId, tableId: APPWRITE.tables.plots, queries: [Query.equal('farm_id', [farmId]), Query.limit(200)], ttl: 0, total:false }),
    tablesDB.listRows({ databaseId: APPWRITE.databaseId, tableId: APPWRITE.tables.analyses, queries: [Query.equal('farm_id', [farmId]), Query.orderDesc('analyzed_at'), Query.limit(500)], ttl: 0, total:false }),
    tablesDB.listRows({ databaseId: APPWRITE.databaseId, tableId: APPWRITE.tables.drone, queries: [Query.equal('farm_id', [farmId]), Query.limit(200)], ttl: 0, total:false }).catch(() => ({rows:[]})),
  ]);

  const latestReading = new Map();
  for (const reading of readingsResult.rows) if (!latestReading.has(reading.sensor_id)) latestReading.set(reading.sensor_id, reading);
  const latestAnalysis = new Map();
  for (const analysis of analysesResult.rows) if (!latestAnalysis.has(analysis.plot_id)) latestAnalysis.set(analysis.plot_id, analysis);

  const plotRows=latestByKey(uniqueById(plotsResult.rows).filter((plot)=>latestAnalysis.has(plot.$id)),(row)=>recordNameKey(row,'plot_code'));
  const droneRows=latestByKey(uniqueById(droneResult.rows),(row)=>recordNameKey(row,'name'));
  return {
    farm: normalizeFarm(farm),
    sensors: uniqueById(sensorsResult.rows).map((sensor) => ({ ...sensor, id:sensor.$id, ...latestReading.get(sensor.$id) })),
    plots: plotRows.map((plot) => ({ ...plot, id:plot.$id, boundary:parseBoundary(plot.boundary_geojson), ...latestAnalysis.get(plot.$id) })),
    droneMappings: droneRows.map(normalizeDrone),
  };
}
