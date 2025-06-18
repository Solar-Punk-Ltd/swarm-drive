export interface Config {
  localDir: string;
  watchIntervalMinutes?: number;
}

export interface State {
  lastSync: string;
  lastFiles?: string[];
}