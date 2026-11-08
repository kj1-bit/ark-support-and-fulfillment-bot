'use strict';

const ERROR_CODES = Object.freeze({
  AUTHORIZATION_CONFIG_INVALID: 'AUTHORIZATION_CONFIG_INVALID',
  AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
  INTERACTION_CONTEXT_INVALID: 'INTERACTION_CONTEXT_INVALID',
  INTERACTION_EXPIRED: 'INTERACTION_EXPIRED',
  INTERACTION_REPLAYED: 'INTERACTION_REPLAYED'
});

class SafeApplicationError extends Error {
  constructor(code, publicMessage, options = {}) {
    super(publicMessage);
    this.name = 'SafeApplicationError';
    this.code = code;
    this.publicMessage = publicMessage;
    Object.defineProperty(this, 'cause', {
      value: options.cause,
      enumerable: false,
      writable: false,
      configurable: false
    });
    Object.freeze(this);
  }
}

function safeError(code, publicMessage, options) {
  if (!Object.values(ERROR_CODES).includes(code)) throw new TypeError('Unknown safe error code.');
  return new SafeApplicationError(code, publicMessage, options);
}

module.exports = { ERROR_CODES, SafeApplicationError, safeError };
