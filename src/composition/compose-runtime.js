'use strict';
const { createAuthorizationPolicy, authorize } = require('../security');
const { createServerRegistry } = require('../registries/server-registry');
const { createPlayerRegistry } = require('../registries/player-registry');
const { createCatalogManager } = require('../catalog/catalog-manager');
const { createSessionStore } = require('../domain/sessions/session-store');
const { createPlayerNameService } = require('../domain/player-names/player-name-service');
const { createSqliteFulfillmentRepository } = require('../adapters/sqlite/fulfillment-repository');
const { createSqliteSessionRepository } = require('../adapters/sqlite/session-repository');
const { createSqlitePlayerRepository } = require('../adapters/sqlite/player-repository');
const { createSqlitePlayerNameRepository } = require('../adapters/sqlite/player-name-repository');
const { createSqliteCatalogStore } = require('../adapters/sqlite/catalog-store');
const { createArkOperationService } = require('../adapters/rcon/operation-service');
const { createFulfillmentService } = require('../application/fulfillment-service');
const { createAuditLogger } = require('../logging/audit-logger');
const { createMigrationRunner } = require('../migrations/migration-runner');
const migration001 = require('../migrations/001-v2-core');
const migration002 = require('../migrations/002-trusted-state');
const migration003 = require('../migrations/003-player-names');
const { checkIntegrity } = require('../recovery/database-recovery');

function buildAuthorizationOptions(config) {
  const moderatorRoleId = config.discord.roles.fulfillmentModerator;
  const staffRoleId = config.discord.roles.staff;
  const channelIds = [config.discord.channels.fulfillment, config.discord.channels.fulfillmentLogs].filter(Boolean);
  return Object.freeze({guildId:config.discord.guildId,capabilities:Object.freeze({
    'fulfillment.confirm':Object.freeze({roleIds:Object.freeze([moderatorRoleId]),channelIds:Object.freeze(channelIds)}),
    'player-names.verify':Object.freeze({roleIds:Object.freeze([staffRoleId]),channelIds:Object.freeze(channelIds)})
  })});
}

async function composeRuntime(options={}) {
  const {config,database,catalog,transport,buildFulfillmentPlan,auditSink,clock=Date.now,randomUUID,createBackup=async()=>null}=options;
  if(!config||!Object.isFrozen(config))throw new TypeError('Frozen validated configuration is required.');
  if(!database)throw new TypeError('database is required.');
  if(!catalog)throw new TypeError('catalog is required.');
  if(!transport||typeof transport.execute!=='function')throw new TypeError('transport.execute is required.');
  if(typeof buildFulfillmentPlan!=='function')throw new TypeError('buildFulfillmentPlan is required.');
  if(typeof auditSink!=='function')throw new TypeError('auditSink is required.');
  await checkIntegrity(database);
  const backup=await createBackup();
  const schemaVersion=await createMigrationRunner({database,migrations:[migration001,migration002,migration003],clock}).run();
  await checkIntegrity(database);
  const policy=createAuthorizationPolicy(buildAuthorizationOptions(config));
  const authorization=Object.freeze({authorize(capability,context){return authorize(policy,capability,context);}});
  const audit=createAuditLogger({sink:auditSink,clock});
  const interactionGuard=createSessionStore({repository:createSqliteSessionRepository(database),clock,uuid:randomUUID});
  const playerRepository=createSqlitePlayerRepository(database);
  const players=createPlayerRegistry(await playerRepository.list());
  const playerNameRepository=createSqlitePlayerNameRepository(database);
  const basePlayerNames=createPlayerNameService({repository:playerNameRepository,audit,clock});
  const playerNames=Object.freeze({submit:basePlayerNames.submit,get:basePlayerNames.get,async verify(input){authorization.authorize('player-names.verify',input.context);return basePlayerNames.verify(input);}});
  const catalogStore=createSqliteCatalogStore(database,{clock});
  const persistedCatalog=await catalogStore.loadActive();
  const catalogManager=createCatalogManager({initialCatalog:persistedCatalog||catalog,store:catalogStore,audit});
  const creatures=catalogManager.current();
  if(!persistedCatalog)await catalogStore.activate(creatures);
  const servers=createServerRegistry(config.ark.servers);
  const repository=createSqliteFulfillmentRepository(database);
  const ark=createArkOperationService({serverRegistry:servers,transport,buildFulfillmentPlan});
  const fulfillment=createFulfillmentService({authorization,interactionGuard,repository,creatures,ark,audit,clock,uuid:randomUUID});
  return Object.freeze({schemaVersion,backup,authorization,interactionGuard,players,playerRepository,playerNames,playerNameRepository,catalogManager,catalogStore,servers,creatures,audit,repository,ark,fulfillment});
}
module.exports={buildAuthorizationOptions,composeRuntime};
