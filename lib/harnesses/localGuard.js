const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function extractHostname(hostHeader = '') {
    const raw = String(hostHeader || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw.startsWith('[')) {
        const end = raw.indexOf(']');
        return end !== -1 ? raw.slice(0, end + 1) : raw;
    }
    return raw.split(':')[0];
}

function isLoopbackIp(rawIp = '') {
    const first = String(rawIp || '').split(',')[0].trim().toLowerCase();
    if (!first) return true;
    return first === '127.0.0.1' || first === '::1' || first === '::ffff:127.0.0.1';
}

/**
 * Ensures local filesystem/CLI harness endpoints cannot be invoked through
 * remote/multi-tenant Next.js deployments.
 */
function assertLoopbackRequest(request, { env = process.env } = {}) {
    if (env.ENABLE_LOCAL_HARNESS_API === 'false') {
        return { ok: false, reason: 'Local harness API is disabled by configuration.' };
    }

    let urlHost = '';
    try {
        urlHost = extractHostname(new URL(request.url).hostname);
    } catch {
        urlHost = '';
    }
    const headerHost = extractHostname(request?.headers?.get?.('host') || '');
    const effectiveHost = headerHost || urlHost;

    if (!LOOPBACK_HOSTS.has(effectiveHost) && !(urlHost && LOOPBACK_HOSTS.has(urlHost) && !headerHost)) {
        return {
            ok: false,
            reason: 'Local harness detection and execution are only available when running locally (localhost).',
        };
    }

    const forwardedFor = request?.headers?.get?.('x-forwarded-for') || '';
    const realIp = request?.headers?.get?.('x-real-ip') || '';
    if (!isLoopbackIp(forwardedFor) || !isLoopbackIp(realIp)) {
        return {
            ok: false,
            reason: 'Local harness API rejected non-loopback forwarded client address.',
        };
    }

    return { ok: true };
}

module.exports = {
    assertLoopbackRequest,
    extractHostname,
    isLoopbackIp,
};
