const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { buildHarnessRegistry, getUserHome } = require('./registry');
const { buildPlatformInvocation } = require('./platformProbe');
const { detectAllHarnesses } = require('./detect');

const OUTPUT_CAP = 512 * 1024;
const activeRuns = new Map();
let runSeq = 0;

function killHarnessTree(child, platform = process.platform, spawnImpl = spawn) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    if (platform === 'win32') {
        try {
            spawnImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } catch {
            try { child.kill(); } catch { /* ignore */ }
        }
        return;
    }
    try {
        process.kill(-child.pid, 'SIGTERM');
    } catch {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ignore */ }
        }
    }, 4000).unref();
}

function extractTextFromJsonEvent(harnessId, obj) {
    if (!obj || typeof obj !== 'object') return null;

    if (harnessId === 'claude' || harnessId === 'antigravity') {
        if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
            const parts = obj.message.content.filter((b) => b?.type === 'text' && b.text).map((b) => b.text);
            if (parts.length) return { type: 'chunk', text: parts.join('') };
        }
        if (obj.type === 'content_block_delta' && obj.delta?.text) {
            return { type: 'chunk', text: obj.delta.text };
        }
        if (obj.type === 'result' && typeof obj.result === 'string') {
            return { type: 'result', text: obj.result };
        }
    }

    if (harnessId === 'codex') {
        if (obj.type === 'item.completed' && obj.item?.type === 'agent_message' && obj.item?.text) {
            return { type: 'chunk', text: obj.item.text };
        }
        if (obj.type === 'message' && obj.content) {
            return { type: 'chunk', text: typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content) };
        }
    }

    if (harnessId === 'opencode') {
        if (obj.type === 'text' && obj.part?.text) {
            return { type: 'chunk', text: obj.part.text };
        }
        if (typeof obj.text === 'string') {
            return { type: 'chunk', text: obj.text };
        }
    }

    if (typeof obj.delta === 'string') return { type: 'chunk', text: obj.delta };
    if (typeof obj.content === 'string') return { type: 'chunk', text: obj.content };
    if (typeof obj.message === 'string') return { type: 'status', text: obj.message };
    return null;
}

function createLineEventParser(harnessId) {
    let buffer = '';
    return function parseChunk(chunk) {
        buffer += String(chunk || '');
        const events = [];
        let newlineIdx;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
            buffer = buffer.slice(newlineIdx + 1);
            if (!line.trim()) continue;
            if (line.trim().startsWith('{')) {
                try {
                    const obj = JSON.parse(line);
                    const extracted = extractTextFromJsonEvent(harnessId, obj);
                    if (extracted) {
                        events.push({ ...extracted, raw: obj });
                        continue;
                    }
                    events.push({ type: 'raw-json', text: '', raw: obj });
                    continue;
                } catch {
                    // fall through to plain line
                }
            }
            events.push({ type: 'chunk', text: line + '\n', raw: line });
        }
        return events;
    };
}

function flushRemainingBuffer(harnessId, remainder) {
    const trimmed = String(remainder || '').trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('{')) {
        try {
            const obj = JSON.parse(trimmed);
            const extracted = extractTextFromJsonEvent(harnessId, obj);
            if (extracted) return [{ ...extracted, raw: obj }];
        } catch {
            // plain text fallback
        }
    }
    return [{ type: 'chunk', text: trimmed, raw: trimmed }];
}

/**
 * Execute a headless prompt through an installed CLI harness.
 * Returns { runId, child, cancel, done }.
 */
async function startHarnessRun(options = {}) {
    const {
        harnessId,
        model = null,
        prompt,
        cwd = process.cwd(),
        mode = 'plan',
        autoApprove = false,
        overrides = {},
        binPath: explicitBinPath = null,
        platform = process.platform,
        env = process.env,
        homeDir = getUserHome(env, os.homedir()),
        fsImpl = fs,
        spawnImpl = spawn,
        onEvent,
    } = options;

    if (!harnessId) throw new Error('harnessId is required');
    if (!prompt || !String(prompt).trim()) throw new Error('Prompt cannot be empty');

    const registry = buildHarnessRegistry({ platform, env, homeDir });
    const spec = registry[harnessId];
    if (!spec) throw new Error(`Unknown harness "${harnessId}"`);

    let resolvedCwd = path.resolve(cwd);
    try {
        if (!fsImpl.existsSync(resolvedCwd) || !fsImpl.statSync(resolvedCwd).isDirectory()) {
            throw new Error(`Working directory does not exist: ${resolvedCwd}`);
        }
    } catch (err) {
        throw new Error(err.message);
    }

    let binPath = explicitBinPath;
    if (!binPath) {
        const detection = await detectAllHarnesses({
            harnessIds: [harnessId],
            overrides,
            platform,
            env,
            homeDir,
            fsImpl,
            skipAppxProbe: true,
        });
        const cliSurface = detection.harnesses[0]?.surfaces?.cli;
        if (!cliSurface?.installed || !cliSurface.path) {
            throw new Error(`${spec.name} CLI is not installed or not found on PATH. Install it or set a custom CLI path.`);
        }
        binPath = cliSurface.path;
    }

    const cliArgs = spec.cli.buildRunArgs({ prompt: String(prompt), model: model || undefined, mode, cwd: resolvedCwd, autoApprove });
    const { cmd, args } = buildPlatformInvocation(binPath, cliArgs, { platform, env });

    const runId = `run-${++runSeq}-${Date.now()}`;
    const child = spawnImpl(cmd, args, {
        cwd: resolvedCwd,
        env,
        detached: platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let cancelled = false;
    const cancel = () => {
        cancelled = true;
        killHarnessTree(child, platform, spawnImpl);
    };
    activeRuns.set(runId, { child, cancel, harnessId });

    const parseLine = createLineEventParser(harnessId);
    let collectedText = '';
    let finalResultText = '';
    let stderrTail = '';
    let stdoutRemainder = '';

    onEvent?.({ runId, harnessId, type: 'status', text: `Starting ${spec.name} CLI...` });

    const done = new Promise((resolve, reject) => {
        child.stdout?.on('data', (buf) => {
            const str = buf.toString();
            stdoutRemainder += str;
            const lastNl = stdoutRemainder.lastIndexOf('\n');
            if (lastNl !== -1) {
                const ready = stdoutRemainder.slice(0, lastNl + 1);
                stdoutRemainder = stdoutRemainder.slice(lastNl + 1);
                for (const ev of parseLine(ready)) {
                    if (ev.type === 'chunk') collectedText = (collectedText + ev.text).slice(-OUTPUT_CAP);
                    if (ev.type === 'result') finalResultText = ev.text;
                    onEvent?.({ runId, harnessId, ...ev });
                }
            }
        });

        child.stderr?.on('data', (buf) => {
            const str = buf.toString();
            stderrTail = (stderrTail + str).slice(-8192);
            onEvent?.({ runId, harnessId, type: 'stderr', text: str });
        });

        child.on('error', (err) => {
            activeRuns.delete(runId);
            reject(new Error(`Failed to start ${spec.name} CLI: ${err.message}`));
        });

        child.on('close', (code, signal) => {
            activeRuns.delete(runId);
            for (const ev of flushRemainingBuffer(harnessId, stdoutRemainder)) {
                if (ev.type === 'chunk') collectedText = (collectedText + ev.text).slice(-OUTPUT_CAP);
                if (ev.type === 'result') finalResultText = ev.text;
                onEvent?.({ runId, harnessId, ...ev });
            }

            if (cancelled) {
                reject(new Error(`${spec.name} run was cancelled.`));
                return;
            }
            if (code !== 0) {
                const detail = stderrTail.trim() || collectedText.trim() || `Exited with ${signal || code}`;
                reject(new Error(`${spec.name} CLI failed (exit ${code ?? signal}): ${detail.slice(-600)}`));
                return;
            }

            const output = (finalResultText || collectedText).trim();
            onEvent?.({ runId, harnessId, type: 'done', text: output });
            resolve({
                runId,
                harnessId,
                exitCode: code,
                output,
                stderr: stderrTail.trim(),
            });
        });
    });

    return { runId, child, cancel, done };
}

function cancelHarnessRun(runId) {
    const entry = activeRuns.get(runId);
    if (!entry) return false;
    entry.cancel();
    return true;
}

module.exports = {
    startHarnessRun,
    cancelHarnessRun,
    killHarnessTree,
    createLineEventParser,
    extractTextFromJsonEvent,
};
