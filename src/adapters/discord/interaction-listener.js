'use strict';

const { ephemeral, respond } = require('./interaction-protocol');
const { safeInteractionMessage } = require('./safe-response');

async function reportInteractionError(context, feature, interaction, error, deferredUpdate = false) {
  try {
    await context.logSink(Object.freeze({
      type: 'discord.interaction.failed',
      at: new Date().toISOString(),
      data: Object.freeze({ feature })
    }));
  } catch {
    console.error('Discord interaction error could not be logged.');
  }
  let publicMessage = 'The request could not be completed safely. A moderator can review the audit log.';
  try {
    publicMessage = safeInteractionMessage(error);
  } catch {
    publicMessage = 'The request could not be completed safely. A moderator can review the audit log.';
  }
  try {
    if (deferredUpdate) {
      await interaction.followUp(ephemeral(publicMessage));
    } else {
      await respond(interaction, ephemeral(publicMessage));
    }
  } catch {
    console.error('Discord interaction error response could not be sent.');
  }
}

function registerInteractionListener(context, feature, handler) {
  const listener = interaction => Promise.resolve()
    .then(() => handler(interaction))
    .catch(error => reportInteractionError(context, feature, interaction, error));
  context.client.on('interactionCreate', listener);
  return listener;
}

module.exports = { registerInteractionListener, reportInteractionError };
