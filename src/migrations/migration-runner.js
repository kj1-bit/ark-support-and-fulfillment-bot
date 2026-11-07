'use strict';
function createMigrationRunner({ database, migrations, clock = Date.now }) {
  if (
    !database ||
    typeof database.executeSql !== 'function' ||
    typeof database.all !== 'function' ||
    typeof database.run !== 'function'
  ) {
    throw new TypeError(
      'database executeSql/all/run interface is required.'
    );
  }
  if (!Array.isArray(migrations) || migrations.length === 0) throw new TypeError('migrations are required.');
  const ordered = [...migrations].sort((a,b)=>a.version-b.version);
  const versions = new Set();
  for (const migration of ordered) {
    if (!Number.isInteger(migration.version) || migration.version < 1 || versions.has(migration.version)) throw new TypeError('Migration versions must be unique positive integers.');
    versions.add(migration.version);
  }
  return Object.freeze({
    async run() {
      await database.executeSql('CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
      const applied = new Set((await database.all('SELECT version FROM schema_versions ORDER BY version')).map(row=>row.version));
      const unknown = [...applied].filter(version=>!versions.has(version));
      if (unknown.length) throw new Error(`Unsupported database schema version: ${unknown.join(', ')}`);
      for (const migration of ordered) {
        if (applied.has(migration.version)) continue;
        await database.executeSql('BEGIN IMMEDIATE');
        try {
          for (const statement of migration.statements) await database.executeSql(statement);
          await database.run('INSERT INTO schema_versions (version, name, applied_at) VALUES (?, ?, ?)', [migration.version, migration.name, new Date(clock()).toISOString()]);
          await database.executeSql('COMMIT');
        } catch (error) {
          await database.executeSql('ROLLBACK').catch(()=>{});
          throw error;
        }
      }
      return ordered.at(-1).version;
    }
  });
}
module.exports = { createMigrationRunner };
