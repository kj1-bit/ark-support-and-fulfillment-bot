# Ticketbot V2 configuration foundation

This checkpoint implements GitHub issue #2 as an isolated library. It does not change `index.js`, connect to Discord or RCON, open SQLite, or alter V1 production behavior.

## Sources and ownership

- Public schemas and examples: tracked under `config/schemas/` and `config/examples/`.
- Installation-specific non-secret configuration: ignored `config/runtime/*.local.json` or the private operations repository.
- Secrets: host environment or an approved secret provider only.
- Raw environment access: bootstrap and secret-resolution boundaries only.

## Deployment modes

`runtime.mode` is mandatory and accepts only `mock`, `test`, or `production`. The V1 `ARK_RCON_MOCK` Boolean is deliberately not used to select V2 mode. Unknown or missing modes fail validation.

- `mock`: permits safe examples and does not require RCON secrets. Later adapters must guarantee no RCON network activity.
- `test`: requires secrets for enabled connections and permits test-only servers.
- `production`: requires secrets, rejects enabled example/test-only servers, and requires storage paths outside the source repository.

## Validate a local file

Copy `config/examples/instance.example.json` to ignored `config/runtime/instance.local.json`, replace example identifiers with installation-specific values, and run:

```powershell
npm.cmd run config:validate -- config/runtime/instance.local.json
```

Successful output is a redacted summary. It reports only secret presence and never prints secret values or storage paths.

## V1 compatibility adapter

`mapV1Environment()` provides a temporary, explicit migration mapping. Callers must provide the V2 mode separately. It rejects a non-empty `UPDATE_SCRIPT_PATH` and never trusts `ARK_RCON_MOCK` as a production-safety decision.

A V1 installation must add `GUILD_ID` before using the adapter because the current V1 example does not define it.

## Security review

- Unknown keys are rejected.
- Discord snowflakes, server IDs, ports, secret-reference names, booleans, modes, operations, feature dependencies, and production storage boundaries are validated.
- Required test/production secrets are checked by presence only.
- Errors identify fields but do not include secret values.
- Returned configuration is deeply frozen.
- Production example/test server activation fails closed.

## Private-configuration impact

A future private operations repository or ignored local configuration must provide guild, channel, role, server, storage, and feature values. Secrets remain on the host. No private values are introduced by this checkpoint.

## Rollback

Before integration, remove the files introduced by this checkpoint and restore `.gitignore`, `package.json`, and `docs/V2_ROADMAP.md` from starting commit `f18b0e2`. Because no existing runtime entry point consumes this library, rollback does not require database, Discord, RCON, or service changes.
