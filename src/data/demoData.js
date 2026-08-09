const base = [10.4247, 122.9225];

const makeBoundary = (lat, lng, dx = 0.010, dy = 0.008) => [
  [lat + dy * 0.50, lng - dx * 0.44],
  [lat + dy * 0.63, lng + dx * 0.16],
  [lat + dy * 0.25, lng + dx * 0.53],
  [lat - dy * 0.43, lng + dx * 0.40],
  [lat - dy * 0.57, lng - dx * 0.18],
  [lat - dy * 0.10, lng - dx * 0.55],
];

export const demoFarms = [
  { id:'farm-1', farmer_id:'farmer-1', farmer_name:'Farmer 1', name:'San Isidro Farm', location_name:'Demo farm area • Negros Occidental', center_lat:base[0], center_lng:base[1], area_hectares:18.4, status:'Good', boundary:makeBoundary(base[0],base[1]) },
  { id:'farm-2', farmer_id:'farmer-2', farmer_name:'Farmer 2', name:'Mabini Farm', location_name:'Demo farm area • Negros Occidental', center_lat:10.4390, center_lng:122.9440, area_hectares:12.7, status:'Monitor', boundary:makeBoundary(10.4390,122.9440,0.008,0.006) },
  { id:'farm-3', farmer_id:'farmer-3', farmer_name:'Farmer 3', name:'Greenfield Plot', location_name:'Demo farm area • Negros Occidental', center_lat:10.4050, center_lng:122.9500, area_hectares:9.2, status:'Good', boundary:makeBoundary(10.4050,122.9500,0.007,0.0055) },
  { id:'farm-4', farmer_id:'farmer-4', farmer_name:'Farmer 4', name:'Riverside Farm', location_name:'Demo farm area • Negros Occidental', center_lat:10.4070, center_lng:122.9000, area_hectares:14.8, status:'Attention', boundary:makeBoundary(10.4070,122.9000,0.009,0.007) },
];

export const demoSensors = [
  { id:'sensor-1', farm_id:'farm-1', sensor_code:'NPK-01', latitude:10.4265, longitude:122.9204, coverage_m:55, status:'Online', nitrogen:46, phosphorus:31, potassium:184, ph:6.42, organic_matter:3.8, moisture:31, recorded_at:'2026-08-09T12:35:00.000Z' },
  { id:'sensor-2', farm_id:'farm-1', sensor_code:'NPK-02', latitude:10.4230, longitude:122.9256, coverage_m:60, status:'Online', nitrogen:39, phosphorus:25, potassium:171, ph:6.13, organic_matter:3.2, moisture:28, recorded_at:'2026-08-09T12:38:00.000Z' },
  { id:'sensor-3', farm_id:'farm-1', sensor_code:'NPK-03', latitude:10.4214, longitude:122.9202, coverage_m:50, status:'Online', nitrogen:52, phosphorus:33, potassium:196, ph:6.60, organic_matter:4.1, moisture:34, recorded_at:'2026-08-09T12:41:00.000Z' },
  { id:'sensor-4', farm_id:'farm-2', sensor_code:'NPK-11', latitude:10.4395, longitude:122.9438, coverage_m:55, status:'Online', nitrogen:31, phosphorus:20, potassium:150, ph:5.75, organic_matter:2.5, moisture:27, recorded_at:'2026-08-09T12:25:00.000Z' },
  { id:'sensor-5', farm_id:'farm-3', sensor_code:'NPK-21', latitude:10.4048, longitude:122.9502, coverage_m:50, status:'Online', nitrogen:44, phosphorus:29, potassium:181, ph:6.31, organic_matter:3.6, moisture:30, recorded_at:'2026-08-09T12:18:00.000Z' },
  { id:'sensor-6', farm_id:'farm-4', sensor_code:'NPK-31', latitude:10.4074, longitude:122.8993, coverage_m:65, status:'Offline', nitrogen:24, phosphorus:17, potassium:132, ph:5.42, organic_matter:2.0, moisture:22, recorded_at:'2026-08-08T08:10:00.000Z' },
];

export const demoPlots = [
  { id:'plot-1', farm_id:'farm-1', plot_code:'LAB-A1', latitude:10.4250, longitude:122.9233, coverage_m:75, nitrogen:48, phosphorus:30, potassium:188, ph:6.48, organic_matter:3.9, classification:'Good', analyzed_at:'2026-08-07T03:00:00.000Z', notes:'Balanced nutrient profile. Continue normal soil management.' },
  { id:'plot-2', farm_id:'farm-1', plot_code:'LAB-B1', latitude:10.4216, longitude:122.9238, coverage_m:70, nitrogen:35, phosphorus:22, potassium:160, ph:5.90, organic_matter:2.9, classification:'Monitor', analyzed_at:'2026-08-06T03:00:00.000Z', notes:'Slightly acidic zone. Monitor pH trend before corrective treatment.' },
  { id:'plot-3', farm_id:'farm-2', plot_code:'LAB-C1', latitude:10.4386, longitude:122.9445, coverage_m:70, nitrogen:29, phosphorus:19, potassium:147, ph:5.68, organic_matter:2.4, classification:'Monitor', analyzed_at:'2026-08-05T03:00:00.000Z', notes:'Nutrients trending lower than the farm target.' },
];

export const trendData = [
  { month:'Mar', nitrogen:37, phosphorus:24, potassium:160, ph:5.9 },
  { month:'Apr', nitrogen:40, phosphorus:26, potassium:167, ph:6.0 },
  { month:'May', nitrogen:42, phosphorus:27, potassium:171, ph:6.1 },
  { month:'Jun', nitrogen:41, phosphorus:28, potassium:176, ph:6.2 },
  { month:'Jul', nitrogen:45, phosphorus:29, potassium:181, ph:6.3 },
  { month:'Aug', nitrogen:46, phosphorus:30, potassium:185, ph:6.4 },
];

export const soilDistribution = [
  { name:'Good', value:58 },
  { name:'Monitor', value:27 },
  { name:'Attention', value:11 },
  { name:'Critical', value:4 },
];

export const demoDroneMappings = [
  { id:'drone-1', farm_id:'farm-1', name:'Drone Survey • August', boundary:makeBoundary(10.4249,122.9227,0.0065,0.0047), center_lat:10.4249, center_lng:122.9227, area_hectares:12.6, nitrogen:44, phosphorus:28, potassium:179, ph:6.31, organic_matter:3.5, moisture:30, classification:'Good', notes:'Drone-assisted soil surface interpretation for the August survey.', image_url:'', captured_at:'2026-08-04T02:20:00.000Z', status:'Mapped' },
  { id:'drone-2', farm_id:'farm-2', name:'Drone Survey • July', boundary:makeBoundary(10.4390,122.9440,0.0048,0.0035), center_lat:10.4390, center_lng:122.9440, area_hectares:7.8, nitrogen:31, phosphorus:21, potassium:151, ph:5.82, organic_matter:2.6, moisture:27, classification:'Monitor', notes:'Lower nutrient zone observed during the July flight.', image_url:'', captured_at:'2026-07-28T02:20:00.000Z', status:'Mapped' },
];
