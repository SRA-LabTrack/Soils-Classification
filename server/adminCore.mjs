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
  changes: process.env.APPWRITE_SPATIAL_CHANGES_TABLE_ID || process.env.VITE_APPWRITE_SPATIAL_CHANGES_TABLE_ID || 'spatial_changes',
  support: process.env.APPWRITE_SUPPORT_MESSAGES_TABLE_ID || process.env.VITE_APPWRITE_SUPPORT_MESSAGES_TABLE_ID || 'support_messages',
  requests: process.env.APPWRITE_SPATIAL_REQUESTS_TABLE_ID || process.env.VITE_APPWRITE_SPATIAL_REQUESTS_TABLE_ID || 'spatial_requests',
};

const uid = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`.slice(0, 36);
async function stableId(prefix,value){
  const source=String(value||'').trim();
  if(!source)return uid(prefix);
  const bytes=new TextEncoder().encode(source);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const hex=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
  return `${prefix}_${hex.slice(0,24)}`.slice(0,36);
}
const now = () => new Date().toISOString();
const adminAuthCache=new Map();
const farmerAuthCache=new Map();
let supportTableCheckedAt=0;
let requestTableCheckedAt=0;
const AUTH_CACHE_MS=60000;
let adminWorkspaceSnapshot={data:null,expiresAt:0};
const farmBundleSnapshot=new Map();
const farmerRealtimeAccessCache=new Map();

const SPATIAL_RESET_AT='2026-08-11T06:08:00.000Z';
const SPATIAL_RESET_MS=Date.parse(SPATIAL_RESET_AT);
function currentSpatialRows(rows=[]){
  return uniqueRows(rows).filter(row=>{
    const created=Date.parse(row?.$createdAt||row?.created_at||'');
    return !Number.isFinite(created)||created>=SPATIAL_RESET_MS;
  });
}

const ADMIN_WORKSPACE_CACHE_MS=10000;
const FARM_BUNDLE_CACHE_MS=6000;
function invalidateWorkspaceSnapshots(farmId=''){
  adminWorkspaceSnapshot={data:null,expiresAt:0};
  if(farmId)farmBundleSnapshot.delete(farmId);else farmBundleSnapshot.clear();
}

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

async function appwriteFetch(path, { method = 'GET', body, jwt, key = false, allow404 = false, timeoutMs = 12000 } = {}) {
  ensureConfig();
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'X-Appwrite-Project': projectId,
    'X-Appwrite-Response-Format': '1.9.5',
  };
  if (key) headers['X-Appwrite-Key'] = apiKey;
  if (jwt) headers['X-Appwrite-JWT'] = jwt;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(2000,Number(timeoutMs)||12000));
  let res;
  try{
    res = await fetch(`${endpoint}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal:controller.signal,
    });
  }catch(error){
    if(error?.name==='AbortError')throw Object.assign(new Error('Appwrite took too long to respond. Please retry the request.'),{status:504});
    throw error;
  }finally{clearTimeout(timer);}
  if (res.status === 204) return null;
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (allow404 && res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(data?.message || `${method} ${path} failed (${res.status})`);
    err.status = res.status;
    err.code = data?.code || data?.type || '';
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
  const cached=adminAuthCache.get(jwt);
  if(cached&&Date.now()<cached.expiresAt)return cached.user;
  const user = await appwriteFetch('/account', { jwt });
  if (!user?.labels?.includes('admin')) {
    const err = new Error('Administrator access required.');
    err.status = 403;
    throw err;
  }
  if(adminAuthCache.size>100)adminAuthCache.clear();
  adminAuthCache.set(jwt,{user,expiresAt:Date.now()+AUTH_CACHE_MS});
  return user;
}

async function verifyFarmerJWT(jwt){
  if(!jwt)throw Object.assign(new Error('Missing farmer session token. Sign in again.'),{status:401});
  const cached=farmerAuthCache.get(jwt);
  if(cached&&Date.now()<cached.expiresAt)return cached.user;
  const user=await appwriteFetch('/account',{jwt});
  if(!user?.$id)throw Object.assign(new Error('Farmer session could not be verified.'),{status:401});
  if(user.labels?.includes('admin'))throw Object.assign(new Error('This endpoint is for farmer accounts.'),{status:403});
  if(farmerAuthCache.size>100)farmerAuthCache.clear();
  farmerAuthCache.set(jwt,{user,expiresAt:Date.now()+AUTH_CACHE_MS});
  return user;
}

const perms = (farmerId) => [
  'read("label:admin")',
  'update("label:admin")',
  'delete("label:admin")',
  ...(farmerId ? [`read("user:${farmerId}")`] : []),
];

const samePermissionSet=(actual=[],expected=[])=>{const a=[...(actual||[])].sort(),b=[...(expected||[])].sort();return a.length===b.length&&a.every((v,i)=>v===b[i]);};
async function ensureFarmerRealtimeAccess(farmId,farmerId){
  if(!farmId||!farmerId)return;
  const key=`${farmId}:${farmerId}`;const cached=farmerRealtimeAccessCache.get(key);
  if(cached&&Date.now()<cached)return;
  try{
    const expected=perms(farmerId);
    const result=await listRows(tables.changes,[Query.equal('farm_id',[farmId])],200).catch(()=>({rows:[]}));
    const repairs=(result?.rows||[]).filter(row=>!samePermissionSet(row.$permissions,expected));
    for(const row of repairs)await updateRow(tables.changes,row.$id||row.id,{},expected);
  }catch(error){console.warn('Farmer realtime access repair skipped:',error?.message||error);}
  farmerRealtimeAccessCache.set(key,Date.now()+10*60*1000);
}

async function createRow(tableId, rowId, data, permissions, {timeoutMs=12000}={}) {
  return appwriteFetch(`/tablesdb/${databaseId}/tables/${tableId}/rows`, {
    method: 'POST', key: true, body: { rowId, data, permissions }, timeoutMs,
  });
}
async function updateRow(tableId, rowId, data, permissions, {timeoutMs=12000}={}) {
  return appwriteFetch(`/tablesdb/${databaseId}/tables/${tableId}/rows/${rowId}`, {
    method: 'PATCH', key: true, body: { data, ...(permissions ? { permissions } : {}) }, timeoutMs,
  });
}
async function upsertRow(tableId,rowId,data,permissions){
  const existing=await getRow(tableId,rowId);
  if(existing)return updateRow(tableId,rowId,data,permissions);
  try{return await createRow(tableId,rowId,data,permissions);}
  catch(error){
    if(error?.status!==409)throw error;
    return updateRow(tableId,rowId,data,permissions);
  }
}
// Approval requests use deterministic row IDs, but Appwrite can briefly return
// a 409 for an ID that is not readable yet (for example after a timed-out create
// or a just-resolved retry). Never treat every 409 as proof that PATCH is safe.
// Verify the exact row first, retry the create/read window, and only PATCH once
// that row is actually visible. This prevents the approval path from turning a
// harmless conflict into "Row with the requested ID ... could not be found".
async function upsertRowFast(tableId,rowId,createData,permissions,{updateData=createData,timeoutMs=7000}={}){
  let conflict=null;
  const delays=[120,220,380,620,900];
  for(let attempt=0;attempt<=delays.length;attempt++){
    try{return await createRow(tableId,rowId,createData,permissions,{timeoutMs});}
    catch(error){
      if(error?.status!==409)throw error;
      conflict=error;
    }

    // A 409 can be either this exact row ID or a different unique/index
    // conflict. Only update when the requested ID is actually present.
    let existing=null;
    try{existing=await getRow(tableId,rowId,{timeoutMs:Math.min(timeoutMs,3000)});}catch(error){if(error?.status!==404)throw error;}
    if(existing){
      try{return await updateRow(tableId,rowId,updateData,permissions,{timeoutMs});}
      catch(error){
        // The row can still be crossing Appwrite's write/read boundary. A 404
        // here is retryable; any other failure is a real schema/permission error.
        if(error?.status!==404)throw error;
      }
    }

    if(attempt<delays.length)await wait(delays[attempt]);
  }

  const error=new Error(conflict?.message||`Appwrite reported a conflict for ${rowId}, but that row never became readable.`);
  error.status=409;
  error.code='SOILS_CONFLICT_WITHOUT_ROW';
  error.cause=conflict;
  throw error;
}
async function deleteRow(tableId, rowId) {
  return appwriteFetch(`/tablesdb/${databaseId}/tables/${tableId}/rows/${rowId}`, { method: 'DELETE', key: true, allow404: true });
}
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function deleteRowVerified(tableId, rowId) {
  if (!rowId) return true;
  // A successful Appwrite DELETE/404 response is the authoritative mutation.
  // v1.10.22 immediately re-read the same row and could see a stale edge/cache
  // response, falsely report failure, and roll the deleted pin back into React.
  // Trust the successful mutation and let the next no-cache workspace refresh
  // reconcile the map if the backend ever reports otherwise.
  await deleteRow(tableId, rowId);
  return true;
}
async function getRow(tableId, rowId, {timeoutMs=12000}={}) {
  return appwriteFetch(`/tablesdb/${databaseId}/tables/${tableId}/rows/${rowId}`, { key: true, allow404: true, timeoutMs });
}
async function listRows(tableId, queries = [], limit = 500) {
  const params = new URLSearchParams();
  for (const query of [...queries, Query.limit(limit)]) params.append('queries[]', query);
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
const isSchemaMismatch=(error)=>Number(error?.status)===400&&/(column|attribute|schema|unknown|invalid.*key|not found)/i.test(String(error?.message||''));

const changeLogicalKey=(type,row={})=>{
  if(type==='sensor') return recordNameKey(row.sensor_code);
  if(type==='plot') return recordNameKey(row.plot_code);
  if(type==='drone') return recordNameKey(row.name);
  return '';
};

let spatialChangeLogCache={ready:null,checkedAt:0};
async function spatialChangeLogReady({force=false}={}){
  const fresh=!force&&spatialChangeLogCache.ready!==null&&(Date.now()-spatialChangeLogCache.checkedAt)<60000;
  if(fresh)return spatialChangeLogCache.ready;
  try{
    const table=await appwriteFetch(`/tablesdb/${databaseId}/tables/${tables.changes}`,{key:true,allow404:true});
    spatialChangeLogCache={ready:!!table,checkedAt:Date.now()};
  }catch(error){
    // The journal accelerates realtime propagation, but it must never block the
    // authoritative Sensor / Plot / Drone write. The Farmer endpoint can always
    // rebuild directly from the source tables on focus or fallback refresh.
    console.warn('Spatial change journal check failed; continuing with authoritative tables.',error?.message||error);
    spatialChangeLogCache={ready:false,checkedAt:Date.now()};
  }
  return spatialChangeLogCache.ready;
}

async function writeSpatialChange({farmId,type,entityId,action,row=null,logicalKey=''}){
  if(!farmId || !type || !action) return null;
  if(!(await spatialChangeLogReady()))return null;
  try{
    const farm=await getRow(tables.farms,farmId);
    const canonicalLogical=String(logicalKey||changeLogicalKey(type,row)||'').trim();
    const data={
      farm_id:String(farmId),
      entity_type:String(type),
      entity_id:String(entityId||''),
      logical_key:canonicalLogical,
      action:String(action),
      payload_json:row?JSON.stringify(row):'',
      changed_at:now(),
    };
    // Keep one durable journal row per logical spatial entity instead of appending
    // forever. This preserves delete tombstones while keeping Appwrite reads small.
    const changeId=await stableId('change',`${farmId}|${type}|${entityId||canonicalLogical||type}`);
    return await upsertRow(tables.changes,changeId,data,perms(farm?.farmer_id));
  }catch(error){
    if(error?.status===404){spatialChangeLogCache={ready:false,checkedAt:Date.now()};return null;}
    // Journal publication is best-effort. A confirmed source-table write must not
    // be rolled back just because the optional realtime journal is unavailable.
    console.warn('Spatial change journal publish failed; source-table write is still authoritative.',error?.message||error);
    return null;
  }
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
      // Appwrite row IDs are authoritative. A label such as "Sensor 1" is not
      // unique and must never delete/hide a different row that happens to share it.
      if(entityId) map.delete(entityId);
      else if(logical){
        for(const [id,row] of [...map.entries()]) if(rowKey(type,row)===logical) map.delete(id);
      }
      continue;
    }
    if(action==='upsert'){
      const payload=parseChangePayload(change.payload_json);
      if(!payload) continue;
      const id=String(payload.id||entityId||'');
      if(!id) continue;
      map.set(id,{...map.get(id),...payload,id,farm_id:payload.farm_id||bundle.farm.id});
    }
  }
  // A spatial record is unique by Appwrite row ID. Names are display labels and
  // may repeat without causing another pin/polygon to disappear.
  return {
    ...bundle,
    farm,
    sensors:uniqueRows([...sensors.values()]),
    plots:uniqueRows([...plots.values()]),
    droneMappings:uniqueRows([...drones.values()]),
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

const rowStamp = (row={}) => Date.parse(row?.$updatedAt || row?.$createdAt || row?.analyzed_at || row?.captured_at || row?.recorded_at || 0) || 0;

function newestRow(rows=[]) {
  return [...rows].sort((a,b)=>rowStamp(b)-rowStamp(a))[0] || null;
}

async function repairFarmSpatialData(farmId) {
  if (!farmId) return { sensors:0, plots:0, drone:0, orphans:0 };
  // Spatial repair is deliberately non-destructive. A Sensor, Soil Plot, or
  // Drone Mapping row is authoritative by its Appwrite row ID even if a legacy
  // reading/analysis child row is missing. Cleanup must never erase a mapped
  // feature simply because a secondary history row has not arrived yet.
  return { sensors:0, plots:0, drone:0, orphans:0 };
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
      for(const tableId of [tables.sensors,tables.readings,tables.plots,tables.analyses,tables.drone,tables.changes,tables.support,tables.requests]){
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
  await deleteRowsWhere(tables.support, 'farmer_id', farmerId).catch(()=>{});
  await deleteRowsWhere(tables.requests, 'farmer_id', farmerId).catch(()=>{});
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
  const farm = await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  const incoming=cleanStoredPolygon(payload.geojson || []);
  if(incoming.length<3) throw Object.assign(new Error('Farm boundary needs at least 3 valid points.'),{status:400});
  const existing=parseStoredBoundaries(farm.boundary_geojson);
  // Retried/offline requests must not clone the same boundary a second time.
  const boundaryKey=(poly)=>JSON.stringify(cleanStoredPolygon(poly).map(([lat,lng])=>[Number(lat.toFixed(7)),Number(lng.toFixed(7))]));
  const incomingKey=boundaryKey(incoming);
  const alreadySaved=existing.some(poly=>boundaryKey(poly)===incomingKey);
  const boundaries=payload.replace===true ? [incoming] : (alreadySaved ? existing : [...existing,incoming]);
  const stats=multiBoundaryStats(boundaries);
  const patch={
    boundary_geojson: serializeStoredBoundaries(boundaries),
    center_lat: stats.center_lat,
    center_lng: stats.center_lng,
    area_hectares: stats.area_hectares,
    status: payload.status || 'Mapped',
  };
  const updated=await updateRow(tables.farms, payload.farm_id, patch, perms(farm.farmer_id));
  const normalized={...serverNormalizeFarm({...farm,...updated,...patch,$id:payload.farm_id}),boundaries,boundary:boundaries[0]||[]};
  await writeSpatialChange({farmId:payload.farm_id,type:'farm',entityId:payload.farm_id,action:'upsert',row:normalized});
  return { updated:true, boundaryCount:boundaries.length, bundle:await buildBundleWithImmediateChange(payload.farm_id,{type:'farm',entityId:payload.farm_id,action:'upsert',row:normalized}) };
}

async function deleteFarmBoundary(payload) {
  const farm = await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  const existing=parseStoredBoundaries(farm.boundary_geojson);
  if(!existing.length) return { deleted:false, boundaryCount:0, bundle:await buildAuthoritativeFarmBundle(payload.farm_id) };

  let boundaries=[];
  if(payload.delete_all===true){
    boundaries=[];
  }else{
    const boundaryKey=(poly)=>JSON.stringify(cleanStoredPolygon(poly).map(([lat,lng])=>[Number(lat.toFixed(7)),Number(lng.toFixed(7))]));
    const requested=cleanStoredPolygon(payload.geojson||[]);
    const requestedKey=requested.length>=3?boundaryKey(requested):'';
    const requestedIndex=Number(payload.boundary_index);
    let removeIndex=-1;
    if(requestedKey) removeIndex=existing.findIndex(poly=>boundaryKey(poly)===requestedKey);
    if(removeIndex<0&&Number.isInteger(requestedIndex)&&requestedIndex>=0&&requestedIndex<existing.length) removeIndex=requestedIndex;
    if(removeIndex<0) throw Object.assign(new Error('The selected farm boundary no longer exists. Refresh the farm and choose it again.'),{status:409});
    boundaries=existing.filter((_,index)=>index!==removeIndex);
  }

  const stats=multiBoundaryStats(boundaries);
  const patch={
    boundary_geojson:serializeStoredBoundaries(boundaries),
    area_hectares:boundaries.length?stats.area_hectares:0,
    status:boundaries.length?'Mapped':'Unmapped',
  };
  if(boundaries.length){patch.center_lat=stats.center_lat;patch.center_lng=stats.center_lng;}
  const updated=await updateRow(tables.farms, payload.farm_id, patch, perms(farm.farmer_id));
  const row={...serverNormalizeFarm({...farm,...updated,...patch,$id:payload.farm_id}),boundaries,boundary:boundaries[0]||[],area_hectares:patch.area_hectares,status:patch.status};
  await writeSpatialChange({farmId:payload.farm_id,type:'farm',entityId:payload.farm_id,action:'upsert',row});
  const bundle = await buildBundleWithImmediateChange(payload.farm_id,{type:'farm',entityId:payload.farm_id,action:'upsert',row});
  return { deleted:true, boundaryCount:boundaries.length, bundle };
}

async function createSensor(payload) {
  const approvalFast=payload._approval_fast===true;
  const farm = payload._farm_row || await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  const mutationId=String(payload.mutation_id||'').trim();
  const sensorId = mutationId ? await stableId('sensor',mutationId) : uid('sensor');
  const permission = perms(farm.farmer_id);
  const previous=approvalFast?null:await getRow(tables.sensors,sensorId);
  const stamp=now();
  const readingData={
    farm_id: payload.farm_id, sensor_id:sensorId,
    nitrogen:Number(payload.nitrogen || 0), phosphorus:Number(payload.phosphorus || 0), potassium:Number(payload.potassium || 0),
    ph:Number(payload.ph || 0), organic_matter:Number(payload.organic_matter || 0), moisture:Number(payload.moisture || 0), recorded_at:stamp,
  };
  const stationData={
    farm_id: payload.farm_id,
    sensor_code: String(payload.sensor_code || 'Sensor').trim(),
    latitude: Number(payload.latitude), longitude: Number(payload.longitude),
    coverage_m: Number(payload.coverage_m || 50),
    orientation_deg: Number(payload.orientation_deg || 0),
    status: payload.status || 'Online', installed_at: previous?.installed_at || stamp, last_seen_at: stamp,
    nitrogen:readingData.nitrogen,phosphorus:readingData.phosphorus,potassium:readingData.potassium,ph:readingData.ph,organic_matter:readingData.organic_matter,moisture:readingData.moisture,recorded_at:stamp,
  };
  const stationUpdateData={...stationData};delete stationUpdateData.installed_at;
  let stationRow;
  let schemaWarning='';
  try{
    stationRow=approvalFast
      ? await upsertRowFast(tables.sensors,sensorId,stationData,permission,{updateData:stationUpdateData,timeoutMs:6500})
      : await upsertRow(tables.sensors,sensorId,stationData,permission);
  }
  catch(error){
    if(!isSchemaMismatch(error))throw error;
    const legacyStationData={farm_id:stationData.farm_id,sensor_code:stationData.sensor_code,latitude:stationData.latitude,longitude:stationData.longitude,coverage_m:stationData.coverage_m,orientation_deg:stationData.orientation_deg,status:stationData.status,installed_at:stationData.installed_at,last_seen_at:stationData.last_seen_at};
    const legacyUpdateData={...legacyStationData};delete legacyUpdateData.installed_at;
    stationRow=approvalFast
      ? await upsertRowFast(tables.sensors,sensorId,legacyStationData,permission,{updateData:legacyUpdateData,timeoutMs:6500})
      : await upsertRow(tables.sensors,sensorId,legacyStationData,permission);
    schemaWarning='Sensor saved using the legacy station schema. Run npm.cmd run setup:appwrite once to enable the optimized latest-reading columns.';
  }
  const readingId = mutationId ? await stableId('reading',mutationId) : uid('reading');
  let historyWarning='';
  if(!approvalFast){
    try{await upsertRow(tables.readings, readingId, readingData, permission);}
    catch(error){historyWarning=`Sensor saved, but its history snapshot could not be appended: ${error?.message||error}`;console.warn(historyWarning);}
  }
  const exact={...previous,...stationRow,...stationData,...readingData,id:sensorId,$id:sensorId};
  if(!approvalFast)await writeSpatialChange({farmId:payload.farm_id,type:'sensor',entityId:sensorId,action:'upsert',row:exact,logicalKey:stationData.sensor_code});
  return { sensorId, readingId, farmId:payload.farm_id, row:exact, warning:[schemaWarning,historyWarning].filter(Boolean).join(' ')||undefined };
}

async function updateSensor(payload) {
  const sensor = await getRow(tables.sensors, payload.sensor_id);
  if (!sensor) throw Object.assign(new Error('Sensor not found.'), { status:404 });
  const farm = await getRow(tables.farms, sensor.farm_id);
  const permission = perms(farm?.farmer_id);
  const stamp=now();
  const readingData={
    farm_id:sensor.farm_id, sensor_id:payload.sensor_id,
    nitrogen:Number(payload.nitrogen || 0), phosphorus:Number(payload.phosphorus || 0), potassium:Number(payload.potassium || 0),
    ph:Number(payload.ph || 0), organic_matter:Number(payload.organic_matter || 0), moisture:Number(payload.moisture || 0), recorded_at:stamp,
  };
  const stationPatch={
    sensor_code:String(payload.sensor_code || sensor.sensor_code), latitude:Number(payload.latitude ?? sensor.latitude), longitude:Number(payload.longitude ?? sensor.longitude),
    coverage_m:Number(payload.coverage_m ?? sensor.coverage_m), orientation_deg:Number(payload.orientation_deg ?? sensor.orientation_deg ?? 0), status:payload.status || sensor.status || 'Online', last_seen_at:stamp,
    nitrogen:readingData.nitrogen,phosphorus:readingData.phosphorus,potassium:readingData.potassium,ph:readingData.ph,organic_matter:readingData.organic_matter,moisture:readingData.moisture,recorded_at:stamp,
  };
  let stationRow;
  let schemaWarning='';
  try{stationRow=await updateRow(tables.sensors, payload.sensor_id, stationPatch, permission);}
  catch(error){
    if(!isSchemaMismatch(error))throw error;
    const legacyPatch={sensor_code:stationPatch.sensor_code,latitude:stationPatch.latitude,longitude:stationPatch.longitude,coverage_m:stationPatch.coverage_m,orientation_deg:stationPatch.orientation_deg,status:stationPatch.status,last_seen_at:stationPatch.last_seen_at};
    stationRow=await updateRow(tables.sensors,payload.sensor_id,legacyPatch,permission);
    schemaWarning='Sensor updated using the legacy station schema. Run npm.cmd run setup:appwrite once to enable the optimized latest-reading columns.';
  }
  const readingId = payload.mutation_id ? await stableId('reading',payload.mutation_id) : uid('reading');
  let historyWarning='';
  try{await upsertRow(tables.readings, readingId, readingData, permission);}
  catch(error){historyWarning=`Sensor updated, but its history snapshot could not be appended: ${error?.message||error}`;console.warn(historyWarning);}
  const exact={...sensor,...stationRow,...stationPatch,...readingData,id:payload.sensor_id,$id:payload.sensor_id,farm_id:sensor.farm_id};
  await writeSpatialChange({farmId:sensor.farm_id,type:'sensor',entityId:payload.sensor_id,action:'upsert',row:exact,logicalKey:stationPatch.sensor_code});
  return { readingId, farmId:sensor.farm_id, row:exact, warning:[schemaWarning,historyWarning].filter(Boolean).join(' ')||undefined };
}

async function deleteSensor(payload) {
  const sensorId=String(payload.sensor_id||'').trim();
  if(!sensorId)throw Object.assign(new Error('Sensor ID is required for deletion.'),{status:400});
  const existing=await getRow(tables.sensors,sensorId);
  if(!existing)return {deleted:true,farmId:payload.farm_id||'',deletedIds:[sensorId]};
  const farmId=existing.farm_id||payload.farm_id;
  let cleanupWarning='';
  try{await deleteRowsWhere(tables.readings,'sensor_id',sensorId);}
  catch(error){cleanupWarning=`Sensor history cleanup was skipped: ${error?.message||error}`;console.warn(cleanupWarning);}
  await deleteRowVerified(tables.sensors,sensorId);
  await writeSpatialChange({farmId,type:'sensor',entityId:sensorId,action:'delete',logicalKey:existing.sensor_code||''});
  return {deleted:true,farmId,deletedIds:[sensorId],warning:cleanupWarning||undefined};
}

async function rotateSensor(payload) {
  const sensor = await getRow(tables.sensors, payload.sensor_id);
  if (!sensor) throw Object.assign(new Error('Sensor not found.'), { status:404 });
  const farm = await getRow(tables.farms, sensor.farm_id);
  const angle = ((Number(payload.orientation_deg ?? sensor.orientation_deg ?? 0) % 360) + 360) % 360;
  const stationRow=await updateRow(tables.sensors, payload.sensor_id, { orientation_deg: angle, last_seen_at: sensor.last_seen_at || now() }, perms(farm?.farmer_id));
  let latest={};
  if(!Object.prototype.hasOwnProperty.call(sensor,'recorded_at')){
    const readings=await listRows(tables.readings,[Query.equal('sensor_id',[payload.sensor_id]),Query.orderDesc('recorded_at')],1).catch(()=>({rows:[]}));
    latest=readings?.rows?.[0]||{};
  }
  const exact={...sensor,...stationRow,...latest,id:payload.sensor_id,$id:payload.sensor_id,orientation_deg:angle};
  await writeSpatialChange({farmId:sensor.farm_id,type:'sensor',entityId:payload.sensor_id,action:'upsert',row:exact,logicalKey:sensor.sensor_code});
  return { updated:true, farmId:sensor.farm_id, orientation_deg:angle, row:exact };
}

// Spatial mutations return only the record they actually changed. A single
// Sensor/Plot/Drone write must never return a whole-farm snapshot that can
// accidentally replace unrelated map collections with an eventually-consistent
// list response. Full snapshots are reserved for explicit workspace reads.
async function createPlot(payload) {
  const approvalFast=payload._approval_fast===true;
  const farm = payload._farm_row || await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  if (!Array.isArray(payload.geojson) || payload.geojson.length < 3) throw Object.assign(new Error('Soil analysis plot needs at least 3 polygon points.'), { status:400 });
  const mutationId=String(payload.mutation_id||'').trim();
  const plotId = mutationId ? await stableId('plot',mutationId) : uid('plot');
  const analysisId = mutationId ? await stableId('analysis',mutationId) : uid('analysis');
  const permission = perms(farm.farmer_id);
  const sampledAt = payload.sampled_at || now();
  const analyzedAt = payload.analyzed_at || now();
  const analysisData={farm_id:payload.farm_id,plot_id:plotId,nitrogen:Number(payload.nitrogen||0),phosphorus:Number(payload.phosphorus||0),potassium:Number(payload.potassium||0),ph:Number(payload.ph||0),organic_matter:Number(payload.organic_matter||0),classification:payload.classification||'Pending',sampled_at:sampledAt,analyzed_at:analyzedAt,notes:String(payload.notes||'')};
  const plotData={farm_id:payload.farm_id,plot_code:String(payload.plot_code || 'SOIL-PLOT').trim(),latitude:Number(payload.latitude),longitude:Number(payload.longitude),coverage_m:Number(payload.coverage_m || 0),boundary_geojson:JSON.stringify(payload.geojson),sampled_at:sampledAt,nitrogen:analysisData.nitrogen,phosphorus:analysisData.phosphorus,potassium:analysisData.potassium,ph:analysisData.ph,organic_matter:analysisData.organic_matter,classification:analysisData.classification,analyzed_at:analyzedAt,notes:analysisData.notes};
  let plotRow;
  let schemaWarning='';
  try{
    plotRow=approvalFast
      ? await upsertRowFast(tables.plots,plotId,plotData,permission,{timeoutMs:6500})
      : await upsertRow(tables.plots,plotId,plotData,permission);
  }
  catch(error){
    if(error?.status===404)throw Object.assign(new Error('The soil_plots table is missing. Run npm.cmd run setup:appwrite, then retry.'),{status:400});
    if(!isSchemaMismatch(error))throw error;
    const legacyPlotData={farm_id:plotData.farm_id,plot_code:plotData.plot_code,latitude:plotData.latitude,longitude:plotData.longitude,coverage_m:plotData.coverage_m,boundary_geojson:plotData.boundary_geojson,sampled_at:plotData.sampled_at};
    plotRow=approvalFast
      ? await upsertRowFast(tables.plots,plotId,legacyPlotData,permission,{timeoutMs:6500})
      : await upsertRow(tables.plots,plotId,legacyPlotData,permission);
    schemaWarning='Soil Plot saved using the legacy plot schema. Run npm.cmd run setup:appwrite once to enable the optimized latest-analysis columns.';
  }
  let analysisRow={};
  let historyWarning='';
  if(!approvalFast){
    try{analysisRow=await upsertRow(tables.analyses,analysisId,analysisData,permission);}
    catch(error){historyWarning=`Soil Plot saved, but its analysis-history row could not be appended: ${error?.message||error}`;console.warn(historyWarning);}
  }
  const exact={...plotRow,...plotData,...analysisRow,...analysisData,id:plotId,$id:plotId,boundary:[...payload.geojson]};
  if(!approvalFast)await writeSpatialChange({farmId:payload.farm_id,type:'plot',entityId:plotId,action:'upsert',row:exact,logicalKey:plotData.plot_code});
  return {plotId,analysisId,farmId:payload.farm_id,row:exact,warning:[schemaWarning,historyWarning].filter(Boolean).join(' ')||undefined};
}

async function updatePlot(payload) {
  const plot = await getRow(tables.plots, payload.plot_id);
  if (!plot) throw Object.assign(new Error('Soil plot not found.'), { status:404 });
  const farm = await getRow(tables.farms, plot.farm_id);
  const permission = perms(farm?.farmer_id);
  const analyzedAt=now();
  const data={nitrogen:Number(payload.nitrogen || 0),phosphorus:Number(payload.phosphorus || 0),potassium:Number(payload.potassium || 0),ph:Number(payload.ph || 0),organic_matter:Number(payload.organic_matter || 0),classification:payload.classification || 'Pending',analyzed_at:analyzedAt,notes:String(payload.notes || '')};
  const plotPatch={plot_code:String(payload.plot_code || plot.plot_code),latitude:Number(payload.latitude ?? plot.latitude),longitude:Number(payload.longitude ?? plot.longitude),coverage_m:Number(payload.coverage_m ?? plot.coverage_m),...(payload.geojson ? {boundary_geojson:JSON.stringify(payload.geojson)}:{}),...data};
  // The plot row itself is authoritative. History is secondary and must never
  // make a successfully-published polygon look like a failed save.
  let plotRow;
  let schemaWarning='';
  try{plotRow=await updateRow(tables.plots,payload.plot_id,plotPatch,permission);}
  catch(error){
    if(!isSchemaMismatch(error))throw error;
    const legacyPatch={plot_code:plotPatch.plot_code,latitude:plotPatch.latitude,longitude:plotPatch.longitude,coverage_m:plotPatch.coverage_m,...(plotPatch.boundary_geojson?{boundary_geojson:plotPatch.boundary_geojson}:{})};
    plotRow=await updateRow(tables.plots,payload.plot_id,legacyPatch,permission);
    schemaWarning='Soil Plot updated using the legacy plot schema. Run npm.cmd run setup:appwrite once to enable the optimized latest-analysis columns.';
  }
  let analysis={};
  let analysisRow={};
  let historyWarning='';
  try{
    const existing=await listRows(tables.analyses,[Query.equal('plot_id',[payload.plot_id]),Query.orderDesc('analyzed_at')],1);
    analysis=existing?.rows?.[0]||{};
    if(analysis?.$id)analysisRow=await updateRow(tables.analyses,analysis.$id,data,permission);
    else analysisRow=await createRow(tables.analyses,uid('analysis'),{farm_id:plot.farm_id,plot_id:payload.plot_id,sampled_at:now(),...data},permission);
  }catch(error){historyWarning=`Soil Plot updated, but its analysis-history row could not be updated: ${error?.message||error}`;console.warn(historyWarning);}
  const boundary=payload.geojson?[...payload.geojson]:parseStoredBoundary(plotPatch.boundary_geojson||plot.boundary_geojson);
  const exact={...plot,...plotRow,...plotPatch,...analysis,...analysisRow,...data,id:payload.plot_id,$id:payload.plot_id,farm_id:plot.farm_id,boundary};
  await writeSpatialChange({farmId:plot.farm_id,type:'plot',entityId:payload.plot_id,action:'upsert',row:exact,logicalKey:plotPatch.plot_code});
  return {updated:true,farmId:plot.farm_id,row:exact,warning:[schemaWarning,historyWarning].filter(Boolean).join(' ')||undefined};
}

async function deletePlot(payload) {
  const plotId=String(payload.plot_id||'').trim();
  if(!plotId)throw Object.assign(new Error('Soil plot ID is required for deletion.'),{status:400});
  const existing=await getRow(tables.plots,plotId);
  if(!existing)return {deleted:true,farmId:payload.farm_id||'',deletedIds:[plotId]};
  const farmId=existing.farm_id||payload.farm_id;
  let cleanupWarning='';
  try{await deleteRowsWhere(tables.analyses,'plot_id',plotId);}
  catch(error){cleanupWarning=`Soil-analysis history cleanup was skipped: ${error?.message||error}`;console.warn(cleanupWarning);}
  await deleteRowVerified(tables.plots,plotId);
  await writeSpatialChange({farmId,type:'plot',entityId:plotId,action:'delete',logicalKey:existing.plot_code||''});
  return {deleted:true,farmId,deletedIds:[plotId],warning:cleanupWarning||undefined};
}

async function createDroneMapping(payload) {
  const approvalFast=payload._approval_fast===true;
  const farm = payload._farm_row || await getRow(tables.farms, payload.farm_id);
  if (!farm) throw Object.assign(new Error('Farm not found.'), { status:404 });
  if (!Array.isArray(payload.geojson) || payload.geojson.length < 3) throw Object.assign(new Error('Drone mapping needs at least 3 polygon points.'), { status:400 });
  const mutationId=String(payload.mutation_id||'').trim();
  const id = mutationId ? await stableId('drone',mutationId) : uid('drone');
  const data={farm_id:payload.farm_id,name:String(payload.name || 'Drone Mapping').trim(),boundary_geojson:JSON.stringify(payload.geojson),center_lat:Number(payload.center_lat || 0),center_lng:Number(payload.center_lng || 0),area_hectares:Number(payload.area_hectares || 0),nitrogen:Number(payload.nitrogen || 0),phosphorus:Number(payload.phosphorus || 0),potassium:Number(payload.potassium || 0),ph:Number(payload.ph || 0),organic_matter:Number(payload.organic_matter || 0),moisture:Number(payload.moisture || 0),classification:String(payload.classification || 'Unclassified'),notes:String(payload.notes || ''),image_url:String(payload.image_url || ''),captured_at:payload.captured_at || now(),status:payload.status || 'Mapped'};
  let createdRow;
  let schemaWarning='';
  try{
    createdRow=approvalFast
      ? await upsertRowFast(tables.drone,id,data,perms(farm.farmer_id),{timeoutMs:6500})
      : await upsertRow(tables.drone,id,data,perms(farm.farmer_id));
  }
  catch(err){
    if(err.status===404) throw Object.assign(new Error('The drone_mappings table is missing. Run npm.cmd run setup:appwrite, then retry.'),{status:400});
    if(!isSchemaMismatch(err))throw err;
    const legacyData={farm_id:data.farm_id,name:data.name,boundary_geojson:data.boundary_geojson,center_lat:data.center_lat,center_lng:data.center_lng,area_hectares:data.area_hectares,classification:data.classification,notes:data.notes,image_url:data.image_url,captured_at:data.captured_at,status:data.status};
    createdRow=approvalFast
      ? await upsertRowFast(tables.drone,id,legacyData,perms(farm.farmer_id),{timeoutMs:6500})
      : await upsertRow(tables.drone,id,legacyData,perms(farm.farmer_id));
    schemaWarning='Drone Mapping saved using the legacy table schema. Run npm.cmd run setup:appwrite once to enable all soil-observation columns.';
  }
  const exact={...createdRow,...data,id,$id:id,boundary:[...payload.geojson],latitude:data.center_lat,longitude:data.center_lng};
  if(!approvalFast)await writeSpatialChange({farmId:payload.farm_id,type:'drone',entityId:id,action:'upsert',row:exact,logicalKey:data.name});
  return {droneId:id,farmId:payload.farm_id,row:exact,warning:schemaWarning||undefined};
}

async function updateDroneMapping(payload) {
  if (!payload.drone_id) throw Object.assign(new Error('Drone mapping ID is required.'), { status:400 });
  const existing=await getRow(tables.drone,payload.drone_id);
  if(!existing) throw Object.assign(new Error('Drone mapping not found.'),{status:404});
  const data={name:String(payload.name ?? existing.name ?? 'Drone Mapping'),center_lat:Number(payload.center_lat ?? existing.center_lat ?? 0),center_lng:Number(payload.center_lng ?? existing.center_lng ?? 0),area_hectares:Number(payload.area_hectares ?? existing.area_hectares ?? 0),nitrogen:Number(payload.nitrogen ?? existing.nitrogen ?? 0),phosphorus:Number(payload.phosphorus ?? existing.phosphorus ?? 0),potassium:Number(payload.potassium ?? existing.potassium ?? 0),ph:Number(payload.ph ?? existing.ph ?? 0),organic_matter:Number(payload.organic_matter ?? existing.organic_matter ?? 0),moisture:Number(payload.moisture ?? existing.moisture ?? 0),classification:String(payload.classification ?? existing.classification ?? 'Unclassified'),notes:String(payload.notes ?? existing.notes ?? ''),image_url:String(payload.image_url ?? existing.image_url ?? ''),captured_at:payload.captured_at || existing.captured_at || now(),status:payload.status || existing.status || 'Mapped',...(payload.geojson?{boundary_geojson:JSON.stringify(payload.geojson)}:{})};
  const farm=await getRow(tables.farms,existing.farm_id);
  let updated;
  let schemaWarning='';
  try{updated=await updateRow(tables.drone,payload.drone_id,data,perms(farm?.farmer_id));}
  catch(error){
    if(!isSchemaMismatch(error))throw error;
    const legacyPatch={name:data.name,center_lat:data.center_lat,center_lng:data.center_lng,area_hectares:data.area_hectares,classification:data.classification,notes:data.notes,image_url:data.image_url,captured_at:data.captured_at,status:data.status,...(data.boundary_geojson?{boundary_geojson:data.boundary_geojson}:{})};
    updated=await updateRow(tables.drone,payload.drone_id,legacyPatch,perms(farm?.farmer_id));
    schemaWarning='Drone Mapping updated using the legacy table schema. Run npm.cmd run setup:appwrite once to enable all soil-observation columns.';
  }
  const boundary=payload.geojson?[...payload.geojson]:parseStoredBoundary(data.boundary_geojson||existing.boundary_geojson);
  const exact={...existing,...updated,...data,id:payload.drone_id,$id:payload.drone_id,farm_id:existing.farm_id,boundary,latitude:data.center_lat,longitude:data.center_lng};
  await writeSpatialChange({farmId:existing.farm_id,type:'drone',entityId:payload.drone_id,action:'upsert',row:exact,logicalKey:data.name});
  return {updated:true,farmId:existing.farm_id,row:exact,warning:schemaWarning||undefined};
}

async function deleteDroneMapping(payload) {
  const droneId=String(payload.drone_id||'').trim();
  if(!droneId)throw Object.assign(new Error('Drone mapping ID is required for deletion.'),{status:400});
  const existing=await getRow(tables.drone,droneId);
  if(!existing)return {deleted:true,farmId:payload.farm_id||'',deletedIds:[droneId]};
  const farmId=existing.farm_id||payload.farm_id;
  await deleteRowVerified(tables.drone,droneId);
  await writeSpatialChange({farmId,type:'drone',entityId:droneId,action:'delete',logicalKey:existing.name||''});
  return {deleted:true,farmId,deletedIds:[droneId]};
}

async function getAdminWorkspace() {
  if(adminWorkspaceSnapshot.data&&Date.now()<adminWorkspaceSnapshot.expiresAt)return adminWorkspaceSnapshot.data;
  // Hot path: four Appwrite reads for the complete Admin snapshot. Sensor and
  // plot rows carry their latest nutrient values in v1.10.22, so the historical
  // tables are only queried for legacy rows that have not been migrated yet.
  const [farmsResult,sensorsResult,plotsResult,droneResult]=await Promise.all([
    listRows(tables.farms,[],250),
    listRows(tables.sensors,[],500),
    listRows(tables.plots,[],500),
    listRows(tables.drone,[],500).catch(()=>({rows:[]})),
  ]);
  const sensorAll=currentSpatialRows(sensorsResult?.rows||[]);
  // Ignore and permanently clean orphan Soil Plot rows that have no usable
  // polygon. Older optimistic create flows could leave one behind in Appwrite,
  // producing a 'Soil Plot • Pending • pH 0.00' source with no plotted area.
  const rawPlotAll=currentSpatialRows(plotsResult?.rows||[]);
  await purgeInvalidPlotRows(rawPlotAll);
  const plotAll=rawPlotAll.filter(validStoredPlot);
  const needsLegacyReadings=sensorAll.some(row=>!Object.prototype.hasOwnProperty.call(row,'recorded_at'));
  const needsLegacyAnalyses=plotAll.some(row=>!Object.prototype.hasOwnProperty.call(row,'analyzed_at'));
  const [readingsResult,analysesResult]=await Promise.all([
    needsLegacyReadings?listRows(tables.readings,[Query.orderDesc('recorded_at')],500):Promise.resolve({rows:[]}),
    needsLegacyAnalyses?listRows(tables.analyses,[Query.orderDesc('analyzed_at')],500):Promise.resolve({rows:[]}),
  ]);
  const farms=uniqueRows(farmsResult?.rows||[]).sort((a,b)=>String(a.farmer_name||'').localeCompare(String(b.farmer_name||'')));
  const byFarm=(rows=[])=>{const map=new Map();for(const row of uniqueRows(rows)){const id=row.farm_id;if(!id)continue;if(!map.has(id))map.set(id,[]);map.get(id).push(row);}return map;};
  const sensorsByFarm=byFarm(sensorAll),plotsByFarm=byFarm(plotAll),droneByFarm=byFarm(currentSpatialRows(droneResult?.rows||[]));
  const latestReading=new Map();for(const row of readingsResult?.rows||[])if(!latestReading.has(row.sensor_id))latestReading.set(row.sensor_id,row);
  const latestAnalysis=new Map();for(const row of analysesResult?.rows||[])if(!latestAnalysis.has(row.plot_id))latestAnalysis.set(row.plot_id,row);
  const bundles=[];
  for(const farm of farms){
    const farmId=farm.$id||farm.id;
    const sensorRows=uniqueRows(sensorsByFarm.get(farmId)||[]).map(sensor=>({...sensor,id:sensor.$id||sensor.id,...latestReading.get(sensor.$id||sensor.id)}));
    const rawPlots=(plotsByFarm.get(farmId)||[]);
    const plotRows=uniqueRows(rawPlots).map(plot=>({...plot,id:plot.$id||plot.id,boundary:parseStoredBoundary(plot.boundary_geojson),...latestAnalysis.get(plot.$id||plot.id)}));
    const drones=uniqueRows(droneByFarm.get(farmId)||[]).map(serverNormalizeDrone);
    bundles.push({farm:serverNormalizeFarm(farm),sensors:sensorRows,plots:plotRows,droneMappings:drones});
  }
  const snapshot={farms:bundles.map(item=>item.farm),bundles,repair:null,syncedAt:now()};
  adminWorkspaceSnapshot={data:snapshot,expiresAt:Date.now()+ADMIN_WORKSPACE_CACHE_MS};
  return snapshot;
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

const SUPPORT_AUTO_REPLY='Your message has been received an agent will accommodate you as soon as possible';
const supportPerms=(farmerId)=>[
  'read("label:admin")',
  'update("label:admin")',
  'delete("label:admin")',
  ...(farmerId?[`read("user:${farmerId}")`]:[]),
];

async function supportTableAvailable(timeoutMs=12000){
  if(Date.now()-supportTableCheckedAt<5*60*1000)return true;
  const table=await appwriteFetch(`/tablesdb/${databaseId}/tables/${tables.support}`,{key:true,allow404:true,timeoutMs});
  if(!table){
    const err=new Error('Support Chat is not initialized yet. Run "npm.cmd run setup:appwrite" once, then refresh SOILS.');
    err.status=503;
    throw err;
  }
  supportTableCheckedAt=Date.now();
  return true;
}

function isOptionalSchemaError(error){
  const text=String(error?.message||'').toLowerCase();
  return error?.status===400 && (text.includes('unknown')||text.includes('column')||text.includes('attribute')||text.includes('invalid document structure')||text.includes('invalid row structure'));
}
async function createSupportMessage({farmerId,farmId='',senderId='',senderRole='farmer',senderName='',message,readByAdmin=false,readByFarmer=false,createdAt='',requestId='',requestType='',timeoutMs=12000}){
  await supportTableAvailable(timeoutMs);
  const text=String(message||'').trim();
  if(!text)throw Object.assign(new Error('Message cannot be empty.'),{status:400});
  if(text.length>4000)throw Object.assign(new Error('Message is too long. Keep support messages under 4000 characters.'),{status:400});
  const rowId=uid('msg');
  const base={
    farmer_id:String(farmerId||''),farm_id:String(farmId||''),sender_id:String(senderId||''),
    sender_role:String(senderRole||'farmer'),sender_name:String(senderName||senderRole||'SOILS'),message:text,
    created_at:createdAt||now(),read_by_admin:!!readByAdmin,read_by_farmer:!!readByFarmer,
  };
  const enhanced={...base,request_id:String(requestId||''),request_type:String(requestType||'')};
  try{return await createRow(tables.support,rowId,enhanced,supportPerms(farmerId),{timeoutMs});}
  catch(error){
    // Backward compatibility: v1.10.26 introduced request_id/request_type. If
    // setup:appwrite was not rerun yet, do not let those optional columns block
    // the Farmer request itself or ordinary Support Chat delivery.
    if(!isOptionalSchemaError(error))throw error;
    return createRow(tables.support,rowId,base,supportPerms(farmerId),{timeoutMs});
  }
}


const requestPerms=(farmerId)=>[
  'read("label:admin")',
  'update("label:admin")',
  'delete("label:admin")',
  ...(farmerId?[`read("user:${farmerId}")`]:[]),
];

async function requestTableAvailable(timeoutMs=12000){
  if(Date.now()-requestTableCheckedAt<5*60*1000)return true;
  const table=await appwriteFetch(`/tablesdb/${databaseId}/tables/${tables.requests}`,{key:true,allow404:true,timeoutMs});
  if(!table){
    const err=new Error('Farmer map requests are not initialized yet. Run "npm.cmd run setup:appwrite" once, then refresh SOILS.');
    err.status=503;throw err;
  }
  requestTableCheckedAt=Date.now();return true;
}

async function createSpatialRequestRow(rowId,data,farmerId){
  try{return await createRow(tables.requests,rowId,data,requestPerms(farmerId));}
  catch(error){
    if(!isOptionalSchemaError(error))throw error;
    // Minimal v1.10.26-compatible request payload. Optional review/notes fields
    // may be absent if Appwrite setup was interrupted, but the request can still
    // reach Admin and be reviewed after setup is repaired.
    const minimal={
      farmer_id:data.farmer_id,farm_id:data.farm_id,request_type:data.request_type,title:data.title,
      status:data.status,geometry_geojson:data.geometry_geojson,center_lat:data.center_lat,center_lng:data.center_lng,
      created_at:data.created_at,
    };
    return createRow(tables.requests,rowId,minimal,requestPerms(farmerId));
  }
}
async function updateSpatialRequestRow(rowId,data,farmerId,{timeoutMs=5000}={}){
  try{return await updateRow(tables.requests,rowId,data,requestPerms(farmerId),{timeoutMs});}
  catch(error){
    if(!isOptionalSchemaError(error))throw error;
    const minimal={status:data.status};
    if(data.resolved_entity_id!==undefined)minimal.resolved_entity_id=data.resolved_entity_id;
    try{return await updateRow(tables.requests,rowId,minimal,requestPerms(farmerId),{timeoutMs});}
    catch(second){return updateRow(tables.requests,rowId,{status:data.status},requestPerms(farmerId),{timeoutMs});}
  }
}

function pointInStoredPolygon(point,polygon=[]){
  const y=Number(point?.[0]),x=Number(point?.[1]);if(!Number.isFinite(y)||!Number.isFinite(x))return false;
  let inside=false;const poly=cleanStoredPolygon(polygon);if(poly.length<3)return false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const yi=Number(poly[i][0]),xi=Number(poly[i][1]),yj=Number(poly[j][0]),xj=Number(poly[j][1]);
    const crosses=((yi>y)!==(yj>y)) && x < ((xj-xi)*(y-yi))/((yj-yi)||1e-12)+xi;
    if(crosses)inside=!inside;
  }
  return inside;
}
function pointInStoredFarm(point,farm){return parseStoredBoundaries(farm?.boundary_geojson).some(poly=>pointInStoredPolygon(point,poly));}
function requestGeometry(request){
  try{return JSON.parse(request?.geometry_geojson||'{}');}catch{return {};}
}
function normalizeSpatialRequest(row){
  if(!row)return null;const geometry=requestGeometry(row);let boundary=[];let latitude=Number(row.center_lat),longitude=Number(row.center_lng);
  if(geometry?.type==='Polygon'&&Array.isArray(geometry.coordinates?.[0])){
    boundary=cleanStoredPolygon(geometry.coordinates[0].map(([lng,lat])=>[lat,lng]));
    if(boundary.length){const stats=polygonAreaStats(boundary);latitude=stats.center_lat;longitude=stats.center_lng;}
  }else if(geometry?.type==='Point'&&Array.isArray(geometry.coordinates)){
    longitude=Number(geometry.coordinates[0]);latitude=Number(geometry.coordinates[1]);
  }
  return {...row,id:row.$id||row.id,boundary,latitude,longitude,center_lat:latitude,center_lng:longitude};
}
async function listSpatialRequestsForFarmer(farmerId,{pendingOnly=false}={}){
  await requestTableAvailable();
  // Fetch the farmer's request rows, then self-heal the rare two-phase case
  // where the real deterministic map record was published but the request's
  // status PATCH was interrupted. Pending request counts therefore cannot
  // resurrect an already-approved overlay on Admin or Farmer maps.
  const result=await listRows(tables.requests,[Query.equal('farmer_id',[farmerId])],120);
  const normalized=uniqueRows(result?.rows||[]).map(normalizeSpatialRequest);
  const reconciled=[];
  for(const request of normalized){
    reconciled.push(String(request.status||'pending').toLowerCase()==='pending'
      ? await reconcilePublishedSpatialRequest(request)
      : request);
  }
  const visible=pendingOnly?reconciled.filter(row=>String(row.status||'').toLowerCase()==='pending'):reconciled;
  return visible.sort((a,b)=>rowStamp(b)-rowStamp(a));
}

async function farmerCreateSpatialRequest(jwt,payload){
  const user=await verifyFarmerJWT(jwt);await requestTableAvailable();
  const profiles=await listRows(tables.profiles,[Query.equal('user_id',[user.$id])],2).catch(()=>({rows:[]}));
  const profile=profiles?.rows?.find(row=>row.role==='farmer')||profiles?.rows?.[0]||null;
  const farmId=String(profile?.farm_id||payload?.farm_id||'').trim();
  let farm=farmId?await getRow(tables.farms,farmId):null;
  if(!farm)throw Object.assign(new Error('Your assigned farm could not be verified.'),{status:403});
  // profiles.farm_id is the canonical assignment. Self-heal older farms whose
  // farmer_id/permissions were stale so a valid Farmer can still submit a request.
  if(farm.farmer_id!==user.$id){
    farm=await updateRow(tables.farms,farmId,{farmer_id:user.$id,farmer_name:farm.farmer_name||user.name||'Farmer'},perms(user.$id));
    await ensureFarmerRealtimeAccess(farmId,user.$id).catch(()=>{});
  }
  const type=String(payload.request_type||'').trim().toLowerCase();
  if(!['sensor','plot','drone'].includes(type))throw Object.assign(new Error('Choose Sensor, Soil Plot, or Drone Mapping.'),{status:400});
  const farmBoundaries=parseStoredBoundaries(farm.boundary_geojson);
  if(!farmBoundaries.length)throw Object.assign(new Error('Your farm needs an approved Farm Boundary before you can request a map placement.'),{status:400});
  let geometry,centerLat,centerLng;
  const points=cleanStoredPolygon(payload.points||[]);
  if(type==='sensor'){
    const point=points[0]||[Number(payload.latitude),Number(payload.longitude)];
    if(!Number.isFinite(Number(point?.[0]))||!Number.isFinite(Number(point?.[1])))throw Object.assign(new Error('Place the requested Sensor or enter a valid GPS coordinate.'),{status:400});
    if(!pointInStoredFarm(point,farm))throw Object.assign(new Error('The requested Sensor must be inside your mapped Farm Boundary.'),{status:400});
    centerLat=Number(point[0]);centerLng=Number(point[1]);geometry={type:'Point',coordinates:[centerLng,centerLat]};
  }else{
    if(points.length<3)throw Object.assign(new Error(`${type==='plot'?'Soil Plot':'Drone Mapping'} requests need at least 3 polygon points.`),{status:400});
    if(points.some(point=>!pointInStoredFarm(point,farm)))throw Object.assign(new Error('Every requested polygon point must be inside your mapped Farm Boundary.'),{status:400});
    const stats=polygonAreaStats(points);centerLat=stats.center_lat;centerLng=stats.center_lng;
    const ring=points.map(([lat,lng])=>[lng,lat]);if(ring.length)ring.push([...ring[0]]);geometry={type:'Polygon',coordinates:[ring]};
  }
  const clientRequestId=String(payload.client_request_id||'').trim().slice(0,96);
  const requestId=clientRequestId?await stableId('req',`${user.$id}:${farmId}:${clientRequestId}`):uid('req');
  const title=String(payload.title||`${type==='sensor'?'Sensor':type==='plot'?'Soil Plot':'Drone Mapping'} request`).trim().slice(0,128);
  const existingRequest=clientRequestId?await getRow(tables.requests,requestId).catch(()=>null):null;
  if(existingRequest){
    const request=normalizeSpatialRequest(existingRequest);
    return {request,messages:[],reused:true,notificationWarning:''};
  }
  const row=await createSpatialRequestRow(requestId,{
    farmer_id:user.$id,farm_id:farmId,request_type:type,title,status:'pending',geometry_geojson:JSON.stringify(geometry),
    center_lat:centerLat,center_lng:centerLng,coverage_m:Number(payload.coverage_m||50),orientation_deg:Number(payload.orientation_deg||0),notes:String(payload.notes||''),
    created_at:now(),reviewed_at:null,reviewed_by:'',resolution_note:'',resolved_entity_id:'',
  },user.$id);
  const label=type==='sensor'?'Sensor':type==='plot'?'Soil Plot':'Drone Mapping';
  const location=type==='sensor'?`${centerLat.toFixed(6)}, ${centerLng.toFixed(6)}`:`requested area centered at ${centerLat.toFixed(6)}, ${centerLng.toFixed(6)}`;
  const sentAt=Date.now();
  // The request row is authoritative. Support notification is deliberately
  // best-effort so a stale/partially migrated support_messages schema can never
  // trap the Farmer on Saving… or lose an otherwise valid approval request.
  const notices=await Promise.allSettled([
    createSupportMessage({farmerId:user.$id,farmId,senderId:user.$id,senderRole:'farmer',senderName:farm.farmer_name||user.name||'Farmer',message:`Map request: ${label} • ${title} • ${location}`,readByAdmin:false,readByFarmer:true,requestId,requestType:type,createdAt:new Date(sentAt).toISOString(),timeoutMs:2500}),
    createSupportMessage({farmerId:user.$id,farmId,senderId:'system',senderRole:'system',senderName:'SOILS Support',message:`Your ${label} placement request was submitted for administrator approval. You will receive the decision here in Support Chat.`,readByAdmin:true,readByFarmer:true,requestId,requestType:type,createdAt:new Date(sentAt+1).toISOString(),timeoutMs:2500}),
  ]);
  const messages=notices.filter(item=>item.status==='fulfilled').map(item=>({...item.value,id:item.value.$id||item.value.id}));
  const notificationWarning=notices.some(item=>item.status==='rejected')?'The request was saved, but Support Chat notification is still repairing. Admin can still see the pending request.':'';
  await writeSpatialChange({farmId,type:'request',entityId:requestId,action:'upsert',row:normalizeSpatialRequest(row),logicalKey:title}).catch(()=>{});
  invalidateWorkspaceSnapshots(farmId);
  return {request:normalizeSpatialRequest(row),messages,notificationWarning};
}

async function spatialRequestEntityIdentity(request,{fallback=false}={}){
  if(!request)return {type:'',entityId:'',tableId:''};
  const type=String(request.request_type||'').toLowerCase();
  if(!['sensor','plot','drone'].includes(type))return {type,entityId:'',tableId:''};
  const requestId=String(request.id||request.$id||'').trim();
  if(!requestId)return {type,entityId:'',tableId:''};
  const prefix=type==='sensor'?'sensor':type==='plot'?'plot':'drone';
  const token=fallback?`approval:${requestId}:fallback`:`approval:${requestId}`;
  const deterministicId=await stableId(prefix,token);
  const entityId=String(!fallback&&request.resolved_entity_id?request.resolved_entity_id:deterministicId||'').trim();
  const tableId=type==='sensor'?tables.sensors:type==='plot'?tables.plots:tables.drone;
  return {type,entityId,tableId};
}

async function resolvedSpatialRequestEntity(request,{allowPending=false,timeoutMs=3500}={}){
  if(!request)return null;
  const status=String(request.status||'pending').toLowerCase();
  if(!allowPending&&status!=='approved')return null;
  const primary=await spatialRequestEntityIdentity(request);
  const fallback=await spatialRequestEntityIdentity(request,{fallback:true});
  const candidates=[];
  for(const item of [primary,fallback]){
    if(item?.entityId&&!candidates.some(x=>x.entityId===item.entityId))candidates.push(item);
  }
  for(const {type,entityId,tableId} of candidates){
    if(!entityId||!tableId)continue;
    const row=await getRow(tableId,entityId,{timeoutMs}).catch(()=>null);
    if(!row)continue;
    if(type==='plot')return {...row,id:entityId,$id:entityId,boundary:parseStoredBoundary(row.boundary_geojson)};
    if(type==='drone')return {...serverNormalizeDrone(row),id:entityId,$id:entityId};
    return {...row,id:entityId,$id:entityId};
  }
  return null;
}

function approvalFallbackLabel(label,request,maxLength=64){
  const requestId=String(request?.id||request?.$id||'').replace(/[^A-Za-z0-9]/g,'');
  const suffix=requestId.slice(-6)||'request';
  const base=String(label||'Requested record').trim()||'Requested record';
  const tail=` ${suffix}`;
  return `${base.slice(0,Math.max(1,maxLength-tail.length))}${tail}`.slice(0,maxLength);
}

async function publishSpatialRequestEntity(request){
  const identity=await spatialRequestEntityIdentity(request);
  const type=identity.type;
  let entityId=identity.entityId;
  if(!entityId)throw Object.assign(new Error('The approval record ID could not be generated.'),{status:500});
  const farm=await getRow(tables.farms,request.farm_id,{timeoutMs:5000});
  if(!farm)throw Object.assign(new Error('The requested farm no longer exists.'),{status:404});
  const farmerId=String(farm.farmer_id||request.farmer_id||'').trim();
  const permission=perms(farmerId);
  const stamp=now();

  // Approval intentionally writes only the stable core columns that exist in
  // every supported SOILS schema. Measurement/history rows are secondary and
  // can be added later by the normal editors. This avoids one optional schema
  // column making every Farmer approval fail.
  if(type==='sensor'){
    const lat=Number(request.latitude??request.center_lat),lng=Number(request.longitude??request.center_lng);
    if(!Number.isFinite(lat)||!Number.isFinite(lng))throw Object.assign(new Error('The requested Sensor has an invalid GPS coordinate.'),{status:400});
    const createData={farm_id:request.farm_id,sensor_code:String(request.title||'Requested Sensor').slice(0,64),latitude:lat,longitude:lng,coverage_m:Number(request.coverage_m||50),orientation_deg:Number(request.orientation_deg||0),status:'Planned',installed_at:stamp,last_seen_at:stamp};
    const updateData={...createData};delete updateData.installed_at;
    let row;
    try{row=await upsertRowFast(tables.sensors,entityId,createData,permission,{updateData,timeoutMs:9000});}
    catch(error){
      if(error?.code!=='SOILS_CONFLICT_WITHOUT_ROW')throw error;
      entityId=(await spatialRequestEntityIdentity(request,{fallback:true})).entityId;
      const fallbackCreate={...createData,sensor_code:approvalFallbackLabel(createData.sensor_code,request,64)};
      const fallbackUpdate={...updateData,sensor_code:fallbackCreate.sensor_code};
      row=await upsertRowFast(tables.sensors,entityId,fallbackCreate,permission,{updateData:fallbackUpdate,timeoutMs:9000});
      Object.assign(createData,{sensor_code:fallbackCreate.sensor_code});
    }
    return {entityType:type,entityId,row:{...row,...createData,id:entityId,$id:entityId}};
  }

  const boundary=cleanStoredPolygon(request.boundary||[]);
  if(boundary.length<3)throw Object.assign(new Error(`${type==='plot'?'Soil Plot':'Drone Mapping'} request has no valid polygon to publish.`),{status:400});
  const stats=polygonAreaStats(boundary);
  if(type==='plot'){
    const createData={farm_id:request.farm_id,plot_code:String(request.title||'Requested Soil Plot').slice(0,64),latitude:Number(stats.center_lat),longitude:Number(stats.center_lng),coverage_m:0,boundary_geojson:JSON.stringify(boundary),sampled_at:stamp,classification:'Pending',notes:String(request.notes?`Approved Farmer request: ${request.notes}`:'Approved Farmer request')};
    let row;
    try{row=await upsertRowFast(tables.plots,entityId,createData,permission,{timeoutMs:9000});}
    catch(error){
      if(error?.code!=='SOILS_CONFLICT_WITHOUT_ROW')throw error;
      entityId=(await spatialRequestEntityIdentity(request,{fallback:true})).entityId;
      const fallbackCreate={...createData,plot_code:approvalFallbackLabel(createData.plot_code,request,64)};
      row=await upsertRowFast(tables.plots,entityId,fallbackCreate,permission,{timeoutMs:9000});
      Object.assign(createData,{plot_code:fallbackCreate.plot_code});
    }
    return {entityType:type,entityId,row:{...row,...createData,id:entityId,$id:entityId,boundary}};
  }

  const createData={farm_id:request.farm_id,name:String(request.title||'Requested Drone Mapping').slice(0,128),boundary_geojson:JSON.stringify(boundary),center_lat:Number(stats.center_lat),center_lng:Number(stats.center_lng),area_hectares:Number(stats.area_hectares||0),classification:'Unclassified',notes:String(request.notes?`Approved Farmer request: ${request.notes}`:'Approved Farmer request'),captured_at:stamp,status:'Planned'};
  let row;
  try{row=await upsertRowFast(tables.drone,entityId,createData,permission,{timeoutMs:9000});}
  catch(error){
    if(error?.code!=='SOILS_CONFLICT_WITHOUT_ROW')throw error;
    entityId=(await spatialRequestEntityIdentity(request,{fallback:true})).entityId;
    const fallbackCreate={...createData,name:approvalFallbackLabel(createData.name,request,128)};
    row=await upsertRowFast(tables.drone,entityId,fallbackCreate,permission,{timeoutMs:9000});
    Object.assign(createData,{name:fallbackCreate.name});
  }
  return {entityType:type,entityId,row:{...row,...createData,id:entityId,$id:entityId,boundary,latitude:createData.center_lat,longitude:createData.center_lng}};
}

async function finalizeSpatialRequest(request,status,{resolvedEntityId='',note=''}={}){
  const requestId=String(request.id||request.$id||'').trim();
  const payload={status,reviewed_at:now(),reviewed_by:'admin',resolution_note:String(note||'').trim(),resolved_entity_id:String(resolvedEntityId||'')};
  let lastError=null;
  for(let attempt=0;attempt<2;attempt++){
    try{return await updateSpatialRequestRow(requestId,payload,request.farmer_id,{timeoutMs:5500});}
    catch(error){lastError=error;if(attempt===0)await wait(180);}
  }
  throw lastError||new Error('The request status could not be updated.');
}

async function reconcilePublishedSpatialRequest(request){
  if(!request||String(request.status||'pending').toLowerCase()!=='pending')return request;
  const entity=await resolvedSpatialRequestEntity(request,{allowPending:true,timeoutMs:2500}).catch(()=>null);
  if(!entity)return request;
  const entityId=String(entity.id||entity.$id||'');
  try{
    const updated=await finalizeSpatialRequest(request,'approved',{resolvedEntityId:entityId,note:'Recovered from an already-published approved map record.'});
    return normalizeSpatialRequest({...request,...updated,status:'approved',resolved_entity_id:entityId});
  }catch(error){
    console.warn('Pending approval reconciliation delayed:',error?.message||error);
    // Even if the status PATCH is temporarily unavailable, never expose a
    // request as Pending after its deterministic real map record already exists.
    return normalizeSpatialRequest({...request,status:'approved',resolved_entity_id:entityId});
  }
}

async function reviewSpatialRequest(payload){
  const requestId=String(payload.request_id||'').trim();
  const decision=String(payload.decision||'').toLowerCase();
  if(!requestId||!['approve','reject'].includes(decision))throw Object.assign(new Error('Choose Approve or Reject for a valid request.'),{status:400});
  const raw=await getRow(tables.requests,requestId,{timeoutMs:5000});
  if(!raw)throw Object.assign(new Error('This Farmer request no longer exists.'),{status:404});
  let request=normalizeSpatialRequest(raw);
  const currentStatus=String(request.status||'pending').toLowerCase();

  if(['approved','rejected'].includes(currentStatus)){
    const recoveredEntity=currentStatus==='approved'?await resolvedSpatialRequestEntity(request,{allowPending:true}):null;
    return {request,alreadyReviewed:true,decision:currentStatus==='approved'?'approve':'reject',entityType:request.request_type,entity:recoveredEntity};
  }

  // A previous approval can successfully publish the deterministic spatial row
  // while its HTTP response/status PATCH is interrupted. Detect that condition
  // BEFORE attempting another write and finish the request automatically.
  const preexisting=await resolvedSpatialRequestEntity(request,{allowPending:true,timeoutMs:2500}).catch(()=>null);
  if(preexisting&&decision==='approve'){
    const entityId=String(preexisting.id||preexisting.$id||'');
    const updated=await finalizeSpatialRequest(request,'approved',{resolvedEntityId:entityId,note:String(payload.note||'')});
    request=normalizeSpatialRequest({...raw,...updated,status:'approved',resolved_entity_id:entityId});
    invalidateWorkspaceSnapshots(request.farm_id);
    return {request,decision:'approve',entityType:request.request_type,entity:preexisting,recovered:true};
  }

  if(decision==='reject'){
    const updated=await finalizeSpatialRequest(request,'rejected',{note:String(payload.note||'')});
    const normalized=normalizeSpatialRequest({...raw,...updated,status:'rejected'});
    invalidateWorkspaceSnapshots(request.farm_id);
    const label=request.request_type==='sensor'?'Sensor':request.request_type==='plot'?'Soil Plot':'Drone Mapping';
    createSupportMessage({farmerId:request.farmer_id,farmId:request.farm_id,senderId:'system',senderRole:'system',senderName:'SOILS Support',message:`Your ${label} map request "${request.title}" was not approved.${payload.note?` ${String(payload.note).trim()}`:''}`,readByAdmin:true,readByFarmer:false,requestId,requestType:request.request_type,timeoutMs:2500}).catch(()=>{});
    writeSpatialChange({farmId:request.farm_id,type:'request',entityId:requestId,action:'upsert',row:normalized,logicalKey:request.title}).catch(()=>{});
    return {request:normalized,decision:'reject',entityType:request.request_type,entity:null};
  }

  const published=await publishSpatialRequestEntity(request);
  const entityId=published.entityId;
  let updated=null;let statusWarning='';
  try{updated=await finalizeSpatialRequest(request,'approved',{resolvedEntityId:entityId,note:String(payload.note||'')});}
  catch(error){
    // The real Sensor/Plot/Drone is authoritative. Return success and let the
    // request reconciliation path finish the status on the next refresh.
    statusWarning=`The map record was published and the approval status will finish syncing automatically. ${error?.message||''}`.trim();
  }
  const normalized=normalizeSpatialRequest({...raw,...updated,status:'approved',reviewed_at:updated?.reviewed_at||now(),reviewed_by:'admin',resolution_note:String(payload.note||''),resolved_entity_id:entityId});
  invalidateWorkspaceSnapshots(request.farm_id);
  const label=request.request_type==='sensor'?'Sensor':request.request_type==='plot'?'Soil Plot':'Drone Mapping';
  createSupportMessage({farmerId:request.farmer_id,farmId:request.farm_id,senderId:'system',senderRole:'system',senderName:'SOILS Support',message:`Your ${label} map request "${request.title}" was approved by the administrator.`,readByAdmin:true,readByFarmer:false,requestId,requestType:request.request_type,timeoutMs:2500}).catch(()=>{});
  writeSpatialChange({farmId:request.farm_id,type:'request',entityId:requestId,action:'upsert',row:normalized,logicalKey:request.title}).catch(()=>{});
  writeSpatialChange({farmId:request.farm_id,type:request.request_type,entityId:entityId,action:'upsert',row:published.row,logicalKey:request.title}).catch(()=>{});
  return {request:normalized,decision:'approve',entityType:request.request_type,entity:published.row,statusWarning:statusWarning||undefined};
}


async function getSupportThreads(){
  // Pending map requests are authoritative and must reach Admin even when the
  // support_messages table is missing, partially migrated, or briefly slow.
  const [messageResult,farmsResult,requestResult]=await Promise.all([
    supportTableAvailable(3500).then(()=>listRows(tables.support,[Query.orderDesc('created_at')],300)).catch(()=>({rows:[]})),
    listRows(tables.farms,[],250).catch(()=>({rows:[]})),
    requestTableAvailable(5000).then(()=>listRows(tables.requests,[Query.orderDesc('created_at')],250)).catch(()=>({rows:[]})),
  ]);
  const farms=uniqueRows(farmsResult?.rows||[]);
  const farmByFarmer=new Map(farms.filter(f=>f.farmer_id).map(f=>[f.farmer_id,f]));
  const farmById=new Map(farms.map(f=>[f.$id||f.id,f]));
  const requests=[];
  for(const row of uniqueRows(requestResult?.rows||[])){
    let request=normalizeSpatialRequest(row);
    if(String(request?.status||'pending').toLowerCase()==='pending')request=await reconcilePublishedSpatialRequest(request);
    const farm=farmById.get(request?.farm_id)||farmByFarmer.get(request?.farmer_id)||null;
    requests.push({...request,farmer_name:farm?.farmer_name||'Farmer',farm_name:farm?.name||''});
  }
  const requestById=new Map(requests.map(request=>[request.id,request]));
  const groups=new Map();
  for(const row of uniqueRows(messageResult?.rows||[])){
    const farmerId=String(row.farmer_id||'');if(!farmerId)continue;
    if(!groups.has(farmerId))groups.set(farmerId,[]);
    groups.get(farmerId).push({...row,id:row.$id||row.id,request:row.request_id?requestById.get(row.request_id)||null:null});
  }
  // If the chat notification could not be written, synthesize a clickable inbox
  // item from spatial_requests itself. This keeps request delivery independent
  // from Support Chat schema timing and also creates a thread for first-time users.
  for(const request of requests){
    const farmerId=String(request.farmer_id||'');if(!farmerId)continue;
    if(!groups.has(farmerId))groups.set(farmerId,[]);
    const rows=groups.get(farmerId);
    const alreadyLinked=rows.some(row=>String(row.request_id||row.request?.id||'')===String(request.id));
    if(alreadyLinked)continue;
    const label=request.request_type==='sensor'?'Sensor':request.request_type==='plot'?'Soil Plot':'Drone Mapping';
    rows.push({
      id:`request_notice_${request.id}`,farmer_id:farmerId,farm_id:request.farm_id,
      sender_id:farmerId,sender_role:'farmer',sender_name:request.farmer_name||'Farmer',
      message:`Map request: ${label} • ${request.title||`${label} request`}`,
      created_at:request.created_at||request.$createdAt||now(),read_by_admin:true,read_by_farmer:true,
      request_id:request.id,request_type:request.request_type,request,synthetic_request_notice:true,
    });
  }
  const threads=[];
  for(const [farmerId,rows] of groups){
    rows.sort((a,b)=>rowStamp(a)-rowStamp(b));
    const last=rows[rows.length-1];
    const preview=[...rows].reverse().find(row=>row.sender_role!=='system')||last;
    const farm=farmById.get(last?.farm_id)||farmByFarmer.get(farmerId)||null;
    threads.push({
      farmer_id:farmerId,farm_id:farm?.$id||last?.farm_id||'',
      farmer_name:farm?.farmer_name||rows.find(row=>row.sender_role==='farmer')?.sender_name||'Farmer',
      farm_name:farm?.name||'',last_message:preview?.message||'',last_at:last?.created_at||last?.$createdAt||'',
      unread:rows.filter(row=>row.sender_role==='farmer'&&!row.read_by_admin&&!row.synthetic_request_notice).length,messages:rows.slice(-120),
    });
  }
  return threads.sort((a,b)=>(Date.parse(b.last_at||0)||0)-(Date.parse(a.last_at||0)||0));
}

async function adminSendSupportReply(payload){
  const farmerId=String(payload.farmer_id||'').trim();
  if(!farmerId)throw Object.assign(new Error('Choose a farmer conversation first.'),{status:400});
  let farmId=String(payload.farm_id||'');
  if(!farmId){
    const profileResult=await listRows(tables.profiles,[Query.equal('user_id',[farmerId])],1).catch(()=>({rows:[]}));
    farmId=String(profileResult?.rows?.[0]?.farm_id||'');
  }
  const row=await createSupportMessage({farmerId,farmId,senderId:'admin',senderRole:'admin',senderName:'SOILS Support',message:payload.message,readByAdmin:true,readByFarmer:false});
  return {message:{...row,id:row.$id||row.id}};
}

async function markSupportThreadRead(payload){
  const farmerId=String(payload.farmer_id||'').trim();
  if(!farmerId)return {updated:0};
  const rows=await listSupportMessagesForFarmer(farmerId);
  const unread=rows.filter(row=>row.sender_role==='farmer'&&!row.read_by_admin);
  await Promise.all(unread.map(row=>updateRow(tables.support,row.id,{read_by_admin:true},supportPerms(farmerId))));
  return {updated:unread.length};
}

const actions = {
  getAdminWorkspace, repairAdminWorkspace, getFarmWorkspace,
  createFarmer, deleteFarmer, updateFarmBoundary, deleteFarmBoundary,
  createSensor, updateSensor, rotateSensor, deleteSensor,
  createPlot, updatePlot, deletePlot,
  createDroneMapping, updateDroneMapping, deleteDroneMapping,
  getSupportThreads, adminSendSupportReply, markSupportThreadRead, reviewSpatialRequest,
};

export async function handleAdminAction({ jwt, action, payload = {} }) {
  await verifyAdmin(jwt);
  const fn = actions[action];
  if (!fn) throw Object.assign(new Error(`Unknown admin action: ${action}`), { status:400 });
  const readOnly=new Set(['getAdminWorkspace','getFarmWorkspace','getSupportThreads','adminSendSupportReply','markSupportThreadRead']);
  if(!readOnly.has(action))invalidateWorkspaceSnapshots(payload?.farm_id||'');
  return fn(payload);
}

function cleanStoredPolygon(points=[]) {
  const out=[];
  for(const point of points||[]){
    const lat=Number(point?.[0]),lng=Number(point?.[1]);
    if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
    const prev=out[out.length-1];
    if(prev&&Math.abs(prev[0]-lat)<1e-10&&Math.abs(prev[1]-lng)<1e-10)continue;
    out.push([lat,lng]);
  }
  if(out.length>2){const first=out[0],last=out[out.length-1];if(Math.abs(first[0]-last[0])<1e-10&&Math.abs(first[1]-last[1])<1e-10)out.pop();}
  return out;
}

function parseStoredBoundaries(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed?.type === 'MultiPolygon') {
      return (parsed.coordinates||[]).map(poly=>cleanStoredPolygon((poly?.[0]||[]).map(([lng,lat])=>[lat,lng]))).filter(poly=>poly.length>=3);
    }
    if (parsed?.type === 'Polygon' && Array.isArray(parsed.coordinates?.[0])) {
      const poly=cleanStoredPolygon(parsed.coordinates[0].map(([lng, lat]) => [lat, lng]));
      return poly.length>=3?[poly]:[];
    }
    if(Array.isArray(parsed)){
      if(parsed.length&&Array.isArray(parsed[0])&&Number.isFinite(Number(parsed[0]?.[0]))&&Number.isFinite(Number(parsed[0]?.[1]))){
        const poly=cleanStoredPolygon(parsed);return poly.length>=3?[poly]:[];
      }
      if(parsed.length&&Array.isArray(parsed[0])&&Array.isArray(parsed[0]?.[0])) return parsed.map(cleanStoredPolygon).filter(poly=>poly.length>=3);
    }
  } catch {}
  return [];
}

function parseStoredBoundary(value) { return parseStoredBoundaries(value)[0] || []; }
function validStoredPlot(row) {
  const boundary=parseStoredBoundary(row?.boundary_geojson);
  return boundary.length>=3 && boundary.every(point=>Array.isArray(point)&&point.length>=2&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1])));
}
async function purgeInvalidPlotRows(rows=[]) {
  const invalid=uniqueRows(rows).filter(row=>!validStoredPlot(row));
  if(!invalid.length)return 0;
  for(const row of invalid){
    const plotId=row?.$id||row?.id;
    if(!plotId)continue;
    try{await deleteRowsWhere(tables.analyses,'plot_id',plotId);}catch(error){console.warn('Orphan plot analysis cleanup skipped:',error?.message||error);}
    try{await deleteRowVerified(tables.plots,plotId);}catch(error){console.warn('Orphan Soil Plot cleanup skipped:',error?.message||error);continue;}
    if(row?.farm_id){
      farmBundleSnapshot.delete(row.farm_id);
      await writeSpatialChange({farmId:row.farm_id,type:'plot',entityId:plotId,action:'delete',logicalKey:row.plot_code||''}).catch(()=>{});
    }
  }
  return invalid.length;
}

function serializeStoredBoundaries(boundaries=[]) {
  const polygons=(boundaries||[]).map(cleanStoredPolygon).filter(poly=>poly.length>=3);
  return JSON.stringify({type:'MultiPolygon',coordinates:polygons.map(poly=>{const ring=poly.map(([lat,lng])=>[lng,lat]);if(ring.length){const first=ring[0],last=ring[ring.length-1];if(first[0]!==last[0]||first[1]!==last[1])ring.push([...first]);}return [ring];})});
}

function polygonAreaStats(points=[]) {
  const poly=cleanStoredPolygon(points);
  if(!poly.length)return {center_lat:0,center_lng:0,area_hectares:0};
  const lat0=poly.reduce((s,p)=>s+p[0],0)/poly.length;
  const lng0=poly.reduce((s,p)=>s+p[1],0)/poly.length;
  const cos=Math.cos(lat0*Math.PI/180);
  const xy=poly.map(([lat,lng])=>[(lng-lng0)*111320*cos,(lat-lat0)*111320]);
  let sum=0;for(let i=0;i<xy.length;i++){const [x1,y1]=xy[i],[x2,y2]=xy[(i+1)%xy.length];sum+=x1*y2-x2*y1;}
  return {center_lat:lat0,center_lng:lng0,area_hectares:Math.abs(sum)/2/10000};
}

function multiBoundaryStats(boundaries=[]) {
  const valid=(boundaries||[]).map(cleanStoredPolygon).filter(poly=>poly.length>=3);
  if(!valid.length)return {center_lat:0,center_lng:0,area_hectares:0};
  const parts=valid.map(polygonAreaStats);
  const total=parts.reduce((s,x)=>s+x.area_hectares,0);
  const weight=total>0?parts.map(x=>x.area_hectares):parts.map(()=>1);
  const denom=weight.reduce((s,x)=>s+x,0)||1;
  return {center_lat:parts.reduce((s,x,i)=>s+x.center_lat*weight[i],0)/denom,center_lng:parts.reduce((s,x,i)=>s+x.center_lng*weight[i],0)/denom,area_hectares:total};
}

function serverNormalizeFarm(row) {
  if(!row)return null;
  const boundaries=parseStoredBoundaries(row.boundary_geojson);
  return { ...row, id:row.$id || row.id, boundaries, boundary:boundaries[0] || [] };
}
function serverNormalizeDrone(row) {
  if (!row) return null;
  const boundary=parseStoredBoundary(row.boundary_geojson);
  const lat=Number(row.center_lat ?? row.latitude ?? (boundary.length?boundary.reduce((s,p)=>s+Number(p[0]||0),0)/boundary.length:0));
  const lng=Number(row.center_lng ?? row.longitude ?? (boundary.length?boundary.reduce((s,p)=>s+Number(p[1]||0),0)/boundary.length:0));
  return { ...row, id:row.$id || row.id, boundary, latitude:lat, longitude:lng, center_lat:lat, center_lng:lng };
}

async function buildAuthoritativeFarmBundle(farmId) {
  const cached=farmBundleSnapshot.get(farmId);
  if(cached&&Date.now()<cached.expiresAt)return cached.bundle;
  const [farm, sensorsResult, plotsResult, droneResult] = await Promise.all([
    getRow(tables.farms, farmId),
    listRows(tables.sensors, [Query.equal('farm_id', [farmId])],200),
    listRows(tables.plots, [Query.equal('farm_id', [farmId])],200),
    listRows(tables.drone, [Query.equal('farm_id', [farmId])],200).catch(()=>({rows:[]})),
  ]);
  if (!farm) return null;
  const sensorRows=currentSpatialRows(sensorsResult?.rows||[]);
  const rawPlotRows=currentSpatialRows(plotsResult?.rows||[]);
  await purgeInvalidPlotRows(rawPlotRows);
  const plotRowsRaw=rawPlotRows.filter(validStoredPlot);
  const needsLegacyReadings=sensorRows.some(row=>!Object.prototype.hasOwnProperty.call(row,'recorded_at'));
  const needsLegacyAnalyses=plotRowsRaw.some(row=>!Object.prototype.hasOwnProperty.call(row,'analyzed_at'));
  const [readingsResult,analysesResult]=await Promise.all([
    needsLegacyReadings?listRows(tables.readings,[Query.equal('farm_id',[farmId]),Query.orderDesc('recorded_at')],500):Promise.resolve({rows:[]}),
    needsLegacyAnalyses?listRows(tables.analyses,[Query.equal('farm_id',[farmId]),Query.orderDesc('analyzed_at')],500):Promise.resolve({rows:[]}),
  ]);
  const latestReading=new Map();
  for (const row of readingsResult?.rows || []) if (!latestReading.has(row.sensor_id)) latestReading.set(row.sensor_id,row);
  const latestAnalysis=new Map();
  for (const row of analysesResult?.rows || []) if (!latestAnalysis.has(row.plot_id)) latestAnalysis.set(row.plot_id,row);
  const plotRows=plotRowsRaw;
  const bundle={
    farm:serverNormalizeFarm(farm),
    sensors:sensorRows.map(sensor=>({ ...sensor, id:sensor.$id || sensor.id, ...latestReading.get(sensor.$id||sensor.id) })),
    plots:plotRows.map(plot=>({ ...plot, id:plot.$id || plot.id, boundary:parseStoredBoundary(plot.boundary_geojson), ...latestAnalysis.get(plot.$id||plot.id) })),
    droneMappings:currentSpatialRows(droneResult?.rows || []).map(serverNormalizeDrone),
  };
  farmBundleSnapshot.set(farmId,{bundle,expiresAt:Date.now()+FARM_BUNDLE_CACHE_MS});
  return bundle;
}

export async function handleFarmerWorkspace({ jwt }) {
  return farmerWorkspaceForJWT(jwt);
}

async function farmerWorkspaceForJWT(jwt){
  const user=await verifyFarmerJWT(jwt);

  let profiles=await listRows(tables.profiles,[Query.equal('user_id',[user.$id])]).catch(()=>({rows:[]}));
  const profile=profiles?.rows?.find(row=>row.role==='farmer') || profiles?.rows?.[0] || null;
  let farm=null;

  // The profile assignment is the canonical Farmer-to-farm link. Older SOILS
  // projects can have a stale farms.farmer_id even though profiles.farm_id is
  // correct; rejecting that profile made Admin records appear "not synced".
  if(profile?.farm_id) farm=await getRow(tables.farms,profile.farm_id).catch(()=>null);

  if(!farm){
    let owned=await listRows(tables.farms,[Query.equal('farmer_id',[user.$id])]).catch(()=>({rows:[]}));
    if((owned?.rows||[]).length>1){
      await repairDuplicateFarmerFarms();
      owned=await listRows(tables.farms,[Query.equal('farmer_id',[user.$id])]).catch(()=>({rows:[]}));
    }
    farm=newestRow(owned?.rows||[]);
  }

  if(!farm)return {farmId:null,bundle:null,syncedAt:now()};
  const farmId=farm.$id||farm.id;

  // Self-heal legacy ownership and row permissions so future Realtime journal
  // notifications can also be read by the assigned Farmer.
  if(farm.farmer_id!==user.$id){
    farm=await updateRow(tables.farms,farmId,{farmer_id:user.$id,farmer_name:farm.farmer_name||user.name||'Farmer'},perms(user.$id));
  }
  if(profile){
    if(profile.farm_id!==farmId || profile.active!==true)await updateRow(tables.profiles,profile.$id,{farm_id:farmId,active:true},perms(user.$id)).catch(()=>{});
  }

  // Repair legacy spatial journal permissions once per session window so the
  // Farmer receives immediate Realtime notifications after Admin changes.
  await ensureFarmerRealtimeAccess(farmId,user.$id);
  farmBundleSnapshot.delete(farmId);
  const bundle=await buildAuthoritativeFarmBundle(farmId);
  const requests=await listSpatialRequestsForFarmer(user.$id).catch(()=>[]);
  return {farmId,bundle:bundle?{...bundle,requests}:bundle,syncedAt:now()};
}

async function farmerSendSupportMessage(jwt,payload){
  const user=await verifyFarmerJWT(jwt);
  const profiles=await listRows(tables.profiles,[Query.equal('user_id',[user.$id])],2).catch(()=>({rows:[]}));
  const profile=profiles?.rows?.find(row=>row.role==='farmer')||profiles?.rows?.[0]||null;
  let farmId=String(profile?.farm_id||'');
  let farm=farmId?await getRow(tables.farms,farmId).catch(()=>null):null;
  if(!farm){
    const owned=await listRows(tables.farms,[Query.equal('farmer_id',[user.$id])],1).catch(()=>({rows:[]}));
    farm=owned?.rows?.[0]||null;farmId=String(farm?.$id||'');
  }
  const farmerId=user.$id;
  const farmerName=farm?.farmer_name||user.name||'Farmer';
  const sentAt=Date.now();
  const [farmerRow,replyRow]=await Promise.all([
    createSupportMessage({farmerId,farmId,senderId:farmerId,senderRole:'farmer',senderName:farmerName,message:payload.message,readByAdmin:false,readByFarmer:true,createdAt:new Date(sentAt).toISOString()}),
    createSupportMessage({farmerId,farmId,senderId:'system',senderRole:'system',senderName:'SOILS Support',message:SUPPORT_AUTO_REPLY,readByAdmin:true,readByFarmer:true,createdAt:new Date(sentAt+1).toISOString()}),
  ]);
  return {messages:[{...farmerRow,id:farmerRow.$id||farmerRow.id},{...replyRow,id:replyRow.$id||replyRow.id}]};
}

async function farmerListSupportMessages(jwt){
  const user=await verifyFarmerJWT(jwt);
  const [messages,requests]=await Promise.all([
    listSupportMessagesForFarmer(user.$id),
    listSpatialRequestsForFarmer(user.$id).catch(()=>[]),
  ]);
  // Mark real Admin/support rows as seen when the Farmer fetches the conversation.
  const unseen=messages.filter(row=>(row.sender_role==='admin'||row.sender_role==='system')&&!row.read_by_farmer);
  await Promise.all(unseen.map(row=>updateRow(tables.support,row.id,{read_by_farmer:true},supportPerms(user.$id)).catch(()=>{})));
  for(const row of unseen)row.read_by_farmer=true;

  // A reviewed spatial request is itself authoritative. If Support Chat was slow
  // or its optional request-link columns were missing, synthesize the decision
  // into the Farmer conversation so approval/rejection can never disappear.
  const merged=[...messages];
  for(const request of requests){
    const status=String(request.status||'pending').toLowerCase();
    if(!['approved','rejected'].includes(status))continue;
    const requestId=String(request.id||request.$id||'');
    const title=String(request.title||'map request');
    const alreadyLinked=messages.some(row=>String(row.request_id||'')===requestId || (row.sender_role==='system'&&String(row.message||'').includes(title)&&/(approved|not approved|rejected)/i.test(String(row.message||''))));
    if(alreadyLinked)continue;
    const label=request.request_type==='sensor'?'Sensor':request.request_type==='plot'?'Soil Plot':'Drone Mapping';
    merged.push({
      id:`request_status_${requestId}_${status}`,
      sender_role:'system',sender_name:'SOILS Support',sender_id:'system',farmer_id:user.$id,farm_id:request.farm_id,
      message:status==='approved'?`Your ${label} map request "${title}" was approved by the administrator.`:`Your ${label} map request "${title}" was not approved.${request.resolution_note?` ${request.resolution_note}`:''}`,
      created_at:request.reviewed_at||request.$updatedAt||request.created_at||request.$createdAt||now(),
      read_by_admin:true,read_by_farmer:true,request_id:requestId,request_type:request.request_type,synthetic_request_status:true,
    });
  }
  merged.sort((a,b)=>rowStamp(a)-rowStamp(b));
  return {messages:merged};
}

export async function handleFarmerAction({jwt,action='getWorkspace',payload={}}){
  if(action==='getWorkspace')return farmerWorkspaceForJWT(jwt);
  if(action==='sendSupportMessage')return farmerSendSupportMessage(jwt,payload);
  if(action==='createSpatialRequest')return farmerCreateSpatialRequest(jwt,payload);
  if(action==='listSupportMessages')return farmerListSupportMessages(jwt);
  throw Object.assign(new Error(`Unknown farmer action: ${action}`),{status:400});
}

