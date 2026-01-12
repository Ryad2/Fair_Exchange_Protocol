const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
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

function getApiBaseUrl() {
    return process.env.NEXTJS_URL || 'http://localhost:3000';
}

async function uploadCiphertext(filePath, contractId) {
    if (!filePath || !contractId) {
        throw new Error('Missing filePath or contractId');
    }
    if (!fs.existsSync(filePath)) {
        throw new Error(`Ciphertext file not found: ${filePath}`);
    }

    const url = new URL(`/api/files/${contractId}`, getApiBaseUrl());
    const stat = fs.statSync(filePath);
    const transport = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const req = transport.request(
            {
                method: 'PUT',
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': stat.size,
                },
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => {
                    body += chunk.toString();
                });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(body ? JSON.parse(body) : { ok: true });
                        } catch {
                            resolve({ ok: true });
                        }
                        return;
                    }
                    reject(new Error(`Upload failed (${res.statusCode}): ${body.slice(0, 200)}`));
                });
            }
        );

        req.on('error', reject);
        fs.createReadStream(filePath).pipe(req);
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

ipcMain.handle('uploadCiphertext', async (_event, payload) => {
    try {
        const { filePath, contractId } = payload || {};
        const result = await uploadCiphertext(filePath, contractId);
        return { success: true, result };
    } catch (error) {
        return {
            success: false,
            error: error.message || 'Erreur inconnue lors de l’upload',
        };
    }
});
