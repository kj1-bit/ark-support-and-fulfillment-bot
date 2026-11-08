# Ticketbot V2 repository boundary and configuration inventory

This document defines the source, deployment, secret, runtime, and generated-data boundaries for Ticketbot V2. It records the current V1/public-repository state and the required V2 destination state without exposing secret values or private infrastructure details.

> **Historical inventory and design boundary.** The branch, starting commit, V1 inventory, and “future V2” ownership stages below describe the snapshot when this inventory was written. They are not a current startup recipe. For actual V2 paths and status use the [V2 guide](V2_GUIDE.md); for Debian staging use the [Debian startup plan](V2_DEBIAN_STARTUP_PLAN.md). The root `index.js` remains V1; the V2 executable is `scripts/start-v2.js`.

## Status and scope

- Repository: `kj1-bit/ark-support-and-fulfillment-bot`
- Branch examined: `rebuild/v2-foundation`
- Starting checkpoint: `0d7debc` (`Record verified V1 baseline and backups`)
- Scope: documentation and inventory only
- Production behavior changed: no
- Private V1 baseline: preserved and independently verified

This inventory covers:

- The canonical public application-source repository
- The future private operations repository
- Host-only secrets and runtime data
- Public-safe examples and schemas
- Tracked source and catalog data
- Generated and review-only catalog artifacts
- Current configuration names and their intended V2 ownership
- Runtime and deployment requirements
- Migration rules and acceptance criteria

## Boundary principles

1. There is one canonical application codebase: the public source repository.
2. The private operations repository must not contain a second copy of application source.
3. Secrets and sensitive runtime data remain outside Git.
4. Public examples contain no production identifiers, addresses, credentials, databases, logs, or personal data.
5. Feature modules receive frozen validated configuration and do not read `process.env` directly.
6. Only the RCON adapter resolves RCON password secret references.
7. Catalog and configuration files are untrusted until fully validated.
8. A disabled feature registers no handlers, panels, timers, jobs, migrations, or network activity beyond explicitly shared required infrastructure.
9. Deployment occurs outside Discord and does not use a Discord-triggered shell path.
10. Every migration of ownership between boundaries must be documented, tested, and reversible.

## Canonical public source repository

The public `ark-support-and-fulfillment-bot` repository owns all reusable application behavior.

### Public application source

The repository may track:

- Application entry points and bootstrap code
- Domain and application services
- Discord adapters and feature handlers
- SQLite repository and migration source files
- Private raw-RCON adapter implementation
- Typed allowlisted ARK operation builders
- Authorization, validation, logging, redaction, and error contracts
- Feature manifests and feature lifecycle definitions
- Catalog validators, importers, diff tools, activation logic, and rollback logic
- Automated tests and controlled test fixtures
- CI and release definitions

### Public documentation

The repository may track:

- Setup and feature documentation
- V2 roadmap, threat model, architecture, and boundary documents
- Public security guidance
- Migration and compatibility guides
- Catalog update and rollback instructions
- Release and rollback checklists
- Contributor and extension documentation

### Public-safe configuration assets

The repository may track:

- JSON schemas or equivalent typed schemas
- Example instance configuration
- Example server configuration
- Example feature-flag configuration
- `.env.example` containing names and blank/example-safe values only
- Public-safe defaults that do not identify a private installation

Recommended V2 paths:

```text
config/
  examples/
    instance.example.json
    servers.example.json
    features.example.json
  schemas/
    instance.schema.json
    servers.schema.json
    features.schema.json
```

### Public catalog assets

The repository may track:

- The canonical public-safe creature catalog
- Public-safe shop-catalog examples
- Catalog schemas
- Catalog version metadata
- Catalog test fixtures
- Review tools and change-report generators

A public catalog record may contain official or otherwise approved public-safe creature metadata, but it must not contain production player data, credentials, private server addresses, or private Discord identifiers.

## Private operations repository

The private operations repository owns deployment composition and installation-specific non-secret configuration.

It may contain:

- PM2, systemd, container, or equivalent service definitions
- Deployment scripts that consume a public release artifact or exact public commit
- Installation-specific Discord role, channel, category, and guild IDs
- Installation-specific ARK server IDs, display names, secret-reference names, enabled state, and test-only state
- Installation-specific feature flags
- Backup schedules and retention policy definitions
- Recovery and rollback runbooks
- Topology documentation that is inappropriate for the public repository
- A pinned public release tag, commit, or artifact checksum

It must not contain:

- A second copy of Ticketbot application source
- Discord tokens
- RCON passwords
- Production SQLite databases
- Runtime logs
- Full EOS IDs or player records
- Unencrypted backups
- Extracted private baseline archives
- Credentials for deployment, Git, SSH, or service accounts

## Production and test hosts

The host owns all runtime-only state.

### Host-only secrets

- Discord bot token
- RCON passwords
- Deployment credentials
- SSH or service-account credentials
- Future interaction-signing or encryption keys
- Any secret-provider credentials

Secrets must be supplied through `.env`, host permissions, or an approved secret provider. Secret values must never be copied into Git, Discord, documentation, test fixtures, or ordinary logs.

### Host-only runtime data

- SQLite databases, journals, and transient database files
- Runtime logs
- PM2 or service-manager state
- Backups and migration checkpoints
- Persistent interaction sessions
- Fulfillment requests and operation results
- Ticket, PIN, player, panel, and audit records
- Full EOS IDs and identity links
- Temporary files used during atomic activation or restoration

### Host-only local configuration

Ignored validated local configuration may include:

- Runtime instance settings
- Server topology
- Feature flags
- Private Discord IDs
- Runtime storage paths
- Backup destinations

Recommended V2 paths:

```text
config/runtime/instance.local.json
config/runtime/servers.local.json
config/runtime/features.local.json
```

These files must be ignored by Git and validated against tracked public schemas before Discord login.

## Current tracked-file inventory

### Repository root

Current tracked root files include:

- `.env.example`: public-safe configuration-name example
- `.gitignore`: exclusion policy
- `LICENSE`: repository license
- `README.md`: public project overview
- `deploy-commands.js`: current Discord command-registration entry point
- `index.js`: current V1 monolithic application entry point
- `package.json` and `package-lock.json`: dependency and install-script policy

### `config/`

- `config/ark-servers.js`: current public example server list; reads host and ports from `process.env` and uses named password environment variables

V2 disposition:

- Replace executable JavaScript configuration with validated data.
- Keep public examples and schemas tracked.
- Store installation-specific values in ignored runtime configuration or the private operations repository.
- Limit raw environment access to bootstrap.

### `data/`

- `data/dino-catalog.json`: current canonical creature data used by fulfillment browsing and lookup
- `data/official-asa-enriched-candidates.json`: candidate/enrichment artifact
- `data/official-asa-reviewed-candidates.json`: reviewed-candidate artifact
- `data/shop-catalog.csv`: public-safe example shop catalog

V2 disposition:

- Define which file is authoritative for runtime fulfillment.
- Mark candidate files explicitly as generated, review-only, or import-source artifacts.
- Prevent candidate artifacts from becoming active catalog data without validation and approval.
- Add catalog schema, version, change summary, atomic activation, known-good retention, and rollback.
- Record the activated catalog version in fulfillment records.

### `docs/`

Tracked public documentation includes:

- `docs/FEATURES.md`
- `docs/SETUP.md`
- `docs/V2_ROADMAP.md`
- `docs/V2_THREAT_MODEL.md`
- `docs/V2_ARCHITECTURE.md`
- `docs/V2_REPOSITORY_BOUNDARY.md` after this checkpoint

### `features/`

- `features/dino-fulfillment-panel.js`: current Discord-facing fulfillment workflow

V2 disposition:

- Move Discord presentation and routing behind application services.
- Do not permit feature code to access SQL, raw RCON, the filesystem, or raw environment variables.

### `services/`

Current services include:

- `services/aat-command-builder.js`
- `services/creature-catalog.js`
- `services/fulfillment-coordinator.js`
- `services/rcon.js`

V2 disposition:

- Preserve the tested AAT command contract.
- Make raw RCON transport private.
- Replace general command-string access with named typed operations.
- Load catalog data through a validated versioned registry.
- Make fulfillment persistent and idempotent before RCON execution.

### `scripts/`

The current repository contains catalog audits, candidate enrichment, and standalone test scripts for command building, catalog behavior, fulfillment coordination, online players, panel integration, DLC behavior, and dashboards.

V2 disposition:

- Preserve useful tests and audit logic.
- Move repeatable tests into the unified test harness.
- Connect required suites to `npm test` and CI.
- Keep import or enrichment scripts from modifying the active catalog directly.

## Ignored-file inventory

The current `.gitignore` excludes:

- `node_modules/`
- `.env` and `.env.*`, except `.env.example`
- Private-key and certificate formats
- SQLite databases and several SQLite backup patterns
- `.pm2/`
- `*.log` and `logs/`
- Editor and operating-system files
- Coverage, temporary directories, and `*.tmp`
- Specific deployment backup filenames

### Required ignore-policy improvements

Before implementation or deployment artifacts are introduced, add broad exclusions for:

```text
backups/
*.7z
*.zip
*.tar
*.tar.gz
*.tgz
config/runtime/*.local.json
runtime/
artifacts/private/
```

Do not broadly ignore release artifacts if CI must publish them. Instead, keep local/private artifact directories distinct from reproducible release-output directories.

## Generated and review-only files

Generated or review-only files must declare their purpose and must not silently become runtime authority.

Each generated catalog artifact should identify:

- Generator or source
- Generation time or source version when safe
- Schema version
- Whether it is authoritative, candidate, reviewed-candidate, or rejected
- Validation status
- Approval status
- Intended next transition

Candidate files must never be loaded by production fulfillment unless an explicit validated promotion process creates a new active catalog version.

## Current configuration-field inventory

This section records names and classifications only. It intentionally excludes real values.

### Discord application

- `DISCORD_TOKEN`
  - Classification: secret
  - V2 owner: host secret provider
  - Required for: Discord connection
- `CLIENT_ID`
  - Classification: installation-specific identifier
  - V2 owner: private operations/runtime configuration
- `OWNER_ID`
  - Classification: installation-specific authorization identifier
  - V2 owner: private operations/runtime configuration
  - Migration note: replace owner-only special cases with explicit capabilities where practical

### Discord roles

- `STAFF_ROLE_ID`
- `MEMBER_ROLE_ID`
- `DINO_FULFILLMENT_ROLE_ID`

Classification: installation-specific non-secret identifiers.

V2 owner: private operations/runtime configuration under typed role or capability mappings.

### Discord channels and categories

- `CATEGORY_ID`
- `VAULT_CHANNEL_ID`
- `REQUESTS_CHANNEL_ID`
- `IGN_CHANNEL_ID`
- `PINS_DASHBOARD_CHANNEL_ID`
- `TICKET_LOGS_CHANNEL_ID`
- `DINO_FULFILLMENT_CHANNEL_ID`
- `DINO_FULFILLMENT_LOG_CHANNEL_ID`

Classification: installation-specific non-secret identifiers.

V2 owner: private operations/runtime configuration. Startup must validate syntax, guild membership, channel type, and required feature references.

### ARK RCON

- `ARK_RCON_HOST`
  - Classification: installation-specific network location; potentially restricted
  - V2 owner: private operations/runtime server registry
- `ARK_RCON_PORT_1`
- `ARK_RCON_PORT_2`
- `ARK_TEST_RCON_PORT`
  - Classification: installation-specific ports
  - V2 owner: private operations/runtime server registry
- `ARK_RCON_PASSWORD`
- `ARK_TEST_RCON_PASSWORD`
  - Classification: secret
  - V2 owner: host secret provider
  - Access restriction: only the RCON adapter resolves these values
- `ARK_RCON_MOCK`
  - Classification: production-safety control
  - V2 disposition: replace with an explicit `mock`, `test`, or `production` deployment mode; missing or unknown values fail startup

### Deployment/update

- `UPDATE_SCRIPT_PATH`
  - Classification: high-risk local execution configuration
  - V2 disposition: remove with `/updatebot`; deployment must occur outside Discord through an operator-controlled workflow

## Proposed V2 configuration ownership

### Environment or secret provider

Only true secrets should remain in environment variables:

```text
DISCORD_TOKEN
ARK_SERVER_<ID>_RCON_PASSWORD
future signing or encryption secrets
```

### Private validated instance configuration

Move non-secret installation-specific values into validated local configuration:

```text
runtime mode
guild ID
client ID
role and capability mapping
channel and category IDs
feature flags
server IDs and display names
server host references and ports
test-only state
secret-reference names
storage and backup paths
retention settings
```

### Public tracked schemas and examples

Track:

```text
field definitions
types and constraints
safe examples
cross-reference rules
feature dependency rules
redaction rules
```

## Configuration validation requirements

Validation occurs before Discord login and before any RCON connection.

Required checks include:

- Explicit deployment mode is one of `mock`, `test`, or `production`
- Discord IDs use valid snowflake syntax
- Required IDs exist for enabled features
- Guild-owned channels and roles resolve to expected types
- Server IDs are unique
- Hosts and ports are valid
- Ports are integers from 1 through 65535
- Secret-reference names use an allowlisted syntax
- Required secrets are present in live modes without printing values
- Test-only servers cannot be used by production unless an explicitly approved policy allows it
- Feature flags and dependencies are consistent
- Unknown properties are rejected
- Runtime paths are writable, outside the source repository where required, and not public examples
- Catalog, server, and feature cross-references resolve
- Example definitions cannot activate in production

The validated configuration object is frozen before services receive it.

## Current runtime and deployment requirements

### Development environment verified during foundation work

- Node.js `v24.22.1`
- npm `11.19.1`
- Current direct dependencies:
  - `discord.js@14.27.0`
  - `dotenv@18.0.9`
  - `node-cron@4.6.0`
  - `rcon@1.1.0`
  - `sqlite3@6.0.1`
- The `sqlite3@6.0.1` install script is explicitly approved in `package.json`

### Production baseline recorded separately

The private V1 baseline and encrypted backups have been verified. Production-specific addresses, identifiers, credentials, database contents, and service state are intentionally excluded from this public document.

### Discord requirements

- Discord application and bot token
- Required gateway intents documented in setup guidance
- Installation-specific guild, role, channel, and category configuration
- Slash-command registration
- Permissions sufficient only for enabled features

### SQLite requirements

- Runtime database outside Git
- Restrictive filesystem permissions
- Parameterized values
- Versioned migrations in V2
- Integrity checks before and after migration
- Verified pre-migration backup and restoration procedure

### RCON and AAT requirements

- RCON reachable only on approved controlled networks
- Dedicated secret references
- Explicit deployment mode
- Mock mode performs no network activity
- Live fulfillment currently depends on the tested Awesome ARK Tools operation contract
- No automatic retry for uncertain non-idempotent fulfillment
- New or changed creature blueprints require approved test-server verification

### Deployment requirements

- Deployment outside Discord
- Exact reviewed public commit, tag, or release artifact
- Clean install from committed lockfile
- CI and security gates before release
- Runtime data backup before migration
- Health and readiness verification
- Practiced rollback independent of `/updatebot`

## Catalog ownership and update boundary

The creature spawning catalog is public-safe versioned application data, not core feature code and not unvalidated runtime input.

### Catalog update lifecycle

1. Create or import a proposed catalog version.
2. Validate the complete catalog.
3. Produce a human-reviewable change report.
4. Review additions, removals, changed blueprints, DLC metadata, gender behavior, delivery mode, and saddle applicability.
5. Test new or changed blueprints on the approved test server.
6. Retain the current known-good catalog.
7. Atomically activate the approved version.
8. Record the active version in fulfillment and audit records.
9. Roll back to the prior known-good version if activation or compatibility verification fails.

No Discord action may accept a local path, raw catalog file, blueprint, or arbitrary command. Any future authorized reload action may request only an already staged and validated catalog version through an opaque server-side reference.

## Migration from current V1/public configuration

### Stage 1: preserve behavior

- Record every current configuration name.
- Add compatibility tests for existing enabled workflows.
- Do not change production behavior.

### Stage 2: introduce schemas and examples

- Add public schemas and safe examples.
- Add ignored runtime local-file paths.
- Add a validation command that does not start Discord or RCON.

### Stage 3: central loader

- Read environment and local configuration only in bootstrap.
- Parse, validate, cross-reference, redact, and freeze configuration.
- Preserve old environment names through a temporary compatibility adapter where required.

### Stage 4: feature migration

- Move features to the validated configuration object.
- Remove direct `process.env` access from feature, domain, application, and infrastructure code except the approved bootstrap/secret-resolution boundary.
- Replace broad staff-role checks with explicit capabilities.

### Stage 5: remove unsafe compatibility paths

- Remove `UPDATE_SCRIPT_PATH` and `/updatebot`.
- Remove ambiguous `ARK_RCON_MOCK` fallback behavior.
- Remove JavaScript server configuration after validated data configuration is proven.
- Remove legacy compatibility adapters only after migration evidence and rollback testing succeed.

## Public/private boundary acceptance criteria

The boundary is accepted when:

- The public repository is the only application-source repository.
- The private operations repository contains no duplicate source.
- True secrets exist only on approved hosts or secret providers.
- Installation-specific non-secret settings are validated and kept outside public source.
- Runtime databases, logs, backups, PM2 state, sessions, and player records remain outside Git.
- Public examples contain no private identifiers or infrastructure details.
- Catalog candidate artifacts cannot become active without validation and approval.
- The active catalog version is auditable and rollback-capable.
- CI scans for secrets and prohibited private values.
- Release artifacts exclude secrets and runtime data.
- Deployment and rollback occur outside Discord.

## Current gaps and follow-up work

- Add broad local backup/archive ignore patterns.
- Define and commit V2 configuration schemas and examples.
- Decide the exact private operations repository name and initialize it without application source.
- Classify the candidate catalog files in metadata and documentation.
- Connect standalone tests to a unified test command and CI.
- Remove `/updatebot` and `UPDATE_SCRIPT_PATH` in the dedicated execution-hardening phase.
- Replace the raw exported RCON command primitive in the dedicated RCON phase.
- Add GitHub milestones, issues, a project board, branch protection, CI, and release tags.
- Complete and rehearse the formal rollback procedure.

## Verification record

- Public branch inspected through GitHub at commit `0d7debc`.
- Public root, configuration, data, documentation, services, scripts, branches, issues, pull requests, and tags were inspected.
- No public GitHub issues, pull requests, or tags existed at this checkpoint.
- `main` and `rebuild/v2-foundation` were not protected at this checkpoint.
- Local verification previously confirmed the working tree was clean and synchronized.
- No secret values were included in this document.

## Next exact step

Commit this document with the corrected `docs/V2_ROADMAP.md` checkpoint. Then create the formal rollback procedure and GitHub planning structure before beginning the accelerated V2 foundation implementation.

## Rollback point

The rollback point for this documentation-only checkpoint is commit `0d7debc`. If validation fails, restore only the uncommitted documentation files after reviewing the diff. Do not modify production or delete backup evidence.
