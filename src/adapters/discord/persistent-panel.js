'use strict';

const { createPinPrivacyListeners } = require('./staff-pin-channel');

function createPersistentPanel({ key, channelId, payload, validateChannel, sensitive = false, retryDelayMs = 30000 }) {
  let messageId = null;
  let readyListener;
  let deleteListener;
  let pending = null;
  let stopped = true;
  let guildId = null;
  let privacyListeners;
  let observedChannel;
  let rerun = false;
  let retryTimer;
  let lastPayload = null;
  let lastPayloadMessageId = null;

  function rememberPayload(body, id = messageId) {
    if (!id) return;
    lastPayload = JSON.stringify(body);
    lastPayloadMessageId = id;
  }

  async function redact(context, saved) {
    if (!saved) return;
    lastPayload = null;
    lastPayloadMessageId = null;
    try {
      const channel = await context.client.channels.fetch(saved.channelId, { force: true });
      if (channel?.guildId !== context.config.discord.guildId) return;
      const message = await channel.messages.fetch(saved.messageId);
      if (message.author?.id !== context.client.user?.id || !message.author?.id) return;
      await message.edit({
        content: 'PIN dashboard unavailable. Staff must verify channel privacy and refresh the panel.',
        embeds: [], components: [], allowedMentions: { parse: [] }
      });
    } catch (error) {
      if (error?.code === 10008 || error?.code === 10003) return;
      await context.logSink(Object.freeze({
        type: 'discord.panel.redaction_failed', at: new Date().toISOString(), data: Object.freeze({ panel: key })
      }));
    }
  }

  async function restore(context) {
    const saved = await context.services.dashboardPanels.get(key);
    if (sensitive && saved && saved.channelId !== channelId) await redact(context, saved);
    const channel = await context.client.channels.fetch(channelId, { force: true });
    if (!channel || typeof channel.send !== 'function' || !channel.messages?.fetch) {
      throw new TypeError(`Panel channel ${key} cannot send messages.`);
    }
    if (channel.guildId !== context.config.discord.guildId) {
      throw new Error('Panel channel belongs to a different guild.');
    }
    observedChannel = channel;
    if (validateChannel) await validateChannel(channel, context);
    let message = null;
    if (saved?.channelId === channelId) {
      try {
        message = await channel.messages.fetch(saved.messageId);
      } catch (error) {
        if (error?.code !== 10008) throw error;
      }
    }
    if (sensitive && message && (!message.author?.id || message.author.id !== context.client.user?.id)) {
      throw new Error('Panel message ownership could not be verified.');
    }
    const body = typeof payload === 'function' ? await payload(context) : payload;
    if (stopped) return;
    if (sensitive && validateChannel) {
      const fresh = await context.client.channels.fetch(channelId, { force: true });
      observedChannel = fresh;
      await validateChannel(fresh, context);
    }
    if (message) {
      if (!sensitive || message.id !== lastPayloadMessageId || JSON.stringify(body) !== lastPayload) {
        await message.edit(body);
      }
    } else {
      message = await channel.send(body);
      try {
        await context.services.dashboardPanels.save({
          panelKey: key, channelId, messageId: message.id, updatedAt: Date.now()
        });
      } catch {
        if (sensitive) await redact(context, { channelId, messageId: message.id });
        const error = new Error('Panel message binding could not be saved.');
        error.code = 'PANEL_BINDING_SAVE_FAILED';
        throw error;
      }
    }
    messageId = message.id;
    if (sensitive) rememberPayload(body);
  }

  async function restoreSafely(context) {
    try {
      await restore(context);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    } catch (error) {
      if (error?.code === 'PANEL_BINDING_SAVE_FAILED') {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (sensitive) {
        const boundMessageId = messageId;
        messageId = null;
        try {
          await redact(context, boundMessageId ? { channelId, messageId: boundMessageId }
            : await context.services.dashboardPanels.get(key));
        } catch {
          console.error('Sensitive panel redaction could not be completed.');
        }
      }
      try {
        await context.logSink(Object.freeze({
          type: 'discord.panel.restore_failed',
          at: new Date().toISOString(),
          data: Object.freeze({ panel: key })
        }));
      } catch {
        console.error('Persistent panel restoration failure could not be logged.');
      }
      // Repeating a failed binding save would post another untracked message on every retry.
      if (sensitive && error?.code !== 'PANEL_BINDING_SAVE_FAILED' && !stopped && !retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void schedule(context);
        }, retryDelayMs);
        retryTimer.unref?.();
      }
    }
  }

  function schedule(context) {
    if (stopped) return Promise.resolve();
    if (pending) {
      rerun = true;
      return pending;
    }
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    pending = (async () => {
      do {
        rerun = false;
        await restoreSafely(context);
      } while (rerun && !stopped);
    })().finally(() => {
      pending = null;
      if (rerun && !stopped) return schedule(context);
    });
    return pending;
  }

  return Object.freeze({
    refresh(context) { return schedule(context); },
    notePublished(body, id) { if (sensitive && id === messageId) rememberPayload(body, id); },
    matches(interaction) {
      return Boolean(messageId && interaction.message?.id === messageId
        && interaction.channelId === channelId && interaction.guildId === guildId);
    },
    async start(context) {
      if (!context.services?.dashboardPanels) throw new TypeError('Panel persistence service is required.');
      stopped = false;
      guildId = context.config.discord.guildId;
      readyListener = () => schedule(context);
      deleteListener = message => {
        if (message.id !== messageId) return;
        messageId = null;
        return schedule(context);
      };
      context.client.on('ready', readyListener);
      context.client.on('messageDelete', deleteListener);
      if (sensitive) {
        privacyListeners = createPinPrivacyListeners({
          guildId, channelId, staffRoleId: context.config.discord.roles.staff, getBotId: () => context.client.user?.id,
          getChannel: () => observedChannel, onChange: () => schedule(context)
        });
        for (const [event, listener] of Object.entries(privacyListeners)) {
          context.client.on(event, listener);
        }
      }
      if (context.client.isReady?.()) await schedule(context);
    },
    async stop(context) {
      stopped = true;
      rerun = false;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (readyListener) context.client.off('ready', readyListener);
      if (deleteListener) context.client.off('messageDelete', deleteListener);
      if (privacyListeners) {
        for (const [event, listener] of Object.entries(privacyListeners)) {
          context.client.off(event, listener);
        }
      }
      if (pending) await pending;
      readyListener = null;
      deleteListener = null;
      messageId = null;
      privacyListeners = null;
      observedChannel = null;
      lastPayload = null;
      lastPayloadMessageId = null;
    }
  });
}

module.exports = { createPersistentPanel };
