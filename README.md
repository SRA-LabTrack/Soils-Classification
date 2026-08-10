# SOILS Classification v1.10.12

## Duplicate Plot / Drone creation fix

v1.10.12 fixes the case where creating one Soil Analysis Plot or one Drone Mapping could appear as two objects at different locations.

### What changed

- Persisted Soil Plots are now represented by one map object only: the saved polygon/coverage shape. The old extra center pin was removed.
- Persisted Drone Mappings are now represented by one map object only: the saved polygon. The old extra center pin was removed.
- Soil Plot and Drone Mapping creates no longer render an optimistic temporary polygon before the Appwrite response. They appear only from the exact authoritative row/bundle returned by the server.
- A synchronous spatial-write latch prevents two submit events from entering before React updates the normal `busy` state.
- Journal replay performs a final logical-name canonicalization, so one Sensor code, Plot code, or Drone Mapping name produces one renderable record.
- Existing delete verification, Farmer synchronization, My Farm boundary fitting, sharp-edge glass UI, transitions, gradients, and map-state preservation remain intact.

## Updating an existing project

Extract `Soils-v1.10.12-Update.zip` into the project folder that contains `package.json`, then choose **Replace All**. The update package does not include `.env`.

No new npm dependencies and no new Appwrite columns/tables were added. If v1.10.11 already runs, use:

```bat
0_VERIFY_VERSION.bat
npm.cmd run dev
```

The verifier should print:

```text
OK: SOILS v1.10.12 is installed
```

You do not need to run `npm.cmd install` or `npm.cmd run setup:appwrite` for this update.

## GitHub

After testing:

```bat
5_GITHUB_UPDATE.bat
```

The script protects `.env`, builds, commits v1.10.12, and pushes `main`.
