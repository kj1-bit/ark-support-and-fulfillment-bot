# Debian V2 startup plan

This plan describes an **isolated V2 test deployment**. The repository now includes a V2 executable at `scripts/start-v2.js`, exposed as `npm run start:v2`. It wires SQLite, Discord, the checked-in creature catalog, the configured RCON transport, backups, audit logging, and signal-driven shutdown. The root `index.js` still starts V1; never use it to start V2.

The launcher has mock-mode startup coverage, but has not been rehearsed on Debian or against a test Discord application and ARK server. Follow these stages only with separate test resources. This is not authorization to connect to production Discord, live RCON, or V1 data.

## Repository path map

Paths below are relative to the repository root unless identified as planned Debian paths.

| Purpose | Current repository path | Status |
| --- | --- | --- |
| Supported current V1 launcher | `index.js` | Exists; starts V1 only. |
| V1 Discord command registration | `deploy-commands.js` | Exists; V1 only. |
| V1 public environment example | `.env.example` | Exists; not a V2 config. |
| V2 config schema and safe example | `config/schemas/instance.schema.json`, `config/examples/instance.example.json` | Exists; example IDs are placeholders. |
| V2 config validation | `scripts/validate-config.js` | Exists; validates and prints a redacted summary. |
| V2 global command registration | `scripts/deploy-v2-commands.js` | Exists; dry-run by default; not a launcher and not guild-scoped. |
| V2 executable | `scripts/start-v2.js` (`npm run start:v2`) | Reads `TICKETBOT_CONFIG_PATH` or the default ignored local config, starts V2, and handles SIGINT/SIGTERM. |
| V2 startup coordinator | `src/composition/start-v2.js` | Injected startup lifecycle used by the executable and tests. |
| V2 runtime wiring | `scripts/start-v2.js`, `src/composition/compose-runtime.js` | Supplies SQLite, catalog, Discord, RCON, fulfillment plan, backup, and audit dependencies. |
| V2 catalog loader | `src/composition/load-initial-catalog.js` | Loads enabled/tameable entries from `data/dino-catalog.json` and derives a deterministic content-fingerprint version. |
| SQLite opener | `src/adapters/sqlite/open-database.js` | Creates the configured parent directory, uses foreign keys and DELETE journaling, and restricts database-file permissions. |
| RCON transport | `src/adapters/rcon/tcp-transport.js` | Uses named allowlisted operations, secret references, bounded responses, timeouts, and sanitized failures; mock mode performs no RCON connection. |
| V2 Discord feature adapter | `src/adapters/discord/adapter.js` | Receives a `discord.js` client and composed feature services from the launcher. |
| V2 SQLite repositories | `src/adapters/sqlite/` | Uses the launcher's SQLite wrapper to run migrations and repositories. |
| V2 RCON operation boundary | `src/adapters/rcon/operation-service.js` | Validates server operation allowlists before invoking the transport. |

Use `node scripts/start-v2.js` or `npm run start:v2` for V2 only. Do not run `node index.js` and call that a V2 test.

## Proposed isolated host layout

Use a dedicated non-root service account, for example `ticketbot-v2`, and paths distinct from the existing V1 installation:

| Data | Proposed Debian path | Ownership/permissions |
| --- | --- | --- |
| Versioned application release | `/opt/ticketbot-v2/releases/<commit>/` | Root-owned application files; service account read/execute only. |
| Current release selector | `/opt/ticketbot-v2/current` | Operator-managed symlink to one reviewed release. |
| Private instance config | `/etc/ticketbot-v2/instance.json` | Root-owned, readable only by the service account. |
| Secret environment file or secret-provider mount | `/etc/ticketbot-v2/runtime.env` | Root-owned, mode `0600`; never placed in the repository or release directory. |
| SQLite database | `/var/lib/ticketbot-v2/database.sqlite` | Writable only by `ticketbot-v2`. |
| Database backups | `/var/backups/ticketbot-v2/` | Writable only by the service account or a dedicated backup group; separate from V1 backups. |
| Service logs | systemd journal | Do not write unrotated sensitive logs into the application directory. |

These are proposed paths, not paths created by this repository. Before adopting them, set matching **absolute** V2 `storage.databasePath` and `storage.backupPath` values in the private config. The launcher resolves those paths, creates the database/backup directories as needed, and restricts database and backup-file permissions; ensure the service account cannot write the V1 database, config, or backup directories.

## Phase A: isolated host preparation

1. Inventory the Debian release, architecture, disk space, current V1 service name/user, its working directory, its database/config/backup paths, and its current commit. Do not modify or restart V1.
2. Install Node.js 22 or newer (`package.json` declares `engines.node >=22`) and verify that the exact Debian Node/npm versions can install the locked native `sqlite3` dependency. The repository does not yet have a Debian-host rehearsal result.
3. Create the separate V2 service identity and planned directories. Do not grant it access to V1 secrets or writable access to V1 files.
4. Prepare a separate test Discord application/guild and ARK test server. Keep their credentials separate from production credentials.
5. Leave command deployment disabled until the V2 command manifest is reviewed for the test application. `scripts/deploy-v2-commands.js` uses global Discord command routes, so it is not safe for a test guild if the same bot application is used elsewhere.
6. Create the private config and test secret environment file as described below. Do not copy production credentials or configuration.

## Phase B: stage a test release

1. Fetch the reviewed merge commit into a new release directory. Keep releases immutable; do not edit application source in place on the Debian host.
2. Install from the committed lockfile with the approved install scripts, using the supported Node/npm versions. Build or native-module verification steps must be explicit in the release instructions if required.
3. Place the private JSON configuration at `/etc/ticketbot-v2/instance.json` and secrets in the approved environment file/provider. Keep credentials out of command history and process arguments. Set `TICKETBOT_CONFIG_PATH=/etc/ticketbot-v2/instance.json`.
4. Set `runtime.mode` to `test`. Point `discord` at the test application/guild, `ark.servers` only at the test ARK server, and `storage` only at the V2 test directories.
5. Ensure `DISCORD_TOKEN` exists whenever any Discord feature is enabled, including in mock mode. In `test` mode also provide configured test RCON secrets and (when PINs are enabled) `PIN_PROTECTION_KEY`. The PIN key is base64 for exactly 32 bytes and must be retained securely for the lifetime of encrypted pending PINs.
6. Validate the private file and run the complete checks from the staged release:

   ```sh
   node scripts/validate-config.js /etc/ticketbot-v2/instance.json
   npm test
   node scripts/test-creature-catalog.js
   node scripts/test-official-asa-catalog-coverage.js
   ```

   These commands validate configuration/code/catalog; they do not prove that the Discord or RCON credentials target a test system. Independently verify the IDs and hostnames before startup.

7. Create the V2 systemd unit only after verifying the installed Node executable and permissions. Example unit (adjust paths and `ExecStart` to the actual host):

   ```ini
   [Unit]
   Description=Ticketbot V2 isolated test instance
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   User=ticketbot-v2
   Group=ticketbot-v2
   WorkingDirectory=/opt/ticketbot-v2/current
   Environment=TICKETBOT_CONFIG_PATH=/etc/ticketbot-v2/instance.json
   EnvironmentFile=/etc/ticketbot-v2/runtime.env
   ExecStart=/usr/bin/node scripts/start-v2.js
   Restart=on-failure
   RestartSec=5
   UMask=0077
   NoNewPrivileges=true
   PrivateTmp=true
   ProtectSystem=strict
   ProtectHome=true
   ReadWritePaths=/var/lib/ticketbot-v2 /var/backups/ticketbot-v2

   [Install]
   WantedBy=multi-user.target
   ```

   Verify `/usr/bin/node` with `command -v node`; do not copy this example into production without separate review. The launcher emits a safe config summary and a `runtime.discord.ready` journal event. RCON command responses are normalized; raw responses and commands are not logged or persisted. A non-empty RCON response without recognized failure text indicates transport-level acceptance, not independent proof that the creature appeared in-game.
8. Verify the unit, then start it only for the isolated test:

   ```sh
   sudo systemd-analyze verify /etc/systemd/system/ticketbot-v2.service
   sudo systemctl daemon-reload
   sudo systemctl start ticketbot-v2.service
   sudo systemctl status --no-pager ticketbot-v2.service
   sudo journalctl -u ticketbot-v2.service -n 100 --no-pager
   ```

   Do not enable automatic boot startup until the isolated acceptance checklist passes and the operator explicitly approves it. Verify startup logs, Discord connection, restored dashboards, each enabled feature, private PIN delivery, test-server RCON behavior, retention, restart recovery, and rollback.
9. Record the commit, configuration version (not secret values), test results, backup location/checksum, service state, and rollback decision.

Start the service only after the operator has reviewed the exact test config, secret file, Discord application/guild, RCON host, and writable paths. Do not substitute `node index.js` or `node src/composition/start-v2.js`.

## Phase C: isolated-test acceptance and rollback

Do not consider the test deployment accepted until the [V2 guide test checklist](V2_GUIDE.md#isolated-test-checklist) passes against the test Discord application and ARK server.

To roll back the isolated test, stop only the V2 systemd unit, point `/opt/ticketbot-v2/current` back to the prior V2 release (or disable the test unit), and restore only the V2 test database if required. Do not stop or change V1. Never attach a V1 process to a V2-migrated SQLite file; restore the untouched V1 database backup before any V1 recovery.

## Separate future production decision

This test plan is not production authorization. Production would require a separately reviewed release, live-service maintenance and rollback plan, explicit command-registration review, production credential handling, migration rehearsal against a verified copy, and operator approval. Do not point the test V2 process at production Discord, live RCON, or V1 data.
