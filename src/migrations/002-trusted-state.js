'use strict';
module.exports=Object.freeze({version:2,name:'trusted-state',statements:Object.freeze([
`CREATE TABLE IF NOT EXISTS interaction_sessions (token TEXT PRIMARY KEY, feature TEXT NOT NULL, actor_id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT NOT NULL, action TEXT NOT NULL, request_id TEXT, state TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER)`,
`CREATE INDEX IF NOT EXISTS idx_sessions_state_expires ON interaction_sessions(state, expires_at)`,
`CREATE TABLE IF NOT EXISTS trusted_players (discord_id TEXT PRIMARY KEY, eos_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, verified_at INTEGER NOT NULL, source TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS catalog_versions (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, catalog_json TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, activated_at INTEGER)`,
`CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_active ON catalog_versions(state) WHERE state='ACTIVE'`
])});
