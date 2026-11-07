# V2 persistence and recovery

V2 uses ordered migrations recorded in `schema_versions`. Each migration runs under `BEGIN IMMEDIATE` and rolls back on failure. Unknown applied versions fail closed.

Fulfillment requests use a unique idempotency key and an atomic conditional update from `PENDING` to `CLAIMED`, preventing a second worker from claiming the same request.

Database backups are copied outside the active database path and recorded with SHA-256 and byte length. Restoration verifies the checksum before atomically replacing the target. Operators must run SQLite integrity checks before migration, after migration, and after restoration.

This checkpoint adds source and isolated tests only. It does not open or modify the production database.
