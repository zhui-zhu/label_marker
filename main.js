const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 900,
        minWidth: 1024,
        minHeight: 600,
        title: 'EEG 波形标注工具',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        backgroundColor: '#1a1a2e',
    });

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    buildMenu();
}

function buildMenu() {
    const template = [
        {
            label: '文件',
            submenu: [
                {
                    label: '打开EDF...',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => openFileFromMenu(),
                },
                { type: 'separator' },
                {
                    label: '导出标注...',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => mainWindow.webContents.send('menu-export'),
                },
                {
                    label: '导入标注...',
                    accelerator: 'CmdOrCtrl+I',
                    click: () => importAnnotationsFromMenu(),
                },
                { type: 'separator' },
                {
                    label: '退出',
                    accelerator: 'CmdOrCtrl+Q',
                    role: 'quit',
                },
            ],
        },
        {
            label: '视图',
            submenu: [
                {
                    label: '重新加载',
                    accelerator: 'CmdOrCtrl+R',
                    role: 'reload',
                },
                {
                    label: '强制重新加载',
                    accelerator: 'CmdOrCtrl+Shift+R',
                    role: 'forceReload',
                },
                {
                    label: '开发者工具',
                    accelerator: 'F12',
                    role: 'toggleDevTools',
                },
                { type: 'separator' },
                {
                    label: '重置缩放',
                    accelerator: 'CmdOrCtrl+0',
                    role: 'resetZoom',
                },
                {
                    label: '放大',
                    accelerator: 'CmdOrCtrl+Plus',
                    role: 'zoomIn',
                },
                {
                    label: '缩小',
                    accelerator: 'CmdOrCtrl+-',
                    role: 'zoomOut',
                },
                { type: 'separator' },
                {
                    label: '全屏',
                    accelerator: 'F11',
                    role: 'togglefullscreen',
                },
            ],
        },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

function readFileBuffer(filePath) {
    return fs.readFileSync(filePath);
}

async function openFileFromMenu() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '打开EDF文件',
        filters: [
            { name: 'EDF文件', extensions: ['edf', 'EDF', 'bdf', 'BDF'] },
            { name: '所有文件', extensions: ['*'] },
        ],
        properties: ['openFile', 'multiSelections'],
    });

    if (result.canceled || result.filePaths.length === 0) return;

    for (const filePath of result.filePaths) {
        const buf = readFileBuffer(filePath);
        mainWindow.webContents.send('edf-file-opened', {
            name: path.basename(filePath),
            size: buf.length,
            data: buf,
        });
    }
}

async function importAnnotationsFromMenu() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '导入标注',
        filters: [
            { name: '文本文件', extensions: ['txt', 'csv'] },
            { name: '所有文件', extensions: ['*'] },
        ],
        properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) return;

    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    mainWindow.webContents.send('annotations-imported', { content });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => { app.quit(); });

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '打开EDF文件',
        filters: [
            { name: 'EDF文件', extensions: ['edf', 'EDF', 'bdf', 'BDF'] },
            { name: '所有文件', extensions: ['*'] },
        ],
        properties: ['openFile', 'multiSelections'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const files = [];
    for (const filePath of result.filePaths) {
        const buf = readFileBuffer(filePath);
        files.push({
            name: path.basename(filePath),
            size: buf.length,
            data: buf,
        });
    }
    return files;
});

ipcMain.handle('export-annotations', async (event, data) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出标注',
        defaultPath: data.fileName ? data.fileName.replace(/\.edf$/i, '') + '_labels.txt' : 'annotations.txt',
        filters: [
            { name: '文本文件', extensions: ['txt'] },
            { name: 'CSV文件', extensions: ['csv'] },
        ],
    });

    if (result.canceled) return false;

    fs.writeFileSync(result.filePath, data.content, 'utf-8');
    return true;
});

ipcMain.handle('import-annotations', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '导入标注',
        filters: [
            { name: '文本文件', extensions: ['txt', 'csv'] },
            { name: '所有文件', extensions: ['*'] },
        ],
        properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    return fs.readFileSync(result.filePaths[0], 'utf-8');
});
