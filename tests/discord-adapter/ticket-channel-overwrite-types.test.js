'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ChannelType, Collection, OverwriteType, PermissionFlagsBits, PermissionOverwrites
} = require('discord.js');
const { createTicketChannelGateway } = require('../../src/adapters/discord/ticket-channel-gateway');

const id = n => `100000000000000${n.toString().padStart(2, '0')}`;
const guildId = id(1);
const staffRoleId = id(2);
const categoryId = id(3);
const botId = id(4);
const requesterId = id(5);
const ticketId = 'ticket-overwrites';
const access = PermissionFlagsBits.ViewChannel
  | PermissionFlagsBits.SendMessages
  | PermissionFlagsBits.ReadMessageHistory;

function makeScope() {
  const client = {
    user:{ id:botId },
    users:{ cache:new Collection(), resolve:() => undefined },
    channels:{}
  };
  const guild = {
    id:guildId,
    client,
    roles:{ resolve:() => undefined },
    members:{ me:{ id:botId } },
    channels:{}
  };
  return { client, guild };
}

function resolveAll(overwrites, guild) {
  return overwrites.map(overwrite => PermissionOverwrites.resolve(overwrite, guild));
}

function assertResolved(overwrites, { state, guild }) {
  assert.deepEqual(overwrites.map(overwrite => ({
    id:overwrite.id,
    type:overwrite.type,
    allow:BigInt(overwrite.allow),
    deny:BigInt(overwrite.deny)
  })), [
    { id:guildId, type:OverwriteType.Role, allow:0n, deny:PermissionFlagsBits.ViewChannel },
    { id:staffRoleId, type:OverwriteType.Role, allow:access, deny:0n },
    {
      id:botId, type:OverwriteType.Member,
      allow:access | PermissionFlagsBits.ManageChannels, deny:0n
    },
    {
      id:requesterId, type:OverwriteType.Member,
      allow:state === 'CLOSED' ? 0n : access,
      deny:state === 'CLOSED' ? PermissionFlagsBits.ViewChannel : 0n
    }
  ]);
}

function makeRecord(state) {
  return {
    id:ticketId,
    actorId:requesterId,
    ticketNumber:12,
    state,
    channelId:id(6),
    messageId:null
  };
}

function makeChannel(guild) {
  let resolved;
  const channel = {
    id:id(6),
    guildId,
    topic:`Ticketbot V2 request ${ticketId}`,
    name:'survivor-12',
    guild,
    permissionsFor:() => ({ has:() => true }),
    permissionOverwrites:{
      set:async overwrites => { resolved = resolveAll(overwrites, guild); }
    },
    setName:async name => { channel.name = name; return channel; },
    getResolved:() => resolved
  };
  return channel;
}

for (const state of ['OPEN', 'CLOSED']) {
  test(`ticket channel sync resolves ${state} overwrites for an uncached requester`, async () => {
    const { client, guild } = makeScope();
    const channel = makeChannel(guild);
    client.channels.fetch = async () => channel;
    const gateway = createTicketChannelGateway({
      client,
      config:{ discord:{
        guildId,
        roles:{ staff:staffRoleId },
        channels:{ ticketCategory:categoryId }
      } }
    });

    await gateway.sync(makeRecord(state));
    assertResolved(channel.getResolved(), { state, guild });
    assert.equal(client.users.cache.has(requesterId), false);
  });
}

test('ticket channel creation resolves explicit overwrite types with an uncached requester', async () => {
  const { client, guild } = makeScope();
  const category = {
    id:categoryId,
    guildId,
    type:ChannelType.GuildCategory,
    guild,
    permissionsFor:() => ({ has:() => true })
  };
  let resolved;
  guild.channels.fetch = async () => category;
  guild.channels.create = async options => {
    resolved = resolveAll(options.permissionOverwrites, guild);
    return { id:id(6) };
  };
  client.guilds = { fetch:async () => guild };
  const gateway = createTicketChannelGateway({
    client,
    config:{ discord:{
      guildId,
      roles:{ staff:staffRoleId },
      channels:{ ticketCategory:categoryId }
    } }
  });

  await gateway.create(makeRecord('OPEN'), 'Survivor');
  assertResolved(resolved, { state:'OPEN', guild });
  assert.equal(client.users.cache.has(requesterId), false);
});
