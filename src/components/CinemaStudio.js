
import { muapi } from '../lib/muapi.js';
import { CameraControls } from './CameraControls.js';
import { buildNanoBananaPrompt, CAMERA_MAP, LENS_MAP, FOCAL_PERSPECTIVE, APERTURE_EFFECT } from '../lib/promptUtils.js';
import { AuthModal } from './AuthModal.js';
import { t } from '../lib/i18n.js';
import { createHistoryImageWithLabel } from '../lib/historyDom.mjs';
import { createStudioHarnessController } from '../lib/harnessStudioMode.js';

export function CinemaStudio() {
    const container = document.createElement('div');
    container.className = 'w-full h-full flex flex-col items-center justify-center bg-black relative overflow-hidden';

    // --- State ---
    const currentSettings = {
        prompt: '',
        aspect_ratio: '16:9',
        camera: Object.keys(CAMERA_MAP)[0],
        lens: Object.keys(LENS_MAP)[0],
        focal: 35,
        aperture: "f/1.4"
    };
    
    // Camera builder panel state
    let showCameraBuilder = false;

    // ==========================================
    // 1. HERO SECTION (Empty State)
    // ==========================================
    const heroSection = document.createElement('div');
    heroSection.className = 'flex flex-col items-center justify-center text-center px-4 animate-fade-in-up';
    heroSection.innerHTML = `
        <div class="mb-4 text-xs font-bold text-white/40 tracking-[0.2em] uppercase">${t('cinema.tagline')}</div>
        <h1 class="text-4xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-white/50 tracking-tight leading-tight mb-2">
            ${t('cinema.headline')}
        </h1>
    `;
    container.appendChild(heroSection);

    // ==========================================
    // 2. CAMERA CONTROLS OVERLAY
    // ==========================================
    const overlayBackdrop = document.createElement('div');
    overlayBackdrop.className = 'fixed inset-0 bg-black/80 backdrop-blur-md z-40 opacity-0 pointer-events-none transition-opacity duration-300 flex items-center justify-center';

    const overlayContent = document.createElement('div');
    // Reduced padding for mobile (p-4) and added max-height/overflow handling
    overlayContent.className = 'w-full max-w-4xl bg-[#141414] border border-white/10 rounded-3xl p-4 md:p-8 shadow-2xl transform scale-95 transition-transform duration-300 flex flex-col max-h-[90vh]';
    overlayBackdrop.appendChild(overlayContent);

    // Header for Overlay
    const overlayHeader = document.createElement('div');
    overlayHeader.className = 'flex items-center justify-between mb-8';
    overlayHeader.innerHTML = `
        <div class="flex gap-4">
            <button class="px-4 py-2 bg-white text-black text-xs font-bold rounded-full">All</button>
        </div>
        <button id="close-overlay-btn" class="text-white/50 hover:text-white transition-colors">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
    `;
    overlayContent.appendChild(overlayHeader);

    // Controls Component
    const cameraControls = CameraControls((state) => {
        currentSettings.camera = state.camera;
        currentSettings.lens = state.lens;
        currentSettings.focal = state.focal;
        currentSettings.aperture = state.aperture;
        updateSummaryCard();
    });
    overlayContent.appendChild(cameraControls);

    document.body.appendChild(overlayBackdrop); // Append to body to sit above everything

    // Overlay Logic
    const openOverlay = () => {
        overlayBackdrop.classList.remove('opacity-0', 'pointer-events-none');
        overlayContent.classList.remove('scale-95');
        overlayContent.classList.add('scale-100');
    };
    const closeOverlay = () => {
        overlayBackdrop.classList.add('opacity-0', 'pointer-events-none');
        overlayContent.classList.add('scale-95');
        overlayContent.classList.remove('scale-100');
    };
    overlayContent.querySelector('#close-overlay-btn').onclick = closeOverlay;
    overlayBackdrop.onclick = (e) => { if (e.target === overlayBackdrop) closeOverlay(); };


    // ==========================================
    // 3. FLOATING PROMPT BAR
    // ==========================================
    const promptBarWrapper = document.createElement('div');
    promptBarWrapper.className = 'absolute bottom-8 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-4xl z-30 flex flex-col gap-3';

    const promptBar = document.createElement('div');
    promptBar.className = 'bg-[#1a1a1a] border border-white/10 rounded-[2rem] p-4 flex justify-between shadow-3xl items-end relative';

    // --- LEFT COLUMN (Input + Settings) ---
    const leftColumn = document.createElement('div');
    leftColumn.className = 'flex-1 flex flex-col gap-3 min-h-[80px] justify-between py-1 px-1 min-w-0';

    // 1. Input Area
    const inputRow = document.createElement('div');
    inputRow.className = 'flex items-start gap-3 w-full';



    // Textarea
    const textarea = document.createElement('textarea');
    textarea.placeholder = t('cinema.placeholder');
    textarea.className = 'flex-1 bg-transparent border-none text-white text-lg font-medium placeholder:text-white/20 focus:outline-none resize-none h-[28px] max-h-[34vh] leading-relaxed overflow-y-auto custom-scrollbar';
    textarea.style.height = 'auto'; // Auto-grow check
    textarea.rows = 1;
    textarea.oninput = function () {
        this.style.height = 'auto';
        const maxPx = Math.round(window.innerHeight * 0.34);
        this.style.height = Math.min(this.scrollHeight, maxPx) + 'px';
    };
    inputRow.appendChild(textarea);

    leftColumn.appendChild(inputRow);

    // 2. Settings Toolbar (Bottom Left)
    const settingsToolbar = document.createElement('div');
    settingsToolbar.className = 'flex flex-wrap items-center gap-2';

    let cinemaHarnessKind = 'image'; // 'image' (Cinema Shot) | 'video' (Cinema Sequence)

    const harnessModelBtn = document.createElement('button');
    harnessModelBtn.type = 'button';
    harnessModelBtn.className = 'hidden items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-white/80 hover:text-white transition-colors bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 max-w-[190px]';
    const harnessModelLabel = document.createElement('span');
    harnessModelLabel.className = 'truncate';
    harnessModelLabel.textContent = 'Model';
    harnessModelBtn.appendChild(harnessModelLabel);

    const kindToggleWrap = document.createElement('div');
    kindToggleWrap.className = 'hidden items-center rounded-lg border border-white/10 bg-white/5 p-0.5 shrink-0';
    const shotKindBtn = document.createElement('button');
    shotKindBtn.type = 'button';
    shotKindBtn.textContent = 'Shot';
    const videoKindBtn = document.createElement('button');
    videoKindBtn.type = 'button';
    videoKindBtn.textContent = 'Video';
    const updateKindButtons = () => {
        shotKindBtn.className = cinemaHarnessKind === 'image'
            ? 'px-2.5 py-1 rounded-md text-[10px] font-bold bg-primary text-black transition-colors'
            : 'px-2.5 py-1 rounded-md text-[10px] font-bold text-white/60 hover:text-white transition-colors';
        videoKindBtn.className = cinemaHarnessKind === 'video'
            ? 'px-2.5 py-1 rounded-md text-[10px] font-bold bg-primary text-black transition-colors'
            : 'px-2.5 py-1 rounded-md text-[10px] font-bold text-white/60 hover:text-white transition-colors';
    };
    shotKindBtn.onclick = (e) => { e.stopPropagation(); cinemaHarnessKind = 'image'; updateKindButtons(); };
    videoKindBtn.onclick = (e) => { e.stopPropagation(); cinemaHarnessKind = 'video'; updateKindButtons(); };
    updateKindButtons();
    kindToggleWrap.appendChild(shotKindBtn);
    kindToggleWrap.appendChild(videoKindBtn);

    const harnessCtrl = createStudioHarnessController({
        kind: 'image',
        includeLocal: false,
        onModeChange: (mode) => {
            const isH = mode === 'harness';
            harnessModelBtn.classList.toggle('hidden', !isH);
            harnessModelBtn.classList.toggle('flex', isH);
            kindToggleWrap.classList.toggle('hidden', !isH);
            kindToggleWrap.classList.toggle('flex', isH);
            if (isH) {
                const m = harnessCtrl.getSelectedModel();
                harnessModelLabel.textContent = m?.name || m?.id || 'Harness Model';
            }
        },
        onHarnessModelChange: ({ model }) => {
            harnessModelLabel.textContent = model?.name || model?.id || 'Harness Model';
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

    harnessModelBtn.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-dropdown').forEach((el) => el.remove());

        const rect = harnessModelBtn.getBoundingClientRect();
        const menu = document.createElement('div');
        menu.className = 'custom-dropdown fixed bg-[#141414] border border-white/10 rounded-2xl p-2.5 shadow-2xl z-50 w-72 max-h-72 flex flex-col gap-2 animate-fade-in';
        menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        menu.style.left = `${rect.left}px`;

        const search = document.createElement('input');
        search.type = 'text';
        search.placeholder = 'Search harness models...';
        search.className = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-primary/50';
        const listEl = document.createElement('div');
        listEl.className = 'flex flex-col gap-1 overflow-y-auto custom-scrollbar max-h-52';

        const renderList = (q = '') => {
            harnessCtrl.renderModelDropdown({
                listEl,
                filter: q,
                onSelect: (m) => {
                    harnessModelLabel.textContent = m?.name || m?.id || 'Harness Model';
                    menu.remove();
                },
            });
        };
        renderList();
        search.onclick = (ev) => ev.stopPropagation();
        search.oninput = (ev) => renderList(ev.target.value);

        menu.appendChild(search);
        menu.appendChild(listEl);

        const closeHandler = (ev) => {
            if (!menu.contains(ev.target) && ev.target !== harnessModelBtn) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
        document.body.appendChild(menu);
    };

    settingsToolbar.appendChild(harnessCtrl.switcher);
    settingsToolbar.appendChild(harnessCtrl.harnessWrap);
    settingsToolbar.appendChild(harnessModelBtn);
    settingsToolbar.appendChild(kindToggleWrap);

    // Helper: Create Dropdown
    const createDropdown = (items, selected, onSelect, trigger) => {
        const existing = document.querySelectorAll('.custom-dropdown');
        existing.forEach(el => el.remove());

        const rect = trigger.getBoundingClientRect();
        const menu = document.createElement('div');
        menu.className = 'custom-dropdown fixed bg-[#1a1a1a] border border-white/10 rounded-xl py-1 shadow-2xl z-50 flex flex-col min-w-[100px] animate-fade-in';
        menu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        menu.style.left = rect.left + 'px';

        items.forEach(item => {
            const btn = document.createElement('button');
            btn.className = `px-3 py-2 text-xs font-bold text-left hover:bg-white/10 transition-colors ${item === selected ? 'text-primary' : 'text-white'}`;
            btn.textContent = item;
            btn.onclick = (e) => {
                e.stopPropagation();
                onSelect(item);
                menu.remove();
            };
            menu.appendChild(btn);
        });

        const closeHandler = (e) => {
            if (!menu.contains(e.target) && e.target !== trigger) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
        document.body.appendChild(menu);
    };

    // Aspect Ratio
    const arBtn = document.createElement('button');
    arBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-white/50 hover:text-white transition-colors bg-white/5 hover:bg-white/10 rounded-lg border border-white/5';
    const updateArBtn = () => {
        arBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="2" ry="2"/></svg> ${currentSettings.aspect_ratio}`;
    };
    updateArBtn();
    arBtn.onclick = () => {
        createDropdown(['16:9', '21:9', '9:16', '1:1', '4:5'], currentSettings.aspect_ratio, (val) => {
            currentSettings.aspect_ratio = val;
            updateArBtn();
        }, arBtn);
    };
    settingsToolbar.appendChild(arBtn);

    // Resolution
    const resBtn = document.createElement('button');
    resBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-white/50 hover:text-white transition-colors bg-white/5 hover:bg-white/10 rounded-lg border border-white/5';
    const updateResBtn = (val) => {
        resBtn.dataset.value = val || '2K';
        resBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> ${resBtn.dataset.value}`;
    };
    updateResBtn('2K');
    resBtn.onclick = () => {
        createDropdown(['1K', '2K', '4K'], resBtn.dataset.value, (val) => { updateResBtn(val); }, resBtn);
    };
    settingsToolbar.appendChild(resBtn);
    
    // Camera Builder Toggle Button
    const cameraBuilderBtn = document.createElement('button');
    cameraBuilderBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-white/50 hover:text-white transition-colors bg-white/5 hover:bg-white/10 rounded-lg border border-white/5';
    cameraBuilderBtn.setAttribute('data-tooltip', t('cinema.builderTooltip'));
    cameraBuilderBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg> Builder`;
    settingsToolbar.appendChild(cameraBuilderBtn);

    leftColumn.appendChild(settingsToolbar);
    promptBar.appendChild(leftColumn);


    // --- RIGHT GROUP (Summary + Generate) ---
    const rightGroup = document.createElement('div');
    rightGroup.className = 'flex items-center gap-2 h-full self-end mb-1';

    // Summary Card (Triggers Overlay)
    const summaryCard = document.createElement('button');
    // Removed 'hidden' class, added 'flex' and refined width constraints for mobile
    summaryCard.className = 'flex flex-col items-start justify-center px-4 py-2 bg-[#2a2a2a] rounded-xl border border-white/5 hover:border-white/20 transition-colors text-left flex-1 min-w-[100px] md:min-w-[140px] max-w-[240px] h-[56px] relative group overflow-hidden';
    summaryCard.setAttribute('data-tooltip', t('cinema.cameraSettings'));

    // Dot indicator
    const dot = document.createElement('div');
    dot.className = 'absolute top-2 right-2 w-2 h-2 bg-primary rounded-full shadow-glow-sm';
    summaryCard.appendChild(dot);

    const summaryTitle = document.createElement('span');
    summaryTitle.className = 'text-[10px] font-bold text-white uppercase truncate w-full tracking-wide';
    summaryTitle.textContent = currentSettings.camera;

    const summaryValue = document.createElement('span');
    summaryValue.className = 'text-[10px] font-medium text-white/60 truncate w-full';
    summaryValue.textContent = formatSummaryValue();

    summaryCard.appendChild(summaryTitle);
    summaryCard.appendChild(summaryValue);

    summaryCard.onclick = openOverlay;

    function formatSummaryValue() {
        return `${currentSettings.lens}, ${currentSettings.focal}mm, ${currentSettings.aperture}`;
    }

    function updateSummaryCard() {
        summaryTitle.textContent = currentSettings.camera;
        summaryValue.textContent = formatSummaryValue();
    }

    // Generate Button
    const generateBtn = document.createElement('button');
    generateBtn.className = 'h-[56px] px-8 bg-[#22d3ee] text-black rounded-xl font-black text-xs uppercase hover:bg-white transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed';
    generateBtn.setAttribute('data-tooltip', 'Generate cinema shot');
    generateBtn.innerHTML = t('cinema.generateBtn');

    rightGroup.appendChild(summaryCard);
    rightGroup.appendChild(generateBtn);
    promptBar.appendChild(rightGroup);

    harnessCtrl.errorBanner.classList.replace('mt-3', 'mt-0');
    harnessCtrl.outputPanel.classList.replace('mt-4', 'mt-0');
    harnessCtrl.outputPanel.querySelector('.harness-run-log')?.classList.replace('max-h-72', 'max-h-40');
    promptBarWrapper.appendChild(harnessCtrl.errorBanner);
    promptBarWrapper.appendChild(harnessCtrl.outputPanel);
    promptBarWrapper.appendChild(promptBar);
    container.appendChild(promptBarWrapper);

    // ==========================================
    // 3B. CAMERA BUILDER PANEL (Collapsible)
    // ==========================================
    const cameraBuilderPanel = document.createElement('div');
    cameraBuilderPanel.className = 'absolute bottom-8 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-4xl z-20';
    cameraBuilderPanel.style.display = 'none'; // Hidden by default
    
    const builderCard = document.createElement('div');
    builderCard.className = 'bg-[#1a1a1a] border border-white/10 rounded-2xl p-4 shadow-3xl';
    
    builderCard.innerHTML = `
        <div class="flex items-center justify-between mb-4">
            <h4 class="text-xs font-bold text-white">${t('cinema.cameraBuilder')}</h4>
            <button id="close-builder-btn" class="text-white/40 hover:text-white transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div class="flex flex-col gap-1.5">
                <label class="text-[10px] font-bold text-muted uppercase">${t('cinema.camera')}</label>
                <select id="builder-camera" class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50">
                    ${Object.keys(CAMERA_MAP).map(c => `<option value="${c}" ${c === currentSettings.camera ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            </div>
            <div class="flex flex-col gap-1.5">
                <label class="text-[10px] font-bold text-muted uppercase">${t('cinema.lens')}</label>
                <select id="builder-lens" class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50">
                    ${Object.keys(LENS_MAP).map(l => `<option value="${l}" ${l === currentSettings.lens ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
            </div>
            <div class="flex flex-col gap-1.5">
                <label class="text-[10px] font-bold text-muted uppercase">${t('cinema.focal')}</label>
                <select id="builder-focal" class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50">
                    ${Object.keys(FOCAL_PERSPECTIVE).map(f => `<option value="${f}" ${f === currentSettings.focal ? 'selected' : ''}>${f}mm</option>`).join('')}
                </select>
            </div>
            <div class="flex flex-col gap-1.5">
                <label class="text-[10px] font-bold text-muted uppercase">${t('cinema.aperture')}</label>
                <select id="builder-aperture" class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50">
                    ${Object.keys(APERTURE_EFFECT).map(a => `<option value="${a}" ${a === currentSettings.aperture ? 'selected' : ''}>${a}</option>`).join('')}
                </select>
            </div>
        </div>

        <div class="flex flex-col gap-2">
            <label class="text-[10px] font-bold text-muted uppercase">${t('cinema.preview')}</label>
            <div id="builder-preview" class="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-xs min-h-[40px]"></div>
            <button id="apply-builder-btn" class="px-4 py-2 bg-primary text-black rounded-lg text-xs font-bold hover:shadow-glow transition-all">
                ${t('cinema.useSetup')}
            </button>
        </div>
    `;
    
    cameraBuilderPanel.appendChild(builderCard);
    container.appendChild(cameraBuilderPanel);
    
    // Camera Builder toggle logic
    cameraBuilderBtn.onclick = () => {
        showCameraBuilder = !showCameraBuilder;
        cameraBuilderPanel.style.display = showCameraBuilder ? 'block' : 'none';
        if (showCameraBuilder) updateBuilderPreview();
    };
    
    const closeBuilderBtn = cameraBuilderPanel.querySelector('#close-builder-btn');
    if (closeBuilderBtn) closeBuilderBtn.onclick = () => {
        showCameraBuilder = false;
        cameraBuilderPanel.style.display = 'none';
    };
    
    // Update builder preview
    const updateBuilderPreview = () => {
        const camera = builderCard.querySelector('#builder-camera')?.value || currentSettings.camera;
        const lens = builderCard.querySelector('#builder-lens')?.value || currentSettings.lens;
        const focal = parseInt(builderCard.querySelector('#builder-focal')?.value || currentSettings.focal);
        const aperture = builderCard.querySelector('#builder-aperture')?.value || currentSettings.aperture;
        
        const preview = buildNanoBananaPrompt('', camera, lens, focal, aperture);
        const previewEl = builderCard.querySelector('#builder-preview');
        if (previewEl) {
            previewEl.textContent = preview || t('cinema.selectSettings');
        }
    };
    
    // Builder event listeners
    const builderCamera = builderCard.querySelector('#builder-camera');
    const builderLens = builderCard.querySelector('#builder-lens');
    const builderFocal = builderCard.querySelector('#builder-focal');
    const builderAperture = builderCard.querySelector('#builder-aperture');
    
    if (builderCamera) builderCamera.onchange = updateBuilderPreview;
    if (builderLens) builderLens.onchange = updateBuilderPreview;
    if (builderFocal) builderFocal.onchange = updateBuilderPreview;
    if (builderAperture) builderAperture.onchange = updateBuilderPreview;
    
    const applyBuilderBtn = builderCard.querySelector('#apply-builder-btn');
    if (applyBuilderBtn) {
        applyBuilderBtn.onclick = () => {
            currentSettings.camera = builderCamera?.value || currentSettings.camera;
            currentSettings.lens = builderLens?.value || currentSettings.lens;
            currentSettings.focal = parseInt(builderFocal?.value || currentSettings.focal);
            currentSettings.aperture = builderAperture?.value || currentSettings.aperture;
            updateSummaryCard();
            showCameraBuilder = false;
            cameraBuilderPanel.style.display = 'none';
        };
    }


    // ==========================================
    // 3. HISTORY SIDEBAR
    // ==========================================
    const generationHistory = [];

    // History Sidebar - VISIBLE BY DEFAULT (removed translate-x-full opacity-0)
    const historySidebar = document.createElement('div');
    historySidebar.className = 'fixed right-0 top-0 h-full w-20 md:w-24 bg-black/60 backdrop-blur-xl border-l border-white/5 z-50 flex flex-col items-center py-4 gap-3 overflow-y-auto transition-all duration-500';

    const historyLabel = document.createElement('div');
    historyLabel.className = 'text-[9px] font-bold text-white/40 uppercase tracking-widest mb-2';
    historyLabel.textContent = t('cinema.history');
    historySidebar.appendChild(historyLabel);

    const historyList = document.createElement('div');
    historyList.className = 'flex flex-col gap-2 w-full px-2';
    historySidebar.appendChild(historyList);

    container.appendChild(historySidebar);

    // ==========================================
    // 4. CANVAS AREA (Result View)
    // ==========================================
    const canvas = document.createElement('div');
    canvas.className = 'absolute inset-0 flex flex-col items-center justify-center p-4 min-[800px]:p-16 z-30 opacity-0 pointer-events-none transition-all duration-1000 translate-y-10 scale-95 bg-black/90 backdrop-blur-3xl';

    const imageContainer = document.createElement('div');
    imageContainer.className = 'relative group max-w-full max-h-[70vh] flex items-center justify-center';

    const resultImg = document.createElement('img');
    resultImg.className = 'max-h-[60vh] max-w-[90vw] rounded-2xl shadow-2xl border border-white/10 object-contain';
    imageContainer.appendChild(resultImg);

    const resultVideo = document.createElement('video');
    resultVideo.className = 'hidden max-h-[60vh] max-w-[90vw] rounded-2xl shadow-2xl border border-white/10 object-contain';
    resultVideo.controls = true;
    resultVideo.loop = true;
    resultVideo.autoplay = true;
    resultVideo.muted = true;
    resultVideo.playsInline = true;
    imageContainer.appendChild(resultVideo);

    canvas.appendChild(imageContainer);

    // Canvas Controls
    const canvasControls = document.createElement('div');
    canvasControls.className = 'mt-8 flex gap-3 opacity-0 transition-opacity delay-500 duration-500 justify-center';

    const createActionBtn = (label, primary = false) => {
        const btn = document.createElement('button');
        btn.className = primary
            ? 'bg-[#22d3ee] text-black px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide hover:bg-white transition-colors shadow-glow-sm hover:scale-105 active:scale-95'
            : 'bg-white/10 hover:bg-white/20 px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide transition-all border border-white/5 backdrop-blur-lg text-white hover:border-white/20';
        btn.textContent = label;
        return btn;
    };

    const regenerateBtn = createActionBtn(t('cinema.regenerate'));
    const downloadBtn = createActionBtn(t('cinema.download'), true);
    const newPromptBtn = createActionBtn(t('cinema.newShot'));

    canvasControls.appendChild(regenerateBtn);
    canvasControls.appendChild(downloadBtn);
    canvasControls.appendChild(newPromptBtn);
    canvas.appendChild(canvasControls);

    container.appendChild(canvas);

    // --- History Logic ---
    const renderHistory = () => {
        historyList.innerHTML = '';
        generationHistory.forEach((entry, idx) => {
            const thumb = document.createElement('div');
            thumb.className = `relative group/thumb cursor-pointer rounded-lg overflow-hidden border-2 transition-all duration-300 aspect-square ${idx === 0 ? 'border-[#22d3ee] shadow-glow-sm' : 'border-white/10 hover:border-white/30'}`;

            const isVideoEntry = entry.mediaType === 'video' || /\.webm(?:\?|$)|\.mp4(?:\?|$)/i.test(entry.url || '');
            if (isVideoEntry) {
                const vid = document.createElement('video');
                vid.src = entry.url;
                vid.muted = true;
                vid.playsInline = true;
                vid.className = 'w-full h-full object-cover opacity-80 group-hover/thumb:opacity-100 transition-opacity';
                const overlay = document.createElement('div');
                overlay.className = 'absolute inset-0 bg-black/50 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center';
                const lbl = document.createElement('span');
                lbl.className = 'text-[8px] font-bold text-white uppercase';
                lbl.textContent = t('cinema.load');
                overlay.appendChild(lbl);
                thumb.appendChild(vid);
                thumb.appendChild(overlay);
            } else {
                const { media, overlay } = createHistoryImageWithLabel({
                    document,
                    url: entry.url,
                    mediaClassName: 'w-full h-full object-cover opacity-80 group-hover/thumb:opacity-100 transition-opacity',
                    overlayClassName: 'absolute inset-0 bg-black/50 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center',
                    labelClassName: 'text-[8px] font-bold text-white uppercase',
                    label: t('cinema.load'),
                });
                thumb.appendChild(media);
                thumb.appendChild(overlay);
            }

            thumb.onclick = () => loadHistoryItem(entry, thumb);
            historyList.appendChild(thumb);
        });
    };

    const addToHistory = (entry) => {
        generationHistory.unshift(entry);
        localStorage.setItem('cinema_history', JSON.stringify(generationHistory.slice(0, 50)));
        renderHistory();
    };

    const loadHistoryItem = (entry, thumbElement) => {
        // Restore Settings
        if (entry.settings) {
            currentSettings.camera = entry.settings.camera;
            currentSettings.lens = entry.settings.lens;
            currentSettings.focal = entry.settings.focal;
            currentSettings.aperture = entry.settings.aperture;
            currentSettings.aspect_ratio = entry.settings.aspect_ratio;

            // Update UI elements
            textarea.value = entry.settings.prompt || '';
            textarea.oninput();
            updateSummaryCard();
            updateArBtn();
            updateResBtn(entry.settings.resolution || '2K');
        }

        const isVideoEntry = entry.mediaType === 'video' || /\.webm(?:\?|$)|\.mp4(?:\?|$)/i.test(entry.url || '');
        showCanvas(entry.url, isVideoEntry ? 'video' : 'image');

        // Highlight active history item
        if (thumbElement) {
            historyList.querySelectorAll('div').forEach(t => {
                t.classList.remove('border-[#22d3ee]', 'shadow-glow-sm');
                t.classList.add('border-white/10');
            });
            thumbElement.classList.remove('border-white/10');
            thumbElement.classList.add('border-[#22d3ee]', 'shadow-glow-sm');
        }
    };

    const showCanvas = (url, mediaType = 'image') => {
        const isVideo = mediaType === 'video' || /\.webm(?:\?|$)|\.mp4(?:\?|$)/i.test(url || '');
        if (isVideo) {
            resultImg.classList.add('hidden');
            resultImg.removeAttribute('src');
            resultVideo.classList.remove('hidden');
            resultVideo.src = url;
            resultVideo.load?.();
        } else {
            try { resultVideo.pause?.(); } catch { /* ignore */ }
            resultVideo.classList.add('hidden');
            resultVideo.removeAttribute('src');
            resultImg.classList.remove('hidden');
            resultImg.src = url;
        }

        // Hide Input UI
        heroSection.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
        promptBarWrapper.classList.add('opacity-0', 'pointer-events-none', 'translate-y-20');

        // Show Canvas
        canvas.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10', 'scale-95');
        canvas.classList.add('opacity-100', 'translate-y-0', 'scale-100');
        canvasControls.classList.remove('opacity-0');
        canvasControls.classList.add('opacity-100');
    };

    const resetToPrompt = () => {
        try { resultVideo.pause?.(); } catch { /* ignore */ }
        // Hide Canvas
        canvas.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10', 'scale-95');
        canvas.classList.remove('opacity-100', 'translate-y-0', 'scale-100');

        // Show Input UI
        heroSection.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
        promptBarWrapper.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-20');
        harnessCtrl.clearError();

        // Clear prompt for new shot?
        textarea.value = '';
        textarea.oninput();
        textarea.focus();
    };

    // Load saved history
    try {
        const saved = JSON.parse(localStorage.getItem('cinema_history') || '[]');
        if (saved.length > 0) {
            saved.forEach(e => generationHistory.push(e));
            renderHistory();
        }
    } catch (e) { }

    // Actions
    newPromptBtn.onclick = resetToPrompt;

    regenerateBtn.onclick = () => {
        resetToPrompt();
        setTimeout(() => {
            generateBtn.click();
        }, 300);
    };

    downloadBtn.onclick = async () => {
        const isVid = !resultVideo.classList.contains('hidden') && resultVideo.src;
        const targetUrl = isVid ? resultVideo.src : resultImg.src;
        const ext = isVid ? (/\.mp4(?:\?|$)/i.test(targetUrl) ? 'mp4' : 'webm') : 'jpg';
        try {
            const response = await fetch(targetUrl);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `cinema-shot-${Date.now()}.${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        } catch (err) {
            window.open(targetUrl, '_blank');
        }
    };

    // ==========================================
    // 5. GENERATION LOGIC UPDATE
    // ==========================================
    generateBtn.onclick = async () => {
        harnessCtrl.clearError();
        const basePrompt = textarea.value.trim();
        if (!basePrompt) return;

        // Compile Prompt with Cinema Studio camera & lens settings
        const finalPrompt = buildNanoBananaPrompt(
            basePrompt,
            currentSettings.camera,
            currentSettings.lens,
            currentSettings.focal,
            currentSettings.aperture
        );
        const resLabel = resBtn.dataset.value || '2K';

        if (harnessCtrl.getMode() === 'harness') {
            generateBtn.disabled = true;
            generateBtn.innerHTML = t('cinema.shooting');
            try {
                await harnessCtrl.runPrompt({
                    prompt: `${finalPrompt}\nTarget resolution: ${resLabel}`,
                    aspectRatio: currentSettings.aspect_ratio,
                    kind: cinemaHarnessKind,
                    onMediaReady: ({ url, mediaType, model }) => {
                        const resolvedType = mediaType === 'video' || /\.webm(?:\?|$)|\.mp4(?:\?|$)/i.test(url || '') ? 'video' : 'image';
                        addToHistory({
                            url,
                            mediaType: resolvedType,
                            timestamp: Date.now(),
                            settings: {
                                prompt: basePrompt,
                                ...currentSettings,
                                resolution: resLabel,
                                model,
                            },
                        });
                        showCanvas(url, resolvedType);
                    },
                });
            } catch (e) {
                console.error(e);
                harnessCtrl.showError(e);
            } finally {
                generateBtn.disabled = false;
                generateBtn.innerHTML = t('cinema.generateBtn');
            }
            return;
        }

        const apiKey = localStorage.getItem('muapi_key');
        if (!apiKey) {
            AuthModal(() => generateBtn.click());
            return;
        }

        generateBtn.disabled = true;
        generateBtn.innerHTML = t('cinema.shooting');

        try {
            const res = await muapi.generateImage({
                model: 'nano-banana-pro',
                prompt: finalPrompt,
                aspect_ratio: currentSettings.aspect_ratio,
                resolution: (resBtn.dataset.value || '1k').toLowerCase(),
                negative_prompt: "blurry, low quality, distortion, bad composition"
            });

            if (res && res.url) {
                // Save to history
                addToHistory({
                    url: res.url,
                    mediaType: 'image',
                    timestamp: Date.now(),
                    settings: {
                        prompt: basePrompt,
                        ...currentSettings,
                        resolution: resLabel
                    }
                });

                showCanvas(res.url, 'image');
            } else {
                throw new Error('No Data');
            }

        } catch (e) {
            console.error(e);
            harnessCtrl.showError(e);
        } finally {
            generateBtn.disabled = false;
            generateBtn.innerHTML = t('cinema.generateBtn');
        }
    };

    return container;
}
