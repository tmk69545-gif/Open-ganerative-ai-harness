const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { detectAllHarnesses } = require('../lib/harnesses/detect');
const { findExecutable, parseVersionString } = require('../lib/harnesses/platformProbe');

function createMemoryFs(files = {}, dirs = []) {
    const fileMap = new Map(Object.entries(files).map(([k, v]) => [path.normalize(k), v]));
    const dirSet = new Set(dirs.map((d) => path.normalize(d)));
    for (const filePath of fileMap.keys()) {
        let cur = path.dirname(filePath);
        while (cur && cur !== path.dirname(cur)) {
            dirSet.add(cur);
            cur = path.dirname(cur);
        }
    }

    return {
        constants: { X_OK: 1 },
        existsSync(p) {
            const norm = path.normalize(p);
            return fileMap.has(norm) || dirSet.has(norm);
        },
        statSync(p) {
            const norm = path.normalize(p);
            if (fileMap.has(norm)) return { isFile: () => true, isDirectory: () => false };
            if (dirSet.has(norm)) return { isFile: () => false, isDirectory: () => true };
            throw new Error(`ENOENT: ${p}`);
        },
        accessSync(p) {
            const norm = path.normalize(p);
            if (!fileMap.has(norm)) throw new Error(`EACCES: ${p}`);
        },
        readFileSync(p) {
            const norm = path.normalize(p);
            if (!fileMap.has(norm)) throw new Error(`ENOENT: ${p}`);
            return fileMap.get(norm);
        },
        readdirSync(p) {
            const norm = path.normalize(p);
            const prefix = norm.endsWith(path.sep) ? norm : norm + path.sep;
            const seen = new Map();
            for (const d of dirSet) {
                if (d.startsWith(prefix)) {
                    const rest = d.slice(prefix.length).split(path.sep)[0];
                    if (rest && !seen.has(rest)) seen.set(rest, { name: rest, isDirectory: () => true, isFile: () => false });
                }
            }
            for (const f of fileMap.keys()) {
                if (f.startsWith(prefix)) {
                    const rest = f.slice(prefix.length).split(path.sep)[0];
                    if (rest && !seen.has(rest)) seen.set(rest, { name: rest, isDirectory: () => false, isFile: () => true });
                }
            }
            if (!seen.size && !dirSet.has(norm)) throw new Error(`ENOENT: ${p}`);
            return Array.from(seen.values());
        },
    };
}

test('parseVersionString extracts semver and two-part versions', () => {
    assert.equal(parseVersionString('claude 2.1.45 (Claude Code)').version, '2.1.45');
    assert.equal(parseVersionString('codex-cli v0.163.0').version, '0.163.0');
    assert.equal(parseVersionString('1.5.18\n').version, '1.5.18');
});

test('findExecutable prefers runnable .cmd/.exe shims over extensionless POSIX scripts on Windows', () => {
    const npmDir = 'C:\\Users\\dev\\AppData\\Roaming\\npm';
    const fsImpl = createMemoryFs({
        [`${npmDir}\\codex`]: '#!/bin/sh\n',
        [`${npmDir}\\codex.cmd`]: '@echo off\r\n',
    });
    const found = findExecutable({
        binaries: ['codex'],
        extraDirs: [npmDir],
        platform: 'win32',
        env: { PATH: '' },
        fsImpl,
    });
    assert.equal(found, path.join(npmDir, 'codex.cmd'));
});

test('detectAllHarnesses detects Antigravity, Claude, OpenCode, and Codex across Windows Desktop/CLI/IDE', async () => {
    const home = 'C:\\Users\\Alice';
    const localAppData = `${home}\\AppData\\Local`;
    const appData = `${home}\\AppData\\Roaming`;

    const files = {
        [`${localAppData}\\Programs\\Antigravity\\Antigravity.exe`]: 'bin',
        [`${localAppData}\\Programs\\Antigravity\\resources\\app\\package.json`]: JSON.stringify({ version: '2.35.2' }),
        [`${home}\\.local\\bin\\agy.exe`]: 'bin',
        [`${home}\\.gemini\\config\\mcp_config.json`]: JSON.stringify({ mcpServers: { muapi: { serverUrl: 'https://api.muapi.ai/mcp' } } }),

        [`${home}\\.local\\bin\\claude.exe`]: 'bin',
        [`${localAppData}\\Packages\\Claude_pzs8sxrjxfjjc\\LocalCache\\Roaming\\Claude\\claude_desktop_config.json`]: JSON.stringify({ mcpServers: {} }),

        [`${localAppData}\\Programs\\OpenCode\\OpenCode.exe`]: 'bin',
        [`${localAppData}\\Programs\\OpenCode\\resources\\app\\package.json`]: JSON.stringify({ version: '0.18.1' }),
        [`${home}\\.opencode\\bin\\opencode.exe`]: 'bin',
        [`${home}\\.config\\opencode\\opencode.json`]: JSON.stringify({ mcp: { muapi: { type: 'remote', url: 'https://api.muapi.ai/mcp', enabled: true } } }),

        [`${appData}\\npm\\codex.cmd`]: '@echo off',
        [`${home}\\.vscode\\extensions\\openai.chatgpt-0.7.1\\package.json`]: JSON.stringify({
            name: 'chatgpt',
            publisher: 'openai',
            displayName: 'Codex IDE',
            version: '0.7.1',
        }),
        [`${home}\\.codex\\config.toml`]: 'model = "gpt-5.4"\n[mcp_servers.muapi]\nurl = "https://api.muapi.ai/mcp"\n',
    };

    const fsImpl = createMemoryFs(files, [`${home}\\.antigravity\\extensions`]);

    const execFileImpl = (cmd, args, opts, cb) => {
        const joined = `${cmd} ${args.join(' ')}`;
        if (joined.includes('Get-AppxPackage')) {
            return cb(null, JSON.stringify([
                { Name: 'Claude', Version: '1.2.3.0', InstallLocation: 'C:\\Program Files\\WindowsApps\\Claude_1.2.3.0' },
                { Name: 'OpenAI.Codex', Version: '2.0.10.0', InstallLocation: 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_2.0.10.0' },
            ]), '');
        }
        if (joined.includes('agy.exe')) return cb(null, 'agy 1.5.18', '');
        if (joined.includes('claude.exe')) return cb(null, '2.1.10 (Claude Code)', '');
        if (joined.includes('opencode.exe')) return cb(null, 'opencode 0.18.1', '');
        if (joined.includes('codex.cmd')) return cb(null, 'codex-cli 0.163.0', '');
        return cb(new Error('unexpected command'));
    };

    const report = await detectAllHarnesses({
        platform: 'win32',
        arch: 'x64',
        homeDir: home,
        env: { USERPROFILE: home, LOCALAPPDATA: localAppData, APPDATA: appData, PATH: '' },
        fsImpl,
        execFileImpl,
    });

    assert.equal(report.os, 'win32');
    assert.equal(report.summary.installedHarnesses, 4);
    assert.equal(report.summary.cliReadyCount, 4);
    assert.equal(report.summary.mcpConfiguredCount, 3);

    const byId = Object.fromEntries(report.harnesses.map((h) => [h.id, h]));

    assert.equal(byId.antigravity.surfaces.desktop.version, '2.35.2');
    assert.equal(byId.antigravity.surfaces.cli.version, '1.5.18');
    assert.equal(byId.antigravity.surfaces.ide.installed, true);
    assert.equal(byId.antigravity.config.mcpConfigured, true);

    assert.equal(byId.claude.surfaces.desktop.source, 'msix');
    assert.equal(byId.claude.surfaces.desktop.version, '1.2.3.0');
    assert.equal(byId.claude.surfaces.cli.version, '2.1.10');
    assert.equal(byId.claude.config.mcpConfigured, false);

    assert.equal(byId.opencode.surfaces.desktop.version, '0.18.1');
    assert.equal(byId.opencode.surfaces.cli.version, '0.18.1');
    assert.equal(byId.opencode.config.mcpConfigured, true);

    assert.equal(byId.codex.surfaces.desktop.source, 'msix');
    assert.equal(byId.codex.surfaces.cli.version, '0.163.0');
    assert.equal(byId.codex.surfaces.ide.installed, true);
    assert.equal(byId.codex.surfaces.ide.extensions[0].version, '0.7.1');
    assert.equal(byId.codex.config.mcpConfigured, true);
});

test('detectAllHarnesses detects Linux Desktop (.desktop/XDG), CLI, IDE, and custom overrides', async () => {
    const home = '/home/bob';
    const files = {
        '/opt/antigravity/antigravity': 'bin',
        '/opt/antigravity/resources/app/package.json': JSON.stringify({ version: '2.30.0' }),
        [`${home}/.local/bin/agy`]: 'bin',

        [`${home}/.local/share/applications/claude-desktop.desktop`]: '[Desktop Entry]\nName=Claude\nExec=/usr/bin/claude-desktop %u\nX-AppImage-Version=1.4.0\n',
        '/usr/bin/claude-desktop': 'bin',
        '/usr/local/bin/claude': 'bin',

        [`${home}/.opencode/bin/opencode`]: 'bin',
        [`${home}/.config/opencode/opencode.json`]: JSON.stringify({ mcp: {} }),

        '/opt/custom/my-codex': 'bin',
        [`${home}/.cursor/extensions/openai.codex-1.1.0/package.json`]: JSON.stringify({
            name: 'codex',
            publisher: 'openai',
            version: '1.1.0',
        }),
    };

    const fsImpl = createMemoryFs(files);
    const execFileImpl = (cmd, args, opts, cb) => {
        if (cmd.endsWith('agy')) return cb(null, '1.5.0', '');
        if (cmd.endsWith('claude')) return cb(null, '2.0.5', '');
        if (cmd.endsWith('opencode')) return cb(null, '0.17.3', '');
        if (cmd.endsWith('my-codex')) return cb(null, '0.150.0', '');
        return cb(new Error('not found'));
    };

    const report = await detectAllHarnesses({
        platform: 'linux',
        arch: 'x64',
        homeDir: home,
        env: { HOME: home, PATH: '/usr/local/bin:/usr/bin' },
        overrides: { codex: { cliPath: '/opt/custom/my-codex' } },
        fsImpl,
        execFileImpl,
    });

    const byId = Object.fromEntries(report.harnesses.map((h) => [h.id, h]));
    assert.equal(byId.antigravity.surfaces.desktop.version, '2.30.0');
    assert.equal(byId.antigravity.surfaces.cli.version, '1.5.0');
    assert.equal(byId.claude.surfaces.desktop.version, '1.4.0');
    assert.equal(byId.claude.surfaces.cli.version, '2.0.5');
    assert.equal(byId.opencode.surfaces.cli.version, '0.17.3');
    assert.equal(byId.codex.surfaces.cli.source, 'override');
    assert.equal(byId.codex.surfaces.cli.version, '0.150.0');
    assert.equal(byId.codex.surfaces.ide.extensions[0].ide, 'Cursor');
});
