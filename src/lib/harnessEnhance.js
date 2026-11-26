import { harnessClient, isHarnessAvailable } from './harnessClient.js';
import { t } from './i18n.js';

const SPARK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/></svg>`;

/**
 * Creates a compact inline prompt enhancer powered by an installed local CLI harness.
 * Remains hidden unless running inside Electron with at least one CLI harness detected.
 */
export function createHarnessPromptEnhancer({ kind = 'image', getPrompt, setPrompt }) {
    const wrap = document.createElement('div');
    wrap.className = 'hidden items-center rounded-xl border border-white/10 bg-white/5 overflow-hidden';

    if (!isHarnessAvailable()) {
        return { element: wrap, refresh: async () => [] };
    }

    const select = document.createElement('select');
    select.className = 'bg-transparent pl-2.5 pr-1.5 py-2 text-xs font-medium text-white/80 focus:outline-none cursor-pointer';
    select.setAttribute('aria-label', 'Local CLI harness for prompt enhancement');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flex items-center gap-1.5 px-2.5 py-2 border-l border-white/10 text-xs font-medium text-white/80 hover:text-primary hover:bg-white/5 transition-colors whitespace-nowrap disabled:opacity-50';
    btn.innerHTML = `${SPARK_ICON}<span>${t('harness.enhanceBtn')}</span>`;

    wrap.appendChild(select);
    wrap.appendChild(btn);

    const labelSpan = btn.querySelector('span');

    const refresh = async () => {
        try {
            const report = await harnessClient.detect();
            const ready = (report?.harnesses || []).filter((h) => h.canRun);
            select.innerHTML = '';
            if (!ready.length) {
                wrap.classList.add('hidden');
                wrap.classList.remove('flex');
                return [];
            }
            for (const h of ready) {
                const opt = document.createElement('option');
                opt.value = h.id;
                const ver = h.surfaces?.cli?.version ? ` ${h.surfaces.cli.version}` : '';
                opt.textContent = `${h.name}${ver}`;
                opt.className = 'bg-[#111] text-white';
                select.appendChild(opt);
            }
            wrap.classList.remove('hidden');
            wrap.classList.add('flex');
            return ready;
        } catch {
            return [];
        }
    };

    btn.onclick = async (e) => {
        e.stopPropagation();
        const rawPrompt = String(getPrompt() || '').trim();
        const harnessId = select.value;
        if (!rawPrompt || !harnessId) return;

        btn.disabled = true;
        if (labelSpan) labelSpan.textContent = t('harness.enhancing');
        try {
            const instruction = `Rewrite and enrich this AI ${kind} generation prompt into one vivid, detailed, production-ready prompt. Output ONLY the enhanced prompt text with no quotes, markdown, or explanation:\n\n${rawPrompt}`;
            const res = await harnessClient.run({
                harnessId,
                prompt: instruction,
                mode: 'plan',
            });
            const enhanced = String(res?.output || '').trim();
            if (enhanced) {
                setPrompt(enhanced);
            }
        } catch (err) {
            console.error('[HarnessEnhancer] failed:', err);
            alert(`Harness enhancement failed: ${err.message}`);
        } finally {
            btn.disabled = false;
            if (labelSpan) labelSpan.textContent = t('harness.enhanceBtn');
        }
    };

    void refresh();
    return { element: wrap, refresh };
}
