# Ticketbot V2 operator-controlled deployment

Discord interactions must never start deployment, execute operating-system commands, select scripts, or restart the bot. Deployment is an operator-controlled host action performed outside the Discord process.

## Security boundary

- `/updatebot` is removed from command registration and runtime handling.
- `UPDATE_SCRIPT_PATH` is not supported configuration.
- Application runtime code must not import `child_process` or invoke `exec`, `execFile`, `spawn`, or `fork`.
- Discord users, roles, commands, buttons, modals, and message content cannot initiate deployment.
- Host operators authenticate to the deployment host through an approved administrative channel and follow the private operations runbook.

## Reviewable deployment sequence

The public source repository defines application code, tests, and public documentation. Installation-specific service definitions, non-secret deployment configuration, and the exact host commands belong in the private operations repository. Secrets remain on the host.

Before deploying, the operator should:

1. Record the currently deployed commit and service state.
2. Back up the runtime database and installation-specific configuration.
3. Fetch the reviewed source through the host's approved Git workflow.
4. Verify the intended commit or release.
5. Install dependencies using the reviewed lockfile and approved install scripts.
6. Run the complete automated test suite and configuration validation.
7. Restart through the host service manager.
8. Verify startup, panels, logs, and mock/test behavior before any live privileged operation.
9. Record the deployed commit, test evidence, and rollback point.

This document defines the security boundary, not installation-specific commands. Host-specific commands must be versioned in the private operations repository and reviewed separately.

## Rollback

Rollback is also operator-controlled and must not depend on Discord.

1. Stop or isolate the failed service through the host service manager.
2. Restore the previously recorded known-good application commit or release.
3. Restore configuration or database backups only when the change affected them.
4. Reinstall dependencies if the lockfile changed.
5. Run tests and configuration validation.
6. Start the service and verify expected behavior.
7. Record the rollback result.

Before any V2 test or production deployment, record the exact deployed commit and a verified database/configuration backup as the rollback point. Restore that commit and its matching configuration through the host's approved service workflow. If a database was migrated from V1, restore the pre-migration backup before starting V1; the V2 migration archives the V1 `tickets` table and does not convert it to the V2 schema.

## Compatibility and migration

The root `index.js` and `deploy-commands.js` remain the V1 entrypoints. V2 has a separate validated JSON configuration, composition layer, repositories, and Discord features; merging V2 source does not switch the root application to V2 or change the V1 service. The V2 executable is `scripts/start-v2.js`; it is separate from the root V1 launcher. A test deployment remains unverified until the isolated Debian acceptance checklist passes.

V2 registers no slash commands. `scripts/deploy-v2-commands.js` is now only a one-time cleanup that removes the seven retired V2 commands from an application that still has them; it is a separate operator action. It defaults to a dry run; `--apply` is a real external change and must be reviewed against the intended application. The app ID comes from validated `discord.clientId`; the script preserves unrelated commands and checks for a concurrent command-list change, but cannot provide an atomic compare-and-swap. See the [V2 guide](V2_GUIDE.md#retiring-the-old-slash-commands). Do not run it against a production application during isolated testing.

V2 **Get My Vault PIN** privately delivers the requesting player's generated PIN, while the verified staff-only `pinsDashboard` directory displays player names with codes hidden. Staff **Reveal PINs Privately** returns only an authorized ephemeral response with normal-message spoilers; the standing directory never contains PINs. Custom chosen-PIN requests and approval/delivery controls are retired; stale interactions respond privately without mutations. Startup strips controls from bound bot-owned historical request messages without deleting records or promoting them into Vault PINs. See [PIN runtime](V2_PIN_RUNTIME.md) for retention and permission-change limitations.

When `features.dashboards` is enabled, `staff`, `ticketLogs`, `pinsDashboard`, and `fulfillmentLogs` are required. The runtime persists each panel message ID in schema version 9, restores or edits the panel after the Discord client becomes ready, and recreates it after a message-delete event. Panels use authorized pagination. Ticket logs display opening, claim/release and closure identities; full audit records remain retained. The tickets feature also owns the separate Open Tickets assignment panel in `ticketLogs`, even with dashboards disabled. The obsolete legacy management UI is removed; startup deletes only its verified bound bot-owned message. PINs have a single directory view with generation and private reveal, no activity tab. The mock-only multiple-ticket exception adds forward migration 014 (schema 14); back up before upgrade and use a pre-upgrade backup for rollback to schema-13 binaries. Switching to non-mock retains multiple mock-created rows/channels but blocks new creation/reopening while another private request is active. See [ticket runtime](V2_TICKET_RUNTIME.md#mock-only-multiple-requests).

Schema version 10 redacts legacy fulfillment operation results during migration. The runtime now stores only a bounded operation index and success flag; raw transport output and command details are excluded.

Schema version 11 adds database-level state constraints to `fulfillment_requests`, `interaction_sessions`, and `catalog_versions` and removes the unused `trusted_identity_associations` table (a non-empty one is renamed `trusted_identity_associations_archive` instead of dropped). The migration first checks that every existing row has a supported state and aborts, rolling back unchanged, if any does. The migration runner also refuses to start when recorded migration history has gaps or version/name pairs that differ from the release.

Retention and cleanup are configured with the optional `retention` section and described in `docs/V2_RETENTION.md`. The runtime also reconciles interrupted fulfillment requests (`CLAIMED` to `FAILED`, `EXECUTING` to `UNCERTAIN`) before Discord connects, so a restart after a crash leaves no request stuck mid-flow.

The V2 runtime migration keeps the legacy V1 ticket table intact by renaming it to `tickets_v1_legacy` before creating the V2 `tickets` table; if that archive name is already occupied, migration fails and rolls back without changing ticket data. This preserves legacy ticket data but does not make V1 able to use the migrated database. Keep the pre-migration backup until the updated runtime and historical ticket data have been verified. A rollback to V1 must restore that backup before starting V1 because its handlers expect the original `tickets` table shape.

The standalone V2 entrypoint is `node scripts/start-v2.js` or `npm run start:v2`. It reads `TICKETBOT_CONFIG_PATH` (or the default ignored local config), and starts the composed SQLite/Discord/RCON runtime. See the [Debian startup plan](V2_DEBIAN_STARTUP_PLAN.md) for an isolated test service example. The launcher has mock-mode startup coverage; it has not been rehearsed on Debian or against external test endpoints. Do not treat it as production-accepted.

## Catalog startup and intentional rollback

The launcher automatically activates a shipped catalog version that has never been active before. If the shipped version is already present as a retained catalog, startup keeps the current active catalog and writes a JSON warning to the normal startup log/journal:

```json
{"type":"runtime.catalog.rollback-blocked","level":"warn","activeVersion":"<active-version>","shippedVersion":"<shipped-version>","message":"Startup kept the active catalog because the shipped version was previously active. Set TICKETBOT_ALLOW_CATALOG_VERSION to the shipped version to allow this rollback."}
```

To deliberately restore that retained catalog, read the exact `shippedVersion` from the warning, set `TICKETBOT_ALLOW_CATALOG_VERSION` to that exact value in the service's operator-controlled environment, and restart once. Verify the startup log records `catalog.activated` with the expected version, then remove the override from the service environment and restart or reload its configuration. The override does not enable any other catalog version; if it does not exactly match the shipped version, the rollback remains blocked. No instance configuration schema or database migration is needed.
