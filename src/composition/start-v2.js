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
        vaultPins:runtime.vaultPins,
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
      void runtime.retention.runOnce().catch(() => writeSummary({
        type: 'runtime.retention.initial_run_failed',
        at: new Date().toISOString()
      }));
    }
  } catch (error) {
    const cleanup = [];
    if (runtime?.retention) cleanup.push(() => runtime.retention.stop());
    if (discord && typeof discord.stop === 'function') cleanup.push(() => discord.stop());
    if (database && typeof database.close === 'function') cleanup.push(() => database.close());
    for (const close of cleanup) {
      try {
        await close();
      } catch {
        // Preserve the startup failure while still attempting remaining cleanup.
      }
    }
    throw error;
  }
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    const failures = [];
    for (const close of [
      () => runtime.retention?.stop(),
      () => typeof discord.stop === 'function' ? discord.stop() : undefined,
      () => typeof database.close === 'function' ? database.close() : undefined
    ]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'V2 shutdown was incomplete.');
  };
  return Object.freeze({ config, database, runtime, discord, stop });
}

module.exports = { startV2 };
