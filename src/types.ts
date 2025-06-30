export interface Config {
  localDir: string;
  watchIntervalSeconds?: number;
  scheduleIntervalSeconds?: number;
}

export interface State {
  lastSync: string;
  lastFiles?: string[];
}
