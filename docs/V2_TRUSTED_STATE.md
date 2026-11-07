# V2 trusted state

This checkpoint adds server-side session records, a verified player identity registry, and a validated catalog lifecycle manager. Sessions carry opaque tokens and authoritative actor, context, action, request, expiration, version, and state fields. Only verified Discord-to-EOS links enter the trusted player registry. Catalog proposals are fully validated before activation, the previous known-good catalog is retained, activation is audited, and rollback is explicit.

This source-only layer does not activate V2 or contact Discord, SQLite, or RCON.
