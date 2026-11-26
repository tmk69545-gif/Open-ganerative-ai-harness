// Frontend client for AI coding/agent harnesses (Antigravity, Claude, OpenCode, Codex)
// Wraps window.harnesses in Electron Desktop.

export const isHarnessAvailable = () =>
    typeof window !== 'undefined' && !!window.harnesses?.isElectron;

class HarnessClient {
    async detect(opts = {}) {
        if (!isHarnessAvailable()) return null;
        return window.harnesses.detect(opts);
    }

    async getOverrides() {
        if (!isHarnessAvailable()) return {};
        return window.harnesses.getOverrides();
    }

    async setOverride(payload) {
        if (!isHarnessAvailable()) throw new Error('System harness overrides are only available in the desktop app.');
        return window.harnesses.setOverride(payload);
    }

    async pickPath(opts = {}) {
        if (!isHarnessAvailable()) return null;
        return window.harnesses.pickPath(opts);
    }

    async configure(opts = {}) {
        if (!isHarnessAvailable()) throw new Error('Automatic MCP config updates are only available in the desktop app.');
        return window.harnesses.configure(opts);
    }

    async installSkills(opts = {}) {
        if (!isHarnessAvailable()) throw new Error('Skills installation is only available in the desktop app.');
        return window.harnesses.installSkills(opts);
    }

    async run(opts = {}) {
        if (!isHarnessAvailable()) throw new Error('Harness execution is only available in the desktop app.');
        return window.harnesses.run(opts);
    }

    async cancel(runId) {
        if (!isHarnessAvailable()) return false;
        return window.harnesses.cancel(runId);
    }

    onOutput(callback) {
        if (!isHarnessAvailable()) return () => {};
        return window.harnesses.onOutput(callback);
    }
}

export const harnessClient = new HarnessClient();
