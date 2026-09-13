import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, Rectangle, CircleMarker, Popup, Tooltip, Marker, LayerGroup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Leaflet fits bounds against the full map rectangle, but SOILS places the
// section navigator/editor on top of that rectangle. Measure the controls that
// are actually visible so focused polygons land in the unobstructed map area.
function focusSafePadding(map) {
  const container=map?.getContainer?.();
  const shell=container?.closest?.('.map-canvas-shell');
  if(!container||!shell){
    return {paddingTopLeft:L.point(52,52),paddingBottomRight:L.point(52,52)};
  }

  const mapRect=container.getBoundingClientRect();
  let left=52,right=52,top=52,bottom=52;
  const overlays=shell.querySelectorAll('.map-section-overlay, .map-editor-overlay, .map-overlay-head, .map-preview-float');

  for(const node of overlays){
    if(!(node instanceof HTMLElement))continue;
    const style=getComputedStyle(node);
    if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)continue;
    const r=node.getBoundingClientRect();
    if(r.width<4||r.height<4)continue;
    if(r.right<=mapRect.left||r.left>=mapRect.right||r.bottom<=mapRect.top||r.top>=mapRect.bottom)continue;

    const cx=(r.left+r.right)/2;
    const cy=(r.top+r.bottom)/2;
    const mx=(mapRect.left+mapRect.right)/2;
    const my=(mapRect.top+mapRect.bottom)/2;

    // Tall overlays are side obstructions. This also works after the user drags
    // the section navigator from the left to the right side of the map.
    if(r.height>=90){
      if(cx<=mx)left=Math.max(left,r.right-mapRect.left+24);
      else right=Math.max(right,mapRect.right-r.left+24);
    }

    // Only genuinely shallow/wide controls reserve vertical space. Do not let
    // the 316px section navigator count as both a left AND top obstruction.
    const wideShallow=r.width>=180 && (r.height<=86 || r.width>=r.height*2.2);
    if(wideShallow){
      if(cy<=my)top=Math.max(top,r.bottom-mapRect.top+18);
      else bottom=Math.max(bottom,mapRect.bottom-r.top+18);
    }
  }

  // Keep a real viewport even if several floating controls are open at once.
  const maxHorizontal=Math.max(0,mapRect.width-220);
  const horizontal=left+right;
  if(horizontal>maxHorizontal&&horizontal>0){
    const scale=maxHorizontal/horizontal;
    left*=scale;right*=scale;
  }
  const maxVertical=Math.max(0,mapRect.height-180);
  const vertical=top+bottom;
  if(vertical>maxVertical&&vertical>0){
    const scale=maxVertical/vertical;
    top*=scale;bottom*=scale;
  }

  return {
    paddingTopLeft:L.point(Math.round(left),Math.round(top)),
    paddingBottomRight:L.point(Math.round(right),Math.round(bottom)),
  };
}

function FitToData({ farms, selectedFarmId, focusTarget, drawing, fitRequestKey=0, fitBoundaryIndex=null }) {
  const map = useMap();
  const lastFitKey = useRef(null);
  const lastFocusKey = useRef(null);

  useEffect(() => {
    if (drawing) return undefined;

    if (focusTarget?.latitude !== undefined && focusTarget?.longitude !== undefined) {
      const focusKey = `${focusTarget.id || 'target'}:${focusTarget.latitude}:${focusTarget.longitude}:${focusTarget.focus_seq||0}`;
      if (lastFocusKey.current !== focusKey) {
        lastFocusKey.current = focusKey;
        map.stop();
        map.closePopup();
        const focusBoundary=sanitizeBoundary(focusTarget?.boundary||[]);

        // Section changes can alter which glass controls are visible. Measure on
        // the next frame, after React has committed the section, then fly once.
        // This prevents Soil Plot focus from first jumping under the navigator
        // and then correcting itself on Admin/Farmer maps.
        const frame=requestAnimationFrame(()=>{
          map.invalidateSize({pan:false});
          const safe=focusSafePadding(map);

          if(focusBoundary.length>=3){
            const bounds=L.latLngBounds(focusBoundary);
            if(bounds.isValid()){
              map.flyToBounds(bounds,{
                ...safe,
                maxZoom:focusTarget?.focus_kind==='plot'?19:18,
                animate:true,
                duration:.88,
                easeLinearity:.13,
              });
            }
            return;
          }

          const lat=Number(focusTarget.latitude);
          const lng=Number(focusTarget.longitude);
          if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
          map.flyTo([lat,lng],Math.max(map.getZoom(),18),{animate:true,duration:.78,easeLinearity:.13,noMoveStart:false});
        });
        return ()=>cancelAnimationFrame(frame);
      }
      return undefined;
    }

    // fitRequestKey is an explicit camera command. Clicking My Farm increments
    // it even when the user is already on that page, so a manually panned map
    // always returns to the saved farm boundary.
    const dataReady = farms.length > 0;
    const fitKey = dataReady ? (selectedFarmId ? `farm:${selectedFarmId}:${fitRequestKey}` : `overall:${fitRequestKey}`) : `empty:${fitRequestKey}`;
    if (!dataReady || lastFitKey.current === fitKey) return undefined;
    lastFitKey.current = fitKey;
    lastFocusKey.current = null;

    const selected = selectedFarmId ? farms.find((farm) => farm.id === selectedFarmId) : null;
    const selectedBoundaries=selected?.boundaries?.length ? selected.boundaries : (selected?.boundary?.length ? [selected.boundary] : []);
    const requestedBoundary=Number.isInteger(fitBoundaryIndex)&&selectedBoundaries.length ? selectedBoundaries[((fitBoundaryIndex%selectedBoundaries.length)+selectedBoundaries.length)%selectedBoundaries.length] : null;
    const points = requestedBoundary?.length ? requestedBoundary : (selectedBoundaries.length ? selectedBoundaries.flat() : farms.flatMap((farm) => farm.boundaries?.length ? farm.boundaries.flat() : (farm.boundary || [])));
    const target = selected || farms[0];
    map.stop();
    map.closePopup();
    map.invalidateSize({pan:false});
    const frame=requestAnimationFrame(()=>{
      map.invalidateSize({pan:false});
      if (points.length) {
        map.flyToBounds(L.latLngBounds(points), { padding: [46, 46], maxZoom: 17, animate:true, duration:.84, easeLinearity:.14 });
        return;
      }
      if (target?.center_lat !== undefined && target?.center_lng !== undefined) {
        map.flyTo([Number(target.center_lat), Number(target.center_lng)], 16, { animate:true, duration:.76, easeLinearity:.14, noMoveStart:false });
      }
    });
    return ()=>cancelAnimationFrame(frame);
  }, [map, selectedFarmId, farms.length, focusTarget?.id, focusTarget?.latitude, focusTarget?.longitude, focusTarget?.focus_seq, drawing, fitRequestKey, fitBoundaryIndex]);
  return null;
}

function DrawingMapEvents({ enabled, onPoint }) {
  const lastPointRef = useRef({ at:0, lat:null, lng:null });
  useMapEvents({
    click(event) {
      if (!enabled) return;
      const lat = Number(event.latlng?.lat);
      const lng = Number(event.latlng?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      // Leaflet can emit a second click when a pane is being reconfigured in the
      // same frame. De-dupe only near-identical clicks within 180ms.
      const now = Date.now();
      const last = lastPointRef.current;
      if (now-last.at < 180 && Math.abs(lat-last.lat) < 1e-9 && Math.abs(lng-last.lng) < 1e-9) return;
      lastPointRef.current = { at:now, lat, lng };
      onPoint?.([lat,lng]);
    },
  });
  return null;
}

function sanitizeBoundary(points=[]) {
  const clean=[];
  for (const raw of points || []) {
    const lat=Number(raw?.[0]);
    const lng=Number(raw?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const prev=clean[clean.length-1];
    if (prev && Math.abs(prev[0]-lat)<1e-10 && Math.abs(prev[1]-lng)<1e-10) continue;
    clean.push([lat,lng]);
  }
  if (clean.length>2) {
    const first=clean[0], last=clean[clean.length-1];
    if (Math.abs(first[0]-last[0])<1e-10 && Math.abs(first[1]-last[1])<1e-10) clean.pop();
  }
  return clean;
}


function clampLegendOffset(value,min,max){return Math.min(Math.max(value,min),max);}
function DraggableMapLegend({children,storageKey='map'}) {
  const nodeRef=useRef(null);
  const dragRef=useRef(null);
  const [dragging,setDragging]=useState(false);
  const [offset,setOffset]=useState(()=>{
    try{const raw=localStorage.getItem(`soils:map-legend-position:v11036:${storageKey}`);const parsed=raw?JSON.parse(raw):null;return {x:Number(parsed?.x)||0,y:Number(parsed?.y)||0};}catch{return {x:0,y:0};}
  });
  const persist=(next)=>{try{localStorage.setItem(`soils:map-legend-position:v11036:${storageKey}`,JSON.stringify(next));}catch{}};
  useEffect(()=>{
    let frame=0;
    const keepInBounds=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const node=nodeRef.current;const shell=node?.closest('.soil-map');if(!node||!shell)return;
        const rect=node.getBoundingClientRect(),bounds=shell.getBoundingClientRect();
        let dx=0,dy=0;
        if(rect.left<bounds.left+6)dx=(bounds.left+6)-rect.left;else if(rect.right>bounds.right-6)dx=(bounds.right-6)-rect.right;
        if(rect.top<bounds.top+6)dy=(bounds.top+6)-rect.top;else if(rect.bottom>bounds.bottom-6)dy=(bounds.bottom-6)-rect.bottom;
        if(!dx&&!dy)return;
        setOffset(current=>{const next={x:current.x+dx,y:current.y+dy};persist(next);return next;});
      });
    };
    keepInBounds();window.addEventListener('resize',keepInBounds);
    return ()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',keepInBounds);};
  },[storageKey]);
  const beginDrag=(event)=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;
    const node=nodeRef.current;const shell=node?.closest('.soil-map');if(!node||!shell)return;
    event.preventDefault();event.stopPropagation();
    const rect=node.getBoundingClientRect(),bounds=shell.getBoundingClientRect();
    dragRef.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,startOffset:{...offset},rect,bounds};
    event.currentTarget.setPointerCapture?.(event.pointerId);setDragging(true);
  };
  const moveDrag=(event)=>{
    const drag=dragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;
    event.preventDefault();event.stopPropagation();
    const baseLeft=drag.rect.left-drag.startOffset.x,baseTop=drag.rect.top-drag.startOffset.y;
    const minX=drag.bounds.left+6-baseLeft,maxX=drag.bounds.right-6-(baseLeft+drag.rect.width);
    const minY=drag.bounds.top+6-baseTop,maxY=drag.bounds.bottom-6-(baseTop+drag.rect.height);
    setOffset({
      x:clampLegendOffset(drag.startOffset.x+(event.clientX-drag.startX),Math.min(minX,maxX),Math.max(minX,maxX)),
      y:clampLegendOffset(drag.startOffset.y+(event.clientY-drag.startY),Math.min(minY,maxY),Math.max(minY,maxY)),
    });
  };
  const endDrag=(event)=>{
    const drag=dragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;
    event.preventDefault();event.stopPropagation();dragRef.current=null;setDragging(false);
    setOffset(current=>{persist(current);return current;});
    try{event.currentTarget.releasePointerCapture?.(event.pointerId);}catch{}
  };
  const reset=(event)=>{event.preventDefault();event.stopPropagation();const next={x:0,y:0};setOffset(next);persist(next);};
  return <div ref={nodeRef} className={`map-legend draggable-map-legend ${dragging?'is-dragging':''}`} style={{'--legend-drag-x':`${offset.x}px`,'--legend-drag-y':`${offset.y}px`}}>
    <button type="button" className="map-legend-drag-handle" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={reset} title="Drag legend. Double-click to reset." aria-label="Drag map legend"><span aria-hidden="true">⋮⋮</span><b>Drag legend</b></button>
    <div className="map-legend-items">{children}</div>
  </div>;
}

function orient(a,b,c) {
  return (b[1]-a[1])*(c[0]-a[0])-(b[0]-a[0])*(c[1]-a[1]);
}
function onSegment(a,b,c) {
  return Math.min(a[0],c[0])-1e-12<=b[0] && b[0]<=Math.max(a[0],c[0])+1e-12 && Math.min(a[1],c[1])-1e-12<=b[1] && b[1]<=Math.max(a[1],c[1])+1e-12;
}
function segmentsIntersect(a,b,c,d) {
  const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
  const eps=1e-12;
  if (((o1>eps&&o2<-eps)||(o1<-eps&&o2>eps)) && ((o3>eps&&o4<-eps)||(o3<-eps&&o4>eps))) return true;
  if (Math.abs(o1)<=eps&&onSegment(a,c,b)) return true;
  if (Math.abs(o2)<=eps&&onSegment(a,d,b)) return true;
  if (Math.abs(o3)<=eps&&onSegment(c,a,d)) return true;
  if (Math.abs(o4)<=eps&&onSegment(c,b,d)) return true;
  return false;
}
function isSimpleBoundary(points=[]) {
  const p=sanitizeBoundary(points);
  if (p.length<3) return false;
  const n=p.length;
  for(let i=0;i<n;i++) {
    const a=p[i],b=p[(i+1)%n];
    for(let j=i+1;j<n;j++) {
      if (j===i || j===(i+1)%n || (i===0&&j===n-1)) continue;
      const c=p[j],d=p[(j+1)%n];
      if (segmentsIntersect(a,b,c,d)) return false;
    }
  }
  return true;
}

const placementIcon = L.divIcon({
  className: 'sensor-placement-icon-wrap',
  html: '<div class="sensor-placement-icon"><span></span><b>DRAG</b></div>',
  iconSize: [44, 54],
  iconAnchor: [22, 45],
});

const rotationHandleIcon = L.divIcon({
  className:'sensor-rotation-handle-wrap',
  html:'<button type="button" class="sensor-rotation-handle" aria-label="Drag to rotate sensor coverage"><span>↻</span><b>ROTATE</b></button>',
  iconSize:[58,44],
  iconAnchor:[29,22],
});

function sensorHeadingIcon(sensor, selected=false) {
  const angle=((Number(sensor?.orientation_deg||0)%360)+360)%360;
  const offline=String(sensor?.status||'').toLowerCase()==='offline';
  return L.divIcon({
    className:'sensor-heading-icon-wrap',
    html:`<div class="sensor-heading-pin${selected?' selected':''}${offline?' offline':''}"><span></span></div>`,
    iconSize:[38,38],
    iconAnchor:[19,19],
  });
}

function rotationHandlePoint(lat,lng,meters,degrees=0){
  const distance=Math.max(34,(Number(meters)||50)*.82);
  const theta=((Number(degrees)||0)%360)*Math.PI/180;
  const east=Math.sin(theta)*distance;
  const north=Math.cos(theta)*distance;
  const lngScale=111320*Math.max(.12,Math.cos(Number(lat)*Math.PI/180));
  return [Number(lat)+north/111320,Number(lng)+east/lngScale];
}

function bearingFromCenter(center,latlng){
  const lat=Number(center?.[0]);
  const lng=Number(center?.[1]);
  const north=(Number(latlng.lat)-lat)*111320;
  const east=(Number(latlng.lng)-lng)*(111320*Math.max(.12,Math.cos(lat*Math.PI/180)));
  return ((Math.atan2(east,north)*180/Math.PI)%360+360)%360;
}

function SensorPlacement({ point, coverageM, orientationDeg=0, onPoint, onOrientation }) {
  const map = useMap();
  useEffect(() => {
    if (!point) {
      const center = map.getCenter();
      onPoint?.([center.lat, center.lng]);
    }
  }, [map, point, onPoint]);

  if (!point) return null;
  const move = (event) => {
    const next = event.target.getLatLng();
    onPoint?.([next.lat, next.lng]);
  };
  const rotate = (event) => {
    const next = event.target.getLatLng();
    onOrientation?.(bearingFromCenter(point,next));
  };
  const angle=((Number(orientationDeg||0)%360)+360)%360;
  const handle=rotationHandlePoint(point[0],point[1],coverageM,angle);
  return <>
    <Polygon positions={orientedSquare(point[0],point[1],coverageM,angle)} interactive={false} pathOptions={{ color:'#19984c', weight:2.8, dashArray:'7 5', fillColor:'#53ce7a', fillOpacity:.23 }}/>
    <Polyline positions={[point,handle]} interactive={false} pathOptions={{color:'#f7fff9',weight:2.5,dashArray:'4 5',opacity:.95}}/>
    <Marker position={point} icon={placementIcon} draggable eventHandlers={{ drag:move, dragend:move }}/>
    <Marker position={handle} icon={rotationHandleIcon} draggable eventHandlers={{drag:rotate,dragend:rotate}}/>
  </>;
}

export function squareBounds(lat, lng, meters) {
  const half = (Number(meters) || 50) / 2;
  const dLat = half / 111320;
  const dLng = half / (111320 * Math.max(.12, Math.cos(lat * Math.PI / 180)));
  return [[lat - dLat, lng - dLng], [lat + dLat, lng + dLng]];
}

export function orientedSquare(lat, lng, meters, degrees=0) {
  const size=Number(meters)||50;
  const half=size/2;
  const theta=((Number(degrees)||0)%360)*Math.PI/180;
  const cos=Math.cos(theta), sin=Math.sin(theta);
  const lngScale=111320*Math.max(.12,Math.cos(Number(lat)*Math.PI/180));
  return [[-half,-half],[half,-half],[half,half],[-half,half]].map(([x,y])=>{
    const xr=x*cos+y*sin;
    const yr=-x*sin+y*cos;
    return [Number(lat)+yr/111320,Number(lng)+xr/lngScale];
  });
}

function orientationTip(lat,lng,meters,degrees=0){
  const distance=Math.max(14,(Number(meters)||50)*.42);
  const theta=((Number(degrees)||0)%360)*Math.PI/180;
  const east=Math.sin(theta)*distance;
  const north=Math.cos(theta)*distance;
  const lngScale=111320*Math.max(.12,Math.cos(Number(lat)*Math.PI/180));
  return [Number(lat)+north/111320,Number(lng)+east/lngScale];
}

function centerOfBoundary(boundary=[]) {
  if (!boundary.length) return null;
  return [
    boundary.reduce((sum,p)=>sum+Number(p[0]||0),0)/boundary.length,
    boundary.reduce((sum,p)=>sum+Number(p[1]||0),0)/boundary.length,
  ];
}

const fmt = (v, digits=1) => v === undefined || v === null || v === '' ? '—' : Number(v).toFixed(digits);
const defaults = { farmBoundary:true, sensors:true, sensorCoverage:true, soilPlots:true, droneMapping:true };
const geometryFingerprint=(points=[])=>sanitizeBoundary(points).map(([lat,lng])=>`${Number(lat).toFixed(7)},${Number(lng).toFixed(7)}`).join(';');
const rowRevision=(row)=>String(row?.$updatedAt||row?.updated_at||row?.updatedAt||'');
const mapClick=(handler,row)=>(event)=>{event?.originalEvent?.preventDefault?.();event?.originalEvent?.stopPropagation?.();handler?.(row);};

function NutrientPopup({ title, subtitle, row, footer }) {
  return <div className="map-popup nutrient-popup">
    <b>{title}</b>
    <small>{subtitle}</small>
    <div className="popup-grid">
      <span>N <strong>{fmt(row.nitrogen,0)}</strong></span>
      <span>P <strong>{fmt(row.phosphorus,0)}</strong></span>
      <span>K <strong>{fmt(row.potassium,0)}</strong></span>
      <span>pH <strong>{fmt(row.ph,2)}</strong></span>
      <span>OM <strong>{fmt(row.organic_matter,1)}%</strong></span>
      <span>Moist. <strong>{fmt(row.moisture,0)}%</strong></span>
    </div>
    {footer && <em>{footer}</em>}
  </div>;
}

function DronePopup({ drone, canDeleteDrone, onDroneDelete }) {
  return <div className="map-popup drone-popup">
    <b>{drone.name}</b>
    <small>Drone mapping soil observation</small>
    <div className="popup-grid">
      <span>N <strong>{fmt(drone.nitrogen,0)}</strong></span>
      <span>P <strong>{fmt(drone.phosphorus,0)}</strong></span>
      <span>K <strong>{fmt(drone.potassium,0)}</strong></span>
      <span>pH <strong>{fmt(drone.ph,2)}</strong></span>
      <span>OM <strong>{fmt(drone.organic_matter,1)}%</strong></span>
      <span>Moist. <strong>{fmt(drone.moisture,0)}%</strong></span>
    </div>
    <div className="drone-popup-meta">
      <span>{drone.classification || drone.status || 'Mapped'}</span>
      <span>{fmt(drone.area_hectares,2)} ha</span>
    </div>
    <em>{drone.captured_at ? `Captured ${new Date(drone.captured_at).toLocaleDateString()}` : 'Capture date not set'}</em>
    {drone.notes && <p>{drone.notes}</p>}
    {canDeleteDrone && <button className="map-popup-delete" onClick={(event)=>{event.stopPropagation();onDroneDelete?.(drone)}}>Delete mapping</button>}
  </div>;
}

export default function SoilMap({
  farms=[], sensors=[], plots=[], droneMappings=[], requests=[], height=520, selectedFarmId, onFarmClick,
  selectedSensorId, selectedPlotId, selectedDroneId, focusTarget, visibility=defaults, visibleSensorIds, visiblePlotIds,
  onSensorClick, onPlotClick, onDroneClick, onDroneDelete, canDeleteDrone=false,
  drawMode=null, drawPoints=[], onMapPoint, drawCoverageM=50, drawOrientation=0, onDrawOrientation, showMapPopups=true, fitRequestKey=0, fitBoundaryIndex=null, dataRevision=0, legendStorageKey='map',
}) {
  const center = useMemo(() => {
    const f = farms.find(x => x.id === selectedFarmId) || farms[0];
    return f ? [Number(f.center_lat), Number(f.center_lng)] : [10.42,122.92];
  }, [farms, selectedFarmId]);
  const tileUrl = import.meta.env.VITE_SATELLITE_TILE_URL || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const v = { ...defaults, ...visibility };
  const sensorAllowed = (s) => !visibleSensorIds || visibleSensorIds.includes(s.id);
  const plotAllowed = (p) => !visiblePlotIds || visiblePlotIds.includes(p.id);
  const drawingPolygon = ['farm','plot','drone'].includes(drawMode);
  // Existing records stay visible while a new record is being drawn. The draft
  // polygon is layered on top instead of temporarily blanking the published set.
  const showPublishedPlots = true;
  const showPublishedDrone = true;
  // Keep the Leaflet layer group stable. Every spatial record already has a
  // geometry/revision-aware React key below, so only the row that changed needs
  // to mount/unmount. Rebuilding the entire Canvas layer group on every save
  // caused unrelated Sensor/Plot/Drone paths to flicker or disappear.

  return <div className={`soil-map ${drawMode?`is-drawing draw-${drawMode}`:''}`} style={{height}}>
    <MapContainer center={center} zoom={15} zoomControl={true} zoomAnimation={true} fadeAnimation={true} markerZoomAnimation={true} zoomSnap={0.25} zoomDelta={0.5} wheelDebounceTime={24} wheelPxPerZoomLevel={96} scrollWheelZoom={true} style={{height:'100%',width:'100%'}} preferCanvas={true}>
      <TileLayer url={tileUrl} attribution='Imagery &copy; Esri &mdash; Leaflet' maxZoom={19} updateWhenIdle keepBuffer={3}/>
      <FitToData farms={farms} selectedFarmId={selectedFarmId} focusTarget={focusTarget} drawing={drawMode} fitRequestKey={fitRequestKey} fitBoundaryIndex={fitBoundaryIndex}/>
      <DrawingMapEvents enabled={drawingPolygon} onPoint={onMapPoint}/>

      <LayerGroup>
      {v.farmBoundary && farms.flatMap((farm) => {
        const boundaries=farm.boundaries?.length?farm.boundaries:(farm.boundary?.length?[farm.boundary]:[]);
        return boundaries.map((rawBoundary,boundaryIndex)=>{const boundary=sanitizeBoundary(rawBoundary);return isSimpleBoundary(boundary)?<Polygon
          className="animated-map-shape"
          key={`farm-${farm.id}-${boundaryIndex}-${geometryFingerprint(boundary)}-${rowRevision(farm)}`}
          positions={boundary}
          pathOptions={{ color:farm.id===selectedFarmId?'#148743':'#31a95c', weight:farm.id===selectedFarmId?4:2.5, fillColor:'#4ecb78', fillOpacity:farm.id===selectedFarmId ? .20 : .11 }}
          interactive={!drawMode}
          bubblingMouseEvents={false}
          eventHandlers={{ click:mapClick((row)=>!drawMode&&onFarmClick?.({...row,boundary_index:boundaryIndex}),farm) }}
        ><Tooltip sticky>{farm.farmer_name} • {farm.name} • Boundary {boundaryIndex+1}</Tooltip></Polygon>:null;});
      })}

      {v.sensorCoverage && sensors.filter(sensorAllowed).map((s) => {
        const rotation=Number(s.orientation_deg||0);
        const center=[Number(s.latitude),Number(s.longitude)];
        const tip=orientationTip(center[0],center[1],Number(s.coverage_m)||50,rotation);
        return <Fragment key={`coverage-${s.id}-${Number(s.latitude).toFixed(7)}-${Number(s.longitude).toFixed(7)}-${Number(s.coverage_m||50)}-${Number(s.orientation_deg||0).toFixed(2)}-${rowRevision(s)}`}>
          <Polygon
            className="animated-map-shape sensor-oriented-coverage"
            positions={orientedSquare(center[0],center[1],Number(s.coverage_m)||50,rotation)}
            pathOptions={{color:s.id===selectedSensorId?'#0a6e35':'#37a960',weight:s.id===selectedSensorId?3:1.5,dashArray:'5 5',fillColor:'#58cf7f',fillOpacity:s.id===selectedSensorId ? .28 : .13}}
            interactive={!drawMode}
            bubblingMouseEvents={false}
            eventHandlers={{click:mapClick((row)=>!drawMode&&onSensorClick?.(row),s)}}
          />
          <Polyline className="sensor-orientation-line" positions={[center,tip]} interactive={false} pathOptions={{color:s.id===selectedSensorId?'#075f2d':'#2b8e4d',weight:s.id===selectedSensorId?3:2,opacity:.9}}/>
        </Fragment>;
      })}
      {v.sensors && sensors.filter(sensorAllowed).map((s) => {
        const selected=s.id===selectedSensorId;
        return <Marker
          key={`sensor-${s.id}-${Number(s.latitude).toFixed(7)}-${Number(s.longitude).toFixed(7)}-${Number(s.orientation_deg||0).toFixed(2)}-${rowRevision(s)}`}
          position={[Number(s.latitude),Number(s.longitude)]}
          icon={sensorHeadingIcon(s,selected)}
          interactive={!drawMode}
          bubblingMouseEvents={false}
          eventHandlers={{click:mapClick((row)=>!drawMode&&onSensorClick?.(row),s)}}
        >
          <Tooltip direction="top" offset={[0,-14]}>{s.sensor_code} • coverage {Number(s.orientation_deg||0).toFixed(0)}° • N {fmt(s.nitrogen,0)} • pH {fmt(s.ph,2)}</Tooltip>
          {showMapPopups && <Popup><NutrientPopup title={s.sensor_code} subtitle="NPK Soil Sensor" row={s} footer={`${s.coverage_m || 50}m × ${s.coverage_m || 50}m coverage • ${Number(s.orientation_deg||0).toFixed(0)}°`}/></Popup>}
        </Marker>;
      })}

      {v.soilPlots && showPublishedPlots && plots.filter(plotAllowed).map((p) => {
        const popup=<NutrientPopup title={p.plot_code} subtitle="Soil analysis plot" row={p} footer={`${p.classification || 'Pending'} • ${p.analyzed_at ? new Date(p.analyzed_at).toLocaleDateString() : 'Not analyzed'}`}/>;
        const boundary=sanitizeBoundary(p.boundary);
        const validBoundary=isSimpleBoundary(boundary);
        const selected=p.id===selectedPlotId || (focusTarget?.focus_kind==='plot' && String(focusTarget?.id||'')===String(p.id));
        const shape=validBoundary
          ? <Polygon className="animated-map-shape" positions={boundary} pathOptions={{color:selected?'#9b7200':'#cf9c19',weight:selected?3:2,fillColor:'#f2c84b',fillOpacity:selected ? .30 : .18}} interactive={!drawMode} bubblingMouseEvents={false} eventHandlers={{click:mapClick((row)=>!drawMode&&onPlotClick?.(row),p)}}><Tooltip sticky>{p.plot_code} • N {fmt(p.nitrogen,0)} • pH {fmt(p.ph,2)}</Tooltip>{showMapPopups && <Popup>{popup}</Popup>}</Polygon>
          : (!p.boundary?.length ? <Rectangle className="animated-map-shape" bounds={squareBounds(Number(p.latitude),Number(p.longitude),Number(p.coverage_m)||70)} pathOptions={{color:selected?'#9b7200':'#cf9c19',weight:selected?3:2,fillColor:'#f2c84b',fillOpacity:selected ? .28 : .19}} interactive={!drawMode} bubblingMouseEvents={false} eventHandlers={{click:mapClick((row)=>!drawMode&&onPlotClick?.(row),p)}}><Tooltip sticky>{p.plot_code} • N {fmt(p.nitrogen,0)} • pH {fmt(p.ph,2)}</Tooltip>{showMapPopups && <Popup>{popup}</Popup>}</Rectangle> : null);
        // A persisted Soil Plot is represented by exactly one map object: its
        // polygon/coverage shape. Older builds also drew a second center pin,
        // which looked like a ghost duplicate at another location.
        return <Fragment key={`plot-${p.id}-${geometryFingerprint(boundary)}-${rowRevision(p)}`}>{shape}</Fragment>;
      })}

      {v.droneMapping && showPublishedDrone && droneMappings.map((d) => {
        const boundary=sanitizeBoundary(d.boundary);
        if (!isSimpleBoundary(boundary)) return null;
        const selected=d.id===selectedDroneId;
        return <Fragment key={`drone-${d.id}-${geometryFingerprint(boundary)}-${rowRevision(d)}`}>
          <Polygon
            className="animated-map-shape drone-map-polygon"
            positions={boundary}
            pathOptions={{color:selected?'#17698e':'#3e91cb',weight:selected?4:2.5,dashArray:'8 6',fillColor:'#65b8ef',fillOpacity:selected ? .29 : .18}}
            interactive={!drawMode}
            bubblingMouseEvents={false}
            eventHandlers={{click:mapClick((row)=>!drawMode&&onDroneClick?.(row),d)}}
          >
            <Tooltip sticky>{d.name} • N {fmt(d.nitrogen,0)} • pH {fmt(d.ph,2)}</Tooltip>
            {showMapPopups && <Popup><DronePopup drone={d} canDeleteDrone={canDeleteDrone} onDroneDelete={onDroneDelete}/></Popup>}
          </Polygon>
        </Fragment>;
      })}

      {requests.filter(request=>String(request.status||'pending').toLowerCase()==='pending').map(request=>{
        const type=String(request.request_type||'');
        const boundary=sanitizeBoundary(request.boundary||[]);
        const label=type==='sensor'?'Sensor request':type==='plot'?'Soil Plot request':'Drone Mapping request';
        if(type==='sensor'){
          const lat=Number(request.latitude??request.center_lat),lng=Number(request.longitude??request.center_lng);
          if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;
          return <CircleMarker key={`request-${request.id}`} center={[lat,lng]} radius={11} pathOptions={{color:'#7b4cc2',weight:3,dashArray:'5 4',fillColor:'#d8c4f2',fillOpacity:.42}}><Tooltip>{label} • Pending approval</Tooltip></CircleMarker>;
        }
        if(boundary.length<3)return null;
        return <Polygon key={`request-${request.id}-${geometryFingerprint(boundary)}`} positions={boundary} pathOptions={{color:'#7b4cc2',weight:3,dashArray:'7 5',fillColor:'#d8c4f2',fillOpacity:.18}}><Tooltip sticky>{label} • Pending approval</Tooltip></Polygon>;
      })}

      {focusTarget?.focus_kind==='request' && String(focusTarget.status||'pending').toLowerCase()==='pending' && (()=>{
        const boundary=sanitizeBoundary(focusTarget.boundary||[]);
        const type=String(focusTarget.request_type||'');
        if(type==='sensor'||boundary.length<3){
          const lat=Number(focusTarget.latitude),lng=Number(focusTarget.longitude);
          return Number.isFinite(lat)&&Number.isFinite(lng)?<CircleMarker key={`request-focus-${focusTarget.focus_seq||0}`} center={[lat,lng]} radius={16} pathOptions={{color:'#5b2b9b',weight:4,dashArray:'5 4',fillColor:'#e5d6fa',fillOpacity:.45}}><Tooltip permanent direction="top">Farmer request • Pending review</Tooltip></CircleMarker>:null;
        }
        return <Polygon key={`request-focus-${focusTarget.focus_seq||0}`} positions={boundary} pathOptions={{color:'#5b2b9b',weight:4,dashArray:'8 5',fillColor:'#e5d6fa',fillOpacity:.26}}><Tooltip sticky permanent>Farmer request • Pending review</Tooltip></Polygon>;
      })()}
      </LayerGroup>

      {drawMode==='sensor'  && <SensorPlacement point={drawPoints[0]} coverageM={drawCoverageM} orientationDeg={drawOrientation} onPoint={onMapPoint} onOrientation={onDrawOrientation}/>} 
      {drawingPolygon && drawPoints.length>0 && <>
        <Polyline positions={drawPoints} interactive={false} pathOptions={{color:drawMode==='farm'?'#28a65b':drawMode==='plot'?'#d1a122':'#4b9cd3',weight:3,dashArray:'7 5'}}/>
        {drawPoints.length>=3 && <Polygon positions={drawPoints} interactive={false} pathOptions={{color:drawMode==='farm'?'#168846':drawMode==='plot'?'#bc8e14':'#3689c0',weight:2.5,fillColor:drawMode==='farm'?'#50cc7a':drawMode==='plot'?'#e8bd42':'#63b5e9',fillOpacity:.20}}/>}
        {drawPoints.map((point,i)=><CircleMarker key={`${point[0]}-${point[1]}-${i}`} center={point} radius={6} interactive={false} pathOptions={{color:'#fff',weight:2,fillColor:'#176338',fillOpacity:1}}><Tooltip permanent direction="top" offset={[0,-5]}>{i+1}</Tooltip></CircleMarker>)}
      </>}
    </MapContainer>
    <DraggableMapLegend storageKey={legendStorageKey}>
      {v.sensors&&<span><i className="legend-sensor"/> Sensor</span>}
      {v.sensorCoverage&&<span><i className="legend-sensor"/> Coverage</span>}
      {v.soilPlots&&<span><i className="legend-plot"/> Soil analysis plot</span>}
      {v.droneMapping&&<span><i className="legend-drone"/> Drone mapping</span>}
      {v.farmBoundary&&<span><i className="legend-farm"/> Farm boundary</span>}
      {requests.some(request=>String(request.status||'pending').toLowerCase()==='pending')&&<span><i className="legend-request"/> Pending request</span>}
    </DraggableMapLegend>
    {drawMode&&<div className="drawing-hint">{drawMode==='sensor'?`Drag the sensor pin to position. Then drag the ROTATE handle around it to turn the coverage square (${Number(drawOrientation||0).toFixed(0)}°).`:'Click point-by-point to trace the shape. The polygon closes automatically when saved.'}</div>}
  </div>;
}
