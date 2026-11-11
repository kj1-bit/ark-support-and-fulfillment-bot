'use strict';

function createPlayerObserver({ onlinePlayers, servers, audit, setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  const targets = servers.filter(server => server.enabled === true && server.operations?.includes('listOnlinePlayers'));
  let timer = null, running = null, stopped = false;
  async function observe() {
    for (const server of targets) {
      if (stopped) break;
      try {
        await onlinePlayers.observe(server.id);
      } catch {
        audit.write('player-observation.failed', { serverId: server.id });
      }
    }
  }
  const service = {
    runOnce() {
      if (stopped) return Promise.resolve();
      if (!running) running = observe().finally(() => { running = null; });
      return running;
    },
    start() {
      if (timer) return;
      stopped = false;
      timer = setIntervalFn(() => { void service.runOnce(); }, 180000);
      timer?.unref?.();
      void service.runOnce();
    },
    async stop() {
      stopped = true;
      if (timer) clearIntervalFn(timer);
      timer = null;
      if (running) await running;
    }
  };
  return Object.freeze(service);
}

module.exports = { createPlayerObserver };
