# Ticketbot V2 roadmap

This document is the authoritative implementation roadmap and continuity record for Ticketbot V2.

V2 is a security-focused rebuild of the existing ARK support and fulfillment bot. Work must preserve known-good V1 behavior until each replacement component has passed implementation review, automated testing, security review, compatibility verification, documentation, private-configuration impact review, and rollback testing.

## Project goals

- Preserve the working V1 baseline and maintain a tested rollback route.
- Keep the public repository as the canonical source-code repository.
- Keep installation-specific deployment configuration in a separate private operations repository.
- Keep secrets in `.env` files or the production host's secret-management environment.
- Replace permissive configuration with strict, validated, fail-closed configuration.
- Remove Discord-triggered shell execution and other remote-code-execution paths.
- Restrict RCON access to validated, allowlisted operations.
- Centralize authorization, input validation, logging, redaction, and error handling.
- Build trusted registries for players, creatures, servers, and supported operations.
- Make the creature spawning catalog independently updatable without editing core feature code.
- Validate, version, audit, atomically activate, back up, and roll back creature catalog updates.
- Make Discord interactions idempotent and resistant to replay or duplicate fulfillment.
- Introduce controlled database migrations, backups, recovery checks, and audit logging.
- Establish automated tests, CI checks, release controls, staged deployment, and rollback verification.
- Preserve compatibility with documented ARK, Discord, AAT, and operational workflows.

## Repository boundaries

### Public source repository

The `ark-support-and-fulfillment-bot` repository is the canonical source repository.

It may contain:

- Application source code
- Public-safe configuration schemas
- Public-safe example configuration
- Versioned public-safe creature catalog data
- Catalog schemas, validators, import tools, and change-report tools
- Database migration definitions
- Automated tests
- CI configuration
- Setup and operational documentation
- Feature manifests and contracts

It must not contain:

- Discord tokens
- RCON passwords
- Live server addresses that are intended to remain private
- Private Discord IDs unless explicitly approved for publication
- Production databases
- Runtime logs
- Backups containing user or operational data
- Installation-specific secrets

### Private operations repository

A separate private repository may contain:

- Deployment definitions
- Installation-specific non-secret configuration
- Host-specific service definitions
- Environment templates without secret values
- Operational runbooks
- Backup and restore procedures
- Installation-specific catalog overlays only if a future approved design requires them

The private operations repository must not contain a second copy of the application source.

Secrets and runtime data must remain outside Git on the production host.

## Definition of done

Every implementation task must include:

1. Implementation
2. Automated or repeatable tests
3. Security review
4. Compatibility notes
5. Documentation
6. Private-configuration impact review
7. Rollback instructions
8. Evidence that the acceptance criteria passed

A task is not complete merely because it works during one manual Discord or RCON test.

## Roadmap phases

## Phase 0: Preserve the V1 baseline

- [x] Confirm the public repository baseline.
- [x] Create the `rebuild/v2-foundation` branch.
- [x] Install and validate the current dependency set.
- [x] Review and approve the pinned SQLite install script.
- [x] Confirm the private V1 backup and integrity evidence.
- [x] Confirm the V1 baseline tag and rollback reference.
- [x] Record the public and private repository boundary.
- [x] Inventory tracked, ignored, generated, and runtime-only files.
- [x] Inventory configuration fields without exposing secret values.
- [x] Record current Node.js, npm, Discord, SQLite, RCON, and deployment requirements.

Exit criteria:

- A known-good V1 rollback point exists.
- Backup integrity has been verified.
- The private V1 repository and remote baseline tag resolve to the same tagged commit.
- Two encrypted Windows archive copies exist and match their recorded SHA-256 value.
- V2 work cannot accidentally overwrite the V1 baseline.
- The public/private repository boundary is documented.

## Phase 1: Threat model and architecture

- [x] Create `docs/V2_THREAT_MODEL.md`.
- [x] Document trust boundaries and privileged operations.
- [x] Identify Discord, configuration, database, RCON, deployment, dependency, and catalog threats.
- [x] Define prohibited operations and fail-closed behavior.
- [x] Record security and compatibility assumptions.
- [x] Create and validate `docs/V2_ARCHITECTURE.md` locally.
- [x] Document the target module boundaries and dependency direction.
- [x] Map threat categories T01 through T14 to architecture controls.
- [x] Commit and push `docs/V2_ARCHITECTURE.md` with this checkpoint update.

Exit criteria:

- Major assets, actors, entry points, threats, mitigations, and residual risks are documented.
- The target architecture assigns each privileged operation to a defined module.
- Catalog updates are assigned to a validated, versioned registry workflow rather than core feature edits.
- The architecture and final checkpoint are committed and pushed.
- No production behavior has changed.

## Phase 2: Configuration foundation

- [x] Define a typed configuration schema.
- [x] Validate all required values at startup.
- [x] Reject malformed IDs, ports, booleans, paths, and server definitions.
- [x] Separate public defaults from private deployment configuration.
- [x] Replace ambiguous Boolean mock/live selection with an explicit deployment-mode enumeration.
- [x] Prevent ambiguous mock, test, and production states.
- [x] Redact secrets from logs and error output.
- [x] Add configuration validation tests.
- [x] Document migration from the V1 configuration format.

Exit criteria:

- Invalid or incomplete production configuration fails closed.
- Mock, test, and production modes cannot be confused.
- No secret value is committed or logged.
- Features receive frozen validated configuration and do not read `process.env` directly.

## Phase 3: Remove dangerous execution paths

- [ ] Remove Discord-triggered shell execution.
- [ ] Remove or replace `/updatebot`.
- [ ] Audit all uses of process execution and dynamic command construction.
- [ ] Restrict RCON to allowlisted operations.
- [ ] Separate command creation from command transport.
- [ ] Make raw RCON transport inaccessible to Discord feature handlers.
- [ ] Add injection and authorization tests.
- [ ] Document the secure deployment update process.

Exit criteria:

- Discord input cannot trigger arbitrary operating-system commands.
- User-controlled text cannot alter the structure of an RCON command.
- Feature modules cannot submit raw RCON command strings.
- Every privileged operation is explicitly authorized and validated.

## Phase 4: Central authorization and validation

- [ ] Centralize role, capability, and permission checks.
- [ ] Centralize Discord interaction validation.
- [ ] Define authorization policies by feature and operation.
- [ ] Normalize and validate player, server, creature, catalog, and request identifiers.
- [ ] Prevent stale, replayed, cross-user, cross-channel, or duplicate interactions.
- [ ] Recheck authorization immediately before privileged execution.
- [ ] Add authorization and negative-path tests.

Exit criteria:

- Privileged actions use one centralized policy mechanism.
- Missing authorization configuration fails closed.
- Cross-guild, cross-channel, wrong-user, expired, and replayed interactions are rejected.

## Phase 5: Trusted registries and updatable catalogs

### Player registry

- [ ] Create a trusted player registry.
- [ ] Separate typed display names from trusted internal identity.
- [ ] Link Discord identity, observed ARK identity, and EOS identity through verified records.
- [ ] Migrate legacy self-entered names as unverified records.

### Server registry

- [ ] Create a trusted server and map registry.
- [ ] Require unique server IDs and validated host, port, secret reference, environment, and test-only state.
- [ ] Define the allowlisted operations supported by each server.

### Creature spawning catalog

- [ ] Store the creature spawning catalog as independently updatable, versioned data rather than hardcoded feature logic.
- [ ] Keep catalog loading, validation, activation, and rollback separate from Discord presentation and RCON transport.
- [ ] Define a documented catalog schema and update workflow.
- [ ] Require stable creature IDs, display names, aliases, blueprints, enabled state, tameable state, gender behavior, delivery mode, saddle applicability, source content, DLC metadata, and catalog-version metadata.
- [ ] Validate the complete proposed catalog before activating any update.
- [ ] Reject duplicate creature IDs, unsafe blueprint paths, unsupported delivery modes, contradictory gender settings, and incomplete required metadata.
- [ ] Generate a reviewable summary of additions, removals, and changed fields before activation.
- [ ] Back up or retain the current known-good catalog before activating a replacement.
- [ ] Activate validated catalog updates atomically so the runtime cannot observe a partially updated registry.
- [ ] Leave the active known-good catalog unchanged when validation or activation fails.
- [ ] Record the active catalog version in fulfillment requests, results, and audit records.
- [ ] Support documented rollback to the previous known-good catalog.
- [ ] Define whether safe catalog reloads require a process restart or may use an authorized reload operation.
- [ ] If runtime reload is supported, ensure it performs validation and atomic replacement without exposing raw file paths or shell execution through Discord.
- [ ] Add tests for DLC, gendered, genderless, saddled, unsaddled, disabled, unsupported, malformed, duplicate, added, modified, and removed entries.
- [ ] Test new or changed blueprints on the approved test server before production use.

### Registry-wide work

- [ ] Define versioned data formats.
- [ ] Validate all registry data during startup.
- [ ] Add migration and compatibility tests.
- [ ] Document registry ownership, update permissions, review requirements, and rollback procedures.

Exit criteria:

- Authorized maintainers can update the creature spawning catalog without editing core feature code.
- An invalid or partial catalog update cannot replace the active known-good catalog.
- Every activated catalog version is identifiable, reviewable, and reproducible.
- Fulfillment records identify the catalog version used.
- The previous known-good catalog can be restored using a documented rollback procedure.
- Creature search and fulfillment resolve trusted stable IDs to validated catalog records.
- A catalog update cannot introduce raw RCON capability or bypass the approved command builder.

## Phase 6: Secure interaction and fulfillment workflow

- [ ] Use versioned, opaque, server-side interaction tokens.
- [ ] Bind interactions to actor, guild, channel, message, action, request, expiration, and state.
- [ ] Add request expiration.
- [ ] Create persistent fulfillment requests before confirmation.
- [ ] Atomically claim a pending request before RCON execution.
- [ ] Add idempotency protection.
- [ ] Require explicit fulfillment confirmation.
- [ ] Revalidate authorization, player availability, server, creature ID, and catalog version immediately before execution.
- [ ] Mask EOS IDs in Discord logs.
- [ ] Preserve the confirmed AAT fulfillment contract.
- [ ] Clearly display scanning delays and DLC restrictions.
- [ ] Treat timeout and lost-response cases as uncertain outcomes rather than automatic retry conditions.
- [ ] Add mock, failure, partial-delivery, retry, replay, restart, and duplicate-request tests.

Exit criteria:

- The same fulfillment request cannot execute twice.
- Partial pair delivery cannot silently repeat a successful operation.
- Fulfillment uses the trusted creature ID and recorded catalog version, not user-entered blueprint data.
- Uncertain outcomes require review instead of automatic non-idempotent retry.

## Phase 7: Database migrations and recovery

- [ ] Introduce a schema-version table.
- [ ] Add ordered, transactional migrations.
- [ ] Back up the database before migration.
- [ ] Validate database integrity before and after migration.
- [ ] Test restoration using a copied database.
- [ ] Define retention and privacy rules.
- [ ] Add persistent fulfillment request and operation-result records.
- [ ] Add catalog-version references to fulfillment audit data.
- [ ] Document recovery and rollback procedures.

Exit criteria:

- Migrations run once and in order.
- Unsupported schema versions fail closed.
- Pre-migration backup restoration is tested.
- Fulfillment requests and catalog-version references survive restart.

## Phase 8: Logging and operational visibility

- [ ] Centralize structured application logging.
- [ ] Redact tokens, passwords, PINs, full EOS IDs, and sensitive output.
- [ ] Add correlation and request IDs.
- [ ] Unify ticket and fulfillment audit conventions.
- [ ] Record catalog version and operation state in fulfillment audit events.
- [ ] Record catalog activation, rejection, and rollback events without logging sensitive data.
- [ ] Build resilient paginated dashboards.
- [ ] Restore dashboards after restart or message deletion.
- [ ] Document operator diagnostics.

Exit criteria:

- Every privileged operation has a correlated, redacted audit trail.
- Dashboard deletion does not delete authoritative audit records.
- Catalog changes and fulfillment records can be correlated to exact catalog versions.

## Phase 9: Feature contracts and modularization

- [ ] Define feature manifests.
- [ ] Define feature flags and dependencies.
- [ ] Establish stable service interfaces.
- [ ] Move feature code out of the monolithic entry point.
- [ ] Support independently testable modules.
- [ ] Give features predictable initialize, register, start, and stop lifecycles.
- [ ] Ensure disabled features register no commands, panels, timers, or network activity.
- [ ] Document extension and contribution patterns.

Exit criteria:

- Feature handlers depend on application services rather than SQL, raw RCON, shell, or environment access.
- The fulfillment feature consumes the trusted catalog registry through a stable interface.

## Phase 10: CI and release controls

- [ ] Add syntax and static validation.
- [ ] Add unit, integration, security, compatibility, and recovery tests.
- [ ] Add clean-install verification.
- [ ] Add secret and private-value scanning.
- [ ] Add dependency and install-script review.
- [ ] Add catalog-schema validation and catalog-change reporting to CI.
- [ ] Add protected-branch and pull-request controls.
- [ ] Produce reproducible release artifacts.
- [ ] Create release and rollback checklists.

Exit criteria:

- Invalid source, configuration, migrations, or catalog data blocks release.
- Dependency and install-script changes require review.
- Release artifacts exclude secrets, runtime data, logs, and backups.

## Phase 11: Staged rollout

- [ ] Deploy to the test environment.
- [ ] Run Discord workflows in mock mode.
- [ ] Validate a no-network mock-mode run.
- [ ] Test catalog validation, activation, rejection, and rollback with non-production data.
- [ ] Run controlled live RCON tests on the approved test server.
- [ ] Verify authorization and failure behavior.
- [ ] Verify database backup and restoration.
- [ ] Exercise the release rollback procedure.
- [ ] Exercise the catalog rollback procedure.
- [ ] Observe the staged release before wider deployment.
- [ ] Record acceptance evidence.

Exit criteria:

- Mock, test, and production modes behave as documented.
- A known-good catalog can be restored.
- Application and database rollback procedures succeed.
- Production cutover evidence is recorded.

## Phase 12: Post-release cleanup

- [ ] Remove obsolete V1 code and configuration.
- [ ] Remove deprecated commands and compatibility shims.
- [ ] Update public setup and feature documentation.
- [ ] Publish the catalog update, validation, review, activation, and rollback guide.
- [ ] Verify third-party dependency and license obligations.
- [ ] Archive superseded migration and rollout notes.
- [ ] Archive the old private source copy after verification.
- [ ] Complete the final security and compatibility review.

## Compatibility requirements

V2 must preserve or deliberately migrate these workflows:

- Persistent Discord panels
- In-game-name records
- Vault PIN management
- Shop catalog search
- Support tickets and ticket logs
- Dino catalog browsing and search
- Independently updatable and validated creature spawning catalog
- Catalog version tracking and known-good rollback
- DLC metadata and warnings
- Dino fulfillment confirmation
- Mock-mode testing
- Live RCON fulfillment
- AAT cryopod delivery
- SQLite-backed persistence
- Paginated operational dashboards

Any intentional incompatibility must include migration instructions and rollback notes.

## Creature catalog update acceptance requirements

A creature catalog update is acceptable only when:

- Core feature code does not need to be edited merely to add, disable, rename, or update a creature record.
- The complete proposed catalog passes schema, field, uniqueness, blueprint, delivery-mode, gender, saddle, and DLC validation.
- The update produces a human-reviewable change summary.
- The active known-good catalog is retained before replacement.
- Activation is atomic.
- Failed validation or activation leaves the current catalog unchanged.
- The new version is identifiable in fulfillment and audit records.
- New or changed blueprints receive approved test-server verification before production use.
- A documented rollback restores the previous known-good catalog.
- Catalog updates cannot submit arbitrary RCON commands or bypass the allowlisted operation builder.

## Current checkpoint

- Date: 2026-11-05
- Branch: `feature/v2-config-foundation`
- Last committed commit: `e4fb907` (`Add fail-closed V2 configuration foundation`)
- Milestone: V2 Secure Core
- Current task: Validate and commit the isolated V2 bootstrap startup-order checkpoint for issue #2.
- Status: The configuration foundation and isolated V2 bootstrap are implemented and tested. Configuration validation precedes Discord and RCON adapter construction, mock mode constructs no RCON adapter, and V1 production startup remains unchanged.

### Completed work

- Confirmed the public baseline at `e4f306a`.
- Created and pushed `rebuild/v2-foundation`.
- Confirmed Node.js `v24.22.1` and npm `11.19.1` on the Windows development machine.
- Installed the existing dependency set.
- Confirmed all five direct dependencies are present.
- Confirmed npm reports zero known vulnerabilities.
- Reviewed and approved the `sqlite3@6.0.1` install script.
- Committed and pushed the approval as `bab3648`.
- Confirmed the branch tracks `origin/rebuild/v2-foundation`.
- Confirmed the existing documentation style in `docs/FEATURES.md` and `docs/SETUP.md`.
- Created, validated, committed, and pushed `docs/V2_ROADMAP.md` as `9e550d7`.
- Reviewed V1 security-sensitive entry points and trust boundaries.
- Created, validated, committed, and pushed `docs/V2_THREAT_MODEL.md` as `bc43c6c`.
- Documented 14 threat categories, required mitigations, verification requirements, prohibited patterns, and production security acceptance criteria.
- Created and validated `docs/V2_ARCHITECTURE.md` locally.
- Mapped threat categories T01 through T14 to explicit modules, interfaces, dependency rules, tests, migration stages, and release controls.
- Added the requirement for an independently updatable, validated, versioned creature spawning catalog with change review, atomic activation, audit tracking, backup, and rollback.
- Committed and pushed `docs/V2_ARCHITECTURE.md` and the expanded catalog roadmap as `74bed7a`.
- Verified the private V1 repository is clean and synchronized on `main`.
- Verified local `HEAD`, `origin/main`, the local `v1-private-baseline` tag, and the remote peeled tag all resolve to `a52558e83b81a6710848c16c03acb0509cdb4583`.
- Confirmed the encrypted V1 archive had previously been opened successfully with its password.
- Confirmed encrypted V1 archive copies exist locally and in OneDrive.
- Confirmed both encrypted archive copies are 42,770 bytes and match SHA-256 `A1DE4A9E5B2034184E4FB47E539C3997771F3B36C6DE20539D5DD005C986CDD4`.
- Inspected the public repository through GitHub at `0d7debc`.
- Created `docs/V2_REPOSITORY_BOUNDARY.md` with tracked, ignored, generated, runtime, configuration, catalog, deployment, and migration ownership.
- Recorded the current configuration-name inventory without including secret values.
- Recorded the accelerated complete-build approach: generate the coordinated V2 implementation, integrate it through reviewable checkpoints, and require all definition-of-done evidence before production use.
- Created `docs/V2_ROLLBACK.md` covering release, configuration, database, catalog, service, Discord, fulfillment, and full V1 recovery.
- Defined rollback levels, checkpoint evidence, rehearsal stages, and acceptance criteria without changing production behavior.
- Committed and pushed the rollback plan as `056fc84`.
- Created five GitHub milestones covering foundation, secure core, trusted data and fulfillment, persistence and operations, and release and rollout.
- Created issues #1 through #14 with acceptance criteria and the project definition of done.
- Created the `Ticketbot V2 Rebuild` GitHub project and added all fourteen issues.
- Verified issue #2 is the first accelerated implementation task: typed fail-closed configuration.
- Added the isolated V2 configuration library, public schema/example, validation command, and configuration tests.
- Added explicit deployment modes and fail-closed production rules.
- Added safe summaries, deep freezing, V1 compatibility mapping, ignore hardening, migration documentation, and rollback notes.
- Committed and pushed the configuration foundation as `e4fb907`.
- Added an isolated V2 bootstrap with dependency-injected Discord and RCON adapter factories.
- Proved configuration failure prevents all external adapter initialization.
- Proved mock mode does not construct an RCON adapter.
- Proved the safe configuration summary is emitted before external initialization.
- Preserved the existing V1 `index.js` startup path without modification.

### Tests and verification completed

- `node --test tests/config/*.test.js`
- `node scripts/validate-config.js config/examples/instance.example.json`
- Syntax checks for all new JavaScript files
- JSON parsing for schemas, examples, and `package.json`
- Package archive content and path traversal checks
- Existing foundation verification retained

All package-construction checks passed in the build environment. Local Windows verification remains required before commit.

### Known failures and gaps

- The formal rollback procedure is documented; test-environment rehearsal evidence is still required.
- GitHub milestones, issues, and project-board membership are complete; dependency relationships, status-field refinement, and branch protection remain future governance work.
- Branch protection, CI gates, and public release tags are not yet configured.
- The private operations repository still requires initialization without duplicated application source.
- Broad archive and local-backup ignore patterns still require addition before implementation artifacts are introduced.
- No production behavior has been changed on this branch.

### Compatibility and security notes

- The SQLite install-script approval is pinned to `sqlite3@6.0.1`.
- The dependency deprecation warning originates from the SQLite dependency chain and did not cause installation failure.
- No secrets or production configuration values were added.
- V1 behavior remains unchanged.
- Creature catalog updates must not require edits to core fulfillment code.
- Proposed catalog updates are untrusted until the complete catalog passes validation.
- Invalid updates must leave the active known-good catalog unchanged.
- Fulfillment must resolve a trusted creature ID and catalog version rather than accepting typed blueprint execution data.
- Catalog update or reload mechanisms must not introduce shell execution or general-purpose raw RCON access.

### Files expected to change in the next commit

- `.gitignore`
- `package.json`
- `config/examples/instance.example.json`
- `config/schemas/instance.schema.json`
- `src/config/*.js`
- `scripts/validate-config.js`
- `tests/config/config-foundation.test.js`
- `docs/V2_CONFIGURATION.md`
- `docs/V2_ROADMAP.md`

### Next exact step

Apply the prepared configuration-foundation overlay to `feature/v2-config-foundation`, inspect the diff, run the configuration tests and validation command on Windows, and review security and compatibility evidence before staging.

### Rollback point

The committed rollback point is `f18b0e2`. Before commit, remove new issue #2 files and restore modified tracked files from `f18b0e2` only after reviewing the diff. No production, database, Discord, or RCON rollback is required because this library is not wired into V1 runtime behavior.
