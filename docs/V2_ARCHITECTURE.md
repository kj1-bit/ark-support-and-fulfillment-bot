# Ticketbot V2 architecture

This document defines the target architecture for Ticketbot V2. It maps the security requirements in `docs/V2_THREAT_MODEL.md` to explicit modules, interfaces, dependency rules, data boundaries, and release controls.

The architecture is intentionally documentation-first. Creating this document does not change production behavior.

## Architectural goals

Ticketbot V2 must:

- Preserve documented V1 workflows while replacing unsafe implementation paths.
- Fail closed when configuration, authorization, validation, or state is uncertain.
- Prevent Discord handlers from executing shell commands or constructing raw RCON commands.
- Restrict privileged behavior to named, typed, allowlisted application operations.
- Centralize configuration validation, authorization, input validation, auditing, and redaction.
- Make fulfillment requests persistent, single-use, expiring, and idempotent before RCON execution.
- Use explicit schema migrations and tested backup and rollback procedures.
- Separate public source code from private deployment configuration, secrets, and runtime data.
- Keep features independently testable and replaceable.
- Support staged deployment with clear health checks and rollback points.

## Architectural principles

### Fail closed

Missing, malformed, contradictory, or unknown security-sensitive configuration must stop startup or disable the affected feature safely. Invalid configuration must never silently select live mode.

### Lowest practical privilege

The bot process, Discord application, database files, deployment workflow, and RCON network access must receive only the permissions required for their defined responsibilities.

### Trusted server-side state

Discord component values are routing hints, not authoritative state. Sensitive workflow state must be stored and validated on the server.

### Typed application operations

Feature modules request named operations with structured inputs. They do not pass arbitrary shell commands, SQL fragments, or RCON strings.

### Dependency inversion at privileged boundaries

Business logic depends on narrow interfaces for Discord, persistence, time, identity, audit, and ARK operations. Infrastructure implementations depend on those contracts, not the reverse.

### Explicit state transitions

Long-running or privileged workflows use defined states and atomic transitions. Success, failure, partial success, expiration, cancellation, and uncertain outcomes are separate states.

### Audit by design

Every privileged operation receives a correlation ID and produces structured, redacted audit events from authorization through completion.

### Compatibility through contracts

V1 behavior is preserved through documented feature contracts and acceptance tests rather than by retaining unsafe internal coupling.

## System context

Ticketbot sits between several external systems and trust zones:

1. Discord users and Discord APIs
2. The Ticketbot application process
3. SQLite persistence
4. ARK servers reached through RCON
5. Private deployment and secret configuration
6. The public source repository and CI system
7. Operators performing deployment, backup, recovery, and rollback

No external input is trusted solely because it originated from Discord, an environment variable, an RCON response, a database record, or a repository file.

## Repository and deployment boundaries

### Public source repository

The public `ark-support-and-fulfillment-bot` repository is the canonical source-code repository.

It may contain:

- Application source code
- Public-safe schemas and examples
- Feature manifests and contracts
- Database migration source files
- Automated tests
- CI definitions
- Public setup, security, and architecture documentation

It must not contain:

- Discord tokens
- RCON passwords
- Production databases or backups
- Runtime logs
- Installation-specific secrets
- Private host credentials
- Unapproved private Discord or infrastructure identifiers

### Private operations repository

A separate private operations repository may contain:

- Deployment definitions
- Installation-specific non-secret configuration
- Service-manager definitions
- Backup and restore runbooks
- Environment templates without secret values
- Host-specific operational documentation

### Production host

The production host contains:

- Runtime secrets provided outside Git
- The deployed release artifact
- Runtime database files
- Restricted logs
- Backups and migration checkpoints
- Service-manager state

Production runtime data must not be copied into the public repository.

## Target logical layers

Dependencies flow downward through contracts. Lower layers must not import Discord feature handlers.

### Layer 1: Entry points and adapters

Responsibilities:

- Receive Discord interactions
- Register slash commands
- Translate Discord events into internal requests
- Render user-safe Discord responses
- Start the application after validated bootstrap

Permitted dependencies:

- Application services
- Authorization service
- Validation contracts
- Presentation helpers

Prohibited behavior:

- Direct SQL
- Direct RCON
- Shell execution
- Reading arbitrary environment variables
- Building privileged commands
- Deciding authorization rules locally

### Layer 2: Application services

Responsibilities:

- Coordinate use cases
- Enforce workflow ordering
- Request authorization
- Load and transition persistent state
- Call named domain operations
- Produce audit events
- Return presentation-neutral results

Examples:

- Open support ticket
- Complete support ticket
- Set in-game name
- Generate or reset PIN
- Search shop catalog
- Start fulfillment request
- Confirm fulfillment request
- Query audit dashboard

Application services do not know how Discord components are rendered or how RCON sockets work.

### Layer 3: Domain services and policies

Responsibilities:

- Define business rules
- Validate domain identifiers
- Resolve trusted catalog entries
- Define authorization policies
- Define state machines
- Build typed operation plans
- Mask sensitive identifiers

Examples:

- Creature eligibility policy
- Fulfillment state machine
- Ticket lifecycle policy
- Player identity validation
- Server eligibility policy
- Audit redaction policy

Domain services must be deterministic where practical and must not access the network directly.

### Layer 4: Infrastructure adapters

Responsibilities:

- SQLite repositories and migrations
- Discord API client implementation
- RCON transport implementation
- Structured logging sink
- Clock and identifier providers
- Filesystem-backed backup integration

Infrastructure adapters implement narrow contracts defined above them.

### Layer 5: External systems

- Discord API
- ARK RCON endpoints
- Filesystem
- SQLite engine
- Service manager
- CI and release systems

External failures must be translated into stable internal error categories before reaching feature code.

## Proposed source layout

The exact names may change during implementation, but responsibilities and dependency direction must remain stable.

```text
src/
  bootstrap/
    start-application.js
    validate-environment.js
  config/
    schema.js
    load-config.js
    safe-summary.js
  contracts/
    errors.js
    identifiers.js
    operation-results.js
  auth/
    authorization-service.js
    policies.js
  validation/
    discord-identifiers.js
    player-identifiers.js
    server-identifiers.js
  domain/
    tickets/
    pins/
    players/
    shop/
    creatures/
    fulfillment/
  application/
    ticket-service.js
    pin-service.js
    player-service.js
    shop-service.js
    fulfillment-service.js
  adapters/
    discord/
    sqlite/
    rcon/
    logging/
  features/
    tickets/
    pins/
    player-names/
    shop/
    dino-fulfillment/
  migrations/
  manifests/
  index.js
scripts/
  validate-config.js
  migrate-database.js
  backup-database.js
  restore-database.js
  verify-release.js
tests/
  unit/
  integration/
  security/
  compatibility/
```

V2 migration may introduce this structure incrementally. New code must not deepen coupling to the V1 monolithic entry point.

## Bootstrap and startup sequence

Startup must occur in this order:

1. Load only the approved configuration sources.
2. Parse configuration into typed values.
3. Validate all required values and cross-field rules.
4. Determine deployment mode from an explicit enumerated value.
5. Produce a redacted configuration summary.
6. Open the database with restrictive runtime expectations.
7. Verify database integrity and schema compatibility.
8. Apply approved migrations only through the migration service.
9. Validate trusted registries and feature manifests.
10. Construct infrastructure adapters.
11. Construct domain and application services.
12. Register Discord handlers.
13. Connect to Discord.
14. Restore persistent panels and dashboards.
15. Mark the application ready.

The application must not connect to Discord or RCON before configuration and database validation succeed.

## Configuration architecture

### Approved configuration sources

V2 recognizes three classes of configuration:

- Public code defaults that are safe to publish
- Installation-specific non-secret configuration
- Runtime secrets supplied outside Git

### Typed configuration object

Feature modules receive a frozen, validated configuration object. They must not read `process.env` directly.

Suggested top-level sections:

```text
runtime
  environment
  mode
  logLevel

discord
  token
  clientId
  guildId
  roles
  channels

ark
  servers
  timeouts
  operationPolicy

storage
  databasePath
  backupPath
  retention

features
  tickets
  pins
  shop
  fulfillment
```

### Deployment mode

Use an explicit enumeration such as:

- `mock`
- `test`
- `production`

Unknown, missing, or contradictory values fail startup.

A boolean such as `ARK_RCON_MOCK` must not remain the sole production-safety switch.

### Validation rules

Configuration validation must include:

- Discord snowflake syntax
- Required role and channel references
- Unique server IDs
- Valid host and port values
- Named secret references
- Required production secrets
- Prohibition of example server definitions in production
- Test-only server restrictions
- Writable and non-repository runtime paths
- Feature dependency checks
- Duplicate or conflicting identifiers

### Safe configuration summary

Startup logs may show:

- Deployment mode
- Enabled feature names
- Server IDs and display names when approved
- Whether required secrets are present
- Database schema version
- Release version

Startup logs must not show secret values, PINs, full EOS IDs, or complete sensitive connection strings.

## Authorization architecture

### Central authorization service

All privileged use cases call a central authorization service immediately before the privileged action.

A policy request includes:

- Actor ID
- Guild ID
- Channel ID
- Current role IDs
- Operation name
- Resource or target context
- Correlation ID

A decision contains:

- Allowed or denied
- Policy identifier
- Safe reason code
- Audit metadata

### Policy examples

- `ticket.complete`
- `ticket.close`
- `pin.viewAll`
- `pin.reset`
- `shop.refresh`
- `fulfillment.start`
- `fulfillment.confirm`
- `audit.view`

### Authorization requirements

- Missing policy configuration fails closed.
- Guild and channel scope are checked where required.
- Direct messages are rejected for guild-only operations.
- Authorization is rechecked at confirmation time.
- Feature code cannot substitute its own ad hoc role check.
- Denials produce a safe audit event.

## Discord interaction architecture

### Interaction routing

The Discord adapter performs only:

- Interaction-type recognition
- Stable route selection
- Basic protocol validation
- Translation into an internal request
- Rendering of the internal result

### Component identifiers

Discord custom IDs must contain only:

- A version
- A feature route
- An opaque server-side token

They must not contain authoritative EOS IDs, raw server addresses, privileged commands, secret values, or complete workflow state.

### Interaction sessions

Persistent session records include:

- Session token
- Feature
- Actor ID
- Guild ID
- Channel ID
- Message ID when available
- Current state
- Created time
- Expiration time
- Version
- Safe workflow references

Session rules:

- Tokens are unpredictable.
- Sessions are scoped to one actor and context.
- Each transition validates the current state.
- Terminal states cannot transition again.
- Expired sessions are rejected.
- Cancellation invalidates the token.
- Concurrent workflows do not overwrite each other.

## Fulfillment architecture

Fulfillment is the highest-risk application workflow and must use persistent request state before any RCON command executes.

### Fulfillment request record

A fulfillment request should contain:

- Request ID
- Idempotency key
- Actor ID
- Guild, channel, and message context
- Creature catalog ID and catalog version
- Server registry ID
- Player reference and protected EOS ID
- Intended operation list
- Current state
- Attempt and result records
- Created, expiration, claim, and completion times
- Correlation ID

### Fulfillment states

Required states:

- `PENDING`
- `CLAIMED`
- `EXECUTING`
- `SUCCEEDED`
- `PARTIAL`
- `FAILED`
- `UNCERTAIN`
- `CANCELED`
- `EXPIRED`

State transitions must be explicit and validated.

### Confirmation and idempotency flow

1. The moderator selects a trusted creature and an online player.
2. The application revalidates authorization and trusted references.
3. A persistent `PENDING` request is created before confirmation.
4. Discord receives an opaque confirmation token.
5. Confirmation reloads the request and validates actor and context.
6. The database atomically changes `PENDING` to `CLAIMED`.
7. Any second claim fails without sending RCON.
8. The application rechecks authorization and player availability.
9. The application creates typed allowlisted ARK operations.
10. The request changes to `EXECUTING`.
11. The ARK operation service performs each operation once.
12. Results are recorded after each operation.
13. The request reaches a terminal or `UNCERTAIN` state.
14. Discord components are disabled or replaced.
15. A redacted audit result is published.

### Partial pair delivery

A pair delivery consists of separately recorded operations. If one succeeds and one fails, the request becomes `PARTIAL` or `UNCERTAIN`; it must not automatically repeat the successful operation.

Operator review decides any compensation or retry.

## ARK and RCON architecture

### Named operation interface

Feature and application modules may request only named operations, for example:

```text
listOnlinePlayers(serverId)
fulfillApprovedCreature(requestId, creatureId, playerRef)
```

They must not call:

```text
sendRawCommand(server, command)
```

### Internal transport

The raw RCON transport is private to the RCON adapter. It accepts a fully validated internal operation plan, not strings from feature modules.

### Operation builders

Each supported operation has:

- A typed input contract
- A trusted registry lookup
- Validation rules
- A deterministic command builder
- Redaction rules
- Expected response handling
- Timeout behavior
- Retry policy
- Compatibility tests

### AAT compatibility contract

The confirmed AAT cryopod behavior must remain represented by tests for:

- Blueprint path
- Level 450
- Tamed state
- Imprint command value `1.0`
- Displayed imprint percentage `100%`
- Saddle applicability
- Saddle quality `10.0`
- Gender handling
- Cryopod delivery
- EOS ID target

The command builder remains internal to the allowlisted operation.

### RCON retry policy

Non-idempotent fulfillment operations are not retried automatically after timeout or uncertain transport failure.

Read-only operations such as listing online players may use bounded retries if documented and tested.

## Trusted registry architecture

### Server registry

Each server record contains:

- Unique server ID
- Approved display name
- Host reference
- Port
- Secret reference
- Environment classification
- Enabled state
- Test-only state
- Supported operation set

Production startup rejects duplicate IDs, example definitions, invalid ports, missing secret references, and prohibited test-only combinations.

### Creature registry

Each creature record contains:

- Unique creature ID
- Display name and aliases
- Validated blueprint
- Tameable and enabled state
- Gender behavior
- Delivery mode
- Saddle applicability
- DLC requirement and display warning
- Catalog version metadata

Catalog validation runs before the fulfillment feature becomes available.

### Player registry

The trusted player registry separates:

- Discord identity
- In-game display name
- ARK/EOS identity
- Verification status
- Last observed server context
- Retention metadata

Full EOS IDs remain protected and are masked in ordinary Discord and diagnostic output.

## Persistence architecture

### Repository interfaces

Application services use repositories rather than SQL directly.

Examples:

- Ticket repository
- Player repository
- PIN repository
- Panel repository
- Fulfillment request repository
- Audit repository
- Migration repository

### SQL rules

- Values use parameters.
- Dynamic identifiers are avoided or selected from internal allowlists.
- Transactions protect multi-step state changes.
- Privileged state claims use conditional atomic updates.
- Repository methods return typed domain records.
- Feature handlers do not contain SQL.

### Schema migrations

Each migration includes:

- Ordered version
- Description
- Upgrade operation
- Compatibility notes
- Backup requirement
- Verification query
- Rollback or restore instruction

Startup does not improvise schema changes. Unsupported versions fail closed.

### Backup and recovery

Before migration:

1. Stop or quiesce writers.
2. Verify database integrity.
3. Create a timestamped backup outside the repository.
4. Record checksum and schema version.
5. Test opening the copy.
6. Apply the migration.
7. Verify integrity and expected schema.
8. Record evidence.

Release acceptance includes restoration from a copied backup.

## Sensitive-data architecture

### Data classification

Classify data as:

- Secret
- Sensitive identity
- Operationally restricted
- Public-safe

### Redaction

Central redaction covers:

- Discord tokens
- RCON passwords
- PINs
- Full EOS IDs
- Secret environment values
- Sensitive paths when not required
- Command output that may contain secrets

### Retention

Retention rules must be defined for:

- Closed ticket records
- Fulfillment audit records
- Full EOS IDs
- PIN history
- Diagnostic logs
- Backups
- Expired sessions

Deletion and retention behavior must be testable.

## Logging and audit architecture

### Diagnostic logs

Diagnostic logs support operation and troubleshooting. They use structured severity levels and redaction.

### Security audit events

Security audit records include:

- Event ID
- Correlation ID
- Request ID when applicable
- Actor ID
- Policy and operation
- Resource references
- Masked target identity
- Result state
- Safe reason code
- Timestamp
- Release version

### Discord dashboards

Discord dashboards are views of persisted records, not the authoritative audit store.

Deleting a dashboard message or restarting the bot must not delete underlying records. The application recreates required dashboards from persistence.

## Error architecture

### Internal error categories

Use stable categories such as:

- Configuration error
- Authorization denied
- Validation error
- Conflict or already claimed
- Expired request
- External service unavailable
- RCON uncertain outcome
- Persistence error
- Migration error
- Internal error

### User-facing errors

Discord receives:

- A concise safe message
- A correlation or request ID
- No raw stack trace
- No token, password, PIN, full EOS ID, raw command, or unrestricted external output

Detailed diagnostics remain in restricted redacted logs.

## Feature manifest architecture

Each feature declares a manifest containing:

- Feature name and version
- Required configuration keys
- Required permissions
- Required repositories
- Required external operations
- Slash commands and interaction routes
- Database migrations
- Health checks
- Compatibility tests
- Feature dependencies
- Default enabled state

Startup validates manifests before registering feature handlers.

## V1 compatibility contracts

### Persistent panels

- Required panels are restored after restart.
- Deleted dashboard messages can be recreated.
- Database state remains authoritative.

### In-game-name records

- A Discord user can create or update the supported in-game name record.
- Authorization and validation remain explicit.

### Vault PIN management

- Existing supported generation, lookup, reset, and administrative workflows remain covered by compatibility tests.
- PINs are classified as sensitive and excluded from ordinary logs.

### Shop catalog

- Catalog import, search, refresh, and presentation behavior receive dedicated service and repository contracts.

### Support tickets

- Ticket opening, completion, closure, numbering, retention, and audit behavior remain covered by tests.

### Dino fulfillment

- Catalog browsing and search remain available.
- DLC warnings remain visible.
- Online scanning communicates that it may take a few seconds.
- Confirmation precedes operation.
- AAT cryopod behavior remains compatible.
- Moderator, creature, player, map, result, request ID, and timestamp remain auditable.
- Full EOS IDs remain masked in Discord logs.

### Mock and live operation

- Mock mode performs no RCON network activity.
- Test and production modes are explicit and separate.
- Live mode requires complete validated configuration.

## Deployment architecture

### Build

A release is built from a reviewed commit using the committed lockfile and approved install scripts.

### Release artifact

The artifact contains:

- Application source or compiled output
- Lockfile
- Migration files
- Public-safe manifest data
- Release metadata
- Checksums

It does not contain secrets, databases, logs, or private deployment configuration.

### Deployment workflow

Deployment occurs through an operator-controlled process outside Discord:

1. Verify branch and commit.
2. Run CI and security checks.
3. Produce or retrieve the release artifact.
4. Back up runtime data.
5. Stage configuration validation.
6. Stop or isolate the old process.
7. Apply migrations under the migration procedure.
8. Start the new release.
9. Verify health and mock/test checks.
10. Perform approved live smoke tests.
11. Record evidence and rollback point.

### Rollback

Rollback restores:

- Previous release artifact
- Compatible configuration
- Pre-migration database backup when required
- Previous service definition when changed

Rollback must not depend on `/updatebot` or any Discord-triggered shell path.

## Health and readiness architecture

The application distinguishes:

- Process alive
- Configuration valid
- Database ready
- Discord connected
- Panels restored
- RCON read-only checks available when enabled
- Fulfillment operation allowed

A process may be alive without being ready for privileged operations.

## Testing architecture

### Unit tests

Cover deterministic domain rules, validation, state transitions, redaction, command builders, and policy decisions.

### Integration tests

Cover repository transactions, migrations, Discord adapter translation, and RCON adapter behavior using controlled substitutes.

### Security tests

Cover:

- Authorization denial
- Missing configuration
- Cross-guild and cross-channel interactions
- Session replay
- Concurrent request claims
- RCON injection attempts
- Secret redaction
- Mock/live separation
- Unsupported operation rejection

### Compatibility tests

Capture documented V1 workflows and confirmed AAT behavior.

### Recovery tests

Cover backup integrity, migration failure, database restoration, process restart, dashboard recreation, and release rollback.

## CI and release gates

Required gates include:

- Clean dependency installation
- Install-script approval review
- Syntax and static checks
- Unit tests
- Integration tests
- Security tests
- Compatibility tests
- Migration validation
- Secret scanning
- Dependency review
- Documentation checks
- Release artifact verification

A release cannot proceed when a required gate fails.

## Dependency rules

The following rules are mandatory:

1. Discord feature handlers depend on application services only.
2. Application services depend on domain policies and repository or operation contracts.
3. Domain code does not import Discord, SQLite, RCON, filesystem, or process-environment modules.
4. Infrastructure adapters implement contracts and do not define business authorization.
5. Only bootstrap code reads raw environment variables.
6. Only migration tooling changes schema.
7. Only the internal RCON adapter reaches the raw RCON library.
8. No application module imports `child_process`.
9. No feature handler contains SQL.
10. Logs and errors pass through shared redaction.

CI should enforce these rules where practical.

## Threat-to-architecture mapping

### T01: Discord-triggered operating-system execution

Assigned controls:

- Remove `/updatebot`.
- Prohibit `child_process` in application modules.
- Use external operator-controlled deployment.

### T02: General-purpose RCON execution

Assigned controls:

- Private raw transport.
- Named ARK operation interface.
- Typed builders and trusted registries.

### T03: Duplicate or replayed fulfillment

Assigned controls:

- Persistent request before confirmation.
- Atomic claim before RCON.
- Single-use session token and explicit state machine.

### T04: Authorization bypass

Assigned controls:

- Central policy service.
- Startup validation.
- Confirmation-time reauthorization.

### T05: Session confusion

Assigned controls:

- Opaque scoped tokens.
- Persistent context binding.
- Expiration and one-way state transitions.

### T06: Unsafe live/mock selection

Assigned controls:

- Explicit deployment-mode enumeration.
- Fail-closed startup.
- Mode-specific configuration checks.

### T07: Configuration ambiguity

Assigned controls:

- Central typed loader.
- Cross-field validation.
- Frozen configuration object.

### T08: Sensitive SQLite exposure

Assigned controls:

- Repository boundary.
- Data minimization and masking.
- Filesystem restrictions and retention.

### T09: Unsafe schema changes

Assigned controls:

- Versioned migrations.
- Backup, integrity, and restoration workflow.

### T10: Disclosure through errors

Assigned controls:

- Stable internal errors.
- Central redaction.
- Safe Discord responses.

### T11: Dependency compromise

Assigned controls:

- Lockfile and pinned approval review.
- CI dependency and install-script gates.
- Isolated builds.

### T12: Catalog manipulation

Assigned controls:

- Versioned trusted registry.
- Startup validation.
- Pull-request review and compatibility tests.

### T13: RCON uncertainty

Assigned controls:

- No automatic retry for non-idempotent operations.
- `UNCERTAIN` state.
- Network restriction and operator review.

### T14: Audit gaps

Assigned controls:

- Correlated structured audit events.
- Persisted authoritative records.
- Rebuildable Discord dashboards.

## Migration strategy from V1

V2 should be introduced in bounded stages:

1. Add contracts and tests around existing behavior.
2. Introduce centralized configuration without changing feature behavior.
3. Introduce shared authorization and validation.
4. Encapsulate database access behind repositories.
5. Introduce migrations and backup verification.
6. Replace raw RCON access with named operations.
7. Introduce persistent idempotent fulfillment requests.
8. Remove `/updatebot` and shell execution.
9. Move Discord features out of the monolithic entry point.
10. Add manifests, CI gates, staged rollout, and rollback exercises.

Each stage requires a separate rollback point and compatibility evidence.

## Architecture acceptance criteria

The architecture is implemented only when:

- Raw environment access is limited to bootstrap configuration code.
- Discord handlers contain no shell, SQL, or raw RCON behavior.
- `/updatebot` and Discord-triggered shell execution are removed.
- Raw RCON transport is private to its adapter.
- Fulfillment is claimed persistently before RCON execution.
- Authorization is centralized and rechecked for privileged confirmation.
- Sessions are scoped, expiring, and single-use.
- Database schema changes use versioned migrations.
- Sensitive output uses shared redaction.
- Audit records survive dashboard deletion and restart.
- Mock, test, and production modes are explicit and validated.
- Compatibility, security, recovery, and rollback tests pass.

## Architecture decisions requiring later confirmation

The following implementation details remain deliberately open until their dedicated tasks:

- Exact module and directory names
- Configuration validation library or custom implementation
- Migration framework or custom migration runner
- Audit storage schema and optional off-host sink
- Secret-management mechanism on each deployment host
- Release artifact format
- Process manager and deployment automation details

Any selection must preserve the boundaries and security properties in this document.

## Current checkpoint

- Date: 2026-11-05
- Branch: `rebuild/v2-foundation`
- Starting commit: `bc43c6c`
- Milestone: V2 foundation and documentation
- Scope: Architecture documentation only
- Production behavior changed: No
- Threat-model coverage: T01 through T14 mapped to architecture controls
- Next exact step: Copy this file to `docs/V2_ARCHITECTURE.md`, validate it with the updated roadmap, then commit and push both documentation files.
- Rollback point: `bc43c6c`
