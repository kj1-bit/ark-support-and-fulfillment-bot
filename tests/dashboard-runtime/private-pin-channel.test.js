'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits, OverwriteType } = require('discord.js');
const { requirePrivatePinChannel, fetchPrivatePinChannel } = require('../../src/adapters/discord/staff-pin-channel');
const { pinPagePayload } = require('../../src/features/dashboards-feature');
const { privatePinChannel } = require('../helpers/private-pin-channel');
const { assertUniqueCustomIds } = require('../helpers/custom-ids');

const config = { discord:{ guildId:'10000000000000001',roles:{ staff:'10000000000000002' },
  channels:{ pinsDashboard:'10000000000000003' } } };
const context = { config };
function channel() {
  return privatePinChannel({
    channelId:config.discord.channels.pinsDashboard,guildId:config.discord.guildId,staffRoleId:config.discord.roles.staff
  });
}

test('PIN channel verification fails closed for wrong guild/channel, missing permission data and role exposure', async () => {
  for (const bad of [null, { ...channel(),id:'wrong' }, { ...channel(),guildId:'wrong' },
    { ...channel(),permissionOverwrites:null }, { ...channel(),permissionsFor:() => null }]) {
    await assert.rejects(() => requirePrivatePinChannel(bad,context));
  }
  const c = channel();
  await requirePrivatePinChannel(c,context);
  c.guild.roles.cache.set('ordinary',{ id:'ordinary',permissions:{ has:() => false } });
  c.permissionsFor = item => ({ has:() => item.id === 'ordinary' });
  await assert.rejects(() => requirePrivatePinChannel(c,context),/staff-only/);
  c.permissionsFor = () => ({ has:() => false });
  c.guild.roles.cache.delete(config.discord.roles.staff);
  await assert.rejects(() => requirePrivatePinChannel(c,context),/could not be verified/);
});

test('member-specific overwrite exposure is rejected even when every ordinary role is private', async () => {
  const c = channel();
  c.permissionOverwrites.cache.set('player',{ id:'player',type:OverwriteType.Member });
  const player = { id:'player',user:{ bot:false },roles:{ cache:new Set() },permissions:{ has:() => false } };
  c.members.set('player',player);
  c.permissionsFor = item => ({ has:() => item.id === 'player' });
  await assert.rejects(() => requirePrivatePinChannel(c,context),/staff-only/);
  c.permissionsFor = () => ({ has:() => false });
  await requirePrivatePinChannel(c,context);
  c.members.clear();
  await assert.rejects(() => requirePrivatePinChannel(c,context),/could not be verified/);
});

test('only Unknown Member is ignored for departed overwrite targets; transport and permission failures stay closed', async () => {
  const c = channel();
  c.permissionOverwrites.cache.set('departed',{ id:'departed',type:OverwriteType.Member });
  c.guild.members.fetch = async () => { throw Object.assign(new Error('Unknown Member'),{ code:10007 }); };
  await requirePrivatePinChannel(c,context);
  for (const code of [50001,50013,'ECONNRESET']) {
    c.guild.members.fetch = async () => { throw Object.assign(new Error('Failed to verify member'),{ code }); };
    await assert.rejects(() => requirePrivatePinChannel(c,context),error => error.code === code);
  }
});

test('staff/admin/bot member overwrites are permitted but booster roles are not exempt', async () => {
  const c = channel();
  c.permissionOverwrites.cache.set('member',{ id:'member',type:OverwriteType.Member });
  const member = { id:'member',user:{ bot:false },roles:{ cache:new Set([config.discord.roles.staff]) },
    permissions:{ has:() => false } };
  c.members.set('member',member);
  c.permissionsFor = item => ({ has:() => item.id === 'member' });
  await requirePrivatePinChannel(c,context);
  member.roles.cache.clear();
  member.permissions.has = bit => bit === PermissionFlagsBits.Administrator;
  await requirePrivatePinChannel(c,context);
  member.permissions.has = () => false;
  member.user.bot = true;
  await requirePrivatePinChannel(c,context);
  c.guild.roles.cache.set('booster',{ id:'booster',managed:true,tags:{ premiumSubscriberRole:true },permissions:{ has:() => false } });
  c.permissionsFor = item => ({ has:() => item.id === 'booster' });
  await assert.rejects(() => requirePrivatePinChannel(c,context),/staff-only/);
});

test('private destination is fetched fresh, not trusted from the interaction cache', async () => {
  let fetched = false;
  const c = channel();
  assert.equal(await fetchPrivatePinChannel({ config,client:{ channels:{ fetch:async (id,options) => {
    assert.equal(id,c.id); assert.equal(options.force,true); fetched = true; return c;
  } } } }),c);
  assert(fetched);
});

test('directory escapes hostile names, hides PINs, and offers only paging, private reveal and generation', () => {
  const panel = { key:'pins',title:'PIN activity' };
  const name = '**spoof** [link](https://bad.invalid) @everyone <@123> `code`\nnext';
  for (const page of [1,2,3]) {
    const body = pinPagePayload(panel,{
      page,pageSize:10,total:23,
      results:Array.from({ length:10 },(_,index) => ({
        userId:`100000000000001${String(index).padStart(2,'0')}`,playerName:name,pin:'5820'
      }))
    });

    const description = body.embeds[0].description;
    assert(description.includes('\\*\\*spoof\\*\\*'));
    assert(!description.includes('@everyone'));
    assert(description.includes('\\[link]('));
    assert(!description.includes('<@123>'));
    assert(description.includes('Vault PIN: hidden'));
    assert(!JSON.stringify(body).includes('5820'));
    assert.equal(body.embeds[0].footer, undefined);
    assert(description.length <= 4096);
    assert.deepEqual(body.allowedMentions,{ parse:[] });
    const ids = assertUniqueCustomIds(body);
    assert.equal(ids.length,4);
    assert(ids.includes(`v2:dashboard:pins:directory-reveal:${page}`));
    assert(!JSON.stringify(body).includes('PIN Activity'));
  }
  const empty = pinPagePayload(panel,{ page:1,pageSize:10,total:0,results:[] });
  assert.match(empty.embeds[0].description,/No generated/);
  assert.equal(empty.components[0].components.length,2);
});

test('directory identifies linked and unlinked players without pinging', () => {
  const body = pinPagePayload({ key:'pins' }, {
    page:1,pageSize:10,total:2,results:[
      { userId:'10000000000000001',playerName:'Old name',linkedPlayerName:'New *name*',pin:'1234' },
      { userId:'10000000000000002',playerName:'Submitted name',linkedPlayerName:null,pin:'5678' }
    ]
  });
  assert.equal(body.embeds[0].description,
    '<@10000000000000001> \u00b7 In-game name: **New \\*name\\***\nVault PIN: hidden\n\n' +
    '<@10000000000000002> \u00b7 Not linked \u00b7 said: **Submitted name**\nVault PIN: hidden');
  assert.deepEqual(body.allowedMentions,{ parse:[] });
  assert(!JSON.stringify(body).includes('1234'));
});
