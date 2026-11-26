/**
 * Surgical TOML helper for reading and updating `[mcp_servers.<name>]` sections
 * in Codex `config.toml` without disturbing unrelated settings or comments.
 */

function escapeTomlString(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

function unquoteTomlValue(raw) {
    const trimmed = String(raw || '').trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function splitSections(tomlText) {
    const lines = String(tomlText || '').split(/\r?\n/);
    const sections = [];
    let current = { header: null, startLine: 0, lines: [] };

    lines.forEach((line, idx) => {
        const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
        if (match) {
            sections.push(current);
            current = { header: match[1].trim(), startLine: idx, lines: [line] };
        } else {
            current.lines.push(line);
        }
    });
    sections.push(current);
    return sections;
}

function parseTomlMcpServer(tomlText, serverName = 'muapi') {
    const targetHeader = `mcp_servers.${serverName}`;
    const sections = splitSections(tomlText);
    const match = sections.find((s) => s.header === targetHeader);
    if (!match) return null;

    const result = {};
    for (const line of match.lines.slice(1)) {
        const stripped = line.replace(/#.*$/, '').trim();
        if (!stripped) continue;
        const eqIdx = stripped.indexOf('=');
        if (eqIdx === -1) continue;
        const key = stripped.slice(0, eqIdx).trim();
        const val = stripped.slice(eqIdx + 1).trim();
        if (val === 'true') result[key] = true;
        else if (val === 'false') result[key] = false;
        else result[key] = unquoteTomlValue(val);
    }
    return result;
}

function renderTomlMcpSection(serverName, config) {
    const lines = [`[mcp_servers.${serverName}]`];
    if (config.url) lines.push(`url = "${escapeTomlString(config.url)}"`);
    if (config.command) lines.push(`command = "${escapeTomlString(config.command)}"`);
    if (Array.isArray(config.args)) {
        lines.push(`args = [${config.args.map((a) => `"${escapeTomlString(a)}"`).join(', ')}]`);
    }
    if (config.bearer_token_env_var) {
        lines.push(`bearer_token_env_var = "${escapeTomlString(config.bearer_token_env_var)}"`);
    }
    if (config.http_headers && typeof config.http_headers === 'object') {
        const entries = Object.entries(config.http_headers)
            .map(([k, v]) => `"${escapeTomlString(k)}" = "${escapeTomlString(v)}"`)
            .join(', ');
        lines.push(`http_headers = { ${entries} }`);
    }
    if (typeof config.enabled === 'boolean') {
        lines.push(`enabled = ${config.enabled ? 'true' : 'false'}`);
    }
    return lines;
}

function upsertTomlMcpServer(tomlText, serverName, config) {
    const targetHeader = `mcp_servers.${serverName}`;
    const newLines = renderTomlMcpSection(serverName, config);
    const eol = String(tomlText || '').includes('\r\n') ? '\r\n' : '\n';

    if (!tomlText || !tomlText.trim()) {
        return newLines.join(eol) + eol;
    }

    const sections = splitSections(tomlText);
    const idx = sections.findIndex((s) => s.header === targetHeader);

    if (idx !== -1) {
        // Preserve trailing blank lines after the replaced section if any
        const trailingBlanks = [];
        const existing = sections[idx].lines;
        for (let i = existing.length - 1; i >= 1 && existing[i].trim() === ''; i--) {
            trailingBlanks.unshift(existing[i]);
        }
        sections[idx].lines = [...newLines, ...trailingBlanks];
        const rebuilt = sections.flatMap((s) => s.lines).join(eol);
        return rebuilt.endsWith(eol) ? rebuilt : rebuilt + eol;
    }

    const trimmedEnd = tomlText.replace(/[\r\n]+$/, '');
    return `${trimmedEnd}${eol}${eol}${newLines.join(eol)}${eol}`;
}

function removeTomlMcpServer(tomlText, serverName) {
    if (!tomlText) return '';
    const targetHeader = `mcp_servers.${serverName}`;
    const eol = String(tomlText).includes('\r\n') ? '\r\n' : '\n';
    const sections = splitSections(tomlText).filter((s) => s.header !== targetHeader);
    const rebuilt = sections.flatMap((s) => s.lines).join(eol).replace(/(\r?\n){3,}/g, `${eol}${eol}`).trimEnd();
    return rebuilt ? `${rebuilt}${eol}` : '';
}

module.exports = {
    parseTomlMcpServer,
    upsertTomlMcpServer,
    removeTomlMcpServer,
};
