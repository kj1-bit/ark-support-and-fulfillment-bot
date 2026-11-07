# V2 combined hardening and compatibility verification

This checkpoint combines lifecycle, migration, recovery, failure-isolation, concurrency, V1 compatibility, public-repository boundary, and release-readiness verification.

## Automated evidence

- Independent repeated startup and shutdown
- Cleanup after configuration, composition, and Discord startup failures
- Ordered upgrades from schema levels 0 through 5 to schema 6
- Schema 6 idempotency and rejection of unknown future schemas
- Transaction rollback on migration failure
- Corruption rejection and checksum-verified backup restoration
- Active-database preservation after checksum mismatch
- Operational-event concurrency and sensitive-data sanitization
- V1 entrypoint comparison against `main`
- No tracked `.env`, runtime SQLite, WAL, SHM, or backup files
- No database or raw transport exposure through Discord composition
- No operating-system process execution API in application source

## Release gates

This checkpoint does not deploy, migrate production, merge to `main`, or replace V1. After all focused and unified tests pass, commit the evidence on `integration/v2-complete-runtime`, open the integration pull request, request review, resolve findings, and only then perform staged deployment and rollback rehearsal.
