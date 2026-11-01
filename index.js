require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { createDinoFulfillmentFeature } = require('./features/dino-fulfillment-panel');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ]
});

const db = new sqlite3.Database('./database.sqlite');
const dashboardState = { pinsPage: 0, ticketLogsPage: 0 };
const PINS_PER_PAGE = 25;
const TICKET_LOGS_PER_PAGE = 15;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

const dinoFulfillment = createDinoFulfillmentFeature({ client, run, get, all });

async function addColumnIfMissing(table, columnDefinition) {
  const columnName = columnDefinition.split(/\s+/)[0];
  const columns = await all(`PRAGMA table_info(${table})`);
  if (!columns.some(column => column.name === columnName)) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition}`);
  }
}


const SHOP_CATALOG_PATH = path.join(__dirname, 'data', 'shop-catalog.csv');
const SHOP_ALIASES = {
  argy: 'argentavis', anky: 'anky', carcha: 'carhcarodontosaurus',
  giga: 'giganotosaurus', theri: 'therizinosaur',
  thyla: 'thylacoleo', tuso: 'tusoteuthis', yuty: 'yutyrannus'
};

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function normalizeShopText(value = '') {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function nullableInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function importShopCatalog() {
  if (!fs.existsSync(SHOP_CATALOG_PATH)) {
    throw new Error(`Shop catalog not found: ${SHOP_CATALOG_PATH}`);
  }
  const text = fs.readFileSync(SHOP_CATALOG_PATH, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error('Shop catalog is empty.');
  const headers = parseCsvLine(lines[0]);
  const records = lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, values[i] ?? '']));
  });
  await run('BEGIN IMMEDIATE TRANSACTION');
  try {
    await run('DELETE FROM shop_catalog');
    for (const row of records) {
      const searchable = normalizeShopText([
        row.PackageName, row.Dino1Blueprint, row.Dino2Blueprint, row.IncludedItems
      ].filter(Boolean).join(' '));
      await run(
        `INSERT INTO shop_catalog
         (package_name, normalized_name, searchable_text, entry_cost,
          dino_1_level, dino_1_gender, dino_1_blueprint,
          dino_2_level, dino_2_gender, dino_2_blueprint, included_items)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.PackageName, normalizeShopText(row.PackageName), searchable,
         nullableInt(row.EntryCost), nullableInt(row.Dino1Level),
         nullableInt(row.Dino1GenderIndex), row.Dino1Blueprint || null,
         nullableInt(row.Dino2Level), nullableInt(row.Dino2GenderIndex),
         row.Dino2Blueprint || null, row.IncludedItems || null]
      );
    }
    await run('COMMIT');
    return records.length;
  } catch (error) {
    await run('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function searchShop(query, limit = 10) {
  const normalized = normalizeShopText(query);
  const aliased = SHOP_ALIASES[normalized] || normalized;
  const like = `%${aliased}%`;
  return all(
    `SELECT * FROM shop_catalog
     WHERE normalized_name LIKE ? OR searchable_text LIKE ?
     ORDER BY CASE WHEN normalized_name = ? THEN 0
                   WHEN normalized_name LIKE ? THEN 1 ELSE 2 END,
              package_name COLLATE NOCASE
     LIMIT ?`,
    [like, like, aliased, `${aliased}%`, limit]
  );
}

function genderLabel(value) {
  if (value === null || value === undefined) return 'Not specified';
  if (value === 0) return 'Gender 0';
  if (value === 1) return 'Gender 1';
  return `Gender ${value}`;
}

function shortBlueprint(value) {
  if (!value) return 'None';
  const tail = value.split('/').pop() || value;
  return tail.split('.')[0].replace(/_Character_BP.*$/i, '').replace(/^PrimalItemArmor_/, '');
}

function formatShopResult(row) {
  const dinos = [];
  if (row.dino_1_blueprint) dinos.push(`${shortBlueprint(row.dino_1_blueprint)} - Level ${row.dino_1_level ?? 'N/A'} - ${genderLabel(row.dino_1_gender)}`);
  if (row.dino_2_blueprint) dinos.push(`${shortBlueprint(row.dino_2_blueprint)} - Level ${row.dino_2_level ?? 'N/A'} - ${genderLabel(row.dino_2_gender)}`);
  const items = row.included_items
    ? row.included_items.split(' | ').map(shortBlueprint).join(', ')
    : 'None';
  return `**${row.package_name}**\n` +
    `Cost: ${row.entry_cost ?? 'N/A'} points\n` +
    `Dinos:\n${dinos.length ? dinos.map(d => `- ${d}`).join('\n') : '- None'}\n` +
    `Included items: ${items}\n\nPress **F1** in-game to open the shop.`;
}

async function replyWithShopSearch(interaction, query) {
  const results = await searchShop(query, 5);
  if (!results.length) {
    return interaction.reply({
      content: `No in-game shop package matched **${query}**. You may open a support request if needed.`,
      ephemeral: true
    });
  }
  return interaction.reply({
    content: results.map(formatShopResult).join('\n\n'),
    ephemeral: true
  });
}

async function initializeDatabase() {
  await dinoFulfillment.initializeDatabase();

  await run(`
    CREATE TABLE IF NOT EXISTS pins (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      pin TEXT,
      created_at TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS player_names (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      ingame_name TEXT,
      updated_at TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS tickets (
      channel_id TEXT PRIMARY KEY,
      user_id TEXT,
      status TEXT,
      created_at TEXT,
      closed_at TEXT
    )
  `);

  await addColumnIfMissing('tickets', 'ticket_number INTEGER');
  await addColumnIfMissing('tickets', 'requester_username TEXT');
  await addColumnIfMissing('tickets', 'completed_at TEXT');
  await addColumnIfMissing('tickets', 'completed_by TEXT');
  await addColumnIfMissing('tickets', 'completed_by_username TEXT');
  await addColumnIfMissing('tickets', 'closed_by TEXT');
  await addColumnIfMissing('tickets', 'closed_by_username TEXT');

  await run(`
    CREATE TABLE IF NOT EXISTS panels (
      panel_name TEXT PRIMARY KEY,
      message_id TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS counters (
      counter_name TEXT PRIMARY KEY,
      counter_value INTEGER NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ticket_logs (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number INTEGER,
      channel_id TEXT,
      user_id TEXT,
      requester_username TEXT,
      action TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_username TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS shop_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      searchable_text TEXT NOT NULL,
      entry_cost INTEGER,
      dino_1_level INTEGER,
      dino_1_gender INTEGER,
      dino_1_blueprint TEXT,
      dino_2_level INTEGER,
      dino_2_gender INTEGER,
      dino_2_blueprint TEXT,
      included_items TEXT
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_shop_normalized_name ON shop_catalog(normalized_name)`);
  await run(
    `INSERT OR IGNORE INTO counters (counter_name, counter_value)
     VALUES ('ticket_number', 0)`
  );

  const maxTicket = await get(
    `SELECT COALESCE(MAX(ticket_number), 0) AS max_number FROM tickets`
  );

  await run(
    `UPDATE counters
     SET counter_value = MAX(counter_value, ?)
     WHERE counter_name = 'ticket_number'`,
    [maxTicket.max_number]
  );

  // Give any legacy tickets a sequential number without changing their status.
  const legacyTickets = await all(`
    SELECT channel_id
    FROM tickets
    WHERE ticket_number IS NULL
    ORDER BY created_at, channel_id
  `);

  for (const legacyTicket of legacyTickets) {
    const number = await nextTicketNumber();
    await run(
      `UPDATE tickets
       SET ticket_number = ?
       WHERE channel_id = ?`,
      [number, legacyTicket.channel_id]
    );
  }
}

function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function isStaff(member) {
  return Boolean(member?.roles?.cache?.has(process.env.STAFF_ROLE_ID));
}

function isMember(member) {
  return Boolean(member?.roles?.cache?.has(process.env.MEMBER_ROLE_ID));
}

function sanitizeChannelName(name) {
  const safe = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || 'player';
}

function ticketLabel(number) {
  return String(number).padStart(4, '0');
}

async function nextTicketNumber() {
  await run('BEGIN IMMEDIATE TRANSACTION');
  try {
    await run(
      `UPDATE counters
       SET counter_value = counter_value + 1
       WHERE counter_name = 'ticket_number'`
    );
    const row = await get(
      `SELECT counter_value
       FROM counters
       WHERE counter_name = 'ticket_number'`
    );
    await run('COMMIT');
    return row.counter_value;
  } catch (error) {
    await run('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function recordTicketLog(ticket, action, actor) {
  await run(
    `INSERT INTO ticket_logs
     (ticket_number, channel_id, user_id, requester_username,
      action, actor_id, actor_username, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ticket.ticket_number,
      ticket.channel_id,
      ticket.user_id,
      ticket.requester_username,
      action,
      actor.id,
      actor.username,
      new Date().toISOString()
    ]
  );
}

function ticketButtons(disableCompleted = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('complete_ticket')
      .setLabel('Ticket Completed')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disableCompleted),
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger)
  );
}

async function generateMissingPins(guild) {
  const members = await guild.members.fetch();
  let created = 0;
  let existing = 0;
  let skippedBots = 0;
  let skippedNoRole = 0;

  for (const [, member] of members) {
    if (member.user.bot) {
      skippedBots++;
      continue;
    }

    if (!isMember(member) && !isStaff(member)) {
      skippedNoRole++;
      continue;
    }

    const existingPin = await get(
      'SELECT user_id FROM pins WHERE user_id = ?',
      [member.id]
    );

    if (existingPin) {
      existing++;
      continue;
    }

    await run(
      `INSERT INTO pins (user_id, username, pin, created_at)
       VALUES (?, ?, ?, ?)`,
      [
        member.id,
        member.user.username,
        generatePin(),
        new Date().toISOString()
      ]
    );
    created++;
  }

  return { created, existing, skippedBots, skippedNoRole };
}

async function buildPinsDashboard() {
  const rows = await all(`
    SELECT
      pins.username,
      pins.pin,
      player_names.ingame_name
    FROM pins
    LEFT JOIN player_names
      ON pins.user_id = player_names.user_id
    ORDER BY pins.username COLLATE NOCASE
  `);

  const pageCount = Math.max(1, Math.ceil(rows.length / PINS_PER_PAGE));
  dashboardState.pinsPage = Math.min(
    Math.max(dashboardState.pinsPage, 0),
    pageCount - 1
  );

  const start = dashboardState.pinsPage * PINS_PER_PAGE;
  const pageRows = rows.slice(start, start + PINS_PER_PAGE);
  const body = pageRows.length
    ? pageRows
      .map(row =>
        `${row.username} | ${row.ingame_name || 'Not Set'} | ${row.pin}`
      )
      .join('\n')
    : 'No PINs have been generated yet.';

  const content =
    `**Vault PIN Dashboard**\n` +
    `Discord | In-game name | PIN\n` +
    `Page ${dashboardState.pinsPage + 1} of ${pageCount} ` +
    `(${rows.length} total)\n\n` +
    `\`\`\`\n${body}\n\`\`\``;

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('pins_previous')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(dashboardState.pinsPage === 0),
    new ButtonBuilder()
      .setCustomId('pins_refresh')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('pins_next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(dashboardState.pinsPage >= pageCount - 1),
    new ButtonBuilder()
      .setCustomId('pins_generate_missing')
      .setLabel('Generate Missing PINs')
      .setStyle(ButtonStyle.Success)
  );

  return { content, components: [controls] };
}

async function buildTicketLogsDashboard() {
  const countRow = await get(
    'SELECT COUNT(*) AS total FROM ticket_logs'
  );
  const total = countRow.total;
  const pageCount = Math.max(
    1,
    Math.ceil(total / TICKET_LOGS_PER_PAGE)
  );

  dashboardState.ticketLogsPage = Math.min(
    Math.max(dashboardState.ticketLogsPage, 0),
    pageCount - 1
  );

  const offset =
    dashboardState.ticketLogsPage * TICKET_LOGS_PER_PAGE;

  const rows = await all(
    `SELECT *
     FROM ticket_logs
     ORDER BY log_id DESC
     LIMIT ? OFFSET ?`,
    [TICKET_LOGS_PER_PAGE, offset]
  );

  const body = rows.length
    ? rows.map(row => {
      const stamp =
        `<t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:F>`;
      return `#${ticketLabel(row.ticket_number || 0)} | ${row.action} | ` +
        `${row.requester_username || row.user_id} | ` +
        `by ${row.actor_username} | ${stamp}`;
    }).join('\n')
    : 'No ticket activity has been recorded yet.';

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_logs_previous')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(dashboardState.ticketLogsPage === 0),
    new ButtonBuilder()
      .setCustomId('ticket_logs_refresh')
      .setLabel('Refresh Logs')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ticket_logs_next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(
        dashboardState.ticketLogsPage >= pageCount - 1
      )
  );

  return {
    content:
      `**Ticket Logs Dashboard**\n` +
      `Page ${dashboardState.ticketLogsPage + 1} of ${pageCount} ` +
      `(${total} total events)\n\n${body}`,
    components: [controls]
  };
}

async function ensurePanel(panelName, channel, payloadBuilder) {
  const saved = await get(
    'SELECT message_id FROM panels WHERE panel_name = ?',
    [panelName]
  );

  let message = null;
  if (saved) {
    try {
      message = await channel.messages.fetch(saved.message_id);
    } catch {}
  }

  const payload = await payloadBuilder();

  if (!message) {
    message = await channel.send(payload);
    await run(
      `INSERT OR REPLACE INTO panels (panel_name, message_id)
       VALUES (?, ?)`,
      [panelName, message.id]
    );
    console.log(`Created ${panelName} panel`);
  } else {
    await message.edit(payload);
  }

  return message;
}

async function refreshPinsDashboard() {
  const channel = await client.channels.fetch(
    process.env.PINS_DASHBOARD_CHANNEL_ID
  );
  return ensurePanel('pins_dashboard', channel, buildPinsDashboard);
}

async function refreshTicketLogsDashboard() {
  const channel = await client.channels.fetch(
    process.env.TICKET_LOGS_CHANNEL_ID
  );
  return ensurePanel(
    'ticket_logs_dashboard',
    channel,
    buildTicketLogsDashboard
  );
}

async function refreshStandardPanels() {
  const vaultChannel = await client.channels.fetch(
    process.env.VAULT_CHANNEL_ID
  );
  const requestChannel = await client.channels.fetch(
    process.env.REQUESTS_CHANNEL_ID
  );
  const ignChannel = await client.channels.fetch(
    process.env.IGN_CHANNEL_ID
  );

  const pinButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('vault_pin')
      .setLabel('Get My Vault PIN')
      .setStyle(ButtonStyle.Primary)
  );

  const requestButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('search_shop')
      .setLabel('Search In-Game Shop')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('open_request')
      .setLabel('Open Request')
      .setStyle(ButtonStyle.Success)
  );

  const ignButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('set_ign')
      .setLabel('Set My In-Game Name')
      .setStyle(ButtonStyle.Secondary)
  );

  await ensurePanel('vault', vaultChannel, async () => ({
    content: 'Click below to view or receive your Vault PIN.',
    components: [pinButton]
  }));

  await ensurePanel('request', requestChannel, async () => ({
    content: 'Search the in-game F1 shop before creating a support request.\n\n**DLC creature requests:** You may request an official DLC creature, but if you do not own the required DLC, the game may prevent you from using the creature or some of its abilities.',
    components: [requestButton]
  }));

  await ensurePanel('ign', ignChannel, async () => ({
    content: 'Click below to set or update your in-game name.',
    components: [ignButton]
  }));
}

async function refreshAllPanels() {
  await Promise.all([
    dinoFulfillment.refreshPanel(),
    refreshStandardPanels(),
    refreshPinsDashboard(),
    refreshTicketLogsDashboard()
  ]);
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    await initializeDatabase();
    const imported = await importShopCatalog();
    console.log(`Imported ${imported} shop packages.`);
    await refreshAllPanels();
  } catch (error) {
    console.error('Startup initialization failed:', error);
  }

  setInterval(() => {
    refreshAllPanels().catch(error =>
      console.error('Panel refresh failed:', error)
    );
  }, 60000);
});

client.on('interactionCreate', async interaction => {
  try {
    if (await dinoFulfillment.handleInteraction(interaction)) return;
    if (interaction.isAutocomplete() && interaction.commandName === 'shop-search') {
      const focused = interaction.options.getFocused();
      const results = await searchShop(focused, 25);
      return interaction.respond(results.map(row => ({
        name: `${row.package_name} - ${row.entry_cost ?? 'N/A'} points`.slice(0, 100),
        value: row.package_name.slice(0, 100)
      })));
    }
    if (interaction.isModalSubmit() && interaction.customId === 'shop_search_modal') {
      const query = interaction.fields.getTextInputValue('shop_query').trim();
      return replyWithShopSearch(interaction, query);
    }
    if (
      interaction.isModalSubmit() &&
      interaction.customId === 'ign_modal'
    ) {
      const ign = interaction.fields
        .getTextInputValue('ingame_name')
        .trim();

      if (ign.length < 1 || ign.length > 32) {
        return interaction.reply({
          content: 'In-game names must be between 1 and 32 characters.',
          ephemeral: true
        });
      }

      await run(
        `INSERT INTO player_names
         (user_id, username, ingame_name, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           username = excluded.username,
           ingame_name = excluded.ingame_name,
           updated_at = excluded.updated_at`,
        [
          interaction.user.id,
          interaction.user.username,
          ign,
          new Date().toISOString()
        ]
      );

      await refreshPinsDashboard();
      return interaction.reply({
        content: `In-game name updated to: ${ign}`,
        ephemeral: true
      });
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'search_shop') {
        const modal = new ModalBuilder()
          .setCustomId('shop_search_modal')
          .setTitle('Search In-Game Shop');
        const queryInput = new TextInputBuilder()
          .setCustomId('shop_query')
          .setLabel('Tame or package name')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(100)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
        return interaction.showModal(modal);
      }
      if (interaction.customId === 'set_ign') {
        const modal = new ModalBuilder()
          .setCustomId('ign_modal')
          .setTitle('Set In-Game Name');

        const ignInput = new TextInputBuilder()
          .setCustomId('ingame_name')
          .setLabel('In-Game Name')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(32)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(ignInput)
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === 'vault_pin') {
        const row = await get(
          `SELECT
             pins.username,
             pins.pin,
             player_names.ingame_name
           FROM pins
           LEFT JOIN player_names
             ON pins.user_id = player_names.user_id
           WHERE pins.user_id = ?`,
          [interaction.user.id]
        );

        if (row) {
          return interaction.reply({
            content:
              `Discord: ${row.username}\n` +
              `In-game name: ${row.ingame_name || 'Not Set'}\n` +
              `Vault PIN: ${row.pin}`,
            ephemeral: true
          });
        }

        const pin = generatePin();
        await run(
          `INSERT INTO pins (user_id, username, pin, created_at)
           VALUES (?, ?, ?, ?)`,
          [
            interaction.user.id,
            interaction.user.username,
            pin,
            new Date().toISOString()
          ]
        );

        const nameRow = await get(
          'SELECT ingame_name FROM player_names WHERE user_id = ?',
          [interaction.user.id]
        );
        await refreshPinsDashboard();

        return interaction.reply({
          content:
            `Discord: ${interaction.user.username}\n` +
            `In-game name: ${nameRow?.ingame_name || 'Not Set'}\n` +
            `Vault PIN: ${pin}`,
          ephemeral: true
        });
      }

      if (interaction.customId === 'open_request') {
        const activeTicket = await get(
          `SELECT channel_id FROM tickets
           WHERE user_id = ? AND status = 'OPEN'`,
          [interaction.user.id]
        );

        if (activeTicket) {
          return interaction.reply({
            content: `You already have an open request: <#${activeTicket.channel_id}>`,
            ephemeral: true
          });
        }

        await interaction.deferReply({ ephemeral: true });
        const number = await nextTicketNumber();
        const channelName =
          `${sanitizeChannelName(interaction.user.username)}-${ticketLabel(number)}`;

        const channel = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: process.env.CATEGORY_ID,
          permissionOverwrites: [
            {
              id: interaction.guild.id,
              deny: [PermissionsBitField.Flags.ViewChannel]
            },
            {
              id: interaction.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
              ]
            },
            {
              id: process.env.STAFF_ROLE_ID,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
              ]
            }
          ]
        });

        const now = new Date().toISOString();
        await run(
          `INSERT INTO tickets
           (channel_id, user_id, status, created_at, closed_at,
            ticket_number, requester_username, completed_at,
            completed_by, completed_by_username, closed_by,
            closed_by_username)
           VALUES (?, ?, 'OPEN', ?, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL)`,
          [
            channel.id,
            interaction.user.id,
            now,
            number,
            interaction.user.username
          ]
        );

        await channel.send({
          content:
            `<@${interaction.user.id}> <@&${process.env.STAFF_ROLE_ID}>\n` +
            `Ticket #${ticketLabel(number)} has been opened. ` +
            `Please describe your request here.\n\n` +
            `**DLC notice:** If your request involves a DLC creature, confirm that you own the required DLC. Delivery does not guarantee access to DLC-restricted abilities.`,
          components: [ticketButtons(false)],
          allowedMentions: {
            users: [interaction.user.id],
            roles: [process.env.STAFF_ROLE_ID]
          }
        });

        return interaction.editReply({
          content: `Ticket created: ${channel}`
        });
      }

      if (interaction.customId === 'complete_ticket') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: 'Only staff can mark a ticket completed.',
            ephemeral: true
          });
        }

        // Acknowledge immediately so Discord does not time out while the
        // database, dashboard, message, and log channel are updated.
        await interaction.deferReply({ ephemeral: true });

        const ticket = await get(
          'SELECT * FROM tickets WHERE channel_id = ?',
          [interaction.channel.id]
        );

        if (!ticket) {
          return interaction.editReply({
            content: 'This channel is not a tracked ticket.'
          });
        }

        if (ticket.status !== 'OPEN') {
          return interaction.editReply({
            content: 'This ticket is already completed or closed.'
          });
        }

        const now = new Date().toISOString();
        await run(
          `UPDATE tickets
           SET status = 'COMPLETED',
               completed_at = ?,
               completed_by = ?,
               completed_by_username = ?
           WHERE channel_id = ?`,
          [
            now,
            interaction.user.id,
            interaction.user.username,
            interaction.channel.id
          ]
        );

        const updated = { ...ticket, completed_at: now };
        await recordTicketLog(updated, 'COMPLETED', interaction.user);
        await interaction.message.edit({
          components: [ticketButtons(true)]
        }).catch(() => {});

        await refreshTicketLogsDashboard();

        await interaction.channel.send({
          content:
            `<@${ticket.user_id}>, ticket #${ticketLabel(ticket.ticket_number)} ` +
            `has been fulfilled by <@${interaction.user.id}>. ` +
            `You may close it now, or leave it visible for up to 30 days.`,
          allowedMentions: {
            users: [...new Set([
              ticket.user_id,
              interaction.user.id
            ])]
          }
        });

        return interaction.editReply({
          content:
            `Ticket #${ticketLabel(ticket.ticket_number)} marked completed ` +
            `and logged successfully.`
        });
      }

      if (interaction.customId === 'close_ticket') {
        const ticket = await get(
          'SELECT * FROM tickets WHERE channel_id = ?',
          [interaction.channel.id]
        );

        if (!ticket) {
          return interaction.reply({
            content: 'This channel is not a tracked ticket.',
            ephemeral: true
          });
        }

        const canClose =
          interaction.user.id === ticket.user_id ||
          isStaff(interaction.member) ||
          (
            isMember(interaction.member) &&
            interaction.channel.permissionsFor(interaction.member)
              ?.has(PermissionsBitField.Flags.ViewChannel)
          );

        if (!canClose) {
          return interaction.reply({
            content: 'You are not allowed to close this ticket.',
            ephemeral: true
          });
        }

        if (ticket.status === 'CLOSED') {
          return interaction.reply({
            content: 'This ticket is already closed.',
            ephemeral: true
          });
        }

        await interaction.deferReply({ ephemeral: true });
        const now = new Date().toISOString();
        await run(
          `UPDATE tickets
           SET status = 'CLOSED',
               closed_at = ?,
               closed_by = ?,
               closed_by_username = ?
           WHERE channel_id = ?`,
          [
            now,
            interaction.user.id,
            interaction.user.username,
            interaction.channel.id
          ]
        );

        await recordTicketLog(ticket, 'CLOSED', interaction.user);
        await interaction.channel.permissionOverwrites.delete(
          ticket.user_id
        ).catch(() => {});

        await interaction.channel.setName(
          `closed-${ticketLabel(ticket.ticket_number)}-${sanitizeChannelName(ticket.requester_username || 'player')}`
        ).catch(() => {});

        await interaction.message.edit({ components: [] }).catch(() => {});
        await refreshTicketLogsDashboard();

        return interaction.editReply({
          content:
            `Ticket #${ticketLabel(ticket.ticket_number)} closed. ` +
            `It remains staff-visible until automatic deletion.`
        });
      }

      if (
        ['pins_previous', 'pins_next', 'pins_refresh', 'pins_generate_missing']
          .includes(interaction.customId)
      ) {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: 'Staff only.',
            ephemeral: true
          });
        }

        await interaction.deferReply({ ephemeral: true });

        if (interaction.customId === 'pins_previous') {
          dashboardState.pinsPage--;
        } else if (interaction.customId === 'pins_next') {
          dashboardState.pinsPage++;
        } else if (interaction.customId === 'pins_generate_missing') {
          const result = await generateMissingPins(interaction.guild);
          await refreshPinsDashboard();
          return interaction.editReply({
            content:
              `PIN generation complete.\n\n` +
              `Created: ${result.created}\n` +
              `Existing: ${result.existing}\n` +
              `Skipped bots: ${result.skippedBots}\n` +
              `Skipped without Member/Staff role: ${result.skippedNoRole}`
          });
        }

        await refreshPinsDashboard();
        return interaction.editReply({ content: 'Dashboard refreshed.' });
      }

      if (
        [
          'ticket_logs_previous',
          'ticket_logs_refresh',
          'ticket_logs_next'
        ].includes(interaction.customId)
      ) {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: 'Staff only.',
            ephemeral: true
          });
        }

        await interaction.deferReply({ ephemeral: true });

        if (interaction.customId === 'ticket_logs_previous') {
          dashboardState.ticketLogsPage--;
        } else if (interaction.customId === 'ticket_logs_next') {
          dashboardState.ticketLogsPage++;
        }

        await refreshTicketLogsDashboard();
        return interaction.editReply({
          content: 'Ticket logs refreshed.'
        });
      }
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'shop-search') {
        const query = interaction.options.getString('query', true);
        return replyWithShopSearch(interaction, query);
      }
      if (interaction.commandName === 'shop-refresh') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: 'Staff only.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        const imported = await importShopCatalog();
        return interaction.editReply({ content: `Reloaded ${imported} shop packages.` });
      }
      if (interaction.commandName === 'updatebot') {
        if (interaction.user.id !== process.env.OWNER_ID) {
          return interaction.reply({
            content: 'Owner only.',
            ephemeral: true
          });
        }

        await interaction.reply({
          content: 'Updating bot...',
          ephemeral: true
        });

        const updateScript = process.env.UPDATE_SCRIPT_PATH;

        if (!updateScript) {
          return interaction.reply({
            content: 'Automated updates are not configured.',
            ephemeral: true
          });
        }

        exec(
          updateScript,
          (error, stdout, stderr) => {
            if (error) {
              return interaction.followUp({
                content:
                  `Update failed:\n\`\`\`\n${stderr || error.message}\n\`\`\``,
                ephemeral: true
              }).catch(() => {});
            }

            return interaction.followUp({
              content:
                `Update started successfully.\n\`\`\`\n${stdout}\n\`\`\``,
              ephemeral: true
            }).catch(() => {});
          }
        );
        return;
      }

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: 'Staff only.',
          ephemeral: true
        });
      }

      if (interaction.commandName === 'viewpins') {
        const rows = await all(`
          SELECT
            pins.username,
            pins.pin,
            player_names.ingame_name
          FROM pins
          LEFT JOIN player_names
            ON pins.user_id = player_names.user_id
          ORDER BY pins.username COLLATE NOCASE
        `);

        const text = rows.length
          ? rows.map(row =>
            `${row.username} | ${row.ingame_name || 'Not Set'} | ${row.pin}`
          ).join('\n')
          : 'No pins found.';

        return interaction.reply({
          content: `\`\`\`\n${text.slice(0, 1900)}\n\`\`\``,
          ephemeral: true
        });
      }

      if (interaction.commandName === 'getpin') {
        const user = interaction.options.getUser('user');
        const row = await get(
          `SELECT
             pins.username,
             pins.pin,
             player_names.ingame_name
           FROM pins
           LEFT JOIN player_names
             ON pins.user_id = player_names.user_id
           WHERE pins.user_id = ?`,
          [user.id]
        );

        if (!row) {
          return interaction.reply({
            content: 'No PIN found.',
            ephemeral: true
          });
        }

        return interaction.reply({
          content:
            `Discord: ${row.username}\n` +
            `In-game name: ${row.ingame_name || 'Not Set'}\n` +
            `Vault PIN: ${row.pin}`,
          ephemeral: true
        });
      }

      if (interaction.commandName === 'resetpin') {
        const user = interaction.options.getUser('user');
        const pin = generatePin();
        await run(
          `INSERT OR REPLACE INTO pins
           (user_id, username, pin, created_at)
           VALUES (?, ?, ?, ?)`,
          [
            user.id,
            user.username,
            pin,
            new Date().toISOString()
          ]
        );
        await refreshPinsDashboard();
        return interaction.reply({
          content: `${user.username} new PIN: ${pin}`,
          ephemeral: true
        });
      }

      if (interaction.commandName === 'generateallpins') {
        await interaction.deferReply({ ephemeral: true });
        const result = await generateMissingPins(interaction.guild);
        await refreshPinsDashboard();
        return interaction.editReply({
          content:
            `PIN generation complete.\n\n` +
            `Created: ${result.created}\n` +
            `Existing: ${result.existing}\n` +
            `Skipped bots: ${result.skippedBots}\n` +
            `Skipped without Member/Staff role: ${result.skippedNoRole}`
        });
      }
    }
  } catch (error) {
    console.error('Interaction failed:', error);
    const message = 'The bot could not complete that action. Check the logs.';
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral: true })
        .catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true })
        .catch(() => {});
    }
  }
});

cron.schedule('0 0 * * *', async () => {
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const tickets = await all(`
    SELECT * FROM tickets
    WHERE status IN ('COMPLETED', 'CLOSED')
  `).catch(error => {
    console.error('Ticket cleanup query failed:', error);
    return [];
  });

  for (const ticket of tickets) {
    const retentionStart = ticket.completed_at || ticket.closed_at;
    if (!retentionStart || new Date(retentionStart).getTime() >= cutoff) {
      continue;
    }

    try {
      const channel = await client.channels.fetch(ticket.channel_id);
      if (channel) await channel.delete('30-day ticket retention expired');
    } catch {}

    await run('DELETE FROM tickets WHERE channel_id = ?', [ticket.channel_id])
      .catch(error => console.error('Ticket cleanup delete failed:', error));
  }
});

client.login(process.env.DISCORD_TOKEN);
