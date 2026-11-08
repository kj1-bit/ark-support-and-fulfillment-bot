'use strict';
const path = require('node:path');
const { ConfigurationError } = require('./configuration-error');
const MODES = new Set(['mock', 'test', 'production']);
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const SNOWFLAKE = /^[1-9][0-9]{16,19}$/;
const SERVER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECRET_REF = /^[A-Z][A-Z0-9_]{2,127}$/;
const OPERATIONS = new Set(['listOnlinePlayers', 'fulfillApprovedCreature']);
const FEATURES = ['tickets', 'pins', 'playerNames', 'shop', 'fulfillment', 'dashboards'];
const TOP_KEYS = new Set(['schemaVersion','runtime','discord','ark','storage','features']);
function object(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function addUnknown(obj, allowed, at, issues) {
  if (!object(obj)) return;
  for (const key of Object.keys(obj)) if (!allowed.has(key)) issues.push(`${at}.${key}: unknown property`);
}
function reqString(obj,key,at,issues,{pattern,allowEmpty=false}={}) {
  const value=obj?.[key];
  if (typeof value!=='string'||(!allowEmpty&&!value.trim())) { issues.push(`${at}.${key}: required non-empty string`); return null; }
  if (pattern&&!pattern.test(value)) issues.push(`${at}.${key}: invalid format`);
  return value;
}
function reqBool(obj,key,at,issues) { if (typeof obj?.[key]!=='boolean') issues.push(`${at}.${key}: required boolean`); return obj?.[key]; }
function snowflake(obj,key,at,issues,required=true) {
  const value=obj?.[key]; if (!required&&(value===null||value===undefined)) return null;
  if (typeof value!=='string'||!SNOWFLAKE.test(value)) issues.push(`${at}.${key}: invalid Discord snowflake`); return value;
}
function validateConfig(input, options={}) {
  const issues=[]; const env=options.env||process.env; const sourceRoot=path.resolve(options.sourceRoot||process.cwd());
  if (!object(input)) throw new ConfigurationError(['configuration: expected object']);
  addUnknown(input,TOP_KEYS,'configuration',issues);
  if (input.schemaVersion!==1) issues.push('configuration.schemaVersion: must equal 1');
  const runtime=input.runtime;
  if (!object(runtime)) issues.push('configuration.runtime: required object'); else {
    addUnknown(runtime,new Set(['mode','environment','logLevel']),'configuration.runtime',issues);
    if (!MODES.has(runtime.mode)) issues.push('configuration.runtime.mode: must be mock, test, or production');
    reqString(runtime,'environment','configuration.runtime',issues);
    if (!LOG_LEVELS.has(runtime.logLevel)) issues.push('configuration.runtime.logLevel: must be debug, info, warn, or error');
  }
  const discord=input.discord;
  if (!object(discord)) issues.push('configuration.discord: required object'); else {
    addUnknown(discord,new Set(['clientId','guildId','tokenSecret','roles','channels']),'configuration.discord',issues);
    snowflake(discord,'clientId','configuration.discord',issues);
    snowflake(discord,'guildId','configuration.discord',issues);
    reqString(discord,'tokenSecret','configuration.discord',issues,{pattern:SECRET_REF});
    for (const section of ['roles','channels']) {
      if (!object(discord[section])) issues.push(`configuration.discord.${section}: required object`);
      else for (const [key,value] of Object.entries(discord[section])) if (value!==null&&(typeof value!=='string'||!SNOWFLAKE.test(value))) issues.push(`configuration.discord.${section}.${key}: invalid Discord snowflake`);
    }
  }
  const ark=input.ark;
  if (!object(ark)) issues.push('configuration.ark: required object'); else {
    addUnknown(ark,new Set(['timeoutMs','servers']),'configuration.ark',issues);
    if (!Number.isInteger(ark.timeoutMs)||ark.timeoutMs<1000||ark.timeoutMs>60000) issues.push('configuration.ark.timeoutMs: integer from 1000 through 60000 required');
    if (!Array.isArray(ark.servers)) issues.push('configuration.ark.servers: required array'); else {
      const ids=new Set();
      ark.servers.forEach((server,i)=>{
        const at=`configuration.ark.servers[${i}]`;
        if (!object(server)) { issues.push(`${at}: expected object`); return; }
        addUnknown(server,new Set(['id','name','host','port','passwordSecret','enabled','testOnly','operations']),at,issues);
        const id=reqString(server,'id',at,issues,{pattern:SERVER_ID}); if (id&&ids.has(id)) issues.push(`${at}.id: duplicate server ID`); if(id) ids.add(id);
        reqString(server,'name',at,issues); reqString(server,'host',at,issues);
        if (!Number.isInteger(server.port)||server.port<1||server.port>65535) issues.push(`${at}.port: integer from 1 through 65535 required`);
        reqString(server,'passwordSecret',at,issues,{pattern:SECRET_REF}); reqBool(server,'enabled',at,issues); reqBool(server,'testOnly',at,issues);
        if (!Array.isArray(server.operations)||!server.operations.length) issues.push(`${at}.operations: non-empty array required`);
        else for (const op of server.operations) if(!OPERATIONS.has(op)) issues.push(`${at}.operations: unsupported operation ${String(op)}`);
        if (runtime?.mode==='production'&&server.enabled&&(server.testOnly||String(server.id).startsWith('example-')||String(server.host).includes('example'))) issues.push(`${at}: example or test-only server cannot be enabled in production`);
        if ((runtime?.mode==='test'||runtime?.mode==='production')&&server.enabled&&server.passwordSecret&&!env[server.passwordSecret]) issues.push(`${at}.passwordSecret: required secret is not present`);
      });
    }
  }
  const storage=input.storage;
  if (!object(storage)) issues.push('configuration.storage: required object'); else {
    addUnknown(storage,new Set(['databasePath','backupPath']),'configuration.storage',issues);
    for (const key of ['databasePath','backupPath']) {
      const value=reqString(storage,key,'configuration.storage',issues);
      if (value&&runtime?.mode==='production') { const resolved=path.resolve(value); if (resolved===sourceRoot||resolved.startsWith(sourceRoot+path.sep)) issues.push(`configuration.storage.${key}: production path must be outside source repository`); }
    }
  }
  const features=input.features;
  if (!object(features)) issues.push('configuration.features: required object'); else {
    addUnknown(features,new Set(FEATURES),'configuration.features',issues);
    for (const name of FEATURES) reqBool(features,name,'configuration.features',issues);
    if (features.fulfillment===true) {
      if (!discord?.roles?.fulfillmentModerator) issues.push('configuration.features.fulfillment: fulfillmentModerator role is required');
      if (!discord?.channels?.fulfillment||!discord?.channels?.fulfillmentLogs) issues.push('configuration.features.fulfillment: fulfillment and fulfillmentLogs channels are required');
      if (!Array.isArray(ark?.servers)||!ark.servers.some(s=>s&&s.enabled)) issues.push('configuration.features.fulfillment: at least one server must be enabled');
    }
    if (features.playerNames===true) {
      if (!discord?.roles?.staff) issues.push('configuration.features.playerNames: staff role is required');
      if (!discord?.channels?.playerNames) issues.push('configuration.features.playerNames: playerNames channel is required');
    }
    if (features.tickets===true) {
      if (!discord?.roles?.staff) issues.push('configuration.features.tickets: staff role is required');
      if (!discord?.channels?.requests||!discord?.channels?.ticketLogs) issues.push('configuration.features.tickets: requests and ticketLogs channels are required');
    }
    if (features.pins===true) {
      if (!discord?.roles?.staff) issues.push('configuration.features.pins: staff role is required');
      if (!discord?.channels?.vault||!discord?.channels?.pinsDashboard) issues.push('configuration.features.pins: vault and pinsDashboard channels are required');
    }
    if (features.dashboards===true) {
      if (!discord?.roles?.staff) issues.push('configuration.features.dashboards: staff role is required');
      if (!discord?.channels?.ticketLogs||!discord?.channels?.pinsDashboard||!discord?.channels?.fulfillmentLogs) {
        issues.push('configuration.features.dashboards: ticketLogs, pinsDashboard, and fulfillmentLogs channels are required');
      }
    }
  }
  if ((runtime?.mode==='test'||runtime?.mode==='production')&&discord?.tokenSecret&&!env[discord.tokenSecret]) issues.push('configuration.discord.tokenSecret: required secret is not present');
  if (issues.length) throw new ConfigurationError(issues);
  return input;
}
module.exports={ FEATURES, LOG_LEVELS, MODES, OPERATIONS, SECRET_REF, SERVER_ID, SNOWFLAKE, validateConfig };
