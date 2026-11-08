'use strict';

const crypto = require('node:crypto');
const { safeInteractionMessage } = require('./safe-response');
const { ephemeral, isButton, isChatInput, isStringSelect } = require('./interaction-protocol');

const FLOW_TTL_MS = 120000;
const MAX_FLOWS = 500;

function parseCustomId(value) {
  const parts = String(value || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v2' || parts[1] !== 'fulfillment') return null;
  if (!['confirm', 'cancel', 'select', 'link'].includes(parts[2]) || !parts[3]) return null;
  return Object.freeze({ action: parts[2], token: parts[3] });
}

function createDiscordRouter({ controller, views, logSink, uuid = crypto.randomUUID }) {
  if (!controller || !views || typeof logSink !== 'function') {
    throw new TypeError('controller, views, and logSink are required.');
  }
  const flows = new Map();

  function cleanFlows(now) {
    for (const [id, flow] of flows) {
      if (flow.expiresAt <= now) flows.delete(id);
    }
    while (flows.size >= MAX_FLOWS) flows.delete(flows.keys().next().value);
  }

  function storeFlow(id, flow) {
    cleanFlows(Date.now());
    flows.set(id, flow);
  }

  async function beginFulfillment(interaction) {
    await interaction.deferReply({ flags: 64 });
    const flow = uuid();
    const serverId = interaction.options.getString('server', true);
    const creatureId = interaction.options.getString('creature', true);
    const players = await controller.scan(interaction, { serverId, ttlMs: FLOW_TTL_MS });
    storeFlow(flow, {
      actorId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      serverId,
      creatureId,
      expiresAt: Date.now() + FLOW_TTL_MS
    });
    return interaction.editReply(views.playerSelectionView({
      content: 'Online-player scanning may take a few seconds. Select a verified online player.',
      customId: `v2:fulfillment:select:${flow}`,
      players
    }));
  }

  async function beginPlayerLink(interaction) {
    await interaction.deferReply({ flags: 64 });
    const flow = uuid();
    const serverId = interaction.options.getString('server', true);
    const user = interaction.options.getUser('user', true);
    const players = await controller.scanCandidates(interaction, { serverId, ttlMs: FLOW_TTL_MS });
    storeFlow(flow, {
      actorId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      serverId,
      discordId: user.id,
      expiresAt: Date.now() + FLOW_TTL_MS
    });
    return interaction.editReply(views.playerSelectionView({
      content: `Select the observed online identity for ${user.username}.`,
      customId: `v2:fulfillment:link:${flow}`,
      players
    }));
  }

  async function handleSelection(interaction) {
    const parsed = parseCustomId(interaction.customId);
    if (!parsed || !['select', 'link'].includes(parsed.action)) return false;
    const flow = flows.get(parsed.token);
    if (!flow) throw new Error('This player-selection flow is invalid or expired.');
    if (flow.expiresAt <= Date.now()) {
      flows.delete(parsed.token);
      throw new Error('This player-selection flow is invalid or expired.');
    }
    if (flow.actorId !== interaction.user.id
      || flow.guildId !== interaction.guildId
      || flow.channelId !== interaction.channelId) {
      throw new Error('This player-selection flow is invalid or expired.');
    }
    flows.delete(parsed.token);
    const playerRef = interaction.values?.[0];
    await interaction.deferUpdate();
    if (parsed.action === 'link') {
      const linked = await controller.associate(interaction, {
        playerRef,
        discordId: flow.discordId,
        serverId: flow.serverId
      });
      return interaction.editReply({ content: `Verified trusted identity for ${linked.displayName}.`, components: [] });
    }
    const model = await controller.begin(interaction, {
      serverId: flow.serverId,
      creatureId: flow.creatureId,
      playerRef,
      ttlMs: FLOW_TTL_MS,
      idempotencyKey: uuid()
    });
    return interaction.editReply(views.confirmationView(model));
  }

  async function handleButton(interaction) {
    const parsed = parseCustomId(interaction.customId);
    if (!parsed) return false;
    if (parsed.action === 'cancel') {
      return interaction.update({ components: [], content: 'Fulfillment canceled.' });
    }
    await interaction.deferUpdate();
    const result = await controller.confirm(interaction, parsed);
    await logSink(controller.moderatorLog(result, interaction.logDetails || {}));
    return interaction.editReply(views.resultView(result));
  }

  return Object.freeze({
    async handle(interaction) {
      cleanFlows(Date.now());
      try {
        if (isChatInput(interaction) && interaction.commandName === 'dino-fulfillment') {
          return await beginFulfillment(interaction);
        }
        if (isChatInput(interaction) && interaction.commandName === 'player-link') {
          return await beginPlayerLink(interaction);
        }
        if (isStringSelect(interaction)) return await handleSelection(interaction);
        if (isButton(interaction)) return await handleButton(interaction);
        return false;
      } catch (error) {
        const payload = ephemeral(safeInteractionMessage(error));
        if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
        return interaction.reply(payload);
      }
    }
  });
}

module.exports = { createDiscordRouter, parseCustomId };
