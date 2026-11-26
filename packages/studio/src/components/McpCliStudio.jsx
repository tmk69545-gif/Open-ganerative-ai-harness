"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FaGithub, FaTerminal, FaPlug, FaStar, FaExternalLinkAlt, FaCopy, FaCheck } from 'react-icons/fa';
import en from '../messages/en/mcpCliStudio.json';
import zh from '../messages/zh/mcpCliStudio.json';
import { resolveCopy } from '../i18nUtils';

const FEATURES = [
  {
    id: 'cli',
    tag: 'CLI',
    title: 'muapi-cli',
    icon: FaTerminal,
    code: `npm install -g muapi-cli
muapi auth login
muapi image generate "a cyberpunk city" --model flux-dev`,
    href: 'https://github.com/SamurAIGPT/muapi-cli',
  },
  {
    id: 'mcp',
    tag: 'MCP',
    title: 'muapi-mcp-server',
    icon: FaPlug,
    code: `claude mcp add --transport http muapi https://api.muapi.ai/mcp \\
  --header "Authorization: Bearer YOUR_KEY"`,
    href: 'https://github.com/SamurAIGPT/muapi-mcp-server',
  },
  {
    id: 'skills',
    tag: 'Skills',
    title: 'Generative Media Skills',
    icon: FaStar,
    code: `npx skills add SamurAIGPT/muapi-skills --all`,
    href: 'https://github.com/SamurAIGPT/muapi-skills',
  },
];

const QUICK_STEPS = [
  { id: 'installCli', num: '1', code: 'npx open-generative-ai harness detect' },
  { id: 'signIn', num: '2', code: 'npx open-generative-ai harness configure all' },
  { id: 'addSkills', num: '3', code: 'npx open-generative-ai harness run claude "prompt"' },
];

const EXAMPLES = [
  { id: 'imageGeneration', code: 'muapi image generate "mountain lake at sunrise" --model flux-dev --download ./outputs' },
  { id: 'textToVideo', code: 'muapi video generate "dog running on a beach" --model kling-master' },
  { id: 'audioCreation', code: 'muapi audio create "ambient electronic synth"' },
  { id: 'runSkill', code: 'bash library/visual/nano-banana/scripts/generate-nano-art.sh --file image.jpg --view' },
];

function CopyButton({ text, copyLabel, copiedLabel }) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard unavailable
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? copiedLabel : copyLabel}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 bg-white/5 text-[11px] font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0"
    >
      {copied ? <FaCheck className="text-[10px]" /> : <FaCopy className="text-[10px]" />}
      <span>{copied ? copiedLabel : copyLabel}</span>
    </button>
  );
}

function CodeBlock({ children, copyLabel, copiedLabel, className = '' }) {
  return (
    <div className={`harness-code flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-[#0a0a0a] px-3 py-2 ${className}`}>
      <pre className="text-xs font-mono text-[#22d3ee] overflow-x-auto whitespace-pre leading-relaxed flex-1">
        {children}
      </pre>
      {copyLabel && (
        <CopyButton text={String(children)} copyLabel={copyLabel} copiedLabel={copiedLabel} />
      )}
    </div>
  );
}

function SurfaceRow({ label, surface, copy }) {
  if (!surface) return null;
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-white/5 last:border-none">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-white/85">{label}</span>
          {surface.extensions?.length > 0 && (
            <span className="text-[11px] text-white/45 truncate font-mono tabular-nums">
              {surface.extensions.map((e) => `${e.ide} ${e.version || ''}`).join(' · ')}
            </span>
          )}
        </div>
        {surface.path && (
          <div className="text-[11px] font-mono text-white/45 truncate mt-0.5" title={surface.path}>
            {surface.path}
          </div>
        )}
      </div>
      <div className="shrink-0 pt-0.5">
        {surface.installed ? (
          <span className="harness-badge-ok inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono font-medium tabular-nums">
            {surface.version ? `v${surface.version}` : copy.harnesses.installed}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/40 text-[11px] font-medium">
            {copy.harnesses.notDetected}
          </span>
        )}
      </div>
    </div>
  );
}

export default function McpCliStudio({ apiKey = '', locale = 'en' }) {
  const copy = resolveCopy(en, zh, locale);

  const [activeView, setActiveView] = useState('workbench');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [remoteMode, setRemoteMode] = useState(false);
  const [banner, setBanner] = useState(null);
  const [busyAction, setBusyAction] = useState(false);

  const [selectedHarness, setSelectedHarness] = useState('claude');
  const [runMode, setRunMode] = useState('plan');
  const [runCwd, setRunCwd] = useState('');
  const [runPrompt, setRunPrompt] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [running, setRunning] = useState(false);
  const [runOutput, setRunOutput] = useState('');
  const abortRef = useRef(null);

  const fetchDetection = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/harnesses/detect', { cache: 'no-store' });
      const data = await res.json();
      if (res.status === 403 && data?.remoteMode) {
        setRemoteMode(true);
        setReport(null);
        return;
      }
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setRemoteMode(false);
      setReport(data);
      const firstRunnable = data.harnesses?.find((h) => h.canRun);
      if (firstRunnable) setSelectedHarness(firstRunnable.id);
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDetection();
  }, [fetchDetection]);

  const handleConfigure = async (harnessId, action = 'configure') => {
    setBusyAction(true);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-api-key'] = apiKey;
      const res = await fetch('/api/harnesses/configure', {
        method: 'POST',
        headers,
        body: JSON.stringify({ harnessId, action, apiKey }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const count = data.results?.length || 0;
      setBanner({
        kind: 'info',
        text: `${action === 'unconfigure' ? 'Disconnected' : 'Configured'} MuAPI MCP (${count} target${count === 1 ? '' : 's'}).`,
      });
      await fetchDetection();
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    } finally {
      setBusyAction(false);
    }
  };

  const handleInstallSkills = async () => {
    setBusyAction(true);
    try {
      const res = await fetch('/api/harnesses/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install-skills' }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setBanner({ kind: 'info', text: 'Installed muapi-skills.' });
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    } finally {
      setBusyAction(false);
    }
  };

  const handleRun = async () => {
    if (!selectedHarness || !runPrompt.trim() || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setRunOutput('');

    try {
      const res = await fetch('/api/harnesses/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          harnessId: selectedHarness,
          prompt: runPrompt,
          cwd: runCwd.trim() || undefined,
          mode: runMode,
          autoApprove,
        }),
        signal: controller.signal,
      });

      if (!res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const errBody = await res.json();
        throw new Error(errBody?.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'chunk' || ev.type === 'stderr') {
              setRunOutput((prev) => prev + ev.text);
            } else if (ev.type === 'status') {
              setRunOutput((prev) => prev + `[${ev.harnessId}] ${ev.text}\n`);
            } else if (ev.type === 'error') {
              setRunOutput((prev) => prev + `\n[Error] ${ev.text}\n`);
            }
          } catch {
            // ignore partial SSE JSON
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setRunOutput((prev) => prev + `\n[Error] ${err.message}\n`);
      } else {
        setRunOutput((prev) => prev + '\n[Cancelled]\n');
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  return (
    <div className="w-full h-full overflow-y-auto bg-[#050505] text-white custom-scrollbar">
      <div className="max-w-5xl mx-auto px-5 md:px-8 py-6 flex flex-col gap-6">

        {/* Left-aligned Workbench Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-white/10">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-white">
                {copy.hero.title}
              </h1>
              <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px] font-mono text-white/65 tabular-nums">
                {report ? `${report.os}/${report.arch}` : (remoteMode ? 'remote' : 'checking')}
              </span>
            </div>
            <p className="text-sm text-white/60 max-w-2xl">
              {copy.hero.description}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* View Switcher */}
            <div className="inline-flex rounded-lg border border-white/10 bg-[#0a0a0a] p-0.5">
              {['workbench', 'reference'].map((viewId) => {
                const active = activeView === viewId;
                return (
                  <button
                    key={viewId}
                    type="button"
                    onClick={() => setActiveView(viewId)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      active
                        ? 'bg-white/10 text-white'
                        : 'text-white/55 hover:text-white'
                    }`}
                  >
                    {copy.tabs[viewId]}
                  </button>
                );
              })}
            </div>

            {!remoteMode && activeView === 'workbench' && (
              <>
                <button
                  type="button"
                  onClick={fetchDetection}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-white/80 transition-colors disabled:opacity-50"
                >
                  {copy.harnesses.refresh}
                </button>
                <button
                  type="button"
                  onClick={() => handleConfigure('all', 'configure')}
                  disabled={busyAction || !report}
                  className="px-3.5 py-1.5 rounded-lg bg-[#22d3ee] text-black text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {copy.harnesses.connectAll}
                </button>
                <button
                  type="button"
                  onClick={handleInstallSkills}
                  disabled={busyAction}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-white/80 transition-colors disabled:opacity-40"
                >
                  {copy.harnesses.installSkills}
                </button>
              </>
            )}
          </div>
        </header>

        {banner && (
          <div
            className={`text-xs rounded-lg px-3.5 py-2.5 border ${
              banner.kind === 'error'
                ? 'bg-red-500/10 border-red-500/30 text-red-300'
                : 'harness-badge-mcp bg-[#22d3ee]/10 border-[#22d3ee]/30 text-[#22d3ee]'
            }`}
          >
            {banner.text}
          </div>
        )}

        {activeView === 'workbench' ? (
          <>
            {/* Detected Harnesses Grid */}
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-white/90">{copy.harnesses.sectionTitle}</h2>
                {report && (
                  <span className="text-xs font-mono text-white/55 tabular-nums">
                    {report.summary.installedHarnesses}/{report.summary.totalHarnesses} installed · {report.summary.cliReadyCount} CLI · {report.summary.mcpConfiguredCount} MCP
                  </span>
                )}
              </div>

              {remoteMode ? (
                <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4 flex flex-col gap-2.5 text-xs text-white/70">
                  <p>{copy.harnesses.remoteNotice}</p>
                  <CodeBlock copyLabel={copy.harnesses.copy} copiedLabel={copy.harnesses.copied}>
                    npx open-generative-ai harness detect
                  </CodeBlock>
                </div>
              ) : loading ? (
                <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5 text-xs text-white/55">
                  {copy.harnesses.scanning}
                </div>
              ) : report ? (
                <div className="grid md:grid-cols-2 gap-4">
                  {report.harnesses.map((h) => (
                    <div
                      key={h.id}
                      className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4 flex flex-col gap-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              h.installed ? 'bg-emerald-400' : 'bg-white/25'
                            }`}
                          />
                          <h3 className="text-sm font-semibold text-white truncate">{h.name}</h3>
                          <span className="text-xs text-white/45">{h.vendor}</span>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-medium border shrink-0 ${
                            h.config.mcpConfigured
                              ? 'harness-badge-mcp bg-[#22d3ee]/10 border-[#22d3ee]/25 text-[#22d3ee]'
                              : 'bg-white/5 border-white/10 text-white/50'
                          }`}
                        >
                          {h.config.mcpConfigured ? copy.harnesses.mcpConnected : copy.harnesses.mcpNotSet}
                        </span>
                      </div>

                      <div className="rounded-lg border border-white/5 bg-[#111111] px-3">
                        <SurfaceRow label="Desktop" surface={h.surfaces.desktop} copy={copy} />
                        <SurfaceRow label="CLI" surface={h.surfaces.cli} copy={copy} />
                        <SurfaceRow label="IDE" surface={h.surfaces.ide} copy={copy} />
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px] text-white/45">
                        <span className="font-mono truncate" title={h.config.primaryPath || ''}>
                          {copy.harnesses.configPrefix}: {h.config.primaryPath || 'n/a'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 pt-1 mt-auto">
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => handleConfigure(h.id, h.config.mcpConfigured ? 'unconfigure' : 'configure')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            h.config.mcpConfigured
                              ? 'bg-white/5 border-white/10 text-white/75 hover:bg-red-500/15 hover:text-red-300'
                              : 'bg-[#22d3ee]/15 border-[#22d3ee]/30 text-[#22d3ee] hover:bg-[#22d3ee]/25'
                          }`}
                        >
                          {h.config.mcpConfigured ? copy.harnesses.disconnectMcp : copy.harnesses.connectMcp}
                        </button>
                        {h.canRun && (
                          <button
                            type="button"
                            onClick={() => setSelectedHarness(h.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                              selectedHarness === h.id
                                ? 'bg-white/10 border-white/20 text-white'
                                : 'bg-white/5 border-white/10 text-white/70 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            {copy.harnesses.useRunner}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            {/* Runner Console */}
            {!remoteMode && report && (
              <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4 md:p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-white/90">{copy.harnesses.runnerTitle}</h2>
                  {runOutput && (
                    <button
                      type="button"
                      onClick={() => setRunOutput('')}
                      className="text-xs text-white/50 hover:text-white transition-colors"
                    >
                      {copy.harnesses.clearOutput}
                    </button>
                  )}
                </div>

                <div className="grid md:grid-cols-3 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-white/65">{copy.harnesses.targetLabel}</span>
                    <select
                      value={selectedHarness}
                      onChange={(e) => setSelectedHarness(e.target.value)}
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-[#22d3ee]/50"
                    >
                      {report.harnesses.map((h) => (
                        <option key={h.id} value={h.id} disabled={!h.canRun}>
                          {h.canRun ? `${h.name} CLI${h.surfaces?.cli?.version ? ` (v${h.surfaces.cli.version})` : ''}` : `${h.name} CLI (${copy.harnesses.notDetected})`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-white/65">{copy.harnesses.modeLabel}</span>
                    <select
                      value={runMode}
                      onChange={(e) => setRunMode(e.target.value)}
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-[#22d3ee]/50"
                    >
                      <option value="plan">{copy.harnesses.modePlan}</option>
                      <option value="auto">{copy.harnesses.modeAuto}</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-white/65">{copy.harnesses.cwdLabel}</span>
                    <input
                      type="text"
                      value={runCwd}
                      onChange={(e) => setRunCwd(e.target.value)}
                      placeholder={copy.harnesses.cwdPlaceholder}
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/35 focus:outline-none focus:border-[#22d3ee]/50"
                    />
                  </label>
                </div>

                <textarea
                  rows={3}
                  value={runPrompt}
                  onChange={(e) => setRunPrompt(e.target.value)}
                  placeholder={copy.harnesses.promptPlaceholder}
                  className="w-full bg-zinc-900 border border-white/10 rounded-lg p-3 text-sm text-white placeholder-white/35 focus:outline-none focus:border-[#22d3ee]/50 resize-y"
                />

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <label className="flex items-center gap-2 text-xs text-white/65 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoApprove}
                      onChange={(e) => setAutoApprove(e.target.checked)}
                    />
                    <span>{copy.harnesses.autoApproveLabel}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {running && (
                      <button
                        type="button"
                        onClick={() => abortRef.current?.abort()}
                        className="px-3.5 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-medium hover:bg-red-500/25 transition-colors"
                      >
                        {copy.harnesses.cancelBtn}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={running || !runPrompt.trim()}
                      onClick={handleRun}
                      className="px-4 py-2 rounded-lg bg-[#22d3ee] text-black text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
                    >
                      {running ? copy.harnesses.runningBtn : copy.harnesses.runBtn}
                    </button>
                  </div>
                </div>

                {runOutput && (
                  <pre className="harness-terminal text-xs font-mono text-white/85 bg-[#111111] border border-white/10 rounded-lg p-3.5 max-h-80 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">
                    {runOutput}
                  </pre>
                )}
              </section>
            )}
          </>
        ) : (
          /* CLI & MCP Reference Tab */
          <div className="flex flex-col gap-6">
            <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5 flex flex-col gap-4">
              <h2 className="text-sm font-semibold text-white/90">{copy.quickStart.sectionLabel}</h2>
              <div className="grid md:grid-cols-3 gap-3">
                {QUICK_STEPS.map((step) => (
                  <div
                    key={step.num}
                    className="rounded-lg border border-white/10 bg-[#111111] p-3.5 flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-white/10 text-white text-xs font-mono font-semibold flex items-center justify-center tabular-nums">
                        {step.num}
                      </span>
                      <span className="text-xs font-semibold text-white">{copy.quickStart.steps[step.id]}</span>
                    </div>
                    <CodeBlock copyLabel={copy.harnesses.copy} copiedLabel={copy.harnesses.copied}>
                      {step.code}
                    </CodeBlock>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid md:grid-cols-3 gap-4">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <div
                    key={f.title}
                    className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4 flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/85">
                          <Icon className="text-sm" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-white">{f.title}</h3>
                          <span className="text-[11px] font-mono text-white/45">{f.tag}</span>
                        </div>
                      </div>
                      <a
                        href={f.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-white/55 hover:text-white transition-colors"
                      >
                        <FaGithub className="text-xs" />
                        <span>{copy.viewOnGithub}</span>
                        <FaExternalLinkAlt className="text-[9px]" />
                      </a>
                    </div>
                    <p className="text-xs text-white/60 leading-relaxed">{copy.features[f.id].description}</p>
                    <div className="mt-auto">
                      <CodeBlock copyLabel={copy.harnesses.copy} copiedLabel={copy.harnesses.copied}>
                        {f.code}
                      </CodeBlock>
                    </div>
                  </div>
                );
              })}
            </section>

            <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5 flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-white/90">{copy.examples.sectionLabel}</h2>
              <div className="grid md:grid-cols-2 gap-3">
                {EXAMPLES.map((ex) => (
                  <div
                    key={ex.id}
                    className="rounded-lg border border-white/10 bg-[#111111] p-3.5 flex flex-col gap-2"
                  >
                    <span className="text-xs font-medium text-white/80">{copy.examples[ex.id]}</span>
                    <CodeBlock copyLabel={copy.harnesses.copy} copiedLabel={copy.harnesses.copied}>
                      {ex.code}
                    </CodeBlock>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
