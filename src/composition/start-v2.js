'use strict';

const { createSafeConfigSummary, loadConfig } = require('../config');
const { composeRuntime } = require('./compose-runtime');

async function startV2(options = {}) {
  const load = options.loadConfig || loadConfig;
  const compose = options.composeRuntime || composeRuntime;
  const writeSummary = options.writeSummary || (() => {});
  if (typeof options.openDatabase !== 'function') throw new TypeError('openDatabase must be a function.');
  if (typeof options.createDiscordAdapter !== 'function') throw new TypeError('createDiscordAdapter must be a function.');

  const config = load({
    configPath: options.configPath,
    env: options.env,
    sourceRoot: options.sourceRoot
  });
  writeSummary(createSafeConfigSummary(config, options.env));
  const database = await options.openDatabase({ config });
  let runtime;
  let discord;
  try {
    runtime = await compose({ ...options, config, database });
    await runtime.retention?.recoverInterrupted();
    discord = await options.createDiscordAdapter({
      config,
      env: options.env || process.env,
      services:Object.freeze({
        authorization: runtime.authorization,
        interactionGuard: runtime.interactionGuard,
        players: runtime.players,
        onlinePlayers: runtime.onlinePlayers,
        playerRepository: runtime.playerRepository,
        playerNames: runtime.playerNames,
        tickets: runtime.tickets,
        pins: runtime.pins,
        shop: runtime.shop,
        dashboards: runtime.dashboards,
        dashboardPanels: runtime.dashboardPanels,
        catalogManager: runtime.catalogManager,
        fulfillment: runtime.fulfillment,
        audit: runtime.audit
      })
    });
    if (!discord || typeof discord.start !== 'function') {
      throw new TypeError('Discord adapter must expose start().');
    }
    await discord.start();
    if (runtime.retention) {
      runtime.retention.start();
      void runtime.retention.runOnce().catch(() => {});
    }
  } catch (error) {
    await runtime?.retention?.stop().catch(() => {});
    if (database && typeof database.close === 'function') {
      await database.close().catch(() => {});
    }
    throw error;
  }
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await runtime.retention?.stop();
    if (typeof discord.stop === 'function') await discord.stop();
    if (typeof database.close === 'function') await database.close();
  };
  return Object.freeze({ config, database, runtime, discord, stop });
}

module.exports = { startV2 };
