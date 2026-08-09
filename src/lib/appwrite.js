import { Client, Account, TablesDB, Query, Realtime, Channel } from 'appwrite';

export const APPWRITE = {
  endpoint: import.meta.env.VITE_APPWRITE_ENDPOINT,
  projectId: import.meta.env.VITE_APPWRITE_PROJECT_ID,
  databaseId: import.meta.env.VITE_APPWRITE_DATABASE_ID || 'soils_database',
  tables: {
    profiles: import.meta.env.VITE_APPWRITE_PROFILES_TABLE_ID || 'profiles',
    farms: import.meta.env.VITE_APPWRITE_FARMS_TABLE_ID || 'farms',
    sensors: import.meta.env.VITE_APPWRITE_SENSORS_TABLE_ID || 'sensor_stations',
    readings: import.meta.env.VITE_APPWRITE_READINGS_TABLE_ID || 'sensor_readings',
    plots: import.meta.env.VITE_APPWRITE_PLOTS_TABLE_ID || 'soil_plots',
    analyses: import.meta.env.VITE_APPWRITE_ANALYSES_TABLE_ID || 'soil_analyses',
    drone: import.meta.env.VITE_APPWRITE_DRONE_TABLE_ID || 'drone_mappings',
  },
};

export const client = new Client()
  .setEndpoint(APPWRITE.endpoint)
  .setProject(APPWRITE.projectId);

export const account = new Account(client);
export const tablesDB = new TablesDB(client);
export const realtime = new Realtime(client);
export { Query, Channel };
