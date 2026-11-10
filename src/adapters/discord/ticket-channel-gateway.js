'use strict';

const { ButtonStyle, ChannelType, ComponentType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const DLC_NOTICE = '**DLC notice:** If your request involves a DLC creature, confirm that you own the required DLC. Delivery does not guarantee access to DLC-restricted abilities.';
const ACCESS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];
// Manage Roles is Discord's "Manage Permissions" for channel overwrites; it is required but cannot be granted by an overwrite.
const REQUIRED_PERMISSIONS = Object.freeze([
  ['ViewChannel','View Channel'], ['SendMessages','Send Messages'], ['ReadMessageHistory','Read Message History'],
  ['ManageChannels','Manage Channels'], ['ManageRoles','Manage Roles']
]);

async function missingPermissions(scope) {
  const members = scope?.guild?.members;
  const me = members?.me || await members?.fetchMe?.();
  const permissions = me && typeof scope.permissionsFor === 'function' ? scope.permissionsFor(me) : null;
  return REQUIRED_PERMISSIONS
    .filter(([flag]) => !permissions?.has(PermissionFlagsBits[flag]))
    .map(([, label]) => label);
}

async function requirePermissions(scope) {
  const missing = await missingPermissions(scope);
  if (missing.length) {
    throw Object.assign(new Error(`The bot is missing ticket channel permissions: ${missing.join(', ')}.`), {
      code:'TICKET_PERMISSIONS_MISSING', missing
    });
  }
}

function ticketControls(record) {
  const closed = record.state === 'CLOSED';
  return [{
    type:ComponentType.ActionRow,
    components: closed ? [{
      type:ComponentType.Button, custom_id:`v2:ticket:reopen:${record.id}`,
      label:'Reopen Ticket', style:ButtonStyle.Secondary
    }] : [
      ...(record.state === 'OPEN' || (record.state === 'COMPLETED' && !record.moderatorId)
        ? [{ type:ComponentType.Button, custom_id:`v2:ticket:claim:${record.id}`,
        label:'Claim Ticket', style:ButtonStyle.Primary }] : []),
      { type:ComponentType.Button, custom_id:`v2:ticket:complete:${record.id}`,
        label:'Ticket Completed', style:ButtonStyle.Success, disabled:record.state === 'COMPLETED' },
      { type:ComponentType.Button, custom_id:`v2:ticket:close:${record.id}`,
        label:'Close Ticket', style:ButtonStyle.Danger }
    ]
  }];
}

function createTicketChannelGateway({ client, config, onRenameError = () => {} }) {
  const discord = config.discord;
  const topic = record => `Ticketbot V2 request ${record.id}`;
  const renames = new Map();
  function overwrites(record) {
    return [
      { id:discord.guildId, type:OverwriteType.Role, deny:[PermissionFlagsBits.ViewChannel] },
      { id:discord.roles.staff, type:OverwriteType.Role, allow:ACCESS },
      { id:client.user.id, type:OverwriteType.Member, allow:[...ACCESS,PermissionFlagsBits.ManageChannels] },
      { id:record.actorId, type:OverwriteType.Member,
        ...(record.state === 'CLOSED' ? { deny:[PermissionFlagsBits.ViewChannel] } : { allow:ACCESS }) }
    ];
  }
  function desiredName(record, current) {
    const base = String(current).replace(new RegExp(`^closed-${record.ticketNumber}-`), '');
    return record.state === 'CLOSED' ? `closed-${record.ticketNumber}-${base}`.slice(0, 100) : base;
  }
  // Discord limits channel renames to about two per ten minutes, so renames never hold the ticket lock.
  // The latest desired name wins; recovery and later syncs re-apply it if a rename fails.
  function scheduleRename(channel, name) {
    const pending = renames.get(channel.id);
    if (pending) { pending.name = name; return; }
    if (channel.name === name) return;
    const job = { channel, name };
    renames.set(channel.id, job);
    job.done = (async () => {
      try {
        for (let attempt = 0; attempt < 3 && job.channel.name !== job.name; attempt += 1) {
          job.channel = await job.channel.setName(job.name, 'Synchronize private ticket state') || job.channel;
        }
      } catch (error) {
        await Promise.resolve(onRenameError(error, channel.id)).catch(() => {});
      } finally {
        renames.delete(channel.id);
      }
    })();
  }
  async function category() {
    const guild = await client.guilds.fetch(discord.guildId);
    const found = await guild.channels.fetch(discord.channels.ticketCategory);
    if (!found || found.type !== ChannelType.GuildCategory || found.guildId !== discord.guildId) {
      throw new Error('The configured ticket category is unavailable.');
    }
    return { guild, category:found };
  }
  async function fetch(record) {
    const channel = await client.channels.fetch(record.channelId);
    if (!channel) throw Object.assign(new Error('The private ticket channel is missing.'), { code:10003 });
    if (channel.guildId !== discord.guildId || channel.topic !== topic(record)) {
      throw new Error('The private ticket channel is missing or not owned by this bot.');
    }
    return channel;
  }
  const payload = record => ({
    content:record.state === 'CLOSED' ? 'This ticket is closed and archived. Staff may reopen it.'
      : `<@${record.actorId}> <@&${discord.roles.staff}>\nYour ticket is open. Please describe your request here.\n\n${DLC_NOTICE}`,
    components:ticketControls(record),
    allowedMentions:record.state === 'CLOSED' ? { parse:[] } : { users:[record.actorId], roles:[discord.roles.staff] }
  });
  return Object.freeze({
    async verify(record) {
      if (record) await requirePermissions(await fetch(record));
      else await requirePermissions((await category()).category);
    },
    async create(record, username) {
      const { guild, category:parent } = await category();
      await requirePermissions(parent);
      const name = String(username || 'player').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'player';
      const channel = await guild.channels.create({
        name:`${name}-${record.ticketNumber}`, type:ChannelType.GuildText,
        parent:parent.id, topic:topic(record), permissionOverwrites:overwrites(record),
        reason:`Private support request #${record.ticketNumber}`
      });
      return channel.id;
    },
    async find(record) {
      const guild = await client.guilds.fetch(discord.guildId);
      const channels = await guild.channels.fetch();
      const found = [...channels.values()].filter(channel => channel?.topic === topic(record)
        && channel.parentId === discord.channels.ticketCategory && channel.type === ChannelType.GuildText);
      if (found.length > 1) throw new Error('Multiple channels match this ticket reservation.');
      return found[0]?.id || null;
    },
    async post(record) {
      const channel = await fetch(record);
      // Recover an opening message sent just before a persistence interruption.
      const messages = await channel.messages.fetch({ limit:100 });
      const existing = [...messages.values()].find(message => message.author?.id === client.user.id
        && message.components?.some(row => row.components.some(button => button.customId === `v2:ticket:close:${record.id}`)));
      return existing?.id || (await channel.send(payload(record))).id;
    },
    async sync(record) {
      const channel = await fetch(record);
      await requirePermissions(channel);
      await channel.permissionOverwrites.set(overwrites(record), 'Synchronize private ticket access');
      let replacementId;
      if (record.messageId) {
        let message;
        try { message = await channel.messages.fetch(record.messageId); }
        catch (error) { if (error.code !== 10008) throw error; }
        if (!message) replacementId = (await channel.send(payload(record))).id;
        else await message.edit({ ...payload(record), allowedMentions:{ parse:[] } });
      }
      scheduleRename(channel, desiredName(record, renames.get(channel.id)?.name || channel.name));
      return replacementId;
    },
    pendingRename(channelId) { return renames.get(channelId)?.done; },
    async remove(record) {
      let channel;
      try { channel = await fetch(record); }
      catch (error) { if (error.code === 10003) return; throw error; }
      await channel.delete('Closed ticket retention expired');
    }
  });
}

module.exports = { createTicketChannelGateway, ticketControls, DLC_NOTICE, REQUIRED_PERMISSIONS };
