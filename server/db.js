import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';

const DB_PATH = path.resolve(process.cwd(), 'server/data/app.sqlite');
const SCHEMA_PATH = path.resolve(process.cwd(), 'server/schema.sql');

let db;

function hasColumn(tableName, columnName) {
  const statement = db.prepare(`PRAGMA table_info(${tableName});`);
  const columns = [];

  while (statement.step()) {
    columns.push(statement.getAsObject());
  }

  statement.free();
  return columns.some((column) => column.name === columnName);
}

function ensureLinksColumns() {
  if (!hasColumn('links', 'group_name')) {
    db.exec('ALTER TABLE links ADD COLUMN group_name TEXT;');
  }

  if (!hasColumn('links', 'tags')) {
    db.exec('ALTER TABLE links ADD COLUMN tags TEXT;');
  }

  if (!hasColumn('links', 'description')) {
    db.exec('ALTER TABLE links ADD COLUMN description TEXT;');
  }

  if (!hasColumn('links', 'image')) {
    db.exec('ALTER TABLE links ADD COLUMN image TEXT;');
  }

  if (!hasColumn('links', 'favicon')) {
    db.exec('ALTER TABLE links ADD COLUMN favicon TEXT;');
  }

  if (!hasColumn('links', 'site_name')) {
    db.exec('ALTER TABLE links ADD COLUMN site_name TEXT;');
  }
}

function saveDatabase() {
  if (!db) {
    return;
  }

  const data = db.export();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function runMigration() {
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schemaSql);
  ensureLinksColumns();
  db.exec('CREATE INDEX IF NOT EXISTS idx_links_user_group ON links(user_id, group_name);');
  saveDatabase();
}

function singleRow(query, params = []) {
  const statement = db.prepare(query);
  statement.bind(params);
  const hasRow = statement.step();
  const row = hasRow ? statement.getAsObject() : null;
  statement.free();
  return row;
}

function listRows(query, params = []) {
  const statement = db.prepare(query);
  statement.bind(params);
  const rows = [];

  while (statement.step()) {
    rows.push(statement.getAsObject());
  }

  statement.free();
  return rows;
}

export async function initializeDatabase() {
  const SQL = await initSqlJs({
    locateFile: (file) => path.resolve(process.cwd(), 'node_modules/sql.js/dist', file)
  });

  if (fs.existsSync(DB_PATH)) {
    const file = fs.readFileSync(DB_PATH);
    db = new SQL.Database(new Uint8Array(file));
  } else {
    db = new SQL.Database();
  }

  runMigration();
}

export function getUserByUsername(username) {
  return singleRow('SELECT id, email AS username, password_hash FROM users WHERE email = ?;', [username]);
}

export function createUser(username, passwordHash) {
  const statement = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?);');
  statement.run([username, passwordHash]);
  statement.free();

  const user = singleRow('SELECT id, email AS username, created_at FROM users WHERE email = ?;', [username]);
  saveDatabase();
  return user;
}

export function createLink(userId, { url, title, description, image, favicon, siteName, groupName, tags }) {
  const statement = db.prepare(
    'INSERT INTO links (user_id, url, title, description, image, favicon, site_name, group_name, tags, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);'
  );
  statement.run([
    userId,
    url,
    title ?? null,
    description ?? null,
    image ?? null,
    favicon ?? null,
    siteName ?? null,
    groupName ?? null,
    JSON.stringify(tags),
    new Date().toISOString()
  ]);
  statement.free();

  const link = singleRow(
    'SELECT id, user_id, url, title, description, image, favicon, site_name, group_name, tags, created_at, synced_at FROM links WHERE rowid = last_insert_rowid();'
  );

  link.tags = JSON.parse(link.tags ?? '[]');

  saveDatabase();
  return link;
}

export function getLinksForUser(userId, filters = {}) {
  const where = ['user_id = ?'];
  const params = [userId];

  if (filters.groupName) {
    where.push('group_name = ?');
    params.push(filters.groupName);
  }

  if (filters.tag) {
    where.push('tags LIKE ?');
    params.push(`%"${filters.tag}"%`);
  }

  const rows = listRows(
    `SELECT id, user_id, url, title, description, image, favicon, site_name, group_name, tags, created_at, synced_at FROM links WHERE ${where.join(
      ' AND '
    )} ORDER BY id DESC;`,
    params
  );

  return rows.map((row) => ({
    ...row,
    tags: JSON.parse(row.tags ?? '[]')
  }));
}

// ── Device trust (pairing) ────────────────────────────────────────

/**
 * Register a device for a user. If it is the first device for this account it
 * is automatically trusted. Returns { isFirstDevice, isTrusted }.
 * Calling this again for an already-registered device is a no-op.
 */
export function registerDevice(userId, deviceId, pairingCode) {
  const countRow = singleRow(
    'SELECT COUNT(*) as cnt FROM user_devices WHERE user_id = ? AND is_trusted = 1',
    [userId]
  );
  const trustedCount = countRow ? Number(countRow.cnt) : 0;
  const isFirstDevice = trustedCount === 0;

  const existing = singleRow(
    'SELECT is_trusted FROM user_devices WHERE user_id = ? AND device_id = ?',
    [userId, deviceId]
  );

  if (existing) {
    // Recovery path: if this account currently has no trusted device at all,
    // promote the current device so the pairing flow can bootstrap.
    if (trustedCount === 0 && !Boolean(existing.is_trusted)) {
      const promote = db.prepare(
        'UPDATE user_devices SET is_trusted = 1, pairing_code = ? WHERE user_id = ? AND device_id = ?'
      );
      promote.run([pairingCode.toUpperCase(), userId, deviceId]);
      promote.free();
      saveDatabase();
      return { isFirstDevice: true, isTrusted: true };
    }

    return { isFirstDevice: false, isTrusted: Boolean(existing.is_trusted) };
  }

  const isTrusted = isFirstDevice ? 1 : 0;
  const stmt = db.prepare(
    'INSERT INTO user_devices (user_id, device_id, pairing_code, is_trusted) VALUES (?, ?, ?, ?)'
  );
  stmt.run([userId, deviceId, pairingCode.toUpperCase(), isTrusted]);
  stmt.free();
  saveDatabase();

  return { isFirstDevice, isTrusted: Boolean(isTrusted) };
}

/**
 * Verify that `inputPairingCode` matches the pairing code of any trusted device
 * owned by the user. If valid, marks `deviceId` as trusted and returns true.
 */
export function verifyAndTrustDevice(userId, deviceId, inputPairingCode) {
  const trusted = singleRow(
    'SELECT id FROM user_devices WHERE user_id = ? AND is_trusted = 1 AND UPPER(pairing_code) = UPPER(?)',
    [userId, inputPairingCode]
  );
  if (!trusted) return false;

  const stmt = db.prepare(
    'UPDATE user_devices SET is_trusted = 1 WHERE user_id = ? AND device_id = ?'
  );
  stmt.run([userId, deviceId]);
  stmt.free();
  saveDatabase();
  return true;
}

/** Returns true if the device is registered and trusted for the user. */
export function isDeviceTrusted(userId, deviceId) {
  const row = singleRow(
    'SELECT is_trusted FROM user_devices WHERE user_id = ? AND device_id = ?',
    [userId, deviceId]
  );
  return row ? Boolean(row.is_trusted) : false;
}
