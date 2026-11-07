'use strict';

const { createAuthorizationPolicy, authorize, createInteractionGuard } = require('../security');
const { createServerRegistry } = require('../registries/server-registry');
const { createCreatureRegistry } = require('../registries/creature-registry');
const { createSqliteFulfillmentRepository } = require('../adapters/sqlite/fulfillment-repository');
const { createArkOperationService } = require('../adapters/rcon/operation-service');
const { createFulfillmentService } = require('../application/fulfillment-service');
const { createAuditLogger } = require('../logging/audit-logger');
const { createMigrationRunner } = require('../migrations/migration-runner');
const migration001 = require('../migrations/001-v2-core');
const migration002 = require('../migrations/002-trusted-state');
const { checkIntegrity } = require('../recovery/database-recovery');

function buildAuthorizationOptions(config) {
  const roleId = config.discord.roles.fulfillmentModerator;
  const channelIds = [
    config.discord.channels.fulfillment,
    config.discord.channels.fulfillmentLogs
  ].filter(Boolean);

  return Object.freeze({
    guildId: config.discord.guildId,
    capabilities: Object.freeze({
      'fulfillment.confirm': Object.freeze({
        roleIds: Object.freeze([roleId]),
        channelIds: Object.freeze(channelIds)
      })
    })
  });
}

async function composeRuntime(options = {}) {
  const {
    config,
    database,
    catalog,
    transport,
    buildFulfillmentPlan,
    auditSink,
    clock = Date.now,
    randomUUID,
    createBackup = async () => null
  } = options;

  if (!config || !Object.isFrozen(config)) {
    throw new TypeError('Frozen validated configuration is required.');
  }
  if (!database) throw new TypeError('database is required.');
  if (!catalog) throw new TypeError('catalog is required.');
  if (!transport || typeof transport.execute !== 'function') {
    throw new TypeError('transport.execute is required.');
  }
  if (typeof buildFulfillmentPlan !== 'function') {
    throw new TypeError('buildFulfillmentPlan is required.');
  }
  if (typeof auditSink !== 'function') {
    throw new TypeError('auditSink is required.');
  }

  await checkIntegrity(database);
  const backup = await createBackup();
  const migrationRunner = createMigrationRunner({
    database,
    migrations: [migration001, migration002],
    clock
  });
  const schemaVersion = await migrationRunner.run();
  await checkIntegrity(database);

  const policy = createAuthorizationPolicy(buildAuthorizationOptions(config));
  const authorization = Object.freeze({
    authorize(capability, context) {
      return authorize(policy, capability, context);
    }
  });
  const interactionGuard = createInteractionGuard({
    ttlMs: 15 * 60 * 1000,
    now: clock,
    randomUUID
  });
  const servers = createServerRegistry(config.ark.servers);
  const creatures = createCreatureRegistry(catalog);
  const audit = createAuditLogger({ sink: auditSink, clock });
  const repository = createSqliteFulfillmentRepository(database);
  const ark = createArkOperationService({
    serverRegistry: servers,
    transport,
    buildFulfillmentPlan
  });
  const fulfillment = createFulfillmentService({
    authorization,
    interactionGuard,
    repository,
    creatures,
    ark,
    audit,
    clock,
    uuid: randomUUID
  });

  return Object.freeze({
    schemaVersion,
    backup,
    authorization,
    interactionGuard,
    servers,
    creatures,
    audit,
    repository,
    ark,
    fulfillment
  });
}

module.exports = { buildAuthorizationOptions, composeRuntime };
