const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { HARNESS_ORDER, buildHarnessRegistry, getUserHome, getWindowsAppDirs } = require('./registry');
const {
    isFileSafe,
    findExecutable,
    readBinaryVersion,
    readAdjacentPackageVersion,
    findLinuxDesktopEntry,
    readWindowsFileVersion,
    probeWindowsAppxPackages,
    readLinuxPackageVersion,
    probeIdeExtensions,
    expandMsixConfigPaths,
} = require('./platformProbe');
const { parseTomlMcpServer } = require('./tomlHelper');
const { listModelsForHarness } = require('./models');

function inspectMcpConfigFile(configPath, mcpFormat, fsImpl = fs) {
    if (!configPath || !isFileSafe(configPath, fsImpl)) {
        return { exists: false, configured: false, serverName: null };
    }
    try {
        const content = fsImpl.readFileSync(configPath, 'utf-8');
        if (mcpFormat === 'codex-toml') {
            const parsed = parseTomlMcpServer(content, 'muapi');
            return {
                exists: true,
                configured: !!parsed,
                serverName: parsed ? 'muapi' : null,
            };
        }
        const json = JSON.parse(content);
        if (mcpFormat === 'opencode-json') {
            const entry = json?.mcp?.muapi;
            return {
                exists: true,
                configured: Boolean(entry && entry.enabled !== false),
                serverName: entry ? 'muapi' : null,
            };
        }
        // antigravity-json / mcp-servers-json
        const entry = json?.mcpServers?.muapi;
        return {
            exists: true,
            configured: Boolean(entry),
            serverName: entry ? 'muapi' : null,
        };
    } catch (err) {
        return {
            exists: true,
            configured: false,
            serverName: null,
            parseError: err.message,
        };
    }
}

async function detectCliSurface(spec, overridePath, ctx) {
    const { platform, env, fsImpl, execFileImpl } = ctx;
    let binPath = null;
    let source = null;

    if (overridePath && isFileSafe(overridePath, fsImpl)) {
        binPath = path.resolve(overridePath);
        source = 'override';
    } else {
        binPath = findExecutable({
            binaries: spec.cli.binaries,
            extraDirs: spec.cli.extraDirs,
            platform,
            env,
            fsImpl,
        });
        if (binPath) source = 'auto';
    }

    if (!binPath) {
        return {
            surface: 'cli',
            installed: false,
            version: null,
            rawVersion: null,
            path: null,
            source: null,
            error: null,
        };
    }

    const ver = await readBinaryVersion(binPath, spec.cli.versionArgs, { platform, env, execFileImpl });
    return {
        surface: 'cli',
        installed: true,
        version: ver.version,
        rawVersion: ver.raw || null,
        path: binPath,
        source,
        error: ver.error,
    };
}

async function detectDesktopSurface(spec, overridePath, appxList, ctx) {
    const { platform, env, homeDir, fsImpl, execFileImpl } = ctx;
    let foundPath = null;
    let source = null;
    let version = null;

    if (overridePath && isFileSafe(overridePath, fsImpl)) {
        foundPath = path.resolve(overridePath);
        source = 'override';
    } else {
        for (const candidate of spec.desktop.candidates || []) {
            if (isFileSafe(candidate, fsImpl)) {
                foundPath = candidate;
                source = 'path';
                break;
            }
        }
    }

    // Windows Store / MSIX package check
    if (!foundPath && platform === 'win32' && Array.isArray(spec.desktop.appxNames) && appxList.length) {
        const match = appxList.find((pkg) =>
            spec.desktop.appxNames.some((prefix) => String(pkg.Name || '').toLowerCase().includes(prefix.toLowerCase()))
        );
        if (match) {
            foundPath = match.InstallLocation || match.Name;
            version = match.Version ? String(match.Version) : null;
            source = 'msix';
        }
    }

    // Linux .desktop entry fallback
    let desktopEntry = null;
    if (platform === 'linux' && Array.isArray(spec.desktop.desktopEntries)) {
        desktopEntry = findLinuxDesktopEntry(spec.desktop.desktopEntries, { env, homeDir, fsImpl });
        if (!foundPath && desktopEntry) {
            if (desktopEntry.execPath && isFileSafe(desktopEntry.execPath, fsImpl)) {
                foundPath = desktopEntry.execPath;
            } else {
                foundPath = desktopEntry.desktopFile;
            }
            version = desktopEntry.version || null;
            source = 'desktop-entry';
        }
    }

    // AppData / XDG directory marker check (installed/used even if binary moved)
    let dataMarker = null;
    for (const marker of spec.desktop.appDataMarkers || []) {
        try {
            if (fsImpl.existsSync(marker)) {
                dataMarker = marker;
                break;
            }
        } catch {
            // ignore
        }
    }

    if (foundPath && !version) {
        version = readAdjacentPackageVersion(foundPath, fsImpl);
    }
    if (foundPath && !version && platform === 'win32') {
        version = await readWindowsFileVersion(foundPath, { env, execFileImpl });
    }
    if (foundPath && !version && platform === 'linux') {
        version = (desktopEntry && desktopEntry.version) || (await readLinuxPackageVersion(foundPath, { execFileImpl }));
    }

    return {
        surface: 'desktop',
        installed: Boolean(foundPath),
        version,
        path: foundPath,
        dataDir: dataMarker,
        source,
    };
}

async function detectIdeSurface(spec, overridePath, desktopResult, ctx) {
    if (!spec.ide) return null;
    const { platform, env, fsImpl, execFileImpl, workspaceDir } = ctx;

    if (spec.ide.kind === 'host-ide') {
        let idePath = null;
        let source = null;
        let version = null;

        if (overridePath && isFileSafe(overridePath, fsImpl)) {
            idePath = path.resolve(overridePath);
            source = 'override';
        } else {
            for (const candidate of spec.ide.candidates || []) {
                if (isFileSafe(candidate, fsImpl)) {
                    idePath = candidate;
                    source = 'path';
                    break;
                }
            }
        }

        if (!idePath && desktopResult?.installed) {
            idePath = desktopResult.path;
            version = desktopResult.version;
            source = desktopResult.source;
        }

        if (idePath && !version) {
            version = readAdjacentPackageVersion(idePath, fsImpl);
            if (!version && platform === 'win32') {
                version = await readWindowsFileVersion(idePath, { env, execFileImpl });
            } else if (!version && platform === 'linux') {
                version = await readLinuxPackageVersion(idePath, { execFileImpl });
            }
        }

        let extensionDir = null;
        for (const extDir of spec.ide.extensionDirs || []) {
            try {
                if (fsImpl.existsSync(extDir)) {
                    extensionDir = extDir;
                    break;
                }
            } catch {
                // ignore
            }
        }

        let workspaceConfigured = false;
        if (workspaceDir && spec.ide.workspaceMarker) {
            try {
                workspaceConfigured = fsImpl.existsSync(path.join(workspaceDir, spec.ide.workspaceMarker));
            } catch {
                workspaceConfigured = false;
            }
        }

        return {
            surface: 'ide',
            installed: Boolean(idePath || extensionDir),
            version,
            path: idePath || extensionDir,
            extensionDir,
            workspaceConfigured,
            source,
        };
    }

    if (spec.ide.kind === 'ide-extension') {
        const extensions = probeIdeExtensions(spec.ide.extensionRoots, spec.ide.extensionPrefixes, fsImpl);
        const primary = extensions[0] || null;
        return {
            surface: 'ide',
            installed: extensions.length > 0,
            version: primary?.version || null,
            path: primary?.path || null,
            extensions,
            source: extensions.length ? 'extension-scan' : null,
        };
    }

    return null;
}

function resolveHarnessConfigPaths(spec, ctx) {
    const { platform, env, homeDir, fsImpl } = ctx;
    const candidates = [...(spec.config?.paths || [])];

    if (platform === 'win32' && spec.config?.msixPackagePrefix && spec.config?.msixRelativeConfig) {
        const { localAppData } = getWindowsAppDirs(env, homeDir || getUserHome(env));
        const msixPaths = expandMsixConfigPaths(
            localAppData,
            spec.config.msixPackagePrefix,
            spec.config.msixRelativeConfig,
            fsImpl
        );
        candidates.unshift(...msixPaths);
    }

    const deduped = [];
    const seen = new Set();
    for (const p of candidates) {
        const key = platform === 'win32' ? p.toLowerCase() : p;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(p);
    }

    const inspected = deduped.map((p) => ({
        path: p,
        ...inspectMcpConfigFile(p, spec.config.mcpFormat, fsImpl),
    }));

    const existing = inspected.filter((c) => c.exists);
    const configured = inspected.filter((c) => c.configured);

    return {
        mcpFormat: spec.config.mcpFormat,
        candidates: inspected,
        primaryPath: configured[0]?.path || existing[0]?.path || spec.config.defaultMcpPath || spec.config.defaultDesktopMcpPath || deduped[0] || null,
        mcpConfigured: configured.length > 0,
        configuredPaths: configured.map((c) => c.path),
    };
}

/**
 * Detect installed harnesses across Desktop, CLI, and IDE surfaces for Linux and Windows.
 */
async function detectAllHarnesses(options = {}) {
    const platform = options.platform || process.platform;
    const arch = options.arch || process.arch;
    const env = options.env || process.env;
    const homeDir = options.homeDir || getUserHome(env, os.homedir());
    const fsImpl = options.fsImpl || fs;
    const execFileImpl = options.execFileImpl || execFile;
    const overrides = options.overrides || {};
    const workspaceDir = options.workspaceDir || null;
    const filterIds = Array.isArray(options.harnessIds) && options.harnessIds.length
        ? new Set(options.harnessIds)
        : null;

    const registry = buildHarnessRegistry({ platform, env, homeDir });
    const ctx = { platform, arch, env, homeDir, fsImpl, execFileImpl, workspaceDir };

    // Single batched Appx check on Windows to keep detection fast
    const appxNames = [];
    for (const id of HARNESS_ORDER) {
        if (filterIds && !filterIds.has(id)) continue;
        const spec = registry[id];
        if (Array.isArray(spec.desktop?.appxNames)) appxNames.push(...spec.desktop.appxNames);
    }
    const appxList = (platform === 'win32' && appxNames.length && !options.skipAppxProbe)
        ? await probeWindowsAppxPackages(appxNames, { platform, env, execFileImpl })
        : [];

    const harnesses = await Promise.all(
        HARNESS_ORDER.filter((id) => !filterIds || filterIds.has(id)).map(async (id) => {
            const spec = registry[id];
            const ov = overrides[id] || {};

            const [cli, desktop] = await Promise.all([
                detectCliSurface(spec, ov.cliPath, ctx),
                detectDesktopSurface(spec, ov.desktopPath, appxList, ctx),
            ]);
            const ide = spec.surfaces.includes('ide')
                ? await detectIdeSurface(spec, ov.idePath, desktop, ctx)
                : null;

            const surfaces = { desktop, cli };
            if (ide) surfaces.ide = ide;

            const config = resolveHarnessConfigPaths(spec, ctx);
            const installedSurfaces = spec.surfaces.filter((s) => surfaces[s]?.installed);
            const models = options.includeModels !== false
                ? await listModelsForHarness(spec.id, {
                    cliPath: cli.installed ? cli.path : null,
                    platform,
                    env,
                    homeDir,
                    fsImpl,
                    execFileImpl,
                })
                : [];

            return {
                id: spec.id,
                name: spec.name,
                vendor: spec.vendor,
                supportedSurfaces: spec.surfaces,
                installed: installedSurfaces.length > 0,
                installedSurfaces,
                surfaces,
                config,
                models,
                canRun: Boolean(cli.installed),
                canConfigureMcp: true,
            };
        })
    );

    return {
        os: platform,
        arch,
        detectedAt: new Date().toISOString(),
        summary: {
            totalHarnesses: harnesses.length,
            installedHarnesses: harnesses.filter((h) => h.installed).length,
            cliReadyCount: harnesses.filter((h) => h.canRun).length,
            mcpConfiguredCount: harnesses.filter((h) => h.config.mcpConfigured).length,
        },
        harnesses,
    };
}

module.exports = {
    detectAllHarnesses,
    inspectMcpConfigFile,
    resolveHarnessConfigPaths,
};
