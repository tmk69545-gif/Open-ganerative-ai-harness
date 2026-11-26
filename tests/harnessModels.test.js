const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    parseAgyModelsOutput,
    parseOpenCodeModelsOutput,
    readCodexModels,
    listModelsForHarness,
} = require('../lib/harnesses/models');
const { buildHarnessRegistry } = require('../lib/harnesses/registry');

test('parseAgyModelsOutput parses tab-separated Antigravity models', () => {
    const out = `Fetching available models...\ngemini-4-hydrogen-high\tGemini 4 Hydrogen (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n`;
    const models = parseAgyModelsOutput(out);
    assert.deepEqual(models, [
        { id: 'gemini-4-hydrogen-high', name: 'Gemini 4 Hydrogen (High)', source: 'agy-cli' },
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)', source: 'agy-cli' },
    ]);
});

test('parseOpenCodeModelsOutput parses provider/model lines', () => {
    const out = `anthropic/claude-sonnet-4-6\nopenai/gpt-5.4\n`;
    const models = parseOpenCodeModelsOutput(out);
    assert.deepEqual(models, [
        { id: 'anthropic/claude-sonnet-4-6', name: 'anthropic/claude-sonnet-4-6', source: 'opencode-cli' },
        { id: 'openai/gpt-5.4', name: 'openai/gpt-5.4', source: 'opencode-cli' },
    ]);
});

test('readCodexModels reads visible models from models_cache.json and marks default from config.toml', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-codex-models-'));
    const codexDir = path.join(home, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'config.toml'), 'model = "gpt-5.6-luna"\n');
    fs.writeFileSync(path.join(codexDir, 'models_cache.json'), JSON.stringify({
        models: [
            { slug: 'gpt-reserve', display_name: 'Hidden', visibility: 'hide' },
            { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list' },
            { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list' },
        ],
    }));

    const models = readCodexModels({ homeDir: home, env: { HOME: home } });
    assert.equal(models.length, 2);
    assert.equal(models[0].id, 'gpt-6-luna');
    assert.equal(models[1].id, 'gpt-5.6-luna');
    assert.equal(models[1].isDefault, true);
});

test('listModelsForHarness passes --model flag cleanly in registry buildRunArgs', async () => {
    const registry = buildHarnessRegistry({ platform: 'linux', homeDir: '/tmp' });
    assert.deepEqual(
        registry.antigravity.cli.buildRunArgs({ prompt: 'hi', model: 'gemini-4-hydrogen-xhigh', mode: 'plan' }),
        ['-p', 'hi', '--output-format', 'stream-json', '--model', 'gemini-4-hydrogen-xhigh', '--mode', 'plan']
    );
    assert.deepEqual(
        registry.codex.cli.buildRunArgs({ prompt: 'hi', model: 'gpt-6-luna', mode: 'plan' }),
        ['exec', '--json', '--skip-git-repo-check', '--model', 'gpt-6-luna', '--sandbox', 'read-only', 'hi']
    );

    const mediaMod = await import('../src/lib/harnessStudioMode.js');
    const svgOut = mediaMod.extractMediaFromHarnessOutput('<svg width="10" height="10"></svg>', 'image');
    assert.match(svgOut.mediaUrl, /^data:image\/svg\+xml/);
    const urlOut = mediaMod.extractMediaFromHarnessOutput('Generated: https://cdn.muapi.ai/out/banana.png', 'image');
    assert.equal(urlOut.mediaUrl, 'https://cdn.muapi.ai/out/banana.png');
    assert.equal(mediaMod.formatStudioError("Error invoking remote method 'local-ai:generate': Error: Model file not found"), 'Model file not found');
});
