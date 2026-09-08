const { getsql } = require("./sqlConnection.js");

const REQUIRED_SCHEMA = {
  users: [
    "id",
    "fullname",
    "username",
    "password",
    "page",
    "status",
    "created_at",
    "updated_at",
  ],
  excel_template: [
    "id",
    "tablename",
    "field",
    "header",
    "header_bg",
    "header_text",
    "content_bg",
    "content_text",
    "display",
    "DATA_TYPE",
    "decimalpoint",
    "template_name",
    "order_no",
    "roundof",
    "created_at",
    "updated_at",
    "status",
  ],
  export_tables: [
    "id",
    "machinename",
    "exportname",
    "created_at",
    "updated_at",
    "status",
  ],
  export_assemblytables: [
    "id",
    "machinename",
    "exportname",
    "menu",
    "created_at",
    "updated_at",
    "status",
  ],
  backup_settings: [
    "id",
    "enabled",
    "backup_time",
    "backup_interval_days",
    "delete_after_backup",
    "delete_older_than_days",
    "last_successful_backup",
    "last_verified_backup_path",
    "last_cleanup_at",
    "last_deleted_rows",
    "last_status",
    "last_message",
    "updated_at",
  ],
  backup_table_settings: [
    "id",
    "table_name",
    "cleanup_enabled",
    "date_column",
    "updated_at",
  ],
};

async function getCurrentSchema() {
  const sql = getsql();
  const result = await sql.query(`
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME IN (
        'users',
        'excel_template',
        'export_tables',
        'export_assemblytables',
        'backup_settings',
        'backup_table_settings'
      )
  `);

  const map = new Map();
  for (const row of result.recordset || []) {
    const table = String(row.TABLE_NAME || "").toLowerCase();
    const column = String(row.COLUMN_NAME || "").toLowerCase();
    if (!map.has(table)) map.set(table, new Set());
    map.get(table).add(column);
  }
  return map;
}

function getMissingItems(schemaMap) {
  const missing = [];
  for (const [table, columns] of Object.entries(REQUIRED_SCHEMA)) {
    const existing = schemaMap.get(table.toLowerCase());
    if (!existing) {
      missing.push(`${table} (table)`);
      continue;
    }
    for (const column of columns) {
      if (!existing.has(column.toLowerCase())) {
        missing.push(`${table}.${column}`);
      }
    }
  }
  return missing;
}

async function applySchemaMigration() {
  const sql = getsql();

  // Each table is created only when missing. Existing tables are preserved.
  await sql.query(`
    IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        fullname VARCHAR(100) NULL,
        username VARCHAR(100) NULL,
        password VARCHAR(200) NULL,
        page VARCHAR(500) NULL,
        status INT NOT NULL CONSTRAINT DF_users_status DEFAULT 1,
        created_at DATETIME NOT NULL CONSTRAINT DF_users_created_at DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL CONSTRAINT DF_users_updated_at DEFAULT GETDATE()
      );
    END;
  `);

  await sql.query(`
    IF OBJECT_ID(N'dbo.excel_template', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.excel_template (
        id INT IDENTITY(1,1) PRIMARY KEY,
        tablename VARCHAR(255) NULL,
        field VARCHAR(255) NULL,
        header VARCHAR(255) NULL,
        header_bg VARCHAR(50) NULL,
        header_text VARCHAR(50) NULL,
        content_bg VARCHAR(50) NULL,
        content_text VARCHAR(50) NULL,
        display INT NULL,
        DATA_TYPE VARCHAR(50) NULL,
        decimalpoint INT NULL,
        template_name VARCHAR(255) NULL,
        order_no INT NULL,
        roundof INT NULL,
        created_at DATETIME NOT NULL CONSTRAINT DF_excel_template_created_at DEFAULT GETDATE(),
        updated_at DATETIME NULL,
        status INT NULL
      );
    END;
  `);

  await sql.query(`
    IF OBJECT_ID(N'dbo.export_tables', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.export_tables (
        id INT IDENTITY(1,1) PRIMARY KEY,
        machinename VARCHAR(200) NOT NULL,
        exportname VARCHAR(200) NOT NULL,
        created_at DATETIME NOT NULL CONSTRAINT DF_export_tables_created_at DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL CONSTRAINT DF_export_tables_updated_at DEFAULT GETDATE(),
        status INT NOT NULL CONSTRAINT DF_export_tables_status DEFAULT 1
      );
    END;
  `);

  await sql.query(`
    IF OBJECT_ID(N'dbo.export_assemblytables', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.export_assemblytables (
        id INT IDENTITY(1,1) PRIMARY KEY,
        machinename VARCHAR(200) NOT NULL,
        exportname VARCHAR(200) NOT NULL,
        menu VARCHAR(200) NOT NULL,
        created_at DATETIME NOT NULL CONSTRAINT DF_export_assemblytables_created_at DEFAULT GETDATE(),
        updated_at DATETIME NOT NULL CONSTRAINT DF_export_assemblytables_updated_at DEFAULT GETDATE(),
        status INT NOT NULL CONSTRAINT DF_export_assemblytables_status DEFAULT 1
      );
    END;
  `);

  await sql.query(`
    IF OBJECT_ID(N'dbo.backup_settings', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.backup_settings (
        id INT NOT NULL PRIMARY KEY,
        enabled BIT NOT NULL CONSTRAINT DF_backup_settings_enabled DEFAULT 1,
        backup_time TIME(0) NOT NULL CONSTRAINT DF_backup_settings_time DEFAULT '10:00:00',
        backup_interval_days INT NOT NULL CONSTRAINT DF_backup_settings_interval DEFAULT 7,
        delete_after_backup BIT NOT NULL CONSTRAINT DF_backup_settings_delete DEFAULT 0,
        delete_older_than_days INT NOT NULL CONSTRAINT DF_backup_settings_retention DEFAULT 30,
        last_successful_backup DATETIME2 NULL,
        last_verified_backup_path NVARCHAR(1000) NULL,
        last_cleanup_at DATETIME2 NULL,
        last_deleted_rows BIGINT NULL,
        last_status VARCHAR(50) NULL,
        last_message NVARCHAR(1000) NULL,
        updated_at DATETIME2 NOT NULL CONSTRAINT DF_backup_settings_updated DEFAULT SYSDATETIME()
      );
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.backup_settings WHERE id = 1)
    BEGIN
      INSERT INTO dbo.backup_settings (
        id, enabled, backup_time, backup_interval_days, delete_after_backup,
        delete_older_than_days, last_status, last_message, updated_at
      )
      VALUES (
        1, 1, '10:00:00', 7, 0, 30,
        'NOT_RUN', 'Automatic backup has not run yet.', SYSDATETIME()
      );
    END;
  `);

  await sql.query(`
    IF OBJECT_ID(N'dbo.backup_table_settings', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.backup_table_settings (
        id INT IDENTITY(1,1) PRIMARY KEY,
        table_name NVARCHAR(128) NOT NULL,
        cleanup_enabled BIT NOT NULL CONSTRAINT DF_backup_table_cleanup DEFAULT 0,
        date_column NVARCHAR(128) NULL,
        updated_at DATETIME2 NOT NULL CONSTRAINT DF_backup_table_updated DEFAULT SYSDATETIME()
      );
    END;

    IF OBJECT_ID(N'dbo.backup_table_settings', N'U') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM sys.indexes
         WHERE object_id = OBJECT_ID(N'dbo.backup_table_settings')
           AND name = N'UX_backup_table_settings_table_name'
       )
    BEGIN
      CREATE UNIQUE INDEX UX_backup_table_settings_table_name
      ON dbo.backup_table_settings(table_name);
    END;
  `);

  // Schema upgrades for databases created by older app versions.
  const alterStatements = [
    ["users", "fullname", "VARCHAR(100) NULL"],
    ["users", "username", "VARCHAR(100) NULL"],
    ["users", "password", "VARCHAR(200) NULL"],
    ["users", "page", "VARCHAR(500) NULL"],
    [
      "users",
      "status",
      "INT NOT NULL CONSTRAINT DF_users_status_mig DEFAULT 1",
    ],
    [
      "users",
      "created_at",
      "DATETIME NOT NULL CONSTRAINT DF_users_created_at_mig DEFAULT GETDATE()",
    ],
    [
      "users",
      "updated_at",
      "DATETIME NOT NULL CONSTRAINT DF_users_updated_at_mig DEFAULT GETDATE()",
    ],

    ["excel_template", "tablename", "VARCHAR(255) NULL"],
    ["excel_template", "field", "VARCHAR(255) NULL"],
    ["excel_template", "header", "VARCHAR(255) NULL"],
    ["excel_template", "header_bg", "VARCHAR(50) NULL"],
    ["excel_template", "header_text", "VARCHAR(50) NULL"],
    ["excel_template", "content_bg", "VARCHAR(50) NULL"],
    ["excel_template", "content_text", "VARCHAR(50) NULL"],
    ["excel_template", "display", "INT NULL"],
    ["excel_template", "DATA_TYPE", "VARCHAR(50) NULL"],
    ["excel_template", "decimalpoint", "INT NULL"],
    ["excel_template", "template_name", "VARCHAR(255) NULL"],
    ["excel_template", "order_no", "INT NULL"],
    ["excel_template", "roundof", "INT NULL"],
    ["excel_template", "created_at", "DATETIME NULL"],
    ["excel_template", "updated_at", "DATETIME NULL"],
    ["excel_template", "status", "INT NULL"],

    ["export_tables", "machinename", "VARCHAR(200) NULL"],
    ["export_tables", "exportname", "VARCHAR(200) NULL"],
    ["export_tables", "created_at", "DATETIME NULL"],
    ["export_tables", "updated_at", "DATETIME NULL"],
    ["export_tables", "status", "INT NULL"],

    ["export_assemblytables", "machinename", "VARCHAR(200) NULL"],
    ["export_assemblytables", "exportname", "VARCHAR(200) NULL"],
    ["export_assemblytables", "menu", "VARCHAR(200) NULL"],
    ["export_assemblytables", "created_at", "DATETIME NULL"],
    ["export_assemblytables", "updated_at", "DATETIME NULL"],
    ["export_assemblytables", "status", "INT NULL"],

    [
      "backup_settings",
      "enabled",
      "BIT NOT NULL CONSTRAINT DF_backup_settings_enabled_mig DEFAULT 1",
    ],
    [
      "backup_settings",
      "backup_time",
      "TIME(0) NOT NULL CONSTRAINT DF_backup_settings_time_mig DEFAULT '10:00:00'",
    ],
    [
      "backup_settings",
      "backup_interval_days",
      "INT NOT NULL CONSTRAINT DF_backup_settings_interval_mig DEFAULT 7",
    ],
    [
      "backup_settings",
      "delete_after_backup",
      "BIT NOT NULL CONSTRAINT DF_backup_settings_delete_mig DEFAULT 0",
    ],
    [
      "backup_settings",
      "delete_older_than_days",
      "INT NOT NULL CONSTRAINT DF_backup_settings_retention_mig DEFAULT 30",
    ],
    ["backup_settings", "last_successful_backup", "DATETIME2 NULL"],
    ["backup_settings", "last_verified_backup_path", "NVARCHAR(1000) NULL"],
    ["backup_settings", "last_cleanup_at", "DATETIME2 NULL"],
    ["backup_settings", "last_deleted_rows", "BIGINT NULL"],
    ["backup_settings", "last_status", "VARCHAR(50) NULL"],
    ["backup_settings", "last_message", "NVARCHAR(1000) NULL"],
    [
      "backup_settings",
      "updated_at",
      "DATETIME2 NOT NULL CONSTRAINT DF_backup_settings_updated_mig DEFAULT SYSDATETIME()",
    ],

    ["backup_table_settings", "table_name", "NVARCHAR(128) NULL"],
    [
      "backup_table_settings",
      "cleanup_enabled",
      "BIT NOT NULL CONSTRAINT DF_backup_table_cleanup_mig DEFAULT 0",
    ],
    ["backup_table_settings", "date_column", "NVARCHAR(128) NULL"],
    [
      "backup_table_settings",
      "updated_at",
      "DATETIME2 NOT NULL CONSTRAINT DF_backup_table_updated_mig DEFAULT SYSDATETIME()",
    ],
  ];

  for (const [table, column, definition] of alterStatements) {
    await sql.query(`
      IF OBJECT_ID(N'dbo.${table}', N'U') IS NOT NULL
         AND COL_LENGTH(N'dbo.${table}', N'${column}') IS NULL
      BEGIN
        ALTER TABLE dbo.${table} ADD [${column}] ${definition};
      END;
    `);
  }

  await sql.query(`
    IF OBJECT_ID(N'dbo.backup_settings', N'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.backup_settings WHERE id = 1)
    BEGIN
      INSERT INTO dbo.backup_settings (
        id, enabled, backup_time, backup_interval_days, delete_after_backup,
        delete_older_than_days, last_status, last_message, updated_at
      )
      VALUES (
        1, 1, '10:00:00', 7, 0, 30,
        'NOT_RUN', 'Automatic backup has not run yet.', SYSDATETIME()
      );
    END;

    IF OBJECT_ID(N'dbo.backup_table_settings', N'U') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM sys.indexes
         WHERE object_id = OBJECT_ID(N'dbo.backup_table_settings')
           AND name = N'UX_backup_table_settings_table_name'
       )
       AND NOT EXISTS (
         SELECT table_name
         FROM dbo.backup_table_settings
         GROUP BY table_name
         HAVING COUNT(*) > 1
       )
    BEGIN
      CREATE UNIQUE INDEX UX_backup_table_settings_table_name
      ON dbo.backup_table_settings(table_name);
    END;
  `);
}

async function syncMachineTables() {
  const sql = getsql();
  // Add newly discovered machine tables to the main machine mapping automatically.
  // Existing rename/status settings are never overwritten.
  await sql.query(`
    INSERT INTO dbo.export_tables (machinename, exportname, created_at, updated_at, status)
    SELECT t.TABLE_NAME, t.TABLE_NAME, GETDATE(), GETDATE(), 1
    FROM INFORMATION_SCHEMA.TABLES t
    WHERE t.TABLE_SCHEMA = 'dbo'
      AND t.TABLE_TYPE = 'BASE TABLE'
      AND (
        t.TABLE_NAME LIKE 'DXP%'
        OR t.TABLE_NAME LIKE 'MD%'
        OR t.TABLE_NAME LIKE 'MES%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.export_tables e
        WHERE e.machinename = t.TABLE_NAME
      );
  `);
}

async function ensureAppSchema() {
  let current = await getCurrentSchema();
  let missing = getMissingItems(current);

  if (missing.length) {
    console.warn("Database app schema is incomplete:", missing.join(", "));
    try {
      await applySchemaMigration();
    } catch (error) {
      throw new Error(
        `Database schema is incomplete and could not be repaired automatically. ` +
          `Run DB_SETUP.sql once using an SQL administrator account. Missing: ${missing.join(", ")}. ` +
          `Original error: ${error.message}`,
      );
    }

    current = await getCurrentSchema();
    missing = getMissingItems(current);
    if (missing.length) {
      throw new Error(
        `Database schema is still incomplete: ${missing.join(", ")}`,
      );
    }
    console.log(" Database support tables created/upgraded successfully");
  } else {
    console.log(" Database support schema verified");
  }

  await syncMachineTables();
  console.log(" Machine table mapping synchronized");
}

module.exports = { ensureAppSchema };
