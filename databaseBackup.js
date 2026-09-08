const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const mssql = require("mssql");
const { execFileSync } = require("child_process");
const { getsql } = require("./sqlConnection.js");

const ALLOWED_INTERVALS = [7, 15, 30];
const ALLOWED_RETENTION_DAYS = [7, 15, 30];
const DATE_TYPES = new Set([
  "date",
  "datetime",
  "datetime2",
  "smalldatetime",
  "datetimeoffset",
]);

let backupInProgress = false;
let backupCycleInProgress = false;
let lastBackupFailureAt = null;
const FAILURE_RETRY_MS = 30 * 60 * 1000; // avoid repeated large .bak attempts every minute

function pad(value) {
  return String(value).padStart(2, "0");
}

function getLocalStamp(date = new Date()) {
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
  };
}

function quoteIdentifier(value) {
  return `[${String(value).replace(/]/g, "]]" )}]`;
}

function quoteSqlString(value) {
  return `N'${String(value).replace(/'/g, "''")}'`;
}

function normalizeTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  return `${pad(hour)}:${pad(minute)}`;
}

function asIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function calculateNextBackup(lastSuccessfulBackup, intervalDays, backupTime) {
  if (!lastSuccessfulBackup) return null;

  const last = new Date(lastSuccessfulBackup);
  if (Number.isNaN(last.getTime())) return null;

  const normalizedTime = normalizeTime(backupTime) || "10:00";
  const [hour, minute] = normalizedTime.split(":").map(Number);

  const next = new Date(last);
  next.setDate(next.getDate() + Number(intervalDays));
  next.setHours(hour, minute, 0, 0);
  return next;
}

function isConfiguredTimeReachedToday(backupTime, now = new Date()) {
  const normalizedTime = normalizeTime(backupTime) || "10:00";
  const [hour, minute] = normalizedTime.split(":").map(Number);

  const scheduled = new Date(now);
  scheduled.setHours(hour, minute, 0, 0);
  return now >= scheduled;
}

async function getCurrentDatabaseName() {
  const result = await getsql().query("SELECT DB_NAME() AS databaseName");
  const databaseName = result?.recordset?.[0]?.databaseName;

  if (!databaseName) {
    throw new Error("Unable to determine the connected SQL database name.");
  }

  return databaseName;
}

async function getSqlDefaultBackupPath() {
  const result = await getsql().query(`
    SELECT CONVERT(nvarchar(4000), SERVERPROPERTY('InstanceDefaultBackupPath')) AS backupPath
  `);

  const backupPath = result?.recordset?.[0]?.backupPath;
  return typeof backupPath === "string" && backupPath.trim()
    ? backupPath.trim()
    : null;
}

async function getSqlServerServiceAccount() {
  try {
    const result = await getsql().query(`
      SELECT TOP (1) service_account AS serviceAccount
      FROM sys.dm_server_services
      WHERE servicename LIKE 'SQL Server (%'
      ORDER BY CASE WHEN status_desc = 'Running' THEN 0 ELSE 1 END, servicename;
    `);

    const serviceAccount = result?.recordset?.[0]?.serviceAccount;
    return typeof serviceAccount === "string" && serviceAccount.trim()
      ? serviceAccount.trim()
      : null;
  } catch (error) {
    console.warn(
      "[WARN] Unable to read SQL Server service account for backup-folder permission:",
      error.message,
    );
    return null;
  }
}

async function ensureSqlServerCanWrite(sqlBackupRoot) {
  await fs.promises.mkdir(sqlBackupRoot, { recursive: true });

  const serviceAccount = await getSqlServerServiceAccount();
  if (!serviceAccount) return false;

  try {
    execFileSync(
      "icacls.exe",
      [sqlBackupRoot, "/grant", `${serviceAccount}:(OI)(CI)M`, "/T", "/C"],
      { windowsHide: true, stdio: "ignore" },
    );

    console.log(
      `[OK] SQL backup folder permission verified for ${serviceAccount}.`,
    );
    return true;
  } catch (error) {
    console.warn(
      `[WARN] Could not grant SQL Server write access to ${sqlBackupRoot}.`,
      error.message,
    );
    return false;
  }
}

async function verifyBackupFile(backupPath) {
  if (!backupPath) {
    throw new Error("Backup verification path is missing.");
  }

  const stat = await fs.promises.stat(backupPath);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error("Backup file is missing or empty.");
  }

  const safeBackupPath = quoteSqlString(backupPath);
  await getsql().query(`
    RESTORE VERIFYONLY
    FROM DISK = ${safeBackupPath}
    WITH CHECKSUM;
  `);

  return {
    verified: true,
    path: backupPath,
    size: stat.size,
  };
}

async function executeSqlBackup(databaseName, backupPath) {
  const safeDatabaseName = quoteIdentifier(databaseName);
  const safeBackupPath = quoteSqlString(backupPath);

  await getsql().query(`
    BACKUP DATABASE ${safeDatabaseName}
    TO DISK = ${safeBackupPath}
    WITH COPY_ONLY, INIT, CHECKSUM, STATS = 10;
  `);

  return await verifyBackupFile(backupPath);
}

async function copyBackupToDocuments(sourcePath, destinationPath) {
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.promises.copyFile(sourcePath, destinationPath);

  const sourceStat = await fs.promises.stat(sourcePath);
  const destinationStat = await fs.promises.stat(destinationPath);

  if (!destinationStat.isFile() || destinationStat.size <= 0) {
    throw new Error("SQL backup copy was created but is empty.");
  }

  if (sourceStat.size !== destinationStat.size) {
    throw new Error("SQL backup copy size does not match the verified source backup.");
  }

  return {
    path: destinationPath,
    size: destinationStat.size,
    verifiedSourcePath: sourcePath,
  };
}

async function cleanupFallbackSource(sourcePath) {
  if (!sourcePath) return;
  try {
    await fs.promises.unlink(sourcePath);
  } catch (cleanupError) {
    console.warn(
      `[WARN] Verified temporary SQL backup retained at ${sourcePath}:`,
      cleanupError.message,
    );
  }
}

async function runFullDatabaseBackup(sqlBackupRoot) {
  if (backupInProgress) {
    return {
      success: false,
      skipped: true,
      message: "SQL backup already running.",
    };
  }

  backupInProgress = true;

  try {
    if (!sqlBackupRoot) {
      throw new Error("SQL backup destination is not configured.");
    }

    const databaseName = await getCurrentDatabaseName();
    const { date, time } = getLocalStamp();

    await ensureSqlServerCanWrite(sqlBackupRoot);

    const dateFolder = path.join(sqlBackupRoot, date);
    await fs.promises.mkdir(dateFolder, { recursive: true });

    const fileName = `${databaseName}_${date}_${time}.bak`;
    const documentsBackupPath = path.join(dateFolder, fileName);

    try {
      const verification = await executeSqlBackup(databaseName, documentsBackupPath);

      console.log(
        `[OK] Full SQL backup created and verified: ${documentsBackupPath}`,
      );

      return {
        success: true,
        verified: true,
        path: documentsBackupPath,
        size: verification.size,
        usedFallback: false,
      };
    } catch (directError) {
      console.warn(
        "[WARN] SQL Server could not write directly to Documents. Trying its default backup directory.",
        directError.message,
      );
    }

    const defaultBackupPath = await getSqlDefaultBackupPath();
    if (!defaultBackupPath) {
      throw new Error(
        "SQL Server default backup path is unavailable and direct Documents backup was denied.",
      );
    }

    const sqlServerBackupPath = path.join(defaultBackupPath, fileName);
    const sourceVerification = await executeSqlBackup(
      databaseName,
      sqlServerBackupPath,
    );

    let copyResult;
    try {
      copyResult = await copyBackupToDocuments(
        sqlServerBackupPath,
        documentsBackupPath,
      );
    } catch (copyError) {
      throw new Error(
        `SQL Server created and verified the backup at ${sqlServerBackupPath}, ` +
          `but Windows denied this app permission to copy it into Documents. ` +
          `Data cleanup will NOT run. Details: ${copyError.message}`,
      );
    }

    // STRICT SAFETY RULE:
    // The exact customer-facing .bak in Documents must itself pass SQL Server
    // RESTORE VERIFYONLY before this backup is considered eligible for cleanup.
    // Source verification + matching file size is NOT enough to permit DELETE.
    let destinationVerification;
    try {
      destinationVerification = await verifyBackupFile(documentsBackupPath);
    } catch (destinationVerifyError) {
      throw new Error(
        `The SQL backup source was created and verified at ${sqlServerBackupPath}, ` +
          `and a copy was written to ${documentsBackupPath}, but the final Documents ` +
          `.bak could not pass RESTORE VERIFYONLY. Data cleanup will NOT run. ` +
          `The verified SQL Server source backup has been retained. Details: ` +
          destinationVerifyError.message,
      );
    }

    // Remove the temporary SQL Server-side source only after the final Documents
    // copy has independently passed RESTORE VERIFYONLY.
    await cleanupFallbackSource(sqlServerBackupPath);

    console.log(
      `[OK] Full SQL backup created and verified: ${documentsBackupPath}`,
    );

    return {
      success: true,
      verified: true,
      path: documentsBackupPath,
      size: destinationVerification.size || copyResult.size || sourceVerification.size,
      usedFallback: true,
      verificationMethod: "RESTORE_VERIFYONLY",
    };
  } catch (error) {
    console.error("[ERROR] Full SQL backup failed:", error);
    return {
      success: false,
      verified: false,
      message: error?.message || "Full SQL backup failed.",
    };
  } finally {
    backupInProgress = false;
  }
}

async function ensureBackupSettingsRow() {
  await getsql().query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.backup_settings WHERE id = 1)
    BEGIN
      INSERT INTO dbo.backup_settings (
        id,
        enabled,
        backup_time,
        backup_interval_days,
        delete_after_backup,
        delete_older_than_days,
        last_status,
        last_message,
        updated_at
      )
      VALUES (
        1,
        1,
        '10:00:00',
        7,
        0,
        30,
        'NOT_RUN',
        'Automatic backup has not run yet.',
        SYSDATETIME()
      );
    END;
  `);
}

async function getBackupSettings() {
  await ensureBackupSettingsRow();

  const result = await getsql().query(`
    SELECT TOP (1)
      id,
      enabled,
      CONVERT(varchar(5), backup_time, 108) AS backup_time,
      backup_interval_days,
      delete_after_backup,
      delete_older_than_days,
      last_successful_backup,
      last_verified_backup_path,
      last_cleanup_at,
      last_deleted_rows,
      last_status,
      last_message,
      updated_at
    FROM dbo.backup_settings
    WHERE id = 1;
  `);

  const row = result?.recordset?.[0];
  if (!row) {
    throw new Error("Backup settings are unavailable.");
  }

  const nextBackup = calculateNextBackup(
    row.last_successful_backup,
    row.backup_interval_days,
    row.backup_time,
  );

  return {
    enabled: Boolean(row.enabled),
    backupTime: normalizeTime(row.backup_time) || "10:00",
    backupIntervalDays: Number(row.backup_interval_days) || 7,
    deleteAfterBackup: Boolean(row.delete_after_backup),
    deleteOlderThanDays: Number(row.delete_older_than_days) || 30,
    lastSuccessfulBackup: asIso(row.last_successful_backup),
    lastVerifiedBackupPath: row.last_verified_backup_path || null,
    lastCleanupAt: asIso(row.last_cleanup_at),
    lastDeletedRows: Number(row.last_deleted_rows || 0),
    lastStatus: row.last_status || "NOT_RUN",
    lastMessage: row.last_message || "",
    nextBackup: nextBackup ? nextBackup.toISOString() : null,
  };
}

async function saveBackupSettings(data) {
  const backupTime = normalizeTime(data?.backupTime);
  const intervalDays = Number(data?.backupIntervalDays);
  const retentionDays = Number(data?.deleteOlderThanDays);
  const enabled = data?.enabled ? 1 : 0;
  const deleteAfterBackup = data?.deleteAfterBackup ? 1 : 0;

  if (!backupTime) {
    throw new Error("Invalid backup time.");
  }

  if (!ALLOWED_INTERVALS.includes(intervalDays)) {
    throw new Error("Backup frequency must be 7, 15, or 30 days.");
  }

  if (!ALLOWED_RETENTION_DAYS.includes(retentionDays)) {
    throw new Error("Data retention must be 7, 15, or 30 days.");
  }

  await ensureBackupSettingsRow();

  const request = await getsql().request();
  request.input("enabled", mssql.Bit, enabled);
  request.input("backupTime", mssql.VarChar(5), backupTime);
  request.input("intervalDays", mssql.Int, intervalDays);
  request.input("deleteAfterBackup", mssql.Bit, deleteAfterBackup);
  request.input("retentionDays", mssql.Int, retentionDays);

  await request.query(`
    UPDATE dbo.backup_settings
    SET
      enabled = @enabled,
      backup_time = CAST(@backupTime AS time(0)),
      backup_interval_days = @intervalDays,
      delete_after_backup = @deleteAfterBackup,
      delete_older_than_days = @retentionDays,
      updated_at = SYSDATETIME()
    WHERE id = 1;
  `);

  // A user settings change is an intentional action, so allow the next due
  // scheduler check to retry immediately instead of honoring an old failure cooldown.
  lastBackupFailureAt = null;

  return await getBackupSettings();
}

async function setBackupStatus({
  status,
  message,
  successfulAt,
  verifiedBackupPath,
  cleanupAt,
  deletedRows,
}) {
  await ensureBackupSettingsRow();

  const request = await getsql().request();
  request.input("status", mssql.VarChar(50), status || "UNKNOWN");
  request.input("message", mssql.NVarChar(1000), message || "");
  request.input(
    "successfulAt",
    mssql.DateTime2,
    successfulAt instanceof Date ? successfulAt : null,
  );
  request.input(
    "verifiedBackupPath",
    mssql.NVarChar(1000),
    verifiedBackupPath || null,
  );
  request.input(
    "cleanupAt",
    mssql.DateTime2,
    cleanupAt instanceof Date ? cleanupAt : null,
  );
  request.input(
    "deletedRows",
    mssql.BigInt,
    Number.isFinite(Number(deletedRows)) ? Number(deletedRows) : null,
  );

  await request.query(`
    UPDATE dbo.backup_settings
    SET
      last_status = @status,
      last_message = @message,
      last_successful_backup = COALESCE(@successfulAt, last_successful_backup),
      last_verified_backup_path = COALESCE(@verifiedBackupPath, last_verified_backup_path),
      last_cleanup_at = COALESCE(@cleanupAt, last_cleanup_at),
      last_deleted_rows = COALESCE(@deletedRows, last_deleted_rows),
      updated_at = SYSDATETIME()
    WHERE id = 1;
  `);
}

async function getMachineDateColumns() {
  const result = await getsql().query(`
    SELECT
      t.TABLE_NAME,
      c.COLUMN_NAME,
      LOWER(c.DATA_TYPE) AS DATA_TYPE,
      c.ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.TABLES t
    LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
      ON c.TABLE_SCHEMA = t.TABLE_SCHEMA
      AND c.TABLE_NAME = t.TABLE_NAME
      AND LOWER(c.DATA_TYPE) IN (
        'date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset'
      )
    WHERE t.TABLE_SCHEMA = 'dbo'
      AND t.TABLE_TYPE = 'BASE TABLE'
      AND (
        t.TABLE_NAME LIKE 'DXP%'
        OR t.TABLE_NAME LIKE 'MD%'
        OR t.TABLE_NAME LIKE 'MES%'
      )
    ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION;
  `);

  const tableMap = new Map();

  for (const row of result?.recordset || []) {
    if (!tableMap.has(row.TABLE_NAME)) {
      tableMap.set(row.TABLE_NAME, []);
    }

    if (row.COLUMN_NAME && DATE_TYPES.has(String(row.DATA_TYPE).toLowerCase())) {
      tableMap.get(row.TABLE_NAME).push({
        name: row.COLUMN_NAME,
        dataType: String(row.DATA_TYPE).toLowerCase(),
      });
    }
  }

  return tableMap;
}

function getPreferredDateColumn(columns) {
  const names = columns.map((column) => column.name);
  const preferredNames = [
    "Date_Time",
    "DateTime",
    "Created_At",
    "created_at",
    "Date",
    "date",
  ];

  for (const preferred of preferredNames) {
    const match = names.find(
      (name) => String(name).toLowerCase() === preferred.toLowerCase(),
    );
    if (match) return match;
  }

  return names[0] || "";
}

async function getBackupTableSettings() {
  const tableMap = await getMachineDateColumns();

  const configured = await getsql().query(`
    SELECT table_name, cleanup_enabled, date_column
    FROM dbo.backup_table_settings;
  `);

  const configuredMap = new Map(
    (configured?.recordset || []).map((row) => [row.table_name, row]),
  );

  return Array.from(tableMap.entries()).map(([tableName, dateColumns]) => {
    const saved = configuredMap.get(tableName);
    const availableNames = dateColumns.map((column) => column.name);

    let dateColumn = saved?.date_column || "";
    if (!availableNames.includes(dateColumn)) {
      dateColumn = getPreferredDateColumn(dateColumns);
    }

    return {
      TABLE_NAME: tableName,
      cleanupEnabled: Boolean(saved?.cleanup_enabled) && Boolean(dateColumn),
      dateColumn,
      dateColumns,
      canCleanup: dateColumns.length > 0,
    };
  });
}

async function saveBackupTableSetting(data) {
  const tableName = String(data?.tableName || "").trim();
  const dateColumn = String(data?.dateColumn || "").trim();
  const cleanupEnabled = Boolean(data?.cleanupEnabled);

  if (!tableName) {
    throw new Error("Machine table name is required.");
  }

  const tableMap = await getMachineDateColumns();
  const dateColumns = tableMap.get(tableName);

  if (!dateColumns) {
    throw new Error("Machine table does not exist or is not eligible for cleanup.");
  }

  const validDateColumn = dateColumns.some(
    (column) => column.name === dateColumn,
  );

  if (cleanupEnabled && !validDateColumn) {
    throw new Error(
      "Select a valid date column before enabling automatic data deletion.",
    );
  }

  const request = await getsql().request();
  request.input("tableName", mssql.NVarChar(128), tableName);
  request.input(
    "dateColumn",
    mssql.NVarChar(128),
    validDateColumn ? dateColumn : null,
  );
  request.input("cleanupEnabled", mssql.Bit, cleanupEnabled ? 1 : 0);

  await request.query(`
    IF EXISTS (
      SELECT 1 FROM dbo.backup_table_settings WHERE table_name = @tableName
    )
    BEGIN
      UPDATE dbo.backup_table_settings
      SET
        cleanup_enabled = @cleanupEnabled,
        date_column = @dateColumn,
        updated_at = SYSDATETIME()
      WHERE table_name = @tableName;
    END
    ELSE
    BEGIN
      INSERT INTO dbo.backup_table_settings (
        table_name,
        cleanup_enabled,
        date_column,
        updated_at
      )
      VALUES (
        @tableName,
        @cleanupEnabled,
        @dateColumn,
        SYSDATETIME()
      );
    END;
  `);

  return {
    success: true,
    tableName,
    cleanupEnabled,
    dateColumn: validDateColumn ? dateColumn : "",
  };
}

async function cleanupOneTable(tableName, dateColumn, retentionDays) {
  const safeTable = quoteIdentifier(tableName);
  const safeColumn = quoteIdentifier(dateColumn);
  const batchSize = 5000;
  let totalDeleted = 0;

  while (true) {
    const request = await getsql().request();
    request.input("retentionDays", mssql.Int, Number(retentionDays));

    // Use SQL Server GETDATE() so the retention cutoff is evaluated in the
    // same local clock/timezone as the machine timestamps stored in SQL.
    const result = await request.query(`
      DELETE TOP (${batchSize})
      FROM dbo.${safeTable}
      WHERE ${safeColumn} < DATEADD(DAY, -@retentionDays, GETDATE());

      SELECT @@ROWCOUNT AS deletedRows;
    `);

    const deletedRows = Number(result?.recordset?.[0]?.deletedRows || 0);
    totalDeleted += deletedRows;

    if (deletedRows < batchSize) break;
  }

  return totalDeleted;
}

async function cleanupOldMachineData(retentionDays) {
  if (!ALLOWED_RETENTION_DAYS.includes(Number(retentionDays))) {
    throw new Error("Invalid data retention period.");
  }

  const tableMap = await getMachineDateColumns();
  const configured = await getsql().query(`
    SELECT table_name, date_column
    FROM dbo.backup_table_settings
    WHERE cleanup_enabled = 1;
  `);

  const cutoffResult = await getsql().query(`
    SELECT CONVERT(varchar(19), DATEADD(DAY, -${Number(retentionDays)}, GETDATE()), 120) AS cutoffValue;
  `);
  const cutoffValue = cutoffResult?.recordset?.[0]?.cutoffValue || null;

  let totalDeletedRows = 0;
  const tableResults = [];
  const errors = [];
  const validConfigs = [];

  // Validate every configured table/column before the first DELETE statement.
  // A stale/invalid cleanup configuration blocks the whole cleanup run.
  for (const row of configured?.recordset || []) {
    const tableName = row.table_name;
    const dateColumn = row.date_column;
    const availableColumns = tableMap.get(tableName) || [];
    const valid = availableColumns.some((column) => column.name === dateColumn);

    if (!valid) {
      errors.push(`${tableName}: configured date column is no longer valid`);
    } else {
      validConfigs.push({ tableName, dateColumn });
    }
  }

  if (errors.length) {
    return {
      success: false,
      partial: false,
      cutoffDate: cutoffValue,
      totalDeletedRows: 0,
      tableResults: [],
      errors,
    };
  }

  for (const { tableName, dateColumn } of validConfigs) {
    try {
      const deletedRows = await cleanupOneTable(
        tableName,
        dateColumn,
        retentionDays,
      );

      totalDeletedRows += deletedRows;
      tableResults.push({ tableName, dateColumn, deletedRows });
      console.log(
        `[OK] Cleanup ${tableName}: ${deletedRows} rows older than ${retentionDays} days deleted.`,
      );
    } catch (error) {
      errors.push(`${tableName}: ${error.message}`);
      break;
    }
  }

  return {
    success: errors.length === 0,
    partial: errors.length > 0 && tableResults.length > 0,
    cutoffDate: cutoffValue,
    totalDeletedRows,
    tableResults,
    errors,
  };
}

async function findLatestPhysicalBackup(sqlBackupRoot, databaseName) {
  try {
    if (!sqlBackupRoot || !fs.existsSync(sqlBackupRoot)) return null;

    const dateFolders = await fs.promises.readdir(sqlBackupRoot, {
      withFileTypes: true,
    });

    const candidates = [];

    for (const folder of dateFolders) {
      if (!folder.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(folder.name)) {
        continue;
      }

      const folderPath = path.join(sqlBackupRoot, folder.name);
      const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.toLowerCase().endsWith(".bak")) continue;
        if (!entry.name.startsWith(`${databaseName}_`)) continue;

        const fullPath = path.join(folderPath, entry.name);
        const stat = await fs.promises.stat(fullPath);
        if (!stat.isFile() || stat.size <= 0) continue;

        candidates.push({
          path: fullPath,
          size: stat.size,
          mtime: stat.mtime,
        });
      }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return candidates[0];
  } catch (error) {
    console.warn("[WARN] Could not inspect SQL backup files:", error.message);
    return null;
  }
}

async function getVerifiedLastBackup(sqlBackupRoot, settings) {
  const configuredPath = settings.lastVerifiedBackupPath;

  if (configuredPath) {
    try {
      const stat = await fs.promises.stat(configuredPath);
      if (stat.isFile() && stat.size > 0 && settings.lastSuccessfulBackup) {
        return {
          path: configuredPath,
          size: stat.size,
          date: new Date(settings.lastSuccessfulBackup),
          recovered: false,
        };
      }
    } catch (_) {
      // Missing configured .bak must not be trusted.
    }
  }

  const databaseName = await getCurrentDatabaseName();
  const latestPhysical = await findLatestPhysicalBackup(
    sqlBackupRoot,
    databaseName,
  );

  if (!latestPhysical) return null;

  try {
    await verifyBackupFile(latestPhysical.path);
    return {
      ...latestPhysical,
      date: latestPhysical.mtime,
      recovered: true,
    };
  } catch (error) {
    console.warn(
      `[WARN] Existing .bak file failed verification and will not satisfy the schedule: ${latestPhysical.path}`,
      error.message,
    );
    return null;
  }
}

async function runBackupAndCleanup({ sqlBackupRoot, settings }) {
  await setBackupStatus({
    status: "BACKUP_RUNNING",
    message: "Creating full SQL backup. No data will be deleted until verification passes.",
  });

  const backupResult = await runFullDatabaseBackup(sqlBackupRoot);

  if (!backupResult.success || !backupResult.verified || !backupResult.path) {
    await setBackupStatus({
      status: "BACKUP_FAILED",
      message:
        backupResult.message ||
        "Backup failed or was not verified. Database cleanup was cancelled.",
    });

    lastBackupFailureAt = new Date();

    return {
      ...backupResult,
      cleanupRan: false,
      cleanupBlocked: true,
    };
  }

  // Mandatory second gate immediately before any DELETE statement.
  // No fallback, size-only, or state-file shortcut is allowed here: the exact
  // final .bak path must pass RESTORE VERIFYONLY again.
  try {
    await verifyBackupFile(backupResult.path);
  } catch (verificationError) {
    await setBackupStatus({
      status: "VERIFY_FAILED",
      message: `Backup verification failed. Database cleanup was cancelled: ${verificationError.message}`,
    });

    lastBackupFailureAt = new Date();

    return {
      success: false,
      verified: false,
      path: backupResult.path,
      message: verificationError.message,
      cleanupRan: false,
      cleanupBlocked: true,
    };
  }

  // Final backup verification passed, so clear any prior backup failure cooldown.
  lastBackupFailureAt = null;
  const successfulAt = new Date();

  await setBackupStatus({
    status: "BACKUP_VERIFIED",
    message: "Full SQL backup created and verified successfully.",
    successfulAt,
    verifiedBackupPath: backupResult.path,
    deletedRows: 0,
  });

  if (!settings.deleteAfterBackup) {
    await setBackupStatus({
      status: "SUCCESS",
      message: "Backup verified successfully. Automatic data deletion is disabled.",
      successfulAt,
      verifiedBackupPath: backupResult.path,
      deletedRows: 0,
    });

    return {
      ...backupResult,
      cleanupRan: false,
      deletedRows: 0,
    };
  }

  const cleanupResult = await cleanupOldMachineData(
    settings.deleteOlderThanDays,
  );

  const cleanupAt = new Date();

  if (!cleanupResult.success) {
    const message = cleanupResult.partial
      ? `Backup verified. Cleanup partially completed; ${cleanupResult.totalDeletedRows} rows deleted. Errors: ${cleanupResult.errors.join(" | ")}`
      : `Backup verified, but cleanup failed before completing. Errors: ${cleanupResult.errors.join(" | ")}`;

    await setBackupStatus({
      status: cleanupResult.partial ? "CLEANUP_PARTIAL" : "CLEANUP_FAILED",
      message,
      successfulAt,
      verifiedBackupPath: backupResult.path,
      cleanupAt,
      deletedRows: cleanupResult.totalDeletedRows,
    });

    return {
      ...backupResult,
      cleanupRan: true,
      cleanup: cleanupResult,
      deletedRows: cleanupResult.totalDeletedRows,
    };
  }

  await setBackupStatus({
    status: "SUCCESS",
    message: `Backup verified. Old data cleanup completed successfully. ${cleanupResult.totalDeletedRows} rows deleted.`,
    successfulAt,
    verifiedBackupPath: backupResult.path,
    cleanupAt,
    deletedRows: cleanupResult.totalDeletedRows,
  });

  return {
    ...backupResult,
    cleanupRan: true,
    cleanup: cleanupResult,
    deletedRows: cleanupResult.totalDeletedRows,
  };
}

async function runBackupIfDueInternal({ sqlBackupRoot }) {
  const settings = await getBackupSettings();

  if (!settings.enabled) {
    return {
      success: true,
      skipped: true,
      message: "Automatic SQL backup is disabled.",
    };
  }

  const now = new Date();

  // The exact backup path recorded as the last successful backup must still
  // physically exist and be non-empty. Do not silently substitute an older
  // backup when the recorded successful file was removed.
  let configuredBackupMissing = false;
  if (settings.lastSuccessfulBackup && settings.lastVerifiedBackupPath) {
    try {
      const stat = await fs.promises.stat(settings.lastVerifiedBackupPath);
      configuredBackupMissing = !stat.isFile() || stat.size <= 0;
    } catch (_) {
      configuredBackupMissing = true;
    }
  }

  const lastBackup = await getVerifiedLastBackup(sqlBackupRoot, settings);

  if (lastBackup?.recovered) {
    await setBackupStatus({
      status: "SUCCESS",
      message: "Existing verified backup file was detected and schedule state was recovered.",
      successfulAt: lastBackup.date,
      verifiedBackupPath: lastBackup.path,
    });

    settings.lastSuccessfulBackup = lastBackup.date.toISOString();
    settings.lastVerifiedBackupPath = lastBackup.path;
  }

  let due = configuredBackupMissing;

  if (!due && lastBackup) {
    const nextBackup = calculateNextBackup(
      lastBackup.date,
      settings.backupIntervalDays,
      settings.backupTime,
    );
    due = Boolean(nextBackup && now >= nextBackup);
  }

  if (!due && !lastBackup) {
    due = isConfiguredTimeReachedToday(settings.backupTime, now);
  }

  if (!due) {
    return {
      success: true,
      skipped: true,
      message: "SQL backup is not due yet.",
      nextBackup: lastBackup
        ? asIso(
            calculateNextBackup(
              lastBackup.date,
              settings.backupIntervalDays,
              settings.backupTime,
            ),
          )
        : null,
    };
  }

  if (
    lastBackupFailureAt &&
    now.getTime() - lastBackupFailureAt.getTime() < FAILURE_RETRY_MS
  ) {
    const retryAt = new Date(lastBackupFailureAt.getTime() + FAILURE_RETRY_MS);
    return {
      success: false,
      skipped: true,
      retryAfter: retryAt.toISOString(),
      message:
        "The previous SQL backup attempt failed. Waiting 30 minutes before retrying to avoid creating large backup files every minute.",
    };
  }

  if (configuredBackupMissing) {
    console.warn(
      "[WARN] Last successful backup record exists, but the physical .bak file is missing/invalid. Creating a replacement before any cleanup.",
    );
  } else {
    console.log(
      `[INFO] SQL backup is due (${settings.backupIntervalDays}-day interval, configured time ${settings.backupTime}).`,
    );
  }

  return await runBackupAndCleanup({ sqlBackupRoot, settings });
}

async function runBackupIfDue(args) {
  if (backupCycleInProgress) {
    return {
      success: true,
      skipped: true,
      message: "Backup/cleanup cycle is already running.",
    };
  }

  backupCycleInProgress = true;
  try {
    return await runBackupIfDueInternal(args);
  } finally {
    backupCycleInProgress = false;
  }
}

function startDatabaseBackupScheduler({ sqlBackupRoot }) {
  // The user can change backup time and 7/15/30-day frequency at runtime.
  // Therefore a lightweight once-per-minute cron reads the latest DB settings
  // and only starts a backup when the configured date/time is actually due.
  cron.schedule(
    "* * * * *",
    () => {
      runBackupIfDue({ sqlBackupRoot }).catch((error) => {
        console.error("[ERROR] Scheduled SQL backup check failed:", error);
      });
    },
    { timezone: "Asia/Kolkata" },
  );

  // Catch up safely when the app/PC was closed at the configured time.
  setTimeout(() => {
    runBackupIfDue({ sqlBackupRoot }).catch((error) => {
      console.error("[ERROR] Startup SQL backup check failed:", error);
    });
  }, 5000);
}

module.exports = {
  runFullDatabaseBackup,
  runBackupIfDue,
  startDatabaseBackupScheduler,
  getBackupSettings,
  saveBackupSettings,
  getBackupTableSettings,
  saveBackupTableSetting,
  verifyBackupFile,
};
