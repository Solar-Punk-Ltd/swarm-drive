import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dotenv from "dotenv";
dotenv.config();

import { initCmd } from "./commands/init";
import { syncCmd } from "./commands/sync";
import { watchCmd } from "./commands/watch";
import { scheduleCmd } from "./commands/schedule";

import {
  listStamps,
  feedGet,
  feedLs,
  manifestLs,
} from "./commands/helpers";

yargs(hideBin(process.argv))
  .command(
    "init <localDir>",
    "Initialize Swarm Drive",
    (y) =>
      y.positional("localDir", {
        type: "string",
        describe: "Local folder path",
      }),
    (argv) => {
      initCmd(argv.localDir as string).catch((e) => {
        console.error("initCmd failed:", e);
        process.exit(1);
      });
    }
  )
  .command(
    "sync",
    "Sync local folder to Swarm",
    () => {},
    () => {
      syncCmd().catch((e) => {
        console.error("syncCmd failed:", e);
        process.exit(1);
      });
    }
  )
  .command(
    "watch",
    "Watch local folder for changes and sync",
    (y) =>
      y.option("debounce", {
        type: "number",
        default: 300,
        describe: "Debounce interval (ms)",
      }),
    (argv) => {
      watchCmd((argv.debounce as number)).catch((e) => {
        console.error("watchCmd failed:", e);
        process.exit(1);
      });
    }
  )

  .command(
    "schedule <intervalMs>",
    "Run sync every <intervalMs> milliseconds",
    (y) =>
      y.positional("intervalMs", {
        type: "number",
        describe: "Interval in milliseconds (e.g. 60000 for 1 minute)",
      }),
    (argv) => {
      scheduleCmd(argv.intervalMs as number).catch((e) => {
        console.error("scheduleCmd failed:", e);
        process.exit(1);
      });
    }
  )

  .command(
    "stamp-list",
    "List all postage stamps (batch IDs, depths, amounts, labels)",
    () => {},
    () => {
      listStamps().catch((e) => {
        console.error("stamp-list failed:", e);
        process.exit(1);
      });
    }
  )
  .command(
    "feed-get [index]",
    "Read a feed entry. Omit [index] for latest; provide an index for a specific slot.",
    (y) =>
      y.positional("index", {
        type: "number",
        describe: "Optional feed index (fallback to latest if not provided)",
      }),
    (argv) => {
      const idx = argv.index as number | undefined;
      feedGet(idx).catch((e) => {
        console.error("feed-get failed:", e);
        process.exit(1);
      });
    }
  )
  .command(
    "feed-ls",
    "Show current feed@latest manifest reference (alias of feed-get)",
    () => {},
    () => {
      feedLs().catch((e) => {
        console.error("feed-ls failed:", e);
        process.exit(1);
      });
    }
  )
  .command(
    "manifest-ls <manifestRef>",
    "List all files under a given Swarm manifest reference",
    (y) =>
      y.positional("manifestRef", {
        type: "string",
        describe: "The 32‐byte Swarm manifest hash",
      }),
    (argv) => {
      manifestLs(argv.manifestRef as string).catch((e) => {
        console.error("manifest-ls failed:", e);
        process.exit(1);
      });
    }
  )
  .demandCommand(1, "You need to specify a command")
  .help()
  .parse();
