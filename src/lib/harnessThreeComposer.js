import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
    getCanvasDimensions,
    normalizeGrade,
    createFilmGrainTile,
    renderColorGradeAndFinish,
    drawOverlayTypography,
    pickSupportedMimeType,
    setupAudioGraph,
} from './harnessVideoComposer.js';

/**
 * Strip ES module import/export boilerplate so AI-generated buildScene code
 * compiles safely inside a scoped builder function.
 */
export function stripModuleBoilerplate(rawCode = '') {
    let code = String(rawCode || '').trim();
    // Remove multi-line or single-line ES imports
    code = code.replace(/^\s*import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*$/gm, '');
    code = code.replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '');
    // Normalize exports
    code = code.replace(/\bexport\s+default\s+function\s+buildScene\b/, 'function buildScene');
    code = code.replace(/\bexport\s+function\s+buildScene\b/, 'function buildScene');
    code = code.replace(/\bexport\s+default\s+buildScene\s*;?/, '');
    code = code.replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, '');
    return code.trim();
}

/**
 * Compile AI-generated Three.js scene source into a callable buildScene factory.
 */
export function compileThreeSceneBuilder(rawCode = '') {
    const cleaned = stripModuleBoilerplate(rawCode);
    if (!cleaned) throw new Error('Three.js scene script is empty.');

    const factory = new Function(
        '"use strict";\n' +
        cleaned +
        '\nif (typeof buildScene === "function") return buildScene;\n' +
        'throw new Error("Three.js code must define function buildScene({ THREE, scene, camera, renderer, width, height, durationSec, utils }).");'
    );
    const buildFn = factory();
    if (typeof buildFn !== 'function') {
        throw new Error('Three.js scene script did not return a buildScene function.');
    }
    return buildFn;
}

function createSoftParticleSprite() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function createThreeUtils({ scene, renderer, disposables }) {
    const trackTex = (tex) => {
        disposables.textures.push(tex);
        return tex;
    };

    return {
        clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
        lerp: (a, b, t) => a + (b - a) * t,
        smoothstep: (e0, e1, x) => {
            const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-6, e1 - e0)));
            return t * t * (3 - 2 * t);
        },
        easeInOut: (t) => {
            const x = Math.max(0, Math.min(1, t));
            return -(Math.cos(Math.PI * x) - 1) / 2;
        },

        createTextTexture({
            text = 'BRAND',
            subtext = '',
            bg = '#0f172a',
            fg = '#ffffff',
            accent = '#22d3ee',
            width = 1024,
            height = 512,
        } = {}) {
            const c = document.createElement('canvas');
            c.width = width;
            c.height = height;
            const ctx = c.getContext('2d');

            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, width, height);

            const grad = ctx.createLinearGradient(0, 0, width, height);
            grad.addColorStop(0, 'rgba(255,255,255,0.08)');
            grad.addColorStop(1, 'rgba(0,0,0,0.25)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            ctx.fillStyle = accent;
            ctx.fillRect(Math.round(width * 0.1), Math.round(height * 0.68), Math.round(width * 0.8), 6);

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = fg;
            ctx.font = `900 ${Math.round(height * 0.28)}px system-ui, -apple-system, Segoe UI, sans-serif`;
            ctx.fillText(String(text || '').slice(0, 28), width / 2, subtext ? height * 0.42 : height * 0.5, width * 0.86);

            if (subtext) {
                ctx.fillStyle = accent;
                ctx.font = `700 ${Math.round(height * 0.11)}px system-ui, -apple-system, Segoe UI, sans-serif`;
                ctx.fillText(String(subtext).slice(0, 44), width / 2, height * 0.8, width * 0.86);
            }

            const tex = new THREE.CanvasTexture(c);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 4);
            return trackTex(tex);
        },

        createSurfaceTexture({
            kind = 'metal',
            primaryColor = '#1e293b',
            secondaryColor = '#0f172a',
            size = 512,
            repeat = 2,
        } = {}) {
            const c = document.createElement('canvas');
            c.width = size;
            c.height = size;
            const ctx = c.getContext('2d');
            ctx.fillStyle = primaryColor;
            ctx.fillRect(0, 0, size, size);

            if (kind === 'grid') {
                ctx.strokeStyle = secondaryColor;
                ctx.lineWidth = 2;
                const step = size / 8;
                for (let i = 0; i <= size; i += step) {
                    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
                }
            } else if (kind === 'metal') {
                for (let y = 0; y < size; y += 2) {
                    ctx.fillStyle = y % 4 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
                    ctx.fillRect(0, y, size, 1);
                }
            } else {
                for (let i = 0; i < 650; i++) {
                    const x = ((i * 73) % size);
                    const y = ((i * 137) % size);
                    ctx.fillStyle = i % 2 === 0 ? `${secondaryColor}33` : 'rgba(255,255,255,0.03)';
                    ctx.fillRect(x, y, 6, 4);
                }
            }

            const tex = new THREE.CanvasTexture(c);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(repeat, repeat);
            return trackTex(tex);
        },

        createStudioStage({
            background = 0x070b12,
            fogColor = 0x070b12,
            fogDensity = 0.035,
            floorColor = 0x101722,
            floorRoughness = 0.25,
            floorMetalness = 0.65,
            accentColor = 0x22d3ee,
            keyIntensity = 3.2,
        } = {}) {
            scene.background = new THREE.Color(background);
            if (fogDensity > 0) {
                scene.fog = new THREE.FogExp2(fogColor, fogDensity);
            }

            const pmrem = new THREE.PMREMGenerator(renderer);
            const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
            scene.environment = envTarget.texture;
            scene.environmentIntensity = 0.85;
            pmrem.dispose();
            disposables.targets.push(envTarget);

            const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x090d14, 0.55);
            scene.add(hemiLight);

            const keyLight = new THREE.DirectionalLight(0xfff7ed, keyIntensity);
            keyLight.position.set(5, 8, 5);
            keyLight.castShadow = true;
            keyLight.shadow.mapSize.set(1024, 1024);
            keyLight.shadow.camera.near = 0.5;
            keyLight.shadow.camera.far = 28;
            const d = 7;
            keyLight.shadow.camera.left = -d;
            keyLight.shadow.camera.right = d;
            keyLight.shadow.camera.top = d;
            keyLight.shadow.camera.bottom = -d;
            keyLight.shadow.bias = -0.0005;
            scene.add(keyLight);

            const rimLight = new THREE.PointLight(accentColor, 40, 22, 2);
            rimLight.position.set(-4.5, 3.2, -3.5);
            scene.add(rimLight);

            const floorGeo = new THREE.CircleGeometry(24, 64);
            const floorMat = new THREE.MeshStandardMaterial({
                color: floorColor,
                roughness: floorRoughness,
                metalness: floorMetalness,
            });
            disposables.geometries.push(floorGeo);
            disposables.materials.push(floorMat);
            const floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI / 2;
            floor.receiveShadow = true;
            scene.add(floor);

            return { floor, keyLight, rimLight, hemiLight };
        },

        createParticleField({
            count = 360,
            color = 0xbae6fd,
            size = 0.14,
            spread = 10,
            speed = 0.65,
            minY = 0.1,
            maxY = 5.5,
            additive = true,
        } = {}) {
            const positions = new Float32Array(count * 3);
            const seeds = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
                const px = (((i * 97) % 1000) / 1000 - 0.5) * spread;
                const py = minY + (((i * 233) % 1000) / 1000) * (maxY - minY);
                const pz = (((i * 419) % 1000) / 1000 - 0.5) * spread;
                positions[i * 3] = px;
                positions[i * 3 + 1] = py;
                positions[i * 3 + 2] = pz;
                seeds[i * 3] = px;
                seeds[i * 3 + 1] = py;
                seeds[i * 3 + 2] = pz;
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const sprite = trackTex(createSoftParticleSprite());
            const mat = new THREE.PointsMaterial({
                color,
                size,
                map: sprite,
                transparent: true,
                opacity: 0.78,
                depthWrite: false,
                blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            });
            disposables.geometries.push(geo);
            disposables.materials.push(mat);

            const points = new THREE.Points(geo, mat);
            scene.add(points);

            return {
                points,
                update(elapsed) {
                    const attr = geo.getAttribute('position');
                    const span = Math.max(0.5, maxY - minY);
                    for (let i = 0; i < count; i++) {
                        const baseX = seeds[i * 3];
                        const baseY = seeds[i * 3 + 1];
                        const baseZ = seeds[i * 3 + 2];
                        attr.setXYZ(
                            i,
                            baseX + Math.sin(elapsed * 0.9 + i) * 0.25,
                            minY + ((baseY - minY + elapsed * speed) % span),
                            baseZ + Math.cos(elapsed * 0.8 + i) * 0.25
                        );
                    }
                    attr.needsUpdate = true;
                },
            };
        },
    };
}

function disposeSceneResources(scene, renderer, composer, disposables) {
    scene.traverse((obj) => {
        if (obj.geometry) {
            try { obj.geometry.dispose(); } catch { /* ignore */ }
        }
        if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const m of mats) {
                for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
                    if (m[key]) {
                        try { m[key].dispose(); } catch { /* ignore */ }
                    }
                }
                try { m.dispose(); } catch { /* ignore */ }
            }
        }
    });
    for (const g of disposables.geometries) try { g.dispose(); } catch { /* ignore */ }
    for (const m of disposables.materials) try { m.dispose(); } catch { /* ignore */ }
    for (const t of disposables.textures) try { t.dispose(); } catch { /* ignore */ }
    for (const rt of disposables.targets) try { rt.dispose(); } catch { /* ignore */ }
    if (scene?.environment?.dispose) try { scene.environment.dispose(); } catch { /* ignore */ }
    if (scene?.background?.dispose) try { scene.background.dispose(); } catch { /* ignore */ }
    try { composer?.dispose?.(); } catch { /* ignore */ }
    try { renderer?.dispose?.(); } catch { /* ignore */ }
}

/**
 * Render an AI-generated Three.js r186 3D scene script with post-processing bloom,
 * color grading, typography overlays, and procedural WebAudio/TTS into playable WebM video.
 */
export async function renderThreeJsVideo({
    threejs,
    aspectRatio = '16:9',
    voiceAudioUrl = null,
    onProgress,
} = {}) {
    if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
        throw new Error('Three.js video rendering requires Chromium MediaRecorder and WebGL support.');
    }

    const builder = compileThreeSceneBuilder(threejs?.code || '');
    const { width, height } = getCanvasDimensions(aspectRatio);

    const glCanvas = document.createElement('canvas');
    glCanvas.width = width;
    glCanvas.height = height;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = width;
    outCanvas.height = height;
    const outCtx = outCanvas.getContext('2d');

    const renderer = new THREE.WebGLRenderer({
        canvas: glCanvas,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
        alpha: false,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
    camera.position.set(0, 1.8, 5.5);

    const disposables = { geometries: [], materials: [], textures: [], targets: [] };
    let composer = null;
    let audioGraph = null;

    try {
        const requestedDur = Math.max(4, Math.min(35, Number(threejs?.durationSec) || 10));
        const utils = createThreeUtils({ scene, renderer, disposables });

        const rawUpdate = builder({
            THREE,
            addons: {
                RoomEnvironment,
                RoundedBoxGeometry,
                EffectComposer,
                RenderPass,
                UnrealBloomPass,
                OutputPass,
            },
            scene,
            camera,
            renderer,
            width,
            height,
            durationSec: requestedDur,
            utils,
        });
        const updateFn = typeof rawUpdate === 'function' ? rawUpdate : (() => {});

        composer = new EffectComposer(renderer);
        composer.setSize(width, height);
        composer.addPass(new RenderPass(scene, camera));
        const bloom = threejs?.bloom || {};
        composer.addPass(new UnrealBloomPass(
            new THREE.Vector2(width, height),
            Number.isFinite(bloom.strength) ? bloom.strength : 0.42,
            Number.isFinite(bloom.radius) ? bloom.radius : 0.4,
            Number.isFinite(bloom.threshold) ? bloom.threshold : 0.85
        ));
        composer.addPass(new OutputPass());

        // Dry-run frame 0 before starting MediaRecorder to fail fast if AI script has a runtime error
        updateFn({ elapsed: 0, progress: 0, delta: 1 / 30 });
        composer.render();

        const overlayScenes = (threejs?.overlays || []).map((o, idx) => ({
            durationSec: Math.max(0.5, (o.end || 4) - (o.start || 0)),
            headline: o.headline,
            subline: o.subline,
            titleStyle: o.style || (idx === threejs.overlays.length - 1 ? 'hero-center' : 'lower-third'),
            transition: idx === 0 ? 'dissolve' : 'flash',
        }));

        audioGraph = await setupAudioGraph({
            voiceAudioUrl,
            baseDurationSec: requestedDur,
            storyboard: {
                audioScript: threejs?.audioScript || '',
                musicMood: threejs?.musicMood || 'cinematic',
                soundEffects: threejs?.soundEffects || '',
                scenes: overlayScenes.length ? overlayScenes : [{ durationSec: requestedDur }],
            },
            aspectRatio,
        });

        const finalDur = audioGraph.finalDur;
        const hasAudio = Boolean(audioGraph?.stream?.getAudioTracks()?.length);
        const mimeType = pickSupportedMimeType(hasAudio);
        if (!mimeType) {
            throw new Error('No supported WebM MediaRecorder codec is available in this runtime.');
        }

        const grade = normalizeGrade(threejs?.grade || 'natural', `${threejs?.audioScript || ''}`);
        const grainPattern = createFilmGrainTile(outCtx);
        const useLetterbox = threejs?.letterbox === true || aspectRatio === '21:9';
        const accentColor = threejs?.accentColor || '#22d3ee';

        const canvasStream = outCanvas.captureStream(30);
        const tracks = [...canvasStream.getVideoTracks(), ...(audioGraph?.stream?.getAudioTracks() || [])];
        const combinedStream = new MediaStream(tracks);

        const chunks = [];
        const recorder = new MediaRecorder(combinedStream, {
            mimeType,
            videoBitsPerSecond: 4_800_000,
        });

        const recordedBlob = await new Promise((resolve, reject) => {
            recorder.ondataavailable = (ev) => {
                if (ev.data && ev.data.size > 0) chunks.push(ev.data);
            };
            recorder.onerror = (ev) => {
                reject(new Error(ev?.error?.message || 'MediaRecorder failed during Three.js capture.'));
            };
            recorder.onstop = () => {
                resolve(new Blob(chunks, { type: mimeType }));
            };

            const startMs = performance.now();
            let lastElapsed = 0;
            let frameIdx = 0;

            const drawCompositeFrame = (elapsedSec) => {
                frameIdx++;
                const delta = Math.max(0.001, Math.min(0.1, elapsedSec - lastElapsed || 1 / 30));
                lastElapsed = elapsedSec;
                const progress = Math.max(0, Math.min(1, elapsedSec / Math.max(0.1, finalDur)));

                try {
                    updateFn({ elapsed: elapsedSec, progress, delta });
                } catch {
                    // Preserve smooth camera fallback if user code hits a mid-timeline edge case
                    const a = progress * Math.PI * 1.5;
                    camera.position.set(Math.sin(a) * 5.2, 1.8, Math.cos(a) * 5.2);
                    camera.lookAt(0, 0.8, 0);
                }

                composer.render();
                outCtx.drawImage(glCanvas, 0, 0, width, height);

                renderColorGradeAndFinish(outCtx, {
                    grade,
                    grainPattern,
                    grainSeed: frameIdx,
                    letterbox: useLetterbox,
                    w: width,
                    h: height,
                });

                for (const ov of threejs?.overlays || []) {
                    if (elapsedSec >= ov.start && elapsedSec <= ov.end) {
                        drawOverlayTypography(
                            outCtx,
                            { headline: ov.headline, subline: ov.subline, titleStyle: ov.style || 'lower-third' },
                            width,
                            height,
                            elapsedSec - ov.start,
                            Math.max(0.6, ov.end - ov.start),
                            accentColor
                        );
                    }
                }
            };

            drawCompositeFrame(0);
            recorder.start(250);

            const timer = setInterval(() => {
                const elapsedSec = (performance.now() - startMs) / 1000;
                if (elapsedSec >= finalDur) {
                    clearInterval(timer);
                    drawCompositeFrame(finalDur - 0.01);
                    onProgress?.({ elapsed: finalDur, total: finalDur, pct: 100 });
                    setTimeout(() => {
                        try { recorder.stop(); } catch { /* ignore */ }
                    }, 120);
                    return;
                }
                drawCompositeFrame(elapsedSec);
                onProgress?.({
                    elapsed: elapsedSec,
                    total: finalDur,
                    pct: Math.min(99, Math.round((elapsedSec / finalDur) * 100)),
                });
            }, 33);
        });

        return {
            blob: recordedBlob,
            bytes: new Uint8Array(await recordedBlob.arrayBuffer()),
            durationSec: finalDur,
            mimeType,
            grade,
        };
    } finally {
        audioGraph?.cleanup?.();
        disposeSceneResources(scene, renderer, composer, disposables);
    }
}
