'use strict';

function serializeRegistry(registry) {
  return JSON.stringify({
    version: registry.version,
    creatures: registry.creatures
  });
}

function createSqliteCatalogStore(database, { clock = Date.now } = {}) {
  if (
    !database ||
    typeof database.run !== 'function' ||
    typeof database.get !== 'function' ||
    typeof database.executeSql !== 'function'
  ) {
    throw new TypeError('database run/get/executeSql interface is required.');
  }

  async function loadActive() {
    const row = await database.get(
      `SELECT catalog_json
       FROM catalog_versions
       WHERE state = 'ACTIVE'`
    );
    return row ? JSON.parse(row.catalog_json) : null;
  }

  async function load(version) {
    const row = await database.get(
      `SELECT catalog_json
       FROM catalog_versions
       WHERE version = ?`,
      [version]
    );
    return row ? JSON.parse(row.catalog_json) : null;
  }

  async function isRetained(version) {
    const row = await database.get(
      `SELECT 1 AS retained
       FROM catalog_versions
       WHERE version = ? AND state = 'RETAINED'`,
      [version]
    );
    return Boolean(row);
  }

  async function activate(registry) {
    const update = async () => {
      await database.run(
        `UPDATE catalog_versions
         SET state = 'RETAINED'
         WHERE state = 'ACTIVE'`
      );
      await database.run(
        `INSERT INTO catalog_versions (
           version, checksum, catalog_json, state, created_at, activated_at
         ) VALUES (?, ?, ?, 'ACTIVE', ?, ?)
         ON CONFLICT(version) DO UPDATE SET
           checksum = excluded.checksum,
           catalog_json = excluded.catalog_json,
           state = 'ACTIVE',
           activated_at = excluded.activated_at`,
        [
          registry.version,
          registry.checksum,
          serializeRegistry(registry),
          clock(),
          clock()
        ]
      );
    };
    if (database.transaction) await database.transaction(update);
    else {
      await database.executeSql('BEGIN IMMEDIATE');
      try {
        await update();
        await database.executeSql('COMMIT');
      } catch (error) {
        await database.executeSql('ROLLBACK').catch(() => {});
        throw error;
      }
    }
    return loadActive();
  }

  async function previousActive(currentVersion) {
    const row = await database.get(
      `SELECT catalog_json
       FROM catalog_versions
       WHERE version <> ? AND state = 'RETAINED'
       ORDER BY activated_at DESC, created_at DESC
       LIMIT 1`,
      [currentVersion]
    );
    return row ? JSON.parse(row.catalog_json) : null;
  }

  return Object.freeze({ activate, isRetained, load, loadActive, previousActive });
}

module.exports = { createSqliteCatalogStore };
