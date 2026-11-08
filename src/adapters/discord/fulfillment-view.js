'use strict';

const { ButtonStyle, ComponentType, MessageFlags } = require('discord.js');

function confirmationView(model) {
  return Object.freeze({
    flags: MessageFlags.Ephemeral,
    content: model.notice,
    embeds: [Object.freeze({
      title: 'Confirm creature fulfillment',
      fields: Object.freeze([
        { name: 'Player', value: model.playerName },
        { name: 'Creature', value: model.creatureName },
        { name: 'Server', value: model.serverId },
        { name: 'Catalog version', value: model.catalogVersion }
      ])
    })],
    components: [Object.freeze({
      type: ComponentType.ActionRow,
      components: Object.freeze([
        { type: ComponentType.Button, custom_id: `v2:fulfillment:confirm:${model.token}`, label: 'Confirm fulfillment', style: ButtonStyle.Danger },
        { type: ComponentType.Button, custom_id: `v2:fulfillment:cancel:${model.token}`, label: 'Cancel', style: ButtonStyle.Secondary }
      ])
    })]
  });
}
function resultView(result) {
  return Object.freeze({
    content: `Fulfillment status: ${result.state}`,
    components: []
  });
}
module.exports = { confirmationView, resultView };
