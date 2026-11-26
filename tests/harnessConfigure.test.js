const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { configureHarnessMcp, unconfigureHarnessMcp } = require('../lib/harnesses/configure');
const { parseTomlMcpServer, upsertTomlMcpServer, removeTomlMcpServer } = require('../lib/harnesses/tomlHelper');

const mkTempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-harness-cfg-'));

test('TOML helper upserts and removes [mcp_servers.muapi] while preserving unrelated sections', () => {
    const initial = `# User Codex config\nmodel = "gpt-5.4"\n\n[mcp_servers.other]\ncommand = "npx"\n`;
    const updated = upsertTomlMcpServer(initial, 'muapi', {
        url: 'https://api.muapi.ai/mcp',
        bearer_token_env_var: 'MUAPI_API_KEY',
        enabled: true,
    });

    assert.match(updated, /# User Codex config/);
    assert.match(updated, /\[mcp_servers\.other\]/);
    assert.deepEqual(parseTomlMcpServer(updated, 'muapi'), {
        url: 'https://api.muapi.ai/mcp',
        bearer_token_env_var: 'MUAPI_API_KEY',
        enabled: true,
    });

    // Idempotent second upsert
    const updatedAgain = upsertTomlMcpServer(updated, 'muapi', {
        url: 'https://api.muapi.ai/mcp',
        bearer_token_env_var: 'MUAPI_API_KEY',
        enabled: true,
    });
    assert.equal(updatedAgain, updated);

    const removed = removeTomlMcpServer(updated, 'muapi');
    assert.equal(parseTomlMcpServer(removed, 'muapi'), null);
    assert.match(removed, /\[mcp_servers\.other\]/);
});

test('configureHarnessMcp creates backups, preserves existing keys, redacts API keys, and supports dryRun', () => {
    const home = mkTempHome();
    const env = { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming') };

    // Pre-seed OpenCode config
    const opencodePath = path.join(home, '.config', 'opencode', 'opencode.json');
    fs.mkdirSync(path.dirname(opencodePath), { recursive: true });
    fs.writeFileSync(opencodePath, JSON.stringify({ theme: 'dark', mcp: { existing: { type: 'local', command: ['echo'] } } }, null, 2));

    // Dry run should not touch disk
    const dry = configureHarnessMcp({
        harnessId: 'antigravity',
        platform: 'linux',
        homeDir: home,
        env,
        apiKey: 'mu_secret_123456',
        dryRun: true,
    });
    assert.equal(dry.dryRun, true);
    assert.equal(fs.existsSync(dry.results[0].configPath), false);
    assert.doesNotMatch(dry.results[0].preview, /mu_secret_123456/);
    assert.match(dry.results[0].preview, /mu_s\*\*\*\*/);

    // Real configure across all harnesses
    const res = configureHarnessMcp({
        harnessId: 'all',
        platform: 'linux',
        homeDir: home,
        env,
        apiKey: 'mu_secret_123456',
    });
    assert.equal(res.ok, true);

    const openCodeWritten = JSON.parse(fs.readFileSync(opencodePath, 'utf-8'));
    assert.equal(openCodeWritten.theme, 'dark');
    assert.ok(openCodeWritten.mcp.existing);
    assert.equal(openCodeWritten.mcp.muapi.url, 'https://api.muapi.ai/mcp');
    assert.equal(openCodeWritten.mcp.muapi.enabled, true);
    assert.equal(fs.existsSync(`${opencodePath}.bak`), true);

    const codexPath = path.join(home, '.codex', 'config.toml');
    assert.ok(parseTomlMcpServer(fs.readFileSync(codexPath, 'utf-8'), 'muapi'));

    // Unconfigure cleans muapi out while keeping existing entries
    unconfigureHarnessMcp({
        harnessId: 'opencode',
        platform: 'linux',
        homeDir: home,
        env,
    });
    const afterRemove = JSON.parse(fs.readFileSync(opencodePath, 'utf-8'));
    assert.equal(afterRemove.mcp.muapi, undefined);
    assert.ok(afterRemove.mcp.existing);
});
