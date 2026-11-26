import { muapi } from '../lib/muapi.js';
import { t2vModels, getAspectRatiosForVideoModel, getDurationsForModel, getResolutionsForVideoModel, i2vModels, getAspectRatiosForI2VModel, getDurationsForI2VModel, getResolutionsForI2VModel, v2vModels } from '../lib/models.js';
import { AuthModal } from './AuthModal.js';
import { t, tf } from '../lib/i18n.js';
import { createUploadPicker } from './UploadPicker.js';
import { savePendingJob, removePendingJob, getPendingJobs } from '../lib/pendingJobs.js';
import { localAI, isLocalAIAvailable } from '../lib/localInferenceClient.js';
import { isWan2gpModelId, getLocalModelById, localT2VModels, localI2VModels } from '../lib/localModels.js';
import { createHistoryMediaWithDownload } from '../lib/historyDom.mjs';
import { createProviderFallbackTile, getProviderLogo, getProviderLogoAlt, getProviderFallbackText, handleProviderLogoError, shouldInvertProviderLogo } from '../lib/providerLogos.js';
import { createHarnessPromptEnhancer } from '../lib/harnessEnhance.js';
import { createStudioHarnessController, readFileAsDataUrl, createVideoAudioToggleButton } from '../lib/harnessStudioMode.js';
import { VFX_PRESETS, GRADE_PRESETS, MUSIC_MOODS } from '../lib/harnessVideoComposer.js';

// Promotes a wan2gp catalog entry (lib/localModels.js shape) into the
// `inputs`-shaped descriptor the Video Studio dropdowns/controls expect.
const adaptLocalToVideoEntry = (m) => ({
    id: m.id,
    name: m.name,
    family: m.family,
    provider: 'wan2gp',
    inputs: {
        prompt: { type: 'string', name: 'prompt', title: 'Prompt' },
        aspect_ratio: { type: 'string', name: 'aspect_ratio', enum: m.aspectRatios || ['16:9', '1:1', '9:16'], default: (m.aspectRatios || ['16:9'])[0] },
    },
});

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const formatBytes = (bytes) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

// Progress label for a Wan2GP event ({ status, step, totalSteps, downloadedBytes, message }).
const localProgressLabel = ({ status, step, totalSteps, downloadedBytes, message }) => {
    if (status === 'downloading') return tf('video.localDownloading', formatBytes(downloadedBytes || 0));
    if (status === 'loading') return t('video.localLoading');
    if (status === 'encoding') return t('video.localEncoding');
    if (status === 'generating' && totalSteps) return tf('video.localStep', step, totalSteps);
    if (status === 'decoding') return t('video.localDecoding');
    if (status === 'saving' || status === 'done') return t('video.localSaving');
    return message || t('video.localStarting');
};

export function VideoStudio() {
    const container = document.createElement('div');
    container.className = 'w-full h-full flex flex-col items-center justify-center bg-app-bg relative p-4 md:p-6 overflow-y-auto custom-scrollbar overflow-x-hidden';

    // Cloud (Muapi) and local (Wan2GP) models live in separate lists; the
    // "⚡ Local" toggle — shown only in the desktop app — picks which one the
    // model dropdown and generation use.
    const localT2V = isLocalAIAvailable() ? localT2VModels.map(adaptLocalToVideoEntry) : [];
    const localI2V = isLocalAIAvailable() ? localI2VModels.map(adaptLocalToVideoEntry) : [];
    const allT2V = t2vModels;
    const allI2V = i2vModels;
    let useLocalModel = false;
    // id → { ready, unavailableReason, availabilityNote } from the Wan2GP engine
    let localAvailability = new Map();
    const t2vList = () => useLocalModel ? localT2V : allT2V;
    const i2vList = () => useLocalModel ? localI2V : allI2V;

    // --- State ---
    const defaultModel = allT2V[0];
    let selectedModel = defaultModel.id;
    let selectedModelName = defaultModel.name;
    let selectedAr = defaultModel.inputs?.aspect_ratio?.default || '16:9';
    let selectedDuration = defaultModel.inputs?.duration?.default || 5;
    let selectedResolution = defaultModel.inputs?.resolution?.default || '';
    let selectedQuality = defaultModel.inputs?.quality?.default || '';
    let selectedMode = '';
    let selectedEffectName = '';
    let lastGenerationId = null;
    let lastGenerationModel = null;
    let dropdownOpen = null;
    let uploadedImageUrl = null;
    let uploadedEndImageUrl = null; // optional end-frame for FLF i2v models
    let imageMode = false; // false = t2v models, true = i2v models
    let v2vMode = false;   // true = video-to-video tools mode
    let uploadedVideoUrl = null;
    let selectedVfx = 'auto';
    let selectedGrade = 'auto';
    let selectedMusicMood = 'auto';
    let selectedLetterbox = null;
    let selectedVideoEngine = 'threejs';
    let negativePrompt = '';

    const getCurrentModels = () => v2vMode ? v2vModels : (imageMode ? i2vList() : t2vList());
    // Local Wan2GP entries don't live in the Muapi-derived helpers, so we
    // resolve aspect ratios off the catalog when the selected id is local.
    const getCurrentAspectRatios = (id) => {
        if (harnessCtrl?.getMode?.() === 'harness') return ['16:9', '21:9', '9:16', '1:1', '4:5'];
        const local = getLocalModelById(id);
        if (local) return local.aspectRatios || ['16:9', '1:1', '9:16'];
        return imageMode ? getAspectRatiosForI2VModel(id) : getAspectRatiosForVideoModel(id);
    };
    const getCurrentDurations = (id) => {
        if (harnessCtrl?.getMode?.() === 'harness') return [5, 8, 10, 15, 20];
        if (getLocalModelById(id)) return [];
        return imageMode ? getDurationsForI2VModel(id) : getDurationsForModel(id);
    };
    const getCurrentResolutions = (id) => {
        if (getLocalModelById(id)) return [];
        return imageMode ? getResolutionsForI2VModel(id) : getResolutionsForVideoModel(id);
    };
    const getCurrentModes = (id) => getCurrentModels().find(m => m.id === id)?.inputs?.mode?.enum || [];
    const getCurrentModel = () => getCurrentModels().find(m => m.id === selectedModel);
    const isMotionControlV2V = () => v2vMode && !!getCurrentModel()?.imageField;
    const getQualitiesForModel = (id) => {
        const model = getCurrentModels().find(m => m.id === id);
        return model?.inputs?.quality?.enum || [];
    };
    const getEffectNamesForModel = (id) => {
        const model = getCurrentModels().find(m => m.id === id);
        return model?.inputs?.name?.enum || [];
    };

    // ==========================================
    // 1. HERO SECTION
    // ==========================================
    const hero = document.createElement('div');
    hero.className = 'flex flex-col items-center mb-10 md:mb-20 animate-fade-in-up transition-all duration-700';
    hero.innerHTML = `
        <div class="mb-10 relative group">
             <div class="absolute inset-0 bg-primary/20 blur-[100px] rounded-full opacity-40 group-hover:opacity-70 transition-opacity duration-1000"></div>
             <div class="relative w-24 h-24 md:w-32 md:h-32 bg-teal-900/40 rounded-3xl flex items-center justify-center border border-white/5 overflow-hidden">
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="text-primary opacity-20 absolute -right-4 -bottom-4">
                    <polygon points="23 7 16 12 23 17 23 7"/>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
                <div class="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20 shadow-glow relative z-10">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-primary">
                        <polygon points="23 7 16 12 23 17 23 7"/>
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                    </svg>
                </div>
                <div class="absolute top-4 right-4 text-primary animate-pulse">✨</div>
             </div>
        </div>
        <h1 class="text-2xl sm:text-4xl md:text-7xl font-black text-white tracking-widest uppercase mb-4 selection:bg-primary selection:text-black text-center px-4">${t('video.title')}</h1>
        <p class="text-secondary text-sm font-medium tracking-wide opacity-60">${t('video.subtitle')}</p>
    `;
    container.appendChild(hero);

    // ==========================================
    // 2. PROMPT BAR
    // ==========================================
    const promptWrapper = document.createElement('div');
    promptWrapper.className = 'w-full max-w-4xl relative z-40 animate-fade-in-up';
    promptWrapper.style.animationDelay = '0.2s';

    const bar = document.createElement('div');
    bar.className = 'w-full bg-[#111]/90 backdrop-blur-xl border border-white/10 rounded-[1.5rem] md:rounded-[2.5rem] p-3 md:p-5 flex flex-col gap-3 md:gap-5 shadow-3xl';

    const topRow = document.createElement('div');
    topRow.className = 'flex items-start gap-5 px-2';

    // --- Image Upload Picker (Image-to-Video) ---
    const picker = createUploadPicker({
        anchorContainer: container,
        onSelect: ({ url }) => {
            uploadedImageUrl = url;
            // Motion-control v2v: image is a second input alongside the video, not a mode switch
            if (isMotionControlV2V()) {
                textarea.disabled = false;
                textarea.placeholder = uploadedVideoUrl
                    ? (getCurrentModel()?.promptRequired ? 'Describe the motion' : 'Describe the motion (optional)')
                    : 'Now upload a reference video using the 🎥 button';
                return;
            }
            // Clear video mode if active
            if (v2vMode) {
                uploadedVideoUrl = null;
                v2vMode = false;
                showVideoIcon();
            }
            if (!imageMode) {
                imageMode = true;
                if (harnessCtrl.getMode() === 'harness') {
                    endPicker.trigger.classList.remove('hidden');
                    endPicker.trigger.classList.add('flex');
                } else {
                    const currentT2V = t2vList().find(m => m.id === selectedModel);
                    const sibling = currentT2V?.family
                        ? i2vList().find(m => m.family === currentT2V.family)
                        : null;
                    const target = sibling || i2vList()[0];
                    selectedModel = target.id;
                    selectedModelName = target.name;
                    document.getElementById('v-model-btn-label').textContent = selectedModelName;
                    updateControlsForModel(selectedModel);
                }
            }
            textarea.placeholder = 'Describe the motion or effect (optional)';
            textarea.disabled = false;
        },
        onClear: () => {
            uploadedImageUrl = null;
            // Motion-control v2v: keep the model selection; just lose the image
            if (isMotionControlV2V()) return;
            imageMode = false;
            // Clearing the start frame invalidates any selected end frame.
            uploadedEndImageUrl = null;
            endPicker?.reset();
            if (harnessCtrl.getMode() === 'harness') {
                endPicker.trigger.classList.add('hidden');
                endPicker.trigger.classList.remove('flex');
            } else {
                selectedModel = t2vList()[0].id;
                selectedModelName = t2vList()[0].name;
                document.getElementById('v-model-btn-label').textContent = selectedModelName;
                updateControlsForModel(selectedModel);
            }
            textarea.placeholder = t('video.placeholder');
            textarea.disabled = false;
        },
        // Local mode keeps the start frame on disk for Wan2GP; Harness reads locally
        // as data URL with no API key required; API mode uploads via MuAPI.
        uploadFn: (file) => useLocalModel
            ? localAI.uploadFileToWan2gp(file)
            : (harnessCtrl.getMode() === 'harness' ? readFileAsDataUrl(file) : muapi.uploadFile(file)),
        requireApiKey: () => !useLocalModel && harnessCtrl.getMode() !== 'harness',
    });
    topRow.appendChild(picker.trigger);
    container.appendChild(picker.panel);

    // --- End-Frame Upload Picker (FLF i2v models — kling/veo/seedance/etc.) ---
    // Shown only when imageMode is on AND the selected i2v model declares a
    // `lastImageField` in its catalog entry. Reuses the same UploadPicker UI;
    // a corner badge differentiates it from the start-frame picker.
    const endPicker = createUploadPicker({
        anchorContainer: container,
        onSelect: ({ url }) => { uploadedEndImageUrl = url; },
        onClear: () => { uploadedEndImageUrl = null; },
        uploadFn: (file) => useLocalModel
            ? localAI.uploadFileToWan2gp(file)
            : (harnessCtrl.getMode() === 'harness' ? readFileAsDataUrl(file) : muapi.uploadFile(file)),
        requireApiKey: () => !useLocalModel && harnessCtrl.getMode() !== 'harness',
    });
    endPicker.trigger.title = 'End frame (optional)';
    // Visual marker: small "L" badge in the corner so users can tell the two
    // pickers apart at a glance. The wrapper keeps it from interfering with
    // UploadPicker's own thumbnail/spinner state swapping.
    const endBadge = document.createElement('div');
    endBadge.className = 'absolute top-0.5 left-0.5 px-1 h-4 bg-white/20 rounded-md flex items-center justify-center pointer-events-none';
    endBadge.innerHTML = '<span class="text-[8px] font-black text-white leading-none">END</span>';
    endPicker.trigger.appendChild(endBadge);
    endPicker.trigger.classList.add('hidden'); // start hidden until updateEndFrameVisibility flips it on
    topRow.appendChild(endPicker.trigger);
    container.appendChild(endPicker.panel);

    const updateEndFrameVisibility = () => {
        const model = getCurrentModel();
        const supports = imageMode && !!model?.lastImageField;
        if (supports) {
            endPicker.trigger.classList.remove('hidden');
            endPicker.trigger.classList.add('flex');
        } else {
            endPicker.trigger.classList.add('hidden');
            endPicker.trigger.classList.remove('flex');
            // Drop any stale end-frame selection when leaving FLF-capable state
            if (uploadedEndImageUrl) {
                uploadedEndImageUrl = null;
                endPicker.reset();
            }
        }
    };

    // --- Video Upload Picker (Video-to-Video) ---
    const videoFileInput = document.createElement('input');
    videoFileInput.type = 'file';
    videoFileInput.accept = 'video/*';
    videoFileInput.className = 'hidden';

    const videoPickerBtn = document.createElement('button');
    videoPickerBtn.type = 'button';
    videoPickerBtn.title = 'Upload video to remove watermark';
    videoPickerBtn.className = 'w-10 h-10 shrink-0 rounded-xl border transition-all flex items-center justify-center relative overflow-hidden mt-1.5 bg-white/5 border-white/10 hover:bg-white/10 hover:border-primary/40 group';

    const videoIconEl = document.createElement('div');
    videoIconEl.className = 'flex items-center justify-center w-full h-full';
    videoIconEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-muted group-hover:text-primary transition-colors"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;

    const videoSpinnerEl = document.createElement('div');
    videoSpinnerEl.className = 'hidden items-center justify-center w-full h-full';
    videoSpinnerEl.innerHTML = `<span class="animate-spin text-primary text-sm">◌</span>`;

    const videoReadyEl = document.createElement('div');
    videoReadyEl.className = 'hidden items-center justify-center w-full h-full';
    videoReadyEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-primary"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/><polyline points="7 10 10 13 15 8" stroke="#22d3ee" stroke-width="2.5"/></svg>`;

    videoPickerBtn.appendChild(videoFileInput);
    videoPickerBtn.appendChild(videoIconEl);
    videoPickerBtn.appendChild(videoSpinnerEl);
    videoPickerBtn.appendChild(videoReadyEl);

    const showVideoIcon = () => {
        videoIconEl.classList.replace('hidden', 'flex');
        videoSpinnerEl.classList.add('hidden'); videoSpinnerEl.classList.remove('flex');
        videoReadyEl.classList.add('hidden'); videoReadyEl.classList.remove('flex');
        videoPickerBtn.classList.remove('border-primary/60');
        videoPickerBtn.classList.add('border-white/10');
        videoPickerBtn.title = 'Upload video to remove watermark';
    };

    const showVideoSpinner = () => {
        videoIconEl.classList.add('hidden'); videoIconEl.classList.remove('flex');
        videoSpinnerEl.classList.replace('hidden', 'flex');
        videoReadyEl.classList.add('hidden'); videoReadyEl.classList.remove('flex');
    };

    const showVideoReady = (filename) => {
        videoIconEl.classList.add('hidden'); videoIconEl.classList.remove('flex');
        videoSpinnerEl.classList.add('hidden'); videoSpinnerEl.classList.remove('flex');
        videoReadyEl.classList.replace('hidden', 'flex');
        videoPickerBtn.classList.remove('border-white/10');
        videoPickerBtn.classList.add('border-primary/60');
        videoPickerBtn.title = `${filename} — click to clear`;
    };

    const clearVideoUpload = () => {
        uploadedVideoUrl = null;
        showVideoIcon();
        // Motion-control v2v: keep the model and image; user can re-upload a video
        if (isMotionControlV2V()) {
            textarea.placeholder = 'Upload a reference video using the 🎥 button';
            return;
        }
        v2vMode = false;
        selectedModel = t2vList()[0].id;
        selectedModelName = t2vList()[0].name;
        document.getElementById('v-model-btn-label').textContent = selectedModelName;
        updateControlsForModel(selectedModel);
        textarea.placeholder = 'Describe the video you want to create';
        textarea.disabled = false;
    };

    videoPickerBtn.onclick = (e) => {
        e.stopPropagation();
        if (uploadedVideoUrl) {
            clearVideoUpload();
        } else {
            videoFileInput.click();
        }
    };

    videoFileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const apiKey = localStorage.getItem('muapi_key');
        if (!apiKey) {
            AuthModal(() => videoFileInput.click());
            return;
        }

        showVideoSpinner();
        try {
            const url = await muapi.uploadFile(file);
            uploadedVideoUrl = url;
            showVideoReady(file.name);

            // If a motion-control v2v model is already selected, keep it and the image upload
            if (isMotionControlV2V()) {
                textarea.disabled = false;
                textarea.placeholder = uploadedImageUrl
                    ? (getCurrentModel()?.promptRequired ? 'Describe the motion' : 'Describe the motion (optional)')
                    : 'Now upload a reference image using the 🖼 button';
            } else {
                // Default v2v flow (e.g. watermark remover) — auto-pick the first v2v model
                if (imageMode) {
                    picker.reset();
                    uploadedImageUrl = null;
                    imageMode = false;
                }
                v2vMode = true;
                selectedModel = v2vModels[0].id;
                selectedModelName = v2vModels[0].name;
                document.getElementById('v-model-btn-label').textContent = selectedModelName;
                updateControlsForModel(selectedModel);
                textarea.placeholder = 'Video ready — click Generate to remove watermark';
                textarea.disabled = true;
            }
        } catch (err) {
            console.error('[VideoStudio] Video upload failed:', err);
            showVideoIcon();
            alert(`Video upload failed: ${err.message}`);
        }
        videoFileInput.value = '';
    };

    topRow.appendChild(videoPickerBtn);

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Describe the video you want to create';
    textarea.className = 'flex-1 bg-transparent border-none text-white text-base md:text-xl placeholder:text-muted focus:outline-none resize-none pt-2.5 leading-relaxed min-h-[40px] max-h-[150px] md:max-h-[250px] overflow-y-auto custom-scrollbar';
    textarea.rows = 1;
    textarea.oninput = () => {
        textarea.style.height = 'auto';
        const maxHeight = window.innerWidth < 768 ? 150 : 250;
        textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
    };

    topRow.appendChild(textarea);
    bar.appendChild(topRow);

    // Extend mode banner (shown when extend model is active, not editable by user)
    const extendBanner = document.createElement('div');
    extendBanner.className = 'hidden items-center gap-2 px-4 py-2 mx-2 mt-2 bg-primary/10 border border-primary/20 rounded-xl text-xs text-primary';
    extendBanner.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        <span>Extending previous Seedance 2.0 generation — add an optional prompt to guide the continuation</span>
    `;
    bar.appendChild(extendBanner);

    // Bottom Row: Controls
    const bottomRow = document.createElement('div');
    bottomRow.className = 'flex flex-wrap items-center justify-between gap-3 px-2 pt-4 border-t border-white/5';

    const controlsLeft = document.createElement('div');
    controlsLeft.className = 'flex flex-wrap items-center gap-2 min-w-0 flex-1 relative';

    const createControlBtn = (icon, label, id, tooltip) => {
        const btn = document.createElement('button');
        btn.id = id;
        btn.className = 'flex items-center gap-1.5 md:gap-2.5 px-3 md:px-4 py-2 md:py-2.5 bg-white/5 hover:bg-white/10 rounded-xl md:rounded-2xl transition-all border border-white/5 group whitespace-nowrap';
        if (tooltip) btn.setAttribute('data-tooltip', tooltip);
        btn.innerHTML = `
            ${icon}
            <span id="${id}-label" class="text-xs font-bold text-white group-hover:text-primary transition-colors">${label}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" class="opacity-20 group-hover:opacity-100 transition-opacity"><path d="M6 9l6 6 6-6"/></svg>
        `;
        return btn;
    };

    const modelBtn = createControlBtn(`
        <div class="w-5 h-5 bg-primary rounded-md flex items-center justify-center shadow-lg shadow-primary/20">
            <span class="text-[10px] font-black text-black">V</span>
        </div>
    `, selectedModelName, 'v-model-btn', 'Select AI video model');

    const arBtn = createControlBtn(`
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="opacity-60 text-secondary"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
    `, selectedAr, 'v-ar-btn', 'Change aspect ratio');

    const durationBtn = createControlBtn(`
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="opacity-60 text-secondary"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    `, `${selectedDuration}s`, 'v-duration-btn', 'Set video duration');

    const resolutionBtn = createControlBtn(`
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="opacity-60 text-secondary"><path d="M6 2L3 6v15a2 2 0 002 2h14a2 2 0 002-2V6l-3-4H6z"/></svg>
    `, selectedResolution || '720p', 'v-resolution-btn', 'Set output resolution');

    const qualityBtn = createControlBtn(`
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="opacity-60 text-secondary"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
    `, selectedQuality || 'basic', 'v-quality-btn', 'Set output quality');

    const modeBtn = createControlBtn(`
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="opacity-60 text-secondary"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    `, selectedMode || 'normal', 'v-mode-btn');

    const effectNameBtn = createControlBtn(`
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="opacity-60 text-secondary"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"/></svg>
    `, 'Effect', 'v-effect-btn', 'Select effect type');

    // Local / API source toggle (only shown in Electron) — same pattern as Image Studio.
    const refreshLocalAvailability = async () => {
        try {
            const models = await localAI.listModels();
            localAvailability = new Map(models.filter(m => m.provider === 'wan2gp').map(m => [m.id, m]));
        } catch (err) {
            console.warn('[VideoStudio] Could not read Wan2GP status:', err);
        }
    };
    const harnessCtrl = createStudioHarnessController({
        kind: 'video',
        onModeChange: async (mode) => {
            useLocalModel = mode === 'local';
            harnessEnhancer.element.classList.toggle('hidden', mode === 'harness');
            harnessEnhancer.element.classList.toggle('flex', mode !== 'harness' && harnessEnhancer.element.querySelector('select')?.options.length > 0);
            if (v2vMode) {
                v2vMode = false;
                uploadedVideoUrl = null;
                showVideoIcon();
                textarea.disabled = false;
            }
            if (mode === 'harness') {
                const m = harnessCtrl.getSelectedModel();
                document.getElementById('v-model-btn-label').textContent = m?.name || m?.id || 'Harness Model';
                arBtn.style.display = 'flex';
                if (![5, 8, 10, 15, 20].includes(Number(selectedDuration))) selectedDuration = 10;
                document.getElementById('v-duration-btn-label').textContent = `${selectedDuration}s`;
                durationBtn.style.display = 'flex';
                resolutionBtn.style.display = 'none';
                qualityBtn.style.display = 'none';
                modeBtn.style.display = 'none';
                effectNameBtn.style.display = 'none';
                videoPickerBtn.classList.add('hidden');
                if (typeof syncVideoEngineVisibility === 'function') syncVideoEngineVisibility(true);
                if (imageMode) {
                    endPicker.trigger.classList.remove('hidden');
                    endPicker.trigger.classList.add('flex');
                }
            } else {
                if (typeof syncVideoEngineVisibility === 'function') syncVideoEngineVisibility(false);
                videoPickerBtn.classList.toggle('hidden', useLocalModel);
                if (useLocalModel) await refreshLocalAvailability();
                const list = getCurrentModels();
                const target = (useLocalModel && list.find(m => localAvailability.get(m.id)?.ready)) || list[0];
                selectedModel = target.id;
                selectedModelName = target.name;
                document.getElementById('v-model-btn-label').textContent = selectedModelName;
                updateControlsForModel(selectedModel);
                textarea.placeholder = t('video.placeholder');
            }
        },
        onHarnessModelChange: ({ model }) => {
            if (harnessCtrl.getMode() === 'harness') {
                document.getElementById('v-model-btn-label').textContent = model?.name || model?.id || 'Harness Model';
            }
        },
        onUseAsPrompt: (text) => {
            textarea.value = text;
            textarea.oninput();
        },
        onRunViaApi: (text) => {
            textarea.value = text;
            textarea.oninput();
            generateBtn.click();
        },
    });

    const videoEngineWrap = document.createElement('div');
    videoEngineWrap.className = 'hidden items-center bg-[#18181b] border border-white/10 rounded-xl p-0.5 gap-0.5 text-[11px] font-bold shrink-0';
    videoEngineWrap.title = 'Choose 3D WebGL 30fps Three.js engine or 2D AI storyboard slides';
    const threeEngineBtn = document.createElement('button');
    threeEngineBtn.type = 'button';
    threeEngineBtn.id = 'v-engine-threejs';
    threeEngineBtn.textContent = '3D Three.js';
    threeEngineBtn.setAttribute('data-tooltip', 'Real-time 30fps WebGL Three.js 3D video');
    const sbEngineBtn = document.createElement('button');
    sbEngineBtn.type = 'button';
    sbEngineBtn.id = 'v-engine-storyboard';
    sbEngineBtn.textContent = '2D Storyboard';
    sbEngineBtn.setAttribute('data-tooltip', 'Multi-scene 2D image storyboard with transitions & voiceover');
    const updateVideoEngineButtons = () => {
        threeEngineBtn.className = `px-2.5 py-1.5 rounded-lg transition-all whitespace-nowrap ${
            selectedVideoEngine === 'threejs' ? 'bg-primary text-black shadow-sm' : 'text-secondary hover:text-white'
        }`;
        sbEngineBtn.className = `px-2.5 py-1.5 rounded-lg transition-all whitespace-nowrap ${
            selectedVideoEngine === 'storyboard' ? 'bg-primary text-black shadow-sm' : 'text-secondary hover:text-white'
        }`;
    };
    const syncVideoEngineVisibility = (isHarness) => {
        videoEngineWrap.classList.toggle('hidden', !isHarness);
        videoEngineWrap.classList.toggle('flex', Boolean(isHarness));
    };
    threeEngineBtn.onclick = (e) => { e.stopPropagation(); selectedVideoEngine = 'threejs'; updateVideoEngineButtons(); };
    sbEngineBtn.onclick = (e) => { e.stopPropagation(); selectedVideoEngine = 'storyboard'; updateVideoEngineButtons(); };
    updateVideoEngineButtons();
    syncVideoEngineVisibility(harnessCtrl.getMode() === 'harness');
    videoEngineWrap.appendChild(threeEngineBtn);
    videoEngineWrap.appendChild(sbEngineBtn);

    controlsLeft.appendChild(harnessCtrl.switcher);
    controlsLeft.appendChild(harnessCtrl.harnessWrap);
    controlsLeft.appendChild(videoEngineWrap);

    controlsLeft.appendChild(modelBtn);
    controlsLeft.appendChild(arBtn);
    controlsLeft.appendChild(durationBtn);
    controlsLeft.appendChild(resolutionBtn);
    controlsLeft.appendChild(qualityBtn);
    controlsLeft.appendChild(effectNameBtn);

    // Advanced options toggle button
    const advancedBtn = createControlBtn(`
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="opacity-60 text-secondary"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 001.82-.33 1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-1.82.33A1.65 1.65 0 0019.4 9a1.65 1.65 0 00-1.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
    `, 'Advanced', 'v-advanced-btn', 'Show advanced options');
    controlsLeft.appendChild(advancedBtn);

    const harnessEnhancer = createHarnessPromptEnhancer({
        kind: 'video',
        getPrompt: () => textarea.value,
        setPrompt: (next) => {
            textarea.value = next;
            textarea.oninput();
        },
    });
    controlsLeft.appendChild(harnessEnhancer.element);

    // Initial visibility (t2v mode)
    const initDurations = getDurationsForModel(defaultModel.id);
    durationBtn.style.display = initDurations.length > 0 ? 'flex' : 'none';
    const initResolutions = getResolutionsForVideoModel(defaultModel.id);
    resolutionBtn.style.display = initResolutions.length > 0 ? 'flex' : 'none';
    qualityBtn.style.display = 'none';
    modeBtn.style.display = getCurrentModes(defaultModel.id).length > 0 ? 'flex' : 'none';
    effectNameBtn.style.display = 'none';

    const generateBtn = document.createElement('button');
    generateBtn.className = 'bg-primary text-black px-6 md:px-7 py-2.5 md:py-3 rounded-xl md:rounded-[1.5rem] font-black text-sm hover:shadow-glow hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-2 w-full sm:w-auto shrink-0 whitespace-nowrap shadow-lg';
    generateBtn.setAttribute('data-tooltip', 'Generate AI video from prompt');
    generateBtn.innerHTML = t('common.generate');

    bottomRow.appendChild(controlsLeft);
    bottomRow.appendChild(generateBtn);
    bar.appendChild(bottomRow);

    // ─── Advanced VFX, Color Grade & Audio Drawer ─────────────────────────────
    const advancedPanel = document.createElement('div');
    advancedPanel.id = 'v-advanced-panel';
    advancedPanel.className = 'hidden flex-col gap-3 pt-4 border-t border-white/5';
    advancedPanel.innerHTML = `
        <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold uppercase tracking-widest text-secondary">Cinematic &amp; VFX Studio Options</span>
            <button type="button" id="v-adv-close" class="text-xs text-white/45 hover:text-white">✕</button>
        </div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label class="flex flex-col gap-1">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-muted">VFX &amp; Atmosphere</span>
                <select id="v-adv-vfx" class="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50">
                    ${VFX_PRESETS.map((p) => `<option value="${p.id}" class="bg-[#111] text-white">${p.label}</option>`).join('')}
                </select>
            </label>
            <label class="flex flex-col gap-1">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-muted">Color Grade</span>
                <select id="v-adv-grade" class="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50">
                    ${GRADE_PRESETS.map((p) => `<option value="${p.id}" class="bg-[#111] text-white">${p.label}</option>`).join('')}
                </select>
            </label>
            <label class="flex flex-col gap-1">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-muted">Soundtrack Mood</span>
                <select id="v-adv-music" class="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50">
                    ${MUSIC_MOODS.map((p) => `<option value="${p.id}" class="bg-[#111] text-white">${p.label}</option>`).join('')}
                </select>
            </label>
            <label class="flex flex-col gap-1">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-muted">Anamorphic 2.39:1 Bars</span>
                <select id="v-adv-letterbox" class="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50">
                    <option value="auto" class="bg-[#111] text-white">Auto</option>
                    <option value="on" class="bg-[#111] text-white">On (Letterbox)</option>
                    <option value="off" class="bg-[#111] text-white">Off (Full Frame)</option>
                </select>
            </label>
        </div>
        <label class="flex flex-col gap-1">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-muted">Negative Prompt / Avoid</span>
            <input id="v-adv-negative" type="text" placeholder="e.g. garbled text, watermarks, blurry faces, morphing shapes" class="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-primary/50" />
        </label>
    `;
    bar.appendChild(advancedPanel);

    const toggleAdvanced = (forceOpen) => {
        const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : advancedPanel.classList.contains('hidden');
        advancedPanel.classList.toggle('hidden', !nextOpen);
        advancedPanel.classList.toggle('flex', nextOpen);
        advancedBtn.classList.toggle('border-primary/40', nextOpen);
        advancedBtn.classList.toggle('bg-primary/10', nextOpen);
    };
    advancedBtn.onclick = (e) => { e.stopPropagation(); toggleAdvanced(); };
    advancedPanel.querySelector('#v-adv-close').onclick = (e) => { e.stopPropagation(); toggleAdvanced(false); };
    advancedPanel.querySelector('#v-adv-vfx').onchange = (e) => { selectedVfx = e.target.value; };
    advancedPanel.querySelector('#v-adv-grade').onchange = (e) => { selectedGrade = e.target.value; };
    advancedPanel.querySelector('#v-adv-music').onchange = (e) => { selectedMusicMood = e.target.value; };
    advancedPanel.querySelector('#v-adv-letterbox').onchange = (e) => {
        selectedLetterbox = e.target.value === 'on' ? true : (e.target.value === 'off' ? false : null);
    };
    advancedPanel.querySelector('#v-adv-negative').oninput = (e) => { negativePrompt = e.target.value.trim(); };

    promptWrapper.appendChild(bar);
    container.appendChild(promptWrapper);
    container.appendChild(harnessCtrl.errorBanner);
    container.appendChild(harnessCtrl.outputPanel);

    // Local generation progress + error panel (hidden until a local run starts)
    const localPanel = document.createElement('div');
    localPanel.id = 'v-local-panel';
    localPanel.className = 'w-full max-w-4xl mt-4 hidden flex-col gap-2 relative z-30';
    localPanel.innerHTML = `
        <div class="v-local-progress flex flex-col gap-2">
            <div class="flex items-center justify-between gap-3">
                <span class="v-local-label text-xs font-bold text-white/60 truncate">${t('video.localStarting')}</span>
                <span class="v-local-pct text-xs font-bold text-primary shrink-0">0%</span>
            </div>
            <div class="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div class="v-local-fill h-full bg-primary transition-all duration-300" style="width:0%"></div>
            </div>
            <div class="flex justify-end">
                <button class="v-local-cancel text-xs text-red-400 hover:text-red-300 transition-colors">${t('common.cancel')}</button>
            </div>
        </div>
        <div class="v-local-error hidden flex-col gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <div class="flex items-center justify-between gap-3">
                <span class="v-local-error-title text-xs font-bold text-red-300"></span>
                <button class="v-local-error-close text-xs text-white/50 hover:text-white">✕</button>
            </div>
            <pre class="v-local-error-log text-[10px] leading-relaxed text-white/60 whitespace-pre-wrap break-words max-h-48 overflow-y-auto custom-scrollbar"></pre>
        </div>
    `;
    container.appendChild(localPanel);
    const localProgressEl = localPanel.querySelector('.v-local-progress');
    const localErrorEl = localPanel.querySelector('.v-local-error');
    const showLocalPanel = (part) => {
        localPanel.classList.remove('hidden');
        localPanel.classList.add('flex');
        localProgressEl.classList.toggle('hidden', part !== 'progress');
        localErrorEl.classList.toggle('hidden', part !== 'error');
        localErrorEl.classList.toggle('flex', part === 'error');
    };
    const hideLocalPanel = () => {
        localPanel.classList.add('hidden');
        localPanel.classList.remove('flex');
    };
    const setLocalProgress = (event) => {
        const pct = Math.round((event.progress ?? 0) * 100);
        localPanel.querySelector('.v-local-label').textContent = localProgressLabel(event);
        localPanel.querySelector('.v-local-pct').textContent = `${pct}%`;
        localPanel.querySelector('.v-local-fill').style.width = `${pct}%`;
    };
    // First line is the reason; the rest (if any) is the Wan2GP log tail.
    const showLocalError = (message) => {
        const [title, ...rest] = String(message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').split('\n');
        localPanel.querySelector('.v-local-error-title').textContent = title;
        localPanel.querySelector('.v-local-error-log').textContent = rest.join('\n').trim();
        showLocalPanel('error');
    };
    localPanel.querySelector('.v-local-cancel').onclick = () => localAI.cancelGeneration();
    localPanel.querySelector('.v-local-error-close').onclick = hideLocalPanel;

    // ==========================================
    // 3. DROPDOWNS
    // ==========================================
    const dropdown = document.createElement('div');
    dropdown.className = 'absolute bottom-[102%] left-2 z-50 transition-all opacity-0 pointer-events-none scale-95 origin-bottom-left glass rounded-3xl p-3 translate-y-2 w-[calc(100vw-3rem)] max-w-xs shadow-4xl border border-white/10 flex flex-col';

    const updateControlsForModel = (modelId) => {
        const model = getCurrentModels().find(m => m.id === modelId);

        // End-frame picker visibility depends on imageMode + model.lastImageField.
        updateEndFrameVisibility();

        // In v2v mode, hide all parameter controls — no prompt/AR/duration/etc needed
        if (v2vMode) {
            arBtn.style.display = 'none';
            durationBtn.style.display = 'none';
            resolutionBtn.style.display = 'none';
            qualityBtn.style.display = 'none';
            modeBtn.style.display = 'none';
            effectNameBtn.style.display = 'none';
            extendBanner.classList.add('hidden');
            extendBanner.classList.remove('flex');
            return;
        }

        // Aspect ratio
        const availableArs = getCurrentAspectRatios(modelId);
        if (availableArs.length > 0) {
            selectedAr = availableArs[0];
            document.getElementById('v-ar-btn-label').textContent = selectedAr;
            arBtn.style.display = 'flex';
        } else {
            arBtn.style.display = 'none';
        }

        // Duration
        const durations = getCurrentDurations(modelId);
        if (durations.length > 0) {
            selectedDuration = durations[0];
            document.getElementById('v-duration-btn-label').textContent = `${selectedDuration}s`;
            durationBtn.style.display = 'flex';
        } else {
            durationBtn.style.display = 'none';
        }

        // Resolution
        const resolutions = getCurrentResolutions(modelId);
        if (resolutions.length > 0) {
            selectedResolution = resolutions[0];
            document.getElementById('v-resolution-btn-label').textContent = selectedResolution;
            resolutionBtn.style.display = 'flex';
        } else {
            resolutionBtn.style.display = 'none';
        }

        // Quality
        const qualities = getQualitiesForModel(modelId);
        if (qualities.length > 0) {
            selectedQuality = model?.inputs?.quality?.default || qualities[0];
            document.getElementById('v-quality-btn-label').textContent = selectedQuality;
            qualityBtn.style.display = 'flex';
        } else {
            selectedQuality = '';
            qualityBtn.style.display = 'none';
        }

        // Mode
        const modes = getCurrentModes(modelId);
        if (modes.length > 0) {
            selectedMode = model?.inputs?.mode?.default || modes[0];
            document.getElementById('v-mode-btn-label').textContent = selectedMode;
            modeBtn.style.display = 'flex';
        } else {
            selectedMode = '';
            modeBtn.style.display = 'none';
        }

        // Effect name (ai-video-effects / motion-controls)
        const effectNames = getEffectNamesForModel(modelId);
        if (effectNames.length > 0) {
            selectedEffectName = model?.inputs?.name?.default || effectNames[0];
            document.getElementById('v-effect-btn-label').textContent = selectedEffectName;
            effectNameBtn.style.display = 'flex';
        } else {
            selectedEffectName = '';
            effectNameBtn.style.display = 'none';
        }

        // Extend banner (extend model only)
        if (model?.requiresRequestId) {
            extendBanner.classList.remove('hidden');
            extendBanner.classList.add('flex');
        } else {
            extendBanner.classList.add('hidden');
            extendBanner.classList.remove('flex');
        }
    };
    const failedProviderLogos = new Set();
    const showDropdown = (type, anchorBtn) => {
        dropdown.innerHTML = '';
        dropdown.classList.remove('opacity-0', 'pointer-events-none');
        dropdown.classList.add('opacity-100', 'pointer-events-auto');

        if (type === 'model') {
            dropdown.classList.add('w-[calc(100vw-3rem)]', 'max-w-xs');
            dropdown.classList.remove('max-w-[240px]', 'max-w-[200px]');
            dropdown.innerHTML = `
                <div class="flex flex-col h-full max-h-[70vh]">
                    <div class="px-2 pb-3 mb-2 border-b border-white/5 shrink-0">
                        <div class="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-2.5 border border-white/5 focus-within:border-primary/50 transition-colors">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="text-muted"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                            <input type="text" id="v-model-search" placeholder="${t('common.searchModels')}" class="bg-transparent border-none text-xs text-white focus:ring-0 w-full p-0">
                        </div>
                    </div>
                    <div class="text-[10px] font-bold text-secondary uppercase tracking-widest px-3 py-2 shrink-0">${harnessCtrl.getMode() === 'harness' ? `${harnessCtrl.getSelectedHarness()?.name || 'Harness'} models` : (useLocalModel ? t('video.localModels') : 'Video models')}</div>
                    <div id="v-model-list-container" class="flex flex-col gap-1.5 overflow-y-auto custom-scrollbar pr-1 pb-2"></div>
                </div>
            `;
            const list = dropdown.querySelector('#v-model-list-container');

            const makeModelItem = (m, isV2V = false) => {
                const item = document.createElement('div');
                // Local Wan2GP models carry the engine's verdict; unavailable ones stay visible with the reason.
                const local = m.provider === 'wan2gp' ? localAvailability.get(m.id) : null;
                const unavailable = local && !local.ready;
                item.className = `flex items-center justify-between p-3.5 rounded-2xl transition-all border border-transparent ${unavailable ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/5 cursor-pointer hover:border-white/5'} ${selectedModel === m.id ? 'bg-white/5 border-white/5' : ''}`;
                const iconColor = isV2V ? 'bg-orange-500/10 text-orange-400' : m.id.includes('kling') ? 'bg-blue-500/10 text-blue-400' : m.id.includes('veo') ? 'bg-purple-500/10 text-purple-400' : m.id.includes('sora') ? 'bg-rose-500/10 text-rose-400' : 'bg-primary/10 text-primary';
                const localNote = unavailable
                    ? `<span class="v-local-reason text-[9px] text-yellow-400/80 leading-snug">${escapeHtml(local.unavailableReason)}</span>`
                    : local?.availabilityNote ? `<span class="text-[9px] text-muted leading-snug">${escapeHtml(local.availabilityNote)}</span>` : '';
                const fallbackText = getProviderFallbackText(m);
                const fallbackClasses = `w-10 h-10 ${iconColor} border border-white/5 rounded-xl flex items-center justify-center font-black text-sm shadow-inner uppercase`;
                const fallbackMarkup = `<div data-provider-fallback class="${fallbackClasses}">${fallbackText}</div>`;
                const configuredProviderLogo = getProviderLogo(m.provider);
                const providerLogo = configuredProviderLogo && !failedProviderLogos.has(configuredProviderLogo)
                    ? configuredProviderLogo
                    : null;
                const logoMarkup = providerLogo
                    ? `<div class="w-10 h-10 rounded-xl border border-white/5 overflow-hidden shrink-0 flex items-center justify-center bg-white/[0.02]"><img data-provider-logo src="${providerLogo}" alt="${getProviderLogoAlt(m)}" loading="lazy" class="w-full h-full object-contain p-1 ${shouldInvertProviderLogo(m.provider) ? 'invert' : ''}"></div>`
                    : fallbackMarkup;
                item.innerHTML = `
                    <div class="flex items-center gap-3.5 min-w-0">
                         ${m.provider === 'wan2gp' ? `<div class="w-10 h-10 shrink-0 ${iconColor} border border-white/5 rounded-xl flex items-center justify-center font-black text-sm shadow-inner uppercase">⚡</div>` : logoMarkup}
                         <div class="flex flex-col gap-0.5 min-w-0">
                            <span class="text-xs font-bold text-white tracking-tight">${m.name}</span>
                            ${isV2V ? `<span class="text-[9px] text-orange-400/70">${m.imageField ? 'Upload a video and image' : 'Upload a video to use'}</span>` : ''}
                            ${localNote}
                         </div>
                    </div>
                    ${selectedModel === m.id ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="4"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                `;
                const logoImage = item.querySelector('[data-provider-logo]');
                logoImage?.addEventListener('error', () => {
                    const fallback = createProviderFallbackTile(document, fallbackClasses, fallbackText);
                    handleProviderLogoError({
                        image: logoImage,
                        failedProviderLogos,
                        providerLogo,
                        fallback,
                    });
                }, { once: true });
                item.onclick = (e) => {
                    e.stopPropagation();
                    if (unavailable) return;
                    if (isV2V) {
                        // Switch to v2v mode
                        v2vMode = true;
                        imageMode = false;
                        const isMC = !!m.imageField;
                        if (!isMC) {
                            // Single-input v2v (watermark remover etc.) — drop any image
                            picker.reset();
                            uploadedImageUrl = null;
                        }
                        selectedModel = m.id;
                        selectedModelName = m.name;
                        document.getElementById('v-model-btn-label').textContent = selectedModelName;
                        updateControlsForModel(selectedModel);
                        if (isMC) {
                            textarea.placeholder = m.promptRequired
                                ? 'Upload a reference video and image, then describe the motion'
                                : 'Upload a reference video and image, then describe the motion (optional)';
                            textarea.disabled = false;
                        } else {
                            textarea.placeholder = 'Upload a video using the 🎥 button, then click Generate';
                            textarea.disabled = true;
                        }
                    } else {
                        // Leaving v2v mode if was in it
                        if (v2vMode) {
                            v2vMode = false;
                            uploadedVideoUrl = null;
                            showVideoIcon();
                            textarea.disabled = false;
                        }
                        selectedModel = m.id;
                        selectedModelName = m.name;
                        document.getElementById('v-model-btn-label').textContent = selectedModelName;
                        updateControlsForModel(selectedModel);
                        textarea.placeholder = imageMode ? 'Describe the motion or effect (optional)' : 'Describe the video you want to create';
                    }
                    closeDropdown();
                };
                return item;
            };

            const renderModels = (filter = '') => {
                list.innerHTML = '';
                const lf = filter.toLowerCase();

                if (harnessCtrl.getMode() === 'harness') {
                    harnessCtrl.renderModelDropdown({
                        listEl: list,
                        filter,
                        onSelect: (m) => {
                            document.getElementById('v-model-btn-label').textContent = m.name || m.id;
                            closeDropdown();
                        },
                    });
                    return;
                }

                // Regular generation models (always t2v or i2v, never v2v)
                const generationModels = imageMode ? i2vList() : t2vList();
                const filteredMain = generationModels
                    .filter(m => m.name.toLowerCase().includes(lf) || m.id.toLowerCase().includes(lf));
                filteredMain.forEach(m => list.appendChild(makeModelItem(m, false)));

                // Video Tools section (cloud-only)
                const filteredV2V = useLocalModel ? [] : v2vModels.filter(m => m.name.toLowerCase().includes(lf) || m.id.toLowerCase().includes(lf));
                if (filteredV2V.length > 0) {
                    const sectionLabel = document.createElement('div');
                    sectionLabel.className = 'text-[10px] font-bold text-orange-400/70 uppercase tracking-widest px-3 py-2 mt-1 border-t border-white/5';
                    sectionLabel.textContent = t('video.videoTools');
                    list.appendChild(sectionLabel);
                    filteredV2V.forEach(m => list.appendChild(makeModelItem(m, true)));
                }
            };

            renderModels();
            const searchInput = dropdown.querySelector('#v-model-search');
            searchInput.onclick = (e) => e.stopPropagation();
            searchInput.oninput = (e) => renderModels(e.target.value);
            // Settings may have changed since the toggle — re-read Wan2GP availability.
            if (useLocalModel) {
                refreshLocalAvailability().then(() => { if (dropdownOpen === 'model') renderModels(searchInput.value); });
            }

        } else if (type === 'ar') {
            dropdown.classList.add('max-w-[240px]');
            dropdown.innerHTML = `<div class="text-[10px] font-bold text-muted uppercase tracking-widest px-3 py-2 border-b border-white/5 mb-2">Aspect Ratio</div>`;
            const list = document.createElement('div');
            list.className = 'flex flex-col gap-1';
            const availableArs = getCurrentAspectRatios(selectedModel);
            availableArs.forEach(r => {
                const item = document.createElement('div');
                item.className = 'flex items-center justify-between p-3.5 hover:bg-white/5 rounded-2xl cursor-pointer transition-all group';
                item.innerHTML = `
                    <div class="flex items-center gap-4">
                        <div class="w-6 h-6 border-2 border-white/20 rounded-md shadow-inner flex items-center justify-center group-hover:border-primary/50 transition-colors">
                             <div class="w-3 h-3 bg-white/10 rounded-sm"></div>
                        </div>
                        <span class="text-xs font-bold text-white opacity-80 group-hover:opacity-100 transition-opacity">${r}</span>
                    </div>
                     ${selectedAr === r ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="4"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                `;
                item.onclick = (e) => {
                    e.stopPropagation();
                    selectedAr = r;
                    document.getElementById('v-ar-btn-label').textContent = r;
                    closeDropdown();
                };
                list.appendChild(item);
            });
            dropdown.appendChild(list);

        } else if (type === 'duration') {
            dropdown.classList.add('max-w-[200px]');
            dropdown.innerHTML = `<div class="text-[10px] font-bold text-secondary uppercase tracking-widest px-3 py-2 border-b border-white/5 mb-2">Duration</div>`;
            const list = document.createElement('div');
            list.className = 'flex flex-col gap-1';
            const durations = getCurrentDurations(selectedModel);
            durations.forEach(d => {
                const item = document.createElement('div');
                item.className = 'flex items-center justify-between p-3.5 hover:bg-white/5 rounded-2xl cursor-pointer transition-all group';
                item.innerHTML = `
                    <span class="text-xs font-bold text-white opacity-80 group-hover:opacity-100">${d}s</span>
                     ${selectedDuration === d ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="4"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                `;
                item.onclick = (e) => {
                    e.stopPropagation();
                    selectedDuration = d;
                    document.getElementById('v-duration-btn-label').textContent = `${d}s`;
                    closeDropdown();
                };
                list.appendChild(item);
            });
            dropdown.appendChild(list);

        } else if (type === 'quality') {
            dropdown.classList.add('max-w-[200px]');
            dropdown.innerHTML = `<div class="text-[10px] font-bold text-secondary uppercase tracking-widest px-3 py-2 border-b border-white/5 mb-2">Quality</div>`;
            const list = document.createElement('div');
            list.className = 'flex flex-col gap-1';
            getQualitiesForModel(selectedModel).forEach(q => {
                const item = document.createElement('div');
                item.className = 'flex items-center justify-between p-3.5 hover:bg-white/5 rounded-2xl cursor-pointer transition-all group';
                item.innerHTML = `
                    <span class="text-xs font-bold text-white opacity-80 group-hover:opacity-100 capitalize">${q}</span>
                    ${selectedQuality === q ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="4"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                `;
                item.onclick = (e) => {
                    e.stopPropagation();
                    selectedQuality = q;
                    document.getElementById('v-quality-btn-label').textContent = q;
                    closeDropdown();
                };
                list.appendChild(item);
            });
            dropdown.appendChild(list);

        } else if (type === 'resolution') {
            dropdown.classList.add('max-w-[200px]');
            dropdown.innerHTML = `<div class="text-[10px] font-bold text-secondary uppercase tracking-widest px-3 py-2 border-b border-white/5 mb-2">Resolution</div>`;
            const list = document.createElement('div');
            list.className = 'flex flex-col gap-1';
            const resolutions = getCurrentResolutions(selectedModel);
            resolutions.forEach(r => {
                const item = document.createElement('div');
                item.className = 'flex items-center justify-between p-3.5 hover:bg-white/5 rounded-2xl cursor-pointer transition-all group';
                item.innerHTML = `
                    <span class="text-xs font-bold text-white opacity-80 group-hover:opacity-100">${r}</span>
                     ${selectedResolution === r ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="4"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                `;
                item.onclick = (e) => {
                    e.stopPropagation();
                    selectedResolution = r;
                    document.getElementById('v-resolution-btn-label').textContent = r;
                    closeDropdown();
                };
                list.appendChild(item);
            });
            dropdown.appendChild(list);

        } else if (type === 'mode') {
            dropdown.classList.add('max-w-[200px]');
            dropdown.innerHTML = `<div class="text-[10px] font-bold text-secondary uppercase tracking-widest px-3 py-2 border-b border-white/5 mb-2">Mode</div>`;
            const list = document.createElement('div');
            list.className = 'flex flex-col gap-1';
            getCurrentModes(selectedModel).forEach(m => {
                const item = document.createElement('div');
                item.className = 'flex items-center justify-between p-3.5 hover:bg-white/5 rounded-2xl cursor-pointer transition-all group';
                item.innerHTML = `
                    <span class="text-xs font-bold text-white opacity-80 group-hover:opacity-100 capitalize">${m}</span>
                    ${selectedMode === m ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="4"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                `;
                item.onclick = (e) => {
                    e.stopPropagation();
                    selectedMode = m;
                    document.getElementById('v-mode-btn-label').textContent = m;
                    closeDropdown();
                };
                list.appendChild(item);
            });
            dropdown.appendChild(list);

        } else if (type === 'effect') {
            dropdown.classList.add('max-w-[240px]');
            dropdown.classList.remove('max-w-[200px]');
            dropdown.innerHTML = `<div class="text-[10px] font-bold text-secondary uppercase tracking-widest px-3 py-2 border-b border-white/5 mb-2">Effect Type</div>`;
            const list = document.createElement('div');
            list.className = 'flex flex-col gap-1 max-h-[50vh] overflow-y-auto custom-scrollbar';
            getEffectNamesForModel(selectedModel).forEach(e => {
                const item = document.createElement('div');
                item.className = 'flex items-center justify-between p-3 hover:bg-white/5 rounded-2xl cursor-pointer transition-all group';
                item.innerHTML = `
                    <span class="text-xs font-bold text-white opacity-80 group-hover:opacity-100">${e}</span>
                    ${selectedEffectName === e ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="4"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                `;
                item.onclick = (ev) => {
                    ev.stopPropagation();
                    selectedEffectName = e;
                    document.getElementById('v-effect-btn-label').textContent = e;
                    closeDropdown();
                };
                list.appendChild(item);
            });
            dropdown.appendChild(list);
        }

        // Position dropdown
        const btnRect = anchorBtn.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        if (window.innerWidth < 768) {
            dropdown.style.left = '50%';
            dropdown.style.transform = 'translateX(-50%) translate(0, 8px)';
        } else {
            dropdown.style.left = `${btnRect.left - containerRect.left}px`;
            dropdown.style.transform = 'translate(0, 8px)';
        }
        dropdown.style.bottom = `${containerRect.bottom - btnRect.top + 8}px`;
    };

    const closeDropdown = () => {
        dropdown.classList.add('opacity-0', 'pointer-events-none');
        dropdown.classList.remove('opacity-100', 'pointer-events-auto');
        dropdownOpen = null;
    };

    const toggleDropdown = (type, btn) => (e) => {
        e.stopPropagation();
        if (dropdownOpen === type) closeDropdown();
        else { dropdownOpen = type; showDropdown(type, btn); }
    };

    modelBtn.onclick = toggleDropdown('model', modelBtn);
    arBtn.onclick = toggleDropdown('ar', arBtn);
    durationBtn.onclick = toggleDropdown('duration', durationBtn);
    resolutionBtn.onclick = toggleDropdown('resolution', resolutionBtn);
    qualityBtn.onclick = toggleDropdown('quality', qualityBtn);
    modeBtn.onclick = toggleDropdown('mode', modeBtn);
    effectNameBtn.onclick = toggleDropdown('effect', effectNameBtn);

    window.addEventListener('click', closeDropdown);
    container.appendChild(dropdown);

    // ==========================================
    // 4. CANVAS AREA + HISTORY
    // ==========================================
    const generationHistory = [];

    const historySidebar = document.createElement('div');
    historySidebar.className = 'fixed right-0 top-0 h-full w-20 md:w-24 bg-black/60 backdrop-blur-xl border-l border-white/5 z-50 flex flex-col items-center py-4 gap-3 overflow-y-auto transition-all duration-500 translate-x-full opacity-0';
    historySidebar.id = 'video-history-sidebar';

    const historyLabel = document.createElement('div');
    historyLabel.className = 'text-[9px] font-bold text-muted uppercase tracking-widest mb-2';
    historyLabel.textContent = t('video.history');
    historySidebar.appendChild(historyLabel);

    const historyList = document.createElement('div');
    historyList.className = 'flex flex-col gap-2 w-full px-2';
    historySidebar.appendChild(historyList);
    container.appendChild(historySidebar);

    // Main canvas
    const canvas = document.createElement('div');
    canvas.className = 'absolute inset-0 flex flex-col items-center justify-center p-4 min-[800px]:p-16 z-10 opacity-0 pointer-events-none transition-all duration-1000 translate-y-10 scale-95';

    const videoContainer = document.createElement('div');
    videoContainer.className = 'relative group';

    const resultVideo = document.createElement('video');
    resultVideo.className = 'max-h-[60vh] max-w-[80vw] rounded-3xl shadow-3xl border border-white/10 interactive-glow object-contain';
    resultVideo.controls = true;
    resultVideo.loop = true;
    resultVideo.autoplay = true;
    resultVideo.muted = true;
    resultVideo.playsInline = true;
    videoContainer.appendChild(resultVideo);

    // Canvas Controls
    const canvasControls = document.createElement('div');
    canvasControls.className = 'mt-6 flex gap-3 opacity-0 transition-opacity delay-500 duration-500 justify-center';

    const regenerateBtn = document.createElement('button');
    regenerateBtn.className = 'bg-white/10 hover:bg-white/20 px-6 py-2.5 rounded-2xl text-xs font-bold transition-all border border-white/5 backdrop-blur-lg text-white';
    regenerateBtn.textContent = t('video.regenerate');

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'bg-primary text-black px-6 py-2.5 rounded-2xl text-xs font-bold transition-all shadow-glow active:scale-95';
    downloadBtn.textContent = t('video.download');

    const extendBtn = document.createElement('button');
    extendBtn.className = 'hidden bg-white/10 hover:bg-white/20 px-6 py-2.5 rounded-2xl text-xs font-bold transition-all border border-primary/30 text-primary backdrop-blur-lg';
    extendBtn.textContent = t('video.extend');
    extendBtn.title = 'Extend this video using Seedance 2.0 Extend';

    const newPromptBtn = document.createElement('button');
    newPromptBtn.className = 'bg-white/10 hover:bg-white/20 px-6 py-2.5 rounded-2xl text-xs font-bold transition-all border border-white/5 backdrop-blur-lg text-white';
    newPromptBtn.textContent = t('video.new');

    const audioToggle = createVideoAudioToggleButton(resultVideo);

    canvasControls.appendChild(audioToggle.button);
    canvasControls.appendChild(regenerateBtn);
    canvasControls.appendChild(extendBtn);
    canvasControls.appendChild(downloadBtn);
    canvasControls.appendChild(newPromptBtn);

    canvas.appendChild(videoContainer);
    canvas.appendChild(canvasControls);
    container.appendChild(canvas);

    // --- Helper: Show video in canvas ---
    const showVideoInCanvas = (videoUrl, genModel) => {
        hero.classList.add('hidden');
        promptWrapper.classList.add('hidden');

        // Show extend button only for seedance-v2.0-t2v and i2v (not extend itself)
        const isSeedance2 = genModel && (genModel === 'seedance-v2.0-t2v' || genModel === 'seedance-v2.0-i2v');
        extendBtn.classList.toggle('hidden', !isSeedance2);

        audioToggle.syncLabel();
        resultVideo.onloadeddata = () => {
            canvas.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10', 'scale-95');
            canvas.classList.add('opacity-100', 'translate-y-0', 'scale-100');
            canvasControls.classList.remove('opacity-0');
            canvasControls.classList.add('opacity-100');
        };
        resultVideo.src = videoUrl;
        resultVideo.load?.();
    };

    // --- Helper: Add to history ---
    const addToHistory = (entry) => {
        generationHistory.unshift(entry);
        localStorage.setItem('video_history', JSON.stringify(generationHistory.slice(0, 30)));
        historySidebar.classList.remove('translate-x-full', 'opacity-0');
        historySidebar.classList.add('translate-x-0', 'opacity-100');
        renderHistory();
    };

    const renderHistory = () => {
        historyList.innerHTML = '';
        generationHistory.forEach((entry, idx) => {
            const thumb = document.createElement('div');
            thumb.className = `relative group/thumb cursor-pointer rounded-xl overflow-hidden border-2 transition-all duration-300 ${idx === 0 ? 'border-primary shadow-glow' : 'border-white/10 hover:border-white/30'}`;

            const { media, overlay } = createHistoryMediaWithDownload({
                document,
                tagName: 'video',
                url: entry.url,
                mediaClassName: 'w-full aspect-square object-cover',
                overlayClassName: 'absolute inset-0 bg-black/60 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center gap-1',
                buttonClassName: 'hist-download p-1.5 bg-primary rounded-lg text-black hover:scale-110 transition-transform',
            });
            thumb.appendChild(media);
            thumb.appendChild(overlay);

            thumb.onclick = (e) => {
                if (e.target.closest('.hist-delete')) {
                    const at = generationHistory.indexOf(entry);
                    if (at !== -1) generationHistory.splice(at, 1);
                    try { localStorage.setItem('video_history', JSON.stringify(generationHistory.slice(0, 30))); } catch (err) { /* ignore */ }
                    renderHistory();
                    return;
                }
                if (e.target.closest('.hist-download')) {
                    downloadFile(entry.url, `video-${entry.id || idx}.mp4`);
                    return;
                }
                // Restore extend context when viewing a seedance-v2.0 generation
                if (entry.model === 'seedance-v2.0-t2v' || entry.model === 'seedance-v2.0-i2v') {
                    lastGenerationId = entry.id;
                    lastGenerationModel = entry.model;
                } else {
                    lastGenerationId = null;
                    lastGenerationModel = null;
                }
                showVideoInCanvas(entry.url, entry.model);
                historyList.querySelectorAll('div').forEach(t => {
                    t.classList.remove('border-primary', 'shadow-glow');
                    t.classList.add('border-white/10');
                });
                thumb.classList.remove('border-white/10');
                thumb.classList.add('border-primary', 'shadow-glow');
            };

            historyList.appendChild(thumb);
        });
    };

    // --- Helper: Download file ---
    const downloadFile = async (url, filename) => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        } catch (err) {
            window.open(url, '_blank');
        }
    };

    // --- Load history from localStorage ---
    try {
        const saved = JSON.parse(localStorage.getItem('video_history') || '[]');
        if (saved.length > 0) {
            saved.forEach(e => generationHistory.push(e));
            historySidebar.classList.remove('translate-x-full', 'opacity-0');
            historySidebar.classList.add('translate-x-0', 'opacity-100');
            renderHistory();
        }
    } catch (e) { /* ignore */ }

    // --- Resume any pending video generations from a previous session ---
    (async () => {
        const pending = getPendingJobs('video');
        if (!pending.length) return;

        const apiKey = localStorage.getItem('muapi_key');
        if (!apiKey) return; // can't poll without key; jobs remain for next time

        const banner = document.createElement('div');
        banner.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[200] bg-[#111] border border-white/10 text-white text-sm px-5 py-3 rounded-2xl shadow-xl flex items-center gap-3';
        banner.innerHTML = `<span class="animate-spin text-primary">◌</span> <span class="banner-text">Resuming ${pending.length} pending generation${pending.length > 1 ? 's' : ''}…</span>`;
        document.body.appendChild(banner);

        let remaining = pending.length;
        pending.forEach(async (job) => {
            const elapsedAttempts = Math.floor((Date.now() - job.submittedAt) / job.interval);
            const attemptsLeft = Math.max(1, job.maxAttempts - elapsedAttempts);
            try {
                const result = await muapi.pollForResult(job.requestId, apiKey, attemptsLeft, job.interval);
                const url = result.outputs?.[0] || result.url || result.output?.url;
                if (url) {
                    addToHistory({ id: job.requestId, url, ...job.historyMeta, timestamp: new Date().toISOString() });
                }
            } catch (e) {
                console.warn('[VideoStudio] Pending job failed on resume:', job.requestId, e.message);
            } finally {
                removePendingJob(job.requestId);
                remaining--;
                if (remaining === 0) banner.remove();
                else banner.querySelector('.banner-text').textContent = `Resuming ${remaining} pending generation${remaining > 1 ? 's' : ''}…`;
            }
        });
    })();

    // --- Button Handlers ---
    downloadBtn.onclick = () => {
        const current = resultVideo.src;
        if (current) {
            const entry = generationHistory.find(e => e.url === current);
            const ext = /\.webm(?:\?|$)/i.test(current) ? 'webm' : 'mp4';
            downloadFile(current, `video-${entry?.id || 'clip'}.${ext}`);
        }
    };

    regenerateBtn.onclick = () => generateBtn.click();

    const resetToPromptBar = () => {
        canvas.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10', 'scale-95');
        canvas.classList.remove('opacity-100', 'translate-y-0', 'scale-100');
        canvasControls.classList.add('opacity-0');
        canvasControls.classList.remove('opacity-100');
        hero.classList.remove('hidden', 'opacity-0', 'scale-95', '-translate-y-10', 'pointer-events-none');
        promptWrapper.classList.remove('hidden', 'opacity-40');
    };

    newPromptBtn.onclick = () => {
        resetToPromptBar();
        textarea.value = '';
        picker.reset();
        uploadedImageUrl = null;
        uploadedEndImageUrl = null;
        endPicker?.reset();
        endPicker.trigger.classList.add('hidden');
        endPicker.trigger.classList.remove('flex');
        imageMode = false;
        uploadedVideoUrl = null;
        v2vMode = false;
        showVideoIcon();
        hideLocalPanel();
        harnessCtrl.clearError();
        if (harnessCtrl.getMode() === 'harness') {
            const hm = harnessCtrl.getSelectedModel();
            document.getElementById('v-model-btn-label').textContent = hm?.name || hm?.id || 'Harness Model';
        } else {
            selectedModel = t2vList()[0].id;
            selectedModelName = t2vList()[0].name;
            document.getElementById('v-model-btn-label').textContent = selectedModelName;
            updateControlsForModel(selectedModel);
        }
        textarea.placeholder = 'Describe the video you want to create';
        textarea.disabled = false;
        textarea.focus();
    };

    extendBtn.onclick = () => {
        if (!lastGenerationId) return;
        resetToPromptBar();
        textarea.value = '';
        picker.reset();
        uploadedImageUrl = null;
        uploadedEndImageUrl = null;
        endPicker?.reset();
        endPicker.trigger.classList.add('hidden');
        endPicker.trigger.classList.remove('flex');
        imageMode = false;
        selectedModel = 'seedance-v2.0-extend';
        selectedModelName = 'Seedance 2.0 Extend';
        document.getElementById('v-model-btn-label').textContent = selectedModelName;
        updateControlsForModel(selectedModel);
        textarea.placeholder = 'Optional: describe how to continue the video...';
        textarea.focus();
    };

    // ==========================================
    // 5. GENERATION LOGIC
    // ==========================================
    generateBtn.onclick = async () => {
        harnessCtrl.clearError();
        const prompt = textarea.value.trim();

        if (harnessCtrl.getMode() === 'harness') {
            if (!prompt && !uploadedImageUrl) {
                alert('Please enter a prompt or upload a start image to generate a video with the selected harness.');
                return;
            }
            hero.classList.add('opacity-0', 'scale-95', '-translate-y-10', 'pointer-events-none');
            generateBtn.disabled = true;
            generateBtn.innerHTML = `<span class="animate-spin inline-block mr-2 text-black">◌</span> ${t('common.generating')}`;
            try {
                await harnessCtrl.runPrompt({
                    prompt: prompt || 'Animate this reference scene with smooth cinematic camera motion',
                    aspectRatio: selectedAr,
                    durationSec: selectedDuration,
                    videoEngine: selectedVideoEngine,
                    vfx: selectedVfx,
                    grade: selectedGrade,
                    musicMood: selectedMusicMood,
                    letterbox: selectedLetterbox,
                    negativePrompt,
                    referenceImages: [uploadedImageUrl, uploadedEndImageUrl].filter(Boolean),
                    onMediaReady: ({ url, model: m }) => {
                        addToHistory({
                            id: Date.now().toString(),
                            url,
                            prompt,
                            model: m,
                            aspect_ratio: selectedAr,
                            duration: selectedDuration,
                            timestamp: new Date().toISOString(),
                        });
                        showVideoInCanvas(url, m);
                    },
                });
            } catch (e) {
                hero.classList.remove('opacity-0', 'scale-95', '-translate-y-10', 'pointer-events-none');
                harnessCtrl.showError(e);
            } finally {
                generateBtn.disabled = false;
                generateBtn.innerHTML = t('common.generate');
            }
            return;
        }

        const model = getCurrentModel();
        const isExtendMode = model?.requiresRequestId;

        if (v2vMode) {
            if (!uploadedVideoUrl) {
                alert('Please upload a video first.');
                return;
            }
            if (model?.imageField && !uploadedImageUrl) {
                alert('Please upload a reference image for motion control.');
                return;
            }
            if (model?.promptRequired && !prompt) {
                alert('Please describe the motion you want.');
                return;
            }
        } else if (isExtendMode) {
            if (!lastGenerationId) {
                alert('No Seedance 2.0 generation found to extend. Generate a video first.');
                return;
            }
        } else if (imageMode) {
            if (!uploadedImageUrl) {
                alert('Please upload a start frame image first.');
                return;
            }
        } else {
            if (!prompt) {
                alert('Please enter a prompt to generate a video.');
                return;
            }
        }

        const isLocal = useLocalModel && isWan2gpModelId(selectedModel);

        // Local Wan2GP generations don't go through Muapi — skip the auth gate,
        // but refuse models the engine reported as unavailable.
        if (isLocal) {
            if (!localAvailability.size) await refreshLocalAvailability();
            const status = localAvailability.get(selectedModel);
            if (status && !status.ready) {
                showLocalError(status.unavailableReason);
                return;
            }
        } else {
            const apiKey = localStorage.getItem('muapi_key');
            if (!apiKey) {
                AuthModal(() => generateBtn.click());
                return;
            }
        }

        hero.classList.add('opacity-0', 'scale-95', '-translate-y-10', 'pointer-events-none');
        generateBtn.disabled = true;
        generateBtn.innerHTML = `<span class="animate-spin inline-block mr-2 text-black">◌</span> ${t('common.generating')}`;

        // Local generations stream phase/step progress into the panel and the button.
        let unsubscribeProgress = null;
        if (isLocal) {
            setLocalProgress({ status: 'starting', progress: 0 });
            showLocalPanel('progress');
            unsubscribeProgress = localAI.onProgress((event) => {
                setLocalProgress(event);
                generateBtn.innerHTML = `<span class="animate-spin inline-block mr-2 text-black">◌</span> ${localProgressLabel(event)}`;
            });
        }

        let hadError = false;
        let capturedRequestId = null;
        const historyMeta = { prompt, model: selectedModel, aspect_ratio: selectedAr, duration: selectedDuration };

        const onRequestId = (rid) => {
            capturedRequestId = rid;
            savePendingJob({ requestId: rid, studioType: 'video', historyMeta, maxAttempts: 900, interval: 2000, submittedAt: Date.now() });
        };

        try {
            // ─── Local Wan2GP path ───────────────────────────────────────────
            // Start frames were saved on disk by uploadFileToWan2gp(); the
            // provider passes that path to Wan2GP (or uploads it to a remote one).
            if (isLocal) {
                const localParams = {
                    model: selectedModel,
                    prompt: prompt || '',
                    aspect_ratio: selectedAr,
                };
                if (imageMode && uploadedImageUrl) localParams.image = uploadedImageUrl;
                const res = await localAI.generate(localParams);
                console.log('[VideoStudio] Local response:', res);
                hideLocalPanel();
                if (res && res.url) {
                    const genId = Date.now().toString();
                    lastGenerationId = null;
                    lastGenerationModel = null;
                    addToHistory({ id: genId, url: res.url, prompt, model: selectedModel, aspect_ratio: selectedAr, seed: res.seed, timestamp: new Date().toISOString() });
                    showVideoInCanvas(res.url, selectedModel);
                } else {
                    throw new Error('No video URL returned by Wan2GP');
                }
                generateBtn.disabled = false;
                generateBtn.innerHTML = t('common.generate');
                return;
            }

            if (v2vMode) {
                const v2vParams = { model: selectedModel, video_url: uploadedVideoUrl, onRequestId };
                if (model?.imageField && uploadedImageUrl) v2vParams.image_url = uploadedImageUrl;
                if (model?.hasPrompt && prompt) v2vParams.prompt = prompt;
                const res = await muapi.processV2V(v2vParams);
                console.log('[VideoStudio] V2V response:', res);
                if (res && res.url) {
                    if (capturedRequestId) removePendingJob(capturedRequestId);
                    const genId = res.id || capturedRequestId || Date.now().toString();
                    lastGenerationId = null;
                    lastGenerationModel = null;
                    addToHistory({ id: genId, url: res.url, prompt: model?.hasPrompt ? prompt : '', model: selectedModel, timestamp: new Date().toISOString() });
                    showVideoInCanvas(res.url, selectedModel);
                } else {
                    throw new Error('No video URL returned by API');
                }
                generateBtn.disabled = false;
                generateBtn.innerHTML = t('common.generate');
                return;
            }

            if (imageMode) {
                const i2vParams = {
                    model: selectedModel,
                    image_url: uploadedImageUrl,
                    onRequestId,
                };
                i2vParams.prompt = prompt || '';
                i2vParams.aspect_ratio = selectedAr;
                if (uploadedEndImageUrl && getCurrentModel()?.lastImageField) {
                    i2vParams.last_image = uploadedEndImageUrl;
                }
                const durations = getCurrentDurations(selectedModel);
                if (durations.length > 0) i2vParams.duration = selectedDuration;
                const resolutions = getCurrentResolutions(selectedModel);
                if (resolutions.length > 0) i2vParams.resolution = selectedResolution;
                if (selectedQuality) i2vParams.quality = selectedQuality;
                if (selectedMode) i2vParams.mode = selectedMode;
                if (selectedEffectName) i2vParams.name = selectedEffectName;

                const res = await muapi.generateI2V(i2vParams);
                console.log('[VideoStudio] I2V response:', res);

                if (res && res.url) {
                    if (capturedRequestId) removePendingJob(capturedRequestId);
                    const genId = res.id || capturedRequestId || Date.now().toString();
                    if (selectedModel === 'seedance-v2.0-i2v') {
                        lastGenerationId = genId;
                        lastGenerationModel = selectedModel;
                    } else {
                        lastGenerationId = null;
                        lastGenerationModel = null;
                    }
                    addToHistory({ id: genId, url: res.url, prompt, model: selectedModel, aspect_ratio: selectedAr, duration: selectedDuration, timestamp: new Date().toISOString() });
                    showVideoInCanvas(res.url, selectedModel);
                } else {
                    throw new Error('No video URL returned by API');
                }
                generateBtn.disabled = false;
                generateBtn.innerHTML = t('common.generate');
                return;
            }

            const params = { model: selectedModel, onRequestId };

            if (prompt) params.prompt = prompt;

            // Extend mode: pass stored request_id, skip aspect_ratio
            if (isExtendMode) {
                params.request_id = lastGenerationId;
            } else {
                params.aspect_ratio = selectedAr;
            }

            const durations = getCurrentDurations(selectedModel);
            if (durations.length > 0) params.duration = selectedDuration;

            const resolutions = getCurrentResolutions(selectedModel);
            if (resolutions.length > 0) params.resolution = selectedResolution;

            if (selectedQuality) params.quality = selectedQuality;
            if (selectedMode) params.mode = selectedMode;

            const res = await muapi.generateVideo(params);

            console.log('[VideoStudio] Full response:', res);

            if (res && res.url) {
                if (capturedRequestId) removePendingJob(capturedRequestId);
                const genId = res.id || capturedRequestId || Date.now().toString();
                // Store request_id for seedance-v2.0 models (enables Extend button)
                if (selectedModel === 'seedance-v2.0-t2v' || selectedModel === 'seedance-v2.0-i2v') {
                    lastGenerationId = genId;
                    lastGenerationModel = selectedModel;
                } else {
                    lastGenerationId = null;
                    lastGenerationModel = null;
                }

                addToHistory({
                    id: genId,
                    url: res.url,
                    prompt,
                    model: selectedModel,
                    aspect_ratio: selectedAr,
                    duration: selectedDuration,
                    timestamp: new Date().toISOString()
                });
                showVideoInCanvas(res.url, selectedModel);
            } else {
                console.error('[VideoStudio] No video URL in response:', res);
                throw new Error('No video URL returned by API');
            }
        } catch (e) {
            hadError = true;
            if (capturedRequestId) removePendingJob(capturedRequestId);
            console.error(e);
            // Restore hero so the page doesn't look broken after a failed generation
            hero.classList.remove('opacity-0', 'scale-95', '-translate-y-10', 'pointer-events-none');
            const cancelled = isLocal && /Generation cancelled/.test(e.message);
            if (isLocal) {
                // Local errors carry the Wan2GP log tail — show all of it, not a 60-char button label.
                if (cancelled) hideLocalPanel();
                else showLocalError(e.message);
            } else {
                harnessCtrl.showError(e);
            }
            generateBtn.innerHTML = cancelled ? t('video.localCancelled')
                : isLocal ? t('video.localFailed')
                : t('common.generate');
            setTimeout(() => {
                generateBtn.innerHTML = t('common.generate');
            }, 4000);
        } finally {
            generateBtn.disabled = false;
            if (typeof unsubscribeProgress === 'function') unsubscribeProgress();
            // Only reset the label on success; the catch timeout handles the error case
            if (!hadError) generateBtn.innerHTML = t('common.generate');
        }
    };

    return container;
}
