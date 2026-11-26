import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findLocalMediaPath, attachLocalMediaResult } = require('../lib/harnesses/media.js');
const { buildHarnessStudioPrompt, extractMediaFromHarnessOutput } = await import('../src/lib/harnessStudioMode.js');

test('findLocalMediaPath and attachLocalMediaResult resolve Windows paths containing spaces', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai space media-'));
    const imgPath = path.join(baseDir, 'banana test.jpg');
    const missingPath = path.join(baseDir, 'not-created.png');
    fs.writeFileSync(imgPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const output = [
        `* Requested path: ${missingPath} was not created.`,
        `* Exact output path: \`${imgPath}\` — confirmed on disk.`,
    ].join('\n');

    assert.equal(findLocalMediaPath(output), imgPath);

    const attached = attachLocalMediaResult({ output });
    assert.equal(attached.mediaType, 'image');
    assert.equal(attached.mediaPath, imgPath);
    assert.match(attached.mediaUrl, /^data:image\/jpeg;base64,/);

    const vidPath = path.join(baseDir, 'clip render.mp4');
    fs.writeFileSync(vidPath, Buffer.from('mp4'));
    const vidAttached = attachLocalMediaResult({ output: `Saved video to ${vidPath}` });
    assert.equal(vidAttached.mediaType, 'video');
    assert.match(vidAttached.mediaUrl, /^file:\/\/\//);
    assert.ok(vidAttached.mediaUrl.includes('clip%20render.mp4'));
});

test('extractMediaFromHarnessOutput handles Windows paths with spaces and encoded file URLs', () => {
    const imgOut = 'Output saved: C:\\Users\\Sanju Sales\\.gemini\\brain\\test\\banana_1.jpg (done)';
    const extractedImg = extractMediaFromHarnessOutput(imgOut, 'image');
    assert.equal(extractedImg.mediaKind, 'image');
    assert.equal(extractedImg.mediaUrl, 'file:///C:/Users/Sanju%20Sales/.gemini/brain/test/banana_1.jpg');

    const vidOut = 'Render complete at C:\\Users\\Sanju Sales\\Videos\\race clip.mp4';
    const extractedVid = extractMediaFromHarnessOutput(vidOut, 'video');
    assert.equal(extractedVid.mediaKind, 'video');
    assert.equal(extractedVid.mediaUrl, 'file:///C:/Users/Sanju%20Sales/Videos/race%20clip.mp4');
});

test('buildHarnessStudioPrompt avoids MuAPI when credentials are absent and enables Antigravity native image generation', () => {
    const agyNoKey = {
        id: 'antigravity',
        config: { mcpConfigured: true, muapiHasCredentials: false, nonMuapiServers: ['rea'] },
    };

    const imgPlan = buildHarnessStudioPrompt({
        kind: 'image',
        prompt: 'futuristic banana building',
        aspectRatio: '16:9',
        harness: agyNoKey,
        hasAppMuapiKey: false,
    });
    assert.equal(imgPlan.mode, 'auto');
    assert.equal(imgPlan.autoApprove, true);
    assert.match(imgPlan.wrappedPrompt, /Do NOT call any muapi MCP tools/i);
    assert.match(imgPlan.wrappedPrompt, /image-generator/i);

    const vidPlan = buildHarnessStudioPrompt({
        kind: 'video',
        prompt: 'two race cars',
        aspectRatio: '16:9',
        harness: agyNoKey,
        hasAppMuapiKey: false,
    });
    assert.match(vidPlan.wrappedPrompt, /Do NOT call any muapi MCP tools/i);

    const vidWithKey = buildHarnessStudioPrompt({
        kind: 'video',
        prompt: 'two race cars',
        aspectRatio: '16:9',
        harness: { id: 'antigravity', config: { mcpConfigured: true, muapiHasCredentials: true, nonMuapiServers: [] } },
        hasAppMuapiKey: false,
    });
    assert.equal(vidWithKey.mode, 'auto');
    assert.doesNotMatch(vidWithKey.wrappedPrompt, /Do NOT call/i);
});
