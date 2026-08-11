import 'dotenv/config';
import { Query } from 'appwrite';

const endpoint=(process.env.VITE_APPWRITE_ENDPOINT||'').replace(/\/$/,'');
const projectId=process.env.VITE_APPWRITE_PROJECT_ID;
const apiKey=process.env.APPWRITE_API_KEY;
const databaseId=process.env.VITE_APPWRITE_DATABASE_ID||'soils_database';

const tableIds={
  sensors:process.env.VITE_APPWRITE_SENSORS_TABLE_ID||'sensor_stations',
  readings:process.env.VITE_APPWRITE_READINGS_TABLE_ID||'sensor_readings',
  plots:process.env.VITE_APPWRITE_PLOTS_TABLE_ID||'soil_plots',
  analyses:process.env.VITE_APPWRITE_ANALYSES_TABLE_ID||'soil_analyses',
  drone:process.env.VITE_APPWRITE_DRONE_TABLE_ID||'drone_mappings',
  changes:process.env.VITE_APPWRITE_SPATIAL_CHANGES_TABLE_ID||'spatial_changes',
  requests:process.env.VITE_APPWRITE_SPATIAL_REQUESTS_TABLE_ID||process.env.APPWRITE_SPATIAL_REQUESTS_TABLE_ID||'spatial_requests',
  farms:process.env.VITE_APPWRITE_FARMS_TABLE_ID||'farms',
};

if(!endpoint||!projectId){console.error('Missing VITE_APPWRITE_ENDPOINT or VITE_APPWRITE_PROJECT_ID in .env');process.exit(1);}
if(!apiKey){console.error('\nAPPWRITE_API_KEY is blank. Paste your Appwrite server API key into .env first.\n');process.exit(1);}

const headers={
  'Content-Type':'application/json',
  'X-Appwrite-Project':projectId,
  'X-Appwrite-Key':apiKey,
  'X-Appwrite-Response-Format':'1.9.5',
};

async function request(method,path,body,{allow404=false}={}){
  const res=await fetch(`${endpoint}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  if(res.status===204)return null;
  const text=await res.text();let data={};
  try{data=text?JSON.parse(text):{};}catch{data={message:text};}
  if(allow404&&res.status===404)return null;
  if(!res.ok)throw new Error(`${method} ${path} -> ${res.status}: ${data.message||text}`);
  return data;
}

async function listFirstPage(tableId){
  const params=new URLSearchParams();
  params.append('queries[]',Query.limit(100));
  return request('GET',`/tablesdb/${databaseId}/tables/${tableId}/rows?${params.toString()}`,undefined,{allow404:true});
}

async function clearTable(tableId,label){
  let removed=0;
  while(true){
    const result=await listFirstPage(tableId);
    if(!result){console.log(`• ${label}: table not found, skipped`);return removed;}
    const rows=Array.isArray(result.rows)?result.rows:[];
    if(!rows.length)break;
    for(const row of rows){
      await request('DELETE',`/tablesdb/${databaseId}/tables/${tableId}/rows/${row.$id}`,undefined,{allow404:true});
      removed++;
    }
    process.stdout.write(`\r  ${label}: removed ${removed}`);
  }
  if(removed)process.stdout.write('\n');
  console.log(removed?`✓ ${label}: ${removed} removed`:`✓ ${label}: already empty`);
  return removed;
}

async function resetFarmAnalysisMetadata(){
  const result=await listFirstPage(tableIds.farms);
  if(!result)return;
  for(const farm of result.rows||[]){
    const boundary=String(farm.boundary_geojson||'').trim();
    let hasBoundary=false;
    try{
      const parsed=JSON.parse(boundary||'[]');
      hasBoundary=(Array.isArray(parsed)&&parsed.length>0) ||
        (parsed?.type==='Polygon'&&Array.isArray(parsed.coordinates?.[0])&&parsed.coordinates[0].length>=3) ||
        (parsed?.type==='MultiPolygon'&&Array.isArray(parsed.coordinates)&&parsed.coordinates.some(poly=>Array.isArray(poly?.[0])&&poly[0].length>=3));
    }catch{}
    await request('PATCH',`/tablesdb/${databaseId}/tables/${tableIds.farms}/rows/${farm.$id}`,{
      data:{last_analysis_at:null,status:hasBoundary?'Mapped':'Unmapped'},
    });
  }
  console.log(`✓ Farms preserved (${(result.rows||[]).length}); analysis metadata reset`);
}

console.log('\nSOILS spatial reset');
console.log('This removes ALL Sensors, Sensor Readings, Soil Plots, Soil Analyses, Drone Mappings, pending/processed Farmer map requests, and spatial-change journal rows.');
console.log('Farmer accounts, farm records, farm boundaries, and support messages are preserved.\n');

try{
  // Children/history first, then parent spatial records.
  const totals=[];
  totals.push(await clearTable(tableIds.readings,'Sensor readings'));
  totals.push(await clearTable(tableIds.analyses,'Soil analyses'));
  totals.push(await clearTable(tableIds.sensors,'Sensors'));
  totals.push(await clearTable(tableIds.plots,'Soil plots'));
  totals.push(await clearTable(tableIds.drone,'Drone mappings'));
  totals.push(await clearTable(tableIds.requests,'Farmer map requests'));
  totals.push(await clearTable(tableIds.changes,'Spatial change journal'));
  await resetFarmAnalysisMetadata();
  const total=totals.reduce((sum,n)=>sum+Number(n||0),0);
  console.log(`\n✓ Spatial reset complete. ${total} rows removed.`);
  console.log('Open SOILS and press Ctrl + F5 once if a browser tab was already open.\n');
}catch(err){
  console.error(`\nReset failed: ${err.message}\n`);
  console.error('Required API key scopes: rows.read/write and databases/tables read access.');
  process.exit(1);
}
