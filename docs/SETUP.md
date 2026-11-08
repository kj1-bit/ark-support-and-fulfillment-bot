# Legacy V1 setup guide

> **This guide is for the existing V1 application only.** It uses V1 `.env` settings, `index.js`, and `deploy-commands.js`; it does not configure or start V2. For the V2 architecture, configuration, feature behavior, and test-readiness requirements, start with the [V2 guide](V2_GUIDE.md). Do not point V2 at V1 production resources during initial testing.

This guide takes a new operator from an empty Discord application to a running V1 Ticketbot installation. Complete the Discord-only setup first, run the bot in mock mode, and enable live RCON last.

## 1. Requirements

- A computer or server that can run Node.js and npm
- A Discord server where you can create roles, channels, and integrations
- A Discord application and bot token
- Network access from the bot host to each ARK server's RCON port for live fulfillment
- AAT installed and configured on the ARK servers if automated dino delivery will be used
- Git, if installing from a Git repository

## 2. Install the project

### Windows PowerShell

```powershell
git clone YOUR_PUBLIC_REPOSITORY_URL
cd ticketbot-public
npm.cmd ci
Copy-Item .env.example .env
```

Use `npm.cmd` if PowerShell blocks `npm.ps1` through its execution policy.

### Linux

```bash
git clone YOUR_PUBLIC_REPOSITORY_URL
cd ticketbot-public
npm ci
cp .env.example .env
```

Do not run the bot yet. The environment file and Discord server must be configured first.

## 3. Create the Discord application

1. Open the Discord Developer Portal and create an application.
2. Open the application's **Bot** page and create or reset the bot token.
3. Copy the token into `DISCORD_TOKEN` in `.env`.
4. Copy the application's ID into `CLIENT_ID`.
5. Enable the **Server Members Intent** because Ticketbot fetches guild members when generating missing PINs.
6. Keep the token private. Treat it like a password.

Ticketbot requests the Guilds, Guild Messages, and Guild Members gateway intents in `index.js`.

## 4. Invite the bot

Create an OAuth2 installation URL for the bot with the `bot` and `applications.commands` scopes.

Grant the bot enough server permissions to perform the actions enabled in the code:

- View Channels
- Send Messages
- Read Message History
- Manage Channels
- Manage Roles only if your local customization requires it
- Use Application Commands
- Embed Links

Ticketbot creates private ticket channels, edits persistent panel messages, changes ticket channel names, adjusts permission overwrites, and deletes expired ticket channels. The bot's highest role must be positioned so Discord allows the required channel operations.

## 5. Create the Discord roles

Create at least these roles:

### Staff role

Purpose:

- Access private ticket channels
- Complete tickets
- Use PIN administration commands
- Refresh the shop catalog
- Operate staff dashboards

Copy the role ID into:

```env
STAFF_ROLE_ID=
```

### Member role

Purpose:

- Identify ordinary community members eligible for bulk PIN generation
- Participate in the ticket-close permission check when a member can already view the ticket

Copy the role ID into:

```env
MEMBER_ROLE_ID=
```

### Dino fulfillment moderator role

Purpose:

- Access the dino fulfillment panel
- Browse or search the approved creature catalog
- Scan for online ARK players
- Confirm AAT delivery
- Browse dino fulfillment logs

Copy the role ID into:

```env
DINO_FULFILLMENT_ROLE_ID=
```

The same Discord role can be used for both staff variables if desired, but the code treats them as separate settings.

## 6. Create the Discord category and channels

Enable Discord Developer Mode, then copy each category, channel, role, user, and application ID into `.env`.

### Required ticket category

Create a category for newly generated private ticket channels.

```env
CATEGORY_ID=
```

### User-facing channels

Create text channels for:

- Vault PIN panel
- Support request and shop-search panel
- In-game-name panel

```env
VAULT_CHANNEL_ID=
REQUESTS_CHANNEL_ID=
IGN_CHANNEL_ID=
```

### Staff dashboard channels

Create text channels for:

- Vault PIN dashboard
- Ticket logs dashboard

```env
PINS_DASHBOARD_CHANNEL_ID=
TICKET_LOGS_CHANNEL_ID=
```

These channels expose administrative data and should normally be staff-only.

### Dino fulfillment channels

Create text channels for:

- Dino fulfillment control panel
- Dino fulfillment logs dashboard

```env
DINO_FULFILLMENT_CHANNEL_ID=
DINO_FULFILLMENT_LOG_CHANNEL_ID=
```

These channels should be limited to the configured dino fulfillment moderator role.

## 7. Complete `.env`

The public example is intentionally blank. Fill in your own values:

```env
DISCORD_TOKEN=
CLIENT_ID=

STAFF_ROLE_ID=
MEMBER_ROLE_ID=

CATEGORY_ID=
VAULT_CHANNEL_ID=
REQUESTS_CHANNEL_ID=
IGN_CHANNEL_ID=
PINS_DASHBOARD_CHANNEL_ID=
TICKET_LOGS_CHANNEL_ID=

DINO_FULFILLMENT_CHANNEL_ID=
DINO_FULFILLMENT_ROLE_ID=
DINO_FULFILLMENT_LOG_CHANNEL_ID=

ARK_RCON_HOST=127.0.0.1
ARK_RCON_PORT_1=27020
ARK_RCON_PORT_2=27021
ARK_TEST_RCON_PORT=27030
ARK_RCON_PASSWORD=
ARK_TEST_RCON_PASSWORD=
ARK_RCON_MOCK=true

```

### Variable meanings

- `DISCORD_TOKEN`: Secret token used to log in as the bot.
- `CLIENT_ID`: Discord application ID used when registering slash commands.
- `STAFF_ROLE_ID`: Role allowed to administer tickets, PINs, and the shop catalog.
- `MEMBER_ROLE_ID`: Community member role used during bulk PIN generation.
- `CATEGORY_ID`: Parent category where private ticket channels are created.
- `VAULT_CHANNEL_ID`: Channel containing the Vault PIN button.
- `REQUESTS_CHANNEL_ID`: Channel containing shop search and support-request buttons.
- `IGN_CHANNEL_ID`: Channel containing the in-game-name button.
- `PINS_DASHBOARD_CHANNEL_ID`: Staff PIN dashboard channel.
- `TICKET_LOGS_CHANNEL_ID`: Staff ticket-log dashboard channel.
- `DINO_FULFILLMENT_CHANNEL_ID`: Moderator dino-delivery panel channel.
- `DINO_FULFILLMENT_ROLE_ID`: Role authorized to operate dino fulfillment.
- `DINO_FULFILLMENT_LOG_CHANNEL_ID`: Persistent dino fulfillment log channel.
- `ARK_RCON_HOST`: Default RCON host used by example server entries.
- `ARK_RCON_PORT_1`, `ARK_RCON_PORT_2`, `ARK_TEST_RCON_PORT`: Example RCON ports referenced by `config/ark-servers.js`.
- `ARK_RCON_PASSWORD`, `ARK_TEST_RCON_PASSWORD`: Passwords read indirectly through each server's `passwordEnv` setting.
- `ARK_RCON_MOCK`: When `true`, prevents live RCON delivery and uses synthetic online-player data.

## 8. Configure ARK servers

Edit `config/ark-servers.js`. Each entry has:

```js
{
  id: 'example-map-1',
  name: 'Example Map 1',
  host: DEFAULT_HOST,
  port: envPort('ARK_RCON_PORT_1', 27020),
  passwordEnv: 'ARK_RCON_PASSWORD',
  enabled: true
}
```

### Field meanings

- `id`: Stable internal identifier. It must be unique.
- `name`: Human-readable map or server name shown to moderators.
- `host`: RCON host name or IP address.
- `port`: RCON TCP port.
- `passwordEnv`: Name of the environment variable containing the password.
- `enabled`: Only enabled servers are scanned for online players.
- `testOnly`: Optional label for a test server.

Add, remove, or rename entries to match the user's cluster. Do not put passwords directly in this JavaScript file.

## 9. Configure the shop catalog

Ticketbot imports `data/shop-catalog.csv` at startup. The required columns are:

```csv
PackageName,EntryCost,Dino1Level,Dino1GenderIndex,Dino1Blueprint,Dino2Level,Dino2GenderIndex,Dino2Blueprint,IncludedItems
```

The included catalog contains example packages only.

- `PackageName`: Name shown in search results.
- `EntryCost`: Shop price or points.
- `Dino1Level`, `Dino2Level`: Levels advertised by the shop.
- `Dino1GenderIndex`, `Dino2GenderIndex`: Gender values stored by the source shop data.
- `Dino1Blueprint`, `Dino2Blueprint`: Creature blueprint paths.
- `IncludedItems`: Optional item paths. Multiple values should follow the delimiter expected by the current formatter.

After editing the CSV, either restart the bot or use `/shop-refresh` as a staff member.

## 10. Review the creature catalog

The dino fulfillment feature reads `data/dino-catalog.json` through `services/creature-catalog.js`.

Catalog records describe:

- Internal ID and display name
- Aliases used by search
- Creature blueprint
- Whether the creature supports gender
- Whether a saddle applies
- Source content or mod
- DLC requirement and DLC name when applicable

Run the catalog tests after changing this data.

## 11. Register slash commands

Run this once after setting `DISCORD_TOKEN` and `CLIENT_ID`:

```powershell
node deploy-commands.js
```

The command file registers global application commands. Global command changes can take time to appear in every server.

Registered commands include:

- `/viewpins`
- `/getpin user:<user>`
- `/resetpin user:<user>`
- `/generateallpins`
- `/shop-search query:<text>`
- `/shop-refresh`

Run the deployment script again whenever the slash-command definitions change.

## 12. First start in mock mode

Confirm:

```env
ARK_RCON_MOCK=true
```

Start the bot:

```powershell
node index.js
```

On successful startup, Ticketbot:

1. Logs in to Discord.
2. Creates or upgrades the SQLite tables in `database.sqlite`.
3. Validates the dino catalog.
4. Imports the shop CSV.
5. Creates or updates the configured persistent panels.
6. Refreshes the panels every 60 seconds.

If a saved panel message was deleted, Ticketbot recreates it and stores the new message ID.

## 13. Validate Discord behavior

Before considering live mode, verify:

- The Vault PIN panel appears.
- The request/shop panel appears.
- The in-game-name panel appears.
- Staff PIN and ticket-log dashboards appear only in staff channels.
- The dino panel and dino logs appear only in moderator channels.
- A member can set an in-game name.
- A member can receive a PIN privately.
- A member can create only one open ticket at a time.
- Staff can complete and close tickets.
- Shop search returns the example packages.
- The dino panel displays MOCK mode and synthetic players.

## 14. Run tests

```powershell
$env:ARK_RCON_MOCK = 'true'
node scripts/test-aat-command-builder.js
node scripts/test-creature-catalog.js
node scripts/test-dino-catalog-audit.js
node scripts/test-dino-catalog-browser-and-dlc.js
node scripts/test-dino-fulfillment-log-dashboard.js
node scripts/test-dino-imprint-and-logs.js
node scripts/test-dino-panel-integration.js
node scripts/test-fulfillment-coordinator.js
node scripts/test-official-asa-catalog-coverage.js
```

All tests should pass before enabling live RCON.

## 15. Enable live RCON carefully

Before switching modes:

1. Verify every enabled server's host and port.
2. Verify RCON is enabled on each ARK server.
3. Verify the bot host can reach each RCON TCP port.
4. Verify each `passwordEnv` points to the correct environment variable.
5. Confirm AAT accepts the generated command format on a test server.
6. Use a test player and a non-production environment first.
7. Review the Discord confirmation screen before every spawn.

Then set:

```env
ARK_RCON_MOCK=false
```

Restart the bot.

The moderator workflow scans enabled servers with `ListPlayers`, identifies the selected player by EOS ID, revalidates the player before delivery, builds fixed AAT commands, and sends them to the selected server.

## 16. Production operation

Run with a process manager or service supervisor appropriate for the operating system. The repository does not force a particular deployment path.

Back up:

- `.env`, securely and outside source control
- `database.sqlite`
- Customized `config/ark-servers.js`
- Customized catalog files

Do not publish backups containing credentials, PINs, player names, ticket history, or EOS IDs.

## 17. Operator-controlled deployment and rollback

Discord cannot deploy, update, restart, or execute host commands.

V1 deployment and rollback must follow the V1 installation's private operations runbook. The [V2 deployment document](V2_DEPLOYMENT.md) describes the separate V2 security boundary and is not a V1 deployment procedure. During an approved V1 deployment, rerun `node deploy-commands.js` to synchronize V1's registered Discord commands with the reviewed source.

## 18. Troubleshooting

### Bot logs in but panels do not appear

- Confirm every panel channel ID is correct.
- Confirm the bot can view and send messages in those channels.
- Confirm the bot can embed links in the dino channels.
- Read the startup error after `Startup initialization failed`.

### Bulk PIN generation misses members

- Confirm the Server Members Intent is enabled.
- Confirm members have `MEMBER_ROLE_ID` or `STAFF_ROLE_ID`.
- Bots and users without either role are intentionally skipped.

### Ticket creation fails

- Confirm `CATEGORY_ID` is a category ID.
- Confirm the bot can manage channels in that category.
- Confirm `STAFF_ROLE_ID` exists.

### Shop search is empty

- Confirm `data/shop-catalog.csv` exists and contains at least one data row.
- Keep the header names unchanged.
- Run `/shop-refresh` or restart the bot.

### No online ARK players are found

- In mock mode, confirm the selected example server ID has mock data.
- In live mode, confirm enabled server entries, RCON connectivity, passwords, and `ListPlayers` output.
- Online-player scanning can take a few seconds when several maps are configured.

### Dino fulfillment is blocked

- Confirm the user has `DINO_FULFILLMENT_ROLE_ID`.
- Confirm the selected player remains online through the final confirmation.
- Confirm the creature is present and valid in the approved catalog.
- Review the dino fulfillment log dashboard and process console.

### SQLite install warning

The `sqlite3` package may use a prebuilt binary or build locally during installation. If installation scripts are blocked, review npm's install-script approval output for the installed npm version and ensure the native module is installed before running the bot.
