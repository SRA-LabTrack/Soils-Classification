# SOILS Classification v1.10.31 OVERHAUL

## v1.10.31 approval + rejection state fix

- **All three approvals use the same corrected transaction:** Farmer Sensor, Soil Plot, and Drone Mapping requests now publish through one bounded, deterministic approval path.
- **No stale request overlay after Reject:** the focused purple request overlay is cleared immediately and the local pending request state is changed before the background refresh.
- **No stale request overlay after Approve:** the pending overlay is removed as soon as review begins; successful approval replaces it with the real spatial record.
- **Deterministic recovery:** if Appwrite commits the Sensor / Plot / Drone row but the HTTP response is delayed, SOILS recovers the deterministic row instead of duplicating or losing it.
- **Short review transaction:** approval no longer re-reads the farm and no longer waits for Support Chat or the optional spatial journal before returning.
- **Request state is preserved during workspace refreshes:** authoritative spatial refreshes no longer accidentally discard the Farmer request list.
- **Background reconciliation:** after approval, Admin refreshes the selected farm separately without keeping the Approve button busy.

No new Appwrite schema is required beyond the existing `spatial_requests` setup.

## v1.10.31 approval reliability

- **Approve no longer hangs:** Sensor, Soil Plot, and Drone Mapping Farmer requests use a fast deterministic approval path instead of waiting on history rows, duplicate farm lookups, the spatial journal, and Support Chat before returning.
- **Primary record first:** the real Sensor / Soil Plot / Drone Mapping row and the reviewed `spatial_requests` status are the authoritative transaction.
- **Safe retry/recovery:** approval row IDs are deterministic. Retrying cannot create duplicates, and an already-approved request returns its published spatial record so the Admin UI can recover without a reload.
- **Support cannot block approval:** decision chat delivery uses a short best-effort timeout. If it is delayed, the Farmer conversation synthesizes the decision from `spatial_requests`.
- **Immediate Farmer sync:** Farmer farm Realtime now listens to both the compact `spatial_changes` journal and the farm-scoped `spatial_requests` channel. The approval status event triggers an authoritative workspace reload without aggressive polling.
- **Lost-response recovery:** if the browser times out after Appwrite has already committed an approval, the Admin UI checks the authoritative request/farm state in the background and restores the published record.

No new Appwrite table is required beyond the v1.10.27 `spatial_requests` migration. If you have not run that migration yet, run `npm.cmd run setup:appwrite` once.


## v1.10.27 request delivery reliability

- **No more endless Saving:** Farmer request calls now have explicit browser/API/Appwrite timeouts and return a useful retry error instead of spinning forever.
- **Request first, chat second:** the `spatial_requests` row is committed first. Support Chat notification is best-effort and cannot cancel a valid request.
- **Admin cannot miss a saved request:** Support Inbox also reads `spatial_requests` directly and synthesizes a clickable map-request card when the linked chat message is unavailable.
- **Safe retry:** the same Farmer draft carries a stable `client_request_id`, so retrying after a network timeout reuses the same request rather than creating duplicates.
- **Schema compatibility:** older `support_messages` tables that do not yet have `request_id` / `request_type` no longer block Farmer placement requests.
- **Realtime request channel:** Admin listens to both Support Chat and spatial request realtime events independently.
- **Correct Farmer UI label:** the request dialog now uses `FARMER REQUEST`, not `ADMIN CONTROL`.

## v1.10.27 Farmer placement request + Admin approval workflow

- **Farmer map requests:** Farmer accounts can request a Sensor, Soil Analysis Plot, or Drone Mapping location directly from **Overview / My Farm** using the same in-map placement editor style as Admin.
- **GPS or map plotting:** Sensor requests can be positioned by map/GPS coordinate. Soil Plot and Drone Mapping requests can be traced as polygons or entered point-by-point with GPS coordinates.
- **Farm-boundary validation:** requested points must stay inside the Farmer's approved Farm Boundary. Farm Boundaries remain Admin-managed.
- **Pending means pending:** Farmer requests live in the separate `spatial_requests` table and appear as purple dashed **Pending request** overlays. They are not counted as real Sensors, Soil Plots, Drone Mappings, or Statistics before approval.
- **Support Inbox notification:** submitting a request creates a Support Chat message linked to the exact request. The Farmer receives a submission acknowledgement.
- **Click-to-map Admin review:** the Admin Support Inbox renders map requests as clickable cards. Clicking one from Overview, Statistics, Sensors, or any other Admin section switches to the map, opens the correct Farmer farm, and smoothly flies to the exact requested point/polygon.
- **Approve / Reject:** a map review card lets Admin approve or reject. Approval converts the pending request into the real Sensor / Soil Plot / Drone Mapping row; rejection creates no operational map record. Either decision is sent back to the Farmer through Support Chat.
- **Low free-tier overhead:** requests are event-driven through the existing Support + spatial-change realtime channels. There is no new aggressive polling loop.

**Required once after this upgrade:** run `npm.cmd run setup:appwrite` to create `spatial_requests` and add request-link fields to `support_messages`.

## v1.10.27 clean-generation overhaul

This build merges the v1.10.24 Support Inbox and Admin header hotfixes into one full project and starts a new spatial-data generation. **All Sensor, Soil Plot, and Drone Mapping rows created before 2026-08-11 14:08 (UTC+8) are archived out of both Admin and Farmer workspaces.** Farm boundaries, Farmer accounts, profiles, and support conversations are preserved.

No reset command is required for the clean workspace: the cutoff is enforced in the Admin API, Farmer API, and direct Appwrite read helpers, and the browser cache generation is new. Old rows can optionally be physically purged from Appwrite with `npm.cmd run reset:pins` when an API key is available. The reset is manual so re-extracting this ZIP can never wipe new records you create later.


## v1.10.27 clean spatial workspace

This full build includes all v1.10.23 hotfixes and starts with a new browser cache namespace so old ghost/pending pins cannot reload locally. To permanently clear the connected Appwrite project of all map pin inputs while preserving farmer accounts and farm boundaries, run once:

```bat
npm.cmd run reset:pins
```

The reset removes **Sensors + readings, Soil Plots + analyses, Drone Mappings, Farmer map requests, and spatial-change journal rows**. It preserves **farmer accounts, farms, farm boundaries, profiles, and support messages**.

v1.10.27 is a map-navigation and spatial-CRUD reliability patch built on v1.10.22. It keeps the isolated Sensor/Soil Plot/Drone collections, while making every in-map section button a repeatable camera navigator and hardening Plot/Drone creation plus exact-row deletion.

## v1.10.27 cycle navigation + CRUD repair

- **Click-to-cycle map sections:** Farms, Sensors, Soil Plots, and Drone Mapping are now active map navigation controls. The first click focuses the first mapped record; repeated clicks move smoothly to the next record and wrap back to the first.
- **Multi-boundary Farm cycling:** every saved Farm Boundary is a separate stop, so repeated **Farms** clicks move Boundary 1 → Boundary 2 → Boundary 3 → Boundary 1.
- **Admin + Farmer parity:** the same cycling navigator is embedded in Admin Overview, the Admin Sensor Network workspace, Admin farmer detail, Farmer Overview, and Farmer My Farm.
- **Smooth polygon focusing:** Soil Plot, Drone Mapping, and Farm Boundary targets use animated boundary fitting rather than a one-time static center jump. Re-clicking the same record issues a fresh camera command.
- **Admin Sensor Network alignment:** the map and right-side Sensor directory now share the same 520px workspace height, with the directory scrolling internally instead of stretching/cropping the map.
- **Exact-row deletion:** Sensor, Soil Plot, and Drone Mapping deletes use the Appwrite row ID and trust a successful DELETE response instead of immediately re-reading a potentially stale cached row and falsely rolling the deletion back.
- **Safer Plot/Drone creation:** the authoritative spatial row is saved first. Secondary reading/analysis history writes are best-effort and can no longer make a successfully-created pin/polygon look like a failed save.
- **Legacy Appwrite schema fallback:** Soil Plot and Drone Mapping creation/update can fall back to the older core table columns when optimized v1.10.22 snapshot columns have not been migrated yet. A clear setup warning is returned instead of silently losing the drawing.
- **Retry-friendly Add flow:** Sensor/Plot/Drone create modals keep their GPS/polygon draft until Appwrite confirms the save. A failed request no longer throws away the shape the user just traced.
- **Type isolation retained:** adding or deleting one spatial type never replaces, hides, or removes records from the other spatial collections.

## v1.10.22 spatial + sync + support reliability

- **Spatial writes are type-isolated:** a Sensor mutation updates only the Sensor collection, a Soil Plot mutation updates only Soil Plots, and a Drone Mapping mutation updates only Drone Mapping. A successful single-record write no longer replaces the whole farm bundle.
- **Exact Appwrite row identity:** confirmed creates/updates merge by Appwrite row ID. Labels such as `Sensor 1`, `Plot 1`, and `Drone Mapping 1` are display text only and cannot collide across record types.
- **No destructive spatial repair:** automatic repair never deletes a mapped Sensor, Soil Plot, or Drone Mapping because a secondary reading/analysis history row is missing or delayed.
- **Stable Leaflet layers:** adding one polygon/pin no longer remounts the complete Canvas overlay group. Existing Sensor, Soil Plot, and Drone Mapping layers stay mounted while only the changed record updates.
- **Authoritative Farmer refresh:** initial load, realtime-triggered refreshes, tab-focus refreshes, and safety refreshes all rebuild the Farmer workspace through the authenticated server endpoint. This avoids partial browser-side Appwrite reads when legacy row permissions are stale.
- **Farmer assignment self-repair:** the Farmer profile's assigned farm remains canonical, and legacy farm ownership plus spatial realtime permissions are repaired when needed.
- **Support Chat confirmed-write merge:** Farmer messages, the automatic acknowledgment, and Admin replies are inserted into the conversation immediately from the confirmed server response. A slightly delayed list response can no longer erase a message that was just successfully sent.
- **Shared Admin/Farmer chat remains Appwrite-backed:** `support_messages` is the common channel for both accounts, with bounded history and realtime notifications plus low-frequency safety refreshes while the chat is open.
- **Setup migration repairs support permissions:** the included Appwrite setup verifies the shared chat table and repairs legacy Farmer/farm/support/realtime permissions.
- **Free-plan optimizations retained:** lazy dashboard/chart loading, immutable Vercel asset caching, bounded support payloads, cached authentication, denormalized latest Sensor/Plot snapshots, request coalescing, Canvas map rendering, and reduced glass-rendering cost remain from v1.10.21.

## v1.10.20 Farmer sync + shared support retained

- **Profile assignment is authoritative:** the Farmer endpoint honors `profiles.farm_id` first and repairs stale farm ownership when needed.
- **Fresh source tables win:** `farms`, Sensor/Plot/Drone rows, and their latest snapshots remain authoritative; `spatial_changes` acts only as a realtime notification signal.
- **Shared support storage:** Farmer/Admin support messages persist in Appwrite `support_messages` and the automatic Farmer acknowledgment remains available across devices and refreshes.
- **Admin Support Inbox:** Admin accounts retain the Farmer conversation list, unread state, refresh control, and reply box.
- **Legacy permission repair:** `npm.cmd run setup:appwrite` repairs Farmer-to-farm ownership and existing row read permissions.

## v1.10.19 multi-entry visibility fix retained

- **Existing pins stay visible:** creating Sensor 2 keeps Sensor 1 rendered. The same applies to Soil Analysis Plots and Drone Mapping polygons.
- **Record ID is the identity:** Sensor names, Plot names, and Drone Mapping names no longer act as destructive unique keys. Two independent records can never hide or delete one another merely because their labels match.
- **No name-based cleanup on save:** creating or editing a spatial record no longer removes another Appwrite row with the same display name.
- **Exact deletion:** deleting a Sensor, Soil Plot, or Drone Mapping record targets its exact Appwrite row ID instead of deleting every record with a matching label.
- **Journal replay is ID-safe:** the optional `spatial_changes` realtime journal updates/deletes the exact entity ID and no longer collapses records by logical name.
- **Admin + Farmer loaders preserve all rows:** global Admin data, farm bundles, and Farmer workspace synchronization now retain every distinct spatial record ID.
- **Existing polygons remain visible while drawing:** starting another Soil Plot or Drone Mapping draft no longer temporarily hides already-published polygons.
- **Automatic Sensor numbering:** the Add Sensor form now chooses the next available `Sensor 1`, `Sensor 2`, `Sensor 3`, and so on instead of reopening with `Sensor 1` every time.
- **Visibility stays ON after additions:** authoritative list changes refresh the visibility ID set so all current Sensor pins and Soil Plot polygons remain enabled by default.

## v1.10.18 collapsible map controls + selective boundary deletion retained

- **Overview controls are inside the map:** the Farms / Sensors / Soil Plots / Drone Mapping selector, section description, counts, and **View section sources** control float over the map instead of consuming a full-width strip above it.
- **Overview panel is collapsible:** collapse the left in-map section panel into a compact tab and expand it whenever you need to switch sections or inspect source records.
- **Admin Map Editor is collapsible:** the right-side Farm Boundary / Sensor / Soil Plot / Drone Mapping editor can also collapse into a compact tab. Starting a drawing action automatically opens the editor while the Overview panel gets out of the way.
- **Selectable Farm Boundary deletion:** when a farmer has multiple saved boundaries, **Delete boundary** opens a selector listing Boundary 1, Boundary 2, and so on, including each boundary's area, center coordinate, and point count. Only the selected boundary is deleted.
- **Remaining boundaries are preserved:** deleting Boundary 2 no longer wipes Boundary 1 or Boundary 3. Farm area, center, status, map geometry, and Farmer synchronization are recalculated from the boundaries that remain.
- **Offline-safe boundary targeting:** selective deletes carry the exact boundary geometry as the target so queued changes can identify the intended boundary even if indexes later shift.

## v1.10.17 map + multi-boundary update retained

- **Multiple Farm Boundaries:** adding another boundary now appends Boundary 2, 3, and so on instead of overwriting Boundary 1. Existing single-boundary farms remain compatible.
- **My Farm boundary cycling:** click **My Farm** repeatedly to fit Boundary 1, then Boundary 2, continuing through every saved boundary and wrapping back to the first.
- **Map-integrated Admin editor:** Farm Boundary, Sensor, Soil Plot, and Drone Mapping controls now float inside the map on a compact right glass rail so the map keeps its full workspace width.
- **Cleaner Sensor placement:** the long drag/rotation instruction labels were removed; remaining placement affordances are compact and unobtrusive.
- **Coordinate preview collision fix:** Preview center, latitude/longitude values, Copy/Copied controls, and GPS actions have dedicated responsive space in the in-map editor.
- **Repeatable source focusing:** the same Sensor, Soil Plot, or Drone Mapping can be clicked repeatedly from Statistics or Sensor lists and the camera will recenter every time, even after manual panning.
- **Matched right-side rails:** Statistics sources and the Sensors directory sit on the right and are height-matched with their map, with internal scrolling when records exceed the visible height.
- **All layers visible by default:** Farm Boundaries, Sensor pins, Sensor coverage, Soil Plots, and Drone Mapping start visible on Admin and Farmer maps. Adding a new spatial record no longer hides the other layers.
- **Farmer support chat:** Farmer accounts now include a compact support messenger. Every submitted message immediately receives: `Your message has been received an agent will accommodate you as soon as possible`.
- **v1.10.16 retained:** the COAC-style top toolbar, Overview/Statistics/Farmer source dropdowns, GPS pair copy/paste, spatial save reliability, and Admin-to-Farmer synchronization remain intact.

## v1.10.16 toolbar + source tracing retained

- **COAC-style horizontal workspace toolbar:** the main left navigation is replaced by a stable top rail modeled after the supplied COAC Tool Aid reference, with fixed section buttons, a strong selected state, compact account controls, and an Admin Farmer selector.
- **Sharp green/white glass geometry:** the new toolbar, section selectors, source controls, and dropdowns stay square-edged while preserving SOILS green/white gradient glass, depth, and motion.
- **Overview source dropdown:** Farms, Sensors, Soil Plots, and Drone Mapping remain one selectable Overview workspace. The selected section now has **View section sources**, listing the exact records behind its count.
- **Statistics source dropdowns:** every nutrient and farm statistic has its own **View sources** control. Sensor averages identify every contributing Sensor pin; area/status identify the Farm Boundary; plot and drone totals list their exact polygons.
- **Farmer account source dropdowns:** My Soil Overview / My Farm nutrient averages, farm area, active sensor count, Soil Plot count, and Drone Mapping count all expose the records that create the displayed number.
- **Farmer Soil Analysis source tracing:** nutrient averages and laboratory plot lists also expose their source Sensor pins / Soil Plot records.
- **Map linkage retained:** choosing a Sensor, Soil Plot, or Drone Mapping source continues to focus the corresponding map record so the source can be visually verified.
- **No regression to v1.10.15 fixes:** exact GPS entry, pair copy/paste, sensor/plot/drone creation, My Farm recentering, realtime/fallback Farmer sync, and optional spatial journal behavior are retained.

## v1.10.15 fixes retained

- **GPS Sensor saves fixed:** entering an exact latitude and longitude now updates the Sensor placement immediately and the confirmed Appwrite row replaces the temporary map pin after save.
- **GPS Soil Plot and Drone Mapping saves fixed:** coordinate-created polygons are shown immediately, then reconciled with the authoritative Appwrite record instead of appearing to do nothing while the server request is in flight.
- **Spatial journal is no longer a write blocker:** `spatial_changes` is now an optional realtime acceleration layer. A missing or temporarily unavailable journal table no longer prevents the real Sensor, Soil Plot, Drone Mapping, or Farm Boundary table from saving.
- **Farmer synchronization fallback:** the original v1.10.15 five-second fallback is retained historically but superseded in v1.10.22 by Realtime-first syncing with much lower-frequency safety refreshes.
- **One Overview workspace:** Overview now uses one sharp-edged section selector for Farms, Sensors, Soil Plots, and Drone Mapping. Only the selected section is highlighted and displayed in the shared map/detail stage.
- **Clickable Overview records:** Sensor, Soil Plot, and Drone Mapping records can be clicked to focus the exact pin/polygon and reveal the data owned by that map record. Plot and Drone rows also expose their N/P/K/pH values directly.
- **Clickable Statistics:** every major statistic can be selected. The drill-down stage identifies the exact Sensor pins, Soil Plot polygons, Drone Mapping polygons, or Farm Boundary that supplies the statistic and lets you focus that source on the map.
- **My Farm recenter strengthened:** clicking **My Farm** issues a fresh camera command even after the map was manually panned away, closes stale popups, refreshes map sizing, and fits the saved farm boundary again.
- **Cleaner Add Sensor form:** Sensor labels, fields, spacing, and rotation summary are smaller and denser so the editor is easier to scan.
- **Coordinate Copy fixed:** Coordinate Preview has a properly sized Copy button. It copies a pair in `latitude, longitude` order without overlapping its box.
- **Pair Paste added:** paste a copied `latitude, longitude` pair into either Latitude or Longitude field and SOILS fills both inputs automatically and respectively. This works in the map GPS editor and Add Sensor GPS fields.

## Windows install and run

Open Command Prompt in the folder containing `package.json` and run:

```bat
npm.cmd install
npm.cmd run dev
```

Or use the included helpers:

```bat
1_INSTALL.bat
3_RUN.bat
```

The development app opens through the integrated API + Vite server on `localhost:5173`.

## Appwrite setup

**Run this once after upgrading to v1.10.27.** It creates/verifies the new `spatial_requests` workflow, adds request-link fields to `support_messages`, keeps the latest-snapshot optimizations, and repairs legacy Farmer assignment/permissions:

```bat
npm.cmd run setup:appwrite
```

The source Farm/Sensor/Plot/Drone tables remain authoritative. `spatial_changes` is only the realtime notification channel. Farmer refreshes are resolved through the authenticated Farmer API so legacy Appwrite row permissions cannot produce a partial map bundle.

## Production build

```bat
npm.cmd run build
```

## Version check

```bat
0_VERIFY_VERSION.bat
```

Expected output includes:

```text
OK: SOILS v1.10.27 is installed
```

## GitHub / Vercel publish

Run:

```bat
5_GITHUB_UPDATE.bat
```

The script first runs `npm.cmd run build`, excludes `.env`, commits v1.10.27, and pushes `main`. If the Vercel project is connected to that branch, Vercel can deploy the new commit automatically.

## Admin + Farmer testing

Appwrite web sessions are shared between tabs in the same browser profile. For simultaneous testing, use one normal browser profile for Admin and an Incognito/InPrivate window or a different browser profile for Farmer.
