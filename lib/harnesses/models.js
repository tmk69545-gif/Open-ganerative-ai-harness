const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { buildHarnessRegistry, getUserHome } = require('./registry');
const { buildPlatformInvocation, execFileAsync, isFileSafe } = require('./platformProbe');

const CURATED_FALLBACKS = {
    antigravity: [
        { id: 'gemini-4-hydrogen-high', name: 'Gemini 4 Hydrogen (High)', source: 'default', isDefault: true },
        { id: 'gemini-4-hydrogen-xhigh', name: 'Gemini 4 Hydrogen (XHigh)', source: 'default' },
        { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)', source: 'default' },
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)', source: 'default' },
        { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)', source: 'default' },
    ],
    claude: [
        { id: 'sonnet', name: 'Claude Sonnet (Default)', source: 'default', isDefault: true },
        { id: 'opus', name: 'Claude Opus', source: 'default' },
        { id: 'haiku', name: 'Claude Haiku', source: 'default' },
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', source: 'default' },
        { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', source: 'default' },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', source: 'default' },
    ],
    opencode: [
        { id: 'anthropic/claude-sonnet-4-6', name: 'Anthropic · Claude Sonnet 4.6', source: 'default', isDefault: true },
        { id: 'openai/gpt-5.4', name: 'OpenAI · GPT-5.4', source: 'default' },
        { id: 'google/gemini-2.5-pro', name: 'Google · Gemini 2.5 Pro', source: 'default' },
    ],
    codex: [
        { id: 'gpt-5.4', name: 'GPT-5.4', source: 'default', isDefault: true },
        { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex', source: 'default' },
        { id: 'o4-mini', name: 'o4-mini', source: 'default' },
        { id: 'o3', name: 'o3', source: 'default' },
    ],
};

function parseAgyModelsOutput(stdout = '') {
    const models = [];
    const seen = new Set();
    for (const rawLine of String(stdout).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('Fetching ')) continue;
        const parts = line.split(/\t+/);
        const id = (parts[0] || '').trim();
        if (!id || /\s/.test(id) || seen.has(id)) continue;
        seen.add(id);
        const name = (parts[1] || id).trim();
        models.push({ id, name, source: 'agy-cli' });
    }
    return models;
}

function parseOpenCodeModelsOutput(stdout = '') {
    const models = [];
    const seen = new Set();
    for (const rawLine of String(stdout).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('INFO') || line.startsWith('DEBUG') || /\s{2,}/.test(line)) continue;
        const token = line.split(/\s+/)[0];
        if (!token || !token.includes('/') || seen.has(token)) continue;
        seen.add(token);
        models.push({ id: token, name: token, source: 'opencode-cli' });
    }
    return models;
}

function parseCodexTomlDefaultModel(tomlText = '') {
    const match = String(tomlText).match(/^\s*model\s*=\s*["']([^"']+)["']/m);
    return match ? match[1].trim() : null;
}

function readCodexModels({ env = process.env, homeDir, fsImpl = fs } = {}) {
    const home = homeDir || getUserHome(env, os.homedir());
    const codexHome = (env.CODEX_HOME || '').trim() || path.join(home, '.codex');
    const configPath = path.join(codexHome, 'config.toml');
    const cachePath = path.join(codexHome, 'models_cache.json');

    let defaultModel = null;
    try {
        if (isFileSafe(configPath, fsImpl)) {
            defaultModel = parseCodexTomlDefaultModel(fsImpl.readFileSync(configPath, 'utf-8'));
        }
    } catch {
        // ignore unreadable config.toml
    }

    const models = [];
    const seen = new Set();

    try {
        if (isFileSafe(cachePath, fsImpl)) {
            const parsed = JSON.parse(fsImpl.readFileSync(cachePath, 'utf-8'));
            for (const entry of parsed?.models || []) {
                if (!entry?.slug) continue;
                if (entry.visibility && entry.visibility !== 'list') continue;
                if (seen.has(entry.slug)) continue;
                seen.add(entry.slug);
                models.push({
                    id: entry.slug,
                    name: entry.display_name || entry.slug,
                    description: entry.description || '',
                    source: 'codex-cache',
                    isDefault: entry.slug === defaultModel,
                });
            }
        }
    } catch {
        // ignore unreadable cache
    }

    if (defaultModel && !seen.has(defaultModel)) {
        models.unshift({ id: defaultModel, name: defaultModel, source: 'codex-config', isDefault: true });
    }

    if (!models.length) {
        return CURATED_FALLBACKS.codex.map((m, idx) => ({
            ...m,
            isDefault: defaultModel ? m.id === defaultModel : idx === 0,
        }));
    }

    if (!models.some((m) => m.isDefault)) models[0].isDefault = true;
    return models;
}

function readClaudeModels({ env = process.env, homeDir, fsImpl = fs } = {}) {
    const home = homeDir || getUserHome(env, os.homedir());
    const settingsPath = path.join(home, '.claude', 'settings.json');
    let configuredModel = null;
    try {
        if (isFileSafe(settingsPath, fsImpl)) {
            const parsed = JSON.parse(fsImpl.readFileSync(settingsPath, 'utf-8'));
            if (typeof parsed?.model === 'string' && parsed.model.trim()) {
                configuredModel = parsed.model.trim();
            }
        }
    } catch {
        // ignore
    }

    const models = CURATED_FALLBACKS.claude.map((m) => ({
        ...m,
        isDefault: configuredModel ? m.id === configuredModel : Boolean(m.isDefault),
    }));
    if (configuredModel && !models.some((m) => m.id === configuredModel)) {
        models.unshift({ id: configuredModel, name: configuredModel, source: 'claude-settings', isDefault: true });
    }
    return models;
}

async function listModelsForHarness(harnessId, { cliPath = null, platform = process.platform, env = process.env, homeDir, fsImpl = fs, execFileImpl = execFile } = {}) {
    const home = homeDir || getUserHome(env, os.homedir());

    if (harnessId === 'antigravity') {
        if (cliPath) {
            const { cmd, args } = buildPlatformInvocation(cliPath, ['models'], { platform, env });
            const res = await execFileAsync(cmd, args, { env, execFileImpl, timeout: 6000 });
            const parsed = parseAgyModelsOutput(res.stdout);
            if (parsed.length) {
                parsed[0].isDefault = true;
                return parsed;
            }
        }
        return CURATED_FALLBACKS.antigravity;
    }

    if (harnessId === 'opencode') {
        if (cliPath) {
            const { cmd, args } = buildPlatformInvocation(cliPath, ['models'], { platform, env });
            const res = await execFileAsync(cmd, args, { env, execFileImpl, timeout: 6000 });
            const parsed = parseOpenCodeModelsOutput(res.stdout);
            if (parsed.length) {
                parsed[0].isDefault = true;
                return parsed;
            }
        }
        const registry = buildHarnessRegistry({ platform, env, homeDir: home });
        for (const p of registry.opencode.config.paths) {
            try {
                if (!isFileSafe(p, fsImpl)) continue;
                const cfg = JSON.parse(fsImpl.readFileSync(p, 'utf-8'));
                if (typeof cfg?.model === 'string' && cfg.model.trim()) {
                    const list = [{ id: cfg.model.trim(), name: cfg.model.trim(), source: 'opencode-config', isDefault: true }];
                    for (const fb of CURATED_FALLBACKS.opencode) {
                        if (fb.id !== cfg.model.trim()) list.push({ ...fb, isDefault: false });
                    }
                    return list;
                }
            } catch {
                // ignore
            }
        }
        return CURATED_FALLBACKS.opencode;
    }

    if (harnessId === 'codex') {
        return readCodexModels({ env, homeDir: home, fsImpl });
    }

    if (harnessId === 'claude') {
        return readClaudeModels({ env, homeDir: home, fsImpl });
    }

    return [];
}

module.exports = {
    CURATED_FALLBACKS,
    parseAgyModelsOutput,
    parseOpenCodeModelsOutput,
    readCodexModels,
    readClaudeModels,
    listModelsForHarness,
};
