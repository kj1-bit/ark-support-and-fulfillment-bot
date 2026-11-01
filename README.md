# Ticketbot

Ticketbot is a configurable Discord support bot for ARK: Survival Ascended communities. It combines support tickets, vault PIN management, in-game name records, a searchable shop catalog, persistent staff dashboards, and optional AAT/RCON dino fulfillment.

> Start with `ARK_RCON_MOCK=true`. Do not enable live RCON fulfillment until the Discord workflow, server list, credentials, and generated commands have been tested.

## Documentation

- [Complete setup guide](docs/SETUP.md)
- [Features and operating guide](docs/FEATURES.md)
- [Example environment configuration](.env.example)
- [Example ARK server configuration](config/ark-servers.js)
- [Example shop catalog](data/shop-catalog.csv)

## Major features

- Private, sequentially numbered support-ticket channels
- Ticket completion, closure, logs, and 30-day cleanup
- Four-digit vault PIN generation and staff dashboard
- Player in-game-name collection
- CSV-backed shop search with autocomplete
- Moderator-only dino fulfillment through AAT and RCON
- Approved creature catalog with DLC warnings
- Persistent paginated dashboards for PINs, ticket logs, and dino fulfillment logs
- SQLite storage that is created automatically at runtime
- Optional owner-only update command

## Quick start

```powershell
git clone YOUR_PUBLIC_REPOSITORY_URL
cd ticketbot-public
npm.cmd ci
Copy-Item .env.example .env
```

1. Create a Discord application and bot.
2. Enable the Server Members privileged gateway intent.
3. Invite the bot with the permissions listed in `docs/SETUP.md`.
4. Create the required roles, category, and text channels.
5. Fill in `.env` with your own IDs and token.
6. Edit `config/ark-servers.js` and `data/shop-catalog.csv`.
7. Register slash commands:

```powershell
node deploy-commands.js
```

8. Start the bot:

```powershell
node index.js
```

## Required and supported ARK mods

### Shop catalog

The CSV-backed shop catalog and Discord shop-search feature are designed
to document packages configured through
[Resonant's Shop Mod](https://www.curseforge.com/ark-survival-ascended/mods/resonants-shop-mod).

Resonant's Shop Mod allows server administrators to create purchasable
packages containing creatures and items. Players access its in-game shop
interface with F1. Ticketbot does not create or manage these packages.
It imports a separately maintained CSV representation so players and
staff can search the configured shop through Discord.

The example `data/shop-catalog.csv` file contains demonstration data and
must be replaced with catalog data appropriate for the server using the
bot.

### Automated dino fulfillment

The feature that spawns creatures in cryopods directly into a selected
online player's inventory has only been developed and tested on servers
with [Awesome ARK Tools](https://www.curseforge.com/ark-survival-ascended/mods/awesome-admin-tools) installed.

Ticketbot uses Awesome ARK Tools script commands through RCON to create
the configured creature, apply the fixed fulfillment settings, place it
in a cryopod, and target the selected player's EOS ID.

This project does not claim that automated fulfillment will work without
Awesome ARK Tools or with a different admin-tools mod. Test the complete
workflow on a non-production server with `ARK_RCON_MOCK=true` before
enabling live delivery.

These mods are separate third-party projects and are not included in or
licensed by this repository.

## Security

Never commit the following:

- `.env`
- Discord bot tokens
- RCON passwords
- `database.sqlite`
- logs or backups containing player data
- real EOS IDs used only for testing

The included `.gitignore` excludes the normal runtime secrets, databases, logs, dependencies, and backups.

## License

Original code and documentation in this repository are released under CC0 1.0 Universal. You may use, copy, modify, and distribute this material without asking permission.

Third-party packages are not covered by this public-domain dedication. They remain subject to their respective licenses, including Apache-2.0, BSD, ISC, and MIT terms. See each dependency's package and license files.

ARK: Survival Ascended, Discord, AAT, creature names, blueprint paths, and other third-party names or materials remain the property of their respective owners. This project is not affiliated with or endorsed by those parties.
