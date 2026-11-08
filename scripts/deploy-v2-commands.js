'use strict';

require('dotenv').config();
const { SlashCommandBuilder, REST, Routes } = require('discord.js');
const { loadConfig } = require('../src/config/load-config');

const commands = [
  new SlashCommandBuilder()
    .setName('dino-fulfillment')
    .setDescription('Fulfill a creature to a verified online player')
    .addStringOption(option => option.setName('server').setDescription('Configured ARK server ID').setRequired(true))
    .addStringOption(option => option.setName('creature').setDescription('Approved creature ID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('player-link')
    .setDescription('Verify an observed online ARK identity for a Discord user')
    .addStringOption(option => option.setName('server').setDescription('Configured ARK server ID').setRequired(true))
    .addUserOption(option => option.setName('user').setDescription('Discord user to link').setRequired(true)),
  new SlashCommandBuilder()
    .setName('player-name')
    .setDescription('Submit your in-game player name')
    .addSubcommand(subcommand => subcommand.setName('submit').setDescription('Submit a player name for verification')),
  new SlashCommandBuilder()
    .setName('player-name-verify')
    .setDescription('Verify a pending player-name submission')
    .addStringOption(option => option.setName('discord-id').setDescription('Discord user ID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Create or manage a support ticket')
    .addSubcommand(subcommand => subcommand.setName('create').setDescription('Create a support ticket')
      .addStringOption(option => option.setName('type').setDescription('Ticket category').setRequired(true)
        .addChoices(
          { name: 'Support', value: 'SUPPORT' },
          { name: 'PIN', value: 'PIN' },
          { name: 'Player name', value: 'PLAYER_NAME' },
          { name: 'Shop', value: 'SHOP' },
          { name: 'Fulfillment', value: 'FULFILLMENT' }
        ))
      .addStringOption(option => option.setName('description').setDescription('Describe your request').setRequired(true)))
    .addSubcommand(subcommand => subcommand.setName('claim').setDescription('Claim an open ticket')
      .addStringOption(option => option.setName('ticket-id').setDescription('Ticket reference').setRequired(true)))
    .addSubcommand(subcommand => subcommand.setName('close').setDescription('Close a ticket')
      .addStringOption(option => option.setName('ticket-id').setDescription('Ticket reference').setRequired(true)))
    .addSubcommand(subcommand => subcommand.setName('reopen').setDescription('Reopen a closed ticket')
      .addStringOption(option => option.setName('ticket-id').setDescription('Ticket reference').setRequired(true))),
  new SlashCommandBuilder()
    .setName('pin')
    .setDescription('Submit or manage a PIN request')
    .addSubcommand(subcommand => subcommand.setName('request').setDescription('Submit a PIN privately'))
    .addSubcommand(subcommand => subcommand.setName('approve').setDescription('Approve a pending PIN request')
      .addStringOption(option => option.setName('request-id').setDescription('PIN request reference').setRequired(true)))
    .addSubcommand(subcommand => subcommand.setName('deliver').setDescription('Privately deliver an approved PIN request')
      .addStringOption(option => option.setName('request-id').setDescription('PIN request reference').setRequired(true)))
    .addSubcommand(subcommand => subcommand.setName('cancel').setDescription('Cancel a PIN request')
      .addStringOption(option => option.setName('request-id').setDescription('PIN request reference').setRequired(true))),
  new SlashCommandBuilder()
    .setName('shop-search')
    .setDescription('Search the creature catalog')
    .addStringOption(option => option.setName('query').setDescription('Creature name or keyword').setRequired(true))
    .addIntegerOption(option => option.setName('page').setDescription('Result page').setMinValue(1))
].map(command => command.toJSON());

const managedNames = new Set(commands.map(command => command.name));

function commandsForFeatures(features) {
  const enabled = {
    'dino-fulfillment': features?.fulfillment === true,
    'player-link': features?.fulfillment === true && features?.playerNames === true,
    'player-name': features?.playerNames === true,
    'player-name-verify': features?.playerNames === true,
    ticket: features?.tickets === true,
    pin: features?.pins === true,
    'shop-search': features?.shop === true
  };
  return commands.filter(command => enabled[command.name] === true);
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

module.exports = { commandDiff, commands, commandsForFeatures, deploy, mergeCommands };
