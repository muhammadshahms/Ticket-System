import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.join(__dirname, "..", "data");
const dataDir = process.env.DATA_DIR || defaultDataDir;
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "banoqabil-queue.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export const DEFAULT_SUPER_ADMIN = Object.freeze({
  username: "admin",
  password: "BanoQabil@2026",
  displayName: "Bano Qabil Super Admin"
});

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(":");
  const actual = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(expected, "hex"));
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS panels (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'reception', 'panel')),
      panel_id INTEGER REFERENCES panels(id),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_number INTEGER NOT NULL,
      token_code TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      phone_display TEXT NOT NULL,
      banoqabil_id TEXT,
      course TEXT NOT NULL,
      panel_id INTEGER NOT NULL REFERENCES panels(id),
      status TEXT NOT NULL DEFAULT 'waiting'
        CHECK(status IN ('waiting', 'called', 'in_interview', 'completed', 'skipped')),
      event_date TEXT NOT NULL,
      called_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(panel_id, event_date, token_number)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      ticket_id INTEGER REFERENCES tickets(id),
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_panel_status ON tickets(panel_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_event_date ON tickets(event_date);
  `);

  const ticketColumns = new Set(db.prepare("PRAGMA table_info(tickets)").all().map((column) => column.name));
  const addTicketColumn = (name, definition) => {
    if (ticketColumns.has(name)) return;
    try { db.exec(`ALTER TABLE tickets ADD COLUMN ${name} ${definition}`); }
    catch (error) { if (!String(error.message).includes("duplicate column name")) throw error; }
  };
  addTicketColumn("interview_score", "INTEGER");
  addTicketColumn("interview_remarks", "TEXT");
  addTicketColumn("interviewed_by", "INTEGER REFERENCES users(id)");

  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();

  const existingAdminLogin = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(DEFAULT_SUPER_ADMIN.username);
  if (existingAdminLogin) {
    db.prepare(`
      UPDATE users
      SET password_hash = ?, display_name = ?, role = 'admin', panel_id = NULL, active = 1
      WHERE id = ?
    `).run(hashPassword(DEFAULT_SUPER_ADMIN.password), DEFAULT_SUPER_ADMIN.displayName, existingAdminLogin.id);
  } else {
    db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, panel_id, active)
      VALUES (?, ?, ?, 'admin', NULL, 1)
    `).run(DEFAULT_SUPER_ADMIN.username, hashPassword(DEFAULT_SUPER_ADMIN.password), DEFAULT_SUPER_ADMIN.displayName);
  }
}

export function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}
