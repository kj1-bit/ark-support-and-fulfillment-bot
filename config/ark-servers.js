function envPort(variableName, fallback) {
  const value = Number.parseInt(
    process.env[variableName] || String(fallback),
    10
  );

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(
      `Invalid RCON port in environment variable ${variableName}.`
    );
  }

  return value;
}

const DEFAULT_HOST =
  process.env.ARK_RCON_HOST || '127.0.0.1';

/*
 * Example server definitions
 *
 * Copy, remove, rename, enable, or disable entries to match your cluster.
 *
 * Required fields:
 * - id: unique internal identifier
 * - name: display name shown in Discord
 * - host: RCON host name or IP address
 * - port: RCON TCP port
 * - passwordEnv: environment variable containing the RCON password
 * - enabled: whether Ticketbot scans and uses this server
 *
 * Optional fields:
 * - testOnly: marks an entry as a test server
 */
const arkServers = [
  {
    id: 'example-map-1',
    name: 'Example Map 1',
    host: DEFAULT_HOST,
    port: envPort('ARK_RCON_PORT_1', 27020),
    passwordEnv: 'ARK_RCON_PASSWORD',
    enabled: true
  },
  {
    id: 'example-map-2',
    name: 'Example Map 2',
    host: DEFAULT_HOST,
    port: envPort('ARK_RCON_PORT_2', 27021),
    passwordEnv: 'ARK_RCON_PASSWORD',
    enabled: false
  },
  {
    id: 'example-test-server',
    name: 'Example Test Server',
    host: DEFAULT_HOST,
    port: envPort('ARK_TEST_RCON_PORT', 27030),
    passwordEnv: 'ARK_TEST_RCON_PASSWORD',
    enabled: false,
    testOnly: true
  }
];

function getEnabledArkServers() {
  return arkServers.filter(server => server.enabled);
}

module.exports = {
  arkServers,
  getEnabledArkServers
};
