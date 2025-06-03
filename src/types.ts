export interface Config {
  localDir: string;
  watchIntervalMinutes?: number;
}

export interface State {
  lastSync: string;
  lastManifest?: string;
  lastFiles?: string[];
}