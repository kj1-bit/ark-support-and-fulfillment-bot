'use strict';

module.exports = Object.freeze({
  version: 12,
  name: 'ticket-channels',
  statements: Object.freeze([
    'ALTER TABLE tickets ADD COLUMN ticket_number INTEGER',
    'ALTER TABLE tickets ADD COLUMN source_channel_id TEXT',
    'ALTER TABLE tickets ADD COLUMN message_id TEXT',
    "ALTER TABLE tickets ADD COLUMN channel_status TEXT CHECK(channel_status IN ('PROVISIONING','ACTIVE','ARCHIVED','FAILED','DELETED'))",
    'ALTER TABLE tickets ADD COLUMN completed_at INTEGER',
    'CREATE TABLE ticket_counter (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL)',
    'INSERT INTO ticket_counter (id,value) VALUES (1,0)',
    `CREATE TRIGGER ticket_assign_number AFTER INSERT ON tickets
     WHEN NEW.channel_status IS NOT NULL
     BEGIN
       UPDATE ticket_counter SET value=value+1 WHERE id=1;
       UPDATE tickets SET ticket_number=(SELECT value FROM ticket_counter WHERE id=1) WHERE id=NEW.id;
     END`,
    `CREATE UNIQUE INDEX idx_ticket_requester_active ON tickets(guild_id,actor_id)
     WHERE channel_status IS NOT NULL AND state IN ('OPEN','CLAIMED')`,
    'CREATE UNIQUE INDEX idx_ticket_channel ON tickets(channel_id) WHERE channel_status IN (\'ACTIVE\',\'ARCHIVED\')'
  ])
});
