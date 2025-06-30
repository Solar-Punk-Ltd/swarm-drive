import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import dotenv from "dotenv"
dotenv.config()

import { initCmd } from "./commands/init"
import { syncCmd } from "./commands/sync"
import { watchCmd } from "./commands/watch"
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
  .command(
    "init <localDir>",
    "Initialize Swarm Drive",
    (y) =>
      y.positional("localDir", {
        type: "string",
        describe: "Local folder path",
      }),
    (argv) => initCmd(argv.localDir as string)
  )
  .command("sync", "Sync local folder to Swarm", () => {}, () => syncCmd())
  .command(
    "watch",
    "Watch local folder for changes and sync",
    y => y.option("debounce", {
      type: "number",
      describe: "Debounce interval (ms) — overrides config.watchIntervalSeconds",
    }),
    argv => watchCmd(argv.debounce as number | undefined)
  )
  .command(
    "schedule <intervalSec>",
    "Run sync every <intervalSec> seconds",
    y =>
      y.positional("intervalSec", {
        type: "number",
        describe: "Interval in seconds (e.g. 60 for 1 minute)",
      }),
    (argv) => scheduleCmd(argv.intervalSec as number)
  )
  .command("stamp-list", "List postage stamps", () => {}, () => listStamps())
  .command(
    "feed-get [index]",
    "Read a feed entry (omit for latest)",
    (y) =>
      y.positional("index", {
        type: "number",
        describe: "Optional feed index",
      }),
    (argv) => feedGet(argv.index as number | undefined)
  )
  .command("feed-ls", "Alias for feed-get latest", () => {}, () => feedLs())
  .command(
    "manifest-ls <manifestRef>",
    "List all files under a given manifest reference",
    (y) =>
      y.positional("manifestRef", {
        type: "string",
        describe: "The 32-byte Swarm manifest hash",
      }),
    (argv) => manifestLs(argv.manifestRef as string)
  )
  .command(
    "status",
    "Show current configuration and last sync status",
    () => {},
    () => statusCmd()
  )
  .command(
    "config <action> [key] [value]",
    "Get or set configuration",
    y =>
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
    async argv => {
      if (argv.action === "get") {
        await configGetCmd(argv.key!);
      } else {
        if (argv.value === undefined) {
          console.error("Error: missing value for config set");
          process.exit(1);
        }
        await configSetCmd(argv.key!, argv.value);
      }
    }
  )
  .demandCommand(1, "You need to specify a command")
  .help()
  .parseAsync()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
