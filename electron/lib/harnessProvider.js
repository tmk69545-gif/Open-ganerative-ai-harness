const { ipcMain, app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const {
    detectAllHarnesses,
    configureHarnessMcp,
    unconfigureHarnessMcp,
    installMuapiSkills,
    startHarnessRun,
    cancelHarnessRun,
    listModelsForHarness,
    findLocalMediaPath,
    attachLocalMediaResult,
    synthesizeSpeechToDataUrl,
    saveRenderedMedia,
} = require('../../lib/harnesses');

const CONFIG_DIR = path.join(app.getPath('userData'), 'local-ai');
const CONFIG_FILE = path.join(CONFIG_DIR, 'harnesses.json');
const RENDERS_DIR = path.join(CONFIG_DIR, 'harness-renders');

function readOverridesConfig() {
    try {
        const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        return parsed?.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {};
    } catch {
        return {};
    }
}

function writeOverridesConfig(overrides) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ overrides }, null, 2));
    return overrides;
}

function emitToWindows(channel, payload) {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    }
}

let latestRunId = null;

function register() {
    ipcMain.handle('harness:detect', async (_, opts = {}) => {
        const overrides = readOverridesConfig();
        return detectAllHarnesses({
            ...opts,
            overrides,
        });
    });

    ipcMain.handle('harness:list-models', async (_, harnessId) => {
        const overrides = readOverridesConfig();
        const report = await detectAllHarnesses({
            harnessIds: harnessId ? [harnessId] : undefined,
            overrides,
            includeModels: true,
        });
        if (harnessId) return report.harnesses[0]?.models || [];
        return Object.fromEntries(report.harnesses.map((h) => [h.id, h.models || []]));
    });

    ipcMain.handle('harness:get-overrides', () => readOverridesConfig());

    ipcMain.handle('harness:set-override', (_, { harnessId, surface, value }) => {
        if (!harnessId || !surface) throw new Error('harnessId and surface are required');
        const overrides = readOverridesConfig();
        const keyMap = { cli: 'cliPath', desktop: 'desktopPath', ide: 'idePath', config: 'configPath' };
        const field = keyMap[surface] || surface;
        const next = { ...overrides, [harnessId]: { ...(overrides[harnessId] || {}) } };
        const trimmed = String(value || '').trim();
        if (trimmed) next[harnessId][field] = trimmed;
        else delete next[harnessId][field];
        return writeOverridesConfig(next);
    });

    ipcMain.handle('harness:pick-path', async (event, opts = {}) => {
        const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
        const result = await dialog.showOpenDialog(win, {
            title: opts.title || 'Select harness executable or config file',
            properties: opts.directory ? ['openDirectory'] : ['openFile'],
        });
        if (result.canceled || !result.filePaths?.length) return null;
        return result.filePaths[0];
    });

    ipcMain.handle('harness:configure', async (_, opts = {}) => {
        if (opts.action === 'unconfigure') {
            return unconfigureHarnessMcp(opts);
        }
        return configureHarnessMcp(opts);
    });

    ipcMain.handle('harness:install-skills', async (_, opts = {}) => {
        return installMuapiSkills(opts);
    });

    ipcMain.handle('harness:run', async (_, opts = {}) => {
        const overrides = readOverridesConfig();
        const run = await startHarnessRun({
            ...opts,
            overrides,
            onEvent: (ev) => {
                latestRunId = ev.runId;
                emitToWindows('harness:output', ev);
            },
        });
        latestRunId = run.runId;
        const result = await run.done;
        attachLocalMediaResult(result, fs);
        return result;
    });

    ipcMain.handle('harness:cancel', (_, runId) => {
        const targetId = runId || latestRunId;
        if (!targetId) return false;
        return cancelHarnessRun(targetId);
    });

    ipcMain.handle('harness:synthesize-speech', async (_, opts = {}) => {
        return synthesizeSpeechToDataUrl({ text: opts?.text || '' });
    });

    ipcMain.handle('harness:save-media', (_, opts = {}) => {
        return saveRenderedMedia({
            bytes: opts?.bytes,
            ext: opts?.ext || 'webm',
            name: opts?.name || 'harness-video',
            outputDir: RENDERS_DIR,
            fsImpl: fs,
        });
    });
}

module.exports = {
    register,
    findLocalMediaPath,
    attachLocalMediaResult,
};
