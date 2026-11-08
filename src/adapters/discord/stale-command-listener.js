'use strict';

const { ephemeral, isChatInput, respond } = require('./interaction-protocol');

const STALE_COMMAND_MESSAGE = 'This command has been replaced by the server panels. Use the buttons in the server channels instead.';

// V2 registers no slash commands; a stale client may still invoke a retired one until Discord drops it.
function registerStaleCommandListener(client, logSink = async () => {}) {
  const listener = async interaction => {
    if (!isChatInput(interaction) || interaction.replied || interaction.deferred) return;
    try {
      await respond(interaction, ephemeral(STALE_COMMAND_MESSAGE));
    } catch {
      console.error('Retired command response could not be sent.');
    }
    try {
      await logSink(Object.freeze({ type: 'discord.command.retired', at: new Date().toISOString(),
        data: Object.freeze({ command: String(interaction.commandName || '').slice(0, 32) }) }));
    } catch {
      console.error('Retired command event could not be logged.');
    }
  };
  client.on('interactionCreate', listener);
  return () => { if (typeof client.off === 'function') client.off('interactionCreate', listener); };
}

module.exports = { STALE_COMMAND_MESSAGE, registerStaleCommandListener };
