import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { initCmd } from "./commands/init";
import { syncCmd } from "./commands/sync";
import { watchCmd } from "./commands/watch";
import dotenv from "dotenv";
dotenv.config();

yargs(hideBin(process.argv))
  .command(
    "init <localDir>",
    "Initialize Swarm Drive",
    (y) =>
      y.positional("localDir", {
        type: "string",
        describe: "Local folder path"
      }),
    (argv) => initCmd(argv.localDir as string)
  )
  .command(
    "sync",
    "Sync local folder to Swarm",
    () => {},
    () => syncCmd()
  )
  .command(
    "watch",
    "Watch local folder for changes and sync",
    (y) =>
      y.option("debounce", {
        type: "number",
        default: 300,
        describe: "Debounce interval in milliseconds"
      }),
    (argv) => watchCmd(argv.debounce as number)
  )
  .demandCommand(1, "You need to specify a command")
  .help()
  .parse();
