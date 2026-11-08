# Ticketbot V2 authorization and interaction-security foundation

This checkpoint adds isolated, dependency-injected security primitives. It does not connect them to the V1 runtime yet and does not change production behavior.

## Controls

- Authorization policies require a valid guild and at least one role for every capability.
- Authorization fails closed for unknown capabilities, wrong guilds, wrong channels, missing roles, and malformed actors.
- Interaction tokens bind actor, guild, channel, message, action, issuance time, and expiration.
- Tokens are single-use and reject expiration, replay, and context mismatch.
- Safe application errors expose stable categories and public messages without exposing their internal cause.
- Recursive redaction removes sensitive keys and masks EOS-like identifiers embedded in strings.

## Integration boundary

The next reviewed checkpoint will create validated policies from frozen V2 configuration and pass authorization evidence into privileged services. Existing V1 handlers remain unchanged until that integration has dedicated tests.

## Private-configuration impact

The private operations configuration must eventually map installation-specific guild, channel, and role IDs into the public authorization-policy schema. This checkpoint adds no private values and reads no environment variables.

## Compatibility

No current Discord, ticket, PIN, shop, fulfillment, database, RCON, or deployment behavior changes in this isolated checkpoint.

## Rollback

Restore commit `195e27a`, remove `src/security/`, `tests/security/authorization-foundation.test.js`, and this document, then restore the package test script and roadmap after reviewing the diff. No production, Discord, database, or RCON rollback is required.
