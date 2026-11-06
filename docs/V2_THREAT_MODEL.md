# Ticketbot V2 threat model

This document records security threats, existing controls, required mitigations, verification requirements, and residual risks for Ticketbot V2.

It is based on the V1 code reviewed on the `rebuild/v2-foundation` branch. It does not claim that a mitigation exists unless the reviewed code currently implements it.

## Scope

The threat model covers:

- Discord interactions and authorization
- Discord tokens and configuration
- Operating-system command execution
- ARK RCON connectivity and commands
- Dino fulfillment
- SQLite data
- Player and moderator identities
- Creature and server configuration
- Deployment and update workflows
- Dependencies, backups, logs, and runtime files

## Security objectives

Ticketbot V2 must:

- Prevent Discord input from reaching arbitrary operating-system execution.
- Prevent untrusted input from changing the structure of an RCON command.
- Permit privileged actions only after centralized authorization.
- Fail closed when live-mode configuration is missing, malformed, or ambiguous.
- Prevent replayed or duplicate fulfillment.
- Protect Discord tokens, RCON credentials, PINs, EOS IDs, and operational data.
- Preserve a complete but appropriately redacted audit trail.
- Keep test, mock, and production behavior clearly separated.
- Preserve a tested rollback route.

## Assets

### Secrets

- Discord bot token
- RCON passwords
- Deployment credentials
- Host access credentials
- Any future interaction-signing or service tokens

### Privileged capabilities

- Operating-system command execution
- RCON access
- Creature fulfillment
- Discord command registration
- Ticket completion and closure
- PIN administration
- Application deployment and restart
- Database migration and restoration

### Sensitive data

- Vault PINs
- Discord user and moderator IDs
- Discord usernames
- In-game names
- EOS IDs
- Ticket history
- Fulfillment history
- Server names and network locations
- RCON responses and errors
- Runtime logs and backups

### Availability assets

- Discord bot process
- SQLite database
- Discord panels and dashboards
- ARK server connectivity
- Ticket and fulfillment workflows
- Deployment and rollback processes

## Actors

### Authorized actors

- Repository maintainers
- Deployment operators
- Discord owner
- Configured staff members
- Configured fulfillment moderators
- Ordinary Discord members
- ARK players

### Untrusted or partially trusted actors

- Unauthorized Discord members
- Compromised Discord accounts
- Compromised moderator or owner accounts
- Malicious or mistaken operators
- Malicious dependency publishers
- Attackers with access to runtime files
- Untrusted Discord interaction data
- Untrusted RCON responses
- Malformed configuration and catalog data

## Trust boundaries

### Discord to Ticketbot

Discord supplies commands, button actions, select-menu values, modal input, identity information, roles, guild context, channel context, and message context.

All Discord data must be treated as untrusted until authorization and validation succeed.

### Ticketbot to the operating system

The V1 `/updatebot` path crosses from a Discord interaction into shell execution through `child_process.exec()`.

This boundary must not remain available through Discord in V2.

### Ticketbot to ARK RCON

RCON can perform privileged operations on ARK servers. Command structure, target server, player identity, creature identity, and operation type must be established from trusted server-side registries and allowlisted builders.

### Ticketbot to SQLite

SQLite stores application state and sensitive operational records. Database access must use parameterized values, controlled migrations, backups, integrity checks, and restrictive filesystem permissions.

### Configuration to runtime

Environment variables and configuration files determine tokens, IDs, roles, channels, RCON endpoints, passwords, mock mode, and update behavior.

Configuration must be validated before the bot connects to Discord or RCON.

### Public repository to private deployment

The public repository contains source code and public-safe examples. Installation-specific configuration, secrets, runtime data, databases, logs, and backups must remain outside the public repository.

## Existing controls observed in V1

The reviewed V1 code includes these useful controls:

- Dino fulfillment requires the configured moderator role.
- Fulfillment sessions expire after a defined period.
- Fulfillment request IDs use `crypto.randomUUID()`.
- The selected player is checked again for online status before fulfillment.
- EOS IDs must contain exactly 32 hexadecimal characters.
- Creatures must exist in the trusted catalog.
- Creatures must be enabled and approved as tameable.
- Blueprint paths must match a restrictive validation pattern.
- Delivery modes and gender choices are validated.
- RCON passwords are obtained indirectly from named environment variables.
- RCON commands use a timeout.
- Reviewed SQL values use placeholders.
- Fulfillment log request IDs have a unique database constraint.
- Mock player identities use example values rather than production data.
- RCON ports are checked for the valid TCP port range.

These controls must be preserved or strengthened during V2 work.

## Threat register

## T01: Discord-triggered operating-system command execution

### Evidence

The V1 `/updatebot` command reads `UPDATE_SCRIPT_PATH` and passes it to `child_process.exec()`. An owner-ID comparison is performed before execution.

### Threat

A compromised owner account, Discord token, environment value, deployment configuration, or application path could cause operating-system commands to run with the bot process's permissions. Shell interpretation also increases the effect of configuration mistakes or injection.

### Required mitigation

- Remove Discord-triggered shell execution.
- Remove or replace `/updatebot`.
- Perform deployment through a separate authenticated operator workflow.
- Do not expose a general shell-execution service to application features.
- Run the bot with a dedicated, minimally privileged operating-system account.
- Document the deployment and rollback procedure.

### Verification

- Static search finds no Discord handler reaching `exec`, `spawn`, `execFile`, or equivalent shell execution.
- An automated test confirms `/updatebot` is absent or safely rejected.
- Deployment succeeds without Discord-triggered shell access.
- Rollback is tested separately from Discord.

### Residual risk

A deployment operator or compromised host may still execute commands outside Ticketbot. Host controls and access management must address that risk.

## T02: General-purpose RCON command execution

### Evidence

`executeRconCommand(server, command)` accepts a command string and sends it directly with `client.send(command)`. The function is exported for other modules.

### Threat

A caller could bypass the validated AAT command builder and send an unintended or dangerous RCON command. Future code could accidentally concatenate user-controlled text into the command.

### Required mitigation

- Make the raw RCON transport internal or inaccessible to feature modules.
- Expose only named, allowlisted operations.
- Build each RCON command from typed, validated server-side values.
- Prohibit raw command strings from Discord handlers.
- Validate target servers against a trusted registry.
- Add negative tests for separators, quotes, control characters, and unsupported operations.

### Verification

- Static analysis confirms feature modules cannot call a raw command interface.
- Tests prove malformed targets and unsupported operations are rejected.
- Tests prove Discord input cannot alter command structure.
- The approved AAT fulfillment contract is preserved.

### Residual risk

The ARK server or RCON library may behave unexpectedly despite a valid command. Test-server validation and constrained credentials remain necessary.

## T03: Duplicate or replayed fulfillment

### Evidence

The V1 confirmation handler creates a new UUID, performs fulfillment, and inserts the unique request ID into SQLite afterward.

### Threat

Repeated button delivery, concurrent handling, retries, process interruption, or deliberate replay may execute fulfillment more than once. The unique database constraint protects log insertion but does not prevent an RCON command that has already executed.

### Required mitigation

- Create a server-side fulfillment request before execution.
- Use explicit states such as pending, executing, succeeded, partially succeeded, failed, and expired.
- Atomically claim a pending request before sending RCON.
- Bind the request to moderator, guild, channel, message, server, player, and creature.
- Reject repeated, expired, completed, or mismatched confirmations.
- Disable or replace confirmation components after claim.
- Define safe retry rules for partial execution.

### Verification

- Repeated confirmation causes one fulfillment only.
- Concurrent confirmation causes one execution only.
- A restart during fulfillment results in a reviewable state.
- Partial pair delivery does not silently repeat the successful command.
- Expired and mismatched requests are rejected.

### Residual risk

RCON may accept a command while the network response is lost. Reconciliation and operator review are required for uncertain outcomes.

## T04: Authorization bypass

### Evidence

Dino fulfillment checks for `DINO_FULFILLMENT_ROLE_ID`. `/updatebot` compares the interaction user ID with `OWNER_ID`.

### Threat

Missing or malformed configuration, inconsistent feature-specific checks, stale Discord role state, or a compromised privileged account could permit unauthorized actions.

### Required mitigation

- Centralize authorization policies.
- Validate all configured Discord IDs at startup.
- Define required guild and channel context.
- Fail closed if an authorization setting is missing.
- Recheck authorization immediately before each privileged operation.
- Audit denied and successful privileged actions without storing unnecessary sensitive data.

### Verification

- Missing role or owner configuration prevents startup or disables the affected feature safely.
- Users without required roles cannot reach privileged operations.
- Privilege removal takes effect before confirmation.
- Cross-guild, cross-channel, and direct-message attempts are rejected.

### Residual risk

A fully compromised authorized Discord account can still request allowed operations. Confirmation, rate controls, and audit logs reduce the impact.

## T05: Session confusion and state substitution

### Evidence

Fulfillment sessions are stored in memory and retrieved using the Discord user ID.

### Threat

Concurrent workflows, old messages, other guilds, other channels, or manipulated component interactions may reuse or replace state unexpectedly.

### Required mitigation

- Use opaque server-side session tokens.
- Bind sessions to user, guild, channel, message, feature, and intended operation.
- Apply short expiration.
- Make state transitions explicit and one-way.
- Delete or invalidate sessions after cancellation, completion, failure, or expiration.
- Reject component values not issued by the current session.

### Verification

- Two simultaneous workflows for one moderator cannot overwrite each other.
- Components from another message, channel, guild, or user are rejected.
- Expired and completed sessions cannot be reused.

### Residual risk

Discord may deliver delayed interactions. Explicit expiration and state checks must handle them safely.

## T06: Unsafe live/mock-mode selection

### Evidence

Mock mode is enabled only when `ARK_RCON_MOCK`, converted to lowercase, equals `true`. Other values result in live behavior.

### Threat

A missing, misspelled, malformed, or stale value may place the bot in live mode unintentionally.

### Required mitigation

- Require an explicit deployment mode value.
- Accept only documented enumerated values.
- Fail startup for missing or unknown mode.
- Require complete live RCON configuration before live mode.
- Display the active mode prominently in startup logs and staff panels.
- Prevent test-only servers from being used in production mode unless explicitly approved.

### Verification

- Missing and malformed modes fail startup.
- Test and production configuration cannot be mixed accidentally.
- Mock mode never opens an RCON connection.
- Live mode cannot start with example or incomplete configuration.

### Residual risk

An operator may deliberately choose the wrong valid mode. Deployment review and environment-specific controls remain necessary.

## T07: Configuration tampering or ambiguity

### Evidence

Configuration is spread across environment variables and JavaScript server definitions. Port validation exists, but comprehensive startup validation is not centralized.

### Threat

Malformed IDs, duplicate server IDs, unsafe hosts, missing passwords, invalid channels, or contradictory feature settings may produce insecure or unpredictable behavior.

### Required mitigation

- Introduce a typed, centralized configuration loader.
- Validate every required value before Discord login.
- Reject duplicate IDs and undefined references.
- Separate public schema, public examples, and private deployment values.
- Redact secret values from validation errors.
- Produce a safe configuration summary for operators.

### Verification

- Automated tests cover missing, malformed, duplicate, and contradictory configuration.
- The bot does not connect to Discord or RCON after validation failure.
- Error output names the invalid field without printing its secret value.

### Residual risk

A syntactically valid but operationally incorrect endpoint may still be configured. Staged connectivity checks are required.

## T08: Sensitive SQLite data exposure

### Evidence

The database contains PINs, Discord identities, in-game names, ticket records, EOS IDs, moderator identities, fulfillment status, and serialized fulfillment results.

### Threat

Host access, overly broad filesystem permissions, accidental Git inclusion, backups, logs, or support bundles could expose sensitive data.

### Required mitigation

- Keep databases and backups outside Git.
- Apply restrictive filesystem ownership and permissions.
- Minimize stored fields.
- Mask EOS IDs in Discord output and general logs.
- Define retention and deletion rules.
- Avoid storing sensitive values in unrestricted serialized result objects.
- Protect backups equivalently to the live database.
- Document privacy and recovery procedures.

### Verification

- Git ignores runtime databases, journals, backups, and logs.
- Secret scans and repository checks find no runtime data.
- Discord dashboards do not display full EOS IDs.
- Backup and restore tests preserve permissions and integrity.
- Retention behavior is tested.

### Residual risk

The application must access operational data while running. Host compromise may expose data available to the bot process.

## T09: Database corruption and unsafe schema changes

### Evidence

V1 creates and alters application tables during startup without a dedicated schema-version migration framework.

### Threat

Interrupted schema changes, incompatible versions, concurrent startup, or deployment mistakes could corrupt data or prevent rollback.

### Required mitigation

- Add a schema-version table.
- Use ordered transactional migrations.
- Back up before migration.
- Verify database integrity before and after migration.
- Stop startup on migration failure.
- Test restoration and backward-compatibility boundaries.
- Never test migrations first against the only production database.

### Verification

- Migrations run once and in order.
- Interrupted migrations roll back or produce a documented recoverable state.
- Restoration from the pre-migration backup is tested.
- Unsupported schema versions fail closed.

### Residual risk

Filesystem or hardware failure can still damage both database and local backups. Separate backup storage is required.

## T10: Secret disclosure through output and errors

### Evidence

Update output and errors are returned through Discord. RCON and fulfillment errors are retained or displayed in several paths.

### Threat

Commands, paths, server details, credentials embedded in errors, player identifiers, or dependency output may be exposed to Discord users or logs.

### Required mitigation

- Centralize error handling and redaction.
- Return stable user-safe error codes through Discord.
- Keep detailed diagnostics in restricted operator logs.
- Never print tokens, passwords, complete EOS IDs, PINs, or environment values.
- Limit and sanitize external process and RCON output.

### Verification

- Tests inject secret-like values into errors and confirm they are redacted.
- Discord responses contain safe summaries only.
- Logs mask sensitive identifiers consistently.

### Residual risk

Unexpected third-party errors may contain sensitive values. Default-deny redaction and restricted log access are necessary.

## T11: Dependency and install-script compromise

### Evidence

The project uses npm dependencies, including a native SQLite package with an install script. The reviewed SQLite install-script approval is pinned to `sqlite3@6.0.1`.

### Threat

A compromised package, maintainer account, transitive dependency, native build, or install script could execute code during development, CI, or deployment.

### Required mitigation

- Commit and review the lockfile.
- Keep install-script approvals pinned and reviewed.
- Run dependency review and secret scanning in CI.
- Use clean, isolated build environments.
- Review updates before changing approved versions.
- Produce documented dependency and license inventories.

### Verification

- Clean installation succeeds from the lockfile.
- CI reports newly introduced install scripts and dependency changes.
- Unreviewed approval changes block release.
- Known vulnerabilities are reviewed before release.

### Residual risk

A trusted package version may still contain unknown vulnerabilities. Updates, isolation, and monitoring remain necessary.

## T12: Catalog or blueprint manipulation

### Evidence

The AAT command builder validates blueprint paths and requires creatures to be enabled, tameable, and assigned a supported delivery mode.

### Threat

A malicious or mistaken catalog edit could authorize an unintended creature, blueprint, saddle behavior, gender mode, or DLC classification.

### Required mitigation

- Treat the creature catalog as trusted reviewed code or versioned data.
- Validate the complete catalog at startup.
- Require unique IDs and controlled blueprint syntax.
- Review catalog changes through pull requests.
- Record catalog version information with fulfillment logs.
- Test representative DLC, gendered, genderless, unsupported, and disabled entries.

### Verification

- Invalid catalog records fail startup.
- Duplicate IDs are rejected.
- Unsupported or disabled creatures cannot produce commands.
- Catalog changes produce a clear reviewable diff.

### Residual risk

A syntactically valid but incorrect blueprint may pass validation. Test-server verification is required for new entries.

## T13: RCON transport and response uncertainty

### Evidence

RCON uses TCP, a configured password, event-based responses, and a timeout.

### Threat

Network interception, timeout, partial response, server impersonation, or uncertain command completion could lead to credential or fulfillment risk.

### Required mitigation

- Restrict RCON network reachability.
- Use dedicated credentials and least available privilege.
- Keep the bot and ARK servers on controlled networks.
- Treat timeouts as uncertain outcomes rather than definite failures when appropriate.
- Avoid automatic retries for non-idempotent operations.
- Record correlation IDs and operator-review states.

### Verification

- Network policy permits RCON only from approved hosts.
- Timeout tests do not automatically repeat fulfillment.
- Unavailable servers are reported without exposing credentials.
- Recovery procedures cover uncertain outcomes.

### Residual risk

The RCON protocol and server implementation may not provide strong transport security or transaction guarantees. Network isolation remains essential.

## T14: Logging, audit, and repudiation gaps

### Threat

Without centralized structured audit records, an operator may be unable to determine who initiated a privileged action, what validation occurred, which command operation was selected, or whether an action completed.

### Required mitigation

- Use structured audit events.
- Include request ID, actor ID, operation, target server, masked player identifier, catalog entry, result state, and timestamps.
- Separate security audit events from general diagnostics.
- Make logs append-oriented and access-controlled.
- Record partial and uncertain outcomes explicitly.

### Verification

- Every privileged operation produces one correlated audit trail.
- Failed authorization and validation attempts are recorded safely.
- Dashboard deletion or bot restart does not destroy underlying audit data.

### Residual risk

An attacker with sufficient host or database privileges may alter local records. Off-host logging may be considered for higher assurance.

## Prohibited V2 design patterns

V2 must not introduce or retain:

- Discord-triggered shell commands
- General-purpose RCON commands exposed to feature handlers
- Direct concatenation of user input into shell, SQL, or RCON commands
- Silent fallback from invalid configuration to live production behavior
- Secrets committed to Git
- Full EOS IDs in ordinary Discord logs
- Automatic retry of uncertain non-idempotent fulfillment
- Production database migration without a verified backup
- Authorization checks performed only at the beginning of a long workflow
- Privileged actions without a correlated audit record

## Required security test categories

V2 security testing must include:

- Authorization tests
- Cross-guild and cross-channel interaction tests
- Session replay and expiration tests
- Concurrent duplicate-confirmation tests
- RCON injection tests
- Blueprint and EOS validation tests
- Mock/live configuration tests
- Missing-secret and malformed-configuration tests
- Database migration and restoration tests
- Secret-redaction tests
- Dependency and install-script review
- Rollback testing
- Negative-path and partial-failure testing

## Security acceptance criteria for production rollout

Production rollout must not proceed until:

- Discord cannot trigger operating-system shell execution.
- Features cannot send arbitrary RCON commands.
- Configuration fails closed.
- Duplicate fulfillment is prevented before RCON execution.
- Authorization is centralized and tested.
- Sessions are server-side, scoped, expiring, and single-use.
- Sensitive logs and Discord output are redacted.
- Database migrations and restoration are tested.
- Test, mock, and production modes are unambiguous.
- CI security checks pass.
- A staged rollback exercise succeeds.

## Current risk posture

The V1 code includes meaningful validation around the dino fulfillment command builder, creature catalog, player-online check, moderator role, SQL parameters, and RCON timeout.

The most urgent V2 risks are:

1. Discord-triggered shell execution
2. General-purpose raw RCON execution
3. Fulfillment idempotency occurring after command execution
4. Ambiguous fail-open live/mock configuration
5. Sensitive SQLite and log data
6. Distributed authorization and configuration validation

No production behavior should change until the architecture document assigns these mitigations to explicit modules and interfaces.

## Review checkpoint

- Date: 2026-11-05
- Branch: `rebuild/v2-foundation`
- Starting commit: `9e550d7`
- Scope: Documentation and threat analysis only
- Production behavior changed: No
- Next step: Validate this threat model, update the roadmap checkpoint, commit both documents, and then create `docs/V2_ARCHITECTURE.md`.
- Rollback point: `9e550d7`
