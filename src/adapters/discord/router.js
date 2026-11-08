'use strict';

const crypto = require('node:crypto');
const { safeInteractionMessage } = require('./safe-response');
const { ephemeral, isButton, isChatInput } = require('./interaction-protocol');

function parseCustomId(value) {
  const parts = String(value || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v2' || parts[1] !== 'fulfillment') return null;
  const action = parts[2];
  if (!['confirm', 'cancel'].includes(action) || !parts[3]) return null;
  return Object.freeze({ action, token: parts[3] });
}

function commandInput(interaction) {
  const options = interaction.options;
  return Object.freeze({
    serverId: options.getString('server', true),
    creatureId: options.getString('creature', true),
    playerRef: options.getString('player', true),
    ttlMs: 120000,
    idempotencyKey: crypto.randomUUID()
  });
}

function createDiscordRouter({ controller, views, logSink }) {
  if (!controller || !views || typeof logSink !== 'function') {
    throw new TypeError('controller, views, and logSink are required.');
  }
  return Object.freeze({
    async handle(interaction) {
      try {
        if (isChatInput(interaction) && interaction.commandName === 'dino-fulfillment') {
          await interaction.deferReply({ flags: 64 });
          const model = await controller.begin(interaction, commandInput(interaction));
          return interaction.editReply(views.confirmationView(model));
        }
        if (!isButton(interaction)) return false;
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return false;
        if (parsed.action === 'cancel') {
          return interaction.update({ components: [], content: 'Fulfillment canceled.' });
        }
        await interaction.deferUpdate();
        const result = await controller.confirm(interaction, parsed);
        await logSink(controller.moderatorLog(result, interaction.logDetails || {}));
        return interaction.editReply(views.resultView(result));
      } catch (error) {
        const payload = ephemeral(safeInteractionMessage(error));
        if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
        return interaction.reply(payload);
      }
    }
  });
}
module.exports = { commandInput, createDiscordRouter, parseCustomId };
