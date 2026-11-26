/**
 * Client-side HD cinematic VFX + audio compositor for AI Harness storyboards.
 * Renders smooth Ken Burns + handheld/tilt camera motion, cut transitions,
 * deterministic VFX particle/lighting systems, color grading, film grain,
 * anamorphic letterboxing, kinetic commercial typography, procedural chords,
 * transition SFX, and ducked voiceover into playable WebM video.
 */

export const VFX_PRESETS = Object.freeze([
    { id: 'auto', label: 'Auto (Scene-aware)' },
    { id: 'frost', label: 'Frost & Cold Mist' },
    { id: 'embers', label: 'Embers & Sparks' },
    { id: 'flare', label: 'Anamorphic Flare' },
    { id: 'rays', label: 'Volumetric God Rays' },
    { id: 'neon', label: 'Cyber Neon Glow' },
    { id: 'rain', label: 'Cinematic Rain' },
    { id: 'dust', label: 'Floating Film Dust' },
    { id: 'none', label: 'None (Clean)' },
]);

export const GRADE_PRESETS = Object.freeze([
    { id: 'auto', label: 'Auto' },
    { id: 'teal-amber', label: 'Teal & Amber' },
    { id: 'cold-steel', label: 'Cold Ice Steel' },
    { id: 'golden-hour', label: 'Golden Hour' },
    { id: 'cyber-neon', label: 'Cyber Neon' },
    { id: 'cinema-film', label: 'Warm 35mm Film' },
    { id: 'noir', label: 'High-Contrast Noir' },
    { id: 'natural', label: 'Natural' },
]);

export const MUSIC_MOODS = Object.freeze([
    { id: 'auto', label: 'Auto' },
    { id: 'cinematic', label: 'Cinematic Epic' },
    { id: 'upbeat', label: 'Upbeat Commercial' },
    { id: 'dramatic', label: 'Dramatic Tension' },
    { id: 'electronic', label: 'Modern Electronic' },
    { id: 'ambient', label: 'Warm Ambient' },
]);

const MOTION_CYCLE = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left', 'tilt-up', 'punch-zoom'];
const TRANSITION_CYCLE = ['dissolve', 'flash', 'whip-left', 'zoom-burst', 'wipe'];

export function getCanvasDimensions(aspectRatio = '16:9') {
    if (aspectRatio === '9:16') return { width: 720, height: 1280 };
    if (aspectRatio === '21:9') return { width: 1344, height: 576 };
    if (aspectRatio === '4:5') return { width: 864, height: 1080 };
    if (aspectRatio === '1:1') return { width: 960, height: 960 };
    if (aspectRatio === '4:3') return { width: 1024, height: 768 };
    if (aspectRatio === '3:4') return { width: 768, height: 1024 };
    return { width: 1280, height: 720 };
}

export function computeSceneTimeline(scenes = [], targetDurationSec = 10) {
    const safeScenes = Array.isArray(scenes) && scenes.length ? scenes : [{ durationSec: targetDurationSec }];
    const clampedTotal = Math.max(4, Math.min(35, Number(targetDurationSec) || 10));
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

function easeOutCubic(t) {
    const x = Math.max(0, Math.min(1, t));
    return 1 - Math.pow(1 - x, 3);
}

export function normalizeMotion(rawMotion = '', index = 0) {
    const m = String(rawMotion || '').toLowerCase();
    if (['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'handheld', 'punch-zoom'].includes(m)) {
        return m;
    }
    if (/punch|snap|impact/.test(m)) return 'punch-zoom';
    if (/handheld|shake|dynamic|chase|orbit/.test(m)) return 'handheld';
    if (/pull|zoom-out|out|wide/.test(m)) return 'zoom-out';
    if (/tilt-down|crane-down|descend/.test(m)) return 'tilt-down';
    if (/tilt|crane|rise|up/.test(m)) return 'tilt-up';
    if (/left/.test(m)) return 'pan-left';
    if (/right|sweep/.test(m)) return 'pan-right';
    if (/push|zoom|close|in/.test(m)) return 'zoom-in';
    return MOTION_CYCLE[index % MOTION_CYCLE.length];
}

export function normalizeTransition(rawTransition = '', index = 0) {
    const t = String(rawTransition || '').toLowerCase().trim();
    if (['dissolve', 'flash', 'whip-left', 'whip-right', 'zoom-burst', 'wipe'].includes(t)) return t;
    if (/whip.*left/.test(t)) return 'whip-left';
    if (/whip/.test(t)) return 'whip-right';
    if (/flash|bloom|strobe/.test(t)) return 'flash';
    if (/burst|punch|zoom/.test(t)) return 'zoom-burst';
    if (/wipe|sweep|slide/.test(t)) return 'wipe';
    if (/fade|dissolve|cross/.test(t)) return 'dissolve';
    return TRANSITION_CYCLE[index % TRANSITION_CYCLE.length];
}

export function resolveSceneVfx(sceneVfx = '', globalVfx = 'auto', hintText = '') {
    const raw = String(sceneVfx || '').toLowerCase().trim();
    const global = String(globalVfx || 'auto').toLowerCase().trim();
    const chosen = (raw && raw !== 'auto') ? raw : global;

    if (chosen === 'none' || chosen === 'off') return 'none';
    if (['frost', 'mist', 'embers', 'sparks', 'flare', 'rays', 'neon', 'rain', 'dust'].includes(chosen)) {
        if (chosen === 'mist') return 'frost';
        if (chosen === 'sparks') return 'embers';
        return chosen;
    }

    const combined = `${chosen} ${hintText}`.toLowerCase();
    if (/ice|frost|cool|chill|cold|arctic|mist|vapor|snow|freezer/.test(combined)) return 'frost';
    if (/fire|flame|ember|spark|forge|explode|welding|heat/.test(combined)) return 'embers';
    if (/rain|storm|thunder|wet|downpour/.test(combined)) return 'rain';
    if (/neon|cyber|synth|club|hologram|laser/.test(combined)) return 'neon';
    if (/sun|golden|morning|light|beam|forest|sunset/.test(combined)) return 'rays';
    if (/car|speed|sport|anamorphic|flare|cinema|studio/.test(combined)) return 'flare';
    return 'dust';
}

export function normalizeGrade(rawGrade = 'auto', hintText = '') {
    const g = String(rawGrade || 'auto').toLowerCase().trim();
    if (['teal-amber', 'cold-steel', 'golden-hour', 'cyber-neon', 'cinema-film', 'noir', 'natural'].includes(g)) {
        return g;
    }
    const lower = `${g} ${hintText}`.toLowerCase();
    if (/ice|frost|cool|cold|arctic|winter/.test(lower)) return 'cold-steel';
    if (/golden|sunset|warm|campfire|beach|amber/.test(lower)) return 'golden-hour';
    if (/neon|cyber|futur|magenta/.test(lower)) return 'cyber-neon';
    if (/noir|monochrome|black and white/.test(lower)) return 'noir';
    if (/film|vintage|retro|70s|16mm/.test(lower)) return 'cinema-film';
    return 'teal-amber';
}

export function normalizeMusicMood(rawMood = 'auto', hintText = '') {
    const m = String(rawMood || 'auto').toLowerCase().trim();
    if (['cinematic', 'upbeat', 'dramatic', 'electronic', 'ambient'].includes(m)) return m;
    const lower = `${m} ${hintText}`.toLowerCase();
    if (/upbeat|festive|commercial|happy|energetic|fun|pop/.test(lower)) return 'upbeat';
    if (/electronic|synth|cyber|tech|pulse|futur/.test(lower)) return 'electronic';
    if (/dramatic|intense|action|battle|epic|trailer/.test(lower)) return 'dramatic';
    if (/calm|peace|serene|ambient|nature|soft/.test(lower)) return 'ambient';
    return 'cinematic';
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function createVfxParticles(w, h, count = 64) {
    const rand = mulberry32(w * 31 + h * 17 + 1337);
    const items = [];
    for (let i = 0; i < count; i++) {
        items.push({
            x: rand(),
            y: rand(),
            vx: (rand() - 0.5) * 0.08,
            vy: 0.03 + rand() * 0.12,
            size: 0.5 + rand() * 1.5,
            phase: rand() * Math.PI * 2,
            alpha: 0.25 + rand() * 0.65,
        });
    }
    return items;
}

export function createFilmGrainTile(ctx) {
    const tile = document.createElement('canvas');
    tile.width = 128;
    tile.height = 128;
    const gctx = tile.getContext('2d');
    const imgData = gctx.createImageData(128, 128);
    const rand = mulberry32(90210);
    for (let i = 0; i < imgData.data.length; i += 4) {
        const v = Math.floor(rand() * 255);
        imgData.data[i] = v;
        imgData.data[i + 1] = v;
        imgData.data[i + 2] = v;
        imgData.data[i + 3] = 28;
    }
    gctx.putImageData(imgData, 0, 0);
    return ctx.createPattern(tile, 'repeat');
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

function computeCameraTransform(w, h, progress, motion, elapsedSec, cutLocalT, shakeIntensity = 0) {
    const eased = easeInOutSine(progress);
    let scale = 1.08;
    let panX = 0;
    let panY = 0;

    if (motion === 'zoom-in') {
        scale = 1.03 + eased * 0.13;
    } else if (motion === 'zoom-out') {
        scale = 1.16 - eased * 0.12;
    } else if (motion === 'punch-zoom') {
        scale = 1.24 - easeOutCubic(progress) * 0.16;
    } else if (motion === 'pan-left') {
        scale = 1.13;
        panX = (0.5 - eased) * w * 0.07;
    } else if (motion === 'pan-right') {
        scale = 1.13;
        panX = (eased - 0.5) * w * 0.07;
    } else if (motion === 'tilt-up') {
        scale = 1.13;
        panY = (0.5 - eased) * h * 0.06;
    } else if (motion === 'tilt-down') {
        scale = 1.13;
        panY = (eased - 0.5) * h * 0.06;
    } else if (motion === 'handheld') {
        scale = 1.1 + Math.sin(elapsedSec * 1.4) * 0.015;
        panX = Math.sin(elapsedSec * 2.1) * w * 0.014;
        panY = Math.cos(elapsedSec * 1.7) * h * 0.014;
    }

    if (shakeIntensity > 0 && cutLocalT < 0.45) {
        const decay = (1 - cutLocalT / 0.45) * shakeIntensity;
        panX += Math.sin(elapsedSec * 52) * w * 0.012 * decay;
        panY += Math.cos(elapsedSec * 61) * h * 0.012 * decay;
    }

    return { scale, panX, panY };
}

function drawFrameWithTransform(ctx, img, w, h, { scale = 1.06, panX = 0, panY = 0, offsetX = 0, alpha = 1 } = {}) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

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
        const dx = (w - drawW) / 2 + panX + offsetX;
        const dy = (h - drawH) / 2 + panY;
        ctx.drawImage(img, dx, dy, drawW, drawH);
    } else {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#07131a');
        grad.addColorStop(0.5, '#0f2c3a');
        grad.addColorStop(1, '#06090e');
        ctx.fillStyle = grad;
        ctx.fillRect(offsetX, 0, w, h);
    }
    ctx.restore();
}

function renderSceneTransition(ctx, {
    prevImg,
    nextImg,
    prevSeg,
    nextSeg,
    w,
    h,
    elapsedSec,
    cutProgress,
    transition,
    accentColor,
}) {
    const t = Math.max(0, Math.min(1, cutProgress));
    const prevTransform = computeCameraTransform(w, h, 1, normalizeMotion(prevSeg.scene.motion, prevSeg.index), elapsedSec, 1, 0);
    const nextProgress = Math.max(0, Math.min(1, (elapsedSec - nextSeg.start) / Math.max(0.1, nextSeg.duration)));
    const nextTransform = computeCameraTransform(w, h, nextProgress, normalizeMotion(nextSeg.scene.motion, nextSeg.index), elapsedSec, elapsedSec - nextSeg.start, nextSeg.scene.shake || 0.45);

    if (transition === 'whip-left' || transition === 'whip-right') {
        const dir = transition === 'whip-left' ? -1 : 1;
        const slide = easeInOutSine(t);
        drawFrameWithTransform(ctx, prevImg, w, h, { ...prevTransform, offsetX: dir * slide * w, alpha: 1 });
        drawFrameWithTransform(ctx, nextImg, w, h, { ...nextTransform, offsetX: -dir * (1 - slide) * w, alpha: 1 });
        const blurStreakAlpha = Math.sin(t * Math.PI) * 0.25;
        ctx.save();
        ctx.fillStyle = `rgba(255,255,255,${blurStreakAlpha})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
        return;
    }

    if (transition === 'zoom-burst') {
        drawFrameWithTransform(ctx, prevImg, w, h, { ...prevTransform, scale: prevTransform.scale + t * 0.28, alpha: 1 - t });
        drawFrameWithTransform(ctx, nextImg, w, h, { ...nextTransform, scale: nextTransform.scale + (1 - easeOutCubic(t)) * 0.24, alpha: t });
        const glowAlpha = Math.sin(t * Math.PI) * 0.35;
        ctx.save();
        ctx.fillStyle = `rgba(255,255,255,${glowAlpha})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
        return;
    }

    if (transition === 'wipe') {
        const wipeX = easeInOutSine(t) * w;
        drawFrameWithTransform(ctx, prevImg, w, h, { ...prevTransform, alpha: 1 });
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, wipeX, h);
        ctx.clip();
        drawFrameWithTransform(ctx, nextImg, w, h, { ...nextTransform, alpha: 1 });
        ctx.restore();

        const edgeGrad = ctx.createLinearGradient(wipeX - 40, 0, wipeX + 24, 0);
        edgeGrad.addColorStop(0, 'rgba(34,211,238,0)');
        edgeGrad.addColorStop(0.5, accentColor || '#22d3ee');
        edgeGrad.addColorStop(1, 'rgba(34,211,238,0)');
        ctx.save();
        ctx.globalAlpha = Math.sin(t * Math.PI) * 0.7;
        ctx.fillStyle = edgeGrad;
        ctx.fillRect(wipeX - 40, 0, 64, h);
        ctx.restore();
        return;
    }

    // Dissolve or Flash
    drawFrameWithTransform(ctx, nextImg, w, h, { ...nextTransform, alpha: 1 });
    drawFrameWithTransform(ctx, prevImg, w, h, { ...prevTransform, alpha: 1 - easeInOutSine(t) });
    if (transition === 'flash') {
        const flashAlpha = Math.sin(t * Math.PI) * 0.72;
        ctx.save();
        ctx.fillStyle = `rgba(255, 252, 244, ${flashAlpha})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
    }
}

function renderVfxLayer(ctx, vfxType, particles, w, h, elapsedSec, accentColor = '#22d3ee') {
    if (!vfxType || vfxType === 'none') return;

    ctx.save();

    if (vfxType === 'rays') {
        ctx.globalCompositeOperation = 'screen';
        const swing = Math.sin(elapsedSec * 0.45) * w * 0.08;
        for (let i = 0; i < 4; i++) {
            const xTop = w * (0.12 + i * 0.22) + swing;
            const beamGrad = ctx.createLinearGradient(xTop, 0, xTop + w * 0.16, h);
            beamGrad.addColorStop(0, 'rgba(255, 232, 185, 0.14)');
            beamGrad.addColorStop(0.6, 'rgba(255, 232, 185, 0.05)');
            beamGrad.addColorStop(1, 'rgba(255, 232, 185, 0)');
            ctx.fillStyle = beamGrad;
            ctx.beginPath();
            ctx.moveTo(xTop - 30, 0);
            ctx.lineTo(xTop + 55, 0);
            ctx.lineTo(xTop + w * 0.25, h);
            ctx.lineTo(xTop + w * 0.05, h);
            ctx.closePath();
            ctx.fill();
        }
    } else if (vfxType === 'flare') {
        ctx.globalCompositeOperation = 'screen';
        const flareX = w * (0.25 + 0.5 * (0.5 + 0.5 * Math.sin(elapsedSec * 0.55)));
        const flareY = h * 0.28;
        const streak = ctx.createLinearGradient(0, flareY, w, flareY);
        streak.addColorStop(0, 'rgba(34,211,238,0)');
        streak.addColorStop(0.45, 'rgba(34,211,238,0.28)');
        streak.addColorStop(0.5, 'rgba(255,255,255,0.48)');
        streak.addColorStop(0.55, 'rgba(34,211,238,0.28)');
        streak.addColorStop(1, 'rgba(34,211,238,0)');
        ctx.fillStyle = streak;
        ctx.fillRect(0, flareY - 2, w, 4);

        const glow = ctx.createRadialGradient(flareX, flareY, 2, flareX, flareY, w * 0.22);
        glow.addColorStop(0, 'rgba(255,250,235,0.42)');
        glow.addColorStop(0.35, 'rgba(34,211,238,0.16)');
        glow.addColorStop(1, 'rgba(34,211,238,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
    } else if (vfxType === 'frost') {
        const mistGrad = ctx.createLinearGradient(0, h * 0.58, 0, h);
        mistGrad.addColorStop(0, 'rgba(186, 230, 253, 0)');
        mistGrad.addColorStop(0.6, `rgba(186, 230, 253, ${0.12 + Math.sin(elapsedSec * 1.4) * 0.04})`);
        mistGrad.addColorStop(1, 'rgba(224, 242, 254, 0.24)');
        ctx.fillStyle = mistGrad;
        ctx.fillRect(0, h * 0.58, w, h * 0.42);
    } else if (vfxType === 'neon') {
        ctx.globalCompositeOperation = 'screen';
        const neonGrad = ctx.createLinearGradient(0, 0, w, h);
        neonGrad.addColorStop(0, 'rgba(236, 72, 153, 0.14)');
        neonGrad.addColorStop(1, 'rgba(34, 211, 238, 0.16)');
        ctx.fillStyle = neonGrad;
        ctx.fillRect(0, 0, w, h);
    }

    // Particle pass
    ctx.globalCompositeOperation = 'screen';
    for (const p of particles) {
        if (vfxType === 'rain') {
            const px = ((p.x * w + elapsedSec * w * 0.14) % w);
            const py = ((p.y * h + elapsedSec * h * 1.35) % h);
            ctx.strokeStyle = `rgba(210, 235, 255, ${p.alpha * 0.45})`;
            ctx.lineWidth = Math.max(1, p.size * 0.8);
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + 6, py + 24);
            ctx.stroke();
        } else if (vfxType === 'embers') {
            const px = ((p.x * w + Math.sin(elapsedSec * 1.8 + p.phase) * 28 + w) % w);
            const py = ((p.y * h - elapsedSec * h * p.vy * 1.6 + h * 10) % h);
            const r = p.size * 2.4;
            const g = ctx.createRadialGradient(px, py, 0, px, py, r * 2);
            g.addColorStop(0, `rgba(255, 220, 140, ${p.alpha})`);
            g.addColorStop(0.5, `rgba(255, 115, 25, ${p.alpha * 0.55})`);
            g.addColorStop(1, 'rgba(255, 80, 0, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(px, py, r * 2, 0, Math.PI * 2);
            ctx.fill();
        } else if (vfxType === 'frost') {
            const px = ((p.x * w + elapsedSec * p.vx * w + w) % w);
            const py = ((p.y * h + Math.sin(elapsedSec * 1.2 + p.phase) * 16 + elapsedSec * h * 0.05) % h);
            const r = p.size * 2.2;
            const g = ctx.createRadialGradient(px, py, 0, px, py, r * 2);
            g.addColorStop(0, `rgba(240, 253, 255, ${p.alpha * 0.85})`);
            g.addColorStop(0.5, `rgba(125, 211, 252, ${p.alpha * 0.3})`);
            g.addColorStop(1, 'rgba(125, 211, 252, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(px, py, r * 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // dust / flare bokeh / neon orbs
            const px = ((p.x * w + elapsedSec * p.vx * w * 0.4 + w) % w);
            const py = ((p.y * h - elapsedSec * p.vy * h * 0.25 + h * 10) % h);
            const twinkle = 0.65 + 0.35 * Math.sin(elapsedSec * 2.4 + p.phase);
            const r = vfxType === 'flare' || vfxType === 'neon' ? p.size * 3.5 : p.size * 1.6;
            ctx.fillStyle = vfxType === 'neon'
                ? (p.phase > Math.PI ? `rgba(236,72,153,${p.alpha * 0.28 * twinkle})` : `${accentColor}44`)
                : `rgba(255, 246, 224, ${p.alpha * 0.35 * twinkle})`;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.restore();
}

export function renderColorGradeAndFinish(ctx, { grade, grainPattern, grainSeed, letterbox, w, h }) {
    ctx.save();

    if (grade === 'teal-amber') {
        ctx.globalCompositeOperation = 'soft-light';
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, 'rgba(13, 148, 136, 0.28)');
        g.addColorStop(1, 'rgba(245, 158, 11, 0.26)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    } else if (grade === 'cold-steel') {
        ctx.globalCompositeOperation = 'soft-light';
        ctx.fillStyle = 'rgba(56, 189, 248, 0.24)';
        ctx.fillRect(0, 0, w, h);
    } else if (grade === 'golden-hour') {
        ctx.globalCompositeOperation = 'soft-light';
        const g = ctx.createRadialGradient(w * 0.75, h * 0.2, 20, w * 0.5, h * 0.5, w * 0.85);
        g.addColorStop(0, 'rgba(251, 191, 36, 0.36)');
        g.addColorStop(1, 'rgba(180, 83, 9, 0.14)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    } else if (grade === 'cyber-neon') {
        ctx.globalCompositeOperation = 'screen';
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, 'rgba(168, 85, 247, 0.16)');
        g.addColorStop(1, 'rgba(6, 182, 212, 0.16)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    } else if (grade === 'cinema-film') {
        ctx.globalCompositeOperation = 'soft-light';
        ctx.fillStyle = 'rgba(217, 160, 102, 0.22)';
        ctx.fillRect(0, 0, w, h);
    } else if (grade === 'noir') {
        ctx.globalCompositeOperation = 'color';
        ctx.fillStyle = 'rgba(128, 128, 128, 0.92)';
        ctx.fillRect(0, 0, w, h);
    }

    // Subtle cinema edge vignette
    ctx.globalCompositeOperation = 'multiply';
    const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.76);
    vig.addColorStop(0, 'rgba(255,255,255,1)');
    vig.addColorStop(1, 'rgba(155,165,175,0.68)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    // Lightweight film grain tile
    if (grainPattern) {
        ctx.globalCompositeOperation = 'overlay';
        ctx.translate((grainSeed * 37) % 128, (grainSeed * 53) % 128);
        ctx.fillStyle = grainPattern;
        ctx.fillRect(-128, -128, w + 256, h + 256);
    }

    ctx.restore();

    if (letterbox) {
        const barH = Math.round(h * 0.085);
        ctx.save();
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, barH);
        ctx.fillRect(0, h - barH, w, barH);
        ctx.restore();
    }
}

export function drawOverlayTypography(ctx, scene, w, h, localT, sceneDur, accentColor = '#22d3ee') {
    const headline = String(scene?.headline || scene?.caption || '').trim();
    const subline = String(scene?.subline || '').trim();
    if (!headline && !subline) return;

    const fadeIn = Math.min(1, localT / 0.45);
    const fadeOut = sceneDur - localT < 0.35 ? Math.max(0, (sceneDur - localT) / 0.35) : 1;
    const alpha = Math.min(fadeIn, fadeOut);
    const style = scene?.titleStyle || 'lower-third';
    const slideY = (1 - easeOutCubic(fadeIn)) * 22;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (style === 'hero-center') {
        const centerGlow = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.42);
        centerGlow.addColorStop(0, 'rgba(0,0,0,0.68)');
        centerGlow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = centerGlow;
        ctx.fillRect(0, 0, w, h);

        ctx.textAlign = 'center';
        const titleSize = Math.round(Math.min(w, h) * 0.072);
        const subSize = Math.round(Math.min(w, h) * 0.032);
        const yMid = Math.round(h * 0.5) + slideY;

        if (headline) {
            ctx.font = `900 ${titleSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(0,0,0,0.85)';
            ctx.shadowBlur = 18;
            ctx.fillText(headline.slice(0, 48), w / 2, yMid, w * 0.84);
        }

        const ruleW = Math.round(72 * easeOutCubic(fadeIn));
        ctx.fillStyle = accentColor;
        ctx.shadowBlur = 0;
        ctx.fillRect(w / 2 - ruleW / 2, yMid + 14, ruleW, 4);

        if (subline) {
            ctx.font = `600 ${subSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
            ctx.fillStyle = 'rgba(255,255,255,0.88)';
            ctx.fillText(subline.slice(0, 72), w / 2, yMid + 14 + subSize + 14, w * 0.82);
        }
        ctx.restore();
        return;
    }

    const padX = Math.round(w * 0.06);
    const baseY = Math.round(h * 0.84) + slideY;

    const bottomGrad = ctx.createLinearGradient(0, h * 0.55, 0, h);
    bottomGrad.addColorStop(0, 'rgba(0,0,0,0)');
    bottomGrad.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = bottomGrad;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);

    ctx.fillStyle = accentColor;
    ctx.fillRect(padX, baseY - Math.round(Math.min(w, h) * 0.065), Math.round(52 * easeOutCubic(fadeIn)), 4);

    if (headline) {
        ctx.font = `800 ${Math.round(Math.min(w, h) * 0.056)}px system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 12;
        ctx.fillText(headline.slice(0, 64), padX, baseY, w - padX * 2);
    }

    if (subline) {
        ctx.font = `500 ${Math.round(Math.min(w, h) * 0.032)}px system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.84)';
        ctx.fillText(subline.slice(0, 96), padX, baseY + Math.round(Math.min(w, h) * 0.045), w - padX * 2);
    }

    ctx.restore();
}

export function pickSupportedMimeType(withAudio = true) {
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

const MOOD_CHORDS = {
    cinematic: [[110, 164.81, 220], [98, 146.83, 196], [87.31, 130.81, 174.61], [110, 164.81, 261.63]],
    upbeat: [[130.81, 164.81, 196], [146.83, 196, 220], [164.81, 196, 246.94], [130.81, 196, 261.63]],
    dramatic: [[82.41, 123.47, 164.81], [77.78, 116.54, 155.56], [73.42, 110, 146.83], [82.41, 123.47, 164.81]],
    electronic: [[110, 220, 329.63], [130.81, 261.63, 392], [98, 196, 293.66], [110, 220, 329.63]],
    ambient: [[130.81, 196, 246.94], [146.83, 220, 261.63], [130.81, 196, 246.94], [110, 164.81, 220]],
};

function scheduleTransitionSfx(audioCtx, destGain, noiseBuffer, atTime, { impact = false, chime = false } = {}) {
    // Filtered air whoosh across scene cuts
    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.6;
    filter.frequency.setValueAtTime(280, Math.max(audioCtx.currentTime, atTime - 0.18));
    filter.frequency.exponentialRampToValueAtTime(2100, atTime + 0.04);
    filter.frequency.exponentialRampToValueAtTime(340, atTime + 0.38);

    const nGain = audioCtx.createGain();
    nGain.gain.setValueAtTime(0.0001, Math.max(audioCtx.currentTime, atTime - 0.18));
    nGain.gain.linearRampToValueAtTime(0.11, atTime + 0.02);
    nGain.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.42);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(destGain);
    noise.start(Math.max(audioCtx.currentTime, atTime - 0.18));
    noise.stop(atTime + 0.45);

    if (impact) {
        const sub = audioCtx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(84, atTime);
        sub.frequency.exponentialRampToValueAtTime(34, atTime + 0.35);
        const sGain = audioCtx.createGain();
        sGain.gain.setValueAtTime(0.18, atTime);
        sGain.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.38);
        sub.connect(sGain);
        sGain.connect(destGain);
        sub.start(atTime);
        sub.stop(atTime + 0.4);
    }

    if (chime) {
        const bell = audioCtx.createOscillator();
        bell.type = 'sine';
        bell.frequency.setValueAtTime(1046.5, atTime);
        const bGain = audioCtx.createGain();
        bGain.gain.setValueAtTime(0.045, atTime);
        bGain.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.55);
        bell.connect(bGain);
        bGain.connect(destGain);
        bell.start(atTime);
        bell.stop(atTime + 0.58);
    }
}

export async function setupAudioGraph({ voiceAudioUrl, baseDurationSec, storyboard, aspectRatio }) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return { finalDur: baseDurationSec, audioCtx: null, stream: null, cleanup: () => {} };

    const audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    let decodedVoice = null;
    if (voiceAudioUrl) {
        try {
            const resp = await fetch(voiceAudioUrl);
            const arrBuf = await resp.arrayBuffer();
            decodedVoice = await audioCtx.decodeAudioData(arrBuf);
        } catch {
            decodedVoice = null;
        }
    }

    const voiceDuration = decodedVoice?.duration || 0;
    const finalDur = Math.max(baseDurationSec, voiceDuration ? Math.min(35, voiceDuration + 0.9) : baseDurationSec);
    const timeline = computeSceneTimeline(storyboard?.scenes || [], finalDur);

    const dest = audioCtx.createMediaStreamDestination();
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.88;
    masterGain.connect(dest);

    const now = audioCtx.currentTime;
    const padGain = audioCtx.createGain();
    const padFilter = audioCtx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.setValueAtTime(480, now);
    padFilter.frequency.linearRampToValueAtTime(860, now + Math.min(2.5, finalDur * 0.4));
    padFilter.frequency.linearRampToValueAtTime(420, now + finalDur);

    // Smooth music ducking envelope when spoken narration plays
    const baseLevel = decodedVoice ? 0.055 : 0.11;
    padGain.gain.setValueAtTime(0.0001, now);
    padGain.gain.linearRampToValueAtTime(0.11, now + 0.35);
    if (decodedVoice) {
        padGain.gain.linearRampToValueAtTime(baseLevel, now + 0.55);
        padGain.gain.setValueAtTime(baseLevel, now + 0.25 + voiceDuration);
        padGain.gain.linearRampToValueAtTime(0.11, now + Math.min(finalDur - 0.3, 0.25 + voiceDuration + 0.45));
    }
    padGain.gain.linearRampToValueAtTime(0.0001, now + finalDur);
    padGain.connect(padFilter);
    padFilter.connect(masterGain);

    const mood = normalizeMusicMood(storyboard?.musicMood, `${storyboard?.audioScript || ''} ${storyboard?.soundEffects || ''}`);
    const progression = MOOD_CHORDS[mood] || MOOD_CHORDS.cinematic;
    const activeOscs = [];

    // Schedule evolving multi-chord segments synchronized cleanly to finalDur
    const segmentCount = Math.max(2, progression.length);
    const segLen = finalDur / segmentCount;
    for (let sIdx = 0; sIdx < segmentCount; sIdx++) {
        const chord = progression[sIdx % progression.length];
        const tStart = now + sIdx * segLen;
        const tEnd = now + (sIdx + 1) * segLen + 0.15;
        for (let fIdx = 0; fIdx < chord.length; fIdx++) {
            const osc = audioCtx.createOscillator();
            osc.type = fIdx === 0 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(chord[fIdx], tStart);
            const cGain = audioCtx.createGain();
            cGain.gain.setValueAtTime(0.0001, tStart);
            cGain.gain.linearRampToValueAtTime(fIdx === 0 ? 0.55 : 0.32, Math.min(tEnd, tStart + 0.25));
            cGain.gain.linearRampToValueAtTime(0.0001, tEnd);
            osc.connect(cGain);
            cGain.connect(padGain);
            osc.start(tStart);
            osc.stop(tEnd + 0.05);
            activeOscs.push(osc);
        }
    }

    // Shared white noise buffer for air-whoosh / frost-crackle SFX
    const noiseLen = Math.floor(audioCtx.sampleRate * 0.7);
    const noiseBuffer = audioCtx.createBuffer(1, noiseLen, audioCtx.sampleRate);
    const ch = noiseBuffer.getChannelData(0);
    const rand = mulberry32(4242);
    for (let i = 0; i < noiseLen; i++) ch[i] = rand() * 2 - 1;

    const hintAudio = `${storyboard?.soundEffects || ''} ${storyboard?.vfx || ''}`.toLowerCase();
    scheduleTransitionSfx(audioCtx, masterGain, noiseBuffer, now + 0.2, {
        impact: false,
        chime: /chime|ice|frost|crackle|sparkle/.test(hintAudio),
    });
    for (let i = 1; i < timeline.length; i++) {
        const trans = normalizeTransition(timeline[i].scene.transition, i);
        const sceneVfx = resolveSceneVfx(timeline[i].scene.vfx, storyboard?.vfx, timeline[i].scene.headline);
        scheduleTransitionSfx(audioCtx, masterGain, noiseBuffer, now + timeline[i].start, {
            impact: trans === 'flash' || trans === 'zoom-burst' || trans.startsWith('whip'),
            chime: sceneVfx === 'frost' || sceneVfx === 'flare' || /chime|ice|crackle/.test(hintAudio),
        });
    }

    if (decodedVoice) {
        const voiceSrc = audioCtx.createBufferSource();
        voiceSrc.buffer = decodedVoice;
        const voiceGain = audioCtx.createGain();
        voiceGain.gain.value = 0.98;
        voiceSrc.connect(voiceGain);
        voiceGain.connect(masterGain);
        voiceSrc.start(now + 0.25);
    }

    return {
        finalDur,
        timeline,
        audioCtx,
        stream: dest.stream,
        hasVoice: Boolean(decodedVoice),
        aspectRatio,
        cleanup: () => {
            for (const osc of activeOscs) {
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
    const baseDurationSec = Math.max(4, Math.min(35, baseDur));
    const loadedImages = await Promise.all((storyboard?.scenes || []).map(loadSceneImage));

    const audioGraph = await setupAudioGraph({
        voiceAudioUrl,
        baseDurationSec,
        storyboard,
        aspectRatio,
    });
    const finalDur = audioGraph.finalDur;
    const adjustedTimeline = audioGraph.timeline || computeSceneTimeline(storyboard?.scenes || [], finalDur);
    const hasAudio = Boolean(audioGraph?.stream?.getAudioTracks()?.length);
    const mimeType = pickSupportedMimeType(hasAudio);
    if (!mimeType) {
        audioGraph?.cleanup();
        throw new Error('No supported WebM MediaRecorder codec is available in this runtime.');
    }

    const { width, height } = getCanvasDimensions(aspectRatio);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const vfxParticles = createVfxParticles(width, height, 68);
    const grainPattern = createFilmGrainTile(ctx);
    const globalGrade = normalizeGrade(storyboard?.grade, `${storyboard?.audioScript || ''} ${storyboard?.vfx || ''}`);
    const useLetterbox = storyboard?.letterbox === true || aspectRatio === '21:9';

    const canvasStream = canvas.captureStream(30);
    const tracks = [...canvasStream.getVideoTracks(), ...(audioGraph?.stream?.getAudioTracks() || [])];
    const combinedStream = new MediaStream(tracks);

    const chunks = [];
    const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 4_200_000,
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
        const transitionSec = 0.5;
        let frameIdx = 0;

        const drawFrame = (elapsedSec) => {
            frameIdx++;
            ctx.fillStyle = '#05070a';
            ctx.fillRect(0, 0, width, height);

            let activeIdx = adjustedTimeline.findIndex((seg) => elapsedSec >= seg.start && elapsedSec < seg.end);
            if (activeIdx === -1) activeIdx = adjustedTimeline.length - 1;
            const seg = adjustedTimeline[activeIdx];
            const localT = Math.max(0, elapsedSec - seg.start);
            const progress = Math.max(0, Math.min(1, localT / Math.max(0.1, seg.duration)));
            const cutTransition = normalizeTransition(seg.scene.transition, activeIdx);

            if (activeIdx > 0 && localT < transitionSec) {
                renderSceneTransition(ctx, {
                    prevImg: loadedImages[adjustedTimeline[activeIdx - 1].index],
                    nextImg: loadedImages[seg.index],
                    prevSeg: adjustedTimeline[activeIdx - 1],
                    nextSeg: seg,
                    w: width,
                    h: height,
                    elapsedSec,
                    cutProgress: localT / transitionSec,
                    transition: cutTransition,
                    accentColor: storyboard?.accentColor || '#22d3ee',
                });
            } else {
                const transform = computeCameraTransform(
                    width,
                    height,
                    progress,
                    normalizeMotion(seg.scene.motion, seg.index),
                    elapsedSec,
                    localT,
                    seg.scene.shake || 0
                );
                drawFrameWithTransform(ctx, loadedImages[seg.index], width, height, { ...transform, alpha: 1 });
            }

            const sceneVfx = resolveSceneVfx(
                seg.scene.vfx,
                storyboard?.vfx || 'auto',
                `${seg.scene.headline || ''} ${seg.scene.subline || ''} ${storyboard?.soundEffects || ''} ${storyboard?.audioScript || ''}`
            );
            renderVfxLayer(ctx, sceneVfx, vfxParticles, width, height, elapsedSec, storyboard?.accentColor || '#22d3ee');

            renderColorGradeAndFinish(ctx, {
                grade: globalGrade,
                grainPattern,
                grainSeed: frameIdx,
                letterbox: useLetterbox,
                w: width,
                h: height,
            });

            drawOverlayTypography(
                ctx,
                seg.scene,
                width,
                height,
                localT,
                seg.duration,
                storyboard?.accentColor || '#22d3ee'
            );
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
        grade: globalGrade,
    };
}
