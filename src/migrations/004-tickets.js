'use strict';

const createTickets = `CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('OPEN','CLAIMED','CLOSED')),
  moderator_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

const indexes = Object.freeze([
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_open_unique
   ON tickets(actor_id,type) WHERE state IN ('OPEN','CLAIMED')`,
  'CREATE INDEX IF NOT EXISTS idx_tickets_state_updated ON tickets(state,updated_at)'
]);
const v2Columns = Object.freeze([
  'id', 'type', 'description', 'actor_id', 'player_name', 'guild_id',
  'channel_id', 'state', 'moderator_id', 'created_at', 'updated_at'
]);

async function ensureIndexes(database) {
  for (const statement of indexes) await database.executeSql(statement);
}

async function up(database) {
  const tables = await database.all("SELECT name FROM sqlite_master WHERE type='table' AND name='tickets'");
  if (!tables.length) {
    await database.executeSql(createTickets);
    await ensureIndexes(database);
    return;
  }

  const columns = await database.all('PRAGMA table_info(tickets)');
  const names = new Set(columns.map(column => column.name));
  if (v2Columns.every(column => names.has(column))) {
    await ensureIndexes(database);
    return;
  }

  if (names.has('channel_id') && names.has('user_id') && names.has('status')) {
    const archive = await database.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tickets_v1_legacy'"
    );
    if (archive.length) {
      throw new Error('Cannot preserve the V1 tickets table: tickets_v1_legacy already exists.');
    }
    await database.executeSql('ALTER TABLE tickets RENAME TO tickets_v1_legacy');
    await database.executeSql(createTickets);
    await ensureIndexes(database);
    return;
  }

  throw new Error('Unsupported tickets table schema; no ticket data was changed.');
}

module.exports = Object.freeze({
  version: 4,
  name: 'tickets',
  statements: Object.freeze([createTickets, ...indexes]),
  up
});
