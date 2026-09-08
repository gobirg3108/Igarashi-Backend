const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("versions", {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
  ping: (data) => ipcRenderer.invoke("ping", data),
  exportPdf: (data) => ipcRenderer.invoke("exportPdf", data),
  openfolder: (data) => ipcRenderer.invoke("openfolder", data),
 
 
  getdata: (data) => ipcRenderer.invoke("getdata", data),
  gettable_name: (data) => ipcRenderer.invoke("gettable_name", data),
  gettable_structure: (data) => ipcRenderer.invoke("gettable_structure", data),
  tets1: (data) => ipcRenderer.invoke("test1", data),
  excel_template: (data) => ipcRenderer.invoke("excelTemplate", data),
  get_excel_template: (data) => ipcRenderer.invoke("get_excel_template", data),
  adduser: (data) => ipcRenderer.invoke("adduser", data),
  getusers: (data) => ipcRenderer.invoke("getusers", data),
  updateuser: (data) => ipcRenderer.invoke("updateuser", data),
  deleteuser: (data) => ipcRenderer.invoke("deleteuser", data),
  checkexistuser: (data) => ipcRenderer.invoke("checkexistuser", data),
  userlogin: (data) => ipcRenderer.invoke("userlogin", data),
  tablerename: (data) => ipcRenderer.invoke("tablerename", data),
  assemblytablerename: (data) =>
    ipcRenderer.invoke("assemblytablerename", data),
  getAssemblytablename: (data) =>
    ipcRenderer.invoke("getAssemblytablename", data),
  gettablename: (data) => ipcRenderer.invoke("gettablename", data),
  getBackupSettings: () => ipcRenderer.invoke("get-backup-settings"),
  saveBackupSettings: (data) => ipcRenderer.invoke("save-backup-settings", data),
  getBackupTableSettings: () => ipcRenderer.invoke("get-backup-table-settings"),
  saveBackupTableSetting: (data) =>
    ipcRenderer.invoke("save-backup-table-setting", data),
  getAssemblyDatas: (data) => ipcRenderer.invoke("getAssemblyDatas", data),
  checkexisttable: (data) => ipcRenderer.invoke("checkexisttable", data),
  checkexistassemblytable: (data) =>
    ipcRenderer.invoke("checkexistassemblytable", data),
  getactivetable: (data) => ipcRenderer.invoke("getactivetable", data),
  getassemblytable: (data) => ipcRenderer.invoke("getassemblytable", data),
  checkexisttemplate: (data) => ipcRenderer.invoke("checkexisttemplate", data),
  editedTemplates: (data) => ipcRenderer.invoke("editedTemplates", data),
  deletetemplate: (data) => ipcRenderer.invoke("deletetemplate", data),
  getdmcdata: (data) => ipcRenderer.invoke("getdmcdata", data),
  saveTraceabilityExcel: (data) =>
    ipcRenderer.invoke("save-traceability-excel", data),
  openTraceabilityFolder: () => ipcRenderer.invoke("open-traceability-folder"),
});

console.log("preload loaded");
