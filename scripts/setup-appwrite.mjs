import 'dotenv/config';
import { Query } from 'appwrite';

const endpoint = (process.env.VITE_APPWRITE_ENDPOINT || '').replace(/\/$/, '');
const projectId = process.env.VITE_APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;
const databaseId = process.env.VITE_APPWRITE_DATABASE_ID || 'soils_database';

if (!endpoint || !projectId) {
  console.error('Missing VITE_APPWRITE_ENDPOINT or VITE_APPWRITE_PROJECT_ID in .env');
  process.exit(1);
}
if (!apiKey) {
  console.error('\nAPPWRITE_API_KEY is blank. Paste your Appwrite server API key into .env first.\n');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'X-Appwrite-Project': projectId,
  'X-Appwrite-Key': apiKey,
  'X-Appwrite-Response-Format': '1.9.5',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(method, path, body, { allow404 = false, allow409 = false } = {}) {
  const res = await fetch(`${endpoint}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return null;

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if ((allow404 && res.status === 404) || (allow409 && res.status === 409)) return null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${data.message || text}`);
  return data;
}

const varchar = (key, size = 255, required = false) => ({ key, kind: 'varchar', size, required });
const text = (key, required = false) => ({ key, kind: 'text', required });
const float = (key, required = false) => ({ key, kind: 'float', required });
const boolean = (key, required = false) => ({ key, kind: 'boolean', required });
const datetime = (key, required = false) => ({ key, kind: 'datetime', required });
const index = (key, ...columns) => ({ key, type: 'key', columns });

const tables = [
  {
    id: 'profiles',
    name: 'Profiles',
    columns: [
      varchar('user_id', 36, true),
      varchar('full_name', 128, true),
      varchar('email', 320, true),
      varchar('role', 20, true),
      varchar('phone', 40),
      boolean('active'),
      varchar('farm_id', 36),
    ],
    indexes: [index('user_id_idx', 'user_id'), index('role_idx', 'role')],
  },
  {
    id: 'farms',
    name: 'Farms',
    columns: [
      varchar('farmer_id', 36, true),
      varchar('farmer_name', 128, true),
      varchar('name', 128, true),
      varchar('location_name', 255),
      float('center_lat', true),
      float('center_lng', true),
      text('boundary_geojson', true),
      float('area_hectares'),
      varchar('status', 32),
      datetime('last_analysis_at'),
    ],
    indexes: [index('farmer_id_idx', 'farmer_id'), index('farmer_name_idx', 'farmer_name')],
  },
  {
    id: 'sensor_stations',
    name: 'Sensor Stations',
    columns: [
      varchar('farm_id', 36, true),
      varchar('sensor_code', 64, true),
      float('latitude', true),
      float('longitude', true),
      float('coverage_m'),
      float('orientation_deg'),
      varchar('status', 32),
      datetime('installed_at'),
      datetime('last_seen_at'),
      // Latest snapshot is denormalized onto the station so dashboard loads do
      // not need to scan the sensor_readings history table on every refresh.
      float('nitrogen'),
      float('phosphorus'),
      float('potassium'),
      float('ph'),
      float('organic_matter'),
      float('moisture'),
      datetime('recorded_at'),
    ],
    indexes: [index('farm_id_idx', 'farm_id'), index('sensor_code_idx', 'sensor_code')],
  },
  {
    id: 'sensor_readings',
    name: 'Sensor Readings',
    columns: [
      varchar('farm_id', 36, true),
      varchar('sensor_id', 36, true),
      float('nitrogen'),
      float('phosphorus'),
      float('potassium'),
      float('ph'),
      float('organic_matter'),
      float('moisture'),
      datetime('recorded_at', true),
    ],
    indexes: [
      index('farm_id_idx', 'farm_id'),
      index('sensor_id_idx', 'sensor_id'),
      index('recorded_at_idx', 'recorded_at'),
    ],
  },
  {
    id: 'soil_plots',
    name: 'Soil Plots',
    columns: [
      varchar('farm_id', 36, true),
      varchar('plot_code', 64, true),
      float('latitude', true),
      float('longitude', true),
      float('coverage_m'),
      text('boundary_geojson'),
      datetime('sampled_at'),
      // Latest lab snapshot lives on the plot row for the hot dashboard path.
      float('nitrogen'),
      float('phosphorus'),
      float('potassium'),
      float('ph'),
      float('organic_matter'),
      varchar('classification', 32),
      datetime('analyzed_at'),
      text('notes'),
    ],
    indexes: [index('farm_id_idx', 'farm_id'), index('plot_code_idx', 'plot_code')],
  },
  {
    id: 'soil_analyses',
    name: 'Soil Analyses',
    columns: [
      varchar('farm_id', 36, true),
      varchar('plot_id', 36, true),
      float('nitrogen'),
      float('phosphorus'),
      float('potassium'),
      float('ph'),
      float('organic_matter'),
      varchar('classification', 32),
      datetime('sampled_at'),
      datetime('analyzed_at', true),
      text('notes'),
    ],
    indexes: [
      index('farm_id_idx', 'farm_id'),
      index('plot_id_idx', 'plot_id'),
      index('analyzed_at_idx', 'analyzed_at'),
    ],
  },
  {
    id: 'drone_mappings',
    name: 'Drone Mappings',
    columns: [
      varchar('farm_id', 36, true),
      varchar('name', 128, true),
      text('boundary_geojson', true),
      float('center_lat'),
      float('center_lng'),
      float('area_hectares'),
      float('nitrogen'),
      float('phosphorus'),
      float('potassium'),
      float('ph'),
      float('organic_matter'),
      float('moisture'),
      varchar('classification', 32),
      text('notes'),
      varchar('image_url', 2048),
      datetime('captured_at'),
      varchar('status', 32),
    ],
    indexes: [index('farm_id_idx', 'farm_id'), index('captured_at_idx', 'captured_at')],
  },

  {
    id: 'spatial_requests',
    name: 'Spatial Requests',
    columns: [
      varchar('farmer_id', 36, true),
      varchar('farm_id', 36, true),
      varchar('request_type', 16, true),
      varchar('title', 128, true),
      varchar('status', 16, true),
      text('geometry_geojson', true),
      float('center_lat', true),
      float('center_lng', true),
      float('coverage_m'),
      float('orientation_deg'),
      text('notes'),
      datetime('created_at', true),
      datetime('reviewed_at'),
      varchar('reviewed_by', 36),
      text('resolution_note'),
      varchar('resolved_entity_id', 36),
    ],
    indexes: [
      index('farmer_id_idx', 'farmer_id'),
      index('farm_id_idx', 'farm_id'),
      index('status_idx', 'status'),
      index('created_at_idx', 'created_at'),
      index('farmer_status_idx', 'farmer_id', 'status'),
    ],
  },
  {
    id: 'support_messages',
    name: 'Support Messages',
    columns: [
      varchar('farmer_id', 36, true),
      varchar('farm_id', 36),
      varchar('sender_id', 36),
      varchar('sender_role', 16, true),
      varchar('sender_name', 128),
      text('message', true),
      datetime('created_at', true),
      boolean('read_by_admin'),
      boolean('read_by_farmer'),
      varchar('request_id', 36),
      varchar('request_type', 16),
    ],
    indexes: [
      index('farmer_id_idx', 'farmer_id'),
      index('created_at_idx', 'created_at'),
      index('farmer_created_idx', 'farmer_id', 'created_at'),
      index('sender_role_idx', 'sender_role'),
    ],
  },
  {
    id: 'spatial_changes',
    name: 'Spatial Changes',
    columns: [
      varchar('farm_id', 36, true),
      varchar('entity_type', 20, true),
      varchar('entity_id', 36),
      varchar('logical_key', 128),
      varchar('action', 16, true),
      text('payload_json'),
      datetime('changed_at', true),
    ],
    indexes: [
      index('farm_id_idx', 'farm_id'),
      index('changed_at_idx', 'changed_at'),
    ],
  },
];

async function ensureDatabase() {
  const exists = await request('GET', `/tablesdb/${databaseId}`, undefined, { allow404: true });
  if (exists) {
    console.log(`✓ Database ${databaseId}`);
    return;
  }

  await request('POST', '/tablesdb', {
    databaseId,
    name: 'Soils Database',
    enabled: true,
  });
  console.log(`+ Database ${databaseId}`);
}

async function ensureTable(table) {
  const exists = await request(
    'GET',
    `/tablesdb/${databaseId}/tables/${table.id}`,
    undefined,
    { allow404: true },
  );

  if (exists) {
    console.log(`✓ Table ${table.id}`);
    return;
  }

  // Create an empty table first. Columns are created through their dedicated
  // Appwrite endpoints below. This avoids mixed-type bulk-create validation
  // issues seen with float columns on some Cloud deployments.
  await request('POST', `/tablesdb/${databaseId}/tables`, {
    tableId: table.id,
    name: table.name,
    permissions: [],
    rowSecurity: true,
    enabled: true,
    columns: [],
    indexes: [],
  });
  console.log(`+ Table ${table.id}`);
}

function columnCreateRequest(column) {
  const common = {
    key: column.key,
    required: column.required,
    array: false,
  };

  switch (column.kind) {
    case 'varchar':
      return {
        route: 'varchar',
        body: { ...common, size: column.size, encrypt: false },
      };
    case 'text':
      return {
        route: 'text',
        body: { ...common, encrypt: false },
      };
    case 'float':
      return {
        route: 'float',
        body: common,
      };
    case 'boolean':
      return {
        route: 'boolean',
        body: common,
      };
    case 'datetime':
      return {
        route: 'datetime',
        body: common,
      };
    default:
      throw new Error(`Unsupported local column kind: ${column.kind}`);
  }
}

async function waitForColumn(tableId, key) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const column = await request(
      'GET',
      `/tablesdb/${databaseId}/tables/${tableId}/columns/${key}`,
      undefined,
      { allow404: true },
    );

    if (column) {
      const status = column.status;
      if (!status || status === 'available') return column;
      if (status === 'failed') throw new Error(`Column ${tableId}.${key} failed: ${column.error || 'unknown error'}`);
    }

    await sleep(350);
  }

  throw new Error(`Timed out waiting for column ${tableId}.${key} to become available.`);
}

async function waitForColumnDeleted(tableId, key) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const column = await request(
      'GET',
      `/tablesdb/${databaseId}/tables/${tableId}/columns/${key}`,
      undefined,
      { allow404: true },
    );
    if (!column) return;
    await sleep(350);
  }
  throw new Error(`Timed out waiting for failed column ${tableId}.${key} to be removed.`);
}

async function ensureColumn(tableId, column) {
  let exists = await request(
    'GET',
    `/tablesdb/${databaseId}/tables/${tableId}/columns/${column.key}`,
    undefined,
    { allow404: true },
  );

  if (exists?.status === 'failed') {
    console.log(`  ! Repairing failed column ${column.key}`);
    await request('DELETE', `/tablesdb/${databaseId}/tables/${tableId}/columns/${column.key}`);
    await waitForColumnDeleted(tableId, column.key);
    exists = null;
  }

  if (exists) {
    if (exists.status && exists.status !== 'available') await waitForColumn(tableId, column.key);
    console.log(`  ✓ Column ${column.key}`);
    return;
  }

  const { route, body } = columnCreateRequest(column);
  await request('POST', `/tablesdb/${databaseId}/tables/${tableId}/columns/${route}`, body);
  await waitForColumn(tableId, column.key);
  console.log(`  + Column ${column.key} (${column.kind})`);
}

async function waitForIndex(tableId, key) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const idx = await request(
      'GET',
      `/tablesdb/${databaseId}/tables/${tableId}/indexes/${key}`,
      undefined,
      { allow404: true },
    );

    if (idx) {
      const status = idx.status;
      if (!status || status === 'available') return idx;
      if (status === 'failed') throw new Error(`Index ${tableId}.${key} failed: ${idx.error || 'unknown error'}`);
    }

    await sleep(350);
  }

  throw new Error(`Timed out waiting for index ${tableId}.${key} to become available.`);
}

async function waitForIndexDeleted(tableId, key) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const idx = await request(
      'GET',
      `/tablesdb/${databaseId}/tables/${tableId}/indexes/${key}`,
      undefined,
      { allow404: true },
    );
    if (!idx) return;
    await sleep(350);
  }
  throw new Error(`Timed out waiting for failed index ${tableId}.${key} to be removed.`);
}

async function ensureIndex(tableId, idx) {
  let exists = await request(
    'GET',
    `/tablesdb/${databaseId}/tables/${tableId}/indexes/${idx.key}`,
    undefined,
    { allow404: true },
  );

  if (exists?.status === 'failed') {
    console.log(`  ! Repairing failed index ${idx.key}`);
    await request('DELETE', `/tablesdb/${databaseId}/tables/${tableId}/indexes/${idx.key}`);
    await waitForIndexDeleted(tableId, idx.key);
    exists = null;
  }

  if (exists) {
    if (exists.status && exists.status !== 'available') await waitForIndex(tableId, idx.key);
    console.log(`  ✓ Index ${idx.key}`);
    return;
  }

  await request('POST', `/tablesdb/${databaseId}/tables/${tableId}/indexes`, {
    key: idx.key,
    type: idx.type,
    columns: idx.columns,
    orders: idx.columns.map(() => 'ASC'),
  });
  await waitForIndex(tableId, idx.key);
  console.log(`  + Index ${idx.key}`);
}

async function ensureUser(id, email, password, name, label) {
  if (!email || !password) return null;

  let user = await request('GET', `/users/${id}`, undefined, { allow404: true });
  if (!user) {
    user = await request('POST', '/users', { userId: id, email, password, name });
    console.log(`+ User ${email}`);
  } else {
    console.log(`✓ User ${email}`);
  }

  await request('PUT', `/users/${id}/labels`, { labels: [label] });
  return user;
}

const perms = (userId) => [
  'read("label:admin")',
  'update("label:admin")',
  'delete("label:admin")',
  ...(userId ? [`read("user:${userId}")`] : []),
];

async function upsert(table, rowId, data, permissions) {
  const existing = await request(
    'GET',
    `/tablesdb/${databaseId}/tables/${table}/rows/${rowId}`,
    undefined,
    { allow404: true },
  );

  if (existing) {
    await request('PUT', `/tablesdb/${databaseId}/tables/${table}/rows/${rowId}`, {
      data,
      permissions,
    });
    return;
  }

  await request('POST', `/tablesdb/${databaseId}/tables/${table}/rows`, {
    rowId,
    data,
    permissions,
  });
}

const polygon = (lat, lng) => JSON.stringify({
  type: 'Polygon',
  coordinates: [[
    [lng - 0.0045, lat + 0.0035],
    [lng + 0.0017, lat + 0.0045],
    [lng + 0.0048, lat + 0.0018],
    [lng + 0.0036, lat - 0.0035],
    [lng - 0.0017, lat - 0.0044],
    [lng - 0.0049, lat - 0.0010],
    [lng - 0.0045, lat + 0.0035],
  ]],
});

async function setupListRows(tableId, queries = []) {
  const params = new URLSearchParams();
  for (const query of [...queries, Query.limit(500)]) params.append('queries[]', query);
  return request('GET', `/tablesdb/${databaseId}/tables/${tableId}/rows?${params.toString()}`);
}

const samePermissions = (actual = [], expected = []) => {
  const a = [...actual].sort();
  const b = [...expected].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

async function migrateLatestSnapshots() {
  // One-time/read-light migration for v1.10.22. Future dashboard refreshes can
  // read sensor_stations and soil_plots directly instead of also downloading
  // the complete readings/analyses lists.
  const [sensorsResult,readingsResult,plotsResult,analysesResult]=await Promise.all([
    setupListRows('sensor_stations'),
    setupListRows('sensor_readings',[Query.orderDesc('recorded_at')]),
    setupListRows('soil_plots'),
    setupListRows('soil_analyses',[Query.orderDesc('analyzed_at')]),
  ]);
  const latestReading=new Map();
  for(const row of readingsResult?.rows||[])if(row.sensor_id&&!latestReading.has(row.sensor_id))latestReading.set(row.sensor_id,row);
  const latestAnalysis=new Map();
  for(const row of analysesResult?.rows||[])if(row.plot_id&&!latestAnalysis.has(row.plot_id))latestAnalysis.set(row.plot_id,row);
  const patches=[];
  for(const sensor of sensorsResult?.rows||[]){
    const latest=latestReading.get(sensor.$id);if(!latest)continue;
    if(sensor.recorded_at===latest.recorded_at&&sensor.nitrogen!==undefined)continue;
    patches.push(['sensor_stations',sensor.$id,{
      nitrogen:Number(latest.nitrogen||0),phosphorus:Number(latest.phosphorus||0),potassium:Number(latest.potassium||0),ph:Number(latest.ph||0),organic_matter:Number(latest.organic_matter||0),moisture:Number(latest.moisture||0),recorded_at:latest.recorded_at,
    }]);
  }
  for(const plot of plotsResult?.rows||[]){
    const latest=latestAnalysis.get(plot.$id);if(!latest)continue;
    if(plot.analyzed_at===latest.analyzed_at&&plot.classification!==undefined)continue;
    patches.push(['soil_plots',plot.$id,{
      nitrogen:Number(latest.nitrogen||0),phosphorus:Number(latest.phosphorus||0),potassium:Number(latest.potassium||0),ph:Number(latest.ph||0),organic_matter:Number(latest.organic_matter||0),classification:String(latest.classification||'Pending'),analyzed_at:latest.analyzed_at,notes:String(latest.notes||''),
    }]);
  }
  for(let i=0;i<patches.length;i+=20){
    await Promise.all(patches.slice(i,i+20).map(([table,rowId,data])=>request('PATCH',`/tablesdb/${databaseId}/tables/${table}/rows/${rowId}`,{data})));
  }
  console.log(patches.length?`+ Migrated ${patches.length} latest nutrient snapshots for faster dashboard reads`:'✓ Latest nutrient snapshots already optimized');
}

async function repairExistingFarmerAccess() {
  const farmsResult = await setupListRows('farms');
  const farms = farmsResult?.rows || [];
  if (!farms.length) {
    console.log('• Farmer access repair skipped (no farms yet).');
    return;
  }

  const [profilesResult, sensorsResult, readingsResult, plotsResult, analysesResult, droneResult, changesResult, supportResult, requestsResult] = await Promise.all([
    setupListRows('profiles'),
    setupListRows('sensor_stations'),
    setupListRows('sensor_readings'),
    setupListRows('soil_plots'),
    setupListRows('soil_analyses'),
    setupListRows('drone_mappings'),
    setupListRows('spatial_changes'),
    setupListRows('support_messages'),
    setupListRows('spatial_requests'),
  ]);

  const farmById = new Map(farms.map((farm) => [farm.$id, farm]));
  const farmByOwner = new Map();
  for (const farm of farms) if (farm.farmer_id && !farmByOwner.has(farm.farmer_id)) farmByOwner.set(farm.farmer_id,farm.$id);
  const targets = [];
  for (const profile of profilesResult?.rows || []) {
    if (profile.role !== 'farmer' || !profile.user_id) continue;
    // profiles.farm_id is the canonical assignment. Older projects sometimes
    // have a stale farms.farmer_id; repair the farm ownership instead of moving
    // the Farmer profile to a different workspace.
    let assignedFarm=profile.farm_id?farmById.get(profile.farm_id):null;
    if (!assignedFarm) {
      const fallbackId=farmByOwner.get(profile.user_id);
      assignedFarm=fallbackId?farmById.get(fallbackId):null;
      if (assignedFarm && profile.farm_id !== assignedFarm.$id) {
        await request('PATCH', `/tablesdb/${databaseId}/tables/profiles/rows/${profile.$id}`, {data:{farm_id:assignedFarm.$id,active:true},permissions:perms(profile.user_id)});
        profile.farm_id=assignedFarm.$id;profile.$permissions=perms(profile.user_id);
        console.log(`+ Re-linked farmer profile ${profile.user_id} -> ${assignedFarm.$id}`);
      }
    }
    if (assignedFarm && assignedFarm.farmer_id !== profile.user_id) {
      await request('PATCH', `/tablesdb/${databaseId}/tables/farms/rows/${assignedFarm.$id}`, {data:{farmer_id:profile.user_id},permissions:perms(profile.user_id)});
      assignedFarm.farmer_id=profile.user_id;assignedFarm.$permissions=perms(profile.user_id);
      console.log(`+ Repaired farm ownership ${assignedFarm.$id} -> ${profile.user_id}`);
    }
    targets.push(['profiles', profile, profile.user_id]);
  }
  const ownerByFarm = new Map(farms.map((farm) => [farm.$id, farm.farmer_id]));
  for (const farm of farms) targets.push(['farms', farm, farm.farmer_id]);
  for (const [tableId, rows] of [
    ['sensor_stations', sensorsResult?.rows || []],
    ['sensor_readings', readingsResult?.rows || []],
    ['soil_plots', plotsResult?.rows || []],
    ['soil_analyses', analysesResult?.rows || []],
    ['drone_mappings', droneResult?.rows || []],
    ['spatial_changes', changesResult?.rows || []],
    ['support_messages', supportResult?.rows || []],
    ['spatial_requests', requestsResult?.rows || []],
  ]) {
    for (const row of rows) {
      // Support messages can legitimately have a blank/stale farm_id while still
      // having the correct farmer_id. Prefer that direct ownership link so chat
      // Realtime/read access is repaired even for legacy conversations.
      const farmerId = (tableId==='support_messages'||tableId==='spatial_requests')
        ? (row.farmer_id || ownerByFarm.get(row.farm_id))
        : ownerByFarm.get(row.farm_id);
      if (farmerId) targets.push([tableId, row, farmerId]);
    }
  }

  const repairs = targets.filter(([, row, farmerId]) => !samePermissions(row.$permissions, perms(farmerId)));
  for (let i = 0; i < repairs.length; i += 20) {
    await Promise.all(repairs.slice(i, i + 20).map(([tableId, row, farmerId]) =>
      request('PATCH', `/tablesdb/${databaseId}/tables/${tableId}/rows/${row.$id}`, {
        data: {},
        permissions: perms(farmerId),
      })
    ));
  }

  console.log(repairs.length
    ? `+ Repaired farmer read access on ${repairs.length} existing rows`
    : '✓ Existing farmer row permissions are already synchronized');
}


async function cleanupLegacySampleArtifacts() {
  // Older SOILS builds seeded a Sample Farm, three NPK sensors and LAB-A1.
  // Those fixed IDs are safe to remove and were the source of the recurring
  // yellow plot pin after setup was rerun. User-created records use random IDs.
  const legacyRows = [
    ['sensor_readings','reading_sensor_farmer1_01'],
    ['sensor_readings','reading_sensor_farmer1_02'],
    ['sensor_readings','reading_sensor_farmer1_03'],
    ['soil_analyses','analysis_farmer1_a1'],
    ['sensor_stations','sensor_farmer1_01'],
    ['sensor_stations','sensor_farmer1_02'],
    ['sensor_stations','sensor_farmer1_03'],
    ['soil_plots','plot_farmer1_a1'],
  ];
  let removed=0;
  for (const [tableId,rowId] of legacyRows) {
    const existing = await request('GET', `/tablesdb/${databaseId}/tables/${tableId}/rows/${rowId}`, undefined, {allow404:true});
    if (!existing) continue;
    await request('DELETE', `/tablesdb/${databaseId}/tables/${tableId}/rows/${rowId}`, undefined, {allow404:true});
    removed++;
  }

  const legacyFarm = await request('GET', `/tablesdb/${databaseId}/tables/farms/rows/farm_soil_farmer_1`, undefined, {allow404:true});
  if (legacyFarm) {
    const oldBoundary = polygon(10.4247, 122.9225);
    const isUntouchedLegacyBoundary = String(legacyFarm.boundary_geojson || '') === String(oldBoundary);
    const oldLocation = String(legacyFarm.location_name || '') === 'Replace with the actual farm location';
    const oldName = String(legacyFarm.name || '') === 'Sample Farm';
    if (isUntouchedLegacyBoundary || oldLocation || oldName) {
      await request('PATCH', `/tablesdb/${databaseId}/tables/farms/rows/${legacyFarm.$id}`, {
        data: {
          ...(oldName ? {name:`${legacyFarm.farmer_name || 'Farmer'} Farm`} : {}),
          ...(oldLocation ? {location_name:'Farm location not set'} : {}),
          ...(isUntouchedLegacyBoundary ? {boundary_geojson:'[]',area_hectares:0,status:'Unmapped',last_analysis_at:null} : {}),
        },
        permissions: perms(legacyFarm.farmer_id),
      });
    }
  }
  console.log(removed ? `+ Removed ${removed} legacy sample map records` : '✓ No legacy sample map records remain');
}

async function seed() {
  // Setup may optionally create the administrator account, but it never creates
  // a premade farmer, farm boundary, sensor, soil plot or drone mapping.
  const adminEmail = process.env.APPWRITE_ADMIN_EMAIL;
  const adminPass = process.env.APPWRITE_ADMIN_PASSWORD;
  const admin = await ensureUser(
    'soil_admin_1',
    adminEmail,
    adminPass,
    process.env.APPWRITE_ADMIN_NAME || 'Soils Administrator',
    'admin',
  );
  if (admin) {
    await upsert('profiles','profile_admin_1',{
      user_id:'soil_admin_1',
      full_name:process.env.APPWRITE_ADMIN_NAME || 'Soils Administrator',
      email:adminEmail,
      role:'admin',
      active:true,
    },perms('soil_admin_1'));
  }
  console.log('✓ No premade farmer/farm/pins are seeded. Create farmers from the Admin account.');
}

console.log('\nSOILS Appwrite setup v1.10.26');
console.log(`Endpoint: ${endpoint}`);
console.log(`Project:  ${projectId}`);
console.log(`Database: ${databaseId}\n`);

try {
  await ensureDatabase();

  for (const table of tables) {
    await ensureTable(table);
    for (const column of table.columns) await ensureColumn(table.id, column);
    for (const idx of table.indexes) await ensureIndex(table.id, idx);
  }

  await cleanupLegacySampleArtifacts();
  await migrateLatestSnapshots();
  await seed();
  await repairExistingFarmerAccess();
  console.log('\n✓ Appwrite setup complete.\n');
} catch (err) {
  console.error(`\nSetup failed: ${err.message}\n`);
  console.error('The setup is resume-safe. Fix the reported issue and run: npm.cmd run setup:appwrite');
  console.error('Required API key scopes: databases.read/write, tables.read/write, columns.read/write, indexes.read/write, rows.read/write, users.read/write.');
  process.exit(1);
}
