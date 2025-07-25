export interface Config {
  localDir: string;
  watchIntervalSeconds?: number;
  scheduleIntervalSeconds?: number;
}

export enum StateMode {
  WATCH = "watch",
  SCHEDULE = "schedule",
  MANUAL = "manual",
}

export interface State {
  lastFiles?: string[];
  skipFiles?: string[];
  lastRemoteFiles?: string[];
  lastSync?: string;
  currentMode: StateMode;
}
