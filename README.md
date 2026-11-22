# Ticketbot

Ticketbot is a Discord support and operations bot for ARK: Survival Ascended communities. The repository contains the original V1 application and a newer, security-focused V2 runtime.

> **Note:** V2 is running on Debian and has been exercised with the configured Discord application and ARK/RCON environment. Core Discord, catalog, SQLite runtime persistence, and RCON workflows have been exercised. Database backup and restoration verification remains incomplete. Remaining production-readiness work is tracked in [docs/V2_ROADMAP.md](docs/V2_ROADMAP.md). The root `index.js` still starts V1; V2 starts through `npm run start:v2` or `node scripts/start-v2.js`.

## Documentation

- [V2 guide: overview, configuration, features, security, and test readiness](docs/V2_GUIDE.md)
- [Debian isolated V2 startup plan](docs/V2_DEBIAN_STARTUP_PLAN.md)
- [V2 configuration reference](docs/V2_CONFIGURATION.md)
- [V2 retention and cleanup policy](docs/V2_RETENTION.md)
- [V2 deployment boundary and rollback guidance](docs/V2_DEPLOYMENT.md)
- [V2 roadmap and current status](docs/V2_ROADMAP.md)
- [Legacy V1 setup guide](docs/SETUP.md)
- [Legacy V1 features and operating guide](docs/FEATURES.md)

## V2 at a glance

V2 is designed around validated configuration, feature-specific authorization, persistent SQLite state, audited operations, and a narrow Discord/RCON boundary. Its implemented feature areas include:

- Player-name submission and staff verification
- Support tickets
- Encrypted Vault PINs, private player retrieval, and a staff-only name/PIN directory
- Shop/catalog search
- Moderator-controlled fulfillment to verified online players
- Persistent, paginated staff log panels
- Expiration cleanup and recovery of interrupted fulfillment

The feature list describes implemented V2 source. Core Discord, catalog, persistence, and RCON workflows have been exercised in its documented environment. Remaining production-readiness work is tracked in [docs/V2_ROADMAP.md](docs/V2_ROADMAP.md). Merging source does not activate V2, migrate the V1 production database, change Discord commands, or stop V1.

## Existing V1 application

The root `index.js`, `deploy-commands.js`, `.env.example`, and the [V1 setup guide](docs/SETUP.md) belong to the existing V1 application. Use those instructions only when operating the V1 service. V1 uses `ARK_RCON_MOCK`; V2 uses a different, explicit configuration model and must not infer its safety mode from that V1 variable.

## Development checks

Install dependencies with `npm ci` (or `npm.cmd ci` in Windows PowerShell), then run the checks from the repository root:

```powershell
npm.cmd test
node scripts/test-creature-catalog.js
npm.cmd run config:validate -- config/examples/instance.example.json
git diff --check
```

On Linux/macOS, replace `npm.cmd` with `npm`. The catalog check validates the repository's current creature catalog; it is not a V2 deployment command.

## Security

Never commit bot tokens, RCON credentials, PIN-protection keys, local instance configuration, production databases, backups, logs containing player information, or real player identifiers used for testing. Keep test credentials and production credentials separate. See the [V2 guide](docs/V2_GUIDE.md) before preparing any private configuration.

## License

Original code and documentation in this repository are released under CC0 1.0 Universal. Third-party packages and names remain subject to their own licenses and ownership.
