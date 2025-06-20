// src/cli.ts
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import dotenv from "dotenv"
dotenv.config()

import { initCmd } from "./commands/init"
import { syncCmd } from "./commands/sync"
import { watchCmd } from "./commands/watch"
import { scheduleCmd } from "./commands/schedule"

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
    (y) =>
      y.option("debounce", {
        type: "number",
        default: 300,
        describe: "Debounce interval (ms)",
      }),
    (argv) => watchCmd(argv.debounce as number)
  )
  .command(
    "schedule <intervalMs>",
    "Run sync every <intervalMs> milliseconds",
    (y) =>
      y.positional("intervalMs", {
        type: "number",
        describe: "Interval in milliseconds (e.g. 60000 for 1 minute)",
      }),
    (argv) => scheduleCmd(argv.intervalMs as number)
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
  .demandCommand(1, "You need to specify a command")
  .help()
  .parseAsync()
  .catch((err) => {
    // any unhandled rejection from your command handlers ends up here
    console.error(err)
    process.exit(1)
  })
