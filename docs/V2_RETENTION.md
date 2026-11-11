# V2 retention and cleanup

The V2 runtime enforces retention in SQLite. Cleanup runs once after startup and then every `retention.intervalMinutes` (default 60). Each step is independent; a failing step is reported by name in the `retention.failed` audit event (no error details) and does not block the others. Runs never overlap, and the timer is stopped by `startV2(...).stop()`.

## Policy

All settings are optional integers under a top-level `retention` object. Defaults apply when it is omitted.

| Setting | Default | Effect |
| --- | --- | --- |
| `sessionGraceHours` | 24 | Interaction sessions are deleted this long after they expire (active, consumed, or canceled). |
| `closedTicketDays` | 365 | Archived private channels are deleted before their `CLOSED` records after this many days without update. Failed channel deletion retains the record for retry. Open, claimed, and completed-but-not-closed tickets are never purged. |
| `completedPinDays` | 30 | `DELIVERED`, `CANCELED`, and `EXPIRED` PIN request rows are deleted. |
| `operationalEventDays` | 90 | Dashboard operational events are deleted. |
| `fulfillmentIdentityDays` | 90 | Terminal fulfillment requests have their EOS ID, player reference, and player name replaced with `REDACTED`. |
| `fulfillmentAuditDays` | 365 | Terminal fulfillment requests (and their bounded results) are deleted. Must be at least `fulfillmentIdentityDays`. |
| `intervalMinutes` | 60 | Cleanup cadence. |

Values are validated before any database access; unknown keys or out-of-range values fail startup.

Purging terminal PIN requests also removes their dependent moderation-message bindings through the foreign key's `ON DELETE CASCADE`; active and recent requests are retained. Ticket channel cleanup handles each record independently: a changed topic, wrong guild, missing access, or other deletion failure emits `ticket.channel_failed` with phase `purge` and retains that ticket for retry. Other successfully cleaned channels and eligible record-only tickets are still purged in the same retention run.

## Always-on state hygiene

- `PENDING` and `APPROVED` PIN requests past their expiry are moved to `EXPIRED` and their protected PIN material is cleared. A player's own elapsed requests are also expired before a new request is created, so an expired request can no longer block re-requesting through the one-active-request index. Approving an expired request is rejected.
- Protected PIN material is cleared from any terminal request that still holds it.
- `PENDING` fulfillment requests past expiry become `EXPIRED`.
- On startup, before Discord connects, interrupted fulfillment is reconciled: `CLAIMED` requests (nothing was sent) become `FAILED`, and `EXECUTING` requests become `UNCERTAIN` with their persisted per-operation results preserved for staff review. Uncertain outcomes are never retried automatically.

## Not purged automatically

- Verified player-name and trusted-player identity associations: they are ongoing authorization state, not history. Remove them through an operator-reviewed process.
- `remembered_players`: retains one row per EOS identity indefinitely, updating the last observed name, map and time. Retention does not purge these rows, and staff unlinking does not remove them. Keep this identity history and its backups private.
- Encrypted generated Vault PINs: these are ongoing credentials retained for the user's repeated private DM retrieval, not one-time PIN requests. `completedPinDays` does not delete them. Removing or rotating them requires an operator-reviewed process; never reuse V1 PIN data.
- Private ticket channels while `tickets` is disabled: channel deletion requires the enabled Discord ticket adapter. Tracked records are retained until successful channel cleanup, rather than orphaning Discord channels.
- `tickets_v1_legacy` and other V1 archives, and database backups (retain according to the operator's backup policy). The legacy ticket archive may hold V1 usernames, Discord IDs, and channel IDs indefinitely by design. Keep it through test and rollback validation; after production acceptance, make an explicit decision to retain, export, redact, or securely delete it. It is deliberately excluded from automatic retention.
- Diagnostic logs, which are written to the process output and governed by the host's log rotation.
