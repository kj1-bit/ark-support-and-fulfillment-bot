'use strict';

const crypto = require('node:crypto');
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { defineFeature } = require('./feature-contract');
const { isButton, isModal } = require('../adapters/discord/interaction-protocol');
const { registerInteractionListener } = require('../adapters/discord/interaction-listener');
const { createPersistentPanel } = require('../adapters/discord/persistent-panel');

function shopSearchModal(customId) {
  return new ModalBuilder().setCustomId(customId).setTitle('Search In-Game Shop').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('query')
      .setLabel('Tame or package name').setStyle(TextInputStyle.Short).setMaxLength(64).setRequired(true))
  );
}

function createShopFeature() {
  let listener;
  let panel;
  const flows = new Map();
  function store(interaction, values) {
    for (const [id, flow] of flows) if (flow.expiresAt <= Date.now()) flows.delete(id);
    while (flows.size >= 500) flows.delete(flows.keys().next().value);
    const id = crypto.randomUUID();
    flows.set(id, { actorId: interaction.user.id, guildId: interaction.guildId,
      channelId: interaction.channelId, expiresAt: Date.now() + 120000, ...values });
    return id;
  }
  function resolve(interaction, id, requireMessage = true) {
    const flow = flows.get(id);
    if (!flow || flow.expiresAt <= Date.now() || flow.actorId !== interaction.user.id
      || flow.guildId !== interaction.guildId || flow.channelId !== interaction.channelId
      || (requireMessage && flow.messageId !== interaction.message?.id)) {
      throw new Error('This shop search has expired. Start a new search.');
    }
    return flow;
  }
  async function search(context, interaction, query, page) {
    const result = await context.services.shop.search({ query, page });
    const items = Array.isArray(result?.results) ? result.results : Array.isArray(result) ? result : [];
    const content = items.length ? items.slice(0, 10).map(item =>
      `${item.name}${item.dlc?.warning ? ` - ${item.dlc.warning}` : ''}`).join('\n') : 'No matching creatures found.';
    const id = store(interaction, { query, page: result.page || page, kind: 'results' });
    const flow = flows.get(id);
    const button = (action, label, disabled = false) => ({ type: 2, custom_id: `v2:shop:${action}:${id}`, label, style: 2, disabled });
    const message = await interaction.editReply({ content,
      components: [{ type: 1, components: [
        button('previous', 'Previous', flow.page <= 1),
        button('next', 'Next', flow.page * (result.pageSize || 10) >= (result.total ?? items.length)),
        button('again', 'Search'), button('cancel', 'Cancel')
      ] }] });
    flow.messageId = message?.id || (await interaction.fetchReply()).id;
    return message;
  }
  return defineFeature({
    name: 'shop', dependencies: [],
    async initialize(context) {
      if (!context.services?.shop) throw new TypeError('shop service is required.');
      if (context.config.features?.tickets !== true) {
        const channelId = context.config.discord.channels?.requests;
        if (!channelId || !context.services.dashboardPanels) {
          throw new TypeError('Shop-only requests panel channel and persistence are required.');
        }
        panel = createPersistentPanel({ key: 'requests', channelId, payload: {
          content: 'Search the in-game shop catalog.',
          components: [{ type: 1, components: [{
            type: 2, custom_id: 'v2:shop:search', label: 'Search In-Game Shop', style: 1
          }] }], allowedMentions: { parse: [] }
        } });
      }
    },
    async register(context) {
      listener = registerInteractionListener(context, 'shop', async interaction => {
        if (isButton(interaction) && interaction.customId === 'v2:shop:search') {
          if (panel && !panel.matches(interaction)) return false;
          const saved = await context.services.dashboardPanels?.get('requests');
          if (!saved || saved.messageId !== interaction.message?.id
            || saved.channelId !== interaction.channelId
            || interaction.channelId !== context.config.discord.channels?.requests
            || interaction.guildId !== context.config.discord.guildId) return false;
          const id = store(interaction, { kind: 'modal' });
          return interaction.showModal(shopSearchModal(`v2:shop:query:${id}`));
        }
        const match = String(interaction.customId || '').match(/^v2:shop:(query|previous|next|again|cancel):([^:]+)$/);
        if (!match) return false;
        const [, action, id] = match;
        if (isModal(interaction) && action === 'query') {
          const flow = resolve(interaction, id, false);
          if (flow.kind !== 'modal') return false;
          flows.delete(id);
          await interaction.deferReply({ flags: 64 });
          return search(context, interaction, interaction.fields.getTextInputValue('query'), 1);
        }
        if (!isButton(interaction) || action === 'query') return false;
        const flow = resolve(interaction, id);
        if (flow.kind !== 'results') return false;
        flows.delete(id);
        if (action === 'again') {
          const modalId = store(interaction, { kind: 'modal' });
          return interaction.showModal(shopSearchModal(`v2:shop:query:${modalId}`));
        }
        await interaction.deferUpdate();
        if (action === 'cancel') return interaction.editReply({ content: 'Shop search canceled.', components: [] });
        return search(context, interaction, flow.query,
          action === 'next' ? flow.page + 1 : Math.max(1, flow.page - 1));
      });
    },
    async start(context) { if (panel) await panel.start(context); },
    async stop(context) {
      if (panel) await panel.stop(context);
      if (listener && typeof context.client.off === 'function') context.client.off('interactionCreate', listener);
      listener = null;
      panel = null;
      flows.clear();
    }
  });
}
module.exports = { createShopFeature, shopSearchModal };
