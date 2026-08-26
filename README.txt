SOILS v1.10.31 - Soil Plot Focus + Stable Tool Patch

PATCH ONLY. This is not an overhaul.

REPLACE ONLY THESE FILES IN YOUR SOILS PROJECT:
  src\pages\DashboardPage.jsx
  src\components\SoilMap.jsx
  src\styles.css

FIXES
- Admin and Farmer Soil plots section reliably cycles through each saved Soil Plot.
- Soil Plot redirection fits the full polygon into the actually visible part of the map.
- The camera accounts for the draggable left section navigator and Admin-side map controls.
- The focused Soil Plot is highlighted without opening the record preview.
- The Mapped Farms / section navigator keeps a stable size and position while redirecting.
- The navigator's existing dragged position remains preserved.

NO CHANGES TO
- .env
- Appwrite
- database/schema
- package.json or dependencies
- server API

AFTER REPLACING THE 3 FILES
Run from your SOILS project folder:
  npm.cmd run dev

Then hard-refresh the browser once with Ctrl+Shift+R.
