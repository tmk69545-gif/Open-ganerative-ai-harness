const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');

const IMAGE_MEDIA_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_MEDIA_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv']);
const AUDIO_MEDIA_EXTS = new Set(['.wav', '.mp3', '.ogg', '.m4a']);

/**
 * Scan harness output text for an existing local image, video, or audio file path,
 * including Windows paths containing spaces (e.g. C:\Users\Sanju Sales\...\out.jpg)
 * and file:/// URIs.
 */
function findLocalMediaPath(text, fsImpl = fs) {
    const raw = String(text || '');
    if (!raw) return null;

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

    const seen = new Set();
    for (const candidate of candidates) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        try {
            if (fsImpl.existsSync(candidate) && fsImpl.statSync(candidate).isFile()) {
                return candidate;
            }
        } catch {
            // ignore unreadable candidate
        }
    }
    return null;
}

/**
 * Attach playable mediaUrl / mediaType metadata onto a finished harness result
 * when the harness saved an image, video, or audio file on local disk.
 */
function attachLocalMediaResult(result, fsImpl = fs) {
    if (!result || result.mediaUrl) return result;
    const mediaPath = findLocalMediaPath(result.output, fsImpl);
    if (!mediaPath) return result;

    const ext = path.extname(mediaPath).toLowerCase();
    try {
        if (IMAGE_MEDIA_EXTS.has(ext)) {
            const rawExt = ext.slice(1);
            const mime = rawExt === 'jpg' ? 'jpeg' : rawExt;
            const b64 = fsImpl.readFileSync(mediaPath).toString('base64');
            result.mediaUrl = `data:image/${mime};base64,${b64}`;
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

module.exports = {
    findLocalMediaPath,
    attachLocalMediaResult,
};
