const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    exportAnnotations: (data) => ipcRenderer.invoke('export-annotations', data),
    importAnnotations: () => ipcRenderer.invoke('import-annotations'),

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
