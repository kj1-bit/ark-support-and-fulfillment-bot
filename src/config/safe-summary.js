'use strict';
function createSafeConfigSummary(config, env=process.env) {
  return Object.freeze({
    schemaVersion: config.schemaVersion,
    mode: config.runtime.mode,
    environment: config.runtime.environment,
    logLevel: config.runtime.logLevel,
    discord: Object.freeze({ clientId: config.discord.clientId, guildId: config.discord.guildId, tokenPresent: Boolean(env[config.discord.tokenSecret]) }),
    enabledFeatures: Object.freeze(Object.entries(config.features).filter(([,v])=>v===true).map(([k])=>k)),
    servers: Object.freeze(config.ark.servers.map(s=>Object.freeze({ id:s.id, name:s.name, enabled:s.enabled, testOnly:s.testOnly, passwordPresent:Boolean(env[s.passwordSecret]), operations:Object.freeze([...s.operations]) }))),
    storage: Object.freeze({ databaseConfigured:Boolean(config.storage.databasePath), backupConfigured:Boolean(config.storage.backupPath) })
  });
}
module.exports={ createSafeConfigSummary };
