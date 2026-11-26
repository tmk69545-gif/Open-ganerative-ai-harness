import { startHarnessRun } from '@/lib/harnesses';
import { assertLoopbackRequest } from '@/lib/harnesses/localGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
    const guard = assertLoopbackRequest(request);
    if (!guard.ok) {
        return new Response(
            JSON.stringify({ ok: false, remoteMode: true, error: guard.reason }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const body = await request.json().catch(() => ({}));
    const { harnessId, model, prompt, cwd, mode = 'plan', autoApprove = false } = body;

    if (!harnessId || !prompt || !String(prompt).trim()) {
        return new Response(
            JSON.stringify({ ok: false, error: 'harnessId and prompt are required.' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (payload) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                } catch {
                    // controller already closed
                }
            };

            try {
                const run = await startHarnessRun({
                    harnessId,
                    model: model || undefined,
                    prompt: String(prompt),
                    cwd: cwd || process.cwd(),
                    mode: mode === 'auto' ? 'auto' : 'plan',
                    autoApprove: Boolean(autoApprove),
                    onEvent: (ev) => send(ev),
                });

                const onAbort = () => run.cancel();
                request.signal?.addEventListener('abort', onAbort, { once: true });

                try {
                    const finalRes = await run.done;
                    send({ type: 'complete', ...finalRes });
                } catch (err) {
                    send({ type: 'error', text: err.message });
                } finally {
                    request.signal?.removeEventListener('abort', onAbort);
                    controller.close();
                }
            } catch (err) {
                send({ type: 'error', text: err.message });
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        },
    });
}
