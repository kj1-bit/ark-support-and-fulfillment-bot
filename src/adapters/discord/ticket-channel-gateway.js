'use strict';

const { ButtonStyle, ChannelType, ComponentType, PermissionFlagsBits } = require('discord.js');
const DLC_NOTICE = '**DLC notice:** If your request involves a DLC creature, confirm that you own the required DLC. Delivery does not guarantee access to DLC-restricted abilities.';
const ACCESS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];

function ticketControls(record) {
  const closed = record.state === 'CLOSED';
  return [{
    type:ComponentType.ActionRow,
    components: closed ? [{
      type:ComponentType.Button, custom_id:`v2:ticket:reopen:${record.id}`,
      label:'Reopen Ticket', style:ButtonStyle.Secondary
    }] : [
      { type:ComponentType.Button, custom_id:`v2:ticket:complete:${record.id}`,
        label:'Ticket Completed', style:ButtonStyle.Success, disabled:record.state === 'COMPLETED' },
      { type:ComponentType.Button, custom_id:`v2:ticket:close:${record.id}`,
        label:'Close Ticket', style:ButtonStyle.Danger }
    ]
  }];
}

function createTicketChannelGateway({ client, config }) {
  const discord = config.discord;
  const topic = record => `Ticketbot V2 request ${record.id}`;
  function overwrites(record) {
    return [
      { id:discord.guildId, deny:[PermissionFlagsBits.ViewChannel] },
      { id:discord.roles.staff, allow:ACCESS },
      { id:client.user.id, allow:[...ACCESS,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ManageMessages] },
      { id:record.actorId, ...(record.state === 'CLOSED' ? { deny:[PermissionFlagsBits.ViewChannel] } : { allow:ACCESS }) }
    ];
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
    content:record.state === 'CLOSED' ? `Ticket #${record.ticketNumber} is closed and archived. Staff may reopen it.`
      : `<@${record.actorId}> <@&${discord.roles.staff}>\nTicket #${record.ticketNumber} has been opened. Please describe your request here.\n\n${DLC_NOTICE}`,
    components:ticketControls(record),
    allowedMentions:record.state === 'CLOSED' ? { parse:[] } : { users:[record.actorId], roles:[discord.roles.staff] }
  });
  return Object.freeze({
    async create(record, username) {
      const guild = await client.guilds.fetch(discord.guildId);
      const category = await guild.channels.fetch(discord.channels.ticketCategory);
      if (!category || category.type !== ChannelType.GuildCategory || category.guildId !== discord.guildId) {
        throw new Error('The configured ticket category is unavailable.');
      }
      const name = String(username || 'player').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'player';
      const channel = await guild.channels.create({
        name:`${name}-${record.ticketNumber}`, type:ChannelType.GuildText,
        parent:category.id, topic:topic(record), permissionOverwrites:overwrites(record),
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
      await channel.permissionOverwrites.set(overwrites(record), 'Synchronize private ticket access');
      if (record.state === 'CLOSED' && !channel.name.startsWith('closed-')) {
        await channel.setName(`closed-${record.ticketNumber}-${channel.name}`.slice(0, 100));
      } else if (record.state !== 'CLOSED' && channel.name.startsWith('closed-')) {
        await channel.setName(`request-${record.ticketNumber}`);
      }
      if (record.messageId) {
        let message;
        try { message = await channel.messages.fetch(record.messageId); }
        catch (error) { if (error.code !== 10008) throw error; }
        if (!message) return (await channel.send(payload(record))).id;
        await message.edit({ components:ticketControls(record), allowedMentions:{ parse:[] } });
      }
    },
    async remove(record) {
      let channel;
      try { channel = await fetch(record); }
      catch (error) { if (error.code === 10003) return; throw error; }
      await channel.delete('Closed ticket retention expired');
    }
  });
}

module.exports = { createTicketChannelGateway, ticketControls, DLC_NOTICE };
