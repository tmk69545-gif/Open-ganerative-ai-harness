import { t } from '../lib/i18n.js';
import { harnessClient, isHarnessAvailable } from '../lib/harnessClient.js';

export function McpCliStudio() {
    const container = document.createElement('div');
    container.className = 'w-full h-full overflow-y-auto bg-app-bg text-white custom-scrollbar';

    const inner = document.createElement('div');
    inner.className = 'max-w-5xl mx-auto px-5 md:px-8 py-6 flex flex-col gap-6';
    container.appendChild(inner);

    // ─── Left-Aligned Workbench Header ────────────────────────────────────────
    const header = document.createElement('header');
    header.className = 'flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-white/10';
    header.innerHTML = `
        <div class="flex flex-col gap-1.5 min-w-0">
            <div class="flex items-center gap-2.5 flex-wrap">
                <h1 class="text-xl md:text-2xl font-semibold tracking-tight text-white">${t('mcp.title')}</h1>
                <span id="harness-os-pill" class="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px] font-mono text-white/65 tabular-nums">...</span>
            </div>
            <p class="text-sm text-secondary max-w-2xl">${t('mcp.subtitle')}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0 flex-wrap">
            <div class="inline-flex rounded-lg border border-white/10 bg-panel-bg p-0.5">
                <button id="tab-workbench" type="button" class="px-3 py-1.5 rounded-md text-xs font-medium bg-white/10 text-white transition-colors">Workbench</button>
                <button id="tab-reference" type="button" class="px-3 py-1.5 rounded-md text-xs font-medium text-white/55 hover:text-white transition-colors">CLI & MCP Reference</button>
            </div>
            <button id="harness-refresh-btn" type="button" class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-white/80 transition-colors">${t('harness.refresh')}</button>
            <button id="harness-connect-all-btn" type="button" class="px-3.5 py-1.5 rounded-lg bg-primary text-black text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40">${t('harness.connectAll')}</button>
            <button id="harness-skills-btn" type="button" class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-white/80 transition-colors disabled:opacity-40">${t('harness.installSkills')}</button>
        </div>
    `;
    inner.appendChild(header);

    const statusBanner = document.createElement('div');
    statusBanner.className = 'hidden text-xs rounded-lg px-3.5 py-2.5 border';
    inner.appendChild(statusBanner);

    // ─── View 1: Workbench ────────────────────────────────────────────────────
    const workbenchView = document.createElement('div');
    workbenchView.className = 'flex flex-col gap-6';
    inner.appendChild(workbenchView);

    const harnessSection = document.createElement('section');
    harnessSection.className = 'flex flex-col gap-3';
    harnessSection.innerHTML = `
        <div class="flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold text-white/90">${t('harness.sectionTitle')}</h2>
            <span id="harness-summary" class="text-xs font-mono text-secondary tabular-nums">${t('harness.scanning')}</span>
        </div>
        <div id="harness-grid" class="grid md:grid-cols-2 gap-4"></div>
    `;
    workbenchView.appendChild(harnessSection);

    const runnerSection = document.createElement('section');
    runnerSection.className = 'rounded-xl border border-white/10 bg-panel-bg p-4 md:p-5 flex flex-col gap-4';
    runnerSection.innerHTML = `
        <div class="flex items-center justify-between gap-2">
            <h2 class="text-sm font-semibold text-white/90">${t('harness.runnerTitle')}</h2>
            <button id="runner-clear-btn" type="button" class="hidden text-xs text-white/50 hover:text-white transition-colors">Clear</button>
        </div>
        <div class="grid md:grid-cols-3 gap-3">
            <label class="flex flex-col gap-1.5">
                <span class="text-xs font-medium text-white/65">CLI harness</span>
                <select id="runner-harness" class="w-full bg-card-bg border border-white/10 rounded-lg px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-primary/50"></select>
            </label>
            <label class="flex flex-col gap-1.5">
                <span class="text-xs font-medium text-white/65">Execution mode</span>
                <select id="runner-mode" class="w-full bg-card-bg border border-white/10 rounded-lg px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-primary/50">
                    <option value="plan">Safe / Plan</option>
                    <option value="auto">Standard workspace</option>
                </select>
            </label>
            <label class="flex flex-col gap-1.5">
                <span class="text-xs font-medium text-white/65">Working directory</span>
                <div class="flex gap-2">
                    <input id="runner-cwd" type="text" placeholder="Default: workspace root" class="flex-1 min-w-0 bg-card-bg border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/35 focus:outline-none focus:border-primary/50" />
                    <button id="runner-browse-cwd" type="button" class="px-2.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-white/80 transition-colors">Browse</button>
                </div>
            </label>
        </div>
        <textarea id="runner-prompt" rows="3" placeholder="Enter a task or prompt to run through the selected CLI harness..." class="w-full bg-card-bg border border-white/10 rounded-lg p-3 text-sm text-white placeholder-white/35 focus:outline-none focus:border-primary/50 resize-y"></textarea>
        <div class="flex items-center justify-between gap-3 flex-wrap">
            <label class="flex items-center gap-2 text-xs text-white/65 cursor-pointer">
                <input id="runner-auto-approve" type="checkbox" class="rounded border-white/20 bg-card-bg" />
                <span>Auto-approve tool permissions</span>
            </label>
            <div class="flex items-center gap-2">
                <button id="runner-cancel-btn" type="button" class="hidden px-3.5 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-medium hover:bg-red-500/25 transition-colors">Cancel</button>
                <button id="runner-run-btn" type="button" class="px-4 py-2 rounded-lg bg-primary text-black text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40">${t('harness.runBtn')}</button>
            </div>
        </div>
        <pre id="runner-output" class="hidden text-xs font-mono text-white/85 bg-card-bg border border-white/10 rounded-lg p-3.5 max-h-80 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed"></pre>
    `;
    workbenchView.appendChild(runnerSection);

    // ─── View 2: CLI & MCP Reference ──────────────────────────────────────────
    const referenceView = document.createElement('div');
    referenceView.className = 'hidden flex-col gap-6';
    referenceView.innerHTML = `
        <section class="rounded-xl border border-white/10 bg-panel-bg p-5 flex flex-col gap-4">
            <h2 class="text-sm font-semibold text-white/90">${t('mcp.quickStart')}</h2>
            <div class="grid md:grid-cols-3 gap-3">
                ${quickStep('1', 'Detect installed harnesses', 'npx open-generative-ai harness detect')}
                ${quickStep('2', 'Configure MuAPI MCP', 'npx open-generative-ai harness configure all')}
                ${quickStep('3', 'Run headless prompt', 'npx open-generative-ai harness run claude "prompt"')}
            </div>
        </section>
        <section id="ref-cards" class="grid md:grid-cols-3 gap-4"></section>
        <section class="rounded-xl border border-white/10 bg-panel-bg p-5 flex flex-col gap-3">
            <h2 class="text-sm font-semibold text-white/90">Usage examples</h2>
            <div class="grid md:grid-cols-2 gap-3">
                ${exampleBlock('Image generation', 'muapi image generate "mountain lake at sunrise" --model flux-dev --download ./outputs')}
                ${exampleBlock('Text-to-video', 'muapi video generate "dog running on a beach" --model kling-master')}
                ${exampleBlock('Audio creation', 'muapi audio create "ambient electronic synth"')}
                ${exampleBlock('Run a skill', 'bash library/visual/nano-banana/scripts/generate-nano-art.sh --file image.jpg --view')}
            </div>
        </section>
    `;
    inner.appendChild(referenceView);

    const refCards = referenceView.querySelector('#ref-cards');
    refCards.appendChild(featureCard({
        tag: 'CLI',
        title: 'muapi-cli',
        body: 'Generate images, videos, and audio from the terminal with human output or --output-json for automation.',
        code: 'npm install -g muapi-cli\nmuapi auth login\nmuapi image generate "a cyberpunk city" --model flux-dev',
        link: 'https://github.com/SamurAIGPT/muapi-cli',
    }));
    refCards.appendChild(featureCard({
        tag: 'MCP',
        title: 'muapi-mcp-server',
        body: 'Connect Antigravity, Claude, OpenCode, Codex, or Cursor to 100+ generative models via https://api.muapi.ai/mcp.',
        code: 'claude mcp add --transport http muapi https://api.muapi.ai/mcp \\\n  --header "Authorization: Bearer YOUR_KEY"',
        link: 'https://github.com/SamurAIGPT/muapi-mcp-server',
    }));
    refCards.appendChild(featureCard({
        tag: 'Skills',
        title: 'Generative Media Skills',
        body: 'Install reusable media generation skills and presets for coding agents.',
        code: 'npx skills add SamurAIGPT/muapi-skills --all',
        link: 'https://github.com/SamurAIGPT/muapi-skills',
    }));

    referenceView.querySelectorAll('[data-copy-text]').forEach((btn) => {
        btn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(btn.dataset.copyText);
                const prev = btn.textContent;
                btn.textContent = t('common.copied');
                setTimeout(() => { btn.textContent = prev; }, 1400);
            } catch {
                // clipboard unavailable
            }
        };
    });

    const tabWorkbench = header.querySelector('#tab-workbench');
    const tabReference = header.querySelector('#tab-reference');
    const refreshBtn = header.querySelector('#harness-refresh-btn');
    const connectAllBtn = header.querySelector('#harness-connect-all-btn');
    const skillsBtn = header.querySelector('#harness-skills-btn');
    const osPill = header.querySelector('#harness-os-pill');
    const summaryEl = harnessSection.querySelector('#harness-summary');
    const gridEl = harnessSection.querySelector('#harness-grid');

    const runnerHarnessSel = runnerSection.querySelector('#runner-harness');
    const runnerModeSel = runnerSection.querySelector('#runner-mode');
    const runnerCwdInput = runnerSection.querySelector('#runner-cwd');
    const runnerBrowseBtn = runnerSection.querySelector('#runner-browse-cwd');
    const runnerPromptInput = runnerSection.querySelector('#runner-prompt');
    const runnerAutoApprove = runnerSection.querySelector('#runner-auto-approve');
    const runnerRunBtn = runnerSection.querySelector('#runner-run-btn');
    const runnerCancelBtn = runnerSection.querySelector('#runner-cancel-btn');
    const runnerClearBtn = runnerSection.querySelector('#runner-clear-btn');
    const runnerOutputEl = runnerSection.querySelector('#runner-output');

    const switchView = (view) => {
        const isWorkbench = view === 'workbench';
        workbenchView.classList.toggle('hidden', !isWorkbench);
        workbenchView.classList.toggle('flex', isWorkbench);
        referenceView.classList.toggle('hidden', isWorkbench);
        referenceView.classList.toggle('flex', !isWorkbench);

        tabWorkbench.className = `px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${isWorkbench ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white'}`;
        tabReference.className = `px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${!isWorkbench ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white'}`;

        [refreshBtn, connectAllBtn, skillsBtn].forEach((b) => {
            b.classList.toggle('hidden', !isWorkbench);
        });
    };

    tabWorkbench.onclick = () => switchView('workbench');
    tabReference.onclick = () => switchView('reference');

    let activeRunId = null;

    const showBanner = (msg, kind = 'info') => {
        statusBanner.textContent = msg;
        statusBanner.className = `text-xs rounded-lg px-3.5 py-2.5 border ${
            kind === 'error'
                ? 'bg-red-500/10 border-red-500/30 text-red-300'
                : 'bg-primary/10 border-primary/25 text-primary'
        }`;
    };

    const renderSurfaceRow = (label, surface, harnessId) => {
        if (!surface) return '';
        const badge = surface.installed
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono font-medium tabular-nums">${surface.version ? `v${escapeHtml(surface.version)}` : t('harness.installed')}</span>`
            : `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/40 text-[11px] font-medium">${t('harness.notDetected')}</span>`;
        const extra = surface.extensions?.length
            ? `<span class="text-[11px] font-mono text-white/45 truncate">${escapeHtml(surface.extensions.map((e) => `${e.ide} ${e.version || ''}`).join(' · '))}</span>`
            : '';
        const pathText = surface.path
            ? `<div class="text-[11px] font-mono text-white/45 truncate mt-0.5" title="${escapeHtml(surface.path)}">${escapeHtml(surface.path)}</div>`
            : '';

        return `
            <div class="flex items-start justify-between gap-3 py-2 border-b border-white/5 last:border-none">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-medium text-white/85">${label}</span>
                        ${extra}
                    </div>
                    ${pathText}
                </div>
                <div class="flex items-center gap-1.5 shrink-0 pt-0.5">
                    ${badge}
                    ${isHarnessAvailable() ? `<button type="button" data-override-harness="${harnessId}" data-override-surface="${surface.surface}" title="${t('harness.setPath')}" class="px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-[11px] text-white/55 hover:text-white hover:bg-white/10 transition-colors">${t('harness.setPath')}</button>` : ''}
                </div>
            </div>
        `;
    };

    const renderHarnesses = (report) => {
        osPill.textContent = `${report.os}/${report.arch}`;
        summaryEl.textContent = `${report.summary.installedHarnesses}/${report.summary.totalHarnesses} installed · ${report.summary.cliReadyCount} CLI · ${report.summary.mcpConfiguredCount} MCP`;

        gridEl.innerHTML = '';
        runnerHarnessSel.innerHTML = '';

        for (const h of report.harnesses) {
            const card = document.createElement('div');
            card.className = 'rounded-xl border border-white/10 bg-panel-bg p-4 flex flex-col gap-3';

            const mcpBadge = h.config.mcpConfigured
                ? `<span class="px-2 py-0.5 rounded-md bg-primary/10 border border-primary/25 text-primary text-[11px] font-medium shrink-0">${t('harness.mcpConnected')}</span>`
                : `<span class="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/50 text-[11px] font-medium shrink-0">${t('harness.mcpNotSet')}</span>`;

            card.innerHTML = `
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="w-1.5 h-1.5 rounded-full shrink-0 ${h.installed ? 'bg-emerald-400' : 'bg-white/25'}"></span>
                        <h3 class="text-sm font-semibold text-white truncate">${escapeHtml(h.name)}</h3>
                        <span class="text-xs text-white/45">${escapeHtml(h.vendor)}</span>
                    </div>
                    ${mcpBadge}
                </div>
                <div class="rounded-lg border border-white/5 bg-card-bg px-3">
                    ${renderSurfaceRow('Desktop', h.surfaces.desktop, h.id)}
                    ${renderSurfaceRow('CLI', h.surfaces.cli, h.id)}
                    ${renderSurfaceRow('IDE', h.surfaces.ide, h.id)}
                </div>
                <div class="text-[11px] font-mono text-white/45 truncate" title="${escapeHtml(h.config.primaryPath || '')}">
                    Config: ${escapeHtml(h.config.primaryPath || 'n/a')}
                </div>
                <div class="flex items-center gap-2 pt-1 mt-auto">
                    <button type="button" data-connect-mcp="${h.id}" data-action="${h.config.mcpConfigured ? 'unconfigure' : 'configure'}" class="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        h.config.mcpConfigured
                            ? 'bg-white/5 border-white/10 text-white/75 hover:bg-red-500/15 hover:text-red-300'
                            : 'bg-primary/15 border-primary/30 text-primary hover:bg-primary/25'
                    }">
                        ${h.config.mcpConfigured ? t('harness.disconnectMcp') : t('harness.connectMcp')}
                    </button>
                    ${h.canRun ? `<button type="button" data-select-runner="${h.id}" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-white/75 hover:text-white hover:bg-white/10 transition-colors">${t('harness.useRunner')}</button>` : ''}
                </div>
            `;
            gridEl.appendChild(card);

            const opt = document.createElement('option');
            opt.value = h.id;
            opt.disabled = !h.canRun;
            const cliVer = h.surfaces?.cli?.version ? ` (v${h.surfaces.cli.version})` : '';
            opt.textContent = h.canRun ? `${h.name} CLI${cliVer}` : `${h.name} CLI (${t('harness.notDetected')})`;
            opt.className = 'bg-[#111] text-white';
            runnerHarnessSel.appendChild(opt);
        }

        const firstRunnable = report.harnesses.find((h) => h.canRun);
        if (firstRunnable) runnerHarnessSel.value = firstRunnable.id;

        gridEl.querySelectorAll('[data-connect-mcp]').forEach((btn) => {
            btn.onclick = async () => {
                const harnessId = btn.dataset.connectMcp;
                const action = btn.dataset.action;
                btn.disabled = true;
                try {
                    const apiKey = localStorage.getItem('muapi_key') || '';
                    const res = await harnessClient.configure({ harnessId, action, apiKey });
                    const updated = res.results?.map((r) => r.configPath).join(', ');
                    showBanner(`${action === 'unconfigure' ? 'Removed' : 'Updated'} MuAPI MCP in ${updated}`);
                    await refreshHarnesses();
                } catch (err) {
                    showBanner(err.message, 'error');
                } finally {
                    btn.disabled = false;
                }
            };
        });

        gridEl.querySelectorAll('[data-select-runner]').forEach((btn) => {
            btn.onclick = () => {
                runnerHarnessSel.value = btn.dataset.selectRunner;
                runnerPromptInput.focus();
            };
        });

        gridEl.querySelectorAll('[data-override-harness]').forEach((btn) => {
            btn.onclick = async () => {
                const harnessId = btn.dataset.overrideHarness;
                const surface = btn.dataset.overrideSurface;
                const picked = await harnessClient.pickPath({ title: `Select ${harnessId} ${surface} executable` });
                if (!picked) return;
                await harnessClient.setOverride({ harnessId, surface, value: picked });
                await refreshHarnesses();
            };
        });
    };

    const refreshHarnesses = async () => {
        if (!isHarnessAvailable()) {
            osPill.textContent = 'browser';
            summaryEl.textContent = 'Desktop/CLI detection disabled in plain browser';
            gridEl.innerHTML = `
                <div class="md:col-span-2 rounded-xl border border-white/10 bg-panel-bg p-4 flex flex-col gap-2 text-xs text-white/70">
                    <p>Host detection and CLI execution require the Electron desktop app, local Next.js server, or terminal CLI:</p>
                    <pre class="text-xs font-mono text-primary bg-card-bg border border-white/10 rounded-lg px-3 py-2">npx open-generative-ai harness detect</pre>
                </div>
            `;
            connectAllBtn.disabled = true;
            skillsBtn.disabled = true;
            runnerRunBtn.disabled = true;
            return;
        }
        summaryEl.textContent = t('harness.scanning');
        try {
            const report = await harnessClient.detect();
            if (report) renderHarnesses(report);
        } catch (err) {
            showBanner(`Detection failed: ${err.message}`, 'error');
        }
    };

    refreshBtn.onclick = refreshHarnesses;

    connectAllBtn.onclick = async () => {
        if (!isHarnessAvailable()) return;
        connectAllBtn.disabled = true;
        try {
            const apiKey = localStorage.getItem('muapi_key') || '';
            const res = await harnessClient.configure({ harnessId: 'all', apiKey });
            showBanner(`Configured MuAPI MCP for ${res.results?.length || 0} target(s).`);
            await refreshHarnesses();
        } catch (err) {
            showBanner(err.message, 'error');
        } finally {
            connectAllBtn.disabled = false;
        }
    };

    skillsBtn.onclick = async () => {
        if (!isHarnessAvailable()) return;
        skillsBtn.disabled = true;
        try {
            const res = await harnessClient.installSkills();
            showBanner(res.ok ? 'Installed muapi-skills.' : (res.error || 'Skills install failed'), res.ok ? 'info' : 'error');
        } catch (err) {
            showBanner(err.message, 'error');
        } finally {
            skillsBtn.disabled = false;
        }
    };

    runnerBrowseBtn.onclick = async () => {
        if (!isHarnessAvailable()) return;
        const dir = await harnessClient.pickPath({ directory: true, title: 'Select working directory for harness run' });
        if (dir) runnerCwdInput.value = dir;
    };

    runnerClearBtn.onclick = () => {
        runnerOutputEl.textContent = '';
        runnerOutputEl.classList.add('hidden');
        runnerClearBtn.classList.add('hidden');
    };

    if (isHarnessAvailable()) {
        harnessClient.onOutput((ev) => {
            if (!ev) return;
            if (ev.runId) activeRunId = ev.runId;
            if (ev.type === 'chunk' || ev.type === 'status' || ev.type === 'stderr') {
                runnerOutputEl.classList.remove('hidden');
                runnerClearBtn.classList.remove('hidden');
                const prefix = ev.type === 'status' ? `[${ev.harnessId}] ` : '';
                runnerOutputEl.textContent += `${prefix}${ev.text}${ev.type === 'status' ? '\n' : ''}`;
                runnerOutputEl.scrollTop = runnerOutputEl.scrollHeight;
            }
        });
    }

    runnerCancelBtn.onclick = async () => {
        await harnessClient.cancel(activeRunId);
    };

    runnerRunBtn.onclick = async () => {
        const harnessId = runnerHarnessSel.value;
        const prompt = runnerPromptInput.value.trim();
        if (!harnessId || !prompt) return;

        runnerOutputEl.textContent = '';
        runnerOutputEl.classList.remove('hidden');
        runnerClearBtn.classList.remove('hidden');
        runnerRunBtn.disabled = true;
        runnerRunBtn.textContent = t('harness.runningBtn');
        runnerCancelBtn.classList.remove('hidden');

        try {
            await harnessClient.run({
                harnessId,
                prompt,
                cwd: runnerCwdInput.value.trim() || undefined,
                mode: runnerModeSel.value,
                autoApprove: runnerAutoApprove.checked,
            });
        } catch (err) {
            runnerOutputEl.textContent += `\n[Error] ${err.message}\n`;
        } finally {
            activeRunId = null;
            runnerRunBtn.disabled = false;
            runnerRunBtn.textContent = t('harness.runBtn');
            runnerCancelBtn.classList.add('hidden');
        }
    };

    void refreshHarnesses();

    return container;
}

function quickStep(num, title, code) {
    return `
        <div class="rounded-lg border border-white/10 bg-card-bg p-3.5 flex flex-col gap-2">
            <div class="flex items-center gap-2">
                <span class="w-5 h-5 rounded-md bg-white/10 text-white text-xs font-mono font-semibold flex items-center justify-center tabular-nums">${num}</span>
                <span class="text-xs font-semibold text-white">${title}</span>
            </div>
            <div class="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-app-bg px-3 py-2">
                <pre class="text-xs font-mono text-primary overflow-x-auto whitespace-pre leading-relaxed flex-1">${escapeHtml(code)}</pre>
                <button type="button" data-copy-text="${escapeHtml(code)}" class="px-2 py-1 rounded-md border border-white/10 bg-white/5 text-[11px] font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0">${t('common.copy')}</button>
            </div>
        </div>
    `;
}

function featureCard({ tag, title, body, code, link }) {
    const card = document.createElement('div');
    card.className = 'rounded-xl border border-white/10 bg-panel-bg p-4 flex flex-col gap-3';
    card.innerHTML = `
        <div class="flex items-center justify-between gap-2">
            <div>
                <h3 class="text-sm font-semibold text-white">${escapeHtml(title)}</h3>
                <span class="text-[11px] font-mono text-white/45">${escapeHtml(tag)}</span>
            </div>
            <a href="${link}" target="_blank" rel="noopener noreferrer" class="text-xs font-medium text-white/55 hover:text-white transition-colors">GitHub ↗</a>
        </div>
        <p class="text-xs text-secondary leading-relaxed">${escapeHtml(body)}</p>
        <div class="mt-auto flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-card-bg px-3 py-2">
            <pre class="text-xs font-mono text-primary overflow-x-auto whitespace-pre leading-relaxed flex-1">${escapeHtml(code)}</pre>
            <button type="button" data-copy-text="${escapeHtml(code)}" class="px-2 py-1 rounded-md border border-white/10 bg-white/5 text-[11px] font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0">${t('common.copy')}</button>
        </div>
    `;
    return card;
}

function exampleBlock(title, code) {
    return `
        <div class="rounded-lg border border-white/10 bg-card-bg p-3.5 flex flex-col gap-2">
            <span class="text-xs font-medium text-white/80">${escapeHtml(title)}</span>
            <div class="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-app-bg px-3 py-2">
                <pre class="text-xs font-mono text-primary overflow-x-auto whitespace-pre leading-relaxed flex-1">${escapeHtml(code)}</pre>
                <button type="button" data-copy-text="${escapeHtml(code)}" class="px-2 py-1 rounded-md border border-white/10 bg-white/5 text-[11px] font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0">${t('common.copy')}</button>
            </div>
        </div>
    `;
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
