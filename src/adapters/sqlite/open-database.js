'use strict';

const fs = require('node:fs');
const path = require('node:path');

function openSqliteDatabase(databasePath, options = {}) {
  if (typeof databasePath !== 'string' || !databasePath.trim()) {
    throw new TypeError('A SQLite database path is required.');
  }
  const sqlite3 = options.sqlite3 || require('sqlite3');
  const resolvedPath = databasePath === ':memory:'
    ? databasePath
    : path.resolve(options.basePath || process.cwd(), databasePath);

  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
  }

  return new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(resolvedPath, async error => {
      if (error) {
        reject(new Error('Could not open the configured SQLite database.'));
        return;
      }

      try {
        connection.configure('busyTimeout', options.busyTimeoutMs || 5000);
        await new Promise((resolvePragma, rejectPragma) => {
          connection.run('PRAGMA foreign_keys = ON', pragmaError => {
            if (pragmaError) {
              rejectPragma(pragmaError);
              return;
            }
            connection.run('PRAGMA journal_mode = DELETE', journalError => {
              if (journalError) rejectPragma(journalError);
              else resolvePragma();
            });
          });
        });
        if (resolvedPath !== ':memory:') fs.chmodSync(resolvedPath, 0o600);
        resolve(createDatabaseInterface(connection));
      } catch {
        connection.close(() => {});
        reject(new Error('Could not initialize the configured SQLite database.'));
      }
    });
  });
}

function createDatabaseInterface(connection) {
  let closed = false;
  return Object.freeze({
    executeSql(sql) {
      return new Promise((resolve, reject) => {
        connection.run(sql, error => error ? reject(error) : resolve());
      });
    },
    all(sql, parameters = []) {
      return new Promise((resolve, reject) => {
        connection.all(sql, parameters, (error, rows) => error ? reject(error) : resolve(rows));
      });
    },
    get(sql, parameters = []) {
      return new Promise((resolve, reject) => {
        connection.get(sql, parameters, (error, row) => error ? reject(error) : resolve(row));
      });
    },
    run(sql, parameters = []) {
      return new Promise((resolve, reject) => {
        connection.run(sql, parameters, function onRun(error) {
          if (error) reject(error);
          else resolve(Object.freeze({ changes: this.changes, lastID: this.lastID }));
        });
      });
    },
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise((resolve, reject) => {
        connection.close(error => error ? reject(error) : resolve());
      });
    }
  });
}

module.exports = { createDatabaseInterface, openSqliteDatabase };
