'use strict';

const { createSafeConfigSummary, loadConfig } = require('../config');

async function startApplication(options = {}) {
  const load = options.loadConfig || loadConfig;
  const writeSummary = options.writeSummary || (() => {});
  const createDiscordAdapter = options.createDiscordAdapter;
  const createRconAdapter = options.createRconAdapter;

  if (typeof createDiscordAdapter !== 'function') {
    throw new TypeError('createDiscordAdapter must be a function.');
  }

  const config = load({
    configPath: options.configPath,
    env: options.env,
    sourceRoot: options.sourceRoot
  });

  writeSummary(createSafeConfigSummary(config, options.env));

  let rcon = null;
  if (config.runtime.mode !== 'mock') {
    if (typeof createRconAdapter !== 'function') {
      throw new TypeError('createRconAdapter must be a function outside mock mode.');
    }
    rcon = await createRconAdapter({ config });
  }

  const discord = await createDiscordAdapter({ config, rcon });

  if (!discord || typeof discord.start !== 'function') {
    throw new TypeError('Discord adapter must expose start().');
  }

  await discord.start();

  return Object.freeze({ config, discord, rcon });
}

module.exports = { startApplication };
