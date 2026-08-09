# SOILS Classification v1.7.0

React + Vite soil-quality monitoring dashboard using Appwrite, Leaflet, and Vercel.

## v1.7.0 fixes

- Farmer accounts now resolve their assigned farm by the signed-in Appwrite user ID instead of assuming the first readable farm.
- Farmer map data is loaded from the same Appwrite farm, sensor, reading, plot, analysis, and drone-mapping rows that the admin edits.
- Added Appwrite Realtime subscriptions for farm changes, plus focus/visibility refresh and a lightweight fallback refresh.
- Running the Appwrite setup now repairs read permissions on existing farms, sensors, sensor readings, soil plots, soil analyses, and drone mappings so the correct farmer can see admin changes.
- Farmer sensor clicks no longer open a competing Leaflet popup and a floating edit-style inspector at the same time.
- Farmer previews are now clean embedded glass cards. They are read-only and show N, P, K, pH, organic material, moisture, status, coverage/location, and timestamps.
- Soil-analysis plots and Drone Mapping areas now use the same farmer preview system, so every clickable map record behaves consistently.
- Map layers stop click bubbling between overlapping farm polygons, sensor coverage, sensor pins, plots, and drone areas. This fixes several cases where a pin click appeared to trigger the wrong map object.
- If an admin deletes a record while a farmer has it selected, the stale preview is automatically closed after synchronization.
- Farmer section changes perform a silent fresh Appwrite pull, so switching Overview, My Farm, Sensors, or Soil Analysis also picks up the latest admin edits.
- Added deeper page, navigation, tab, row, and farmer-preview transitions while respecting reduced-motion settings.

## Existing Appwrite configuration

Project ID:

```text
6a787625002b311b4896
```

Endpoint:

```text
https://fra.cloud.appwrite.io/v1
```

Database ID:

```text
soils_database
```

Keep the Appwrite server key only in:

```env
APPWRITE_API_KEY=YOUR_KEY_HERE
```

Do not rename it to a `VITE_` variable.

## Updating from v1.6.0

Extract the v1.7.0 update ZIP into:

```text
D:\Soil Classification\Soils-Classification-Ready
```

Choose **Replace/Overwrite all**. The update ZIP does not contain `.env`.

Run this once because v1.7.0 repairs existing farmer row permissions:

```bat
cd /d "D:\Soil Classification\Soils-Classification-Ready"
npm.cmd run setup:appwrite
```

Then start the app:

```bat
npm.cmd run dev
```

No new dependency was added. If `node_modules` is missing, run:

```bat
npm.cmd install
```

Production check:

```bat
npm.cmd run build
```
