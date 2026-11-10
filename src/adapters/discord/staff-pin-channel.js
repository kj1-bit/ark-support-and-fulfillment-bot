'use strict';

const { PermissionFlagsBits, OverwriteType } = require('discord.js');

async function requirePrivateStaffChannel(channel, context, channelId, label = 'Staff panel') {
  const config = context.config.discord;
  if (!channel || channel.id !== channelId || channel.guildId !== config.guildId
    || !config.roles.staff || typeof channel.guild?.roles?.fetch !== 'function'
    || !channel.permissionOverwrites?.cache || typeof channel.permissionsFor !== 'function') {
    throw new Error(`${label} privacy could not be verified.`);
  }
  const roles = await channel.guild.roles.fetch();
  if (!roles.has(config.roles.staff) || !roles.has(config.guildId)) {
    throw new Error(`${label} privacy could not be verified.`);
  }
  for (const role of roles.values()) {
    if (role.id === config.roles.staff || role.permissions.has(PermissionFlagsBits.Administrator)
      || (role.managed && role.tags?.botId)) continue;
    const permissions = channel.permissionsFor(role);
    if (!permissions || permissions.has(PermissionFlagsBits.ViewChannel)) {
      throw new Error(`${label} must be staff-only.`);
    }
  }
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (overwrite.type !== OverwriteType.Member) continue;
    let member;
    try {
      member = await channel.guild.members.fetch({ user: overwrite.id, force: true });
    } catch (error) {
      if (error?.code === 10007) continue;
      throw error;
    }
    if (!member) throw new Error(`${label} privacy could not be verified.`);
    if (member.user?.bot || member.roles.cache.has(config.roles.staff)
      || member.permissions.has(PermissionFlagsBits.Administrator)) continue;
    const permissions = channel.permissionsFor(member);
    if (!permissions || permissions.has(PermissionFlagsBits.ViewChannel)) {
      throw new Error(`${label} must be staff-only.`);
    }
  }
}

function requirePrivatePinChannel(channel, context) {
  return requirePrivateStaffChannel(channel, context, context.config.discord.channels.pinsDashboard, 'PIN dashboard');
}

function createPinPrivacyListeners({ guildId, channelId, staffRoleId, getBotId, getChannel, onChange }) {
  const inGuild = item => (item?.guildId || item?.guild?.id) === guildId;
  const overwrites = () => getChannel()?.permissionOverwrites?.cache;
  const hasMemberOverwrite = id => overwrites()?.get(id)?.type === OverwriteType.Member;
  const hasRoleOverwrite = id => overwrites()?.get(id)?.type === OverwriteType.Role;
  const audiencePermissions = role => {
    if (!role?.permissions?.has) return null;
    return [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Administrator]
      .map(bit => role.permissions.has(bit)).join(':');
  };
  const roleRelevant = role => !role?.permissions?.has || role.id === staffRoleId
    || hasRoleOverwrite(role.id) || role.permissions.has(PermissionFlagsBits.ViewChannel)
    || role.permissions.has(PermissionFlagsBits.Administrator);
  const overwriteState = channel => JSON.stringify([...(channel?.permissionOverwrites?.cache?.values() || [])]
    .map(item => [item.id, item.type, String(item.allow?.bitfield), String(item.deny?.bitfield)])
    .sort((left, right) => left[0].localeCompare(right[0])));
  const roleIds = member => new Set(member?.roles?.cache?.keys() || []);
  const memberArrived = member => {
    if (inGuild(member) && (hasMemberOverwrite(member.id) || member.id === getBotId())) return onChange();
  };
  return {
    channelUpdate(oldChannel, newChannel) {
      const channel = newChannel || oldChannel;
      if (!inGuild(channel) || channel.id !== channelId) return;
      if (newChannel && oldChannel && oldChannel.parentId === newChannel.parentId
        && oldChannel.type === newChannel.type && oldChannel.permissionOverwrites?.cache
        && newChannel.permissionOverwrites?.cache && overwriteState(oldChannel) === overwriteState(newChannel)) return;
      return onChange();
    },
    roleUpdate(oldRole, newRole) {
      const role = newRole || oldRole;
      if (!inGuild(role)) return;
      const before = audiencePermissions(oldRole);
      if (newRole && oldRole && before !== null && before === audiencePermissions(newRole)
        && oldRole.managed === newRole.managed && oldRole.tags?.botId === newRole.tags?.botId) return;
      return onChange();
    },
    roleDelete(role) {
      if (inGuild(role) && roleRelevant(role)) return onChange();
    },
    roleCreate(role) {
      if (inGuild(role) && roleRelevant(role)) return onChange();
    },
    guildMemberUpdate(oldMember, newMember) {
      const member = newMember || oldMember;
      if (!inGuild(member)) return;
      const before = roleIds(oldMember);
      const after = roleIds(member);
      const changed = [...new Set([...before, ...after])].filter(id => before.has(id) !== after.has(id));
      const knownRoles = oldMember?.roles?.cache && newMember?.roles?.cache;
      if (knownRoles && !changed.length && oldMember.user?.bot === newMember.user?.bot) return;
      if (!knownRoles || member.id === getBotId() || hasMemberOverwrite(member.id)
        || changed.some(id => id === staffRoleId || hasRoleOverwrite(id)
          || roleRelevant(getChannel()?.guild?.roles?.cache?.get(id)))) return onChange();
    },
    guildMemberAdd: memberArrived,
    guildMemberAvailable: memberArrived
  };
}

async function fetchPrivatePinChannel(context) {
  const channel = await context.client.channels.fetch(context.config.discord.channels.pinsDashboard, { force: true });
  await requirePrivatePinChannel(channel, context);
  return channel;
}

module.exports = { requirePrivatePinChannel, requirePrivateStaffChannel, fetchPrivatePinChannel, createPinPrivacyListeners };
