import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    findLocalMediaPath,
    attachLocalMediaResult,
    saveRenderedMedia,
    parseStoryboardFromOutput,
    parseThreeJsFromOutput,
} = require('../lib/harnesses/media.js');
const { installThreejsSkills } = require('../lib/harnesses/configure.js');
const { buildHarnessStudioPrompt, extractMediaFromHarnessOutput } = await import('../src/lib/harnessStudioMode.js');
const {
    stripModuleBoilerplate,
    compileThreeSceneBuilder,
} = await import('../src/lib/harnessThreeComposer.js');
const {
    getCanvasDimensions,
    computeSceneTimeline,
    normalizeMotion,
    normalizeTransition,
    resolveSceneVfx,
    normalizeGrade,
    normalizeMusicMood,
} = await import('../src/lib/harnessVideoComposer.js');

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
        videoEngine: 'storyboard',
        prompt: 'two race cars',
        aspectRatio: '16:9',
        harness: { id: 'antigravity', config: { mcpConfigured: true, muapiHasCredentials: true, nonMuapiServers: [] } },
        hasAppMuapiKey: false,
    });
    assert.equal(vidWithKey.mode, 'auto');
    assert.doesNotMatch(vidWithKey.wrappedPrompt, /Do NOT call/i);

    const threePlan = buildHarnessStudioPrompt({
        kind: 'video',
        videoEngine: 'threejs',
        prompt: '3D product commercial',
        aspectRatio: '16:9',
        durationSec: 10,
        vfx: 'frost',
        grade: 'cold-steel',
        musicMood: 'cinematic',
        harness: agyNoKey,
        hasAppMuapiKey: false,
    });
    assert.match(threePlan.wrappedPrompt, /Three\.js r186/);
    assert.match(threePlan.wrappedPrompt, /ogai-threejs-meta/);
    assert.match(threePlan.wrappedPrompt, /ogai-threejs-code/);
    assert.match(threePlan.wrappedPrompt, /Do NOT call any muapi MCP tools/i);
});

test('storyboard parser attaches multi-scene images with Windows spaces and timeline normalizes duration/motion', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai space sb-'));
    const s1 = path.join(tmpDir, 'scene 1.jpg');
    const s2 = path.join(tmpDir, 'scene 2.jpg');
    fs.writeFileSync(s1, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    fs.writeFileSync(s2, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const text = `Preparing storyboard...\n\`\`\`ogai-storyboard
{
  "durationSec": 10,
  "audioScript": "Horbax cooler keeps ice frozen.",
  "scenes": [
    { "durationSec": 3, "headline": "Built Tough", "motion": "Slow cinematic push-in", "imagePath": ${JSON.stringify(s1)} },
    { "durationSec": 4, "headline": "Cold Inside", "motion": "Gentle wide pullback", "imagePath": ${JSON.stringify(s2)} }
  ]
}
\`\`\``;

    const sb = parseStoryboardFromOutput(text);
    assert.equal(sb.durationSec, 10);
    assert.equal(sb.scenes.length, 2);

    const attached = attachLocalMediaResult({ output: text });
    assert.equal(attached.storyboard.scenes.length, 2);
    assert.match(attached.storyboard.scenes[0].imageDataUrl, /^data:image\/jpeg;base64,/);
    assert.match(attached.storyboard.scenes[1].imageDataUrl, /^data:image\/jpeg;base64,/);
    assert.equal(attached.mediaUrl, undefined);

    assert.deepEqual(getCanvasDimensions('16:9'), { width: 1280, height: 720 });
    assert.deepEqual(getCanvasDimensions('9:16'), { width: 720, height: 1280 });
    assert.equal(normalizeMotion('Slow cinematic push-in', 0), 'zoom-in');
    assert.equal(normalizeMotion('Gentle wide pullback', 1), 'zoom-out');

    const timeline = computeSceneTimeline(attached.storyboard.scenes, 10);
    assert.equal(timeline.length, 2);
    assert.ok(Math.abs(timeline[1].end - 10) < 1e-6);

    const saved = saveRenderedMedia({
        bytes: Uint8Array.from([1, 2, 3, 4]),
        ext: 'webm',
        name: 'Horbax Cooler Ad',
        outputDir: path.join(tmpDir, 'renders'),
    });
    assert.equal(fs.existsSync(saved.path), true);
    assert.match(saved.url, /^file:\/\/\//);
});

test('Cinema Studio compiled camera prompts route cleanly through buildHarnessStudioPrompt for Shot and Video', () => {
    const cinemaPrompt = 'Horbax Air Cooler grand opening commercial, shot on a modular 8K digital cinema camera, using a creative tilt lens effect at 14mm, aperture f/1.4';
    const agyHarness = { id: 'antigravity', config: { mcpConfigured: true, muapiHasCredentials: false, nonMuapiServers: [] } };

    const shot = buildHarnessStudioPrompt({
        kind: 'image',
        prompt: `${cinemaPrompt}\nTarget resolution: 2K`,
        aspectRatio: '16:9',
        harness: agyHarness,
        hasAppMuapiKey: false,
    });
    assert.equal(shot.mode, 'auto');
    assert.match(shot.wrappedPrompt, /modular 8K digital cinema camera/i);
    assert.match(shot.wrappedPrompt, /image-generator/i);

    const sequence = buildHarnessStudioPrompt({
        kind: 'video',
        videoEngine: 'storyboard',
        prompt: `${cinemaPrompt}\nTarget resolution: 2K`,
        aspectRatio: '16:9',
        harness: agyHarness,
        hasAppMuapiKey: false,
    });
    assert.equal(sequence.mode, 'auto');
    assert.match(sequence.wrappedPrompt, /ogai-storyboard/);
    assert.match(sequence.wrappedPrompt, /modular 8K digital cinema camera/i);

    const sequence3d = buildHarnessStudioPrompt({
        kind: 'video',
        videoEngine: 'threejs',
        prompt: `${cinemaPrompt}\nTarget resolution: 2K`,
        aspectRatio: '16:9',
        harness: agyHarness,
        hasAppMuapiKey: false,
    });
    assert.match(sequence3d.wrappedPrompt, /ogai-threejs-code/);
    assert.match(sequence3d.wrappedPrompt, /modular 8K digital cinema camera/i);
});

test('Cinematic VFX, grading, transition, music mood normalizers and 21:9/4:5 dimensions work cleanly', () => {
    assert.deepEqual(getCanvasDimensions('21:9'), { width: 1344, height: 576 });
    assert.deepEqual(getCanvasDimensions('4:5'), { width: 864, height: 1080 });

    assert.equal(normalizeMotion('dynamic handheld chase', 0), 'handheld');
    assert.equal(normalizeMotion('crane tilt up', 0), 'tilt-up');
    assert.equal(normalizeTransition('whip pan left', 0), 'whip-left');
    assert.equal(normalizeTransition('white flash burst', 0), 'flash');
    assert.equal(resolveSceneVfx('', 'auto', 'ice cold cooler frost mist'), 'frost');
    assert.equal(resolveSceneVfx('embers', 'frost', 'cool'), 'embers');
    assert.equal(resolveSceneVfx('', 'none', 'ice'), 'none');
    assert.equal(normalizeGrade('auto', 'golden campfire sunset'), 'golden-hour');
    assert.equal(normalizeMusicMood('auto', 'upbeat festive commercial'), 'upbeat');

    const richJson = `\`\`\`ogai-storyboard
{
  "durationSec": 15,
  "full_script": "Beat the heat with Horbax!",
  "musicMood": "upbeat",
  "grade": "cold-steel",
  "vfx": "frost",
  "letterbox": true,
  "sound_effects": ["whoosh", "crisp ice crackle"],
  "scenes": [
    { "durationSec": 5, "headline": "Horbax", "transition": "flash", "vfx": "frost" },
    { "durationSec": 5, "headline": "Arctic Chill", "transition": "whip-left" },
    { "durationSec": 5, "headline": "Grand Opening" }
  ]
}
\`\`\``;
    const parsed = parseStoryboardFromOutput(richJson);
    assert.equal(parsed.audioScript, 'Beat the heat with Horbax!');
    assert.equal(parsed.vfx, 'frost');
    assert.equal(parsed.grade, 'cold-steel');
    assert.equal(parsed.musicMood, 'upbeat');
    assert.equal(parsed.letterbox, true);
    assert.match(parsed.soundEffects, /ice crackle/);
    assert.equal(parsed.scenes[2].titleStyle, 'hero-center');

    const longPrompt = buildHarnessStudioPrompt({
        kind: 'video',
        videoEngine: 'storyboard',
        prompt: 'Horbax air cooler opening',
        aspectRatio: '21:9',
        durationSec: 15,
        vfx: 'frost',
        grade: 'cold-steel',
        musicMood: 'upbeat',
        letterbox: true,
        negativePrompt: 'blurry, watermarks',
        hasReferenceImages: true,
        harness: { id: 'antigravity', config: { mcpConfigured: true, muapiHasCredentials: false } },
        hasAppMuapiKey: false,
    });
    assert.match(longPrompt.wrappedPrompt, /4-scene 15-second 21:9/i);
    assert.match(longPrompt.wrappedPrompt, /VFX=frost/);
    assert.match(longPrompt.wrappedPrompt, /Avoid: blurry, watermarks/);
    assert.match(longPrompt.wrappedPrompt, /reference frame/i);
});

test('installThreejsSkills copies bundled CloudAI-X threejs skills across all harness targets', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-threejs-home-'));
    const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-threejs-ws-'));
    const env = { HOME: tmpHome, USERPROFILE: tmpHome, XDG_CONFIG_HOME: path.join(tmpHome, '.config') };

    const res = installThreejsSkills({ homeDir: tmpHome, env, workspaceDir: tmpWs });
    assert.equal(res.ok, true);
    assert.equal(res.count, 13);
    assert.ok(res.skillNames.includes('threejs-fundamentals'));
    assert.ok(res.skillNames.includes('threejs-shaders'));
    assert.equal(res.installedPaths.length, 5);
    for (const root of res.installedPaths) {
        assert.equal(fs.existsSync(path.join(root, 'threejs-fundamentals', 'SKILL.md')), true);
    }
});

test('parseThreeJsFromOutput and compileThreeSceneBuilder handle ES boilerplate and extract meta/code cleanly', () => {
    const rawOutput = `Here is your 3D commercial:
\`\`\`ogai-threejs-meta
{
  "durationSec": 12,
  "audioScript": "Meet the Horbax Polar 3D cooler.",
  "musicMood": "cinematic",
  "grade": "cold-steel",
  "accentColor": "#38bdf8",
  "letterbox": true,
  "sound_effects": ["whoosh", "frost chime"],
  "bloom": { "strength": 0.6, "radius": 0.5, "threshold": 0.8 },
  "overlays": [
    { "start": 0.5, "end": 4, "headline": "HORBAX POLAR", "subline": "ARCTIC COOLING", "style": "lower-third" }
  ]
}
\`\`\`

\`\`\`ogai-threejs-code
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export default function buildScene({ THREE, scene, camera, utils }) {
  let angle = 0;
  return function update({ elapsed, progress, delta }) {
    angle = progress * Math.PI * 2;
    return { angle, elapsed, delta };
  };
}
\`\`\``;

    const attached = attachLocalMediaResult({ output: rawOutput });
    assert.ok(attached.threejs);
    assert.equal(attached.threejs.durationSec, 12);
    assert.equal(attached.threejs.grade, 'cold-steel');
    assert.equal(attached.threejs.letterbox, true);
    assert.match(attached.threejs.soundEffects, /frost chime/);
    assert.equal(attached.threejs.bloom.strength, 0.6);
    assert.equal(attached.threejs.overlays.length, 1);

    const stripped = stripModuleBoilerplate(attached.threejs.code);
    assert.doesNotMatch(stripped, /import\s+\*\s+as\s+THREE/);
    assert.doesNotMatch(stripped, /export\s+default/);

    const buildFn = compileThreeSceneBuilder(attached.threejs.code);
    const updateFn = buildFn({ THREE: {}, scene: {}, camera: {}, utils: {} });
    assert.equal(typeof updateFn, 'function');
    const step = updateFn({ elapsed: 1.5, progress: 0.5, delta: 1 / 30 });
    assert.ok(Math.abs(step.angle - Math.PI) < 1e-6);
});
