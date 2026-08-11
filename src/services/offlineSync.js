const QUEUE_VERSION='v11025-overhaul';
const CACHE_VERSION='v11025-overhaul';
const EVENT_NAME='soils-offline-sync-change';

const LEGACY_CACHE_PREFIXES=['soils-workspace-cache-','soils-offline-queue-'];
let legacyCachePurged=false;
export function purgeLegacySpatialBrowserState(){
  if(legacyCachePurged||typeof localStorage==='undefined')return;
  legacyCachePurged=true;
  try{
    const keepQueue=`soils-offline-queue-${QUEUE_VERSION}:`;
    const keepCache=`soils-workspace-cache-${CACHE_VERSION}:`;
    for(let i=localStorage.length-1;i>=0;i--){
      const key=localStorage.key(i)||'';
      if(LEGACY_CACHE_PREFIXES.some(prefix=>key.startsWith(prefix))&&!key.startsWith(keepQueue)&&!key.startsWith(keepCache))localStorage.removeItem(key);
    }
  }catch{}
}
purgeLegacySpatialBrowserState();

const queueKey=(userId)=>`soils-offline-queue-${QUEUE_VERSION}:${userId||'anonymous'}`;
const cacheKey=(role,userId)=>`soils-workspace-cache-${CACHE_VERSION}:${role||'unknown'}:${userId||'anonymous'}`;

const readJson=(key,fallback)=>{
  try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback;}catch{return fallback;}
};
const writeJson=(key,value)=>{
  try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}
};
const emit=()=>{try{window.dispatchEvent(new CustomEvent(EVENT_NAME));}catch{}};

export function createMutationId(prefix='change'){
  const id=globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

export function getPendingMutations(userId){
  const rows=readJson(queueKey(userId),[]);
  return Array.isArray(rows)?rows:[];
}

export function pendingMutationCount(userId){return getPendingMutations(userId).length;}

function entityKey(action,payload={}){
  if(action==='updateFarmBoundary') return payload.farm_id?`farm:${payload.farm_id}:boundary:add:${payload.mutation_id||Date.now()}`:'';
  if(action==='deleteFarmBoundary') return payload.farm_id?`farm:${payload.farm_id}:boundary:delete:${payload.mutation_id||(payload.boundary_index??'selected')}`:'';
  if(['updateSensor','rotateSensor','deleteSensor'].includes(action)) return payload.sensor_id?`sensor:${payload.sensor_id}`:'';
  if(['updatePlot','deletePlot'].includes(action)) return payload.plot_id?`plot:${payload.plot_id}`:'';
  if(['updateDroneMapping','deleteDroneMapping'].includes(action)) return payload.drone_id?`drone:${payload.drone_id}`:'';
  return '';
}

const createType=(action)=>action==='createSensor'?'sensor':action==='createPlot'?'plot':action==='createDroneMapping'?'drone':'';
const targetId=(action,payload={})=>action.includes('Sensor')||action==='rotateSensor'?payload.sensor_id:action.includes('Plot')?payload.plot_id:action.includes('Drone')?payload.drone_id:null;
function isDeleteAction(action){return ['deleteFarmBoundary','deleteSensor','deletePlot','deleteDroneMapping'].includes(action);}
function isUpdateAction(action){return ['updateFarmBoundary','updateSensor','rotateSensor','updatePlot','updateDroneMapping'].includes(action);}

export function enqueueMutation(userId, action, payload={}, meta={}){
  if(!userId) throw new Error('Cannot save an offline change without a signed-in user.');
  const mutationId=payload.mutation_id || meta.mutationId || createMutationId(action);
  const nextPayload={...payload,mutation_id:mutationId};
  let queue=getPendingMutations(userId);
  if(queue.some(item=>item.mutationId===mutationId)) return {mutationId,queue};

  // A record created offline has a temporary browser-only id until the queued
  // create reaches Appwrite. Merge edits into that create, or cancel the create
  // entirely if the user deletes it before reconnecting. This prevents a later
  // update/delete request from targeting a temporary id and creating ghosts.
  const wantedTarget=targetId(action,nextPayload);
  if(wantedTarget){
    const createIndex=queue.findIndex(item=>item.meta?.tempId===wantedTarget && createType(item.action));
    if(createIndex>=0){
      const pendingCreate=queue[createIndex];
      if(isDeleteAction(action)){
        queue.splice(createIndex,1);writeJson(queueKey(userId),queue);emit();
        return {mutationId:pendingCreate.mutationId,queue,cancelledCreate:true};
      }
      if(isUpdateAction(action)){
        const idFields=new Set(['sensor_id','plot_id','drone_id']);
        const patch=Object.fromEntries(Object.entries(nextPayload).filter(([key])=>!idFields.has(key)));
        queue[createIndex]={...pendingCreate,payload:{...pendingCreate.payload,...patch,mutation_id:pendingCreate.mutationId},createdAt:new Date().toISOString(),meta:{...pendingCreate.meta,...meta}};
        writeJson(queueKey(userId),queue);emit();
        return {mutationId:pendingCreate.mutationId,queue,mergedIntoCreate:true};
      }
    }
  }

  const key=entityKey(action,nextPayload);
  if(key){
    if(isDeleteAction(action)){
      queue=queue.filter(item=>item.entityKey!==key || String(item.action||'').startsWith('create'));
    }else if(isUpdateAction(action)){
      const index=queue.findIndex(item=>item.entityKey===key && isUpdateAction(item.action));
      if(index>=0){
        const previous=queue[index];
        queue[index]={...previous,action,payload:{...previous.payload,...nextPayload},mutationId,createdAt:new Date().toISOString(),entityKey:key,meta:{...previous.meta,...meta}};
        writeJson(queueKey(userId),queue);emit();
        return {mutationId,queue};
      }
    }
  }

  queue.push({
    mutationId,
    action,
    payload:nextPayload,
    entityKey:key,
    createdAt:new Date().toISOString(),
    attempts:0,
    meta,
  });
  writeJson(queueKey(userId),queue);emit();
  return {mutationId,queue};
}

export function removePendingMutation(userId, mutationId){
  const queue=getPendingMutations(userId).filter(item=>item.mutationId!==mutationId);
  writeJson(queueKey(userId),queue);emit();
  return queue;
}

export function updatePendingMutation(userId, mutationId, patch={}){
  const queue=getPendingMutations(userId).map(item=>item.mutationId===mutationId?{...item,...patch}:item);
  writeJson(queueKey(userId),queue);emit();
  return queue;
}

export function clearPendingMutations(userId){
  try{localStorage.removeItem(queueKey(userId));}catch{}
  emit();
}

export function subscribePendingMutations(callback){
  if(typeof window==='undefined')return ()=>{};
  const handler=()=>callback?.();
  window.addEventListener(EVENT_NAME,handler);
  window.addEventListener('storage',handler);
  return ()=>{window.removeEventListener(EVENT_NAME,handler);window.removeEventListener('storage',handler);};
}

export function saveWorkspaceCache(role,userId,data){
  if(!role||!userId||!data)return false;
  return writeJson(cacheKey(role,userId),{version:CACHE_VERSION,savedAt:new Date().toISOString(),data});
}

export function loadWorkspaceCache(role,userId){
  if(!role||!userId)return null;
  const cached=readJson(cacheKey(role,userId),null);
  if(!cached?.data)return null;
  return cached;
}

export function clearWorkspaceCache(role,userId){
  try{localStorage.removeItem(cacheKey(role,userId));}catch{}
}

export function isLikelyNetworkError(error){
  if(typeof navigator!=='undefined' && navigator.onLine===false)return true;
  const status=Number(error?.status||0);
  if([408,425,429,502,503,504].includes(status))return true;
  const text=String(error?.message||error||'').toLowerCase();
  return ['failed to fetch','network','timed out','timeout','could not be reached','load failed','fetch failed','offline'].some(part=>text.includes(part));
}

export async function flushPendingMutations(userId, send, {onApplied,onProgress,onBlocked}={}){
  if(!userId||typeof send!=='function')return {synced:0,remaining:pendingMutationCount(userId)};
  if(typeof navigator!=='undefined' && navigator.onLine===false)return {synced:0,remaining:pendingMutationCount(userId),offline:true};
  let synced=0;
  let queue=getPendingMutations(userId);
  for(const item of [...queue]){
    if(typeof navigator!=='undefined' && navigator.onLine===false)break;
    try{
      updatePendingMutation(userId,item.mutationId,{attempts:Number(item.attempts||0)+1,lastAttemptAt:new Date().toISOString()});
      const result=await send(item.action,{...item.payload,mutation_id:item.mutationId});
      removePendingMutation(userId,item.mutationId);
      synced+=1;
      await onApplied?.(item,result);
      onProgress?.({synced,remaining:pendingMutationCount(userId),item,result});
    }catch(error){
      updatePendingMutation(userId,item.mutationId,{lastError:String(error?.message||error),lastAttemptAt:new Date().toISOString()});
      if(isLikelyNetworkError(error)) break;
      const status=Number(error?.status||0);
      if(status===401||status===403){onBlocked?.(item,error);break;}
      // Validation/conflict errors should stay queued for manual attention instead
      // of being silently discarded. Stop here so later dependent edits preserve order.
      onBlocked?.(item,error);
      break;
    }
    queue=getPendingMutations(userId);
  }
  return {synced,remaining:pendingMutationCount(userId)};
}
