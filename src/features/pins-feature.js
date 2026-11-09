'use strict';

const { ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const { defineFeature } = require('./feature-contract');
const { toInteractionContext } = require('../adapters/discord/interaction-context');
const { ephemeral, isButton, isModal, respond } = require('../adapters/discord/interaction-protocol');
const { registerInteractionListener } = require('../adapters/discord/interaction-listener');
const { createPersistentPanel } = require('../adapters/discord/persistent-panel');
const { fetchPrivatePinChannel } = require('../adapters/discord/staff-pin-channel');
const { VaultPinError } = require('../domain/pins/vault-pin-service');

const VAULT_PANEL_KEY = 'pins-vault';
const CUSTOM_IDS = Object.freeze({ vault: 'v2:pin:vault', generateMissing: 'v2:pin:generate-missing' });
const RETIRED_MESSAGE = 'Custom PIN requests have been retired. Use Get My Vault PIN on the current Vault panel.';

function vaultPanelPayload() {
  return {
    embeds: [{
      title: 'Vault PIN',
      description: 'Click below to view or receive your Vault PIN.\nYour PIN is private between you and staff. You receive it by direct message; staff can view it in their staff-only dashboard.',
      color: 0x5865f2
    }],
    components: [{
      type: ComponentType.ActionRow,
      components: [{ type: ComponentType.Button, custom_id: CUSTOM_IDS.vault, label: 'Get My Vault PIN', style: ButtonStyle.Primary }]
    }]
  };
}

async function logFailure(context) {
  try {
    await context.logSink(Object.freeze({
      type: 'discord.pin.retired_controls_cleanup_failed', at: new Date().toISOString(), data: Object.freeze({})
    }));
  } catch {
    console.error('Retired PIN control cleanup failure could not be logged.');
  }
}

async function retireCustomControls(context) {
  if (!context.services.retiredPinControls) return;
  try {
    let after = '';
    for (;;) {
      const channel = await fetchPrivatePinChannel(context);
      const rows = await context.services.retiredPinControls.list({
        guildId: context.config.discord.guildId, channelId: channel.id, after, limit: 100
      });
      for (const row of rows) {
        if (row.channelId !== channel.id) continue;
        try {
          const message = await channel.messages.fetch(row.messageId);
          if (!message.author?.id || message.author.id !== context.client.user?.id) continue;
          await message.edit({
            content: 'Custom PIN requests are retired. This historical request was not activated as a generated Vault PIN.',
            embeds: [], components: [], allowedMentions: { parse: [] }
          });
        } catch (error) {
          if (error?.code !== 10008) await logFailure(context);
        }
      }
      if (rows.length < 100) return;
      after = rows[rows.length - 1].id;
    }
  } catch {
    await logFailure(context);
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
  const staffRoleId = context.config?.discord?.roles?.staff;
  return [...new Set([...members.values()]
    .filter(member => !member.user?.bot
      && (member.roles?.cache?.has(memberRoleId) || (staffRoleId && member.roles?.cache?.has(staffRoleId))))
    .map(member => member.id))];
}

function createPinsFeature() {
  let listener;
  let readyListener;
  let cleanup;
  let vaultPanel = null;
  return defineFeature({
    name: 'pins',
    dependencies: ['player-names'],
    async initialize(context) {
      if (context.services.vaultPins) {
        const channelId = context.config?.discord?.channels?.vault;
        if (!channelId) throw new TypeError('discord.channels.vault is required for the Vault panel.');
        vaultPanel = createPersistentPanel({ key: VAULT_PANEL_KEY, channelId, payload: vaultPanelPayload() });
      }
    },
    async register(context) {
      listener = registerInteractionListener(context, 'pins', async interaction => {
        try {
          const customId = String(interaction.customId || '');
          if ((isModal(interaction) && customId === 'v2:pin:request')
            || (isButton(interaction) && /^v2:pin:(request-open|approve|deliver|cancel)(:|$)/.test(customId))) {
            return respond(interaction, ephemeral(RETIRED_MESSAGE));
          }
          if (!isButton(interaction)) return;
          if (customId === CUSTOM_IDS.vault) {
            if (!vaultPanel || !vaultPanel.matches(interaction)) {
              return respond(interaction, ephemeral('This Vault panel is no longer active. Please use the current Vault panel.'));
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const result = await context.services.vaultPins.deliverOwn({
              context: toInteractionContext(interaction, { requireMessage: true }),
              deliver: async pin => {
                await interaction.user.send(`Your Vault PIN is **${pin}**.\nKeep it private between you and staff. Staff can view it in the staff-only dashboard.`);
                return true;
              }
            });
            return respond(interaction, ephemeral(result.created
              ? 'Your Vault PIN was created and sent to your direct messages.'
              : 'Your Vault PIN was sent to your direct messages.'));
          }
          if (customId !== CUSTOM_IDS.generateMissing) return;
          if (!context.services.vaultPins) return respond(interaction, ephemeral('Vault PIN generation is not enabled.'));
          const pinContext = toInteractionContext(interaction, { requireMessage: true });
          context.services.vaultPins.assertCanGenerate(pinContext);
          const bound = await context.services.dashboardPanels.get('pins');
          if (!bound || bound.channelId !== interaction.channelId || bound.messageId !== interaction.message?.id) {
            throw new Error('This PIN dashboard is no longer active.');
          }
          await fetchPrivatePinChannel(context);
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const memberIds = await eligibleMemberIds(context, interaction, pinContext.guildId);
          const summary = await context.services.vaultPins.generateMissing({ context: pinContext, memberIds });
          const lines = [
            'Vault PIN generation complete. Refresh the PIN directory to view new codes. Members receive theirs from the Vault panel.',
            `Eligible members: ${summary.eligible}`, `Generated: ${summary.created}`, `Already had a PIN: ${summary.existing}`,
            `Skipped (player name not verified): ${summary.unverified}`, `Failed: ${summary.failed}`
          ];
          if (summary.failed) lines.push('Run Generate Missing PINs again to retry the failed members.');
          return respond(interaction, ephemeral(lines.join('\n')));
        } catch (error) {
          if (error instanceof VaultPinError) return respond(interaction, ephemeral(error.publicMessage));
          throw error;
        }
      });
    },
    async start(context) {
      if (vaultPanel) await vaultPanel.start(context);
      readyListener = () => {
        if (!cleanup) cleanup = retireCustomControls(context).finally(() => { cleanup = null; });
        return cleanup;
      };
      context.client.on('ready', readyListener);
      if (context.client.isReady?.()) await readyListener();
    },
    async stop(context) {
      if (listener) context.client.off('interactionCreate', listener);
      if (readyListener) context.client.off('ready', readyListener);
      if (cleanup) await cleanup;
      if (vaultPanel) await vaultPanel.stop(context);
      listener = null;
      readyListener = null;
      vaultPanel = null;
    }
  });
}

module.exports = { CUSTOM_IDS, VAULT_PANEL_KEY, RETIRED_MESSAGE, createPinsFeature, eligibleMemberIds, vaultPanelPayload };
