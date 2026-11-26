#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const {
    HARNESS_ORDER,
    detectAllHarnesses,
    configureHarnessMcp,
    unconfigureHarnessMcp,
    installMuapiSkills,
    startHarnessRun,
} = require('../lib/harnesses');

const PKG_VERSION = (() => {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')).version;
    } catch {
        return '2.0.0';
    }
})();

function parseCliArgs(argv) {
    const positional = [];
    const flags = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('-')) {
            positional.push(arg);
            continue;
        }
        if (arg === '--') {
            positional.push(...argv.slice(i + 1));
            break;
        }
        if (arg === '-h' || arg === '--help') {
            flags.help = true;
            continue;
        }
        if (arg === '-v' || arg === '--version') {
            flags.version = true;
            continue;
        }
        if (arg.startsWith('--')) {
            const eq = arg.indexOf('=');
            if (eq !== -1) {
                flags[arg.slice(2, eq)] = arg.slice(eq + 1);
            } else {
                const key = arg.slice(2);
                const next = argv[i + 1];
                if (next !== undefined && !next.startsWith('--')) {
                    flags[key] = next;
                    i++;
                } else {
                    flags[key] = true;
                }
            }
        }
    }

    return { positional, flags };
}

function formatSurfaceCell(surface) {
    if (!surface) return 'n/a';
    if (!surface.installed) return 'not installed';
    return surface.version ? `v${surface.version}` : 'installed';
}

function printDetectionReport(report) {
    console.log(`\nOpen Generative AI — Harness Detection (${report.os}/${report.arch})`);
    console.log(`Installed: ${report.summary.installedHarnesses}/${report.summary.totalHarnesses} | CLI ready: ${report.summary.cliReadyCount} | MuAPI MCP configured: ${report.summary.mcpConfiguredCount}\n`);

    for (const h of report.harnesses) {
        const statusIcon = h.installed ? '[INSTALLED]' : '[MISSING]  ';
        console.log(`${statusIcon} ${h.name} (${h.id})`);
        console.log(`  Desktop : ${formatSurfaceCell(h.surfaces.desktop)}${h.surfaces.desktop?.path ? ` — ${h.surfaces.desktop.path}` : ''}`);
        console.log(`  CLI     : ${formatSurfaceCell(h.surfaces.cli)}${h.surfaces.cli?.path ? ` — ${h.surfaces.cli.path}` : ''}`);
        if (h.surfaces.ide) {
            const extNote = h.surfaces.ide.extensions?.length
                ? ` (${h.surfaces.ide.extensions.map((e) => `${e.ide}: ${e.version || e.id}`).join(', ')})`
                : '';
            console.log(`  IDE     : ${formatSurfaceCell(h.surfaces.ide)}${extNote}${h.surfaces.ide.path ? ` — ${h.surfaces.ide.path}` : ''}`);
        }
        const mcpLabel = h.config.mcpConfigured ? 'configured' : 'not configured';
        console.log(`  MCP     : ${mcpLabel} (${h.config.primaryPath || 'n/a'})`);
        console.log('');
    }
}

function printUsage() {
    console.log(`open-generative-ai (ogai) v${PKG_VERSION}

Usage:
  ogai harness detect [--harness <id>] [--workspace <dir>] [--json]
  ogai harness models [<id>] [--json]
  ogai harness configure <id|all> [--surface auto|desktop|cli|ide|all] [--api-key <key>] [--api-key-env <ENV>] [--config <path>] [--skills] [--dry-run] [--json]
  ogai harness unconfigure <id|all> [--surface auto|desktop|cli|ide|all] [--config <path>] [--dry-run] [--json]
  ogai harness run <id> "<prompt>" [--model <modelId>] [--cwd <dir>] [--mode plan|auto] [--auto-approve] [--json]
  ogai harness doctor [--json]

Supported harnesses: ${HARNESS_ORDER.join(', ')}
Supported platforms: linux, win32, cli
`);
}

async function readStdinIfPiped() {
    if (process.stdin.isTTY) return '';
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data.trim()));
        process.stdin.on('error', () => resolve(''));
    });
}

async function runCli(argv = process.argv.slice(2), io = {}) {
    const out = io.log || console.log;
    const errOut = io.error || console.error;
    const { positional, flags } = parseCliArgs(argv);

    if (flags.version && positional.length === 0) {
        out(PKG_VERSION);
        return 0;
    }

    // Allow both `ogai harness detect` and `ogai detect`
    const tokens = positional[0] === 'harness' ? positional.slice(1) : positional;
    const subcommand = tokens[0];

    if (flags.help || !subcommand) {
        printUsage();
        return 0;
    }

    if (subcommand === 'detect') {
        const harnessIds = flags.harness && flags.harness !== 'all' ? [String(flags.harness)] : undefined;
        const report = await detectAllHarnesses({
            harnessIds,
            workspaceDir: flags.workspace ? path.resolve(String(flags.workspace)) : process.cwd(),
            platform: flags.platform ? String(flags.platform) : undefined,
        });
        if (flags.json) {
            out(JSON.stringify(report, null, 2));
        } else {
            printDetectionReport(report);
        }
        return 0;
    }

    if (subcommand === 'models') {
        const target = tokens[1] && tokens[1] !== 'all' ? [tokens[1]] : (flags.harness && flags.harness !== 'all' ? [String(flags.harness)] : undefined);
        const report = await detectAllHarnesses({
            harnessIds: target,
            workspaceDir: process.cwd(),
            includeModels: true,
        });
        const payload = report.harnesses.map((h) => ({
            id: h.id,
            name: h.name,
            installed: h.canRun,
            models: h.models || [],
        }));
        if (flags.json) {
            out(JSON.stringify(payload, null, 2));
        } else {
            for (const h of payload) {
                out(`\n${h.name} (${h.id}) — ${h.models.length} model(s) [${h.installed ? 'CLI ready' : 'fallback defaults'}]`);
                for (const m of h.models) {
                    out(`  ${m.isDefault ? '*' : ' '} ${m.id}${m.name && m.name !== m.id ? `  —  ${m.name}` : ''}`);
                }
            }
            out('');
        }
        return 0;
    }

    if (subcommand === 'configure' || subcommand === 'unconfigure') {
        const target = tokens[1] || String(flags.harness || 'all');
        const res = subcommand === 'unconfigure'
            ? unconfigureHarnessMcp({
                harnessId: target,
                surface: flags.surface ? String(flags.surface) : 'auto',
                configPath: flags.config ? String(flags.config) : undefined,
                dryRun: Boolean(flags['dry-run'] || flags.dryRun),
            })
            : configureHarnessMcp({
                harnessId: target,
                surface: flags.surface ? String(flags.surface) : 'auto',
                configPath: flags.config ? String(flags.config) : undefined,
                apiKey: flags['api-key'] ? String(flags['api-key']) : (process.env.MUAPI_API_KEY || ''),
                apiKeyEnv: flags['api-key-env'] ? String(flags['api-key-env']) : 'MUAPI_API_KEY',
                dryRun: Boolean(flags['dry-run'] || flags.dryRun),
            });

        let skillsRes = null;
        if (subcommand === 'configure' && flags.skills && !res.dryRun) {
            skillsRes = await installMuapiSkills();
        }

        if (flags.json) {
            out(JSON.stringify({ ...res, ...(skillsRes ? { skills: skillsRes } : {}) }, null, 2));
        } else {
            for (const item of res.results) {
                const verb = res.dryRun ? 'Would update' : (item.changed ? 'Updated' : 'Unchanged');
                out(`[${item.harnessId}] ${verb}: ${item.configPath}${item.backupPath ? ` (backup: ${item.backupPath})` : ''}`);
                if (res.dryRun && item.preview) {
                    out(item.preview);
                }
            }
            if (skillsRes) {
                out(skillsRes.ok ? 'Installed muapi-skills.' : `Skills installation failed: ${skillsRes.error}`);
            }
        }
        return 0;
    }

    if (subcommand === 'run') {
        const harnessId = tokens[1];
        if (!harnessId || !HARNESS_ORDER.includes(harnessId)) {
            errOut(`Specify a valid harness (${HARNESS_ORDER.join(', ')}). Example: ogai harness run claude "Summarize README"`);
            return 1;
        }
        const promptArg = tokens.slice(2).join(' ').trim();
        const prompt = promptArg || (await readStdinIfPiped());
        if (!prompt) {
            errOut('Prompt is required. Pass it as an argument or pipe it via stdin.');
            return 1;
        }

        const run = await startHarnessRun({
            harnessId,
            model: flags.model ? String(flags.model) : undefined,
            prompt,
            cwd: flags.cwd ? String(flags.cwd) : process.cwd(),
            mode: flags.mode === 'auto' ? 'auto' : 'plan',
            autoApprove: Boolean(flags['auto-approve'] || flags.autoApprove),
            onEvent: (ev) => {
                if (flags.json) {
                    out(JSON.stringify(ev));
                } else if (ev.type === 'chunk') {
                    process.stdout.write(ev.text);
                } else if (ev.type === 'stderr' && ev.text.trim()) {
                    process.stderr.write(ev.text);
                }
            },
        });

        await run.done;
        if (!flags.json) process.stdout.write('\n');
        return 0;
    }

    if (subcommand === 'doctor') {
        const report = await detectAllHarnesses({ workspaceDir: process.cwd() });
        const checks = report.harnesses.map((h) => {
            const issues = [];
            if (!h.installed) issues.push('Not installed on this machine');
            if (h.surfaces.cli?.installed && !h.surfaces.cli?.version) {
                issues.push(h.surfaces.cli.error || 'CLI found but --version failed');
            }
            const parseErr = h.config.candidates.find((c) => c.parseError);
            if (parseErr) issues.push(`Malformed config at ${parseErr.path}: ${parseErr.parseError}`);
            return {
                id: h.id,
                name: h.name,
                installedSurfaces: h.installedSurfaces,
                mcpConfigured: h.config.mcpConfigured,
                issues,
            };
        });

        if (flags.json) {
            out(JSON.stringify({ os: report.os, arch: report.arch, checks }, null, 2));
        } else {
            out(`\nHarness Doctor (${report.os}/${report.arch})`);
            for (const c of checks) {
                const state = c.installedSurfaces.length ? c.installedSurfaces.join(', ') : 'none';
                out(`- ${c.name}: surfaces=[${state}], mcp=${c.mcpConfigured ? 'ok' : 'not set'}`);
                for (const issue of c.issues) out(`    ! ${issue}`);
            }
            out('');
        }
        return 0;
    }

    errOut(`Unknown command "${subcommand}". Run "ogai --help" for usage.`);
    return 1;
}

if (require.main === module) {
    runCli().then(
        (code) => process.exit(code),
        (err) => {
            console.error(err?.message || String(err));
            process.exit(1);
        }
    );
}

module.exports = {
    parseCliArgs,
    runCli,
};
