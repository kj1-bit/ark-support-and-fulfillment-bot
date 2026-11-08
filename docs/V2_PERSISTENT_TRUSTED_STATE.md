# V2 persistent trusted state

Migration 002 persists authoritative interaction sessions, verified player identities, and versioned catalog history. Session consumption uses one conditional update bound to state, expiration, actor, guild, channel, message, and action. Catalog activation is transactional and retains previous versions for rollback. This checkpoint is source-only and does not touch production data.
