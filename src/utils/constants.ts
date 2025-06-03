// src/utils/constants.ts
import { Topic, Reference } from "@ethersphere/bee-js";
import { NULL_ADDRESS } from "@ethersphere/bee-js";

// Make DRIVE_FEED_TOPIC exactly 32 bytes long.
// (Topic.fromString(...) will also work, but this is explicitly 32 bytes.)
export const DRIVE_FEED_TOPIC = new Topic(Buffer.alloc(32));

// A zero‐reference used to detect empty feeds
export const SWARM_ZERO_ADDRESS = new Reference(NULL_ADDRESS);
