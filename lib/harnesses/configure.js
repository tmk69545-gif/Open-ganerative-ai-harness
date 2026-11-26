const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { HARNESS_ORDER, buildHarnessRegistry, getUserHome, getWindowsAppDirs } = require('./registry');
const { isFileSafe, expandMsixConfigPaths } = require('./platformProbe');
const { upsertTomlMcpServer, removeTomlMcpServer } = require('./tomlHelper');

const DEFAULT_MUAPI_MCP_URL = 'https://api.muapi.ai/mcp';

function resolveTargetConfigPaths(spec, { surface = 'auto', configPath, platform = process.platform, env = process.env, homeDir, fsImpl = fs } = {}) {
    if (configPath) return [path.resolve(configPath)];

    const home = homeDir || getUserHome(env, os.homedir());
    if (spec.id === 'claude') {
        const msixPaths = platform === 'win32'
            ? expandMsixConfigPaths(getWindowsAppDirs(env, home).localAppData, spec.config.msixPackagePrefix, spec.config.msixRelativeConfig, fsImpl)
            : [];
        const desktopPath = msixPaths[0] || spec.config.defaultDesktopMcpPath;
        const cliPath = spec.config.defaultCliMcpPath;

        if (surface === 'desktop') return [desktopPath];
        if (surface === 'cli') return [cliPath];
        if (surface === 'all') return [desktopPath, cliPath];
        // 'auto': configure whichever exists, or desktop + cli if desktop dir exists
        const existing = [desktopPath, cliPath].filter((p) => isFileSafe(p, fsImpl));
        return existing.length ? existing : [cliPath];
    }

    if (spec.id === 'antigravity') {
        const configPaths = spec.config.paths.slice(0, 2);
        if (surface === 'all') {
            return configPaths;
        }
        if (surface === 'ide' || surface === 'desktop') {
            return [configPaths[1]];
        }
        if (surface === 'cli') {
            return [configPaths[0]];
        }
        const existing = configPaths.filter((p) => isFileSafe(p, fsImpl));
        return existing.length ? existing : [spec.config.defaultMcpPath];
    }

    if (spec.id === 'opencode') {
        const existing = spec.config.paths.filter((p) => isFileSafe(p, fsImpl));
        return existing.length ? [existing[0]] : [spec.config.defaultMcpPath];
    }

    return [spec.config.defaultMcpPath];
}

function buildJsonMcpPayload(format, { mcpUrl, apiKey, apiKeyEnv }) {
    const authHeader = apiKey ? `Bearer ${apiKey}` : `Bearer \${${apiKeyEnv}}`;
    if (format === 'antigravity-json') {
        return {
            serverUrl: mcpUrl,
            headers: { Authorization: authHeader },
        };
    }
    if (format === 'opencode-json') {
        return {
            type: 'remote',
            url: mcpUrl,
            headers: { Authorization: authHeader },
            enabled: true,
        };
    }
    return {
        type: 'http',
        url: mcpUrl,
        headers: { Authorization: authHeader },
    };
}

function redactSecretPreview(text, apiKey) {
    let out = String(text || '');
    if (apiKey && apiKey.length >= 6) {
        out = out.split(apiKey).join(`${apiKey.slice(0, 4)}****`);
    }
    return out;
}

function applyConfigUpdate(targetPath, spec, opts) {
    const {
        action = 'configure',
        mcpUrl = DEFAULT_MUAPI_MCP_URL,
        apiKey = '',
        apiKeyEnv = 'MUAPI_API_KEY',
        dryRun = false,
        fsImpl = fs,
    } = opts;

    const existed = isFileSafe(targetPath, fsImpl);
    const original = existed ? fsImpl.readFileSync(targetPath, 'utf-8') : '';
    let nextContent = original;

    if (spec.config.mcpFormat === 'codex-toml') {
        if (action === 'unconfigure') {
            nextContent = removeTomlMcpServer(original, 'muapi');
        } else {
            const tomlCfg = {
                url: mcpUrl,
                enabled: true,
                ...(apiKey
                    ? { http_headers: { Authorization: `Bearer ${apiKey}` } }
                    : { bearer_token_env_var: apiKeyEnv }),
            };
            nextContent = upsertTomlMcpServer(original, 'muapi', tomlCfg);
        }
    } else {
        let parsed = {};
        if (original.trim()) {
            try {
                parsed = JSON.parse(original);
            } catch (err) {
                throw new Error(`Cannot parse existing JSON config at ${targetPath}: ${err.message}`);
            }
        }
        const rootKey = spec.config.mcpFormat === 'opencode-json' ? 'mcp' : 'mcpServers';
        if (!parsed[rootKey] || typeof parsed[rootKey] !== 'object') {
            parsed[rootKey] = {};
        }

        if (action === 'unconfigure') {
            if (!parsed[rootKey].muapi) {
                return {
                    configPath: targetPath,
                    existed,
                    changed: false,
                    backupPath: null,
                    dryRun,
                    preview: redactSecretPreview(original, apiKey),
                };
            }
            delete parsed[rootKey].muapi;
        } else {
            parsed[rootKey].muapi = buildJsonMcpPayload(spec.config.mcpFormat, { mcpUrl, apiKey, apiKeyEnv });
        }
        nextContent = JSON.stringify(parsed, null, 2) + '\n';
    }

    const changed = nextContent !== original;
    let backupPath = null;

    if (changed && !dryRun) {
        fsImpl.mkdirSync(path.dirname(targetPath), { recursive: true });
        if (existed) {
            backupPath = `${targetPath}.bak`;
            fsImpl.writeFileSync(backupPath, original, 'utf-8');
        }
        fsImpl.writeFileSync(targetPath, nextContent, 'utf-8');
    }

    return {
        configPath: targetPath,
        existed,
        changed,
        backupPath,
        dryRun,
        preview: redactSecretPreview(nextContent, apiKey),
    };
}

/**
 * Configure (or unconfigure) MuAPI MCP server in one or all supported harnesses.
 */
function configureHarnessMcp(options = {}) {
    const platform = options.platform || process.platform;
    const env = options.env || process.env;
    const homeDir = options.homeDir || getUserHome(env, os.homedir());
    const fsImpl = options.fsImpl || fs;
    const harnessId = options.harnessId || 'all';
    const registry = buildHarnessRegistry({ platform, env, homeDir });

    const targetIds = harnessId === 'all' ? HARNESS_ORDER : [harnessId];
    for (const id of targetIds) {
        if (!registry[id]) {
            throw new Error(`Unknown harness "${id}". Expected one of: ${HARNESS_ORDER.join(', ')}, all`);
        }
    }

    const results = [];
    for (const id of targetIds) {
        const spec = registry[id];
        const paths = resolveTargetConfigPaths(spec, {
            surface: options.surface || 'auto',
            configPath: targetIds.length === 1 ? options.configPath : undefined,
            platform,
            env,
            homeDir,
            fsImpl,
        });

        for (const p of paths) {
            const res = applyConfigUpdate(p, spec, {
                action: options.action || 'configure',
                mcpUrl: options.mcpUrl || DEFAULT_MUAPI_MCP_URL,
                apiKey: (options.apiKey || '').trim(),
                apiKeyEnv: options.apiKeyEnv || 'MUAPI_API_KEY',
                dryRun: Boolean(options.dryRun),
                fsImpl,
            });
            results.push({ harnessId: id, name: spec.name, ...res });
        }
    }

    return {
        ok: true,
        action: options.action || 'configure',
        dryRun: Boolean(options.dryRun),
        results,
    };
}

function unconfigureHarnessMcp(options = {}) {
    return configureHarnessMcp({ ...options, action: 'unconfigure' });
}

/**
 * Run `npx skills add SamurAIGPT/muapi-skills` into local agent skill directories.
 */
function installMuapiSkills({ cwd = process.cwd(), all = true, platform = process.platform, env = process.env, execFileImpl = execFile } = {}) {
    const npxBin = platform === 'win32' ? 'npx.cmd' : 'npx';
    const args = ['--yes', 'skills', 'add', 'SamurAIGPT/muapi-skills'];
    if (all) args.push('--all');
    const cmd = platform === 'win32' ? (env.ComSpec || 'cmd.exe') : npxBin;
    const finalArgs = platform === 'win32' ? ['/d', '/c', npxBin, ...args] : args;

    return new Promise((resolve) => {
        execFileImpl(cmd, finalArgs, { cwd, env, timeout: 120000, windowsHide: true }, (error, stdout, stderr) => {
            resolve({
                ok: !error,
                stdout: String(stdout || ''),
                stderr: String(stderr || ''),
                error: error ? error.message : null,
            });
        });
    });
}

/**
 * Copy bundled CloudAI-X/threejs-skills (three.js r186) into local harness skill folders.
 */
function installThreejsSkills({
    homeDir,
    env = process.env,
    workspaceDir = null,
    fsImpl = fs,
    skillsSourceDir = path.join(__dirname, '..', 'skills', 'threejs'),
} = {}) {
    const home = homeDir || getUserHome(env, os.homedir());
    const xdgConfig = env.XDG_CONFIG_HOME || path.join(home, '.config');

    if (!fsImpl.existsSync(skillsSourceDir)) {
        return { ok: false, error: `Bundled Three.js skills folder missing: ${skillsSourceDir}`, installedPaths: [], skillNames: [] };
    }

    const skillNames = fsImpl.readdirSync(skillsSourceDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith('threejs-'))
        .map((d) => d.name);

    const targets = [
        path.join(home, '.gemini', 'antigravity', 'skills'),
        path.join(home, '.claude', 'skills'),
        path.join(home, '.codex', 'skills'),
        path.join(xdgConfig, 'opencode', 'skills'),
    ];
    if (workspaceDir) {
        targets.push(path.join(path.resolve(workspaceDir), '.agents', 'skills'));
    }

    const installedPaths = [];
    for (const targetRoot of targets) {
        fsImpl.mkdirSync(targetRoot, { recursive: true });
        for (const name of skillNames) {
            const src = path.join(skillsSourceDir, name);
            const dest = path.join(targetRoot, name);
            fsImpl.cpSync(src, dest, { recursive: true, force: true });
        }
        installedPaths.push(targetRoot);
    }

    return {
        ok: true,
        count: skillNames.length,
        skillNames,
        installedPaths,
    };
}

module.exports = {
    DEFAULT_MUAPI_MCP_URL,
    resolveTargetConfigPaths,
    configureHarnessMcp,
    unconfigureHarnessMcp,
    installMuapiSkills,
    installThreejsSkills,
};
