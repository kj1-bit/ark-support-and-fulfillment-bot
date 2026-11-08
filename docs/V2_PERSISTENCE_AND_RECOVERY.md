# V2 persistence and recovery

V2 uses ordered migrations recorded in `schema_versions`. Each migration runs under `BEGIN IMMEDIATE` and rolls back on failure. Unknown applied versions fail closed.

Fulfillment requests use a unique idempotency key and an atomic conditional update from `PENDING` to `CLAIMED`, preventing a second worker from claiming the same request.

Database backups are copied outside the active database path and recorded with SHA-256 and byte length. Restoration verifies the checksum before atomically replacing the target. Operators must run SQLite integrity checks before migration, after migration, and after restoration.

This checkpoint adds source and isolated tests only. It does not open or modify the production database.

Migration 004 detects the V1 `tickets` columns and renames the original table to `tickets_v1_legacy` before creating the V2 ticket schema. The legacy rows are deliberately retained without an automatic conversion because V1 does not contain the guild, player-name, or description fields required by V2. A pre-existing `tickets_v1_legacy` table causes a fail-closed migration error rather than overwriting either table.
