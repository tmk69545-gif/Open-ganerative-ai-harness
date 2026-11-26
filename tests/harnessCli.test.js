const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runCli } = require('../bin/open-generative-ai');
const { assertLoopbackRequest } = require('../lib/harnesses/localGuard');

test('CLI detect --json and configure --dry-run return valid structured output', async () => {
    const logs = [];
    const errors = [];
    const code = await runCli(['harness', 'detect', '--json', '--harness', 'claude'], {
        log: (m) => logs.push(m),
        error: (m) => errors.push(m),
    });
    assert.equal(code, 0);
    assert.equal(errors.length, 0);
    const parsed = JSON.parse(logs.join('\n'));
    assert.equal(parsed.harnesses.length, 1);
    assert.equal(parsed.harnesses[0].id, 'claude');

    const dryLogs = [];
    const tmpCfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-cli-cfg-')), 'opencode.json');
    const cfgCode = await runCli(['harness', 'configure', 'opencode', '--config', tmpCfg, '--dry-run', '--json'], {
        log: (m) => dryLogs.push(m),
        error: (m) => errors.push(m),
    });
    assert.equal(cfgCode, 0);
    const cfgParsed = JSON.parse(dryLogs.join('\n'));
    assert.equal(cfgParsed.dryRun, true);
    assert.equal(cfgParsed.results[0].configPath, path.resolve(tmpCfg));
    assert.equal(fs.existsSync(tmpCfg), false);
});

test('assertLoopbackRequest allows localhost and rejects remote hosts or forwarded IPs', () => {
    const mkReq = (url, headers = {}) => ({
        url,
        headers: { get: (k) => headers[k.toLowerCase()] || null },
    });

    assert.equal(assertLoopbackRequest(mkReq('http://localhost:3000/api/harnesses/detect', { host: 'localhost:3000' })).ok, true);
    assert.equal(assertLoopbackRequest(mkReq('http://127.0.0.1:3000/api/harnesses/detect', { host: '127.0.0.1:3000' })).ok, true);
    assert.equal(assertLoopbackRequest(mkReq('http://[::1]:3000/api/harnesses/detect', { host: '[::1]:3000' })).ok, true);

    assert.equal(assertLoopbackRequest(mkReq('https://studio.example.com/api/harnesses/detect', { host: 'studio.example.com' })).ok, false);
    assert.equal(assertLoopbackRequest(mkReq('http://localhost:3000/api/harnesses/detect', { host: 'localhost:3000', 'x-forwarded-for': '203.0.113.5' })).ok, false);
});
