'use strict';

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { defineFeature } = require('./feature-contract');
const { toInteractionContext } = require('../adapters/discord/interaction-context');
const { isButton, isChatInput, isModal, respond, safePublicRecord } = require('../adapters/discord/interaction-protocol');
const { registerInteractionListener } = require('../adapters/discord/interaction-listener');

function pinRequestModal() {
  return new ModalBuilder()
    .setCustomId('v2:pin:request')
    .setTitle('Request a PIN')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('pin')
        .setLabel('Four-digit PIN')
        .setStyle(TextInputStyle.Short)
        .setMinLength(4)
        .setMaxLength(4)
        .setRequired(true)
    ));
}

function createPinsFeature() {
  let listener;
  return defineFeature({
    name: 'pins',
    dependencies: ['player-names'],
    async initialize(context) {
      if (!context.services?.pins) throw new TypeError('pins service is required.');
    },
    async register(context) {
      listener = registerInteractionListener(context, 'pins', async interaction => {
        if (isModal(interaction) && interaction.customId === 'v2:pin:request') {
          const result = await context.services.pins.request({
            pin: interaction.fields.getTextInputValue('pin'),
            context: toInteractionContext(interaction)
          });
          return respond(interaction, safePublicRecord(result, 'PIN request submitted.'));
        }

        let action;
        let input;
        if (isChatInput(interaction) && interaction.commandName === 'pin') {
          action = interaction.options.getSubcommand();
          if (action === 'request') return interaction.showModal(pinRequestModal());
          input = {
            requestId: interaction.options.getString('request-id', true),
            context: toInteractionContext(interaction)
          };
        } else if (isButton(interaction) && String(interaction.customId).startsWith('v2:pin:')) {
          const parts = interaction.customId.split(':');
          action = parts[2];
          input = {
            requestId: parts[3],
            context: toInteractionContext(interaction, { requireMessage: true })
          };
        } else {
          return;
        }

        if (action === 'deliver') {
          input.deliver = async (pin, record) => {
            const recipient = await context.client.users.fetch(record.actorId);
            await recipient.send(`Your approved vault PIN is **${pin}**. Do not share it.`);
            return true;
          };
        }
        if (typeof context.services.pins[action] !== 'function') return;
        const result = await context.services.pins[action](input);
        return respond(interaction, safePublicRecord(result, 'PIN request updated.'));
      });
    },
    async start() {},
    async stop(context) {
      if (listener && typeof context.client.off === 'function') {
        context.client.off('interactionCreate', listener);
      }
      listener = null;
    }
  });
}

module.exports = { createPinsFeature, pinRequestModal };
