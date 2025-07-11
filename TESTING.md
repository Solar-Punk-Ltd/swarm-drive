# Testing

This project uses Jest for unit testing. All tests live under `tests/unit/`.  
In the future, integration tests can be added under `tests/integration/`.

---

## Prerequisites

- Node.js ≥ 14
- (Optional) `npm` or `yarn`

Ensure your environment variables are set for any commands that rely on them, e.g.:

```bash
export BEE_SIGNER_KEY=0x…   # for tests that require bee-js signer key
```

---

## Running All Tests

```bash
# with npm
npm test
```
---

## Unit Tests

All unit tests live in `tests/unit/` and cover:

- **init** (`init.spec.ts`)  
  - `initCmd` config/state file creation and error cases
- **sync** (`sync.spec.ts`)  
  - `syncCmd` end-to-end “remote-only” synchronization flows
- **helpers** (`helpers.spec.ts`)  
  - `feedGet`, `feedLs`, `manifestLs`, `listStamps` behaviors
- **watch** (`watch.spec.ts`)  
  - `watchCmd` file–event debounce & error handling
- **schedule** (`schedule.spec.ts`)  
  - `scheduleCmd` invocation & timer behavior
- **status** (`status.spec.ts`)  
  - `statusCmd` output formatting, missing-config error, and modes (`manual`/`watch`/`schedule`)  
- **config** (`config.spec.ts`)  
  - `configSetCmd` and `configGetCmd` set/get behaviors, valid/invalid keys and values  

### Run just unit tests

```bash
npx jest tests/unit
```

---

## Integration Tests

Detailed end‑to‑end or service‑level tests live in `tests/integration/`, validating real interactions with a Bee dev node:

- **init** (`init.integration.spec.ts`)  
  Tests that `init` writes a valid config and empty state file.  
- **sync** (`sync.integration.spec.ts`)  
  Tests end‑to‑end synchronization: initial upload, manifest listing, file modifications, and deletions.  
- **helpers** (`helpers.integration.spec.ts`)  
  Tests helper commands: `feed-get`, `feed-ls`, and `manifest-ls` against a live node.  
- **watch** (`watch.integration.spec.ts`)  
  Tests `watch` command detects file changes and publishes updates to the feed manifest.  
- **schedule** (`schedule.integration.spec.ts`)  
  Tests `schedule` command performs an initial sync and repeats at the configured interval.  
- **status** (`status.integration.spec.ts`)  
  Tests the `status` command’s exit codes and output for missing and present config/state.  
- **config** (`config.integration.spec.ts`)  
  Tests `config get` and `config set` end-to-end, including valid updates and error handling for invalid keys or values.  

### Run just integration tests

Integration tests require a running Bee dev node on port 1633. Our script launches and kills a bee-node to enable the bee-api endpoints:

```bash
npx jest tests/integration
```

## Coverage

Generate a coverage report:

```bash
npx jest --coverage
```

Open `coverage/lcov-report/index.html` in your browser to explore coverage details.

---

## Tips

- Use `jest.useFakeTimers()` in tests that rely on timers.
- Spy on imports via module-wide imports, e.g.:
- When mocking ES module functions, prefer `import * as` over named imports so that `spyOn` will work`.

---
