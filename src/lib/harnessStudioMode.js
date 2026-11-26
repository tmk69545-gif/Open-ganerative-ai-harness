import { harnessClient, isHarnessAvailable } from './harnessClient.js';
import { isLocalAIAvailable } from './localInferenceClient.js';
import { renderStoryboardVideo } from './harnessVideoComposer.js';
import { t } from './i18n.js';

export function formatStudioError(err) {
    const raw = typeof err === 'string' ? err : (err?.message || String(err || 'Unknown error'));
    return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '').trim();
}

export function extractMediaFromHarnessOutput(text, kind = 'image') {
    const raw = String(text || '').trim();
    if (!raw) return { mediaUrl: null, mediaKind: null, text: '' };

    if (kind === 'image') {
        const svgMatch = raw.match(/<svg[\s\S]*?<\/svg>/i);
        if (svgMatch) {
            const svg = svgMatch[0];
            return {
                mediaUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
                mediaKind: 'image',
                isSvg: true,
                text: raw,
            };
        }
    }

    const mediaRegex = kind === 'video'
        ? /(https?:\/\/[^\s"'<>)]+\.(?:mp4|webm|mov|mkv)(?:\?[^\s"'<>)]*)?|file:\/\/\/[^\s"'<>)]+\.(?:mp4|webm|mov|mkv)|[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*?\.(?:mp4|webm|mov|mkv)(?=$|[\s"'`),\]*])|\/[^\s"'<>)]+\.(?:mp4|webm|mov|mkv))/i
        : /(https?:\/\/[^\s"'<>)]+\.(?:png|jpe?g|webp|gif|svg)(?:\?[^\s"'<>)]*)?|https?:\/\/(?:cdn|api)\.muapi\.ai\/[^\s"'<>)]+|file:\/\/\/[^\s"'<>)]+\.(?:png|jpe?g|webp|gif)|[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*?\.(?:png|jpe?g|webp|gif)(?=$|[\s"'`),\]*])|\/[^\s"'<>)]+\.(?:png|jpe?g|webp|gif))/i;

    const match = raw.match(mediaRegex);
    if (match) {
        let url = match[1];
        if (/^[A-Za-z]:\\/.test(url) || url.startsWith('/')) {
            const normalized = url.replace(/\\/g, '/');
            url = normalized.startsWith('/') ? `file://${encodeURI(normalized)}` : `file:///${encodeURI(normalized)}`;
        }
        return {
            mediaUrl: url,
            mediaKind: kind,
            isSvg: false,
            text: raw,
        };
    }

    return { mediaUrl: null, mediaKind: null, isSvg: false, text: raw };
}

/**
 * Read a browser File into a local data URL without remote upload or MuAPI credentials.
 */
export function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            reject(new Error('No file provided'));
            return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read uploaded image file'));
        reader.readAsDataURL(file);
    });
}

/**
 * Shared sound mute/unmute pill for VideoStudio and CinemaStudio players.
 */
export function createVideoAudioToggleButton(videoEl) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bg-white/10 hover:bg-white/20 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all border border-white/10 backdrop-blur-lg text-white flex items-center gap-1.5';

    const syncLabel = () => {
        const isMuted = Boolean(videoEl?.muted);
        btn.textContent = isMuted ? '🔇 Unmute Audio' : '🔊 Sound On';
    };

    btn.onclick = async () => {
        if (!videoEl) return;
        videoEl.muted = !videoEl.muted;
        if (!videoEl.muted) {
            try { await videoEl.play?.(); } catch { /* ignore */ }
        }
        syncLabel();
    };
    videoEl?.addEventListener?.('volumechange', syncLabel);
    syncLabel();
    return { button: btn, syncLabel };
}

/**
 * Build the prompt and execution mode for running Studio image/video requests
 * through a CLI harness without requiring paid MuAPI credentials.
 */
export function buildHarnessStudioPrompt({
    kind = 'image',
    prompt,
    aspectRatio,
    durationSec = 10,
    vfx = 'auto',
    grade = 'auto',
    musicMood = 'auto',
    letterbox = null,
    negativePrompt = '',
    hasReferenceImages = false,
    harness,
    hasAppMuapiKey = false,
} = {}) {
    const ar = aspectRatio || (kind === 'video' ? '16:9' : '1:1');
    const canUseMuapi = Boolean(hasAppMuapiKey || harness?.config?.muapiHasCredentials);
    const hasNonMuapiMcp = Boolean(harness?.config?.nonMuapiServers?.length);
    const isAntigravity = harness?.id === 'antigravity';
    const negRule = negativePrompt ? `\nAvoid: ${negativePrompt}` : '';

    if (kind === 'image') {
        if (isAntigravity) {
            const muapiRule = canUseMuapi
                ? 'Prefer your built-in generate_image / image-generator subagent first (or MuAPI/other MCP image tools if helpful).'
                : 'Do NOT call any muapi MCP tools because no MuAPI API key is configured.';
            return {
                wrappedPrompt: `Generate an image for this request (${ar}): ${prompt}${negRule}\nUse your built-in generate_image tool / image-generator subagent natively to generate the image file. ${muapiRule} Include the exact saved image file path in your reply.`,
                mode: 'auto',
                autoApprove: true,
            };
        }

        const muapiRule = canUseMuapi
            ? 'Use any image generation MCP/tool if available, or '
            : 'Do NOT call muapi MCP tools (no MuAPI API key is configured). Use any non-MuAPI image generation tool/script if available, or ';
        return {
            wrappedPrompt: `${muapiRule}output either a saved local image file path (.png/.jpg/.webp) or a clean standalone <svg> illustration matching (${ar}) for: ${prompt}${negRule}`,
            mode: (canUseMuapi || hasNonMuapiMcp) ? 'auto' : 'plan',
            autoApprove: Boolean(canUseMuapi || hasNonMuapiMcp),
        };
    }

    if (canUseMuapi) {
        return {
            wrappedPrompt: `If video generation MCP tools are available, generate the requested video (${ar}, ${durationSec}s): ${prompt}${negRule} and include the resulting media URL or saved file path in your reply. Otherwise write a single concise production-ready video generation prompt describing camera motion, lighting, and action with no markdown fences.`,
            mode: 'auto',
            autoApprove: true,
        };
    }

    const dur = Math.max(4, Math.min(35, Number(durationSec) || 10));
    const sceneCount = dur >= 14 ? 4 : 3;
    const lookHints = [
        vfx && vfx !== 'auto' ? `VFX=${vfx}` : null,
        grade && grade !== 'auto' ? `grade=${grade}` : null,
        musicMood && musicMood !== 'auto' ? `musicMood=${musicMood}` : null,
        typeof letterbox === 'boolean' ? `letterbox=${letterbox}` : null,
    ].filter(Boolean).join(', ');
    const styleLine = lookHints ? `\nPreferred cinematic direction: ${lookHints}.` : '';
    const refLine = hasReferenceImages ? '\nThe user also provided reference frame(s); keep brand/subject continuity matching them.' : '';
    const schemaExample = `{"durationSec":${dur},"audioScript":"Concise voiceover script","musicMood":"cinematic|upbeat|dramatic|electronic|ambient","grade":"teal-amber|cold-steel|golden-hour|cyber-neon|cinema-film|noir","vfx":"frost|embers|flare|rays|neon|rain|dust","letterbox":false,"soundEffects":"whoosh, subtle chime","accentColor":"#22d3ee","scenes":[{"durationSec":3,"headline":"Short Title","subline":"Short Subtitle","motion":"zoom-in|zoom-out|pan-left|pan-right|tilt-up|tilt-down|handheld|punch-zoom","transition":"dissolve|flash|whip-left|whip-right|zoom-burst|wipe","vfx":"auto","titleStyle":"lower-third|hero-center","imagePath":"<exact saved jpg path>"}]}`;

    if (isAntigravity) {
        return {
            wrappedPrompt: `Create a ${sceneCount}-scene ${dur}-second ${ar} cinematic video storyboard for: ${prompt}${styleLine}${refLine}${negRule}
Do NOT call any muapi MCP tools because no MuAPI API key is configured.
If a non-MuAPI video MCP tool produces an .mp4 or .webm directly, reply with its exact saved file path.
Otherwise invoke ${sceneCount} parallel image-generator subagents right now (one crisp ${ar} keyframe visual per scene — let image-generator save to its default artifact directory rather than the workspace root; make the closing scene a strong hero product/ending shot).
After all finish, reply ONLY with a JSON block tagged \`\`\`ogai-storyboard matching this schema (use each returned path as imagePath):
${schemaExample}`,
            mode: 'auto',
            autoApprove: true,
        };
    }

    return {
        wrappedPrompt: `Create a ${sceneCount}-scene ${dur}-second ${ar} animated video storyboard for: ${prompt}${styleLine}${refLine}${negRule}
Do NOT call any muapi MCP tools because no MuAPI API key is configured.
If you have a non-MuAPI video tool/MCP that creates an .mp4 or .webm file, reply with its exact saved file path; otherwise reply ONLY with a JSON block tagged \`\`\`ogai-storyboard matching this schema (replace "imagePath" with "svg": a crisp standalone 1280x720 <svg viewBox='0 0 1280 720' xmlns='http://www.w3.org/2000/svg'> illustration per scene):
${schemaExample}`,
        mode: hasNonMuapiMcp ? 'auto' : 'plan',
        autoApprove: hasNonMuapiMcp,
    };
}

/**
 * Shared API | Harness | Local switcher, harness/model state, error banner,
 * and streaming output card for ImageStudio and VideoStudio.
 */
export function createStudioHarnessController({
    kind = 'image',
    includeLocal = true,
    onModeChange,
    onHarnessModelChange,
    onUseAsPrompt,
    onRunViaApi,
}) {
    const hasHarness = isHarnessAvailable();
    const hasLocal = includeLocal && isLocalAIAvailable();

    let sourceMode = 'api'; // 'api' | 'harness' | 'local'
    let harnesses = [];
    let selectedHarnessId = '';
    let selectedHarnessModelId = '';
    let activeRunId = null;

    // ─── Source Switcher (API | Harness | Local) ──────────────────────────────
    const switcher = document.createElement('div');
    switcher.className = 'inline-flex items-center rounded-xl border border-white/10 bg-white/5 p-0.5 shrink-0';

    const modeButtons = {};
    const modes = [
        { id: 'api', label: 'API' },
        ...(hasHarness ? [{ id: 'harness', label: 'Harness' }] : []),
        ...(hasLocal ? [{ id: 'local', label: 'Local' }] : []),
    ];

    const updateSwitcherStyles = () => {
        for (const [id, btn] of Object.entries(modeButtons)) {
            const active = sourceMode === id;
            btn.className = active
                ? 'px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-black transition-colors whitespace-nowrap'
                : 'px-2.5 py-1.5 rounded-lg text-xs font-medium text-white/65 hover:text-white transition-colors whitespace-nowrap';
        }
        harnessWrap.classList.toggle('hidden', sourceMode !== 'harness');
        harnessWrap.classList.toggle('flex', sourceMode === 'harness');
    };

    if (modes.length > 1) {
        for (const m of modes) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = m.label;
            btn.onclick = async (e) => {
                e.stopPropagation();
                if (m.id === 'harness' && harnesses.length === 0) {
                    await refreshHarnesses();
                }
                sourceMode = m.id;
                updateSwitcherStyles();
                onModeChange?.(sourceMode);
            };
            modeButtons[m.id] = btn;
            switcher.appendChild(btn);
        }
    } else {
        switcher.classList.add('hidden');
    }

    // ─── Harness Selector Pill (shown in Harness mode) ────────────────────────
    const harnessWrap = document.createElement('div');
    harnessWrap.className = 'hidden items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-2.5 py-1.5 shrink-0';

    const harnessSelect = document.createElement('select');
    harnessSelect.className = 'bg-transparent text-xs font-semibold text-primary focus:outline-none cursor-pointer';
    harnessSelect.setAttribute('aria-label', 'Select installed harness');
    harnessWrap.appendChild(harnessSelect);

    const getSelectedHarness = () => harnesses.find((h) => h.id === selectedHarnessId) || null;
    const getModels = () => getSelectedHarness()?.models || [];
    const getSelectedModel = () => {
        const list = getModels();
        return list.find((m) => m.id === selectedHarnessModelId) || list.find((m) => m.isDefault) || list[0] || null;
    };

    const syncDefaultModelForHarness = () => {
        const list = getModels();
        const def = list.find((m) => m.isDefault) || list[0] || null;
        selectedHarnessModelId = def?.id || '';
        onHarnessModelChange?.({ harness: getSelectedHarness(), model: def });
    };

    harnessSelect.onchange = (e) => {
        e.stopPropagation();
        selectedHarnessId = harnessSelect.value;
        syncDefaultModelForHarness();
    };

    const refreshHarnesses = async () => {
        if (!hasHarness) return [];
        try {
            const report = await harnessClient.detect({ includeModels: true });
            harnesses = (report?.harnesses || []).filter((h) => h.canRun);
            harnessSelect.innerHTML = '';
            if (!harnesses.length) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'No CLI harness found';
                opt.className = 'bg-[#111] text-white';
                harnessSelect.appendChild(opt);
                selectedHarnessId = '';
                selectedHarnessModelId = '';
                return [];
            }
            for (const h of harnesses) {
                const opt = document.createElement('option');
                opt.value = h.id;
                const ver = h.surfaces?.cli?.version ? ` v${h.surfaces.cli.version}` : '';
                opt.textContent = `${h.name}${ver}`;
                opt.className = 'bg-[#111] text-white';
                harnessSelect.appendChild(opt);
            }
            if (!harnesses.some((h) => h.id === selectedHarnessId)) {
                selectedHarnessId = harnesses[0].id;
            }
            harnessSelect.value = selectedHarnessId;
            if (!getModels().some((m) => m.id === selectedHarnessModelId)) {
                syncDefaultModelForHarness();
            }
            return harnesses;
        } catch {
            return [];
        }
    };

    if (hasHarness) {
        void refreshHarnesses();
    }
    updateSwitcherStyles();

    // ─── Error Banner (keeps errors out of the Generate button!) ──────────────
    const errorBanner = document.createElement('div');
    errorBanner.className = 'w-full max-w-4xl mt-3 hidden items-start justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200 relative z-30';
    errorBanner.innerHTML = `
        <span class="studio-error-text leading-relaxed break-words flex-1"></span>
        <button type="button" class="studio-error-close text-red-300/70 hover:text-white shrink-0">✕</button>
    `;
    errorBanner.querySelector('.studio-error-close').onclick = () => {
        errorBanner.classList.add('hidden');
        errorBanner.classList.remove('flex');
    };

    const showError = (err) => {
        errorBanner.querySelector('.studio-error-text').textContent = formatStudioError(err);
        errorBanner.classList.remove('hidden');
        errorBanner.classList.add('flex');
    };
    const clearError = () => {
        errorBanner.classList.add('hidden');
        errorBanner.classList.remove('flex');
    };

    // ─── Harness Streaming & Output Card ──────────────────────────────────────
    const outputPanel = document.createElement('div');
    outputPanel.className = 'w-full max-w-4xl mt-4 hidden flex-col gap-3 rounded-xl border border-white/10 bg-panel-bg p-4 relative z-30';
    outputPanel.innerHTML = `
        <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
                <span class="harness-run-dot w-2 h-2 rounded-full bg-primary"></span>
                <span class="harness-run-title text-xs font-semibold text-white truncate">Harness</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button type="button" class="harness-run-cancel hidden px-2.5 py-1 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-medium hover:bg-red-500/25">Cancel</button>
                <button type="button" class="harness-run-close text-xs text-white/50 hover:text-white">✕</button>
            </div>
        </div>
        <pre class="harness-run-log text-xs font-mono text-white/85 bg-card-bg border border-white/10 rounded-lg p-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed"></pre>
        <div class="harness-run-actions hidden flex-wrap items-center gap-2">
            <button type="button" class="harness-copy-btn px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-medium text-white/80 hover:text-white hover:bg-white/10">${t('common.copy')}</button>
            <button type="button" class="harness-use-prompt-btn px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-medium text-white/80 hover:text-white hover:bg-white/10">Use as prompt</button>
            <button type="button" class="harness-api-gen-btn px-3 py-1.5 rounded-lg bg-primary text-black text-xs font-semibold hover:opacity-90">Generate ${kind} via API</button>
        </div>
    `;

    const titleEl = outputPanel.querySelector('.harness-run-title');
    const dotEl = outputPanel.querySelector('.harness-run-dot');
    const logEl = outputPanel.querySelector('.harness-run-log');
    const cancelBtn = outputPanel.querySelector('.harness-run-cancel');
    const closeBtn = outputPanel.querySelector('.harness-run-close');
    const actionsEl = outputPanel.querySelector('.harness-run-actions');
    const copyBtn = outputPanel.querySelector('.harness-copy-btn');
    const usePromptBtn = outputPanel.querySelector('.harness-use-prompt-btn');
    const apiGenBtn = outputPanel.querySelector('.harness-api-gen-btn');

    let lastFinalOutput = '';

    closeBtn.onclick = () => {
        outputPanel.classList.add('hidden');
        outputPanel.classList.remove('flex');
    };
    cancelBtn.onclick = async () => {
        if (activeRunId) await harnessClient.cancel(activeRunId);
    };
    copyBtn.onclick = async () => {
        if (!lastFinalOutput) return;
        await navigator.clipboard.writeText(lastFinalOutput);
        copyBtn.textContent = t('common.copied');
        setTimeout(() => { copyBtn.textContent = t('common.copy'); }, 1400);
    };
    usePromptBtn.onclick = () => {
        if (lastFinalOutput) onUseAsPrompt?.(lastFinalOutput);
    };
    apiGenBtn.onclick = () => {
        if (lastFinalOutput) {
            sourceMode = 'api';
            updateSwitcherStyles();
            onModeChange?.('api');
            onRunViaApi?.(lastFinalOutput);
        }
    };

    const runPrompt = async ({
        prompt,
        aspectRatio,
        durationSec = 10,
        vfx = 'auto',
        grade = 'auto',
        musicMood = 'auto',
        letterbox = null,
        negativePrompt = '',
        referenceImages = [],
        kind: kindOverride,
        onMediaReady,
    }) => {
        const effectiveKind = kindOverride || kind;
        clearError();
        if (!hasHarness) throw new Error('Harnesses are only available in the Electron desktop app or CLI.');
        const harness = getSelectedHarness();
        if (!harness) {
            await refreshHarnesses();
        }
        const activeHarness = getSelectedHarness();
        if (!activeHarness) {
            throw new Error('No installed CLI harness found. Check MCP & CLI to configure Antigravity, Codex, Claude, or OpenCode.');
        }

        const modelObj = getSelectedModel();
        const modelId = modelObj?.id || '';
        const modelLabel = modelObj?.name || modelId || 'Default';
        const validRefs = (referenceImages || []).filter(Boolean);

        lastFinalOutput = '';
        apiGenBtn.textContent = `Generate ${effectiveKind} via API`;
        outputPanel.classList.remove('hidden');
        outputPanel.classList.add('flex');
        actionsEl.classList.add('hidden');
        actionsEl.classList.remove('flex');
        cancelBtn.classList.remove('hidden');
        dotEl.className = 'harness-run-dot w-2 h-2 rounded-full bg-primary animate-pulse';
        titleEl.textContent = `${activeHarness.name} · ${modelLabel}`;
        logEl.textContent = `Running with ${activeHarness.name} (${modelLabel})...\n`;

        const unsub = harnessClient.onOutput((ev) => {
            if (!ev) return;
            if (ev.runId) activeRunId = ev.runId;
            if (ev.type === 'chunk') {
                if (logEl.textContent.startsWith('Running with ')) logEl.textContent = '';
                logEl.textContent += ev.text;
                logEl.scrollTop = logEl.scrollHeight;
            }
        });

        try {
            const hasAppMuapiKey = Boolean((localStorage.getItem('muapi_key') || '').trim());
            const { wrappedPrompt, mode, autoApprove } = buildHarnessStudioPrompt({
                kind: effectiveKind,
                prompt,
                aspectRatio,
                durationSec,
                vfx,
                grade,
                musicMood,
                letterbox,
                negativePrompt,
                hasReferenceImages: validRefs.length > 0,
                harness: activeHarness,
                hasAppMuapiKey,
            });

            const res = await harnessClient.run({
                harnessId: activeHarness.id,
                model: modelId || undefined,
                prompt: wrappedPrompt,
                mode,
                autoApprove,
            });

            lastFinalOutput = String(res?.output || '').trim();
            logEl.textContent = lastFinalOutput || 'Harness completed with no text output.';

            const extracted = extractMediaFromHarnessOutput(lastFinalOutput, effectiveKind);
            let mediaUrl = res?.mediaUrl || extracted.mediaUrl;
            let mediaType = res?.mediaType || extracted.mediaKind || effectiveKind;

            // If user uploaded reference frames for Video and harness returned no JSON scenes,
            // synthesize a multi-beat animated I2V/FLF storyboard straight from uploaded frames.
            let storyboard = res?.storyboard;
            if (effectiveKind === 'video' && !mediaUrl && (!storyboard || !storyboard.scenes?.length) && validRefs.length > 0) {
                const dur = Math.max(4, Math.min(35, Number(durationSec) || 10));
                const shortTitle = prompt.split(/[.,;\n]/)[0].trim().slice(0, 40) || 'AI Cinema Sequence';
                storyboard = {
                    durationSec: dur,
                    audioScript: lastFinalOutput.slice(0, 260),
                    vfx: vfx || 'auto',
                    grade: grade || 'auto',
                    musicMood: musicMood || 'cinematic',
                    letterbox: Boolean(letterbox),
                    scenes: [
                        { durationSec: dur * 0.35, headline: shortTitle, motion: 'zoom-in', transition: 'dissolve', titleStyle: 'lower-third', imageDataUrl: validRefs[0] },
                        { durationSec: dur * 0.35, motion: 'pan-right', transition: 'flash', imageDataUrl: validRefs[validRefs.length - 1] },
                        { durationSec: dur * 0.3, headline: shortTitle, motion: 'zoom-out', transition: 'zoom-burst', titleStyle: 'hero-center', imageDataUrl: validRefs[validRefs.length - 1] },
                    ],
                };
            }

            if (effectiveKind === 'video' && !mediaUrl && storyboard?.scenes?.length) {
                const mergedStoryboard = {
                    ...storyboard,
                    durationSec: Number(durationSec) > 0 ? Number(durationSec) : storyboard.durationSec,
                    vfx: vfx && vfx !== 'auto' ? vfx : (storyboard.vfx || 'auto'),
                    grade: grade && grade !== 'auto' ? grade : (storyboard.grade || 'auto'),
                    musicMood: musicMood && musicMood !== 'auto' ? musicMood : (storyboard.musicMood || 'cinematic'),
                    letterbox: typeof letterbox === 'boolean' ? letterbox : Boolean(storyboard.letterbox),
                    scenes: storyboard.scenes.map((scene, idx) => {
                        if (scene.imageDataUrl || (scene.svg && scene.svg.includes('<svg'))) return scene;
                        if (validRefs.length > 0) {
                            const refUrl = idx === storyboard.scenes.length - 1
                                ? validRefs[validRefs.length - 1]
                                : validRefs[idx % validRefs.length];
                            return { ...scene, imageDataUrl: refUrl };
                        }
                        return scene;
                    }),
                };

                logEl.textContent = 'Synthesizing voiceover narration, SFX & VFX timeline...\n';
                const voiceAudioUrl = mergedStoryboard.audioScript
                    ? await harnessClient.synthesizeSpeech({ text: mergedStoryboard.audioScript }).catch(() => null)
                    : null;
                const rendered = await renderStoryboardVideo({
                    storyboard: mergedStoryboard,
                    aspectRatio,
                    voiceAudioUrl,
                    onProgress: ({ pct }) => {
                        logEl.textContent = `Rendering HD WebM (VFX: ${mergedStoryboard.vfx} · Grade: ${mergedStoryboard.grade}${voiceAudioUrl ? ' · Voiceover + SFX' : ''})... ${pct}%`;
                    },
                });
                const saved = await harnessClient.saveMedia({
                    bytes: rendered.bytes,
                    ext: 'webm',
                    name: prompt,
                }).catch(() => null);
                mediaUrl = saved?.url || URL.createObjectURL(rendered.blob);
                mediaType = 'video';

                const sceneSummary = mergedStoryboard.scenes
                    .map((s, i) => `Scene ${i + 1} (${s.durationSec}s · ${s.motion || 'motion'} / ${s.transition || 'cut'}): ${s.headline || s.caption || 'Frame'}`)
                    .join('\n');
                lastFinalOutput = [
                    `Rendered ${Math.round(rendered.durationSec)}s WebM video (Grade: ${rendered.grade} · VFX: ${mergedStoryboard.vfx}${voiceAudioUrl ? ' · Voiceover + SFX + Music' : ' · SFX + Music'}).`,
                    saved?.path ? `Saved to: ${saved.path}` : '',
                    mergedStoryboard.audioScript ? `Voiceover: "${mergedStoryboard.audioScript}"` : '',
                    sceneSummary,
                ].filter(Boolean).join('\n');
                logEl.textContent = lastFinalOutput;
            }

            if (mediaUrl && onMediaReady) {
                outputPanel.classList.add('hidden');
                outputPanel.classList.remove('flex');
                onMediaReady({
                    url: mediaUrl,
                    mediaType,
                    model: `harness:${activeHarness.id}/${modelId || 'default'}`,
                    output: lastFinalOutput,
                });
            }

            const showApiFallback = Boolean(hasAppMuapiKey || activeHarness.config?.muapiHasCredentials);
            apiGenBtn.classList.toggle('hidden', !showApiFallback);
            dotEl.className = 'harness-run-dot w-2 h-2 rounded-full bg-emerald-400';
            actionsEl.classList.remove('hidden');
            actionsEl.classList.add('flex');
            return res;
        } catch (err) {
            dotEl.className = 'harness-run-dot w-2 h-2 rounded-full bg-red-400';
            throw err;
        } finally {
            unsub();
            activeRunId = null;
            cancelBtn.classList.add('hidden');
        }
    };

    const renderModelDropdown = ({ listEl, filter = '', onSelect }) => {
        listEl.innerHTML = '';
        const h = getSelectedHarness();
        const models = getModels().filter((m) => {
            const q = filter.toLowerCase();
            return (m.name || '').toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
        });

        if (!models.length) {
            listEl.innerHTML = `<div class="text-xs text-muted text-center py-4">No models available for ${h?.name || 'harness'}</div>`;
            return;
        }

        for (const m of models) {
            const isSelected = (selectedHarnessModelId || getSelectedModel()?.id) === m.id;
            const item = document.createElement('div');
            item.className = `flex items-center justify-between p-3 hover:bg-white/5 rounded-xl cursor-pointer transition-colors border ${isSelected ? 'bg-white/5 border-white/10' : 'border-transparent hover:border-white/5'}`;
            item.innerHTML = `
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-8 h-8 bg-primary/10 text-primary border border-white/10 rounded-lg flex items-center justify-center font-bold text-xs uppercase shrink-0">${(h?.name || 'H').charAt(0)}</div>
                    <div class="flex flex-col gap-0.5 min-w-0">
                        <span class="text-xs font-semibold text-white truncate">${m.name || m.id}</span>
                        <span class="text-[10px] font-mono text-muted truncate">${m.id}${m.source ? ` · ${m.source}` : ''}</span>
                    </div>
                </div>
                ${isSelected ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
            `;
            item.onclick = (e) => {
                e.stopPropagation();
                selectedHarnessModelId = m.id;
                onHarnessModelChange?.({ harness: h, model: m });
                onSelect?.(m);
            };
            listEl.appendChild(item);
        }
    };

    return {
        switcher,
        harnessWrap,
        errorBanner,
        outputPanel,
        getMode: () => sourceMode,
        setMode: (m) => {
            sourceMode = m;
            updateSwitcherStyles();
            onModeChange?.(sourceMode);
        },
        refreshHarnesses,
        getSelectedHarness,
        getModels,
        getSelectedModel,
        renderModelDropdown,
        runPrompt,
        showError,
        clearError,
    };
}
