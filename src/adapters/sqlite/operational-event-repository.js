'use strict';

const TICKET_HISTORY = `WITH history AS (
  SELECT *,CASE WHEN json_type(details_json,'$.id')='text' AND length(json_extract(details_json,'$.id'))>0
    THEN 'ticket:' || json_extract(details_json,'$.id') ELSE 'event:' || id END AS ticket_key
  FROM operational_events WHERE category='ticket'
    AND type IN ('ticket.created','ticket.claimed','ticket.unclaimed','ticket.completed','ticket.closed','ticket.reopened')
), grouped AS (
  SELECT ticket_key,MIN(id) AS first_id,MIN(CASE WHEN type='ticket.created' THEN id END) AS opened_id,
    MAX(CASE WHEN type IN ('ticket.claimed','ticket.unclaimed') THEN id END) AS assignment_id,
    MAX(CASE WHEN type='ticket.completed' THEN id END) AS completed_id,
    MAX(CASE WHEN type='ticket.closed' THEN id END) AS closed_id,
    MAX(CASE WHEN type='ticket.reopened' THEN id END) AS reopened_id,
    COALESCE(MIN(CASE WHEN type='ticket.created' THEN occurred_at END),MIN(occurred_at)) AS opened_at
  FROM history GROUP BY ticket_key
)`;

function createSqliteOperationalEventRepository(database) {
  if (!database || typeof database.run !== 'function' || typeof database.all !== 'function'
    || typeof database.get !== 'function') throw new TypeError('database run/all/get interface is required.');
  return Object.freeze({
    async ticketPage({ page, pageSize }) {
      const count = await database.get(`${TICKET_HISTORY} SELECT COUNT(*) AS total FROM grouped`);
      const rows = await database.all(`${TICKET_HISTORY}, selected AS (
        SELECT * FROM grouped ORDER BY opened_at DESC,COALESCE(opened_id,first_id) DESC LIMIT ? OFFSET ?
      )
      SELECT selected.ticket_key AS ticketKey,selected.opened_at AS occurredAt,
        identity.details_json AS identityJson,opened.details_json AS openedJson,
        assignment.type AS assignmentType,assignment.id AS assignmentSequence,assignment.details_json AS assignmentJson,
        completed.id AS completedSequence,completed.details_json AS completedJson,
        closed.id AS closedSequence,closed.details_json AS closedJson,
        reopened.id AS reopenedSequence,reopened.details_json AS reopenedJson
      FROM selected
      JOIN operational_events AS identity ON identity.id=COALESCE(selected.opened_id,selected.first_id)
      LEFT JOIN operational_events AS opened ON opened.id=selected.opened_id
      LEFT JOIN operational_events AS assignment ON assignment.id=selected.assignment_id
        AND assignment.id>COALESCE(selected.reopened_id,0)
      LEFT JOIN operational_events AS completed ON completed.id=selected.completed_id
        AND completed.id>COALESCE(selected.reopened_id,0)
      LEFT JOIN operational_events AS closed ON closed.id=selected.closed_id
        AND closed.id>COALESCE(selected.reopened_id,0)
      LEFT JOIN operational_events AS reopened ON reopened.id=selected.reopened_id
      ORDER BY selected.opened_at DESC,COALESCE(selected.opened_id,selected.first_id) DESC`,
      [pageSize,(page - 1) * pageSize]);
      const parse = json => {
        if (!json) return null;
        const details = JSON.parse(json);
        return Object.freeze(details && typeof details === 'object' && !Array.isArray(details) ? details : {});
      };
      const action = (json, sequence) => json ? Object.freeze({ sequence,details:parse(json) }) : null;
      return Object.freeze({ page,pageSize,total:Number(count.total),
        results:Object.freeze(rows.map(row => Object.freeze({
          id:row.ticketKey,occurredAt:row.occurredAt,identity:parse(row.identityJson),opened:parse(row.openedJson),
          assignment:row.assignmentJson ? Object.freeze({
            type:row.assignmentType,...action(row.assignmentJson,row.assignmentSequence)
          }) : null,
          completed:action(row.completedJson,row.completedSequence),
          closed:action(row.closedJson,row.closedSequence),reopened:action(row.reopenedJson,row.reopenedSequence)
        }))) });
    },
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
