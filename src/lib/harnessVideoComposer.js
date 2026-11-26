/**
 * Client-side HD video + audio compositor for AI Harness storyboards.
 * Encodes smooth Ken Burns scene motion, cross-dissolves, kinetic captions,
 * synthesized voiceover + ambient synth bed directly into playable WebM video
 * using Chromium's native Canvas, WebAudio, and MediaRecorder APIs.
 */

export function getCanvasDimensions(aspectRatio = '16:9') {
    if (aspectRatio === '9:16') return { width: 720, height: 1280 };
    if (aspectRatio === '1:1') return { width: 960, height: 960 };
    if (aspectRatio === '4:3') return { width: 1024, height: 768 };
    if (aspectRatio === '3:4') return { width: 768, height: 1024 };
    return { width: 1280, height: 720 };
}

export function computeSceneTimeline(scenes = [], targetDurationSec = 10) {
    const safeScenes = Array.isArray(scenes) && scenes.length ? scenes : [{ durationSec: targetDurationSec }];
    const clampedTotal = Math.max(4, Math.min(30, Number(targetDurationSec) || 10));
    const rawSum = safeScenes.reduce((acc, s) => acc + (Number(s?.durationSec) > 0 ? Number(s.durationSec) : 3), 0);

    let cursor = 0;
    return safeScenes.map((s, idx) => {
        const w = (Number(s?.durationSec) > 0 ? Number(s.durationSec) : 3) / rawSum;
        const dur = idx === safeScenes.length - 1 ? clampedTotal - cursor : clampedTotal * w;
        const entry = {
            index: idx,
            scene: s,
            start: cursor,
            end: cursor + dur,
            duration: dur,
        };
        cursor += dur;
        return entry;
    });
}

function easeInOutSine(t) {
    const x = Math.max(0, Math.min(1, t));
    return -(Math.cos(Math.PI * x) - 1) / 2;
}

function loadSceneImage(scene) {
    let src = scene?.imageDataUrl || '';
    if (!src && scene?.svg && scene.svg.includes('<svg')) {
        src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(scene.svg)}`;
    }
    if (!src) return Promise.resolve(null);

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

const MOTION_CYCLE = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right'];

export function normalizeMotion(rawMotion = '', index = 0) {
    const m = String(rawMotion || '').toLowerCase();
    if (m === 'zoom-in' || m === 'zoom-out' || m === 'pan-left' || m === 'pan-right') return m;
    if (/pull|zoom-out|out|wide/.test(m)) return 'zoom-out';
    if (/left/.test(m)) return 'pan-left';
    if (/right|tilt/.test(m)) return 'pan-right';
    if (/push|zoom|close|in/.test(m)) return 'zoom-in';
    return MOTION_CYCLE[index % MOTION_CYCLE.length];
}

function drawCoverWithMotion(ctx, img, w, h, progress, motion = 'zoom-in', alpha = 1) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    const eased = easeInOutSine(progress);

    let scale = 1.08;
    let panX = 0;
    let panY = 0;
    if (motion === 'zoom-in') {
        scale = 1.03 + eased * 0.11;
    } else if (motion === 'zoom-out') {
        scale = 1.14 - eased * 0.11;
    } else if (motion === 'pan-left') {
        scale = 1.12;
        panX = (0.5 - eased) * w * 0.06;
    } else if (motion === 'pan-right') {
        scale = 1.12;
        panX = (eased - 0.5) * w * 0.06;
    }

    if (img && img.width > 0 && img.height > 0) {
        const imgAspect = img.width / img.height;
        const boxAspect = w / h;
        let drawW = w;
        let drawH = h;
        if (imgAspect > boxAspect) {
            drawH = h * scale;
            drawW = drawH * imgAspect;
        } else {
            drawW = w * scale;
            drawH = drawW / imgAspect;
        }
        const dx = (w - drawW) / 2 + panX;
        const dy = (h - drawH) / 2 + panY;
        ctx.drawImage(img, dx, dy, drawW, drawH);
    } else {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#09151c');
        grad.addColorStop(0.5, '#0f2936');
        grad.addColorStop(1, '#070b10');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
}

function drawOverlayTypography(ctx, scene, w, h, localT, accentColor = '#22d3ee') {
    const headline = String(scene?.headline || scene?.caption || '').trim();
    const subline = String(scene?.subline || '').trim();
    if (!headline && !subline) return;

    const fadeIn = Math.min(1, localT / 0.45);
    const slideY = (1 - easeInOutSine(fadeIn)) * 18;

    ctx.save();
    ctx.globalAlpha = fadeIn;

    const padX = Math.round(w * 0.06);
    const baseY = Math.round(h * 0.87) + slideY;

    const bottomGrad = ctx.createLinearGradient(0, h * 0.56, 0, h);
    bottomGrad.addColorStop(0, 'rgba(0,0,0,0)');
    bottomGrad.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = bottomGrad;
    ctx.fillRect(0, h * 0.56, w, h * 0.44);

    ctx.fillStyle = accentColor;
    ctx.fillRect(padX, baseY - 38, Math.round(48 * easeInOutSine(fadeIn)), 4);

    if (headline) {
        ctx.font = `800 ${Math.round(Math.min(w, h) * 0.056)}px system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 12;
        ctx.fillText(headline.slice(0, 64), padX, baseY, w - padX * 2);
    }

    if (subline) {
        ctx.font = `500 ${Math.round(Math.min(w, h) * 0.032)}px system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.fillText(subline.slice(0, 96), padX, baseY + Math.round(Math.min(w, h) * 0.045), w - padX * 2);
    }

    ctx.restore();
}

function pickSupportedMimeType(withAudio = true) {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = withAudio
        ? [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
        ]
        : [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
        ];
    return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

async function setupAudioGraph(voiceAudioUrl, totalDurationSec) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    const audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
    const dest = audioCtx.createMediaStreamDestination();
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.85;
    masterGain.connect(dest);

    // Subtle warm ambient pad chord (ducked gently when narration plays)
    const padGain = audioCtx.createGain();
    const padFilter = audioCtx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 520;
    padGain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    padGain.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 0.5);
    padGain.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + totalDurationSec);
    padGain.connect(padFilter);
    padFilter.connect(masterGain);

    const oscs = [110, 164.81, 220].map((freq) => {
        const osc = audioCtx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.connect(padGain);
        osc.start();
        osc.stop(audioCtx.currentTime + totalDurationSec + 0.2);
        return osc;
    });

    let voiceDuration = 0;
    if (voiceAudioUrl) {
        try {
            const resp = await fetch(voiceAudioUrl);
            const arrBuf = await resp.arrayBuffer();
            const audioBuf = await audioCtx.decodeAudioData(arrBuf);
            voiceDuration = audioBuf.duration;
            const voiceSrc = audioCtx.createBufferSource();
            voiceSrc.buffer = audioBuf;
            const voiceGain = audioCtx.createGain();
            voiceGain.gain.value = 0.95;
            voiceSrc.connect(voiceGain);
            voiceGain.connect(masterGain);
            voiceSrc.start(audioCtx.currentTime + 0.25);
        } catch {
            // proceed cleanly with ambient pad
        }
    }

    return {
        audioCtx,
        stream: dest.stream,
        voiceDuration,
        cleanup: () => {
            for (const osc of oscs) {
                try { osc.stop(); } catch { /* ignore */ }
            }
            try { void audioCtx.close(); } catch { /* ignore */ }
        },
    };
}

export async function renderStoryboardVideo({
    storyboard,
    aspectRatio = '16:9',
    voiceAudioUrl = null,
    onProgress,
} = {}) {
    if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
        throw new Error('In-app video rendering requires Chromium MediaRecorder support.');
    }

    const baseDur = Number(storyboard?.durationSec) > 0 ? Number(storyboard.durationSec) : 10;
    const totalDurationSec = Math.max(4, Math.min(30, baseDur));
    const loadedImages = await Promise.all((storyboard?.scenes || []).map(loadSceneImage));

    const audioGraph = await setupAudioGraph(voiceAudioUrl, totalDurationSec);
    const hasAudio = Boolean(audioGraph?.stream?.getAudioTracks()?.length);
    const mimeType = pickSupportedMimeType(hasAudio);
    if (!mimeType) {
        audioGraph?.cleanup();
        throw new Error('No supported WebM MediaRecorder codec is available in this runtime.');
    }

    const finalDur = Math.max(totalDurationSec, audioGraph?.voiceDuration ? Math.min(30, audioGraph.voiceDuration + 0.8) : totalDurationSec);
    const adjustedTimeline = computeSceneTimeline(storyboard?.scenes || [], finalDur);

    const { width, height } = getCanvasDimensions(aspectRatio);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const canvasStream = canvas.captureStream(30);
    const tracks = [...canvasStream.getVideoTracks(), ...(audioGraph?.stream?.getAudioTracks() || [])];
    const combinedStream = new MediaStream(tracks);

    const chunks = [];
    const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 3_500_000,
    });

    const recordedBlob = await new Promise((resolve, reject) => {
        recorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };
        recorder.onerror = (ev) => {
            audioGraph?.cleanup();
            reject(new Error(ev?.error?.message || 'MediaRecorder failed while encoding video.'));
        };
        recorder.onstop = () => {
            audioGraph?.cleanup();
            resolve(new Blob(chunks, { type: mimeType }));
        };

        const startMs = performance.now();
        const transitionSec = 0.45;

        const drawFrame = (elapsedSec) => {
            ctx.fillStyle = '#05070a';
            ctx.fillRect(0, 0, width, height);

            let activeIdx = adjustedTimeline.findIndex((seg) => elapsedSec >= seg.start && elapsedSec < seg.end);
            if (activeIdx === -1) activeIdx = adjustedTimeline.length - 1;
            const seg = adjustedTimeline[activeIdx];
            const progress = Math.max(0, Math.min(1, (elapsedSec - seg.start) / Math.max(0.1, seg.duration)));

            drawCoverWithMotion(ctx, loadedImages[seg.index], width, height, progress, normalizeMotion(seg.scene.motion, seg.index), 1);

            if (activeIdx > 0 && (elapsedSec - seg.start) < transitionSec) {
                const prevSeg = adjustedTimeline[activeIdx - 1];
                const outAlpha = 1 - ((elapsedSec - seg.start) / transitionSec);
                drawCoverWithMotion(ctx, loadedImages[prevSeg.index], width, height, 1, normalizeMotion(prevSeg.scene.motion, prevSeg.index), outAlpha);
            }

            drawOverlayTypography(ctx, seg.scene, width, height, elapsedSec - seg.start, storyboard?.accentColor || '#22d3ee');
        };

        drawFrame(0);
        recorder.start(250);

        const timer = setInterval(() => {
            const elapsedSec = (performance.now() - startMs) / 1000;
            if (elapsedSec >= finalDur) {
                clearInterval(timer);
                drawFrame(finalDur - 0.01);
                onProgress?.({ elapsed: finalDur, total: finalDur, pct: 100 });
                setTimeout(() => {
                    try { recorder.stop(); } catch { /* ignore */ }
                }, 120);
                return;
            }
            drawFrame(elapsedSec);
            onProgress?.({
                elapsed: elapsedSec,
                total: finalDur,
                pct: Math.min(99, Math.round((elapsedSec / finalDur) * 100)),
            });
        }, 33);
    });

    return {
        blob: recordedBlob,
        bytes: new Uint8Array(await recordedBlob.arrayBuffer()),
        durationSec: finalDur,
        mimeType,
    };
}
