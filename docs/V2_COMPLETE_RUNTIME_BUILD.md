# Accelerated V2 complete-runtime build

This integration branch uses `v2-pre-full-integration` (`a005b8c`) as its rollback point. The build is organized as logical commits but will be reviewed in one pull request.

This package establishes typed identifiers, trusted server and creature registries, a versioned catalog with checksums and change reports, an allowlisted ARK operation service, explicit fulfillment states, atomic in-memory claim semantics for tests, redacted audit events, and an application fulfillment coordinator that rechecks authorization before privileged execution.

The current adapter is deliberately dependency-injected and does not contact Discord, SQLite, RCON, or production services. Persistent SQLite migrations and Discord adapter integration remain required before deployment.
