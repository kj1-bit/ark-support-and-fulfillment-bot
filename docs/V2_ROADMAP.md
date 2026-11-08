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

- [x] Remove Discord-triggered shell execution.
- [x] Remove or replace `/updatebot`.
- [x] Audit all uses of process execution and dynamic command construction.
- [x] Restrict RCON to allowlisted operations.
- [x] Separate command creation from command transport.
- [x] Make raw RCON transport inaccessible to Discord feature handlers.
- [x] Add injection and authorization tests.
- [x] Document the secure deployment update process.

Exit criteria:

- Discord input cannot trigger arbitrary operating-system commands.
- User-controlled text cannot alter the structure of an RCON command.
- Feature modules cannot submit raw RCON command strings.
- Every privileged operation is explicitly authorized and validated.

## Phase 4: Central authorization and validation

- [x] Centralize role, capability, and permission checks.
- [x] Centralize Discord interaction validation.
- [x] Define authorization policies by feature and operation.
- [x] Normalize and validate player, server, creature, catalog, and request identifiers.
- [x] Prevent stale, replayed, cross-user, cross-channel, or duplicate interactions.
- [x] Recheck authorization immediately before privileged execution.
- [x] Add authorization and negative-path tests.

Exit criteria:

- Privileged actions use one centralized policy mechanism.
- Missing authorization configuration fails closed.
- Cross-guild, cross-channel, wrong-user, expired, and replayed interactions are rejected.

## Phase 5: Trusted registries and updatable catalogs

### Player registry

- [x] Create a trusted player registry.
- [x] Separate typed display names from trusted internal identity.
- [x] Link Discord identity, observed ARK identity, and EOS identity through verified records.
- [x] Migrate legacy self-entered names as unverified records.

### Server registry

- [x] Create a trusted server and map registry.
- [x] Require unique server IDs and validated host, port, secret reference, environment, and test-only state.
- [x] Define the allowlisted operations supported by each server.

### Creature spawning catalog

- [x] Store the creature spawning catalog as independently updatable, versioned data rather than hardcoded feature logic.
- [x] Keep catalog loading, validation, activation, and rollback separate from Discord presentation and RCON transport.
- [x] Define a documented catalog schema and update workflow.
- [x] Require stable creature IDs, display names, aliases, blueprints, enabled state, tameable state, gender behavior, delivery mode, saddle applicability, source content, DLC metadata, and catalog-version metadata.
- [x] Validate the complete proposed catalog before activating any update.
- [x] Reject duplicate creature IDs, unsafe blueprint paths, unsupported delivery modes, contradictory gender settings, and incomplete required metadata.
- [x] Generate a reviewable summary of additions, removals, and changed fields before activation.
- [x] Back up or retain the current known-good catalog before activating a replacement.
- [x] Activate validated catalog updates atomically so the runtime cannot observe a partially updated registry.
- [x] Leave the active known-good catalog unchanged when validation or activation fails.
- [x] Record the active catalog version in fulfillment requests, results, and audit records.
- [x] Support documented rollback to the previous known-good catalog.
- [x] Define whether safe catalog reloads require a process restart or may use an authorized reload operation.
- [x] If runtime reload is supported, ensure it performs validation and atomic replacement without exposing raw file paths or shell execution through Discord.
- [x] Add tests for DLC, gendered, genderless, saddled, unsaddled, disabled, unsupported, malformed, duplicate, added, modified, and removed entries.
- [ ] Test new or changed blueprints on the approved test server before production use.

### Registry-wide work

- [x] Define versioned data formats.
- [x] Validate all registry data during startup.
- [x] Add migration and compatibility tests.
- [x] Document registry ownership, update permissions, review requirements, and rollback procedures.

Exit criteria:

- Authorized maintainers can update the creature spawning catalog without editing core feature code.
- An invalid or partial catalog update cannot replace the active known-good catalog.
- Every activated catalog version is identifiable, reviewable, and reproducible.
- Fulfillment records identify the catalog version used.
- The previous known-good catalog can be restored using a documented rollback procedure.
- Creature search and fulfillment resolve trusted stable IDs to validated catalog records.
- A catalog update cannot introduce raw RCON capability or bypass the approved command builder.

## Phase 6: Secure interaction and fulfillment workflow

- [x] Use versioned, opaque, server-side interaction tokens.
- [x] Bind interactions to actor, guild, channel, message, action, request, expiration, and state.
- [x] Add request expiration.
- [x] Create persistent fulfillment requests before confirmation.
- [x] Atomically claim a pending request before RCON execution.
- [x] Add idempotency protection.
- [x] Require explicit fulfillment confirmation.
- [x] Revalidate authorization, player availability, server, creature ID, and catalog version immediately before execution.
- [x] Mask EOS IDs in Discord logs.
- [x] Preserve the confirmed AAT fulfillment contract.
- [x] Clearly display scanning delays and DLC restrictions.
- [x] Treat timeout and lost-response cases as uncertain outcomes rather than automatic retry conditions.
- [x] Add mock, failure, partial-delivery, retry, replay, restart, and duplicate-request tests.

Exit criteria:

- The same fulfillment request cannot execute twice.
- Partial pair delivery cannot silently repeat a successful operation.
- Fulfillment uses the trusted creature ID and recorded catalog version, not user-entered blueprint data.
- Uncertain outcomes require review instead of automatic non-idempotent retry.

## Phase 7: Database migrations and recovery

- [x] Introduce a schema-version table.
- [x] Add ordered, transactional migrations.
- [x] Back up the database before migration.
- [x] Validate database integrity before and after migration.
- [x] Test restoration using a copied database.
- [x] Define retention and privacy rules (see `docs/V2_RETENTION.md`).
- [x] Add persistent fulfillment request and operation-result records.
- [x] Add catalog-version references to fulfillment audit data.
- [x] Document recovery and rollback procedures.

Exit criteria:

- Migrations run once and in order.
- Unsupported schema versions fail closed.
- Pre-migration backup restoration is tested.
- Fulfillment requests and catalog-version references survive restart.

## Phase 8: Logging and operational visibility

- [x] Centralize structured application logging.
- [x] Redact tokens, passwords, PINs, full EOS IDs, and sensitive output.
- [ ] Add correlation and request IDs.
- [x] Unify ticket and fulfillment audit conventions.
- [x] Record catalog version and operation state in fulfillment audit events.
- [ ] Record catalog activation, rejection, and rollback events without logging sensitive data.
- [x] Build resilient paginated dashboards.
- [x] Restore dashboards after restart or message deletion.
- [x] Document operator diagnostics.

Exit criteria:

- Every privileged operation has a correlated, redacted audit trail.
- Dashboard deletion does not delete authoritative audit records.
- Catalog changes and fulfillment records can be correlated to exact catalog versions.

## Phase 9: Feature contracts and modularization

- [x] Define feature manifests.
- [x] Define feature flags and dependencies.
- [x] Establish stable service interfaces.
- [x] Move feature code out of the monolithic entry point.
- [x] Support independently testable modules.
- [x] Give features predictable initialize, register, start, and stop lifecycles.
- [x] Ensure disabled features register no commands, panels, timers, or network activity.
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

- Date: 2026-11-07
- PR: [#17](https://github.com/kj1-bit/ark-support-and-fulfillment-bot/pull/17), merged to `main` as `a7412ef536ca45d4ef52c3264e8d41d5199c7179`
- V2 test baseline tag: `v2-test-baseline-2026-11-07`
- Milestone: V2 runtime review remediation
- Database schema version: 10
- Status: PR #17 is merged. V2 now has a standalone launcher at `scripts/start-v2.js`; Debian and external test-endpoint rehearsal remain outstanding. The root `index.js` remains the V1 entrypoint. See the [V2 guide](V2_GUIDE.md) and [Debian startup plan](V2_DEBIAN_STARTUP_PLAN.md) for current operator guidance and test acceptance steps.

### Current implementation

- Fulfillment reads the active catalog at request creation and confirmation; stale catalog requests expire before claim.
- Confirmation cancellation consumes the same one-time session as confirmation and transitions the persistent request to `CANCELED`.
- Each normalized RCON operation result is saved as it completes. Persisted summaries are limited to success and operation index; raw transport responses, commands, server details, and sensitive identifiers are not stored. Schema version 10 also redacts historical raw result data.
- PIN cancellation derives ownership from the persisted request. Staff can deliver an approved PIN only by direct message to its owner.
- Shop search renders the catalog service's `results` and nested DLC warning contract.
- Ticket, PIN, and fulfillment audit panels use the same authorized paginated interface and are persisted/restored after restart or message deletion.
- Enabled features require their staff roles and channels before backup or migrations begin.
- Slash-command deployment defaults to a reviewed dry run, uses the validated Discord application ID, updates only managed commands, and aborts when the command list changes during review.
- A scheduled retention service purges expired sessions, old tickets, completed PIN requests, operational events, and old fulfillment audit rows, and anonymizes terminal fulfillment identities. Expired PIN requests no longer block re-requesting, and interrupted fulfillment is reconciled on startup.
- Enabled PINs require `PIN_PROTECTION_KEY` during configuration validation outside mock mode.
- `scripts/start-v2.js` wires the runtime to SQLite, the content-fingerprinted checked-in catalog, the Discord adapter, and the mode-specific RCON transport. Mock-mode launcher integration is tested; no Debian or external test-service deployment has been performed.

### Verification

- Full automated suite after Debian launcher review fixes: 185 tests passed, 0 failed.
- Creature catalog validation and reviewed catalog coverage: passed.
- Public example configuration validation: passed.
- `git diff --check`: passed.
- PR checks passed before merge. No separate post-merge check run was reported by GitHub at the checkpoint.
- Merging did not activate V2, change V1, register Discord commands, migrate production data, or connect to live RCON.

## Historical checkpoint (2026-11-05)

- Date: 2026-11-05
- Branch: `feature/v2-authorization-foundation`
- Last committed commit: `195e27a` (`Merge pull request #16 from kj1-bit/feature/v2-remove-shell-execution`)
- Milestone: V2 Secure Core
- Current task: Build and review the isolated authorization, interaction-binding, redaction, and safe-error foundation for issue #4.
- Status: Issues #2 and #3 are merged and closed. Issue #4 security primitives are applied locally without V1 runtime integration or production changes.

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
- Issue #2 merged through PR #15 at merge commit `21de487` and was closed.
- Audited operating-system process execution across the repository.
- Removed the `child_process` import and Discord-triggered `exec()` path.
- Removed the deployment command from runtime handling and command registration.
- Removed `UPDATE_SCRIPT_PATH` from public configuration.
- Removed obsolete deployment guidance from user-facing documentation.
- Added operator-controlled deployment and rollback documentation.
- Added static and negative-path shell-execution tests.
- Verified executable runtime code contains no `child_process`, `exec`, `execFile`, `spawn`, or `fork` path.
- Verified public configuration and user-facing documentation contain no obsolete deployment command or variable.

### Completed issue #4 foundation work

- Issue #4 isolated authorization foundation added without V1 runtime integration.
- Authorization policy validation fails closed for missing or malformed configuration.
- Authorization rejects wrong guild, channel, role, capability, and actor context.
- Interaction tokens bind actor, guild, channel, message, action, and expiration.
- Interaction-token tests reject context mismatch, expiration, and replay.
- Recursive redaction removes sensitive fields and masks full EOS-like identifiers.
- Safe application errors expose stable public categories without exposing internal causes.

### Tests and verification completed

- `npm.cmd test`: 13 tests passed, including configuration, bootstrap, and schema-consistency tests.
- `npm.cmd run test:bootstrap`: 4 tests passed.
- `npm.cmd run config:validate -- config/examples/instance.example.json`: passed with redacted output.
- JavaScript syntax checks passed for configuration and bootstrap files.
- Private-value scan returned no matches.
- V1 runtime-file status scan returned no matches.
- `git diff --check`: passed; LF-to-CRLF notices were informational.
- PR #15 opened from `feature/v2-config-foundation` into `rebuild/v2-foundation`.
- Final corrective verification for issue #2 passed with 13 tests and 0 failures.
- Issue #3 unified suite passed with 17 tests and 0 failures.
- Issue #3 security-only suite passed with 4 tests and 0 failures.
- Runtime and public-documentation prohibition scans returned no unexpected matches.
- Issue #4 unified suite passed with 22 tests and 0 failures.
- Issue #4 security-only suite passed with 9 tests and 0 failures.
- Syntax checks passed for every new security module and its test file.
- V1 runtime-file status scan returned no issue #4 changes.
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

- `src/security/*.js`
- `tests/security/authorization-foundation.test.js`
- `docs/V2_AUTHORIZATION.md`
- `docs/V2_ROADMAP.md`

### Next exact step

Run the unified and security-only suites, review negative-path and redaction evidence, inspect the diff, and commit the isolated issue #4 foundation if clean.

### Rollback point

The committed rollback point is `195e27a`. Before commit, remove the isolated issue #4 files and restore `docs/V2_ROADMAP.md` from `195e27a` after reviewing the diff. No production, Discord, database, or RCON rollback is required.
