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

async function deploy({ env = process.env, rest: suppliedRest, config = loadConfig({ env }) } = {}) {
  const token = env.DISCORD_TOKEN;
  const clientId = env.CLIENT_ID;
  if (!token || !clientId) throw new Error('DISCORD_TOKEN and CLIENT_ID are required.');
  const rest = suppliedRest || new REST({ version: '10' });
  rest.setToken(token);
  const route = Routes.applicationCommands(clientId);
  const existing = await rest.get(route);
  await rest.put(route, { body: mergeCommands(existing, config.features) });
}

if (require.main === module) {
  deploy().then(() => console.log('V2 commands deployed.')).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { commands, commandsForFeatures, deploy, mergeCommands };
