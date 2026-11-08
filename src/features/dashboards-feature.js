'use strict';

const { ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const { defineFeature } = require('./feature-contract');
const { toInteractionContext } = require('../adapters/discord/interaction-context');
const { isButton } = require('../adapters/discord/interaction-protocol');
const { registerInteractionListener } = require('../adapters/discord/interaction-listener');

const PANEL_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'tickets', title: 'Ticket logs', channelKey: 'ticketLogs' }),
  Object.freeze({ key: 'pins', title: 'PIN logs', channelKey: 'pinsDashboard' }),
  Object.freeze({ key: 'fulfillment', title: 'Fulfillment logs', channelKey: 'fulfillmentLogs' })
]);

function panelPayload(panel) {
  return {
    embeds: [{
      title: panel.title,
      description: 'Open the latest operational events. Access is limited to authorized staff.',
      color: 0x5865f2
    }],
    components: [{
      type: ComponentType.ActionRow,
      components: [{
        type: ComponentType.Button,
        custom_id: `v2:dashboard:${panel.key}:1`,
        label: 'View latest events',
        style: ButtonStyle.Primary
      }]
    }]
  };
}

function pagePayload(panel, page, result) {
  const entries = result.results.map(event => {
    const time = Math.floor(Number(event.occurredAt) / 1000);
    const details = JSON.stringify(event.details).slice(0, 300);
    return `**${event.type}** · <t:${time}:R>\n${details}`;
  });
  const description = entries.length ? entries.join('\n\n').slice(0, 4000) : 'No events recorded yet.';
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  const components = [];
  if (page > 1 || page < lastPage) {
    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          custom_id: `v2:dashboard:${panel.key}:${Math.max(1, page - 1)}`,
          label: 'Previous',
          style: ButtonStyle.Secondary,
          disabled: page <= 1
        },
        {
          type: ComponentType.Button,
          custom_id: `v2:dashboard:${panel.key}:${Math.min(lastPage, page + 1)}`,
          label: 'Next',
          style: ButtonStyle.Secondary,
          disabled: page >= lastPage
        }
      ]
    });
  }
  return {
    flags: MessageFlags.Ephemeral,
    embeds: [{ title: `${panel.title} · page ${page}`, description, color: 0x5865f2 }],
    components
  };
}

function createDashboardsFeature() {
  let listener;
  let readyListener;
  let deleteListener;
  const activeMessages = new Map();
  const panels = [];

  async function restorePanel(context, panel) {
    const channel = await context.client.channels.fetch(panel.channelId);
    if (!channel || typeof channel.send !== 'function' || !channel.messages?.fetch) {
      throw new TypeError(`Dashboard channel ${panel.key} cannot send messages.`);
    }

    const saved = await context.services.dashboardPanels.get(panel.key);
    let message = null;
    if (saved?.channelId === panel.channelId) {
      try {
        message = await channel.messages.fetch(saved.messageId);
      } catch (error) {
        if (error?.code !== 10008 && error?.status !== 404) throw error;
      }
    }

    if (message) {
      await message.edit(panelPayload(panel));
    } else {
      message = await channel.send(panelPayload(panel));
      await context.services.dashboardPanels.save({
        panelKey: panel.key,
        channelId: panel.channelId,
        messageId: message.id,
        updatedAt: Date.now()
      });
    }
    activeMessages.set(message.id, panel);
  }

  async function reportRestoreFailure(context, panel) {
    try {
      await context.logSink(Object.freeze({
        type: 'discord.dashboard.restore_failed',
        at: new Date().toISOString(),
        data: Object.freeze({ panel: panel.key })
      }));
    } catch {
      console.error('Dashboard restoration failure could not be logged.');
    }
  }

  function scheduleRestore(context, panel) {
    return restorePanel(context, panel).catch(() => reportRestoreFailure(context, panel));
  }

  return defineFeature({
    name: 'dashboards',
    dependencies: [],
    async initialize(context) {
      if (!context.services?.dashboards || !context.services?.dashboardPanels) {
        throw new TypeError('dashboards and dashboard panel services are required.');
      }
      for (const definition of PANEL_DEFINITIONS) {
        const channelId = context.config.discord.channels[definition.channelKey];
        if (channelId) panels.push(Object.freeze({ ...definition, channelId }));
      }
      if (panels.length !== PANEL_DEFINITIONS.length) {
        throw new TypeError('All dashboard log channels are required when dashboards are enabled.');
      }
    },
    async register(context) {
      listener = registerInteractionListener(context, 'dashboards', async interaction => {
        if (!isButton(interaction)) return;
        const parts = String(interaction.customId || '').split(':');
        const page = Number(parts[3]);
        if (parts.length !== 4 || parts[0] !== 'v2' || parts[1] !== 'dashboard'
          || !['tickets', 'pins', 'fulfillment'].includes(parts[2])
          || !Number.isSafeInteger(page) || page < 1) return;
        const panel = panels.find(item => item.key === parts[2]);
        if (!panel) return;
        const result = await context.services.dashboards[panel.key]({
          page,
          context: toInteractionContext(interaction)
        });
        return interaction.reply(pagePayload(panel, page, result));
      });
    },
    async start(context) {
      readyListener = () => Promise.all(panels.map(panel => scheduleRestore(context, panel)));
      deleteListener = message => {
        const panel = activeMessages.get(message.id);
        if (!panel) return;
        activeMessages.delete(message.id);
        return scheduleRestore(context, panel);
      };
      context.client.on('ready', readyListener);
      context.client.on('messageDelete', deleteListener);
      if (typeof context.client.isReady === 'function' && context.client.isReady()) readyListener();
    },
    async stop(context) {
      if (listener && typeof context.client.off === 'function') {
        context.client.off('interactionCreate', listener);
      }
      if (readyListener && typeof context.client.off === 'function') {
        context.client.off('ready', readyListener);
      }
      if (deleteListener && typeof context.client.off === 'function') {
        context.client.off('messageDelete', deleteListener);
      }
      listener = null;
      readyListener = null;
      deleteListener = null;
      activeMessages.clear();
      panels.length = 0;
    }
  });
}

module.exports = { createDashboardsFeature, pagePayload, panelPayload };
