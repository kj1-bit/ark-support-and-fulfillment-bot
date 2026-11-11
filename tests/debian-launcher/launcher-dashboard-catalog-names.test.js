'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLauncherOptions } = require('../../scripts/start-v2');
const { startV2 } = require('../../src/composition/start-v2');
const { loadInitialCatalog } = require('../../src/composition/load-initial-catalog');
const { createDashboardsFeature } = require('../../src/features/dashboards-feature');
const { createPlayerNamesFeature } = require('../../src/features/player-names-feature');
const { createPinProtector } = require('../../src/security/pin-protector');
const { createPinService } = require('../../src/domain/pins/pin-service');
const { privatePinChannel } = require('../helpers/private-pin-channel');

const id = n => `100000000000000${n.toString().padStart(2,'0')}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const lines = payload => payload.embeds[0].description.replace(/<t:\d+:R>/g, '<t:N:R>').split('\n\n');

function fakeDiscord(config) {
  const client = new EventEmitter();
  client.user = { id:id(90) };
  client.isReady = () => true;
  const sent = [];
  const channels = new Map(['ticketLogs','pinsDashboard','fulfillmentLogs','playerNames'].filter(key => config.discord.channels[key]).map(key => {
    const channelId = config.discord.channels[key];
    const messages = new Map();
    return [channelId, {
      ...privatePinChannel({ channelId, guildId:config.discord.guildId, staffRoleId:config.discord.roles.staff }),
      messages:{ fetch:async messageId => {
        if (!messages.has(messageId)) throw Object.assign(new Error('Unknown Message'), { code:10008 });
        return messages.get(messageId);
      } },
      send:async payload => {
        const message = { id:`${channelId}-${sent.length}`, channelId, payload, author:client.user,
          edit:async body => { message.payload = body; } };
        sent.push(message);
        messages.set(message.id, message);
        return message;
      }
    }];
  }));
  client.channels = { fetch:async channelId => channels.get(channelId) };
  return { client, sent, channels };
}

test('launcher service facade renders active catalog names on the fulfillment panel, paging and refresh', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketbot-v2-dashboard-names-'));
  const configPath = path.join(root, 'instance.json');
  const catalogPath = path.resolve(__dirname, '../../data/dino-catalog.json');
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion:1,
    runtime:{ mode:'mock', environment:'dashboard-names-test', logLevel:'error' },
    discord:{
      clientId:id(10), guildId:id(1), tokenSecret:'DISCORD_TOKEN',
      roles:{ staff:id(2), member:null, fulfillmentModerator:null },
      channels:{ ticketCategory:null, vault:null, requests:null, playerNames:null,
        pinsDashboard:id(4), ticketLogs:id(3), fulfillment:null, fulfillmentLogs:id(5) }
    },
    ark:{ timeoutMs:1000, servers:[{ id:'test-map', name:'Test Map', host:'127.0.0.1', port:27020,
      passwordSecret:'ARK_SECRET', enabled:true, testOnly:true, operations:['listOnlinePlayers'] }] },
    storage:{ databasePath:'runtime/database.sqlite', backupPath:'runtime/backups' },
    features:{ tickets:false, pins:false, playerNames:false, shop:false, fulfillment:false, dashboards:true }
  }));

  let services;
  const options = createLauncherOptions({
    sourceRoot:root, configPath, catalogPath, env:{ DISCORD_TOKEN:'not-a-real-token' }, write:() => {}
  });

  await t.test('real launcher exposes request queue and renamed linked identity to persistent panels', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketbot-v2-name-queue-'));
    const configPath = path.join(root,'instance.json');
    const key = Buffer.alloc(32,9).toString('base64');
    fs.writeFileSync(configPath,JSON.stringify({
      schemaVersion:1, runtime:{ mode:'mock',environment:'queue-test',logLevel:'error' },
      discord:{ clientId:id(10),guildId:id(1),tokenSecret:'DISCORD_TOKEN',
        roles:{ staff:id(2),member:id(9),fulfillmentModerator:null },
        channels:{ ticketCategory:null,vault:id(8),requests:null,playerNames:id(6),
          pinsDashboard:id(4),ticketLogs:id(3),fulfillment:null,fulfillmentLogs:id(5) } },
      ark:{ timeoutMs:1000,servers:[{ id:'test-map',name:'Test Map',host:'127.0.0.1',port:27020,
        passwordSecret:'ARK_SECRET',enabled:true,testOnly:true,operations:['listOnlinePlayers'] }] },
      storage:{ databasePath:'runtime/db.sqlite',backupPath:'runtime/backups' },
      features:{ tickets:false,pins:true,playerNames:true,shop:false,fulfillment:false,dashboards:true }
    }));
    let services;
    const options = createLauncherOptions({ sourceRoot:root,configPath,
      catalogPath:path.resolve(__dirname,'../../data/dino-catalog.json'),
      env:{ DISCORD_TOKEN:'fixture',PIN_PROTECTION_KEY:key },write:() => {} });
    const service = await startV2({ ...options,createDiscordAdapter:async input => {
      services = input.services;
      return { start:async () => {},stop:async () => {} };
    } });
    const discord = fakeDiscord(service.config);
    const context = { client:discord.client,config:service.config,logSink:async () => {},services };
    const names = createPlayerNamesFeature(), dashboards = createDashboardsFeature();
    t.after(async () => { await names.stop(context); await dashboards.stop(context); await service.stop();
      fs.rmSync(root,{ recursive:true,force:true }); });
    await services.playerNames.submit({ discordId:id(11),playerName:'Mock Test Player' });
    const request = await services.playerNames.submit({ discordId:id(12),playerName:'Original Name' });
    await services.playerLinks.link({ discordId:id(12),eosId:'a'.repeat(32),displayName:'Original Name',
      source:'manual',actorId:id(2),request });
    await service.runtime.rememberedPlayers.remember({ eosId:'a'.repeat(32),displayName:'Renamed Player',
      serverId:'test-map',lastSeenAt:123 });
    await service.runtime.vaultPinRepository.insertIfAbsent({ guildId:id(1),userId:id(12),
      protectedPin:await createPinProtector({ key }).protect('1234'),source:'SELF_SERVICE',createdAt:1,updatedAt:1 });
    await names.initialize(context); await names.register(context); await names.start(context);
    await dashboards.initialize(context); await dashboards.register(context); await dashboards.start(context);
    const staff = await services.dashboardPanels.get('player-name-requests');
    const panel = discord.sent.find(message => message.id === staff.messageId);
    assert.match(panel.payload.embeds[0].description,/Mock Test Player/);
    assert(!panel.payload.embeds[0].description.includes('Original Name'));
    const pins = await services.dashboardPanels.get('pins');
    const directory = discord.sent.find(message => message.id === pins.messageId);
    assert.match(directory.payload.embeds[0].description,/Renamed Player/);
    assert(!JSON.stringify(directory.payload).includes('1234'));
    await services.onlinePlayers.observe('test-map');
    let response;
    const invoke = async (customId, kind = 'button', values = [], extra = {}) => {
      const input = { customId,values,user:{ id:id(7) },guildId:id(1),channelId:id(4),
        member:{ roleIds:[id(2)] },message:{ id:customId === 'v2:name-requests:link' ? staff.messageId : id(80) },
        isButton:() => kind === 'button',isStringSelectMenu:() => kind === 'select',
        isModalSubmit:() => kind === 'modal',isUserSelectMenu:() => false,
        deferReply:async () => { input.deferred = true; },deferUpdate:async () => { input.deferred = true; },
        editReply:async body => { response = body; return { id:id(80) }; },
        fetchReply:async () => ({ id:id(80) }),
        reply:async body => { response = body; },followUp:async body => { response = body; },
        ...extra };
      for (const listener of discord.client.listeners('interactionCreate')) await listener(input);
      return response;
    };
    const component = (body,text) => body.components.flatMap(row => row.components)
      .find(item => item.label === text || item.placeholder === text);
    let body = await invoke('v2:name-requests:link');
    const requests = component(body,'Select a request');
    assert.equal(requests.options[0].value,id(11));
    for (const extra of [{ user:{ id:id(8) } },{ guildId:id(8) },{ channelId:id(8) },
      { message:{ id:id(8) } },{ member:{ roleIds:[] } }]) {
      const denied = await invoke(requests.custom_id,'select',[id(11)],extra);
      assert.equal(denied.flags,64);
      assert.equal((await services.playerNames.get(id(11))).status,'PENDING');
    }
    body = await invoke(requests.custom_id,'select',[id(11)]);
    const candidates = component(body,'Select a remembered player');
    assert.equal(candidates.options[0].label,'Mock Test Player');
    body = await invoke(candidates.custom_id,'select',[candidates.options[0].value]);
    assert.match(body.content,/Review link/);
    assert.equal((await services.playerNames.get(id(11))).status,'PENDING');
    assert(!body.content.includes('a'.repeat(32)));
    body = await invoke(component(body,'Confirm Link').custom_id);
    assert.match(body.content,/Linked in-game identity/);
    assert.equal((await services.playerNames.get(id(11))).status,'VERIFIED');
    let delivered = false;
    await services.vaultPins.deliverOwn({ context:{ actorId:id(11),guildId:id(1),channelId:id(8),roleIds:[id(9)] },
      deliver:async pin => { delivered = /^\d{4}$/.test(pin); return true; } });
    assert(delivered);
    const pinRequests = createPinService({ repository:service.runtime.pinRepository,playerNames:services.playerNames,
      authorization:services.authorization,protector:createPinProtector({ key }),audit:services.audit,uuid:() => 'fixture' });
    const pinRequest = await pinRequests.request({ context:{ actorId:id(11),guildId:id(1),channelId:id(8) },pin:'5820' });
    assert.equal(pinRequest.state,'PENDING');
    for (let attempt = 0; attempt < 50 && !panel.payload.embeds[0].description.includes('No player name requests'); attempt++) {
      await sleep(10);
    }
    assert.match(panel.payload.embeds[0].description,/No player name requests/);
    assert.equal((await invoke('v2:player-name:verify')).content,
      'These controls are retired. Staff must use the player name requests panel.');
  });
  const service = await startV2({
    ...options,
    createDiscordAdapter:async input => {
      services = input.services;
      return { start:async () => {}, stop:async () => {} };
    }
  });
  const discord = fakeDiscord(service.config);
  const context = { client:discord.client, config:service.config, logSink:async () => {}, services };
  const feature = createDashboardsFeature();
  t.after(async () => {
    await feature.stop(context);
    await service.stop();
    fs.rmSync(root, { recursive:true, force:true });
  });

  const record = async creatureId => {
    await service.runtime.operationalEvents.record('fulfillment.succeeded',
      { actorId:id(7), playerName:'Mud', ...(creatureId ? { creatureId } : {}) });
    await sleep(3);
  };
  await record('rex');
  await record('removedcreature');
  await record(null);
  for (let i = 0; i < 8; i += 1) await record('achatina');

  await feature.initialize(context);
  await feature.register(context);
  await feature.start(context);

  const panel = discord.sent.find(message => message.channelId === id(5));
  assert.equal(panel.payload.embeds[0].title, 'Dino Fulfillment Logs \u00b7 page 1');
  const achatina = `<@${id(7)}> spawned Achatina for Mud \u00b7 <t:N:R>`;
  assert.deepEqual(lines(panel.payload), [
    ...Array(8).fill(achatina),
    `<@${id(7)}> spawned Unknown creature for Mud \u00b7 <t:N:R>`,
    `<@${id(7)}> spawned removedcreature for Mud \u00b7 <t:N:R>`
  ]);
  assert.deepEqual(panel.payload.allowedMentions, { parse:[] });

  const press = async (action, page) => {
    let body;
    const listeners = discord.client.listeners('interactionCreate');
    await Promise.all(listeners.map(listener => listener({
      customId:`v2:dashboard:fulfillment:${action}:${page}`, isButton:() => true,
      user:{ id:id(6) }, guildId:id(1), channelId:id(5), channel:discord.channels.get(id(5)),
      message:{ id:panel.id }, member:{ roleIds:[id(2)] },
      deferUpdate:async () => {}, editReply:async payload => { body = payload; },
      reply:async () => assert.fail('Authorized paging must edit inline.'),
      followUp:async () => assert.fail('Authorized paging must not fail.')
    })));
    return body;
  };

  const next = await press('next', 2);
  assert.equal(next.embeds[0].title, 'Dino Fulfillment Logs \u00b7 page 2');
  assert.deepEqual(lines(next), [`<@${id(7)}> spawned Rex for Mud \u00b7 <t:N:R>`]);

  const source = loadInitialCatalog(catalogPath);
  await services.catalogManager.activate(await services.catalogManager.propose({
    version:'2026.9.9-dashboard-names',
    creatures:source.creatures.map(item => item.id === 'achatina' ? { ...item, name:'Achatina Prime' } : item)
  }));
  const refreshed = await press('refresh', 1);
  assert.equal(refreshed.embeds[0].title, 'Dino Fulfillment Logs \u00b7 page 1');
  assert.equal(lines(refreshed)[0], `<@${id(7)}> spawned Achatina Prime for Mud \u00b7 <t:N:R>`);
  assert(!refreshed.embeds[0].description.includes('spawned achatina '));
});
