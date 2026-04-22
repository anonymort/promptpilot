import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function isReadStatement(sql) {
  return /^\s*(select|with|explain|pragma)/i.test(sql);
}

class D1PreparedStatementAdapter {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new D1PreparedStatementAdapter(this.database, this.sql, params);
  }

  async first() {
    const statement = this.database.prepare(this.sql);
    return statement.get(...this.params) ?? null;
  }

  async run() {
    const statement = this.database.prepare(this.sql);

    if (isReadStatement(this.sql)) {
      const results = statement.all(...this.params);
      return {
        success: true,
        meta: {
          changes: 0,
          last_row_id: 0,
          changed_db: false
        },
        results
      };
    }

    const result = statement.run(...this.params);
    return {
      success: true,
      meta: {
        changes: result.changes ?? 0,
        last_row_id: Number(result.lastInsertRowid ?? 0),
        changed_db: (result.changes ?? 0) > 0
      },
      results: []
    };
  }
}

export class D1DatabaseAdapter {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
  }

  applyMigration(relativePath) {
    const sql = readFileSync(resolve(relativePath), "utf8");
    this.sqlite.exec(sql);
  }

  prepare(sql) {
    return new D1PreparedStatementAdapter(this.sqlite, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }

  async exec(sql) {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }
}

export function createTestDb() {
  const db = new D1DatabaseAdapter();
  db.applyMigration("./backend/migrations/0001_init.sql");
  db.applyMigration("./backend/migrations/0002_usage_reservations_and_redemptions.sql");
  db.applyMigration("./backend/migrations/0003_buymeacoffee_supporter_unlocks.sql");
  return db;
}
