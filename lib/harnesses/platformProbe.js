const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_TIMEOUT_MS = 4000;

function execFileAsync(cmd, args, { env = process.env, timeout = DEFAULT_TIMEOUT_MS, execFileImpl = execFile, windowsVerbatimArguments = false } = {}) {
    return new Promise((resolve) => {
        try {
            execFileImpl(cmd, args, { env, timeout, windowsHide: true, windowsVerbatimArguments, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
                resolve({
                    ok: !error,
                    code: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0),
                    stdout: String(stdout || ''),
                    stderr: String(stderr || ''),
                    error: error ? error.message : null,
                });
            });
        } catch (err) {
            resolve({ ok: false, code: 1, stdout: '', stderr: '', error: err.message });
        }
    });
}

function quoteCmdArg(arg) {
    // cmd.exe breaks commands on raw newlines and strips unescaped meta chars;
    // collapse newlines to spaces and double-quote safely for /d /s /c.
    const singleLine = String(arg ?? '').replace(/\r?\n+/g, ' ');
    const escaped = singleLine.replace(/"/g, '\\"').replace(/%/g, '%%');
    return `"${escaped}"`;
}

function resolveNpmCmdJsEntry(binPath, fsImpl = fs) {
    try {
        if (!isFileSafe(binPath, fsImpl)) return null;
        const content = fsImpl.readFileSync(binPath, 'utf-8');
        const match = content.match(/"%dp0%\\([^"\r\n]+\.(?:c|m)?js)"/i);
        if (!match) return null;
        const resolved = path.join(path.dirname(binPath), match[1].replace(/\\/g, path.sep));
        return isFileSafe(resolved, fsImpl) ? resolved : null;
    } catch {
        return null;
    }
}

function findNodeExecutable(env = process.env, fsImpl = fs) {
    if (!process.versions?.electron && process.execPath && isFileSafe(process.execPath, fsImpl)) {
        return process.execPath;
    }
    return findExecutable({ binaries: ['node'], platform: 'win32', env, fsImpl });
}

function buildPlatformInvocation(binPath, args = [], { platform = process.platform, env = process.env, fsImpl = fs } = {}) {
    const lower = String(binPath || '').toLowerCase();
    if (platform === 'win32') {
        if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
            const npmEntry = resolveNpmCmdJsEntry(binPath, fsImpl);
            if (npmEntry) {
                const nodeBin = findNodeExecutable(env, fsImpl);
                if (nodeBin) {
                    return { cmd: nodeBin, args: [npmEntry, ...args], windowsVerbatimArguments: false };
                }
            }
            const cmdLine = `"${[binPath, ...args].map(quoteCmdArg).join(' ')}"`;
            return {
                cmd: env.ComSpec || 'cmd.exe',
                args: ['/d', '/s', '/c', cmdLine],
                windowsVerbatimArguments: true,
            };
        }
        if (lower.endsWith('.ps1')) {
            return {
                cmd: 'powershell.exe',
                args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', binPath, ...args],
                windowsVerbatimArguments: false,
            };
        }
    }
    return { cmd: binPath, args, windowsVerbatimArguments: false };
}

function parseVersionString(rawOutput) {
    const text = String(rawOutput || '').trim();
    if (!text) return { version: null, raw: '' };
    const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || text;
    const semverMatch = firstLine.match(/v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
    if (semverMatch) {
        return { version: semverMatch[1], raw: firstLine.trim() };
    }
    const twoPartMatch = firstLine.match(/v?(\d+\.\d+(?:\.\d+)?)/);
    return {
        version: twoPartMatch ? twoPartMatch[1] : firstLine.trim(),
        raw: firstLine.trim(),
    };
}

function isFileSafe(filePath, fsImpl = fs) {
    try {
        const stat = fsImpl.statSync(filePath);
        return stat.isFile();
    } catch {
        return false;
    }
}

function isExecutableSafe(filePath, { platform = process.platform, fsImpl = fs } = {}) {
    if (!isFileSafe(filePath, fsImpl)) return false;
    if (platform === 'win32') return true;
    try {
        fsImpl.accessSync(filePath, fsImpl.constants?.X_OK ?? 1);
        return true;
    } catch {
        return false;
    }
}

function findExecutable({ binaries = [], extraDirs = [], platform = process.platform, env = process.env, fsImpl = fs }) {
    const pathEnv = env.PATH || env.Path || '';
    const pathSep = platform === 'win32' ? ';' : ':';
    const searchDirs = [];
    const seenDirs = new Set();

    for (const dir of [...pathEnv.split(pathSep), ...extraDirs]) {
        const trimmed = String(dir || '').trim();
        if (!trimmed) continue;
        const normalized = platform === 'win32' ? trimmed.toLowerCase() : trimmed;
        if (seenDirs.has(normalized)) continue;
        seenDirs.add(normalized);
        searchDirs.push(trimmed);
    }

    // On Windows, npm/scoop create extensionless POSIX sh scripts alongside .cmd/.exe shims;
    // prefer runnable Windows extensions first so we never pick an un-executable sh wrapper.
    const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', '.ps1'] : [''];

    for (const dir of searchDirs) {
        for (const binName of binaries) {
            for (const ext of extensions) {
                const candidate = ext && !binName.toLowerCase().endsWith(ext)
                    ? path.join(dir, `${binName}${ext}`)
                    : path.join(dir, binName);
                if (isExecutableSafe(candidate, { platform, fsImpl })) {
                    return candidate;
                }
            }
        }
    }

    return null;
}

async function readBinaryVersion(binPath, versionArgs = ['--version'], opts = {}) {
    const { cmd, args, windowsVerbatimArguments } = buildPlatformInvocation(binPath, versionArgs, opts);
    const res = await execFileAsync(cmd, args, { ...opts, windowsVerbatimArguments });
    const combined = `${res.stdout}\n${res.stderr}`.trim();
    const parsed = parseVersionString(combined);
    if (!res.ok && !parsed.version) {
        return { version: null, raw: parsed.raw, error: res.error || combined || `Exit ${res.code}` };
    }
    return { version: parsed.version, raw: parsed.raw, error: null };
}

function readAdjacentPackageVersion(exePath, fsImpl = fs) {
    if (!exePath) return null;
    const dir = path.dirname(exePath);
    const candidates = [
        path.join(dir, 'resources', 'app', 'package.json'),
        path.join(dir, 'resources', 'package.json'),
        path.join(dir, 'package.json'),
        path.join(dir, '..', 'package.json'),
    ];
    for (const pkgPath of candidates) {
        try {
            if (!isFileSafe(pkgPath, fsImpl)) continue;
            const parsed = JSON.parse(fsImpl.readFileSync(pkgPath, 'utf-8'));
            if (parsed?.version) return String(parsed.version);
        } catch {
            // ignore unreadable package.json
        }
    }
    return null;
}

function parseDesktopFile(content) {
    const data = {};
    for (const line of String(content || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!(key in data)) data[key] = val;
    }
    return data;
}

function findLinuxDesktopEntry(desktopNames = [], { env = process.env, homeDir, fsImpl = fs } = {}) {
    if (!desktopNames.length) return null;
    const home = homeDir || env.HOME || '';
    const appDirs = [
        home ? path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'applications') : null,
        '/usr/local/share/applications',
        '/usr/share/applications',
    ].filter(Boolean);

    for (const dir of appDirs) {
        for (const name of desktopNames) {
            const fullPath = path.join(dir, name);
            try {
                if (!isFileSafe(fullPath, fsImpl)) continue;
                const parsed = parseDesktopFile(fsImpl.readFileSync(fullPath, 'utf-8'));
                const execToken = (parsed.Exec || '').split(/\s+/)[0]?.replace(/^["']|["']$/g, '') || null;
                return {
                    desktopFile: fullPath,
                    execPath: execToken,
                    version: parsed['X-AppImage-Version'] || parsed.Version || null,
                    name: parsed.Name || null,
                };
            } catch {
                // ignore unreadable desktop entry
            }
        }
    }
    return null;
}

async function readWindowsFileVersion(filePath, { env = process.env, execFileImpl = execFile } = {}) {
    if (!filePath || !filePath.toLowerCase().endsWith('.exe')) return null;
    const res = await execFileAsync(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '$v = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:OGAI_PROBE_PATH); if ($v.ProductVersion) { $v.ProductVersion } else { $v.FileVersion }',
        ],
        { env: { ...env, OGAI_PROBE_PATH: filePath }, execFileImpl, timeout: 4000 }
    );
    if (!res.ok) return null;
    return parseVersionString(res.stdout).version;
}

async function probeWindowsAppxPackages(names = [], { platform = process.platform, env = process.env, execFileImpl = execFile } = {}) {
    if (platform !== 'win32' || !names.length) return [];
    const filter = names.map((n) => `\$_.Name -like '*${String(n).replace(/'/g, '')}*'`).join(' -or ');
    const script = `Get-AppxPackage | Where-Object { ${filter} } | Select-Object Name,Version,InstallLocation | ConvertTo-Json -Compress`;
    const res = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { env, execFileImpl, timeout: 5000 }
    );
    if (!res.ok || !res.stdout.trim()) return [];
    try {
        const parsed = JSON.parse(res.stdout.trim());
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return [];
    }
}

async function readLinuxPackageVersion(execPath, { execFileImpl = execFile } = {}) {
    if (!execPath || !execPath.startsWith('/')) return null;
    const dpkgOwner = await execFileAsync('dpkg', ['-S', execPath], { execFileImpl, timeout: 2500 });
    if (dpkgOwner.ok && dpkgOwner.stdout) {
        const pkgName = dpkgOwner.stdout.split(':')[0]?.trim();
        if (pkgName) {
            const verRes = await execFileAsync('dpkg-query', ['-W', '-f=${Version}', pkgName], { execFileImpl, timeout: 2500 });
            if (verRes.ok && verRes.stdout.trim()) return parseVersionString(verRes.stdout).version;
        }
    }
    const rpmRes = await execFileAsync('rpm', ['-qf', '--queryformat', '%{VERSION}', execPath], { execFileImpl, timeout: 2500 });
    if (rpmRes.ok && rpmRes.stdout.trim()) return parseVersionString(rpmRes.stdout).version;
    return null;
}

function probeIdeExtensions(extensionRoots = [], prefixes = [], fsImpl = fs) {
    const found = [];
    for (const root of extensionRoots) {
        let entries;
        try {
            entries = fsImpl.readdirSync(root.dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const lower = entry.name.toLowerCase();
            if (!prefixes.some((p) => lower.startsWith(p.toLowerCase()))) continue;
            const extPath = path.join(root.dir, entry.name);
            let version = null;
            let displayName = entry.name;
            let extensionId = entry.name;
            try {
                const pkgPath = path.join(extPath, 'package.json');
                if (isFileSafe(pkgPath, fsImpl)) {
                    const pkg = JSON.parse(fsImpl.readFileSync(pkgPath, 'utf-8'));
                    version = pkg.version || null;
                    displayName = pkg.displayName || pkg.name || entry.name;
                    extensionId = pkg.publisher && pkg.name ? `${pkg.publisher}.${pkg.name}` : entry.name;
                }
            } catch {
                // fallback to folder name suffix
                const dashVer = entry.name.match(/-(\d+\.\d+\.\d+.*)$/);
                if (dashVer) version = dashVer[1];
            }
            found.push({
                ide: root.ide,
                id: extensionId,
                name: displayName,
                version,
                path: extPath,
            });
        }
    }
    return found;
}

function expandMsixConfigPaths(localAppData, prefix, relativeSubpath, fsImpl = fs) {
    const packagesDir = path.join(localAppData, 'Packages');
    const results = [];
    try {
        for (const entry of fsImpl.readdirSync(packagesDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            if (!entry.name.startsWith(prefix)) continue;
            results.push(path.join(packagesDir, entry.name, relativeSubpath));
        }
    } catch {
        // Packages dir missing or inaccessible
    }
    return results;
}

module.exports = {
    execFileAsync,
    buildPlatformInvocation,
    parseVersionString,
    isFileSafe,
    isExecutableSafe,
    findExecutable,
    readBinaryVersion,
    readAdjacentPackageVersion,
    findLinuxDesktopEntry,
    readWindowsFileVersion,
    probeWindowsAppxPackages,
    readLinuxPackageVersion,
    probeIdeExtensions,
    expandMsixConfigPaths,
};
