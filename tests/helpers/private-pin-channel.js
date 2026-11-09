'use strict';

function privatePinChannel({ channelId, guildId, staffRoleId }) {
  const roles = new Map([
    [guildId, { id: guildId, permissions: { has: () => false } }],
    [staffRoleId, { id: staffRoleId, permissions: { has: () => false } }]
  ]);
  const members = new Map();
  return {
    id: channelId, guildId,
    guild: {
      id: guildId,
      roles: { cache: roles, fetch: async () => roles },
      members: { fetch: async ({ user }) => members.get(user) }
    },
    permissionOverwrites: { cache: new Map() },
    permissionsFor: item => ({ has: () => item.id === staffRoleId }),
    members
  };
}

module.exports = { privatePinChannel };
