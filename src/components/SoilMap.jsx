import { Fragment, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, Rectangle, CircleMarker, Popup, Tooltip, Marker, LayerGroup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function FitToData({ farms, selectedFarmId, focusTarget, drawing, fitRequestKey=0 }) {
  const map = useMap();
  const lastFitKey = useRef(null);
  const lastFocusKey = useRef(null);

  useEffect(() => {
    if (drawing) return;

    if (focusTarget?.latitude !== undefined && focusTarget?.longitude !== undefined) {
      const focusKey = `${focusTarget.id || 'target'}:${focusTarget.latitude}:${focusTarget.longitude}`;
      if (lastFocusKey.current !== focusKey) {
        lastFocusKey.current = focusKey;
        map.setView(
          [Number(focusTarget.latitude), Number(focusTarget.longitude)],
          Math.max(map.getZoom(), 18),
          { animate:false },
        );
      }
      return;
    }

    // Only fit when a workspace/farm is first opened. CRUD updates do not
    // reset the viewport, so the map stays exactly where the editor was working.
    const dataReady = farms.length > 0;
    const fitKey = dataReady ? (selectedFarmId ? `farm:${selectedFarmId}:${fitRequestKey}` : `overall:${fitRequestKey}`) : `empty:${fitRequestKey}`;
    if (!dataReady || lastFitKey.current === fitKey) return;
    lastFitKey.current = fitKey;
    lastFocusKey.current = null;

    const selected = selectedFarmId ? farms.find((farm) => farm.id === selectedFarmId) : null;
    const points = selected?.boundary?.length ? selected.boundary : farms.flatMap((farm) => farm.boundary || []);
    if (points.length) {
      map.fitBounds(L.latLngBounds(points), { padding: [34, 34], maxZoom: 17, animate:true, duration:.35 });
      return;
    }
    const target = selected || farms[0];
    if (target?.center_lat !== undefined && target?.center_lng !== undefined) {
      map.setView([Number(target.center_lat), Number(target.center_lng)], 16, { animate:true });
    }
  }, [map, selectedFarmId, farms.length, focusTarget?.id, focusTarget?.latitude, focusTarget?.longitude, drawing, fitRequestKey]);
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
    <Marker position={point} icon={placementIcon} draggable eventHandlers={{ drag:move, dragend:move }}>
      <Tooltip permanent direction="top" offset={[0,-42]}>Drag sensor to position</Tooltip>
    </Marker>
    <Marker position={handle} icon={rotationHandleIcon} draggable eventHandlers={{drag:rotate,dragend:rotate}}>
      <Tooltip permanent direction="top" offset={[0,-20]}>Drag this handle around the sensor to rotate coverage • {angle.toFixed(0)}°</Tooltip>
    </Marker>
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
const defaults = { farmBoundary:true, sensors:true, sensorCoverage:true, soilPlots:false, droneMapping:false };
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
  farms=[], sensors=[], plots=[], droneMappings=[], height=520, selectedFarmId, onFarmClick,
  selectedSensorId, selectedPlotId, selectedDroneId, focusTarget, visibility=defaults, visibleSensorIds, visiblePlotIds,
  onSensorClick, onPlotClick, onDroneClick, onDroneDelete, canDeleteDrone=false,
  drawMode=null, drawPoints=[], onMapPoint, drawCoverageM=50, drawOrientation=0, onDrawOrientation, showMapPopups=true, fitRequestKey=0, dataRevision=0,
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
  const showPublishedPlots = drawMode !== 'plot';
  const showPublishedDrone = drawMode !== 'drone';
  // Rebuild the complete published-overlay group whenever authoritative map data
  // changes. MapContainer itself stays mounted, so camera/zoom remain untouched,
  // while stale Leaflet paths/markers are guaranteed to be removed.
  const overlayRevision = useMemo(() => JSON.stringify({
    revision:dataRevision,
    farms:farms.map(f=>[f.id,geometryFingerprint(f.boundary||[]),rowRevision(f),f.status]),
    sensors:sensors.map(s=>[s.id,Number(s.latitude),Number(s.longitude),Number(s.coverage_m||0),Number(s.orientation_deg||0),s.status,s.nitrogen,s.phosphorus,s.potassium,s.ph,s.organic_matter,s.moisture,rowRevision(s)]),
    plots:plots.map(p=>[p.id,geometryFingerprint(p.boundary||[]),p.plot_code,p.nitrogen,p.phosphorus,p.potassium,p.ph,p.organic_matter,p.classification,rowRevision(p)]),
    drone:droneMappings.map(d=>[d.id,geometryFingerprint(d.boundary||[]),d.name,d.nitrogen,d.phosphorus,d.potassium,d.ph,d.organic_matter,d.moisture,d.classification,rowRevision(d)]),
  }), [farms,sensors,plots,droneMappings,dataRevision]);

  return <div className={`soil-map ${drawMode?`is-drawing draw-${drawMode}`:''}`} style={{height}}>
    <MapContainer center={center} zoom={15} zoomControl={true} zoomAnimation={false} fadeAnimation={false} markerZoomAnimation={false} style={{height:'100%',width:'100%'}} preferCanvas={false}>
      <TileLayer url={tileUrl} attribution='Imagery &copy; Esri &mdash; Leaflet' maxZoom={19} updateWhenIdle keepBuffer={3}/>
      <FitToData farms={farms} selectedFarmId={selectedFarmId} focusTarget={focusTarget} drawing={drawMode} fitRequestKey={fitRequestKey}/>
      <DrawingMapEvents enabled={drawingPolygon} onPoint={onMapPoint}/>

      <LayerGroup key={overlayRevision}>
      {v.farmBoundary && farms.map((farm) => { const boundary=sanitizeBoundary(farm.boundary); return isSimpleBoundary(boundary) ? <Polygon
        className="animated-map-shape"
        key={`farm-${farm.id}-${geometryFingerprint(boundary)}-${rowRevision(farm)}`}
        positions={boundary}
        pathOptions={{ color:farm.id===selectedFarmId?'#148743':'#31a95c', weight:farm.id===selectedFarmId?4:2.5, fillColor:'#4ecb78', fillOpacity:farm.id===selectedFarmId ? .20 : .11 }}
        interactive={!drawMode}
        bubblingMouseEvents={false}
        eventHandlers={{ click:mapClick((row)=>!drawMode&&onFarmClick?.(row),farm) }}
      ><Tooltip sticky>{farm.farmer_name} • {farm.name}</Tooltip></Polygon> : null; })}

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
        const selected=p.id===selectedPlotId;
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
      </LayerGroup>

      {drawMode==='sensor' && <SensorPlacement point={drawPoints[0]} coverageM={drawCoverageM} orientationDeg={drawOrientation} onPoint={onMapPoint} onOrientation={onDrawOrientation}/>} 
      {drawingPolygon && drawPoints.length>0 && <>
        <Polyline positions={drawPoints} interactive={false} pathOptions={{color:drawMode==='farm'?'#28a65b':drawMode==='plot'?'#d1a122':'#4b9cd3',weight:3,dashArray:'7 5'}}/>
        {drawPoints.length>=3 && <Polygon positions={drawPoints} interactive={false} pathOptions={{color:drawMode==='farm'?'#168846':drawMode==='plot'?'#bc8e14':'#3689c0',weight:2.5,fillColor:drawMode==='farm'?'#50cc7a':drawMode==='plot'?'#e8bd42':'#63b5e9',fillOpacity:.20}}/>}
        {drawPoints.map((point,i)=><CircleMarker key={`${point[0]}-${point[1]}-${i}`} center={point} radius={6} interactive={false} pathOptions={{color:'#fff',weight:2,fillColor:'#176338',fillOpacity:1}}><Tooltip permanent direction="top" offset={[0,-5]}>{i+1}</Tooltip></CircleMarker>)}
      </>}
    </MapContainer>
    <div className="map-legend">
      {v.sensors&&<span><i className="legend-sensor"/> Sensor</span>}
      {v.sensorCoverage&&<span><i className="legend-sensor"/> Coverage</span>}
      {v.soilPlots&&<span><i className="legend-plot"/> Soil analysis plot</span>}
      {v.droneMapping&&<span><i className="legend-drone"/> Drone mapping</span>}
      {v.farmBoundary&&<span><i className="legend-farm"/> Farm boundary</span>}
    </div>
    {drawMode&&<div className="drawing-hint">{drawMode==='sensor'?`Drag the sensor pin to position. Then drag the ROTATE handle around it to turn the coverage square (${Number(drawOrientation||0).toFixed(0)}°).`:'Click point-by-point to trace the shape. The polygon closes automatically when saved.'}</div>}
  </div>;
}
