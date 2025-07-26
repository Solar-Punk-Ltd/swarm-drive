import { Bytes, FeedIndex, Reference } from "@ethersphere/bee-js";

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

interface FeedUpdateHeaders {
  feedIndex: FeedIndex;
  feedIndexNext?: FeedIndex;
}
export interface FeedPayloadResult extends FeedUpdateHeaders {
  payload: Bytes;
}
export interface FeedReferenceResult extends FeedUpdateHeaders {
  reference: Reference;
}
