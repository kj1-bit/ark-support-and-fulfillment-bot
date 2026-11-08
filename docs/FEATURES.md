# Legacy V1 features and operating guide

> This page documents the existing V1 application (`index.js`, `features/`, and `services/`). It is not a description of V2 runtime behavior. For V2, use the [V2 guide](V2_GUIDE.md) and its source-path map.

This document explains what each user-facing and staff-facing feature is intended to do, who can use it, and what data it stores.

## Persistent panels

Ticketbot stores panel message IDs in SQLite. On startup and every 60 seconds, it edits the existing messages. If a saved panel message cannot be fetched, it creates a replacement and saves the new message ID.

Configured panels include:

- Vault PIN panel
- Support request and shop search panel
- In-game-name panel
- Vault PIN dashboard
- Ticket logs dashboard
- Dino fulfillment panel
- Dino fulfillment logs dashboard

## In-game-name records

### Intended purpose

Connect a Discord account to the name staff recognize in ARK.

### User workflow

1. Select **Set My In-Game Name**.
2. Enter a name between 1 and 32 characters.
3. Submit the modal.

The bot saves the Discord user ID, username, in-game name, and update time. The staff PIN dashboard displays the in-game name next to the Discord username and PIN.

## Vault PIN system

### Intended purpose

Provide each eligible player with a private four-digit vault PIN while giving staff a persistent lookup dashboard.

### Member workflow

1. Select **Get My Vault PIN**.
2. If a PIN already exists, the bot returns it privately.
3. If no PIN exists, the bot generates and stores a random four-digit PIN.

### Staff tools

- `/viewpins`: Ephemeral list of stored users, in-game names, and PINs.
- `/getpin user:<user>`: Look up one user's PIN.
- `/resetpin user:<user>`: Replace or create the selected user's PIN.
- `/generateallpins`: Generate PINs for non-bot users holding the member or staff role.
- PIN dashboard buttons: Previous, Refresh, Next, and Generate Missing PINs.

The PIN dashboard displays 25 records per page.

## Shop catalog search

### Intended purpose

Let users search the server's in-game shop before opening a support request.

### User workflows

- Select **Search In-Game Shop** on the request panel, enter a creature or package name, and receive up to five matching packages privately.
- Use `/shop-search query:<text>` with autocomplete.

Search compares normalized package names and searchable blueprint/item text. Several short aliases are built into `index.js`.

### Staff workflow

Use `/shop-refresh` after changing `data/shop-catalog.csv`. The command deletes the current imported rows and reloads the CSV inside a database transaction.

## Support tickets

### Intended purpose

Create a private Discord channel where one player and staff can handle a support request, while retaining an auditable lifecycle.

### Opening a ticket

1. A user selects **Open Request**.
2. Ticketbot checks whether that user already has an open ticket.
3. Ticketbot assigns the next sequential ticket number.
4. Ticketbot creates a private text channel under `CATEGORY_ID`.
5. The user and staff role receive view, send, and history permissions.
6. Ticketbot posts **Ticket Completed** and **Close Ticket** buttons.

The generated channel name combines the sanitized requester username and a four-digit ticket label.

### Completing a ticket

Only staff can select **Ticket Completed**. The bot:

- Changes status from `OPEN` to `COMPLETED`
- Records who completed it and when
- Writes a completion event to the ticket log
- Disables the completion button
- Refreshes the ticket-log dashboard
- Tells the requester that the ticket may be closed or retained temporarily

### Closing a ticket

The requester, staff, or a qualifying visible member can select **Close Ticket**. The bot:

- Changes status to `CLOSED`
- Records who closed it and when
- Removes the requester's channel overwrite
- Renames the channel with a `closed-` prefix
- Removes the ticket buttons
- Refreshes the ticket-log dashboard

### Retention

Every day at midnight, Ticketbot checks completed and closed tickets. Channels whose completion or closure timestamp is at least 30 days old are deleted, and their active ticket record is removed.

### Ticket logs dashboard

The dashboard shows the newest ticket events first, 15 per page. Each entry includes ticket number, action, requester, actor, and timestamp.

## Dino fulfillment

### Intended purpose

Allow authorized moderators to deliver approved creatures to an online player through a reviewed, logged workflow rather than manually composing RCON commands.

### Access control

Every dino interaction requires `DINO_FULFILLMENT_ROLE_ID`. Unauthorized users receive an ephemeral rejection.

### Creature selection

Moderators can:

- Browse the approved catalog, 25 creatures per page
- Search by creature name or alias
- Review gender behavior, saddle applicability, source content, and DLC requirements

A session expires after 15 minutes.

### Fixed fulfillment rules

The current command builder is intended to deliver:

- Level 450 creatures
- 100% imprint
- Cryopod delivery
- A male and female pair for gendered creatures
- One creature for genderless creatures
- An ascendant saddle at quality 10.0 when a saddle applies

These are application rules, not moderator-entered fields.

### Online-player selection

When **Select Online Player** is chosen, Ticketbot scans all enabled ARK server entries. This can take a few seconds. Results display character name and server/map name.

The selected value includes the server ID and EOS ID. The review page shows the character, map, creature, delivery quantity, gender, saddle, content source, DLC warning, and whether the bot is in MOCK or LIVE mode.

### Confirmation and delivery

When **Confirm Spawn** is selected, Ticketbot:

1. Creates a unique request ID.
2. Revalidates the selected creature, server, and online player.
3. Builds one or more AAT commands.
4. Sends commands to the selected server through RCON, or simulates them in mock mode.
5. Returns `SUCCESS`, `PARTIAL`, or `FAILED` based on command results.
6. Stores the fulfillment result in SQLite.
7. Refreshes the persistent dino-log dashboard.

### DLC warning

Catalog entries can declare a DLC requirement. The panel and review page warn that the recipient may be unable to use the creature or some abilities without owning the required DLC.

### Fulfillment logs

The persistent log dashboard displays five entries per page. Each entry shows status, moderator, creature, target character, server, and timestamp. The detailed database record also stores the request ID, EOS ID, serialized result, and creation time.

## Mock mode

### Intended purpose

Allow installation testing without connecting to live ARK servers or sending real commands.

Set:

```env
ARK_RCON_MOCK=true
```

In mock mode:

- Online players come from synthetic data in `services/rcon.js`.
- RCON commands return simulated success messages.
- The review screen clearly shows MOCK mode.

Keep mock mode enabled until all other configuration is complete.

## Live RCON mode

Set `ARK_RCON_MOCK=false` only after validation. The RCON service reads the password from the environment-variable name stored in each server's `passwordEnv` property.

The service uses TCP with the challenge option disabled, waits for authentication, sends the command, captures the response, and applies a timeout. Online-player scanning queries servers in parallel and reports unavailable servers separately.

## Database

Ticketbot creates `database.sqlite` in the project directory. It contains tables for:

- PINs
- Player in-game names
- Tickets
- Panel message IDs
- Counters
- Ticket logs
- Imported shop catalog
- Dino fulfillment logs

The database is runtime data and is excluded from Git. Back it up securely because it may contain PINs, player identifiers, ticket history, and EOS IDs.

## Slash-command reference

### `/viewpins`

Staff-only. Returns a private text list of PIN records.

### `/getpin user:<user>`

Staff-only. Returns one user's Discord name, in-game name, and PIN.

### `/resetpin user:<user>`

Staff-only. Generates a new four-digit PIN for the selected user.

### `/generateallpins`

Staff-only. Generates missing PINs for users with the configured member or staff role.

### `/shop-search query:<text>`

Available before the general staff-only command gate. Searches the imported shop catalog and returns results privately.

### `/shop-refresh`

Staff-only. Reimports `data/shop-catalog.csv`.

## Main source files

- `index.js`: Discord client, SQLite schema, PINs, names, shop, tickets, panels, slash commands, and retention cleanup.
- `deploy-commands.js`: Registers global slash commands.
- `config/ark-servers.js`: User-editable ARK/RCON server list.
- `features/dino-fulfillment-panel.js`: Discord UI and orchestration for dino delivery and logs.
- `services/rcon.js`: RCON connection, `ListPlayers` parsing, cross-server scanning, and mock mode.
- `services/creature-catalog.js`: Creature lookup, search, paging, and catalog validation.
- `services/aat-command-builder.js`: Fixed fulfillment summary and AAT command generation.
- `services/fulfillment-coordinator.js`: Final validation, player recheck, command execution, and aggregate status.
- `data/shop-catalog.csv`: User-editable in-game shop catalog.
- `data/dino-catalog.json`: Approved dino fulfillment catalog.
- `database.sqlite`: Generated runtime database, never commit it.

## Operational safety

- Never expose the Discord token or RCON passwords.
- Keep staff and moderator dashboard channels private.
- Back up the SQLite database securely.
- Test catalog and command changes in mock mode.
- Review DLC ownership warnings with players.
- Deployment and rollback are operator-controlled host actions performed outside Discord. See `docs/V2_DEPLOYMENT.md`.
