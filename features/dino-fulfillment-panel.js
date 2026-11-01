const crypto = require('crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { getEnabledArkServers } = require('../config/ark-servers');
const {
  getCatalogPage,
  getCreatureById,
  searchCreatures,
  validateCatalog
} = require('../services/creature-catalog');
const { buildFulfillmentSummary } = require('../services/aat-command-builder');
const { fulfillCreatureRequest } = require('../services/fulfillment-coordinator');
const { isMockMode, listPlayersAcrossServers } = require('../services/rcon');

const PANEL_NAME = 'dino_fulfillment';
const LOG_PANEL_NAME = 'dino_fulfillment_logs';
const LOGS_PER_PAGE = 5;
const SESSION_TTL_MS = 15 * 60 * 1000;
const sessions = new Map();

function createSession(userId) {
  const session = { userId, creatureId: null, player: null, catalogPage: 0, createdAt: Date.now() };
  sessions.set(userId, session);
  return session;
}

function getSession(userId) {
  const session = sessions.get(userId);
  if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(userId);
    return null;
  }
  return session;
}

function isAuthorized(interaction) {
  return Boolean(
    interaction.member?.roles?.cache?.has(process.env.DINO_FULFILLMENT_ROLE_ID)
  );
}

function panelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('Dino Fulfillment')
    .setDescription(
      'Search the approved tameable-creature catalog, select an online player, ' +
      'review the fixed level-450 delivery, and confirm the spawn.'
    )
    .addFields(
      { name: 'Delivery rules', value: 'Gendered creatures: male + female cryos\nGenderless creatures: one cryo' },
      { name: 'Saddles', value: 'Ascendant quality 10.0 when applicable' },
      { name: 'Access', value: 'Moderator role only' }
    )
    .setColor(0x2b8a3e);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dino_browse')
      .setLabel('Browse Dino Catalog')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('dino_search')
      .setLabel('Search Dino')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

function catalogPagePayload(page = 0) {
  const catalogPage = getCatalogPage(page, 25);
  const select = new StringSelectMenuBuilder()
    .setCustomId('dino_creature_select')
    .setPlaceholder('Choose a creature to fulfill')
    .addOptions(catalogPage.creatures.map(creature => ({
      label: creature.name.slice(0, 100),
      value: creature.id,
      description: [
        creature.requiresDlc ? 'DLC' : 'Base/Map content',
        creature.supportsGender ? 'Male + female' : 'Genderless',
        creature.saddleApplicable ? 'Saddle' : 'No saddle'
      ].join(' | ').slice(0, 100)
    })));
  const navigation = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dino_catalog_previous')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(catalogPage.page === 0),
    new ButtonBuilder()
      .setCustomId('dino_catalog_next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(catalogPage.page >= catalogPage.pageCount - 1),
    new ButtonBuilder()
      .setCustomId('dino_search')
      .setLabel('Search Dino')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('dino_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger)
  );
  return {
    content: `**Dino Catalog** | Page ${catalogPage.page + 1} of ${catalogPage.pageCount} (${catalogPage.total} creatures)\nSelect a creature below or use **Search Dino**. DLC creatures are marked in the list.`,
    embeds: [],
    components: [new ActionRowBuilder().addComponents(select), navigation]
  };
}

function searchModal() {
  const modal = new ModalBuilder()
    .setCustomId('dino_search_modal')
    .setTitle('Search Tameable Creatures');
  const input = new TextInputBuilder()
    .setCustomId('dino_query')
    .setLabel('Creature name or alias')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(100)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function creatureResultsPayload(results) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('dino_creature_select')
    .setPlaceholder('Select a creature')
    .addOptions(results.slice(0, 25).map(creature => ({
      label: creature.name.slice(0, 100),
      value: creature.id,
      description: `${creature.supportsGender ? 'Male + female' : 'Genderless'} | ${creature.saddleApplicable ? 'Saddle' : 'No saddle'}`.slice(0, 100)
    })));
  return {
    content: 'Select an approved tameable creature:',
    components: [new ActionRowBuilder().addComponents(select)]
  };
}

function creatureSelectedPayload(creature) {
  const summary = buildFulfillmentSummary(creature);
  const embed = new EmbedBuilder()
    .setTitle('Creature selected')
    .setDescription(`**${creature.name}**`)
    .addFields(
      { name: 'Level', value: String(summary.level), inline: true },
      { name: 'Quantity', value: String(summary.quantity), inline: true },
      { name: 'Gender', value: summary.genders.join(' + '), inline: true },
      { name: 'Saddle', value: summary.saddle ? 'Yes, quality 10.0' : 'Not applicable', inline: true },
      { name: 'Content', value: creature.requiresDlc ? `DLC: ${creature.dlcName}` : creature.sourceMod, inline: false },
      ...(creature.requiresDlc ? [{
        name: 'DLC ownership warning',
        value: 'The recipient may be unable to use this creature or some of its abilities without the required DLC.',
        inline: false
      }] : [])
    )
    .setColor(0x1971c2);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('dino_players').setLabel('Select Online Player').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dino_catalog_back').setLabel('Back to Catalog').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('dino_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

function playerResultsPayload(players, unavailableServers) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('dino_player_select')
    .setPlaceholder('Select online player and map')
    .addOptions(players.slice(0, 25).map(player => ({
      label: player.characterName.slice(0, 100),
      value: `${player.serverId}|${player.eosId}`,
      description: player.serverName.slice(0, 100)
    })));
  const note = unavailableServers.length
    ? `\n${unavailableServers.length} server(s) could not be queried.`
    : '';
  return {
    content: `Select the recipient. The selected map will receive the command.${note}`,
    embeds: [],
    components: [new ActionRowBuilder().addComponents(select)]
  };
}

function reviewPayload(creature, player) {
  const summary = buildFulfillmentSummary(creature);
  const embed = new EmbedBuilder()
    .setTitle('Review Dino Fulfillment')
    .addFields(
      { name: 'Creature', value: creature.name, inline: true },
      { name: 'Level', value: String(summary.level), inline: true },
      { name: 'Delivery', value: `${summary.quantity} cryo${summary.quantity === 1 ? '' : 's'}`, inline: true },
      { name: 'Gender', value: summary.genders.join(' + '), inline: true },
      { name: 'Saddle', value: summary.saddle ? 'Ascendant, quality 10.0' : 'Not applicable', inline: true },
      { name: 'Player', value: player.characterName, inline: true },
      { name: 'Map', value: player.serverName, inline: true },
      { name: 'Mode', value: isMockMode() ? 'MOCK' : 'LIVE', inline: true },
      { name: 'Content', value: creature.requiresDlc ? `DLC: ${creature.dlcName}` : creature.sourceMod, inline: false },
      ...(creature.requiresDlc ? [{
        name: 'DLC ownership warning',
        value: 'The recipient may be unable to use this creature or some of its abilities without the required DLC.',
        inline: false
      }] : [])
    )
    .setFooter({ text: 'The player must still be online when Confirm Spawn is selected.' })
    .setColor(isMockMode() ? 0xf08c00 : 0xc92a2a);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('dino_confirm').setLabel('Confirm Spawn').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('dino_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

function resultPayload(result) {
  const lines = result.results.map(item =>
    `${item.success ? 'SUCCESS' : 'FAILED'}: ${item.label}${item.error ? ` (${item.error})` : ''}`
  );
  return {
    content:
      `Fulfillment ${result.requestId}: **${result.status}**\n` +
      `Player: ${result.player.characterName}\n` +
      `Map: ${result.server.name}\n` +
      `Creature: ${result.summary.creatureName}\n\n${lines.join('\n')}`,
    embeds: [],
    components: []
  };
}

function maskEosId(eosId) {
  if (!eosId || eosId.length < 12) return 'Unavailable';
  return `${eosId.slice(0, 6)}...${eosId.slice(-6)}`;
}

function logPanelPayload(entries, total, page = 0) {
  const pageCount = Math.max(1, Math.ceil(total / LOGS_PER_PAGE));
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dino_logs_previous')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(total === 0 || page <= 0),
    new ButtonBuilder()
      .setCustomId('dino_logs_refresh')
      .setLabel('Refresh Logs')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('dino_logs_next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(total === 0 || page >= pageCount - 1)
  );

  if (!entries.length) {
    const embed = new EmbedBuilder()
      .setTitle('Dino Fulfillment Logs')
      .setDescription(
        `Page 1 of 1 (0 entries)\n\nNo dino fulfillments have been recorded yet.`
      )
      .setColor(0x495057);
    return { embeds: [embed], components: [controls] };
  }

  const lines = entries.map(entry => {
    const stamp = Math.floor(new Date(entry.created_at).getTime() / 1000);
    const status = entry.status || 'FAILED';
    return (
      `#${entry.id} | ${status} | ${entry.moderator_username} | ` +
      `${entry.creature_name} | ${entry.character_name} | ` +
      `${entry.server_name || 'Unknown'} | <t:${stamp}:F>`
    );
  });
  const color = entries.some(entry => entry.status === 'FAILED')
    ? 0xc92a2a
    : entries.some(entry => entry.status === 'PARTIAL')
      ? 0xf08c00
      : 0x2b8a3e;
  const embed = new EmbedBuilder()
    .setTitle('Dino Fulfillment Logs')
    .setDescription(
      `Page ${page + 1} of ${pageCount} | ${total} logs\n\n${lines.join('\n')}`
    )
    .setColor(color);

  return { embeds: [embed], components: [controls], allowedMentions: { parse: [] } };
}

function createDinoFulfillmentFeature({ client, run, get, all }) {
  let logPage = 0;

  async function getLogPanelData() {
    const countRow = await get('SELECT COUNT(*) AS total FROM dino_fulfillment_logs');
    const total = countRow?.total || 0;
    const pageCount = Math.max(1, Math.ceil(total / LOGS_PER_PAGE));
    logPage = Math.min(Math.max(logPage, 0), pageCount - 1);
    const entries = total
      ? await all(
        'SELECT * FROM dino_fulfillment_logs ORDER BY id DESC LIMIT ? OFFSET ?',
        [LOGS_PER_PAGE, logPage * LOGS_PER_PAGE]
      )
      : [];
    return { entries, total, page: logPage };
  }

  async function initializeDatabase() {
    validateCatalog();
    await run(`
      CREATE TABLE IF NOT EXISTS dino_fulfillment_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        moderator_id TEXT NOT NULL,
        moderator_username TEXT NOT NULL,
        creature_id TEXT NOT NULL,
        creature_name TEXT NOT NULL,
        server_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        character_name TEXT NOT NULL,
        eos_id TEXT NOT NULL,
        status TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  }

  async function refreshLogPanel(options = {}) {
    const channelId = process.env.DINO_FULFILLMENT_LOG_CHANNEL_ID;
    if (!channelId) return null;
    if (options.latest) logPage = 0;
    const channel = await client.channels.fetch(channelId);
    const saved = await get('SELECT message_id FROM panels WHERE panel_name = ?', [LOG_PANEL_NAME]);
    const data = await getLogPanelData();
    const payload = logPanelPayload(data.entries, data.total, data.page);
    let message = null;
    if (saved) {
      try { message = await channel.messages.fetch(saved.message_id); } catch {}
    }
    if (message) {
      await message.edit(payload);
    } else {
      message = await channel.send(payload);
      await run(
        'INSERT OR REPLACE INTO panels (panel_name, message_id) VALUES (?, ?)',
        [LOG_PANEL_NAME, message.id]
      );
    }
    return message;
  }

  async function refreshPanel() {
    const channelId = process.env.DINO_FULFILLMENT_CHANNEL_ID;
    if (!channelId) return null;
    const channel = await client.channels.fetch(channelId);
    const saved = await get('SELECT message_id FROM panels WHERE panel_name = ?', [PANEL_NAME]);
    let message = null;
    if (saved) {
      try { message = await channel.messages.fetch(saved.message_id); } catch {}
    }
    if (message) {
      await message.edit(panelPayload());
    } else {
      message = await channel.send(panelPayload());
      await run(
        'INSERT OR REPLACE INTO panels (panel_name, message_id) VALUES (?, ?)',
        [PANEL_NAME, message.id]
      );
    }
    await refreshLogPanel();
    return message;
  }

  async function rejectUnauthorized(interaction) {
    if (isAuthorized(interaction)) return false;
    const payload = { content: 'This feature is restricted to the configured moderator role.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
    return true;
  }

  async function handleInteraction(interaction) {
    const id = interaction.customId || '';
    if (!id.startsWith('dino_')) return false;
    if (await rejectUnauthorized(interaction)) return true;

    if (interaction.isButton() && [
      'dino_logs_previous',
      'dino_logs_refresh',
      'dino_logs_next'
    ].includes(id)) {
      await interaction.deferUpdate();
      if (id === 'dino_logs_previous') logPage = Math.max(0, logPage - 1);
      if (id === 'dino_logs_next') logPage++;
      await refreshLogPanel();
      return true;
    }

    if (interaction.isButton() && id === 'dino_browse') {
      const session = createSession(interaction.user.id);
      await interaction.reply({ ...catalogPagePayload(session.catalogPage), flags: MessageFlags.Ephemeral });
      return true;
    }

    if (interaction.isButton() && id === 'dino_search') {
      if (!getSession(interaction.user.id)) createSession(interaction.user.id);
      await interaction.showModal(searchModal());
      return true;
    }

    if (interaction.isButton() && ['dino_catalog_previous', 'dino_catalog_next', 'dino_catalog_back'].includes(id)) {
      const session = getSession(interaction.user.id) || createSession(interaction.user.id);
      if (id === 'dino_catalog_previous') session.catalogPage--;
      if (id === 'dino_catalog_next') session.catalogPage++;
      session.creatureId = null;
      session.player = null;
      await interaction.update(catalogPagePayload(session.catalogPage));
      return true;
    }

    if (interaction.isModalSubmit() && id === 'dino_search_modal') {
      const query = interaction.fields.getTextInputValue('dino_query').trim();
      const results = searchCreatures(query, 25);
      if (!results.length) {
        await interaction.reply({ content: `No approved tameable creature matched **${query}**.`, flags: MessageFlags.Ephemeral });
        return true;
      }
      createSession(interaction.user.id);
      await interaction.reply({ ...creatureResultsPayload(results), flags: MessageFlags.Ephemeral });
      return true;
    }

    if (interaction.isStringSelectMenu() && id === 'dino_creature_select') {
      const session = getSession(interaction.user.id) || createSession(interaction.user.id);
      const creature = getCreatureById(interaction.values[0]);
      if (!creature) {
        await interaction.update({ content: 'That creature is no longer available.', embeds: [], components: [] });
        return true;
      }
      session.creatureId = creature.id;
      session.player = null;
      await interaction.update(creatureSelectedPayload(creature));
      return true;
    }

    if (interaction.isButton() && id === 'dino_players') {
      const session = getSession(interaction.user.id);
      if (!session?.creatureId) {
        await interaction.reply({ content: 'This selection expired. Start again from the panel.', flags: MessageFlags.Ephemeral });
        return true;
      }
      await interaction.deferUpdate();
      await interaction.editReply({
        content: 'Scanning all configured maps for online players. This may take a few seconds...',
        embeds: [],
        components: []
      });
      const result = await listPlayersAcrossServers(getEnabledArkServers());
      if (!result.players.length) {
        await interaction.editReply({ content: 'No online players were found.', embeds: [], components: [] });
        return true;
      }
      session.players = result.players;
      await interaction.editReply(playerResultsPayload(result.players, result.unavailableServers));
      return true;
    }

    if (interaction.isStringSelectMenu() && id === 'dino_player_select') {
      const session = getSession(interaction.user.id);
      if (!session?.creatureId || !session.players) {
        await interaction.update({ content: 'This selection expired. Start again from the panel.', embeds: [], components: [] });
        return true;
      }
      const [serverId, eosId] = interaction.values[0].split('|');
      const player = session.players.find(item => item.serverId === serverId && item.eosId === eosId);
      const creature = getCreatureById(session.creatureId);
      if (!player || !creature) {
        await interaction.update({ content: 'The selected player or creature is no longer available.', embeds: [], components: [] });
        return true;
      }
      session.player = player;
      await interaction.update(reviewPayload(creature, player));
      return true;
    }

    if (interaction.isButton() && id === 'dino_cancel') {
      sessions.delete(interaction.user.id);
      await interaction.update({ content: 'Dino fulfillment canceled.', embeds: [], components: [] });
      return true;
    }

    if (interaction.isButton() && id === 'dino_confirm') {
      const session = getSession(interaction.user.id);
      if (!session?.creatureId || !session.player) {
        await interaction.reply({ content: 'This selection expired. Start again from the panel.', flags: MessageFlags.Ephemeral });
        return true;
      }
      const creature = getCreatureById(session.creatureId);
      if (!creature) {
        await interaction.update({ content: 'That creature is no longer available.', embeds: [], components: [] });
        return true;
      }
      await interaction.deferUpdate();
      const requestId = `DINO-${crypto.randomUUID()}`;
      try {
        const result = await fulfillCreatureRequest({
          requestId,
          creatureId: creature.id,
          serverId: session.player.serverId,
          eosId: session.player.eosId
        });
        await run(
          `INSERT INTO dino_fulfillment_logs
           (request_id, moderator_id, moderator_username, creature_id, creature_name,
            server_id, server_name, character_name, eos_id, status, result_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            requestId, interaction.user.id, interaction.user.username,
            creature.id, creature.name, result.server.id, result.server.name,
            result.player.characterName, result.player.eosId, result.status,
            JSON.stringify(result), new Date().toISOString()
          ]
        );
        await refreshLogPanel({ latest: true }).catch(error =>
          console.error('Dino fulfillment dashboard refresh failed:', error)
        );
        sessions.delete(interaction.user.id);
        await interaction.editReply(resultPayload(result));
      } catch (error) {
        const failedResult = {
          requestId,
          status: 'FAILED',
          summary: buildFulfillmentSummary(creature),
          player: session.player,
          server: {
            id: session.player.serverId,
            name: session.player.serverName
          },
          results: [{
            label: 'Pre-delivery validation',
            success: false,
            error: error.message
          }]
        };
        await run(
          `INSERT OR IGNORE INTO dino_fulfillment_logs
           (request_id, moderator_id, moderator_username, creature_id, creature_name,
            server_id, server_name, character_name, eos_id, status, result_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            requestId, interaction.user.id, interaction.user.username,
            creature.id, creature.name, session.player.serverId,
            session.player.serverName, session.player.characterName,
            session.player.eosId, 'FAILED', JSON.stringify(failedResult),
            new Date().toISOString()
          ]
        ).catch(dbError => console.error('Dino failure database log failed:', dbError));
        await refreshLogPanel({ latest: true }).catch(logError =>
          console.error('Dino failure dashboard refresh failed:', logError)
        );
        sessions.delete(interaction.user.id);
        await interaction.editReply({
          content: `Fulfillment failed before delivery: ${error.message}`,
          embeds: [],
          components: []
        });
      }
      return true;
    }

    return false;
  }

  return { handleInteraction, initializeDatabase, refreshLogPanel, refreshPanel };
}

module.exports = {
  catalogPagePayload,
  createDinoFulfillmentFeature,
  logPanelPayload,
  maskEosId,
  panelPayload,
  reviewPayload,
  resultPayload
};
