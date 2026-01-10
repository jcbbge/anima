/**
 * Database Backup Script
 *
 * Creates a SQL dump of the entire anima database
 * This is a provider-agnostic backup tool
 */

import { query } from "../src/config/database.js";
import fs from "fs";
import path from "path";

const BACKUP_DIR = path.join(process.cwd(), "backups");
const BACKUP_FILE = path.join(
  BACKUP_DIR,
  `anima_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.sql`,
);

// Create backups directory if it doesn't exist
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

console.log("🔄 Starting database backup...");

async function backupDatabase() {
  try {
    // Get list of all tables
    const tablesResult = await query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    const tables = tablesResult.rows.map((row) => row.tablename);
    console.log(`📊 Found ${tables.length} tables to backup`);

    let sqlContent = `-- Anima Database Backup
-- Created: ${new Date().toISOString()}
-- Tables: ${tables.join(", ")}

`;

    // Backup each table
    for (const table of tables) {
      console.log(`📦 Backing up table: ${table}`);

      // Get table structure
      const createResult = await query(
        `
        SELECT 'CREATE TABLE ' || relname || ' (' || 
          array_to_string(
            array_agg(
              attname || ' ' || pg_catalog.format_type(atttypid, atttypmod) ||
              CASE WHEN attnotnull THEN ' NOT NULL' ELSE '' END
            ),
            ', '
          ) || ');' AS create_statement
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        WHERE c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
        GROUP BY relname
      `,
        [table],
      );

      if (createResult.rows.length > 0) {
        sqlContent += `\n-- Table: ${table}\n`;
        sqlContent += createResult.rows[0].create_statement + "\n";
      }

      // Get table data
      const dataResult = await query(`SELECT * FROM ${table}`);

      if (dataResult.rows.length > 0) {
        sqlContent += `\n-- Data: ${dataResult.rows.length} rows\n`;

        for (const row of dataResult.rows) {
          const columns = Object.keys(row);
          const values = columns.map((col) => {
            const val = row[col];
            if (val === null) return "NULL";
            if (typeof val === "string") {
              // Escape single quotes
              return `'${val.replace(/'/g, "''")}'`;
            }
            if (typeof val === "object") {
              return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
            }
            return val;
          });

          sqlContent += `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")});\n`;
        }
      }

      sqlContent += "\n";
    }

    // Write backup file
    fs.writeFileSync(BACKUP_FILE, sqlContent);

    const stats = fs.statSync(BACKUP_FILE);
    console.log(`\n✅ Backup completed successfully!`);
    console.log(`📁 Location: ${BACKUP_FILE}`);
    console.log(`📏 Size: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`📊 Tables backed up: ${tables.length}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Backup failed:", error.message);
    console.error(error);
    process.exit(1);
  }
}

backupDatabase();
