# Ticketbot V2 guide

This guide explains what V2 is designed to do, how its configuration is organized, how each feature behaves, and what must be ready before an isolated test deployment.

## First: understand the current status

V2's validated configuration, service composition, feature handlers, SQLite repositories and migrations, Discord interaction flows, retention, launcher, and tests are in the repository. The standalone launcher is `npm run start:v2` (or `node scripts/start-v2.js`):

- The root `index.js` still starts the existing V1 application.
- The launcher wires the SQLite database, validated catalog, Discord client, configured RCON transport, fulfillment command builder, backup provider, audit sink, and graceful signal shutdown into `src/composition/start-v2.js`.
- The launcher has focused mock-mode tests, but it has not been rehearsed on Debian or against a test Discord application and ARK server. Treat test/production connectivity and operational acceptance as unverified until the isolated test checklist is completed.

Do not point V2 at production Discord, live RCON, or a V1 database. The example configuration is for learning and validation, not a ready-to-run production instance. A merge of V2 code does not activate V2, change V1, register Discord commands, or migrate any database.

If you need to run the currently supported application, use the [V1 setup guide](SETUP.md). The [roadmap](V2_ROADMAP.md) tracks remaining V2 work.

## What V2 changes

V2 separates Discord presentation from application rules and persistence:

1. **Configuration** is read as JSON, validated (including feature-specific settings and secret presence), then deeply frozen. Invalid configuration stops before the database opens.
2. **Runtime composition** checks database integrity, makes a backup, applies ordered SQLite migrations, and constructs narrow application services.
3. **Feature handlers** translate real Discord button, select-menu, and modal interactions into validated service calls. Authorization is checked at the service boundary, not just by hiding a button.
4. **Repositories** persist tickets, trusted player associations, PIN requests, fulfillment requests, interaction sessions, catalog versions, log events, and dashboard message IDs.
5. **Adapters** contain Discord and SQLite boundaries and an allowlisted RCON operation service. `scripts/start-v2.js` supplies the concrete runtime wiring; the [Debian startup plan](V2_DEBIAN_STARTUP_PLAN.md) describes isolated staging and remaining operational validation.

The current SQLite schema version is **15**. Migrations are ordered and transactional. Runtime composition backs up an existing database before migration. Migration 012 adds private-channel metadata and a durable ticket counter without deleting existing tickets; migration 013 adds encrypted persistent Vault PINs. Migration 014 permits mock-only multiple private tickets with a per-row marker and retained ordinary uniqueness guard. Forward migration 015 adds remembered player identities and seeds existing trusted links without changing existing tables; released migrations 001-014 remain unchanged. Back up before upgrading: schema-14 binaries reject schema 15, requiring a pre-upgrade backup for rollback. Migration 004 preserves the legacy V1 `tickets` table as `tickets_v1_legacy`; it does not convert V1 ticket records into V2 tickets. Keep the pre-migration backup and restore it before rolling V1 back onto a migrated database.

## Feature guide

| Feature | What users/staff do | Important behavior |
| --- | --- | --- |
| Player names | **Set My In-Game Name** opens the name modal; staff use **Verify Player Name**, **Link Player** and **Unlink Player** on the same panel. | Player names must be verified before tickets or Vault PINs; verification is never automatic. Linking accepts remembered offline players or manual name/EOS entry. An existing link must be unlinked first. Fulfillment still requires a trusted player online at execution time. |
| Tickets | **Open Request** creates a numbered private channel under `ticketCategory`. Staff can **Claim Ticket**, mark **Ticket Completed**, archive with **Close Ticket** and **Reopen Ticket**. A separate staff-only **Open Tickets** panel in `ticketLogs` lists five nonclosed tickets per page with requester, assignment, channel link and numbered **Unclaim** buttons. There is no Legacy Ticket Management panel or lookup/action UI. | Only exact `runtime.mode: mock` permits multiple active requests per requester; all other modes enforce one, including concurrent creation/reopening. Mode switching preserves existing mock rows/channels but blocks additional creates/reopens while another is active. Requester or staff may close private requests; other actions are staff-only. Completed/legacy tickets remain listed until closed. Unclaim preserves completion and restores Claim Ticket. Debounced refresh, restart/deletion recovery, privacy checks and audits remain. Historical rows retain their states; already-closed rows keep retention eligibility. |
| PINs | **Get My Vault PIN** generates a four-digit PIN once, or retrieves the existing PIN, and privately DMs only the requesting player. Staff can **Generate Missing PINs** and **Reveal PINs Privately** from the staff-only directory. Custom PIN requests are retired. | Generated PINs stay encrypted at rest. The directory never contains codes; authorized private reveals use normal-message spoilers. Historical custom records retain existing expiry/retention. No PIN appears in process logs, activity or audit events. |
| Shop search | **Search In-Game Shop** opens a paged catalog-search modal. | Search results are informational; DLC warnings are shown when present. This searches V2's catalog, not a live F1 shop integration. |
| Player linking and fulfillment | **Link Player** selects a Discord member then a remembered player directly, or **Enter Player Manually**. **Unlink Player** selects a member then **Confirm Unlink** / Cancel. **Browse Dino Catalog** / **Search Dino** retain the separate live fulfillment wizard. | Linking never requires a map or online presence and never replaces an existing link. Fulfillment scans enabled, allowlisted servers, retains the selected reference's map, and revalidates online identity there. Confirmation uses a bound, single-use persisted token and checks the active catalog before execution. |
| Dashboards | Ticket logs have one line per ticket: `@Mud (Mud) opened a ticket, @Bob claimed the ticket, @Sam completed the ticket, @Alex closed the ticket.` Only the latest claim/unclaim phrase is shown, with the last actor; reopening resets old assignment/completion/closure phrases. PINs retain one directory with generation/private reveal and no activity tab. | Ticket pages contain up to ten tickets, newest-opened first, and auto-refresh after persisted lifecycle actions. Full audits/retention remain intact; partial histories are labelled rather than guessed. Staff-only authorization, no-ping mentions and private PIN protections remain enforced. |

These are V2 interaction contracts. They are not a claim that the current root V1 process handles them. V2 registers no slash commands: every flow starts from a standing panel button. If a Discord client still shows a retired V2 command, invoking it returns a private "This command has been replaced by the server panels" reply, logs the harmless `discord.slash_retired` event, and calls no application service.

## Discord setup planning

Prepare a **separate test application and test guild** before testing any V2 Discord behavior. Use Discord Developer Mode to copy the application, guild, role, and channel IDs. The runtime validates Discord IDs as snowflakes.

Configure only the features you intend to test. Enabled features have required roles, channels, dependencies, and (where relevant) secrets:

| Feature | Required Discord settings | Dependency or additional requirement |
| --- | --- | --- |
| `playerNames` | `roles.staff`, `channels.playerNames` | Provides verified names used by tickets and PINs. |
| `tickets` | `roles.staff`, `channels.requests`, `channels.ticketLogs`, `channels.ticketCategory` | Requires `playerNames`; the category must belong to the configured guild. |
| `pins` | `roles.staff`, `channels.vault`, `channels.pinsDashboard` | Requires `playerNames` and `PIN_PROTECTION_KEY` in every launcher mode. Enable Server Members Intent for bulk generation. |
| `shop` | `channels.requests` | Uses the active catalog/search service; restores a search-only panel if tickets are disabled. |
| `fulfillment` | `roles.fulfillmentModerator`, `channels.fulfillment`, `channels.fulfillmentLogs` | Requires at least one enabled server and its RCON credential outside mock mode. |
| `dashboards` | `roles.staff`, `channels.ticketLogs`, `channels.pinsDashboard`, `channels.fulfillmentLogs` | Fulfillment logs show concise staff, creature, outcome, target and relative time summaries; log channels remain staff-only. |

The example at `config/examples/instance.example.json` shows the complete configuration shape, including IDs for optional fields. Replace all example values with values from the test guild and test server before using it. Do not copy real IDs or secrets into tracked files.

The V1-style standing panels are posted only for enabled features. Saved messages are edited in place on ready and recreated when deleted. The bot needs View Channel, Send Messages, Read Message History, and Embed Links in panel channels. In the ticket category it also needs Manage Channels and Manage Roles (Manage Permissions) to create, archive, and delete private tickets; Manage Messages is not required. Every ticket explicitly denies `@everyone` visibility and grants requester, staff, and the bot access; closing replaces requester access with a deny and retains staff access. Keep the bot role high enough to manage the configured roles/channel overwrites.

Private catalog/fulfillment/linking/unlinking wizards expire after two minutes per step and must be restarted after a process restart. Catalog pages show 10 creatures; player menus show at most 25 choices per page with Previous/Next. Fulfillment player paging rescans all eligible maps; a map scan error fails visibly rather than hiding players. Ordering can change and departed players cannot be fulfilled; displayed-page bindings and the existing 1,000-reference cache/expiry remain enforced. Cancel before fulfillment review creates no delivery request; review Cancel consumes the existing bound cancellation token. Dismissing a search or manual-entry modal requires starting that flow again.

With `playerNames` enabled, remembered-player observation runs after startup and every three minutes, sequentially on enabled maps allowlisted for `listOnlinePlayers`. Live fulfillment scans also persist observations. Remembered identities survive restarts and remain available offline, newest first; the last observed name/map is updated by EOS ID. Map failures are logged without deleting remembered identities. Manual linking requires a valid 2-32 character in-game name and exactly 32 hexadecimal EOS characters. Both member and EOS uniqueness are checked before writing. To correct a mistake, **Unlink Player**, select the member, review the masked identity and **Confirm Unlink**, then use **Link Player** again. Unlink removes only the trusted association, leaving the submitted name and other records unchanged. See [staff identity management](V2_DISCORD_FULFILLMENT_ADAPTER.md#staff-identity-management).

Inline log channels must not be visible to ordinary roles. V2 checks their effective role permissions before rendering or paging and refuses to publish logs if it cannot verify privacy. Administrators retain Discord's inherent access. With PINs enabled the launcher requests the privileged Guild Members intent; enable **Server Members Intent** for the separate test application before starting it.

The obsolete legacy management panel is no longer posted. With tickets enabled, startup removes only its saved bot-owned message after checking configured guild/channel and author identity; cleanup failures are logged and retried on later readiness/restart, not worked around by deleting unverified messages. Historical ticket rows and normal retention remain unchanged. Old buttons and submitted modals only receive a private retirement notice. Open Tickets continues to list nonclosed historical entries and supports its existing Unclaim action, but the removed legacy claim/complete/close/reopen UI is not replaced.

## Configuration and secrets

V2 configuration is JSON, separate from the V1 `.env` configuration:

- Public schema: `config/schemas/instance.schema.json`
- Public shape/example: `config/examples/instance.example.json`
- Default private file location: ignored `config/runtime/instance.local.json`
- Optional path override: `TICKETBOT_CONFIG_PATH`

Copy and edit the example into the ignored runtime directory:

```powershell
New-Item -ItemType Directory -Force config/runtime
Copy-Item config/examples/instance.example.json config/runtime/instance.local.json
```

Use the corresponding shell commands on Linux. Replace the example guild, application, role, channel, server, and storage values. Use local environment variables or the approved host secret manager for secret values. Configuration contains **secret references**, not secret values:

- `discord.tokenSecret` names the environment variable containing the bot token. The one-time command cleanup script reads `DISCORD_TOKEN`.
- Each `ark.servers[].passwordSecret` names the environment variable containing that server's RCON password.
- `PIN_PROTECTION_KEY` is a separate secret, not stored in the JSON file. When PINs are enabled in test or production mode, it must be base64-encoded key material that decodes to exactly 32 bytes. Generate it with an approved cryptographic tool; do not reuse the Discord or RCON password.

`runtime.mode` must be explicitly set:

- `mock` allows safe example values and does not require the test/production connection secrets.
- `test` requires secrets for enabled connections and allows test-only servers.
- `production` rejects enabled example/test servers and requires storage paths outside the source repository.

V2 does not use `ARK_RCON_MOCK` to choose its mode. Do not assume that setting the V1 mock variable makes V2 safe.

Validate a private config before any runtime startup attempt:

```powershell
npm.cmd run config:validate -- config/runtime/instance.local.json
```

The validator prints a safe summary (including secret-presence booleans), not secret values or storage paths. Invalid feature configuration, missing required secrets, unknown properties, or unsafe production settings fail validation.

## Retiring the old slash commands

V2 no longer registers or handles slash commands. Earlier V2 test releases registered seven global commands: `/ticket`, `/pin`, `/player-name`, `/player-name-verify`, `/player-link`, `/dino-fulfillment`, and `/shop-search`. The panels replace all of them. `scripts/deploy-v2-commands.js` is kept only as a **one-time cleanup** that removes those seven from an application that still has them. It registers nothing new:

```powershell
node scripts/deploy-v2-commands.js
node scripts/deploy-v2-commands.js --apply
```

The first command is a **dry run**. It should list exactly the retired commands still present under `remove` and any other application commands under `preserve`. Review it before considering `--apply`, which deletes only those retired commands. The script uses the validated `discord.clientId` and requires `DISCORD_TOKEN`. Unrelated commands are always preserved. It re-reads commands before applying and aborts if the list changed, but Discord has no atomic compare-and-swap, so do not run it concurrently. Once the retired commands are gone, further runs report no changes. Applications that never had V2 commands need no cleanup.

Do not run the script, including the dry run, against a live application as part of setup or source merge. Use it on a disposable test application only after an operator has confirmed the target application. It uses global command routes, so it does not target a single test guild.

## Persistence, privacy, and recovery

- The runtime uses SQLite and ordered migrations through schema version 15. Startup refuses a database whose recorded migration history has gaps or names that do not match this release. The launcher creates private database and backup paths; production paths must remain outside the source checkout.
- Before migration, runtime composition checks integrity and calls the configured backup provider. A V1 `tickets` table is archived, not converted. Preserve the backup separately.
- PIN material is encrypted at rest and never included in audit records. One-time PIN requests clear material after delivery/cancellation/expiration. Generated Vault PINs are deliberately retained encrypted so the same PIN can be privately retrieved; protect the encryption key and backups accordingly.
- Completion is persisted separately from closure: completed tickets remain active and visible until explicitly closed. Migration 012 preserves the existing base state constraint using a completion timestamp, exposed as `COMPLETED` by the repository/service. Closed private channels are archived and deleted only after `retention.closedTicketDays` (V2 default 365), before their database rows are purged. Failed Discord cleanup retains the row for retry. Interrupted channel provisioning is reconciled on ready; manually deleted channels are recorded as closed/deleted.
- Fulfillment stores only bounded operation summaries (`success` and operation index), not raw RCON output or commands. If a pair delivery partially succeeds, the saved operation results remain available for staff review.
- Confirmation/cancellation sessions are one-time, context-bound records. Expired sessions are removed after the configured grace period.
- On startup, a request interrupted in `CLAIMED` is marked `FAILED`; one interrupted in `EXECUTING` becomes `UNCERTAIN` with completed operation evidence preserved. Uncertain delivery must be reviewed, not automatically retried.
- Retention defaults and settings are described in [V2 retention and cleanup](V2_RETENTION.md). Trusted player identities, V1 ticket archives, and backups are intentionally not automatically purged.
- Operational dashboards show persisted, sanitized events; a Discord panel is a view onto those records, not the record itself.

## Isolated test checklist

Do not use production resources for initial V2 testing. Prepare separate:

- V2 application directory and process/service identity
- Test Discord bot, application, guild, roles, and channels
- Test database and backup directory
- Test-only RCON endpoint and credentials
- Secret values and private JSON configuration, stored outside Git

Before calling V2 test-ready, complete all of the following in a disposable environment:

1. Validate the private JSON config and confirm invalid configuration fails before opening SQLite. For mock mode with any feature enabled, provide the configured Discord token secret.
2. Run the full automated suite and catalog validation against the exact release commit.
3. Start with mock or test endpoints using `npm run start:v2`; confirm feature registration matches enabled flags, the Discord ready log appears, and disabled features make no external connections.
4. Exercise panel-driven name submission/staff verification/linking, private ticket creation/duplicate protection/claim/completion/archival/reopening, generated PIN retrieval/failed-DM retry, staff directory paging/private reveal/privacy checks, retired custom-interaction rejection and bound-control cleanup, and shop pagination. Confirm cross-map fulfillment completion/cancellation and their persisted logs using an isolated mock/test environment. Upgrade a disposable schema-11 database containing record-only tickets and confirm original states are preserved, nonclosed legacy rows remain in Open Tickets, and already-closed rows retain retention eligibility. Confirm the old bot-owned legacy management panel is removed at startup, foreign/unowned messages are untouched, cleanup failures are logged for retry, and stale buttons/modals only receive the private removal notice without changing records. Historical nonclosed rows no longer have Discord closure controls and are not automatically closed or purged. On an application that previously had V2 commands, run the command cleanup dry run, then `--apply`, and confirm a stale retired command only returns the private panel pointer.
5. Verify fulfillment against the ARK test server, including cancellation, catalog version change, pair-delivery partial result, restart recovery, and explicit handling of `UNCERTAIN`.
6. Observe retention cleanup in the test database and confirm only records past the configured policy are affected.
7. Test a process restart and panel recreation after deleting a test panel message.
8. Rehearse rollback: preserve the V1 database/configuration/backup and verify V1 can start with its original database schema restored.

This guide does not authorize a production rollout. Live Discord command registration, production database migration, live RCON, and V1 service changes each require separate review and explicit operator approval.

## Further reading

- [Debian isolated startup plan](V2_DEBIAN_STARTUP_PLAN.md)
- [Configuration foundation](V2_CONFIGURATION.md)
- [Feature contracts](V2_FEATURE_CONTRACTS.md)
- [Dashboard runtime](V2_DASHBOARD_RUNTIME.md)
- [PIN runtime](V2_PIN_RUNTIME.md)
- [Deployment and rollback boundary](V2_DEPLOYMENT.md)
- [Retention policy](V2_RETENTION.md)
- [Architecture](V2_ARCHITECTURE.md)
- [Roadmap and status](V2_ROADMAP.md)
