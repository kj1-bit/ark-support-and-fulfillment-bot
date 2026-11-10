'use strict';

const { ButtonStyle, ComponentType, PermissionFlagsBits, escapeMarkdown } = require('discord.js');
const { defineFeature } = require('./feature-contract');
const { toInteractionContext } = require('../adapters/discord/interaction-context');
const { isButton } = require('../adapters/discord/interaction-protocol');
const { registerInteractionListener, reportInteractionError } = require('../adapters/discord/interaction-listener');
const { createPersistentPanel } = require('../adapters/discord/persistent-panel');
const { sanitizeDetails } = require('../domain/dashboards/operational-event-service');
const { requirePrivatePinChannel, fetchPrivatePinChannel } = require('../adapters/discord/staff-pin-channel');
const { ticketPlayerName } = require('../adapters/discord/ticket-view');

const PANEL_DEFINITIONS = Object.freeze([
  { key:'tickets', title:'Ticket logs', channelKey:'ticketLogs' },
  { key:'pins', title:'PINs dashboard', channelKey:'pinsDashboard' },
  { key:'fulfillment', title:'Dino Fulfillment Logs', channelKey:'fulfillmentLogs' }
]);

function pagePayload(panel, page, result, pinsEnabled = false) {
  const entries = result.results.filter(event => panel.key !== 'tickets'
    || ['ticket.created','ticket.claimed','ticket.unclaimed','ticket.closed'].includes(event.type)).map(event => {
    const time = Math.floor(Number(event.occurredAt) / 1000);
    if (panel.key === 'tickets') {
      const details = event.details;
      const mention = id => /^[1-9][0-9]{16,19}$/.test(String(id || '')) ? `<@${id}>` : 'Unknown';
      const player = ticketPlayerName(details.playerName || details.player_name);
      const requester = mention(details.actorId || details.actor_id);
      if (event.type === 'ticket.created') return `${requester} (${player}) opened a ticket.`;
      const moderator = mention(details.actionActorId || details.moderatorId || details.moderator_id);
      const action = { 'ticket.claimed':'claimed','ticket.unclaimed':'unclaimed','ticket.closed':'closed' }[event.type];
      return `${moderator} ${action} ${requester}'s (${player}) ticket.`;
    }
    return `**${event.type}** · <t:${time}:R>\n${JSON.stringify(sanitizeDetails(event.details)).slice(0, 300)}`;
  });
  const description = entries.length ? entries.join('\n\n').slice(0, 4000) : 'No events recorded yet.';
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  return {
    embeds:[{ title:`${panel.title} · page ${page}`, description, color:0x5865f2 }],
    components:[{
      type:ComponentType.ActionRow,
      components:[
        { type:ComponentType.Button, custom_id:`v2:dashboard:${panel.key}:prev:${Math.max(1,page-1)}`,
          label:'Previous', style:ButtonStyle.Secondary, disabled:page <= 1 },
        { type:ComponentType.Button, custom_id:`v2:dashboard:${panel.key}:refresh:${page}`,
          label:panel.key === 'pins' ? 'Refresh' : 'Refresh Logs', style:ButtonStyle.Primary },
        { type:ComponentType.Button, custom_id:`v2:dashboard:${panel.key}:next:${Math.min(lastPage,page+1)}`,
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
    // Bot integration roles (this bot or others) are not human audiences; booster and other managed roles still count.
    if (role.managed && role.tags?.botId) continue;
    if (channel.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel)) {
      throw new Error('Inline dashboards require staff-only channel permissions.');
    }
  }
}

function pinPagePayload(panel, result) {
  const page = result.page;
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  const body = {
    embeds: [{
      title: `Vault PIN directory \u00b7 page ${page}`,
      description: result.results.length ? result.results.map(row => {
        const name = escapeMarkdown(String(row.playerName || 'Name unavailable').slice(0, 80)
          .replace(/[\r\n<>]/g, ' ').replace(/@/g, '@\u200b'), { maskedLink: true });
        return `**${name}** \u00b7 <@${row.userId}>\nVault PIN: hidden`;
      }).join('\n\n') : 'No generated Vault PINs yet.',
      color: 0x5865f2
    }]
  };
  const button = (action, label, target, disabled = false) => ({
    type: ComponentType.Button, custom_id: `v2:dashboard:pins:directory-${action}:${target}`,
    label, style: ButtonStyle.Secondary, disabled
  });
  return {
    ...body, content: null, allowedMentions: { parse: [] },
    components: [{
      type: ComponentType.ActionRow, components: [
        ...(lastPage > 1 ? [
          button('prev', 'Previous', Math.max(1, page - 1), page <= 1),
          button('next', 'Next', Math.min(lastPage, page + 1), page >= lastPage)
        ] : []),
        button('reveal', 'Reveal PINs Privately', page, !result.results.length),
        { type: ComponentType.Button, custom_id: 'v2:pin:generate-missing',
          label: 'Generate Missing PINs', style: ButtonStyle.Success }
      ]
    }]
  };
}

function createDashboardsFeature() {
  let listener;
  let pinsChangedListener;
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
        const directory = definition.key === 'pins' && context.config.features.pins;
        if (directory && (!context.services.pinDirectory || !context.services.pinDirectoryRestoration)) {
          throw new TypeError('PIN directory services are required.');
        }
        const panel = createPersistentPanel({
          key:definition.key, channelId, sensitive:directory,
          validateChannel:directory ? requirePrivatePinChannel : requireStaffChannel,
          payload:async () => directory
            ? pinPagePayload(definition, await context.services.pinDirectoryRestoration.page(page))
            : definition.key === 'pins' ? { content:'Vault PINs are disabled.', embeds:[], components:[] }
              : pagePayload(definition, page, await context.services.dashboards.snapshot(definition.key, page))
        });
        panels.push({ ...definition, panel, directory, setPage:value => { page = value; } });
      }
    },
    async register(context) {
      pinsChangedListener = () => {
        const definition = panels.find(item => item.key === 'pins' && item.directory);
        if (definition) {
          definition.setPage(1);
          return definition.panel.refresh(context);
        }
      };
      context.client.on('v2VaultPinsChanged', pinsChangedListener);
      listener = registerInteractionListener(context, 'dashboards', async interaction => {
        if (!isButton(interaction)) return;
        const parts = String(interaction.customId || '').split(':');
        if (parts.length !== 5 || parts[0] !== 'v2' || parts[1] !== 'dashboard') return;
        const page = Number(parts[4]);
        const definition = panels.find(item => item.key === parts[2]);
        if (definition?.key === 'pins' && !definition.directory) return;
        if (!definition || !Number.isSafeInteger(page) || page < 1 || page > 1000) return;
        const pinAction = parts[3].match(/^directory-(prev|refresh|next|reveal)$/);
        if (definition.directory ? !pinAction : !['prev','refresh','next'].includes(parts[3])) return;
        if (!definition.panel.matches(interaction)) throw new Error('This log panel is no longer valid.');
        const userContext = toInteractionContext(interaction);
        context.services.authorization.authorize('dashboards.view', userContext);
        if (definition.directory) {
          const reveal = pinAction[1] === 'reveal';
          if (reveal) await interaction.deferReply({ flags:64 });
          else await interaction.deferUpdate();
          const verify = async () => {
            try {
              await fetchPrivatePinChannel(context);
            } catch {
              await definition.panel.refresh(context);
              throw new Error('PIN dashboard privacy could not be verified.');
            }
          };
          try {
            await verify();
            const result = await context.services.pinDirectory.page({ page, context:userContext });
            await verify();
            if (reveal) {
              return interaction.editReply({
                content: result.results.length ? result.results.map(row =>
                  `<@${row.userId}>: ||${row.pin}||`).join('\n') : 'No generated Vault PINs yet.',
                embeds:[], components:[], allowedMentions:{ parse:[] }
              });
            }
            definition.setPage(result.page);
            const body = pinPagePayload(definition, result);
            await interaction.editReply(body);
            definition.panel.notePublished(body, interaction.message.id);
            await verify();
          } catch (error) {
            await reportInteractionError(context, 'dashboards', interaction, error, true);
          }
          return;
        }
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
      if (pinsChangedListener) context.client.off('v2VaultPinsChanged', pinsChangedListener);
      await Promise.all(panels.map(item => item.panel.stop(context)));
      listener = null;
      panels.length = 0;
    }
  });
}

module.exports = { createDashboardsFeature, pagePayload, pinPagePayload, requireStaffChannel };
