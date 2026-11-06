# Ticketbot V2 roadmap

This document is the authoritative implementation roadmap and continuity record for Ticketbot V2.

V2 is a security-focused rebuild of the existing ARK support and fulfillment bot. Work must preserve known-good V1 behavior until each replacement component has passed implementation review, automated testing, security review, compatibility verification, documentation, and rollback testing.

## Project goals

- Preserve the working V1 baseline and maintain a tested rollback route.
- Keep the public repository as the canonical source-code repository.
- Keep installation-specific deployment configuration in a separate private operations repository.
- Keep secrets in `.env` files or the production host's secret-management environment.
- Replace permissive configuration with strict, validated, fail-closed configuration.
- Remove Discord-triggered shell execution and other remote-code-execution paths.
- Restrict RCON access to validated, allowlisted operations.
- Centralize authorization, input validation, logging, and error handling.
- Build trusted registries for players, creatures, servers, and supported operations.
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

- [ ] Create `docs/V2_THREAT_MODEL.md`.
- [ ] Create `docs/V2_ARCHITECTURE.md`.
- [ ] Document trust boundaries and privileged operations.
- [ ] Identify Discord, configuration, database, RCON, deployment, and dependency threats.
- [ ] Document the target module boundaries and dependency direction.
- [ ] Define prohibited operations and fail-closed behavior.
- [ ] Record security and compatibility assumptions.

Exit criteria:

- Major assets, actors, entry points, threats, mitigations, and residual risks are documented.
- The target architecture assigns each privileged operation to a defined module.
- No production behavior has changed.

## Phase 2: Configuration foundation

- [ ] Define a typed configuration schema.
- [ ] Validate all required values at startup.
- [ ] Reject malformed IDs, ports, booleans, paths, and server definitions.
- [ ] Separate public defaults from private deployment configuration.
- [ ] Prevent ambiguous mock/live mode states.
- [ ] Redact secrets from logs and error output.
- [ ] Add configuration validation tests.
- [ ] Document migration from the V1 configuration format.

Exit criteria:

- Invalid or incomplete production configuration fails closed.
- Mock mode and live mode cannot be confused.
- No secret value is committed or logged.

## Phase 3: Remove dangerous execution paths

- [ ] Remove Discord-triggered shell execution.
- [ ] Remove or replace `/updatebot`.
- [ ] Audit all uses of process execution and dynamic command construction.
- [ ] Restrict RCON to allowlisted operations.
- [ ] Separate command creation from command transport.
- [ ] Add injection and authorization tests.
- [ ] Document the secure deployment update process.

Exit criteria:

- Discord input cannot trigger arbitrary operating-system commands.
- User-controlled text cannot alter the structure of an RCON command.
- Every privileged operation is explicitly authorized and validated.

## Phase 4: Central authorization and validation

- [ ] Centralize role and permission checks.
- [ ] Centralize Discord interaction validation.
- [ ] Define authorization policies by feature and operation.
- [ ] Normalize and validate player, server, creature, and request identifiers.
- [ ] Prevent stale, replayed, or duplicate interactions.
- [ ] Add authorization and negative-path tests.

## Phase 5: Trusted registries

- [ ] Create a trusted player registry.
- [ ] Create a trusted creature registry.
- [ ] Store DLC metadata and usage warnings.
- [ ] Create a trusted server and map registry.
- [ ] Define versioned data formats.
- [ ] Validate registry data during startup.
- [ ] Add migration and compatibility tests.

## Phase 6: Secure interaction and fulfillment workflow

- [ ] Use server-side interaction tokens.
- [ ] Add request expiration.
- [ ] Add idempotency protection.
- [ ] Require explicit fulfillment confirmation.
- [ ] Mask EOS IDs in Discord logs.
- [ ] Preserve the confirmed AAT fulfillment contract.
- [ ] Clearly display scanning delays and DLC restrictions.
- [ ] Add mock, failure, retry, and duplicate-request tests.

## Phase 7: Database migrations and recovery

- [ ] Introduce a schema-version table.
- [ ] Add ordered, transactional migrations.
- [ ] Back up the database before migration.
- [ ] Validate database integrity before and after migration.
- [ ] Test restoration using a copied database.
- [ ] Define retention and privacy rules.
- [ ] Document recovery and rollback procedures.

## Phase 8: Logging and operational visibility

- [ ] Centralize structured application logging.
- [ ] Redact tokens, passwords, PINs, and full EOS IDs.
- [ ] Add correlation and request IDs.
- [ ] Unify ticket and fulfillment audit conventions.
- [ ] Build resilient paginated dashboards.
- [ ] Restore dashboards after restart or message deletion.
- [ ] Document operator diagnostics.

## Phase 9: Feature contracts and modularization

- [ ] Define feature manifests.
- [ ] Define feature flags and dependencies.
- [ ] Establish stable service interfaces.
- [ ] Move feature code out of the monolithic entry point.
- [ ] Support independently testable modules.
- [ ] Document extension and contribution patterns.

## Phase 10: CI and release controls

- [ ] Add syntax and static validation.
- [ ] Add unit and integration tests.
- [ ] Add clean-install verification.
- [ ] Add secret scanning.
- [ ] Add dependency review.
- [ ] Add protected-branch and pull-request controls.
- [ ] Produce reproducible release artifacts.
- [ ] Create release and rollback checklists.

## Phase 11: Staged rollout

- [ ] Deploy to the test environment.
- [ ] Run Discord workflows in mock mode.
- [ ] Run controlled live RCON tests.
- [ ] Verify authorization and failure behavior.
- [ ] Verify database backup and restoration.
- [ ] Exercise the rollback procedure.
- [ ] Observe the staged release before wider deployment.
- [ ] Record acceptance evidence.

## Phase 12: Post-release cleanup

- [ ] Remove obsolete V1 code and configuration.
- [ ] Remove deprecated commands and compatibility shims.
- [ ] Update public setup and feature documentation.
- [ ] Verify third-party dependency and license obligations.
- [ ] Archive superseded migration and rollout notes.
- [ ] Complete the final security and compatibility review.

## Compatibility requirements

V2 must preserve or deliberately migrate these workflows:

- Persistent Discord panels
- In-game-name records
- Vault PIN management
- Shop catalog search
- Support tickets and ticket logs
- Dino catalog browsing and search
- DLC metadata and warnings
- Dino fulfillment confirmation
- Mock-mode testing
- Live RCON fulfillment
- AAT cryopod delivery
- SQLite-backed persistence
- Paginated operational dashboards

Any intentional incompatibility must include migration instructions and rollback notes.

## Current checkpoint

- Date: 2026-11-05
- Branch: `rebuild/v2-foundation`
- Last commit: `bab3648` (`Approve sqlite3 install script`)
- Milestone: V2 foundation and documentation
- Current task: Establish the documented V2 roadmap, threat model, and architecture before changing production behavior.
- Status: In progress

### Completed work

- Confirmed the public baseline at `e4f306a`.
- Created and pushed `rebuild/v2-foundation`.
- Confirmed Node.js `v24.22.1` and npm `11.19.1`.
- Installed the existing dependency set.
- Confirmed all five direct dependencies are present.
- Confirmed npm reports zero known vulnerabilities.
- Reviewed and approved the `sqlite3@6.0.1` install script.
- Committed and pushed the approval as `bab3648`.
- Confirmed the branch tracks `origin/rebuild/v2-foundation`.
- Confirmed no existing roadmap, threat-model, or architecture document is present.
- Confirmed the existing documentation style in `docs/FEATURES.md` and `docs/SETUP.md`.

### Tests and verification

- `npm.cmd install`
- `npm.cmd ls --depth=0`
- `npm.cmd install-scripts ls`
- `git diff --check`
- `git status --short`
- `git status -sb`
- `git log -1 --oneline`

All completed checks passed.

### Known failures and gaps

- `docs/V2_ROADMAP.md` did not previously exist.
- `docs/V2_THREAT_MODEL.md` does not yet exist.
- `docs/V2_ARCHITECTURE.md` does not yet exist.
- The private V1 backup, baseline tag, and integrity evidence still require documentation or verification.
- No production behavior has been changed on this branch.

### Compatibility and security notes

- The SQLite install-script approval is pinned to `sqlite3@6.0.1`.
- The dependency deprecation warning originates from the SQLite dependency chain and did not cause installation failure.
- No secrets or production configuration values were added.
- V1 behavior remains unchanged.
- The working tree was clean before creation of this document.

### Changed files for this checkpoint

- `package.json`
- `docs/V2_ROADMAP.md`

### Next exact step

Validate `docs/V2_ROADMAP.md`, commit it separately, and push the checkpoint. Then create `docs/V2_THREAT_MODEL.md` without changing production behavior.

### Rollback point

Reset the branch to commit `bab3648` to return to the verified state immediately before creation of the V2 roadmap.