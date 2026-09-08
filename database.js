const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron/main");
const path = require("path");
const fs = require("fs");

// Avoid Chromium cache permission/locking issues on Windows.
// Keep development and installed builds on separate writable cache folders.
const sessionDataPath = path.join(
  app.getPath("cache"),
  app.isPackaged ? "IgarashiRSI" : "IgarashiRSI-Dev",
  "SessionData",
);
fs.mkdirSync(sessionDataPath, { recursive: true });
app.setPath("sessionData", sessionDataPath);

// Prevent random GPU rendering blocks seen on some customer PCs.
app.disableHardwareAcceleration();

const getOutputPaths = () => {
  const documentsPath = app.getPath("documents");
  const rootPath = path.join(documentsPath, "Igarashi");

  return {
    rootPath,
    backupRoot: path.join(rootPath, "Backup"),
    sqlBackupRoot: path.join(rootPath, "Backup", "SQL"),
    traceabilityRoot: path.join(rootPath, "Traceability"),
  };
};

const getLocalDateFolderName = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const ensureOutputFolders = () => {
  const outputPaths = getOutputPaths();
  fs.mkdirSync(outputPaths.backupRoot, { recursive: true });
  fs.mkdirSync(outputPaths.sqlBackupRoot, { recursive: true });
  fs.mkdirSync(outputPaths.traceabilityRoot, { recursive: true });
  return outputPaths;
};

const {
  getdata,
  createExcel_concurrent,
  createPDF_concurrent,
  gettable_name,
  gettable_structure,
  add_template,
  get_excel_template,
  adduser,
  getusers,
  deleteuser,
  updateuser,
  checkexistuser,
  userlogin,
  tablerename,
  gettablename,
  checkexisttable,
  getactivetable,
  getassemblytable,
  checkexisttemplate,
  deletetemplate,
  editedTemplates,
  getdmcdata,
  assemblytablerename,
  getAssemblytablename,
  checkexistassemblytable,
  getAssemblyDatas,
} = require("./api");

require("./sqlConnection.js");
const { ensureAppSchema } = require("./dbBootstrap.js");
const {
  startDatabaseBackupScheduler,
  getBackupSettings,
  saveBackupSettings,
  getBackupTableSettings,
  saveBackupTableSetting,
} = require("./databaseBackup.js");

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
};

app.whenReady().then(async () => {
  try {
    await ensureAppSchema();
  } catch (error) {
    console.error(" Database schema initialization failed:", error);
    dialog.showErrorBox(
      "Database Setup Error",
      `${error.message}\n\nIf this SQL login has only read/write access, run Server\\DB_SETUP.sql once from SSMS using an administrator account.`,
    );
    app.quit();
    return;
  }
  // Keep all user-generated output outside app.asar/application folders.
  // Windows resolves this to the user's real Documents directory.
  const outputPaths = ensureOutputFolders();

  startDatabaseBackupScheduler({
    sqlBackupRoot: outputPaths.sqlBackupRoot,
    stateRoot: app.getPath("userData"),
  });

  ipcMain.handle("ping", async (event, data) => {
    console.log("data Excel :", data);
    const { backupRoot } = ensureOutputFolders();
    return await createExcel_concurrent({ ...data, outputRoot: backupRoot });
  });

  ipcMain.handle("exportPdf", async (event, data) => {
    const js = { date_field: "Date_Time" };
    const { backupRoot } = ensureOutputFolders();
    return await createPDF_concurrent({ ...data, outputRoot: backupRoot }, js);
  });

  ipcMain.handle("openfolder", async (event, data) => {
    try {
      if (typeof data !== "string" || !data.trim()) {
        return { success: false, message: "Invalid folder path" };
      }

      const folderPath = path.resolve(data);
      const errorMessage = await shell.openPath(folderPath);

      if (errorMessage) {
        console.error("Error opening folder:", errorMessage);
        return { success: false, message: errorMessage };
      }

      return { success: true };
    } catch (error) {
      console.error("Error opening folder:", error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle("getdata", async (event, data) => {
    const result = await getdata(data);
    return result;
  });

  ipcMain.handle("gettable_name", async (event, data) => {
    const result = await gettable_name(data);

    return result;
  });

  ipcMain.handle("checkexistuser", async (event, data) => {
    const res = await checkexistuser(data);
    return res;
  });

  ipcMain.handle("checkexisttable", async (event, data) => {
    const res = await checkexisttable(data);
    return res;
  });

  ipcMain.handle("checkexistassemblytable", async (event, data) => {
    const res = await checkexistassemblytable(data);
    return res;
  });

  ipcMain.handle("userlogin", async (event, data) => {
    const res = await userlogin(data);
    return res;
  });

  ipcMain.handle("test1", () => {
    return "api call";
  });

  ipcMain.handle("excelTemplate", async (event, data) => {
    const template = await add_template(data);
    return template;
  });

  ipcMain.handle("get_excel_template", async (event, data) => {
    const result = await get_excel_template(data);
    return result;
  });

  ipcMain.handle("gettable_structure", async (event, data) => {
    const result = await gettable_structure(data);

    return result;
  });

  ipcMain.handle("adduser", async (event, data) => {
    const res = await adduser(data);
    return res;
  });

  ipcMain.handle("getusers", async (event) => {
    const res = await getusers();
    return res;
  });

  ipcMain.handle("deleteuser", async (event, data) => {
    const res = await deleteuser(data);
    return res;
  });

  ipcMain.handle("updateuser", async (event, data) => {
    const res = await updateuser(data);
    return res;
  });

  ipcMain.handle("tablerename", async (event, data) => {
    const res = await tablerename(data);
    return res;
  });

  ipcMain.handle("assemblytablerename", async (event, data) => {
    const res = await assemblytablerename(data);
    return res;
  });

  ipcMain.handle("getAssemblytablename", async (event, data) => {
    const res = await getAssemblytablename(data);
    return res;
  });

  ipcMain.handle("gettablename", async (event, data) => {
    const res = await gettablename();
    return res;
  });

  ipcMain.handle("get-backup-settings", async () => {
    return await getBackupSettings();
  });

  ipcMain.handle("save-backup-settings", async (event, data) => {
    return await saveBackupSettings(data);
  });

  ipcMain.handle("get-backup-table-settings", async () => {
    return await getBackupTableSettings();
  });

  ipcMain.handle("save-backup-table-setting", async (event, data) => {
    return await saveBackupTableSetting(data);
  });

  ipcMain.handle("getAssemblyDatas", async (event, data) => {
    const res = await getAssemblyDatas(data);
    return res;
  });

  ipcMain.handle("getactivetable", async (event) => {
    const res = await getactivetable();
    return res;
  });

  ipcMain.handle("getassemblytable", async (event, data) => {
    const res = await getassemblytable(data);
    return res;
  });

  ipcMain.handle("checkexisttemplate", async (event, data) => {
    const res = await checkexisttemplate(data);
    return res;
  });

  ipcMain.handle("editedTemplates", async (event, data) => {
    const res = await editedTemplates(data);
    return res;
  });

  ipcMain.handle("deletetemplate", async (event, data) => {
    const res = await deletetemplate(data);
    return res;
  });

  ipcMain.handle("getdmcdata", async (event, data) => {
    const res = await getdmcdata(data);
    return res;
  });

  ipcMain.handle(
    "save-traceability-excel",
    async (event, { buffer, fileName }) => {
      try {
        const { traceabilityRoot } = ensureOutputFolders();
        const today = getLocalDateFolderName();
        const todayFolder = path.join(traceabilityRoot, today);

        // Create folder recursively
        fs.mkdirSync(todayFolder, { recursive: true });

        const filePath = path.join(todayFolder, fileName);

        fs.writeFileSync(filePath, buffer);

        console.log("Saved at:", filePath);

        return { success: true, path: filePath };
      } catch (error) {
        console.error("Save Error:", error);
        return { success: false };
      }
    },
  );

  ipcMain.handle("open-traceability-folder", async () => {
    try {
      const { traceabilityRoot } = ensureOutputFolders();
      const today = getLocalDateFolderName();
      const folderPath = path.join(traceabilityRoot, today);

      if (!fs.existsSync(folderPath)) {
        return { success: false };
      }

      const openError = await shell.openPath(folderPath);
      if (openError) {
        console.error("Failed to open traceability folder:", openError);
        return { success: false, message: openError };
      }

      return { success: true };
    } catch (error) {
      console.error(error);
      return { success: false };
    }
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
