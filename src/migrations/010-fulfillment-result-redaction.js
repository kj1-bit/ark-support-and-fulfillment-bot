'use strict';

function safeResults(value) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const results = [];
  for (const result of value) {
    if (!result || typeof result.success !== 'boolean') return null;
    results.push({
      success: result.success,
      ...(Number.isInteger(result.operationIndex) && result.operationIndex >= 1 && result.operationIndex <= 20
        ? { operationIndex: result.operationIndex }
        : {})
    });
  }
  return results;
}

module.exports = Object.freeze({
  version: 10,
  name: 'fulfillment-result-redaction',
  statements: Object.freeze([]),
  async up(database) {
    let lastId = '';
    while (true) {
      const rows = await database.all(
        `SELECT id,
           CASE WHEN length(result_json) <= 4096 THEN result_json ELSE NULL END AS resultJson
         FROM fulfillment_requests
         WHERE result_json IS NOT NULL AND id > ?
         ORDER BY id LIMIT 100`,
        [lastId]
      );
      if (!rows.length) break;
      for (const row of rows) {
        lastId = row.id;
        let safe = null;
        try {
          safe = typeof row.resultJson === 'string'
            ? safeResults(JSON.parse(row.resultJson))
            : null;
        } catch {
          safe = null;
        }
        await database.run(
          'UPDATE fulfillment_requests SET result_json = ? WHERE id = ?',
          [safe === null ? null : JSON.stringify(safe), row.id]
        );
      }
    }
  }
});
