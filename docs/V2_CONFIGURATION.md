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

When `features.pins` is enabled in `test` or `production`, the host must also provide `PIN_PROTECTION_KEY`: base64-encoded key material decoding to exactly 32 bytes. Keep it separate from the JSON configuration and all other credentials. Loss of this key prevents decryption of pending PIN requests.

Never put secret values in tracked JSON, `.env.example`, command arguments, screenshots, issue reports, or logs. Store test and production secrets separately.

## Feature validation

Configuration validation happens before the V2 database opener is called. The launcher additionally checks the Discord secret in mock mode before opening SQLite when any feature is enabled. Validation checks:

- Shared and feature-specific staff/moderator role IDs and channel IDs.
- `tickets` and `pins` dependencies on enabled `playerNames`.
- Required server availability for `fulfillment`.
- Presence of Discord, RCON, and PIN-protection secrets in non-mock modes; the launcher also checks that the Discord token exists before opening SQLite whenever a feature is enabled in mock mode.
- Retention keys, bounds, and the requirement that fulfillment identity retention not exceed fulfillment audit retention.

Runtime composition repeats critical authorization requirements before backup and migrations. This protects startup against incomplete or invalid runtime options as well.

## Important distinction

`schemaVersion` in the JSON file is currently `1`. The SQLite database schema is a separate version, currently `10`. Do not edit either number to migrate an installation. Schema migrations are code-controlled and run through the V2 runtime composition; they should first be exercised against a disposable copy of the database with a verified backup.

Configuration validity does not mean that a live/test deployment is accepted. `scripts/start-v2.js` wires the runtime dependencies, but test application/server connectivity, Debian service installation, and the isolated acceptance checklist still require operator verification.
