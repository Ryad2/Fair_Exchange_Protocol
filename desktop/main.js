const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // Charger l'application web Next.js au lieu du fichier local
    const nextjsUrl = process.env.NEXTJS_URL || 'http://localhost:3000';
    mainWindow.loadURL(nextjsUrl);

    // Ouvrir les DevTools en développement
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Fonction pour exécuter le précompute
async function runPrecompute(filePath) {
    return new Promise((resolve, reject) => {
        // Chemin vers le binaire Rust precontract_cli
        // Le binaire est compilé dans src/wasm/target/release/precontract_cli
        const cliPath = path.join(__dirname, '..', 'src', 'wasm', 'target', 'release', 'precontract_cli');
        
        // Sur Windows, ajouter .exe
        const command = process.platform === 'win32' ? cliPath + '.exe' : cliPath;
        
        // Arguments: le binaire prend le fichier en premier argument (pas de --input)
        const args = [filePath];
        
        const child = spawn(command, args, {
            cwd: path.join(__dirname, '..'),
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                try {
                    const result = JSON.parse(stdout);
                    resolve({
                        success: true,
                        inputPath: filePath,
                        ...result,
                    });
                } catch (e) {
                    resolve({
                        success: true,
                        inputPath: filePath,
                        output: stdout,
                    });
                }
            } else {
                reject(new Error(stderr || `Process exited with code ${code}`));
            }
        });

        child.on('error', (error) => {
            reject(error);
        });
    });
}

// Exposer l'API au preload
const { ipcMain } = require('electron');

ipcMain.handle('precompute', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Choisir un fichier pour le précompute',
            properties: ['openFile'],
            filters: [
                { name: 'Tous les fichiers', extensions: ['*'] },
                { name: 'Fichiers binaires', extensions: ['bin', 'dat'] },
            ],
        });

        if (result.canceled) {
            return { cancelled: true };
        }

        const filePath = result.filePaths[0];
        const precomputeResult = await runPrecompute(filePath);
        
        return precomputeResult;
    } catch (error) {
        return {
            error: error.message || 'Erreur inconnue lors du précompute',
        };
    }
});
