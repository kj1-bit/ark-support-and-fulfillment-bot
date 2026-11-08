'use strict';
const { ConfigurationError } = require('./configuration-error');
function required(env,name,issues) { const value=env[name]; if(typeof value!=='string'||!value.trim()) issues.push(`${name}: required for V1 compatibility mapping`); return value||''; }
function port(env,name,issues) { const raw=required(env,name,issues); const value=Number(raw); if(!Number.isInteger(value)||value<1||value>65535) issues.push(`${name}: invalid TCP port`); return value; }
function mapV1Environment(env=process.env, options={}) {
  const issues=[]; const mode=options.mode;
  if (!['mock','test','production'].includes(mode)) issues.push('mode: explicit mock, test, or production value is required; ARK_RCON_MOCK is not trusted');
  if (Object.prototype.hasOwnProperty.call(env,'UPDATE_SCRIPT_PATH')&&String(env.UPDATE_SCRIPT_PATH).trim()) issues.push('UPDATE_SCRIPT_PATH: prohibited in V2 configuration');
  const config={ schemaVersion:1, runtime:{mode,environment:options.environment||'v1-migration',logLevel:options.logLevel||'info'}, discord:{ clientId:required(env,'CLIENT_ID',issues), guildId:required(env,'GUILD_ID',issues), tokenSecret:'DISCORD_TOKEN', roles:{ staff:env.STAFF_ROLE_ID||null, member:env.MEMBER_ROLE_ID||null, fulfillmentModerator:env.DINO_FULFILLMENT_ROLE_ID||null }, channels:{ ticketCategory:env.CATEGORY_ID||null, vault:env.VAULT_CHANNEL_ID||null, requests:env.REQUESTS_CHANNEL_ID||null, playerNames:env.IGN_CHANNEL_ID||null, pinsDashboard:env.PINS_DASHBOARD_CHANNEL_ID||null, ticketLogs:env.TICKET_LOGS_CHANNEL_ID||null, fulfillment:env.DINO_FULFILLMENT_CHANNEL_ID||null, fulfillmentLogs:env.DINO_FULFILLMENT_LOG_CHANNEL_ID||null } }, ark:{ timeoutMs:10000, servers:[{id:'v1-primary',name:'V1 Primary',host:required(env,'ARK_RCON_HOST',issues),port:port(env,'ARK_RCON_PORT_1',issues),passwordSecret:'ARK_RCON_PASSWORD',enabled:true,testOnly:false,operations:['listOnlinePlayers','fulfillApprovedCreature']}] }, storage:{databasePath:options.databasePath||'./runtime/database.sqlite',backupPath:options.backupPath||'./runtime/backups'},   features:{tickets:true,pins:true,playerNames:true,shop:true,fulfillment:Boolean(env.DINO_FULFILLMENT_ROLE_ID),dashboards:false} };
  if (issues.length) throw new ConfigurationError(issues);
  return config;
}
module.exports={ mapV1Environment };
