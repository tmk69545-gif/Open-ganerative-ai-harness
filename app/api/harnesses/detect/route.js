import { NextResponse } from 'next/server';
import { detectAllHarnesses } from '@/lib/harnesses';
import { assertLoopbackRequest } from '@/lib/harnesses/localGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
    const guard = assertLoopbackRequest(request);
    if (!guard.ok) {
        return NextResponse.json({ ok: false, remoteMode: true, error: guard.reason }, { status: 403 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const harness = searchParams.get('harness');
        const report = await detectAllHarnesses({
            harnessIds: harness && harness !== 'all' ? [harness] : undefined,
            workspaceDir: process.cwd(),
        });
        return NextResponse.json({ ok: true, ...report });
    } catch (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
