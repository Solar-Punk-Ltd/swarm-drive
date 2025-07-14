import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import dotenv from "dotenv"
dotenv.config()

import { initCmd } from "./commands/init"
import { syncCmd } from "./commands/sync"
import { scheduleCmd } from "./commands/schedule"
import { statusCmd } from "./commands/status";
import { configSetCmd, configGetCmd } from "./commands/config";

import {
  listStamps,
  feedGet,
  feedLs,
  manifestLs,
} from "./commands/helpers"

yargs(hideBin(process.argv))
  .command({
    command: "init <localDir>",
    describe: "Initialize Swarm Drive",
    builder: (y) =>
      y.positional("localDir", {
        type: "string",
        describe: "Local folder path",
      }),
    handler: (argv) => initCmd(argv.localDir as string),
  })
  .command({
    command: "sync",
    describe: "Sync local folder to Swarm",
    handler: () => syncCmd(),
  })
  .command({
    command: "schedule <intervalSec>",
    describe: "Run sync every <intervalSec> seconds",
    builder: (y) =>
      y.positional("intervalSec", {
          type: "number",
          describe: "Interval in seconds (e.g. 60 for 1 minute)",
        }),
    handler: (argv) => scheduleCmd(argv.intervalSec as number),
  })
  .command({
    command: "stamp-list",
    describe: "List postage stamps",
    handler: () => listStamps(),
  })
  .command({
    command: "feed-get [index]",
    describe: "Read a feed entry (omit for latest)",
    builder: {
      index: { type: "number", describe: "Optional feed index" },
    },
    handler: (argv) => feedGet(argv.index as number | undefined),
  })
  .command({
    command: "feed-ls",
    describe: "Alias for feed-get latest",
    handler: () => feedLs(),
  })
  .command({
    command: "manifest-ls <manifestRef>",
    describe: "List all files under a given manifest reference",
    builder: {
      manifestRef: {
        type: "string",
        describe: "The 32-byte Swarm manifest hash",
      },
    },
    handler: (argv) => manifestLs(argv.manifestRef as string),
  })
  .command({
    command: "status",
    describe: "Show current configuration and last sync status",
    handler: () => statusCmd(),
  })
  .command({
    command: "config <action> [key] [value]",
    describe: "Get or set configuration",
    builder: (y) =>
      y
        .positional("action", {
          choices: ["get", "set"],
          describe: "Whether to read or update a setting",
        })
        .positional("key", {
          type: "string",
          describe: "Config key (e.g. localDir, watchIntervalSeconds)",
        })
        .positional("value", {
          type: "string",
          describe: "New value (only required for set)",
        }),
    handler: async (argv) => {
      if (argv.action === "get") {
        await configGetCmd(argv.key!);
      } else {
        if (argv.value === undefined) {
          console.error("Error: missing value for config set");
          process.exit(1);
        }
        await configSetCmd(argv.key!, argv.value);
      }
    },
  })
  .demandCommand(1, "You need to specify a command")
  .help()
  .parseAsync()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
