'use strict';

const crypto = require('node:crypto');
const { safeInteractionMessage } = require('./safe-response');
const { ephemeral, isButton, isChatInput, isStringSelect, isModal } = require('./interaction-protocol');

const FLOW_TTL_MS = 120000;
const MAX_FLOWS = 500;
const ACTIONS = new Set(['confirm', 'cancel', 'select', 'link', 'creature', 'previous', 'next',
  'search', 'query', 'online', 'server', 'member', 'back', 'close']);

function parseCustomId(value) {
  const parts = String(value || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v2' || parts[1] !== 'fulfillment'
    || !ACTIONS.has(parts[2]) || !parts[3]) return null;
  return Object.freeze({ action: parts[2], token: parts[3] });
}

function createDiscordRouter({ controller, views, logSink, uuid = crypto.randomUUID, config = {},
  panelMatches = () => false, playerPanelMatches = () => false,
  handleFulfillment = true, handlePlayerLink = true }) {
  if (!controller || !views || typeof logSink !== 'function') {
    throw new TypeError('controller, views, and logSink are required.');
  }
  const flows = new Map();
  const issuedTokens = new Set();
  function cleanFlows() {
    for (const [id, flow] of flows) if (flow.expiresAt <= Date.now()) flows.delete(id);
    while (flows.size >= MAX_FLOWS) flows.delete(flows.keys().next().value);
  }
  function store(interaction, data) {
    cleanFlows();
    const token = uuid();
    issuedTokens.add(token);
    while (issuedTokens.size > MAX_FLOWS) issuedTokens.delete(issuedTokens.values().next().value);
    flows.set(token, { actorId: interaction.user.id, guildId: interaction.guildId,
      channelId: interaction.channelId, ...data, expiresAt: Date.now() + FLOW_TTL_MS });
    return token;
  }
  function resolve(interaction, token) {
    const flow = flows.get(token);
    if (!flow || flow.expiresAt <= Date.now() || flow.actorId !== interaction.user.id
      || flow.guildId !== interaction.guildId || flow.channelId !== interaction.channelId
      || (flow.stage !== 'query-start' && (!flow.messageId || flow.messageId !== interaction.message?.id))) {
      throw new Error('This selection flow is invalid or expired.');
    }
    controller.authorize?.(interaction, flow.linking || flow.verifying ? 'player-names.verify' : 'fulfillment.confirm');
    if (flow.catalogVersion && flow.catalogVersion !== controller.catalog().version) {
      throw new Error('Catalog version changed. Start a new catalog selection.');
    }
    return flow;
  }
  async function render(interaction, data, view) {
    const token = store(interaction, data);
    try {
      const message = await interaction.editReply(view(token));
      const messageId = message?.id || (await interaction.fetchReply()).id;
      if (!messageId) throw new Error('A private wizard message is required.');
      flows.get(token).messageId = messageId;
      return message;
    } catch (error) {
      flows.delete(token);
      throw error;
    }
  }
  function allowedServers(linking = false) {
    return (config.ark?.servers || []).filter(server => server.enabled === true
      && server.operations?.includes('listOnlinePlayers')
      && (linking || server.operations.includes('fulfillApprovedCreature')));
  }
  async function showCatalog(interaction, data = {}) {
    const result = await controller.search({ query: data.query || '', page: data.page || 1 });
    return render(interaction, { stage: 'catalog', query: result.query, page: result.page,
      catalogVersion: result.catalogVersion, creatureIds: result.results.map(item => item.id) },
    token => views.catalogView(result, token));
  }
  async function showPlayers(interaction, data) {
    const result = controller.scanPage ? await controller.scanPage(interaction,
      { serverId: data.serverId, ttlMs: FLOW_TTL_MS, linking: data.linking === true, page: data.playerPage || 1 })
      : { players: await (data.linking ? controller.scanCandidates : controller.scan)(interaction,
        { serverId: data.serverId, ttlMs: FLOW_TTL_MS }), page: 1, pageSize: 25 };
    const players = result.players;
    return render(interaction, { ...data, stage: 'players', playerPage: result.page,
      playerTotal: result.total ?? players.length, playerRefs: players.map(player => player.playerRef) },
      token => views.playerSelectionView({
        content: data.linking ? 'Select the observed online identity for the selected Discord member.'
          : 'Select a verified online player.',
        customId: `v2:fulfillment:${data.linking ? 'link' : 'select'}:${token}`,
        players, token, linking: data.linking, showBack: data.wizard === true,
        page: result.page, total: result.total ?? players.length, pageSize: result.pageSize
      }));
  }
  async function showMaps(interaction, data) {
    const servers = allowedServers(data.linking);
    const page = Math.min(Math.max(1, data.serverPage || 1), Math.max(1, Math.ceil(servers.length / 25)));
    return render(interaction, { ...data, stage: 'server', serverPage: page, serverTotal: servers.length,
      serverIds: servers.slice((page - 1) * 25, page * 25).map(server => server.id) },
    id => views.serverSelectionView(servers, id, data.linking, page));
  }
  async function beginFulfillment(interaction) {
    await interaction.deferReply({ flags: 64 });
    return showPlayers(interaction, { serverId: interaction.options.getString('server', true),
      creatureId: interaction.options.getString('creature', true) });
  }
  async function beginPlayerLink(interaction) {
    await interaction.deferReply({ flags: 64 });
    return showPlayers(interaction, { serverId: interaction.options.getString('server', true),
      discordId: interaction.options.getUser('user', true).id, linking: true });
  }
  async function beginPanel(interaction) {
    if (handleFulfillment && ['v2:fulfillment:browse', 'v2:fulfillment:search'].includes(interaction.customId)) {
      if (!panelMatches(interaction)) return false;
      controller.authorize(interaction);
      if (interaction.customId.endsWith(':search')) {
        const token = store(interaction, { stage: 'query-start' });
        return interaction.showModal(views.catalogSearchModal(token));
      }
      await interaction.deferReply({ flags: 64 });
      return showCatalog(interaction);
    }
    if (handlePlayerLink && ['v2:player-name:verify', 'v2:player-name:link'].includes(interaction.customId)) {
      if (!playerPanelMatches(interaction)) return false;
      controller.authorize(interaction, 'player-names.verify');
      const linking = interaction.customId.endsWith(':link');
      await interaction.deferReply({ flags: 64 });
      return render(interaction, { stage: 'member', linking, verifying: !linking, wizard: true },
        token => views.memberSelectionView(token, linking));
    }
    return false;
  }
  async function handleFlow(interaction, parsed) {
    const { action, token } = parsed;
    const flow = resolve(interaction, token);
    if (action === 'search' && isButton(interaction) && flow.stage === 'catalog') {
      flows.delete(token);
      const modalToken = store(interaction, { ...flow, stage: 'query' });
      return interaction.showModal(views.catalogSearchModal(modalToken));
    }
    if (action === 'query' && isModal(interaction) && ['query', 'query-start'].includes(flow.stage)) {
      flows.delete(token);
      if (flow.stage === 'query-start') await interaction.deferReply({ flags: 64 });
      else await interaction.deferUpdate();
      return showCatalog(interaction, { query: interaction.fields.getTextInputValue('query') });
    }
    if (action === 'close' && isButton(interaction)) {
      flows.delete(token);
      await interaction.deferUpdate();
      return interaction.editReply({ content: 'Selection canceled.', components: [], embeds: [] });
    }
    if (action === 'back' && isButton(interaction) && !flow.linking && flow.wizard) {
      flows.delete(token);
      await interaction.deferUpdate();
      return showCatalog(interaction, flow);
    }
    if (['previous', 'next'].includes(action) && isButton(interaction) && flow.stage === 'catalog') {
      flows.delete(token);
      await interaction.deferUpdate();
      return showCatalog(interaction, { ...flow, page: action === 'next' ? flow.page + 1 : Math.max(1, flow.page - 1) });
    }
    if (['previous', 'next'].includes(action) && isButton(interaction)
      && ['server', 'players'].includes(flow.stage)) {
      const page = flow.stage === 'server' ? flow.serverPage : flow.playerPage;
      const total = flow.stage === 'server' ? flow.serverTotal : flow.playerTotal;
      const lastPage = Math.max(1, Math.ceil(total / 25));
      const nextPage = Math.min(lastPage, Math.max(1, page + (action === 'next' ? 1 : -1)));
      flows.delete(token);
      await interaction.deferUpdate();
      return flow.stage === 'server' ? showMaps(interaction, { ...flow, serverPage: nextPage })
        : showPlayers(interaction, { ...flow, playerPage: nextPage });
    }
    const value = interaction.values?.[0];
    if (action === 'creature' && isStringSelect(interaction) && flow.stage === 'catalog') {
      if (!flow.creatureIds.includes(value)) throw new Error('Select a creature from the displayed catalog.');
      flows.delete(token);
      await interaction.deferUpdate();
      const creature = controller.catalog().get(value);
      return render(interaction, { ...flow, stage: 'creature', creatureId: value, wizard: true },
        id => views.creatureView(creature, id));
    }
    if (action === 'online' && isButton(interaction) && flow.stage === 'creature') {
      flows.delete(token);
      await interaction.deferUpdate();
      return showMaps(interaction, { ...flow, serverPage: 1 });
    }
    if (action === 'member' && interaction.isUserSelectMenu?.() && flow.stage === 'member') {
      if (!/^[1-9][0-9]{16,19}$/.test(value || '')) throw new Error('Select a Discord member.');
      flows.delete(token);
      await interaction.deferUpdate();
      if (flow.verifying) {
        await controller.verify(interaction, { discordId: value });
        return interaction.editReply({ content: 'Player name verified. Use Link Online Player to associate a trusted online identity.',
          components: [], embeds: [] });
      }
      return showMaps(interaction, { ...flow, discordId: value, serverPage: 1 });
    }
    if (action === 'server' && isStringSelect(interaction) && flow.stage === 'server') {
      if (!flow.serverIds.includes(value) || !allowedServers(flow.linking).some(server => server.id === value)) {
        throw new Error('Select an enabled, allowlisted map.');
      }
      flows.delete(token);
      await interaction.deferUpdate();
      return showPlayers(interaction, { ...flow, serverId: value, playerPage: 1 });
    }
    if (['select', 'link'].includes(action) && isStringSelect(interaction) && flow.stage === 'players') {
      if (Boolean(flow.linking) !== (action === 'link') || !flow.playerRefs.includes(value)) {
        throw new Error('Select an online player from this scan.');
      }
      flows.delete(token);
      await interaction.deferUpdate();
      if (flow.linking) {
        const linked = await controller.associate(interaction, {
          playerRef: value, discordId: flow.discordId, serverId: flow.serverId
        });
        return interaction.editReply({ content: `Verified trusted identity for ${linked.displayName}.`, components: [] });
      }
      const model = await controller.begin(interaction, {
        serverId: flow.serverId, creatureId: flow.creatureId, playerRef: value,
        ...(flow.catalogVersion ? { catalogVersion: flow.catalogVersion } : {}),
        ttlMs: FLOW_TTL_MS, idempotencyKey: uuid()
      });
      return interaction.editReply(views.confirmationView(model));
    }
    return false;
  }
  return Object.freeze({
    async handle(interaction) {
      cleanFlows();
      try {
        if (handleFulfillment && isChatInput(interaction) && interaction.commandName === 'dino-fulfillment') {
          return await beginFulfillment(interaction);
        }
        if (handlePlayerLink && isChatInput(interaction) && interaction.commandName === 'player-link') {
          return await beginPlayerLink(interaction);
        }
        if (isButton(interaction) && ['v2:fulfillment:browse', 'v2:fulfillment:search',
          'v2:player-name:verify', 'v2:player-name:link'].includes(interaction.customId)) return await beginPanel(interaction);
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return false;
        if (isButton(interaction) && ['confirm', 'cancel'].includes(parsed.action) && handleFulfillment) {
          await interaction.deferUpdate();
          const result = await controller[parsed.action](interaction, parsed);
          if (parsed.action === 'confirm') await logSink(controller.moderatorLog(result, interaction.logDetails || {}));
          return interaction.editReply(views.resultView(result));
        }
        if (!flows.has(parsed.token)) {
          if (issuedTokens.has(parsed.token) || (isStringSelect(interaction) && ((handleFulfillment && parsed.action === 'select')
            || (handlePlayerLink && parsed.action === 'link')))) {
            throw new Error('This selection flow is invalid or expired.');
          }
          return false;
        }
        return await handleFlow(interaction, parsed);
      } catch (error) {
        const payload = ephemeral(safeInteractionMessage(error));
        if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
        return interaction.reply(payload);
      }
    },
    stop() { flows.clear(); issuedTokens.clear(); }
  });
}
module.exports = { createDiscordRouter, parseCustomId };
