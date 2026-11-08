'use strict';

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { loadConfig } = require('../src/config/load-config');

// Every V2 flow is driven by the persistent server panels, so no slash commands are registered.
const commands = Object.freeze([]);

// Slash commands that earlier V2 releases registered and the panels replaced. They stay managed so a
// deploy removes them from Discord; unrelated commands on the application are always preserved.
const RETIRED_COMMAND_NAMES = Object.freeze([
  'dino-fulfillment',
  'player-link',
  'player-name',
  'player-name-verify',
  'ticket',
  'pin',
  'shop-search'
]);

const managedNames = new Set([...commands.map(command => command.name), ...RETIRED_COMMAND_NAMES]);

function commandsForFeatures(features) {
  void features;
  return commands.filter(command => !RETIRED_COMMAND_NAMES.includes(command.name));
}

function mergeCommands(existing, features) {
  if (!Array.isArray(existing)) throw new TypeError('Existing application commands must be an array.');
  const preserved = existing
    .filter(command => !managedNames.has(command.name))
    .map(({ id, application_id, guild_id, version, ...command }) => command);
  return [...preserved, ...commandsForFeatures(features)];
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function commandShape(command) {
  const { id, application_id, guild_id, version, ...shape } = command;
  return JSON.stringify(canonical(shape));
}

function publicCommand(command) {
  const { id, application_id, guild_id, version, ...shape } = command;
  return canonical(shape);
}

function commandDiff(existing, desired) {
  const current = new Map(existing.filter(command => managedNames.has(command.name)).map(command => [command.name, command]));
  const target = new Map(desired.map(command => [command.name, command]));
  return Object.freeze({
    add: Object.freeze([...target.entries()]
      .filter(([name]) => !current.has(name))
      .map(([, command]) => publicCommand(command))),
    remove: Object.freeze([...current.keys()].filter(name => !target.has(name))),
    update: Object.freeze([...target.entries()]
      .filter(([name, command]) => current.has(name) && commandShape(current.get(name)) !== commandShape(command))
      .map(([name, command]) => Object.freeze({
        name,
        before: publicCommand(current.get(name)),
        after: publicCommand(command)
      }))),
    preserve: existing.filter(command => !managedNames.has(command.name)).length
  });
}

async function deploy({
  env = process.env,
  rest: suppliedRest,
  config = loadConfig({ env }),
  apply = false
} = {}) {
  const token = env.DISCORD_TOKEN;
  const clientId = config.discord?.clientId;
  if (!token || !clientId) throw new Error('DISCORD_TOKEN and config.discord.clientId are required.');
  const rest = suppliedRest || new REST({ version: '10' });
  rest.setToken(token);
  const collectionRoute = Routes.applicationCommands(clientId);
  const existing = await rest.get(collectionRoute);
  const desired = commandsForFeatures(config.features);
  const diff = commandDiff(existing, desired);
  if (!apply) return Object.freeze({ applied: false, clientId, diff });

  const latest = await rest.get(collectionRoute);
  if (JSON.stringify(canonical(latest)) !== JSON.stringify(canonical(existing))) {
    throw new Error('Application commands changed during review; rerun the dry run before applying.');
  }

  const currentManaged = new Map(existing.filter(command => managedNames.has(command.name)).map(command => [command.name, command]));
  const targetManaged = new Map(desired.map(command => [command.name, command]));
  for (const [name, command] of targetManaged) {
    const current = currentManaged.get(name);
    if (!current) {
      await rest.post(collectionRoute, { body: command });
    } else if (commandShape(current) !== commandShape(command)) {
      await rest.patch(Routes.applicationCommand(clientId, current.id), { body: command });
    }
  }
  for (const [name, current] of currentManaged) {
    if (!targetManaged.has(name)) await rest.delete(Routes.applicationCommand(clientId, current.id));
  }
  return Object.freeze({ applied: true, clientId, diff });
}

if (require.main === module) {
  deploy({ apply: process.argv.includes('--apply') }).then(result => {
    console.log(JSON.stringify({ mode: result.applied ? 'applied' : 'dry-run', ...result }, null, 2));
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { RETIRED_COMMAND_NAMES, commandDiff, commands, commandsForFeatures, deploy, mergeCommands };
