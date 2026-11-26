const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startHarnessRun } = require('../lib/harnesses/runner');

function createFakeCliShim(dir, name) {
    const jsPath = path.join(dir, `${name}-fake.js`);
    fs.writeFileSync(jsPath, `
const args = process.argv.slice(2);
if (args.includes('--version')) {
    console.log('${name} 9.9.9');
    process.exit(0);
}
const pIdx = args.indexOf('-p');
const prompt = pIdx !== -1 && args[pIdx + 1] !== undefined ? args[pIdx + 1] : (args[args.length - 1] || '');
if (prompt === 'hang') {
    console.log('ready');
    setTimeout(() => {}, 30000);
} else if (prompt === 'fail') {
    console.error('simulated failure');
    process.exit(2);
} else if ('${name}' === 'claude') {
    console.log(JSON.stringify({ type: 'content_block_delta', delta: { text: 'Hello ' } }));
    console.log(JSON.stringify({ type: 'content_block_delta', delta: { text: 'from Claude' } }));
    console.log(JSON.stringify({ type: 'result', result: 'Hello from Claude' }));
} else if ('${name}' === 'codex') {
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Codex reply' } }));
} else if ('${name}' === 'opencode') {
    console.log(JSON.stringify({ type: 'text', part: { text: 'OpenCode reply' } }));
} else if ('${name}' === 'agy') {
    console.log(JSON.stringify({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'Agy ' } }));
    console.log(JSON.stringify({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'streamed' } }));
    console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Antigravity reply: ' + prompt } }));
} else {
    console.log('Antigravity reply: ' + prompt);
}
`);

    if (process.platform === 'win32') {
        const cmdPath = path.join(dir, `${name}.cmd`);
        fs.writeFileSync(cmdPath, `@echo off\r\n"${process.execPath}" "${jsPath}" %*\r\n`);
        return cmdPath;
    }
    const shPath = path.join(dir, name);
    fs.writeFileSync(shPath, `#!/bin/sh\nexec "${process.execPath}" "${jsPath}" "$@"\n`);
    fs.chmodSync(shPath, 0o755);
    return shPath;
}

test('startHarnessRun streams normalized output for claude, codex, opencode, and antigravity', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-fake-cli-'));
    const bins = {
        claude: createFakeCliShim(tmpDir, 'claude'),
        codex: createFakeCliShim(tmpDir, 'codex'),
        opencode: createFakeCliShim(tmpDir, 'opencode'),
        antigravity: createFakeCliShim(tmpDir, 'agy'),
    };

    const claudeEvents = [];
    const claudeRun = await startHarnessRun({
        harnessId: 'claude',
        prompt: 'test prompt',
        cwd: tmpDir,
        binPath: bins.claude,
        onEvent: (e) => claudeEvents.push(e),
    });
    const claudeOut = await claudeRun.done;
    assert.equal(claudeOut.output, 'Hello from Claude');
    assert.ok(claudeEvents.some((e) => e.type === 'chunk' && e.text === 'Hello '));

    const codexRun = await startHarnessRun({ harnessId: 'codex', prompt: 'test', cwd: tmpDir, binPath: bins.codex });
    assert.equal((await codexRun.done).output, 'Codex reply');

    const opencodeRun = await startHarnessRun({ harnessId: 'opencode', prompt: 'test', cwd: tmpDir, binPath: bins.opencode });
    assert.equal((await opencodeRun.done).output, 'OpenCode reply');

    const agyEvents = [];
    const agyRun = await startHarnessRun({
        harnessId: 'antigravity',
        prompt: 'ok',
        cwd: tmpDir,
        binPath: bins.antigravity,
        onEvent: (e) => agyEvents.push(e),
    });
    assert.equal((await agyRun.done).output, 'Antigravity reply: ok');
    assert.ok(agyEvents.some((e) => e.type === 'chunk' && e.text === 'Agy '));
});

test('startHarnessRun handles .cmd paths with spaces on Windows', async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai space dir-'));
    const spacedBin = createFakeCliShim(tmpBase, 'codex');
    const run = await startHarnessRun({ harnessId: 'codex', prompt: 'hello world', cwd: tmpBase, binPath: spacedBin });
    assert.equal((await run.done).output, 'Codex reply');
});

test('startHarnessRun surfaces CLI exit failures and supports cancellation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-fake-cli-err-'));
    const agyBin = createFakeCliShim(tmpDir, 'agy');

    const failRun = await startHarnessRun({ harnessId: 'antigravity', prompt: 'fail', cwd: tmpDir, binPath: agyBin });
    await assert.rejects(failRun.done, /CLI failed \(exit 2\).*simulated failure/);

    const hangRun = await startHarnessRun({ harnessId: 'antigravity', prompt: 'hang', cwd: tmpDir, binPath: agyBin });
    await new Promise((r) => setTimeout(r, 150));
    hangRun.cancel();
    await assert.rejects(hangRun.done, /cancelled/i);
});
