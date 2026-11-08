'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');
const { backupDatabase } = require('../src/recovery/database-recovery');
const { openSqliteDatabase } = require('../src/adapters/sqlite/open-database');
const { createRconTransport } = require('../src/adapters/rcon/tcp-transport');
const { buildFulfillmentCommands } = require('../services/aat-command-builder');
const { composeRuntime } = require('../src/composition/compose-runtime');
const { startV2 } = require('../src/composition/start-v2');
const { loadInitialCatalog } = require('../src/composition/load-initial-catalog');
const { loadConfig } = require('../src/config');
const { ConfigurationError } = require('../src/config/configuration-error');
const { decodeKey } = require('../src/security/pin-protector');

const SOURCE_ROOT = path.resolve(__dirname, '..');

function createAuditSink(write = console.info) {
  return event => write(JSON.stringify(event));
}

function createDefaultDiscordClient() {
  // Panel self-healing relies on messageDelete, which needs GuildMessages and a partial for uncached messages.
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    partials: [Partials.Message]
  });
}

function createLauncherOptions(options = {}) {
  const env = options.env || process.env;
  const sourceRoot = path.resolve(options.sourceRoot || SOURCE_ROOT);
  const sqlite3 = options.sqlite3;
  const createClient = options.createDiscordClient || createDefaultDiscordClient;
  const write = options.write || (line => console.info(line));

  return {
    env,
    sourceRoot,
    configPath: options.configPath,
    loadConfig: input => {
      const config = (options.loadConfig || loadConfig)(input);
      const issues = [];
      if (Object.values(config.features).some(enabled => enabled === true)
        && !env[config.discord.tokenSecret]) {
        issues.push('configuration.discord.tokenSecret: required secret is not present when Discord features are enabled');
      }
      if (config.features.pins === true) {
        if (!env.PIN_PROTECTION_KEY) {
          issues.push('configuration.features.pins: required PIN_PROTECTION_KEY secret is not present');
        } else {
          try {
            decodeKey(env.PIN_PROTECTION_KEY);
          } catch {
            issues.push('configuration.features.pins: PIN_PROTECTION_KEY must be a non-example base64 value decoding to exactly 32 bytes');
          }
        }
      }
      if (issues.length) throw new ConfigurationError(issues);
      return config;
    },
    writeSummary: summary => write(JSON.stringify(summary.type ? summary : { type: 'runtime.config', ...summary })),
    openDatabase: ({ config }) => openSqliteDatabase(config.storage.databasePath, { basePath: sourceRoot, sqlite3 }),
    composeRuntime: async input => {
      const databasePath = path.resolve(sourceRoot, input.config.storage.databasePath);
      const backupDirectory = path.resolve(sourceRoot, input.config.storage.backupPath);
      const transport = createRconTransport({
        mode: input.config.runtime.mode,
        env,
        timeoutMs: input.config.ark.timeoutMs,
        RconClass: options.RconClass
      });
      const catalog = loadInitialCatalog(options.catalogPath || path.join(sourceRoot, 'data', 'dino-catalog.json'));
      const runtime = await composeRuntime({
        ...input,
        randomUUID: options.randomUUID || crypto.randomUUID,
        catalog,
        transport,
        buildFulfillmentPlan: ({ creature, eosId }) => buildFulfillmentCommands(creature, eosId),
        auditSink: options.auditSink || createAuditSink(write),
        createBackup: async () => {
          fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
          fs.chmodSync(backupDirectory, 0o700);
          const backup = backupDatabase({ databasePath, backupDirectory });
          fs.chmodSync(backup.path, 0o600);
          return backup;
        }
      });
      // The persisted active catalog wins inside composeRuntime, so a newer shipped catalog must be activated explicitly.
      if (runtime.catalogManager.current().version !== catalog.version) {
        await runtime.catalogManager.activate(await runtime.catalogManager.propose(catalog));
      }
      return runtime;
    },
    createDiscordAdapter: async ({ config, services }) => {
      const { createDiscordAdapter } = require('../src/adapters/discord/adapter');
      const client = createClient();
      if (typeof client.once === 'function') {
        client.once(Events.ClientReady, () => write(JSON.stringify({ type: 'runtime.discord.ready' })));
      }
      if (typeof client.on === 'function') {
        client.on('error', () => write(JSON.stringify({ type: 'runtime.discord.error' })));
      }
      return createDiscordAdapter({
        client,
        config,
        services,
        env,
        logSink: options.auditSink || createAuditSink(write)
      });
    }
  };
}

async function startV2Service(options = {}) {
  return startV2(createLauncherOptions(options));
}

async function run(options = {}) {
  const service = await startV2Service(options);
  let stopping = false;
  const shutdown = async signal => {
    if (stopping) return;
    stopping = true;
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    try {
      if (options.write) options.write(`V2 stopping (${signal}).`);
      else console.info(`V2 stopping (${signal}).`);
      await service.stop();
    } catch {
      console.error('V2 shutdown failed.');
      process.exitCode = 1;
    }
  };
  const onSigint = () => { void shutdown('SIGINT'); };
  const onSigterm = () => { void shutdown('SIGTERM'); };
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  return service;
}

if (require.main === module) {
  run().catch(error => {
    if (error?.code === 'CONFIGURATION_INVALID' && Array.isArray(error.issues)) {
      for (const issue of error.issues) console.error(`Configuration: ${issue}`);
    } else {
      console.error(`V2 startup failed${error?.code ? ` (${error.code})` : ''}.`);
    }
    process.exitCode = 1;
  });
}

module.exports = { createAuditSink, createDefaultDiscordClient, createLauncherOptions, run, startV2Service };
