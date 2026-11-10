# Ticketbot V2 configuration reference

This page describes the current V2 configuration contract. It supplements the operator-oriented [V2 guide](V2_GUIDE.md); it is not an installation-specific deployment procedure. V2's launcher is `npm run start:v2`.

## Files and validation

- Schema: `config/schemas/instance.schema.json`
- Example: `config/examples/instance.example.json`
- Default private file: `config/runtime/instance.local.json` (ignored by Git)
- Optional path override: `TICKETBOT_CONFIG_PATH`
- Validator: `npm.cmd run config:validate -- config/runtime/instance.local.json`

The validator rejects unknown fields, malformed IDs, unsupported operations, invalid feature settings, missing required secrets, and unsafe production paths. On success it prints only a redacted summary. The JSON file holds references to secrets, not their values.

## Top-level sections

| Section | Purpose |
| --- | --- |
| `schemaVersion` | Must be `1`; this is the configuration-format version, not the SQLite schema version. |
| `runtime` | Explicit mode (`mock`, `test`, or `production`), environment label, and log level. |
| `discord` | Application ID, guild ID, token-secret reference, roles, and channels. Discord IDs are snowflakes represented as strings. |
| `ark` | RCON timeout and server definitions. Each server has an ID, host, port, password-secret reference, enabled/test-only flags, and an allowlist of supported operations. |
| `storage` | SQLite database and backup paths. Production paths must resolve outside the source repository. |
| `features` | Required booleans controlling registration of `tickets`, `pins`, `playerNames`, `shop`, `fulfillment`, and `dashboards`. |
| `retention` | Optional bounded cleanup intervals. See [retention policy](V2_RETENTION.md). |

Use the complete public schema and example for exact field names. Required roles, channels, dependencies, and secrets depend on which features are enabled. See the [Discord planning table](V2_GUIDE.md#discord-setup-planning).

## Runtime modes

- **`mock`** accepts public example values and does not require RCON or PIN secrets. The launcher still requires the configured Discord token if any Discord feature is enabled. A production launch must not use mock mode as a substitute for an explicitly reviewed test.
- **`test`** requires secrets for enabled connections and permits servers marked `testOnly`.
- **`production`** requires secrets, rejects enabled example/test-only servers, and requires database/backup paths outside the source repository.

Private tickets permit multiple active requests by the same requester only when `runtime.mode` is exactly `mock`. Test/production retain atomic one-active-request protection, including create/reopen races and existing mock-created active rows. Switching out of mock preserves those rows/channels without closing or deleting them, but blocks additional creates/reopens until the requester has no other active private ticket. Mock tickets still require verified names and the usual authorization/private-channel checks; RCON mode, allowlists and safety checks do not change. There is no separate ticket-limit setting. See [ticket runtime](V2_TICKET_RUNTIME.md#mock-only-multiple-requests).

The V2 validator never infers a mode from V1's `ARK_RCON_MOCK` flag. Always set `runtime.mode` explicitly.

## Secret references

`discord.tokenSecret` and `ark.servers[].passwordSecret` are environment-variable names. Runtime adapters resolve their values at the boundary. The one-time command cleanup script specifically requires `DISCORD_TOKEN` and uses `discord.clientId` as the application ID.

When `features.pins` is enabled in `test` or `production`, the host must also provide `PIN_PROTECTION_KEY`: base64-encoded key material decoding to exactly 32 bytes. The launcher requires a valid key in mock mode as well whenever PINs are enabled, and rejects a malformed key before SQLite is opened. Keep it separate from the JSON configuration and all other credentials. Loss of this key prevents decryption of pending PIN requests and persistent generated Vault PINs. Generated PINs remain encrypted for repeated private DM retrieval; do not replace this key without an operator-reviewed re-encryption procedure.

Never put secret values in tracked JSON, `.env.example`, command arguments, screenshots, issue reports, or logs. Store test and production secrets separately.

## Feature validation

Configuration validation happens before the V2 database opener is called. The launcher additionally checks the Discord secret in mock mode before opening SQLite when any feature is enabled. Validation checks:

- Shared and feature-specific staff/moderator role IDs and channel IDs.
- `tickets` and `pins` dependencies on enabled `playerNames`.
- A non-null `discord.channels.ticketCategory` when tickets are enabled. This existing field is shown in the example; it now controls private per-request channels. Ticket creation validates that it is a category in the configured guild.
- `discord.channels.requests` for shop search panels, including when tickets are disabled.
- Required server availability for `fulfillment`.
- Presence of Discord, RCON, and PIN-protection secrets in non-mock modes; the launcher also checks that the Discord token exists before opening SQLite whenever a feature is enabled in mock mode.
- Retention keys, bounds, and the requirement that fulfillment identity retention not exceed fulfillment audit retention.

Runtime composition repeats critical authorization requirements before backup and migrations. This protects startup against incomplete or invalid runtime options as well.

## Discord permissions and standing panels

The enabled features restore V1-style request, Vault, IGN, fulfillment, and inline log panels using persisted message IDs. In panel channels the bot needs View Channel, Send Messages, Read Message History, and Embed Links. For private tickets it needs View Channel, Send Messages, Read Message History, Manage Channels, and Manage Roles (Manage Permissions) in `ticketCategory`, which covers creation, overwrite updates, archive renames, and retention deletion. Manage Messages is not required. Ticket creation and close/reopen check these permissions before acting, and startup audits any that are missing. The request panel's shop button appears only when `shop` is enabled.

Keep `ticketLogs`, `pinsDashboard`, and `fulfillmentLogs` staff-only. Inline dashboard rendering fails with a generic audit notice if ordinary roles can view the channel or permissions cannot be verified; it never silently publishes an ephemeral replacement. Bot integration roles (managed roles tagged with a bot ID, such as this bot's own role) are ignored, so adding the bot's role to a private channel is fine. `@everyone`, booster roles, and every other non-staff role still count as public visibility. Staff interaction authorization remains required for paging.

Legacy Ticket Management has been removed. With tickets enabled, startup removes only its previously bound, verified bot-owned message in the configured guild and `ticketLogs` channel. Unsafe bindings or cleanup failures are logged and retained for retry, never used to delete another message. Historical rows and migration compatibility remain intact; old UI interactions return a private retirement notice without running actions.

With dashboards enabled, Ticket logs renders one comma-separated line per ticket, automatically appending the latest claim/unclaim and completion/closure actors after the opening phrase. Pages count up to ten tickets, newest-opened first, not ten events. Reopening resets prior assignment/completion/closure phrases. This grouping uses existing retained audit events and adds no setting or migration; partially expired histories are explicitly labelled. See [dashboard runtime](V2_DASHBOARD_RUNTIME.md).

The same tickets feature also restores a separate **Open Tickets** panel in `ticketLogs`, independently of `features.dashboards`. It lists nonclosed private and legacy tickets in SQL pages of five with numbered Unclaim buttons; completed-but-not-closed tickets remain visible. No new channel, role, setting or migration is required. Fresh role/member-overwrite privacy checks protect publication and actions; unsafe or unverifiable destinations redact the panel. Unclaim additionally checks staff authorization, configured guild/log channel and the current persisted panel message, replies privately and records the acting staff member and previous claimant. Ticket changes refresh the existing message with a 150 ms debounce. See [ticket runtime](V2_TICKET_RUNTIME.md#open-tickets-and-unclaim).

With `pins` enabled, turn on **Server Members Intent** in the test application's Developer Portal. The launcher requests Guild Members only for that feature so **Generate Missing PINs** can enumerate eligible members. This does not grant PINs to unverified users or reveal them publicly.

## Important distinction

`schemaVersion` in the JSON file remains `1`. The SQLite database schema is a separate version, currently `14`. Do not edit either number to migrate an installation. Migrations 012 (private ticket metadata/counter), 013 (generated Vault PINs) and forward migration 014 (mock-only ticket multiplicity) run through runtime composition; released migrations through 013 are unchanged. Migration 014 adds a checked per-ticket mock marker and narrows the ordinary unique index without discarding existing records/counters. Non-mock reservation/reopen statements still check all active private tickets, including marked mock rows. First exercise upgrades against a disposable copy with a verified backup; schema-13 binaries reject schema 14, so rollback requires the pre-upgrade backup. Existing record-only tickets are retained rather than creating channels retroactively.

Preserved record-only tickets no longer have Discord claim/complete/close/reopen controls. They remain visible in Open Tickets until closed, with its existing Unclaim action preserved. This removal does not automatically close historical rows: nonclosed rows stay outside closed-ticket retention, and already-closed rows retain normal retention eligibility.

Configuration validity does not mean that a live/test deployment is accepted. `scripts/start-v2.js` wires the runtime dependencies, but test application/server connectivity, Debian service installation, and the isolated acceptance checklist still require operator verification.
