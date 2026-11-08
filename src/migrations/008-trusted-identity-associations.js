'use strict';
module.exports=Object.freeze({version:8,name:'trusted-identity-associations',statements:Object.freeze([
`CREATE TABLE IF NOT EXISTS trusted_identity_associations (id TEXT PRIMARY KEY, discord_id TEXT NOT NULL, normalized_player_name TEXT NOT NULL, eos_id TEXT NOT NULL, server_id TEXT NOT NULL, verification_source TEXT NOT NULL, state TEXT NOT NULL, observed_at INTEGER NOT NULL, verified_at INTEGER, reviewed_by TEXT, created_at INTEGER NOT NULL)`,
`CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_identity_verified_discord ON trusted_identity_associations(discord_id) WHERE state='VERIFIED'`,
`CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_identity_verified_eos ON trusted_identity_associations(eos_id) WHERE state='VERIFIED'`,
`CREATE INDEX IF NOT EXISTS idx_trusted_identity_state ON trusted_identity_associations(state,created_at)`
])});
