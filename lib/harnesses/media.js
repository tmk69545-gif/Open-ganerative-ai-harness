const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');

const IMAGE_MEDIA_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_MEDIA_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv']);
const AUDIO_MEDIA_EXTS = new Set(['.wav', '.mp3', '.ogg', '.m4a']);

/**
 * Scan harness output text for all existing local image, video, or audio file paths,
 * including Windows paths containing spaces (e.g. C:\Users\Sanju Sales\...\out.jpg)
 * and file:/// URIs.
 */
function findAllLocalMediaPaths(text, fsImpl = fs) {
    const raw = String(text || '');
    if (!raw) return [];

    const candidates = [];
    const extGroup = 'png|jpe?g|webp|gif|mp4|webm|mov|mkv|wav|mp3|ogg|m4a';
    const patterns = [
        new RegExp(`file:\\/\\/\\/[^\\s"'<>)]+\\.(?:${extGroup})`, 'gi'),
        new RegExp(`([A-Za-z]:\\\\(?:[^\\\\/:*?"<>|\\r\\n]+\\\\)*[^\\\\/:*?"<>|\\r\\n]*?\\.(?:${extGroup}))(?=$|[\\s"'\`),\\]*])`, 'gi'),
        new RegExp(`\\\`(\\/[^\\\`\\r\\n]+\\.(?:${extGroup}))\\\``, 'gi'),
        new RegExp(`"(\\/[^"\\r\\n]+\\.(?:${extGroup}))"`, 'gi'),
        new RegExp(`(\\/[^\\s"'<>)]+\\.(?:${extGroup}))`, 'gi'),
    ];

    for (const re of patterns) {
        for (const match of raw.matchAll(re)) {
            let candidate = (match[1] || match[0] || '').trim();
            if (!candidate) continue;
            if (/^file:\/\//i.test(candidate)) {
                try {
                    candidate = fileURLToPath(candidate);
                } catch {
                    continue;
                }
            }
            candidates.push(candidate);
        }
    }

    const valid = [];
    const seen = new Set();
    for (const candidate of candidates) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        try {
            if (fsImpl.existsSync(candidate) && fsImpl.statSync(candidate).isFile()) {
                valid.push(candidate);
            }
        } catch {
            // ignore unreadable candidate
        }
    }
    return valid;
}

function findLocalMediaPath(text, fsImpl = fs) {
    return findAllLocalMediaPaths(text, fsImpl)[0] || null;
}

function imageFileToDataUrl(filePath, fsImpl = fs) {
    const ext = path.extname(filePath).toLowerCase();
    if (!IMAGE_MEDIA_EXTS.has(ext)) return null;
    const rawExt = ext.slice(1);
    const mime = rawExt === 'jpg' ? 'jpeg' : rawExt;
    const b64 = fsImpl.readFileSync(filePath).toString('base64');
    return `data:image/${mime};base64,${b64}`;
}

/**
 * Extract an ogai-storyboard JSON payload from harness text output.
 */
function parseStoryboardFromOutput(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const jsonCandidates = [];
    const tagged = raw.match(/```(?:ogai-storyboard|json)?\s*([\s\S]*?)```/i);
    if (tagged) jsonCandidates.push(tagged[1].trim());

    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        jsonCandidates.push(raw.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of jsonCandidates) {
        try {
            const obj = JSON.parse(candidate);
            if (!obj || !Array.isArray(obj.scenes) || obj.scenes.length === 0) continue;
            const scenes = obj.scenes.map((s) => ({
                durationSec: Number(s?.durationSec) > 0 ? Number(s.durationSec) : 3.3,
                caption: typeof s?.caption === 'string' ? s.caption : '',
                headline: typeof s?.headline === 'string' ? s.headline : '',
                subline: typeof s?.subline === 'string' ? s.subline : '',
                motion: typeof s?.motion === 'string' ? s.motion : 'zoom-in',
                imagePath: typeof s?.imagePath === 'string' ? s.imagePath : '',
                svg: typeof s?.svg === 'string' ? s.svg : '',
            }));
            return {
                durationSec: Number(obj.durationSec) > 0
                    ? Number(obj.durationSec)
                    : scenes.reduce((acc, s) => acc + s.durationSec, 0),
                audioScript: typeof obj.audioScript === 'string' ? obj.audioScript.trim() : '',
                accentColor: typeof obj.accentColor === 'string' && obj.accentColor.trim() ? obj.accentColor.trim() : '#22d3ee',
                scenes,
            };
        } catch {
            // try next candidate
        }
    }
    return null;
}

/**
 * Attach playable mediaUrl / mediaType or multi-scene storyboard images
 * onto a completed harness run result.
 */
function attachLocalMediaResult(result, fsImpl = fs) {
    if (!result) return result;

    const storyboard = parseStoryboardFromOutput(result.output);
    if (storyboard) {
        const fallbackPaths = findAllLocalMediaPaths(result.output, fsImpl)
            .filter((p) => IMAGE_MEDIA_EXTS.has(path.extname(p).toLowerCase()));
        let fallbackIdx = 0;

        storyboard.scenes = storyboard.scenes.map((scene) => {
            let resolvedPath = scene.imagePath;
            if (!resolvedPath || !fsImpl.existsSync(resolvedPath)) {
                if (/^file:\/\//i.test(resolvedPath || '')) {
                    try { resolvedPath = fileURLToPath(resolvedPath); } catch { resolvedPath = ''; }
                }
            }
            if (!resolvedPath || !fsImpl.existsSync(resolvedPath)) {
                resolvedPath = fallbackPaths[fallbackIdx++] || '';
            }
            if (resolvedPath) {
                try {
                    const dataUrl = imageFileToDataUrl(resolvedPath, fsImpl);
                    if (dataUrl) {
                        return { ...scene, imagePath: resolvedPath, imageDataUrl: dataUrl };
                    }
                } catch {
                    // ignore unreadable image
                }
            }
            return scene;
        });

        result.storyboard = storyboard;
    }

    if (result.mediaUrl) return result;
    const allPaths = findAllLocalMediaPaths(result.output, fsImpl);
    const directVideoOrAudio = allPaths.find((p) => {
        const ext = path.extname(p).toLowerCase();
        return VIDEO_MEDIA_EXTS.has(ext) || AUDIO_MEDIA_EXTS.has(ext);
    });
    const mediaPath = directVideoOrAudio || (storyboard ? null : allPaths[0]);
    if (!mediaPath) return result;

    const ext = path.extname(mediaPath).toLowerCase();
    try {
        if (IMAGE_MEDIA_EXTS.has(ext)) {
            result.mediaUrl = imageFileToDataUrl(mediaPath, fsImpl);
            result.mediaType = 'image';
            result.mediaPath = mediaPath;
        } else if (VIDEO_MEDIA_EXTS.has(ext)) {
            result.mediaUrl = pathToFileURL(mediaPath).href;
            result.mediaType = 'video';
            result.mediaPath = mediaPath;
        } else if (AUDIO_MEDIA_EXTS.has(ext)) {
            result.mediaUrl = pathToFileURL(mediaPath).href;
            result.mediaType = 'audio';
            result.mediaPath = mediaPath;
        }
    } catch {
        // ignore unreadable media file
    }
    return result;
}

/**
 * Synthesize spoken narration to an inline WAV data URL using OS built-in TTS
 * (Windows System.Speech or Linux espeak-ng/espeak) without requiring API keys.
 */
function synthesizeSpeechToDataUrl(options = {}) {
    const {
        text,
        platform = process.platform,
        tmpDir = os.tmpdir(),
        fsImpl = fs,
        execFileImpl = execFile,
    } = options;

    const cleaned = String(text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
    if (!cleaned) return Promise.resolve(null);

    const wavPath = path.join(tmpDir, `ogai-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);

    return new Promise((resolve) => {
        const finish = (err) => {
            try {
                if (!err && fsImpl.existsSync(wavPath)) {
                    const b64 = fsImpl.readFileSync(wavPath).toString('base64');
                    fsImpl.unlinkSync(wavPath);
                    resolve(`data:audio/wav;base64,${b64}`);
                    return;
                }
            } catch {
                // ignore read/cleanup failure
            }
            try { if (fsImpl.existsSync(wavPath)) fsImpl.unlinkSync(wavPath); } catch { /* ignore */ }
            resolve(null);
        };

        if (platform === 'win32') {
            const safePath = wavPath.replace(/'/g, "''");
            const safeText = cleaned.replace(/'/g, "''");
            const psScript = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = 0; $s.SetOutputToWaveFile('${safePath}'); $s.Speak('${safeText}'); $s.Dispose()`;
            execFileImpl('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], { timeout: 15000, windowsHide: true }, finish);
            return;
        }

        execFileImpl('espeak-ng', ['-w', wavPath, cleaned], { timeout: 15000 }, (err) => {
            if (!err) return finish(null);
            execFileImpl('espeak', ['-w', wavPath, cleaned], { timeout: 15000 }, finish);
        });
    });
}

function saveRenderedMedia({ bytes, ext = 'webm', name = 'harness-render', outputDir, fsImpl = fs } = {}) {
    if (!bytes || !bytes.length) throw new Error('Rendered media buffer is empty');
    if (!outputDir) throw new Error('outputDir is required');

    fsImpl.mkdirSync(outputDir, { recursive: true });
    const safeBase = String(name || 'harness-render').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'harness-render';
    const cleanExt = String(ext || 'webm').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'webm';
    const filePath = path.join(outputDir, `${safeBase}-${Date.now()}.${cleanExt}`);
    fsImpl.writeFileSync(filePath, Buffer.from(bytes));
    return {
        path: filePath,
        url: pathToFileURL(filePath).href,
    };
}

module.exports = {
    findAllLocalMediaPaths,
    findLocalMediaPath,
    imageFileToDataUrl,
    parseStoryboardFromOutput,
    attachLocalMediaResult,
    synthesizeSpeechToDataUrl,
    saveRenderedMedia,
};
