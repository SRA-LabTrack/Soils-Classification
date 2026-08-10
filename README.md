
## v1.10.11 Farmer navigation + sharp glass layout

- **My Farm** now immediately fits the Farmer map to the currently saved farm boundary, even when clicked repeatedly, then refreshes the authoritative boundary in the background and refits if needed.
- Dashboard structural surfaces now use **sharp square edges** instead of rounded cards while preserving the layered glass treatment, green/white gradients, shadows, highlights, hover lift, and page transitions.
- Content grids stretch their panels and cards to use available space more evenly and reduce dead/negative space.

# SOILS Classification v1.10.11

v1.10.11 focuses on startup speed, instant delete behavior, and account/session correctness.

## Fixed in this version

- Admin startup no longer performs legacy database repair before rendering the dashboard.
- Farmer synchronization no longer runs spatial repair on every 2.5-second refresh.
- React StrictMode was removed from the development entry point so `npm.cmd run dev` does not mount the workspace twice and create duplicate startup/sync requests.
- Admin workspace bundles load in parallel.
- A 20-second Admin API timeout and 15-second Farmer sync timeout prevent an endless loading screen.
- Legacy cleanup still runs automatically, but only in the background after the dashboard is already usable.
- After background cleanup finishes, SOILS silently reloads the current authoritative workspace without showing the full-screen loader.
- Sensor, Soil Plot, and Drone Mapping deletes now remove matching duplicate layers from local state immediately, not only the selected row ID.
- Delete operations now physically delete and verify Appwrite rows first. A failed Appwrite delete is no longer swallowed or reported as success.
- The spatial delete journal/tombstone is written only after the physical deletion succeeds.
- The published Leaflet overlay group receives an explicit data revision, forcing deleted markers/polygons to disappear immediately without refreshing the page.
- Farmer workspace refreshes replace map layers directly from the latest authoritative bundle.
- Duplicate Farmer section-sync requests were removed; one Realtime + fallback synchronization path remains.
- Real login always closes the previous Appwrite session before creating the requested account session.
- Admin and Farmer JWT caches are cleared whenever the account changes.
- Demo role state now uses `sessionStorage` instead of `localStorage`, so one browser tab cannot leak a Demo Admin/Farmer role into other tabs.
- When a tab regains focus, SOILS verifies the current Appwrite account and corrects the UI if another tab changed the shared browser session.

## Existing Appwrite schema

v1.10.11 uses the `spatial_changes` table introduced in v1.10.9. If you already ran the v1.10.9 setup successfully, you do not need to run setup again.

If `spatial_changes` was never created, run once:

```bat
npm.cmd run setup:appwrite
```

## Install the update

Extract `Soils-v1.10.11-Update.zip` directly into your existing project folder, the folder that already contains `package.json` and `node_modules`, then choose **Replace All**.

The update ZIP intentionally excludes `.env`.

Verify:

```bat
0_VERIFY_VERSION.bat
```

Expected:

```text
OK: SOILS v1.10.11 is installed
```

Start:

```bat
npm.cmd run dev
```

A new npm install is not required when updating from v1.10.9 because no dependency was added.

## Admin and Farmer at the same time

Appwrite's browser session is shared by tabs using the same browser profile and the same site origin. Therefore, do not keep a real Admin account and a real Farmer account signed in simultaneously in two ordinary tabs of the same Chrome profile.

Recommended test setup:

- Normal Chrome window: Admin
- Incognito window or a different Chrome profile: Farmer

v1.10.11 prevents accidental reuse of the previous session when switching accounts, but separate browser contexts are still required for simultaneous two-account testing.

## GitHub / Vercel

After testing locally:

```bat
5_GITHUB_UPDATE.bat
```

The script builds with `npm.cmd`, protects `.env`, commits v1.10.11, pushes `main`, and lets the connected Vercel project redeploy.
