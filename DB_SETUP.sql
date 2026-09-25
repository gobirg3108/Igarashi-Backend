USE IGARASHI_DB;
GO

/*
  One-time Igarashi application support schema setup.
  Safe to run repeatedly. Existing data is preserved.
*/

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.users (
    id INT IDENTITY(1,1) PRIMARY KEY,
    fullname VARCHAR(100) NULL,
    username VARCHAR(100) NULL,
    password VARCHAR(200) NULL,
    page VARCHAR(500) NULL,
    status INT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME NOT NULL DEFAULT GETDATE()
  );
END;
GO


-- Guaranteed built-in Igarashi account (plain-text password by requirement).
-- Safe to run repeatedly; restores the account and all current page access.
DECLARE @IgarashiPages VARCHAR(500) =
  'Home,Encap Assembly,Motor Assembly,Armature Assembly,Settings,Excel Template,All Table Names,Assembly Table Names,Backup Tables,Traceability';

IF EXISTS (
  SELECT 1
  FROM dbo.users
  WHERE LOWER(LTRIM(RTRIM(username))) = LOWER('Igarashi')
)
BEGIN
  UPDATE dbo.users
  SET
    fullname = 'Igarashi',
    username = 'Igarashi',
    password = 'Igarashi',
    page = @IgarashiPages,
    status = 1,
    updated_at = GETDATE()
  WHERE LOWER(LTRIM(RTRIM(username))) = LOWER('Igarashi');
END
ELSE
BEGIN
  INSERT INTO dbo.users
    (fullname, username, password, page, status, created_at, updated_at)
  VALUES
    ('Igarashi', 'Igarashi', 'Igarashi', @IgarashiPages, 1, GETDATE(), GETDATE());
END;
GO

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
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME NULL,
    status INT NULL
  );
END;
GO

IF OBJECT_ID(N'dbo.export_tables', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.export_tables (
    id INT IDENTITY(1,1) PRIMARY KEY,
    machinename VARCHAR(200) NOT NULL,
    exportname VARCHAR(200) NOT NULL,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    status INT DEFAULT 1,
    traceability_order INT NULL
  );
END;
GO

IF OBJECT_ID(N'dbo.export_assemblytables', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.export_assemblytables (
    id INT IDENTITY(1,1) PRIMARY KEY,
    machinename VARCHAR(200) NOT NULL,
    exportname VARCHAR(200) NOT NULL,
    menu VARCHAR(200) NOT NULL,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    status INT DEFAULT 1
  );
END;
GO

-- Upgrade columns used by current app if an older version of a table exists.
IF COL_LENGTH(N'dbo.excel_template', N'roundof') IS NULL ALTER TABLE dbo.excel_template ADD roundof INT NULL;
IF COL_LENGTH(N'dbo.excel_template', N'updated_at') IS NULL ALTER TABLE dbo.excel_template ADD updated_at DATETIME NULL;
IF COL_LENGTH(N'dbo.excel_template', N'status') IS NULL ALTER TABLE dbo.excel_template ADD status INT NULL;
IF COL_LENGTH(N'dbo.export_tables', N'traceability_order') IS NULL ALTER TABLE dbo.export_tables ADD traceability_order INT NULL;
IF COL_LENGTH(N'dbo.export_assemblytables', N'menu') IS NULL ALTER TABLE dbo.export_assemblytables ADD menu VARCHAR(200) NULL;
GO

-- Automatically register machine tables that are not mapped yet.
INSERT INTO dbo.export_tables (machinename, exportname, created_at, updated_at, status, traceability_order)
SELECT t.TABLE_NAME, t.TABLE_NAME, GETDATE(), GETDATE(), 1, NULL
FROM INFORMATION_SCHEMA.TABLES t
WHERE t.TABLE_SCHEMA = 'dbo'
  AND t.TABLE_TYPE = 'BASE TABLE'
  AND (t.TABLE_NAME LIKE 'DXP%' OR t.TABLE_NAME LIKE 'MD%' OR t.TABLE_NAME LIKE 'MES%')
  AND NOT EXISTS (
    SELECT 1 FROM dbo.export_tables e WHERE e.machinename = t.TABLE_NAME
  );

DECLARE @maxTraceabilityOrder INT = ISNULL(
  (SELECT MAX(traceability_order) FROM dbo.export_tables),
  0
);

;WITH MissingOrder AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM dbo.export_tables
  WHERE traceability_order IS NULL
)
UPDATE e
SET traceability_order = @maxTraceabilityOrder + m.rn
FROM dbo.export_tables e
INNER JOIN MissingOrder m ON m.id = e.id;
GO

PRINT 'Igarashi DB setup completed successfully.';
GO

/* Dynamic automatic SQL backup + verified cleanup settings */
IF OBJECT_ID(N'dbo.backup_settings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.backup_settings (
    id INT NOT NULL PRIMARY KEY,
    enabled BIT NOT NULL DEFAULT 1,
    backup_time TIME(0) NOT NULL DEFAULT '10:00:00',
    backup_interval_days INT NOT NULL DEFAULT 7,
    delete_after_backup BIT NOT NULL DEFAULT 0,
    delete_older_than_days INT NOT NULL DEFAULT 30,
    last_successful_backup DATETIME2 NULL,
    last_verified_backup_path NVARCHAR(1000) NULL,
    last_cleanup_at DATETIME2 NULL,
    last_deleted_rows BIGINT NULL,
    last_status VARCHAR(50) NULL,
    last_message NVARCHAR(1000) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.backup_settings WHERE id = 1)
BEGIN
  INSERT INTO dbo.backup_settings (
    id, enabled, backup_time, backup_interval_days,
    delete_after_backup, delete_older_than_days,
    last_status, last_message, updated_at
  )
  VALUES (
    1, 1, '10:00:00', 7, 0, 30,
    'NOT_RUN', 'Automatic backup has not run yet.', SYSDATETIME()
  );
END;
GO

IF OBJECT_ID(N'dbo.backup_table_settings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.backup_table_settings (
    id INT IDENTITY(1,1) PRIMARY KEY,
    table_name NVARCHAR(128) NOT NULL,
    cleanup_enabled BIT NOT NULL DEFAULT 1,
    date_column NVARCHAR(128) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.backup_table_settings')
    AND name = N'UX_backup_table_settings_table_name'
)
BEGIN
  CREATE UNIQUE INDEX UX_backup_table_settings_table_name
    ON dbo.backup_table_settings(table_name);
END;
GO


/* Traceability barcode scan setting (persisted in DB) */
IF OBJECT_ID(N'dbo.traceability_settings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.traceability_settings (
    id INT NOT NULL PRIMARY KEY,
    barcode_scan_enabled BIT NOT NULL DEFAULT 1,
    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
  );
END;
GO

IF COL_LENGTH(N'dbo.traceability_settings', N'barcode_scan_enabled') IS NULL
  ALTER TABLE dbo.traceability_settings ADD barcode_scan_enabled BIT NOT NULL DEFAULT 1;
IF COL_LENGTH(N'dbo.traceability_settings', N'updated_at') IS NULL
  ALTER TABLE dbo.traceability_settings ADD updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME();
GO

IF NOT EXISTS (SELECT 1 FROM dbo.traceability_settings WHERE id = 1)
BEGIN
  INSERT INTO dbo.traceability_settings (id, barcode_scan_enabled, updated_at)
  VALUES (1, 1, SYSDATETIME());
END;
GO
