import { NextResponse } from 'next/server';
import { configureHarnessMcp, unconfigureHarnessMcp, installMuapiSkills } from '@/lib/harnesses';
import { assertLoopbackRequest } from '@/lib/harnesses/localGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
    const guard = assertLoopbackRequest(request);
    if (!guard.ok) {
        return NextResponse.json({ ok: false, remoteMode: true, error: guard.reason }, { status: 403 });
    }

    try {
        const body = await request.json().catch(() => ({}));
        const action = body.action || 'configure';

        if (action === 'install-skills') {
            const skillsRes = await installMuapiSkills({ cwd: process.cwd() });
            return NextResponse.json(skillsRes, { status: skillsRes.ok ? 200 : 500 });
        }

        const headerKey = request.headers.get('x-api-key');
        const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim()
            ? body.apiKey.trim()
            : (headerKey ? headerKey.trim() : '');

        const opts = {
            harnessId: body.harnessId || 'all',
            surface: body.surface || 'auto',
            configPath: body.configPath || undefined,
            apiKey,
            apiKeyEnv: body.apiKeyEnv || 'MUAPI_API_KEY',
            dryRun: Boolean(body.dryRun),
        };

        const result = action === 'unconfigure'
            ? unconfigureHarnessMcp(opts)
            : configureHarnessMcp(opts);

        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
}
