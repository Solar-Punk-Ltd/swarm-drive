export interface Config {
  localDir: string;
  volumeRef: string;
  lastManifest?: string;
  watchIntervalMinutes?: number;
}

export interface State {
  lastSync: string;
  lastManifest?: string;
  lastFiles?: string[];
}