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
  changes: process.env.APPWRITE_SPATIAL_CHANGES_TABLE_ID || 'spatial_changes',
};

const uid = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`.slice(0, 36);
const now = () => new Date().toISOString();

const uniqueRows = (rows=[]) => {
  const seen=new Set();
  return rows.filter((row)=>{
    const id=row?.$id || row?.id;
    if(!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const latestRowsByKey = (rows=[], keyFn) => {
  const map=new Map();
  for(const row of rows){
    const key=keyFn(row);
    if(!key){ map.set(`id:${row?.$id||row?.id||crypto.randomUUID()}`,row); continue; }
    const prev=map.get(key);
    const stamp=Date.parse(row?.$updatedAt||row?.$createdAt||0)||0;
    const prevStamp=Date.parse(prev?.$updatedAt||prev?.$createdAt||0)||0;
    if(!prev || stamp>=prevStamp) map.set(key,row);
  }
  return [...map.values()];
};

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
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function deleteRowVerified(tableId, rowId) {
  if (!rowId) return true;
  // Appwrite DELETE is authoritative only when the row can no longer be fetched.
  // Retry a few times so a transient network edge cannot turn into a resurrecting pin.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await deleteRow(tableId, rowId);
    const stillThere = await getRow(tableId, rowId);
    if (!stillThere) return true;
    await wait(90 * (attempt + 1));
  }
  const err = new Error(`Appwrite did not confirm deletion of ${rowId}. The map was not told the delete succeeded.`);
  err.status = 409;
  throw err;
}
async function getRow(tableId, rowId) {
  return appwriteFetch(`/tablesdb/${databaseId}/tables/${tableId}/rows/${rowId}`, { key: true, allow404: true });
}
async function listRows(tableId, queries = []) {
  const params = new URLSearchParams();
  for (const query of [...queries, Query.limit(500)]) params.append('queries[]', query);
  // Always fetch authoritative rows. Appwrite list-response caching is useful for
  // static views but row writes do not invalidate a cached list, which can make
  // a farmer appear to keep an old boundary/pin after the Admin has changed it.
  params.set('ttl','0');
  params.set('total','false');
  return appwriteFetch(`/tablesdb/${databaseId}/tables/${tableId}/rows?${params.toString()}`, { key: true });
}
async function deleteRowsWhere(tableId, column, value) {
  const result = await listRows(tableId, [Query.equal(column, [value])]);
  const rows = result?.rows || [];
  if (!rows.length) return [];
  for (const row of rows) await deleteRowVerified(tableId, row.$id || row.id);
  return rows.map(row => row.$id || row.id);
}

async function listFarmRows(tableId, farmId) {
  if (!farmId) return [];
  const result = await listRows(tableId, [Query.equal('farm_id', [farmId])]);
  return uniqueRows(result?.rows || []);
}

async function verifyLogicalDelete(tableId, farmId, field, logicalValue, ids = []) {
  const wanted = recordNameKey(logicalValue);
  const rows = await listFarmRows(tableId, farmId);
  const idSet = new Set(ids.filter(Boolean));
  const survivors = rows.filter(row => {
    const id = row?.$id || row?.id;
    return idSet.has(id) || (wanted && recordNameKey(row?.[field]) === wanted);
  });
  if (survivors.length) {
    const err = new Error(`Appwrite still contains ${survivors.length} matching record(s). Delete was not confirmed.`);
    err.status = 409;
    throw err;
  }
  return true;
}

const recordNameKey = (value='') => String(value || '').trim().toLowerCase().replace(/\s+/g,' ');

const changeLogicalKey=(type,row={})=>{
  if(type==='sensor') return recordNameKey(row.sensor_code);
  if(type==='plot') return recordNameKey(row.plot_code);
  if(type==='drone') return recordNameKey(row.name);
  return '';
};

async function assertSpatialChangeLogReady(){
  const table=await appwriteFetch(`/tablesdb/${databaseId}/tables/${tables.changes}`,{key:true,allow404:true});
  if(!table){
    const err=new Error('SOILS v1.10.10 needs the spatial_changes table. Run "npm.cmd run setup:appwrite" once, then retry.');
    err.status=400;
    throw err;
  }
  return true;
}

async function writeSpatialChange({farmId,type,entityId,action,row=null,logicalKey=''}){
  if(!farmId || !type || !action) return null;
  const farm=await getRow(tables.farms,farmId);
  const data={
    farm_id:String(farmId),
    entity_type:String(type),
    entity_id:String(entityId||''),
    logical_key:String(logicalKey||changeLogicalKey(type,row)||''),
    action:String(action),
    payload_json:row?JSON.stringify(row):'',
    changed_at:now(),
  };
  return createRow(tables.changes,uid('change'),data,perms(farm?.farmer_id));
}

async function listSpatialChanges(farmId){
  if(!farmId) return [];
  try{
    const result=await listRows(tables.changes,[Query.equal('farm_id',[farmId]),Query.orderAsc('changed_at')]);
    return uniqueRows(result?.rows||[]).sort((a,b)=>rowStamp(a)-rowStamp(b));
  }catch(error){
    if(error?.status===404) return [];
    throw error;
  }
}

function parseChangePayload(value){
  if(!value) return null;
  try{return typeof value==='string'?JSON.parse(value):value;}catch{return null;}
}

function applySpatialChangeJournal(bundle,changes=[]){
  if(!bundle?.farm || !changes.length) return bundle;
  const sensors=new Map((bundle.sensors||[]).map(row=>[row.id,row]));
  const plots=new Map((bundle.plots||[]).map(row=>[row.id,row]));
  const drones=new Map((bundle.droneMappings||[]).map(row=>[row.id,row]));
  let farm=bundle.farm;
  const collection=(type)=>type==='sensor'?sensors:type==='plot'?plots:type==='drone'?drones:null;
  const rowKey=(type,row)=>changeLogicalKey(type,row);
  for(const change of [...changes].sort((a,b)=>rowStamp(a)-rowStamp(b))){
    const type=String(change.entity_type||'');
    const action=String(change.action||'');
    const entityId=String(change.entity_id||'');
    const logical=recordNameKey(change.logical_key||'');
    if(type==='farm'){
      if(action==='upsert'){
        const payload=parseChangePayload(change.payload_json);
        if(payload) farm={...farm,...payload,id:farm.id};
      }
      continue;
    }
    const map=collection(type);
    if(!map) continue;
    if(action==='delete'){
      if(entityId) map.delete(entityId);
      if(logical){
        for(const [id,row] of [...map.entries()]) if(rowKey(type,row)===logical) map.delete(id);
      }
      continue;
    }
    if(action==='upsert'){
      const payload=parseChangePayload(change.payload_json);
      if(!payload) continue;
      const id=String(payload.id||entityId||'');
      if(!id) continue;
      const key=logical||rowKey(type,payload);
      if(key){
        for(const [otherId,row] of [...map.entries()]) if(otherId!==id && rowKey(type,row)===key) map.delete(otherId);
      }
      map.set(id,{...map.get(id),...payload,id,farm_id:payload.farm_id||bundle.farm.id});
    }
  }
  // Final canonicalization is intentional even after journal replay. It makes
  // one logical Sensor/Plot/Drone name equal one renderable record, protecting
  // both Admin and Farmer from legacy duplicate rows or overlapping old events.
  return {
    ...bundle,
    farm,
    sensors:newestByName([...sensors.values()],'sensor_code'),
    plots:newestByName([...plots.values()],'plot_code'),
    droneMappings:newestByName([...drones.values()],'name'),
  };
}


async function buildBundleWithImmediateChange(farmId,{type,entityId='',action,row=null,logicalKey=''}){
  const bundle=await buildAuthoritativeFarmBundle(farmId);
  if(!bundle) return bundle;
  return applySpatialChangeJournal(bundle,[{
    entity_type:type,
    entity_id:entityId,
    logical_key:logicalKey||changeLogicalKey(type,row),
    action,
    payload_json:row?JSON.stringify(row):'',
    changed_at:now(),
  }]);
}

function newestByName(rows=[], field='name') {
  return latestRowsByKey(uniqueRows(rows), (row)=>{
    const name=recordNameKey(row?.[field]);
    return name ? `${row?.farm_id || ''}::${name}` : `id:${row?.$id || row?.id || crypto.randomUUID()}`;
  });
}

async function deleteNamedSiblings(tableId, farmId, field, value, keepId=null) {
  const wanted=recordNameKey(value);
  if(!farmId || !wanted) return [];
  const result=await listRows(tableId,[Query.equal('farm_id',[farmId])]).catch(()=>({rows:[]}));
  const duplicates=(result?.rows||[]).filter(row=>{
    const id=row?.$id || row?.id;
    return id!==keepId && recordNameKey(row?.[field])===wanted;
  });
  for (const row of duplicates) await deleteRowVerified(tableId,row.$id || row.id);
  return duplicates.map(row=>row.$id || row.id);
}

async function deleteSensorCodeSiblings(farmId, sensorCode, keepId=null) {
  const wanted=recordNameKey(sensorCode);
  if(!farmId || !wanted) return [];
  const rows=await listFarmRows(tables.sensors,farmId);
  const duplicates=rows.filter(row=>(row.$id||row.id)!==keepId && recordNameKey(row.sensor_code)===wanted);
  for(const row of duplicates){
    const id=row.$id||row.id;
    await deleteRowsWhere(tables.readings,'sensor_id',id);
    await deleteRowVerified(tables.sensors,id);
  }
  return duplicates.map(row=>row.$id||row.id);
}

async function deletePlotCodeSiblings(farmId, plotCode, keepId=null) {
  const wanted=recordNameKey(plotCode);
  if(!farmId || !wanted) return [];
  const rows=await listFarmRows(tables.plots,farmId);
  const duplicates=rows.filter(row=>(row.$id||row.id)!==keepId && recordNameKey(row.plot_code)===wanted);
  for(const row of duplicates){
    const id=row.$id||row.id;
    await deleteRowsWhere(tables.analyses,'plot_id',id);
    await deleteRowVerified(tables.plots,id);
  }
  return duplicates.map(row=>row.$id||row.id);
}

async function deleteDroneNameSiblings(farmId, name, keepId=null) {
  return deleteNamedSiblings(tables.drone,farmId,'name',name,keepId);
}


const rowStamp = (row={}) => Date.parse(row?.$updatedAt || row?.$createdAt || row?.analyzed_at || row?.captured_at || row?.recorded_at || 0) || 0;

function newestRow(rows=[]) {
  return [...rows].sort((a,b)=>rowStamp(b)-rowStamp(a))[0] || null;
}

async function repairFarmSpatialData(farmId) {
  if (!farmId) return { sensors:0, plots:0, drone:0, orphans:0 };
  const [sensorRows, plotRows, analysisRows, droneRows] = await Promise.all([
    listFarmRows(tables.sensors, farmId),
    listFarmRows(tables.plots, farmId),
    listFarmRows(tables.analyses, farmId),
    listFarmRows(tables.drone, farmId).catch(()=>[]),
  ]);
  const removed={sensors:0,plots:0,drone:0,orphans:0};

  const sensorGroups=new Map();
  for(const row of sensorRows){
    const key=recordNameKey(row.sensor_code) || `id:${row.$id||row.id}`;
    if(!sensorGroups.has(key)) sensorGroups.set(key,[]);
    sensorGroups.get(key).push(row);
  }
  for(const rows of sensorGroups.values()){
    if(rows.length<2) continue;
    const keep=newestRow(rows);
    for(const row of rows){
      const id=row.$id||row.id;
      if(id===(keep?.$id||keep?.id)) continue;
      await deleteRowsWhere(tables.readings,'sensor_id',id);
      await deleteRowVerified(tables.sensors,id);
      removed.sensors+=1;
    }
  }

  const analysesByPlot=new Map();
  for(const row of analysisRows){
    if(!analysesByPlot.has(row.plot_id)) analysesByPlot.set(row.plot_id,[]);
    analysesByPlot.get(row.plot_id).push(row);
  }
  const validPlots=[];
  for(const row of plotRows){
    const id=row.$id||row.id;
    if(!analysesByPlot.has(id)){
      await deleteRowVerified(tables.plots,id);
      removed.orphans+=1;
    } else validPlots.push(row);
  }
  const plotGroups=new Map();
  for(const row of validPlots){
    const key=recordNameKey(row.plot_code) || `id:${row.$id||row.id}`;
    if(!plotGroups.has(key)) plotGroups.set(key,[]);
    plotGroups.get(key).push(row);
  }
  for(const rows of plotGroups.values()){
    if(rows.length<2) continue;
    const keep=newestRow(rows);
    for(const row of rows){
      const id=row.$id||row.id;
      if(id===(keep?.$id||keep?.id)) continue;
      await deleteRowsWhere(tables.analyses,'plot_id',id);
      await deleteRowVerified(tables.plots,id);
      removed.plots+=1;
    }
  }

  const droneGroups=new Map();
  for(const row of droneRows){
    const key=recordNameKey(row.name) || `id:${row.$id||row.id}`;
    if(!droneGroups.has(key)) droneGroups.set(key,[]);
    droneGroups.get(key).push(row);
  }
  for(const rows of droneGroups.values()){
    if(rows.length<2) continue;
    const keep=newestRow(rows);
    for(const row of rows){
      const id=row.$id||row.id;
      if(id===(keep?.$id||keep?.id)) continue;
      await deleteRowVerified(tables.drone,id);
      removed.drone+=1;
    }
  }
  return removed;
}

async function touchFarm(farmId) {
  if(!farmId) return false;
  try{
    const farm=await getRow(tables.farms,farmId);
    if(!farm) return false;
    // Updating the farm row after a child-record mutation guarantees a dedicated
    // farm Realtime event for the Farmer workspace. Keep the semantic status unchanged.
    await updateRow(tables.farms,farmId,{status:farm.status || 'Mapped'},perms(farm.farmer_id));
    return true;
  }catch(error){
    // Child write is already authoritative. A missed wake-up event must never
    // turn a successful save into a false rollback; the Farmer interval still syncs.
    console.warn('Farm sync touch failed:',error?.message||error);
    return false;
  }
}

async function migrateFarmRows(tableId, fromFarmId, toFarmId, farmerId) {
  if(!fromFarmId || !toFarmId || fromFarmId===toFarmId) return 0;
  const rows=await listFarmRows(tableId,fromFarmId).catch(()=>[]);
  for(const row of rows){
    await updateRow(tableId,row.$id||row.id,{farm_id:toFarmId},perms(farmerId));
  }
  return rows.length;
}

async function repairDuplicateFarmerFarms() {
  const [farmsResult,profilesResult]=await Promise.all([
    listRows(tables.farms,[]),
    listRows(tables.profiles,[]).catch(()=>({rows:[]})),
  ]);
  const farms=uniqueRows(farmsResult?.rows||[]);
  const profiles=uniqueRows(profilesResult?.rows||[]);
  const groups=new Map();
  for(const farm of farms){
    const farmerId=String(farm.farmer_id||'').trim();
    if(!farmerId) continue;
    if(!groups.has(farmerId)) groups.set(farmerId,[]);
    groups.get(farmerId).push(farm);
  }
  const report={duplicateFarmsRemoved:0,migratedRows:0,profilesRepaired:0};
  for(const [farmerId,rows] of groups.entries()){
    if(rows.length<2) continue;
    // The most recently updated farm is the canonical workspace. A child write
    // touches its farm row, so this selects the workspace Admin actually edited.
    const canonical=newestRow(rows);
    const canonicalId=canonical?.$id||canonical?.id;
    if(!canonicalId) continue;
    for(const duplicate of rows){
      const duplicateId=duplicate.$id||duplicate.id;
      if(!duplicateId || duplicateId===canonicalId) continue;
      for(const tableId of [tables.sensors,tables.readings,tables.plots,tables.analyses,tables.drone,tables.changes]){
        report.migratedRows+=await migrateFarmRows(tableId,duplicateId,canonicalId,farmerId);
      }
      await deleteRowVerified(tables.farms,duplicateId);
      report.duplicateFarmsRemoved+=1;
    }
    for(const profile of profiles.filter(row=>row.user_id===farmerId && row.farm_id!==canonicalId)){
      await updateRow(tables.profiles,profile.$id||profile.id,{farm_id:canonicalId,active:true},perms(farmerId));
      report.profilesRepaired+=1;
    }
  }
  return report;
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
  await deleteRowsWhere(tables.changes, 'farm_id', farmId).catch(()=>{});
  await deleteRow(tables.farms, farmId);
  const profiles = await listRows(tables.profiles, [Query.equal('user_id', [farmerId])]);
  for (const profile of profiles?.rows || []) await deleteRow(tables.profiles, profile.$id);
  await appwriteFetch(`/users/${farmerId}`, { method:'DELETE', key:true, allow404:true });
  return { deleted:true };
}

async function relatedFarmIds(farmId){
  if(!farmId) return [];
  const farm=await getRow(tables.farms,farmId);
  if(!farm?.farmer_id) return [farmId];
  const result=await listRows(tables.farms,[Query.equal('farmer_id',[farm.farmer_id])]).catch(()=>({rows:[]}));
  const ids=uniqueRows(result?.rows||[]).map(row=>row.$id||row.id).filter(Boolean);
  return [...new Set([farmId,...ids])];
}

async function updateFarmBoundary(payload) {
  await assertSpatialChangeLogReady();
  const farm = await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  const patch={
    boundary_geojson: JSON.stringify(payload.geojson || []),
    center_lat: Number(payload.center_lat),
    center_lng: Number(payload.center_lng),
    area_hectares: Number(payload.area_hectares || 0),
    status: payload.status || 'Mapped',
  };
  const updated=await updateRow(tables.farms, payload.farm_id, patch, perms(farm.farmer_id));
  const normalized={...serverNormalizeFarm({...farm,...updated,...patch,$id:payload.farm_id}),boundary:[...(payload.geojson||[])]};
  await writeSpatialChange({farmId:payload.farm_id,type:'farm',entityId:payload.farm_id,action:'upsert',row:normalized});
  return { updated:true, bundle:await buildBundleWithImmediateChange(payload.farm_id,{type:'farm',entityId:payload.farm_id,action:'upsert',row:normalized}) };
}

async function deleteFarmBoundary(payload) {
  await assertSpatialChangeLogReady();
  const farm = await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  const updated=await updateRow(tables.farms, payload.farm_id, { boundary_geojson:'[]', area_hectares:0, status:'Unmapped' }, perms(farm.farmer_id));
  await writeSpatialChange({farmId:payload.farm_id,type:'farm',entityId:payload.farm_id,action:'upsert',row:{...serverNormalizeFarm({...farm,...updated,$id:payload.farm_id}),boundary:[],area_hectares:0,status:'Unmapped'}});
  const row={...serverNormalizeFarm({...farm,...updated,$id:payload.farm_id}),boundary:[],area_hectares:0,status:'Unmapped'};
  const bundle = await buildBundleWithImmediateChange(payload.farm_id,{type:'farm',entityId:payload.farm_id,action:'upsert',row});
  return { deleted:true, bundle };
}

async function createSensor(payload) {
  await assertSpatialChangeLogReady();
  const farm = await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  const sensorId = uid('sensor');
  const permission = perms(farm.farmer_id);
  const stationData={
    farm_id: payload.farm_id,
    sensor_code: String(payload.sensor_code || 'Sensor').trim(),
    latitude: Number(payload.latitude), longitude: Number(payload.longitude),
    coverage_m: Number(payload.coverage_m || 50),
    orientation_deg: Number(payload.orientation_deg || 0),
    status: payload.status || 'Online', installed_at: now(), last_seen_at: now(),
  };
  const stationRow=await createRow(tables.sensors, sensorId, stationData, permission);
  const readingId = uid('reading');
  const readingData={
    farm_id: payload.farm_id, sensor_id:sensorId,
    nitrogen:Number(payload.nitrogen || 0), phosphorus:Number(payload.phosphorus || 0), potassium:Number(payload.potassium || 0),
    ph:Number(payload.ph || 0), organic_matter:Number(payload.organic_matter || 0), moisture:Number(payload.moisture || 0), recorded_at:now(),
  };
  await createRow(tables.readings, readingId, readingData, permission);
  const exact={...stationRow,...stationData,...readingData,id:sensorId,$id:sensorId};
  try{
    await writeSpatialChange({farmId:payload.farm_id,type:'sensor',entityId:sensorId,action:'upsert',row:exact,logicalKey:stationData.sensor_code});
  }catch(error){
    await deleteRowsWhere(tables.readings,'sensor_id',sensorId).catch(()=>{});
    await deleteRow(tables.sensors,sensorId).catch(()=>{});
    throw error;
  }
  await deleteSensorCodeSiblings(payload.farm_id,stationData.sensor_code,sensorId);
  await touchFarm(payload.farm_id);
  return { sensorId, readingId, row:exact, bundle:await buildBundleWithImmediateChange(payload.farm_id,{type:'sensor',entityId:sensorId,action:'upsert',row:exact,logicalKey:stationData.sensor_code}) };
}

async function updateSensor(payload) {
  await assertSpatialChangeLogReady();
  const sensor = await getRow(tables.sensors, payload.sensor_id);
  if (!sensor) throw Object.assign(new Error('Sensor not found.'), { status:404 });
  const farm = await getRow(tables.farms, sensor.farm_id);
  const permission = perms(farm?.farmer_id);
  const stationPatch={
    sensor_code:String(payload.sensor_code || sensor.sensor_code), latitude:Number(payload.latitude ?? sensor.latitude), longitude:Number(payload.longitude ?? sensor.longitude),
    coverage_m:Number(payload.coverage_m ?? sensor.coverage_m), orientation_deg:Number(payload.orientation_deg ?? sensor.orientation_deg ?? 0), status:payload.status || sensor.status || 'Online', last_seen_at:now(),
  };
  const stationRow=await updateRow(tables.sensors, payload.sensor_id, stationPatch, permission);
  const readingId = uid('reading');
  const readingData={
    farm_id:sensor.farm_id, sensor_id:payload.sensor_id,
    nitrogen:Number(payload.nitrogen || 0), phosphorus:Number(payload.phosphorus || 0), potassium:Number(payload.potassium || 0),
    ph:Number(payload.ph || 0), organic_matter:Number(payload.organic_matter || 0), moisture:Number(payload.moisture || 0), recorded_at:now(),
  };
  await createRow(tables.readings, readingId, readingData, permission);
  const exact={...sensor,...stationRow,...stationPatch,...readingData,id:payload.sensor_id,$id:payload.sensor_id,farm_id:sensor.farm_id};
  await writeSpatialChange({farmId:sensor.farm_id,type:'sensor',entityId:payload.sensor_id,action:'upsert',row:exact,logicalKey:stationPatch.sensor_code});
  await deleteSensorCodeSiblings(sensor.farm_id,stationPatch.sensor_code,payload.sensor_id);
  await touchFarm(sensor.farm_id);
  return { readingId, row:exact, bundle:await buildBundleWithImmediateChange(sensor.farm_id,{type:'sensor',entityId:payload.sensor_id,action:'upsert',row:exact,logicalKey:stationPatch.sensor_code}) };
}

async function deleteSensor(payload) {
  await assertSpatialChangeLogReady();
  const existing = payload.sensor_id ? await getRow(tables.sensors, payload.sensor_id) : null;
  const farmId = existing?.farm_id || payload.farm_id;
  const logicalCode = String(existing?.sensor_code || payload.sensor_code || '').trim();
  if (!farmId) throw Object.assign(new Error('Sensor farm ID is required.'), { status:400 });

  const farmIds=await relatedFarmIds(farmId);
  const deletedIds=[];
  for(const idFarm of farmIds){
    const rows=await listFarmRows(tables.sensors,idFarm);
    const targets=rows.filter(row=>(row.$id||row.id)===payload.sensor_id || (logicalCode && recordNameKey(row.sensor_code)===recordNameKey(logicalCode)));
    for(const row of targets){
      const id=row.$id||row.id;
      await deleteRowsWhere(tables.readings,'sensor_id',id);
      await deleteRowVerified(tables.sensors,id);
      deletedIds.push(id);
    }
  }
  for(const idFarm of farmIds) await verifyLogicalDelete(tables.sensors,idFarm,'sensor_code',logicalCode,deletedIds);

  // Only publish the tombstone after the physical delete was verified. A failed
  // Appwrite delete must never be reported as success to the UI.
  await writeSpatialChange({farmId,type:'sensor',entityId:payload.sensor_id||'',action:'delete',logicalKey:logicalCode});
  await touchFarm(farmId);
  return { deleted:true, deletedIds:[...new Set(deletedIds)], bundle:await buildBundleWithImmediateChange(farmId,{type:'sensor',entityId:payload.sensor_id||'',action:'delete',logicalKey:logicalCode}) };
}

async function rotateSensor(payload) {
  await assertSpatialChangeLogReady();
  const sensor = await getRow(tables.sensors, payload.sensor_id);
  if (!sensor) throw Object.assign(new Error('Sensor not found.'), { status:404 });
  const farm = await getRow(tables.farms, sensor.farm_id);
  const angle = ((Number(payload.orientation_deg ?? sensor.orientation_deg ?? 0) % 360) + 360) % 360;
  const stationRow=await updateRow(tables.sensors, payload.sensor_id, { orientation_deg: angle, last_seen_at: sensor.last_seen_at || now() }, perms(farm?.farmer_id));
  const readings=await listRows(tables.readings,[Query.equal('sensor_id',[payload.sensor_id]),Query.orderDesc('recorded_at')]).catch(()=>({rows:[]}));
  const latest=readings?.rows?.[0]||{};
  const exact={...sensor,...stationRow,...latest,id:payload.sensor_id,$id:payload.sensor_id,orientation_deg:angle};
  await writeSpatialChange({farmId:sensor.farm_id,type:'sensor',entityId:payload.sensor_id,action:'upsert',row:exact,logicalKey:sensor.sensor_code});
  await touchFarm(sensor.farm_id);
  return { updated:true, orientation_deg:angle, row:exact, bundle:await buildBundleWithImmediateChange(sensor.farm_id,{type:'sensor',entityId:payload.sensor_id,action:'upsert',row:exact,logicalKey:sensor.sensor_code}) };
}

async function createPlot(payload) {
  await assertSpatialChangeLogReady();
  const farm = await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  if (!Array.isArray(payload.geojson) || payload.geojson.length < 3) throw Object.assign(new Error('Soil analysis plot needs at least 3 polygon points.'), { status:400 });
  const plotId = uid('plot');
  const analysisId = uid('analysis');
  const permission = perms(farm.farmer_id);
  const sampledAt = payload.sampled_at || now();
  const analyzedAt = payload.analyzed_at || now();
  const plotData={farm_id:payload.farm_id,plot_code:String(payload.plot_code || 'SOIL-PLOT').trim(),latitude:Number(payload.latitude),longitude:Number(payload.longitude),coverage_m:Number(payload.coverage_m || 0),boundary_geojson:JSON.stringify(payload.geojson),sampled_at:sampledAt};
  const analysisData={farm_id:payload.farm_id,plot_id:plotId,nitrogen:Number(payload.nitrogen || 0),phosphorus:Number(payload.phosphorus || 0),potassium:Number(payload.potassium || 0),ph:Number(payload.ph || 0),organic_matter:Number(payload.organic_matter || 0),classification:payload.classification || 'Pending',sampled_at:sampledAt,analyzed_at:analyzedAt,notes:String(payload.notes || '')};
  let plotRow=null;
  try{
    plotRow=await createRow(tables.plots,plotId,plotData,permission);
    await createRow(tables.analyses,analysisId,analysisData,permission);
  }catch(error){
    if(plotRow) await deleteRow(tables.plots,plotId).catch(()=>{});
    throw error;
  }
  const exact={...plotRow,...plotData,...analysisData,id:plotId,$id:plotId,boundary:[...payload.geojson]};
  try{
    await writeSpatialChange({farmId:payload.farm_id,type:'plot',entityId:plotId,action:'upsert',row:exact,logicalKey:plotData.plot_code});
  }catch(error){
    await deleteRowsWhere(tables.analyses,'plot_id',plotId).catch(()=>{});
    await deleteRow(tables.plots,plotId).catch(()=>{});
    throw error;
  }
  await deletePlotCodeSiblings(payload.farm_id,plotData.plot_code,plotId);
  await touchFarm(payload.farm_id);
  return {plotId,analysisId,row:exact,bundle:await buildBundleWithImmediateChange(payload.farm_id,{type:'plot',entityId:plotId,action:'upsert',row:exact,logicalKey:plotData.plot_code})};
}

async function updatePlot(payload) {
  await assertSpatialChangeLogReady();
  const plot = await getRow(tables.plots, payload.plot_id);
  if (!plot) throw Object.assign(new Error('Soil plot not found.'), { status:404 });
  const farm = await getRow(tables.farms, plot.farm_id);
  const permission = perms(farm?.farmer_id);
  const plotPatch={plot_code:String(payload.plot_code || plot.plot_code),latitude:Number(payload.latitude ?? plot.latitude),longitude:Number(payload.longitude ?? plot.longitude),coverage_m:Number(payload.coverage_m ?? plot.coverage_m),...(payload.geojson ? {boundary_geojson:JSON.stringify(payload.geojson)}:{})};
  const plotRow=await updateRow(tables.plots,payload.plot_id,plotPatch,permission);
  const existing=await listRows(tables.analyses,[Query.equal('plot_id',[payload.plot_id]),Query.orderDesc('analyzed_at')]);
  const analysis=existing?.rows?.[0];
  const data={nitrogen:Number(payload.nitrogen || 0),phosphorus:Number(payload.phosphorus || 0),potassium:Number(payload.potassium || 0),ph:Number(payload.ph || 0),organic_matter:Number(payload.organic_matter || 0),classification:payload.classification || 'Pending',analyzed_at:now(),notes:String(payload.notes || '')};
  let analysisRow;
  if(analysis) analysisRow=await updateRow(tables.analyses,analysis.$id,data,permission);
  else analysisRow=await createRow(tables.analyses,uid('analysis'),{farm_id:plot.farm_id,plot_id:payload.plot_id,sampled_at:now(),...data},permission);
  const boundary=payload.geojson?[...payload.geojson]:parseStoredBoundary(plotPatch.boundary_geojson||plot.boundary_geojson);
  const exact={...plot,...plotRow,...plotPatch,...analysis,...analysisRow,...data,id:payload.plot_id,$id:payload.plot_id,farm_id:plot.farm_id,boundary};
  await writeSpatialChange({farmId:plot.farm_id,type:'plot',entityId:payload.plot_id,action:'upsert',row:exact,logicalKey:plotPatch.plot_code});
  await deletePlotCodeSiblings(plot.farm_id,plotPatch.plot_code,payload.plot_id);
  await touchFarm(plot.farm_id);
  return {updated:true,row:exact,bundle:await buildBundleWithImmediateChange(plot.farm_id,{type:'plot',entityId:payload.plot_id,action:'upsert',row:exact,logicalKey:plotPatch.plot_code})};
}

async function deletePlot(payload) {
  await assertSpatialChangeLogReady();
  const existing = payload.plot_id ? await getRow(tables.plots, payload.plot_id) : null;
  const farmId = existing?.farm_id || payload.farm_id;
  const logicalCode = String(existing?.plot_code || payload.plot_code || '').trim();
  if (!farmId) throw Object.assign(new Error('Soil plot farm ID is required.'), { status:400 });

  const deletedIds=[];
  const farmIds=await relatedFarmIds(farmId);
  for(const idFarm of farmIds){
    const rows=await listFarmRows(tables.plots,idFarm);
    const targets=rows.filter(row=>(row.$id||row.id)===payload.plot_id || (logicalCode && recordNameKey(row.plot_code)===recordNameKey(logicalCode)));
    for(const row of targets){
      const id=row.$id||row.id;
      await deleteRowsWhere(tables.analyses,'plot_id',id);
      await deleteRowVerified(tables.plots,id);
      deletedIds.push(id);
    }
  }
  for(const idFarm of farmIds) await verifyLogicalDelete(tables.plots,idFarm,'plot_code',logicalCode,deletedIds);

  await writeSpatialChange({farmId,type:'plot',entityId:payload.plot_id||'',action:'delete',logicalKey:logicalCode});
  await touchFarm(farmId);
  return {deleted:true,deletedIds:[...new Set(deletedIds)],bundle:await buildBundleWithImmediateChange(farmId,{type:'plot',entityId:payload.plot_id||'',action:'delete',logicalKey:logicalCode})};
}

async function createDroneMapping(payload) {
  await assertSpatialChangeLogReady();
  const farm = await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  if (!Array.isArray(payload.geojson) || payload.geojson.length < 3) throw Object.assign(new Error('Drone mapping needs at least 3 polygon points.'), { status:400 });
  const id = uid('drone');
  const data={farm_id:payload.farm_id,name:String(payload.name || 'Drone Mapping').trim(),boundary_geojson:JSON.stringify(payload.geojson),center_lat:Number(payload.center_lat || 0),center_lng:Number(payload.center_lng || 0),area_hectares:Number(payload.area_hectares || 0),nitrogen:Number(payload.nitrogen || 0),phosphorus:Number(payload.phosphorus || 0),potassium:Number(payload.potassium || 0),ph:Number(payload.ph || 0),organic_matter:Number(payload.organic_matter || 0),moisture:Number(payload.moisture || 0),classification:String(payload.classification || 'Unclassified'),notes:String(payload.notes || ''),image_url:String(payload.image_url || ''),captured_at:payload.captured_at || now(),status:payload.status || 'Mapped'};
  let createdRow;
  try{createdRow=await createRow(tables.drone,id,data,perms(farm.farmer_id));}
  catch(err){if(err.status===404) throw Object.assign(new Error('The drone_mappings table or one of its columns is missing. Run npm.cmd run setup:appwrite, then retry.'),{status:400});throw err;}
  const exact={...createdRow,...data,id,$id:id,boundary:[...payload.geojson],latitude:data.center_lat,longitude:data.center_lng};
  try{
    await writeSpatialChange({farmId:payload.farm_id,type:'drone',entityId:id,action:'upsert',row:exact,logicalKey:data.name});
  }catch(error){
    await deleteRow(tables.drone,id).catch(()=>{});
    throw error;
  }
  await deleteDroneNameSiblings(payload.farm_id,data.name,id);
  await touchFarm(payload.farm_id);
  return {droneId:id,row:exact,bundle:await buildBundleWithImmediateChange(payload.farm_id,{type:'drone',entityId:id,action:'upsert',row:exact,logicalKey:data.name})};
}

async function updateDroneMapping(payload) {
  await assertSpatialChangeLogReady();
  if (!payload.drone_id) throw Object.assign(new Error('Drone mapping ID is required.'), { status:400 });
  const existing=await getRow(tables.drone,payload.drone_id);
  if(!existing) throw Object.assign(new Error('Drone mapping not found.'),{status:404});
  const data={name:String(payload.name ?? existing.name ?? 'Drone Mapping'),center_lat:Number(payload.center_lat ?? existing.center_lat ?? 0),center_lng:Number(payload.center_lng ?? existing.center_lng ?? 0),area_hectares:Number(payload.area_hectares ?? existing.area_hectares ?? 0),nitrogen:Number(payload.nitrogen ?? existing.nitrogen ?? 0),phosphorus:Number(payload.phosphorus ?? existing.phosphorus ?? 0),potassium:Number(payload.potassium ?? existing.potassium ?? 0),ph:Number(payload.ph ?? existing.ph ?? 0),organic_matter:Number(payload.organic_matter ?? existing.organic_matter ?? 0),moisture:Number(payload.moisture ?? existing.moisture ?? 0),classification:String(payload.classification ?? existing.classification ?? 'Unclassified'),notes:String(payload.notes ?? existing.notes ?? ''),image_url:String(payload.image_url ?? existing.image_url ?? ''),captured_at:payload.captured_at || existing.captured_at || now(),status:payload.status || existing.status || 'Mapped',...(payload.geojson?{boundary_geojson:JSON.stringify(payload.geojson)}:{})};
  const farm=await getRow(tables.farms,existing.farm_id);
  const updated=await updateRow(tables.drone,payload.drone_id,data,perms(farm?.farmer_id));
  const boundary=payload.geojson?[...payload.geojson]:parseStoredBoundary(data.boundary_geojson||existing.boundary_geojson);
  const exact={...existing,...updated,...data,id:payload.drone_id,$id:payload.drone_id,farm_id:existing.farm_id,boundary,latitude:data.center_lat,longitude:data.center_lng};
  await writeSpatialChange({farmId:existing.farm_id,type:'drone',entityId:payload.drone_id,action:'upsert',row:exact,logicalKey:data.name});
  await deleteDroneNameSiblings(existing.farm_id,data.name,payload.drone_id);
  await touchFarm(existing.farm_id);
  return {updated:true,row:exact,bundle:await buildBundleWithImmediateChange(existing.farm_id,{type:'drone',entityId:payload.drone_id,action:'upsert',row:exact,logicalKey:data.name})};
}

async function deleteDroneMapping(payload) {
  await assertSpatialChangeLogReady();
  if (!payload.drone_id && !payload.name) throw Object.assign(new Error('Drone mapping ID or name is required.'), { status:400 });
  const existing=payload.drone_id?await getRow(tables.drone,payload.drone_id):null;
  const farmId=existing?.farm_id || payload.farm_id;
  const logicalName=String(existing?.name || payload.name || '').trim();
  if(!farmId) throw Object.assign(new Error('Drone mapping farm ID is required.'),{status:400});

  const deletedIds=[];
  const farmIds=await relatedFarmIds(farmId);
  for(const idFarm of farmIds){
    const rows=await listFarmRows(tables.drone,idFarm);
    const targets=rows.filter(row=>(row.$id||row.id)===payload.drone_id || (logicalName && recordNameKey(row.name)===recordNameKey(logicalName)));
    for(const row of targets){
      const id=row.$id||row.id;
      await deleteRowVerified(tables.drone,id);
      deletedIds.push(id);
    }
  }
  for(const idFarm of farmIds) await verifyLogicalDelete(tables.drone,idFarm,'name',logicalName,deletedIds);

  await writeSpatialChange({farmId,type:'drone',entityId:payload.drone_id||'',action:'delete',logicalKey:logicalName});
  await touchFarm(farmId);
  return {deleted:true,deletedIds:[...new Set(deletedIds)],bundle:await buildBundleWithImmediateChange(farmId,{type:'drone',entityId:payload.drone_id||'',action:'delete',logicalKey:logicalName})};
}

async function getAdminWorkspace() {
  // Fast path: loading the UI must never wait for legacy cleanup. The journal
  // already makes current spatial state authoritative, so maintenance can run
  // separately in the background.
  const farmsResult=await listRows(tables.farms,[]);
  const farms=uniqueRows(farmsResult?.rows||[]).sort((a,b)=>String(a.farmer_name||'').localeCompare(String(b.farmer_name||'')));
  const bundles=(await Promise.all(farms.map(farm=>buildAuthoritativeFarmBundle(farm.$id||farm.id)))).filter(Boolean);
  return { farms:bundles.map(item=>item.farm), bundles, repair:null };
}

async function repairAdminWorkspace() {
  const farmRepair=await repairDuplicateFarmerFarms();
  const farmsResult=await listRows(tables.farms,[]);
  const farms=uniqueRows(farmsResult?.rows||[]).sort((a,b)=>String(a.farmer_name||'').localeCompare(String(b.farmer_name||'')));
  const bundles=[];
  const spatialRepair=[];
  for(const farm of farms){
    const farmId=farm.$id||farm.id;
    spatialRepair.push({farmId,...await repairFarmSpatialData(farmId)});
    const bundle=await buildAuthoritativeFarmBundle(farmId);
    if(bundle) bundles.push(bundle);
  }
  return { farms:bundles.map(item=>item.farm), bundles, repair:{...farmRepair,spatial:spatialRepair} };
}

async function getFarmWorkspace(payload) {
  const farmId=String(payload?.farm_id||'').trim();
  if(!farmId) throw Object.assign(new Error('Farm ID is required.'),{status:400});
  const bundle=await buildAuthoritativeFarmBundle(farmId);
  if(!bundle) throw Object.assign(new Error('Farm not found.'),{status:404});
  return { farmId, bundle };
}

const actions = {
  getAdminWorkspace, repairAdminWorkspace, getFarmWorkspace,
  createFarmer, deleteFarmer, updateFarmBoundary, deleteFarmBoundary,
  createSensor, updateSensor, rotateSensor, deleteSensor,
  createPlot, updatePlot, deletePlot,
  createDroneMapping, updateDroneMapping, deleteDroneMapping,
};

export async function handleAdminAction({ jwt, action, payload = {} }) {
  await verifyAdmin(jwt);
  const fn = actions[action];
  if (!fn) throw Object.assign(new Error(`Unknown admin action: ${action}`), { status:400 });
  return fn(payload);
}

function parseStoredBoundary(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed?.type === 'Polygon' && Array.isArray(parsed.coordinates?.[0])) {
      return parsed.coordinates[0].map(([lng, lat]) => [lat, lng]);
    }
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function serverNormalizeFarm(row) {
  return row ? { ...row, id:row.$id || row.id, boundary:parseStoredBoundary(row.boundary_geojson) } : null;
}
function serverNormalizeDrone(row) {
  if (!row) return null;
  const boundary=parseStoredBoundary(row.boundary_geojson);
  const lat=Number(row.center_lat ?? row.latitude ?? (boundary.length?boundary.reduce((s,p)=>s+Number(p[0]||0),0)/boundary.length:0));
  const lng=Number(row.center_lng ?? row.longitude ?? (boundary.length?boundary.reduce((s,p)=>s+Number(p[1]||0),0)/boundary.length:0));
  return { ...row, id:row.$id || row.id, boundary, latitude:lat, longitude:lng, center_lat:lat, center_lng:lng };
}

async function buildAuthoritativeFarmBundle(farmId) {
  const [farm, sensorsResult, readingsResult, plotsResult, analysesResult, droneResult] = await Promise.all([
    getRow(tables.farms, farmId),
    listRows(tables.sensors, [Query.equal('farm_id', [farmId])]),
    listRows(tables.readings, [Query.equal('farm_id', [farmId]), Query.orderDesc('recorded_at')]),
    listRows(tables.plots, [Query.equal('farm_id', [farmId])]),
    listRows(tables.analyses, [Query.equal('farm_id', [farmId]), Query.orderDesc('analyzed_at')]),
    listRows(tables.drone, [Query.equal('farm_id', [farmId])]).catch(()=>({rows:[]})),
  ]);
  if (!farm) return null;
  const latestReading=new Map();
  for (const row of readingsResult?.rows || []) if (!latestReading.has(row.sensor_id)) latestReading.set(row.sensor_id,row);
  const latestAnalysis=new Map();
  for (const row of analysesResult?.rows || []) if (!latestAnalysis.has(row.plot_id)) latestAnalysis.set(row.plot_id,row);
  const plotRows=newestByName(uniqueRows(plotsResult?.rows || []).filter(plot=>latestAnalysis.has(plot.$id)),'plot_code');
  const droneRows=newestByName(uniqueRows(droneResult?.rows || []),'name');
  const base={
    farm:serverNormalizeFarm(farm),
    sensors:newestByName(uniqueRows(sensorsResult?.rows || []),'sensor_code').map(sensor=>({ ...sensor, id:sensor.$id || sensor.id, ...latestReading.get(sensor.$id) })),
    plots:plotRows.map(plot=>({ ...plot, id:plot.$id || plot.id, boundary:parseStoredBoundary(plot.boundary_geojson), ...latestAnalysis.get(plot.$id) })),
    droneMappings:droneRows.map(serverNormalizeDrone),
  };
  const changes=await listSpatialChanges(farmId);
  return applySpatialChangeJournal(base,changes);
}

export async function handleFarmerWorkspace({ jwt }) {
  if (!jwt) throw Object.assign(new Error('Missing farmer session token. Sign in again.'), {status:401});
  const user = await appwriteFetch('/account', { jwt });
  if (!user?.$id) throw Object.assign(new Error('Farmer session could not be verified.'), {status:401});
  if (user.labels?.includes('admin')) throw Object.assign(new Error('This endpoint is for farmer accounts.'), {status:403});

  // The farms table is authoritative. A stale profile from an older seed must
  // never point a farmer at a different farm. Prefer the profile only when it
  // references a farm actually owned by this user, otherwise self-heal it.
  let [profiles,owned] = await Promise.all([
    listRows(tables.profiles,[Query.equal('user_id',[user.$id])]).catch(()=>({rows:[]})),
    listRows(tables.farms,[Query.equal('farmer_id',[user.$id])]).catch(()=>({rows:[]})),
  ]);
  // Only run the heavier duplicate-farm repair when this Farmer actually has
  // more than one farm row. Normal 2.5-second syncs stay lightweight.
  if((owned?.rows||[]).length>1){
    await repairDuplicateFarmerFarms();
    [profiles,owned] = await Promise.all([
      listRows(tables.profiles,[Query.equal('user_id',[user.$id])]).catch(()=>({rows:[]})),
      listRows(tables.farms,[Query.equal('farmer_id',[user.$id])]).catch(()=>({rows:[]})),
    ]);
  }
  const ownedRows=owned?.rows || [];
  const ownedIds=new Set(ownedRows.map(row=>row.$id));
  const profile=profiles?.rows?.find(row=>row.role==='farmer') || profiles?.rows?.[0] || null;
  let farmId=(profile?.farm_id && ownedIds.has(profile.farm_id)) ? profile.farm_id : (ownedRows[0]?.$id || null);
  if (!farmId) return { farmId:null, bundle:null, syncedAt:now() };

  if (profile && profile.farm_id !== farmId) {
    await updateRow(tables.profiles, profile.$id, { farm_id:farmId, active:true }, perms(user.$id)).catch(()=>{});
  }
  const bundle=await buildAuthoritativeFarmBundle(farmId);
  return { farmId, bundle, syncedAt:now() };
}
