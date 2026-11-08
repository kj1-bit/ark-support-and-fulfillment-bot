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

For this source-only checkpoint, restoring commit `21de487` returns the repository to the state before removal of the Discord shell path. No production service, Discord registration, database, or RCON state is changed merely by merging this source checkpoint.

## Compatibility and migration

Removing `/updatebot` intentionally removes one V1 administrative workflow. All player, ticket, PIN, shop, panel, fulfillment, database, mock-mode, and RCON behaviors remain otherwise unchanged by this checkpoint.

Existing installations must remove `UPDATE_SCRIPT_PATH` from private environment files and rerun `node deploy-commands.js` during a reviewed deployment so Discord's global command registration no longer includes `/updatebot`.

Run `node scripts/deploy-v2-commands.js` for a dry run with `DISCORD_TOKEN` and a valid V2 runtime configuration. Review the printed add/update/remove diff, then apply it with `node scripts/deploy-v2-commands.js --apply`. The application ID comes from validated `discord.clientId`, not a separate environment variable. The script changes only commands it owns and preserves unrelated global commands. Before applying, it re-reads the command list and aborts if the list changed during review; Discord does not provide an atomic compare-and-swap for command edits, so keep deployment changes serialized.

V2 PIN requests can be approved and then delivered with `/pin deliver request-id:<reference>`. Delivery sends the protected PIN only by direct message to the request owner; a failed DM leaves the request approved so staff can retry after resolving the recipient's DM settings.

When `features.dashboards` is enabled, `staff`, `ticketLogs`, `pinsDashboard`, and `fulfillmentLogs` are required. The runtime persists each log-panel message ID in schema version 9, restores or edits the panel after the Discord client becomes ready, and recreates it after a message-delete event. All three panels use the same authorized, paginated response layout.

Schema version 10 redacts legacy fulfillment operation results during migration. The runtime now stores only a bounded operation index and success flag; raw transport output and command details are excluded.

Retention and cleanup are configured with the optional `retention` section and described in `docs/V2_RETENTION.md`. The runtime also reconciles interrupted fulfillment requests (`CLAIMED` to `FAILED`, `EXECUTING` to `UNCERTAIN`) before Discord connects, so a restart after a crash leaves no request stuck mid-flow.

The V2 runtime migration keeps the legacy V1 ticket table intact by renaming it to `tickets_v1_legacy` before creating the V2 `tickets` table; if that archive name is already occupied, migration fails and rolls back without changing ticket data. Keep the pre-migration backup until the updated runtime and historical ticket data have been verified. A rollback to V1 must restore that backup before starting V1 because its handlers expect the original `tickets` table shape.
