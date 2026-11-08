# Ticketbot V2 authorization and interaction-security foundation

> **Historical foundation checkpoint.** The controls described here have since been integrated into the V2 services and Discord feature flow. This is not a statement that they remain isolated or a V2 startup guide. See the [V2 guide](V2_GUIDE.md), [source path map and Debian startup plan](V2_DEBIAN_STARTUP_PLAN.md), and current implementation under `src/security/`, `src/application/`, and `src/features/`.

This checkpoint originally added dependency-injected security primitives without changing the V1 runtime or production behavior.

## Controls

- Authorization policies require a valid guild and at least one role for every capability.
- Authorization fails closed for unknown capabilities, wrong guilds, wrong channels, missing roles, and malformed actors.
- Interaction tokens bind actor, guild, channel, message, action, issuance time, and expiration.
- Tokens are single-use and reject expiration, replay, and context mismatch.
- Safe application errors expose stable categories and public messages without exposing their internal cause.
- Recursive redaction removes sensitive keys and masks EOS-like identifiers embedded in strings.

## Current integration boundary

V2 composition builds authorization from validated configuration and passes narrow authorized services to V2 feature handlers. The root V1 handlers remain separate. `src/composition/start-v2.js` remains the injected coordinator; `scripts/start-v2.js` supplies the Debian-capable executable wiring.

## Private-configuration impact

The private operations configuration must eventually map installation-specific guild, channel, and role IDs into the public authorization-policy schema. This checkpoint adds no private values and reads no environment variables.

## Compatibility

No current Discord, ticket, PIN, shop, fulfillment, database, RCON, or deployment behavior changes in this isolated checkpoint.

## Rollback

The commit-specific rollback instructions above are historical. Use the reviewed [V2 rollback plan](V2_ROLLBACK.md) for current source and data recovery guidance.
