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
- [ ] Confirm the private V1 backup and integrity evidence.
- [ ] Confirm the V1 baseline tag and rollback reference.
- [ ] Record the public and private repository boundary.
- [ ] Inventory tracked, ignored, generated, and runtime-only files.
- [ ] Inventory configuration fields without exposing secret values.
- [ ] Record current Node.js, npm, Discord, SQLite, RCON, and deployment requirements.

Exit criteria:

- A known-good V1 rollback point exists.
- Backup integrity has been verified.
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
- [ ] Commit and push `docs/V2_ARCHITECTURE.md` with this checkpoint update.

Exit criteria:

- Major assets, actors, entry points, threats, mitigations, and residual risks are documented.
- The target architecture assigns each privileged operation to a defined module.
- Catalog updates are assigned to a validated, versioned registry workflow rather than core feature edits.
- The architecture and final checkpoint are committed and pushed.
- No production behavior has changed.

## Phase 2: Configuration foundation

- [ ] Define a typed configuration schema.
- [ ] Validate all required values at startup.
- [ ] Reject malformed IDs, ports, booleans, paths, and server definitions.
- [ ] Separate public defaults from private deployment configuration.
- [ ] Replace ambiguous Boolean mock/live selection with an explicit deployment-mode enumeration.
- [ ] Prevent ambiguous mock, test, and production states.
- [ ] Redact secrets from logs and error output.
- [ ] Add configuration validation tests.
- [ ] Document migration from the V1 configuration format.

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
- Branch: `rebuild/v2-foundation`
- Last committed commit: `bc43c6c` (`Add Ticketbot V2 threat model`)
- Milestone: V2 foundation and documentation
- Current task: Finalize the roadmap and architecture checkpoint before making production-behavior changes.
- Status: In progress; paused at a cleanly identified uncommitted documentation checkpoint.

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

### Tests and verification completed

- `npm.cmd install`
- `npm.cmd ls --depth=0`
- `npm.cmd install-scripts ls`
- `git diff --check`
- `git status --short`
- `git status -sb`
- `git log -3 --oneline`
- Heading and file-size verification for `docs/V2_THREAT_MODEL.md`
- Heading and file-size verification for `docs/V2_ARCHITECTURE.md`

All completed checks passed. LF-to-CRLF messages were informational warnings.

### Known failures and gaps

- `docs/V2_ARCHITECTURE.md` has been created and validated locally but is not yet committed or pushed.
- This replacement `docs/V2_ROADMAP.md` must be copied into the repository, validated, staged, committed, and pushed with the architecture document.
- The private V1 backup, baseline tag, and integrity evidence still require documentation or verification in the public roadmap checkpoint.
- The tracked, ignored, generated, and runtime-only file inventory remains incomplete.
- The configuration-field inventory remains incomplete.
- The public/private repository boundary still requires a dedicated recorded verification step.
- GitHub milestones, issues, and project-board state still require creation or verification.
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

- `docs/V2_ROADMAP.md`
- `docs/V2_ARCHITECTURE.md`

### Next exact step

Copy this replacement file over `docs/V2_ROADMAP.md`. Validate the roadmap and architecture documents, stage both files, inspect the staged diff, commit them together, and push the branch. Then verify the private V1 backup, baseline tag, repository boundary, and configuration inventory before making production-behavior changes.

### Rollback point

Reset only the uncommitted documentation work back to committed state `bc43c6c` if the roadmap or architecture validation fails. Do not use destructive reset or cleanup commands without first reviewing the affected files.
