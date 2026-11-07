'use strict';
class ConfigurationError extends Error {
  constructor(issues) {
    const list = Array.isArray(issues) ? issues : [String(issues)];
    super(`Configuration validation failed (${list.length} issue${list.length === 1 ? '' : 's'}).`);
    this.name = 'ConfigurationError';
    this.code = 'CONFIGURATION_INVALID';
    this.issues = Object.freeze([...list]);
  }
}
module.exports = { ConfigurationError };
