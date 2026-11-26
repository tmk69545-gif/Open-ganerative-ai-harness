const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localAI', {
    isElectron: true,

    // ── sd.cpp engine ──────────────────────────────────────────────────────
    getBinaryStatus: () => ipcRenderer.invoke('local-ai:binary-status'),
    downloadBinary: () => ipcRenderer.invoke('local-ai:download-binary'),

    listModels: () => ipcRenderer.invoke('local-ai:list-models'),
    downloadModel: (modelId) => ipcRenderer.invoke('local-ai:download-model', modelId),
    downloadAuxiliary: (auxKey) => ipcRenderer.invoke('local-ai:download-auxiliary', auxKey),
    deleteModel: (modelId) => ipcRenderer.invoke('local-ai:delete-model', modelId),
    cancelDownload: (modelId) => ipcRenderer.invoke('local-ai:cancel-download', modelId),

    generate: (params) => ipcRenderer.invoke('local-ai:generate', params),
    cancelGeneration: () => ipcRenderer.invoke('local-ai:cancel-generation'),

    // ── Wan2GP engine (local folder or remote MCP server) ──────────────────
    wan2gp: {
        getConfig:  () => ipcRenderer.invoke('wan2gp:get-config'),
        setConfig:  (cfg) => ipcRenderer.invoke('wan2gp:set-config', cfg),
        setUrl:     (url) => ipcRenderer.invoke('wan2gp:set-url', url),
        check:      (cfg) => ipcRenderer.invoke('wan2gp:check', cfg),
        pickFolder: () => ipcRenderer.invoke('wan2gp:pick-folder'),
        probe:      (url) => ipcRenderer.invoke('wan2gp:probe', url),
        listModels: () => ipcRenderer.invoke('wan2gp:list-models'),
        generate:   (params) => ipcRenderer.invoke('wan2gp:generate', params),
        cancelGeneration: () => ipcRenderer.invoke('wan2gp:cancel-generation'),
        uploadFile: (payload) => ipcRenderer.invoke('wan2gp:upload-file', payload),
    },

    // Progress events — both engines emit on local-ai:progress
    onProgress: (callback) => {
        const listener = (_, data) => callback(data);
        ipcRenderer.on('local-ai:progress', listener);
        return () => ipcRenderer.removeListener('local-ai:progress', listener);
    },
    onDownloadProgress: (callback) => {
        const listener = (_, data) => callback(data);
        ipcRenderer.on('local-ai:download-progress', listener);
        return () => ipcRenderer.removeListener('local-ai:download-progress', listener);
    },
});

contextBridge.exposeInMainWorld('harnesses', {
    isElectron: true,
    detect: (opts) => ipcRenderer.invoke('harness:detect', opts),
    listModels: (harnessId) => ipcRenderer.invoke('harness:list-models', harnessId),
    getOverrides: () => ipcRenderer.invoke('harness:get-overrides'),
    setOverride: (payload) => ipcRenderer.invoke('harness:set-override', payload),
    pickPath: (opts) => ipcRenderer.invoke('harness:pick-path', opts),
    configure: (opts) => ipcRenderer.invoke('harness:configure', opts),
    installSkills: (opts) => ipcRenderer.invoke('harness:install-skills', opts),
    run: (opts) => ipcRenderer.invoke('harness:run', opts),
    cancel: (runId) => ipcRenderer.invoke('harness:cancel', runId),
    synthesizeSpeech: (opts) => ipcRenderer.invoke('harness:synthesize-speech', opts),
    saveMedia: (opts) => ipcRenderer.invoke('harness:save-media', opts),
    onOutput: (callback) => {
        const listener = (_, data) => callback(data);
        ipcRenderer.on('harness:output', listener);
        return () => ipcRenderer.removeListener('harness:output', listener);
    },
});
