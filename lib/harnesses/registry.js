const path = require('path');

const HARNESS_ORDER = ['antigravity', 'claude', 'opencode', 'codex'];

function getUserHome(env = process.env, osHome = require('os').homedir()) {
    return env.HOME || env.USERPROFILE || osHome;
}

function getWindowsAppDirs(env = process.env, home) {
    const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    return { localAppData, appData, programFiles, programFilesX86 };
}

function getXdgDirs(env = process.env, home) {
    return {
        configHome: env.XDG_CONFIG_HOME || path.join(home, '.config'),
        dataHome: env.XDG_DATA_HOME || path.join(home, '.local', 'share'),
        binHome: env.XDG_BIN_HOME || path.join(home, '.local', 'bin'),
    };
}

/**
 * Declarative registry for all supported AI harnesses and their platform-specific
 * Desktop, CLI, IDE, MCP config, and headless runner metadata.
 */
function buildHarnessRegistry({ platform = process.platform, env = process.env, homeDir } = {}) {
    const home = homeDir || getUserHome(env);
    const win = getWindowsAppDirs(env, home);
    const xdg = getXdgDirs(env, home);
    const codexHome = (env.CODEX_HOME || '').trim() || path.join(home, '.codex');

    const ideExtensionRoots = platform === 'win32'
        ? [
            { ide: 'VS Code', dir: path.join(home, '.vscode', 'extensions') },
            { ide: 'VS Code Insiders', dir: path.join(home, '.vscode-insiders', 'extensions') },
            { ide: 'Cursor', dir: path.join(home, '.cursor', 'extensions') },
            { ide: 'Windsurf', dir: path.join(home, '.windsurf', 'extensions') },
            { ide: 'Antigravity IDE', dir: path.join(home, '.antigravity', 'extensions') },
        ]
        : [
            { ide: 'VS Code', dir: path.join(home, '.vscode', 'extensions') },
            { ide: 'VS Code Insiders', dir: path.join(home, '.vscode-insiders', 'extensions') },
            { ide: 'Cursor', dir: path.join(home, '.cursor', 'extensions') },
            { ide: 'Windsurf', dir: path.join(home, '.windsurf', 'extensions') },
            { ide: 'Antigravity IDE', dir: path.join(home, '.antigravity', 'extensions') },
        ];

    return {
        antigravity: {
            id: 'antigravity',
            name: 'Antigravity',
            vendor: 'Google',
            surfaces: ['desktop', 'cli', 'ide'],
            cli: {
                binaries: ['agy'],
                versionArgs: ['--version'],
                extraDirs: platform === 'win32'
                    ? [
                        path.join(win.localAppData, 'Programs', 'Antigravity'),
                        path.join(win.localAppData, 'Programs', 'antigravity-ide'),
                        path.join(win.localAppData, 'Programs', 'Antigravity', 'resources', 'app', 'bin'),
                        path.join(home, '.local', 'bin'),
                        path.join(win.appData, 'npm'),
                    ]
                    : [
                        xdg.binHome,
                        '/usr/local/bin',
                        '/usr/bin',
                        path.join(xdg.dataHome, 'antigravity-ide', 'bin'),
                    ],
                buildRunArgs: ({ prompt, model, mode, cwd, autoApprove }) => {
                    const args = ['-p', prompt, '--output-format', 'stream-json'];
                    if (model) args.push('--model', model);
                    if (mode === 'plan') args.push('--mode', 'plan');
                    if (cwd) args.push('--add-dir', cwd);
                    if (autoApprove) args.push('--dangerously-skip-permissions');
                    return args;
                },
            },
            desktop: {
                candidates: platform === 'win32'
                    ? [
                        path.join(win.localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'),
                        path.join(win.localAppData, 'Programs', 'antigravity-ide', 'Antigravity.exe'),
                        path.join(win.localAppData, 'antigravity', 'Antigravity.exe'),
                        path.join(win.programFiles, 'Antigravity', 'Antigravity.exe'),
                    ]
                    : [
                        '/opt/antigravity/antigravity',
                        '/usr/share/antigravity/antigravity',
                        '/usr/bin/antigravity',
                        path.join(xdg.dataHome, 'antigravity-ide', 'antigravity-ide'),
                        path.join(xdg.binHome, 'antigravity'),
                    ],
                desktopEntries: ['antigravity.desktop', 'antigravity-ide.desktop'],
                appDataMarkers: platform === 'win32'
                    ? [path.join(win.appData, 'Antigravity'), path.join(home, '.gemini', 'antigravity')]
                    : [path.join(xdg.configHome, 'Antigravity'), path.join(home, '.gemini', 'antigravity')],
            },
            ide: {
                kind: 'host-ide',
                candidates: platform === 'win32'
                    ? [
                        path.join(win.localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'),
                        path.join(win.localAppData, 'Programs', 'antigravity-ide', 'Antigravity.exe'),
                        path.join(win.programFiles, 'Antigravity', 'Antigravity.exe'),
                    ]
                    : [
                        path.join(xdg.dataHome, 'antigravity-ide', 'antigravity-ide'),
                        '/usr/share/antigravity/antigravity',
                        '/opt/antigravity/antigravity',
                        '/usr/bin/antigravity',
                    ],
                extensionDirs: [path.join(home, '.antigravity', 'extensions')],
                workspaceMarker: '.agents',
            },
            config: {
                mcpFormat: 'antigravity-json',
                paths: [
                    path.join(home, '.gemini', 'config', 'mcp_config.json'),
                    path.join(home, '.gemini', 'antigravity', 'mcp_config.json'),
                    path.join(home, '.gemini', 'antigravity-cli', 'settings.json'),
                ],
                defaultMcpPath: path.join(home, '.gemini', 'config', 'mcp_config.json'),
            },
        },

        claude: {
            id: 'claude',
            name: 'Claude',
            vendor: 'Anthropic',
            surfaces: ['desktop', 'cli'],
            cli: {
                binaries: ['claude'],
                versionArgs: ['--version'],
                extraDirs: platform === 'win32'
                    ? [
                        path.join(home, '.local', 'bin'),
                        path.join(win.localAppData, 'Programs', 'claude'),
                        path.join(win.appData, 'npm'),
                    ]
                    : [
                        xdg.binHome,
                        path.join(home, '.npm-global', 'bin'),
                        '/usr/local/bin',
                        '/usr/bin',
                    ],
                buildRunArgs: ({ prompt, model, mode, autoApprove }) => {
                    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
                    if (model) args.push('--model', model);
                    if (mode === 'plan') args.push('--permission-mode', 'plan');
                    if (autoApprove) args.push('--dangerously-skip-permissions');
                    return args;
                },
            },
            desktop: {
                candidates: platform === 'win32'
                    ? [
                        path.join(win.localAppData, 'AnthropicClaude', 'claude.exe'),
                        path.join(win.localAppData, 'Programs', 'Claude', 'Claude.exe'),
                        path.join(win.localAppData, 'Programs', 'claude', 'Claude.exe'),
                        path.join(win.programFiles, 'Claude', 'Claude.exe'),
                    ]
                    : [
                        '/usr/bin/claude-desktop',
                        '/opt/Claude/claude-desktop',
                        '/usr/lib/claude-desktop/claude-desktop',
                        path.join(xdg.binHome, 'claude-desktop'),
                    ],
                desktopEntries: ['claude-desktop.desktop', 'claude.desktop'],
                appxNames: ['Claude'],
                appDataMarkers: platform === 'win32'
                    ? [path.join(win.appData, 'Claude')]
                    : [path.join(xdg.configHome, 'Claude')],
            },
            config: {
                mcpFormat: 'mcp-servers-json',
                paths: platform === 'win32'
                    ? [
                        path.join(win.appData, 'Claude', 'claude_desktop_config.json'),
                        path.join(home, '.claude.json'),
                        path.join(home, '.claude', 'settings.json'),
                    ]
                    : [
                        path.join(xdg.configHome, 'Claude', 'claude_desktop_config.json'),
                        path.join(home, '.claude.json'),
                        path.join(home, '.claude', 'settings.json'),
                    ],
                msixPackagePrefix: 'Claude_',
                msixRelativeConfig: path.join('LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'),
                defaultDesktopMcpPath: platform === 'win32'
                    ? path.join(win.appData, 'Claude', 'claude_desktop_config.json')
                    : path.join(xdg.configHome, 'Claude', 'claude_desktop_config.json'),
                defaultCliMcpPath: path.join(home, '.claude.json'),
            },
        },

        opencode: {
            id: 'opencode',
            name: 'OpenCode',
            vendor: 'OpenCode',
            surfaces: ['desktop', 'cli'],
            cli: {
                binaries: ['opencode'],
                versionArgs: ['--version'],
                extraDirs: platform === 'win32'
                    ? [
                        path.join(home, '.opencode', 'bin'),
                        path.join(home, '.local', 'bin'),
                        path.join(win.localAppData, 'opencode'),
                        path.join(home, 'scoop', 'shims'),
                        path.join(win.appData, 'npm'),
                    ]
                    : [
                        path.join(home, '.opencode', 'bin'),
                        xdg.binHome,
                        '/usr/local/bin',
                        '/usr/bin',
                    ],
                buildRunArgs: ({ prompt, model }) => {
                    const args = ['run', '--format', 'json'];
                    if (model) args.push('--model', model);
                    args.push(prompt);
                    return args;
                },
            },
            desktop: {
                candidates: platform === 'win32'
                    ? [
                        path.join(win.localAppData, 'Programs', 'OpenCode', 'OpenCode.exe'),
                        path.join(win.localAppData, 'Programs', 'opencode-desktop', 'OpenCode.exe'),
                        path.join(win.localAppData, 'OpenCode', 'OpenCode.exe'),
                        path.join(win.programFiles, 'OpenCode', 'OpenCode.exe'),
                    ]
                    : [
                        '/opt/OpenCode/opencode-desktop',
                        '/usr/bin/opencode-desktop',
                        path.join(xdg.binHome, 'opencode-desktop'),
                        path.join(xdg.dataHome, 'opencode', 'opencode-desktop'),
                    ],
                desktopEntries: ['opencode.desktop', 'opencode-desktop.desktop', 'ai.opencode.desktop.desktop'],
                appDataMarkers: platform === 'win32'
                    ? [path.join(win.appData, 'ai.opencode.desktop'), path.join(home, '.local', 'share', 'opencode')]
                    : [path.join(xdg.dataHome, 'opencode'), path.join(xdg.configHome, 'opencode')],
            },
            config: {
                mcpFormat: 'opencode-json',
                paths: platform === 'win32'
                    ? [
                        path.join(home, '.config', 'opencode', 'opencode.json'),
                        path.join(win.appData, 'opencode', 'opencode.json'),
                    ]
                    : [
                        path.join(xdg.configHome, 'opencode', 'opencode.json'),
                    ],
                defaultMcpPath: platform === 'win32'
                    ? path.join(home, '.config', 'opencode', 'opencode.json')
                    : path.join(xdg.configHome, 'opencode', 'opencode.json'),
            },
        },

        codex: {
            id: 'codex',
            name: 'Codex',
            vendor: 'OpenAI',
            surfaces: ['desktop', 'cli', 'ide'],
            cli: {
                binaries: ['codex'],
                versionArgs: ['--version'],
                extraDirs: platform === 'win32'
                    ? [
                        path.join(win.appData, 'npm'),
                        path.join(win.localAppData, 'Programs', 'Codex'),
                        path.join(home, '.local', 'bin'),
                        path.join(home, '.codex', 'bin'),
                    ]
                    : [
                        xdg.binHome,
                        '/usr/local/bin',
                        '/usr/bin',
                        path.join(home, '.npm-global', 'bin'),
                    ],
                buildRunArgs: ({ prompt, model, mode, autoApprove }) => {
                    const args = ['exec', '--json', '--skip-git-repo-check'];
                    if (model) args.push('--model', model);
                    if (autoApprove) args.push('--full-auto');
                    else if (mode === 'plan') args.push('--sandbox', 'read-only');
                    args.push(prompt);
                    return args;
                },
            },
            desktop: {
                candidates: platform === 'win32'
                    ? [
                        path.join(win.localAppData, 'Programs', 'Codex', 'Codex.exe'),
                        path.join(win.localAppData, 'Programs', 'OpenAI Codex', 'Codex.exe'),
                        path.join(win.programFiles, 'Codex', 'Codex.exe'),
                    ]
                    : [
                        '/opt/Codex/Codex',
                        '/opt/Codex/codex',
                        '/usr/bin/codex-desktop',
                        path.join(xdg.binHome, 'codex-desktop'),
                    ],
                desktopEntries: ['codex.desktop', 'openai-codex.desktop'],
                appxNames: ['OpenAI.Codex'],
                appDataMarkers: platform === 'win32'
                    ? [path.join(win.appData, 'Codex'), codexHome]
                    : [path.join(xdg.configHome, 'Codex'), codexHome],
            },
            ide: {
                kind: 'ide-extension',
                extensionPrefixes: ['openai.chatgpt-', 'openai.codex-'],
                extensionRoots: ideExtensionRoots,
            },
            config: {
                mcpFormat: 'codex-toml',
                paths: [path.join(codexHome, 'config.toml')],
                defaultMcpPath: path.join(codexHome, 'config.toml'),
            },
        },
    };
}

module.exports = {
    HARNESS_ORDER,
    buildHarnessRegistry,
    getUserHome,
    getWindowsAppDirs,
    getXdgDirs,
};
