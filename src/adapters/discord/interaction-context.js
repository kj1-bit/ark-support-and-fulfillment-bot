'use strict';

function getRoleIds(interaction) {
  if (interaction?.member?.roles?.cache) {
    return Array.from(interaction.member.roles.cache.keys());
  }

  return Array.from(interaction?.member?.roleIds || []);
}

function toInteractionContext(interaction, options = {}) {
  const requireMessage = options.requireMessage === true;
  const actorId = interaction?.user?.id;
  const guildId = interaction?.guildId;
  const channelId = interaction?.channelId;
  const messageId = interaction?.message?.id || options.messageId || null;

  if (!actorId || !guildId || !channelId) {
    throw new TypeError('Complete guild interaction context is required.');
  }

  if (requireMessage && !messageId) {
    throw new TypeError('A message-bound interaction context is required.');
  }

  return Object.freeze({
    actorId,
    guildId,
    channelId,
    messageId,
    roleIds: Object.freeze(getRoleIds(interaction))
  });
}

module.exports = { toInteractionContext };
