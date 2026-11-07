require('dotenv').config();

const {
  SlashCommandBuilder,
  REST,
  Routes
} = require('discord.js');

const commands = [

  new SlashCommandBuilder()
    .setName('viewpins')
    .setDescription('View all vault pins'),

  new SlashCommandBuilder()
    .setName('getpin')
    .setDescription('View a users pin')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('resetpin')
    .setDescription('Reset a users pin')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('generateallpins')
    .setDescription(
      'Generate pins for member role users missing a pin'
    ),

  new SlashCommandBuilder()
    .setName('shop-search')
    .setDescription('Search the in-game shop')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('Tame or package name')
        .setRequired(true)
        .setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName('shop-refresh')
    .setDescription('Reload the shop catalog from CSV')

].map(command => command.toJSON());


const rest = new REST({ version: '10' })
  .setToken(process.env.DISCORD_TOKEN);

(async () => {

  try {

    console.log('Deploying commands...');

    await rest.put(
      Routes.applicationCommands(
        process.env.CLIENT_ID
      ),
      { body: commands }
    );

    console.log(
      'Commands deployed successfully.'
    );

  } catch (error) {

    console.error(error);

  }

})();
