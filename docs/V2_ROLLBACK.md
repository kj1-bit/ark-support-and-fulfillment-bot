# Ticketbot V2 rollback and recovery plan

This document defines the required rollback, recovery, and evidence procedures for Ticketbot V2. It is designed to preserve the verified V1 baseline, prevent data loss, avoid duplicate fulfillment, and ensure that releases, configuration, database migrations, catalogs, and service definitions can be restored independently.

## Status and scope

- Repository: `kj1-bit/ark-support-and-fulfillment-bot`
- Branch: `rebuild/v2-foundation`
- Starting checkpoint: `4f96cac` (`Document V2 repository and configuration boundaries`)
- Scope: documentation and rollback planning only
- Production behavior changed: no

This plan covers:

- Source and release rollback
- Private V1 recovery
- Configuration rollback
- SQLite backup, migration, and restoration
- Creature catalog rollback
- Service-manager rollback
- Discord registration and panel recovery
- Partial or uncertain fulfillment
- Test, staging, and production acceptance evidence

## Safety rules

1. Never test a migration or restoration first against the only production database.
2. Never delete or overwrite the last known-good release, configuration, database backup, or catalog version.
3. Never use `git reset --hard`, `git clean`, destructive database commands, or recursive deletion until the affected paths and rollback evidence have been reviewed.
4. Never retry a non-idempotent fulfillment automatically after a timeout or uncertain response.
5. Never expose secrets, PINs, full EOS IDs, private configuration, or backup contents in Git, Discord, screenshots, or ordinary logs.
6. Never perform deployment or rollback through Discord or `/updatebot`.
7. Stop or quiesce writers before copying or restoring SQLite data.
8. Treat rollback as incomplete until health, compatibility, data integrity, panels, and audit evidence are verified.
9. Preserve failed-release evidence separately from the active runtime so it can be reviewed without blocking restoration.
10. Use the smallest rollback scope that safely restores service.

## Verified V1 recovery anchors

### Private V1 Git baseline

The verified private V1 source baseline is:

- Tag: `v1-private-baseline`
- Commit: `a52558e83b81a6710848c16c03acb0509cdb4583`
- Tag description: `Last private V1 state before V2 rebuild`
- Local `HEAD`, `origin/main`, the local tag, and the remote peeled tag were verified at the same commit.

### Encrypted private V1 archive

The verified encrypted archive is:

- Filename: `ticketbot-v1-private-baseline-20261104-encrypted.7z`
- Size: 42,770 bytes
- SHA-256: `A1DE4A9E5B2034184E4FB47E539C3997771F3B36C6DE20539D5DD005C986CDD4`
- Copies: one local Windows copy and one OneDrive-synchronized copy
- Password verification: the archive was previously opened successfully

The public repository records only the filename, size, hash, and verification status. The password and archive contents remain outside Git.

### Public V2 foundation rollback point

The current public documentation baseline before this document is:

- Branch: `rebuild/v2-foundation`
- Commit: `4f96cac1faa22dde162d2953a566639645f65349`
- Commit message: `Document V2 repository and configuration boundaries`

## Rollback levels

### Level 0: Abort before activation

Use when validation fails before any release, configuration, database, catalog, Discord registration, or service change becomes active.

Actions:

- Do not activate the proposed change.
- Keep the current release and runtime data untouched.
- Save validation output and failed-check evidence.
- Restore only modified working-copy files if necessary.

No production interruption should occur.

### Level 1: Application release rollback

Use when application code or release packaging fails but configuration and database remain compatible.

Restore:

- Previous release artifact or exact reviewed commit
- Previous lockfile and approved dependency state
- Previous service entry point if changed

Do not restore the database unless the release changed schema or data incompatibly.

### Level 2: Configuration rollback

Use when a validated configuration change causes startup, authorization, routing, feature, or server-selection failure.

Restore:

- Previous known-good configuration bundle
- Previous feature flags
- Previous server and capability mappings
- Previous secret-reference names, without copying secret values into evidence

Restart only after the restored configuration validates successfully.

### Level 3: Catalog rollback

Use when a creature catalog update passes syntax validation but fails review, test-server verification, activation, search, DLC warnings, or fulfillment compatibility.

Restore:

- Previous known-good catalog version
- Previous catalog manifest and checksum
- Previous active-version pointer

Do not modify fulfillment records that already reference the failed version. Preserve their catalog-version references for audit.

### Level 4: Database restoration

Use when a migration, application write, filesystem event, or schema incompatibility damages or invalidates runtime data.

Restore:

- Pre-migration database backup
- Matching application release
- Matching validated configuration
- Matching migration/schema expectations

A database must never be restored while the application can still write to it.

### Level 5: Full V1 restoration

Use when V2 cannot be made safe or compatible within the approved recovery window.

Restore:

- Private V1 source at `v1-private-baseline`
- V1-compatible configuration and secrets from approved host storage
- V1-compatible database backup
- V1 service definition
- V1 Discord command and panel behavior where registration changed

The encrypted baseline archive is disaster-recovery evidence, not the first-line deployment mechanism.

## Required release checkpoint bundle

Before any staged or production activation, record a release checkpoint containing:

- Release version, tag, and full commit SHA
- Artifact filename and SHA-256
- Node.js and npm versions
- Lockfile checksum
- Approved install-script state
- Configuration schema version
- Redacted configuration-validation result
- Database path classification, schema version, integrity result, backup filename, and backup checksum
- Active catalog version and checksum
- Service-manager definition version
- Enabled features
- CI result references
- Compatibility, security, migration, recovery, and rollback test results
- Previous known-good release, database, configuration, and catalog references
- Operator and timestamp

The checkpoint must not contain secret values, full EOS IDs, PINs, or private backup contents.

## Pre-deployment procedure

1. Confirm the intended branch, tag, and full commit SHA.
2. Confirm the working tree and release process use reviewed committed content only.
3. Run clean dependency installation from the lockfile.
4. Verify approved install scripts have not changed.
5. Run syntax, unit, integration, security, compatibility, migration, catalog, and recovery checks.
6. Scan for secrets and prohibited private values.
7. Validate installation-specific configuration without starting Discord or RCON.
8. Confirm the deployment mode is explicitly `mock`, `test`, or `production`.
9. Confirm example configuration cannot activate in production.
10. Verify the current database integrity and schema version.
11. Stop or quiesce database writers before taking the pre-migration backup.
12. Create the backup outside the source repository.
13. Calculate and record the backup checksum.
14. Open and integrity-check a copied backup.
15. Record the current catalog version and checksum.
16. Retain the previous release artifact, configuration bundle, service definition, and catalog version.
17. Confirm rollback commands and file paths for the target host.
18. Confirm the operator can restore the previous service without Discord-triggered shell access.

If any required evidence is missing, deployment stops.

## Source and release rollback

### Preferred mechanism

Deploy immutable versioned release directories or artifacts and switch an external service pointer only after validation. Keep the previous version intact until the observation period and rollback exercise pass.

### Rollback sequence

1. Disable privileged operations or stop the new process.
2. Preserve redacted diagnostics from the failed release.
3. Determine whether schema or configuration changed.
4. Select the previous known-good release by exact tag or SHA.
5. Restore its matching dependency state and service entry point.
6. Restore matching configuration if required.
7. Restore the database only if compatibility requires it.
8. Start in the safest applicable mode.
9. Verify readiness and required V1 compatibility workflows.
10. Record rollback completion and unresolved issues.

Do not roll back only source code while leaving an incompatible migrated database active.

## Configuration rollback

### Configuration versioning

Each activated configuration bundle must have:

- Schema version
- Deployment mode
- Safe version identifier
- Checksum
- Activation time
- Previous known-good identifier

Secret values are referenced, not copied into tracked configuration.

### Configuration rollback sequence

1. Stop startup or disable affected privileged features.
2. Preserve the failed validation output with secrets redacted.
3. Restore the previous configuration bundle atomically.
4. Validate it against the matching schema.
5. Confirm required secrets are present without printing them.
6. Confirm server, role, channel, capability, feature, storage, and mode cross-references.
7. Restart and verify readiness.

Unknown, missing, or contradictory production-safety values must fail closed.

## SQLite backup and restore

### Backup requirements

A migration backup must be:

- Created while writers are stopped or safely quiesced
- Stored outside Git
- Timestamped and linked to the release checkpoint
- Protected like the live database
- Checksummed
- Integrity-tested from a copy
- Retained until rollback acceptance and retention policy permit removal

### Migration failure handling

If a transactional migration fails before commit:

- Stop startup.
- Confirm the transaction rolled back.
- Run integrity checks.
- Do not continue with later migrations.
- Preserve migration diagnostics.

If migration state is uncertain or committed data is incompatible:

- Stop all writers.
- Preserve the failed database separately.
- Restore the verified pre-migration backup to a new path.
- Verify its checksum, integrity, and schema.
- Activate the restored database atomically.
- Start the matching previous application release.

### Restore verification

After restoration, verify:

- SQLite integrity check passes
- Expected schema version is present
- Ticket numbering and active tickets are coherent
- PIN records remain available and are not logged
- In-game-name records remain available
- Panel metadata remains available
- Fulfillment audit records remain coherent
- Full EOS IDs remain protected
- Required dashboards can be rebuilt

Never overwrite the failed database before preserving it for controlled review.

## Creature catalog rollback

### Catalog version package

Each active catalog version must include:

- Catalog version
- Schema version
- Catalog checksum
- Validation result
- Human-reviewable change summary
- Approval status
- Test-server evidence for new or changed blueprints
- Previous known-good version

### Atomic activation

Activation must:

1. Stage the proposed version separately.
2. Validate the complete catalog.
3. Generate and review the change report.
4. Retain the active known-good version.
5. Replace the active reference atomically.
6. Record activation in the audit store.

### Rollback sequence

1. Disable new fulfillment requests if catalog correctness is uncertain.
2. Preserve the failed catalog and change report.
3. Atomically restore the previous known-good active reference.
4. Validate search, browsing, DLC warnings, and command-building compatibility.
5. Do not rewrite historical fulfillment records to a different catalog version.
6. Record rollback and reason.

A catalog rollback must never expose arbitrary file paths, raw blueprint execution, shell access, or raw RCON commands through Discord.

## Fulfillment partial and uncertain outcomes

### Required behavior

- `PARTIAL` means at least one separately recorded operation succeeded and at least one did not complete successfully.
- `UNCERTAIN` means transport or process failure prevents reliable determination of whether an operation executed.
- Neither state is automatically retried.
- A successful member of a pair is never repeated silently.

### Operator review

The operator uses the request ID and correlated audit records to review:

- Actor and authorization decision
- Server and masked player identity
- Creature ID and catalog version
- Intended operation list
- Per-operation state and timestamps
- RCON response or timeout classification

Any compensating action must create a new explicitly authorized request linked to the original. It must not reuse the original confirmation token or idempotency key.

Rollback of application or database state does not undo a creature already delivered by an ARK server.

## Service-manager rollback

Service definitions belong in the private operations boundary.

Before activation, retain:

- Previous service definition
- Previous working directory or release pointer
- Previous environment/configuration references
- Previous process name and startup command
- Previous restart and health-check behavior

Rollback sequence:

1. Stop the failed service instance.
2. Restore the previous service definition and release pointer.
3. Reload the service manager if required.
4. Start the previous release.
5. Verify one expected process is running.
6. Verify configuration, database, Discord, panels, and enabled external operations.

Do not preserve `/updatebot` as a rollback mechanism.

## Discord command and panel recovery

### Command registration

Before changing registered commands, record the previous command manifest or release version. If registration causes incompatibility:

- Restore the command manifest from the matching known-good release.
- Re-register using the operator-controlled deployment process.
- Confirm removed privileged commands, especially `/updatebot`, are not reintroduced by V2 rollback unless performing a full approved V1 restoration.

### Panels and dashboards

SQLite remains authoritative. After restart or rollback:

- Restore or recreate required panels from persisted metadata.
- Rebuild paginated ticket and fulfillment dashboards from records.
- Confirm deleting a Discord message did not delete audit data.
- Confirm stale components cannot execute completed, expired, or mismatched sessions.

## Full V1 restoration

Use only after an explicit decision that V2 cannot remain active safely.

Required inputs:

- Verified private V1 Git tag and commit
- Verified V1-compatible database backup
- V1-compatible host configuration and secrets
- Previous service definition
- Previous Discord registration expectations

Procedure:

1. Stop V2 and preserve its database and redacted diagnostics.
2. Confirm the V1 source tag resolves to the verified commit.
3. Restore or deploy V1 from reviewed source or approved artifact.
4. Restore the matching V1-compatible database copy if required.
5. Restore V1 configuration and service definition from approved host/private storage.
6. Start V1 without changing the verified baseline tag.
7. Verify ticket, PIN, player-name, shop, panel, dashboard, mock, and controlled RCON behavior as applicable.
8. Record the restoration evidence and any V2 data created after cutover that requires later reconciliation.

Do not extract the encrypted archive into a public repository or shared location.

## Rollback rehearsal plan

### Documentation-only rehearsal

Before implementation begins:

- Verify all source, archive, hash, configuration-classification, and backup references.
- Walk through each rollback level and identify required host-specific inputs.
- Record missing tooling without changing production.

### Development rehearsal

Using disposable data:

- Start a known-good checkpoint.
- Introduce a controlled configuration failure and restore the previous configuration.
- Introduce an invalid catalog and confirm activation is rejected.
- Activate a safe catalog test version and roll back the active pointer.
- Run a migration against a copied database and restore the pre-migration copy.
- Start a new application checkpoint and restore the previous checkpoint.

### Test-environment rehearsal

- Deploy the candidate release in mock mode.
- Verify no RCON network activity occurs.
- Exercise migration and restoration using a copied V1 database.
- Recreate panels and dashboards after restart.
- Test repeated and concurrent fulfillment confirmation without sending live RCON.
- Test partial and uncertain operation handling with controlled substitutes.
- Roll back release, configuration, database, and catalog independently.

### Production readiness rehearsal

Before production cutover:

- Restore the previous release in the test environment using the exact production runbook.
- Restore a copied pre-migration database.
- Verify the previous known-good catalog.
- Verify service-manager restoration.
- Record elapsed times as observed evidence, without inventing an unsupported recovery target.
- Obtain explicit release approval.

## Rollback acceptance criteria

Rollback is accepted only when:

- The previous source or artifact is identifiable by exact version and checksum.
- The previous configuration validates without exposing secrets.
- Database backup integrity and restoration have been tested from a copy.
- Catalog activation and known-good rollback are tested.
- Service-manager restoration is tested.
- Discord command and panel recovery are documented and tested where applicable.
- Partial and uncertain fulfillment do not trigger automatic retry.
- Historical audit records retain their original release and catalog references.
- V1 compatibility checks pass after restoration.
- The restored service is ready, not merely running.
- Evidence is recorded and secrets remain redacted.

## Evidence template

Record the following for each rehearsal or real rollback:

```text
Date and operator:
Environment:
Reason:
Starting release/tag/SHA:
Target release/tag/SHA:
Configuration version/checksum:
Database schema before/after:
Backup filename/checksum:
Catalog version before/after:
Service definition version:
Rollback scope:
Commands or automation used:
Validation checks:
Compatibility checks:
Security checks:
Known failures:
Data requiring reconciliation:
Result:
Next action:
```

Never place secret values, passwords, tokens, PINs, full EOS IDs, or private archive contents in this evidence.

## Current gaps

- Host-specific release and service directories still require definition in the private operations repository.
- Automated database backup, restore, and migration tooling has not yet been implemented.
- Catalog version packaging and atomic activation tooling has not yet been implemented.
- Unified readiness checks and CI recovery tests have not yet been implemented.
- The rollback procedure has not yet been rehearsed in the test environment.
- GitHub milestones, issues, project board, branch protection, CI gates, and release tags still require creation or configuration.

## Current checkpoint

- Date: 2026-11-05
- Branch: `rebuild/v2-foundation`
- Starting commit: `4f96cac`
- Scope: rollback and recovery documentation only
- Production behavior changed: no
- Next exact step: commit this document with the corrected roadmap checkpoint, then create GitHub milestones, issues, and project tracking before accelerated implementation.
- Rollback point: `4f96cac`
