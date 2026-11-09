'use strict';

const PAGE_SIZE = 10;

function createPinDirectoryService({ repository, protector, authorization, guildId, channelId, staffRoleId }) {
  async function page(number = 1) {
    if (!Number.isSafeInteger(number) || number < 1 || number > 1000) {
      throw new Error('Invalid PIN directory page.');
    }
    try {
      const result = await repository.directoryPage(guildId, number, PAGE_SIZE);
      const results = [];
      for (const row of result.results) {
        const pin = await protector.reveal(row.protectedPin);
        if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw new Error('Invalid PIN.');
        results.push(Object.freeze({ userId: row.userId, playerName: row.playerName, pin }));
      }
      return Object.freeze({
        page: result.page, pageSize: result.pageSize, total: result.total, results: Object.freeze(results)
      });
    } catch {
      // Repository and crypto exceptions can contain protected material.
      throw new Error('The PIN directory could not be loaded. Contact staff.');
    }
  }

  return Object.freeze({
    staff: Object.freeze({
      async page({ page: number = 1, context } = {}) {
        authorization.authorize('pins.moderate', context);
        if (!guildId || !channelId || !staffRoleId || context?.guildId !== guildId
          || context.channelId !== channelId || !context.roleIds?.includes(staffRoleId)) {
          throw new Error('This PIN directory operation is not authorized.');
        }
        return page(number);
      }
    }),
    // Internal lifecycle capability, kept separate from the user-triggered reader.
    // The Discord adapter must verify the configured private destination before using it.
    restoration: Object.freeze({ page })
  });
}

module.exports = { createPinDirectoryService, PAGE_SIZE };
