'use strict';

const { createAuthorizationPolicy, authorize } = require('../security');
const { createPinProtector } = require('../security/pin-protector');
const { createServerRegistry } = require('../registries/server-registry');
const { createPlayerRegistry } = require('../registries/player-registry');
const { createCatalogManager } = require('../catalog/catalog-manager');
const { createOperationalEventService } = require('../domain/dashboards/operational-event-service');
const { createDashboardService } = require('../domain/dashboards/dashboard-service');
const { createSessionStore } = require('../domain/sessions/session-store');
const { createPlayerNameService } = require('../domain/player-names/player-name-service');
const { createTicketService } = require('../domain/tickets/ticket-service');
const { createCatalogSearchService } = require('../domain/shop/catalog-search-service');
const { createPinService } = require('../domain/pins/pin-service');
const { createSqliteFulfillmentRepository } = require('../adapters/sqlite/fulfillment-repository');
const { createSqliteSessionRepository } = require('../adapters/sqlite/session-repository');
const { createSqlitePlayerRepository } = require('../adapters/sqlite/player-repository');
const { createSqlitePlayerNameRepository } = require('../adapters/sqlite/player-name-repository');
const { createSqliteTicketRepository } = require('../adapters/sqlite/ticket-repository');
const { createSqlitePinRepository } = require('../adapters/sqlite/pin-repository');
const { createSqliteCatalogStore } = require('../adapters/sqlite/catalog-store');
const { createSqliteOperationalEventRepository } = require('../adapters/sqlite/operational-event-repository');
const { createSqlitePanelRepository } = require('../adapters/sqlite/panel-repository');
const { createArkOperationService } = require('../adapters/rcon/operation-service');
const { createFulfillmentService } = require('../application/fulfillment-service');
const { createOnlinePlayerSelectionService } = require('../application/online-player-selection-service');
const { createSqliteRetentionRepository } = require('../adapters/sqlite/retention-repository');
const { createRetentionService } = require('../application/retention-service');
const { createAuditLogger } = require('../logging/audit-logger');
const { createMigrationRunner } = require('../migrations/migration-runner');
const migration001 = require('../migrations/001-v2-core');
const migration002 = require('../migrations/002-trusted-state');
const migration003 = require('../migrations/003-player-names');
const migration004 = require('../migrations/004-tickets');
const migration005 = require('../migrations/005-pins');
const migration006 = require('../migrations/006-operational-events');
const migration007 = require('../migrations/007-fulfillment-targets');
const migration008 = require('../migrations/008-trusted-identity-associations');
const migration009 = require('../migrations/009-discord-panels');
const migration010 = require('../migrations/010-fulfillment-result-redaction');
const { checkIntegrity } = require('../recovery/database-recovery');

function buildAuthorizationOptions(config) {
  const { roles, channels } = config.discord;
  const enabled = config.features || {};
  const capabilities = {};
  const requireId = (value, name) => {
    if (!value) throw new TypeError(`Enabled feature requires ${name}.`);
    return value;
  };
  const staff = enabled.tickets || enabled.pins || enabled.playerNames || enabled.dashboards
    ? requireId(roles.staff, 'discord.roles.staff')
    : roles.staff;

  if (enabled.fulfillment === true) {
    capabilities['fulfillment.confirm'] = Object.freeze({
      roleIds: Object.freeze([requireId(roles.fulfillmentModerator, 'discord.roles.fulfillmentModerator')]),
      channelIds: Object.freeze([requireId(channels.fulfillment, 'discord.channels.fulfillment')])
    });
  }
  if (enabled.playerNames === true) {
    capabilities['player-names.verify'] = Object.freeze({
      roleIds: Object.freeze([staff]),
      channelIds: Object.freeze([requireId(channels.playerNames, 'discord.channels.playerNames')])
    });
  }
  if (enabled.tickets === true) {
    capabilities['tickets.moderate'] = Object.freeze({
      roleIds: Object.freeze([staff]),
      channelIds: Object.freeze([
        requireId(channels.requests, 'discord.channels.requests'),
        requireId(channels.ticketLogs, 'discord.channels.ticketLogs')
      ])
    });
  }
  if (enabled.pins === true) {
    capabilities['pins.moderate'] = Object.freeze({
      roleIds: Object.freeze([staff]),
      channelIds: Object.freeze([
        requireId(channels.vault, 'discord.channels.vault'),
        requireId(channels.pinsDashboard, 'discord.channels.pinsDashboard')
      ])
    });
    capabilities['pins.deliver'] = Object.freeze({
      roleIds: Object.freeze([staff]),
      channelIds: Object.freeze([requireId(channels.vault, 'discord.channels.vault')])
    });
  }
  if (enabled.dashboards === true) {
    capabilities['dashboards.view'] = Object.freeze({
      roleIds: Object.freeze([staff]),
      channelIds: Object.freeze([
        requireId(channels.ticketLogs, 'discord.channels.ticketLogs'),
        requireId(channels.pinsDashboard, 'discord.channels.pinsDashboard'),
        requireId(channels.fulfillmentLogs, 'discord.channels.fulfillmentLogs')
      ])
    });
  }
  return Object.freeze({
    guildId: config.discord.guildId,
    capabilities: Object.freeze(capabilities)
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
    createBackup = async () => null,
    env = {}
  } = options;
  if (!config || !Object.isFrozen(config)) throw new TypeError('Frozen validated configuration is required.');
  if (!database) throw new TypeError('database is required.');
  if (!catalog) throw new TypeError('catalog is required.');
  if (!transport || typeof transport.execute !== 'function') throw new TypeError('transport.execute is required.');
  if (typeof buildFulfillmentPlan !== 'function') throw new TypeError('buildFulfillmentPlan is required.');
  if (typeof auditSink !== 'function') throw new TypeError('auditSink is required.');

  const authorizationOptions = buildAuthorizationOptions(config);
  const pinProtector = config.features?.pins === true
    ? createPinProtector({ key: env.PIN_PROTECTION_KEY })
    : null;

  await checkIntegrity(database);
  const backup = await createBackup();
  const schemaVersion = await createMigrationRunner({
    database,
    migrations: [
      migration001, migration002, migration003, migration004, migration005,
      migration006, migration007, migration008, migration009, migration010
    ],
    clock
  }).run();
  await checkIntegrity(database);

  const policy = Object.keys(authorizationOptions.capabilities).length
    ? createAuthorizationPolicy(authorizationOptions)
    : null;
  const authorization = Object.freeze({
    authorize(capability, context) {
      if (!policy) throw new Error('This operation is not authorized.');
      return authorize(policy, capability, context);
    }
  });

  const operationalEventRepository = createSqliteOperationalEventRepository(database);
  const operationalEvents = createOperationalEventService({ repository: operationalEventRepository, clock });
  const mapOperationalType = event => {
    if (event.type.startsWith('ticket.') || event.type.startsWith('pin.') || event.type.startsWith('catalog.')) {
      return event.type;
    }
    if (event.type === 'fulfillment.completed') {
      return event.data?.state === 'SUCCEEDED' ? 'fulfillment.succeeded' : 'fulfillment.failed';
    }
    if (event.type === 'fulfillment.uncertain') return 'fulfillment.failed';
    if (event.type === 'fulfillment.canceled') return 'fulfillment.canceled';
    return null;
  };
  const audit = createAuditLogger({
    sink: event => {
      auditSink(event);
      const type = mapOperationalType(event);
      if (type) {
        void operationalEvents.record(type, event.data).catch(() => auditSink(Object.freeze({
          type: 'operational-event.persistence-failed',
          at: new Date(clock()).toISOString(),
          data: Object.freeze({ message: 'Operational event persistence failed.' })
        })));
      }
    },
    clock
  });
  const dashboardsBase = createDashboardService({ events: operationalEvents });
  const dashboards = Object.freeze({
    tickets(input) {
      authorization.authorize('dashboards.view', input.context);
      return dashboardsBase.tickets(input);
    },
    pins(input) {
      authorization.authorize('dashboards.view', input.context);
      return dashboardsBase.pins(input);
    },
    fulfillment(input) {
      authorization.authorize('dashboards.view', input.context);
      return dashboardsBase.fulfillment(input);
    },
    catalog(input) {
      authorization.authorize('dashboards.view', input.context);
      return dashboardsBase.catalog(input);
    },
    all(input) {
      authorization.authorize('dashboards.view', input.context);
      return dashboardsBase.all(input);
    }
  });
  const dashboardPanels = createSqlitePanelRepository(database);
  const interactionGuard = createSessionStore({
    repository: createSqliteSessionRepository(database),
    clock,
    uuid: randomUUID
  });

  const playerRepository = createSqlitePlayerRepository(database);
  const players = createPlayerRegistry(await playerRepository.list());
  const playerNameRepository = createSqlitePlayerNameRepository(database);
  const basePlayerNames = createPlayerNameService({ repository: playerNameRepository, audit, clock });
  const playerNames = Object.freeze({
    submit: basePlayerNames.submit,
    get: basePlayerNames.get,
    async verify(input) {
      authorization.authorize('player-names.verify', input.context);
      return basePlayerNames.verify(input);
    }
  });
  const ticketRepository = createSqliteTicketRepository(database);
  const tickets = createTicketService({
    repository: ticketRepository,
    playerNames,
    authorization,
    audit,
    clock,
    uuid: randomUUID
  });
  const pinRepository = createSqlitePinRepository(database);
  const pins = pinProtector
    ? createPinService({ repository: pinRepository, playerNames, authorization, protector: pinProtector, audit, clock, uuid: randomUUID })
    : null;

  const catalogStore = createSqliteCatalogStore(database, { clock });
  const persistedCatalog = await catalogStore.loadActive();
  const catalogManager = createCatalogManager({ initialCatalog: persistedCatalog || catalog, store: catalogStore, audit });
  const shop = createCatalogSearchService({ catalogManager });
  if (!persistedCatalog) await catalogStore.activate(catalogManager.current());

  const servers = createServerRegistry(config.ark.servers);
  const repository = createSqliteFulfillmentRepository(database);
  const ark = createArkOperationService({ serverRegistry: servers, transport, buildFulfillmentPlan });
  const onlinePlayers = createOnlinePlayerSelectionService({ players, ark, clock, uuid: randomUUID });
  const fulfillment = createFulfillmentService({
    authorization,
    interactionGuard,
    repository,
    catalogManager,
    ark,
    onlinePlayers,
    audit,
    clock,
    uuid: randomUUID
  });

  const retention = createRetentionService({
    repository: createSqliteRetentionRepository(database),
    policy: config.retention,
    audit,
    clock
  });

  return Object.freeze({
    schemaVersion,
    backup,
    retention,
    authorization,
    interactionGuard,
    players,
    onlinePlayers,
    playerRepository,
    playerNames,
    playerNameRepository,
    tickets,
    ticketRepository,
    pins,
    pinRepository,
    shop,
    dashboards,
    dashboardPanels,
    operationalEvents,
    operationalEventRepository,
    catalogManager,
    catalogStore,
    servers,
    get creatures() { return catalogManager.current(); },
    audit,
    repository,
    ark,
    fulfillment
  });
}

module.exports = { buildAuthorizationOptions, composeRuntime };
