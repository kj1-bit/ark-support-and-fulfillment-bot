const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDinoFulfillmentFeature, logPanelPayload } = require('../features/dino-fulfillment-panel');

const root = path.resolve(__dirname, '..');
const panelSource = fs.readFileSync(path.join(root, 'features', 'dino-fulfillment-panel.js'), 'utf8');

const empty = logPanelPayload([], 0);
assert(empty.embeds[0].toJSON().description.includes('No dino fulfillments'));
assert.strictEqual(empty.components[0].components.length, 3);

const logs = Array.from({ length: 7 }, (_, index) => ({
  id: 7 - index,
  moderator_username: 'Moderator',
  creature_name: 'Pyromane',
  character_name: `Player ${7 - index}`,
  server_name: 'Test Map',
  status: index === 1 ? 'FAILED' : 'SUCCESS',
  created_at: '2026-10-31T18:30:00.000Z'
}));

const firstPage = logPanelPayload(logs.slice(0, 5), logs.length, 0);
const firstPageJson = firstPage.embeds[0].toJSON();
assert(firstPageJson.description.includes('Page 1 of 2 | 7 logs'));
assert(firstPageJson.description.includes('#7 | SUCCESS | Moderator | Pyromane | Player 7 | Test Map |'));
assert(firstPageJson.description.includes('#3 | SUCCESS | Moderator | Pyromane | Player 3 | Test Map |'));
assert(!firstPageJson.description.includes('#2 | FAILED'));
assert.strictEqual(firstPage.components[0].components[0].toJSON().disabled, true);
assert.strictEqual(firstPage.components[0].components[2].toJSON().disabled, false);

const failedPage = logPanelPayload([{ ...logs[1], status: 'FAILED' }], 1, 0);
const failedDescription = failedPage.embeds[0].toJSON().description;
assert(failedDescription.includes('#6 | FAILED | Moderator | Pyromane | Player 6 | Test Map |'));
assert(!failedDescription.includes('attempted to spawn'));
assert(!failedDescription.includes('spawned'));
assert(!failedDescription.includes('Stored in SQLite'));
assert(failedDescription.includes('<t:'));
assert(failedDescription.includes(':F>'));
assert(JSON.stringify(firstPage).includes('dino_logs_previous'));
assert(JSON.stringify(firstPage).includes('dino_logs_refresh'));
assert(JSON.stringify(firstPage).includes('dino_logs_next'));
assert(panelSource.includes('SELECT COUNT(*) AS total FROM dino_fulfillment_logs'));
assert(panelSource.includes('ORDER BY id DESC LIMIT ? OFFSET ?'));
assert(!panelSource.includes('sendFulfillmentLog('));
assert(!panelSource.includes('function fulfillmentLogPayload('));

async function testNavigationEditsPersistentPanelSilently() {
  process.env.DINO_FULFILLMENT_ROLE_ID = 'moderator-role';
  process.env.DINO_FULFILLMENT_LOG_CHANNEL_ID = 'log-channel';
  let editedPayload;
  const savedMessage = {
    id: 'persistent-panel',
    async edit(payload) {
      editedPayload = payload;
    }
  };
  const client = {
    channels: {
      async fetch() {
        return { messages: { fetch: async () => savedMessage } };
      }
    }
  };
  const get = async query => {
    if (query.includes('SELECT message_id FROM panels')) {
      return { message_id: savedMessage.id };
    }
    if (query.includes('SELECT COUNT(*) AS total FROM dino_fulfillment_logs')) {
      return { total: logs.length };
    }
    throw new Error(`Unexpected single-row query: ${query}`);
  };
  const all = async (query, params = []) => {
    if (query.includes('FROM dino_fulfillment_logs ORDER BY id DESC')) {
      return logs.slice(params[1], params[1] + params[0]);
    }
    throw new Error(`Unexpected multi-row query: ${query}`);
  };
  const feature = createDinoFulfillmentFeature({ client, get, all, run: async () => {} });

  async function click(customId) {
    let deferUpdateCount = 0;
    const interaction = {
      customId,
      member: { roles: { cache: { has: role => role === 'moderator-role' } } },
      isButton: () => true,
      async deferUpdate() {
        deferUpdateCount++;
      },
      async deferReply() {
        throw new Error('Log navigation must not create an ephemeral reply.');
      },
      async reply() {
        throw new Error('Log navigation must not send a reply.');
      },
      async editReply() {
        throw new Error('Log navigation must not send a follow-up message.');
      }
    };

    assert.strictEqual(await feature.handleInteraction(interaction), true);
    assert.strictEqual(deferUpdateCount, 1);
    assert.strictEqual(editedPayload.embeds[0].toJSON().description.includes('Page 2 of 2'), customId !== 'dino_logs_previous');
    assert.strictEqual(editedPayload.components[0].components.length, 3);
  }

  await click('dino_logs_next');
  assert(editedPayload.embeds[0].toJSON().description.includes('#2 | SUCCESS | Moderator | Pyromane | Player 2 | Test Map |'));
  await click('dino_logs_refresh');
  assert(editedPayload.embeds[0].toJSON().description.includes('Page 2 of 2'));
  await click('dino_logs_previous');
  assert(editedPayload.embeds[0].toJSON().description.includes('Page 1 of 2'));
  assert(editedPayload.embeds[0].toJSON().description.includes('#7 | SUCCESS | Moderator | Pyromane | Player 7 | Test Map |'));
}

testNavigationEditsPersistentPanelSilently()
  .then(() => console.log('Dino fulfillment log dashboard test passed.'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
