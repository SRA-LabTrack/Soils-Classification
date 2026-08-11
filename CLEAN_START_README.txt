SOILS v1.10.27 OVERHAUL - CLEAN SPATIAL GENERATION

This full build preserves:
- Administrator / Farmer accounts
- Farm records and multiple Farm Boundaries
- Profiles
- Support Chat history

It removes from the ACTIVE workspace everything created before this overhaul:
- Sensors and readings
- Soil Analysis Plots and analyses
- Drone Mappings

IMPORTANT
1) npm.cmd install
2) npm.cmd run dev

No cleanup command is required to get a blank spatial workspace. All pre-overhaul Sensor / Soil Plot / Drone rows are archived/hidden on BOTH Admin and Farmer accounts, and old browser caches are ignored. New records created after this overhaul are shown and synchronized normally.

Optional physical cleanup of the old Appwrite rows:
npm.cmd run reset:pins
