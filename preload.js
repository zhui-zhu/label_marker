const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    exportAnnotations: (data) => ipcRenderer.invoke('export-annotations', data),
    importAnnotations: () => ipcRenderer.invoke('import-annotations'),
    saveAutosave: (data) => ipcRenderer.invoke('save-autosave', data),
    loadAutosave: (edfFileName) => ipcRenderer.invoke('load-autosave', edfFileName),
    clearAutosave: (edfFileName) => ipcRenderer.invoke('clear-autosave', edfFileName),
    getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
    openRecentFile: (filePath) => ipcRenderer.invoke('open-recent-file', filePath),
    addRecentFile: (filePath, fileName, fileSize) => ipcRenderer.invoke('add-recent-file', filePath, fileName, fileSize),

    onFileOpened: (callback) => {
        ipcRenderer.on('edf-file-opened', (event, data) => callback(data));
    },
    onAnnotationsImported: (callback) => {
        ipcRenderer.on('annotations-imported', (event, data) => callback(data));
    },
    onMenuExport: (callback) => {
        ipcRenderer.on('menu-export', () => callback());
    },
});
