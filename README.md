# Ticketbot

Ticketbot is a Discord support and operations bot for ARK: Survival Ascended communities. The repository contains the original V1 application and a newer, security-focused V2 runtime.

> **Important:** V2 now has a standalone launcher (`npm run start:v2` / `node scripts/start-v2.js`) with SQLite, Discord, catalog, and RCON wiring. It has focused mock-mode startup coverage, but has not yet been rehearsed on Debian or against a test Discord application and ARK server. `index.js` still starts V1. Do not connect V2 to production or treat command registration as part of startup. Follow the [V2 guide](docs/V2_GUIDE.md) and [Debian startup plan](docs/V2_DEBIAN_STARTUP_PLAN.md) for isolated staging.

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

The feature list describes implemented V2 source, not a production-ready deployment. Before any V2 test launch, stage the launcher in a separate environment and complete the test checklist. Merging source does not activate V2, migrate the V1 production database, change Discord commands, or stop V1.

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
