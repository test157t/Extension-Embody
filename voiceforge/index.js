import { cancelTtsPlay, eventSource, event_types, getCurrentChatId, isStreamingEnabled, name2, saveSettingsDebounced, substituteParams } from '../../../../../script.js';
import { ModuleWorkerWrapper, extension_settings, getContext, renderExtensionTemplateAsync } from '../../../../extensions.js';
import { delay, escapeRegex, getBase64Async, getStringHash, onlyUnique } from '../../../../utils.js';
import { power_user } from '../../../../power-user.js';
import { VoiceForgeProvider } from './voiceforge.js';
import { initAudioModule, getAudioManager } from './audio.js';
import { initCallMode, isCallActive, buildVoiceforgeMetadataPrefixForGeneration } from './call-mode.js';
import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../../../slash-commands/SlashCommandArgument.js';
import { debounce_timeout } from '../../../../constants.js';
import { SlashCommandEnumValue, enumTypes } from '../../../../slash-commands/SlashCommandEnumValue.js';
import { enumIcons } from '../../../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { POPUP_TYPE, callGenericPopup } from '../../../../popup.js';

const console = { ...globalThis.console, debug: () => {}, log: () => {}, info: () => {} };

const UPDATE_INTERVAL = 1000;
const wrapper = new ModuleWorkerWrapper(moduleWorker);

let voiceMapEntries = [];
let voiceMap = {}; // {charName:voiceid, charName2:voiceid2}
let lastChatId = null;
let lastMessage = null;
let lastMessageHash = null;
let periodicMessageGenerationTimer = null;
let lastPositionOfParagraphEnd = -1;
let currentInitVoiceMapPromise = null;
let currentNarratingMessageId = null; // Track which message is being narrated

// Streaming TTS state
let streamingTtsBuffer = ''; // Buffer for accumulating streamed text
let streamingTtsLastProcessedIndex = 0; // Track how much text we've already sent to TTS
let streamingTtsLastReceivedText = ''; // Track last accumulated text payload for robust deduplication
let streamingTtsActive = false; // Whether we're currently processing a stream
let streamingTtsMessageId = null; // Current message being streamed
let streamingTtsCharName = null; // Character name for the current stream
let streamingTtsProcessedMessageId = null; // Track which message was processed by streaming TTS (to prevent double-play)
let streamingTtsRequestId = null; // ONE request_id for ALL chunks in this streaming session
let streamingTtsSentenceCount = 0; // Track sentences for first-chunk detection
let streamingTtsCompletedMessageId = null; // Message ID for which streaming completed (prevents double-play via CHARACTER_MESSAGE_RENDERED)
let streamingTtsQuoteStack = [];
let streamingTtsInAsteriskBlock = false;
let streamingTtsInAngleTag = false; // Tracks open <...> fragments across streamed chunks
let streamingTtsPendingText = ''; // Filtered streamed text waiting for the next chunk-size boundary
let streamingTtsPendingRawText = '';
let streamingTtsPendingSourceStart = null;
let streamingTtsPendingSourceEnd = null;
let streamingTtsPendingMode = 'streaming';
let activeGenerationMetadataState = null;

function stripLeadingVoiceforgeMetadataTags(value) {
    return String(value || '').replace(/^(?:\s*<metadata:[^>]*>\s*)+/i, '');
}

function cleanupPersistedMetadataPrefixLeak() {
    const powerUser = getContext().powerUserSettings || {};
    const current = String(powerUser.user_prompt_bias || '');
    const cleaned = stripLeadingVoiceforgeMetadataTags(current);
    if (cleaned !== current) {
        powerUser.user_prompt_bias = cleaned;
        saveSettingsDebounced();
    }
}

const DEFAULT_VOICE_MARKER = '[Default Voice]';
const DISABLED_VOICE_MARKER = 'disabled';

// Clipboard for copy/paste voice settings
let voiceSettingsClipboard = null;

// Sentence ending patterns for streaming TTS
const SENTENCE_END_PATTERN = /[.!?。！？]+[\s\n"'」』】）\)]*$/;
function getCommonPrefixLength(a, b) {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a[i] === b[i]) {
        i++;
    }
    return i;
}

const DEFAULT_QUOTE_PAIRS = [
    // typographic doubles
    ['„', '“'],          // DE low-high
    ['“', '”'],          // EN
    ['«', '»'],          // FR open « close »
    ['»', '«'],          // Some locales open »
    // typographic singles
    ['‘', '’'],
    ['‚', '‘'],
    // Japanese corner quotes
    ['「', '」'],
    ['『', '』'],
    // symmetric doubles
    ['"', '"'],
    ['＂', '＂'],
];

export function getPreviewString(lang) {
    const previewStrings = {
        'en-US': 'The quick brown fox jumps over the lazy dog',
        'en-GB': 'Sphinx of black quartz, judge my vow',
        'fr-FR': 'Portez ce vieux whisky au juge blond qui fume',
        'de-DE': 'Victor jagt zwölf Boxkämpfer quer über den großen Sylter Deich',
        'it-IT': 'Pranzo d\'acqua fa volti sghembi',
        'es-ES': 'Quiere la boca exhausta vid, kiwi, piña y fugaz jamón',
        'es-MX': 'Fabio me exige, sin tapujos, que añada cerveza al whisky',
        'ru-RU': 'В чащах юга жил бы цитрус? Да, но фальшивый экземпляр!',
        'pt-BR': 'Vejo xá gritando que fez show sem playback.',
        'pt-PR': 'Todo pajé vulgar faz boquinha sexy com kiwi.',
        'uk-UA': 'Фабрикуймо гідність, лящім їжею, ґав хапаймо, з\'єднавці чаш!',
        'pl-PL': 'Pchnąć w tę łódź jeża lub ośm skrzyń fig',
        'cs-CZ': 'Příliš žluťoučký kůň úpěl ďábelské ódy',
        'sk-SK': 'Vyhŕňme si rukávy a vyprážajme čínske ryžové cestoviny',
        'hu-HU': 'Árvíztűrő tükörfúrógép',
        'tr-TR': 'Pijamalı hasta yağız şoföre çabucak güvendi',
        'nl-NL': 'De waard heeft een kalfje en een pinkje opgegeten',
        'sv-SE': 'Yxskaftbud, ge vårbygd, zinkqvarn',
        'da-DK': 'Quizdeltagerne spiste jordbær med fløde, mens cirkusklovnen Walther spillede på xylofon',
        'ja-JP': 'いろはにほへと　ちりぬるを　わかよたれそ　つねならむ　うゐのおくやま　けふこえて　あさきゆめみし　ゑひもせす',
        'ko-KR': '가나다라마바사아자차카타파하',
        'zh-CN': '我能吞下玻璃而不伤身体',
        'ro-RO': 'Muzicologă în bej vând whisky și tequila, preț fix',
        'bg-BG': 'Щъркелите се разпръснаха по цялото небе',
        'el-GR': 'Ταχίστη αλώπηξ βαφής ψημένη γη, δρασκελίζει υπέρ νωθρού κυνός',
        'fi-FI': 'Voi veljet, miksi juuri teille myin nämä vehkeet?',
        'he-IL': 'הקצינים צעקו: "כל הכבוד לצבא הצבאות!"',
        'id-ID': 'Jangkrik itu memang enak, apalagi kalau digoreng',
        'ms-MY': 'Muzik penyanyi wanita itu menggambarkan kehidupan yang penuh dengan duka nestapa',
        'th-TH': 'เป็นไงบ้างครับ ผมชอบกินข้าวผัดกระเพราหมูกรอบ',
        'vi-VN': 'Cô bé quàng khăn đỏ đang ngồi trên bãi cỏ xanh',
        'ar-SA': 'أَبْجَدِيَّة عَرَبِيَّة',
        'hi-IN': 'श्वेता ने श्वेता के श्वेते हाथों में श्वेता का श्वेता चावल पकड़ा',
    };
    const defaultPreview = 'Neque porro quisquam est qui dolorem ipsum quia dolor sit amet';

    return previewStrings[lang] ?? defaultPreview;
}

const PROVIDER_NAME = 'VoiceForge';
let ttsProvider;


async function onNarrateOneMessage() {
    audioElement.src = '/sounds/silence.mp3';
    const context = getContext();
    const id = $(this).closest('.mes').attr('mesid');
    const message = context.chat[id];

    if (!message) {
        return;
    }

    // Clear streaming completion flags for manual narration
    // This allows re-narrating messages that were previously streamed
    if (streamingTtsCompletedMessageId === parseInt(id)) {
        streamingTtsCompletedMessageId = null;
    }
    if (streamingTtsProcessedMessageId === parseInt(id)) {
        streamingTtsProcessedMessageId = null;
    }
    
    resetTtsPlayback();
    currentNarratingMessageId = id;
    processAndQueueTtsMessage(message, id);
    moduleWorker();
}

async function onNarrateText(args, text) {
    if (!text) {
        return '';
    }

    audioElement.src = '/sounds/silence.mp3';

    // To load all characters in the voice map, set unrestricted to true
    await initVoiceMap(true);

    const baseName = args?.voice || name2;
    const name = baseName === 'SillyTavern System' ? DEFAULT_VOICE_MARKER : baseName;

    if (!name) {
        throw new Error('Voice selection missing for /speak request');
    }

    let voiceMapEntry = voiceMap[name];

    // Check if voice is disabled or not configured
    const isDisabled = !voiceMapEntry || 
        voiceMapEntry === DISABLED_VOICE_MARKER ||
        (typeof voiceMapEntry === 'object' && voiceMapEntry.audio_prompt === DISABLED_VOICE_MARKER);

    if (isDisabled) {
        toastr.info(`Specified voice for ${name} was not found. Check the TTS extension settings.`);
        return;
    }

    resetTtsPlayback();
    processAndQueueTtsMessage({ mes: text, name: name });
    await moduleWorker();

    // Return back to the chat voices
    await initVoiceMap(false);
    return '';
}

async function moduleWorker() {
    if (!shouldAllowTtsNow()) {
        return;
    }

    processTtsQueue();
    processAudioJobQueue();
    updateUiAudioPlayState();
}

function resetTtsPlayback() {
    // Stop system TTS utterance
    cancelTtsPlay();

    // Clear currently processing jobs
    currentTtsJob = null;
    currentAudioJob = null;
    currentNarratingMessageId = null;
    
    // Reset TTS processing flag (allows new jobs to process)
    ttsJobProcessing = false;

    // Reset streaming TTS state
    resetStreamingTts();

    // Reset audio element
    audioElement.currentTime = 0;
    audioElement.src = '';
    lastSpokenSegmentId = null;
    
    // Clean up Web Audio context - releases system audio resources
    cleanupWebAudioContext();

    // Clear any queue items
    ttsJobQueue.splice(0, ttsJobQueue.length);
    audioJobQueue.splice(0, audioJobQueue.length);

    // Set audio ready to process again
    audioQueueProcessorReady = true;
    
    // Reset expected chunk index for audio ordering
    
    // Stop VoiceForge background audio stream if playing (quick fade on reset)
    const audioManager = getAudioManager();
    if (audioManager) {
        audioManager.stopVoiceForgeBackground(0.5, true);  // Force stop on reset
    }
    
    // Reset request ID for new TTS session (important for RVC model caching)
    if (ttsProvider && typeof ttsProvider.resetRequestId === 'function') {
        ttsProvider.resetRequestId();
    }

    resetTtsPlaybackSession();
}

/**
 * Reset TTS playback but KEEP background audio playing.
 * Used for swipes where the same character is speaking a new response.
 */
function resetTtsPlaybackKeepBackground() {
    // Stop system TTS utterance
    cancelTtsPlay();

    // Clear currently processing jobs
    currentTtsJob = null;
    currentAudioJob = null;
    currentNarratingMessageId = null;
    
    // Reset TTS processing flag (allows new jobs to process)
    ttsJobProcessing = false;

    // Reset streaming TTS state
    resetStreamingTts();

    // Reset audio element
    audioElement.currentTime = 0;
    audioElement.src = '';
    lastSpokenSegmentId = null;
    
    // Clean up Web Audio context - releases system audio resources
    cleanupWebAudioContext();

    // Clear any queue items
    ttsJobQueue.splice(0, ttsJobQueue.length);
    audioJobQueue.splice(0, audioJobQueue.length);

    // Set audio ready to process again
    audioQueueProcessorReady = true;
    
    // Reset expected chunk index for audio ordering
    
    // DON'T stop VoiceForge background - same character is still speaking
    console.debug('[TTS] Reset playback (keeping background for swipe)');
    
    // Reset request ID for new TTS session (important for RVC model caching)
    if (ttsProvider && typeof ttsProvider.resetRequestId === 'function') {
        ttsProvider.resetRequestId();
    }

    resetTtsPlaybackSession();
}

function isTtsProcessing() {
    let processing = false;

    // Check job queues
    if (ttsJobQueue.length > 0 || audioJobQueue.length > 0) {
        processing = true;
    }
    // Check current jobs
    if (currentTtsJob != null || currentAudioJob != null) {
        processing = true;
    }
    return processing;
}

/**
 * Splits a message into lines and adds each non-empty line to the TTS job queue.
 * @param {ChatMessage} message - The message object to be processed.
 * @param {string|number} messageId - The message ID (mesid) for playback bar attachment.
 * @returns {void}
 */
function processAndQueueTtsMessage(message, messageId = null, requestId = null, mode = 'standard', syncMeta = null) {
    if (!shouldAllowTtsNow()) {
        return;
    }

    const normalizedMessageId = normalizeMessageId(messageId);
    const jobBase = {
        ...message,
        messageId: normalizedMessageId,
        requestId: requestId,
        mode: mode,
        sourceStart: Number.isFinite(syncMeta?.sourceStart) ? Number(syncMeta.sourceStart) : null,
        sourceEnd: Number.isFinite(syncMeta?.sourceEnd) ? Number(syncMeta.sourceEnd) : null,
    };
    ttsJobQueue.push(jobBase);
}

function shouldAllowTtsNow() {
    if (!extension_settings.tts.enabled) {
        return false;
    }

    return isCallActive() || extension_settings.tts.non_call_tts_enabled !== false;
}

function normalizeMessageId(value) {
    if (Number.isInteger(value) && value >= 0) {
        return value;
    }

    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isInteger(parsed) && parsed >= 0) {
            return parsed;
        }
    }

    return null;
}

function debugTtsPlayback() {
    console.log(JSON.stringify(
        {
            'provider': PROVIDER_NAME,
            'voiceMap': voiceMap,
            'audioPaused': audioPaused,
            'audioJobQueue': audioJobQueue,
            'currentAudioJob': currentAudioJob,
            'audioQueueProcessorReady': audioQueueProcessorReady,
            'ttsJobQueue': ttsJobQueue,
            'currentTtsJob': currentTtsJob,
            'ttsConfig': extension_settings.tts,
        },
    ));
}
window['debugTtsPlayback'] = debugTtsPlayback;

//##################//
//   Audio Control  //
//##################//

let audioElement = new Audio();
audioElement.id = 'tts_audio';
audioElement.autoplay = true;

// Web Audio API for gapless streaming playback (like VoiceForge core)
let webAudioContext = null;
let webAudioGainNode = null;
let webAudioAnalyser = null;  // Shared analyser for real-time lip sync
let webAudioScheduledTime = 0;
let webAudioIsPlaying = false;
let webAudioSources = [];

const STREAMING_WEB_AUDIO_REMOTE_LEAD_SECONDS = 0;

function isLocalBrowserHost(hostname = window.location.hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function getStreamingWebAudioLeadSeconds() {
    const userAgent = String(navigator.userAgent || '');
    const isMobileBrowser = /android|iphone|ipad|ipod|mobile/i.test(userAgent);
    const isRemoteBrowser = !isLocalBrowserHost();
    return (isMobileBrowser || isRemoteBrowser) ? STREAMING_WEB_AUDIO_REMOTE_LEAD_SECONDS : 0;
}

function getEstimatedAudioOutputLatencyMs(audioContext = null) {
    const ctx = audioContext && typeof audioContext === 'object' ? audioContext : null;
    const outputLatencySec = Number(ctx?.outputLatency);
    const baseLatencySec = Number(ctx?.baseLatency);

    const outputLatencyMs = Number.isFinite(outputLatencySec) && outputLatencySec > 0
        ? outputLatencySec * 1000
        : null;
    const baseLatencyMs = Number.isFinite(baseLatencySec) && baseLatencySec > 0
        ? baseLatencySec * 1000
        : null;

    if (outputLatencyMs !== null || baseLatencyMs !== null) {
        const combined = (outputLatencyMs ?? 0) + (baseLatencyMs ?? 0);
        return Math.max(0, Math.min(350, combined));
    }

    return 0;
}

function shouldUseWebAudioStreaming() {
    return !!window.AudioContext;
}

/**
 * Clean up Web Audio context to release system audio resources.
 * IMPORTANT: This prevents audio conflicts with other applications.
 * The AudioContext can hold exclusive access to audio hardware or
 * cause sample rate mismatches if left open indefinitely.
 */
function cleanupWebAudioContext() {
    if (webAudioContext) {
        // Stop all scheduled/playing sources
        webAudioSources.forEach(source => {
            try { source.stop(); } catch (e) {}
        });
        webAudioSources = [];
        
        // Close the context to release audio hardware
        if (webAudioContext.state !== 'closed') {
            try {
                webAudioContext.close();
                console.debug('[Audio] Web Audio context closed - audio resources released');
            } catch (e) {
                console.warn('[Audio] Error closing Web Audio context:', e);
            }
        }
        
        webAudioContext = null;
        webAudioGainNode = null;
        webAudioAnalyser = null;
    }
    webAudioScheduledTime = 0;
    webAudioIsPlaying = false;
}

// Expose analyser globally for VRM lip sync
window.getVoiceForgeAnalyser = () => webAudioAnalyser; // Track sources for cleanup

function getPersistedTtsVolumePercent() {
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

/**
 * @type AudioJob[] Audio job queue
 * @typedef {{audioBlob: Blob | string, char: string, messageId: string|number|null, requestId: string|null, mode: string, segmentId: string|null, segmentText: string|null}} AudioJob Audio job object
 */
let audioJobQueue = [];
/**
 * @type AudioJob Current audio job
 */
let currentAudioJob;
let audioPaused = false;
let audioQueueProcessorReady = true;

let lastSpokenSegmentId = null;

const TTS_MODE_STANDARD = 'standard';
const TTS_MODE_STREAMING = 'streaming';

let ttsPlaybackSession = {
    active: false,
    startEmitted: false,
    endEmitted: false,
    startScheduled: false,
    sequence: 0,
    payloadBase: {
        messageId: null,
        requestId: null,
        mode: TTS_MODE_STANDARD,
    },
    sourceCursor: 0,
    rawChunkCounter: 0,
    subtitleChunkCounter: 0,
};

function beginTtsPlaybackSession(meta = {}) {
    if (ttsPlaybackSession.active) {
        return;
    }

    ttsPlaybackSession.active = true;
    ttsPlaybackSession.startEmitted = false;
    ttsPlaybackSession.endEmitted = false;
    ttsPlaybackSession.startScheduled = false;
    ttsPlaybackSession.sequence += 1;
    ttsPlaybackSession.payloadBase = {
        messageId: meta.messageId ?? null,
        requestId: meta.requestId ?? null,
        mode: meta.mode || TTS_MODE_STANDARD,
    };
    ttsPlaybackSession.sourceCursor = 0;
    ttsPlaybackSession.rawChunkCounter = 0;
    ttsPlaybackSession.subtitleChunkCounter = 0;
}

function resetTtsPlaybackSession() {
    ttsPlaybackSession.active = false;
    ttsPlaybackSession.startEmitted = false;
    ttsPlaybackSession.endEmitted = false;
    ttsPlaybackSession.startScheduled = false;
    ttsPlaybackSession.sequence += 1;
    ttsPlaybackSession.payloadBase = {
        messageId: null,
        requestId: null,
        mode: TTS_MODE_STANDARD,
    };
    ttsPlaybackSession.sourceCursor = 0;
    ttsPlaybackSession.rawChunkCounter = 0;
    ttsPlaybackSession.subtitleChunkCounter = 0;
}

function resolveStreamingTargetMessageId(context, accumulatedText = '') {
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    if (!chat.length) {
        return 0;
    }

    const lastIndex = chat.length - 1;
    const lastMessage = chat[lastIndex];
    const lastText = String(lastMessage?.mes || '');
    const acc = String(accumulatedText || '');
    const looksAssistant = !!lastMessage && !lastMessage.is_user && !lastMessage.is_system;

    if (looksAssistant) {
        if (!acc) {
            return lastIndex;
        }
        if (acc.startsWith(lastText) || lastText.startsWith(acc)) {
            return lastIndex;
        }
        if (lastText.length === 0) {
            return lastIndex;
        }
    }

    return chat.length;
}

function resolveAudioJobSourceRange(audioJob) {
    if (!audioJob || typeof audioJob !== 'object') {
        return { sourceStart: null, sourceEnd: null };
    }

    if (Number.isFinite(audioJob._vfSourceStart) && Number.isFinite(audioJob._vfSourceEnd)) {
        return {
            sourceStart: Number(audioJob._vfSourceStart),
            sourceEnd: Number(audioJob._vfSourceEnd),
        };
    }

    const explicitStart = Number.isFinite(audioJob.sourceStart) ? Number(audioJob.sourceStart) : null;
    const explicitEnd = Number.isFinite(audioJob.sourceEnd) ? Number(audioJob.sourceEnd) : null;

    if (explicitStart !== null && explicitEnd !== null) {
        audioJob._vfSourceStart = explicitStart;
        audioJob._vfSourceEnd = explicitEnd;
        return { sourceStart: explicitStart, sourceEnd: explicitEnd };
    }

    const spokenLen = String(audioJob.segmentText || '').length;
    const rawLen = String(audioJob.rawSegmentText || audioJob.segmentText || '').length;
    const length = Math.max(1, spokenLen || rawLen || 1);
    const start = Number.isFinite(ttsPlaybackSession.sourceCursor) ? Number(ttsPlaybackSession.sourceCursor) : 0;
    const end = start + length;

    ttsPlaybackSession.sourceCursor = end;
    audioJob._vfSourceStart = start;
    audioJob._vfSourceEnd = end;
    return { sourceStart: start, sourceEnd: end };
}

function emitVoiceforgeTtsStartOnce() {
    if (!ttsPlaybackSession.active || ttsPlaybackSession.startEmitted) {
        return;
    }

    ttsPlaybackSession.startEmitted = true;
    ttsPlaybackSession.startScheduled = false;
        eventSource.emit('voiceforge_tts_start', {
            ...ttsPlaybackSession.payloadBase,
            messageIdResolved: ttsPlaybackSession.payloadBase.messageId ?? null,
            messageIdPredicted: ttsPlaybackSession.payloadBase.messageId ?? null,
            sequence: ttsPlaybackSession.sequence,
            timestamp: performance.now(),
        });
}

function scheduleVoiceforgeTtsStartOnce(delayMs, meta = {}) {
    beginTtsPlaybackSession(meta);
    if (ttsPlaybackSession.startEmitted || ttsPlaybackSession.startScheduled) {
        return;
    }

    const sessionSequence = ttsPlaybackSession.sequence;
    ttsPlaybackSession.startScheduled = true;
    setTimeout(() => {
        if (!ttsPlaybackSession.active || ttsPlaybackSession.sequence !== sessionSequence) {
            return;
        }
        emitVoiceforgeTtsStartOnce();
    }, Math.max(0, delayMs));
}

function emitVoiceforgeTtsEndOnce() {
    if (!ttsPlaybackSession.active || ttsPlaybackSession.endEmitted) {
        return;
    }

    ttsPlaybackSession.endEmitted = true;
        eventSource.emit('voiceforge_tts_end', {
            ...ttsPlaybackSession.payloadBase,
            messageIdResolved: ttsPlaybackSession.payloadBase.messageId ?? null,
            messageIdPredicted: ttsPlaybackSession.payloadBase.messageId ?? null,
            sequence: ttsPlaybackSession.sequence,
            timestamp: performance.now(),
        });
    resetTtsPlaybackSession();
}

async function onVoiceforgeInterruptRequested(payload = {}) {
    const requestedRequestId = typeof payload?.requestId === 'string' && payload.requestId.trim()
        ? payload.requestId.trim()
        : null;
    const sequence = Number.isFinite(payload?.sequence) ? Number(payload.sequence) : ttsPlaybackSession.sequence;
    const reason = typeof payload?.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : 'unknown';

    // Stop local TTS output but keep VoiceForge background stream active.
    resetTtsPlaybackKeepBackground();

    let cancelStatus = 'skipped';
    let cancelMessage = '';
    let cancelledRequestId = requestedRequestId;

    try {
        if (ttsProvider && typeof ttsProvider.cancelGeneration === 'function') {
            const cancelResult = await ttsProvider.cancelGeneration(requestedRequestId);
            cancelStatus = cancelResult?.status || 'ok';
            cancelMessage = cancelResult?.message || '';
            if (typeof cancelResult?.requestId === 'string' && cancelResult.requestId.trim()) {
                cancelledRequestId = cancelResult.requestId.trim();
            }
        }
    } catch (error) {
        cancelStatus = 'failed';
        cancelMessage = error?.message || String(error);
        console.warn('[VoiceForge] Failed to cancel active generation:', error);
    }

    await eventSource.emit('voiceforge_tts_interrupted', {
        requestId: cancelledRequestId || null,
        sequence,
        reason,
        cancelStatus,
        cancelMessage,
        timestamp: performance.now(),
    });
}

function emitVoiceforgeTtsChunkStart(audioJob, delayMs = 0, durationMs = null) {
    const rawSegmentText = String(audioJob?.rawSegmentText || audioJob?.segmentText || '');
    const segmentText = stripControlCommandTags(String(audioJob?.segmentText || rawSegmentText));
    const sourceRange = resolveAudioJobSourceRange(audioJob);
    const sessionSequence = ttsPlaybackSession.sequence;

    if (!Number.isFinite(audioJob?._vfRawChunkIndex)) {
        audioJob._vfRawChunkIndex = ttsPlaybackSession.rawChunkCounter;
        ttsPlaybackSession.rawChunkCounter += 1;
    }
    if (!Number.isFinite(audioJob?._vfSubtitleChunkIndex)) {
        audioJob._vfSubtitleChunkIndex = ttsPlaybackSession.subtitleChunkCounter;
        ttsPlaybackSession.subtitleChunkCounter += 1;
    }
    const rawChunkIndex = Number(audioJob._vfRawChunkIndex);
    const subtitleChunkIndex = Number(audioJob._vfSubtitleChunkIndex);

    setTimeout(() => {
        const active = !!ttsPlaybackSession.active;
        const currentSequence = ttsPlaybackSession.sequence;
        const emittedSequence = Number.isFinite(sessionSequence) ? sessionSequence : currentSequence;

        eventSource.emit('voiceforge_tts_chunk_start', {
            text: segmentText,
            spokenText: segmentText,
            rawText: rawSegmentText,
            char: audioJob?.char,
            messageId: audioJob?.messageId ?? null,
            messageIdResolved: audioJob?.messageId ?? ttsPlaybackSession.payloadBase.messageId ?? null,
            messageIdPredicted: ttsPlaybackSession.payloadBase.messageId ?? null,
            requestId: audioJob?.requestId ?? null,
            mode: audioJob?.mode || TTS_MODE_STANDARD,
            sequence: emittedSequence,
            segmentId: audioJob?.segmentId ?? null,
            rawChunkIndex,
            subtitleChunkIndex,
            sourceStart: sourceRange.sourceStart,
            sourceEnd: sourceRange.sourceEnd,
            durationMs: Number.isFinite(durationMs) ? Number(durationMs) : null,
            active,
            timestamp: performance.now(),
        });
    }, Math.max(0, Number.isFinite(delayMs) ? delayMs : 0));
}

function emitVoiceforgeTtsSpokenTextOnce(audioJob, delayMs = 0, durationMs = null) {
    const rawSegmentText = String(audioJob?.rawSegmentText || audioJob?.segmentText || '');
    const segmentText = stripControlCommandTags(String(audioJob?.segmentText || rawSegmentText));
    const sourceRange = resolveAudioJobSourceRange(audioJob);
    const rawChunkIndex = Number.isFinite(audioJob?._vfRawChunkIndex) ? Number(audioJob._vfRawChunkIndex) : null;
    const subtitleChunkIndex = Number.isFinite(audioJob?._vfSubtitleChunkIndex) ? Number(audioJob._vfSubtitleChunkIndex) : null;
    if (!rawSegmentText && !segmentText) {
        return;
    }

    // Use messageId + text for deduplication instead of random segmentId
    // segmentId is randomly generated per job, so it doesn't work for deduplication
    const dedupeBasis = rawSegmentText || segmentText;
    const indexedBasis = Number.isFinite(rawChunkIndex) ? `${rawChunkIndex}|${dedupeBasis}` : dedupeBasis;
    const dedupeKey = `${audioJob?.messageId ?? 'no_msg'}|${audioJob?.requestId ?? 'no_req'}|${indexedBasis}`;
    if (lastSpokenSegmentId === dedupeKey) {
        return;
    }

    lastSpokenSegmentId = dedupeKey;
    const queuedSequence = ttsPlaybackSession.sequence;
    const emitDelay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
    setTimeout(() => {
        const active = !!ttsPlaybackSession.active;
        const currentSequence = ttsPlaybackSession.sequence;
        const emittedSequence = Number.isFinite(queuedSequence) ? queuedSequence : currentSequence;

        if (!active) {
            console.warn('[VoiceForge] [chunk-sync] emitting chunk while session inactive');
        }
        if (currentSequence !== queuedSequence) {
            console.warn(`[VoiceForge] [chunk-sync] sequence changed before emit (queued=${queuedSequence}, current=${currentSequence})`);
        }

        eventSource.emit('voiceforge_tts_spoken_text', {
            text: segmentText,
            spokenText: segmentText,
            rawText: rawSegmentText,
            char: audioJob.char,
            messageId: audioJob.messageId ?? null,
            messageIdResolved: audioJob?.messageId ?? ttsPlaybackSession.payloadBase.messageId ?? null,
            messageIdPredicted: ttsPlaybackSession.payloadBase.messageId ?? null,
            requestId: audioJob.requestId ?? null,
            mode: audioJob.mode || TTS_MODE_STANDARD,
            sequence: emittedSequence,
            segmentId: audioJob?.segmentId ?? null,
            rawChunkIndex,
            subtitleChunkIndex,
            sourceStart: sourceRange.sourceStart,
            sourceEnd: sourceRange.sourceEnd,
            durationMs: Number.isFinite(durationMs) ? Number(durationMs) : null,
            timestamp: performance.now(),
        });
    }, emitDelay);
}


/**
 * Play audio data from audio job object.
 * @param {AudioJob} audioJob Audio job object
 * @returns {Promise<void>} Promise that resolves when audio playback is started
 */
async function playAudioData(audioJob) {
    const { audioBlob, char, messageId, requestId, mode } = audioJob;
    // Since current audio job can be cancelled, don't playback if it is null
    if (currentAudioJob == null) {
        console.log('Cancelled TTS playback because currentAudioJob was null');
        return;
    }
    
    if (!(audioBlob instanceof Blob)) {
        throw new Error(`TTS received invalid audio data type ${typeof audioBlob}`);
    }
    if (!shouldUseWebAudioStreaming()) {
        throw new Error('VoiceForge requires Web Audio API playback');
    }

    // Play every VoiceForge chunk through Web Audio so VRM lip sync reads the same audible stream.
    {
        try {
            // Initialize Web Audio context if needed
            if (!webAudioContext || webAudioContext.state === 'closed') {
                webAudioContext = new window.AudioContext();
                
                // Create GainNode for volume control
                webAudioGainNode = webAudioContext.createGain();
                webAudioGainNode.gain.value = getPersistedTtsVolumePercent() / 100;
                
                // Create AnalyserNode for real-time lip sync (VRM can tap into this)
                webAudioAnalyser = webAudioContext.createAnalyser();
                webAudioAnalyser.fftSize = 512;
                webAudioAnalyser.smoothingTimeConstant = 0.05;  // Keep lip sync close to the audible stream
                
                // Audio chain: sources -> analyser -> gainNode -> destination
                // Keep analyser pre-volume so lip sync remains expressive at low output volume.
                webAudioAnalyser.connect(webAudioGainNode);
                webAudioGainNode.connect(webAudioContext.destination);
                
                webAudioScheduledTime = 0;
                webAudioIsPlaying = false;
                webAudioSources = [];
                
                console.debug('[Audio] Web Audio initialized with shared analyser for lip sync');
            }
            
            // Resume if suspended (autoplay policy)
            if (webAudioContext.state === 'suspended') {
                await webAudioContext.resume();
            }
            
            // Decode audio data
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioBuffer = await webAudioContext.decodeAudioData(arrayBuffer);
            
            // Create buffer source
            const source = webAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            
            // Apply playback rate
            const playbackRate = extension_settings.tts?.playback_rate || 1.0;
            source.playbackRate.value = playbackRate;
            
            // Connect source into analyser path (pre-volume for lip sync)
            source.connect(webAudioAnalyser);
            
            // Schedule playback - gapless!
            // Only reset schedule time when NOT playing yet (first chunk of session)
            const currentTime = webAudioContext.currentTime;
            const leadSeconds = getStreamingWebAudioLeadSeconds();
            if (!webAudioIsPlaying) {
                webAudioScheduledTime = currentTime + leadSeconds;
                webAudioIsPlaying = true;
            }
            // If scheduled time fell behind current time, catch up (but don't interrupt current playback)
            if (webAudioScheduledTime < currentTime) {
                console.debug(`[Audio] Schedule time fell behind (${webAudioScheduledTime.toFixed(3)}s < ${currentTime.toFixed(3)}s), scheduling from current time`);
                webAudioScheduledTime = currentTime + leadSeconds;
            }
            
            // Calculate actual playback duration accounting for playback rate
            // e.g., 6s audio at 0.75x speed = 8s actual duration
            const actualDuration = audioBuffer.duration / playbackRate;
            
            console.debug(`[Audio] Scheduling audio at ${webAudioScheduledTime.toFixed(3)}s (ctx: ${currentTime.toFixed(3)}s, duration: ${audioBuffer.duration.toFixed(2)}s, actual: ${actualDuration.toFixed(2)}s @ ${playbackRate}x)`);
            const scheduledStartTime = webAudioScheduledTime;
            source.start(webAudioScheduledTime);
            webAudioScheduledTime += actualDuration;

            const syncDelayMs = ((scheduledStartTime - currentTime) * 1000) + getEstimatedAudioOutputLatencyMs(webAudioContext);

            scheduleVoiceforgeTtsStartOnce(syncDelayMs, {
                messageId,
                requestId,
                mode,
            });
            const durationMs = actualDuration * 1000;
            emitVoiceforgeTtsChunkStart(audioJob, syncDelayMs, durationMs);
            emitVoiceforgeTtsSpokenTextOnce(audioJob, syncDelayMs, durationMs);
            
            // Track source for cleanup
            webAudioSources.push(source);
            
            // Set up ended callback for the last scheduled source
            source.onended = () => {
                // Remove from tracking
                const idx = webAudioSources.indexOf(source);
                if (idx > -1) webAudioSources.splice(idx, 1);
                
                // Try to process any pending TTS/audio jobs
                processTtsQueue();
                processAudioJobQueue();
                
                // If this was the last source and no more chunks expected, call complete
                // IMPORTANT: Also check ttsJobProcessing - a chunk might be generating
                if (webAudioSources.length === 0 && audioJobQueue.length === 0 && !ttsJobProcessing && ttsJobQueue.length === 0) {
                    completeCurrentAudioJob();
                }
            };
            
            // In streaming mode VRM reads this shared analyser directly; avoid per-chunk blob analysis.
            if (typeof window.vrmStartLipSync === 'function') {
                window.vrmStartLipSync(char);
            }
            
            // Mark ready for next chunk immediately (gapless scheduling)
            audioQueueProcessorReady = true;
            processAudioJobQueue();
            return;
            
        } catch (e) {
            throw new Error(`VoiceForge Web Audio playback failed: ${e?.message || e}`);
        }
    }
}

function updateUiAudioPlayState() {
    const topbarIcon = $('#voiceforge-connect-button .drawer-icon');
    const ttsEnabled = extension_settings.tts.enabled === true;
    const ttsActive = !audioElement.paused || isTtsProcessing();

    if (topbarIcon.length) {
        topbarIcon.toggleClass('flashing-icon', ttsEnabled || ttsActive);
        topbarIcon.toggleClass('tts-disabled', !ttsEnabled);
    }

    if (extension_settings.tts.enabled == true) {
        $('#ttsExtensionMenuItem').show();
        let img;
        // Give user feedback that TTS is active by setting the stop icon if processing or playing
        if (!audioElement.paused || isTtsProcessing()) {
            img = 'fa-solid fa-stop-circle extensionsMenuExtensionButton';
        } else {
            img = 'fa-solid fa-circle-play extensionsMenuExtensionButton';
        }
        $('#tts_media_control').attr('class', img);
    } else {
        $('#ttsExtensionMenuItem').hide();
    }
}

function onAudioControlClicked() {
    audioElement.src = '/sounds/silence.mp3';
    let context = getContext();
    // Not pausing, doing a full stop to anything TTS is doing. Better UX as pause is not as useful
    if (!audioElement.paused || isTtsProcessing()) {
        resetTtsPlayback();
    } else {
        // Default play behavior if not processing or playing is to play the last message.
        processAndQueueTtsMessage(context.chat[context.chat.length - 1]);
    }
    updateUiAudioPlayState();
}

function addAudioControl() {
    $('#tts_wand_container').append(`
        <div id="ttsExtensionMenuItem" class="list-group-item flex-container flexGap5">
            <div id="tts_media_control" class="extensionsMenuExtensionButton "/></div>
            TTS Playback
        </div>`);
    $('#tts_wand_container').append(`
        <div id="ttsExtensionNarrateAll" class="list-group-item flex-container flexGap5">
            <div class="extensionsMenuExtensionButton fa-solid fa-radio"></div>
            Narrate All Chat
        </div>`);
    $('#ttsExtensionMenuItem').attr('title', 'TTS play/pause').on('click', onAudioControlClicked);
    $('#ttsExtensionNarrateAll').attr('title', 'Narrate all messages in the current chat. Includes user messages, excludes hidden comments.').on('click', playFullConversation);
    updateUiAudioPlayState();
}

function bindTopbarDrawerClickHandler() {
    try {
        const extensionsToggle = document.querySelector('#extensions-settings-button .drawer-toggle');
        if (!extensionsToggle) {
            return;
        }

        const events = $._data(extensionsToggle, 'events');
        if (!events || !events.click || !events.click[0] || !events.click[0].handler) {
            return;
        }

        const drawerToggle = $('#voiceforge-connect-button .drawer-toggle');
        if (!drawerToggle.length) {
            return;
        }

        drawerToggle.off('click.voiceforgeDrawer');
        drawerToggle.on('click.voiceforgeDrawer', events.click[0].handler);
    } catch (error) {
        console.error('VoiceForge: Failed to bind topbar drawer handler', error);
    }
}

function completeCurrentAudioJob() {
    audioQueueProcessorReady = true;
    currentAudioJob = null;
    // If no more audio jobs pending
    if (audioJobQueue.length === 0 && ttsJobQueue.length === 0 && !ttsJobProcessing) {
        // Don't stop background if streaming TTS is still active (more sentences coming)
        if (streamingTtsActive) {
            console.debug('[TTS] Audio chunk complete, but streaming TTS still active - keeping background');
            // Immediately process any queued audio
            processAudioJobQueue();
            return;
        }
        
        emitVoiceforgeTtsEndOnce();
        
        // Stop VRM real-time lip sync
        if (typeof window.vrmStopLipSync === 'function') {
            window.vrmStopLipSync();
        }
        
        // IMPORTANT: Close Web Audio context to release system audio resources
        // This prevents audio conflicts with other applications
        cleanupWebAudioContext();
        
        // DON'T stop VoiceForge background here!
        // Background should only stop when:
        // 1. Character changes (handled in startVoiceForgeBackground)
        // 2. User explicitly stops it
        // 3. Chat changes (handled in resetTtsProviderState)
        // Stopping here causes the bug where background restarts between audio chunks
        // because streamingTtsActive becomes false before all audio plays
    }
    
    // Immediately process next audio job - don't wait for moduleWorker interval!
    processAudioJobQueue();
}

/**
/**
 * Accepts audio data and puts it on the queue for playback
 * @param {Response|Blob|string} response - Audio data
 * @param {string} char - Character name
 * @param {string|number} messageId - Message ID for playback bar positioning
 */
function addAudioJob(response, char, messageId = null, requestId = null, mode = 'standard', segmentId = null, segmentText = null, rawSegmentText = null, sourceStart = null, sourceEnd = null) {
    audioJobQueue.push({
        audioBlob: response,
        char,
        messageId,
        requestId,
        mode,
        segmentId,
        segmentText,
        rawSegmentText,
        sourceStart: Number.isFinite(sourceStart) ? Number(sourceStart) : null,
        sourceEnd: Number.isFinite(sourceEnd) ? Number(sourceEnd) : null,
    });
    if (audioQueueProcessorReady) processAudioJobQueue();
}

async function processAudioJobQueue() {
    if (!shouldAllowTtsNow()) {
        audioJobQueue.splice(0, audioJobQueue.length);
        return;
    }
    if (audioJobQueue.length == 0 || !audioQueueProcessorReady || audioPaused) return;
    
    // Simple FIFO - VoiceForge server handles ordering
    audioQueueProcessorReady = false;
    currentAudioJob = audioJobQueue.shift();
    playAudioData(currentAudioJob).catch((error) => {
        console.warn('[VoiceForge] Audio playback job failed:', error);
        completeCurrentAudioJob();
    });
}

//################//
//  TTS Control   //
//################//

let ttsJobQueue = [];
let currentTtsJob; // Null if nothing is currently being processed

async function tts(text, voiceName, char, voiceMapKey = null, messageId = null, requestId = null, mode = 'standard', segmentId = null, segmentText = null, rawSegmentText = null, sourceStart = null, sourceEnd = null) {
    const effectiveMode = mode || TTS_MODE_STANDARD;

    async function processResponse(response) {
        if (typeof window['rvcVoiceConversion'] === 'function' && extension_settings.rvc.enabled) {
            window['rvcVoiceConversion'](response, char, text)
                .then(converted => addAudioJob(converted, char, messageId, effectiveRequestId, effectiveMode, segmentId, segmentText || text, rawSegmentText || segmentText || text, sourceStart, sourceEnd))
                .catch(() => addAudioJob(response, char, messageId, effectiveRequestId, effectiveMode, segmentId, segmentText || text, rawSegmentText || segmentText || text, sourceStart, sourceEnd));
        } else {
            addAudioJob(response, char, messageId, effectiveRequestId, effectiveMode, segmentId, segmentText || text, rawSegmentText || segmentText || text, sourceStart, sourceEnd);
        }
    }

    // voiceName is the audio prompt name, voiceMapKey is the character name, requestId for session tracking
    let response = await ttsProvider.generateTts(text, voiceName, voiceMapKey, requestId);
    const effectiveRequestId = requestId || ttsProvider?.currentRequestId || null;

    // VoiceForge handles chunk ordering - just play as received
    if (typeof response[Symbol.asyncIterator] === 'function') {
        for await (const chunk of response) {
            await processResponse(chunk);
        }
    } else {
        await processResponse(response);
    }
}

function parseMessageSegments(text) {
    // Return the full text as a single segment
    if (text.trim().length > 0) {
        return [{ type: 'other', text: text.trim() }];
    }
    return [];
}

let ttsJobProcessing = false;

function isTinyClauseChunk(text) {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return false;
    }

    if (!/[,:;]\s*$/.test(normalized)) {
        return false;
    }

    const alphaNumLength = normalized.replace(/[^\p{L}\p{N}]/gu, '').length;
    const words = normalized.replace(/[,:;]/g, '').trim().split(/\s+/).filter(Boolean).length;
    return alphaNumLength > 0 && alphaNumLength <= 8 && words <= 2;
}

function mergeTinyClauseIntoNextJob(currentJob, tinyClauseText) {
    if (!ttsJobQueue.length) {
        return false;
    }

    const currentMessageId = currentJob?.messageId ?? null;
    const currentRequestId = currentJob?.requestId ?? null;
    const clause = String(tinyClauseText || '').trim();
    if (!clause) {
        return false;
    }

    const candidateIndex = ttsJobQueue.findIndex((queuedJob) => {
        if (!queuedJob) return false;
        const queuedText = String(queuedJob.segmentText || queuedJob.mes || '').trim();
        if (!queuedText) return false;

        const sameMessage = (queuedJob.messageId ?? null) === currentMessageId;
        const sameRequest = currentRequestId === null || (queuedJob.requestId ?? null) === currentRequestId;
        return sameMessage && sameRequest;
    });

    if (candidateIndex === -1) {
        return false;
    }

    const nextJob = ttsJobQueue[candidateIndex];
    const nextText = String(nextJob.segmentText || nextJob.mes || '').trim();
    if (!nextText) {
        return false;
    }

    const merged = `${clause} ${nextText}`.replace(/\s+/g, ' ').trim();
    nextJob.segmentText = merged;
    if (typeof nextJob.mes === 'string' && nextJob.mes.trim().length > 0) {
        nextJob.mes = merged;
    }
    return true;
}

function stripControlCommandTags(text) {
    let value = String(text || '');
    if (!value) {
        return '';
    }

    value = value
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&');

    value = value
        .replace(/<[^>]*>/g, ' ')
        .replace(/<[^>]*$/g, ' ')
        .replace(/^[^<]*>/g, ' ')
        .replace(/\b[^<>\n\r]*>/g, ' ')
        .replace(/<\s*intiface_commands\s*>[\s\S]*?<\s*\/\s*intiface_commands\s*>/gi, ' ')
        .replace(/<\s*(device|interface|media)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
        .replace(/<\s*(device|interface|media)\s*:[^>]*>/gi, ' ')
        .replace(/<\s*[a-z0-9_\-]+\s*:[^>]*>/gi, ' ')
        .replace(/<\s*intiface_commands\b[^>]*$/gi, ' ')
        .replace(/<\s*\/?\s*(?:any|device|interface|media)\b[^>]*$/gi, ' ')
        .replace(/<\s*[a-z0-9_\-]+\s*:[^>]*$/gi, ' ')
        .replace(/\b[a-z_][a-z0-9_\-]*\s*,\s*min\s*=\s*\d+\s*,\s*max\s*=\s*\d+\s*,\s*duration\s*=\s*\d+(?:\s*,\s*cycles\s*=\s*\d+)?\s*>?/gi, ' ')
        .replace(/\b(?:any|device|interface|media)\s*:\s*(?:waveform|basic|preset|dual|gradient|vibrate|oscillate|linear|pattern|stop|intensity|scan|connect|disconnect|start)\b[^.!?\n]*/gi, ' ')
        .replace(/\b(?:waveform|basic|preset|dual|gradient|vibrate|oscillate|linear|pattern)\s*:[^.!?\n]*/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return value;
}

function applyAngleTagMask(text, initialInAngleTag = false) {
    const source = String(text || '');
    let inAngleTag = !!initialInAngleTag;
    let masked = '';

    for (let i = 0; i < source.length; i++) {
        const ch = source[i];

        if (inAngleTag) {
            masked += ' ';
            if (ch === '>') {
                inAngleTag = false;
            }
            continue;
        }

        if (ch === '<') {
            inAngleTag = true;
            masked += ' ';
            continue;
        }

        masked += ch;
    }

    return { text: masked, inAngleTag };
}

function getTrailingCommandTagLength(text, startIndex = 0) {
    const source = String(text || '');
    let cursor = Math.max(0, Number(startIndex) || 0);
    let consumed = 0;

    while (cursor < source.length) {
        const rest = source.slice(cursor);
        const wsMatch = rest.match(/^\s+/);
        if (wsMatch) {
            cursor += wsMatch[0].length;
            consumed += wsMatch[0].length;
        }

        const blockMatch = source.slice(cursor).match(/^<\s*intiface_commands\s*>[\s\S]*?<\s*\/\s*intiface_commands\s*>/i);
        if (blockMatch) {
            cursor += blockMatch[0].length;
            consumed += blockMatch[0].length;
            continue;
        }

        const inlineMatch = source.slice(cursor).match(/^<\s*(?:any|device|interface|media)\s*:[^>]+>/i);
        if (inlineMatch) {
            cursor += inlineMatch[0].length;
            consumed += inlineMatch[0].length;
            continue;
        }

        break;
    }

    return consumed;
}

function getStreamingSentenceMatch(text, requireClosedQuotes = false) {
    const source = String(text || '');
    if (!requireClosedQuotes) {
        return source.match(/^(.*?(?:[.!?]{1,3}|…)+[\s\n"'」』】）\)]*)/s);
    }

    const openToClose = Object.fromEntries(DEFAULT_QUOTE_PAIRS);
    const quoteStack = [];
    let sawSentenceEndInQuote = false;

    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        const top = quoteStack[quoteStack.length - 1];

        if (top && ch === top.expectedClose) {
            quoteStack.pop();
            if (quoteStack.length === 0 && sawSentenceEndInQuote) {
                let end = i + 1;
                while (end < source.length && /[\s\n"'」』】）\)]/.test(source[end])) {
                    end++;
                }
                const chunk = source.slice(0, end);
                return [chunk, chunk];
            }
            continue;
        }

        if (openToClose[ch]) {
            quoteStack.push({ expectedClose: openToClose[ch] });
            continue;
        }

        if (/[.!?。！？…]/.test(ch)) {
            if (quoteStack.length > 0) {
                sawSentenceEndInQuote = true;
                continue;
            }

            let end = i + 1;
            while (end < source.length && /[.!?。！？…\s\n"'」』】）\)]/.test(source[end])) {
                end++;
            }
            const chunk = source.slice(0, end);
            return [chunk, chunk];
        }
    }

    return null;
}

function countTtsWords(text) {
    const matches = String(text || '').match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
    return matches ? matches.length : 0;
}

function getNthWordEndIndex(text, wordCount) {
    const source = String(text || '');
    const regex = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
    let match;
    let count = 0;
    while ((match = regex.exec(source)) !== null) {
        count++;
        if (count >= wordCount) {
            let end = regex.lastIndex;
            while (end < source.length && /[\s,;:!?。！？…"'”’」』）\]]/.test(source[end])) {
                end++;
            }
            return end;
        }
    }
    return -1;
}

function filterStreamingTextForSpeech(text) {
    const source = String(text || '');
    if (!source) return '';

    const quoteOnly = extension_settings.tts?.narrate_quoted_only === true;
    const skipAsterisks = extension_settings.tts?.narrate_dialogues_only === true;
    const openToClose = Object.fromEntries(DEFAULT_QUOTE_PAIRS);
    let output = '';

    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        const top = streamingTtsQuoteStack[streamingTtsQuoteStack.length - 1];

        if (top && ch === top.expectedClose) {
            streamingTtsQuoteStack.pop();
            if (!quoteOnly && !streamingTtsInAsteriskBlock) output += ch;
            continue;
        }

        if (openToClose[ch]) {
            if (!quoteOnly && !streamingTtsInAsteriskBlock) output += ch;
            streamingTtsQuoteStack.push({ expectedClose: openToClose[ch] });
            continue;
        }

        const insideQuote = streamingTtsQuoteStack.length > 0;
        if (!insideQuote && ch === '*') {
            streamingTtsInAsteriskBlock = !streamingTtsInAsteriskBlock;
            continue;
        }

        if (quoteOnly) {
            if (insideQuote) output += ch;
            continue;
        }

        if (skipAsterisks && streamingTtsInAsteriskBlock) {
            continue;
        }

        output += ch;
    }

    return output;
}

function getStreamingTtsMinChunkWords() {
    const chunkSize = Number(ttsProvider?.settings?.chunk_size ?? extension_settings.tts?.[PROVIDER_NAME]?.chunk_size ?? 0);
    return Number.isFinite(chunkSize) && chunkSize > 0 ? chunkSize : 0;
}

function splitTtsTextForExtension(text) {
    const source = String(text || '').trim();
    const chunkWords = getStreamingTtsMinChunkWords();
    if (!source || !chunkWords || countTtsWords(source) <= chunkWords) {
        return [source].filter(Boolean);
    }

    const chunks = [];
    let remaining = source;
    while (remaining && countTtsWords(remaining) > chunkWords) {
        let endIndex = getNthWordEndIndex(remaining, chunkWords);
        const sentenceMatch = getStreamingSentenceMatch(remaining.slice(0, endIndex), true)
            || getStreamingSentenceMatch(remaining.slice(0, endIndex), false);
        if (sentenceMatch && sentenceMatch[0]?.trim()) {
            endIndex = sentenceMatch[0].length;
        }
        if (endIndex <= 0) break;
        const chunk = remaining.slice(0, endIndex).trim();
        if (chunk) chunks.push(chunk);
        remaining = remaining.slice(endIndex).trimStart();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

function clearStreamingTtsPendingChunk() {
    streamingTtsPendingText = '';
    streamingTtsPendingRawText = '';
    streamingTtsPendingSourceStart = null;
    streamingTtsPendingSourceEnd = null;
    streamingTtsPendingMode = TTS_MODE_STREAMING;
}

function queueStreamingTtsChunk(text, rawText, sourceStart, sourceEnd, mode = TTS_MODE_STREAMING) {
    if (!shouldAllowTtsNow()) {
        return false;
    }

    const chunkText = String(text || '').trim();
    if (!chunkText) {
        return false;
    }

    const sentenceMessage = {
        mes: chunkText,
        rawMes: String(rawText || chunkText).trim(),
        name: streamingTtsCharName,
        is_user: false,
        messageId: streamingTtsMessageId,
    };

    processAndQueueTtsMessage(sentenceMessage, streamingTtsMessageId, streamingTtsRequestId, mode, {
        sourceStart,
        sourceEnd,
    });
    streamingTtsSentenceCount++;
    return true;
}

function accumulateStreamingTtsChunk(text, rawText, sourceStart, sourceEnd, force = false, mode = TTS_MODE_STREAMING) {
    const chunkText = String(text || '');
    if (!chunkText.trim()) {
        return false;
    }

    if (streamingTtsPendingText && streamingTtsPendingMode !== mode) {
        flushStreamingTtsPendingChunk();
    }

    if (!streamingTtsPendingText) {
        streamingTtsPendingText = chunkText.trimStart();
        streamingTtsPendingRawText = String(rawText || chunkText).trimStart();
        streamingTtsPendingSourceStart = Number.isFinite(sourceStart) ? sourceStart : null;
        streamingTtsPendingMode = mode;
    } else {
        streamingTtsPendingText = `${streamingTtsPendingText}${chunkText}`.replace(/\s+/g, ' ');
        streamingTtsPendingRawText = `${streamingTtsPendingRawText}${String(rawText || chunkText)}`.replace(/\s+/g, ' ');
    }
    streamingTtsPendingSourceEnd = Number.isFinite(sourceEnd) ? sourceEnd : streamingTtsPendingSourceEnd;

    const chunkWords = getStreamingTtsMinChunkWords();
    if (!force && (!chunkWords || countTtsWords(streamingTtsPendingText) < chunkWords)) {
        return false;
    }

    let queuedAny = false;
    while (force || (chunkWords > 0 && countTtsWords(streamingTtsPendingText) >= chunkWords)) {
        const endIndex = force ? streamingTtsPendingText.length : getNthWordEndIndex(streamingTtsPendingText, chunkWords);
        if (endIndex <= 0) break;

        const chunk = streamingTtsPendingText.slice(0, endIndex).trim();
        if (chunk) {
            queuedAny = queueStreamingTtsChunk(
                chunk,
                streamingTtsPendingRawText,
                streamingTtsPendingSourceStart,
                streamingTtsPendingSourceEnd,
                streamingTtsPendingMode,
            ) || queuedAny;
        }

        streamingTtsPendingText = streamingTtsPendingText.slice(endIndex).trimStart();
        if (force || !streamingTtsPendingText) {
            clearStreamingTtsPendingChunk();
            break;
        }
    }

    return queuedAny;
}

function flushStreamingTtsPendingChunk() {
    if (!streamingTtsPendingText) {
        return false;
    }

    const queued = queueStreamingTtsChunk(
        streamingTtsPendingText,
        streamingTtsPendingRawText,
        streamingTtsPendingSourceStart,
        streamingTtsPendingSourceEnd,
        streamingTtsPendingMode,
    );
    clearStreamingTtsPendingChunk();
    return queued;
}

function processTtsQueue() {
    if (!shouldAllowTtsNow()) {
        ttsJobQueue.splice(0, ttsJobQueue.length);
        return;
    }
    if (audioPaused) return;
    if (ttsJobProcessing) return;
    if (ttsJobQueue.length === 0) return;
    
    const job = ttsJobQueue.shift();
    ttsJobProcessing = true;
    currentTtsJob = job;
    
    const finishJob = () => {
        currentTtsJob = null;
        ttsJobProcessing = false;
        processTtsQueue();
    };
    
    const rawSegmentText = String(job.rawMes || job.segmentText || job.mes || '');
    let text = String(job.segmentText || job.mes || rawSegmentText || '');
    if (!text) {
        finishJob();
        return;
    }
    
    text = substituteParams(text);
    
    // Strip trailing periods/ellipsis after parameter substitution
    text = text.replace(/\.+\s*$/, '').trim();

    if (isTinyClauseChunk(text)) {
        if (mergeTinyClauseIntoNextJob(job, text)) {
            finishJob();
            return;
        }
    }
    
    // Skip sentences that are just ellipsis or mostly punctuation (garbage from streaming)
    const nonPunctLength = text.replace(/[.!?。！？;,:，。；：、""''「」『』【】（）""＂…\-–——\s]/g, '').length;
    if (nonPunctLength < 2) {
        console.debug('[VoiceForge] Skipping garbage TTS job (mostly punctuation):', text);
        finishJob();
        return;
    }
    
    // Only skip codeblocks if the setting is explicitly enabled (true)
    if (extension_settings.tts.skip_codeblocks === true) {
        text = text.replace(/^\s{4}.*$/gm, '').replace(/```.*?```/gs, '').replace(/~~~.*?~~~/gs, '').trim();
    }
    // Always filter out standalone triple backticks (even if code blocks aren't skipped)
    text = text.replace(/```+/g, '').trim();
    text = stripControlCommandTags(text);
    if (extension_settings.tts.skip_tags) {
        // Remove complete HTML tags with content: <tag>content</tag>
        text = text.replace(/<[^>]*>[\s\S]*?<\/[^>]*>/g, '');
        // Remove self-closing tags: <tag/>
        text = text.replace(/<[^>]+\/>/g, '');
        // Remove standalone tags: <tag>
        text = text.replace(/<[^>]+>/g, '');
        // Remove incomplete opening tags at the end: <redacted
        text = text.replace(/<[^>]*$/g, '');
        // Remove incomplete closing tags at the start: reasoning>
        text = text.replace(/^[^<]*>/g, '');
        text = text.trim();
    }
    // Filter markdown images FIRST (before any quote/dialogue filtering)
    // This prevents image URLs from being processed
    // Use [\s\S] to match any char including newlines, non-greedy with *?
    text = text.replace(/!\[[\s\S]*?\]\([\s\S]*?\)/g, '');
    // Also filter incomplete image markdown (if closing paren is missing)
    text = text.replace(/!\[[\s\S]*?\]\([\s\S]*$/g, '');
    
    // Dialogue/action modifiers are applied only here so every TTS path behaves identically.
    if (extension_settings.tts.skip_brackets) {
        text = text.replace(/\[[\s\S]*?\]/g, '').trim();
    }
    if (job.mode !== TTS_MODE_STREAMING && extension_settings.tts.narrate_quoted_only) {
        text = joinQuotedBlocks(text, { separator: ' ', includeQuotes: false, returnEmptyOnNoQuotes: true });
    }
    if (job.mode !== TTS_MODE_STREAMING && extension_settings.tts.narrate_dialogues_only) {
        text = stripAsteriskBlocksOutsideQuotes(text).trim();
    }
    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    if (!text) {
        finishJob();
        return;
    }

    const chunks = splitTtsTextForExtension(text);
    if (chunks.length > 1) {
        for (let i = chunks.length - 1; i >= 0; i--) {
            ttsJobQueue.unshift({
                ...job,
                mes: chunks[i],
                segmentText: chunks[i],
                rawMes: chunks[i],
            });
        }
        finishJob();
        return;
    }
    text = chunks[0];
     
    const char = job.name;
    let voiceMapEntry = voiceMap[char];
    const defaultEntry = voiceMap[DEFAULT_VOICE_MARKER];

    if (!voiceMapEntry) {
        voiceMapEntry = defaultEntry;
    }

    if (!voiceMapEntry || voiceMapEntry === DISABLED_VOICE_MARKER) {
        const err = new Error(`TTS voice map entry missing/disabled for character "${char}"`);
        console.error('[TTS] Error:', err);
        finishJob();
        return;
    }

    const rawResolvedBackend = (typeof voiceMapEntry === 'object' ? voiceMapEntry?.tts_backend : null)
        || (typeof defaultEntry === 'object' ? defaultEntry?.tts_backend : null);
    const resolvedBackend = rawResolvedBackend;
    if (!resolvedBackend) {
        const err = new Error(`TTS backend missing for character "${char}"`);
        console.error('[TTS] Error:', err);
        finishJob();
        return;
    }
    const rawPromptValue = typeof voiceMapEntry === 'object' ? voiceMapEntry.audio_prompt : voiceMapEntry;
    const defaultPromptValue = typeof defaultEntry === 'object' ? defaultEntry.audio_prompt : defaultEntry;
    const audioPromptValue = rawPromptValue === DEFAULT_VOICE_MARKER ? defaultPromptValue : rawPromptValue;
    const requiresPromptAudio =
        resolvedBackend === 'omnivoice'
        || resolvedBackend === 'omnivoice';
    if (requiresPromptAudio && audioPromptValue === DISABLED_VOICE_MARKER) {
        const err = new Error(`TTS audio prompt disabled for backend "${resolvedBackend}" and character "${char}"`);
        console.error('[TTS] Error:', err);
        finishJob();
        return;
    }

    const voiceName = audioPromptValue;
    const segmentId = Math.random().toString(36).substring(2, 12);
    
    // Fire sequentially to preserve chunk order
    tts(text, voiceName, char, char, job.messageId, job.requestId, job.mode, segmentId, text, rawSegmentText, job.sourceStart, job.sourceEnd)
        .catch(e => console.error(`[TTS] Error:`, e))
        .finally(finishJob);
}

/**
 * Extract and join quoted blocks with proper matching pairs and nesting.
 * - Captures outermost quotes and everything inside (including different inner quote styles).
 * - Requires matching opener/closer style (e.g., “ ... ”, 「 ... 」, « ... », etc.).
 * - Ignores incomplete/unclosed quotes (doesn't include them in the result).
 * - Symmetric quotes like "..." and ＂...＂ are supported (not nesting the same symmetric style).
 *
 * @param {string} text - The text to process
 * @param {object} [opts={}] - Optional options object
 * @param {string} [opts.separator=' '] - String to join multiple quoted blocks
 * @param {boolean} [opts.includeQuotes=true] - Keep the quote chars around the captured text
 * @param {boolean} [opts.returnEmptyOnNoQuotes=false] - Return an empty string if no quotes are found
 * @param {Array<[string,string]>} [opts.pairs] - Custom quote pairs; defaults cover EN/DE/FR/JP
 * @returns {string} The joined quoted blocks, or the original text if no quotes found
 */
function joinQuotedBlocks(text, opts = {}) {
    const {
        separator = ' ',
        includeQuotes = true,
        returnEmptyOnNoQuotes = false,
        pairs = DEFAULT_QUOTE_PAIRS,
    } = opts;

    if (!text || typeof text !== 'string') return text;

    const openToClose = Object.fromEntries(pairs);

    const segments = [];
    const stack = []; // [{ opener, expectedClose, start }]
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const top = stack[stack.length - 1];

        // Prefer closing the current open pair if the char matches its expected closer
        if (top && ch === top.expectedClose) {
            const finished = stack.pop();
            if (stack.length === 0) {
                // Only collect outermost quotes (contains all nested content)
                segments.push(text.slice(finished.start, i + 1));
            }
            continue;
        }

        // Otherwise, see if this is a new opener
        if (openToClose[ch]) {
            stack.push({ opener: ch, expectedClose: openToClose[ch], start: i });
            continue;
        }

        // If it's a stray closer that doesn't match current top, ignore
    }

    if (!segments.length) return returnEmptyOnNoQuotes ? '' : text;

    const cleaned = includeQuotes
        ? segments
        : segments.map(s => s.slice(1, -1).trim()).filter(s => s.length > 0); // all defined pairs are single-char quotes, filter empties

    return cleaned.join(separator);
}

function stripAsteriskBlocksOutsideQuotes(text) {
    if (!text || typeof text !== 'string' || !text.includes('*')) return text;

    const openToClose = Object.fromEntries(DEFAULT_QUOTE_PAIRS);
    let out = '';
    let inAsteriskBlock = false;
    const quoteStack = [];

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const top = quoteStack[quoteStack.length - 1];
        const insideQuote = quoteStack.length > 0;

        if (top && ch === top.expectedClose) {
            quoteStack.pop();
            if (!inAsteriskBlock) out += ch;
            continue;
        }

        if (!insideQuote && openToClose[ch]) {
            quoteStack.push({ expectedClose: openToClose[ch] });
            if (!inAsteriskBlock) out += ch;
            continue;
        }

        if (!insideQuote && ch === '*') {
            inAsteriskBlock = !inAsteriskBlock;
            continue;
        }

        if (!inAsteriskBlock) {
            out += ch;
        }
    }

    return out;
}

async function playFullConversation() {
    resetTtsPlayback();

    if (!shouldAllowTtsNow()) {
        return toastr.warning('TTS is disabled. Please enable it in the extension settings.');
    }

    const context = getContext();
    const chat = context.chat.filter(x => !x.is_system && x.mes !== '...' && x.mes !== '');

    if (chat.length === 0) {
        return toastr.info('No messages to narrate.');
    }

    ttsJobQueue = chat;
}

window['playFullConversation'] = playFullConversation;

//#############################//
//  Extension UI and Settings  //
//#############################//

function loadSettings() {
    // Initialize tts settings object if it doesn't exist
    if (!extension_settings.tts) {
        extension_settings.tts = {};
    }
    // Only set defaults for keys that don't exist (preserves user's saved settings including false values)
    for (const key in defaultSettings) {
        if (!(key in extension_settings.tts) || extension_settings.tts[key] === undefined) {
            extension_settings.tts[key] = defaultSettings[key];
        }
    }
    $('#tts_enabled').prop(
        'checked',
        extension_settings.tts.enabled,
    );
    $('#tts_narrate_dialogues').prop('checked', extension_settings.tts.narrate_dialogues_only);
    $('#tts_narrate_quoted').prop('checked', extension_settings.tts.narrate_quoted_only);
    $('#tts_auto_generation').prop('checked', extension_settings.tts.auto_generation);
    $('#tts_non_call_enabled').prop('checked', extension_settings.tts.non_call_tts_enabled !== false);
    $('#tts_generation_metadata_prefix').prop('checked', extension_settings.tts.generation_metadata_prefix === true);
    $('#tts_skip_codeblocks').prop('checked', extension_settings.tts.skip_codeblocks);
    $('#tts_skip_tags').prop('checked', extension_settings.tts.skip_tags);
    $('#tts_skip_brackets').prop('checked', extension_settings.tts.skip_brackets);
    $('#playback_rate').val(extension_settings.tts.playback_rate);
    $('#playback_rate_counter').val(Number(extension_settings.tts.playback_rate).toFixed(2));

    $('body').toggleClass('tts', extension_settings.tts.enabled);
}

const defaultSettings = {
    voiceMap: '',
    ttsEnabled: false,
    currentProvider: 'VoiceForge',
    auto_generation: true,
    non_call_tts_enabled: true,
    playback_rate: 1,
    show_playback_bar: true,
    narrate_dialogues_only: false,  // Ignore *asterisk actions*
    narrate_quoted_only: false,     // Only narrate quoted speech
    skip_codeblocks: true,
    skip_tags: false,
    skip_brackets: false,           // Ignore [text inside brackets]
    generation_metadata_prefix: false,
};

function setTtsStatus(status, success) {
    $('#tts_status').text(status);
    if (success) {
        $('#tts_status').removeAttr('style');
    } else {
        $('#tts_status').css('color', 'red');
    }
}

async function onEnableClick() {
    extension_settings.tts.enabled = $('#tts_enabled').is(':checked');
    updateUiAudioPlayState();
    saveSettingsDebounced();
    $('body').toggleClass('tts', extension_settings.tts.enabled);
    if (extension_settings.tts.enabled) {
        await initVoiceMap();
    }
}


function onAutoGenerationClick() {
    extension_settings.tts.auto_generation = !!$('#tts_auto_generation').prop('checked');
    saveSettingsDebounced();
}

function onNonCallTtsEnabledClick() {
    extension_settings.tts.non_call_tts_enabled = !!$('#tts_non_call_enabled').prop('checked');
    if (!shouldAllowTtsNow()) {
        resetTtsPlayback();
    }
    saveSettingsDebounced();
}

function onGenerationMetadataPrefixClick() {
    extension_settings.tts.generation_metadata_prefix = !!$('#tts_generation_metadata_prefix').prop('checked');
    saveSettingsDebounced();
}


function onNarrateDialoguesClick() {
    extension_settings.tts.narrate_dialogues_only = !!$('#tts_narrate_dialogues').prop('checked');
    saveSettingsDebounced();
}

function onNarrateQuotedClick() {
    extension_settings.tts.narrate_quoted_only = !!$('#tts_narrate_quoted').prop('checked');
    saveSettingsDebounced();
}


function onSkipCodeblocksClick() {
    extension_settings.tts.skip_codeblocks = !!$('#tts_skip_codeblocks').prop('checked');
    saveSettingsDebounced();
}

function onSkipTagsClick() {
    extension_settings.tts.skip_tags = !!$('#tts_skip_tags').prop('checked');
    saveSettingsDebounced();
}

function onSkipBracketsClick() {
    extension_settings.tts.skip_brackets = !!$('#tts_skip_brackets').prop('checked');
    saveSettingsDebounced();
}

//##############//
// TTS Provider //
//##############//

function mountVoiceForgeConnectionPanel() {
    const providerRoot = $('#tts_provider_settings .voiceforge-provider-settings').first();
    const connectionMount = $('#voiceforge_connection_mount');

    if (!providerRoot.length || !connectionMount.length) {
        return;
    }

    const statusBlock = providerRoot.find('#voiceforge_server_status').first();
    const endpointBlock = providerRoot.find('#voiceforge_endpoint').closest('.flex-container.flexFlowColumn').first();

    if (!statusBlock.length || !endpointBlock.length) {
        return;
    }

    const panel = $('<div class="voiceforge-main-connection"></div>');
    panel.append(statusBlock);
    panel.append(endpointBlock);
    connectionMount.empty().append(panel);

    const leadingDivider = providerRoot.children('hr').first();
    if (leadingDivider.length) {
        leadingDivider.remove();
    }
}

async function loadTtsProvider() {
    // Clear the current config and add new config
    $('#tts_provider_settings').html('');

    // Init provider
    extension_settings.tts.currentProvider = PROVIDER_NAME;
    ttsProvider = new VoiceForgeProvider();

    // Init provider settings
    $('#tts_provider_settings').append(ttsProvider.settingsHtml);
    mountVoiceForgeConnectionPanel();
    if (!(PROVIDER_NAME in extension_settings.tts)) {
        console.warn(`Provider ${PROVIDER_NAME} not in Extension Settings, initializing provider in settings`);
        extension_settings.tts[PROVIDER_NAME] = {};
    }
    await ttsProvider.loadSettings(extension_settings.tts[PROVIDER_NAME]);
    await initVoiceMap();
}

// Ensure that TTS provider settings are saved to extension settings.
export function saveTtsProviderSettings() {
    extension_settings.tts[PROVIDER_NAME] = ttsProvider.settings;
    updateVoiceMap();
    saveSettingsDebounced();
}


//###################//
// voiceMap Handling //
//###################//

async function onChatChanged() {
    await onGenerationEnded();
    resetTtsPlayback();
    const voiceMapInit = initVoiceMap();
    await Promise.race([voiceMapInit, delay(debounce_timeout.relaxed)]);
    lastMessage = null;
}

async function onMessageEvent(messageId, lastCharIndex) {
    const normalizedMessageId = normalizeMessageId(messageId);
    // If TTS is disabled, do nothing
    if (!shouldAllowTtsNow()) {
        return;
    }

    // Auto generation is disabled - only manual TTS allowed
    if (!extension_settings.tts.auto_generation) {
        return;
    }
    
    // If periodic/streaming mode is ON, streaming TTS handles it via STREAM_TOKEN_RECEIVED
    // Check these flags OUTSIDE the isStreamingEnabled() check because streaming may have just ended
    // Skip if streaming TTS already processed this message
    if (streamingTtsProcessedMessageId === normalizedMessageId) {
        console.debug('[VoiceForge] Skipping message', normalizedMessageId, '- streaming TTS already processed this message');
        return;
    }
    // Skip if streaming completed for this message (race condition: CHARACTER_MESSAGE_RENDERED fires before finalizeStreamingTts sets processed ID)
    if (streamingTtsCompletedMessageId === normalizedMessageId) {
        console.debug('[VoiceForge] Skipping message', normalizedMessageId, '- streaming TTS just completed for this message');
        return;
    }
    // If streaming is currently active for this message, skip it
    if (streamingTtsActive && streamingTtsMessageId === normalizedMessageId) {
        console.debug('[VoiceForge] Skipping message', normalizedMessageId, '- streaming TTS is currently active');
        return;
    }
    
    const context = getContext();

    // no characters or group selected
    if (!context.groupId && context.characterId === undefined) {
        return;
    }

    // Chat changed
    if (context.chatId !== lastChatId) {
        lastChatId = context.chatId;
        lastMessageHash = getStringHash(context.chat[normalizedMessageId]?.mes ?? '');

        // Force to speak on the first message in the new chat
        if (context.chat.length === 1) {
            lastMessageHash = -1;
        }
    }

    // clone message object, as things go haywire if message object is altered below (it's passed by reference)
    const message = structuredClone(context.chat[normalizedMessageId]);
    const hashNew = getStringHash(message?.mes ?? '');

    // Ignore prompt-hidden messages
    if (message.is_system) {
        return;
    }

    // if no new messages, or same message, or same message hash, do nothing
    if (hashNew === lastMessageHash) {
        return;
    }

    // if we only want to process part of the message
    if (lastCharIndex) {
        message.mes = message.mes.substring(0, lastCharIndex);
    }

    const isLastMessageInCurrent = () =>
        lastMessage &&
        typeof lastMessage === 'object' &&
        message.swipe_id === lastMessage.swipe_id &&
        message.name === lastMessage.name &&
        message.is_user === lastMessage.is_user &&
        message.mes.indexOf(lastMessage.mes) !== -1;

    // if last message within current message, message got extended. only send diff to TTS.
    if (isLastMessageInCurrent()) {
        const tmp = structuredClone(message);
        message.mes = message.mes.replace(lastMessage.mes, '');
        lastMessage = tmp;
    } else {
        lastMessage = structuredClone(message);
    }

    // We're currently swiping. Don't generate voice
    if (!message || message.mes === '...' || message.mes === '') {
        return;
    }

    // Skip user messages - only narrate AI/character messages
    if (message.is_user) {
        return;
    }

    // New messages, add new chat to history
    lastMessageHash = hashNew;
    lastChatId = context.chatId;

    console.debug(`Adding message from ${message.name} for TTS processing: "${message.mes}"`);

    // Track which message is being narrated for playback bar positioning
    currentNarratingMessageId = normalizedMessageId;

    // If streaming TTS is active for this message, DON'T also add via onMessageUpdated
    // Let the streaming handler (onStreamTokenReceived) handle sentence detection
    // BUT: Only skip if the message hash matches (same content) - if content changed (regeneration), process it
    if (streamingTtsActive && streamingTtsMessageId === normalizedMessageId) {
        // Check if this is actually the same message content or a regeneration
        const context = getContext();
        const existingMessage = context.chat[normalizedMessageId];
        const existingHash = existingMessage ? getStringHash(existingMessage.mes || '') : null;
        
        // If hash matches, it's the same content - streaming TTS is handling it
        if (existingHash === hashNew) {
            console.debug('[VoiceForge] Skipping onMessageUpdated - streaming TTS is handling this message');
            return;
        } else {
            // Content changed (regeneration) - reset streaming state and process normally
            console.debug('[VoiceForge] Message regenerated - resetting streaming TTS and processing');
            resetStreamingTts();
        }
    }

    // When streaming mode is enabled, NEVER queue the full message here.
    // Streaming TTS processes sentences in real-time via STREAM_TOKEN_RECEIVED.
    // onMessageEvent is for non-streaming mode only.
    if (extension_settings.tts.auto_generation && isStreamingEnabled()) {
        console.debug('[VoiceForge] Skipping onMessageEvent - streaming mode handles TTS via real-time tokens');
        return;
    }

    processAndQueueTtsMessage(message, normalizedMessageId);
}

async function onMessageDeleted() {
    const context = getContext();

    // update internal references to new last message
    lastChatId = context.chatId;

    // compare against lastMessageHash. If it's the same, we did not delete the last chat item, so no need to reset tts queue
    const messageHash = getStringHash((context.chat.length && context.chat[context.chat.length - 1].mes) ?? '');
    if (messageHash === lastMessageHash) {
        return;
    }
    lastMessageHash = messageHash;
    lastMessage = context.chat.length ? structuredClone(context.chat[context.chat.length - 1]) : null;

    // stop any tts playback since message might not exist anymore
    resetTtsPlayback();
}

async function onGenerationStarted(generationType, _args, isDryRun) {
    console.debug('[VoiceForge STREAM] onGenerationStarted:', generationType, 'isDryRun:', isDryRun);
    await applyGenerationMetadataPrefix(generationType, isDryRun);
    
    // If dry running or quiet mode, do nothing
    if (isDryRun || ['quiet', 'impersonate'].includes(generationType)) {
        console.debug('[VoiceForge STREAM] Skipping - dry run or quiet/impersonate');
        // Still reset streaming state to prevent stale state from blocking future generations
        resetStreamingTts();
        return;
    }

    // If TTS is disabled, do nothing
    if (!shouldAllowTtsNow()) {
        console.debug('[VoiceForge STREAM] Skipping - TTS disabled for current mode');
        // Still reset streaming state to prevent stale state from blocking future generations
        resetStreamingTts();
        return;
    }

    // Auto generation is disabled
    if (!extension_settings.tts.auto_generation) {
        console.debug('[VoiceForge STREAM] Skipping - Auto generation disabled');
        // Still reset streaming state to prevent stale state from blocking future generations
        resetStreamingTts();
        return;
    }
    
    // If the LLM reply is not being streamed, skip streaming TTS setup
    if (!isStreamingEnabled()) {
        console.debug('[VoiceForge STREAM] Skipping - SillyTavern streaming disabled (isStreamingEnabled=false)');
        // Reset streaming state so onMessageEvent doesn't skip processing
        resetStreamingTts();
        return;
    }

    // Initialize streaming TTS for real-time sentence processing
    const context = getContext();
    const lastMessageId = resolveStreamingTargetMessageId(context);
    const charName = context.name2; // Character name
    
    initStreamingTts(lastMessageId, charName);
}

async function onGenerationEnded() {
    clearGenerationMetadataPrefix();

    if (periodicMessageGenerationTimer) {
        clearInterval(periodicMessageGenerationTimer);
        periodicMessageGenerationTimer = null;
    }
    lastPositionOfParagraphEnd = -1;
    
    // Finalize streaming TTS - process any remaining buffered text
    if (streamingTtsActive) {
        await finalizeStreamingTts();
    }
}

function clearGenerationMetadataPrefix() {
    if (!activeGenerationMetadataState) {
        return;
    }

    const powerUser = getContext().powerUserSettings || {};
    powerUser.user_prompt_bias = activeGenerationMetadataState.previousBias;
    powerUser.show_user_prompt_bias = activeGenerationMetadataState.previousShowBias;
    activeGenerationMetadataState = null;
}

async function applyGenerationMetadataPrefix(generationType, isDryRun) {
    clearGenerationMetadataPrefix();

    if (isDryRun || ['quiet', 'impersonate'].includes(generationType)) {
        return;
    }

    if (extension_settings.tts?.generation_metadata_prefix !== true) {
        return;
    }

    const metadataPrefix = String(await buildVoiceforgeMetadataPrefixForGeneration() || '');
    if (!metadataPrefix) {
        return;
    }

    const powerUser = getContext().powerUserSettings || {};
    const cleanedPreviousBias = stripLeadingVoiceforgeMetadataTags(String(powerUser.user_prompt_bias || ''));
    activeGenerationMetadataState = {
        previousBias: cleanedPreviousBias,
        previousShowBias: powerUser.show_user_prompt_bias === true,
    };

    powerUser.user_prompt_bias = [metadataPrefix, cleanedPreviousBias].filter(Boolean).join(' ');
    powerUser.show_user_prompt_bias = true;
}

// Debug timing for streaming TTS
let streamingTtsFirstTokenTime = 0;
let streamingTtsTokenCount = 0;

/**
 * Handle streaming token received event for real-time TTS
 * This fires for each chunk of text as it streams from the LLM
 * Note: SillyTavern sends ACCUMULATED text, not deduplicated tokens!
 * @param {string} accumulatedText - The full accumulated text so far (not just the new token)
 */
async function onStreamTokenReceived(accumulatedText) {
    const now = performance.now();
    
    // If TTS is disabled or auto generation is off, skip
    if (!shouldAllowTtsNow() || !extension_settings.tts.auto_generation) {
        return;
    }
    
    // If streaming mode is enabled but streaming TTS isn't active yet, initialize it
    // This handles cases where tokens arrive before onGenerationStarted is called
    if (!streamingTtsActive && extension_settings.tts.auto_generation && isStreamingEnabled()) {
        const context = getContext();
        const lastMessageId = resolveStreamingTargetMessageId(context, accumulatedText);
        const charName = context.name2; // Character name
        console.debug(`[VoiceForge STREAM] Auto-initializing streaming TTS on first token (onGenerationStarted may have been delayed)`);
        initStreamingTts(lastMessageId, charName);
    }
    
    // Only process if streaming TTS is active
    if (!streamingTtsActive) {
        return;
    }
    
    // Track timing
    streamingTtsTokenCount++;
    if (streamingTtsTokenCount === 1) {
        streamingTtsFirstTokenTime = now;
    }
    
    let shouldProcessBuffer = false;
    const previousAccumulated = streamingTtsLastReceivedText;

    // Robust deduplication:
    // - Normal case: accumulated text grows, append just the suffix.
    // - Rewind case: accumulated shrinks, wait for growth again.
    // - Desync case: accumulated was rewritten (not a prefix relation), resync safely.
    if (!previousAccumulated) {
        streamingTtsBuffer += accumulatedText;
        shouldProcessBuffer = accumulatedText.length > 0;
    } else if (accumulatedText.startsWith(previousAccumulated)) {
        const appendedText = accumulatedText.slice(previousAccumulated.length);
        if (appendedText.length > 0) {
            streamingTtsBuffer += appendedText;
            shouldProcessBuffer = true;
        }
    } else if (previousAccumulated.startsWith(accumulatedText)) {
        // Rewinding - wait for more
    } else {
        const previouslyProcessedText = streamingTtsBuffer.slice(0, streamingTtsLastProcessedIndex);
        const safeProcessedPrefix = getCommonPrefixLength(previouslyProcessedText, accumulatedText);

        streamingTtsBuffer = accumulatedText;
        streamingTtsLastProcessedIndex = safeProcessedPrefix;
        shouldProcessBuffer = accumulatedText.length > safeProcessedPrefix;

        console.warn('[VoiceForge STREAM] Accumulated text desynced, resynced to avoid dropped speech');
    }

    streamingTtsLastReceivedText = accumulatedText;

    if (!shouldProcessBuffer) {
        return;
    }
    
    // Try to extract and process complete sentences
    // NOTE: No await - processStreamingTtsBuffer is sync internally, and we don't want to block token processing
    processStreamingTtsBuffer();
}

/**
 * Initialize streaming TTS for a new generation
 */
function initStreamingTts(messageId, charName) {
    const normalizedMessageId = normalizeMessageId(messageId);

    // Guard against re-initialization mid-stream (would reset chunk indices!)
    if (streamingTtsActive && streamingTtsMessageId === normalizedMessageId) {
        console.debug('[VoiceForge STREAM] Already initialized for this message, skipping re-init');
        return;
    }
    
    // If switching to a new message mid-stream, finalize the old one first
    if (streamingTtsActive && streamingTtsMessageId !== normalizedMessageId) {
        console.warn('[VoiceForge STREAM] New message started while previous still active - finalizing previous');
        finalizeStreamingTts();
    }
    
    // IMPORTANT: Stop any already-scheduled audio from previous message
    // This prevents old audio from continuing to play and "repeating" chunks
    if (webAudioSources.length > 0) {
        console.debug('Stopping', webAudioSources.length, 'previously scheduled audio sources');
        webAudioSources.forEach(source => {
            try { source.stop(); } catch (e) {}
        });
        webAudioSources = [];
    }
    
    // Clear any queued audio jobs from previous message
    audioJobQueue.splice(0, audioJobQueue.length);
    ttsJobQueue.splice(0, ttsJobQueue.length);
    currentAudioJob = null;
    audioQueueProcessorReady = true;
    lastSpokenSegmentId = null;

    resetTtsPlaybackSession();
    
    streamingTtsBuffer = '';
    streamingTtsLastProcessedIndex = 0;
    streamingTtsLastReceivedText = ''; // Reset deduplication tracker
    streamingTtsActive = true;
    streamingTtsMessageId = normalizedMessageId;
    streamingTtsCharName = charName;
    // Generate ONE request_id for ALL chunks in this streaming session
    streamingTtsRequestId = Math.random().toString(36).substring(2, 10);
    streamingTtsSentenceCount = 0; // Reset sentence counter
    streamingTtsCompletedMessageId = null; // Reset completion flag for new streaming session (allows regeneration)
    streamingTtsQuoteStack = [];
    streamingTtsInAsteriskBlock = false;
    streamingTtsInAngleTag = false;
    clearStreamingTtsPendingChunk();
    currentNarratingMessageId = normalizedMessageId;
    
    // Reset debug timing
    streamingTtsFirstTokenTime = 0;
    streamingTtsTokenCount = 0;
    
    // Reset Web Audio state for new streaming session
    webAudioScheduledTime = 0;
    webAudioIsPlaying = false;
}

/**
 * Process the streaming buffer and send complete sentences to TTS
 * Optimized for low latency:
 * - Processes ALL available sentences in one pass (not just one)
 * - Fires first chunk faster with clause-level detection
 */
async function processStreamingTtsBuffer() {
    if (!streamingTtsActive || !streamingTtsBuffer) {
        return;
    }

    const sourceStartAbs = streamingTtsLastProcessedIndex;
    const unprocessedChunk = streamingTtsBuffer.slice(streamingTtsLastProcessedIndex);
    if (!unprocessedChunk) {
        return;
    }

    streamingTtsLastProcessedIndex = streamingTtsBuffer.length;

    const filteredChunk = filterStreamingTextForSpeech(unprocessedChunk)
        .replace(/!\[[\s\S]*?\]\([\s\S]*?\)/g, '')
        .replace(/!\[[\s\S]*?\]\([\s\S]*$/g, '')
        .replace(/```+/g, '')
        .replace(/\[.*?\]\([\s\S]*?\)/g, '');

    if (filteredChunk.trim() && accumulateStreamingTtsChunk(filteredChunk, unprocessedChunk, sourceStartAbs, streamingTtsLastProcessedIndex)) {
        processTtsQueue();
    }

    return;
    
    // Get unprocessed portion of the buffer
    let unprocessedText = streamingTtsBuffer.slice(streamingTtsLastProcessedIndex);
    
    if (!unprocessedText.trim()) {
        return;
    }

    // Filter markdown images from buffer BEFORE sentence extraction
    // This prevents images from being split across sentence boundaries
    // Loop to skip all markdown images at the start
    while (true) {
        const imageMatch = unprocessedText.match(/!\[[\s\S]*?\]\([\s\S]*?\)/);
        if (imageMatch) {
            // Skip past the image markdown
            const imageEndIndex = unprocessedText.indexOf(imageMatch[0]) + imageMatch[0].length;
            streamingTtsInAngleTag = applyAngleTagMask(unprocessedText.slice(0, imageEndIndex), streamingTtsInAngleTag).inAngleTag;
            streamingTtsLastProcessedIndex += imageEndIndex;
            // Update unprocessedText to check for more images
            unprocessedText = streamingTtsBuffer.slice(streamingTtsLastProcessedIndex);
            continue;
        }
        break;
    }
    // Also check for incomplete image markdown (if closing paren is missing, wait for it)
    const incompleteImageMatch = unprocessedText.match(/!\[[\s\S]*?\]\([\s\S]*$/);
    if (incompleteImageMatch) {
        return;
    }
    
    // Loop to process ALL available sentences (not just one per call)
    let sentencesProcessed = 0;
    const maxSentencesPerPass = 10; // Safety limit
    
    while (sentencesProcessed < maxSentencesPerPass) {
        unprocessedText = streamingTtsBuffer.slice(streamingTtsLastProcessedIndex);
        const processableText = applyAngleTagMask(unprocessedText, streamingTtsInAngleTag).text;
        
        if (!processableText.trim()) {
            break;
        }
        
        // PRE-SKIP: Skip markdown images that appear anywhere in the text before sentence boundaries
        // This handles images on their own lines or inline - find first occurrence
        const imageAnywhereMatch = processableText.match(/!\[[\s\S]*?\]\([\s\S]*?\)/);
        if (imageAnywhereMatch) {
            // Check if image appears BEFORE any sentence-ending punctuation
            const textBeforeImage = processableText.substring(0, processableText.indexOf(imageAnywhereMatch[0]));
            // Only skip if there's no sentence boundary before the image (meaning it's standalone/on its own line)
            // or if it looks like the image is between sentences
            const hasSentenceEndBefore = /[.!?。！？]+[\s\n]*$/.test(textBeforeImage);
            
            if (!textBeforeImage.trim() || hasSentenceEndBefore) {
                // Image is at start or after a sentence end - safe to skip
                const imageEndIndex = processableText.indexOf(imageAnywhereMatch[0]) + imageAnywhereMatch[0].length;
                streamingTtsInAngleTag = applyAngleTagMask(unprocessedText.slice(0, imageEndIndex), streamingTtsInAngleTag).inAngleTag;
                streamingTtsLastProcessedIndex += imageEndIndex;
                continue;
            }
        }
        // Also wait for incomplete images (check if buffer might end mid-image)
        if (processableText.includes('![')) {
            const imageStartIndex = processableText.indexOf('![');
            const afterImageStart = processableText.substring(imageStartIndex);
            // Check if this is a complete image
            const isCompleteImage = /!\[[\s\S]*?\]\([[\s\S]*?\)/.test(afterImageStart);
            if (!isCompleteImage) {
                break;
            }
        }
        
        // Use a single sentence-boundary strategy for consistent chunk sizing.
        // In quote-only mode, do not split inside an open quoted block.
        const sentenceMatch = getStreamingSentenceMatch(
            processableText,
            extension_settings.tts.narrate_quoted_only,
        );
        
        if (!sentenceMatch) {
            break; // No more complete sentences
        }
        
        let completeSentence = sentenceMatch[1].trim();
        const sourceStartAbs = streamingTtsLastProcessedIndex;
        const baseConsumedLen = sentenceMatch[0].length;
        const extraCommandTagLen = getTrailingCommandTagLength(unprocessedText, baseConsumedLen);
        const consumedLen = baseConsumedLen + extraCommandTagLen;
        const rawCompleteSentence = unprocessedText.slice(0, consumedLen).trim();
        
        // Strip trailing ellipsis from LLM output (e.g., "text..." -> "text" or "text…" -> "text")
        // Handles: ... (three ASCII dots), … (U+2026 ellipsis), .... (four+ dots)
        completeSentence = completeSentence.replace(/(\.{3,}|…)\s*$/, '').trim();
        
        // Skip sentences that are just ellipsis or mostly punctuation (garbage from streaming)
        // This prevents TTS from trying to speak just "..." or similar noise
        const nonPunctLength = completeSentence.replace(/[.!?。！？;,:，。；：、""''「」『』【】（）""＂…\-–——\s]/g, '').length;
        if (nonPunctLength < 2) {
            console.debug('[VoiceForge] Skipping garbage sentence (mostly punctuation):', completeSentence);
            streamingTtsInAngleTag = applyAngleTagMask(unprocessedText.slice(0, consumedLen), streamingTtsInAngleTag).inAngleTag;
            streamingTtsLastProcessedIndex += consumedLen;
            continue;
        }
        
        // IMMEDIATELY filter images from the extracted sentence
        // This catches images that got included in the sentence match
        completeSentence = completeSentence.replace(/!\[[\s\S]*?\]\([\s\S]*?\)/g, '');
        completeSentence = completeSentence.replace(/!\[[\s\S]*?\]\([\s\S]*$/g, '');
        completeSentence = completeSentence.trim();
        
        // Update the processed index FIRST (before any filtering that might skip the sentence)
        streamingTtsInAngleTag = applyAngleTagMask(unprocessedText.slice(0, consumedLen), streamingTtsInAngleTag).inAngleTag;
        streamingTtsLastProcessedIndex += consumedLen;

        const sourceEndAbs = streamingTtsLastProcessedIndex;
        
        if (completeSentence.length === 0) {
            continue;
        }
        
        // Filter out markdown images BEFORE bracket filtering
        // This prevents the bracket regex from corrupting the image pattern
        completeSentence = completeSentence.replace(/!\[[\s\S]*?\]\([\s\S]*?\)/g, '');
        completeSentence = completeSentence.replace(/!\[[\s\S]*?\]\([\s\S]*$/g, '');
        completeSentence = completeSentence.trim();
        
        // Apply bracket filtering for streaming mode
        if (extension_settings.tts.skip_brackets) {
            const beforeFilter = completeSentence;
            completeSentence = completeSentence.replace(/\[[\s\S]*?\]/g, '').trim();
        }

        if (completeSentence.length === 0) {
            continue;
        }
        
        // Apply HTML tag filtering for streaming mode
        if (extension_settings.tts.skip_tags) {
            // Remove complete HTML tags with content: <tag>content</tag>
            completeSentence = completeSentence.replace(/<[^>]*>[\s\S]*?<\/[^>]*>/g, '');
            // Remove self-closing tags: <tag/>
            completeSentence = completeSentence.replace(/<[^>]+\/>/g, '');
            // Remove standalone tags: <tag>
            completeSentence = completeSentence.replace(/<[^>]+>/g, '');
            // Remove incomplete opening tags at the end: <redacted
            completeSentence = completeSentence.replace(/<[^>]*$/g, '');
            // Remove incomplete closing tags at the start: reasoning>
            completeSentence = completeSentence.replace(/^[^<]*>/g, '');
            completeSentence = completeSentence.trim();
        }

        completeSentence = stripControlCommandTags(completeSentence);
        
        // Filter out standalone triple backticks
        completeSentence = completeSentence.replace(/```+/g, '').trim();
        
        if (completeSentence.length === 0) {
            continue;
        }
        
        // Create a mini-message object for the sentence
        // FINAL safety filter - ensure absolutely no images make it through
        completeSentence = completeSentence.replace(/!\[[\s\S]*?\]\([\s\S]*?\)/g, '');
        completeSentence = completeSentence.replace(/!\[[\s\S]*?\]\([\s\S]*$/g, '');
        completeSentence = completeSentence.replace(/\[.*?\]\([\s\S]*?\)/g, '');  // Also catch corrupted patterns
        completeSentence = completeSentence.trim();
        
        // Skip if nothing left after all filtering
        if (completeSentence.length === 0) {
            continue;
        }
        
        if (accumulateStreamingTtsChunk(completeSentence, rawCompleteSentence, sourceStartAbs, sourceEndAbs)) {
            sentencesProcessed++;
        }
    }
    
    // Fire TTS immediately if we queued anything - don't wait for moduleWorker interval
    if (sentencesProcessed > 0) {
        console.debug(`[VoiceForge STREAM] Fired ${sentencesProcessed} sentence(s) to TTS`);
        processTtsQueue();
    }
}

/**
 * Finalize streaming TTS - process any remaining text in the buffer
 */
async function finalizeStreamingTts() {
    if (!streamingTtsActive) {
        return;
    }

    // Check if we processed any text via streaming (either sentences or remaining text)
    const hadProcessedContent = streamingTtsLastProcessedIndex > 0;
    
    // Process any remaining unprocessed text
    const rawRemainingText = streamingTtsBuffer.slice(streamingTtsLastProcessedIndex).trim();
    let remainingText = applyAngleTagMask(rawRemainingText, streamingTtsInAngleTag).text.trim();
    
    // Strip trailing ellipsis from remaining text
    remainingText = remainingText.replace(/\.+\s*$/, '').trim();
    
    // Filter out markdown images from remaining text BEFORE bracket filtering
    // This prevents the bracket regex from corrupting the image pattern
    const remainingTextBeforeImages = remainingText;
    remainingText = remainingText.replace(/!\[[\s\S]*?\]\([\s\S]*?\)/g, '');
    remainingText = remainingText.replace(/!\[[\s\S]*?\]\([\s\S]*$/g, '');
    remainingText = remainingText.trim();
    if (remainingTextBeforeImages !== remainingText) {
        console.debug(`[VoiceForge] Filtered remaining text images`);
    }
    
    // Apply bracket filtering to remaining text
    if (extension_settings.tts.skip_brackets && remainingText.length > 0) {
        const beforeFilter = remainingText;
        remainingText = remainingText.replace(/\[[\s\S]*?\]/g, '').trim();
        
        if (beforeFilter !== remainingText) {
            console.debug(`[VoiceForge] Filtered remaining text brackets: "${beforeFilter.substring(0,40)}" -> "${remainingText.substring(0,40)}"`);
        }
    }
    
    // Apply HTML tag filtering to remaining text
    if (extension_settings.tts.skip_tags && remainingText.length > 0) {
        const beforeFilter = remainingText;
        // Remove complete HTML tags with content: <tag>content</tag>
        remainingText = remainingText.replace(/<[^>]*>[\s\S]*?<\/[^>]*>/g, '');
        // Remove self-closing tags: <tag/>
        remainingText = remainingText.replace(/<[^>]+\/>/g, '');
        // Remove standalone tags: <tag>
        remainingText = remainingText.replace(/<[^>]+>/g, '');
        // Remove incomplete opening tags at the end: <redacted
        remainingText = remainingText.replace(/<[^>]*$/g, '');
        // Remove incomplete closing tags at the start: reasoning>
        remainingText = remainingText.replace(/^[^<]*>/g, '');
        remainingText = remainingText.trim();
        
        if (beforeFilter !== remainingText) {
            console.debug(`[VoiceForge] Filtered remaining text HTML tags: "${beforeFilter.substring(0,40)}" -> "${remainingText.substring(0,40)}"`);
        }
    }

    if (remainingText.length > 0) {
        remainingText = stripControlCommandTags(remainingText);
    }

    // Filter out standalone triple backticks from remaining text
    remainingText = remainingText.replace(/```+/g, '').trim();
    
    // FINAL safety filter for remaining text
    const remainingFinalCheck = remainingText;
    remainingText = remainingText.replace(/!\[[\s\S]*?\]\([\s\S]*?\)/g, '');
    remainingText = remainingText.replace(/!\[[\s\S]*?\]\([\s\S]*$/g, '');
    remainingText = remainingText.replace(/\[.*?\]\([\s\S]*?\)/g, '');  // Catch corrupted patterns
    remainingText = remainingText.trim();
    if (remainingFinalCheck !== remainingText) {
        console.warn(`[VoiceForge] FINAL FILTER caught image in remaining text: "${remainingFinalCheck.substring(0,50)}" -> "${remainingText.substring(0,50)}"`);
    }
    
    if (remainingText.length > 0) {
        // Skip remaining text that is just ellipsis or mostly punctuation (garbage from streaming)
        const nonPunctLength = remainingText.replace(/[.!?。！？;,:，。；：、""''「」『』【】（）""＂…\-–——\s]/g, '').length;
        if (nonPunctLength < 2) {
            console.debug('[VoiceForge] Skipping garbage remaining text (mostly punctuation):', remainingText);
        } else {
            console.debug('[VoiceForge] Streaming TTS - processing remaining text:', remainingText.substring(0, 50));
            
            accumulateStreamingTtsChunk(remainingText, rawRemainingText, streamingTtsLastProcessedIndex, streamingTtsBuffer.length, true);
        }
    }
    flushStreamingTtsPendingChunk();

    // Fire TTS immediately for any final forced chunk.
    processTtsQueue();
    
    // Mark this message as processed by streaming TTS to prevent double-play
    // ALWAYS mark it if streaming was active, even if no TTS content was generated
    // This prevents the full message from being queued via onMessageEvent after streaming ends
    streamingTtsProcessedMessageId = streamingTtsMessageId;
    streamingTtsCompletedMessageId = streamingTtsMessageId;
    console.debug('[VoiceForge] Marked message', streamingTtsMessageId, 'as processed by streaming TTS');
    
    // Reset streaming state
    streamingTtsBuffer = '';
    streamingTtsLastProcessedIndex = 0;
    streamingTtsLastReceivedText = '';
    streamingTtsActive = false;
    streamingTtsMessageId = null;
    streamingTtsCharName = null;
    streamingTtsRequestId = null;
    streamingTtsSentenceCount = 0;
    streamingTtsQuoteStack = [];
    streamingTtsInAsteriskBlock = false;
    clearStreamingTtsPendingChunk();
    
    console.debug('[VoiceForge] Streaming TTS finalized');
}

/**
 * Reset streaming TTS state (called on message swipe, chat change, etc.)
 */
function resetStreamingTts() {
    streamingTtsBuffer = '';
    streamingTtsLastProcessedIndex = 0;
    streamingTtsLastReceivedText = '';
    streamingTtsActive = false;
    streamingTtsMessageId = null;
    streamingTtsCharName = null;
    streamingTtsProcessedMessageId = null;
    streamingTtsRequestId = null;
    streamingTtsSentenceCount = 0;
    streamingTtsCompletedMessageId = null;
    streamingTtsQuoteStack = [];
    streamingTtsInAsteriskBlock = false;
    clearStreamingTtsPendingChunk();
    streamingTtsInAngleTag = false;
}

async function onPeriodicMessageGenerationTick() {
    // Skip if streaming TTS is handling this message
    // This prevents both streaming TTS and periodic generation from processing the same content
    if (streamingTtsActive) {
        return;
    }
    
    const context = getContext();

    // no characters or group selected
    if (!context.groupId && context.characterId === undefined) {
        return;
    }

    const lastMessageId = context.chat.length - 1;

    // the last message was from the user
    if (context.chat[lastMessageId].is_user) {
        return;
    }

    const lastMessage = structuredClone(context.chat[lastMessageId]);
    const lastMessageText = lastMessage?.mes ?? '';

    // look for double ending lines which should indicate the end of a paragraph
    let newLastPositionOfParagraphEnd = lastMessageText
        .indexOf('\n\n', lastPositionOfParagraphEnd + 1);
    // if not found, look for a single ending line which should indicate the end of a paragraph
    if (newLastPositionOfParagraphEnd === -1) {
        newLastPositionOfParagraphEnd = lastMessageText
            .indexOf('\n', lastPositionOfParagraphEnd + 1);
    }

    // send the message to the tts module if we found the new end of a paragraph
    if (newLastPositionOfParagraphEnd > -1) {
        onMessageEvent(lastMessageId, newLastPositionOfParagraphEnd);

        if (periodicMessageGenerationTimer) {
            lastPositionOfParagraphEnd = newLastPositionOfParagraphEnd;
        }
    }
}

/**
 * Get characters in current chat
 * @param {boolean} unrestricted - If true, will include all characters in voiceMapEntries, even if they are not in the current chat.
 * @returns {string[]} - Array of character names
 */
export function getCharacters(unrestricted) {
    const context = getContext();
    console.log('[VoiceForge] getCharacters called, unrestricted:', unrestricted);
    console.log('[VoiceForge] context.groupId:', context.groupId);
    console.log('[VoiceForge] context.name1:', context.name1);
    console.log('[VoiceForge] context.name2:', context.name2);

    if (unrestricted) {
        const names = context.characters.map(char => char.name);
        names.unshift(DEFAULT_VOICE_MARKER);
        return names.filter(onlyUnique);
    }

    let characters = [];
    if (context.groupId === null) {
        // Single char chat
        characters.push(DEFAULT_VOICE_MARKER);
        characters.push(context.name2);
    } else {
        // Group chat
        characters.push(DEFAULT_VOICE_MARKER);
        const group = context.groups.find(group => context.groupId == group.id);
        for (let member of group.members) {
            const character = context.characters.find(char => char.avatar == member);
            if (character) {
                characters.push(character.name);
            }
        }
    }
    
    // Filter out empty/undefined values and duplicates
    characters = characters.filter(c => c && c.trim()).filter(onlyUnique);
    console.log('[VoiceForge] Final characters list:', characters);

    return characters;

}

export function sanitizeId(input) {
    // Remove any non-alphanumeric characters except underscore (_) and hyphen (-)
    let sanitized = encodeURIComponent(input).replace(/[^a-zA-Z0-9-_]/g, '');

    // Ensure first character is always a letter
    if (!/^[a-zA-Z]/.test(sanitized)) {
        sanitized = 'element_' + sanitized;
    }

    return sanitized;
}

function parseVoiceMap(voiceMapString) {
    let parsedVoiceMap = {};
    for (const [charName, voiceId] of voiceMapString
        .split(',')
        .map(s => s.split(':'))) {
        if (charName && voiceId) {
            parsedVoiceMap[charName.trim()] = voiceId.trim();
        }
    }
    return parsedVoiceMap;
}



/**
 * Apply voiceMap based on current voiceMapEntries
 * Now supports extended voice settings (audio_prompt, rvc_model, toggles)
 */
function updateVoiceMap() {
    const tempVoiceMap = {};
    for (const voice of voiceMapEntries) {
        // Always include Default Voice (contains server config settings)
        // For other voices, skip if disabled
        if (voice.name !== DEFAULT_VOICE_MARKER) {
            if (voice.settings.audio_prompt === null || voice.settings.audio_prompt === DISABLED_VOICE_MARKER) {
                continue;
            }
        }
        // Store extended settings object
        tempVoiceMap[voice.name] = voice.settings;
    }
    if (Object.keys(tempVoiceMap).length !== 0) {
        voiceMap = tempVoiceMap;
        console.log(`Voicemap updated to ${JSON.stringify(voiceMap)}`);
    }
    if (!extension_settings.tts[PROVIDER_NAME].voiceMap) {
        extension_settings.tts[PROVIDER_NAME].voiceMap = {};
    }
    Object.assign(extension_settings.tts[PROVIDER_NAME].voiceMap, voiceMap);
    saveSettingsDebounced();
}

/**
 * Default RVC settings for new voices
 */
const DEFAULT_RVC_SETTINGS = {
    pitch_algo: 'rmvpe+',
    pitch_level: 0,
    index_influence: 0.75,
    respiration_median_filtering: 3,
    envelope_ratio: 0.25,
    consonant_breath_protection: 0.33,
};

/**
 * Default post-processing settings for new voices
 * NOTE: Must match exactly what VoiceForge UI sends in collectTTSRequest()
 */
const DEFAULT_POST_SETTINGS = {
    // EQ
    highpass: 0,
    lowpass: 0,
    bass_freq: 100,
    bass_gain: 0,
    treble_freq: 8000,
    treble_gain: 0,
    // Reverb
    reverb_delay: 0,
    reverb_decay: 0,
    // Effects
    crystalizer: 0,
    deesser: 0,
    // Spatial Audio (8D)
    audio_8d_enabled: false,
    audio_8d_mode: 'extreme',
    audio_8d_speed: 0.08,
    audio_8d_depth: 180,  // Arc in degrees (180 = L↔R, 360 = full circle)
    audio_8d_distance: 0.3,  // 0 = in ear, 1 = far
    audio_8d_quality: 'balanced',  // fast, balanced, ultra
    audio_8d_itd: true,  // Interaural Time Difference
    audio_8d_proximity: true,  // Bass boost when close
    audio_8d_crossfeed: true,  // Natural bleed between ears
    audio_8d_micro_movements: true,  // Subtle organic variation
    audio_8d_speech_aware: true,  // Transitions at speech pauses
    // ASMR Enhancement
    asmr_enabled: false,
    asmr_tingles: 60,
    asmr_breathiness: 65,
    asmr_crispness: 55,
    asmr_warmth: 0,
    asmr_intimacy: 0,
    asmr_mouth_detail: 0,
    asmr_softness: 0,
};

/**
 * Extended VoiceMapEntry for VoiceForge
 * Supports audio_prompt, rvc_model, pipeline toggles, post-processing, and background tracks per character
 */
class VoiceMapEntry {
    name;
    settings;
    elements = {};
    bgTracks = []; // Available VF background tracks

    constructor(name, settings = null) {
        this.name = name;
        // Extended settings structure with all post-processing options
        const defaults = {
            audio_prompt: name === DEFAULT_VOICE_MARKER ? DISABLED_VOICE_MARKER : DEFAULT_VOICE_MARKER,
            pocket_tts_voice: 'alba',
            kokoro_voice: 'af_sarah',
            omnivoice_voice: 'auto',
            omnivoice_ref_text: null,
            tts_backend: null, // null = use [Default Voice] entry behavior
            rvc_model: null,
            enable_rvc: null, // null = use default
            enable_post: null,
            enable_background: null,
            // Per-voice background tracks (array of {path, volume, delay, fade_in, fade_out})
            bg_tracks: [],
            // RVC settings (null = use server defaults)
            rvc: null,
            // Post-processing settings (null = use server defaults)
            post: null,
        };
        
        // Merge with provided settings
        this.settings = { ...defaults, ...settings };
    }

    addUI(audioPrompts, rvcModels, bgTracks = []) {
        this.bgTracks = bgTracks;
        const sanitizedName = sanitizeId(this.name);
        const isDefault = this.name === DEFAULT_VOICE_MARKER;
        const s = this.settings;
        const post = s.post || DEFAULT_POST_SETTINGS;

        // Build audio prompt options (for OmniVoice)
        let promptOptions = isDefault
            ? `<option value="${DISABLED_VOICE_MARKER}">${DISABLED_VOICE_MARKER}</option>`
            : `<option value="${DEFAULT_VOICE_MARKER}">${DEFAULT_VOICE_MARKER}</option><option value="${DISABLED_VOICE_MARKER}">${DISABLED_VOICE_MARKER}</option>`;

        for (const prompt of audioPrompts) {
            promptOptions += `<option value="${prompt.name}">${prompt.name}</option>`;
        }

        // Build Pocket TTS voice options
        const pocketVoices = [
            { value: 'alba', label: 'Alba (Female)' },
            { value: 'marius', label: 'Marius (Male)' },
            { value: 'javert', label: 'Javert (Male)' },
            { value: 'jean', label: 'Jean (Male)' },
            { value: 'fantine', label: 'Fantine (Female)' },
            { value: 'cosette', label: 'Cosette (Female)' },
            { value: 'eponine', label: 'Eponine (Female)' },
            { value: 'azelma', label: 'Azelma (Female)' },
        ];
        let pocketVoiceOptions = isDefault
            ? `<option value="${DISABLED_VOICE_MARKER}">${DISABLED_VOICE_MARKER}</option>`
            : `<option value="${DEFAULT_VOICE_MARKER}">${DEFAULT_VOICE_MARKER}</option><option value="${DISABLED_VOICE_MARKER}">${DISABLED_VOICE_MARKER}</option>`;
        for (const voice of pocketVoices) {
            pocketVoiceOptions += `<option value="${voice.value}">${voice.label}</option>`;
        }

        // Build Kokoro voice options from provider
        const kokoroVoices = ttsProvider?.getKokoroVoices() || [];
        let kokoroVoiceOptions = isDefault
            ? `<option value="${DISABLED_VOICE_MARKER}">${DISABLED_VOICE_MARKER}</option>`
            : `<option value="${DEFAULT_VOICE_MARKER}">${DEFAULT_VOICE_MARKER}</option><option value="${DISABLED_VOICE_MARKER}">${DISABLED_VOICE_MARKER}</option>`;
        for (const voice of kokoroVoices) {
            const voiceName = voice.name || voice.id || voice;
            kokoroVoiceOptions += `<option value="${voiceName}">${voiceName}</option>`;
        }

        // Build RVC model options
        let rvcOptions = '<option value="">None</option>';
        for (const model of rvcModels) {
            rvcOptions += `<option value="${model}">${model}</option>`;
        }

        // Determine backend from voice map only
        const rawCharBackend = s.tts_backend || 'omnivoice';
        const charBackend = rawCharBackend;
        const isPocketTTS = charBackend === 'pocket_tts';
        const isKokoro = charBackend === 'kokoro';
        const isOmniVoice = charBackend === 'omnivoice';

        // For Default Voice, show note that it reflects server config; for others, show editable toggles
        const togglesHtml = isDefault 
            ? `<div class="voice-toggles">
                   <label title="RVC setting from server config" style="opacity: 0.7;">
                       <input type="checkbox" id="voiceforge_enable_rvc_${sanitizedName}" ${s.enable_rvc ? 'checked' : ''} disabled>
                       <span>RVC</span>
                   </label>
                   <label title="Post-FX setting from server config" style="opacity: 0.7;">
                       <input type="checkbox" id="voiceforge_enable_post_${sanitizedName}" ${s.enable_post ? 'checked' : ''} disabled>
                       <span>Post-FX</span>
                   </label>
                   <label title="Background setting from server config" style="opacity: 0.7;">
                       <input type="checkbox" id="voiceforge_enable_bg_${sanitizedName}" ${s.enable_background ? 'checked' : ''} disabled>
                       <span>Background</span>
                   </label>
               </div>
               <div class="voice-defaults-note" style="font-size: 0.85em; color: var(--SmartThemeQuoteColor); margin-top: 4px;">
                   <i class="fa-solid fa-server"></i> Loaded from VoiceForge server config
               </div>`
            : `<div class="voice-toggles">
                   <label title="Apply RVC voice conversion">
                       <input type="checkbox" id="voiceforge_enable_rvc_${sanitizedName}">
                       <span>RVC</span>
                   </label>
                   <label title="Apply post-processing effects">
                       <input type="checkbox" id="voiceforge_enable_post_${sanitizedName}">
                       <span>Post-FX</span>
                   </label>
                   <label title="Blend background audio">
                       <input type="checkbox" id="voiceforge_enable_bg_${sanitizedName}">
                       <span>Background</span>
                   </label>
               </div>`;

        // Get RVC settings
        const rvc = s.rvc || DEFAULT_RVC_SETTINGS;

        const template = `
            <div class="voiceforge-voice-entry" id="voiceforge_entry_${sanitizedName}">
                <div class="voice-header" data-target="voiceforge_content_${sanitizedName}">
                    <span class="voice-name">${this.name}</span>
                    <div class="voice-header-buttons">
                        <button class="voice-copy-btn menu_button" data-name="${sanitizedName}" title="Copy settings">
                            <i class="fa-solid fa-copy"></i>
                        </button>
                        <button class="voice-paste-btn menu_button" data-name="${sanitizedName}" title="Paste settings" ${isDefault ? 'disabled' : ''}>
                            <i class="fa-solid fa-paste"></i>
                        </button>
                        <i class="fa-solid fa-chevron-down voice-toggle-icon"></i>
                    </div>
                </div>
                <div class="voice-content" id="voiceforge_content_${sanitizedName}" style="display: none;">
                    <!-- Basic Settings -->
                    <div class="voice-section">
                        <div class="voice-settings">
                        <div class="voice-setting">
                            <label>TTS Backend:</label>
                            <select id="voiceforge_backend_${sanitizedName}" class="text_pole voiceforge-backend-select">
                                <option value="pocket_tts" ${charBackend === 'pocket_tts' ? 'selected' : ''}>Pocket TTS</option>
                                <option value="kokoro" ${charBackend === 'kokoro' ? 'selected' : ''}>Kokoro</option>
                                <option value="omnivoice" ${charBackend === 'omnivoice' ? 'selected' : ''}>OmniVoice</option>
                            </select>
                        </div>
                        <div class="voice-setting voiceforge-voice-selector">
                            <label class="voiceforge-voice-label">${isPocketTTS || isKokoro || isOmniVoice ? 'Voice:' : 'Audio Prompt:'}</label>
                            <select id="voiceforge_prompt_${sanitizedName}" class="text_pole voiceforge-prompt-select" style="${isPocketTTS || isKokoro ? 'display:none;' : ''}">
                                ${promptOptions}
                            </select>
                            <select id="voiceforge_pocket_voice_${sanitizedName}" class="text_pole voiceforge-pocket-voice-select" style="${isPocketTTS ? '' : 'display:none;'}">
                                ${pocketVoiceOptions}
                            </select>
                            <select id="voiceforge_kokoro_voice_${sanitizedName}" class="text_pole voiceforge-kokoro-voice-select" style="${isKokoro ? '' : 'display:none;'}">
                                ${kokoroVoiceOptions}
                            </select>
                        </div>
                            <div class="voice-setting">
                                <label>RVC Model:</label>
                                <select id="voiceforge_rvc_${sanitizedName}" class="text_pole">
                                    ${rvcOptions}
                                </select>
                            </div>
                        </div>
                        ${togglesHtml}
                    </div>

                    <!-- RVC Parameters Section -->
                    <div class="voice-section-collapsible">
                        <div class="section-header" data-section="rvc_${sanitizedName}">
                            <span>🎤 RVC Parameters</span>
                            <i class="fa-solid fa-chevron-right section-icon"></i>
                        </div>
                        <div class="section-content" id="section_rvc_${sanitizedName}" style="display: none;">
                            <div class="post-sliders">
                                <div class="post-slider-row">
                                    <label>Pitch Algorithm:</label>
                                    <select class="rvc-setting text_pole" data-key="pitch_algo" style="width: 140px;">
                                        <option value="pm" ${rvc.pitch_algo === 'pm' ? 'selected' : ''}>pm</option>
                                        <option value="harvest" ${rvc.pitch_algo === 'harvest' ? 'selected' : ''}>harvest</option>
                                        <option value="dio" ${rvc.pitch_algo === 'dio' ? 'selected' : ''}>dio</option>
                                        <option value="crepe" ${rvc.pitch_algo === 'crepe' ? 'selected' : ''}>crepe</option>
                                        <option value="mangio-crepe" ${rvc.pitch_algo === 'mangio-crepe' ? 'selected' : ''}>mangio-crepe</option>
                                        <option value="rmvpe" ${rvc.pitch_algo === 'rmvpe' ? 'selected' : ''}>rmvpe</option>
                                        <option value="rmvpe+" ${rvc.pitch_algo === 'rmvpe+' ? 'selected' : ''}>rmvpe+</option>
                                        <option value="mangio-crepe+" ${rvc.pitch_algo === 'mangio-crepe+' ? 'selected' : ''}>mangio-crepe+</option>
                                    </select>
                                </div>
                                <div class="post-slider-row">
                                    <label>Pitch Level:</label>
                                    <input type="range" class="rvc-setting" data-key="pitch_level" min="-24" max="24" value="${rvc.pitch_level}" step="1">
                                    <span class="slider-value">${rvc.pitch_level}</span>
                                </div>
                                <div class="post-slider-row">
                                    <label>Index Influence:</label>
                                    <input type="range" class="rvc-setting" data-key="index_influence" min="0" max="1" value="${rvc.index_influence}" step="0.01">
                                    <span class="slider-value">${rvc.index_influence}</span>
                                </div>
                                <div class="post-slider-row">
                                    <label>Respiration Filter:</label>
                                    <input type="number" class="rvc-setting text_pole" data-key="respiration_median_filtering" value="${rvc.respiration_median_filtering}" min="0" max="99" style="width: 60px;">
                                </div>
                                <div class="post-slider-row">
                                    <label>Envelope Ratio:</label>
                                    <input type="range" class="rvc-setting" data-key="envelope_ratio" min="0" max="1" value="${rvc.envelope_ratio}" step="0.01">
                                    <span class="slider-value">${rvc.envelope_ratio}</span>
                                </div>
                                <div class="post-slider-row">
                                    <label>Breath Protection:</label>
                                    <input type="range" class="rvc-setting" data-key="consonant_breath_protection" min="0" max="1" value="${rvc.consonant_breath_protection}" step="0.01">
                                    <span class="slider-value">${rvc.consonant_breath_protection}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Background Tracks Section -->
                    <div class="voice-section-collapsible">
                        <div class="section-header" data-section="bg_${sanitizedName}">
                            <span>🎵 Background Tracks</span>
                            <i class="fa-solid fa-chevron-right section-icon"></i>
                        </div>
                        <div class="section-content" id="section_bg_${sanitizedName}" style="display: none;">
                            <div class="bg-tracks-list" id="bg_tracks_${sanitizedName}">
                                <!-- Track entries populated dynamically -->
                            </div>
                            <button class="menu_button bg-add-track" data-name="${sanitizedName}" style="margin-top: 6px;">
                                <i class="fa-solid fa-plus"></i> Add Track
                            </button>
                        </div>
                    </div>

                    <!-- ASMR Section: adds missing close-mic texture to generated TTS -->
                    <div class="voice-section-collapsible">
                        <div class="section-header" data-section="asmr_${sanitizedName}">
                            <span>✨ ASMR Enhancement</span>
                            <i class="fa-solid fa-chevron-right section-icon"></i>
                        </div>
                        <div class="section-content" id="section_asmr_${sanitizedName}" style="display: none;">
                            <div style="font-size: 0.9em; color: var(--SmartThemeQuoteColor); margin-bottom: 8px; line-height: 1.35;">
                                Makes generated TTS feel more like close-mic ASMR. Start with <strong>Breath Layer</strong> and <strong>Mouth Sounds</strong>; use tone controls only if the voice needs shaping.
                            </div>
                            <label class="checkbox_label">
                                <input type="checkbox" class="post-setting" data-key="asmr_enabled" id="asmr_enabled_${sanitizedName}" ${post.asmr_enabled ? 'checked' : ''}>
                                <span>Enable TTS-to-ASMR Texture</span>
                            </label>
                            <div style="font-size: 0.86em; color: var(--SmartThemeQuoteColor); margin: 6px 0 8px 0;">
                                Adds missing generated-audio cues. This is separate from Spatial Audio, which controls left/right ear position.
                            </div>
                            <div style="font-size: 0.9em; font-weight: 600; margin: 8px 0 4px 0; color: var(--SmartThemeBodyColor);">Generated Texture</div>
                            <div class="post-sliders">
                                <div class="post-slider-row" title="Adds synthetic close-mic air/noise following the speech envelope.">
                                    <label>Breath Layer:</label>
                                    <input type="range" class="post-setting" data-key="asmr_breathiness" min="0" max="100" value="${post.asmr_breathiness ?? DEFAULT_POST_SETTINGS.asmr_breathiness}">
                                    <span class="slider-value">${post.asmr_breathiness ?? DEFAULT_POST_SETTINGS.asmr_breathiness}</span>
                                </div>
                                <div class="post-slider-row" title="Adds subtle synthetic lip/click texture based on speech transients.">
                                    <label>Mouth Sounds:</label>
                                    <input type="range" class="post-setting" data-key="asmr_mouth_detail" min="0" max="100" value="${post.asmr_mouth_detail ?? DEFAULT_POST_SETTINGS.asmr_mouth_detail}">
                                    <span class="slider-value">${post.asmr_mouth_detail ?? DEFAULT_POST_SETTINGS.asmr_mouth_detail}</span>
                                </div>
                                <div class="post-slider-row" title="Adds upper-mid tingle/presence detail. Use carefully if the voice gets sharp.">
                                    <label>Tingle Focus:</label>
                                    <input type="range" class="post-setting" data-key="asmr_tingles" min="0" max="100" value="${post.asmr_tingles ?? DEFAULT_POST_SETTINGS.asmr_tingles}">
                                    <span class="slider-value">${post.asmr_tingles ?? DEFAULT_POST_SETTINGS.asmr_tingles}</span>
                                </div>
                            </div>
                            <div style="font-size: 0.9em; font-weight: 600; margin: 10px 0 4px 0; color: var(--SmartThemeBodyColor);">Tone Shaping</div>
                            <div class="post-sliders">
                                <div class="post-slider-row" title="Brightens consonants and fine detail without changing spatial position.">
                                    <label>Crisp Presence:</label>
                                    <input type="range" class="post-setting" data-key="asmr_crispness" min="0" max="100" value="${post.asmr_crispness ?? DEFAULT_POST_SETTINGS.asmr_crispness}">
                                    <span class="slider-value">${post.asmr_crispness ?? DEFAULT_POST_SETTINGS.asmr_crispness}</span>
                                </div>
                                <div class="post-slider-row" title="Optional low-mid body for close warmth. Too much can get muddy.">
                                    <label>Close Warmth:</label>
                                    <input type="range" class="post-setting" data-key="asmr_warmth" min="0" max="100" value="${post.asmr_warmth ?? DEFAULT_POST_SETTINGS.asmr_warmth}">
                                    <span class="slider-value">${post.asmr_warmth ?? DEFAULT_POST_SETTINGS.asmr_warmth}</span>
                                </div>
                                <div class="post-slider-row" title="Optional close compression/detail lift. Leave low if the voice feels pushed back.">
                                    <label>Intimacy Lift:</label>
                                    <input type="range" class="post-setting" data-key="asmr_intimacy" min="0" max="100" value="${post.asmr_intimacy ?? DEFAULT_POST_SETTINGS.asmr_intimacy}">
                                    <span class="slider-value">${post.asmr_intimacy ?? DEFAULT_POST_SETTINGS.asmr_intimacy}</span>
                                </div>
                                <div class="post-slider-row" title="Reduces sharpness after detail boosts. High values can make TTS sound farther away.">
                                    <label>Edge Softness:</label>
                                    <input type="range" class="post-setting" data-key="asmr_softness" min="0" max="100" value="${post.asmr_softness ?? DEFAULT_POST_SETTINGS.asmr_softness}">
                                    <span class="slider-value">${post.asmr_softness ?? DEFAULT_POST_SETTINGS.asmr_softness}</span>
                                </div>
                            </div>
                            <div style="font-size: 0.85em; color: var(--SmartThemeQuoteColor); margin-top: 8px; line-height: 1.35;">
                                Quick start: Breath Layer 60-90, Mouth Sounds 15-45, Tingle Focus to taste. If it feels distant, lower Edge Softness and Intimacy Lift.
                            </div>
                        </div>
                    </div>

                    <!-- EQ Section (updated with freq controls) -->
                    <div class="voice-section-collapsible">
                        <div class="section-header" data-section="eq_${sanitizedName}">
                            <span>🎚️ EQ / Filtering</span>
                            <i class="fa-solid fa-chevron-right section-icon"></i>
                        </div>
                        <div class="section-content" id="section_eq_${sanitizedName}" style="display: none;">
                            <div class="post-sliders">
                                <div class="post-slider-row">
                                    <label>Highpass (Hz):</label>
                                    <input type="number" class="post-setting text_pole" data-key="highpass" value="${post.highpass}" min="0" max="500" style="width: 70px;">
                                </div>
                                <div class="post-slider-row">
                                    <label>Lowpass (Hz):</label>
                                    <input type="number" class="post-setting text_pole" data-key="lowpass" value="${post.lowpass}" min="0" max="20000" style="width: 70px;">
                                </div>
                                <div class="post-slider-row">
                                    <label>Bass Freq (Hz):</label>
                                    <input type="number" class="post-setting text_pole" data-key="bass_freq" value="${post.bass_freq}" min="20" max="500" style="width: 70px;">
                                </div>
                                <div class="post-slider-row">
                                    <label>Bass Gain (dB):</label>
                                    <input type="range" class="post-setting" data-key="bass_gain" min="-24" max="24" value="${post.bass_gain}" step="0.1">
                                    <span class="slider-value">${post.bass_gain}</span>
                                </div>
                                <div class="post-slider-row">
                                    <label>Treble Freq (Hz):</label>
                                    <input type="number" class="post-setting text_pole" data-key="treble_freq" value="${post.treble_freq}" min="1000" max="20000" style="width: 70px;">
                                </div>
                                <div class="post-slider-row">
                                    <label>Treble Gain (dB):</label>
                                    <input type="range" class="post-setting" data-key="treble_gain" min="-24" max="24" value="${post.treble_gain}" step="0.1">
                                    <span class="slider-value">${post.treble_gain}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Reverb Section (simplified - matches VoiceForge UI) -->
                    <div class="voice-section-collapsible">
                        <div class="section-header" data-section="reverb_${sanitizedName}">
                            <span>🏛️ Reverb</span>
                            <i class="fa-solid fa-chevron-right section-icon"></i>
                        </div>
                        <div class="section-content" id="section_reverb_${sanitizedName}" style="display: none;">
                            <div class="post-sliders">
                                <div class="post-slider-row">
                                    <label>Delay (ms):</label>
                                    <input type="number" class="post-setting text_pole" data-key="reverb_delay" value="${post.reverb_delay}" min="0" max="500" style="width: 70px;">
                                </div>
                                <div class="post-slider-row">
                                    <label>Decay:</label>
                                    <input type="range" class="post-setting" data-key="reverb_decay" min="0" max="0.9" value="${post.reverb_decay}" step="0.05">
                                    <span class="slider-value">${post.reverb_decay}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Effects Section (simplified) -->
                    <div class="voice-section-collapsible">
                        <div class="section-header" data-section="fx_${sanitizedName}">
                            <span>🎛️ Effects</span>
                            <i class="fa-solid fa-chevron-right section-icon"></i>
                        </div>
                        <div class="section-content" id="section_fx_${sanitizedName}" style="display: none;">
                            <div class="post-sliders">
                                <div class="post-slider-row">
                                    <label>Crystalizer:</label>
                                    <input type="range" class="post-setting" data-key="crystalizer" min="0" max="20" value="${post.crystalizer}" step="0.1">
                                    <span class="slider-value">${post.crystalizer}</span>
                                </div>
                                <div class="post-slider-row">
                                    <label>De-esser:</label>
                                    <input type="range" class="post-setting" data-key="deesser" min="0" max="1" value="${post.deesser}" step="0.01">
                                    <span class="slider-value">${post.deesser}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Spatial Audio Section (enhanced with new VoiceForge features) -->
                    <div class="voice-section-collapsible">
                        <div class="section-header" data-section="8d_${sanitizedName}">
                            <span>🎧 Spatial Audio</span>
                            <i class="fa-solid fa-chevron-right section-icon"></i>
                        </div>
                        <div class="section-content" id="section_8d_${sanitizedName}" style="display: none;">
                            <div style="font-size: 0.9em; color: var(--SmartThemeQuoteColor); margin-bottom: 8px; line-height: 1.35;">
                                Places the voice around the listener. For intimate ASMR, use a static ear mode and low Ear Distance; avoid fast movement unless you want an 8D effect.
                            </div>
                            <label class="checkbox_label">
                                <input type="checkbox" class="post-setting" data-key="audio_8d_enabled" ${post.audio_8d_enabled ? 'checked' : ''}>
                                <span>Enable Spatial Audio</span>
                            </label>
                            <div class="post-sliders">
                                <div class="post-slider-row" title="Static Left/Right is best for ear-whisper intimacy. Sweep/Rotate are more obvious 8D effects.">
                                    <label>Ear Position:</label>
                                    <select class="post-setting text_pole" data-key="audio_8d_mode" style="width: 160px;">
                                        <option value="center" ${post.audio_8d_mode === 'center' ? 'selected' : ''}>Center front</option>
                                        <option value="static" ${post.audio_8d_mode === 'static' ? 'selected' : ''}>Left ear whisper</option>
                                        <option value="static_right" ${post.audio_8d_mode === 'static_right' ? 'selected' : ''}>Right ear whisper</option>
                                        <option value="extreme" ${post.audio_8d_mode === 'extreme' ? 'selected' : ''}>Alternate ear zones</option>
                                        <option value="sweep" ${post.audio_8d_mode === 'sweep' ? 'selected' : ''}>Slow left-right sweep</option>
                                        <option value="rotate" ${post.audio_8d_mode === 'rotate' ? 'selected' : ''}>Full 8D rotation</option>
                                    </select>
                                </div>
                                <div class="post-slider-row" title="Ultra uses the most detailed binaural model; Fast is lighter for streaming.">
                                    <label>Binaural Quality:</label>
                                    <select class="post-setting text_pole" data-key="audio_8d_quality" style="width: 160px;">
                                        <option value="fast" ${post.audio_8d_quality === 'fast' ? 'selected' : ''}>Fast streaming</option>
                                        <option value="balanced" ${post.audio_8d_quality === 'balanced' ? 'selected' : ''}>Balanced</option>
                                        <option value="ultra" ${post.audio_8d_quality === 'ultra' ? 'selected' : ''}>Ultra ASMR</option>
                                    </select>
                                </div>
                                <div class="post-slider-row" title="Only affects moving modes. Keep low for ASMR.">
                                    <label>Movement Speed:</label>
                                    <input type="range" class="post-setting" data-key="audio_8d_speed" min="0.01" max="0.5" value="${post.audio_8d_speed}" step="0.01">
                                    <span class="slider-value">${post.audio_8d_speed}</span>
                                </div>
                                <div class="post-slider-row" title="Only affects moving modes. Smaller arcs feel less theatrical.">
                                    <label>Movement Arc:</label>
                                    <input type="range" class="post-setting" data-key="audio_8d_depth" min="0" max="360" value="${post.audio_8d_depth ?? DEFAULT_POST_SETTINGS.audio_8d_depth}" step="1">
                                    <span class="slider-value">${post.audio_8d_depth ?? DEFAULT_POST_SETTINGS.audio_8d_depth}</span>
                                </div>
                                <div class="post-slider-row" title="0 = closest to ear, 1 = farther away">
                                    <label>Ear Distance:</label>
                                    <input type="range" class="post-setting" data-key="audio_8d_distance" min="0" max="1" value="${post.audio_8d_distance ?? DEFAULT_POST_SETTINGS.audio_8d_distance}" step="0.01">
                                    <span class="slider-value">${post.audio_8d_distance ?? DEFAULT_POST_SETTINGS.audio_8d_distance}</span>
                                </div>
                            </div>
                            <div style="margin-top: 8px; font-size: 0.9em; color: var(--SmartThemeQuoteColor);">
                                <strong>Binaural Features:</strong>
                            </div>
                            <div class="spatial-features" style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px;">
                                <label class="checkbox_label" title="Interaural Time Difference - ear timing for realism">
                                    <input type="checkbox" class="post-setting" data-key="audio_8d_itd" ${post.audio_8d_itd !== false ? 'checked' : ''}>
                                    <span>🕐 ITD (timing)</span>
                                </label>
                                <label class="checkbox_label" title="Bass boost and presence when close">
                                    <input type="checkbox" class="post-setting" data-key="audio_8d_proximity" ${post.audio_8d_proximity !== false ? 'checked' : ''}>
                                    <span>👂 Proximity</span>
                                </label>
                                <label class="checkbox_label" title="Natural bleed between ears">
                                    <input type="checkbox" class="post-setting" data-key="audio_8d_crossfeed" ${post.audio_8d_crossfeed !== false ? 'checked' : ''}>
                                    <span>🔀 Crossfeed</span>
                                </label>
                                <label class="checkbox_label" title="Subtle organic variation">
                                    <input type="checkbox" class="post-setting" data-key="audio_8d_micro_movements" ${post.audio_8d_micro_movements !== false ? 'checked' : ''}>
                                    <span>🌊 Micro-moves</span>
                                </label>
                                <label class="checkbox_label" title="Transitions at natural speech pauses" style="grid-column: span 2;">
                                    <input type="checkbox" class="post-setting" data-key="audio_8d_speech_aware" ${post.audio_8d_speech_aware !== false ? 'checked' : ''}>
                                    <span>🗣️ Speech-Aware Transitions</span>
                                </label>
                            </div>
                            <div style="font-size: 0.85em; color: var(--SmartThemeQuoteColor); margin-top: 8px; line-height: 1.35;">
                                Ear-whisper starter: Left or Right ear whisper, Ultra ASMR, Ear Distance 0.00-0.20, Movement Speed low.
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        `;

        $('#tts_voicemap_block').append(template);
        
        const entryEl = $(`#voiceforge_entry_${sanitizedName}`);

        // Store element references
        this.elements = {
            entry: entryEl,
            backend: $(`#voiceforge_backend_${sanitizedName}`),
            prompt: $(`#voiceforge_prompt_${sanitizedName}`),
            pocketVoice: $(`#voiceforge_pocket_voice_${sanitizedName}`),
            kokoroVoice: $(`#voiceforge_kokoro_voice_${sanitizedName}`),
            voiceLabel: entryEl.find('.voiceforge-voice-label'),
            rvc: $(`#voiceforge_rvc_${sanitizedName}`),
            bgTracksList: $(`#bg_tracks_${sanitizedName}`),
        };

        // For non-default voices, also store toggle elements
        if (!isDefault) {
            this.elements.enableRvc = $(`#voiceforge_enable_rvc_${sanitizedName}`);
            this.elements.enablePost = $(`#voiceforge_enable_post_${sanitizedName}`);
            this.elements.enableBg = $(`#voiceforge_enable_bg_${sanitizedName}`);
        }

        // Set initial values
        this.elements.backend.val(this.settings.tts_backend || 'omnivoice');
        this.elements.prompt.val(this.settings.audio_prompt || (isDefault ? DISABLED_VOICE_MARKER : DEFAULT_VOICE_MARKER));
        this.elements.pocketVoice.val(this.settings.pocket_tts_voice || (isDefault ? DISABLED_VOICE_MARKER : 'alba'));
        this.elements.kokoroVoice.val(this.settings.kokoro_voice || (isDefault ? DISABLED_VOICE_MARKER : 'af_sarah'));
        this.elements.rvc.val(this.settings.rvc_model || '');
        
        // Update voice selector visibility based on per-character backend
        this.updateVoiceSelectorForBackend();
        
        // For Default Voice, disable dropdowns since they come from server config
        if (isDefault) {
            this.elements.backend.prop('disabled', true).css('opacity', '0.7');
            this.elements.prompt.prop('disabled', true).css('opacity', '0.7');
            this.elements.pocketVoice.prop('disabled', true).css('opacity', '0.7');
            this.elements.kokoroVoice.prop('disabled', true).css('opacity', '0.7');
            this.elements.rvc.prop('disabled', true).css('opacity', '0.7');
        }
        
        // Only set toggle values for non-default voices
        if (!isDefault) {
            this.elements.enableRvc.prop('checked', this.settings.enable_rvc !== false);
            this.elements.enablePost.prop('checked', this.settings.enable_post !== false);
            this.elements.enableBg.prop('checked', this.settings.enable_background === true);
        }

        // Bind change handlers for basic settings (only for non-default)
        if (!isDefault) {
            this.elements.backend.on('change', () => this.onBackendChange());
            this.elements.prompt.on('change', () => this.onSettingsChange());
            this.elements.pocketVoice.on('change', () => this.onSettingsChange());
            this.elements.kokoroVoice.on('change', () => this.onSettingsChange());
            this.elements.rvc.on('change', () => this.onSettingsChange());
            this.elements.enableRvc.on('change', () => this.onSettingsChange());
            this.elements.enablePost.on('change', () => this.onSettingsChange());
            this.elements.enableBg.on('change', () => this.onSettingsChange());
        }

        // Voice entry header toggle - using direct element reference
        const voiceHeader = entryEl.find('.voice-header');
        const voiceContent = entryEl.find('.voice-content');
        const voiceIcon = entryEl.find('.voice-toggle-icon');
        
        voiceHeader.css('cursor', 'pointer');
        voiceHeader.on('click', function(e) {
            // Don't toggle if clicking on buttons
            if ($(e.target).closest('.voice-copy-btn, .voice-paste-btn').length) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            voiceContent.slideToggle(200);
            voiceIcon.toggleClass('fa-chevron-down fa-chevron-up');
        });
        
        // Copy button handler
        entryEl.find('.voice-copy-btn').on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.copySettings();
        });
        
        // Paste button handler (only for non-default voices)
        if (!isDefault) {
            entryEl.find('.voice-paste-btn').on('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.pasteSettings();
            });
        }

        // Section header toggles - bind directly to each section
        entryEl.find('.section-header').each(function() {
            const header = $(this);
            const sectionId = header.data('section');
            const sectionContent = $(`#section_${sectionId}`);
            const sectionIcon = header.find('.section-icon');
            
            header.css('cursor', 'pointer');
            header.on('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                sectionContent.slideToggle(200);
                sectionIcon.toggleClass('fa-chevron-right fa-chevron-down');
            });
        });

        // Post-processing setting changes
        entryEl.find('.post-setting').on('input change', (e) => {
            const el = $(e.target);
            const key = el.data('key');
            let value;
            
            if (el.attr('type') === 'checkbox') {
                value = el.is(':checked');
            } else if (el.attr('type') === 'range' || el.attr('type') === 'number') {
                value = parseFloat(el.val());
                // Update slider value display
                el.siblings('.slider-value').text(value);
            } else {
                value = el.val();
            }
            
            this.updatePostSetting(key, value);
        });

        // RVC setting changes
        entryEl.find('.rvc-setting').on('input change', (e) => {
            const el = $(e.target);
            const key = el.data('key');
            let value;
            
            if (el.attr('type') === 'checkbox') {
                value = el.is(':checked');
            } else if (el.attr('type') === 'range' || el.attr('type') === 'number') {
                value = el.attr('type') === 'number' ? parseInt(el.val()) : parseFloat(el.val());
                // Update slider value display
                el.siblings('.slider-value').text(value);
            } else {
                value = el.val();
            }
            
            this.updateRvcSetting(key, value);
        });

        // Add track button
        entryEl.find('.bg-add-track').on('click', () => this.addBgTrack());

        // Populate background tracks
        this.renderBgTracks();
    }

    renderBgTracks() {
        const container = this.elements.bgTracksList;
        container.empty();

        const tracks = this.settings.bg_tracks || [];
        
        if (tracks.length === 0) {
            container.append('<div class="bg-track-empty" style="color: var(--SmartThemeQuoteColor); font-size: 0.85em; padding: 4px;">No tracks added</div>');
            return;
        }

        tracks.forEach((track, idx) => {
            const trackHtml = `
                <div class="bg-track-entry" data-index="${idx}">
                    <div class="bg-track-row">
                        <select class="bg-track-select text_pole" style="flex: 1;">
                            <option value="">-- Select --</option>
                            ${this.bgTracks.map(t => {
                                const path = t.path || t;
                                const name = t.name || path.split('/').pop();
                                return `<option value="${path}" ${path === track.path ? 'selected' : ''}>${name}</option>`;
                            }).join('')}
                        </select>
                        <button class="menu_button bg-track-remove" title="Remove"><i class="fa-solid fa-trash"></i></button>
                    </div>
                    <div class="bg-track-params">
                        <div class="bg-param">
                            <label>Vol:</label>
                            <input type="range" class="bg-track-volume" min="0" max="100" value="${(track.volume || 0.5) * 100}">
                            <span class="bg-vol-label">${Math.round((track.volume || 0.5) * 100)}</span>
                        </div>
                        <div class="bg-param">
                            <label>Delay:</label>
                            <input type="number" class="bg-track-delay text_pole" min="0" max="300" value="${track.delay || 0}" style="width: 50px;">
                        </div>
                        <div class="bg-param">
                            <label>Fade In:</label>
                            <input type="number" class="bg-track-fade-in text_pole" min="0" max="30" value="${track.fade_in || 2}" style="width: 50px;">
                        </div>
                        <div class="bg-param">
                            <label>Fade Out:</label>
                            <input type="number" class="bg-track-fade-out text_pole" min="0" max="30" value="${track.fade_out || 2}" style="width: 50px;">
                        </div>
                    </div>
                </div>
            `;
            container.append(trackHtml);
        });

        // Bind track event handlers
        container.find('.bg-track-select').on('change', (e) => {
            const entry = $(e.target).closest('.bg-track-entry');
            const idx = entry.data('index');
            this.settings.bg_tracks[idx].path = $(e.target).val();
            this.onSettingsChange();
        });

        container.find('.bg-track-volume').on('input', (e) => {
            const entry = $(e.target).closest('.bg-track-entry');
            const idx = entry.data('index');
            const val = parseInt($(e.target).val());
            entry.find('.bg-vol-label').text(val);
            this.settings.bg_tracks[idx].volume = val / 100;
            this.onSettingsChange();
        });

        container.find('.bg-track-delay').on('input', (e) => {
            const entry = $(e.target).closest('.bg-track-entry');
            const idx = entry.data('index');
            this.settings.bg_tracks[idx].delay = parseFloat($(e.target).val()) || 0;
            this.onSettingsChange();
        });

        container.find('.bg-track-fade-in').on('input', (e) => {
            const entry = $(e.target).closest('.bg-track-entry');
            const idx = entry.data('index');
            this.settings.bg_tracks[idx].fade_in = parseFloat($(e.target).val()) || 0;
            this.onSettingsChange();
        });

        container.find('.bg-track-fade-out').on('input', (e) => {
            const entry = $(e.target).closest('.bg-track-entry');
            const idx = entry.data('index');
            this.settings.bg_tracks[idx].fade_out = parseFloat($(e.target).val()) || 0;
            this.onSettingsChange();
        });

        container.find('.bg-track-remove').on('click', (e) => {
            const entry = $(e.target).closest('.bg-track-entry');
            const idx = entry.data('index');
            this.settings.bg_tracks.splice(idx, 1);
            this.renderBgTracks();
            this.onSettingsChange();
        });
    }

    addBgTrack() {
        if (!this.settings.bg_tracks) {
            this.settings.bg_tracks = [];
        }
        this.settings.bg_tracks.push({
            path: '',
            volume: 0.5,
            delay: 0,
            fade_in: 2,
            fade_out: 2,
        });
        this.renderBgTracks();
        this.onSettingsChange();
    }

    updatePostSetting(key, value) {
        if (!this.settings.post) {
            this.settings.post = { ...DEFAULT_POST_SETTINGS };
        }
        this.settings.post[key] = value;
        this.onSettingsChange();
    }

    updateRvcSetting(key, value) {
        if (!this.settings.rvc) {
            this.settings.rvc = { ...DEFAULT_RVC_SETTINGS };
        }
        this.settings.rvc[key] = value;
        this.onSettingsChange();
    }

    onSettingsChange() {
        // Note: This is only called for non-Default voices (Default Voice has disabled UI)
        this.settings.audio_prompt = this.elements.prompt.val();
        this.settings.pocket_tts_voice = this.elements.pocketVoice.val() || 'alba';
        this.settings.kokoro_voice = this.elements.kokoroVoice.val() || 'af_sarah';
        this.settings.omnivoice_voice = 'auto';
        this.settings.omnivoice_ref_text = (typeof this.settings.omnivoice_ref_text === 'string' && this.settings.omnivoice_ref_text.trim())
            ? this.settings.omnivoice_ref_text.trim()
            : null;
        this.settings.rvc_model = this.elements.rvc.val() || null;
        this.settings.enable_rvc = this.elements.enableRvc.is(':checked');
        this.settings.enable_post = this.elements.enablePost.is(':checked');
        this.settings.enable_background = this.elements.enableBg.is(':checked');

        updateVoiceMap();
    }

    /**
     * Handle backend dropdown change
     * Updates visibility of voice/prompt selectors and saves setting
     */
    onBackendChange() {
        this.settings.tts_backend = this.elements.backend.val();
        this.updateVoiceSelectorForBackend();
        updateVoiceMap();
    }

    /**
     * Update voice selector visibility based on this character's backend setting
     */
    updateVoiceSelectorForBackend() {
        const backend = this.settings.tts_backend || 'omnivoice';
        const isPocketTTS = backend === 'pocket_tts';
        const isKokoro = backend === 'kokoro';
        const isOmniVoice = backend === 'omnivoice';

        if (isPocketTTS) {
            this.elements.voiceLabel.text('Voice:');
            this.elements.prompt.hide();
            this.elements.pocketVoice.show();
            this.elements.kokoroVoice.hide();
        } else if (isKokoro) {
            this.elements.voiceLabel.text('Voice:');
            this.elements.prompt.hide();
            this.elements.pocketVoice.hide();
            this.elements.kokoroVoice.show();
        } else if (isOmniVoice) {
            this.elements.voiceLabel.text('Voice Prompt:');
            this.elements.prompt.show();
            this.elements.pocketVoice.hide();
            this.elements.kokoroVoice.hide();
        } else {
            this.elements.voiceLabel.text('Audio Prompt:');
            this.elements.prompt.show();
            this.elements.pocketVoice.hide();
            this.elements.kokoroVoice.hide();
        }
    }

    /**
     * Copy current voice settings to clipboard
     */
    copySettings() {
        // Deep copy the settings
        voiceSettingsClipboard = JSON.parse(JSON.stringify(this.settings));
        toastr.success(`Copied settings from "${this.name}"`, 'VoiceForge');
        console.debug('[VoiceForge] Copied settings:', voiceSettingsClipboard);
    }

    /**
     * Paste settings from clipboard to this voice
     */
    pasteSettings() {
        if (!voiceSettingsClipboard) {
            toastr.warning('No settings copied. Copy settings from another voice first.', 'VoiceForge');
            return;
        }

        // Don't allow pasting to Default Voice
        if (this.name === DEFAULT_VOICE_MARKER) {
            toastr.warning('Cannot paste settings to Default Voice (uses server config)', 'VoiceForge');
            return;
        }

        // Deep copy from clipboard
        const pasted = JSON.parse(JSON.stringify(voiceSettingsClipboard));
        
        // Apply settings (keep the name, but copy everything else)
        this.settings.audio_prompt = pasted.audio_prompt;
        this.settings.pocket_tts_voice = pasted.pocket_tts_voice || 'alba';
        this.settings.kokoro_voice = pasted.kokoro_voice || 'af_sarah';
        this.settings.omnivoice_voice = pasted.omnivoice_voice || 'auto';
        this.settings.omnivoice_ref_text = (typeof pasted.omnivoice_ref_text === 'string' && pasted.omnivoice_ref_text.trim())
            ? pasted.omnivoice_ref_text.trim()
            : null;
        this.settings.rvc_model = pasted.rvc_model;
        this.settings.enable_rvc = pasted.enable_rvc;
        this.settings.enable_post = pasted.enable_post;
        this.settings.enable_background = pasted.enable_background;
        this.settings.bg_tracks = pasted.bg_tracks || [];
        this.settings.post = pasted.post ? JSON.parse(JSON.stringify(pasted.post)) : null;

        // Update UI elements
        this.elements.prompt.val(this.settings.audio_prompt || DEFAULT_VOICE_MARKER);
        this.elements.pocketVoice.val(this.settings.pocket_tts_voice || 'alba');
        this.elements.kokoroVoice.val(this.settings.kokoro_voice || 'af_sarah');
        this.elements.rvc.val(this.settings.rvc_model || '');
        if (this.elements.enableRvc) {
            this.elements.enableRvc.prop('checked', this.settings.enable_rvc !== false);
            this.elements.enablePost.prop('checked', this.settings.enable_post !== false);
            this.elements.enableBg.prop('checked', this.settings.enable_background === true);
        }

        // Update post-processing sliders
        if (this.settings.post) {
            const sanitizedName = sanitizeId(this.name);
            const entryEl = $(`#voiceforge_entry_${sanitizedName}`);
            for (const [key, value] of Object.entries(this.settings.post)) {
                const input = entryEl.find(`.post-setting[data-key="${key}"]`);
                if (input.length) {
                    if (input.attr('type') === 'checkbox') {
                        input.prop('checked', value);
                    } else {
                        input.val(value);
                        input.siblings('.slider-value').text(value);
                    }
                }
            }
        }

        // Re-render background tracks
        this.renderBgTracks();

        // Save changes
        updateVoiceMap();
        
        toastr.success(`Pasted settings to "${this.name}"`, 'VoiceForge');
        console.debug('[VoiceForge] Pasted settings to', this.name, ':', this.settings);
    }
}

/**
 * Init voiceMapEntries for character select list.
 * If an initialization is already in progress, it returns the existing Promise instead of starting a new one.
 * @param {boolean} unrestricted - If true, will include all characters in voiceMapEntries, even if they are not in the current chat.
 * @returns {Promise} A promise that resolves when the initialization is complete.
 */
export async function initVoiceMap(unrestricted = false) {
    // Preventing parallel execution
    if (currentInitVoiceMapPromise) {
        return currentInitVoiceMapPromise;
    }

    currentInitVoiceMapPromise = (async () => {
        const initialChatId = getCurrentChatId();
        try {
            await initVoiceMapInternal(unrestricted);
        } finally {
            currentInitVoiceMapPromise = null;
        }
        const currentChatId = getCurrentChatId();

        if (initialChatId !== currentChatId) {
            // Chat changed during initialization, reinitialize
            await initVoiceMap(unrestricted);
        }
    })();

    return currentInitVoiceMapPromise;
}

/**
 * Init voiceMapEntries for character select list.
 * @param {boolean} unrestricted - If true, will include all characters in voiceMapEntries, even if they are not in the current chat.
 */
async function initVoiceMapInternal(unrestricted) {
    console.log('[VoiceForge] initVoiceMapInternal called, unrestricted:', unrestricted);
    
    // Gate initialization if not enabled or TTS Provider not ready. Prevents error popups.
    const enabled = $('#tts_enabled').is(':checked');
    console.log('[VoiceForge] TTS enabled:', enabled);
    if (!enabled) {
        console.log('[VoiceForge] TTS not enabled, skipping voice map init');
        return;
    }

    // Keep errors inside extension UI rather than toastr. Toastr errors for TTS are annoying.
    try {
        console.log('[VoiceForge] Checking TTS provider ready...');
        await ttsProvider.checkReady();
        console.log('[VoiceForge] TTS provider is ready');
    } catch (error) {
        const message = `TTS Provider not ready. ${error}`;
        console.error('[VoiceForge]', message, error);
        setTtsStatus(message, false);
        return;
    }

    // Clear existing voiceMap state
    $('#tts_voicemap_block').empty();
    voiceMapEntries = [];

    // Get characters in current chat
    const characters = getCharacters(unrestricted);
    console.log('[VoiceForge] Characters for voice map:', characters);

    // Get saved voicemap from provider settings, handling new and old representations
    let voiceMapFromSettings = {};
    if ('voiceMap' in extension_settings.tts[PROVIDER_NAME]) {
        // Handle previous representation (string format)
        if (typeof extension_settings.tts[PROVIDER_NAME].voiceMap === 'string') {
            const parsed = parseVoiceMap(extension_settings.tts[PROVIDER_NAME].voiceMap);
            // Convert old string format to new extended format
            for (const [name, voiceId] of Object.entries(parsed)) {
                voiceMapFromSettings[name] = {
                    audio_prompt: voiceId,
                    rvc_model: null,
                    enable_rvc: null,
                    enable_post: null,
                    enable_background: null,
                };
            }
        } else if (typeof extension_settings.tts[PROVIDER_NAME].voiceMap === 'object') {
            voiceMapFromSettings = extension_settings.tts[PROVIDER_NAME].voiceMap;
        }
    }

    // Get audio prompts, RVC models, and background tracks from provider
    let audioPrompts = [];
    let rvcModels = [];
    let bgTracks = [];

    try {
        if (typeof ttsProvider.getAudioPrompts === 'function') {
            audioPrompts = ttsProvider.getAudioPrompts() || [];
        } else if (typeof ttsProvider.fetchTtsVoiceObjects === 'function') {
            // Fallback: use voice objects as audio prompts
            audioPrompts = await ttsProvider.fetchTtsVoiceObjects() || [];
        }
    } catch (error) {
        console.warn('Failed to get audio prompts:', error);
    }

    try {
        if (typeof ttsProvider.getRvcModels === 'function') {
            rvcModels = ttsProvider.getRvcModels() || [];
        }
    } catch (error) {
        console.warn('Failed to get RVC models:', error);
    }

    // Fetch available background tracks from VoiceForge
    try {
        if (typeof ttsProvider.getBackgroundTracks === 'function') {
            bgTracks = await ttsProvider.getBackgroundTracks() || [];
        }
    } catch (error) {
        console.warn('Failed to get background tracks:', error);
    }

    // Get server config for Default Voice
    let serverConfig = null;
    try {
        if (typeof ttsProvider.getServerConfig === 'function') {
            serverConfig = ttsProvider.getServerConfig();
        }
    } catch (error) {
        console.warn('Failed to get server config:', error);
    }

    console.log('[VoiceForge] Building voice map UI for', characters.length, 'characters');
    console.log('[VoiceForge] Audio prompts available:', audioPrompts.length);
    console.log('[VoiceForge] RVC models available:', rvcModels.length);
    console.log('[VoiceForge] Background tracks available:', bgTracks.length);
    console.log('[VoiceForge] Server config:', serverConfig);
    
    // Build UI using VoiceMapEntry objects
    for (const character of characters) {
        console.log('[VoiceForge] Processing character:', character);
        if (character === 'SillyTavern System') {
            console.log('[VoiceForge] Skipping SillyTavern System');
            continue;
        }

        // Get saved settings for this character
        let savedSettings = null;
        
        // For Default Voice, use server config values
        if (character === DEFAULT_VOICE_MARKER && serverConfig) {
            savedSettings = buildSettingsFromServerConfig(serverConfig, bgTracks);
        } else if (character in voiceMapFromSettings) {
            const saved = voiceMapFromSettings[character];
            // Handle both old string format and new object format
            if (typeof saved === 'string') {
                savedSettings = {
                    audio_prompt: saved,
                    rvc_model: null,
                    enable_rvc: null,
                    enable_post: null,
                    enable_background: null,
                };
            } else if (typeof saved === 'object') {
                savedSettings = saved;
            }
        }

        // Create entry with saved or default settings
        const voiceMapEntry = new VoiceMapEntry(character, savedSettings);
        voiceMapEntry.addUI(audioPrompts, rvcModels, bgTracks);
        voiceMapEntries.push(voiceMapEntry);
    }
    updateVoiceMap();
}

/**
 * Build voice map settings from server config
 * Maps server config fields to VoiceMapEntry settings
 * @param {Object} cfg - Server config from /api/config
 * @param {Array} availableTracks - Available background tracks from /v1/background/list
 */
function buildSettingsFromServerConfig(cfg, availableTracks = []) {
    // Map config fields to our format
    // Audio prompt: look for OmniVoice_prompt_filename or audio_prompt_select
    let audioPrompt = null;
    if (cfg.OmniVoice_prompt_filename) {
        // Extract name without extension
        audioPrompt = cfg.OmniVoice_prompt_filename.replace(/\.[^/.]+$/, '');
    }

    // RVC model
    const rvcModel = cfg.model || cfg.model_select || null;

    // Build RVC settings
    const rvc = {
        pitch_algo: cfg.pitch_algo ?? DEFAULT_RVC_SETTINGS.pitch_algo,
        pitch_level: cfg.pitch_lvl ?? cfg.pitch_level ?? DEFAULT_RVC_SETTINGS.pitch_level,
        index_influence: cfg.index_influence ?? DEFAULT_RVC_SETTINGS.index_influence,
        respiration_median_filtering: cfg.respiration_median_filtering ?? DEFAULT_RVC_SETTINGS.respiration_median_filtering,
        envelope_ratio: cfg.envelope_ratio ?? DEFAULT_RVC_SETTINGS.envelope_ratio,
        consonant_breath_protection: cfg.consonant_breath_protection ?? DEFAULT_RVC_SETTINGS.consonant_breath_protection,
    };

    // Build bg_tracks from config, matching to available tracks by filename
    // Config uses relative paths like "sounds/rain.mp3" 
    // Server returns absolute paths like "D:\...\sounds\rain.mp3"
    const bgTracks = (cfg.bg_tracks || []).flatMap(t => {
        const configPath = t.file || t.path || '';
        // Extract just the filename for matching
        const configFilename = configPath.split(/[/\\]/).pop();
        
        // Find matching track in available tracks
        const matchedTrack = availableTracks.find(avail => {
            const availPath = avail.path || '';
            const availFilename = availPath.split(/[/\\]/).pop();
            return availFilename === configFilename;
        });

        if (!matchedTrack) {
            return [];
        }
        
        return [{
            path: matchedTrack.path,
            volume: t.volume || 0.5,
            delay: t.delay || 0,
            fade_in: t.fade_in || 2,
            fade_out: t.fade_out || 2,
        }];
    });

    // Build post-processing settings (updated to match VoiceForge UI)
    const post = {
        // EQ
        highpass: cfg.highpass ?? DEFAULT_POST_SETTINGS.highpass,
        lowpass: cfg.lowpass ?? DEFAULT_POST_SETTINGS.lowpass,
        bass_freq: cfg.bass_freq ?? DEFAULT_POST_SETTINGS.bass_freq,
        bass_gain: cfg.bass_gain ?? DEFAULT_POST_SETTINGS.bass_gain,
        treble_freq: cfg.treble_freq ?? DEFAULT_POST_SETTINGS.treble_freq,
        treble_gain: cfg.treble_gain ?? DEFAULT_POST_SETTINGS.treble_gain,
        // Reverb (simplified - auto-enabled when values > 0)
        reverb_delay: cfg.reverb_delay ?? DEFAULT_POST_SETTINGS.reverb_delay,
        reverb_decay: cfg.reverb_decay ?? DEFAULT_POST_SETTINGS.reverb_decay,
        // Effects (simplified)
        crystalizer: cfg.crystalizer ?? DEFAULT_POST_SETTINGS.crystalizer,
        deesser: cfg.deesser ?? DEFAULT_POST_SETTINGS.deesser,
        // ASMR (simplified - only tingles, breathiness, crispness)
        asmr_enabled: cfg.asmr_enabled ?? DEFAULT_POST_SETTINGS.asmr_enabled,
        asmr_tingles: cfg.asmr_tingles ?? DEFAULT_POST_SETTINGS.asmr_tingles,
        asmr_breathiness: cfg.asmr_breathiness ?? DEFAULT_POST_SETTINGS.asmr_breathiness,
        asmr_crispness: cfg.asmr_crispness ?? DEFAULT_POST_SETTINGS.asmr_crispness,
        asmr_warmth: cfg.asmr_warmth ?? DEFAULT_POST_SETTINGS.asmr_warmth,
        asmr_intimacy: cfg.asmr_intimacy ?? DEFAULT_POST_SETTINGS.asmr_intimacy,
        asmr_mouth_detail: cfg.asmr_mouth_detail ?? DEFAULT_POST_SETTINGS.asmr_mouth_detail,
        asmr_softness: cfg.asmr_softness ?? DEFAULT_POST_SETTINGS.asmr_softness,
        // Spatial Audio (enhanced with new VoiceForge features)
        audio_8d_enabled: cfg.audio_8d_enabled ?? DEFAULT_POST_SETTINGS.audio_8d_enabled,
        audio_8d_mode: cfg.audio_8d_mode ?? DEFAULT_POST_SETTINGS.audio_8d_mode,
        audio_8d_speed: cfg.audio_8d_speed ?? DEFAULT_POST_SETTINGS.audio_8d_speed,
        audio_8d_depth: cfg.audio_8d_depth ?? DEFAULT_POST_SETTINGS.audio_8d_depth,
        audio_8d_distance: cfg.audio_8d_distance ?? DEFAULT_POST_SETTINGS.audio_8d_distance,
        audio_8d_quality: cfg.audio_8d_quality ?? DEFAULT_POST_SETTINGS.audio_8d_quality,
        audio_8d_itd: cfg.audio_8d_itd ?? DEFAULT_POST_SETTINGS.audio_8d_itd,
        audio_8d_proximity: cfg.audio_8d_proximity ?? DEFAULT_POST_SETTINGS.audio_8d_proximity,
        audio_8d_crossfeed: cfg.audio_8d_crossfeed ?? DEFAULT_POST_SETTINGS.audio_8d_crossfeed,
        audio_8d_micro_movements: cfg.audio_8d_micro_movements ?? DEFAULT_POST_SETTINGS.audio_8d_micro_movements,
        audio_8d_speech_aware: cfg.audio_8d_speech_aware ?? DEFAULT_POST_SETTINGS.audio_8d_speech_aware,
    };

    return {
        audio_prompt: audioPrompt,
        pocket_tts_voice: cfg.pocket_tts_voice || cfg.pocket_tts_voice_select || 'alba',
        kokoro_voice: cfg.kokoro_voice || 'af_sarah',
        omnivoice_voice: cfg.omnivoice_voice || 'auto',
        omnivoice_ref_text: cfg.omnivoice_ref_text || null,
        tts_backend: cfg.tts_backend || cfg.tts_backend_select || 'omnivoice',
        rvc_model: rvcModel,
        enable_rvc: cfg.enable_rvc ?? true,
        enable_post: cfg.enable_post ?? true,
        enable_background: cfg.enable_background ?? false,
        bg_tracks: bgTracks,
        rvc: rvc,
        post: post,
    };
}

jQuery(async function () {
    async function addExtensionControls() {
        const settingsHtml = $(await renderExtensionTemplateAsync('third-party/Extension-Embody/voiceforge', 'settings'));
        const embodyPanel = $('#embody-voiceforge-panel');
        let mountedInEmbody = false;
        if (embodyPanel.length) {
            embodyPanel.empty().append(settingsHtml);
            mountedInEmbody = true;
        } else {
            const topbarDrawer = $(
                '<div id="voiceforge-connect-button" class="drawer">'
              + '  <div class="drawer-toggle drawer-header">'
              + '    <div class="drawer-icon fa-solid fa-phone fa-fw closedIcon" title="VoiceForge"></div>'
              + '  </div>'
              + '  <div class="drawer-content closedDrawer"></div>'
              + '</div>'
            );
            topbarDrawer.find('.drawer-content').append(settingsHtml);
            $('#extensions-settings-button').after(topbarDrawer);
            bindTopbarDrawerClickHandler();
        }
        $('#tts_enabled').on('change', onEnableClick);
        $('#tts_narrate_dialogues').on('change', onNarrateDialoguesClick);
        $('#tts_narrate_quoted').on('change', onNarrateQuotedClick);
        $('#tts_skip_codeblocks').on('change', onSkipCodeblocksClick);
        $('#tts_skip_tags').on('change', onSkipTagsClick);
        $('#tts_skip_brackets').on('change', onSkipBracketsClick);
        $('#tts_auto_generation').on('change', onAutoGenerationClick);
        $('#tts_non_call_enabled').on('change', onNonCallTtsEnabledClick);
        $('#tts_generation_metadata_prefix').on('change', onGenerationMetadataPrefixClick);

        $('#playback_rate').on('input', function () {
            const value = $(this).val();
            const formattedValue = Number(value).toFixed(2);
            extension_settings.tts.playback_rate = value;
            $('#playback_rate_counter').val(formattedValue);
            saveSettingsDebounced();
        });

        $(document).on('click', '.mes_narrate', onNarrateOneMessage);
        
        // Voice map entry toggle handlers (event delegation for dynamically created entries)
        $('#tts_voicemap_block').on('click', '.voice-header', function(e) {
            e.preventDefault();
            const entry = $(this).closest('.voiceforge-voice-entry');
            const content = entry.find('.voice-content');
            const icon = $(this).find('.voice-toggle-icon');
            content.slideToggle(200);
            icon.toggleClass('fa-chevron-down fa-chevron-up');
        });
        
        $('#tts_voicemap_block').on('click', '.section-header', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const sectionId = $(this).data('section');
            const content = $(`#section_${sectionId}`);
            const icon = $(this).find('.section-icon');
            content.slideToggle(200);
            icon.toggleClass('fa-chevron-right fa-chevron-down');
        });
        
        // Playback bar toggle
        $('#tts_playback_bar').prop('checked', extension_settings.tts.show_playback_bar !== false);
        $('#tts_playback_bar').on('change', function() {
            extension_settings.tts.show_playback_bar = $(this).is(':checked');
            saveSettingsDebounced();
        });
        
        // Provider Settings section toggle
        $('#tts_provider_header').on('click', function() {
            const content = $('#tts_provider_content');
            const icon = $('#tts_provider_toggle_icon');
            
            if (content.is(':visible')) {
                content.slideUp(200);
                icon.removeClass('fa-chevron-up').addClass('fa-chevron-down');
            } else {
                content.slideDown(200);
                icon.removeClass('fa-chevron-down').addClass('fa-chevron-up');
            }
        });
        
        // Voice Map section toggle
        $('#tts_voicemap_header').on('click', function() {
            const content = $('#tts_voicemap_content');
            const icon = $('#tts_voicemap_toggle_icon');
            
            if (content.is(':visible')) {
                content.slideUp(200);
                icon.removeClass('fa-chevron-up').addClass('fa-chevron-down');
            } else {
                content.slideDown(200);
                icon.removeClass('fa-chevron-down').addClass('fa-chevron-up');
            }
        });
        
        // Initialize Dynamic Audio UI controls
        initAudioControls();
    }
    
    /**
     * Initialize audio controls (BGM, Ambient, VoiceForge background)
     */
    function initAudioControls() {
        const audioManager = getAudioManager();
        if (!audioManager) return;
        
        const settings = audioManager.getSettings();
        
        // Audio section toggle
        $('#audio_section_header').on('click', function() {
            const content = $('#audio_section_content');
            const icon = $('#audio_toggle_icon');
            
            if (content.is(':visible')) {
                content.slideUp(200);
                icon.removeClass('fa-chevron-up').addClass('fa-chevron-down');
            } else {
                content.slideDown(200);
                icon.removeClass('fa-chevron-down').addClass('fa-chevron-up');
            }
        });
        
        // Audio enabled checkbox
        $('#audio_enabled').prop('checked', settings.audio_enabled);
        $('#audio_enabled').on('change', function() {
            audioManager.setEnabled($(this).is(':checked'));
        });
        
        // Dynamic BGM checkbox
        $('#audio_dynamic_bgm_enabled').prop('checked', settings.bgm_dynamic_enabled);
        $('#audio_dynamic_bgm_enabled').on('change', function() {
            const s = audioManager.getSettings();
            s.bgm_dynamic_enabled = $(this).is(':checked');
            saveSettingsDebounced();
        });
        
        // BGM volume
        $('#audio_bgm_volume_slider').val(settings.bgm_volume);
        $('#audio_bgm_volume').text(settings.bgm_volume);
        $('#audio_bgm_volume_slider').on('input', function() {
            const vol = parseInt($(this).val());
            $('#audio_bgm_volume').text(vol);
            audioManager.setBGMVolume(vol);
        });
        
        // BGM mute
        updateMuteIcon('#audio_bgm_mute_icon', settings.bgm_muted);
        $('#audio_bgm_mute').toggleClass('redOverlayGlow', settings.bgm_muted);
        $('#audio_bgm_mute').on('click', function() {
            const s = audioManager.getSettings();
            audioManager.setBGMMuted(!s.bgm_muted);
            updateMuteIcon('#audio_bgm_mute_icon', s.bgm_muted);
            $(this).toggleClass('redOverlayGlow', s.bgm_muted);
        });
        
        // BGM lock/loop
        $('#audio_bgm_lock').toggleClass('redOverlayGlow', settings.bgm_locked);
        $('#audio_bgm_lock').on('click', function() {
            const s = audioManager.getSettings();
            audioManager.setBGMLocked(!s.bgm_locked);
            $(this).toggleClass('redOverlayGlow', s.bgm_locked);
        });
        
        // BGM random
        $('#audio_bgm_random').on('click', function() {
            const select = document.getElementById('audio_bgm_select');
            const options = select.getElementsByTagName('option');
            if (options.length < 2) return;
            
            let index;
            do {
                index = Math.floor(Math.random() * options.length);
            } while (index === select.selectedIndex);
            
            select.selectedIndex = index;
            const s = audioManager.getSettings();
            s.bgm_selected = $(select).val();
            audioManager.updateBGM(true);
            saveSettingsDebounced();
        });
        
        // BGM select
        $('#audio_bgm_select').on('change', function() {
            const s = audioManager.getSettings();
            s.bgm_selected = $(this).val();
            audioManager.updateBGM(true);
            saveSettingsDebounced();
        });
        
        // Ambient volume
        $('#audio_ambient_volume_slider').val(settings.ambient_volume);
        $('#audio_ambient_volume').text(settings.ambient_volume);
        $('#audio_ambient_volume_slider').on('input', function() {
            const vol = parseInt($(this).val());
            $('#audio_ambient_volume').text(vol);
            audioManager.setAmbientVolume(vol);
        });
        
        // Ambient mute
        updateMuteIcon('#audio_ambient_mute_icon', settings.ambient_muted);
        $('#audio_ambient_mute').toggleClass('redOverlayGlow', settings.ambient_muted);
        $('#audio_ambient_mute').on('click', function() {
            const s = audioManager.getSettings();
            audioManager.setAmbientMuted(!s.ambient_muted);
            updateMuteIcon('#audio_ambient_mute_icon', s.ambient_muted);
            $(this).toggleClass('redOverlayGlow', s.ambient_muted);
        });
        
        // Ambient lock
        updateLockIcon('#audio_ambient_lock_icon', settings.ambient_locked);
        $('#audio_ambient_lock').toggleClass('redOverlayGlow', settings.ambient_locked);
        $('#audio_ambient_lock').on('click', function() {
            const s = audioManager.getSettings();
            s.ambient_locked = !s.ambient_locked;
            updateLockIcon('#audio_ambient_lock_icon', s.ambient_locked);
            $(this).toggleClass('redOverlayGlow', s.ambient_locked);
            saveSettingsDebounced();
        });
        
        // Ambient select
        $('#audio_ambient_select').on('change', function() {
            const s = audioManager.getSettings();
            s.ambient_selected = $(this).val();
            audioManager.updateAmbient(true);
            saveSettingsDebounced();
        });
        
        // VoiceForge background enabled
        $('#audio_voiceforge_bg_enabled').prop('checked', settings.voiceforge_bg_enabled !== false);
        $('#audio_voiceforge_bg_enabled').on('change', function() {
            const s = audioManager.getSettings();
            s.voiceforge_bg_enabled = $(this).is(':checked');
            saveSettingsDebounced();
        });
        
        // VoiceForge background volume
        $('#audio_voiceforge_bg_volume_slider').val(settings.voiceforge_bg_volume);
        $('#audio_voiceforge_bg_volume').text(settings.voiceforge_bg_volume);
        $('#audio_voiceforge_bg_volume_slider').on('input', function() {
            const vol = parseInt($(this).val());
            $('#audio_voiceforge_bg_volume').text(vol);
            audioManager.setVoiceForgeBgVolume(vol);
        });
        
        // VoiceForge background persist
        $('#audio_voiceforge_bg_persist').prop('checked', settings.voiceforge_bg_persist !== false);
        $('#audio_voiceforge_bg_persist').on('change', function() {
            const s = audioManager.getSettings();
            s.voiceforge_bg_persist = $(this).is(':checked');
            saveSettingsDebounced();
        });
        
        // VoiceForge background stop button
        $('#audio_voiceforge_bg_stop').on('click', async function() {
            await audioManager.stopVoiceForgeBackground(0.5, true);  // Force stop
            toastr.info('Background audio stopped', 'VoiceForge');
        });
        
        // BGM cooldown
        $('#audio_bgm_cooldown').val(settings.bgm_cooldown);
        $('#audio_bgm_cooldown').on('input', function() {
            const s = audioManager.getSettings();
            s.bgm_cooldown = parseInt($(this).val()) || 30;
            saveSettingsDebounced();
        });
        
        // Refresh assets
        $('#audio_refresh_assets').on('click', async function() {
            await audioManager.refreshAssets();
            await audioManager.update(); // Reload assets
            await populateAudioSelects();
        });
        
        // Listen for assets ready event from audio module
        document.addEventListener('voiceforge-assets-ready', () => {
            console.debug('[VoiceForge] Assets ready event received, populating selects...');
            populateAudioSelects();
        });
        
        setTimeout(populateAudioSelects, 2000);
    }
    
    function updateMuteIcon(selector, muted) {
        if (muted) {
            $(selector).removeClass('fa-volume-high').addClass('fa-volume-mute');
        } else {
            $(selector).removeClass('fa-volume-mute').addClass('fa-volume-high');
        }
    }
    
    function updateLockIcon(selector, locked) {
        if (locked) {
            $(selector).removeClass('fa-lock-open').addClass('fa-lock');
        } else {
            $(selector).removeClass('fa-lock').addClass('fa-lock-open');
        }
    }
    
    async function populateAudioSelects() {
        const audioManager = getAudioManager();
        if (!audioManager) return;
        
        const settings = audioManager.getSettings();
        
        // Populate BGM select
        const bgmOptions = audioManager.getBGMOptions();
        const bgmSelect = $('#audio_bgm_select');
        bgmSelect.empty().append('<option value="">-- Select BGM --</option>');
        for (const opt of bgmOptions) {
            bgmSelect.append($('<option>').val(opt.value).text(opt.label));
        }
        if (settings.bgm_selected) {
            bgmSelect.val(settings.bgm_selected);
        }
        
        // Populate Ambient select
        const ambientOptions = audioManager.getAmbientOptions();
        const ambientSelect = $('#audio_ambient_select');
        ambientSelect.empty().append('<option value="">-- Select Ambient --</option>');
        for (const opt of ambientOptions) {
            ambientSelect.append($('<option>').val(opt.value).text(opt.label));
        }
        if (settings.ambient_selected) {
            ambientSelect.val(settings.ambient_selected);
        }
    }
    
    await addExtensionControls(); // No init dependencies
    loadSettings(); // Depends on Extension Controls and loadTtsProvider
    cleanupPersistedMetadataPrefixLeak();
    audioElement.volume = getPersistedTtsVolumePercent() / 100;
    await initAudioModule(); // Initialize unified audio system
    await loadTtsProvider(); // Load TTS provider and init voice map
    addAudioControl(); // Depends on Extension Controls
    
    // Initialize call mode (includes real-time voice conversation + push-to-talk STT)
    // Speech recognition functionality consolidated into call-mode.js
    initCallMode();
    
    // Listen for volume change events from call mode
    document.addEventListener('voiceforge-tts-volume-change', (e) => {
        const vol = e.detail?.volume ?? 100;
        // Update Web Audio gain for streaming TTS
        if (webAudioGainNode) {
            webAudioGainNode.gain.value = vol / 100;
        }
        // Update audio element volume for non-streaming TTS
        if (audioElement) {
            audioElement.volume = vol / 100;
        }
    });
    
    setInterval(wrapper.update.bind(wrapper), UPDATE_INTERVAL); // Init depends on all the things
    eventSource.on(event_types.MESSAGE_SWIPED, () => { resetTtsPlaybackKeepBackground(); resetStreamingTts(); });
    eventSource.on(event_types.CHAT_CHANGED, () => { onChatChanged(); resetStreamingTts(); });
    eventSource.on(event_types.MESSAGE_DELETED, onMessageDeleted);
    eventSource.on(event_types.GROUP_UPDATED, onChatChanged);
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.on('voiceforge_tts_interrupt_requested', onVoiceforgeInterruptRequested);
    
    // Stream token handler for real-time TTS during LLM streaming
    eventSource.on(event_types.STREAM_TOKEN_RECEIVED, onStreamTokenReceived);
    
    eventSource.makeLast(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => onMessageEvent(messageId));
    eventSource.makeLast(event_types.USER_MESSAGE_RENDERED, (messageId) => onMessageEvent(messageId));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'speak',
        callback: async (args, value) => {
            await onNarrateText(args, value);
            return '';
        },
        aliases: ['narrate', 'tts'],
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'voice',
                description: 'character voice name',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
                enumProvider: () => Object.keys(voiceMap).map(voiceName => new SlashCommandEnumValue(voiceName, null, enumTypes.enum, enumIcons.voice)),
            }),
        ],
        unnamedArgumentList: [
            new SlashCommandArgument(
                'text', [ARGUMENT_TYPE.STRING], true,
            ),
        ],
        helpString: `
            <div>
                Narrate any text using currently selected character's voice.
            </div>
            <div>
                Use <code>voice="Character Name"</code> argument to set other voice from the voice map.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li>
                        <pre><code>/speak voice="Donald Duck" Quack!</code></pre>
                    </li>
                </ul>
            </div>
        `,
    }));
    
    // Add /stoptts command to stop TTS playback
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'stoptts',
        callback: () => {
            resetTtsPlayback();
            toastr.info('TTS playback stopped', 'VoiceForge');
            return '';
        },
        aliases: ['stoptalking', 'ttsstop'],
        helpString: `
            <div>
                Stop all TTS playback immediately.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li><pre><code>/stoptts</code></pre></li>
                </ul>
            </div>
        `,
    }));

    document.body.appendChild(audioElement);
});
