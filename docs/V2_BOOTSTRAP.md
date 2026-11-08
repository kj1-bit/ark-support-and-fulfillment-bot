# Ticketbot V2 bootstrap integration

> **Historical implementation checkpoint.** This page records the original dependency-injected bootstrap work, not the current V2 executable or a runnable Debian procedure. The current coordinator is `src/composition/start-v2.js`; it is still a function that requires injected adapters, not a command-line entrypoint. See the [V2 guide](V2_GUIDE.md) and [Debian startup plan](V2_DEBIAN_STARTUP_PLAN.md) for current status.

This checkpoint completed the startup-order portion of GitHub issue #2 without modifying the V1 `index.js` entry point.

## Guaranteed order

1. Load and validate configuration.
2. Produce a redacted summary.
3. In test or production mode, create the RCON adapter.
4. Create the Discord adapter.
5. Start the Discord adapter.

If configuration loading or validation fails, neither adapter is constructed. Mock mode never constructs an RCON adapter.

## Dependency injection

The bootstrap accepts adapter factories so startup ordering can be tested without Discord, RCON, SQLite, or network access. Each factory receives the same deeply frozen validated configuration object.

## Security review

- No adapter is constructed before configuration validation succeeds.
- Mock mode cannot construct RCON through this bootstrap.
- Safe summary output occurs before external initialization and contains presence booleans rather than secret values.
- The bootstrap does not read feature-specific environment variables.
- V1 production startup remains unchanged because `index.js` does not import this module.

## Compatibility and private configuration

At the time this checkpoint was written, V1 was the production path. The current root `index.js` remains the V1 entrypoint. `src/bootstrap/start-application.js` is the V1 bootstrap and is not the V2 coordinator.

## Rollback

The commit-specific rollback instructions above are historical and are not a current deployment procedure. Use the reviewed [V2 rollback plan](V2_ROLLBACK.md) for current source and data recovery guidance.
