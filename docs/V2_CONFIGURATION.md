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

The V2 validator never infers a mode from V1's `ARK_RCON_MOCK` flag. Always set `runtime.mode` explicitly.

## Secret references

`discord.tokenSecret` and `ark.servers[].passwordSecret` are environment-variable names. Runtime adapters resolve their values at the boundary. The command registration script specifically requires `DISCORD_TOKEN` and uses `discord.clientId` as the application ID.

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

With `pins` enabled, turn on **Server Members Intent** in the test application's Developer Portal. The launcher requests Guild Members only for that feature so **Generate Missing PINs** can enumerate eligible members. This does not grant PINs to unverified users or reveal them publicly.

## Important distinction

`schemaVersion` in the JSON file remains `1`. The SQLite database schema is a separate version, currently `13`. Do not edit either number to migrate an installation. Migrations 012 (private ticket metadata/counter) and 013 (generated Vault PINs) are additive and run through runtime composition; first exercise them against a disposable copy of the existing V2 database with a verified backup. Existing record-only tickets are retained rather than creating channels retroactively.

Configuration validity does not mean that a live/test deployment is accepted. `scripts/start-v2.js` wires the runtime dependencies, but test application/server connectivity, Debian service installation, and the isolated acceptance checklist still require operator verification.
