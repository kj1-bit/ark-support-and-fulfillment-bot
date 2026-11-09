'use strict';

function createPersistentPanel({ key, channelId, payload, validateChannel }) {
  let messageId = null;
  let readyListener;
  let deleteListener;
  let pending = null;
  let stopped = true;
  let guildId = null;

  async function restore(context) {
    const channel = await context.client.channels.fetch(channelId);
    if (!channel || typeof channel.send !== 'function' || !channel.messages?.fetch) {
      throw new TypeError(`Panel channel ${key} cannot send messages.`);
    }
    if (channel.guildId !== context.config.discord.guildId) {
      throw new Error('Panel channel belongs to a different guild.');
    }
    if (validateChannel) await validateChannel(channel, context);
    const saved = await context.services.dashboardPanels.get(key);
    let message = null;
    if (saved?.channelId === channelId) {
      try {
        message = await channel.messages.fetch(saved.messageId);
      } catch (error) {
        if (error?.code !== 10008) throw error;
      }
    }
    const body = typeof payload === 'function' ? await payload(context) : payload;
    if (stopped) return;
    if (message) {
      await message.edit(body);
    } else {
      message = await channel.send(body);
      await context.services.dashboardPanels.save({
        panelKey: key, channelId, messageId: message.id, updatedAt: Date.now()
      });
    }
    messageId = message.id;
  }

  function schedule(context) {
    if (!pending) {
      pending = restore(context).catch(async () => {
        try {
          await context.logSink(Object.freeze({
            type: 'discord.panel.restore_failed',
            at: new Date().toISOString(),
            data: Object.freeze({ panel: key })
          }));
        } catch {
          console.error('Persistent panel restoration failure could not be logged.');
        }
      }).finally(() => { pending = null; });
    }
    return pending;
  }

  return Object.freeze({
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
      if (context.client.isReady?.()) await schedule(context);
    },
    async stop(context) {
      stopped = true;
      if (readyListener) context.client.off('ready', readyListener);
      if (deleteListener) context.client.off('messageDelete', deleteListener);
      if (pending) await pending;
      readyListener = null;
      deleteListener = null;
      messageId = null;
    }
  });
}

module.exports = { createPersistentPanel };
