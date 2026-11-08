'use strict';

const {
  ActionRowBuilder, ButtonStyle, ComponentType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { defineFeature } = require('./feature-contract');
const { toInteractionContext } = require('../adapters/discord/interaction-context');
const { ephemeral, isButton, isChatInput, isModal, respond, safePublicRecord } = require('../adapters/discord/interaction-protocol');
const { registerInteractionListener } = require('../adapters/discord/interaction-listener');
const { createPersistentPanel } = require('../adapters/discord/persistent-panel');
const { VaultPinError } = require('../domain/pins/vault-pin-service');

const VAULT_PANEL_KEY = 'pins-vault';
const CUSTOM_IDS = Object.freeze({
  vault: 'v2:pin:vault',
  requestOpen: 'v2:pin:request-open',
  generateMissing: 'v2:pin:generate-missing'
});
const MODERATION_ACTIONS = Object.freeze(['approve', 'deliver', 'cancel']);
const REQUEST_ID = /^PIN-[A-Za-z0-9-]{1,80}$/;

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

function vaultPanelPayload() {
  return {
    embeds: [{
      title: 'Vault PIN',
      description: 'Click below to view or receive your Vault PIN.\nYour PIN is only ever sent to you by direct message.',
      color: 0x5865f2
    }],
    components: [{
      type: ComponentType.ActionRow,
      components: [
        { type: ComponentType.Button, custom_id: CUSTOM_IDS.vault, label: 'Get My Vault PIN', style: ButtonStyle.Primary },
        { type: ComponentType.Button, custom_id: CUSTOM_IDS.requestOpen, label: 'Request a Custom PIN', style: ButtonStyle.Secondary }
      ]
    }]
  };
}

function moderationPayload(record) {
  const state = String(record?.state || 'UNKNOWN');
  const id = String(record?.id || '');
  const button = (action, label, style, enabled) => ({
    type: ComponentType.Button,
    custom_id: `v2:pin:${action}:${id}`,
    label,
    style,
    disabled: !enabled
  });
  const open = state === 'PENDING' || state === 'APPROVED';
  return {
    allowedMentions: { parse: [] },
    embeds: [{
      title: 'PIN request',
      color: open ? 0xfee75c : 0x99aab5,
      fields: [
        { name: 'Requester', value: record?.actorId ? `<@${record.actorId}>` : 'Unknown', inline: true },
        { name: 'Player name', value: String(record?.playerName || 'Unknown').slice(0, 64), inline: true },
        { name: 'Status', value: state.slice(0, 40), inline: true },
        { name: 'Reference', value: id.slice(0, 100) || 'Unknown' }
      ]
    }],
    components: open ? [{
      type: ComponentType.ActionRow,
      components: [
        button('approve', 'Approve', ButtonStyle.Success, state === 'PENDING'),
        button('deliver', 'Deliver by DM', ButtonStyle.Primary, state === 'APPROVED'),
        button('cancel', 'Cancel', ButtonStyle.Danger, true)
      ]
    }] : []
  };
}

async function logEvent(context, type, data) {
  try {
    await context.logSink(Object.freeze({ type, at: new Date().toISOString(), data: Object.freeze(data) }));
  } catch {
    console.error('PIN feature event could not be logged.');
  }
}

async function moderationChannel(context) {
  const channelId = context.config?.discord?.channels?.pinsDashboard;
  if (!channelId) return null;
  const channel = await context.client.channels.fetch(channelId);
  if (!channel || typeof channel.send !== 'function') throw new TypeError('PIN dashboard channel cannot send messages.');
  if (channel.guildId !== context.config.discord.guildId) throw new Error('PIN dashboard channel guild mismatch.');
  return channel;
}

async function sendAndBind(context, channel, record, bind) {
  const message = await channel.send(moderationPayload(record));
  try {
    await bind(message);
  } catch (error) {
    // Another poster won the binding; remove this duplicate so only the bound message carries controls.
    await Promise.resolve(message.delete?.()).catch(() => {});
    throw error;
  }
  return message;
}

async function postModerationMessage(context, record, tracked) {
  if (typeof context.services.pins.attachModerationMessage !== 'function' || !record?.id) return;
  try {
    const channel = await moderationChannel(context);
    if (!channel) return;
    const message = await sendAndBind(context, channel, record, posted => context.services.pins.attachModerationMessage({
      requestId: record.id, channelId: channel.id, messageId: posted.id
    }));
    tracked.set(message.id, record.id);
  } catch {
    await logEvent(context, 'discord.pin.moderation_post_failed', { requestId: String(record.id).slice(0, 100) });
  }
}

const RESTORE_BATCH_SIZE = 100;

async function restoreOne(context, channel, record, tracked) {
  const bound = record.moderation;
  if (!bound) {
    const message = await sendAndBind(context, channel, record, posted => context.services.pins.attachModerationMessage({
      requestId: record.id, channelId: channel.id, messageId: posted.id
    }));
    tracked.set(message.id, record.id);
    return;
  }
  let existing = null;
  if (bound.channelId === channel.id) {
    try {
      existing = await channel.messages.fetch(bound.messageId);
    } catch (error) {
      if (error?.code !== 10008 && error?.status !== 404) throw error;
    }
  }
  if (existing) {
    await existing.edit(moderationPayload(record));
    tracked.set(existing.id || bound.messageId, record.id);
    return;
  }
  const message = await sendAndBind(context, channel, record, posted => context.services.pins.rebindModerationMessage({
    requestId: record.id, channelId: channel.id, previousMessageId: bound.messageId, messageId: posted.id
  }));
  tracked.set(message.id, record.id);
}

async function restoreModerationMessages(context, tracked) {
  if (typeof context.services.pins.outstandingModeration !== 'function') return;
  const guildId = context.config.discord.guildId;
  let channel;
  try {
    channel = await moderationChannel(context);
  } catch {
    await logEvent(context, 'discord.pin.moderation_restore_failed', {});
    return;
  }
  if (!channel) return;
  let after = null;
  for (;;) {
    let records;
    try {
      records = await context.services.pins.outstandingModeration({ guildId, limit: RESTORE_BATCH_SIZE, after });
    } catch {
      await logEvent(context, 'discord.pin.moderation_restore_failed', {});
      return;
    }
    for (const record of records) {
      if (record.guildId !== guildId) continue;
      try {
        await restoreOne(context, channel, record, tracked);
      } catch {
        await logEvent(context, 'discord.pin.moderation_restore_failed', { requestId: String(record.id).slice(0, 100) });
      }
    }
    if (records.length < RESTORE_BATCH_SIZE) return;
    const last = records[records.length - 1];
    after = Object.freeze({ createdAt: last.createdAt, id: last.id });
  }
}

async function restoreDeletedModerationMessage(context, deleted, tracked) {
  const requestId = tracked.get(deleted?.id);
  if (!requestId) return;
  tracked.delete(deleted.id);
  if (typeof context.services.pins.moderationRecord !== 'function') return;
  try {
    const record = await context.services.pins.moderationRecord(requestId);
    // Closed requests need no controls; a different stored message means another restore already won.
    if (!record || record.guildId !== context.config.discord.guildId) return;
    if (!record.moderation || record.moderation.messageId !== deleted.id) return;
    const channel = await moderationChannel(context);
    if (!channel) return;
    const message = await sendAndBind(context, channel, record, posted => context.services.pins.rebindModerationMessage({
      requestId: record.id, channelId: channel.id, previousMessageId: deleted.id, messageId: posted.id
    }));
    tracked.set(message.id, record.id);
  } catch {
    await logEvent(context, 'discord.pin.moderation_restore_failed', { requestId: String(requestId).slice(0, 100) });
  }
}

async function eligibleMemberIds(context, interaction, guildId) {
  const memberRoleId = context.config?.discord?.roles?.member;
  if (!memberRoleId) {
    throw new VaultPinError('MEMBER_ROLE_MISSING', 'The member role is not configured, so eligible members cannot be determined.');
  }
  let members;
  try {
    const guild = interaction.guild?.id === guildId ? interaction.guild : await context.client.guilds.fetch(guildId);
    members = await guild.members.fetch();
  } catch {
    throw new VaultPinError('MEMBER_FETCH_FAILED', 'Server members could not be loaded. Ensure the bot has the Server Members intent enabled, then try again.');
  }
  return [...members.values()]
    .filter(member => !member.user?.bot && member.roles?.cache?.has(memberRoleId))
    .map(member => member.id);
}

function createPinsFeature() {
  let listener;
  let readyListener;
  let deleteListener;
  let vaultPanel = null;
  const trackedModeration = new Map();

  async function handleVault(context, interaction) {
    if (!vaultPanel || !vaultPanel.matches(interaction)) {
      return respond(interaction, ephemeral('This Vault panel is no longer active. Please use the current Vault panel.'));
    }
    const pinContext = toInteractionContext(interaction, { requireMessage: true });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await context.services.vaultPins.deliverOwn({
      context: pinContext,
      deliver: async pin => {
        await interaction.user.send(`Your Vault PIN is **${pin}**.\nKeep it private. Staff will never ask you for it.`);
        return true;
      }
    });
    return respond(interaction, ephemeral(result.created
      ? 'Your Vault PIN was created and sent to your direct messages.'
      : 'Your Vault PIN was sent to your direct messages.'));
  }

  async function handleGenerateMissing(context, interaction) {
    if (!context.services.vaultPins) return respond(interaction, ephemeral('Vault PIN generation is not enabled.'));
    const pinContext = toInteractionContext(interaction, { requireMessage: true });
    context.services.vaultPins.assertCanGenerate(pinContext);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const memberIds = await eligibleMemberIds(context, interaction, pinContext.guildId);
    const summary = await context.services.vaultPins.generateMissing({ context: pinContext, memberIds });
    const lines = [
      'Vault PIN generation complete. No PINs were sent; members receive theirs from the Vault panel.',
      `Eligible members: ${summary.eligible}`,
      `Generated: ${summary.created}`,
      `Already had a PIN: ${summary.existing}`,
      `Skipped (player name not verified): ${summary.unverified}`,
      `Failed: ${summary.failed}`
    ];
    if (summary.failed) lines.push('Run Generate Missing PINs again to retry the failed members.');
    return respond(interaction, ephemeral(lines.join('\n')));
  }

  return defineFeature({
    name: 'pins',
    dependencies: ['player-names'],
    async initialize(context) {
      if (!context.services?.pins) throw new TypeError('pins service is required.');
      if (context.services.vaultPins) {
        const channelId = context.config?.discord?.channels?.vault;
        if (!channelId) throw new TypeError('discord.channels.vault is required for the Vault panel.');
        if (!context.services.dashboardPanels) throw new TypeError('Panel persistence service is required for the Vault panel.');
        vaultPanel = createPersistentPanel({ key: VAULT_PANEL_KEY, channelId, payload: vaultPanelPayload() });
      }
    },
    async register(context) {
      listener = registerInteractionListener(context, 'pins', async interaction => {
        try {
          return await handle(interaction);
        } catch (error) {
          if (error instanceof VaultPinError) return respond(interaction, ephemeral(error.publicMessage));
          throw error;
        }
      });

      async function handle(interaction) {
        if (isModal(interaction) && interaction.customId === 'v2:pin:request') {
          const result = await context.services.pins.request({
            pin: interaction.fields.getTextInputValue('pin'),
            context: toInteractionContext(interaction)
          });
          await postModerationMessage(context, result, trackedModeration);
          return respond(interaction, safePublicRecord(result, 'PIN request submitted. Staff will review it and deliver it by direct message.'));
        }

        if (isButton(interaction)) {
          if (interaction.customId === CUSTOM_IDS.vault) {
            if (!context.services.vaultPins) return respond(interaction, ephemeral('Vault PINs are not enabled.'));
            return handleVault(context, interaction);
          }
          if (interaction.customId === CUSTOM_IDS.requestOpen) {
            if (!vaultPanel || !vaultPanel.matches(interaction)) {
              return respond(interaction, ephemeral('This Vault panel is no longer active. Please use the current Vault panel.'));
            }
            return interaction.showModal(pinRequestModal());
          }
          if (interaction.customId === CUSTOM_IDS.generateMissing) return handleGenerateMissing(context, interaction);
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
          if (parts.length !== 4 || !REQUEST_ID.test(parts[3])) return;
          action = parts[2];
          input = {
            requestId: parts[3],
            requireBoundMessage: true,
            context: toInteractionContext(interaction, { requireMessage: true })
          };
        } else {
          return;
        }

        if (!MODERATION_ACTIONS.includes(action)) return;
        if (action === 'deliver') {
          input.deliver = async (pin, record) => {
            const recipient = await context.client.users.fetch(record.actorId);
            await recipient.send(`Your approved vault PIN is **${pin}**. Do not share it.`);
            return true;
          };
        }
        const result = await context.services.pins[action](input);
        if (input.requireBoundMessage && typeof interaction.message?.edit === 'function') {
          try {
            await interaction.message.edit(moderationPayload(result));
            if (!['PENDING', 'APPROVED'].includes(result?.state)) trackedModeration.delete(interaction.message.id);
          } catch {
            await logEvent(context, 'discord.pin.moderation_update_failed', { requestId: String(result?.id || '').slice(0, 100) });
          }
        }
        return respond(interaction, safePublicRecord(result, 'PIN request updated.'));
      }
    },
    async start(context) {
      if (vaultPanel) await vaultPanel.start(context);
      readyListener = () => restoreModerationMessages(context, trackedModeration);
      deleteListener = message => restoreDeletedModerationMessage(context, message, trackedModeration);
      context.client.on('ready', readyListener);
      context.client.on('messageDelete', deleteListener);
      if (typeof context.client.isReady === 'function' && context.client.isReady()) await readyListener();
    },
    async stop(context) {
      if (listener && typeof context.client.off === 'function') {
        context.client.off('interactionCreate', listener);
      }
      listener = null;
      if (readyListener && typeof context.client.off === 'function') context.client.off('ready', readyListener);
      readyListener = null;
      if (deleteListener && typeof context.client.off === 'function') context.client.off('messageDelete', deleteListener);
      deleteListener = null;
      trackedModeration.clear();
      if (vaultPanel) await vaultPanel.stop(context);
      vaultPanel = null;
    }
  });
}

module.exports = { CUSTOM_IDS, VAULT_PANEL_KEY, createPinsFeature, moderationPayload, pinRequestModal, vaultPanelPayload };