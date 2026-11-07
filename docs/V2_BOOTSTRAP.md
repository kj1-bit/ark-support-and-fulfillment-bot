# Ticketbot V2 bootstrap integration

This checkpoint completes the startup-order portion of GitHub issue #2 without modifying the V1 `index.js` entry point.

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

This checkpoint does not change V1 configuration consumption. A later migration will explicitly select the V2 bootstrap and supply private runtime configuration. Until then, the current V1 entry point remains the production path.

## Rollback

Restore the branch to commit `e4fb907` or remove `src/bootstrap/start-application.js`, `tests/bootstrap/start-application.test.js`, and this document, then restore the roadmap and package scripts after reviewing the diff. No Discord, RCON, database, or service rollback is required.
