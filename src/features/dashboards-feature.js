'use strict';

const { ButtonStyle, ComponentType, PermissionFlagsBits } = require('discord.js');
const { defineFeature } = require('./feature-contract');
const { toInteractionContext } = require('../adapters/discord/interaction-context');
const { isButton } = require('../adapters/discord/interaction-protocol');
const { registerInteractionListener } = require('../adapters/discord/interaction-listener');
const { createPersistentPanel } = require('../adapters/discord/persistent-panel');
const { sanitizeDetails } = require('../domain/dashboards/operational-event-service');

const PANEL_DEFINITIONS = Object.freeze([
  { key:'tickets', title:'Ticket logs', channelKey:'ticketLogs' },
  { key:'pins', title:'PINs dashboard', channelKey:'pinsDashboard' },
  { key:'fulfillment', title:'Dino Fulfillment Logs', channelKey:'fulfillmentLogs' }
]);

function pagePayload(panel, page, result, pinsEnabled = false) {
  const entries = result.results.map(event => {
    const time = Math.floor(Number(event.occurredAt) / 1000);
    return `**${event.type}** · <t:${time}:R>\n${JSON.stringify(sanitizeDetails(event.details)).slice(0, 300)}`;
  });
  const description = entries.length ? entries.join('\n\n').slice(0, 4000) : 'No events recorded yet.';
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  return {
    embeds:[{ title:`${panel.title} · page ${page}`, description, color:0x5865f2 }],
    components:[{
      type:ComponentType.ActionRow,
      components:[
        { type:ComponentType.Button, custom_id:`v2:dashboard:${panel.key}:${Math.max(1,page-1)}`,
          label:'Previous', style:ButtonStyle.Secondary, disabled:page <= 1 },
        { type:ComponentType.Button, custom_id:`v2:dashboard:${panel.key}:${page}`,
          label:panel.key === 'pins' ? 'Refresh' : 'Refresh Logs', style:ButtonStyle.Primary },
        { type:ComponentType.Button, custom_id:`v2:dashboard:${panel.key}:${Math.min(lastPage,page+1)}`,
          label:'Next', style:ButtonStyle.Secondary, disabled:page >= lastPage },
        ...(panel.key === 'pins' && pinsEnabled ? [{
          type:ComponentType.Button, custom_id:'v2:pin:generate-missing',
          label:'Generate Missing PINs', style:ButtonStyle.Success
        }] : [])
      ]
    }],
    allowedMentions:{ parse:[] }
  };
}

function requireStaffChannel(channel, context) {
  const guild = channel.guild;
  if (!guild?.roles?.cache || typeof channel.permissionsFor !== 'function') {
    throw new Error('Dashboard channel permissions could not be verified.');
  }
  for (const role of guild.roles.cache.values()) {
    if (role.id === context.config.discord.roles.staff || role.permissions.has(PermissionFlagsBits.Administrator)) continue;
    if (channel.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel)) {
      throw new Error('Inline dashboards require staff-only channel permissions.');
    }
  }
}

function createDashboardsFeature() {
  let listener;
  const panels = [];
  return defineFeature({
    name:'dashboards',
    dependencies:[],
    async initialize(context) {
      if (!context.services?.dashboards || !context.services?.dashboardPanels) {
        throw new TypeError('dashboards and dashboard panel services are required.');
      }
      for (const definition of PANEL_DEFINITIONS) {
        const channelId = context.config.discord.channels[definition.channelKey];
        if (!channelId) throw new TypeError('All dashboard log channels are required when dashboards are enabled.');
        let page = 1;
        const panel = createPersistentPanel({
          key:definition.key, channelId, validateChannel:requireStaffChannel,
          payload:async () => pagePayload(definition, page,
            await context.services.dashboards.snapshot(definition.key, page), context.config.features.pins)
        });
        panels.push({ ...definition, panel, setPage:value => { page = value; } });
      }
    },
    async register(context) {
      listener = registerInteractionListener(context, 'dashboards', async interaction => {
        if (!isButton(interaction)) return;
        const parts = String(interaction.customId || '').split(':');
        if (parts.length !== 4 || parts[0] !== 'v2' || parts[1] !== 'dashboard') return;
        const page = Number(parts[3]);
        const definition = panels.find(item => item.key === parts[2]);
        if (!definition || !Number.isSafeInteger(page) || page < 1 || page > 1000) return;
        if (!definition.panel.matches(interaction)) throw new Error('This log panel is no longer valid.');
        context.services.authorization.authorize('dashboards.view', toInteractionContext(interaction));
        requireStaffChannel(interaction.channel, context);
        await interaction.deferUpdate();
        const result = await context.services.dashboards[definition.key]({ page, context:toInteractionContext(interaction) });
        definition.setPage(page);
        await interaction.editReply(pagePayload(definition, page, result, context.config.features.pins));
      });
    },
    async start(context) { await Promise.all(panels.map(item => item.panel.start(context))); },
    async stop(context) {
      if (listener) context.client.off('interactionCreate', listener);
      await Promise.all(panels.map(item => item.panel.stop(context)));
      listener = null;
      panels.length = 0;
    }
  });
}

module.exports = { createDashboardsFeature, pagePayload, requireStaffChannel };
