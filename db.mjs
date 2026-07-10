import 'dotenv/config';
import sqlite3 from 'sqlite3';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

sqlite3.verbose();
const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const configuredDbPath = process.env.DB_PATH || './data/database.db';
const dbPath = isAbsolute(configuredDbPath) ? configuredDbPath : resolve(projectRoot, configuredDbPath);
const dataDir = dirname(dbPath);
const imageDir = join(dataDir, 'images');
await mkdir(dataDir, { recursive: true });
await mkdir(imageDir, { recursive: true });

export const db = new sqlite3.Database(dbPath);
export const dbReady = new Promise((resolve, reject) => {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_path TEXT NOT NULL UNIQUE,
      tag TEXT NOT NULL CHECK (tag IN ('口味', '环境')),
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'cooling')),
      last_used_at TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      highlight TEXT NOT NULL,
      detail TEXT,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      generated_content TEXT,
      selected_image_paths TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS private_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      feedback_content TEXT NOT NULL,
      rating INTEGER CHECK (rating BETWEEN 1 AND 3)
    )`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      const ensureColumn = (table, column, definition, done) => {
        db.all(`PRAGMA table_info(${table})`, (tableError, columns) => {
          if (tableError) return done(tableError);
          if (columns.some((item) => item.name === column)) return done();
          db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, done);
        });
      };
      ensureColumn('reviews', 'selected_image_paths', 'TEXT', (reviewError) => {
        if (reviewError) return reject(reviewError);
        ensureColumn('private_feedback', 'rating', 'INTEGER CHECK (rating BETWEEN 1 AND 3)', (feedbackError) => {
          if (feedbackError) reject(feedbackError);
          else resolve();
        });
      });
    });
  });
});

export function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}

export function run(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function onRun(error) {
    if (error) reject(error);
    else resolve({ lastID: this.lastID, changes: this.changes });
  }));
}

export { dbPath, imageDir, projectRoot };
