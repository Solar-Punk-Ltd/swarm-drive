import { NULL_ADDRESS, NULL_TOPIC, Reference } from "@ethersphere/bee-js";
import path from "path";

export const DRIVE_FEED_TOPIC = NULL_TOPIC;
export const STATE_PATH_NAME = ".swarm-sync-state.json";
export const STATE_PATH = path.resolve(process.cwd(), STATE_PATH_NAME);
export const CONFIG_FILE = ".swarm-sync.json";
export const SWARM_ZERO_ADDRESS = new Reference(NULL_ADDRESS);
export const SWARM_DRIVE_STAMP_LABEL = "swarm-drive-stamp";
export const DEFAULT_BEE_URL = "http://127.0.0.1:1633";
