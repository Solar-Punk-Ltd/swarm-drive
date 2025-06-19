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

- **helpers** (`helpers.spec.ts`)  
  - `feedGet`, `feedLs`, `manifestLs`, `listStamps` behaviors
- **schedule** (`schedule.spec.ts`)  
  - `scheduleCmd` invocation & timer behavior
- **watch** (`watch.spec.ts`)  
  - `watchCmd` file–event debounce & error handling
- **init** (`init.spec.ts`)  
  - `initCmd` config/state file creation and error cases
- **sync** (`sync.spec.ts`)  
  - `syncCmd` end-to-end “remote-only” synchronization flows

### Run just unit tests

```bash
npx jest tests/unit
```

---

## Integration Tests

> **TODO:** Add end-to-end or service-level tests here once the Bee node is available  
> (e.g. spinning up a local Swarm node, running `init → sync → watch` in a real directory, etc.)

To run integration tests:

```bash
npx jest tests/integration
```

---

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
