'use strict';

function createSqliteOperationalEventRepository(database) {
  if (!database || typeof database.run !== 'function' || typeof database.all !== 'function'
    || typeof database.get !== 'function') throw new TypeError('database run/all/get interface is required.');
  return Object.freeze({
    async append(event) {
      const detailsJson = JSON.stringify(event.details);
      if (Buffer.byteLength(detailsJson, 'utf8') > 4096) {
        throw new TypeError('Operational event details exceed the persistence limit.');
      }
      await database.run('INSERT INTO operational_events (type,category,occurred_at,details_json) VALUES (?,?,?,?)',
        [event.type,event.category,event.occurredAt,detailsJson]);
      return Object.freeze({ ...event, details:JSON.parse(detailsJson) });
    },
    async query({ page, pageSize, category, types }) {
      const clauses = [];
      const args = [];
      if (category) { clauses.push('category=?'); args.push(category); }
      if (types?.length) {
        clauses.push(`type IN (${types.map(() => '?').join(',')})`);
        args.push(...types);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const count = await database.get(`SELECT COUNT(*) AS total FROM operational_events${where}`, args);
      const rows = await database.all(
        `SELECT id,type,category,occurred_at AS occurredAt,details_json AS detailsJson
         FROM operational_events${where} ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?`,
        [...args,pageSize,(page - 1) * pageSize]);
      return Object.freeze({ page,pageSize,total:Number(count?.total || 0),
        results:Object.freeze(rows.map(row => Object.freeze({
          id:row.id,type:row.type,category:row.category,occurredAt:row.occurredAt,
          details:Object.freeze(JSON.parse(row.detailsJson))
        }))) });
    }
  });
}
module.exports = { createSqliteOperationalEventRepository };
