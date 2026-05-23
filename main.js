const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// 单实例锁：防止多开，第二个实例传文件路径给主实例
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 900,
        minWidth: 1024,
        minHeight: 600,
        title: 'EEG 波形标注工具',
        icon: path.join(__dirname, 'build', 'icon.png'),
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

function openFileByPath(filePath) {
    try {
        if (!fs.existsSync(filePath)) return;
        const buf = fs.readFileSync(filePath);
        const stats = fs.statSync(filePath);
        mainWindow.webContents.send('edf-file-opened', {
            name: path.basename(filePath),
            size: stats.size,
            data: buf,
            filePath: filePath,
        });
        addRecentFile(filePath, path.basename(filePath), stats.size);
    } catch (err) {
        console.error('打开文件失败:', err);
    }
}

function handleFileArgs(args) {
    for (const arg of args) {
        const ext = path.extname(arg).toLowerCase();
        if (ext === '.edf' || ext === '.bdf') {
            openFileByPath(arg);
        }
    }
}

app.whenReady().then(() => {
    createWindow();
    // 处理命令行中的文件路径（首次启动，等页面加载完再发送）
    if (process.argv.length > 1) {
        const pendingArgs = process.argv.slice(1);
        mainWindow.webContents.once('did-finish-load', () => {
            handleFileArgs(pendingArgs);
        });
    }
});

// 第二个实例启动时，将文件路径传给主实例
app.on('second-instance', (event, argv) => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        if (argv.length > 1) {
            handleFileArgs(argv.slice(1));
        }
    }
});

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
            filePath: filePath,
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

// 坏道导出
ipcMain.handle('export-bad-channels', async (event, data) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出坏道标记',
        defaultPath: data.fileName ? data.fileName.replace(/\.edf$/i, '') + '_bad.txt' : 'badchannels.txt',
        filters: [
            { name: '文本文件', extensions: ['txt'] },
            { name: 'CSV文件', extensions: ['csv'] },
        ],
    });

    if (result.canceled) return false;

    fs.writeFileSync(result.filePath, data.content, 'utf-8');
    return true;
});

// 坏道导入
ipcMain.handle('import-bad-channels', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '导入坏道标记',
        filters: [
            { name: '坏道文件', extensions: ['txt', 'csv'] },
            { name: '所有文件', extensions: ['*'] },
        ],
        properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    return fs.readFileSync(result.filePaths[0], 'utf-8');
});

function getAutosavePath(edfFileName) {
    const autosaveDir = path.join(app.getPath('userData'), 'autosave');
    if (!fs.existsSync(autosaveDir)) {
        fs.mkdirSync(autosaveDir, { recursive: true });
    }
    const safeName = edfFileName ? edfFileName.replace(/[^a-zA-Z0-9_\-\.]/g, '_') : 'unknown';
    return path.join(autosaveDir, `autosave_${safeName}.json`);
}

ipcMain.handle('save-autosave', async (event, data) => {
    try {
        const autosavePath = getAutosavePath(data.edfFileName);
        const autosaveData = {
            version: 1,
            savedAt: new Date().toISOString(),
            edfFileName: data.edfFileName || '',
            duration: data.duration || 0,
            sfreq: data.sfreq || 0,
            channels: data.channels || [],
            annotations: data.annotations || [],
            viewportStart: data.viewportStart || 0,
        };
        fs.writeFileSync(autosavePath, JSON.stringify(autosaveData, null, 2), 'utf-8');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('load-autosave', async (event, edfFileName) => {
    try {
        const autosavePath = getAutosavePath(edfFileName);
        if (!fs.existsSync(autosavePath)) {
            return { success: true, data: null };
        }
        const content = fs.readFileSync(autosavePath, 'utf-8');
        const data = JSON.parse(content);
        return { success: true, data };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('clear-autosave', async (event, edfFileName) => {
    try {
        const autosavePath = getAutosavePath(edfFileName);
        if (fs.existsSync(autosavePath)) {
            fs.unlinkSync(autosavePath);
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

function getRecentFilesPath() {
    return path.join(app.getPath('userData'), 'recent_files.json');
}

function loadRecentFiles() {
    try {
        const p = getRecentFilesPath();
        if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8');
            return JSON.parse(content);
        }
    } catch (err) {
        console.error('加载最近文件失败:', err);
    }
    return [];
}

function saveRecentFiles(files) {
    try {
        const p = getRecentFilesPath();
        fs.writeFileSync(p, JSON.stringify(files, null, 2), 'utf-8');
    } catch (err) {
        console.error('保存最近文件失败:', err);
    }
}

function addRecentFile(filePath, fileName, fileSize) {
    let files = loadRecentFiles();
    // 移除已存在的相同文件
    files = files.filter(f => f.filePath !== filePath);
    // 添加到列表开头
    files.unshift({
        filePath,
        fileName,
        fileSize,
        openedAt: new Date().toISOString(),
    });
    // 只保留最近 10 个
    if (files.length > 10) {
        files = files.slice(0, 10);
    }
    saveRecentFiles(files);
}

ipcMain.handle('get-recent-files', async () => {
    return loadRecentFiles();
});

ipcMain.handle('open-recent-file', async (event, filePath) => {
    try {
        if (!fs.existsSync(filePath)) {
            return { success: false, error: '文件不存在' };
        }
        const buf = fs.readFileSync(filePath);
        const stats = fs.statSync(filePath);
        addRecentFile(filePath, path.basename(filePath), stats.size);
        return {
            success: true,
            data: {
                name: path.basename(filePath),
                size: stats.size,
                data: buf,
                filePath: filePath,
            }
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('add-recent-file', async (event, filePath, fileName, fileSize) => {
    try {
        addRecentFile(filePath, fileName, fileSize);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
