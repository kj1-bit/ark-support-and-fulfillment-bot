'use strict';

const { resolveRetentionPolicy } = require('../config/retention-policy');

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const REQUIRED = [
  'expirePinRequests', 'clearTerminalPinMaterial', 'purgePinRequests', 'purgeSessions',
  'purgeClosedTickets', 'purgeOperationalEvents', 'expireFulfillmentRequests',
  'recoverInterruptedFulfillment', 'anonymizeFulfillmentIdentity', 'purgeFulfillmentRequests'
];

function createRetentionService({
  repository,
  policy: policyOverrides,
  audit,
  clock = Date.now,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) {
  for (const method of REQUIRED) {
    if (!repository || typeof repository[method] !== 'function') {
      throw new TypeError(`repository.${method} is required.`);
    }
  }
  if (!audit || typeof audit.write !== 'function') throw new TypeError('audit.write is required.');
  const policy = resolveRetentionPolicy(policyOverrides);
  let timer = null;
  let running = null;

  async function execute() {
    const now = clock();
    const counts = {};
    const failures = [];
    const steps = [
      // Counter names avoid the substring "pin" because audit redaction masks such keys.
      ['accessCodesExpired', () => repository.expirePinRequests(now)],
      ['accessCodesCleared', () => repository.clearTerminalPinMaterial(now)],
      ['accessCodesPurged', () => repository.purgePinRequests(now - policy.completedPinDays * DAY_MS)],
      ['sessionsPurged', () => repository.purgeSessions(now - policy.sessionGraceHours * 60 * MINUTE_MS)],
      ['ticketsPurged', () => repository.purgeClosedTickets(now - policy.closedTicketDays * DAY_MS)],
      ['eventsPurged', () => repository.purgeOperationalEvents(now - policy.operationalEventDays * DAY_MS)],
      ['fulfillmentExpired', () => repository.expireFulfillmentRequests(now)],
      ['fulfillmentAnonymized', () => repository.anonymizeFulfillmentIdentity(now - policy.fulfillmentIdentityDays * DAY_MS)],
      ['fulfillmentPurged', () => repository.purgeFulfillmentRequests(now - policy.fulfillmentAuditDays * DAY_MS)]
    ];
    for (const [name, step] of steps) {
      try {
        counts[name] = await step();
      } catch {
        counts[name] = 0;
        failures.push(name);
      }
    }
    const summary = Object.freeze({ ...counts, failures: Object.freeze(failures) });
    audit.write(failures.length ? 'retention.failed' : 'retention.completed', summary);
    return summary;
  }

  const service = {
    policy,

    runOnce() {
      if (!running) running = execute().finally(() => { running = null; });
      return running;
    },

    async recoverInterrupted() {
      const recovered = await repository.recoverInterruptedFulfillment(clock());
      audit.write('retention.recovered', recovered);
      return recovered;
    },

    start() {
      if (timer) return;
      timer = setIntervalFn(() => { void service.runOnce().catch(() => {}); }, policy.intervalMinutes * MINUTE_MS);
      if (typeof timer?.unref === 'function') timer.unref();
    },

    async stop() {
      if (timer) clearIntervalFn(timer);
      timer = null;
      if (running) await running.catch(() => {});
    }
  };
  return Object.freeze(service);
}

module.exports = { createRetentionService };
