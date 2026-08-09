import { Fragment, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, Rectangle, CircleMarker, Popup, Tooltip, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function FitToData({ farms, selectedFarmId, focusTarget, drawing }) {
  const map = useMap();
  const lastFitKey = useRef(null);
  const lastFocusKey = useRef(null);

  useEffect(() => {
    if (drawing) return;

    if (focusTarget?.latitude !== undefined && focusTarget?.longitude !== undefined) {
      const focusKey = `${focusTarget.id || 'target'}:${focusTarget.latitude}:${focusTarget.longitude}`;
      if (lastFocusKey.current !== focusKey) {
        lastFocusKey.current = focusKey;
        map.flyTo(
          [Number(focusTarget.latitude), Number(focusTarget.longitude)],
          Math.max(map.getZoom(), 18),
          { duration: .38, easeLinearity: .22 },
        );
      }
      return;
    }

    // Only fit when a workspace/farm is first opened. CRUD updates do not
    // reset the viewport, so the map stays exactly where the editor was working.
    const dataReady = farms.length > 0;
    const fitKey = dataReady ? (selectedFarmId ? `farm:${selectedFarmId}` : 'overall') : 'empty';
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
  }, [map, selectedFarmId, farms.length, focusTarget?.id, focusTarget?.latitude, focusTarget?.longitude, drawing]);
  return null;
}

function MapClickCapture({ enabled, onPoint }) {
  useMapEvents({ click(e) { if (enabled) onPoint?.([e.latlng.lat, e.latlng.lng]); } });
  return null;
}

const placementIcon = L.divIcon({
  className: 'sensor-placement-icon-wrap',
  html: '<div class="sensor-placement-icon"><span></span><b>DRAG</b></div>',
  iconSize: [44, 54],
  iconAnchor: [22, 45],
});

function SensorPlacement({ point, coverageM, onPoint }) {
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
  return <>
    <Rectangle bounds={squareBounds(point[0], point[1], coverageM)} pathOptions={{ color:'#19984c', weight:2.5, dashArray:'7 5', fillColor:'#53ce7a', fillOpacity:.19 }}/>
    <Marker position={point} icon={placementIcon} draggable eventHandlers={{ drag:move, dragend:move }}>
      <Tooltip permanent direction="top" offset={[0,-42]}>Drag sensor to its exact location</Tooltip>
    </Marker>
  </>;
}

export function squareBounds(lat, lng, meters) {
  const half = (Number(meters) || 50) / 2;
  const dLat = half / 111320;
  const dLng = half / (111320 * Math.max(.12, Math.cos(lat * Math.PI / 180)));
  return [[lat - dLat, lng - dLng], [lat + dLat, lng + dLng]];
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
  drawMode=null, drawPoints=[], onMapPoint, drawCoverageM=50, showMapPopups=true,
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

  return <div className={`soil-map ${drawMode?'is-drawing':''}`} style={{height}}>
    <MapContainer center={center} zoom={15} zoomControl={true} style={{height:'100%',width:'100%'}} preferCanvas={false}>
      <TileLayer url={tileUrl} attribution='Imagery &copy; Esri &mdash; Leaflet' maxZoom={19} updateWhenIdle keepBuffer={3}/>
      <FitToData farms={farms} selectedFarmId={selectedFarmId} focusTarget={focusTarget} drawing={drawMode}/>
      <MapClickCapture enabled={!!drawMode && drawMode !== 'sensor'} onPoint={onMapPoint}/>

      {v.farmBoundary && farms.map((farm) => farm.boundary?.length ? <Polygon
        className="animated-map-shape"
        key={farm.id}
        positions={farm.boundary}
        pathOptions={{ color:farm.id===selectedFarmId?'#148743':'#31a95c', weight:farm.id===selectedFarmId?4:2.5, fillColor:'#4ecb78', fillOpacity:farm.id===selectedFarmId ? .20 : .11 }}
        bubblingMouseEvents={false}
        eventHandlers={{ click:() => !drawMode && onFarmClick?.(farm) }}
      ><Tooltip sticky>{farm.farmer_name} • {farm.name}</Tooltip></Polygon> : null)}

      {v.sensorCoverage && sensors.filter(sensorAllowed).map((s) => <Rectangle
        className="animated-map-shape"
        key={`coverage-${s.id}`}
        bounds={squareBounds(Number(s.latitude),Number(s.longitude),Number(s.coverage_m)||50)}
        pathOptions={{color:s.id===selectedSensorId?'#0a6e35':'#37a960',weight:s.id===selectedSensorId?3:1.5,dashArray:'5 5',fillColor:'#58cf7f',fillOpacity:s.id===selectedSensorId ? .28 : .13}}
        bubblingMouseEvents={false}
        eventHandlers={{click:()=>!drawMode&&onSensorClick?.(s)}}
      />)}
      {v.sensors && sensors.filter(sensorAllowed).map((s) => <CircleMarker
        className={`map-sensor-pin ${s.id===selectedSensorId?'selected-map-pin':''}`}
        key={s.id}
        center={[Number(s.latitude),Number(s.longitude)]}
        radius={s.id===selectedSensorId?11:8}
        pathOptions={{color:'#ffffff',weight:s.id===selectedSensorId?3.5:2.5,fillColor:s.status==='Offline'?'#e66e61':'#23a957',fillOpacity:1}}
        bubblingMouseEvents={false}
        eventHandlers={{click:()=>!drawMode&&onSensorClick?.(s)}}
      >
        <Tooltip direction="top" offset={[0,-7]}>{s.sensor_code} • N {fmt(s.nitrogen,0)} • pH {fmt(s.ph,2)}</Tooltip>
        {showMapPopups && <Popup><NutrientPopup title={s.sensor_code} subtitle="NPK Soil Sensor" row={s} footer={`${s.coverage_m || 50}m × ${s.coverage_m || 50}m coverage`}/></Popup>}
      </CircleMarker>)}

      {v.soilPlots && plots.filter(plotAllowed).map((p) => {
        const popup=<NutrientPopup title={p.plot_code} subtitle="Soil analysis plot" row={p} footer={`${p.classification || 'Pending'} • ${p.analyzed_at ? new Date(p.analyzed_at).toLocaleDateString() : 'Not analyzed'}`}/>;
        if (p.boundary?.length) return <Polygon className="animated-map-shape" key={`plot-${p.id}`} positions={p.boundary} pathOptions={{color:p.id===selectedPlotId?'#9b7200':'#cf9c19',weight:p.id===selectedPlotId?3:2,fillColor:'#f2c84b',fillOpacity:p.id===selectedPlotId ? .30 : .18}} bubblingMouseEvents={false} eventHandlers={{click:()=>!drawMode&&onPlotClick?.(p)}}><Tooltip sticky>{p.plot_code} • N {fmt(p.nitrogen,0)} • pH {fmt(p.ph,2)}</Tooltip>{showMapPopups && <Popup>{popup}</Popup>}</Polygon>;
        return <Rectangle className="animated-map-shape" key={`plot-${p.id}`} bounds={squareBounds(Number(p.latitude),Number(p.longitude),Number(p.coverage_m)||70)} pathOptions={{color:p.id===selectedPlotId?'#9b7200':'#cf9c19',weight:p.id===selectedPlotId?3:2,fillColor:'#f2c84b',fillOpacity:.19}} bubblingMouseEvents={false} eventHandlers={{click:()=>!drawMode&&onPlotClick?.(p)}}><Tooltip sticky>{p.plot_code} • N {fmt(p.nitrogen,0)} • pH {fmt(p.ph,2)}</Tooltip>{showMapPopups && <Popup>{popup}</Popup>}</Rectangle>;
      })}

      {v.droneMapping && droneMappings.map((d) => {
        if (!d.boundary?.length) return null;
        const fallback=centerOfBoundary(d.boundary);
        const pin=[Number(d.center_lat ?? d.latitude ?? fallback?.[0]),Number(d.center_lng ?? d.longitude ?? fallback?.[1])];
        const selected=d.id===selectedDroneId;
        return <Fragment key={d.id}>
          <Polygon
            className="animated-map-shape drone-map-polygon"
            positions={d.boundary}
            pathOptions={{color:selected?'#17698e':'#3e91cb',weight:selected?4:2.5,dashArray:'8 6',fillColor:'#65b8ef',fillOpacity:selected ? .29 : .18}}
            bubblingMouseEvents={false}
            eventHandlers={{click:()=>!drawMode&&onDroneClick?.(d)}}
          >
            <Tooltip sticky>{d.name} • N {fmt(d.nitrogen,0)} • pH {fmt(d.ph,2)}</Tooltip>
            {showMapPopups && <Popup><DronePopup drone={d} canDeleteDrone={canDeleteDrone} onDroneDelete={onDroneDelete}/></Popup>}
          </Polygon>
          {Number.isFinite(pin[0]) && Number.isFinite(pin[1]) && <CircleMarker
            className={`drone-center-pin ${selected?'selected-map-pin':''}`}
            center={pin}
            radius={selected?10:7}
            pathOptions={{color:'#fff',weight:3,fillColor:selected?'#17698e':'#3e91cb',fillOpacity:1}}
            bubblingMouseEvents={false}
            eventHandlers={{click:()=>!drawMode&&onDroneClick?.(d)}}
          >
            <Tooltip direction="top" offset={[0,-7]}>{d.name} • N {fmt(d.nitrogen,0)} • P {fmt(d.phosphorus,0)} • K {fmt(d.potassium,0)}</Tooltip>
            {showMapPopups && <Popup><DronePopup drone={d} canDeleteDrone={canDeleteDrone} onDroneDelete={onDroneDelete}/></Popup>}
          </CircleMarker>}
        </Fragment>;
      })}

      {drawMode==='sensor' && <SensorPlacement point={drawPoints[0]} coverageM={drawCoverageM} onPoint={onMapPoint}/>} 
      {drawingPolygon && drawPoints.length>0 && <>
        <Polyline positions={drawPoints} pathOptions={{color:drawMode==='farm'?'#28a65b':drawMode==='plot'?'#d1a122':'#4b9cd3',weight:3,dashArray:'7 5'}}/>
        {drawPoints.length>=3 && <Polygon positions={drawPoints} pathOptions={{color:drawMode==='farm'?'#168846':drawMode==='plot'?'#bc8e14':'#3689c0',weight:2.5,fillColor:drawMode==='farm'?'#50cc7a':drawMode==='plot'?'#e8bd42':'#63b5e9',fillOpacity:.20}}/>}
        {drawPoints.map((point,i)=><CircleMarker key={`${point[0]}-${point[1]}-${i}`} center={point} radius={6} pathOptions={{color:'#fff',weight:2,fillColor:'#176338',fillOpacity:1}}><Tooltip permanent direction="top" offset={[0,-5]}>{i+1}</Tooltip></CircleMarker>)}
      </>}
    </MapContainer>
    <div className="map-legend">
      {v.sensors&&<span><i className="legend-sensor"/> Sensor</span>}
      {v.sensorCoverage&&<span><i className="legend-sensor"/> Coverage</span>}
      {v.soilPlots&&<span><i className="legend-plot"/> Soil analysis plot</span>}
      {v.droneMapping&&<span><i className="legend-drone"/> Drone mapping</span>}
      {v.farmBoundary&&<span><i className="legend-farm"/> Farm boundary</span>}
    </div>
    {drawMode&&<div className="drawing-hint">{drawMode==='sensor'?'Drag the temporary sensor pin to the exact location, then click Continue.':'Click point-by-point to trace the shape. The polygon closes automatically when saved.'}</div>}
  </div>;
}
