/**
 * VoiceForge Call Mode
 * 
 * Real-time voice conversation mode using live transcription.
 * Streams audio to ASR server, accumulates transcriptions, sends on silence.
 */

import {
    eventSource,
    event_types,
    sendMessageAsUser,
    Generate,
    substituteParams,
    cancelTtsPlay,
    saveSettingsDebounced,
    saveSettings,
    stopGeneration,
} from '../../../../../script.js';
import { extension_settings, getContext } from '../../../../extensions.js';

const console = { ...globalThis.console, debug: () => {} };

const DEBUG_PREFIX = '<VoiceForge Call Mode> ';
const MODULE_NAME = 'voiceforge_call_mode';
const WEATHER_FETCH_TIMEOUT_MS = 9000;
const WEATHER_REFRESH_MIN_MINUTES = 5;
const WEATHER_REFRESH_MAX_MINUTES = 180;
const DEFAULT_ASR_MODEL = 'large-v3-turbo';
const SUPPORTED_ASR_MODELS = new Set(['large-v3-turbo', 'glm-asr-nano', 'parakeet-tdt-0.6b-v3']);
const INCOMING_CALL_RING_VOLUME = 0.22;
const OUTGOING_CALL_RING_VOLUME = 0.2;
const OUTGOING_CALL_MIN_RING_MS = 2600;
const CALL_MUTE_SFX_VOLUME = 0.22;

// Call state
let callActive = false;
let callMuted = false;
let callState = 'idle'; // 'idle' | 'listening' | 'processing' | 'speaking'
let randomCallTimer = null;
let randomCallCooldownUntil = 0;
let incomingCallActive = false;
let incomingCallPlayer = null;
let incomingCallTimeout = null;
let incomingCallAudioUrl = null;
let incomingCallAudioResolvePromise = null;
let outgoingCallActive = false;
let outgoingCallPlayer = null;
let outgoingCallAudioUrl = null;
let outgoingCallAudioResolvePromise = null;
let muteSoundPlayer = null;
let muteSoundAudioUrl = null;
let unmuteSoundPlayer = null;
let unmuteSoundAudioUrl = null;

// Audio streaming
let micStream = null;
let audioContext = null;
let scriptProcessor = null;
let scriptProcessorSilentGain = null;

// WebSocket live transcription
let liveWs = null;
let wsReady = false;

// Transcription state
let lastSentText = '';
let lastSendTime = 0;
let lastMetadataTimestampAt = 0;
let weatherCache = null;
let weatherFetchPromise = null;
let weatherInitPromise = null;
let weatherRefreshTimer = null;
let weatherFetchGeneration = 0;
const MIN_SEND_INTERVAL_MS = 500; // 500ms between sends to prevent accidental double-sends
let callSpeechActive = false;
let callUtteranceHasAudio = false;
let lastSpeechFrameAt = 0;
const CLIENT_NOISE_GATE_THRESHOLD = 0.0085;
const CLIENT_SPEECH_HANGOVER_MS = 160;
const CLIENT_NOISE_GATE_RMS_MAX = 0.05;
const CLIENT_PREROLL_MS = 350;
const CLIENT_MIN_UTTERANCE_MS = 450;
const CLIENT_MIN_SPEECH_MS = 160;
const CLIENT_MIN_VOICED_RATIO = 0.18;
const CLIENT_MAX_UTTERANCE_MS = 15000;
let latestMicRms = 0;
let lastMicLevelUiUpdateAt = 0;
let micLevelTestActive = false;
let micLevelTestStream = null;
let micLevelTestContext = null;
let micLevelTestAnalyser = null;
let micLevelTestRafId = null;
let micLevelTestData = null;

// TTS state tracking
let lastTtsEndTime = 0;
const TTS_END_COOLDOWN = 200; // Brief cooldown after TTS to avoid echo
const SUBTITLE_POST_END_CLEAR_MS = 1200;
let callPreRollFrames = [];
let callUtteranceFrames = [];
let callUtteranceSamples = 0;
let callUtteranceSpeechSamples = 0;
let callUtteranceEnergy = 0;
let callUtterancePeakRms = 0;

// UI Elements
let callButton = null;
let subtitleElement = null;
let subtitleClearTimer = null;
let subtitleLineTimers = new Set();
let lastSubtitleText = '';
let lastSubtitleAt = 0;
let lastSubtitleSequence = null;
let activeTtsSequence = null;
let activeTtsRequestId = null;
let lastInterruptAt = 0;
const INTERRUPT_DEBOUNCE_MS = 250;
let overlayResizeFrameId = null;
let overlayResizeSettleTimer = null;
let overlayUiInteractionTimer = null;
let overlayVisualRefreshFrameId = null;
let overlayAnimationFrameId = null;
let overlayCssMotionActive = false;
let overlayCssMotionLastFrameAt = 0;
let qrBarOriginalParent = null;
let qrBarOriginalNextSibling = null;
let qrBarMovedToSendArea = false;
const overlayDomCache = {
    root: null,
    callUi: null,
    content: null,
    backdrop: null,
    effectsLayer: null,
    particleCanvas: null,
    statusText: null,
};
const overlayInlineStyleCache = {
    root: Object.create(null),
    backdrop: Object.create(null),
    vars: Object.create(null),
};
const overlayCanvasParticles = {
    canvas: null,
    ctx: null,
    rafId: null,
    particles: [],
    spriteCache: {
        snow: null,
        firefly: null,
    },
    style: 'snow',
    fallRate: 1,
    fireflyGlow: 1,
    drawWidth: 0,
    drawHeight: 0,
    lastTs: 0,
};
const overlaySpiralCanvas = {
    canvas: null,
    ctx: null,
    active: false,
    drawWidth: 0,
    drawHeight: 0,
    lastTs: 0,
    spinCycleRings: [],
    spinPulseRing: 0,
    spinPulseFrame: 0,
};
const OVERLAY_CANVAS_FRAME_INTERVAL_MS = 1000 / 20;
let waveformAnimationFrameId = null;
let waveformLevelSmoothed = 0;
let waveformBars = [];
let waveformTimeData = null;
let callSfxContext = null;
let lastCallSfxAt = 0;
const CALL_SFX_MIN_INTERVAL_MS = 90;
const CALL_SFX_CANDIDATES = {
    start: ['snap_reverb.mp3'],
    end: ['snap_reverb.mp3'],
};
const CALL_AMBIENT_CANDIDATES = ['callmode_static.mp3'];
const CALL_AMBIENT_VOLUME = 0.05;
const CALL_PARTICLE_AMBIENT_CANDIDATES = {
    snow: ['snow.mp3', 'snow_ambient.mp3'],
    rain: ['rain.mp3', 'storm_light.mp3'],
    firefly: ['fireflies.mp3', 'forest_night.mp3'],
};
const CALL_PARTICLE_AMBIENT_VOLUME = 0.03;
const CALL_PARTICLE_AMBIENT_STYLE_GAIN = {
    firefly: 0.12,
};
const CALL_BREATH_CUE_CANDIDATES = {
    in: ['breathe_in.wav'],
    out: ['breathe_out.wav'],
};
const CALL_BREATH_CUE_VOLUME = 0.01;
const CALL_BREATH_CUE_PERIOD_MS = 9600;
const callSfxUrlCache = { start: null, end: null };
const callSfxResolvePromise = { start: null, end: null };
const callSfxUnavailable = new Set();
const callSfxPlayer = { start: null, end: null };
let lastSpokenSnapCueAt = 0;
const SPOKEN_SNAP_CUE_COOLDOWN_MS = 1200;
let callAmbientUrlCache = null;
let callAmbientResolvePromise = null;
const callAmbientUnavailable = new Set();
let callAmbientPlayer = null;
const callParticleAmbientUrlCache = { snow: null, rain: null, firefly: null };
const callParticleAmbientResolvePromise = { snow: null, rain: null, firefly: null };
const callParticleAmbientUnavailable = new Set();
let callParticleAmbientPlayer = null;
let callParticleAmbientStyle = null;
const callBreathCueUrlCache = { in: null, out: null };
const callBreathCueResolvePromise = { in: null, out: null };
const callBreathCueUnavailable = new Set();
const callBreathCuePlayer = { in: null, out: null };
let callBreathInTimer = null;
let callBreathOutTimer = null;
let callBreathPromptInTimer = null;
let callBreathPromptOutTimer = null;
let callBreathHoldTimer = null;
let hypnoWhisperTimer = null;
let hypnoParticleImpactTimer = null;
let hypnoEasterEggTimer = null;
let tranceDepth = 0;
let tranceDepthDecayTimer = null;
let lastHypnoWhisperText = '';
let hypnoWhisperTickCount = 0;
let lastBreathPromptIn = '';
let lastBreathPromptOut = '';
const hypnoWhisperClearTimers = new Set();
const overlayImpactReleaseTimers = new Map();
const overlayElementPool = {
    whispers: [],
    particles: [],
    impacts: [],
};
const activeOverlayElements = {
    whispers: [],
    particles: [],
    impacts: [],
};
let overlayVisibilityListenerAttached = false;
let overlaySuspendedByVisibility = false;
let overlaySuspendedByUiInteraction = false;
const HYPNO_MAX_ACTIVE_WHISPERS = 2;
const HYPNO_WHISPER_POOL = [
    'relax',
    'drift',
    'deeper',
    'breathe for me',
    'follow my voice',
    'be still for me',
    'soften for me',
    'let your thoughts go',
    'drop your guard',
    'sink for me',
    'listen and obey',
    'empty that mind',
    'melt and yield',
    'submit to calm',
    'good pet',
    'good boy',
    'just like that',
    'nice and deep',
];
const HYPNO_WHISPER_PREWARM = HYPNO_WHISPER_POOL;
const SPOKEN_WHISPER_EVERY_N_VISUALS = 3;
const WHISPER_PREWARM_LIMIT = 6;
const HYPNO_BREATH_PROMPTS_IN = [
    'breathe in for me',
    'inhale nice and slow',
    'in for me now',
    'draw it in and hold',
];
const HYPNO_BREATH_PROMPTS_OUT = [
    'and breathe out',
    'exhale and let go',
    'out for me now',
    'release it all',
];
const VOICEFORGE_PROVIDER_KEY = 'VoiceForge';
const DEFAULT_VOICE_MARKER = '[Default Voice]';
const DISABLED_VOICE_MARKER = 'disabled';
const WHISPER_AUDIO_SETTINGS_CACHE_KEY = 'whisperAudioCache';
const WHISPER_AUDIO_MIN_INTERVAL_MS = 6000;
const whisperAudioPromptsByEndpoint = new Map();
const whisperAudioPromptFetches = new Map();
const whisperPrewarmByCharacter = new Map();
const whisperClipInFlight = new Map();
const activeWhisperPlayers = new Set();
let whisperCharacterHint = null;
let lastWhisperAudioAt = 0;

// Hallucination patterns to filter (common ASR artifacts from Whisper/GLM-ASR)
const HALLUCINATION_PATTERNS = [
    // Filler sounds repeated
    /^(oh[,.\s]*)+$/i,
    /^(uh[,.\s]*)+$/i,
    /^(um[,.\s]*)+$/i,
    /^(ah[,.\s]*)+$/i,
    /^(hm+[,.\s]*)+$/i,
    /^(mm+[,.\s]*)+$/i,
    /^(eh[,.\s]*)+$/i,
    // Punctuation only
    /^[\s.,!?�\-]+$/,
    /^(\.+)$/,
    /^(\.{3,})+$/,
    // YouTube/podcast artifacts
    /^thank(s| you)( for watching)?\.?$/i,
    /^please subscribe\.?$/i,
    /^like and subscribe\.?$/i,
    /^don't forget to subscribe\.?$/i,
    // Single words that are usually noise
    /^you\.?$/i,
    /^yeah\.?$/i,
    /^okay\.?$/i,
    /^yes\.?$/i,
    /^no\.?$/i,
    /^so\.?$/i,
    /^and\.?$/i,
    /^the\.?$/i,
    /^a\.?$/i,
    /^i\.?$/i,
    // Chinese/other language artifacts from GLM
    /^[\u4e00-\u9fff]+$/,  // Chinese characters only
    /^[\u3040-\u309f\u30a0-\u30ff]+$/,  // Japanese only
    // Repeated single characters
    /^(.)\1+$/,
    // Very short nonsense
    /^[a-z]{1,2}\.?$/i,
    // Music/background noise artifacts
    /^\[.*\]$/,  // [Music], [Applause], etc.
    /^\*.*\*$/,
];

// Minimum transcript length to accept (filters out noise)
const MIN_TRANSCRIPT_LENGTH = 3;

function pickRandom(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return '';
    }
    return items[Math.floor(Math.random() * items.length)];
}

function pickRandomNot(items, previousValue = '') {
    if (!Array.isArray(items) || items.length === 0) {
        return '';
    }

    if (items.length === 1) {
        return items[0];
    }

    const prev = String(previousValue || '');
    const filtered = prev ? items.filter((item) => String(item) !== prev) : items;
    const pool = filtered.length > 0 ? filtered : items;
    return pool[Math.floor(Math.random() * pool.length)];
}

function isDocumentHidden() {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function isSettingsUiOpen() {
    const host = document.querySelector('#tts_settings .inline-drawer-content');
    if (!host) {
        return false;
    }

    const style = window.getComputedStyle(host);
    if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
    }

    const rect = host.getBoundingClientRect();
    return host.offsetParent !== null && rect.width > 0 && rect.height > 28;
}

function isGlobalUiPanelOpen() {
    const openDrawerVisible = $('.drawer-content.openDrawer').filter((_, el) => {
        if (el.id === 'voiceforge_call_overlay') {
            return false;
        }
        return $(el).is(':visible');
    }).length > 0;

    if (openDrawerVisible) {
        return true;
    }

    if ($('#extensionsMenu').is(':visible')) {
        return true;
    }

    if ($('dialog[open], .ui-dialog:visible, .popup[open]').length > 0) {
        return true;
    }

    return isSettingsUiOpen();
}

function isMobileCallModeDevice() {
    return window.matchMedia('(max-width: 768px), (max-height: 700px), (pointer: coarse)').matches;
}

function resetOverlayInlineStyleCache() {
    overlayInlineStyleCache.root = Object.create(null);
    overlayInlineStyleCache.backdrop = Object.create(null);
    overlayInlineStyleCache.vars = Object.create(null);
}

function setCachedInlineStyle(element, cacheKey, prop, value) {
    if (!element) {
        return;
    }

    const nextValue = String(value);
    const cache = overlayInlineStyleCache[cacheKey];
    if (cache[prop] === nextValue) {
        return;
    }

    element.style.setProperty(prop, nextValue);
    cache[prop] = nextValue;
}

function removeOverlayActiveElement(poolKey, el) {
    const activeList = activeOverlayElements[poolKey];
    if (!activeList) {
        return;
    }
    const index = activeList.indexOf(el);
    if (index !== -1) {
        activeList.splice(index, 1);
    }
}

function acquireOverlayElement(poolKey, className) {
    const pool = overlayElementPool[poolKey];
    const element = pool && pool.length ? pool.pop() : document.createElement('div');
    element.className = className;
    element.removeAttribute('style');
    element.textContent = '';
    return element;
}

function releaseOverlayElement(poolKey, element) {
    if (!element) {
        return;
    }
    removeOverlayActiveElement(poolKey, element);
    if (element.parentNode) {
        element.parentNode.removeChild(element);
    }
    element.className = '';
    element.removeAttribute('style');
    element.textContent = '';
    const pool = overlayElementPool[poolKey];
    if (pool && pool.length < 600) {
        pool.push(element);
    }
}

function releaseOverlayImpactElement(element) {
    const releaseTimer = overlayImpactReleaseTimers.get(element);
    if (releaseTimer) {
        clearTimeout(releaseTimer);
        overlayImpactReleaseTimers.delete(element);
    }
    releaseOverlayElement('impacts', element);
}

function buildHypnoWhisperText() {
    const phrase = pickRandomNot(HYPNO_WHISPER_POOL, lastHypnoWhisperText) || pickRandom(HYPNO_WHISPER_POOL);
    lastHypnoWhisperText = phrase || lastHypnoWhisperText;
    return phrase;
}

function getSavedTtsVolume() {
    const volumeFromTts = Number(extension_settings.tts?.tts_volume);
    if (Number.isFinite(volumeFromTts)) {
        return Math.max(0, Math.min(100, volumeFromTts));
    }

    const volumeFromPlaybackBar = Number(extension_settings.tts?.playbackBar?.tts_volume);
    if (Number.isFinite(volumeFromPlaybackBar)) {
        return Math.max(0, Math.min(100, volumeFromPlaybackBar));
    }

    return 100;
}

function persistTtsVolume(volume) {
    if (!extension_settings.tts) {
        extension_settings.tts = {};
    }
    if (!extension_settings.tts.playbackBar) {
        extension_settings.tts.playbackBar = { tts_volume: 100, playback_speed: 1.0, auto_hide_delay: 2000 };
    }

    extension_settings.tts.playbackBar.tts_volume = volume;
    extension_settings.tts.tts_volume = volume;
}

function getCallSfxContext() {
    const AudioContextCtor = window.AudioContext;
    if (!AudioContextCtor) {
        return null;
    }

    if (!callSfxContext || callSfxContext.state === 'closed') {
        callSfxContext = new AudioContextCtor();
    }

    if (callSfxContext.state === 'suspended') {
        callSfxContext.resume().catch(() => {});
    }

    return callSfxContext;
}

async function resolveCallSnapAudioUrl(type = 'start') {
    const normalizedType = type === 'end' ? 'end' : 'start';
    if (callSfxUrlCache[normalizedType]) {
        return callSfxUrlCache[normalizedType];
    }
    if (callSfxResolvePromise[normalizedType]) {
        return callSfxResolvePromise[normalizedType];
    }

    callSfxResolvePromise[normalizedType] = (async () => {
        const candidates = CALL_SFX_CANDIDATES[normalizedType] || CALL_SFX_CANDIDATES.start;
        for (const filename of candidates) {
            if (callSfxUnavailable.has(filename)) {
                continue;
            }

            const url = new URL(filename, import.meta.url).href;
            try {
                const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
                if (response.ok) {
                    callSfxUrlCache[normalizedType] = url;
                    return url;
                }
            } catch (e) {
                // Ignore and continue with next candidate.
            }

            callSfxUnavailable.add(filename);
        }

        return null;
    })();

    const resolved = await callSfxResolvePromise[normalizedType];
    callSfxResolvePromise[normalizedType] = null;
    return resolved;
}

async function resolveIncomingCallAudioUrl() {
    if (incomingCallAudioUrl) {
        return incomingCallAudioUrl;
    }
    if (incomingCallAudioResolvePromise) {
        return incomingCallAudioResolvePromise;
    }

    incomingCallAudioResolvePromise = (async () => {
        const url = new URL('Incoming_Call.mp3', import.meta.url).href;
        try {
            const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
            if (response.ok) {
                incomingCallAudioUrl = url;
                return url;
            }
        } catch (e) {
            throw e;
        }
        return null;
    })();

    const resolved = await incomingCallAudioResolvePromise;
    incomingCallAudioResolvePromise = null;
    return resolved;
}

async function resolveOutgoingCallAudioUrl() {
    if (outgoingCallAudioUrl) {
        return outgoingCallAudioUrl;
    }
    if (outgoingCallAudioResolvePromise) {
        return outgoingCallAudioResolvePromise;
    }

    outgoingCallAudioResolvePromise = (async () => {
        const url = new URL('Outgoing_Call.mp3', import.meta.url).href;
        try {
            const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
            if (response.ok) {
                outgoingCallAudioUrl = url;
                return url;
            }
        } catch (e) {
            // Ignore and show the outgoing prompt without sound.
        }
        return null;
    })();

    const resolved = await outgoingCallAudioResolvePromise;
    outgoingCallAudioResolvePromise = null;
    return resolved;
}

async function resolveMuteSoundAudioUrl() {
    if (muteSoundAudioUrl) {
        return muteSoundAudioUrl;
    }

    muteSoundAudioUrl = new URL('Mute.mp3', import.meta.url).href;
    return muteSoundAudioUrl;
}

async function resolveUnmuteSoundAudioUrl() {
    if (unmuteSoundAudioUrl) {
        return unmuteSoundAudioUrl;
    }

    unmuteSoundAudioUrl = new URL('Unmute.mp3', import.meta.url).href;
    return unmuteSoundAudioUrl;
}

function ensureMuteSoundPlayer() {
    const url = muteSoundAudioUrl || new URL('Mute.mp3', import.meta.url).href;
    muteSoundAudioUrl = url;
    if (!muteSoundPlayer) {
        muteSoundPlayer = new Audio(url);
        muteSoundPlayer.preload = 'auto';
        muteSoundPlayer.volume = CALL_MUTE_SFX_VOLUME;
        try {
            muteSoundPlayer.load();
        } catch (e) {
            // Ignore preload failures; play() will retry on click.
        }
    }
    return muteSoundPlayer;
}

function ensureUnmuteSoundPlayer() {
    const url = unmuteSoundAudioUrl || new URL('Unmute.mp3', import.meta.url).href;
    unmuteSoundAudioUrl = url;
    if (!unmuteSoundPlayer) {
        unmuteSoundPlayer = new Audio(url);
        unmuteSoundPlayer.preload = 'auto';
        unmuteSoundPlayer.volume = CALL_MUTE_SFX_VOLUME;
        try {
            unmuteSoundPlayer.load();
        } catch (e) {
            // Ignore preload failures; play() will retry on click.
        }
    }
    return unmuteSoundPlayer;
}

async function resolveCallAmbientAudioUrl() {
    if (callAmbientUrlCache) {
        return callAmbientUrlCache;
    }
    if (callAmbientResolvePromise) {
        return callAmbientResolvePromise;
    }

    callAmbientResolvePromise = (async () => {
        for (const filename of CALL_AMBIENT_CANDIDATES) {
            if (callAmbientUnavailable.has(filename)) {
                continue;
            }

            const url = new URL(filename, import.meta.url).href;
            try {
                const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
                if (response.ok) {
                    callAmbientUrlCache = url;
                    return url;
                }
            } catch (e) {
                // Ignore and continue with next candidate.
            }

            callAmbientUnavailable.add(filename);
        }

        return null;
    })();

    const resolved = await callAmbientResolvePromise;
    callAmbientResolvePromise = null;
    return resolved;
}

function stopCallAmbientLoop(resetPosition = true) {
    if (!callAmbientPlayer) {
        return;
    }

    try {
        callAmbientPlayer.pause();
        if (resetPosition) {
            callAmbientPlayer.currentTime = 0;
        }
    } catch (e) {
        console.debug(DEBUG_PREFIX + 'Ambient loop stop skipped:', e);
    }
}

async function resolveCallParticleAmbientAudioUrl(style = 'snow') {
    const normalizedStyle = style === 'rain' || style === 'firefly' ? style : 'snow';
    if (callParticleAmbientUrlCache[normalizedStyle]) {
        return callParticleAmbientUrlCache[normalizedStyle];
    }
    if (callParticleAmbientResolvePromise[normalizedStyle]) {
        return callParticleAmbientResolvePromise[normalizedStyle];
    }

    callParticleAmbientResolvePromise[normalizedStyle] = (async () => {
        const candidates = CALL_PARTICLE_AMBIENT_CANDIDATES[normalizedStyle] || [];
        for (const filename of candidates) {
            const url = new URL(filename, import.meta.url).href;
            callParticleAmbientUrlCache[normalizedStyle] = url;
            return url;
        }

        return null;
    })();

    const resolved = await callParticleAmbientResolvePromise[normalizedStyle];
    callParticleAmbientResolvePromise[normalizedStyle] = null;
    return resolved;
}

function stopCallParticleAmbientLoop(resetPosition = true) {
    if (!callParticleAmbientPlayer) {
        return;
    }

    try {
        callParticleAmbientPlayer.pause();
        if (resetPosition) {
            callParticleAmbientPlayer.currentTime = 0;
        }
    } catch (e) {
        console.debug(DEBUG_PREFIX + 'Particle ambient stop skipped:', e);
    }
}

function startCallParticleAmbientLoop(forceStyle = null) {
    if (!isHypnoFeatureEnabled('hypnoAmbientEnabled') || !isHypnoFeatureEnabled('hypnoParticlesEnabled')) {
        stopCallParticleAmbientLoop(false);
        return;
    }

    const style = forceStyle || getHypnoParticleStyle();
    if (callParticleAmbientStyle !== style) {
        stopCallParticleAmbientLoop(true);
        callParticleAmbientStyle = style;
    }

    resolveCallParticleAmbientAudioUrl(style)
        .then((url) => {
            if (!url || !callActive || !isHypnoFeatureEnabled('hypnoAmbientEnabled') || !isHypnoFeatureEnabled('hypnoParticlesEnabled')) {
                return;
            }

            try {
                const player = callParticleAmbientPlayer || new Audio(url);
                player.src = url;
                player.preload = 'auto';
                player.loop = true;
                player.volume = toParticleAmbientVolume(getHypnoAmbientParticleVolume(), style);
                player.currentTime = 0;
                callParticleAmbientPlayer = player;
                callParticleAmbientStyle = style;
                player.play().catch(() => {});
            } catch (e) {
                console.debug(DEBUG_PREFIX + 'Particle ambient play skipped:', e);
            }
        })
        .catch(() => {});
}

function startCallAmbientLoop() {
    if (!isHypnoFeatureEnabled('hypnoAmbientEnabled')) {
        return;
    }

    resolveCallAmbientAudioUrl()
        .then((url) => {
            if (!url || !callActive || !isHypnoFeatureEnabled('hypnoAmbientEnabled')) {
                return;
            }

            try {
                const player = callAmbientPlayer || new Audio(url);
                player.src = url;
                player.preload = 'auto';
                player.loop = true;
                player.volume = toPerceptualAmbientVolume(getHypnoAmbientBaseVolume());
                player.currentTime = 0;
                callAmbientPlayer = player;
                player.play().catch(() => {});
                startCallParticleAmbientLoop();
            } catch (e) {
                console.debug(DEBUG_PREFIX + 'Ambient loop play skipped:', e);
            }
        })
        .catch(() => {});
}

function shouldRunCallBreathCueLoop() {
    const settings = extension_settings[MODULE_NAME] || {};
    return isHypnoFeatureEnabled('hypnoBreathCuesEnabled') && callActive && settings.overlayEnabled === true;
}

async function resolveCallBreathCueAudioUrl(type = 'in') {
    const normalizedType = type === 'out' ? 'out' : 'in';
    if (callBreathCueUrlCache[normalizedType]) {
        return callBreathCueUrlCache[normalizedType];
    }
    if (callBreathCueResolvePromise[normalizedType]) {
        return callBreathCueResolvePromise[normalizedType];
    }

    callBreathCueResolvePromise[normalizedType] = (async () => {
        const candidates = CALL_BREATH_CUE_CANDIDATES[normalizedType] || CALL_BREATH_CUE_CANDIDATES.in;
        for (const filename of candidates) {
            if (callBreathCueUnavailable.has(filename)) {
                continue;
            }

            const url = new URL(filename, import.meta.url).href;
            try {
                const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
                if (response.ok) {
                    callBreathCueUrlCache[normalizedType] = url;
                    return url;
                }
            } catch (e) {
                // Ignore and continue with next candidate.
            }

            callBreathCueUnavailable.add(filename);
        }

        return null;
    })();

    const resolved = await callBreathCueResolvePromise[normalizedType];
    callBreathCueResolvePromise[normalizedType] = null;
    return resolved;
}

function playCallBreathCue(type = 'in') {
    const normalizedType = type === 'out' ? 'out' : 'in';

    resolveCallBreathCueAudioUrl(normalizedType)
        .then((url) => {
            if (!url || !shouldRunCallBreathCueLoop()) {
                return;
            }

            try {
                const player = callBreathCuePlayer[normalizedType] || new Audio(url);
                player.src = url;
                player.preload = 'auto';
                player.loop = false;
                player.playbackRate = 0.92;
                player.volume = toPerceptualAmbientVolume(getHypnoBreathCueVolume());
                player.currentTime = 0;
                callBreathCuePlayer[normalizedType] = player;
                player.play().catch(() => {});
            } catch (e) {
                console.debug(DEBUG_PREFIX + 'Breath cue play skipped:', e);
            }
        })
        .catch(() => {});
}

async function playBreathGuidancePrompt(type = 'in') {
    if (!isHypnoBreathGuidanceEnabled() || !callActive) {
        return false;
    }

    const prompts = type === 'out' ? HYPNO_BREATH_PROMPTS_OUT : HYPNO_BREATH_PROMPTS_IN;
    const previous = type === 'out' ? lastBreathPromptOut : lastBreathPromptIn;
    const phrase = pickRandomNot(prompts, previous);
    if (!phrase) {
        return false;
    }

    if (type === 'out') {
        lastBreathPromptOut = phrase;
    } else {
        lastBreathPromptIn = phrase;
    }

    const charName = whisperCharacterHint || getCharacterNameFallback();
    const clip = await loadWhisperClip(phrase, charName);
    if (!clip || !callActive || !isHypnoBreathGuidanceEnabled()) {
        return false;
    }

    const objectUrl = URL.createObjectURL(clip);
    const player = new Audio(objectUrl);
    activeWhisperPlayers.add(player);
    const cleanup = () => {
        activeWhisperPlayers.delete(player);
        URL.revokeObjectURL(objectUrl);
    };

    player.preload = 'auto';
    player.volume = toPerceptualAmbientVolume(getHypnoBreathGuidanceVolume());
    player.playbackRate = 0.9 + Math.random() * 0.06;
    player.currentTime = 0;
    player.onended = cleanup;
    player.onerror = cleanup;
    try {
        await player.play();
        bumpTranceDepth(0.035);
        return true;
    } catch (e) {
        cleanup();
        return false;
    }
}

function applyBreathVisualPhase(phase = 'idle') {
    const overlay = $('#voiceforge_call_overlay');
    const strength = getHypnoBreathVisualStrength();
    const inScale = 1 + (0.08 * strength);
    const holdScale = 1 + (0.06 * strength);
    const outScale = 1 - (0.05 * strength);

    if (overlay.length) {
        overlay.attr('data-breath-phase', phase);
        const targetScale = phase === 'in' ? inScale : phase === 'hold' ? holdScale : phase === 'out' ? outScale : 1;
        overlay.css('--vf-breath-scale', targetScale.toFixed(3));
    }
}

function runBreathPhase(type = 'in') {
    if (!callActive || !shouldRunCallBreathCueLoop()) {
        return;
    }

    bumpTranceDepth(type === 'in' ? 0.02 : 0.014);
    applyBreathVisualPhase(type);
    playCallBreathCue(type);
}

function scheduleBreathPhaseWithGuidance(type = 'in', phaseStartDelayMs = 0) {
    const leadMs = getHypnoBreathGuidanceLeadMs();
    const hasGuidance = isHypnoBreathGuidanceEnabled() && leadMs > 0;
    const guidanceStartDelay = hasGuidance ? Math.max(0, phaseStartDelayMs - leadMs) : phaseStartDelayMs;

    return setTimeout(() => {
        if (!callActive || !shouldRunCallBreathCueLoop()) {
            return;
        }

        if (!hasGuidance) {
            runBreathPhase(type);
            return;
        }

        playBreathGuidancePrompt(type)
            .then((started) => {
                if (!callActive || !shouldRunCallBreathCueLoop()) {
                    return;
                }
                if (started) {
                    setTimeout(() => {
                        if (callActive && shouldRunCallBreathCueLoop()) {
                            runBreathPhase(type);
                        }
                    }, leadMs);
                } else {
                    runBreathPhase(type);
                }
            })
            .catch(() => {
                if (callActive && shouldRunCallBreathCueLoop()) {
                    runBreathPhase(type);
                }
            });
    }, guidanceStartDelay);
}

function stopCallBreathCueLoop(resetPosition = true) {
    if (callBreathInTimer) {
        clearTimeout(callBreathInTimer);
        callBreathInTimer = null;
    }
    if (callBreathOutTimer) {
        clearTimeout(callBreathOutTimer);
        callBreathOutTimer = null;
    }
    if (callBreathPromptInTimer) {
        clearTimeout(callBreathPromptInTimer);
        callBreathPromptInTimer = null;
    }
    if (callBreathPromptOutTimer) {
        clearTimeout(callBreathPromptOutTimer);
        callBreathPromptOutTimer = null;
    }
    if (callBreathHoldTimer) {
        clearTimeout(callBreathHoldTimer);
        callBreathHoldTimer = null;
    }

    applyBreathVisualPhase('idle');
    if (callButton) {
        callButton.classList.remove('vf-breath-hold');
        callButton.style.transform = '';
    }

    for (const type of ['in', 'out']) {
        const player = callBreathCuePlayer[type];
        if (!player) {
            continue;
        }

        try {
            player.pause();
            if (resetPosition) {
                player.currentTime = 0;
            }
        } catch (e) {
            console.debug(DEBUG_PREFIX + 'Breath cue stop skipped:', e);
        }
    }
}

function startCallBreathCueLoop() {
    stopCallBreathCueLoop(false);

    const tick = () => {
        if (!shouldRunCallBreathCueLoop()) {
            stopCallBreathCueLoop(false);
            return;
        }

        const inhaleMs = getHypnoBreathInDurationMs();
        const holdMs = getHypnoBreathHoldDurationMs();
        const exhaleMs = getHypnoBreathOutDurationMs();
        const restMs = getHypnoBreathRestDurationMs();
        const cycleMs = inhaleMs + holdMs + exhaleMs + restMs;

        callBreathPromptInTimer = scheduleBreathPhaseWithGuidance('in', 0);

        callBreathHoldTimer = setTimeout(() => {
            if (shouldRunCallBreathCueLoop()) {
                applyBreathVisualPhase('hold');
            }
        }, inhaleMs);

        callBreathOutTimer = scheduleBreathPhaseWithGuidance('out', inhaleMs + holdMs);

        callBreathPromptOutTimer = setTimeout(() => {
            if (shouldRunCallBreathCueLoop()) {
                applyBreathVisualPhase('idle');
            }
        }, inhaleMs + holdMs + exhaleMs);

        callBreathInTimer = setTimeout(tick, cycleMs);
    };

    tick();
}

function stopHypnoWhispers() {
    hypnoWhisperTickCount = 0;

    if (hypnoWhisperTimer) {
        clearTimeout(hypnoWhisperTimer);
        hypnoWhisperTimer = null;
    }

    for (const timerId of hypnoWhisperClearTimers) {
        clearTimeout(timerId);
    }
    hypnoWhisperClearTimers.clear();

    while (activeOverlayElements.whispers.length) {
        releaseOverlayElement('whispers', activeOverlayElements.whispers[activeOverlayElements.whispers.length - 1]);
    }

    while (activeOverlayElements.particles.length) {
        releaseOverlayElement('particles', activeOverlayElements.particles[activeOverlayElements.particles.length - 1]);
    }

    while (activeOverlayElements.impacts.length) {
        releaseOverlayImpactElement(activeOverlayElements.impacts[activeOverlayElements.impacts.length - 1]);
    }

    for (const releaseTimerId of overlayImpactReleaseTimers.values()) {
        clearTimeout(releaseTimerId);
    }
    overlayImpactReleaseTimers.clear();

    if (hypnoParticleImpactTimer) {
        clearTimeout(hypnoParticleImpactTimer);
        hypnoParticleImpactTimer = null;
    }

    stopOverlayParticleCanvas(true);
}

function applyTranceDepth() {
    const overlay = $('#voiceforge_call_overlay');
    if (!overlay.length) {
        return;
    }
    overlay.css('--vf-trance-depth', String(Math.max(0, Math.min(1, tranceDepth))));
}

function decayTranceDepthTick() {
    if (!callActive || !extension_settings[MODULE_NAME]?.overlayEnabled) {
        tranceDepthDecayTimer = null;
        return;
    }

    tranceDepth = Math.max(0, tranceDepth - 0.035);
    applyTranceDepth();
    if (tranceDepth > 0) {
        tranceDepthDecayTimer = setTimeout(decayTranceDepthTick, 1200);
    } else {
        tranceDepthDecayTimer = null;
    }
}

function bumpTranceDepth(amount = 0.06) {
    tranceDepth = Math.max(0, Math.min(1, tranceDepth + amount));
    applyTranceDepth();
    if (tranceDepthDecayTimer) {
        clearTimeout(tranceDepthDecayTimer);
    }
    tranceDepthDecayTimer = setTimeout(decayTranceDepthTick, 1300);
}

function stopHypnoEasterEggs() {
    if (hypnoEasterEggTimer) {
        clearTimeout(hypnoEasterEggTimer);
        hypnoEasterEggTimer = null;
    }

    if (tranceDepthDecayTimer) {
        clearTimeout(tranceDepthDecayTimer);
        tranceDepthDecayTimer = null;
    }

    const overlay = $('#voiceforge_call_overlay');
    overlay.removeClass('vf-eegg-vignette-pulse vf-eegg-focus-lock vf-eegg-time-slip vf-eegg-firefly-swarm vf-eegg-phase-lock vf-eegg-bloom');
    overlay.find('.vf-eegg-sigil').remove();
    tranceDepth = 0;
    lastHypnoWhisperText = '';
    lastBreathPromptIn = '';
    lastBreathPromptOut = '';
    applyTranceDepth();
}

function spawnEasterEggSigil() {
    const overlay = document.getElementById('voiceforge_call_overlay');
    if (!overlay) {
        return;
    }

    const phrases = ['focus', 'deeper', 'good', 'obey', 'soft', 'still', 'listen', 'drift'];
    const sigil = document.createElement('div');
    sigil.className = 'vf-eegg-sigil';
    sigil.textContent = pickRandom(phrases);
    const x = 18 + Math.random() * 64;
    const y = 18 + Math.random() * 62;
    const rot = -12 + Math.random() * 24;
    sigil.style.left = `${x}%`;
    sigil.style.top = `${y}%`;
    sigil.style.setProperty('--vf-sigil-rot', `${rot}deg`);
    sigil.style.setProperty('--vf-sigil-scale', `${(0.94 + Math.random() * 0.22).toFixed(3)}`);
    overlay.appendChild(sigil);
    setTimeout(() => sigil.remove(), 2600 + Math.floor(Math.random() * 1400));
}

function playMicroEarTone() {
    const ctx = getCallSfxContext();
    if (!ctx) {
        return;
    }

    try {
        const start = ctx.currentTime + 0.01;
        const duration = 0.22;
        const end = start + duration;
        const pan = (Math.random() < 0.5 ? -1 : 1) * (0.38 + Math.random() * 0.35);

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(640 + Math.random() * 260, start);
        osc.frequency.exponentialRampToValueAtTime(420 + Math.random() * 170, end);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.009, start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);

        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(pan, start);

        osc.connect(gain);
        gain.connect(panner);
        panner.connect(ctx.destination);

        osc.start(start);
        osc.stop(end);
    } catch (e) {
        // Ignore micro-tone failures.
    }
}

function triggerHypnoEasterEgg() {
    const overlay = $('#voiceforge_call_overlay');
    if (!overlay.length) {
        return;
    }

    const depth = Math.max(0, Math.min(1, tranceDepth));
    const roll = Math.random();

    if (roll < (0.22 + depth * 0.16)) {
        overlay.addClass('vf-eegg-vignette-pulse');
        setTimeout(() => overlay.removeClass('vf-eegg-vignette-pulse'), 1700 + Math.floor(900 * (1 - depth)));
    } else if (roll < (0.44 + depth * 0.15)) {
        overlay.addClass('vf-eegg-focus-lock');
        setTimeout(() => overlay.removeClass('vf-eegg-focus-lock'), 2600 + Math.floor(1800 * (1 - depth)));
    } else if (roll < (0.68 + depth * 0.12)) {
        overlay.addClass('vf-eegg-time-slip');
        setTimeout(() => overlay.removeClass('vf-eegg-time-slip'), 2400 + Math.floor(1500 * (1 - depth)));
    } else if (roll < 0.9) {
        overlay.addClass('vf-eegg-phase-lock');
        setTimeout(() => overlay.removeClass('vf-eegg-phase-lock'), 2600 + Math.floor(1200 * (1 - depth)));
    } else {
        if (getHypnoParticleStyle() === 'firefly') {
            overlay.addClass('vf-eegg-firefly-swarm');
            setTimeout(() => overlay.removeClass('vf-eegg-firefly-swarm'), 3200 + Math.floor(1800 * (1 - depth)));
        }
        if (depth > 0.35 && Math.random() < (0.4 + depth * 0.45)) {
            overlay.addClass('vf-eegg-bloom');
            setTimeout(() => overlay.removeClass('vf-eegg-bloom'), 1700 + Math.floor(700 * Math.random()));
        }
        playMicroEarTone();
    }

    if (depth > 0.22 && Math.random() < (0.18 + depth * 0.45)) {
        spawnEasterEggSigil();
    }
}

function startHypnoEasterEggs() {
    if (hypnoEasterEggTimer) {
        clearTimeout(hypnoEasterEggTimer);
        hypnoEasterEggTimer = null;
    }

    const tick = () => {
        if (!callActive || !areHypnoticEffectsEnabled() || !extension_settings[MODULE_NAME]?.overlayEnabled || isDocumentHidden()) {
            hypnoEasterEggTimer = null;
            return;
        }

        triggerHypnoEasterEgg();
        const depth = Math.max(0, Math.min(1, tranceDepth));
        const minMs = Math.max(6000, 18000 - Math.floor(depth * 11000));
        const maxMs = Math.max(minMs + 1200, 32000 - Math.floor(depth * 17000));
        const nextMs = minMs + Math.floor(Math.random() * (maxMs - minMs));
        hypnoEasterEggTimer = setTimeout(tick, nextMs);
    };

    hypnoEasterEggTimer = setTimeout(tick, 12000 + Math.floor(Math.random() * 7000));
}

function ensureOverlayParticleCanvas() {
    const overlay = document.getElementById('voiceforge_call_overlay');
    if (!overlay) {
        return null;
    }

    if (!overlayCanvasParticles.canvas || !overlay.contains(overlayCanvasParticles.canvas)) {
        const canvas = overlay.querySelector('.vf-call-particle-canvas');
        if (!canvas) {
            overlayCanvasParticles.canvas = null;
            overlayCanvasParticles.ctx = null;
            return null;
        }

        overlayCanvasParticles.canvas = canvas;
        overlayCanvasParticles.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
        overlayCanvasParticles.drawWidth = 0;
        overlayCanvasParticles.drawHeight = 0;
    }

    return overlayCanvasParticles.canvas;
}

function ensureOverlaySpiralCanvas() {
    const overlay = document.getElementById('voiceforge_call_overlay');
    if (!overlay) {
        return null;
    }

    if (!overlaySpiralCanvas.canvas || !overlay.contains(overlaySpiralCanvas.canvas)) {
        let canvas = overlay.querySelector('.vf-call-spiral-canvas');
        if (!canvas) {
            const effectsLayer = overlay.querySelector('.vf-call-effects-layer');
            if (effectsLayer) {
                canvas = document.createElement('canvas');
                canvas.className = 'vf-call-spiral-canvas';
                effectsLayer.prepend(canvas);
            }
        }
        if (!canvas) {
            overlaySpiralCanvas.canvas = null;
            overlaySpiralCanvas.ctx = null;
            return null;
        }

        overlaySpiralCanvas.canvas = canvas;
        overlaySpiralCanvas.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
        overlaySpiralCanvas.drawWidth = 0;
        overlaySpiralCanvas.drawHeight = 0;
    }

    return overlaySpiralCanvas.canvas;
}

function resizeOverlayParticleCanvas(force = false) {
    const canvas = ensureOverlayParticleCanvas();
    const ctx = overlayCanvasParticles.ctx;
    if (!canvas || !ctx) {
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const drawWidth = Math.max(1, Math.round(rect.width));
    const drawHeight = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, Math.min(1.5, window.devicePixelRatio || 1));
    const nextWidth = Math.max(1, Math.round(drawWidth * dpr));
    const nextHeight = Math.max(1, Math.round(drawHeight * dpr));

    if (!force && canvas.width === nextWidth && canvas.height === nextHeight && overlayCanvasParticles.drawWidth === drawWidth && overlayCanvasParticles.drawHeight === drawHeight) {
        return;
    }

    canvas.width = nextWidth;
    canvas.height = nextHeight;
    overlayCanvasParticles.drawWidth = drawWidth;
    overlayCanvasParticles.drawHeight = drawHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resizeOverlaySpiralCanvas(force = false) {
    const canvas = ensureOverlaySpiralCanvas();
    const ctx = overlaySpiralCanvas.ctx;
    if (!canvas || !ctx) {
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const drawWidth = Math.max(1, Math.round(rect.width));
    const drawHeight = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, Math.min(1.5, window.devicePixelRatio || 1));
    const nextWidth = Math.max(1, Math.round(drawWidth * dpr));
    const nextHeight = Math.max(1, Math.round(drawHeight * dpr));

    if (!force && canvas.width === nextWidth && canvas.height === nextHeight && overlaySpiralCanvas.drawWidth === drawWidth && overlaySpiralCanvas.drawHeight === drawHeight) {
        return;
    }

    canvas.width = nextWidth;
    canvas.height = nextHeight;
    overlaySpiralCanvas.drawWidth = drawWidth;
    overlaySpiralCanvas.drawHeight = drawHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function hasActiveOverlayAnimationWork() {
    return overlayCssMotionActive || overlaySpiralCanvas.active || overlayCanvasParticles.rafId !== null || waveformAnimationFrameId !== null;
}

function updateOverlayCssMotionFrame(ts) {
    if (!overlayCssMotionActive || !callActive || isDocumentHidden() || !extension_settings[MODULE_NAME]?.overlayEnabled) {
        overlayCssMotionActive = false;
        return false;
    }

    const now = Number.isFinite(ts) ? ts : performance.now();
    if (overlayCssMotionLastFrameAt !== 0 && (now - overlayCssMotionLastFrameAt) < WAVEFORM_FRAME_INTERVAL_MS) {
        return true;
    }
    overlayCssMotionLastFrameAt = now;

    const overlay = overlayDomCache.root?.[0] || document.getElementById('voiceforge_call_overlay');
    if (!overlay) {
        overlayCssMotionActive = false;
        return false;
    }

    const t = now / 1000;
    const breath = (Math.sin(t * 0.46) + 1) * 0.5;
    const slow = (Math.sin(t * 0.073) + 1) * 0.5;
    const drift = Math.sin(t * 0.19) * 0.62 + Math.sin(t * 0.047) * 0.32;
    const lift = Math.cos(t * 0.16) * 0.48 + Math.sin(t * 0.061) * 0.22;
    const depth = Math.max(0, Math.min(1, tranceDepth));

    setCachedInlineStyle(overlay, 'vars', '--vf-overlay-smoke-x', `${drift.toFixed(3)}%`);
    setCachedInlineStyle(overlay, 'vars', '--vf-overlay-smoke-y', `${lift.toFixed(3)}%`);
    setCachedInlineStyle(overlay, 'vars', '--vf-overlay-smoke-scale', (1.01 + breath * 0.01 + slow * 0.008).toFixed(4));
    setCachedInlineStyle(overlay, 'vars', '--vf-overlay-smoke-opacity', (0.24 + breath * 0.045 + depth * 0.035).toFixed(3));
    setCachedInlineStyle(overlay, 'vars', '--vf-overlay-vignette-opacity', (0.42 + depth * 0.16 + breath * 0.045).toFixed(3));
    setCachedInlineStyle(overlay, 'vars', '--vf-overlay-grid-y', `${((t * 0.62) % 72).toFixed(2)}px`);
    setCachedInlineStyle(overlay, 'vars', '--vf-overlay-aurora-rot', `${((t * -0.92) % 360).toFixed(2)}deg`);
    setCachedInlineStyle(overlay, 'vars', '--vf-overlay-aurora-opacity', (0.22 + slow * 0.08 + depth * 0.04).toFixed(3));
    setCachedInlineStyle(overlay, 'vars', '--vf-overlay-content-y', `${(Math.sin(t * 0.38) * 1.15).toFixed(2)}px`);
    setCachedInlineStyle(overlay, 'vars', '--vf-overlay-screen-flash-opacity', '0');

    const rings = overlay._vfCallRings || (overlay._vfCallRings = Array.from(overlay.querySelectorAll('.vf-ring')));
    for (let i = 0; i < rings.length; i++) {
        const phase = ((t * 0.11) + (i * 0.33)) % 1;
        const scale = 0.94 + phase * 0.52;
        const opacity = phase < 0.12
            ? phase / 0.12 * 0.22
            : Math.max(0, 0.22 * (1 - ((phase - 0.12) / 0.88)));
        const ring = rings[i];
        ring.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)}) rotate(${(phase * 180).toFixed(2)}deg)`;
        ring.style.opacity = opacity.toFixed(3);
        ring.style.borderWidth = `${Math.max(0.5, 2 - phase * 1.5).toFixed(2)}px`;
    }
    return true;
}

function stopOverlayAnimationLoopIfIdle() {
    if (hasActiveOverlayAnimationWork()) {
        return;
    }
    if (overlayAnimationFrameId !== null) {
        cancelAnimationFrame(overlayAnimationFrameId);
        overlayAnimationFrameId = null;
    }
}

function runOverlayAnimationFrame(ts) {
    overlayAnimationFrameId = null;

    const cssMotionActive = updateOverlayCssMotionFrame(ts);
    const spiralActive = renderOverlaySpiralCanvas(ts);
    const particlesActive = renderOverlayParticleCanvas(ts);
    const waveformActive = updateCallWaveformFrame(ts);

    if (cssMotionActive || spiralActive || particlesActive || waveformActive) {
        overlayAnimationFrameId = requestAnimationFrame(runOverlayAnimationFrame);
    }
}

function ensureOverlayAnimationLoop() {
    if (overlayAnimationFrameId !== null || !hasActiveOverlayAnimationWork()) {
        return;
    }
    overlayAnimationFrameId = requestAnimationFrame(runOverlayAnimationFrame);
}

function startOverlayCssMotion() {
    if (isDocumentHidden()) {
        return;
    }
    overlayCssMotionActive = true;
    overlayCssMotionLastFrameAt = 0;
    ensureOverlayAnimationLoop();
}

function stopOverlayCssMotion() {
    overlayCssMotionActive = false;
    overlayCssMotionLastFrameAt = 0;
    stopOverlayAnimationLoopIfIdle();
}

function startOverlaySpiralCanvas() {
    if (isDocumentHidden()) {
        return;
    }
    overlaySpiralCanvas.active = true;
    overlaySpiralCanvas.lastTs = 0;
    ensureOverlaySpiralCanvas();
    resizeOverlaySpiralCanvas(true);
    ensureOverlayAnimationLoop();
}

function stopOverlaySpiralCanvas(clearFrame = true) {
    overlaySpiralCanvas.active = false;
    overlaySpiralCanvas.lastTs = 0;
    overlaySpiralCanvas.spinCycleRings = [];
    overlaySpiralCanvas.spinPulseRing = 0;
    overlaySpiralCanvas.spinPulseFrame = 0;

    if (clearFrame && overlaySpiralCanvas.ctx && overlaySpiralCanvas.drawWidth > 0 && overlaySpiralCanvas.drawHeight > 0) {
        overlaySpiralCanvas.ctx.clearRect(0, 0, overlaySpiralCanvas.drawWidth, overlaySpiralCanvas.drawHeight);
    }
    stopOverlayAnimationLoopIfIdle();
}

function removeOverlaySpiralCanvas() {
    stopOverlaySpiralCanvas(true);
    overlaySpiralCanvas.canvas?.remove();
    overlaySpiralCanvas.canvas = null;
    overlaySpiralCanvas.ctx = null;
}

function drawOverlayVortexDots(ctx, width, height, now, reactiveLevel) {
    const maxRadius = Math.sqrt(width * width + height * height) * 0.55;
    const dotCount = Math.min(1000, Math.max(420, Math.floor(maxRadius * 1.25)));
    const angleSpeed = now * 0.031;
    const radiusStep = maxRadius / dotCount;
    const centerX = width / 2;
    const centerY = height / 2;
    const dotSize = Math.max(2.0, Math.min(5.2, Math.min(width, height) / 180));

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < dotCount; i++) {
        const radius = i * radiusStep;
        if (radius < 18) continue;
        const angle = i + angleSpeed;
        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);
        const progress = i / dotCount;
        const alpha = Math.max(0.014, Math.min(0.13, 0.02 + progress * 0.07 + reactiveLevel * 0.035));
        const warm = Math.floor(168 + progress * 72);
        const plum = Math.floor(96 + progress * 58);
        ctx.fillStyle = i % 5 === 0
            ? `rgba(${plum}, 74, 128, ${alpha.toFixed(3)})`
            : `rgba(255, ${warm}, 104, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, dotSize * (0.62 + progress * 0.48), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function rebuildOverlaySpinCycleRings(width, height) {
    const maxRadius = Math.sqrt(width * width + height * height) * 0.54;
    const ballCount = 20;
    const angleSlice = (Math.PI * 2) / ballCount;
    const rings = [];
    let radius = 4;
    let ballSize = 2;
    let offset = false;
    while (radius < maxRadius) {
        const angleMod = offset ? angleSlice * 0.5 : 0;
        const speed = offset ? 0.02 : -0.02;
        rings.push({ radius, angleMod, speed, baseAngle: 0 });
        offset = !offset;
        radius += ballSize;
        ballSize *= 1.3;
    }
    overlaySpiralCanvas.spinCycleRings = rings;
    overlaySpiralCanvas.spinPulseRing = rings.length + 2;
    overlaySpiralCanvas.spinPulseFrame = 0;
}

function drawOverlaySpinCycle(ctx, width, height, frameScale, reactiveLevel) {
    if (!overlaySpiralCanvas.spinCycleRings.length) {
        rebuildOverlaySpinCycleRings(width, height);
    }

    const rings = overlaySpiralCanvas.spinCycleRings;
    const ballCount = 20;
    const angleSlice = (Math.PI * 2) / ballCount;
    const centerX = width / 2;
    const centerY = height / 2;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.globalCompositeOperation = 'lighter';
    for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];
        ring.baseAngle += ring.speed * frameScale;
        const progress = rings.length > 1 ? r / (rings.length - 1) : 0;
        const diameter = Math.max(2, 0.7 * ((Math.PI * 2 * ring.radius) / ballCount));
        const pulseDistance = Math.abs(r - overlaySpiralCanvas.spinPulseRing);
        const shadow = pulseDistance === 0 ? 0.42 : pulseDistance === 1 ? 0.52 : pulseDistance === 2 ? 0.63 : pulseDistance === 3 ? 0.75 : pulseDistance === 4 ? 0.86 : 1;
        const alpha = Math.max(0.006, Math.min(0.065, (0.011 + progress * 0.032 + reactiveLevel * 0.014) * shadow));
        for (let i = 0; i < ballCount; i++) {
            const angle = (i * angleSlice) + ring.angleMod + ring.baseAngle;
            const x = ring.radius * Math.cos(angle);
            const y = ring.radius * Math.sin(angle);
            ctx.fillStyle = i % 4 === 0
                ? `rgba(142, 92, 146, ${alpha.toFixed(3)})`
                : `rgba(255, 176, 104, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(x, y, diameter * 0.28, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();

    overlaySpiralCanvas.spinPulseFrame += frameScale;
    if (overlaySpiralCanvas.spinPulseFrame >= 4) {
        overlaySpiralCanvas.spinPulseRing = overlaySpiralCanvas.spinPulseRing > -2 ? overlaySpiralCanvas.spinPulseRing - 1 : rings.length + 2;
        overlaySpiralCanvas.spinPulseFrame = 0;
    }
}

function renderOverlaySpiralCanvas(ts) {
    if (!overlaySpiralCanvas.active || !callActive || isDocumentHidden() || !extension_settings[MODULE_NAME]?.overlayEnabled || !isHypnoFeatureEnabled('hypnoSpiralEnabled')) {
        stopOverlaySpiralCanvas(true);
        return false;
    }

    const canvas = ensureOverlaySpiralCanvas();
    const ctx = overlaySpiralCanvas.ctx;
    if (!canvas || !ctx) {
        return false;
    }
    resizeOverlaySpiralCanvas(false);

    const width = overlaySpiralCanvas.drawWidth;
    const height = overlaySpiralCanvas.drawHeight;
    if (width <= 0 || height <= 0) {
        return true;
    }

    const now = Number.isFinite(ts) ? ts : performance.now();
    if (overlaySpiralCanvas.lastTs !== 0 && (now - overlaySpiralCanvas.lastTs) < OVERLAY_CANVAS_FRAME_INTERVAL_MS) {
        return true;
    }
    const dt = Math.min(0.08, Math.max(0.008, ((now - (overlaySpiralCanvas.lastTs || now)) / 1000) || 0.033));
    overlaySpiralCanvas.lastTs = now;
    const frameScale = dt * 30;
    const reactiveLevel = Math.max(0, Math.min(1, waveformLevelSmoothed || 0));

    ctx.clearRect(0, 0, width, height);
    drawOverlayVortexDots(ctx, width, height, now, reactiveLevel);
    drawOverlaySpinCycle(ctx, width, height, frameScale, reactiveLevel);
    return true;
}

function stopOverlayParticleCanvas(clearFrame = true) {
    overlayCanvasParticles.rafId = null;

    overlayCanvasParticles.lastTs = 0;
    overlayCanvasParticles.particles = [];

    if (clearFrame && overlayCanvasParticles.ctx && overlayCanvasParticles.drawWidth > 0 && overlayCanvasParticles.drawHeight > 0) {
        overlayCanvasParticles.ctx.clearRect(0, 0, overlayCanvasParticles.drawWidth, overlayCanvasParticles.drawHeight);
    }
    stopOverlayAnimationLoopIfIdle();
}

function createCanvasParticle(style, zLayer, width, height, fallRate, fireflyGlow) {
    const safeFallRate = Math.max(0.25, fallRate);
    const far = zLayer === 'far';
    const mid = zLayer === 'mid';

    if (style === 'rain') {
        const alpha = far ? (0.22 + Math.random() * 0.18) : mid ? (0.32 + Math.random() * 0.2) : (0.44 + Math.random() * 0.26);
        const speed = (far ? 180 : mid ? 235 : 300) * safeFallRate;
        return {
            style,
            x: Math.random() * width,
            y: Math.random() * (height + 120) - 80,
            vx: (-20 + Math.random() * 14) * (far ? 0.55 : mid ? 0.75 : 1),
            vy: speed,
            alpha,
            width: far ? 0.8 : mid ? 1.1 : 1.4,
            height: far ? (7 + Math.random() * 7) : mid ? (9 + Math.random() * 8) : (12 + Math.random() * 9),
            strokeColor: `rgba(204, 230, 255, ${Math.max(0.04, Math.min(1, alpha)).toFixed(3)})`,
        };
    }

    if (style === 'firefly') {
        const glowScale = Math.max(0.5, fireflyGlow);
        return {
            style,
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (-26 + Math.random() * 52) * (far ? 0.35 : mid ? 0.6 : 0.85),
            vy: (-24 + Math.random() * 48) * (far ? 0.35 : mid ? 0.55 : 0.85),
            size: (far ? 1.2 : mid ? 1.9 : 2.8) + Math.random() * (far ? 1.0 : mid ? 1.4 : 1.8),
            alpha: far ? (0.2 + Math.random() * 0.22) : mid ? (0.3 + Math.random() * 0.28) : (0.4 + Math.random() * 0.36),
            phase: Math.random() * Math.PI * 2,
            twinkleSpeed: 1.2 + Math.random() * 2.4,
            wanderX: (far ? 10 : mid ? 16 : 24) * (0.6 + Math.random() * 0.9),
            wanderY: (far ? 8 : mid ? 12 : 18) * (0.6 + Math.random() * 0.9),
            glowScale,
        };
    }

    const speed = (far ? 38 : mid ? 58 : 76) * safeFallRate;
    return {
        style: 'snow',
        x: Math.random() * width,
        y: Math.random() * (height + 120) - 80,
        vx: (-12 + Math.random() * 24) * (far ? 0.45 : mid ? 0.7 : 1),
        vy: speed,
        size: (far ? 1.0 : mid ? 1.8 : 2.4) + Math.random() * (far ? 1.4 : mid ? 1.6 : 2.4),
        alpha: far ? (0.16 + Math.random() * 0.18) : mid ? (0.26 + Math.random() * 0.2) : (0.36 + Math.random() * 0.3),
        drift: 0.5 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
    };
}

function getOverlayParticleSprite(style) {
    const key = style === 'firefly' ? 'firefly' : 'snow';
    const cached = overlayCanvasParticles.spriteCache[key];
    if (cached) {
        return cached;
    }

    const size = 80;
    const sprite = document.createElement('canvas');
    sprite.width = size;
    sprite.height = size;

    const ctx = sprite.getContext('2d', { alpha: true });
    if (!ctx) {
        return null;
    }

    const c = size / 2;
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    if (key === 'firefly') {
        gradient.addColorStop(0, 'rgba(255, 248, 188, 1)');
        gradient.addColorStop(0.35, 'rgba(255, 232, 142, 0.88)');
        gradient.addColorStop(0.72, 'rgba(255, 210, 120, 0.28)');
        gradient.addColorStop(1, 'rgba(255, 206, 120, 0)');
    } else {
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.45, 'rgba(236, 246, 255, 0.72)');
        gradient.addColorStop(0.78, 'rgba(214, 232, 250, 0.22)');
        gradient.addColorStop(1, 'rgba(210, 230, 255, 0)');
    }

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();

    overlayCanvasParticles.spriteCache[key] = sprite;
    return sprite;
}

function renderOverlayParticleCanvas(ts) {
    const ctx = overlayCanvasParticles.ctx;
    const width = overlayCanvasParticles.drawWidth;
    const height = overlayCanvasParticles.drawHeight;

    if (!ctx || width <= 0 || height <= 0 || !overlayCanvasParticles.particles.length || isDocumentHidden() || !callActive || !extension_settings[MODULE_NAME]?.overlayEnabled || !isHypnoFeatureEnabled('hypnoParticlesEnabled')) {
        overlayCanvasParticles.rafId = null;
        return false;
    }

    if (overlayCanvasParticles.lastTs !== 0 && (ts - overlayCanvasParticles.lastTs) < OVERLAY_CANVAS_FRAME_INTERVAL_MS) {
        return true;
    }

    const dt = Math.min(0.08, Math.max(0.008, ((ts - (overlayCanvasParticles.lastTs || ts)) / 1000) || 0.016));
    overlayCanvasParticles.lastTs = ts;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';

    for (const p of overlayCanvasParticles.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        if (p.style === 'firefly') {
            p.phase += p.twinkleSpeed * dt;
            p.x += Math.cos(p.phase * 0.85) * p.wanderX * dt;
            p.y += Math.sin(p.phase) * p.wanderY * dt;
        } else if (p.style === 'snow') {
            p.phase += p.drift * dt;
            p.x += Math.sin(p.phase) * 14 * dt;
        }

        if (p.x < -40) p.x = width + 20;
        if (p.x > width + 40) p.x = -20;
        if (p.y > height + 50) p.y = -30;
        if (p.style === 'firefly' && p.y < -50) p.y = height + 20;

        if (p.style === 'rain') {
            ctx.strokeStyle = p.strokeColor;
            ctx.lineWidth = p.width;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + p.vx * 0.045, p.y - p.height);
            ctx.stroke();
            continue;
        }

        const alpha = p.style === 'firefly'
            ? Math.max(0.05, Math.min(1, p.alpha * (0.7 + Math.sin(p.phase * 2.1) * 0.25)))
            : Math.max(0.05, Math.min(1, p.alpha));
        const sprite = getOverlayParticleSprite(p.style);
        if (!sprite) {
            continue;
        }

        const diameter = p.style === 'firefly'
            ? p.size * (4.4 * p.glowScale)
            : p.size * 3.6;
        const half = diameter / 2;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, p.x - half, p.y - half, diameter, diameter);
    }

    ctx.globalAlpha = 1;

    return true;
}

function startOverlayParticleCanvas(style, count, fallRate, fireflyGlow) {
    if (!count) {
        stopOverlayParticleCanvas(true);
        return;
    }

    const canvas = ensureOverlayParticleCanvas();
    if (!canvas || !overlayCanvasParticles.ctx) {
        return;
    }

    resizeOverlayParticleCanvas(true);
    const width = overlayCanvasParticles.drawWidth;
    const height = overlayCanvasParticles.drawHeight;
    overlayCanvasParticles.style = style;
    overlayCanvasParticles.fallRate = fallRate;
    overlayCanvasParticles.fireflyGlow = fireflyGlow;
    overlayCanvasParticles.particles = [];

    for (let i = 0; i < count; i++) {
        const zLayer = Math.random() < 0.55 ? 'far' : 'mid';
        overlayCanvasParticles.particles.push(createCanvasParticle(style, zLayer, width, height, fallRate, fireflyGlow));
    }

    overlayCanvasParticles.lastTs = 0;
    overlayCanvasParticles.rafId = 1;
    ensureOverlayAnimationLoop();
}

function scheduleParticleImpacts(style = 'snow') {
    if (hypnoParticleImpactTimer) {
        clearTimeout(hypnoParticleImpactTimer);
        hypnoParticleImpactTimer = null;
    }

    if (style !== 'snow' && style !== 'rain') {
        return;
    }

    const tick = () => {
        if (!callActive || !extension_settings[MODULE_NAME]?.overlayEnabled || !isHypnoFeatureEnabled('hypnoParticlesEnabled') || isDocumentHidden()) {
            hypnoParticleImpactTimer = null;
            return;
        }

        const overlay = document.getElementById('voiceforge_call_overlay');
        const effectsLayer = overlay?.querySelector('.vf-call-effects-layer') || null;
        if (!overlay || !effectsLayer) {
            hypnoParticleImpactTimer = setTimeout(tick, 800);
            return;
        }

        const impactRate = getHypnoParticleImpactRate();
        const impactChance = (style === 'rain' ? 0.85 : 0.45) * impactRate;
        if (Math.random() < Math.min(0.98, Math.max(0, impactChance))) {
            const impact = acquireOverlayElement('impacts', `vf-call-impact vf-call-impact-${style}`);
            const x = 4 + Math.random() * 92;
            const y = 82 + Math.random() * 14;
            const scale = style === 'rain' ? 0.65 + Math.random() * 0.9 : 0.8 + Math.random() * 1.1;
            impact.style.left = `${x}%`;
            impact.style.top = `${y}%`;
            impact.style.transform = `translate(-50%, -50%) scale(${scale})`;
            effectsLayer.appendChild(impact);
            activeOverlayElements.impacts.push(impact);
            const impactLifetime = style === 'rain' ? 520 : 920;
            const releaseTimerId = setTimeout(() => {
                overlayImpactReleaseTimers.delete(impact);
                releaseOverlayImpactElement(impact);
            }, impactLifetime);
            overlayImpactReleaseTimers.set(impact, releaseTimerId);
        }

        const minDelayBase = style === 'rain' ? 220 : 560;
        const maxDelayBase = style === 'rain' ? 520 : 1200;
        const minDelay = Math.max(80, Math.round(minDelayBase / Math.max(0.15, impactRate)));
        const maxDelay = Math.max(minDelay + 60, Math.round(maxDelayBase / Math.max(0.15, impactRate)));
        hypnoParticleImpactTimer = setTimeout(tick, minDelay + Math.floor(Math.random() * (maxDelay - minDelay)));
    };

    hypnoParticleImpactTimer = setTimeout(tick, style === 'rain' ? 280 : 900);
}

function startHypnoParticles() {
    if (!isHypnoFeatureEnabled('hypnoParticlesEnabled') || isDocumentHidden()) return;

    const overlay = document.getElementById('voiceforge_call_overlay');
    const effectsLayer = overlay?.querySelector('.vf-call-effects-layer') || null;
    if (!overlay || !effectsLayer) return;

    const particleCount = getHypnoParticleCount();
    const fallRate = getHypnoParticleFallRate();
    const particleStyle = getHypnoParticleStyle();
    const fireflyGlow = getHypnoFireflyGlow();

    const canvasCount = particleCount;

    while (activeOverlayElements.particles.length) {
        releaseOverlayElement('particles', activeOverlayElements.particles[activeOverlayElements.particles.length - 1]);
    }
    while (activeOverlayElements.impacts.length) {
        releaseOverlayImpactElement(activeOverlayElements.impacts[activeOverlayElements.impacts.length - 1]);
    }

    scheduleParticleImpacts(particleStyle);
    startOverlayParticleCanvas(particleStyle, canvasCount, fallRate, fireflyGlow);

}

function startHypnoWhispers() {
    if (!isHypnoFeatureEnabled('hypnoWhispersEnabled') || isDocumentHidden()) {
        stopHypnoWhispers();
        return;
    }

    stopHypnoWhispers();

    const tick = () => {
        if (!isHypnoFeatureEnabled('hypnoWhispersEnabled') || !callActive || !extension_settings[MODULE_NAME]?.overlayEnabled) {
            stopHypnoWhispers();
            return;
        }

        const overlay = document.getElementById('voiceforge_call_overlay');
        if (!overlay) {
            hypnoWhisperTimer = setTimeout(tick, 1200);
            return;
        }

        if (activeOverlayElements.whispers.length >= HYPNO_MAX_ACTIVE_WHISPERS) {
            releaseOverlayElement('whispers', activeOverlayElements.whispers[0]);
        }

        const whisperEl = acquireOverlayElement('whispers', 'vf-call-whisper');
        overlay.appendChild(whisperEl);
        activeOverlayElements.whispers.push(whisperEl);

        const text = buildHypnoWhisperText();
        const x = 14 + Math.random() * 72;
        const y = 12 + Math.random() * 76;
        const rotation = -8 + Math.random() * 16;
        whisperEl.textContent = text;
        whisperEl.style.setProperty('--vf-whisper-x', `${x}%`);
        whisperEl.style.setProperty('--vf-whisper-y', `${y}%`);
        whisperEl.style.setProperty('--vf-whisper-rot', `${rotation}deg`);
        whisperEl.classList.remove('is-visible');
        requestAnimationFrame(() => {
            if (activeOverlayElements.whispers.includes(whisperEl)) {
                whisperEl.classList.add('is-visible');
            }
        });

        bumpTranceDepth(0.018);
        hypnoWhisperTickCount += 1;
        if ((hypnoWhisperTickCount % SPOKEN_WHISPER_EVERY_N_VISUALS) === 0) {
            playWhisperPhraseAudio(text, whisperCharacterHint || getCharacterNameFallback()).catch(() => {});
        }

        const clearTimerId = setTimeout(() => {
            whisperEl.classList.remove('is-visible');
            releaseOverlayElement('whispers', whisperEl);
            hypnoWhisperClearTimers.delete(clearTimerId);
        }, 3800);
        hypnoWhisperClearTimers.add(clearTimerId);

        hypnoWhisperTimer = setTimeout(tick, 8500 + Math.floor(Math.random() * 4500));
    };

    hypnoWhisperTimer = setTimeout(tick, 2200);
}

function getOverlayRoot(createIfMissing = false) {
    if (overlayDomCache.root && overlayDomCache.root.length && document.body?.contains(overlayDomCache.root[0])) {
        return overlayDomCache.root;
    }

    let overlay = $('#voiceforge_call_overlay');
    if (!overlay.length && createIfMissing) {
        overlay = $('<div id="voiceforge_call_overlay"></div>');
        $('body').append(overlay);
    }

    overlayDomCache.root = overlay.length ? overlay : null;
    return overlayDomCache.root || $();
}

function pauseOverlayVisualLoops() {
    if (overlaySuspendedByVisibility) {
        return;
    }

    overlaySuspendedByVisibility = true;

    const overlay = getOverlayRoot(false);
    if (overlay.length) {
        overlay.addClass('vf-overlay-no-effects');
    }

    stopHypnoWhispers();
    hypnoWhisperTickCount = 0;
    stopHypnoEasterEggs();
    stopCallBreathCueLoop(false);
    stopCallWaveformAnimation(false);
    stopOverlayCssMotion();
    stopOverlaySpiralCanvas(true);
}

function resumeOverlayVisualLoopsIfAllowed() {
    if (!overlaySuspendedByVisibility) {
        return;
    }

    if (isDocumentHidden() || overlaySuspendedByUiInteraction) {
        return;
    }

    overlaySuspendedByVisibility = false;

    const overlay = getOverlayRoot(false);
    if (overlay.length) {
        overlay.removeClass('vf-overlay-no-effects');
    }

    const settings = extension_settings[MODULE_NAME] || {};
    if (!callActive || settings.overlayEnabled !== true) {
        return;
    }

    startCallBreathCueLoop();
    startOverlayCssMotion();
    startOverlaySpiralCanvas();
    startHypnoWhispers();
    startHypnoParticles();
    startHypnoEasterEggs();

    if (shouldShowOverlayWaveform()) {
        startCallWaveformAnimation();
    }
}

function onOverlayVisibilityChange() {
    if (isDocumentHidden()) {
        pauseOverlayVisualLoops();
    } else {
        resumeOverlayVisualLoopsIfAllowed();
    }
}

function ensureOverlayVisibilityListener() {
    if (overlayVisibilityListenerAttached) {
        return;
    }
    document.addEventListener('visibilitychange', onOverlayVisibilityChange);
    overlayVisibilityListenerAttached = true;
}

function playCallSnapSynth(type = 'start') {
    const ctx = getCallSfxContext();
    if (!ctx) {
        return;
    }

    try {
        const start = ctx.currentTime + 0.004;
        const duration = type === 'end' ? 0.065 : 0.052;
        const end = start + duration;
        const peak = type === 'end' ? 0.07 : 0.085;

        const output = ctx.createGain();
        output.gain.setValueAtTime(0.0001, start);
        output.gain.exponentialRampToValueAtTime(peak, start + 0.006);
        output.gain.exponentialRampToValueAtTime(0.0001, end);
        output.connect(ctx.destination);

        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(type === 'end' ? 980 : 360, start);
        osc.frequency.exponentialRampToValueAtTime(type === 'end' ? 250 : 1180, end);

        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(0.48, start);
        oscGain.gain.exponentialRampToValueAtTime(0.02, end);
        osc.connect(oscGain);
        oscGain.connect(output);

        const noiseDuration = 0.026;
        const noiseBuffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * noiseDuration)), ctx.sampleRate);
        const channelData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < channelData.length; i++) {
            channelData[i] = (Math.random() * 2 - 1) * 0.85;
        }

        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;

        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.setValueAtTime(type === 'end' ? 2100 : 2400, start);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.0001, start);
        noiseGain.gain.exponentialRampToValueAtTime(0.04, start + 0.003);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + noiseDuration);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(output);

        osc.start(start);
        osc.stop(end);
        noise.start(start);
        noise.stop(start + noiseDuration);

        const cleanupDelayMs = Math.max(90, Math.ceil((duration + 0.06) * 1000));
        setTimeout(() => {
            try {
                osc.disconnect();
                oscGain.disconnect();
                noise.disconnect();
                noiseFilter.disconnect();
                noiseGain.disconnect();
                output.disconnect();
            } catch (e) {
                // Ignore cleanup errors.
            }
        }, cleanupDelayMs);
    } catch (e) {
        console.debug(DEBUG_PREFIX + 'Call snap synth skipped:', e);
    }
}

function playCallSnapSfx(type = 'start') {
    if (!isHypnoFeatureEnabled('hypnoSnapSfxEnabled')) {
        return;
    }

    const nowMs = performance.now();
    if (nowMs - lastCallSfxAt < CALL_SFX_MIN_INTERVAL_MS) {
        return;
    }
    lastCallSfxAt = nowMs;

    const normalizedType = type === 'end' ? 'end' : 'start';
    const cachedUrl = callSfxUrlCache[normalizedType];
    if (cachedUrl) {
        try {
            const player = callSfxPlayer[normalizedType] || new Audio(cachedUrl);
            player.src = cachedUrl;
            player.preload = 'auto';
            player.volume = 0.05;
            player.currentTime = 0;
            callSfxPlayer[normalizedType] = player;
            player.play().catch(() => playCallSnapSynth(normalizedType));
            return;
        } catch (e) {
            playCallSnapSynth(normalizedType);
            return;
        }
    }

    resolveCallSnapAudioUrl(normalizedType)
        .then((url) => {
            if (!url) {
                playCallSnapSynth(normalizedType);
                return;
            }

            try {
                const player = callSfxPlayer[normalizedType] || new Audio(url);
                player.src = url;
                player.preload = 'auto';
                player.volume = 0.05;
                player.currentTime = 0;
                callSfxPlayer[normalizedType] = player;
                player.play().catch(() => playCallSnapSynth(normalizedType));
            } catch (e) {
                playCallSnapSynth(normalizedType);
            }
        })
        .catch(() => playCallSnapSynth(normalizedType));
}

function maybePlaySpokenSnapCue(text) {
    if (!isHypnoFeatureEnabled('hypnoSnapSfxEnabled')) {
        return;
    }

    if (!text || typeof text !== 'string') {
        return;
    }

    if (!/(?:^|[^a-z])snap(?:$|[^a-z])/i.test(text)) {
        return;
    }

    const now = Date.now();
    if (now - lastSpokenSnapCueAt < SPOKEN_SNAP_CUE_COOLDOWN_MS) {
        return;
    }

    lastSpokenSnapCueAt = now;
    playCallSnapSfx('start');
}

/**
 * Default settings for call mode
 */
const defaultSettings = {
    enabled: false,
    silenceThreshold: 350, // Server-side silence detection in ms (0.35s for faster response)
    hideChatShield: false, // Hide chat shield during call mode
    moveQuickRepliesToSendArea: false, // Move Quick Reply bar to wand/send area globally
    overlayEnabled: false, // Show overlay during call mode
    overlayTransparency: 0.5, // Overlay transparency (0.0 to 1.0)
    overlayZIndex: 9998, // Overlay z-index
    overlayScale: 1.0, // Overlay GIF scale (0.1 to 5.0)
    overlayPositionX: 50, // Overlay X position in percentage (0-100, 50 = center)
    overlayPositionY: 50, // Overlay Y position in percentage (0-100, 50 = center)
    overlayShowStatusText: true,
    overlayShowWaveform: true,
    // ASR settings for live transcription
    asr_endpoint: 'http://127.0.0.1:8889',
    asr_model: DEFAULT_ASR_MODEL,
    asr_wrapInQuotes: false,
    client_noise_gate: CLIENT_NOISE_GATE_THRESHOLD,
    hypnoticEffectsEnabled: true,
    hypnoSpiralEnabled: true,
    hypnoSnapSfxEnabled: true,
    hypnoAmbientEnabled: true,
    hypnoWhispersEnabled: true,
    hypnoBreathCuesEnabled: true,
    hypnoParticlesEnabled: true,
    hypnoParticleCount: 250,
    hypnoParticleFallRate: 1.0,
    hypnoParticleStyle: 'snow',
    hypnoParticleImpactRate: 1.0,
    hypnoFireflyGlow: 1.0,
    hypnoAmbientBaseVolume: 0.05,
    hypnoAmbientParticleVolume: 0.03,
    hypnoBreathCueVolume: 0.01,
    hypnoBreathGuidanceVolume: 0.1,
    hypnoSpokenWhispersEnabled: false,
    hypnoSpokenWhispersPrewarm: true,
    hypnoBreathGuidanceEnabled: true,
    hypnoBreathGuidanceLeadMs: 260,
    hypnoBreathVisualStrength: 1.0,
    hypnoBreathInDurationMs: 1600,
    hypnoBreathHoldDurationMs: 1000,
    hypnoBreathOutDurationMs: 1800,
    hypnoBreathRestDurationMs: 1200,
    subtitleEnabled: true,
    subtitleFontSize: 20,
    subtitleTextColor: '#FFFFFF',
    subtitleBackgroundColor: '#000000',
    subtitleBackgroundOpacity: 65,
    subtitleFontFamily: '',
    subtitleBottomOffset: 24,
    randomCallEnabled: false,
    randomCallMinMinutes: 30,
    randomCallMaxMinutes: 120,
    randomCallCooldownMinutes: 60,
    weatherContextEnabled: false,
    weatherRefreshMinutes: 30,
    weatherManualCity: '',
    uiSectionExpanded: false,
    uiGeneralExpanded: true,
    uiOverlayExpanded: true,
};

function areHypnoticEffectsEnabled() {
    const settings = extension_settings[MODULE_NAME] || {};
    return settings.hypnoticEffectsEnabled !== false;
}

function stopSpokenWhisperAudio(resetPosition = true) {
    for (const player of activeWhisperPlayers) {
        try {
            player.pause();
            if (resetPosition) {
                player.currentTime = 0;
            }
        } catch (e) {
            // Ignore playback stop errors.
        }
    }
    activeWhisperPlayers.clear();
}

async function resolveAudioPromptPath(promptName, providerEndpoint) {
    if (!promptName || promptName === DEFAULT_VOICE_MARKER || promptName === DISABLED_VOICE_MARKER) {
        return null;
    }

    const endpoint = String(providerEndpoint || '').replace(/\/+$/, '');
    if (!endpoint) {
        return null;
    }

    if (whisperAudioPromptsByEndpoint.has(endpoint)) {
        const map = whisperAudioPromptsByEndpoint.get(endpoint);
        return map?.get(promptName) || null;
    }

    if (!whisperAudioPromptFetches.has(endpoint)) {
        whisperAudioPromptFetches.set(endpoint, (async () => {
            const map = new Map();
            try {
                const response = await fetch(`${endpoint}/api/audio-prompts`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(6000),
                });
                if (response.ok) {
                    const data = await response.json();
                    const prompts = Array.isArray(data?.prompts) ? data.prompts : [];
                    for (const prompt of prompts) {
                        if (prompt?.name && prompt?.path) {
                            map.set(prompt.name, prompt.path);
                        }
                    }
                }
            } catch (e) {
                console.debug(DEBUG_PREFIX + 'Whisper prompt lookup failed:', e);
            }
            whisperAudioPromptsByEndpoint.set(endpoint, map);
            whisperAudioPromptFetches.delete(endpoint);
            return map;
        })());
    }

    const map = await whisperAudioPromptFetches.get(endpoint);
    return map?.get(promptName) || null;
}

async function buildWhisperRequestBody(phrase, charName) {
    const providerSettings = getVoiceForgeProviderSettings();
    const moduleSettings = extension_settings[MODULE_NAME] || {};
    if (!providerSettings) {
        return null;
    }

    const selectedVoice = resolveCharacterVoiceSettings(charName);

    if (!selectedVoice) {
        console.debug(DEBUG_PREFIX + `No character voice map match for whisper phrase "${phrase}" (char="${charName || '<none>'}").`);
        return null;
    }

    const backend = selectedVoice.tts_backend;
    if (!backend) {
        console.warn(DEBUG_PREFIX + `Whisper generation skipped: no tts_backend resolved from voice map for char="${charName || '<none>'}"`);
        return null;
    }
    const body = {
        input: phrase,
        response_format: 'mp3',
        tts_mode: 'chunked',
        tts_backend: backend,
        output_volume: 1.0,
        enable_background: false,
        enable_post: false,
        enable_rvc: false,
        rvc_model: null,
        save_output: false,
    };
    if (backend === 'pocket_tts') {
        if (!selectedVoice.pocket_tts_voice) {
            throw new Error(`Whisper generation failed: pocket_tts_voice missing for char="${charName || '<none>'}"`);
        }
        body.pocket_tts_voice = selectedVoice.pocket_tts_voice;
    } else if (backend === 'kokoro') {
        if (!selectedVoice.kokoro_voice) {
            throw new Error(`Whisper generation failed: kokoro_voice missing for char="${charName || '<none>'}"`);
        }
        body.kokoro_voice = selectedVoice.kokoro_voice;
    } else if (backend === 'omnivoice') {
        const resolvedPrompt = await resolveAudioPromptPath(selectedVoice.audio_prompt, providerSettings.provider_endpoint);
        const omniVoiceSetting = (selectedVoice.omnivoice_voice && selectedVoice.omnivoice_voice !== DISABLED_VOICE_MARKER)
            ? selectedVoice.omnivoice_voice
            : null;
        const omniVoiceRef = resolvedPrompt || omniVoiceSetting;
        if (!omniVoiceRef) {
            throw new Error(`Whisper generation failed: ${backend} requires audio prompt or omnivoice_voice for char="${charName || '<none>'}"`);
        }
        body.omnivoice_voice = omniVoiceRef;
        if (selectedVoice.omnivoice_ref_text && String(selectedVoice.omnivoice_ref_text).trim()) {
            body.omnivoice_ref_text = String(selectedVoice.omnivoice_ref_text).trim();
        }
        body.omnivoice_ref_asr_model = moduleSettings.asr_model || null;
    }

    return { body, providerSettings, voiceSettings: selectedVoice };
}

function getWhisperSettingsCache() {
    const moduleSettings = extension_settings[MODULE_NAME] || {};
    const raw = moduleSettings[WHISPER_AUDIO_SETTINGS_CACHE_KEY];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw;
    }
    moduleSettings[WHISPER_AUDIO_SETTINGS_CACHE_KEY] = {};
    extension_settings[MODULE_NAME] = moduleSettings;
    return moduleSettings[WHISPER_AUDIO_SETTINGS_CACHE_KEY];
}

function readWhisperBlobFromSettings(cacheKey) {
    const cache = getWhisperSettingsCache();
    const entry = cache[cacheKey];
    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const b64 = typeof entry.audio_b64 === 'string' ? entry.audio_b64 : '';
    if (!b64) {
        return null;
    }

    try {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        entry.hit_at = Date.now();
        return new Blob([bytes], { type: entry.mime || 'audio/mpeg' });
    } catch (_err) {
        delete cache[cacheKey];
        saveSettingsDebounced();
        return null;
    }
}

async function writeWhisperBlobToSettings(cacheKey, blob) {
    if (!blob || blob.size <= 0) {
        return;
    }

    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    const audioB64 = btoa(binary);

    const cache = getWhisperSettingsCache();
    cache[cacheKey] = {
        mime: blob.type || 'audio/mpeg',
        audio_b64: audioB64,
        size: blob.size,
        created_at: Date.now(),
        hit_at: Date.now(),
    };

    saveSettingsDebounced();
    try {
        await saveSettings();
    } catch (_err) {
        // Debounced save is already queued; ignore immediate save errors.
    }
}

async function fetchWhisperBlob(endpoint, requestBody) {
    const response = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody, tts_mode: 'chunked' }),
        signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
        let errBody = '';
        try {
            errBody = await response.text();
        } catch (e) {
            // Ignore body parse failure.
        }
        throw new Error(`status=${response.status} route=/api/generate backend=${requestBody.tts_backend} body=${errBody || '<empty>'}`);
    }

    const blob = await response.blob();
    return blob && blob.size > 0 ? blob : null;
}

async function loadWhisperClip(phrase, charName) {
    const prepared = await buildWhisperRequestBody(phrase, charName);
    if (!prepared) {
        return null;
    }

    const { body, providerSettings, voiceSettings } = prepared;
    const endpoint = String(providerSettings.provider_endpoint || '').replace(/\/+$/, '');
    if (!endpoint) {
        return null;
    }

    const settingsCacheKey = createWhisperCacheKey(phrase, charName, providerSettings, voiceSettings);

    const settingsCachedBlob = readWhisperBlobFromSettings(settingsCacheKey);
    if (settingsCachedBlob) {
        return settingsCachedBlob;
    }

    if (whisperClipInFlight.has(settingsCacheKey)) {
        return await whisperClipInFlight.get(settingsCacheKey);
    }

    const inflight = (async () => {
        try {
            const blob = await fetchWhisperBlob(endpoint, body);
            if (!blob || blob.size === 0) {
                return null;
            }

            await writeWhisperBlobToSettings(settingsCacheKey, blob);

            return blob;
        } catch (e) {
            console.debug(DEBUG_PREFIX + 'Whisper clip generation failed:', e);
            return null;
        } finally {
            whisperClipInFlight.delete(settingsCacheKey);
        }
    })();

    whisperClipInFlight.set(settingsCacheKey, inflight);
    return await inflight;
}

async function playWhisperPhraseAudio(phrase, charName) {
    if (!isSpokenWhispersEnabled() || !phrase || !callActive) {
        return;
    }

    const now = Date.now();
    if (now - lastWhisperAudioAt < WHISPER_AUDIO_MIN_INTERVAL_MS) {
        return;
    }

    const clip = await loadWhisperClip(phrase, charName);
    if (!clip || !callActive || !isSpokenWhispersEnabled()) {
        return;
    }

    lastWhisperAudioAt = Date.now();

    const objectUrl = URL.createObjectURL(clip);
    const player = new Audio(objectUrl);
    activeWhisperPlayers.add(player);
    const cleanup = () => {
        activeWhisperPlayers.delete(player);
        URL.revokeObjectURL(objectUrl);
    };
    player.preload = 'auto';
    player.volume = toPerceptualAmbientVolume(getHypnoSpokenWhispersVolume());
    player.playbackRate = 0.94 + Math.random() * 0.1;
    player.currentTime = 0;
    player.onended = cleanup;
    player.onerror = cleanup;
    player.play().catch((err) => {
        console.debug(DEBUG_PREFIX + `Spoken whisper playback failed: "${phrase}"`, err);
        cleanup();
    });
}

function prewarmSpokenWhispers(charName) {
    if (!shouldPrewarmSpokenWhispers() || !charName) {
        return;
    }

    const key = String(charName).trim().toLowerCase();
    if (!key || whisperPrewarmByCharacter.has(key)) {
        return;
    }

    const task = (async () => {
        const phrases = HYPNO_WHISPER_PREWARM.slice(0, WHISPER_PREWARM_LIMIT);
        for (const phrase of phrases) {
            if (!callActive || !shouldPrewarmSpokenWhispers()) {
                break;
            }
            await loadWhisperClip(phrase, charName);
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    })();

    whisperPrewarmByCharacter.set(key, task);
}

function prewarmBreathGuidancePrompts(charName) {
    if (!shouldPrewarmSpokenWhispers() || !isHypnoBreathGuidanceEnabled() || !charName) {
        return;
    }

    const key = `${String(charName).trim().toLowerCase()}:breath`;
    if (!key || whisperPrewarmByCharacter.has(key)) {
        return;
    }

    const prompts = [...HYPNO_BREATH_PROMPTS_IN, ...HYPNO_BREATH_PROMPTS_OUT];
    const task = (async () => {
        for (const phrase of prompts) {
            if (!callActive || !isHypnoBreathGuidanceEnabled()) {
                break;
            }
            await loadWhisperClip(phrase, charName);
            await new Promise((resolve) => setTimeout(resolve, 35));
        }
    })();

    whisperPrewarmByCharacter.set(key, task);
}

function isHypnoFeatureEnabled(settingKey) {
    const settings = extension_settings[MODULE_NAME] || {};
    if (settingKey === 'hypnoParticlesEnabled') {
        return settings.hypnoParticlesEnabled !== false;
    }

    return areHypnoticEffectsEnabled();
}

function getHypnoParticleCount() {
    const isMobile = window.matchMedia('(max-width: 768px), (max-height: 700px)').matches;
    return isMobile ? 36 : 90;
}

function getHypnoParticleFallRate() {
    return 2.0;
}

function getHypnoParticleStyle() {
    const settings = extension_settings[MODULE_NAME] || {};
    if (settings.hypnoParticleStyle === 'rain' || settings.hypnoParticleStyle === 'firefly' || settings.hypnoParticleStyle === 'snow') {
        return settings.hypnoParticleStyle;
    }
    return 'firefly';
}

function getHypnoParticleImpactRate() {
    return 1.0;
}

function getHypnoFireflyGlow() {
    return 1.0;
}

function getHypnoAmbientBaseVolume() {
    const settings = extension_settings[MODULE_NAME] || {};
    const raw = Number(settings.hypnoAmbientBaseVolume);
    return Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : defaultSettings.hypnoAmbientBaseVolume));
}

function getHypnoAmbientParticleVolume() {
    const settings = extension_settings[MODULE_NAME] || {};
    const raw = Number(settings.hypnoAmbientParticleVolume);
    return Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : defaultSettings.hypnoAmbientParticleVolume));
}

function toPerceptualAmbientVolume(raw) {
    const clamped = Math.max(0, Math.min(1, Number(raw) || 0));
    return Math.pow(clamped, 2.4);
}

function toParticleAmbientVolume(raw, style = null) {
    const clamped = Math.max(0, Math.min(1, Number(raw) || 0));
    const styleGain = CALL_PARTICLE_AMBIENT_STYLE_GAIN[String(style || '').toLowerCase()] ?? 1;
    return clamped * 0.35 * styleGain;
}

function getHypnoBreathCueVolume() {
    return 0.13;
}

function getHypnoBreathGuidanceVolume() {
    return 0.12;
}

function isHypnoBreathGuidanceEnabled() {
    return areHypnoticEffectsEnabled();
}

function getHypnoBreathGuidanceLeadMs() {
    return 260;
}

function getHypnoBreathVisualStrength() {
    return 1.5;
}

function getHypnoBreathInDurationMs() {
    return 4000;
}

function getHypnoBreathHoldDurationMs() {
    return 6000;
}

function getHypnoBreathOutDurationMs() {
    return 8000;
}

function getHypnoBreathRestDurationMs() {
    return 1000;
}

function getHypnoSpokenWhispersVolume() {
    return 0.10;
}

function isSpokenWhispersEnabled() {
    return areHypnoticEffectsEnabled();
}

function shouldPrewarmSpokenWhispers() {
    return areHypnoticEffectsEnabled();
}

function shouldShowOverlayStatusText() {
    const settings = extension_settings[MODULE_NAME] || {};
    return settings.overlayShowStatusText !== false;
}

function shouldShowOverlayWaveform() {
    const settings = extension_settings[MODULE_NAME] || {};
    return settings.overlayShowWaveform !== false;
}

function getVoiceForgeProviderSettings() {
    return extension_settings.tts?.[VOICEFORGE_PROVIDER_KEY] || null;
}

function getCharacterNameFallback() {
    const ctx = getContext();
    const characterId = Number(ctx?.characterId);
    const activeCharacter = Number.isInteger(characterId) && characterId >= 0
        ? ctx?.characters?.[characterId]
        : null;

    if (typeof activeCharacter?.name === 'string' && activeCharacter.name.trim()) {
        return activeCharacter.name.trim();
    }

    if (typeof ctx?.name2 === 'string' && ctx.name2.trim()) {
        return ctx.name2.trim();
    }

    if (Array.isArray(ctx?.chat)) {
        for (let i = ctx.chat.length - 1; i >= 0; i--) {
            const msg = ctx.chat[i];
            if (msg && !msg.is_user && typeof msg.name === 'string' && msg.name.trim()) {
                return msg.name.trim();
            }
        }
    }

    return null;
}

function normalizeVoiceMapLookupKey(name) {
    return String(name || '').trim().toLowerCase();
}

function resolveCharacterVoiceSettings(charName) {
    const providerSettings = getVoiceForgeProviderSettings();
    if (!providerSettings) {
        return null;
    }

    const map = providerSettings.voiceMap || {};
    const exact = charName ? map[charName] : undefined;
    let normalizedMatch;

    if (exact === undefined && charName) {
        const normalizedChar = normalizeVoiceMapLookupKey(charName);
        const entries = Object.entries(map);
        const found = entries.find(([key]) => normalizeVoiceMapLookupKey(key) === normalizedChar);
        normalizedMatch = found ? found[1] : undefined;

        if (normalizedMatch === undefined) {
            const strippedChar = normalizeVoiceMapLookupKey(String(charName).replace(/\s*\([^)]*\)\s*$/, ''));
            if (strippedChar && strippedChar !== normalizedChar) {
                const strippedFound = entries.find(([key]) => normalizeVoiceMapLookupKey(key) === strippedChar);
                normalizedMatch = strippedFound ? strippedFound[1] : undefined;
            }
        }
    }

    const defaultRaw = map[DEFAULT_VOICE_MARKER];
    const raw = exact ?? normalizedMatch ?? defaultRaw;

    if (!raw || raw === DISABLED_VOICE_MARKER || raw?.audio_prompt === DISABLED_VOICE_MARKER) {
        return null;
    }

    const defaultObj = defaultRaw && typeof defaultRaw === 'object' ? defaultRaw : null;

    if (typeof raw === 'string') {
        return {
            audio_prompt: raw,
            tts_backend: defaultObj?.tts_backend || null,
            pocket_tts_voice: defaultObj?.pocket_tts_voice || null,
            kokoro_voice: defaultObj?.kokoro_voice || null,
            omnivoice_voice: defaultObj?.omnivoice_voice || null,
            omnivoice_ref_text: null,
            rvc_model: null,
            enable_rvc: false,
            enable_post: false,
            enable_background: false,
            rvc: null,
            post: null,
            bg_tracks: [],
        };
    }

    return {
        audio_prompt: (raw.audio_prompt && raw.audio_prompt !== DEFAULT_VOICE_MARKER)
            ? raw.audio_prompt
            : (defaultObj?.audio_prompt || null),
        tts_backend: raw.tts_backend || defaultObj?.tts_backend || null,
        pocket_tts_voice: raw.pocket_tts_voice || defaultObj?.pocket_tts_voice || null,
        kokoro_voice: raw.kokoro_voice || defaultObj?.kokoro_voice || null,
        omnivoice_voice: raw.omnivoice_voice || defaultObj?.omnivoice_voice || null,
        omnivoice_ref_text: raw.omnivoice_ref_text || defaultObj?.omnivoice_ref_text || null,
        rvc_model: raw.rvc_model || null,
        enable_rvc: !!raw.enable_rvc,
        enable_post: !!raw.enable_post,
        enable_background: false,
        rvc: raw.rvc || null,
        post: raw.post || null,
        bg_tracks: [],
    };
}

function createWhisperCacheKey(phrase, charName, providerSettings, voiceSettings) {
    const moduleSettings = extension_settings[MODULE_NAME] || {};
    const backend = voiceSettings?.tts_backend || null;
    const keyPayload = {
        phrase,
        char: charName || 'unknown',
        backend,
        audio_prompt: voiceSettings?.audio_prompt || null,
        pocket_tts_voice: voiceSettings?.pocket_tts_voice || null,
        kokoro_voice: voiceSettings?.kokoro_voice || null,
        omnivoice_voice: voiceSettings?.omnivoice_voice || null,
        omnivoice_ref_text: voiceSettings?.omnivoice_ref_text || null,
        omnivoice_ref_asr_model: moduleSettings.asr_model || null,
        rvc_model: voiceSettings?.enable_rvc ? (voiceSettings?.rvc_model || null) : null,
        seed: Number.isFinite(Number(providerSettings?.seed)) ? Number(providerSettings.seed) : 0,
    };
    return encodeURIComponent(JSON.stringify(keyPayload));
}

/**
 * Load call mode settings
 */
function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    if (Object.prototype.hasOwnProperty.call(extension_settings[MODULE_NAME], 'overlayGif')) {
        delete extension_settings[MODULE_NAME].overlayGif;
    }
    for (const key in defaultSettings) {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = defaultSettings[key];
        }
    }

    extension_settings[MODULE_NAME].asr_model = normalizeAsrModelSetting(extension_settings[MODULE_NAME].asr_model);

    const rawRefresh = Number(extension_settings[MODULE_NAME].weatherRefreshMinutes);
    extension_settings[MODULE_NAME].weatherRefreshMinutes = Math.max(
        WEATHER_REFRESH_MIN_MINUTES,
        Math.min(WEATHER_REFRESH_MAX_MINUTES, Number.isFinite(rawRefresh) ? Math.round(rawRefresh) : defaultSettings.weatherRefreshMinutes),
    );
    extension_settings[MODULE_NAME].weatherManualCity = String(extension_settings[MODULE_NAME].weatherManualCity || '').trim();
    normalizeRandomCallSettings();
}

function normalizeRandomCallSettings() {
    const settings = extension_settings[MODULE_NAME] || {};
    const min = Math.max(1, Math.round(Number(settings.randomCallMinMinutes) || defaultSettings.randomCallMinMinutes));
    const max = Math.max(min, Math.round(Number(settings.randomCallMaxMinutes) || defaultSettings.randomCallMaxMinutes));
    const cooldown = Math.max(0, Math.round(Number(settings.randomCallCooldownMinutes) || defaultSettings.randomCallCooldownMinutes));
    settings.randomCallMinMinutes = min;
    settings.randomCallMaxMinutes = max;
    settings.randomCallCooldownMinutes = cooldown;
}

function stopRandomCallScheduler() {
    if (randomCallTimer) {
        clearTimeout(randomCallTimer);
        randomCallTimer = null;
    }
}

function stopIncomingCallRing() {
    if (incomingCallPlayer) {
        try {
            incomingCallPlayer.pause();
            incomingCallPlayer.currentTime = 0;
        } catch (e) {
            // Ignore playback stop errors.
        }
    }
}

function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function stopOutgoingCallRing() {
    if (outgoingCallPlayer) {
        try {
            outgoingCallPlayer.pause();
            outgoingCallPlayer.currentTime = 0;
        } catch (e) {
            // Ignore playback stop errors.
        }
    }
}

function pickCallPromptTemplate(templates) {
    return templates[Math.floor(Math.random() * templates.length)] || templates[0];
}

async function sendCallDeniedMessage() {
    const callerName = getCharacterNameFallback() || 'the current character';
    const text = substituteParams(
        pickCallPromptTemplate([
            'I declined {{character}}\'s call because I cannot take a call right now. {{character}}, respond naturally and briefly as if you noticed I cannot take the call.',
            'I sent {{character}}\'s call to voicemail. {{character}}, react briefly and naturally in character.',
            'I cannot answer {{character}} right now. {{character}}, leave a short in-character response as if the call was declined.',
        ]),
        { dynamicMacros: { character: callerName } },
    );
    try {
        await sendMessageAsUser(text);
        Generate('normal', { automatic_trigger: true }).catch((error) => {
            console.warn(DEBUG_PREFIX + 'Failed to generate call denied response:', error);
        });
    } catch (error) {
        console.warn(DEBUG_PREFIX + 'Failed to generate call denied response:', error);
    }
}

async function sendOutgoingCallPromptMessage() {
    const callerName = getCharacterNameFallback() || 'the current character';
    const text = substituteParams(
        pickCallPromptTemplate([
            'I am calling {{character}} now. {{character}}, answer naturally and in character as if you just picked up the phone.',
            'I started a voice call with {{character}}. {{character}}, greet me naturally and briefly like this is the beginning of a live call.',
            'I placed a call to {{character}}. {{character}}, pick up in character, using recent conversation context, and keep the opening natural.',
            'I am on the phone with {{character}} now. {{character}}, begin the call with a short, natural in-character greeting.',
        ]),
        { dynamicMacros: { character: callerName } },
    );
    try {
        await sendMessageAsUser(text);
        Generate('normal', { automatic_trigger: true }).catch((error) => {
            console.warn(DEBUG_PREFIX + 'Failed to generate outgoing call response:', error);
        });
    } catch (error) {
        console.warn(DEBUG_PREFIX + 'Failed to generate outgoing call response:', error);
    }
}

async function sendIncomingCallAcceptedMessage() {
    const callerName = getCharacterNameFallback() || 'the current character';
    const text = substituteParams(
        pickCallPromptTemplate([
            'I answered {{character}}\'s call. {{character}}, greet me naturally and in character as if your call was just picked up.',
            '{{character}}\'s call connected. {{character}}, start the live call naturally and briefly in character.',
            'I picked up {{character}}\'s call. {{character}}, open the conversation like a real phone call, using recent context if helpful.',
        ]),
        { dynamicMacros: { character: callerName } },
    );
    try {
        await sendMessageAsUser(text);
        Generate('normal', { automatic_trigger: true }).catch((error) => {
            console.warn(DEBUG_PREFIX + 'Failed to generate accepted incoming call response:', error);
        });
    } catch (error) {
        console.warn(DEBUG_PREFIX + 'Failed to generate accepted incoming call response:', error);
    }
}

async function sendIncomingCallMissedMessage() {
    const callerName = getCharacterNameFallback() || 'the current character';
    const text = substituteParams(
        pickCallPromptTemplate([
            'I missed {{character}}\'s call. {{character}}, respond briefly and naturally as if your call went unanswered.',
            '{{character}}\'s call went unanswered. {{character}}, leave a short in-character response.',
            'I did not pick up {{character}}\'s call. {{character}}, react naturally and briefly as if you noticed I missed it.',
        ]),
        { dynamicMacros: { character: callerName } },
    );
    try {
        await sendMessageAsUser(text);
        Generate('normal', { automatic_trigger: true }).catch((error) => {
            console.warn(DEBUG_PREFIX + 'Failed to generate missed incoming call response:', error);
        });
    } catch (error) {
        console.warn(DEBUG_PREFIX + 'Failed to generate missed incoming call response:', error);
    }
}

function ensureCallTtsAutoplay() {
    if (extension_settings.voiceforge) {
        extension_settings.voiceforge.auto_play_enabled = true;
        $('#tts_auto_play').prop('checked', true).trigger('change');
    }
}

function hideIncomingCallPrompt({ applyCooldown = false } = {}) {
    incomingCallActive = false;
    stopIncomingCallRing();

    if (incomingCallTimeout) {
        clearTimeout(incomingCallTimeout);
        incomingCallTimeout = null;
    }

    const prompt = document.getElementById('voiceforge_incoming_call_prompt');
    if (prompt) {
        prompt.classList.remove('visible');
        setTimeout(() => {
            if (!incomingCallActive) {
                prompt.remove();
            }
        }, 180);
    }

    if (applyCooldown) {
        applyRandomCallCooldown();
    }
}

function hideOutgoingCallPrompt() {
    outgoingCallActive = false;
    stopOutgoingCallRing();

    const prompt = document.getElementById('voiceforge_outgoing_call_prompt');
    if (prompt) {
        prompt.classList.remove('visible');
        setTimeout(() => {
            if (!outgoingCallActive) {
                prompt.remove();
            }
        }, 180);
    }
}

async function playIncomingCallRing() {
    const url = await resolveIncomingCallAudioUrl();
    if (!url || !incomingCallActive) {
        return;
    }

    try {
        const player = incomingCallPlayer || new Audio(url);
        incomingCallPlayer = player;
        player.src = url;
        player.preload = 'auto';
        player.loop = true;
        player.volume = INCOMING_CALL_RING_VOLUME;
        player.currentTime = 0;
        await player.play();
    } catch (e) {
        console.debug(DEBUG_PREFIX + 'Incoming call ring playback blocked:', e);
    }
}

async function playOutgoingCallRing() {
    const url = await resolveOutgoingCallAudioUrl();
    if (!url || !outgoingCallActive) {
        return;
    }

    try {
        const player = outgoingCallPlayer || new Audio(url);
        outgoingCallPlayer = player;
        player.src = url;
        player.preload = 'auto';
        player.loop = true;
        player.volume = OUTGOING_CALL_RING_VOLUME;
        player.currentTime = 0;
        await player.play();
    } catch (e) {
        console.debug(DEBUG_PREFIX + 'Outgoing call ring playback blocked:', e);
    }
}

function playMuteSound(muted = true) {
    try {
        const player = muted ? ensureMuteSoundPlayer() : ensureUnmuteSoundPlayer();
        player.loop = false;
        player.volume = CALL_MUTE_SFX_VOLUME;
        player.currentTime = 0;
        player.play().catch((e) => {
            console.debug(DEBUG_PREFIX + 'Mute SFX playback blocked:', e);
        });
    } catch (e) {
        console.debug(DEBUG_PREFIX + 'Mute SFX playback blocked:', e);
    }
}

function showOutgoingCallPrompt() {
    if (callActive || outgoingCallActive) {
        return;
    }

    outgoingCallActive = true;

    let prompt = document.getElementById('voiceforge_outgoing_call_prompt');
    if (!prompt) {
        prompt = document.createElement('div');
        prompt.id = 'voiceforge_outgoing_call_prompt';
        prompt.innerHTML = `
            <div class="vf-incoming-call-card vf-outgoing-call-card" role="status" aria-live="polite" aria-label="Calling VoiceForge character">
                <div class="vf-incoming-call-orb vf-outgoing-call-orb">
                    <i class="fa-solid fa-phone"></i>
                </div>
                <div class="vf-incoming-call-label">Calling</div>
                <div class="vf-incoming-call-name"></div>
                <div class="vf-outgoing-call-status">Ringing...</div>
            </div>
        `;
        document.body.appendChild(prompt);
    }

    const callerName = getCharacterNameFallback() || 'AI';
    const nameEl = prompt.querySelector('.vf-incoming-call-name');
    if (nameEl) {
        nameEl.textContent = callerName;
    }

    requestAnimationFrame(() => prompt.classList.add('visible'));
    playOutgoingCallRing();
}

function showIncomingCallPrompt() {
    if (callActive || incomingCallActive) {
        return;
    }

    incomingCallActive = true;
    stopRandomCallScheduler();

    let prompt = document.getElementById('voiceforge_incoming_call_prompt');
    if (!prompt) {
        prompt = document.createElement('div');
        prompt.id = 'voiceforge_incoming_call_prompt';
        prompt.innerHTML = `
            <div class="vf-incoming-call-card" role="dialog" aria-modal="true" aria-label="Incoming VoiceForge call">
                <div class="vf-incoming-call-orb">
                    <i class="fa-solid fa-phone"></i>
                </div>
                <div class="vf-incoming-call-label">Incoming call</div>
                <div class="vf-incoming-call-name"></div>
                <div class="vf-incoming-call-actions">
                    <button type="button" class="menu_button vf-incoming-call-deny">Deny</button>
                    <button type="button" class="menu_button vf-incoming-call-accept">Accept</button>
                </div>
            </div>
        `;
        document.body.appendChild(prompt);
    }

    const callerName = getCharacterNameFallback() || 'AI';
    const nameEl = prompt.querySelector('.vf-incoming-call-name');
    if (nameEl) {
        nameEl.textContent = callerName;
    }

    const acceptButton = prompt.querySelector('.vf-incoming-call-accept');
    const denyButton = prompt.querySelector('.vf-incoming-call-deny');

    if (acceptButton) acceptButton.onclick = () => {
        hideIncomingCallPrompt();
        startCall({ generateIncomingAcceptedResponse: true }).catch((error) => {
            console.warn(DEBUG_PREFIX + 'Incoming call failed to start:', error);
            applyRandomCallCooldown();
        });
    };

    if (denyButton) denyButton.onclick = () => {
        sendCallDeniedMessage();
        hideIncomingCallPrompt({ applyCooldown: true });
    };

    requestAnimationFrame(() => prompt.classList.add('visible'));
    playIncomingCallRing();
    incomingCallTimeout = setTimeout(() => {
        if (incomingCallActive) {
            sendIncomingCallMissedMessage();
            hideIncomingCallPrompt({ applyCooldown: true });
        }
    }, 60000);
}

function scheduleRandomCall() {
    stopRandomCallScheduler();
    const settings = extension_settings[MODULE_NAME] || {};
    if (settings.randomCallEnabled !== true || callActive || incomingCallActive) {
        return;
    }

    normalizeRandomCallSettings();
    const now = Date.now();
    const minMs = settings.randomCallMinMinutes * 60 * 1000;
    const maxMs = settings.randomCallMaxMinutes * 60 * 1000;
    const randomDelay = minMs + Math.random() * Math.max(0, maxMs - minMs);
    const delay = Math.max(randomDelay, randomCallCooldownUntil - now, 1000);

    randomCallTimer = setTimeout(() => {
        randomCallTimer = null;
        if ((extension_settings[MODULE_NAME] || {}).randomCallEnabled !== true) return;
        if (callActive || incomingCallActive || Date.now() < randomCallCooldownUntil) {
            scheduleRandomCall();
            return;
        }
        showIncomingCallPrompt();
    }, delay);
}

function applyRandomCallCooldown() {
    const settings = extension_settings[MODULE_NAME] || {};
    normalizeRandomCallSettings();
    randomCallCooldownUntil = Date.now() + settings.randomCallCooldownMinutes * 60 * 1000;
    scheduleRandomCall();
}

function getNormalizedWeatherRefreshMinutes() {
    const settings = extension_settings[MODULE_NAME] || {};
    const raw = Number(settings.weatherRefreshMinutes);
    return Math.max(
        WEATHER_REFRESH_MIN_MINUTES,
        Math.min(WEATHER_REFRESH_MAX_MINUTES, Number.isFinite(raw) ? Math.round(raw) : defaultSettings.weatherRefreshMinutes),
    );
}

function sanitizeAngleTagContent(value) {
    return String(value ?? '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[<>]/g, '')
        .trim();
}

function getOrdinalDay(dayNumber) {
    const day = Number(dayNumber);
    if (!Number.isFinite(day)) {
        return String(dayNumber);
    }

    const abs = Math.abs(day);
    const mod100 = abs % 100;
    if (mod100 >= 11 && mod100 <= 13) {
        return `${day}th`;
    }

    const mod10 = abs % 10;
    if (mod10 === 1) return `${day}st`;
    if (mod10 === 2) return `${day}nd`;
    if (mod10 === 3) return `${day}rd`;
    return `${day}th`;
}

function buildTimestampMetadataValue() {
    const now = new Date();
    const monthName = now.toLocaleString(undefined, { month: 'long' });
    const yyyy = String(now.getFullYear());
    const dd = getOrdinalDay(now.getDate());
    const hour24 = now.getHours();
    const hour12 = hour24 % 12 || 12;
    const min = String(now.getMinutes()).padStart(2, '0');
    const meridiem = hour24 >= 12 ? 'pm' : 'am';
    const tz = Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
        .formatToParts(now)
        .find((part) => part.type === 'timeZoneName')?.value || 'local';

    lastMetadataTimestampAt = now.getTime();

    return sanitizeAngleTagContent(`${monthName} ${dd}, ${yyyy} at ${hour12}:${min} ${meridiem} ${tz}`);
}

function getWeatherUnitsForLocale() {
    const locale = typeof navigator !== 'undefined' ? String(navigator.language || '').toLowerCase() : '';
    return ['en-us', 'en-lr', 'my'].some((entry) => locale === entry || locale.startsWith(`${entry}-`))
        ? 'imperial'
        : 'metric';
}

function getWeatherCodeLabel(code) {
    const c = Number(code);
    if (c === 0) return 'clear';
    if (c === 1) return 'mostly clear';
    if (c === 2) return 'partly cloudy';
    if (c === 3) return 'overcast';
    if (c === 45 || c === 48) return 'foggy';
    if ([51, 53, 55, 56, 57].includes(c)) return 'drizzle';
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return 'rain';
    if ([71, 73, 75, 77, 85, 86].includes(c)) return 'snow';
    if ([95, 96, 99].includes(c)) return 'thunderstorm';
    return 'mixed';
}

async function getBrowserGeolocationCoords() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
        return null;
    }

    try {
        const pos = await new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
                (value) => resolve(value),
                () => resolve(null),
                { enableHighAccuracy: false, timeout: WEATHER_FETCH_TIMEOUT_MS, maximumAge: 15 * 60 * 1000 },
            );
        });
        const lat = Number(pos?.coords?.latitude);
        const lon = Number(pos?.coords?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return null;
        }
        return { latitude: lat, longitude: lon };
    } catch {
        return null;
    }
}

async function geocodeManualCity(city) {
    const trimmed = String(city || '').trim();
    if (!trimmed) {
        return null;
    }

    try {
        const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
        url.searchParams.set('name', trimmed);
        url.searchParams.set('count', '1');
        url.searchParams.set('language', 'en');
        url.searchParams.set('format', 'json');
        const res = await fetch(url.toString());
        if (!res.ok) {
            return null;
        }
        const data = await res.json();
        const row = Array.isArray(data?.results) ? data.results[0] : null;
        const lat = Number(row?.latitude);
        const lon = Number(row?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return null;
        }
        const name = String(row?.name || trimmed).trim();
        return { latitude: lat, longitude: lon, label: name || trimmed };
    } catch {
        return null;
    }
}

async function reverseGeocodeCoords(coords) {
    if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
        return '';
    }

    try {
        const url = new URL('https://nominatim.openstreetmap.org/reverse');
        url.searchParams.set('lat', String(coords.latitude));
        url.searchParams.set('lon', String(coords.longitude));
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('zoom', '10');
        url.searchParams.set('addressdetails', '1');
        const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json', 'Accept-Language': 'en' } });
        if (!res.ok) {
            return '';
        }
        const data = await res.json();
        const address = data?.address || {};
        const city = String(address.city || address.town || address.village || address.county || '').trim();
        const region = String(address.state || '').trim();
        const country = String(address.country || '').trim();
        const pieces = [city, region, country].filter(Boolean);
        return pieces.length > 0 ? pieces.join(', ') : '';
    } catch {
        return '';
    }
}

async function fetchCurrentWeather(coords, units) {
    try {
        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.searchParams.set('latitude', String(coords.latitude));
        url.searchParams.set('longitude', String(coords.longitude));
        url.searchParams.set('current', 'temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m');
        url.searchParams.set('temperature_unit', units === 'imperial' ? 'fahrenheit' : 'celsius');
        url.searchParams.set('wind_speed_unit', units === 'imperial' ? 'mph' : 'kmh');
        url.searchParams.set('timezone', 'auto');
        const res = await fetch(url.toString());
        if (!res.ok) {
            return null;
        }
        const data = await res.json();
        return data?.current || null;
    } catch {
        return null;
    }
}

function formatWeatherSummary(current, units, locationLabel = 'your area') {
    const temp = Number(current?.temperature_2m);
    const wind = Number(current?.wind_speed_10m);
    const humidity = Number(current?.relative_humidity_2m);
    const tempUnit = units === 'imperial' ? 'F' : 'C';
    const windUnit = units === 'imperial' ? 'mph' : 'km/h';
    const condition = getWeatherCodeLabel(current?.weather_code);
    const parts = [];
    if (Number.isFinite(temp)) parts.push(`${Math.round(temp)}${tempUnit}`);
    parts.push(condition);
    if (Number.isFinite(wind)) parts.push(`wind ${Math.round(wind)} ${windUnit}`);
    if (Number.isFinite(humidity)) parts.push(`humidity ${Math.round(humidity)}%`);
    return `${locationLabel}: ${parts.join(', ')}.`;
}

async function getWeatherContextText() {
    const settings = extension_settings[MODULE_NAME] || {};
    if (settings.weatherContextEnabled !== true) {
        return '';
    }

    const now = Date.now();
    if (weatherCache?.summary && weatherCache.expiresAt > now) {
        return weatherCache.summary;
    }
    if (weatherFetchPromise) {
        return await weatherFetchPromise;
    }

    const fetchGeneration = ++weatherFetchGeneration;
    weatherFetchPromise = (async () => {
        const units = getWeatherUnitsForLocale();
        let coords = await getBrowserGeolocationCoords();
        let label = '';
        if (coords) {
            label = await reverseGeocodeCoords(coords);
        }
        if (!coords) {
            return '';
        }
        if (!label) {
            label = `lat ${coords.latitude.toFixed(2)}, lon ${coords.longitude.toFixed(2)}`;
        }
        const current = await fetchCurrentWeather(coords, units);
        if (!current) {
            return '';
        }
        const summary = formatWeatherSummary(current, units, label);
        if (fetchGeneration === weatherFetchGeneration) {
            weatherCache = {
                summary,
                fetchedAt: now,
                expiresAt: now + getNormalizedWeatherRefreshMinutes() * 60 * 1000,
            };
        }
        return summary;
    })();

    try {
        return await weatherFetchPromise;
    } finally {
        if (fetchGeneration === weatherFetchGeneration) {
            weatherFetchPromise = null;
        }
    }
}

function getCachedWeatherContextText() {
    const now = Date.now();
    if (weatherCache?.summary && weatherCache.expiresAt > now) {
        return weatherCache.summary;
    }
    return '';
}

async function warmWeatherContext(force = false) {
    const settings = extension_settings[MODULE_NAME] || {};
    if (settings.weatherContextEnabled !== true) {
        return '';
    }

    if (force) {
        weatherCache = null;
        weatherFetchPromise = null;
        weatherInitPromise = null;
        weatherFetchGeneration += 1;
    }

    const cached = getCachedWeatherContextText();
    if (cached) {
        return cached;
    }

    if (!weatherInitPromise) {
        weatherInitPromise = (async () => {
            try {
                return await getWeatherContextText();
            } finally {
                weatherInitPromise = null;
            }
        })();
    }

    return await weatherInitPromise;
}

function stopWeatherRefreshLoop() {
    if (weatherRefreshTimer) {
        clearTimeout(weatherRefreshTimer);
        weatherRefreshTimer = null;
    }
}

function startWeatherRefreshLoop() {
    stopWeatherRefreshLoop();

    const settings = extension_settings[MODULE_NAME] || {};
    if (settings.weatherContextEnabled !== true) {
        return;
    }

    const scheduleNextTick = () => {
        const currentSettings = extension_settings[MODULE_NAME] || {};
        if (currentSettings.weatherContextEnabled !== true) {
            stopWeatherRefreshLoop();
            return;
        }

        const refreshMs = getNormalizedWeatherRefreshMinutes() * 60 * 1000;
        weatherRefreshTimer = setTimeout(async () => {
            weatherCache = null;
            try {
                await warmWeatherContext();
            } catch {
                // Ignore transient weather refresh errors.
            }
            scheduleNextTick();
        }, refreshMs);
    };

    scheduleNextTick();
}

function resetWeatherContextState() {
    stopWeatherRefreshLoop();
    weatherCache = null;
    weatherFetchPromise = null;
    weatherInitPromise = null;
    weatherFetchGeneration += 1;
}

function applyWeatherContextLifecycle({ forceFetch = false } = {}) {
    const settings = extension_settings[MODULE_NAME] || {};
    if (settings.weatherContextEnabled !== true) {
        resetWeatherContextState();
        return;
    }

    startWeatherRefreshLoop();
    void warmWeatherContext(forceFetch);
}

async function buildCallMetadataPrefix() {
    if (extension_settings?.tts?.generation_metadata_prefix !== true) {
        return '';
    }

    const tsValue = buildTimestampMetadataValue();
    const weather = await warmWeatherContext();
    const parts = [];
    if (tsValue) parts.push(tsValue);
    if (weather) {
        parts.push(sanitizeAngleTagContent(weather));
    }
    return parts.length ? `<metadata: ${parts.join(' | ')}> ` : '';
}

export async function buildVoiceforgeMetadataPrefixForGeneration() {
    applyWeatherContextLifecycle();
    return await buildCallMetadataPrefix();
}

/**
 * Set call state and update UI
 */
function setCallState(state) {
    console.debug(DEBUG_PREFIX + 'State:', callState, '->', state);
    callState = state;
    updateUI();
}

/**
 * Update the call mode UI based on current state
 */
function updateUI() {
    if (!callButton) return;
    
    callButton.classList.remove('active', 'listening', 'speaking');
    const micButton = $('#voiceforge_microphone_button');
    
    if (!callActive) {
        callButton.title = 'Start Call Mode';
        return;
    }
    
    callButton.classList.add('active');
    
    // Update mic button for mute/unmute during call
    if (micButton.length) {
        const mobileHoldToTalk = isMobileCallModeDevice();
        if (callMuted) {
            micButton.removeClass('fa-microphone').addClass('fa-microphone-slash muted');
            micButton.prop('title', mobileHoldToTalk ? 'Hold to speak' : 'Muted - Click to unmute');
        } else {
            micButton.removeClass('fa-microphone-slash muted').addClass('fa-microphone');
            micButton.prop('title', mobileHoldToTalk ? 'Release to mute' : 'Click to mute');
        }
    }
    
    switch (callState) {
        case 'listening':
            callButton.classList.add('listening');
            callButton.title = 'Call Active - Listening... (click to end)';
            break;
        case 'speaking':
            callButton.classList.add('speaking');
            callButton.title = 'Call Active - AI Speaking... (click to end)';
            break;
        case 'processing':
            callButton.title = 'Call Active - Processing... (click to end)';
            break;
        default:
            callButton.title = 'Call Active - Click to End';
    }
    
    // Update overlay status if overlay is active
    if (callActive && extension_settings[MODULE_NAME]?.overlayEnabled) {
        updateCallOverlayStatus();
    }

    if (!callActive) {
        stopCallWaveformAnimation(false);
    } else {
        const settings = extension_settings[MODULE_NAME] || {};
        if (settings.overlayEnabled && shouldShowOverlayWaveform()) {
            startCallWaveformAnimation();
        } else {
            stopCallWaveformAnimation(false);
        }
    }
}

function getTtsOutputLevel() {
    const analyser = typeof window.getVoiceForgeAnalyser === 'function'
        ? window.getVoiceForgeAnalyser()
        : null;
    if (!analyser || typeof analyser.getByteTimeDomainData !== 'function') {
        return null;
    }

    const binCount = analyser.frequencyBinCount;
    if (!binCount || !Number.isFinite(binCount)) {
        return null;
    }

    if (!waveformTimeData || waveformTimeData.length !== binCount) {
        waveformTimeData = new Uint8Array(binCount);
    }

    analyser.getByteTimeDomainData(waveformTimeData);

    let sumSquares = 0;
    let peak = 0;
    let sampleCount = 0;
    const sampleStep = Math.max(1, Math.floor(binCount / 128));
    for (let i = 0; i < binCount; i += sampleStep) {
        const centered = (waveformTimeData[i] - 128) / 128;
        const magnitude = Math.abs(centered);
        if (magnitude > peak) {
            peak = magnitude;
        }
        sumSquares += centered * centered;
        sampleCount++;
    }

    const rms = Math.sqrt(sumSquares / Math.max(1, sampleCount));
    const rmsBoosted = Math.max(0, Math.min(1, rms * 4.8));
    const peakBoosted = Math.max(0, Math.min(1, (peak - 0.01) * 2.2));
    const combined = Math.max((rmsBoosted * 0.75) + (peakBoosted * 0.55), peakBoosted * 0.9);

    return Math.max(0, Math.min(1, Math.pow(combined, 0.72)));
}

function refreshWaveformBars() {
    const bars = document.querySelectorAll('#voiceforge_call_overlay .vf-call-waveform .vf-wave-bar');
    waveformBars = Array.from(bars);
    return waveformBars;
}

let waveformLastFrameAt = 0;
const WAVEFORM_FRAME_INTERVAL_MS = 1000 / 30;

function updateCallWaveformFrame(ts = performance.now()) {
    if (!callActive || isDocumentHidden()) {
        waveformAnimationFrameId = null;
        return false;
    }

    const now = Number.isFinite(ts) ? ts : performance.now();
    if (waveformLastFrameAt !== 0 && (now - waveformLastFrameAt) < WAVEFORM_FRAME_INTERVAL_MS) {
        return true;
    }
    waveformLastFrameAt = now;

    if (!waveformBars.length) {
        refreshWaveformBars();
    }

    if (!waveformBars.length) {
        const hasWaveformUi = !!document.querySelector('#voiceforge_call_overlay .vf-call-waveform');
        if (!hasWaveformUi) {
            waveformAnimationFrameId = null;
            return false;
        }
        return true;
    }

    const measuredLevel = getTtsOutputLevel();
    const hasSignal = measuredLevel !== null && measuredLevel > 0.02;
    const reactiveMode = callState === 'speaking' || hasSignal;

    if (reactiveMode) {
        const targetLevel = measuredLevel ?? 0.1;
        const attack = 0.6;
        const release = 0.25;
        const smoothing = targetLevel > waveformLevelSmoothed ? attack : release;
        waveformLevelSmoothed += (targetLevel - waveformLevelSmoothed) * smoothing;
    } else {
        waveformLevelSmoothed *= 0.85;
    }

    const overlay = overlayDomCache.root?.[0] || document.getElementById('voiceforge_call_overlay');
    if (overlay) {
        const reactiveLevel = reactiveMode ? Math.max(0, Math.min(1, waveformLevelSmoothed)) : 0;
        setCachedInlineStyle(overlay, 'vars', '--vf-overlay-reactive-level', reactiveLevel.toFixed(3));
    }

    const bars = waveformBars;
    const barCount = bars.length;
    const center = (barCount - 1) / 2;
    const t = now;

    for (let i = 0; i < barCount; i++) {
        const bar = bars[i];
        const distance = center > 0 ? Math.abs(i - center) / center : 0;
        const shape = 1 - distance * 0.35;
        const canned = (Math.sin((t / 145) + i * 0.72) + 1) * 0.16;
        const jitter = reactiveMode ? ((Math.sin((t / 120) + i * 0.8) + 1) * 0.04) : 0;
        const level = reactiveMode
            ? Math.max(0.12, Math.min(1.18, 0.13 + waveformLevelSmoothed * shape * 2.15 + jitter))
            : Math.max(0.12, Math.min(0.58, 0.16 + canned * shape));
        const opacity = Math.max(0.35, Math.min(0.95, 0.28 + level * 0.72));

        const transformValue = `scaleY(${level.toFixed(3)})`;
        const opacityValue = opacity.toFixed(3);
        if (bar.dataset.vfWaveTransform !== transformValue) {
            bar.style.transform = transformValue;
            bar.dataset.vfWaveTransform = transformValue;
        }
        if (bar.dataset.vfWaveOpacity !== opacityValue) {
            bar.style.opacity = opacityValue;
            bar.dataset.vfWaveOpacity = opacityValue;
        }
    }

    return true;
}

function startCallWaveformAnimation() {
    if (isDocumentHidden()) {
        return;
    }
    if (waveformAnimationFrameId) {
        return;
    }
    waveformLevelSmoothed = 0;
    waveformLastFrameAt = 0;
    refreshWaveformBars();
    for (const bar of waveformBars) {
        if (bar.style.animation !== 'none') {
            bar.style.animation = 'none';
        }
    }
    waveformAnimationFrameId = 1;
    ensureOverlayAnimationLoop();
}

function stopCallWaveformAnimation(enableCanned = false) {
    waveformAnimationFrameId = null;

    waveformLevelSmoothed = 0;
    waveformLastFrameAt = 0;
    waveformTimeData = null;
    refreshWaveformBars();
    for (const bar of waveformBars) {
        if (enableCanned) {
            bar.style.animation = '';
            bar.style.transform = '';
            bar.style.opacity = '';
            delete bar.dataset.vfWaveTransform;
            delete bar.dataset.vfWaveOpacity;
        } else {
            bar.style.animation = 'none';
            bar.style.transform = 'scaleY(0.12)';
            bar.style.opacity = '0.35';
            bar.dataset.vfWaveTransform = 'scaleY(0.12)';
            bar.dataset.vfWaveOpacity = '0.35';
        }
    }
    stopOverlayAnimationLoopIfIdle();
}

function applyOverlayCallUiVisibility() {
    const overlay = syncOverlayDomCache();
    if (!overlay || !overlay.length) {
        return;
    }

    const statusText = overlay.find('#vf-call-status-text').first();
    if (statusText.length) {
        statusText.css('display', shouldShowOverlayStatusText() ? '' : 'none');
    }

    const waveform = overlay.find('.vf-call-waveform').first();
    if (waveform.length) {
        const showWaveform = shouldShowOverlayWaveform();
        waveform.css('display', showWaveform ? '' : 'none');
        if (showWaveform && callActive) {
            startCallWaveformAnimation();
        } else {
            stopCallWaveformAnimation(false);
        }
    }
}

function ensureSubtitleElement() {
    subtitleElement = document.getElementById('voiceforge_call_subtitle') || subtitleElement;
    if (!subtitleElement) {
        subtitleElement = document.createElement('div');
        subtitleElement.id = 'voiceforge_call_subtitle';
        subtitleElement.className = 'voiceforge-call-subtitle';
        subtitleElement.setAttribute('aria-live', 'polite');
        subtitleElement.style.display = 'none';
    }

    const overlayHost = document.getElementById('voiceforge_call_overlay');
    const desiredParent = overlayHost || document.body;

    if (subtitleElement.parentElement !== desiredParent) {
        desiredParent.appendChild(subtitleElement);
    }

    // Keep subtitle as the last child in overlay so it stays above GIF/call UI layers.
    if (overlayHost && subtitleElement.parentElement === overlayHost) {
        overlayHost.appendChild(subtitleElement);
    }

    subtitleElement.classList.toggle('in-overlay', !!overlayHost);

    let textEl = subtitleElement.querySelector('.voiceforge-call-subtitle-text');
    if (!textEl) {
        textEl = document.createElement('span');
        textEl.className = 'voiceforge-call-subtitle-text';
        subtitleElement.textContent = '';
        subtitleElement.appendChild(textEl);
    }

    return subtitleElement;
}

function getSubtitleTextElement() {
    const el = ensureSubtitleElement();
    return el.querySelector('.voiceforge-call-subtitle-text');
}

function clearCallSubtitle() {
    if (subtitleClearTimer) {
        clearTimeout(subtitleClearTimer);
        subtitleClearTimer = null;
    }
    clearSubtitleLineTimers();

    const el = ensureSubtitleElement();
    const textEl = getSubtitleTextElement();
    textEl.textContent = '';
    textEl.classList.remove('subtitle-refresh');
    el.style.display = 'none';
    lastSubtitleText = '';
    lastSubtitleAt = 0;
    lastSubtitleSequence = null;
}

function clearSubtitleLineTimers() {
    for (const timer of subtitleLineTimers) {
        clearTimeout(timer);
    }
    subtitleLineTimers.clear();
}

function normalizeHexColor(value, defaultColor) {
    const str = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(str)) {
        return str;
    }
    return defaultColor;
}


function applyCallSubtitleStyles() {
    const settings = extension_settings[MODULE_NAME] || {};
    const fontSize = Math.max(12, Math.min(48, Number(settings.subtitleFontSize) || defaultSettings.subtitleFontSize));
    const textColor = normalizeHexColor(settings.subtitleTextColor, defaultSettings.subtitleTextColor);
    const bgColor = normalizeHexColor(settings.subtitleBackgroundColor, defaultSettings.subtitleBackgroundColor);
    const rawBgOpacity = Number(settings.subtitleBackgroundOpacity);
    const bgOpacity = Math.max(0, Math.min(100, Number.isFinite(rawBgOpacity) ? rawBgOpacity : defaultSettings.subtitleBackgroundOpacity));
    const fontFamily = String(settings.subtitleFontFamily || '').trim();
    const rawBottomOffset = Number(settings.subtitleBottomOffset);
    const bottomOffset = Math.max(0, Math.min(260, Number.isFinite(rawBottomOffset) ? rawBottomOffset : defaultSettings.subtitleBottomOffset));
    const alpha = bgOpacity / 100;
    const r = parseInt(bgColor.slice(1, 3), 16);
    const g = parseInt(bgColor.slice(3, 5), 16);
    const b = parseInt(bgColor.slice(5, 7), 16);

    const el = ensureSubtitleElement();
    el.style.fontSize = `${fontSize}px`;
    el.style.color = textColor;
    el.style.background = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
    el.style.fontFamily = fontFamily || '';
    el.style.bottom = `${bottomOffset}px`;
    el.style.border = alpha > 0 ? '1px solid rgba(255, 255, 255, 0.2)' : 'none';
    el.style.boxShadow = alpha > 0 ? '0 8px 28px rgba(0, 0, 0, 0.42), 0 0 40px rgba(255, 180, 120, 0.08)' : 'none';
    el.style.backdropFilter = alpha > 0 ? 'blur(7px) saturate(130%)' : 'none';
    el.style.webkitBackdropFilter = alpha > 0 ? 'blur(7px) saturate(130%)' : 'none';
    el.classList.toggle('vf-subtitle-no-bg', alpha === 0);
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('bottom', 'calc(env(safe-area-inset-bottom) + 1px)')) {
        el.style.bottom = `calc(env(safe-area-inset-bottom) + ${bottomOffset}px)`;
    }
}

function showCallSubtitle(text) {
    const settings = extension_settings[MODULE_NAME] || {};
    if (!callActive || !text || settings.subtitleEnabled === false) {
        return;
    }

    const cleanText = String(text).replace(/\s+/g, ' ').trim();
    if (!cleanText) {
        return;
    }

    const el = ensureSubtitleElement();
    const textEl = getSubtitleTextElement();
    applyCallSubtitleStyles();
    textEl.textContent = cleanText;
    textEl.classList.remove('subtitle-refresh');
    void textEl.offsetWidth;
    textEl.classList.add('subtitle-refresh');
    el.style.display = 'block';
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    el.style.zIndex = '2147483646';

    if (subtitleClearTimer) {
        clearTimeout(subtitleClearTimer);
    }

    const words = cleanText.split(/\s+/).filter(Boolean).length;
    const holdMs = Math.max(10000, Math.min(30000, words * 450 + 6000));
    subtitleClearTimer = setTimeout(() => {
        if (!callActive || callState !== 'speaking') {
            clearCallSubtitle();
        }
    }, holdMs);
}

/**
 * Get ASR settings for live transcription
 */
function getAsrSettings() {
    const settings = extension_settings[MODULE_NAME] || {};
    const modelFromUi = normalizeAsrModelSetting($('#voiceforge_asr_model').val());
    const endpointFromUi = String($('#voiceforge_asr_endpoint').val() || '').trim();
    return {
        endpoint: endpointFromUi || settings.asr_endpoint || 'http://127.0.0.1:8889',
        model: modelFromUi || normalizeAsrModelSetting(settings.asr_model),
        language: 'en',
    };
}

function splitSubtitleIntoLines(text) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    if (!source) return [];

    const maxChars = 72;
    const parts = source.match(/[^.!??!?�]+[.!??!?�]*["'��??)\]]*/g) || [source];
    const lines = [];

    for (const part of parts) {
        const words = String(part || '').trim().split(/\s+/).filter(Boolean);
        let line = '';
        for (const word of words) {
            const next = line ? `${line} ${word}` : word;
            if (next.length > maxChars && line) {
                lines.push(line);
                line = word;
            } else {
                line = next;
            }
        }
        if (line) lines.push(line);
    }

    return lines.filter(Boolean);
}

function estimateSubtitleDurationMs(line) {
    const words = String(line || '').split(/\s+/).filter(Boolean).length;
    return Math.max(1100, Math.min(4600, words * 320 + 450));
}

function showCallSubtitleLines(lines, payload = {}) {
    clearSubtitleLineTimers();

    const cleanLines = (Array.isArray(lines) ? lines : []).map(line => String(line || '').trim()).filter(Boolean);
    if (!cleanLines.length) return;

    const payloadSequence = Number.isFinite(payload?.sequence) ? payload.sequence : null;
    if (payloadSequence !== null) {
        lastSubtitleSequence = payloadSequence;
    }
    const durationMs = Number.isFinite(payload?.durationMs) && payload.durationMs > 0 ? Number(payload.durationMs) : null;
    const estimatedTotal = cleanLines.reduce((sum, line) => sum + estimateSubtitleDurationMs(line), 0);
    const scale = durationMs ? Math.max(0.6, Math.min(2.5, (durationMs * 0.95) / Math.max(1, estimatedTotal))) : 1;

    let offset = 0;
    cleanLines.forEach((line, index) => {
        const showLine = () => {
            if (!callActive) return;
            const belongsToRecentSubtitle = payloadSequence !== null && lastSubtitleSequence === payloadSequence;
            if (callState !== 'speaking' && !belongsToRecentSubtitle) return;
            if (payloadSequence !== null && activeTtsSequence !== null && payloadSequence !== activeTtsSequence) return;
            showCallSubtitle(line);
        };

        if (index === 0) {
            showLine();
        } else {
            const timer = setTimeout(showLine, offset);
            subtitleLineTimers.add(timer);
        }

        offset += Math.round(estimateSubtitleDurationMs(line) * scale);
    });
}

function getClientNoiseGateThreshold() {
    const settings = extension_settings[MODULE_NAME] || {};
    const raw = Number(settings.client_noise_gate);
    if (!Number.isFinite(raw)) {
        return CLIENT_NOISE_GATE_THRESHOLD;
    }
    return Math.max(0.0005, Math.min(CLIENT_NOISE_GATE_RMS_MAX, raw));
}

function rmsToUiPercent(rms) {
    return Math.max(0, Math.min(100, Math.round((Number(rms) / CLIENT_NOISE_GATE_RMS_MAX) * 100)));
}

function uiPercentToRms(percent) {
    const p = Math.max(1, Math.min(100, Number(percent) || 1));
    return (p / 100) * CLIENT_NOISE_GATE_RMS_MAX;
}

function updateMicLevelUi(rms = 0, source = 'idle') {
    latestMicRms = Number.isFinite(Number(rms)) ? Math.max(0, Number(rms)) : 0;
    const now = performance.now();
    if (source === 'call' && now - lastMicLevelUiUpdateAt < 100) {
        return;
    }
    lastMicLevelUiUpdateAt = now;

    const gate = getClientNoiseGateThreshold();
    const levelPct = rmsToUiPercent(latestMicRms);
    const gatePct = rmsToUiPercent(gate);
    const isOpen = latestMicRms >= gate;

    const barEl = document.getElementById('voiceforge_call_mic_level_fill');
    const markerEl = document.getElementById('voiceforge_call_mic_gate_marker');
    const statusEl = document.getElementById('voiceforge_call_mic_level_status');
    const testBtn = document.getElementById('voiceforge_call_mic_test_button');
    if (barEl) {
        barEl.style.width = `${levelPct}%`;
        barEl.style.background = isOpen
            ? 'linear-gradient(90deg, #ffb454 0%, #ff7b6b 55%, #ff5470 100%)'
            : 'linear-gradient(90deg, #5ec4ff 0%, #4ba3ff 100%)';
    }
    if (markerEl) {
        markerEl.style.left = `${gatePct}%`;
    }
    if (statusEl) {
        const sourceLabel = source === 'call' ? 'call' : source === 'test' ? 'test' : 'idle';
        statusEl.textContent = `Level ${levelPct}% | Gate ${gatePct}% | ${isOpen ? 'OPEN' : 'closed'} (${sourceLabel})`;
    }
    if (testBtn && !callActive) {
        testBtn.textContent = micLevelTestActive ? 'Stop Mic Test' : 'Start Mic Test';
    }
    if (testBtn && callActive) {
        testBtn.textContent = 'Call Active';
    }
}

function stopMicLevelTest() {
    micLevelTestActive = false;
    if (micLevelTestRafId !== null) {
        cancelAnimationFrame(micLevelTestRafId);
        micLevelTestRafId = null;
    }
    if (micLevelTestStream) {
        try {
            micLevelTestStream.getTracks().forEach((t) => t.stop());
        } catch (_err) {
            // Ignore stop errors.
        }
        micLevelTestStream = null;
    }
    if (micLevelTestContext) {
        micLevelTestContext.close().catch(() => {});
        micLevelTestContext = null;
    }
    micLevelTestAnalyser = null;
    micLevelTestData = null;
    if (!callActive) {
        updateMicLevelUi(0, 'idle');
    }
}

async function startMicLevelTest() {
    if (callActive || micLevelTestActive) {
        return;
    }

    try {
        micLevelTestStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: false,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });
        micLevelTestContext = new window.AudioContext();
        const source = micLevelTestContext.createMediaStreamSource(micLevelTestStream);
        micLevelTestAnalyser = micLevelTestContext.createAnalyser();
        micLevelTestAnalyser.fftSize = 1024;
        micLevelTestData = new Float32Array(micLevelTestAnalyser.fftSize);
        source.connect(micLevelTestAnalyser);
        micLevelTestActive = true;

        const tick = () => {
            if (!micLevelTestActive || !micLevelTestAnalyser || !micLevelTestData) {
                return;
            }
            micLevelTestAnalyser.getFloatTimeDomainData(micLevelTestData);
            let sum = 0;
            for (let i = 0; i < micLevelTestData.length; i++) {
                const v = micLevelTestData[i];
                sum += v * v;
            }
            const rms = Math.sqrt(sum / micLevelTestData.length);
            updateMicLevelUi(rms, 'test');
            micLevelTestRafId = requestAnimationFrame(tick);
        };

        updateMicLevelUi(0, 'test');
        micLevelTestRafId = requestAnimationFrame(tick);
    } catch (err) {
        console.warn(DEBUG_PREFIX + 'Mic test failed to start:', err);
        stopMicLevelTest();
    }
}

function normalizeAsrModelForServer(rawModel) {
    let model = normalizeAsrModelSetting(rawModel);
    if (!model) {
        return 'whisper-large-v3-turbo';
    }

    // Full backend-prefixed identifiers pass through unchanged.
    if (model.startsWith('whisper-') || model.startsWith('glm-') || model.startsWith('parakeet-')) {
        return model;
    }

    // Legacy shorthand values are Whisper models.
    return `whisper-${model}`;
}

function normalizeAsrModelSetting(rawModel) {
    const model = String(rawModel || '').trim();
    if (!model) {
        return DEFAULT_ASR_MODEL;
    }

    if (model === 'whisper-large-v3-turbo') {
        return 'large-v3-turbo';
    }

    if (SUPPORTED_ASR_MODELS.has(model)) {
        return model;
    }

    return DEFAULT_ASR_MODEL;
}

/**
 * Start the live transcription WebSocket
 */
async function startLiveTranscription() {
    const settings = getAsrSettings();
    const silenceThreshold = (extension_settings[MODULE_NAME]?.silenceThreshold || defaultSettings.silenceThreshold) / 1000;
    
    // Build WebSocket URL
    const wsProtocol = settings.endpoint.startsWith('https') ? 'wss:' : 'ws:';
    const host = settings.endpoint.replace(/^https?:\/\//, '');
    
    // Normalize model name for unified ASR backend routing.
    const model = normalizeAsrModelForServer(settings.model);
    
    // call_mode=true with client-driven flush endpointing
    const wsUrl = `${wsProtocol}//${host}/v1/audio/transcriptions/live?model=${encodeURIComponent(model)}&language=${encodeURIComponent(settings.language)}&call_mode=true&silence_threshold=${silenceThreshold}`;
    
    try {
        liveWs = new WebSocket(wsUrl);
        
        liveWs.onopen = () => {
            console.debug(DEBUG_PREFIX + 'WebSocket connected');
        };
        
        liveWs.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                handleTranscriptionMessage(msg);
            } catch (e) {
                console.error(DEBUG_PREFIX + 'Failed to parse message:', e);
            }
        };
        
        liveWs.onerror = (error) => {
            console.error(DEBUG_PREFIX + 'WebSocket error:', error);
            wsReady = false;
        };
        
        liveWs.onclose = () => {
            console.debug(DEBUG_PREFIX + 'WebSocket closed');
            wsReady = false;
            liveWs = null;
            
            // Reconnect if call still active
            if (callActive) {
                setTimeout(() => {
                    if (callActive) {
                        startLiveTranscription();
                    }
                }, 1000);
            }
        };
        
    } catch (error) {
        console.error(DEBUG_PREFIX + 'Failed to create WebSocket:', error);
    }
}

/**
 * Handle incoming transcription messages
 */
async function handleTranscriptionMessage(msg) {
    if (msg.type === 'ready') {
        wsReady = true;
        console.debug(DEBUG_PREFIX + 'Live transcription ready, call_mode:', msg.call_mode);
        return;
    }
    
    if (msg.type === 'error') {
        console.error(DEBUG_PREFIX + 'Transcription error:', msg.message);
        return;
    }
    
    if (msg.type === 'complete') {
        // End of session
        console.debug(DEBUG_PREFIX + 'Session complete');
        return;
    }
    
    // Handle TTS interruption (always enabled in call mode)
    if (callState === 'speaking') {
        // Treat ASR during TTS playback as barge-in/echo only. Do not submit the
        // captured text as a user message, or speaker bleed can recursively
        // trigger new generations from the character's own voice.
        await interruptActiveResponse('asr_voice_detected');
        return;
    }
    
    // Brief cooldown after TTS ends naturally (not when we just interrupted)
    if (Date.now() - lastTtsEndTime < TTS_END_COOLDOWN) {
        return;
    }
    
    // Server sends 'transcript' when it detects end of utterance (silence)
    if (msg.type === 'transcript') {
        const text = msg.text?.trim();
        if (!text || isHallucination(text)) {
            return;
        }
        
        // Don't send duplicates
        if (text === lastSentText) {
            return;
        }
        
        // Rate limiting
        const timeSinceLastSend = Date.now() - lastSendTime;
        if (timeSinceLastSend < MIN_SEND_INTERVAL_MS && lastSendTime > 0) {
            return;
        }
        
        console.debug(DEBUG_PREFIX + 'Sending utterance:', text);
        lastSentText = text;
        lastSendTime = Date.now();
        setCallState('processing');
        
        // Wrap in quotes if enabled
        const callSettings = extension_settings[MODULE_NAME] || {};
        let textToSend = text;
        if (callSettings.asr_wrapInQuotes === true) {
            textToSend = `"${text}"`;
        }

        const metadataPrefix = await buildCallMetadataPrefix();

        // Send as user message and trigger AI response
        try {
            await sendMessageAsUser(textToSend, metadataPrefix || undefined);
            await getContext().generate();
        } catch (error) {
            console.error(DEBUG_PREFIX + 'Failed to send/generate:', error);
            setCallState('listening');
        }
    }
}

async function interruptActiveResponse(reason = 'unknown') {
    if (!callActive) {
        return;
    }

    const now = Date.now();
    if (now - lastInterruptAt < INTERRUPT_DEBOUNCE_MS) {
        return;
    }
    lastInterruptAt = now;

    try {
        stopGeneration();
    } catch (e) {
        // ignore generation stop failures
    }

    try {
        cancelTtsPlay();
    } catch (e) {
        // ignore local synth cancel failures
    }

    const payload = {
        requestId: activeTtsRequestId,
        sequence: activeTtsSequence,
        reason,
        timestamp: performance.now(),
    };

    try {
        await eventSource.emit('voiceforge_tts_interrupt_requested', payload);
    } catch (e) {
        // ignore extension interrupt bridge failures
    }

    setCallState('listening');
}

/**
 * Check if text is a hallucination or noise
 */
function isHallucination(text) {
    // Too short - likely noise
    if (text.length < MIN_TRANSCRIPT_LENGTH) {
        return true;
    }
    
    // Check patterns
    for (const pattern of HALLUCINATION_PATTERNS) {
        if (pattern.test(text)) {
            return true;
        }
    }
    
    // Check for repeated words (e.g., "the the the")
    const words = text.toLowerCase().split(/\s+/);
    if (words.length >= 2 && words.every(w => w === words[0])) {
        return true;
    }
    
    return false;
}

/**
 * Downsample audio from input sample rate to target rate (16kHz for ASR)
 * Uses simple decimation - good enough for speech transcription
 */
function downsampleAudio(inputData, inputSampleRate, targetSampleRate = 16000) {
    if (inputSampleRate === targetSampleRate) {
        return inputData;
    }
    
    const ratio = inputSampleRate / targetSampleRate;
    const outputLength = Math.floor(inputData.length / ratio);
    const output = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
        output[i] = inputData[Math.floor(i * ratio)];
    }
    
    return output;
}

function sendLiveWsJson(payload) {
    if (!wsReady || !liveWs || liveWs.readyState !== WebSocket.OPEN) {
        return false;
    }
    try {
        liveWs.send(JSON.stringify(payload));
        return true;
    } catch (_err) {
        return false;
    }
}

function resetCallUtteranceBuffer() {
    callUtteranceFrames = [];
    callUtteranceSamples = 0;
    callUtteranceSpeechSamples = 0;
    callUtteranceEnergy = 0;
    callUtterancePeakRms = 0;
    callUtteranceHasAudio = false;
}

function resetCallMicBuffers() {
    callPreRollFrames = [];
    resetCallUtteranceBuffer();
}

function pushCallPreRollFrame(frame, sampleRate) {
    const copy = new Float32Array(frame);
    callPreRollFrames.push(copy);

    const maxFrames = Math.max(1, Math.ceil((CLIENT_PREROLL_MS / 1000) * sampleRate / copy.length));
    while (callPreRollFrames.length > maxFrames) {
        callPreRollFrames.shift();
    }
}

function appendCallUtteranceFrame(frame, rms, isSpeech) {
    const copy = new Float32Array(frame);
    callUtteranceFrames.push(copy);
    callUtteranceSamples += copy.length;
    callUtteranceEnergy += rms * rms * copy.length;
    callUtterancePeakRms = Math.max(callUtterancePeakRms, rms);
    if (isSpeech) {
        callUtteranceSpeechSamples += copy.length;
    }
    callUtteranceHasAudio = true;
}

function startCallUtterance(frame, rms, sampleRate) {
    resetCallUtteranceBuffer();
    for (const preRollFrame of callPreRollFrames) {
        appendCallUtteranceFrame(preRollFrame, 0, false);
    }
    appendCallUtteranceFrame(frame, rms, true);
    callPreRollFrames = [];
    callSpeechActive = true;
    lastSpeechFrameAt = Date.now();

    const maxSamples = Math.floor((CLIENT_MAX_UTTERANCE_MS / 1000) * sampleRate);
    if (callUtteranceSamples > maxSamples) {
        flushCallUtteranceIfNeeded(sampleRate, 'max_duration');
    }
}

function sendCallAudioFrames(frames, sampleRate) {
    if (!frames.length) {
        return false;
    }

    let totalLength = 0;
    for (const frame of frames) {
        totalLength += frame.length;
    }

    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const frame of frames) {
        merged.set(frame, offset);
        offset += frame.length;
    }

    const bytes = new Uint8Array(merged.buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    return sendLiveWsJson({
        type: 'audio',
        data: btoa(binary),
        sampleRate,
    });
}

function shouldSendCallUtterance(sampleRate) {
    if (!callUtteranceHasAudio || callUtteranceSamples <= 0) {
        return false;
    }

    const durationMs = (callUtteranceSamples / sampleRate) * 1000;
    const speechMs = (callUtteranceSpeechSamples / sampleRate) * 1000;
    const voicedRatio = callUtteranceSpeechSamples / callUtteranceSamples;
    const avgRms = Math.sqrt(callUtteranceEnergy / callUtteranceSamples);
    const threshold = getClientNoiseGateThreshold();

    return durationMs >= CLIENT_MIN_UTTERANCE_MS
        && speechMs >= CLIENT_MIN_SPEECH_MS
        && voicedRatio >= CLIENT_MIN_VOICED_RATIO
        && callUtterancePeakRms >= threshold
        && avgRms >= threshold * 0.35;
}

function flushCallUtteranceIfNeeded(sampleRate = 16000, reason = 'silence') {
    if (!callUtteranceHasAudio) {
        return;
    }

    const frames = callUtteranceFrames;
    const shouldSend = shouldSendCallUtterance(sampleRate);

    resetCallUtteranceBuffer();
    callSpeechActive = false;
    lastSpeechFrameAt = 0;

    if (!shouldSend) {
        console.debug(DEBUG_PREFIX + `Dropped local mic utterance (${reason}) before ASR`);
        return;
    }

    if (sendCallAudioFrames(frames, sampleRate)) {
        sendLiveWsJson({ type: 'flush' });
    }
}

/**
 * Start audio capture and streaming
 */
async function startAudioCapture() {
    try {
        callSpeechActive = false;
        resetCallMicBuffers();
        lastSpeechFrameAt = 0;

        micStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: false,
            }
        });

        if (!callActive || callMuted) {
            micStream.getTracks().forEach(t => t.stop());
            micStream = null;
            return;
        }
        
        // Use native sample rate - server handles resampling
        const AudioContextCtor = window.AudioContext;
        audioContext = new AudioContextCtor({ sampleRate: 16000, latencyHint: 'interactive' });
        if (audioContext.state === 'suspended') {
            await audioContext.resume().catch(() => {});
        }
        console.debug(DEBUG_PREFIX + 'Audio sample rate:', audioContext.sampleRate);
        
        const source = audioContext.createMediaStreamSource(micStream);
        
        scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        scriptProcessorSilentGain = audioContext.createGain();
        scriptProcessorSilentGain.gain.value = 0;
        source.connect(scriptProcessor);
        scriptProcessor.connect(scriptProcessorSilentGain);
        scriptProcessorSilentGain.connect(audioContext.destination);
        
        scriptProcessor.onaudioprocess = (e) => {
            if (!callActive || callMuted || !wsReady || !liveWs || liveWs.readyState !== WebSocket.OPEN) {
                if (callMuted) {
                    callSpeechActive = false;
                    resetCallMicBuffers();
                }
                return;
            }
            
            const inputData = e.inputBuffer.getChannelData(0);

            // Do the cheap gate check before allocating/downsampling anything.
            let sum = 0;
            for (let i = 0; i < inputData.length; i++) {
                sum += inputData[i] * inputData[i];
            }
            const rms = Math.sqrt(sum / inputData.length);
            updateMicLevelUi(rms, 'call');

            const now = Date.now();
            const targetSampleRate = 16000;
            const gate = getClientNoiseGateThreshold();
            const isSpeech = rms >= gate;
            const silenceThresholdMs = Math.max(150, Number(extension_settings[MODULE_NAME]?.silenceThreshold || defaultSettings.silenceThreshold));
            const tailThresholdMs = Math.max(CLIENT_SPEECH_HANGOVER_MS, silenceThresholdMs);

            let downsampled = null;
            const getDownsampled = () => {
                if (!downsampled) {
                    downsampled = downsampleAudio(inputData, audioContext.sampleRate, targetSampleRate);
                }
                return downsampled;
            };

            if (isSpeech) {
                if (!callSpeechActive) {
                    startCallUtterance(getDownsampled(), rms, targetSampleRate);
                } else {
                    appendCallUtteranceFrame(getDownsampled(), rms, true);
                    lastSpeechFrameAt = now;
                }
                lastSpeechFrameAt = now;
            } else if (callSpeechActive) {
                const silenceMs = now - lastSpeechFrameAt;
                const shouldKeepShortTail = silenceMs <= tailThresholdMs;
                if (!shouldKeepShortTail) {
                    flushCallUtteranceIfNeeded(targetSampleRate, 'silence');
                    return;
                }
                appendCallUtteranceFrame(getDownsampled(), rms, false);
            } else {
                pushCallPreRollFrame(getDownsampled(), targetSampleRate);
                return;
            }

            const maxSamples = Math.floor((CLIENT_MAX_UTTERANCE_MS / 1000) * targetSampleRate);
            if (callUtteranceSamples >= maxSamples) {
                flushCallUtteranceIfNeeded(targetSampleRate, 'max_duration');
                return;
            }

            if (!isSpeech && callSpeechActive && (now - lastSpeechFrameAt) >= silenceThresholdMs) {
                flushCallUtteranceIfNeeded(targetSampleRate, 'silence_threshold');
            }
        };
        
        console.debug(DEBUG_PREFIX + 'Audio capture started');
        
    } catch (error) {
        console.error(DEBUG_PREFIX + 'Failed to start audio capture:', error);
        throw error;
    }
}

/**
 * Stop audio capture
 */
function stopAudioCapture(flushPendingUtterance = false) {
    if (flushPendingUtterance) {
        flushCallUtteranceIfNeeded(16000, 'hold_release');
    }

    callSpeechActive = false;
    resetCallMicBuffers();
    lastSpeechFrameAt = 0;

    if (scriptProcessor) {
        scriptProcessor.disconnect();
        scriptProcessor = null;
    }
    if (scriptProcessorSilentGain) {
        scriptProcessorSilentGain.disconnect();
        scriptProcessorSilentGain = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
        micStream = null;
    }
    if (!micLevelTestActive) {
        updateMicLevelUi(0, 'idle');
    }
    console.debug(DEBUG_PREFIX + 'Audio capture stopped');
}

/**
 * Stop WebSocket connection
 */
function stopLiveTranscription() {
    if (liveWs) {
        try {
            flushCallUtteranceIfNeeded();
            liveWs.send(JSON.stringify({ type: 'end' }));
            liveWs.close();
        } catch (e) { /* ignore */ }
        liveWs = null;
    }
    wsReady = false;
}

/**
 * Start call mode
 */
function setupVolumeSliderEvents() {
    const sliderWrapper = document.getElementById('voiceforge_call_volume_slider_wrapper');
    const volumeContainer = document.getElementById('voiceforge_call_volume_container');
    const volumeButton = volumeContainer?.querySelector('#voiceforge_call_volume_button');
    const volumeSlider = sliderWrapper?.querySelector('#voiceforge_call_volume_slider');
    if (!volumeSlider || !volumeButton || !volumeContainer) {
        console.warn(DEBUG_PREFIX + 'Volume slider elements missing');
        return;
    }
    const updateVolumeIcon = (vol) => {
        volumeButton.className = `fa-solid ${vol === 0 ? 'fa-volume-xmark' : vol < 33 ? 'fa-volume-off' : vol < 66 ? 'fa-volume-low' : 'fa-volume-high'}`;
        volumeButton.title = `TTS Volume: ${vol}%\\nClick and drag slider to adjust`;
    };
    volumeSlider.addEventListener('input', (e) => {
        const vol = parseInt(e.target.value);
        persistTtsVolume(vol);
        saveSettingsDebounced();
        updateVolumeIcon(vol);
        const audioEl = document.getElementById('voiceforge_audio');
        if (audioEl) audioEl.volume = vol / 100;
        document.dispatchEvent(new CustomEvent('voiceforge-tts-volume-change', { detail: { volume: vol } }));
    });
    const positionAndShowSlider = () => {
        const rect = volumeButton.getBoundingClientRect();
        sliderWrapper.style.left = `${rect.left + rect.width / 2}px`;
        sliderWrapper.style.top = `${rect.top - 110}px`;
        sliderWrapper.style.opacity = '1';
        sliderWrapper.style.visibility = 'visible';
        sliderWrapper.style.pointerEvents = 'auto';
    };
    const hideSlider = () => {
        sliderWrapper.style.opacity = '0';
        sliderWrapper.style.visibility = 'hidden';
        sliderWrapper.style.pointerEvents = 'none';
    };
    volumeButton.addEventListener('mouseenter', positionAndShowSlider);
    volumeContainer.addEventListener('mouseenter', positionAndShowSlider);
    sliderWrapper.addEventListener('mouseenter', positionAndShowSlider);
    volumeButton.addEventListener('mouseleave', hideSlider);
    volumeContainer.addEventListener('mouseleave', hideSlider);
    sliderWrapper.addEventListener('mouseleave', hideSlider);
}

export async function startCall(options = {}) {
    if (callActive) {
        console.debug(DEBUG_PREFIX + 'Call already active');
        return;
    }
    if (outgoingCallActive) {
        console.debug(DEBUG_PREFIX + 'Outgoing call already ringing');
        return;
    }
    const showOutgoingPrompt = options?.showOutgoingPrompt === true;
    const generateIncomingAcceptedResponse = options?.generateIncomingAcceptedResponse === true;
    const outgoingRingStartedAt = showOutgoingPrompt ? Date.now() : 0;
    hideIncomingCallPrompt();
    stopRandomCallScheduler();
    if (showOutgoingPrompt) {
        showOutgoingCallPrompt();
        ensureCallTtsAutoplay();
    }
    
    console.debug(DEBUG_PREFIX + 'Starting call mode...');
    stopMicLevelTest();
    callActive = true;
    overlaySuspendedByVisibility = false;
    playCallSnapSfx('start');
    startCallAmbientLoop();
    lastSpokenSnapCueAt = 0;
    whisperCharacterHint = getCharacterNameFallback();
    prewarmSpokenWhispers(whisperCharacterHint);
    prewarmBreathGuidancePrompts(whisperCharacterHint);
    // Mobile uses hold-to-talk, so calls intentionally start muted.
    callMuted = isMobileCallModeDevice();
    lastSentText = '';
    lastSendTime = 0;
    lastMetadataTimestampAt = 0;
    activeTtsSequence = null;
    clearCallSubtitle();

    applyWeatherContextLifecycle();
    
    // Show microphone button for call mode (mute/unmute only)
    const micButton = document.getElementById('voiceforge_microphone_button');
    if (micButton) {
        micButton.style.display = '';
        if (callMuted) {
            micButton.classList.remove('fa-microphone');
            micButton.classList.add('muted', 'fa-microphone-slash');
            micButton.title = isMobileCallModeDevice() ? 'Hold to speak' : 'Muted - Click to unmute';
        } else {
            micButton.classList.remove('muted', 'fa-microphone-slash');
            micButton.classList.add('fa-microphone');
            micButton.title = 'Click to mute';
        }
    }
    
    // Show volume control for call mode
    const volumeContainer = document.getElementById('voiceforge_call_volume_container');
    if (volumeContainer) {
        volumeContainer.style.display = '';
    }
    
    // Recreate volume slider if it was removed
    let sliderWrapper = document.getElementById('voiceforge_call_volume_slider_wrapper');
    if (!sliderWrapper) {
        sliderWrapper = document.createElement('div');
        sliderWrapper.id = 'voiceforge_call_volume_slider_wrapper';
        sliderWrapper.className = 'voiceforge-volume-slider-wrapper';
        const currentVolume = getSavedTtsVolume();
        sliderWrapper.innerHTML = `<input type="range" id="voiceforge_call_volume_slider" min="0" max="100" value="${currentVolume}" orient="vertical">`;
        document.body.appendChild(sliderWrapper);
        
        // Setup slider event listeners
        setupVolumeSliderEvents();
    }

    applyQuickRepliesPlacementForCallMode();
    setTimeout(() => {
        if (callActive) {
            applyQuickRepliesPlacementForCallMode();
        }
    }, 250);
    setTimeout(() => {
        if (callActive) {
            applyQuickRepliesPlacementForCallMode();
        }
    }, 1200);
    
    // Hide chat if enabled
    if (extension_settings[MODULE_NAME]?.hideChatShield) {
        $('#chat').css('display', 'none');
        // Also hide QR bar buttons when chat is disabled
        if (extension_settings[MODULE_NAME]?.moveQuickRepliesToSendArea !== true) {
            $('#qr--bar > .qr--buttons').css('display', 'none');
        }
    }
    
    // Show overlay if enabled
    if (extension_settings[MODULE_NAME]?.overlayEnabled) {
        showCallOverlay();
        if (isDocumentHidden() || isGlobalUiPanelOpen()) {
            overlaySuspendedByUiInteraction = isGlobalUiPanelOpen();
            pauseOverlayVisualLoops();
        }
    }
    
    // Enable auto-play TTS
    ensureCallTtsAutoplay();
    
    try {
        if (!callMuted || isMobileCallModeDevice()) {
            await startAudioCapture();
        }
        await startLiveTranscription();
        
        setCallState('listening');
        setupCallEventListeners();
        if (showOutgoingPrompt) {
            await sendOutgoingCallPromptMessage();
            const remainingRingMs = Math.max(0, OUTGOING_CALL_MIN_RING_MS - (Date.now() - outgoingRingStartedAt));
            if (remainingRingMs > 0) {
                await waitMs(remainingRingMs);
            }
        }
        if (generateIncomingAcceptedResponse) {
            await sendIncomingCallAcceptedMessage();
        }
        hideOutgoingCallPrompt();
        
        console.debug(DEBUG_PREFIX + 'Call mode started');
    } catch (error) {
        console.error(DEBUG_PREFIX + 'Failed to start call:', error);
        hideOutgoingCallPrompt();
        endCall();
    }
}

/**
 * End call mode
 */
export function endCall() {
    if (!callActive) return;
    
    console.debug(DEBUG_PREFIX + 'Ending call mode...');
    callActive = false;
    overlaySuspendedByVisibility = false;
    hideOutgoingCallPrompt();
    stopCallAmbientLoop(true);
    stopCallParticleAmbientLoop(true);
    callParticleAmbientStyle = null;
    stopHypnoEasterEggs();
    playCallSnapSfx('end');
    lastSpokenSnapCueAt = 0;
    whisperCharacterHint = null;
    stopSpokenWhisperAudio(true);
    activeTtsSequence = null;
    // Hide microphone button when call ends
    const micButton = document.getElementById('voiceforge_microphone_button');
    if (micButton) {
        micButton.style.display = 'none';
    }
    
    // Hide volume control (only shown in call mode)
    const volumeContainer = document.getElementById('voiceforge_call_volume_container');
    if (volumeContainer) {
        volumeContainer.style.display = 'none';
    }
    
    // Remove slider from body
    const sliderWrapper = document.getElementById('voiceforge_call_volume_slider_wrapper');
    if (sliderWrapper) {
        sliderWrapper.remove();
    }
    
    // Show chat again if it was hidden
    if (extension_settings[MODULE_NAME]?.hideChatShield) {
        $('#chat').css('display', '');
        // Also show QR bar buttons again
        $('#qr--bar > .qr--buttons').css('display', '');
    }

    applyQuickRepliesPlacementForCallMode();
    
    // Hide overlay if it was shown
    hideCallOverlay();
    stopHypnoWhispers();
    clearCallSubtitle();
    
    // Stop TTS
    try {
        cancelTtsPlay();
    } catch (e) { /* ignore */ }
    
    // Stop audio/websocket
    stopLiveTranscription();
    stopAudioCapture();
    updateMicLevelUi(0, 'idle');
    
    // Reset state
    lastSentText = '';
    lastSendTime = 0;
    activeTtsSequence = null;
    activeTtsRequestId = null;
    
    setCallState('idle');
    removeCallEventListeners();
    
    console.debug(DEBUG_PREFIX + 'Call mode ended');
    applyRandomCallCooldown();
}

/**
 * Toggle call mode
 */
export function toggleCall() {
    if (callActive) {
        endCall();
    } else {
        startCall({ showOutgoingPrompt: true });
    }
}


/**
 * Handle TTS start
 */
function onTtsStart(payload = {}) {
    if (!callActive) return;
    const newSequence = Number.isFinite(payload?.sequence) ? payload.sequence : null;
    const newRequestId = typeof payload?.requestId === 'string' && payload.requestId.trim()
        ? payload.requestId.trim()
        : null;
    if (newSequence !== null) {
        activeTtsSequence = newSequence;
        console.debug(DEBUG_PREFIX + 'TTS started with sequence:', newSequence);
    }
    if (newRequestId) {
        activeTtsRequestId = newRequestId;
    }
    setCallState('speaking');
}

/**
 * Handle TTS end
 */
function onTtsEnd(payload = {}) {
    if (!callActive) return;

    const payloadSequence = Number.isFinite(payload?.sequence) ? payload.sequence : null;
    if (payloadSequence !== null && activeTtsSequence !== null && payloadSequence !== activeTtsSequence) {
        return;
    }

    console.debug(DEBUG_PREFIX + 'TTS ended');
    lastTtsEndTime = Date.now();
    activeTtsSequence = null;
    activeTtsRequestId = null;

    setTimeout(() => {
        if (callActive && callState === 'speaking') {
            setCallState('listening');
            if (subtitleClearTimer) {
                clearTimeout(subtitleClearTimer);
            }
            subtitleClearTimer = setTimeout(() => {
                if (callActive && callState !== 'speaking') {
                    clearCallSubtitle();
                }
            }, SUBTITLE_POST_END_CLEAR_MS);
        }
    }, TTS_END_COOLDOWN);
}

function onTtsSegment(payload) {
    if (!callActive || !payload || typeof payload.text !== 'string') return;

    const payloadSequence = Number.isFinite(payload?.sequence) ? payload.sequence : null;

    if (activeTtsSequence === null && payloadSequence !== null) {
        activeTtsSequence = payloadSequence;
        console.debug(DEBUG_PREFIX + 'Synced sequence from segment:', payloadSequence);
    }

    if (payloadSequence !== null && activeTtsSequence !== null && payloadSequence !== activeTtsSequence) {
        return;
    }

    // Subtitles mirror the filtered text that the main TTS queue actually spoke.
    const sourceText = String(payload.text || '').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
    const normalized = normalizeSubtitleText(sourceText);

    // Filter out empty or punctuation-only strings (including errant quotes and ellipsis)
    if (!normalized || /^[\s.,!?�\-"'''�"''????\[\]]+$/.test(normalized)) {
        return;
    }

    const now = Date.now();
    if (normalized && normalized === lastSubtitleText && (now - lastSubtitleAt) < 1200) {
        return;
    }

    lastSubtitleText = normalized;
    lastSubtitleAt = now;
    showCallSubtitleLines(splitSubtitleIntoLines(normalized), payload);

    setTimeout(() => {
        if (!callActive) return;
        bumpTranceDepth(0.08);
        if (typeof payload.char === 'string' && payload.char.trim()) {
            whisperCharacterHint = payload.char.trim();
            prewarmSpokenWhispers(whisperCharacterHint);
            prewarmBreathGuidancePrompts(whisperCharacterHint);
        }
        maybePlaySpokenSnapCue(normalized);
    }, 0);
}

function normalizeSubtitleText(sourceText) {
    const source = String(sourceText || '');
    const metadataTagRegex = /<\s*metadata:[^>]*>/gi;
    const intifaceBlockRegex = /<\s*intiface_commands\s*>[\s\S]*?<\s*\/\s*intiface_commands\s*>/gi;
    const bracketTagRegex = /<\s*([^>]+?)\s*>/g;

    let subtitleSafe = source.replace(metadataTagRegex, ' ');
    subtitleSafe = subtitleSafe.replace(intifaceBlockRegex, ' [intiface commands] ');
    subtitleSafe = subtitleSafe.replace(bracketTagRegex, (_full, inner) => {
        const text = String(inner || '').trim().toLowerCase();
        if (!text) return ' ';
        if (text.startsWith('media:')) return ' [media action] ';
        if (text.startsWith('device:') || text.startsWith('any:') || text.startsWith('interface:')) return ' [device action] ';
        if (text.includes('intiface')) return ' [intiface command] ';
        return ' [command] ';
    });

    return subtitleSafe.replace(/\s+/g, ' ').trim();
}

/**
 * Handle AI generation start
 */
function onAiMessageStart() {
    if (!callActive) return;
    setCallState('processing');
}

/**
 * Handle user message - interrupt if speaking
 */
function onUserInput() {
    if (!callActive) return;
    
    // Always interrupt TTS when user provides input
    if (callState === 'speaking') {
        void interruptActiveResponse('user_input');
        clearCallSubtitle();
    }
}

/**
 * Handle chat change - end call mode
 */
function onChatChanged() {
    lastMetadataTimestampAt = 0;
    if (incomingCallActive) {
        hideIncomingCallPrompt({ applyCooldown: true });
    }

    if (callActive) {
        console.debug(DEBUG_PREFIX + 'Chat changed, ending call');
        endCall();
    }

    if (extension_settings[MODULE_NAME]?.moveQuickRepliesToSendArea === true) {
        setTimeout(() => applyQuickRepliesPlacementForCallMode(), 0);
    }
}

/**
 * Setup event listeners
 */
function setupCallEventListeners() {
    eventSource.on(event_types.GENERATION_STARTED, onAiMessageStart);
    eventSource.on('voiceforge_tts_start', onTtsStart);
    eventSource.on('voiceforge_tts_end', onTtsEnd);
    eventSource.on('voiceforge_tts_spoken_text', onTtsSegment);
}

/**
 * Remove event listeners
 */
function removeCallEventListeners() {
    try {
        eventSource.off(event_types.GENERATION_STARTED, onAiMessageStart);
        eventSource.off('voiceforge_tts_start', onTtsStart);
        eventSource.off('voiceforge_tts_end', onTtsEnd);
        eventSource.off('voiceforge_tts_spoken_text', onTtsSegment);
    } catch (e) {
        console.warn(DEBUG_PREFIX + 'Failed to remove event listeners:', e);
    }
}

/**
 * Create the call mode UI elements
 */
function createCallUI() {
    // Prevent duplicate creation
    if (document.getElementById('voiceforge_call_button')) {
        return;
    }
    
    // Create microphone button for call mode mute/unmute (hidden by default)
    let micButton = document.getElementById('voiceforge_microphone_button');
    if (!micButton) {
        micButton = document.createElement('div');
        micButton.id = 'voiceforge_microphone_button';
        micButton.className = 'fa-solid fa-microphone interactable';
        micButton.tabIndex = 0;
        micButton.style.display = 'none';
        micButton.style.cursor = 'pointer';
        micButton.style.padding = '5px 8px';
        micButton.style.fontSize = '1.1em';
        
        // Add click handler for mute/unmute
        const isMobile = isMobileCallModeDevice();
        
        if (isMobile) {
            // Mobile: hold to talk
            micButton.setAttribute('title', 'Hold to speak');
            micButton.style.touchAction = 'none';
            let holdToTalkActive = false;
            let lastTouchAt = 0;
            
            const holdToTalkStart = (event) => {
                event?.preventDefault?.();
                if (event?.type?.startsWith('mouse') && Date.now() - lastTouchAt < 700) {
                    return;
                }
                if (event?.type?.startsWith('touch')) {
                    lastTouchAt = Date.now();
                }
                holdToTalkActive = true;
                if (callActive && callMuted) {
                    callMuted = false;
                    audioContext?.resume?.().catch(() => {});
                    if (!micStream || !audioContext || !scriptProcessor) {
                        startAudioCapture().catch(err => {
                            console.debug(DEBUG_PREFIX + 'Failed to start audio capture:', err);
                        });
                    }
                    playMuteSound(false);
                    updateUI();
                }
            };
            
            const holdToTalkEnd = (event) => {
                event?.preventDefault?.();
                if (event?.type?.startsWith('mouse') && Date.now() - lastTouchAt < 700) {
                    return;
                }
                holdToTalkActive = false;
                if (callActive && !callMuted) {
                    flushCallUtteranceIfNeeded(16000, 'hold_release');
                    callMuted = true;
                    playMuteSound(true);
                    updateUI();
                }
            };

            const holdToTalkCancel = (event) => {
                if (holdToTalkActive) {
                    holdToTalkEnd(event);
                }
            };
            
            if (window.PointerEvent) {
                micButton.onpointerdown = (event) => {
                    if (event.pointerType === 'mouse') return;
                    micButton.setPointerCapture?.(event.pointerId);
                    holdToTalkStart(event);
                };
                micButton.onpointerup = holdToTalkEnd;
                micButton.onpointercancel = holdToTalkEnd;
                micButton.onpointerleave = holdToTalkCancel;
            } else {
                micButton.ontouchstart = holdToTalkStart;
                micButton.ontouchend = holdToTalkEnd;
                micButton.ontouchcancel = holdToTalkEnd;
                micButton.onmousedown = holdToTalkStart;
                micButton.onmouseup = holdToTalkEnd;
                micButton.onmouseleave = holdToTalkCancel;
            }
        } else {
            // Desktop: toggle
            micButton.onclick = () => {
                if (callActive) {
                    toggleCallMute();
                }
            };
        }
        
        // Add to send area
        const sendArea = getSendAreaElement();
        if (sendArea) {
            sendArea.prepend(micButton);
        }
    }
    
    // Call button (phone icon)
    callButton = document.createElement('div');
    callButton.id = 'voiceforge_call_button';
    callButton.className = 'fa-solid fa-phone interactable';
    callButton.title = 'Start Call Mode';
    callButton.tabIndex = 0;
    callButton.onclick = toggleCall;
    
    // Create TTS volume control (button + vertical slider)
    // Uses the same playbackBar.tts_volume as the TTS bar
    const volumeContainer = document.createElement('div');
    volumeContainer.id = 'voiceforge_call_volume_container';
    volumeContainer.className = 'voiceforge-volume-control';
    volumeContainer.style.display = 'none'; // Hidden by default, shown in call mode
    
    // Ensure playbackBar settings exist
    if (!extension_settings.tts.playbackBar) {
        extension_settings.tts.playbackBar = { tts_volume: 100, playback_speed: 1.0, auto_hide_delay: 2000 };
    }
    const currentVolume = getSavedTtsVolume();
    persistTtsVolume(currentVolume);
    
    volumeContainer.innerHTML = `
        <div id="voiceforge_call_volume_button" class="fa-solid ${currentVolume === 0 ? 'fa-volume-xmark' : currentVolume < 33 ? 'fa-volume-off' : currentVolume < 66 ? 'fa-volume-low' : 'fa-volume-high'}" title="TTS Volume: ${currentVolume}%\nClick and drag slider to adjust"></div>
    `;
    
    // Create separate slider element attached to body (prevents layout issues)
    const sliderWrapper = document.createElement('div');
    sliderWrapper.id = 'voiceforge_call_volume_slider_wrapper';
    sliderWrapper.className = 'voiceforge-volume-slider-wrapper';
    sliderWrapper.innerHTML = `<input type="range" id="voiceforge_call_volume_slider" min="0" max="100" value="${currentVolume}" orient="vertical">`;
    document.body.appendChild(sliderWrapper);
    
    // Add to send area
    const sendArea = getSendAreaElement();
    if (sendArea) {
        // Insert in order: volume, mic, call button
        sendArea.prepend(callButton);
        if (micButton) {
            sendArea.prepend(micButton);
            // Mic only visible during call mode (for mute/unmute)
            micButton.style.display = callActive ? '' : 'none';
        }
        sendArea.prepend(volumeContainer);
        
        // Setup volume slider event
        const volumeSlider = sliderWrapper.querySelector('#voiceforge_call_volume_slider');
        const volumeButton = volumeContainer.querySelector('#voiceforge_call_volume_button');
        
        const updateVolumeIcon = (vol) => {
            volumeButton.className = 'fa-solid ' + (vol === 0 ? 'fa-volume-xmark' : vol < 33 ? 'fa-volume-off' : vol < 66 ? 'fa-volume-low' : 'fa-volume-high');
            volumeButton.title = `TTS Volume: ${vol}%\nClick and drag slider to adjust`;
        };
        
        volumeSlider.addEventListener('input', (e) => {
            const vol = parseInt(e.target.value);
            
            // Save to playback bar and shared tts volume keys
            persistTtsVolume(vol);
            saveSettingsDebounced();
            
            // Update button icon
            updateVolumeIcon(vol);
            
            // Update audio element volume (immediate effect)
            const audioEl = document.getElementById('voiceforge_audio');
            if (audioEl) {
                audioEl.volume = vol / 100;
            }
            
            // Dispatch volume change event for streaming audio
            const event = new CustomEvent('voiceforge-tts-volume-change', { detail: { volume: vol } });
            document.dispatchEvent(event);
        });
        
        // Add positioning logic to show/hide the slider
        const positionAndShowSlider = () => {
            const rect = volumeButton.getBoundingClientRect();
            const desiredLeft = rect.left + (rect.width / 2);
            const desiredTop = rect.top - 110;
            const clampedLeft = Math.max(24, Math.min(window.innerWidth - 24, desiredLeft));
            const clampedTop = Math.max(8, Math.min(window.innerHeight - 120, desiredTop));
            sliderWrapper.style.left = clampedLeft + 'px';
            sliderWrapper.style.top = clampedTop + 'px';
            sliderWrapper.style.opacity = '1';
            sliderWrapper.style.visibility = 'visible';
            sliderWrapper.style.pointerEvents = 'auto';
        };
        
        const hideSlider = () => {
            sliderWrapper.style.opacity = '0';
            sliderWrapper.style.visibility = 'hidden';
            sliderWrapper.style.pointerEvents = 'none';
        };
        
        volumeButton.addEventListener('mouseenter', positionAndShowSlider);
        volumeContainer.addEventListener('mouseenter', positionAndShowSlider);
        sliderWrapper.addEventListener('mouseenter', positionAndShowSlider);
        
        volumeButton.addEventListener('mouseleave', hideSlider);
        volumeContainer.addEventListener('mouseleave', hideSlider);
        sliderWrapper.addEventListener('mouseleave', hideSlider);
    }
}

function getSendAreaElement() {
    return document.querySelector('#send_but_sheld') || document.querySelector('#rightSendForm') || document.querySelector('#send_form');
}

function getQuickReplyDockElement() {
    return document.getElementById('extensionsMenu') || document.querySelector('#leftSendForm') || getSendAreaElement();
}

function moveQuickRepliesToSendArea() {
    const qrBar = document.getElementById('qr--bar');
    const dockArea = getQuickReplyDockElement();
    if (!qrBar || !dockArea) {
        return;
    }

    if (qrBar.parentElement !== dockArea) {
        qrBarOriginalParent = qrBar.parentElement;
        qrBarOriginalNextSibling = qrBar.nextSibling;
    }

    dockArea.prepend(qrBar);

    qrBar.classList.remove('voiceforge-call-qr-in-wand', 'voiceforge-call-qr-inline');
    if (dockArea.id === 'extensionsMenu') {
        qrBar.classList.add('voiceforge-call-qr-in-wand');
    } else {
        qrBar.classList.add('voiceforge-call-qr-inline');
    }

    qrBarMovedToSendArea = true;
}

function restoreQuickRepliesPlacement() {
    if (!qrBarMovedToSendArea) {
        return;
    }

    const qrBar = document.getElementById('qr--bar');
    if (!qrBar) {
        qrBarMovedToSendArea = false;
        qrBarOriginalParent = null;
        qrBarOriginalNextSibling = null;
        return;
    }

    if (qrBarOriginalParent && qrBarOriginalParent.isConnected) {
        qrBar.classList.remove('voiceforge-call-qr-inline', 'voiceforge-call-qr-in-wand');
        if (qrBarOriginalNextSibling && qrBarOriginalNextSibling.parentNode === qrBarOriginalParent) {
            qrBarOriginalParent.insertBefore(qrBar, qrBarOriginalNextSibling);
        } else {
            qrBarOriginalParent.appendChild(qrBar);
        }
    } else {
        qrBar.classList.remove('voiceforge-call-qr-inline', 'voiceforge-call-qr-in-wand');
    }

    qrBarMovedToSendArea = false;
    qrBarOriginalParent = null;
    qrBarOriginalNextSibling = null;
}

function applyQuickRepliesPlacementForCallMode() {
    const shouldMove = extension_settings[MODULE_NAME]?.moveQuickRepliesToSendArea === true;
    if (shouldMove) {
        moveQuickRepliesToSendArea();
    } else {
        restoreQuickRepliesPlacement();
    }
}

/**
 * Add call mode styles
 */
function addCallStyles() {
    const style = document.createElement('style');
    style.textContent = `
        #voiceforge_call_button {
            cursor: pointer;
            padding: 5px 8px;
            font-size: 1.1em;
            color: #f5ab40;
            text-shadow: 0 0 8px rgba(245, 171, 64, 0.42);
            transition: transform 0.9s cubic-bezier(0.2, 0.7, 0.2, 1), opacity 0.25s ease, filter 0.7s ease;
            opacity: 0.7;
        }
        #voiceforge_call_button:hover {
            opacity: 1;
        }

        #voiceforge_microphone_button {
            color: #4ade80;
            text-shadow: 0 0 8px rgba(74, 222, 128, 0.55);
            transition: color 0.2s ease, text-shadow 0.2s ease, opacity 0.2s ease;
        }

        #voiceforge_microphone_button.muted {
            color: #ef4444;
            text-shadow: 0 0 8px rgba(239, 68, 68, 0.62);
        }

        #voiceforge_incoming_call_prompt,
        #voiceforge_outgoing_call_prompt {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            overflow: hidden;
            background:
                radial-gradient(circle at 50% 35%, rgba(251, 170, 72, 0.19), transparent 18%),
                radial-gradient(circle at 50% 50%, rgba(210, 113, 31, 0.15), transparent 45%),
                linear-gradient(180deg, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0.9));
            opacity: 0;
            pointer-events: none;
            transition: opacity 180ms ease;
            backdrop-filter: blur(10px) saturate(125%);
            -webkit-backdrop-filter: blur(10px) saturate(125%);
        }

        #voiceforge_incoming_call_prompt::before,
        #voiceforge_outgoing_call_prompt::before {
            content: '';
            position: absolute;
            inset: 0;
            background:
                repeating-linear-gradient(90deg, rgba(255, 185, 96, 0.032) 0 1px, transparent 1px 72px),
                repeating-linear-gradient(0deg, rgba(255, 185, 96, 0.024) 0 1px, transparent 1px 72px);
            opacity: 0.42;
            pointer-events: none;
        }

        #voiceforge_incoming_call_prompt::after,
        #voiceforge_outgoing_call_prompt::after {
            content: '';
            position: absolute;
            inset: 0;
            background:
                radial-gradient(circle at 50% 50%, transparent 0 28%, rgba(0, 0, 0, 0.32) 66%, rgba(0, 0, 0, 0.76) 100%),
                linear-gradient(120deg, rgba(255, 190, 100, 0.06), transparent 38%, rgba(255, 145, 55, 0.035) 78%, transparent);
            pointer-events: none;
        }

        #voiceforge_incoming_call_prompt.visible,
        #voiceforge_outgoing_call_prompt.visible {
            opacity: 1;
            pointer-events: auto;
        }

.vf-incoming-call-card {
            width: min(92vw, 360px);
            padding: 28px 22px 22px;
            border-radius: 26px;
            color: #fff;
            text-align: center;
            background:
                radial-gradient(circle at 50% 0%, rgba(252, 186, 89, 0.16), transparent 42%),
                linear-gradient(180deg, rgba(33, 19, 10, 0.78), rgba(0, 0, 0, 0.84));
            border: 1px solid rgba(255, 176, 82, 0.26);
            box-shadow:
                0 28px 90px rgba(0, 0, 0, 0.62),
                inset 0 1px 0 rgba(255, 206, 140, 0.1),
                0 0 74px rgba(207, 104, 28, 0.18);
            backdrop-filter: blur(18px) saturate(135%);
            -webkit-backdrop-filter: blur(18px) saturate(135%);
            transform: translateY(12px) scale(0.96);
            transition: transform 180ms ease;
            position: relative;
            z-index: 1;
        }

        @media (max-width: 768px) {
            #voiceforge_incoming_call_prompt,
            #voiceforge_outgoing_call_prompt {
                backdrop-filter: blur(4px) saturate(110%);
                -webkit-backdrop-filter: blur(4px) saturate(110%);
            }
            .vf-incoming-call-card {
                backdrop-filter: blur(8px) saturate(120%);
                -webkit-backdrop-filter: blur(8px) saturate(120%);
            }
        }

        #voiceforge_incoming_call_prompt.visible .vf-incoming-call-card,
        #voiceforge_outgoing_call_prompt.visible .vf-incoming-call-card {
            transform: translateY(0) scale(1);
        }

        .vf-outgoing-call-card {
            box-shadow:
                0 28px 90px rgba(0, 0, 0, 0.62),
                inset 0 1px 0 rgba(255, 206, 140, 0.1),
                0 0 74px rgba(207, 104, 28, 0.18);
        }

        .vf-incoming-call-orb {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 92px;
            height: 92px;
            margin-bottom: 16px;
            border-radius: 50%;
            color: #fff;
            font-size: 34px;
            background:
                radial-gradient(circle at 36% 24%, rgba(255, 226, 170, 0.48), transparent 30%),
                radial-gradient(circle at 50% 50%, rgba(255, 183, 80, 0.28), rgba(20, 11, 5, 0.94) 67%);
            border: 1px solid rgba(255, 171, 72, 0.32);
            box-shadow: 0 0 0 0 rgba(255, 171, 72, 0.35), inset 0 0 26px rgba(255, 148, 49, 0.12), 0 0 24px rgba(255, 148, 49, 0.16);
            animation: vf-incoming-call-ring 1.45s ease-out infinite;
        }

        .vf-incoming-call-orb i {
            animation: vf-incoming-call-wiggle 820ms ease-in-out infinite;
        }

        .vf-outgoing-call-orb {
            background:
                radial-gradient(circle at 36% 24%, rgba(255, 226, 170, 0.48), transparent 30%),
                radial-gradient(circle at 50% 50%, rgba(255, 183, 80, 0.28), rgba(20, 11, 5, 0.94) 67%);
            animation: vf-outgoing-call-ring 1.2s ease-out infinite;
        }

        .vf-incoming-call-label {
            margin-bottom: 5px;
            font-size: 0.82rem;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.68);
        }

        .vf-incoming-call-name {
            margin-bottom: 22px;
            font-size: clamp(24px, 7vw, 36px);
            line-height: 1.05;
            font-weight: 700;
            text-shadow: 0 0 22px rgba(255, 169, 72, 0.28);
            word-break: break-word;
        }

        .vf-incoming-call-actions {
            display: flex;
            gap: 12px;
            justify-content: center;
        }

        .vf-incoming-call-actions .menu_button {
            min-width: 116px;
            min-height: 44px;
            border-radius: 999px;
            font-weight: 700;
        }

        .vf-outgoing-call-status {
            margin-top: -10px;
            color: rgba(255, 255, 255, 0.7);
            font-size: 0.95rem;
            letter-spacing: 0.04em;
            animation: vf-outgoing-call-status 1.2s ease-in-out infinite;
        }

        .vf-incoming-call-deny {
            background: rgba(45, 27, 14, 0.9) !important;
            color: #fff !important;
            border-color: rgba(255, 176, 82, 0.22) !important;
        }

        .vf-incoming-call-accept {
            background: rgba(245, 171, 64, 0.94) !important;
            color: #1b0f05 !important;
            border-color: rgba(255, 221, 161, 0.32) !important;
        }

        .vf-incoming-call-deny:hover,
        .vf-incoming-call-accept:hover {
            filter: brightness(1.08);
        }

        .vf-incoming-call-deny:active,
        .vf-incoming-call-accept:active {
            transform: translateY(1px);
        }

        .vf-incoming-call-deny i,
        .vf-incoming-call-accept i {
            color: #fff !important;
        }

        @keyframes vf-incoming-call-ring {
            0% { box-shadow: 0 0 0 0 rgba(255, 171, 72, 0.34), inset 0 0 26px rgba(255, 148, 49, 0.12), 0 0 24px rgba(255, 148, 49, 0.16); }
            70% { box-shadow: 0 0 0 26px rgba(255, 171, 72, 0), inset 0 0 26px rgba(255, 148, 49, 0.12), 0 0 24px rgba(255, 148, 49, 0.16); }
            100% { box-shadow: 0 0 0 0 rgba(255, 171, 72, 0), inset 0 0 26px rgba(255, 148, 49, 0.12), 0 0 24px rgba(255, 148, 49, 0.16); }
        }

        @keyframes vf-incoming-call-wiggle {
            0%, 100% { transform: rotate(0deg); }
            15% { transform: rotate(-14deg); }
            30% { transform: rotate(12deg); }
            45% { transform: rotate(-8deg); }
            60% { transform: rotate(6deg); }
            75% { transform: rotate(-2deg); }
        }

        @keyframes vf-outgoing-call-ring {
            0% { box-shadow: 0 0 0 0 rgba(255, 171, 72, 0.32), inset 0 0 26px rgba(255, 148, 49, 0.12), 0 0 24px rgba(255, 148, 49, 0.16); }
            72% { box-shadow: 0 0 0 30px rgba(255, 171, 72, 0), inset 0 0 26px rgba(255, 148, 49, 0.12), 0 0 24px rgba(255, 148, 49, 0.16); }
            100% { box-shadow: 0 0 0 0 rgba(255, 171, 72, 0), inset 0 0 26px rgba(255, 148, 49, 0.12), 0 0 24px rgba(255, 148, 49, 0.16); }
        }

        @keyframes vf-outgoing-call-status {
            0%, 100% { opacity: 0.55; }
            50% { opacity: 1; }
        }

        #qr--bar.voiceforge-call-qr-inline {
            width: auto;
            max-width: min(28vw, 240px);
            min-width: 0;
            overflow-x: auto;
            overflow-y: hidden;
            opacity: 1;
            margin: 0 2px;
            order: 0;
            flex: 0 0 auto;
            height: calc(var(--bottomFormBlockSize) - 2px);
            align-items: center;
        }

        #leftSendForm > #qr--bar.voiceforge-call-qr-inline,
        #rightSendForm > #qr--bar.voiceforge-call-qr-inline {
            width: auto;
            height: calc(var(--bottomFormBlockSize) - 2px);
            align-self: center;
            border: 0;
        }

        #qr--bar.voiceforge-call-qr-inline > .qr--buttons {
            width: auto;
            max-width: 100%;
            flex-wrap: nowrap;
            justify-content: flex-start;
            gap: 3px;
        }

        #qr--bar.voiceforge-call-qr-inline > .qr--buttons .qr--button {
            min-width: calc(var(--bottomFormBlockSize) - 10px);
            min-height: calc(var(--bottomFormBlockSize) - 10px);
            height: calc(var(--bottomFormBlockSize) - 10px);
            padding: 0 4px;
            border-radius: 7px;
            font-size: 0.82em;
            line-height: 1;
        }

        #qr--bar.voiceforge-call-qr-inline::-webkit-scrollbar {
            height: 0;
            width: 0;
        }

        #qr--bar.voiceforge-call-qr-inline > .qr--buttons .qr--button .qr--button-label {
            display: none;
        }

        #qr--bar.voiceforge-call-qr-inline > .qr--buttons .qr--button .qr--button-icon {
            margin-right: 0;
        }

        #qr--bar.voiceforge-call-qr-inline > #qr--popoutTrigger {
            display: none !important;
        }

        #extensionsMenu > #qr--bar.voiceforge-call-qr-in-wand {
            width: 100%;
            max-width: 100%;
            margin: 0;
            opacity: 1;
            padding: 2px;
            overflow: visible;
        }

        #extensionsMenu > #qr--bar.voiceforge-call-qr-in-wand > .qr--buttons {
            width: 100%;
            max-width: 100%;
            justify-content: flex-start;
            flex-wrap: wrap;
            gap: 4px;
        }

        #extensionsMenu > #qr--bar.voiceforge-call-qr-in-wand > #qr--popoutTrigger {
            display: none !important;
        }

        .voiceforge-call-subtitle {
            position: fixed;
            left: 50%;
            bottom: max(24px, env(safe-area-inset-bottom));
            transform: translateX(-50%);
            z-index: 2147483646;
            width: fit-content;
            max-width: min(90vw, 920px);
            padding: 4px 8px;
            min-height: 0;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.65);
            color: #ffffff;
            text-align: center;
            font-size: clamp(14px, 2vw, 20px);
            line-height: 1.35;
            font-weight: 600;
            text-wrap: balance;
            pointer-events: none;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 8px 28px rgba(0, 0, 0, 0.42), 0 0 40px rgba(255, 180, 120, 0.08);
            backdrop-filter: blur(7px) saturate(130%);
            -webkit-backdrop-filter: blur(7px) saturate(130%);
            will-change: transform, opacity, filter;
            -webkit-backface-visibility: hidden;
            backface-visibility: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: voiceforge-subtitle-breathe 4.8s ease-in-out infinite, voiceforge-subtitle-glow 6s ease-in-out infinite;
        }

        .voiceforge-call-subtitle.vf-subtitle-no-bg {
            background: transparent !important;
            border-color: transparent !important;
            box-shadow: none !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
        }

        .voiceforge-call-subtitle::before {
            content: '';
            position: absolute;
            inset: -50%;
            background: radial-gradient(ellipse at center, rgba(255, 200, 150, 0.15) 0%, transparent 60%);
            mix-blend-mode: screen;
            opacity: 0.4;
            animation: voiceforge-subtitle-soft-pulse 3s ease-in-out infinite;
            pointer-events: none;
        }

        .voiceforge-call-subtitle::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(135deg, rgba(255, 180, 120, 0.05) 0%, transparent 50%, rgba(255, 150, 80, 0.03) 100%);
            pointer-events: none;
            animation: voiceforge-subtitle-shimmer 8s ease-in-out infinite;
        }

        .voiceforge-call-subtitle.vf-subtitle-no-bg::before,
        .voiceforge-call-subtitle.vf-subtitle-no-bg::after {
            display: none;
        }

        .voiceforge-call-subtitle.in-overlay {
            position: absolute;
            left: 50%;
            right: auto;
            transform: translateX(-50%);
            bottom: max(12px, env(safe-area-inset-bottom));
            z-index: 2147483647;
        }

@media (max-width: 768px) {
            .voiceforge-call-subtitle {
                left: 12px;
                right: 12px;
                transform: none;
                width: auto;
                max-width: none;
                bottom: calc(env(safe-area-inset-bottom) + 12px);
                font-size: clamp(13px, 3.7vw, 18px);
                padding: 4px 7px;
            }
            .voiceforge-call-subtitle,
            .voiceforge-call-subtitle::before,
            .voiceforge-call-subtitle::after,
            .voiceforge-call-subtitle-text {
                animation: none !important;
            }
        }

        .voiceforge-call-subtitle-text {
            position: relative;
            display: inline;
            z-index: 1;
            letter-spacing: 0.01em;
            text-shadow:
                0 0 8px rgba(255, 255, 255, 0.3),
                0 0 16px rgba(255, 200, 150, 0.15),
                0 1px 0 rgba(0, 0, 0, 0.12);
            animation: voiceforge-subtitle-text-drift 2.8s ease-in-out infinite, voiceforge-subtitle-text-glow 4s ease-in-out infinite;
        }

        .voiceforge-call-subtitle-text.subtitle-refresh {
            animation:
                voiceforge-subtitle-text-drift 2.8s ease-in-out infinite,
                voiceforge-subtitle-text-glow 4s ease-in-out infinite,
                voiceforge-subtitle-text-pop 560ms cubic-bezier(0.2, 0.7, 0.2, 1);
        }

        @keyframes voiceforge-subtitle-breathe {
            0%, 100% {
                filter: saturate(100%) brightness(100%);
                box-shadow: 0 8px 28px rgba(0, 0, 0, 0.42), 0 0 40px rgba(255, 180, 120, 0.08);
            }
            50% {
                filter: saturate(118%) brightness(106%);
                box-shadow: 0 12px 34px rgba(0, 0, 0, 0.5), 0 0 60px rgba(255, 180, 120, 0.12);
            }
        }

        @keyframes voiceforge-subtitle-glow {
            0%, 100% {
                border-color: rgba(255, 255, 255, 0.2);
            }
            50% {
                border-color: rgba(255, 200, 150, 0.35);
            }
        }

        @keyframes voiceforge-subtitle-soft-pulse {
            0%, 100% {
                opacity: 0.3;
                transform: scale(1);
            }
            50% {
                opacity: 0.5;
                transform: scale(1.05);
            }
        }

        @keyframes voiceforge-subtitle-shimmer {
            0%, 100% {
                transform: translateX(-100%);
            }
            50% {
                transform: translateX(100%);
            }
        }

        @keyframes voiceforge-subtitle-text-drift {
            0%, 100% {
                letter-spacing: 0.01em;
                text-shadow:
                    0 0 8px rgba(255, 255, 255, 0.3),
                    0 0 16px rgba(255, 200, 150, 0.15),
                    0 1px 0 rgba(0, 0, 0, 0.12);
            }
            50% {
                letter-spacing: 0.022em;
                text-shadow:
                    0 0 14px rgba(255, 255, 255, 0.5),
                    0 0 24px rgba(255, 200, 150, 0.25),
                    0 1px 0 rgba(0, 0, 0, 0.12);
            }
        }

        @keyframes voiceforge-subtitle-text-glow {
            0%, 100% {
                filter: brightness(1);
            }
            50% {
                filter: brightness(1.08);
            }
        }

        @keyframes voiceforge-subtitle-text-pop {
            0% {
                transform: scale(0.98);
                opacity: 0.45;
                filter: blur(1px);
            }
            100% {
                transform: scale(1);
                opacity: 1;
                filter: blur(0px);
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .vf-incoming-call-orb,
            .vf-incoming-call-orb i,
            .vf-outgoing-call-status,
            .voiceforge-call-subtitle,
            .voiceforge-call-subtitle::before,
            .voiceforge-call-subtitle-text,
            .voiceforge-call-subtitle-text.subtitle-refresh {
                animation: none !important;
            }
        }
        
        /* Active call - green */
        #voiceforge_call_button.active {
            color: #4ade80;
            opacity: 1;
            text-shadow: 0 0 8px #4ade80;
        }
        
        /* Listening - pulsing green */
        #voiceforge_call_button.listening {
            animation: call-listen-pulse 1s ease-in-out infinite;
        }
        
        /* Speaking - blue */
        #voiceforge_call_button.speaking {
            color: #60a5fa;
            text-shadow: 0 0 8px #60a5fa;
            animation: none;
        }
        
        @keyframes call-listen-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        #voiceforge_call_button.vf-breath-hold {
            animation: call-breath-hold 0.62s ease-in-out infinite;
        }

        @keyframes call-breath-hold {
            0%, 100% { filter: brightness(1); }
            50% { filter: brightness(1.12); }
        }
        
/* Call mode overlay */
#voiceforge_call_overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  height: 100vh;
  min-width: 100vw;
  min-height: 100vh;
  pointer-events: none;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  display: none;
  contain: layout paint style;
  --overlay-position-x: 50%;
  --overlay-position-y: 50%;
  --overlay-scale: 1;
}

#voiceforge_call_overlay.vf-overlay-resizing,
#voiceforge_call_overlay.vf-overlay-resizing * {
  animation: none !important;
  transition: none !important;
}

#voiceforge_call_overlay.vf-overlay-interacting,
#voiceforge_call_overlay.vf-overlay-interacting * {
  animation-play-state: paused !important;
}

#voiceforge_call_overlay.vf-overlay-interacting .vf-call-backdrop {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

        /* Call mode TTS volume control */
        .voiceforge-volume-control {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        
        #voiceforge_call_volume_button {
            cursor: pointer;
            padding: 5px 8px;
            font-size: 1.1em;
            color: var(--SmartThemeBodyColor);
            transition: all 0.2s ease;
            opacity: 0.7;
        }
        
        #voiceforge_call_volume_button:hover {
            opacity: 1;
        }
        
        .voiceforge-volume-slider-wrapper {
            position: fixed;
            z-index: 99999;
            padding: 8px 4px;
            background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.8));
            border-radius: 12px;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.2s ease, visibility 0.2s ease;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            pointer-events: none;
            transform: translateX(-50%);
        }
        
        #voiceforge_call_volume_slider {
            writing-mode: bt-lr; /* IE/Edge */
            -webkit-appearance: slider-vertical; /* WebKit */
            width: 20px;
            height: 100px;
            padding: 0 5px;
            cursor: pointer;
            background: transparent;
        }
        
        #voiceforge_call_volume_slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #f5ab40;
            box-shadow: 0 0 8px rgba(245, 171, 64, 0.68);
            cursor: pointer;
            margin-top: -5px;
			transform: translateX(36%)
        }
        
        #voiceforge_call_volume_slider::-webkit-slider-runnable-track {
            width: 4px;
            height: 100%;
            background: linear-gradient(180deg, rgba(245, 171, 64, 0.92), rgba(245, 171, 64, 0.22));
            border-radius: 2px;
        }
        
        #voiceforge_call_volume_slider::-moz-range-thumb {
            width: 14px;
            height: 14px;
            border: none;
            border-radius: 50%;
            background: #f5ab40;
            box-shadow: 0 0 8px rgba(245, 171, 64, 0.68);
            cursor: pointer;
        }
        
        #voiceforge_call_volume_slider::-moz-range-track {
            width: 4px;
            height: 100%;
            background: linear-gradient(180deg, rgba(245, 171, 64, 0.92), rgba(245, 171, 64, 0.22));
            border-radius: 2px;
        }

        #voiceforge_call_mic_level_track {
            position: relative;
            width: 100%;
            height: 10px;
            border-radius: 999px;
            overflow: hidden;
            border: 1px solid var(--SmartThemeBorderColor);
            background: rgba(0, 0, 0, 0.25);
        }

        #voiceforge_call_mic_level_fill {
            position: absolute;
            top: 0;
            left: 0;
            height: 100%;
            width: 0%;
            transition: width 60ms linear;
            background: linear-gradient(90deg, #5ec4ff 0%, #4ba3ff 100%);
        }

        #voiceforge_call_mic_gate_marker {
            position: absolute;
            top: -1px;
            width: 2px;
            height: 12px;
            background: rgba(255, 255, 255, 0.92);
            left: 17%;
            pointer-events: none;
            box-shadow: 0 0 6px rgba(255, 255, 255, 0.35);
        }
    `;
    document.head.appendChild(style);
}

/**
 * Get settings HTML for call mode
 */
export function getCallModeSettingsHtml() {
    return `
    <div id="voiceforge_call_mode_settings" class="voiceforge-section">
        <div class="voiceforge-section-header" id="call_mode_section_header" style="cursor: pointer;">
            <span><i class="fa-solid fa-phone"></i> Call Mode</span>
            <i id="call_mode_toggle_icon" class="fa-solid fa-chevron-down"></i>
        </div>
        <div id="call_mode_section_content" style="display: none; margin-top: 8px;">
            <p style="font-size: 0.85em; color: var(--SmartThemeEmColor); margin-bottom: 10px;">
                Live voice conversation. Click <i class="fa-solid fa-phone"></i> to start.
                ASR options are in General below.
            </p>
            
            <div class="voiceforge-subsection" style="margin-top: 8px;">
                <div id="call_mode_general_header" class="voiceforge-subsection-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 6px 8px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; background: var(--SmartThemeBlurTintColor);">
                    <span style="font-weight: 600;">General</span>
                    <i id="call_mode_general_icon" class="fa-solid fa-chevron-down"></i>
                </div>
                <div id="call_mode_general_content" style="display: none; margin-top: 8px; padding-left: 4px;">
                    <div style="margin-bottom: 10px;">
                        <label for="voiceforge_call_silence">Silence Detection (ms)</label>
                        <input type="number" id="voiceforge_call_silence" class="text_pole" value="800" min="250" max="10000" step="1">
                        <small class="text_muted">How long to wait after you stop speaking</small>
                    </div>
                    <label class="checkbox_label" for="voiceforge_call_hide_shield">
                        <input type="checkbox" id="voiceforge_call_hide_shield">
                        <small>Hide chat shield during call mode</small>
                    </label>
                    <label class="checkbox_label" for="voiceforge_call_move_qr_to_send_area">
                        <input type="checkbox" id="voiceforge_call_move_qr_to_send_area">
                        <small>Move Quick Reply bar to magic wand menu globally</small>
                    </label>
                    <hr style="margin: 10px 0;">
                    <label class="checkbox_label" for="voiceforge_random_call_enabled">
                        <input type="checkbox" id="voiceforge_random_call_enabled">
                        <small>Allow AI to randomly start call mode</small>
                    </label>
                    <div id="voiceforge_random_call_settings" style="margin-left: 20px; margin-top: 6px; display: none;">
                        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                            <label for="voiceforge_random_call_min_minutes" style="min-width: 80px;">Min (min):</label>
                            <input type="number" id="voiceforge_random_call_min_minutes" class="text_pole" min="1" max="10080" step="1" style="width: 90px;">
                            <label for="voiceforge_random_call_max_minutes" style="min-width: 80px;">Max (min):</label>
                            <input type="number" id="voiceforge_random_call_max_minutes" class="text_pole" min="1" max="10080" step="1" style="width: 90px;">
                        </div>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <label for="voiceforge_random_call_cooldown_minutes" style="min-width: 120px;">Cooldown (min):</label>
                            <input type="number" id="voiceforge_random_call_cooldown_minutes" class="text_pole" min="0" max="10080" step="1" style="width: 90px;">
                        </div>
                        <small class="text_muted">When idle, starts call mode after a random delay between min and max. Cooldown starts after a call ends.</small>
                    </div>
                    <hr style="margin: 10px 0;">
                    <div style="margin-bottom: 10px;">
                        <label for="voiceforge_asr_endpoint">ASR Server URL:</label>
                        <input type="text" id="voiceforge_asr_endpoint" class="text_pole" placeholder="http://127.0.0.1:8889">
                        <small class="text_muted">Unified ASR endpoint (Whisper Turbo / GLM-ASR / Parakeet v3)</small>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label for="voiceforge_asr_model">ASR Model:</label>
                        <select id="voiceforge_asr_model" class="text_pole">
                            <optgroup label="Whisper (OpenAI)">
                                <option value="large-v3-turbo">large-v3-turbo (fast+accurate)</option>
                            </optgroup>
                            <optgroup label="GLM-ASR">
                                <option value="glm-asr-nano">GLM-ASR Nano (whispers)</option>
                            </optgroup>
                            <optgroup label="Parakeet (NVIDIA)">
                                <option value="parakeet-tdt-0.6b-v3">Parakeet TDT 0.6B v3 (multilingual)</option>
                            </optgroup>
                        </select>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label class="checkbox_label" for="voiceforge_asr_wrap_quotes">
                            <input type="checkbox" id="voiceforge_asr_wrap_quotes">
                            <small>Wrap transcriptions in "quotes"</small>
                        </label>
                    </div>
                    <hr style="margin: 10px 0;">
                    <div style="margin-bottom: 8px;">
                        <label for="voiceforge_call_noise_gate">Mic Gate Threshold</label>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="range" id="voiceforge_call_noise_gate" class="text_pole" min="1" max="100" value="17" step="1">
                            <span id="voiceforge_call_noise_gate_label" style="min-width: 56px; text-align: right;">17%</span>
                        </div>
<small class="text_muted">Higher = ignores quieter sounds (Discord-style gate)</small>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label class="checkbox_label" for="voiceforge_call_mute_releases_mic" style="margin-bottom: 10px; display: block;">
                            <input type="checkbox" id="voiceforge_call_mute_releases_mic">
                            <small>Release mic when muted (Android: routes audio to headphones)</small>
                        </label>
                    </div>
                    <div id="voiceforge_call_mic_level_panel" style="margin-bottom: 10px;">
                        <div id="voiceforge_call_mic_level_track">
                            <div id="voiceforge_call_mic_level_fill"></div>
                            <div id="voiceforge_call_mic_gate_marker"></div>
                        </div>
                        <div id="voiceforge_call_mic_level_status" class="text_muted" style="font-size: 0.8em; margin-top: 4px;">Level 0% | Gate 17% | closed (idle)</div>
                        <div style="margin-top: 6px;">
                            <button id="voiceforge_call_mic_test_button" class="menu_button" type="button">Start Mic Test</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="voiceforge-subsection" style="margin-top: 10px;">
                <div id="call_mode_hypno_header" class="voiceforge-subsection-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 6px 8px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; background: var(--SmartThemeBlurTintColor);">
                    <span style="font-weight: 600;">Overlay</span>
                    <i id="call_mode_hypno_icon" class="fa-solid fa-chevron-down"></i>
                </div>
                <div id="call_mode_hypno_content" style="display: none; margin-top: 8px; padding-left: 4px;">
                    <label class="checkbox_label" for="voiceforge_call_overlay_enabled">
                        <input type="checkbox" id="voiceforge_call_overlay_enabled">
                        <small>Show visual overlay during call mode</small>
                    </label>
                    <label class="checkbox_label" for="voiceforge_call_hypnotic_effects">
                        <input type="checkbox" id="voiceforge_call_hypnotic_effects">
                        <small>Enable immersive effects</small>
                    </label>
                    <div id="voiceforge_call_hypnotic_settings" style="margin-left: 20px; margin-top: 6px;">
                        <label class="checkbox_label" for="voiceforge_call_hypno_particles_enabled">
                            <input type="checkbox" id="voiceforge_call_hypno_particles_enabled">
                            <small>Enable particle effects</small>
                        </label>
                        <div style="margin-bottom: 10px;">
                            <label for="voiceforge_call_hypno_particle_style" style="font-size: 0.85em;">Particle style:</label>
                            <select id="voiceforge_call_hypno_particle_style" class="text_pole">
                                <option value="firefly">Fireflies</option>
                                <option value="rain">Rain</option>
                                <option value="snow">Snow</option>
                            </select>
                        </div>
                        <hr style="margin: 10px 0;">

                        <div id="voiceforge_overlay_settings" style="display: none; margin-left: 20px; margin-top: 8px;">
                        <label class="checkbox_label" for="voiceforge_call_overlay_show_status">
                            <input type="checkbox" id="voiceforge_call_overlay_show_status">
                            <small>Show listening/processing text</small>
                        </label>
                        <label class="checkbox_label" for="voiceforge_call_overlay_show_waveform">
                            <input type="checkbox" id="voiceforge_call_overlay_show_waveform">
                            <small>Show audio visualizer</small>
                        </label>
                        <div style="margin-bottom: 8px;">
                            <label for="voiceforge_call_overlay_transparency" style="font-size: 0.85em;">Transparency:</label>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="range" id="voiceforge_call_overlay_transparency" 
                                       class="text_pole" min="0" max="100" value="50" step="1">
                                <span id="voiceforge_overlay_transparency_label" style="min-width: 40px; text-align: right;">50%</span>
                            </div>
                        </div>

                        <div style="margin-bottom: 8px;">
                            <label for="voiceforge_call_overlay_scale" style="font-size: 0.85em;">Scale:</label>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="range" id="voiceforge_call_overlay_scale" 
                                       class="text_pole" min="10" max="500" value="100" step="5">
                                <span id="voiceforge_overlay_scale_label" style="min-width: 50px; text-align: right;">100%</span>
                            </div>
                            <small class="text_muted">Overlay size multiplier (10% to 500%)</small>
                        </div>

                        <div style="margin-bottom: 8px;">
                            <label for="voiceforge_call_overlay_zindex" style="font-size: 0.85em;">Z-Index:</label>
                            <input type="number" id="voiceforge_call_overlay_zindex" class="text_pole" 
                                   min="0" max="99999" value="9998" step="1">
                            <small class="text_muted">Higher values appear on top</small>
                        </div>

                        <div style="margin-bottom: 8px;">
                            <label for="voiceforge_call_overlay_position_x" style="font-size: 0.85em;">Position X:</label>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="range" id="voiceforge_call_overlay_position_x" 
                                       class="text_pole" min="0" max="100" value="50" step="1">
                                <span id="voiceforge_overlay_position_x_label" style="min-width: 50px; text-align: right;">50%</span>
                            </div>
                            <small class="text_muted">Horizontal position (0% = left, 50% = center, 100% = right)</small>
                        </div>

                        <div style="margin-bottom: 8px;">
                            <label for="voiceforge_call_overlay_position_y" style="font-size: 0.85em;">Position Y:</label>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="range" id="voiceforge_call_overlay_position_y" 
                                       class="text_pole" min="0" max="100" value="50" step="1">
                                <span id="voiceforge_overlay_position_y_label" style="min-width: 50px; text-align: right;">50%</span>
                            </div>
                            <small class="text_muted">Vertical position (0% = top, 50% = center, 100% = bottom)</small>
                        </div>
                        </div>

                        <hr style="margin: 10px 0;">
                        <div style="font-weight: 600; margin-bottom: 6px;">Subtitles</div>
                    <label class="checkbox_label" for="voiceforge_call_subtitle_enabled">
                        <input type="checkbox" id="voiceforge_call_subtitle_enabled">
                        <small>Show TTS subtitles in call mode</small>
                    </label>
                    <div id="voiceforge_call_subtitle_settings" style="margin-left: 20px; margin-top: 6px; display: none;">
                    <div style="margin-bottom: 8px;">
                        <label for="voiceforge_call_subtitle_font_size" style="font-size: 0.85em;">Subtitle font size:</label>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="range" id="voiceforge_call_subtitle_font_size" class="text_pole" min="12" max="48" value="20" step="1">
                            <span id="voiceforge_call_subtitle_font_size_label" style="min-width: 40px; text-align: right;">20px</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 16px; align-items: center; margin-bottom: 8px;">
                        <label for="voiceforge_call_subtitle_text_color" style="font-size: 0.85em;">Text color:</label>
                        <input type="color" id="voiceforge_call_subtitle_text_color" value="#ffffff">
                        <label for="voiceforge_call_subtitle_bg_color" style="font-size: 0.85em;">Background:</label>
                        <input type="color" id="voiceforge_call_subtitle_bg_color" value="#000000">
                    </div>
                    <div style="margin-bottom: 8px;">
                        <label for="voiceforge_call_subtitle_bg_opacity" style="font-size: 0.85em;">Background opacity:</label>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="range" id="voiceforge_call_subtitle_bg_opacity" class="text_pole" min="0" max="100" value="65" step="1">
                            <span id="voiceforge_call_subtitle_bg_opacity_label" style="min-width: 40px; text-align: right;">65%</span>
                        </div>
                    </div>
                    <div style="margin-bottom: 8px;">
                        <label for="voiceforge_call_subtitle_font_family" style="font-size: 0.85em;">Font family (optional):</label>
                        <input type="text" id="voiceforge_call_subtitle_font_family" class="text_pole" placeholder="e.g. Georgia, serif">
                    </div>
                    <div style="margin-bottom: 8px;">
                        <label for="voiceforge_call_subtitle_height" style="font-size: 0.85em;">Subtitle height:</label>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="range" id="voiceforge_call_subtitle_height" class="text_pole" min="0" max="260" value="24" step="2">
                            <span id="voiceforge_call_subtitle_height_label" style="min-width: 50px; text-align: right;">24px</span>
                        </div>
                    </div>
                    </div>
                </div>
            </div>
            
        </div>
    </div>
    `;
}

/**
 * Initialize call mode
 */
export function initCallMode() {
    console.debug(DEBUG_PREFIX + 'Initializing call mode...');
    
    loadSettings();
    applyWeatherContextLifecycle();
    scheduleRandomCall();
    ensureOverlayVisibilityListener();
    addCallStyles();
    createCallUI();
    resolveCallSnapAudioUrl('start').catch(() => {});
    resolveCallSnapAudioUrl('end').catch(() => {});
    resolveIncomingCallAudioUrl().catch(() => {});
    resolveOutgoingCallAudioUrl().catch(() => {});
    ensureMuteSoundPlayer();
    ensureUnmuteSoundPlayer();
    resolveCallParticleAmbientAudioUrl('snow').catch(() => {});
    resolveCallParticleAmbientAudioUrl('rain').catch(() => {});
    resolveCallParticleAmbientAudioUrl('firefly').catch(() => {});
    resolveCallAmbientAudioUrl().catch(() => {});
    resolveCallBreathCueAudioUrl('in').catch(() => {});
    resolveCallBreathCueAudioUrl('out').catch(() => {});
    
    // Always listen for chat changes to auto-end call
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    
    // Add settings UI
    const settingsHtml = getCallModeSettingsHtml();
    $('#tts_settings .inline-drawer-content').append('<hr>' + settingsHtml);
    
    const initSectionToggle = (headerSelector, contentSelector, iconSelector, settingKey, openByDefault) => {
        const header = $(headerSelector);
        const content = $(contentSelector);
        const icon = $(iconSelector);
        if (!header.length || !content.length || !icon.length) {
            return;
        }

        const saved = extension_settings[MODULE_NAME]?.[settingKey];
        const isOpen = typeof saved === 'boolean' ? saved : openByDefault;
        content.toggle(isOpen);
        icon.toggleClass('fa-chevron-up', isOpen);
        icon.toggleClass('fa-chevron-down', !isOpen);

        header.off('click').on('click', function() {
            const nextOpen = !content.is(':visible');
            content.slideToggle(160);
            icon.toggleClass('fa-chevron-down fa-chevron-up');
            extension_settings[MODULE_NAME][settingKey] = nextOpen;
            saveSettingsDebounced();
        });
    };

    const initSubsection = (name, settingKey, openByDefault = false) => {
        const header = $(`#${name}_header`);
        const content = $(`#${name}_content`);
        const icon = $(`#${name}_icon`);
        if (!header.length || !content.length || !icon.length) {
            return;
        }

        const saved = extension_settings[MODULE_NAME]?.[settingKey];
        const isOpen = typeof saved === 'boolean' ? saved : openByDefault;
        content.toggle(isOpen);
        icon.toggleClass('fa-chevron-up', isOpen);
        icon.toggleClass('fa-chevron-down', !isOpen);

        header.off('click').on('click', function() {
            const nextOpen = !content.is(':visible');
            content.slideToggle(160);
            icon.toggleClass('fa-chevron-down fa-chevron-up');
            extension_settings[MODULE_NAME][settingKey] = nextOpen;
            saveSettingsDebounced();
        });
    };

    initSectionToggle('#call_mode_section_header', '#call_mode_section_content', '#call_mode_toggle_icon', 'uiSectionExpanded', false);
    initSubsection('call_mode_general', 'uiGeneralExpanded', true);
    initSubsection('call_mode_hypno', 'uiOverlayExpanded', true);
    
    // Settings handlers
    const initialSilenceThresholdRaw = Number(extension_settings[MODULE_NAME]?.silenceThreshold);
    const initialSilenceThreshold = Math.max(250, Math.min(10000, Number.isFinite(initialSilenceThresholdRaw) ? Math.round(initialSilenceThresholdRaw) : 800));
    extension_settings[MODULE_NAME].silenceThreshold = initialSilenceThreshold;
    $('#voiceforge_call_silence').val(initialSilenceThreshold);
    $('#voiceforge_call_silence').on('change', function() {
        const raw = Number($(this).val());
        const value = Math.max(250, Math.min(10000, Number.isFinite(raw) ? Math.round(raw) : 800));
        extension_settings[MODULE_NAME].silenceThreshold = value;
        $(this).val(value);
        saveSettingsDebounced();
    });
    
    $('#voiceforge_call_hide_shield').prop('checked', extension_settings[MODULE_NAME]?.hideChatShield === true);
    $('#voiceforge_call_hide_shield').on('change', function() {
        extension_settings[MODULE_NAME].hideChatShield = $(this).is(':checked');
        saveSettingsDebounced();
    });

    $('#voiceforge_call_move_qr_to_send_area').prop('checked', extension_settings[MODULE_NAME]?.moveQuickRepliesToSendArea === true);
    $('#voiceforge_call_move_qr_to_send_area').on('change', function() {
        extension_settings[MODULE_NAME].moveQuickRepliesToSendArea = $(this).is(':checked');
        saveSettingsDebounced();
        applyQuickRepliesPlacementForCallMode();
    });

    normalizeRandomCallSettings();
    $('#voiceforge_random_call_enabled').prop('checked', extension_settings[MODULE_NAME]?.randomCallEnabled === true);
    $('#voiceforge_random_call_settings').toggle(extension_settings[MODULE_NAME]?.randomCallEnabled === true);
    $('#voiceforge_random_call_min_minutes').val(extension_settings[MODULE_NAME].randomCallMinMinutes);
    $('#voiceforge_random_call_max_minutes').val(extension_settings[MODULE_NAME].randomCallMaxMinutes);
    $('#voiceforge_random_call_cooldown_minutes').val(extension_settings[MODULE_NAME].randomCallCooldownMinutes);

    $('#voiceforge_random_call_enabled').on('change', function() {
        extension_settings[MODULE_NAME].randomCallEnabled = $(this).is(':checked');
        $('#voiceforge_random_call_settings').toggle(extension_settings[MODULE_NAME].randomCallEnabled === true);
        if (extension_settings[MODULE_NAME].randomCallEnabled !== true && incomingCallActive) {
            hideIncomingCallPrompt();
        }
        saveSettingsDebounced();
        scheduleRandomCall();
    });
    $('#voiceforge_random_call_min_minutes, #voiceforge_random_call_max_minutes, #voiceforge_random_call_cooldown_minutes').on('change', function() {
        extension_settings[MODULE_NAME].randomCallMinMinutes = Number($('#voiceforge_random_call_min_minutes').val()) || defaultSettings.randomCallMinMinutes;
        extension_settings[MODULE_NAME].randomCallMaxMinutes = Number($('#voiceforge_random_call_max_minutes').val()) || defaultSettings.randomCallMaxMinutes;
        extension_settings[MODULE_NAME].randomCallCooldownMinutes = Number($('#voiceforge_random_call_cooldown_minutes').val()) || defaultSettings.randomCallCooldownMinutes;
        normalizeRandomCallSettings();
        $('#voiceforge_random_call_min_minutes').val(extension_settings[MODULE_NAME].randomCallMinMinutes);
        $('#voiceforge_random_call_max_minutes').val(extension_settings[MODULE_NAME].randomCallMaxMinutes);
        $('#voiceforge_random_call_cooldown_minutes').val(extension_settings[MODULE_NAME].randomCallCooldownMinutes);
        saveSettingsDebounced();
        scheduleRandomCall();
    });

    $('#voiceforge_generation_weather_context_enabled').prop('checked', extension_settings[MODULE_NAME]?.weatherContextEnabled === true);
    $('#voiceforge_generation_weather_context_enabled').on('change', function() {
        extension_settings[MODULE_NAME].weatherContextEnabled = $(this).is(':checked');
        applyWeatherContextLifecycle({ forceFetch: true });
        saveSettingsDebounced();
    });

    $('#voiceforge_generation_weather_refresh_minutes').val(getNormalizedWeatherRefreshMinutes());
    $('#voiceforge_generation_weather_refresh_minutes').on('change', function() {
        const value = Math.max(WEATHER_REFRESH_MIN_MINUTES, Math.min(WEATHER_REFRESH_MAX_MINUTES, Number($(this).val()) || defaultSettings.weatherRefreshMinutes));
        extension_settings[MODULE_NAME].weatherRefreshMinutes = value;
        $(this).val(value);
        applyWeatherContextLifecycle({ forceFetch: true });
        saveSettingsDebounced();
    });

    $('#voiceforge_generation_weather_manual_city').val(extension_settings[MODULE_NAME]?.weatherManualCity || '');
    $('#voiceforge_generation_weather_manual_city').on('change', function() {
        const city = String($(this).val() || '').trim();
        extension_settings[MODULE_NAME].weatherManualCity = city;
        $(this).val(city);
        applyWeatherContextLifecycle({ forceFetch: true });
        saveSettingsDebounced();
    });

    applyQuickRepliesPlacementForCallMode();

    const hypnoSettings = extension_settings[MODULE_NAME] || {};
    const hypnoEffectsEnabled = hypnoSettings.hypnoticEffectsEnabled !== false;
    const hypnoParticleCount = getHypnoParticleCount();
    const hypnoParticleFallRate = getHypnoParticleFallRate();
    const hypnoParticleStyle = getHypnoParticleStyle();
    const hypnoParticleImpactRate = getHypnoParticleImpactRate();
    const hypnoFireflyGlow = getHypnoFireflyGlow();
    const hypnoAmbientBaseVolume = getHypnoAmbientBaseVolume();
    const hypnoAmbientParticleVolume = getHypnoAmbientParticleVolume();
    const hypnoParticlesEnabled = hypnoSettings.hypnoParticlesEnabled !== false;

    $('#voiceforge_call_hypnotic_effects').prop('checked', hypnoEffectsEnabled);
    $('#voiceforge_call_hypno_particles_enabled').prop('checked', hypnoParticlesEnabled);
    $('#voiceforge_call_hypno_particle_count').val(hypnoParticleCount);
    $('#voiceforge_call_hypno_particle_count_label').text(String(hypnoParticleCount));
    $('#voiceforge_call_hypno_particle_fall_rate').val(Math.round(hypnoParticleFallRate * 100));
    $('#voiceforge_call_hypno_particle_fall_rate_label').text(`${hypnoParticleFallRate.toFixed(2)}x`);
    $('#voiceforge_call_hypno_particle_style').val(hypnoParticleStyle);
    $('#voiceforge_call_hypno_particle_impact_rate').val(Math.round(hypnoParticleImpactRate * 100));
    $('#voiceforge_call_hypno_particle_impact_rate_label').text(`${Math.round(hypnoParticleImpactRate * 100)}%`);
    $('#voiceforge_call_hypno_firefly_glow').val(Math.round(hypnoFireflyGlow * 100));
    $('#voiceforge_call_hypno_firefly_glow_label').text(`${Math.round(hypnoFireflyGlow * 100)}%`);
    $('#voiceforge_call_hypno_ambient_volume_base').val(Math.round(hypnoAmbientBaseVolume * 100));
    $('#voiceforge_call_hypno_ambient_volume_base_label').text(`${Math.round(hypnoAmbientBaseVolume * 100)}%`);
    $('#voiceforge_call_hypno_ambient_volume_particle').val(Math.round(hypnoAmbientParticleVolume * 100));
    $('#voiceforge_call_hypno_ambient_volume_particle_label').text(`${Math.round(hypnoAmbientParticleVolume * 100)}%`);

    const applyHypnoticEffects = () => {
        if (!callActive) {
            return;
        }

        if (!areHypnoticEffectsEnabled()) {
            stopCallAmbientLoop(true);
            stopCallParticleAmbientLoop(true);
            stopCallBreathCueLoop(true);
            stopHypnoWhispers();
            stopHypnoEasterEggs();
            stopSpokenWhisperAudio(true);
            const overlayEl = $('#voiceforge_call_overlay');
            if (overlayEl.length) {
                overlayEl.removeClass('vf-hypno-spiral-disabled');
            }

            if (extension_settings[MODULE_NAME]?.overlayEnabled) {
                showCallOverlay();
            }
            return;
        }

        if (!isHypnoFeatureEnabled('hypnoAmbientEnabled')) {
            stopCallAmbientLoop(true);
            stopCallParticleAmbientLoop(true);
        } else {
            startCallAmbientLoop();
        }

        if (extension_settings[MODULE_NAME]?.overlayEnabled) {
            if (!isHypnoFeatureEnabled('hypnoBreathCuesEnabled')) {
                stopCallBreathCueLoop(true);
            } else {
                startCallBreathCueLoop();
            }
            showCallOverlay();
        }
    };

    $('#voiceforge_call_hypnotic_effects').on('change', function() {
        extension_settings[MODULE_NAME].hypnoticEffectsEnabled = $(this).is(':checked');
        saveSettingsDebounced();
        applyHypnoticEffects();
    });

    $('#voiceforge_call_hypno_particles_enabled').on('change', function() {
        extension_settings[MODULE_NAME].hypnoParticlesEnabled = $(this).is(':checked');
        saveSettingsDebounced();
        if (callActive && extension_settings[MODULE_NAME]?.overlayEnabled) {
            showCallOverlay();
        }
        if (!extension_settings[MODULE_NAME].hypnoParticlesEnabled) {
            stopCallParticleAmbientLoop(true);
        } else if (callActive) {
            startCallParticleAmbientLoop(getHypnoParticleStyle());
        }
    });

    $('#voiceforge_call_hypno_particle_count').on('input', function() {
        const raw = parseInt($(this).val(), 10);
        const val = Math.max(0, Math.min(500, Number.isFinite(raw) ? raw : defaultSettings.hypnoParticleCount));
        extension_settings[MODULE_NAME].hypnoParticleCount = val;
        $('#voiceforge_call_hypno_particle_count_label').text(String(val));
        saveSettingsDebounced();
        if (callActive && extension_settings[MODULE_NAME]?.overlayEnabled && isHypnoFeatureEnabled('hypnoParticlesEnabled')) {
            showCallOverlay();
        }
    });

    $('#voiceforge_call_hypno_particle_fall_rate').on('input', function() {
        const raw = parseInt($(this).val(), 10);
        const pct = Math.max(25, Math.min(300, Number.isFinite(raw) ? raw : Math.round(defaultSettings.hypnoParticleFallRate * 100)));
        const rate = pct / 100;
        extension_settings[MODULE_NAME].hypnoParticleFallRate = rate;
        $('#voiceforge_call_hypno_particle_fall_rate_label').text(`${rate.toFixed(2)}x`);
        saveSettingsDebounced();
        if (callActive && extension_settings[MODULE_NAME]?.overlayEnabled && isHypnoFeatureEnabled('hypnoParticlesEnabled')) {
            showCallOverlay();
        }
    });

    $('#voiceforge_call_hypno_particle_style').on('change', function() {
        const selected = $(this).val();
        const style = selected === 'rain' || selected === 'firefly' ? selected : 'snow';
        extension_settings[MODULE_NAME].hypnoParticleStyle = style;
        saveSettingsDebounced();
        if (callActive) {
            startCallParticleAmbientLoop(style);
        }
        if (callActive && extension_settings[MODULE_NAME]?.overlayEnabled && isHypnoFeatureEnabled('hypnoParticlesEnabled')) {
            showCallOverlay();
        }
    });

    $('#voiceforge_call_hypno_particle_impact_rate').on('input', function() {
        const raw = parseInt($(this).val(), 10);
        const pct = Math.max(0, Math.min(200, Number.isFinite(raw) ? raw : 100));
        extension_settings[MODULE_NAME].hypnoParticleImpactRate = pct / 100;
        $('#voiceforge_call_hypno_particle_impact_rate_label').text(`${pct}%`);
        saveSettingsDebounced();
    });

    $('#voiceforge_call_hypno_firefly_glow').on('input', function() {
        const raw = parseInt($(this).val(), 10);
        const pct = Math.max(50, Math.min(200, Number.isFinite(raw) ? raw : 100));
        extension_settings[MODULE_NAME].hypnoFireflyGlow = pct / 100;
        $('#voiceforge_call_hypno_firefly_glow_label').text(`${pct}%`);
        saveSettingsDebounced();
        if (callActive && extension_settings[MODULE_NAME]?.overlayEnabled && isHypnoFeatureEnabled('hypnoParticlesEnabled') && getHypnoParticleStyle() === 'firefly') {
            showCallOverlay();
        }
    });

    $('#voiceforge_call_hypno_ambient_volume_base').on('input', function() {
        const raw = parseInt($(this).val(), 10);
        const pct = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 5));
        extension_settings[MODULE_NAME].hypnoAmbientBaseVolume = pct / 100;
        $('#voiceforge_call_hypno_ambient_volume_base_label').text(`${pct}%`);
        saveSettingsDebounced();
        if (callActive && isHypnoFeatureEnabled('hypnoAmbientEnabled') && callAmbientPlayer) {
            callAmbientPlayer.volume = toPerceptualAmbientVolume(getHypnoAmbientBaseVolume());
        }
    });

    $('#voiceforge_call_hypno_ambient_volume_particle').on('input', function() {
        const raw = parseInt($(this).val(), 10);
        const pct = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 3));
        extension_settings[MODULE_NAME].hypnoAmbientParticleVolume = pct / 100;
        $('#voiceforge_call_hypno_ambient_volume_particle_label').text(`${pct}%`);
        saveSettingsDebounced();
        if (callActive && isHypnoFeatureEnabled('hypnoAmbientEnabled') && callParticleAmbientPlayer) {
            callParticleAmbientPlayer.volume = toParticleAmbientVolume(getHypnoAmbientParticleVolume(), callParticleAmbientStyle);
        }
    });

    // Subtitle settings
    const subtitleSettings = extension_settings[MODULE_NAME];
    const subtitleEnabled = subtitleSettings?.subtitleEnabled !== false;
    const subtitleFontSize = Math.max(12, Math.min(48, Number(subtitleSettings?.subtitleFontSize) || defaultSettings.subtitleFontSize));
    const subtitleTextColor = normalizeHexColor(subtitleSettings?.subtitleTextColor, defaultSettings.subtitleTextColor);
    const subtitleBgColor = normalizeHexColor(subtitleSettings?.subtitleBackgroundColor, defaultSettings.subtitleBackgroundColor);
    const rawSubtitleBgOpacity = Number(subtitleSettings?.subtitleBackgroundOpacity);
    const subtitleBgOpacity = Math.max(0, Math.min(100, Number.isFinite(rawSubtitleBgOpacity) ? rawSubtitleBgOpacity : defaultSettings.subtitleBackgroundOpacity));
    const subtitleFontFamily = String(subtitleSettings?.subtitleFontFamily || '');
    const rawSubtitleBottomOffset = Number(subtitleSettings?.subtitleBottomOffset);
    const subtitleBottomOffset = Math.max(0, Math.min(260, Number.isFinite(rawSubtitleBottomOffset) ? rawSubtitleBottomOffset : defaultSettings.subtitleBottomOffset));

    $('#voiceforge_call_subtitle_enabled').prop('checked', subtitleEnabled);
    $('#voiceforge_call_subtitle_settings').toggle(subtitleEnabled);
    $('#voiceforge_call_subtitle_font_size').val(subtitleFontSize);
    $('#voiceforge_call_subtitle_font_size_label').text(`${subtitleFontSize}px`);
    $('#voiceforge_call_subtitle_text_color').val(subtitleTextColor);
    $('#voiceforge_call_subtitle_bg_color').val(subtitleBgColor);
    $('#voiceforge_call_subtitle_bg_opacity').val(subtitleBgOpacity);
    $('#voiceforge_call_subtitle_bg_opacity_label').text(`${subtitleBgOpacity}%`);
    $('#voiceforge_call_subtitle_font_family').val(subtitleFontFamily);
    $('#voiceforge_call_subtitle_height').val(subtitleBottomOffset);
    $('#voiceforge_call_subtitle_height_label').text(`${subtitleBottomOffset}px`);

    $('#voiceforge_call_subtitle_enabled').on('change', function() {
        extension_settings[MODULE_NAME].subtitleEnabled = $(this).is(':checked');
        $('#voiceforge_call_subtitle_settings').toggle(extension_settings[MODULE_NAME].subtitleEnabled !== false);
        if (!extension_settings[MODULE_NAME].subtitleEnabled) {
            clearCallSubtitle();
        }
        applyCallSubtitleStyles();
        saveSettingsDebounced();
    });

    $('#voiceforge_call_subtitle_font_size').on('input', function() {
        const val = Math.max(12, Math.min(48, parseInt($(this).val()) || defaultSettings.subtitleFontSize));
        extension_settings[MODULE_NAME].subtitleFontSize = val;
        $('#voiceforge_call_subtitle_font_size_label').text(`${val}px`);
        applyCallSubtitleStyles();
        saveSettingsDebounced();
    });

    $('#voiceforge_call_subtitle_text_color').on('input', function() {
        extension_settings[MODULE_NAME].subtitleTextColor = normalizeHexColor($(this).val(), defaultSettings.subtitleTextColor);
        applyCallSubtitleStyles();
        saveSettingsDebounced();
    });

    $('#voiceforge_call_subtitle_bg_color').on('input', function() {
        extension_settings[MODULE_NAME].subtitleBackgroundColor = normalizeHexColor($(this).val(), defaultSettings.subtitleBackgroundColor);
        applyCallSubtitleStyles();
        saveSettingsDebounced();
    });

    $('#voiceforge_call_subtitle_bg_opacity').on('input', function() {
        const rawVal = parseInt($(this).val(), 10);
        const val = Math.max(0, Math.min(100, Number.isFinite(rawVal) ? rawVal : defaultSettings.subtitleBackgroundOpacity));
        extension_settings[MODULE_NAME].subtitleBackgroundOpacity = val;
        $('#voiceforge_call_subtitle_bg_opacity_label').text(`${val}%`);
        applyCallSubtitleStyles();
        saveSettingsDebounced();
    });

    $('#voiceforge_call_subtitle_font_family').on('change', function() {
        extension_settings[MODULE_NAME].subtitleFontFamily = String($(this).val() || '').trim();
        applyCallSubtitleStyles();
        saveSettingsDebounced();
    });

    $('#voiceforge_call_subtitle_height').on('input', function() {
        const rawVal = parseInt($(this).val(), 10);
        const val = Math.max(0, Math.min(260, Number.isFinite(rawVal) ? rawVal : defaultSettings.subtitleBottomOffset));
        extension_settings[MODULE_NAME].subtitleBottomOffset = val;
        $('#voiceforge_call_subtitle_height_label').text(`${val}px`);
        applyCallSubtitleStyles();
        saveSettingsDebounced();
    });

    applyCallSubtitleStyles();
    
    // Overlay settings
    $('#voiceforge_call_overlay_enabled').prop('checked', extension_settings[MODULE_NAME]?.overlayEnabled === true);
    $('#voiceforge_call_overlay_enabled').on('change', function() {
        extension_settings[MODULE_NAME].overlayEnabled = $(this).is(':checked');
        $('#voiceforge_overlay_settings').toggle(extension_settings[MODULE_NAME].overlayEnabled);
        saveSettingsDebounced();

        if (callActive) {
            if (extension_settings[MODULE_NAME].overlayEnabled) {
                showCallOverlay();
            } else {
                hideCallOverlay();
            }
        }
    });
    
    // Show/hide overlay settings based on checkbox
    if (extension_settings[MODULE_NAME]?.overlayEnabled) {
        $('#voiceforge_overlay_settings').show();
    }

    $('#voiceforge_call_overlay_show_status').prop('checked', shouldShowOverlayStatusText());
    $('#voiceforge_call_overlay_show_waveform').prop('checked', shouldShowOverlayWaveform());

    $('#voiceforge_call_overlay_show_status').on('change', function() {
        extension_settings[MODULE_NAME].overlayShowStatusText = $(this).is(':checked');
        saveSettingsDebounced();
        if (callActive && extension_settings[MODULE_NAME]?.overlayEnabled) {
            updateCallOverlayStatus();
            applyOverlayCallUiVisibility();
        }
    });

    $('#voiceforge_call_overlay_show_waveform').on('change', function() {
        extension_settings[MODULE_NAME].overlayShowWaveform = $(this).is(':checked');
        saveSettingsDebounced();
        if (callActive && extension_settings[MODULE_NAME]?.overlayEnabled) {
            applyOverlayCallUiVisibility();
        }
    });
    
    // Z-index control
    $('#voiceforge_call_overlay_zindex').val(extension_settings[MODULE_NAME]?.overlayZIndex ?? 9998);
    $('#voiceforge_call_overlay_zindex').on('input', function() {
        const rawVal = parseInt($(this).val(), 10);
        extension_settings[MODULE_NAME].overlayZIndex = Number.isFinite(rawVal) ? rawVal : 9998;
        saveSettingsDebounced();
        // Update overlay if it's currently shown
        if (callActive && extension_settings[MODULE_NAME]?.overlayEnabled) {
            queueOverlayVisualRefresh(true);
        }
    });
    
    const transparency = extension_settings[MODULE_NAME]?.overlayTransparency ?? 0.5;
    $('#voiceforge_call_overlay_transparency').val(Math.round(transparency * 100));
    $('#voiceforge_overlay_transparency_label').text(Math.round(transparency * 100) + '%');
    $('#voiceforge_call_overlay_transparency').on('input', function() {
        const rawVal = parseInt($(this).val(), 10);
        const val = Number.isFinite(rawVal) ? rawVal : 50;
        extension_settings[MODULE_NAME].overlayTransparency = val / 100;
        $('#voiceforge_overlay_transparency_label').text(val + '%');
        saveSettingsDebounced();
        // Update overlay if it's currently shown
        if (callActive && extension_settings[MODULE_NAME]?.overlayEnabled) {
            queueOverlayVisualRefresh(true);
        }
    });
    
    // Scale control
    const scale = extension_settings[MODULE_NAME]?.overlayScale ?? 1.0;
    $('#voiceforge_call_overlay_scale').val(Math.round(scale * 100));
    $('#voiceforge_overlay_scale_label').text(Math.round(scale * 100) + '%');
    $('#voiceforge_call_overlay_scale').on('input', function() {
        const rawVal = parseInt($(this).val(), 10);
        const val = Number.isFinite(rawVal) ? rawVal : 100;
        extension_settings[MODULE_NAME].overlayScale = val / 100;
        $('#voiceforge_overlay_scale_label').text(val + '%');
        saveSettingsDebounced();
        // Update overlay if it's currently shown
        if (callActive && extension_settings[MODULE_NAME]?.overlayEnabled) {
            queueOverlayVisualRefresh(true);
        }
    });
    
    // Position X control
    const positionX = extension_settings[MODULE_NAME]?.overlayPositionX ?? 50;
    $('#voiceforge_call_overlay_position_x').val(positionX);
    $('#voiceforge_overlay_position_x_label').text(positionX + '%');
    $('#voiceforge_call_overlay_position_x').on('input', function() {
        const rawVal = parseInt($(this).val(), 10);
        const val = Number.isFinite(rawVal) ? rawVal : 50;
        extension_settings[MODULE_NAME].overlayPositionX = val;
        $('#voiceforge_overlay_position_x_label').text(val + '%');
        saveSettingsDebounced();
        // Update overlay if it's currently shown
        if (callActive && extension_settings[MODULE_NAME]?.overlayEnabled) {
            queueOverlayVisualRefresh(true);
        }
    });
    
    // Position Y control
    const positionY = extension_settings[MODULE_NAME]?.overlayPositionY ?? 50;
    $('#voiceforge_call_overlay_position_y').val(positionY);
    $('#voiceforge_overlay_position_y_label').text(positionY + '%');
    $('#voiceforge_call_overlay_position_y').on('input', function() {
        const rawVal = parseInt($(this).val(), 10);
        const val = Number.isFinite(rawVal) ? rawVal : 50;
        extension_settings[MODULE_NAME].overlayPositionY = val;
        $('#voiceforge_overlay_position_y_label').text(val + '%');
        saveSettingsDebounced();
        // Update overlay if it's currently shown
        if (callActive && extension_settings[MODULE_NAME]?.overlayEnabled) {
            queueOverlayVisualRefresh(true);
        }
    });
    
    // Handle window resize to keep overlay layout aligned without stutter.
    // Remove any existing resize handler first to prevent duplicates.
    $(window).off('resize.voiceforge-overlay');
    $(window).on('resize.voiceforge-overlay', function() {
        if (!callActive || !extension_settings[MODULE_NAME]?.overlayEnabled) {
            return;
        }

        const overlay = getOverlayRoot(false);
        if (overlay.length) {
            overlay.addClass('vf-overlay-resizing');
        }

        if (overlayResizeFrameId === null) {
            overlayResizeFrameId = requestAnimationFrame(() => {
                overlayResizeFrameId = null;
                queueOverlayVisualRefresh(true);
            });
        }

        if (overlayResizeSettleTimer) {
            clearTimeout(overlayResizeSettleTimer);
        }

        overlayResizeSettleTimer = setTimeout(() => {
            overlayResizeSettleTimer = null;
            const currentOverlay = getOverlayRoot(false);
            if (currentOverlay.length) {
                currentOverlay.removeClass('vf-overlay-resizing');
            }
            queueOverlayVisualRefresh(true);
        }, 160);
    });

    // While interacting with UI, temporarily pause expensive overlay effects.
    const markOverlayInteraction = () => {
        if (!callActive || !extension_settings[MODULE_NAME]?.overlayEnabled) {
            return;
        }
        const overlay = getOverlayRoot(false);
        if (!overlay.length) {
            return;
        }

        overlay.addClass('vf-overlay-interacting');
        overlaySuspendedByUiInteraction = true;
        pauseOverlayVisualLoops();
        if (overlayUiInteractionTimer) {
            clearTimeout(overlayUiInteractionTimer);
        }
        const settle = () => {
            overlayUiInteractionTimer = null;

            if (isGlobalUiPanelOpen()) {
                overlayUiInteractionTimer = setTimeout(settle, 260);
                return;
            }

            overlaySuspendedByUiInteraction = false;
            const currentOverlay = getOverlayRoot(false);
            if (currentOverlay.length) {
                currentOverlay.removeClass('vf-overlay-interacting');
            }
            resumeOverlayVisualLoopsIfAllowed();
        };

        overlayUiInteractionTimer = setTimeout(settle, 260);
    };

    const markOverlayInteractionFromEvent = (event) => {
        const target = event?.target;
        const targetElement = target instanceof Element ? target : null;

        if (targetElement?.closest('#voiceforge_call_overlay')) {
            return;
        }

        if (targetElement?.closest('#send_form, #send_textarea, #leftSendForm, #rightSendForm')) {
            return;
        }

        const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
        if (activeElement?.closest('#send_form, #send_textarea, #leftSendForm, #rightSendForm')) {
            return;
        }

        const isUiPanelTarget = !!targetElement?.closest('.drawer-content, .inline-drawer-content, #extensionsMenu, #extensionsMenuButton, dialog[open], .ui-dialog, .popup[open], #right-nav-panel, #left-nav-panel');
        if (!isGlobalUiPanelOpen() && !isUiPanelTarget) {
            return;
        }

        markOverlayInteraction();
    };

    const settingsRoot = $('#tts_settings');
    const settingsScrollHost = $('#tts_settings .inline-drawer-content');
    settingsRoot.off('pointerdown.voiceforge-overlay');
    settingsRoot.on('pointerdown.voiceforge-overlay', markOverlayInteraction);
    settingsScrollHost.off('scroll.voiceforge-overlay wheel.voiceforge-overlay touchmove.voiceforge-overlay');
    settingsScrollHost.on('scroll.voiceforge-overlay wheel.voiceforge-overlay touchmove.voiceforge-overlay', markOverlayInteraction);

    $(document).off('pointerdown.voiceforge-overlay-ui wheel.voiceforge-overlay-ui touchmove.voiceforge-overlay-ui keydown.voiceforge-overlay-ui');
    $(document).on('pointerdown.voiceforge-overlay-ui wheel.voiceforge-overlay-ui touchmove.voiceforge-overlay-ui keydown.voiceforge-overlay-ui', markOverlayInteractionFromEvent);
    
    // ASR Settings handlers
    const asrSettings = extension_settings[MODULE_NAME];
    asrSettings.asr_model = normalizeAsrModelSetting(asrSettings?.asr_model);
    $('#voiceforge_asr_endpoint').val(asrSettings?.asr_endpoint || 'http://127.0.0.1:8889');
    $('#voiceforge_asr_model').val(asrSettings.asr_model);
    $('#voiceforge_asr_wrap_quotes').prop('checked', asrSettings?.asr_wrapInQuotes === true);
    const gateRms = getClientNoiseGateThreshold();
    const gatePercent = rmsToUiPercent(gateRms);
    $('#voiceforge_call_noise_gate').val(gatePercent);
    $('#voiceforge_call_noise_gate_label').text(`${gatePercent}%`);
    updateMicLevelUi(0, 'idle');
    
    $('#voiceforge_asr_endpoint').on('change', function() {
        extension_settings[MODULE_NAME].asr_endpoint = $(this).val().trim();
        saveSettingsDebounced();
    });
    $('#voiceforge_asr_endpoint').on('input', function() {
        extension_settings[MODULE_NAME].asr_endpoint = $(this).val().trim();
    });
    
    $('#voiceforge_asr_model').on('change', function() {
        extension_settings[MODULE_NAME].asr_model = normalizeAsrModelSetting($(this).val());
        $(this).val(extension_settings[MODULE_NAME].asr_model);
        saveSettingsDebounced();
    });
    
    $('#voiceforge_asr_wrap_quotes').on('change', function() {
        extension_settings[MODULE_NAME].asr_wrapInQuotes = $(this).is(':checked');
        saveSettingsDebounced();
    });
    
    console.debug(DEBUG_PREFIX + 'Call mode initialized');
}

/**
 * Check if call is active
 */
export function isCallActive() {
    return callActive;
}

/**
 * Toggle mute during call mode
 */
export function toggleCallMute() {
    if (!callActive) return false;
    
    callMuted = !callMuted;
    console.debug(DEBUG_PREFIX + 'Mute toggled:', callMuted);
    playMuteSound(callMuted);
    updateUI();
    return true;
}

/**
 * Check if call is muted
 */
export function isCallMuted() {
    return callMuted;
}

/**
 * Get current call state
 */
export function getCallState() {
    return callState;
}

/**
 * Show call mode overlay
 */
function getOverlayDisplaySettings() {
    const settings = extension_settings[MODULE_NAME] || {};
    const rawTransparency = Number(settings.overlayTransparency);
    const transparency = Math.max(0, Math.min(1, Number.isFinite(rawTransparency) ? rawTransparency : 0.5));
    const rawZIndex = parseInt(settings.overlayZIndex, 10);
    const zIndex = Math.max(0, Math.min(2147483646, Number.isFinite(rawZIndex) ? rawZIndex : 9998));
    const rawScale = Number(settings.overlayScale);
    const scale = Math.max(0.1, Math.min(5, Number.isFinite(rawScale) ? rawScale : 1.0));
    const rawPositionX = Number(settings.overlayPositionX);
    const positionX = Math.max(0, Math.min(100, Number.isFinite(rawPositionX) ? rawPositionX : 50));
    const rawPositionY = Number(settings.overlayPositionY);
    const positionY = Math.max(0, Math.min(100, Number.isFinite(rawPositionY) ? rawPositionY : 50));

    return {
        transparency,
        zIndex,
        scale,
        positionX,
        positionY,
    };
}

function getAdaptiveOverlayScale(scale) {
    const width = Math.max(1, window.innerWidth || 1);
    const height = Math.max(1, window.innerHeight || 1);
    const widthFit = Math.min(1, width / 420);
    const heightFit = Math.min(1, height / 420);
    const fit = Math.max(0.45, Math.min(widthFit, heightFit));
    return Math.max(0.1, Math.min(5, scale * fit));
}

function syncOverlayDomCache() {
    const overlay = getOverlayRoot(false);
    if (!overlay.length) {
        clearOverlayDomCache();
        return null;
    }

    if (!overlayDomCache.callUi || !overlayDomCache.callUi.length || !overlay[0].contains(overlayDomCache.callUi[0])) {
        overlayDomCache.callUi = overlay.find('.vf-call-ui').first();
    }
    if (!overlayDomCache.content || !overlayDomCache.content.length || !overlay[0].contains(overlayDomCache.content[0])) {
        overlayDomCache.content = overlay.find('.vf-call-content').first();
    }
    if (!overlayDomCache.backdrop || !overlayDomCache.backdrop.length || !overlay[0].contains(overlayDomCache.backdrop[0])) {
        overlayDomCache.backdrop = overlay.find('.vf-call-backdrop').first();
    }
    if (!overlayDomCache.effectsLayer || !overlayDomCache.effectsLayer.length || !overlay[0].contains(overlayDomCache.effectsLayer[0])) {
        overlayDomCache.effectsLayer = overlay.find('.vf-call-effects-layer').first();
    }
    if (!overlayDomCache.particleCanvas || !overlayDomCache.particleCanvas.length || !overlay[0].contains(overlayDomCache.particleCanvas[0])) {
        overlayDomCache.particleCanvas = overlay.find('.vf-call-particle-canvas').first();
    }
    if (!overlayDomCache.statusText || !overlayDomCache.statusText.length || !overlay[0].contains(overlayDomCache.statusText[0])) {
        overlayDomCache.statusText = overlay.find('#vf-call-status-text').first();
    }

    return overlay;
}

function queueOverlayVisualRefresh(rebuildIfMissing = false) {
    if (overlayVisualRefreshFrameId !== null) {
        return;
    }

    overlayVisualRefreshFrameId = requestAnimationFrame(() => {
        overlayVisualRefreshFrameId = null;
        const overlay = getOverlayRoot(false);
        if (!overlay.length) {
            if (rebuildIfMissing) {
                showCallOverlay();
            }
            return;
        }
        refreshOverlayLayout();
    });
}

function refreshOverlayLayout() {
    if (!callActive || !extension_settings[MODULE_NAME]?.overlayEnabled || isDocumentHidden()) {
        return;
    }

    const overlay = syncOverlayDomCache();
    if (!overlay || !overlay.length) {
        return;
    }

    const cfg = getOverlayDisplaySettings();
    const effectiveScale = getAdaptiveOverlayScale(cfg.scale);

    setCachedInlineStyle(overlay[0], 'root', 'z-index', String(cfg.zIndex));
    setCachedInlineStyle(overlay[0], 'root', 'display', 'block');
    setCachedInlineStyle(overlay[0], 'root', 'visibility', 'visible');
    setCachedInlineStyle(overlay[0], 'vars', '--overlay-position-x', `${cfg.positionX}%`);
    setCachedInlineStyle(overlay[0], 'vars', '--overlay-position-y', `${cfg.positionY}%`);
    setCachedInlineStyle(overlay[0], 'vars', '--overlay-scale', String(effectiveScale));

    const backdrop = overlayDomCache.backdrop;
    if (backdrop.length) {
        setCachedInlineStyle(backdrop[0], 'backdrop', 'opacity', String(cfg.transparency));
    }

    resizeOverlayParticleCanvas(false);

    applyOverlayCallUiVisibility();
}

/**
 * Update the call overlay status text based on current call state
 */
function updateCallOverlayStatus() {
    const state = callState;
    const overlay = syncOverlayDomCache();
    if (overlay.length) {
        overlay.attr('data-call-state', state || 'idle');
    }

    const statusText = overlayDomCache.statusText && overlayDomCache.statusText.length
        ? overlayDomCache.statusText
        : $('#vf-call-status-text');
    overlayDomCache.statusText = statusText;
    if (!statusText.length) return;

    statusText.css('display', shouldShowOverlayStatusText() ? '' : 'none');

    let text = 'In Call';
    if (state === 'listening') {
        text = 'Listening...';
    } else if (state === 'processing') {
        text = 'Processing...';
    } else if (state === 'speaking') {
        text = 'Speaking...';
    }
    statusText.text(text);
}

/**
 * Hide call mode overlay
 */
function hideCallOverlay() {
    if (overlayResizeFrameId !== null) {
        cancelAnimationFrame(overlayResizeFrameId);
        overlayResizeFrameId = null;
    }
    if (overlayResizeSettleTimer) {
        clearTimeout(overlayResizeSettleTimer);
        overlayResizeSettleTimer = null;
    }
    if (overlayUiInteractionTimer) {
        clearTimeout(overlayUiInteractionTimer);
        overlayUiInteractionTimer = null;
    }
    overlaySuspendedByUiInteraction = false;
    if (overlayVisualRefreshFrameId !== null) {
        cancelAnimationFrame(overlayVisualRefreshFrameId);
        overlayVisualRefreshFrameId = null;
    }
    stopCallWaveformAnimation(false);
    stopOverlayCssMotion();
    removeOverlaySpiralCanvas();
    stopCallBreathCueLoop(true);
    stopCallParticleAmbientLoop(true);
    stopHypnoWhispers();
    stopHypnoEasterEggs();
    stopSpokenWhisperAudio(true);
    overlaySuspendedByVisibility = false;
    const overlay = getOverlayRoot(false);
    if (overlay.length) {
        overlay.removeClass('vf-overlay-resizing vf-overlay-interacting vf-overlay-no-effects').hide();
    }
    clearOverlayDomCache();
}

function clearOverlayDomCache() {
    overlayDomCache.root = null;
    overlayDomCache.callUi = null;
    overlayDomCache.content = null;
    overlayDomCache.backdrop = null;
    overlayDomCache.effectsLayer = null;
    overlayDomCache.particleCanvas = null;
    overlayDomCache.statusText = null;
    resetOverlayInlineStyleCache();
    overlayCanvasParticles.canvas = null;
    overlayCanvasParticles.ctx = null;
    overlaySpiralCanvas.canvas = null;
    overlaySpiralCanvas.ctx = null;
    const overlay = document.getElementById('voiceforge_call_overlay');
    if (overlay?._vfCallRings) {
        delete overlay._vfCallRings;
    }
}

function showCallOverlay() {
    // Only show overlay if call is active and overlay is enabled
    if (!callActive || !extension_settings[MODULE_NAME]?.overlayEnabled) {
        return;
    }

    const overlay = getOverlayRoot(true);
    if (!overlay.length) {
        return;
    }

    const cfg = getOverlayDisplaySettings();
    const transparency = cfg.transparency;
    const zIndex = cfg.zIndex;
    const positionX = cfg.positionX;
    const positionY = cfg.positionY;
    const effectiveScale = getAdaptiveOverlayScale(cfg.scale);
    const spiralEnabled = isHypnoFeatureEnabled('hypnoSpiralEnabled');

    overlay.toggleClass('vf-hypno-spiral-disabled', !spiralEnabled);
    overlay.attr('data-breath-phase', overlay.attr('data-breath-phase') || 'idle');
    if (!overlay[0].style.getPropertyValue('--vf-breath-scale')) {
        setCachedInlineStyle(overlay[0], 'vars', '--vf-breath-scale', '1');
    }

    setCachedInlineStyle(overlay[0], 'vars', '--overlay-position-x', positionX + '%');
    setCachedInlineStyle(overlay[0], 'vars', '--overlay-position-y', positionY + '%');
    setCachedInlineStyle(overlay[0], 'vars', '--overlay-scale', String(effectiveScale));

    overlay.find('.voiceforge-call-gif').remove();

    setCachedInlineStyle(overlay[0], 'root', 'background-image', 'none');
    setCachedInlineStyle(overlay[0], 'root', 'background-color', 'transparent');
    setCachedInlineStyle(overlay[0], 'root', 'opacity', '1');
    setCachedInlineStyle(overlay[0], 'root', 'z-index', String(zIndex));
    setCachedInlineStyle(overlay[0], 'root', 'display', 'block');
    setCachedInlineStyle(overlay[0], 'root', 'visibility', 'visible');

    // Create default call UI if it doesn't exist
    let callUI = overlayDomCache.callUi && overlayDomCache.callUi.length ? overlayDomCache.callUi : overlay.find('.vf-call-ui');
    if (callUI.length && (!callUI.find('.vf-call-backdrop-shell').length || !callUI.find('.vf-call-effects-layer').length || !callUI.find('.vf-call-particle-canvas').length)) {
        callUI.remove();
        callUI = $();
        overlayDomCache.callUi = null;
    }
    if (!callUI.length) {
        callUI = $(`
                <div class="vf-call-ui">
                    <div class="vf-call-backdrop-shell">
                        <div class="vf-call-backdrop"></div>
                    </div>
                    <div class="vf-call-effects-layer">
                        <canvas class="vf-call-particle-canvas"></canvas>
                        <div class="vf-call-backdrop-layer hypno-grid"></div>
                        <div class="vf-call-vignette"></div>
                    </div>
                    <div class="vf-call-content">
                        <div class="vf-call-avatar">
                            <div class="vf-call-avatar-circle">
                                <i class="fa-solid fa-phone"></i>
                            </div>
                            <div class="vf-call-rings">
                                <div class="vf-ring vf-ring-1"></div>
                                <div class="vf-ring vf-ring-2"></div>
                                <div class="vf-ring vf-ring-3"></div>
                            </div>
                        </div>
                        <div class="vf-call-status" id="vf-call-status-text">In Call</div>
                        <div class="vf-call-waveform">
                            <div class="vf-wave-bar"></div>
                            <div class="vf-wave-bar"></div>
                            <div class="vf-wave-bar"></div>
                            <div class="vf-wave-bar"></div>
                            <div class="vf-wave-bar"></div>
                            <div class="vf-wave-bar"></div>
                            <div class="vf-wave-bar"></div>
                            <div class="vf-wave-bar"></div>
                        </div>
                    </div>
                </div>
            `);
        overlay.append(callUI);
    }
    const effectsLayer = callUI.find('.vf-call-effects-layer').first();
    overlayDomCache.callUi = callUI;
    syncOverlayDomCache();

    overlayDomCache.content = overlayDomCache.content && overlayDomCache.content.length ? overlayDomCache.content : overlay.find('.vf-call-content').first();

    // Apply transparency to backdrop
    const backdrop = overlayDomCache.backdrop && overlayDomCache.backdrop.length ? overlayDomCache.backdrop : overlay.find('.vf-call-backdrop');
    if (backdrop.length) {
        setCachedInlineStyle(backdrop[0], 'backdrop', 'opacity', String(transparency));
    }
    overlayDomCache.backdrop = backdrop;

    if (overlayDomCache.particleCanvas?.length) {
        ensureOverlayParticleCanvas();
        resizeOverlayParticleCanvas(true);
    }
    ensureOverlaySpiralCanvas();
    resizeOverlaySpiralCanvas(true);

    // Update call status based on current state
    updateCallOverlayStatus();
    applyOverlayCallUiVisibility();
    startCallBreathCueLoop();
    startOverlayCssMotion();
    startOverlaySpiralCanvas();

    // Ensure subtitles are rendered in the overlay layer while call overlay is active.
    ensureSubtitleElement();

    if (isDocumentHidden() || isGlobalUiPanelOpen()) {
        overlaySuspendedByUiInteraction = isGlobalUiPanelOpen();
        pauseOverlayVisualLoops();
    } else {
        overlaySuspendedByVisibility = false;
        overlaySuspendedByUiInteraction = false;
        overlay.removeClass('vf-overlay-no-effects');
        startHypnoWhispers();
        startHypnoParticles();
        startHypnoEasterEggs();
    }
}

