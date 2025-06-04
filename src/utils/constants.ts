import { Topic, Reference } from "@ethersphere/bee-js";
import { NULL_ADDRESS } from "@ethersphere/bee-js";

export const DRIVE_FEED_TOPIC = new Topic(Buffer.alloc(32));

export const SWARM_ZERO_ADDRESS = new Reference(NULL_ADDRESS);
