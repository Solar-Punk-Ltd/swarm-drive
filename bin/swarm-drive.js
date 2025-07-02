#!/usr/bin/env node
"use strict";

const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

// 1) register TS-Node so we can import .ts files
require("ts-node").register({
  project: path.resolve(__dirname, "../tsconfig.json"),
  // optionally: transpileOnly: true
});

// 2) load your TS CLI entrypoint
require(path.resolve(__dirname, "../src/cli.ts"));
