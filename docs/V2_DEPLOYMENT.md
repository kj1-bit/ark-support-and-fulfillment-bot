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

V2 PIN requests are approved and then delivered with the staff **Deliver by DM** button on the request's control message in `pinsDashboard`. Delivery sends the protected PIN only by direct message to the request owner; a failed DM leaves the request approved so staff can retry after resolving the recipient's DM settings.

When `features.dashboards` is enabled, `staff`, `ticketLogs`, `pinsDashboard`, and `fulfillmentLogs` are required. The runtime persists each log-panel message ID in schema version 9, restores or edits the panel after the Discord client becomes ready, and recreates it after a message-delete event. All three panels use the same authorized, paginated response layout.

Schema version 10 redacts legacy fulfillment operation results during migration. The runtime now stores only a bounded operation index and success flag; raw transport output and command details are excluded.

Schema version 11 adds database-level state constraints to `fulfillment_requests`, `interaction_sessions`, and `catalog_versions` and removes the unused `trusted_identity_associations` table (a non-empty one is renamed `trusted_identity_associations_archive` instead of dropped). The migration first checks that every existing row has a supported state and aborts, rolling back unchanged, if any does. The migration runner also refuses to start when recorded migration history has gaps or version/name pairs that differ from the release.

Retention and cleanup are configured with the optional `retention` section and described in `docs/V2_RETENTION.md`. The runtime also reconciles interrupted fulfillment requests (`CLAIMED` to `FAILED`, `EXECUTING` to `UNCERTAIN`) before Discord connects, so a restart after a crash leaves no request stuck mid-flow.

The V2 runtime migration keeps the legacy V1 ticket table intact by renaming it to `tickets_v1_legacy` before creating the V2 `tickets` table; if that archive name is already occupied, migration fails and rolls back without changing ticket data. This preserves legacy ticket data but does not make V1 able to use the migrated database. Keep the pre-migration backup until the updated runtime and historical ticket data have been verified. A rollback to V1 must restore that backup before starting V1 because its handlers expect the original `tickets` table shape.

The standalone V2 entrypoint is `node scripts/start-v2.js` or `npm run start:v2`. It reads `TICKETBOT_CONFIG_PATH` (or the default ignored local config), and starts the composed SQLite/Discord/RCON runtime. See the [Debian startup plan](V2_DEBIAN_STARTUP_PLAN.md) for an isolated test service example. The launcher has mock-mode startup coverage; it has not been rehearsed on Debian or against external test endpoints. Do not treat it as production-accepted.
