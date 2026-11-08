'use strict';

const { MessageFlags } = require('discord.js');

function isChatInput(interaction) {
  return typeof interaction?.isChatInputCommand === 'function' && interaction.isChatInputCommand();
}
function isButton(interaction) {
  return typeof interaction?.isButton === 'function' && interaction.isButton();
}
function isStringSelect(interaction) {
  return typeof interaction?.isStringSelectMenu === 'function' && interaction.isStringSelectMenu();
}
function isModal(interaction) {
  return typeof interaction?.isModalSubmit === 'function' && interaction.isModalSubmit();
}
function ephemeral(content) {
  return { content: String(content).slice(0, 2000), flags: MessageFlags.Ephemeral };
}
function safePublicRecord(value, label = 'Operation completed.') {
  if (!value || typeof value !== 'object') return ephemeral(label);
  const state = value.state || value.status;
  const id = value.id || value.requestId;
  const parts = [label];
  if (id) parts.push(`Reference: ${String(id).slice(0, 80)}`);
  if (state) parts.push(`Status: ${String(state).slice(0, 40)}`);
  return ephemeral(parts.join('\n'));
}
async function respond(interaction, payload) {
  if (interaction.deferred && typeof interaction.editReply === 'function') return interaction.editReply(payload);
  if (interaction.replied && typeof interaction.followUp === 'function') return interaction.followUp(payload);
  return interaction.reply(payload);
}
module.exports = { ephemeral, isButton, isChatInput, isModal, isStringSelect, respond, safePublicRecord };
