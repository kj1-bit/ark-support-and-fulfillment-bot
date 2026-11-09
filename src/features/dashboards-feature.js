'use strict';

const { ButtonStyle, ComponentType, PermissionFlagsBits, escapeMarkdown } = require('discord.js');
const { defineFeature } = require('./feature-contract');
const { toInteractionContext } = require('../adapters/discord/interaction-context');
const { isButton } = require('../adapters/discord/interaction-protocol');
const { registerInteractionListener, reportInteractionError } = require('../adapters/discord/interaction-listener');
const { createPersistentPanel } = require('../adapters/discord/persistent-panel');
const { sanitizeDetails } = require('../domain/dashboards/operational-event-service');
const { requirePrivatePinChannel, fetchPrivatePinChannel } = require('../adapters/discord/staff-pin-channel');

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

function pinPagePayload(panel, mode, result) {
  const page = result.page;
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  const body = mode === 'activity' ? pagePayload({ ...panel, title: 'PIN activity' }, page, result) : {
    embeds: [{
      title: `Vault PIN directory \u00b7 page ${page}`,
      description: result.results.length ? result.results.map(row => {
        const name = escapeMarkdown(String(row.playerName || 'Name unavailable').slice(0, 80)
          .replace(/[\r\n<>]/g, ' ').replace(/@/g, '@\u200b'), { maskedLink: true });
        return `**${name}** \u00b7 <@${row.userId}> (\`${row.userId}\`)\nCurrent Vault PIN: **${row.pin}**`;
      }).join('\n\n') : 'No generated Vault PINs yet.',
      color: 0x5865f2,
      footer: { text: 'Private to players and staff. Generated Vault PINs only; historical custom requests are not active Vault PINs.' }
    }]
  };
  const button = (action, label, target, disabled = false) => ({
    type: ComponentType.Button, custom_id: `v2:dashboard:pins:${mode}-${action}:${target}`,
    label, style: ButtonStyle.Secondary, disabled
  });
  return {
    ...body, content: null, allowedMentions: { parse: [] },
    components: [{
      type: ComponentType.ActionRow, components: [
        button('prev', 'Previous', Math.max(1, page - 1), page <= 1),
        button('refresh', 'Refresh', page),
        button('next', 'Next', Math.min(lastPage, page + 1), page >= lastPage),
        { type: ComponentType.Button, custom_id: `v2:dashboard:pins:${mode === 'directory' ? 'activity' : 'directory'}-refresh:1`,
          label: mode === 'directory' ? 'PIN Activity' : 'PIN Directory', style: ButtonStyle.Primary },
        { type: ComponentType.Button, custom_id: 'v2:pin:generate-missing',
          label: 'Generate Missing PINs', style: ButtonStyle.Success }
      ]
    }]
  };
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
        let mode = 'directory';
        const directory = definition.key === 'pins' && context.config.features.pins;
        if (directory && (!context.services.pinDirectory || !context.services.pinDirectoryRestoration)) {
          throw new TypeError('PIN directory services are required.');
        }
        const panel = createPersistentPanel({
          key:definition.key, channelId, sensitive:directory,
          validateChannel:directory ? requirePrivatePinChannel : requireStaffChannel,
          payload:async () => directory
            ? pinPagePayload(definition, mode, mode === 'directory'
              ? await context.services.pinDirectoryRestoration.page(page)
              : await context.services.dashboards.snapshot('pins', page))
            : pagePayload(definition, page, await context.services.dashboards.snapshot(definition.key, page))
        });
        panels.push({ ...definition, panel, directory, setPage:(value, view) => { page = value; if (view) mode = view; } });
      }
    },
    async register(context) {
      listener = registerInteractionListener(context, 'dashboards', async interaction => {
        if (!isButton(interaction)) return;
        const parts = String(interaction.customId || '').split(':');
        if (parts.length !== 5 || parts[0] !== 'v2' || parts[1] !== 'dashboard') return;
        const page = Number(parts[4]);
        const definition = panels.find(item => item.key === parts[2]);
        if (!definition || !Number.isSafeInteger(page) || page < 1 || page > 1000) return;
        const pinAction = parts[3].match(/^(directory|activity)-(prev|refresh|next)$/);
        if (definition.directory ? !pinAction : !['prev','refresh','next'].includes(parts[3])) return;
        if (!definition.panel.matches(interaction)) throw new Error('This log panel is no longer valid.');
        const userContext = toInteractionContext(interaction);
        context.services.authorization.authorize('dashboards.view', userContext);
        if (definition.directory) {
          await interaction.deferUpdate();
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
            const mode = pinAction[1];
            const result = mode === 'directory'
              ? await context.services.pinDirectory.page({ page, context:userContext })
              : await context.services.dashboards.pins({ page, context:userContext });
            await verify();
            definition.setPage(result.page, mode);
            const body = pinPagePayload(definition, mode, result);
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
      await Promise.all(panels.map(item => item.panel.stop(context)));
      listener = null;
      panels.length = 0;
    }
  });
}

module.exports = { createDashboardsFeature, pagePayload, pinPagePayload, requireStaffChannel };
