// ==========================================
// EMBODY - Combined Extension Module
// ==========================================

// ==========================================
// Imports (deduplicated from all sub-modules)
// ==========================================
import { cancelTtsPlay, chat as globalChat, eventSource, event_types, extension_prompt_roles, extension_prompt_types, generateRaw, getCharacters as getSillyTavernCharacters, getCurrentChatId, getExtensionPromptByName, getRequestHeaders, isStreamingEnabled, name2, saveChatDebounced, saveSettings, saveSettingsDebounced, sendSystemMessage, setExtensionPrompt, substituteParams, system_message_types, updateMessageBlock } from '../../../../script.js';
import { debounce_timeout } from '../../../constants.js';
import { ModuleWorkerWrapper, extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { POPUP_TYPE, callGenericPopup } from '../../../popup.js';
import { power_user } from '../../../power-user.js';
import { registerSlashCommand } from '../../../slash-commands.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { enumIcons } from '../../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { SlashCommandEnumValue, enumTypes } from '../../../slash-commands/SlashCommandEnumValue.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { delay, escapeRegex, getBase64Async, getStringHash, onlyUnique } from '../../../utils.js';
import { createNewWorldInfo, loadWorldInfo, onWorldInfoChange, saveWorldInfo, updateWorldInfoList } from '../../../world-info.js';
import { buildVoiceforgeMetadataPrefixForGeneration, endCall, getCallState, initCallMode, isCallActive, isCallMuted, startCall, toggleCall, toggleCallMute } from './callmode/call-mode.js';
import { PlayModeLoader } from './intiface/_loader.js';
import { parseDeviceCommands, setParserName } from './intiface/command_parser.js';
import { connect as connectDevices, disconnect as disconnectDevices, getActiveChannels, getButtplug, getConnectedDevices, getDeviceChannel, getDeviceDisplayName, getDeviceMotorCount, getDeviceType, getDevicesOnChannel, initConnectedDevices, isClientConnected, onDeviceChange, rescan as rescanDevices, setConnectedDevices, setDeviceChannel, stopAllDevices } from './intiface/connected_devices.js';
import { applyIntensityScale, executeCommand, executeGradientPattern, executePattern, executeTeaseAndDenialMode, executeWaveformPattern, generateWaveformValues, getActivePatterns, initDeviceExecution, stopAllDeviceActions, stopDevicePattern } from './intiface/device_execution.js';
import { initDynamicCommands } from './intiface/dynamic_commands.js';
import { applyMediaPlayerAppearance, createChatSidebarPanel, hideChatMediaPanel, initMediaModule, initMediaPlayer, loadChatMediaFile, loadFunscript, loadMediaPlayerAppearance, mediaPlayer, processFunscript, refreshMenuMediaList, saveMediaPlayerAppearance, setupChatPanelEventHandlers, setupChatVideoEventListeners, showChatMediaPanel, startFunscriptSync, startInternalProxy, stopFunscriptSync, stopInternalProxy, stopMediaPlayback, updateChatFunscriptUI, updateMediaPlayerStatus } from './intiface/media_playback.js';
import { initModeBuilder } from './intiface/mode_builder.js';
import { clearWorkerTimeout, initTimerWorker, setWorkerInterval, setWorkerTimeout } from './intiface/shared_timers.js';
import { addTimelineBlock, attachLaneClickHandlers, clearTimeline, convertTimelineToFunscripts, formatDurationShort, formatTimelineTime, getChannelMotorCount, getContentDuration, getPatternDefaults, getPatternDuration, getTimelineBlocks, getTimelineCurrentPosition, getTimelineDuration, initTimelineModule, isTimelinePlaying, pauseTimeline, playTimeline, removeTimelineBlock, renderTimeline, resumeTimeline, scrubTimeline, selectPatternForTimeline, setupTimelineEventHandlers, stopTimeline, updateMotorLanes } from './intiface/timeline_sequencer.js';
import { getPollingRate, initSync, pauseSync, resumeSync, setPollingRate, startSync, stopAllSync, stopSync } from './intiface/universal_funscript_sync.js';
import { getAudioManager, initAudioModule } from './voiceforge/audio.js';
import { VoiceForgeProvider } from './voiceforge/voiceforge.js';
import { DEBUG_PREFIX, DEFAULT_LIGHT_COLOR, DEFAULT_LIGHT_INTENSITY, MODULE_NAME, VRM_CANVAS_ID } from './vrm/constants.js';
import './vrm/controls.js';
import { animations_files, applyModelZIndex, loadBlendShapeMappingUi, models_files, onAnimationCacheClick, onAnimationMappingChange, onAutoSendHitboxMessageClick, onBlendShapeAddClick, onBlinkClick, onCharacterChange, onCharacterMapCopyClick, onCharacterMapPasteClick, onCharacterRefreshClick, onCharacterRemoveClick, onEnabledClick, onFollowCameraClick, onFollowCursorClick, onHitboxCallmodeDelayChange, onHitboxCallmodeWaitTtsStartChange, onHitboxesClick, onLightChange, onLightColorResetClick, onLightIntensityResetClick, onLockModelsClick, onModelCacheClick, onModelChange, onModelPositionChange, onModelRefreshClick, onModelResetClick, onModelRotationChange, onModelScaleChange, onModelZIndexChange, onNaturalIdleClick, onSequenceClearClick, onSequencePlayClick, onShowGridClick, onTtsLipsSyncClick, updateCharactersList, updateCharactersListOnce, updateCharactersModels } from './vrm/ui.js';
import { currentChatMembers } from './vrm/utils.js';
import { clearAnimationSequence, getVRM, loadAllModels, loadScene, setBackground, setCursorTracking, setExpression, setLight, setModel, setMotion, setMotionSequence, setPhonePropVisible, talk, updateExpression, updateModel } from './vrm/vrm.js';

// ==========================================
// UI Shell
// ==========================================

const EMBODY_FOLDER = 'scripts/extensions/third-party/Extension-Embody';

function bindTopbarDrawerClickHandler() {
    try {
        const extensionsToggle = document.querySelector('#extensions-settings-button .drawer-toggle');
        if (!extensionsToggle) return;
        const events = $._data(extensionsToggle, 'events');
        if (!events?.click?.[0]?.handler) return;
        const drawerToggle = $('#embody-settings-button .drawer-toggle');
        drawerToggle.off('click.embodyDrawer');
        drawerToggle.on('click.embodyDrawer', events.click[0].handler);
    } catch (error) {
        console.warn('[Embody] Failed to bind drawer handler', error);
    }
}

function addSharedUi() {
    $('#embody-settings-button').remove();
    const drawer = $(
        '<div id="embody-settings-button" class="drawer">' +
        '  <div class="drawer-toggle drawer-header">' +
        '    <div class="drawer-icon fa-solid fa-user-astronaut fa-fw closedIcon" title="Embody"></div>' +
        '  </div>' +
        '  <div class="drawer-content closedDrawer">' +
        '    <div id="embody_settings" class="embody-settings-root">' +
        '      <div class="embody-header">' +
        '        <div>' +
        '          <h3 class="margin0">Embody</h3>' +
        '          <small class="text_muted">VoiceForge, Call Mode, Intiface, and VRM</small>' +
        '        </div>' +
        '      </div>' +
        '      <div class="embody-tabs">' +
        '        <button class="menu_button embody-tab active" data-embody-tab="voiceforge">VoiceForge</button>' +
        '        <button class="menu_button embody-tab" data-embody-tab="callmode">Call Mode</button>' +
        '        <button class="menu_button embody-tab" data-embody-tab="audio">Audio</button>' +
        '        <button class="menu_button embody-tab" data-embody-tab="environment">Environment</button>' +
        '        <button class="menu_button embody-tab" data-embody-tab="intiface">Intiface</button>' +
        '        <button class="menu_button embody-tab" data-embody-tab="vrm">VRM</button>' +
        '      </div>' +
        '      <div class="embody-panel active" id="embody-voiceforge-panel"></div>' +
        '      <div class="embody-panel" id="embody-callmode-panel"></div>' +
        '      <div class="embody-panel" id="embody-audio-panel"></div>' +
        '      <div class="embody-panel" id="embody-environment-panel"></div>' +
        '      <div class="embody-panel" id="embody-intiface-panel"></div>' +
        '      <div class="embody-panel" id="embody-vrm-panel"></div>' +
        '    </div>' +
        '  </div>' +
        '</div>'
    );
    $('#extensions-settings-button').after(drawer);
    bindTopbarDrawerClickHandler();
    drawer.on('click', '.embody-tab', function () {
        const tab = String($(this).data('embody-tab') || 'voiceforge');
        drawer.find('.embody-tab').removeClass('active');
        $(this).addClass('active');
        drawer.find('.embody-panel').removeClass('active');
        drawer.find('#embody-' + tab + '-panel').addClass('active');
    });
}

// ==========================================
// EXTENSION INITIALIZATION
// ==========================================
addSharedUi();
globalThis.EMBODY_EXTENSION_FOLDER = EMBODY_FOLDER;

// ==========================================
// VOICEFORGE MODULE
// ==========================================
{
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
let streamingTtsInReasoningBlock = false; // Tracks open reasoning delimiters across streamed chunks
let streamingTtsReasoningCarry = ''; // Holds possible partial reasoning delimiters between streamed chunks
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

function getPreviewString(lang) {
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

    // Keep full voice list visible after /speak
    await initVoiceMap(true);
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

    return true;
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

function getActiveReasoningDelimiters() {
    const contextPowerUser = getContext()?.powerUserSettings || {};
    const contextReasoning = contextPowerUser.reasoning || {};
    const fallbackReasoning = power_user?.reasoning || {};
    const prefix = String(contextReasoning.prefix ?? fallbackReasoning.prefix ?? '').trim();
    const suffix = String(contextReasoning.suffix ?? fallbackReasoning.suffix ?? '').trim();
    return { prefix, suffix };
}

function stripReasoningBlocks(text, initialInReasoning = false) {
    const source = String(text || '');
    const { prefix, suffix } = getActiveReasoningDelimiters();

    if (!source || !prefix || !suffix || prefix === suffix) {
        return { text: source, inReasoning: !!initialInReasoning };
    }

    let inReasoning = !!initialInReasoning;
    let cursor = 0;
    let output = '';

    while (cursor < source.length) {
        if (inReasoning) {
            const closeIndex = source.indexOf(suffix, cursor);
            if (closeIndex === -1) {
                return { text: output, inReasoning: true };
            }
            cursor = closeIndex + suffix.length;
            inReasoning = false;
            continue;
        }

        const openIndex = source.indexOf(prefix, cursor);
        if (openIndex === -1) {
            output += source.slice(cursor);
            break;
        }

        output += source.slice(cursor, openIndex);
        cursor = openIndex + prefix.length;
        inReasoning = true;
    }

    return { text: output, inReasoning };
}

function getTrailingDelimiterFragmentLength(text, delimiter) {
    const source = String(text || '');
    const marker = String(delimiter || '');
    if (!source || !marker) {
        return 0;
    }

    const maxLen = Math.min(source.length, marker.length - 1);
    for (let len = maxLen; len > 0; len--) {
        if (source.endsWith(marker.slice(0, len))) {
            return len;
        }
    }
    return 0;
}

function stripReasoningBlocksStreaming(text, inReasoning = false, carry = '') {
    const source = `${String(carry || '')}${String(text || '')}`;
    const { prefix, suffix } = getActiveReasoningDelimiters();

    if (!source || !prefix || !suffix || prefix === suffix) {
        return { text: source, inReasoning: !!inReasoning, carry: '' };
    }

    const filtered = stripReasoningBlocks(source, inReasoning);
    let output = filtered.text;
    let nextCarry = '';

    if (!filtered.inReasoning) {
        const overlap = getTrailingDelimiterFragmentLength(source, prefix);
        if (overlap > 0) {
            nextCarry = source.slice(source.length - overlap);
            if (output.endsWith(nextCarry)) {
                output = output.slice(0, output.length - nextCarry.length);
            }
        }
    } else {
        const overlap = getTrailingDelimiterFragmentLength(source, suffix);
        if (overlap > 0) {
            nextCarry = source.slice(source.length - overlap);
        }
    }

    return { text: output, inReasoning: filtered.inReasoning, carry: nextCarry };
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

    if (extension_settings.tts.skip_reasoning !== false) {
        text = stripReasoningBlocks(text, false).text;
    }
    
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
    $('#tts_generation_metadata_prefix').prop('checked', extension_settings.tts.generation_metadata_prefix === true);
    $('#tts_skip_codeblocks').prop('checked', extension_settings.tts.skip_codeblocks);
    $('#tts_skip_tags').prop('checked', extension_settings.tts.skip_tags);
    $('#tts_skip_brackets').prop('checked', extension_settings.tts.skip_brackets);
    $('#tts_skip_reasoning').prop('checked', extension_settings.tts.skip_reasoning !== false);
    $('#playback_rate').val(extension_settings.tts.playback_rate);
    $('#playback_rate_counter').val(Number(extension_settings.tts.playback_rate).toFixed(2));

    $('body').toggleClass('tts', extension_settings.tts.enabled);
}

const defaultSettings = {
    voiceMap: '',
    ttsEnabled: false,
    currentProvider: 'VoiceForge',
    auto_generation: true,
    playback_rate: 1,
    narrate_dialogues_only: false,  // Ignore *asterisk actions*
    narrate_quoted_only: false,     // Only narrate quoted speech
    skip_codeblocks: true,
    skip_tags: false,
    skip_brackets: false,           // Ignore [text inside brackets]
    skip_reasoning: true,
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

function onSkipReasoningClick() {
    extension_settings.tts.skip_reasoning = !!$('#tts_skip_reasoning').prop('checked');
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
    try {
        await ttsProvider.loadSettings(extension_settings.tts[PROVIDER_NAME]);
    } catch (err) {
        console.warn('VoiceForge: loadSettings failed (server unreachable?), UI still available', err);
    }
    await initVoiceMap();
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
    streamingTtsInReasoningBlock = false;
    streamingTtsReasoningCarry = '';
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

    let chunkForSpeech = unprocessedChunk;
    if (extension_settings.tts.skip_reasoning !== false) {
        const reasoningFiltered = stripReasoningBlocksStreaming(chunkForSpeech, streamingTtsInReasoningBlock, streamingTtsReasoningCarry);
        chunkForSpeech = reasoningFiltered.text;
        streamingTtsInReasoningBlock = reasoningFiltered.inReasoning;
        streamingTtsReasoningCarry = reasoningFiltered.carry;
    }

    let filteredChunk = filterStreamingTextForSpeech(chunkForSpeech)
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

    if (extension_settings.tts.skip_reasoning !== false && remainingText.length > 0) {
        const reasoningFiltered = stripReasoningBlocksStreaming(remainingText, streamingTtsInReasoningBlock, streamingTtsReasoningCarry);
        remainingText = reasoningFiltered.text.trim();
        streamingTtsInReasoningBlock = reasoningFiltered.inReasoning;
        streamingTtsReasoningCarry = reasoningFiltered.carry;
    }
    
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
    streamingTtsInReasoningBlock = false;
    streamingTtsReasoningCarry = '';
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
    streamingTtsInReasoningBlock = false;
    streamingTtsReasoningCarry = '';
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
async function getCharacters(unrestricted) {
    const context = getContext();
    console.log('[VoiceForge] getCharacters called, unrestricted:', unrestricted);
    console.log('[VoiceForge] context.groupId:', context.groupId);
    console.log('[VoiceForge] context.name1:', context.name1);
    console.log('[VoiceForge] context.name2:', context.name2);

    if (unrestricted) {
        if (!Array.isArray(context.characters) || context.characters.length === 0) {
            try {
                await getSillyTavernCharacters();
            } catch (error) {
                console.warn('[VoiceForge] Failed to force-load SillyTavern characters', error);
            }
        }
        const freshContext = getContext();
        const names = (freshContext.characters || []).map(char => char.name);
        const savedMap = extension_settings.tts?.[PROVIDER_NAME]?.voiceMap;
        if (savedMap && typeof savedMap === 'object' && !Array.isArray(savedMap)) {
            names.push(...Object.keys(savedMap));
        }
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

function sanitizeId(input) {
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

function getStoredVoiceMap() {
    if (!extension_settings.tts[PROVIDER_NAME].voiceMap || typeof extension_settings.tts[PROVIDER_NAME].voiceMap !== 'object') {
        extension_settings.tts[PROVIDER_NAME].voiceMap = {};
    }
    updateVoiceMap();
    return extension_settings.tts[PROVIDER_NAME].voiceMap;
}

function extractVoiceMapImport(input) {
    const value = typeof input === 'string' ? JSON.parse(input) : input;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Import must be a voice map object or JSON string.');
    }
    if (value.tts?.[PROVIDER_NAME]?.voiceMap) return value.tts[PROVIDER_NAME].voiceMap;
    if (value[PROVIDER_NAME]?.voiceMap) return value[PROVIDER_NAME].voiceMap;
    if (value.voiceMap) return value.voiceMap;
    return value;
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}

async function readTextFromClipboard() {
    if (navigator.clipboard?.readText) return navigator.clipboard.readText();
    return window.prompt('Paste VoiceForge voice map JSON:') || '';
}

async function exportVoiceMapToClipboard() {
    const text = JSON.stringify(getStoredVoiceMap(), null, 2);
    await copyTextToClipboard(text);
    toastr.success('VoiceForge voice map copied to clipboard.', 'VoiceForge');
}

async function importVoiceMapFromClipboard() {
    const text = await readTextFromClipboard();
    if (!text.trim()) return;

    const importedMap = extractVoiceMapImport(text);
    if (!importedMap || typeof importedMap !== 'object' || Array.isArray(importedMap)) {
        throw new Error('No voiceMap object found in clipboard JSON.');
    }

    if (!extension_settings.tts[PROVIDER_NAME].voiceMap || typeof extension_settings.tts[PROVIDER_NAME].voiceMap !== 'object') {
        extension_settings.tts[PROVIDER_NAME].voiceMap = {};
    }

    const beforeCount = Object.keys(extension_settings.tts[PROVIDER_NAME].voiceMap).length;
    Object.assign(extension_settings.tts[PROVIDER_NAME].voiceMap, importedMap);
    voiceMap = { ...extension_settings.tts[PROVIDER_NAME].voiceMap };
    saveSettingsDebounced();
    await initVoiceMap(true);

    const importedCount = Object.keys(importedMap).length;
    const afterCount = Object.keys(extension_settings.tts[PROVIDER_NAME].voiceMap).length;
    toastr.success(`Imported ${importedCount} entries. Map now has ${afterCount} entries (${beforeCount} before).`, 'VoiceForge');
}

globalThis.VoiceForgeExportMap = exportVoiceMapToClipboard;
globalThis.VoiceForgeImportMap = importVoiceMapFromClipboard;

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
async function initVoiceMap(unrestricted = true) {
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
    
    // Keep voice map visible even if TTS is disabled or provider is offline.
    const enabled = $('#tts_enabled').is(':checked');
    console.log('[VoiceForge] TTS enabled:', enabled);
    if (!enabled) {
        console.log('[VoiceForge] TTS not enabled, continuing voice map init in view-only mode');
    }

    // Keep errors inside extension UI rather than toastr. Toastr errors for TTS are annoying.
    let providerReady = false;
    try {
        console.log('[VoiceForge] Checking TTS provider ready...');
        await ttsProvider.checkReady();
        console.log('[VoiceForge] TTS provider is ready');
        providerReady = true;
    } catch (error) {
        const message = `TTS Provider not ready. ${error}`;
        console.error('[VoiceForge]', message, error);
        setTtsStatus(message, false);
        console.log('[VoiceForge] Continuing voice map init using saved settings only');
    }

    // Clear existing voiceMap state
    $('#tts_voicemap_block').empty();
    voiceMapEntries = [];

    // Get characters in current chat
    const characters = await getCharacters(unrestricted);
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
        if (providerReady && typeof ttsProvider.getAudioPrompts === 'function') {
            audioPrompts = ttsProvider.getAudioPrompts() || [];
        } else if (providerReady && typeof ttsProvider.fetchTtsVoiceObjects === 'function') {
            // Fallback: use voice objects as audio prompts
            audioPrompts = await ttsProvider.fetchTtsVoiceObjects() || [];
        }
    } catch (error) {
        console.warn('Failed to get audio prompts:', error);
    }

    try {
        if (providerReady && typeof ttsProvider.getRvcModels === 'function') {
            rvcModels = ttsProvider.getRvcModels() || [];
        }
    } catch (error) {
        console.warn('Failed to get RVC models:', error);
    }

    // Fetch available background tracks from VoiceForge
    try {
        if (providerReady && typeof ttsProvider.getBackgroundTracks === 'function') {
            bgTracks = await ttsProvider.getBackgroundTracks() || [];
        }
    } catch (error) {
        console.warn('Failed to get background tracks:', error);
    }

    // Get server config for Default Voice
    let serverConfig = null;
    try {
        if (providerReady && typeof ttsProvider.getServerConfig === 'function') {
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

        // Keep Default Voice internal for inheritance/server config, but do not render it in the UI.
        const voiceMapEntry = new VoiceMapEntry(character, savedSettings);
        if (character === DEFAULT_VOICE_MARKER) {
            voiceMapEntries.push(voiceMapEntry);
            continue;
        }

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
        const settingsHtml = $(await renderExtensionTemplateAsync('third-party/Extension-Embody', 'settings'));
        const voiceforgeSettings = settingsHtml.filter('#embody-voiceforge-settings').length
            ? settingsHtml.filter('#embody-voiceforge-settings')
            : settingsHtml.find('#embody-voiceforge-settings');
        voiceforgeSettings.find('.inline-drawer-content').removeClass('inline-drawer-content').show();
        const audioSection = voiceforgeSettings.find('#audio_section_header').closest('.voiceforge-section');
        const callModeBgBlock = audioSection.find('#audio_voiceforge_bg_volume_slider').closest('.audio-ui-block');
        if (callModeBgBlock.length) {
            const callModeHost = $('#embody-callmode-panel');
            if (callModeHost.length) {
                callModeHost.append('<hr><h4>VoiceForge Background Audio</h4>');
                callModeHost.append(callModeBgBlock);
            }
        }
        const audioPanel = $('#embody-audio-panel');
        if (audioPanel.length && audioSection.length) {
            audioPanel.empty().append(audioSection);
        }

        const environmentPanel = $('#embody-environment-panel');
        const metadataLabel = voiceforgeSettings.find('label.checkbox_label[for="tts_generation_metadata_prefix"]').first();
        const weatherToggleLabel = voiceforgeSettings.find('label.checkbox_label[for="voiceforge_generation_weather_context_enabled"]').first();
        const weatherRefreshBlock = voiceforgeSettings.find('#voiceforge_generation_weather_refresh_minutes').closest('div');
        const weatherCityBlock = voiceforgeSettings.find('#voiceforge_generation_weather_manual_city').closest('div');
        if (environmentPanel.length && metadataLabel.length) {
            const section = $('<div class="voiceforge-section"></div>');
            section.append('<div class="voiceforge-section-header"><span>Generation Environment</span></div>');
            const content = $('<div style="margin-top: 8px;"></div>');
            content.append(metadataLabel);
            if (weatherToggleLabel.length) content.append(weatherToggleLabel);
            if (weatherRefreshBlock.length) content.append(weatherRefreshBlock);
            if (weatherCityBlock.length) content.append(weatherCityBlock);
            section.append(content);
            environmentPanel.empty().append(section);
            $(document).trigger('embody-environment-mounted');
        }
        const embodyPanel = $('#embody-voiceforge-panel');
        let mountedInEmbody = false;
        if (embodyPanel.length) {
            embodyPanel.empty().append(voiceforgeSettings);
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
        $('#tts_skip_reasoning').on('change', onSkipReasoningClick);
        $('#tts_auto_generation').on('change', onAutoGenerationClick);
        $('#tts_generation_metadata_prefix').on('change', onGenerationMetadataPrefixClick);
        $('#voiceforge_export_map').on('click', () => exportVoiceMapToClipboard().catch((error) => {
            console.error('[VoiceForge] Failed to export voice map', error);
            toastr.error(error?.message || String(error), 'VoiceForge export failed');
        }));
        $('#voiceforge_import_map').on('click', () => importVoiceMapFromClipboard().catch((error) => {
            console.error('[VoiceForge] Failed to import voice map', error);
            toastr.error(error?.message || String(error), 'VoiceForge import failed');
        }));

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
}

// ==========================================
// CALLMODE MODULE
// ==========================================
{
jQuery(async () => {
    initCallMode();
});
}

// ==========================================
// INTIFACE MODULE
// ==========================================
{
// Module imports
const console = { ...globalThis.console }

const NAME = "intiface-connect"

if (typeof globalThis !== 'undefined') {
  globalThis.__intifacePromptManagedByIndex = true
}
if (typeof window !== 'undefined') {
  window.__intifacePromptManagedByIndex = true
}
const extensionName = "Extension-Embody"

// Global state (kept for compatibility)
let client
let buttplug
let devices = []
let device = null
let deviceAssignments = {}

// Command processing state
let messageCommands = []
let executedCommands = new Set()
let streamingText = ''
let lastRawStreamText = ''
let seenCommands = new Set()
let commandQueueInterval = null
let isExecutingCommands = false
let isStartingIntiface = false
let playModeSequenceTimeouts = new Set()
let pendingMediaListFromStream = false
let aiStopLatchActive = false
let systemCommandState = new Map()
let pendingSpokenSyncCommands = []
let pendingSpokenSyncKeys = new Set()
let spokenSyncQueuedKeysEver = new Set()
let spokenSyncCommandOrdinal = 0
let spokenSyncSeenCommandSignaturesByRequest = new Map()
let spokenSyncLastChunkStartKey = ''
let spokenSyncLastExecutionAt = 0
let lastKnownChatIdentity = ''
let activeTtsRequestId = null
let activeTtsMessageId = null
let spokenSyncTraceCounter = 0
let CHUNK_SYNC_DEBUG = false
const CHUNK_SYNC_FALLBACK_CHUNK_DELAY = 1
const CHUNK_SYNC_SUBTITLE_EARLY_LEAD_CHUNKS = 0
const CHUNK_SYNC_RECENT_EXECUTION_WINDOW_MS = 1800
const CHUNK_SYNC_OFFSET_EARLY_LEAD_MIN = 0
const CHUNK_SYNC_OFFSET_EARLY_LEAD_MAX = 0
const CHUNK_SYNC_OFFSET_EXTRA_CHUNK_LEAD = 0.33
let TARGET_PARSE_DEBUG = false
const TARGET_SENTINEL_ANY_CHANNEL = -1
const TARGET_SENTINEL_CHANNEL_A = -101
const TARGET_SENTINEL_CHANNEL_B = -102
const TARGET_SENTINEL_CHANNEL_C = -103
const TARGET_SENTINEL_CHANNEL_D = -104

function initializeIntifaceEmbodyTheme() {
  const sectionPairs = [
    ['#intiface-playmode-menu-toggle', '#intiface-playmode-menu-content'],
    ['#intiface-ai-modes-toggle', '#intiface-ai-modes-content'],
    ['#intiface-mode-builder-toggle', '#intiface-mode-builder-content'],
    ['#intiface-intensity-toggle', '#intiface-intensity-content'],
    ['#intiface-media-menu-toggle', '#intiface-media-menu-content'],
    ['#intiface-funscript-editor-toggle', '#intiface-funscript-editor-content'],
    ['#intiface-funscript-menu-toggle', '#intiface-funscript-menu-content'],
    ['#intiface-advanced-toggle', '#intiface-advanced-content'],
  ]

  sectionPairs.forEach(([headerSelector, contentSelector]) => {
    const header = $(headerSelector)
    const content = $(contentSelector)
    if (header.length) {
      header.addClass('embody-intiface-section-header')
    }
    if (content.length) {
      content.addClass('embody-intiface-section-content embody-intiface-card')
    }
  })

  $('#intiface-ai-status, #intiface-devices').addClass('embody-intiface-card')
  $('#intiface-ip-input').closest('.flex-container').addClass('embody-intiface-connect-row')
}

// Settings
let globalIntensityScale = 100
let globalInvert = false
let devicePollingRate = 30
let aiCommandsEnabled = true
let aiTtsSyncEnabled = false
let aiTtsSyncOffsetMs = 0
let aiTtsSyncStartTimeoutMs = 1200
let aiSyncStartLeadMs = 1200
let aiTtsInterruptPolicy = 'grace'
let intifaceDebugLoggingEnabled = false

// TTS sync state
let ttsSyncWaitingForStart = false
let ttsSyncActive = false
let ttsSyncLastReleaseSource = 'none'
let ttsSyncStartTimeoutId = null
let ttsSyncOffsetTimeoutId = null
let ttsInterruptGraceTimeoutId = null

const INTIFACE_DEVICE_LOREBOOK_NAME = 'intiface_device_profiles'
const INTIFACE_DEVICE_LOREBOOK_TEMPLATE_PATH = '/scripts/extensions/third-party/Extension-Embody/intiface/intiface_device_profiles.json'

// AI status check interval
let aiStatusCheckInterval = null
let connectionStateMonitorInterval = null
let lastObservedConnectionState = null
let pendingModelRuntimeNotice = ''
let pendingModelRuntimeNoticeAt = 0
let lastCallModeDisconnectReplyAt = 0
const CALL_MODE_DISCONNECT_REPLY_COOLDOWN_MS = 8000
let lastUiDisconnectIntentAt = 0
let autoReconnectInFlight = false
const UI_DISCONNECT_INTENT_WINDOW_MS = 2500
const AUTO_RECONNECT_MAX_ATTEMPTS = 3
let lastDisconnectReason = 'none'

// Pattern tracking
let activePatterns = new Map()

// Mode settings (managed by PlayModeLoader)
const modeSettings = new Proxy({}, {
  get(target, prop) {
    const camelCaseToFolder = {
      'denialDomina': 'denial',
      'milkMaid': 'milking',
      'petTraining': 'training',
      'sissySurrender': 'sissy',
      'prejacPrincess': 'prejac',
      'roboticRuination': 'robotic',
      'evilEdgingMistress': 'evil',
      'frustrationFairy': 'frustration',
      'hypnoHelper': 'hypno',
      'chastityCaretaker': 'chastity'
    }
    const modeId = camelCaseToFolder[prop] || prop
    if (PlayModeLoader?.isModeEnabled) {
      return PlayModeLoader.isModeEnabled(modeId)
    }
    return target[prop]
  },
  set(target, prop, value) {
    const camelCaseToFolder = {
      'denialDomina': 'denial',
      'milkMaid': 'milking',
      'petTraining': 'training',
      'sissySurrender': 'sissy',
      'prejacPrincess': 'prejac',
      'roboticRuination': 'robotic',
      'evilEdgingMistress': 'evil',
      'frustrationFairy': 'frustration',
      'hypnoHelper': 'hypno',
      'chastityCaretaker': 'chastity'
    }
    const modeId = camelCaseToFolder[prop] || prop
    if (PlayModeLoader?.setModeEnabled) {
      PlayModeLoader.setModeEnabled(modeId, value)
    }
    target[prop] = value
    return true
  }
})

const modeIntensityMultipliers = new Proxy({}, {
  get(target, prop) {
    const camelCaseToFolder = {
      'denialDomina': 'denial',
      'milkMaid': 'milking',
      'petTraining': 'training',
      'sissySurrender': 'sissy',
      'prejacPrincess': 'prejac',
      'roboticRuination': 'robotic',
      'evilEdgingMistress': 'evil',
      'frustrationFairy': 'frustration',
      'hypnoHelper': 'hypno',
      'chastityCaretaker': 'chastity'
    }
    const modeId = camelCaseToFolder[prop] || prop
    if (PlayModeLoader?.getIntensityMultiplier) {
      return PlayModeLoader.getIntensityMultiplier(modeId)
    }
    return target[prop]
  },
  set(target, prop, value) {
    const camelCaseToFolder = {
      'denialDomina': 'denial',
      'milkMaid': 'milking',
      'petTraining': 'training',
      'sissySurrender': 'sissy',
      'prejacPrincess': 'prejac',
      'roboticRuination': 'robotic',
      'evilEdgingMistress': 'evil',
      'frustrationFairy': 'frustration',
      'hypnoHelper': 'hypno',
      'chastityCaretaker': 'chastity'
    }
    const modeId = camelCaseToFolder[prop] || prop
    if (PlayModeLoader?.setIntensityMultiplier) {
      PlayModeLoader.setIntensityMultiplier(modeId, value)
    }
    target[prop] = value
    return true
  }
})

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function updateStatus(status, isError = false) {
  const statusPanel = $("#intiface-status-panel")
  statusPanel.text(`Status: ${status}`)
  if (isError) {
    statusPanel.removeClass("connected").addClass("disconnected")
  }
}

function updateButtonStates(isConnected) {
  const connectButton = $("#intiface-connect-action-button")
  if (isConnected) {
    connectButton
      .html('<i class="fa-solid fa-power-off"></i> Disconnect')
      .removeClass("connect-button")
      .addClass("disconnect-button")
  } else {
    connectButton
      .html('<i class="fa-solid fa-power-off"></i> Connect')
      .removeClass("disconnect-button")
      .addClass("connect-button")
  }
  $("#intiface-rescan-button").toggle(isConnected)
  $("#intiface-start-timer-button").toggle(isConnected)
  $("#intiface-connect-button .drawer-icon").toggleClass("flashing-icon", isConnected)
}

function getPollingInterval() {
  return Math.round(1000 / devicePollingRate)
}

function getErrorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  if (error && typeof error === 'object') {
    const msg = String(error?.message || error?.reason || error?.error || '').trim()
    if (msg) return msg
  }
  throw new Error('Unknown error object')
}

function applyInversion(value) {
  if (globalInvert) {
    return 100 - value
  }
  return value
}

function loadGlobalInvert() {
  try {
    const saved = localStorage.getItem('intiface-global-invert')
    if (saved !== null) {
      globalInvert = saved === 'true'
    }
  } catch (e) {
    console.error(`${NAME}: Failed to load global invert:`, e)
    globalInvert = false
  }
}

function saveGlobalInvert(value) {
  try {
    globalInvert = value
    localStorage.setItem('intiface-global-invert', value.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save global invert:`, e)
  }
}

function loadDevicePollingRate() {
  try {
    const saved = localStorage.getItem('intiface-polling-rate')
    if (saved) {
      devicePollingRate = parseInt(saved, 10) || 30
      if (devicePollingRate < 10) devicePollingRate = 10
      if (devicePollingRate > 120) devicePollingRate = 120
    }
  } catch (e) {
    console.error(`${NAME}: Failed to load polling rate:`, e)
    devicePollingRate = 30
  }
}

function saveDevicePollingRate(rate) {
  try {
    devicePollingRate = rate
    localStorage.setItem('intiface-polling-rate', rate.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save polling rate:`, e)
  }
}

function updateExePathStatus(pathValue) {
  const statusEl = $("#intiface-exe-status")
  const trimmed = String(pathValue || '').trim()

  if (!trimmed) {
    statusEl.css('color', '#888').text('Not configured')
    return
  }

  statusEl.css('color', '#4CAF50').text('Configured')
}

function saveExePath(pathValue) {
  const trimmed = String(pathValue || '').trim()
  localStorage.setItem('intiface-exe-path', trimmed)
  updateExePathStatus(trimmed)
  lastPromptHash = ''
  updatePrompt()
}

function loadExePath() {
  const saved = localStorage.getItem('intiface-exe-path') || ''
  $("#intiface-exe-path").val(saved)
  updateExePathStatus(saved)
}

async function browseExePath() {
  const button = $("#intiface-exe-browse")
  const originalHtml = button.html()
  button.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i>')

  try {
    const response = await fetch('/api/plugins/intiface-launcher/browse-exe', {
      method: 'GET',
      headers: getRequestHeaders(),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    if (data?.success && data.path) {
      $("#intiface-exe-path").val(data.path)
      saveExePath(data.path)
      updateStatus('Selected Intiface executable path')
    } else if (data?.cancelled) {
      updateStatus('Executable browse cancelled')
    } else {
      updateStatus(data?.error || 'Failed to browse for executable', true)
    }
  } catch (e) {
    console.error(`${NAME}: Failed to browse executable path:`, e)
    updateStatus('Browse unavailable - enter path manually', true)
  } finally {
    button.prop('disabled', false).html(originalHtml)
  }
}

function loadAICommandsEnabled() {
  try {
    const saved = localStorage.getItem('intiface-ai-commands-enabled')
    aiCommandsEnabled = saved !== null ? saved === 'true' : true
  } catch (e) {
    console.error(`${NAME}: Failed to load AI command toggle:`, e)
    aiCommandsEnabled = true
  }
}

function saveAICommandsEnabled(enabled) {
  try {
    aiCommandsEnabled = enabled
    localStorage.setItem('intiface-ai-commands-enabled', enabled.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save AI command toggle:`, e)
  }
}

function loadAITtsSyncSettings() {
  try {
    const savedEnabled = localStorage.getItem('intiface-ai-tts-sync-enabled')
    aiTtsSyncEnabled = savedEnabled !== null ? savedEnabled === 'true' : false

    const savedOffsetRaw = localStorage.getItem('intiface-ai-tts-sync-offset-ms')
    const savedOffset = Number.parseInt(savedOffsetRaw ?? '0', 10)
    aiTtsSyncOffsetMs = Number.isFinite(savedOffset) ? Math.max(-1500, Math.min(1500, savedOffset)) : 0

    const savedTimeout = Number.parseInt(localStorage.getItem('intiface-ai-tts-sync-timeout-ms') || '1200', 10)
    aiTtsSyncStartTimeoutMs = Number.isFinite(savedTimeout) ? Math.max(300, Math.min(5000, savedTimeout)) : 1200

    const savedLead = Number.parseInt(localStorage.getItem('intiface-ai-sync-start-lead-ms') || '1200', 10)
    aiSyncStartLeadMs = Number.isFinite(savedLead) ? Math.max(0, Math.min(3000, savedLead)) : 1200

    const savedPolicy = String(localStorage.getItem('intiface-ai-tts-interrupt-policy') || 'grace').trim().toLowerCase()
    aiTtsInterruptPolicy = ['flush', 'grace', 'preserve'].includes(savedPolicy) ? savedPolicy : 'grace'
  } catch (e) {
    console.error(`${NAME}: Failed to load AI TTS sync settings:`, e)
    aiTtsSyncEnabled = false
    aiTtsSyncOffsetMs = 0
    aiTtsSyncStartTimeoutMs = 1200
    aiSyncStartLeadMs = 1200
    aiTtsInterruptPolicy = 'grace'
  }
}

function loadDebugLoggingSetting() {
  try {
    const saved = localStorage.getItem('intiface-debug-logging-enabled')
    intifaceDebugLoggingEnabled = saved !== null ? saved === 'true' : false
  } catch (e) {
    console.error(`${NAME}: Failed to load debug logging setting:`, e)
    intifaceDebugLoggingEnabled = false
  }

  CHUNK_SYNC_DEBUG = intifaceDebugLoggingEnabled
  TARGET_PARSE_DEBUG = intifaceDebugLoggingEnabled
}

function saveDebugLoggingSetting(enabled) {
  try {
    intifaceDebugLoggingEnabled = enabled
    CHUNK_SYNC_DEBUG = enabled
    TARGET_PARSE_DEBUG = enabled
    localStorage.setItem('intiface-debug-logging-enabled', enabled.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save debug logging setting:`, e)
  }
}

function saveAITtsSyncEnabled(enabled) {
  try {
    aiTtsSyncEnabled = enabled
    localStorage.setItem('intiface-ai-tts-sync-enabled', enabled.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save AI TTS sync enabled:`, e)
  }
}

function saveAITtsSyncOffsetMs(value) {
  try {
    aiTtsSyncOffsetMs = Math.max(-1500, Math.min(1500, Number.parseInt(value, 10) || 0))
    localStorage.setItem('intiface-ai-tts-sync-offset-ms', aiTtsSyncOffsetMs.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save AI TTS sync offset:`, e)
  }
}

function saveAITtsSyncTimeoutMs(value) {
  try {
    aiTtsSyncStartTimeoutMs = Math.max(300, Math.min(5000, Number.parseInt(value, 10) || 1200))
    localStorage.setItem('intiface-ai-tts-sync-timeout-ms', aiTtsSyncStartTimeoutMs.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save AI TTS sync timeout:`, e)
  }
}

function saveAISyncStartLeadMs(value) {
  try {
    aiSyncStartLeadMs = Math.max(0, Math.min(3000, Number.parseInt(value, 10) || 0))
    localStorage.setItem('intiface-ai-sync-start-lead-ms', aiSyncStartLeadMs.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save AI sync start lead:`, e)
  }
}

function saveAITtsInterruptPolicy(value) {
  try {
    const normalized = String(value || '').trim().toLowerCase()
    aiTtsInterruptPolicy = ['flush', 'grace', 'preserve'].includes(normalized) ? normalized : 'grace'
    localStorage.setItem('intiface-ai-tts-interrupt-policy', aiTtsInterruptPolicy)
  } catch (e) {
    console.error(`${NAME}: Failed to save AI TTS interrupt policy:`, e)
  }
}

function updateAITtsSyncControls() {
  const disabled = !aiTtsSyncEnabled
  $("#intiface-ai-tts-sync-offset").prop('disabled', disabled)
  $("#intiface-ai-tts-sync-timeout").prop('disabled', disabled)
  $("#intiface-ai-sync-start-lead").prop('disabled', disabled)
  $("#intiface-ai-tts-interrupt-policy").prop('disabled', disabled)
}

function clearTtsSyncTimers() {
  if (ttsSyncStartTimeoutId) {
    clearWorkerTimeout(ttsSyncStartTimeoutId)
    ttsSyncStartTimeoutId = null
  }
  if (ttsSyncOffsetTimeoutId) {
    clearWorkerTimeout(ttsSyncOffsetTimeoutId)
    ttsSyncOffsetTimeoutId = null
  }
}

function resetTtsSyncState() {
  clearTtsSyncTimers()
  ttsSyncWaitingForStart = false
  ttsSyncActive = false
  ttsSyncLastReleaseSource = 'none'
}

function clearSpokenSyncQueueState() {
  pendingSpokenSyncCommands = []
  pendingSpokenSyncKeys.clear()
  spokenSyncQueuedKeysEver.clear()
  spokenSyncCommandOrdinal = 0
  spokenSyncLastExecutionAt = 0
  spokenSyncSeenCommandSignaturesByRequest.clear()
  spokenSyncLastChunkStartKey = ''
  activeTtsMessageId = null
}

function clearTtsInterruptGraceTimer() {
  if (!ttsInterruptGraceTimeoutId) return
  clearWorkerTimeout(ttsInterruptGraceTimeoutId)
  ttsInterruptGraceTimeoutId = null
}

function shouldGateDeviceCommandExecution() {
  return aiCommandsEnabled && aiTtsSyncEnabled && ttsSyncWaitingForStart
}

function armTtsSyncGate() {
  if (!aiCommandsEnabled || !aiTtsSyncEnabled) return
  if (ttsSyncWaitingForStart || ttsSyncActive) return

  ttsSyncWaitingForStart = true
  ttsSyncLastReleaseSource = 'waiting'

  if (ttsSyncStartTimeoutId) {
    clearWorkerTimeout(ttsSyncStartTimeoutId)
  }

  ttsSyncStartTimeoutId = setWorkerTimeout(() => {
    ttsSyncStartTimeoutId = null
    if (!ttsSyncWaitingForStart) return
    console.warn(`${NAME}: TTS sync start timed out; command queue remains gated`)
  }, aiTtsSyncStartTimeoutMs)

  updateAIStatusFromActivity()
}

function releaseTtsSyncGate(source = 'tts') {
  const applyRelease = () => {
    clearTtsSyncTimers()
    ttsSyncWaitingForStart = false
    ttsSyncActive = true
    ttsSyncLastReleaseSource = source
    updateAIStatusFromActivity()
    processCommandQueue()
  }

  if (source === 'tts' && aiTtsSyncOffsetMs > 0) {
    if (ttsSyncOffsetTimeoutId) {
      clearWorkerTimeout(ttsSyncOffsetTimeoutId)
    }
    ttsSyncOffsetTimeoutId = setWorkerTimeout(() => {
      ttsSyncOffsetTimeoutId = null
      applyRelease()
    }, aiTtsSyncOffsetMs)
    return
  }

  applyRelease()
}

function getDeviceShorthand(dev) {
  const devName = (dev.displayName || dev.name || '').toLowerCase()
  return devName.split(' ')[0]
}

function getDeviceDefaultIntensity(dev) {
  return 100
}

// ==========================================
// AI COMMAND HANDLING
// ==========================================

function updateAIStatusFromActivity() {
  const statusEl = $("#intiface-ai-status")
  const textEl = $("#intiface-ai-status-text")

  if (!aiCommandsEnabled) {
    statusEl.css("background", "rgba(120,120,120,0.15)")
    textEl.css("color", "#aaa").text("AI control is disabled")
    return
  }

  const hasActivePatterns = activePatterns.size > 0
  const isProcessing = isExecutingCommands || messageCommands.length > 0

  if (shouldGateDeviceCommandExecution()) {
    statusEl.css("background", "rgba(255, 193, 7, 0.18)")
    textEl.css("color", "#e5b93c").text("Waiting for VoiceForge TTS playback...")
    return
  }

  if (hasActivePatterns || isProcessing) {
    statusEl.css("background", "rgba(76, 175, 80, 0.15)")
    textEl.css("color", "#4CAF50").text('AI is controlling your device...')
  } else {
    statusEl.css("background", "rgba(0,0,0,0.05)")
    textEl.css("color", "#888").text("AI is ready to control your device via chat commands")
  }
}

function startAIStatusMonitoring() {
  if (aiStatusCheckInterval) return
  aiStatusCheckInterval = setInterval(updateAIStatusFromActivity, 500)
}

function stopAIStatusMonitoring() {
  if (aiStatusCheckInterval) {
    clearInterval(aiStatusCheckInterval)
    aiStatusCheckInterval = null
  }
}

function clearPendingModelRuntimeNotice() {
  if (!pendingModelRuntimeNotice) return
  pendingModelRuntimeNotice = ''
  pendingModelRuntimeNoticeAt = 0
  updatePrompt()
}

function setPendingModelRuntimeNotice(message) {
  const normalized = String(message || '').trim()
  if (!normalized) return
  pendingModelRuntimeNotice = normalized
  pendingModelRuntimeNoticeAt = Date.now()
  updatePrompt()
}

function isCallModeActive() {
  try {
    const button = document.getElementById('voiceforge_call_button')
    return !!button?.classList?.contains('active')
  } catch (_e) {
    return false
  }
}

function classifyDisconnectReason() {
  const now = Date.now()
  if ((now - lastUiDisconnectIntentAt) <= UI_DISCONNECT_INTENT_WINDOW_MS) {
    lastUiDisconnectIntentAt = 0
    return 'ui_manual'
  }
  return 'unexpected'
}

async function attemptAutomaticReconnect() {
  if (autoReconnectInFlight) return false
  autoReconnectInFlight = true

  try {
    for (let attempt = 1; attempt <= AUTO_RECONNECT_MAX_ATTEMPTS; attempt++) {
      if (client?.connected || isClientConnected()) {
        return true
      }

      try {
        await connectDevices(true)
      } catch (_e) {
        // Keep retrying with short backoff.
      }

      if (client?.connected || isClientConnected()) {
        return true
      }

      await waitMs(800 * attempt)
    }
  } finally {
    autoReconnectInFlight = false
  }

  return !!(client?.connected || isClientConnected())
}

async function maybeTriggerCallModeDisconnectReply(reason = 'unexpected') {
  if (!isCallModeActive()) return

  const now = Date.now()
  if ((now - lastCallModeDisconnectReplyAt) < CALL_MODE_DISCONNECT_REPLY_COOLDOWN_MS) {
    return
  }
  lastCallModeDisconnectReplyAt = now

  const context = getContext?.()
  if (!context || typeof context.generate !== 'function') {
    return
  }

  try {
    if (reason === 'ui_manual') {
      sendSystemMessage(
        system_message_types.GENERIC,
        '[System status update: The user manually disconnected Intiface from the UI. Give a short, mildly annoyed acknowledgment, and do not auto-reconnect unless asked.]',
        { isSmallSys: true, source: 'intiface_runtime' }
      )
    } else {
      sendSystemMessage(
        system_message_types.GENERIC,
        '[System status update: Intiface disconnected unexpectedly (likely server-side). Briefly acknowledge this and say you are attempting automatic reconnect now.]',
        { isSmallSys: true, source: 'intiface_runtime' }
      )
    }
    await context.generate()
  } catch (e) {
    console.warn(`${NAME}: Failed to auto-generate call-mode disconnect acknowledgement`, e)
  }
}

function getConnectionStateKey() {
  const connected = !!(client?.connected || isClientConnected())
  const deviceCount = Array.isArray(getConnectedDevices()) ? getConnectedDevices().length : 0
  return `${connected ? 1 : 0}:${deviceCount}`
}

function startConnectionStateMonitoring() {
  if (connectionStateMonitorInterval) return

  lastObservedConnectionState = getConnectionStateKey()
  connectionStateMonitorInterval = setInterval(() => {
    const nextState = getConnectionStateKey()
    if (nextState === lastObservedConnectionState) {
      return
    }

    const [wasConnected] = String(lastObservedConnectionState || '0:0').split(':')
    const [isConnected] = String(nextState).split(':')
    lastObservedConnectionState = nextState

    updatePrompt()
    updateButtonStates(isConnected === '1')

    if (isConnected === '1') {
      clearPendingModelRuntimeNotice()
    }

    if (wasConnected !== isConnected) {
      updateStatus(isConnected === '1' ? 'Connected' : 'Disconnected')
      if (wasConnected === '1' && isConnected === '0') {
        const disconnectReason = classifyDisconnectReason()
        lastDisconnectReason = disconnectReason
        if (disconnectReason === 'ui_manual') {
          setPendingModelRuntimeNotice('User manually disconnected Intiface from the UI. Acknowledge this in your next reply with mild annoyance, and wait for user instruction before reconnecting.')
          void maybeTriggerCallModeDisconnectReply('ui_manual')
        } else {
          setPendingModelRuntimeNotice('Intiface disconnected unexpectedly. Explain you are attempting automatic reconnect, then proceed if successful.')
          void maybeTriggerCallModeDisconnectReply('unexpected')
          void (async () => {
            const restored = await attemptAutomaticReconnect()
            if (restored) {
              setPendingModelRuntimeNotice('Intiface connection was restored automatically after an unexpected disconnect. Briefly confirm recovery.')
            } else {
              setPendingModelRuntimeNotice('Automatic reconnect failed after retries. Ask the user to verify Intiface server status and approve another reconnect attempt.')
            }
          })()
        }
      } else if (wasConnected === '0' && isConnected === '1') {
        lastDisconnectReason = 'none'
      }
    }
  }, 1000)
}

async function loadIntifaceDeviceLorebookTemplate() {
  try {
    const response = await fetch(INTIFACE_DEVICE_LOREBOOK_TEMPLATE_PATH, {
      method: 'GET',
      cache: 'no-cache',
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    if (!data || typeof data !== 'object' || !data.entries || typeof data.entries !== 'object') {
      return null
    }

    return data
  } catch (_e) {
    return null
  }
}

async function ensureIntifaceDeviceLorebookSelected() {
  try {
    await updateWorldInfoList()
    const option = $('#world_info').children('option').filter(function () {
      return String($(this).text() || '').trim().toLowerCase() === INTIFACE_DEVICE_LOREBOOK_NAME.toLowerCase()
    })

    if (!option.length) {
      return
    }

    if (!option.prop('selected')) {
      option.prop('selected', true)
      onWorldInfoChange('__notSlashCommand__')
    }
  } catch (e) {
    console.warn(`${NAME}: Failed selecting Intiface device lorebook`, e)
  }
}

async function ensureIntifaceDeviceLorebook() {
  if (!aiCommandsEnabled) return

  try {
    const template = await loadIntifaceDeviceLorebookTemplate()
    if (!template) {
      return
    }

    const desiredVersion = Number(template?.extensions?.intifaceVersion || 1)
    let existing = await loadWorldInfo(INTIFACE_DEVICE_LOREBOOK_NAME)

    if (!existing) {
      await createNewWorldInfo(INTIFACE_DEVICE_LOREBOOK_NAME, { interactive: false })
      existing = await loadWorldInfo(INTIFACE_DEVICE_LOREBOOK_NAME)
    }

    if (!existing) {
      return
    }

    const isManaged = existing?.extensions?.intifaceManaged === true
    const currentVersion = Number(existing?.extensions?.intifaceVersion || 0)
    const entryCount = existing?.entries ? Object.keys(existing.entries).length : 0
    const shouldWrite = (isManaged && (currentVersion < desiredVersion || entryCount === 0)) || (!isManaged && entryCount === 0)

    if (shouldWrite) {
      const merged = {
        ...existing,
        ...template,
        name: INTIFACE_DEVICE_LOREBOOK_NAME,
        entries: template.entries,
        extensions: {
          ...(existing?.extensions || {}),
          ...(template?.extensions || {}),
          intifaceManaged: true,
          intifaceVersion: desiredVersion,
        },
      }
      await saveWorldInfo(INTIFACE_DEVICE_LOREBOOK_NAME, merged, true)
    }

    await ensureIntifaceDeviceLorebookSelected()
  } catch (e) {
    console.warn(`${NAME}: Failed ensuring Intiface device lorebook`, e)
  }
}

async function processCommandQueue() {
  if (!aiCommandsEnabled) {
    messageCommands = []
    resetTtsSyncState()
    return
  }

  if (isExecutingCommands || messageCommands.length === 0) return

  if (shouldGateDeviceCommandExecution()) {
    const stopCommands = messageCommands.filter((cmd) => isStopCommandType(cmd?.type))
    if (stopCommands.length === 0) {
      updateAIStatusFromActivity()
      return
    }
    messageCommands = stopCommands
  }

  const playerPanel = $("#intiface-chat-media-panel")
  const isMediaPlaying = playerPanel.length > 0 && playerPanel.is(":visible") && mediaPlayer.isPlaying

  if (isMediaPlaying) {
    const stopCommands = messageCommands.filter((cmd) => isStopCommandType(cmd?.type))
    if (stopCommands.length === 0) {
      if (messageCommands.length > 0) {
        messageCommands = []
        resetTtsSyncState()
      }
      return
    }
    messageCommands = stopCommands
  }

  isExecutingCommands = true
  startAIStatusMonitoring()

  while (messageCommands.length > 0) {
    const cmd = messageCommands.shift()
    if (!cmd) continue

    if (isStopCommandType(cmd.type)) {
      await executeStopCommand(cmd)
      continue
    }

    if (aiStopLatchActive) {
      continue
    }

    if (isSystemCommandType(cmd.type)) {
      continue
    }

    const currentPlayerPanel = $("#intiface-chat-media-panel")
    if (currentPlayerPanel.length > 0 && currentPlayerPanel.is(":visible") && mediaPlayer.isPlaying) {
      const remainingStopCommands = messageCommands.filter((queuedCmd) => isStopCommandType(queuedCmd?.type))
      if (remainingStopCommands.length === 0) {
        messageCommands = []
        resetTtsSyncState()
        break
      }
      messageCommands = remainingStopCommands
      continue
    }

    if (!client.connected) {
      continue
    }

    const expandedCommands = expandCommandTargetsForExecution(cmd)
    if (expandedCommands.length > 0) {
      clearPendingModelRuntimeNotice()
    }
    for (let i = 0; i < expandedCommands.length; i++) {
      const expandedCmd = expandedCommands[i]
      const cmdForExecution = i === 0 ? expandedCmd : { ...expandedCmd, _skipSyncStartLead: true }
      await executeCommand(cmdForExecution)
    }
  }

  isExecutingCommands = false
  updateAIStatusFromActivity()
}

async function executeSystemCommand(cmd) {
  const type = String(cmd?.type || '').trim()
  if (!type) {
    return
  }

  const gate = shouldSkipSystemCommand(type)
  if (gate.skip) {
    return
  }

  let succeeded = false
  try {
    if (type === 'interface_start') {
      if (isStartingIntiface) {
        return
      }

      const exePath = String(localStorage.getItem('intiface-exe-path') || '').trim()
      if (!exePath) {
        updateStatus('Cannot start Intiface: executable path is not configured', true)
        return
      }

      isStartingIntiface = true
      updateStatus('Starting Intiface Central...')
      emitIntifaceCommandSyncPulse(cmd, 'start')

      const response = await fetch('/api/plugins/intiface-launcher/start', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ exePath })
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${response.status}`)
      }

      updateStatus('Intiface Central launch requested')
      emitIntifaceUiAction('interface_start')
      succeeded = true
      scheduleIntifaceCommandSyncStop(cmd)
      setTimeout(() => updatePrompt(), 200)
      return
    }

    if (type === 'interface_connect') {
      emitIntifaceCommandSyncPulse(cmd, 'start')
      await connectDevices()
      emitIntifaceUiAction('interface_connect')
      succeeded = true
      scheduleIntifaceCommandSyncStop(cmd)
      setTimeout(() => updatePrompt(), 200)
      return
    }

    if (type === 'interface_disconnect') {
      emitIntifaceCommandSyncPulse(cmd, 'start')
      await disconnectDevices()
      succeeded = true
      scheduleIntifaceCommandSyncStop(cmd)
      setTimeout(() => updatePrompt(), 200)
      return
    }

    if (type === 'interface_scan') {
      emitIntifaceCommandSyncPulse(cmd, 'start')
      if (!client?.connected) {
        updateStatus('Scan requested: connecting first...')
        await connectDevices()
        emitIntifaceUiAction('interface_connect')
      }
      await rescanDevices()
      emitIntifaceUiAction('interface_scan')
      succeeded = true
      scheduleIntifaceCommandSyncStop(cmd)
      setTimeout(() => updatePrompt(), 200)
    }
  } catch (e) {
    const action = String(cmd?.type || 'system command').replace('interface_', '')
    const message = getErrorMessage(e, 'unknown error')
    updateStatus(`Failed to ${action}: ${message}`, true)
    console.error(`${NAME}: System command failed (${cmd?.type}): ${message}`, e)
  } finally {
    finishSystemCommand(type, succeeded)
    if (type === 'interface_start') {
      isStartingIntiface = false
    }
  }
}

function isMediaCommandType(type) {
  return type === 'media_list' ||
    type === 'media_play' ||
    type === 'media_stop' ||
    type === 'media_pause' ||
    type === 'media_resume' ||
    type === 'media_intensity'
}

function isSystemCommandType(type) {
  return type === 'interface_start' ||
    type === 'interface_connect' ||
    type === 'interface_disconnect' ||
    type === 'interface_scan'
}

function isStopCommandType(type) {
  return type === 'stop'
}

function clearAiStopLatch() {
  aiStopLatchActive = false
}

function engageAiStopLatch() {
  aiStopLatchActive = true
  messageCommands = []
  pendingMediaListFromStream = false
  clearSpokenSyncQueueState()
  resetTtsSyncState()
}

function isDeviceCommandType(type) {
  return !isSystemCommandType(type) && !isMediaCommandType(type)
}

async function executeStopCommand(cmd = {}) {
  engageAiStopLatch()

  try {
    if (typeof stopAllSync === 'function') {
      await stopAllSync()
    }
  } catch (e) {
    console.warn(`${NAME}: stopAllSync failed during STOP`, e)
  }

  try {
    if (typeof stopTimeline === 'function' && isTimelinePlaying()) {
      await stopTimeline()
    }
  } catch (e) {
    console.warn(`${NAME}: stopTimeline failed during STOP`, e)
  }

  try {
    if (typeof stopMediaPlayback === 'function') {
      await stopMediaPlayback()
    }
  } catch (e) {
    console.warn(`${NAME}: stopMediaPlayback failed during STOP`, e)
  }

  await executeCommand({ ...cmd, type: 'stop' })

  // STOP should cancel current motion/queue immediately, but must not block
  // subsequent commands that arrive after the STOP tag in the same response.
  clearAiStopLatch()
}

function resolveTargetChannelFromCommand(cmd) {
  const deviceIndex = Number(cmd?.deviceIndex)
  if (!Number.isFinite(deviceIndex)) return null
  if (deviceIndex === TARGET_SENTINEL_ANY_CHANNEL) return '-'
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_A) return 'A'
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_B) return 'B'
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_C) return 'C'
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_D) return 'D'
  return null
}

function resolveDeviceIndexesForTargetChannel(targetChannel) {
  const liveDevices = getConnectedDevices()
  if (!Array.isArray(liveDevices) || liveDevices.length === 0) {
    return []
  }

  const channel = String(targetChannel || '').trim().toUpperCase()
  if (!channel || channel === '-') {
    return liveDevices.map((_, index) => index)
  }

  const indexes = []
  for (let index = 0; index < liveDevices.length; index++) {
    const assigned = String(getDeviceChannel(index) || '-').trim().toUpperCase()
    if (assigned === channel) {
      indexes.push(index)
    }
  }
  return indexes
}

function resolveFallbackIndexForChannelSentinel(deviceIndex, liveDeviceCount) {
  if (!Number.isFinite(deviceIndex) || !Number.isFinite(liveDeviceCount) || liveDeviceCount <= 0) {
    return null
  }

  if (deviceIndex === TARGET_SENTINEL_CHANNEL_A) return liveDeviceCount > 0 ? 0 : null
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_B) return liveDeviceCount > 1 ? 1 : null
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_C) return liveDeviceCount > 2 ? 2 : null
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_D) return liveDeviceCount > 3 ? 3 : null
  return null
}

function expandCommandTargetsForExecution(cmd) {
  if (!cmd || !isDeviceCommandType(cmd?.type)) {
    return cmd ? [cmd] : []
  }

  if (cmd?.type === 'stop') {
    return [cmd]
  }

  const targetChannel = resolveTargetChannelFromCommand(cmd)
  if (!targetChannel) {
    return [cmd]
  }

  const targetIndexes = resolveDeviceIndexesForTargetChannel(targetChannel)
  if (!targetIndexes.length) {
    return []
  }

  return targetIndexes.map((deviceIndex) => ({
    ...cmd,
    deviceIndex,
    targetChannel,
  }))
}

function decodeCommandEntities(text) {
  return String(text || '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

function classifyTargetToken(rawTarget) {
  const token = String(rawTarget || '').trim().toLowerCase()
  if (!token) return 'unknown'
  if (token === 'any') return 'canonical_any'
  if (token === 'a' || token === 'b' || token === 'c' || token === 'd') return 'canonical_channel'
  if (token === 'interface' || token === 'system' || token === 'intiface' || token === 'media') return 'system_media'
  return 'unknown'
}

function classifyResolvedTargetFromCommand(cmd) {
  const deviceIndex = Number(cmd?.deviceIndex)
  if (!Number.isFinite(deviceIndex)) return 'unknown'
  if (deviceIndex === TARGET_SENTINEL_ANY_CHANNEL) return 'canonical_any'
  if (
    deviceIndex === TARGET_SENTINEL_CHANNEL_A ||
    deviceIndex === TARGET_SENTINEL_CHANNEL_B ||
    deviceIndex === TARGET_SENTINEL_CHANNEL_C ||
    deviceIndex === TARGET_SENTINEL_CHANNEL_D
  ) {
    return 'canonical_channel'
  }
  return 'unknown'
}

function summarizeTargetParsing(text) {
  const sourceText = decodeCommandEntities(text)
  const inlineTagRegex = /<([^<>\n:][^<>:\n]*?)\s*:\s*([\s\S]*?)>/gi
  const counts = {
    canonical_any: 0,
    canonical_channel: 0,
    system_media: 0,
    unknown: 0,
  }
  const tokens = []

  let match
  while ((match = inlineTagRegex.exec(sourceText)) !== null) {
    const rawTarget = String(match[1] || '').trim()
    if (!rawTarget) continue
    const kind = classifyTargetToken(rawTarget)
    counts[kind] += 1
    tokens.push(rawTarget)
  }

  return {
    totalTargets: tokens.length,
    counts,
    sampleTargets: tokens.slice(0, 8),
  }
}

function getSystemCommandCooldownMs(type) {
  if (type === 'interface_start') return 8000
  if (type === 'interface_connect') return 2500
  if (type === 'interface_disconnect') return 1500
  if (type === 'interface_scan') return 3000
  return 1000
}

function shouldSkipSystemCommand(type) {
  const now = Date.now()
  const state = systemCommandState.get(type) || { inFlight: false, lastAt: 0 }

  if (state.inFlight) {
    return { skip: true, reason: 'in_flight' }
  }

  const cooldownMs = getSystemCommandCooldownMs(type)
  if ((now - state.lastAt) < cooldownMs) {
    return { skip: true, reason: 'cooldown' }
  }

  systemCommandState.set(type, { inFlight: true, lastAt: now })
  return { skip: false }
}

function finishSystemCommand(type, succeeded) {
  const current = systemCommandState.get(type) || { inFlight: false, lastAt: 0 }
  systemCommandState.set(type, {
    inFlight: false,
    lastAt: succeeded ? current.lastAt : 0,
  })
}

function emitIntifaceDevicePlaybackEvent(payload = {}) {
  try {
    eventSource.emit('intiface_device_playback', {
      ...payload,
      emittedAt: performance.now(),
    })
  } catch (e) {
    // Keep device execution isolated from event bus issues.
  }
}

function emitIntifaceUiAction(actionType, extra = {}) {
  emitIntifaceDevicePlaybackEvent({
    state: 'ui_action',
    actionType: String(actionType || '').trim() || 'unknown',
    ...extra,
  })
}

function emitIntifaceCommandSyncPulse(cmd, state = 'start') {
  const traceId = Number.isFinite(cmd?.traceId)
    ? Number(cmd.traceId)
    : (Number.isFinite(cmd?._traceId) ? Number(cmd._traceId) : null)
  const requestId = typeof cmd?.requestId === 'string'
    ? cmd.requestId
    : (typeof cmd?._meta?.requestId === 'string' ? cmd._meta.requestId : null)
  const messageId = Number.isInteger(cmd?.messageId)
    ? cmd.messageId
    : (Number.isInteger(cmd?._meta?.messageId) ? cmd._meta.messageId : null)

  emitIntifaceDevicePlaybackEvent({
    state: String(state || 'start'),
    commandType: String(cmd?.type || 'unknown'),
    requestId,
    messageId,
    traceId,
    char: typeof cmd?.char === 'string' ? cmd.char : null,
  })
}

const SYSTEM_SYNC_PULSE_STOP_DELAY_MS = 8000

function scheduleIntifaceCommandSyncStop(cmd, delayMs = SYSTEM_SYNC_PULSE_STOP_DELAY_MS) {
  const waitMs = Math.max(120, Number(delayMs) || SYSTEM_SYNC_PULSE_STOP_DELAY_MS)
  setWorkerTimeout(() => {
    emitIntifaceCommandSyncPulse(cmd, 'stop')
  }, waitMs)
}

function getImmediateCommandKey(cmd) {
  return JSON.stringify({
    type: cmd?.type,
    deviceIndex: cmd?.deviceIndex,
    modeName: cmd?.modeName,
    presetName: cmd?.presetName,
    pattern: cmd?.pattern,
    intensity: cmd?.intensity,
    filename: cmd?.filename,
  })
}

function describeCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') return cmd
  return {
    type: cmd.type,
    deviceIndex: cmd.deviceIndex,
    modeName: cmd.modeName,
    presetName: cmd.presetName,
    pattern: cmd.pattern,
    intensity: cmd.intensity,
    min: cmd.min,
    max: cmd.max,
    duration: cmd.duration,
    cycles: cmd.cycles,
    startPos: cmd.startPos,
    endPos: cmd.endPos,
    filename: cmd.filename,
  }
}

function getSpokenSyncCommandKey(cmd, meta = {}) {
  return JSON.stringify({
    type: cmd?.type,
    deviceIndex: cmd?.deviceIndex,
    modeName: cmd?.modeName,
    presetName: cmd?.presetName,
    pattern: cmd?.pattern,
    intensity: cmd?.intensity,
    filename: cmd?.filename,
    commandOffset: Number.isFinite(meta?.commandOffset) ? Number(meta.commandOffset) : null,
  })
}

function hasPotentialCommandTags(text) {
  const value = String(text || '')
  if (!value) return false
  const hasOpen = value.includes('<') || /&lt;/i.test(value)
  const hasClose = value.includes('>') || /&gt;/i.test(value)
  return hasOpen && hasClose
}

function enqueueSpokenSyncCommand(cmd, char = null, meta = {}) {
  if (!cmd || typeof cmd !== 'object' || !cmd?.type) {
    return
  }

  const cmdKey = getSpokenSyncCommandKey(cmd, meta)
  if (spokenSyncQueuedKeysEver.has(cmdKey)) {
    return
  }
  if (pendingSpokenSyncKeys.has(cmdKey)) {
    return
  }

  if (executedCommands.has(cmdKey)) {
    return
  }

  const commandOffset = Number.isFinite(meta?.commandOffset) ? Number(meta.commandOffset) : null
  const targetSubtitleChunkIndex = Number.isFinite(meta?.targetSubtitleChunkIndex) ? Number(meta.targetSubtitleChunkIndex) : null
  const commandRawChunkIndex = Number.isFinite(meta?.commandRawChunkIndex) ? Number(meta.commandRawChunkIndex) : null

  pendingSpokenSyncKeys.add(cmdKey)
  spokenSyncQueuedKeysEver.add(cmdKey)
  pendingSpokenSyncCommands.push({
    ...cmd,
    char: typeof char === 'string' ? char : null,
    _syncKey: cmdKey,
    _execKey: cmdKey,
    _queuedAt: performance.now(),
    _source: 'stream_parse',
    _traceId: ++spokenSyncTraceCounter,
    _ordinal: ++spokenSyncCommandOrdinal,
    _meta: {
      streamLen: Number.isFinite(meta?.streamLen) ? meta.streamLen : null,
      requestId: typeof meta?.requestId === 'string' ? meta.requestId : null,
      messageId: Number.isInteger(meta?.messageId) ? meta.messageId : null,
      commandOffset,
      targetSubtitleChunkIndex,
      commandRawChunkIndex,
    },
  })

  if (TARGET_PARSE_DEBUG) {
    const queued = pendingSpokenSyncCommands[pendingSpokenSyncCommands.length - 1]
    console.log(`${NAME}: [parse-debug] queued`, {
      source: 'spoken-sync',
      type: queued?.type,
      resolvedTarget: classifyResolvedTargetFromCommand(queued),
      deviceIndex: Number.isFinite(queued?.deviceIndex) ? Number(queued.deviceIndex) : null,
      requestId: queued?._meta?.requestId || null,
      messageId: Number.isInteger(queued?._meta?.messageId) ? queued._meta.messageId : null,
      commandOffset: Number.isFinite(queued?._meta?.commandOffset) ? Number(queued._meta.commandOffset) : null,
    })
  }

  console.debug(`${NAME}: [chunk-sync] queued`, {
    traceId: pendingSpokenSyncCommands[pendingSpokenSyncCommands.length - 1]?._traceId,
    type: cmd?.type,
    resolvedTarget: classifyResolvedTargetFromCommand(pendingSpokenSyncCommands[pendingSpokenSyncCommands.length - 1]),
    isCanonicalTarget: (() => {
      const kind = classifyResolvedTargetFromCommand(pendingSpokenSyncCommands[pendingSpokenSyncCommands.length - 1])
      return kind === 'canonical_any' || kind === 'canonical_channel'
    })(),
    requestId: meta?.requestId || null,
    messageId: Number.isInteger(meta?.messageId) ? meta.messageId : null,
    commandOffset,
    targetSubtitleChunkIndex,
    commandRawChunkIndex,
    queueSize: pendingSpokenSyncCommands.length,
  })
}

function requeueSpokenSyncCommandFront(cmd) {
  if (!cmd) return
  if (cmd?._syncKey) {
    pendingSpokenSyncKeys.add(cmd._syncKey)
  }
  pendingSpokenSyncCommands.unshift(cmd)
}

function dequeueSpokenSyncCommandForPayload(payload = {}) {
  const payloadRequestId = String(payload?.requestId || payload?.request_id || '').trim()
  const payloadSubtitleChunkIndex = Number.isFinite(payload?.subtitleChunkIndex) ? Number(payload.subtitleChunkIndex) : null
  const payloadSourceStart = Number.isFinite(payload?.sourceStart) ? Number(payload.sourceStart) : null
  const payloadSourceEnd = Number.isFinite(payload?.sourceEnd) ? Number(payload.sourceEnd) : null

  if (pendingSpokenSyncCommands.length === 0) return null
  if (!Number.isFinite(payloadSubtitleChunkIndex)) return null

  for (let i = 0; i < pendingSpokenSyncCommands.length; i++) {
    const queued = pendingSpokenSyncCommands[i]
    const queuedRequestId = String(queued?._meta?.requestId || '').trim()
    const offset = Number(queued?._meta?.commandOffset)
    const rawTargetSubtitleChunkIndex = queued?._meta?.targetSubtitleChunkIndex
    const hasTargetSubtitleChunkIndex = Number.isFinite(rawTargetSubtitleChunkIndex)
    const targetSubtitleChunkIndex = hasTargetSubtitleChunkIndex ? Number(rawTargetSubtitleChunkIndex) : null

    if (payloadRequestId && queuedRequestId && payloadRequestId !== queuedRequestId) {
      continue
    }
    if (hasTargetSubtitleChunkIndex) {
      // Primary timing mode: chunk-index mapping from VoiceForge.
      // Keep a slight lead so matching commands are not skipped when a command
      // first appears on the same subtitle chunk.
      const animationChunk = Math.max(0, targetSubtitleChunkIndex - CHUNK_SYNC_SUBTITLE_EARLY_LEAD_CHUNKS)
      if (payloadSubtitleChunkIndex < animationChunk) {
        continue
      }
    } else {
      continue
    }

    pendingSpokenSyncCommands.splice(i, 1)
    if (queued?._syncKey) {
      pendingSpokenSyncKeys.delete(queued._syncKey)
    }
    return queued
  }

  return null
}

async function flushPendingSpokenSyncCommands(reason = 'flush') {
  if (!Array.isArray(pendingSpokenSyncCommands) || pendingSpokenSyncCommands.length === 0) {
    return 0
  }

  const queued = [...pendingSpokenSyncCommands]
  pendingSpokenSyncCommands = []
  pendingSpokenSyncKeys.clear()

  let executed = 0
  for (const rawCmd of queued) {
    if (!rawCmd) continue
    const cmdKey = rawCmd?._execKey || getImmediateCommandKey(rawCmd)
    if (executedCommands.has(cmdKey)) {
      continue
    }

    try {
      executedCommands.add(cmdKey)
      executedCommands.add(getImmediateCommandKey(rawCmd))
      if (isSystemCommandType(rawCmd?.type)) {
        await executeSystemCommand(rawCmd)
      } else if (isMediaCommandType(rawCmd?.type)) {
        await executeMediaCommand(rawCmd, Number.isInteger(rawCmd?._meta?.messageId) ? rawCmd._meta.messageId : null)
      } else if (isStopCommandType(rawCmd?.type)) {
        await executeStopCommand(rawCmd)
      } else {
        if (aiStopLatchActive) {
          continue
        }
        if (!client.connected) {
          continue
        }
        const expandedCommands = expandCommandTargetsForExecution(rawCmd)
        if (expandedCommands.length > 0) {
          clearPendingModelRuntimeNotice()
        }
        for (let i = 0; i < expandedCommands.length; i++) {
          const expandedCmd = expandedCommands[i]
          const cmdForExecution = i === 0 ? expandedCmd : { ...expandedCmd, _skipSyncStartLead: true }
          await executeCommand(cmdForExecution)
        }
      }
      executed += 1
    } catch (e) {
      console.warn(`${NAME}: [chunk-sync] flush command failed (${rawCmd?.type || 'unknown'})`, e)
    }
  }

  if (executed > 0) {
    console.log(`${NAME}: [chunk-sync] ${reason} executed ${executed} queued command(s)`)
  }
  return executed
}

function parseTaggedDeviceCommandsWithOffsets(text) {
  const sourceRaw = String(text || '')
  const sourceDecoded = sourceRaw
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')

  const inlineTagRegex = /<([^<>\n:][^<>:\n]*?)\s*:\s*([\s\S]*?)>/gi
  const blockTagRegex = /<([^<>\n:][^<>:\n]*?)\s*>([\s\S]*?)<\/\s*\1\s*>/gi
  const entries = []
  let match

  while ((match = inlineTagRegex.exec(sourceDecoded)) !== null) {
    const deviceType = String(match[1] || '').trim().toLowerCase()
    const inner = String(match[2] || '').trim()
    if (!deviceType || !inner) continue

    const tagText = `<${deviceType}:${inner}>`
    // VoiceForge chunk events report sourceStart/sourceEnd in raw streamed-text
    // coordinates. Keep command offsets in the same coordinate space so tags
    // stripped from TTS still align to the spoken chunk they arrived with.
    const commandOffset = Number(match.index) || 0
    const parsed = parseDeviceCommands(tagText)
    for (const cmd of parsed) {
      entries.push({ cmd, commandOffset, escaped: false })
    }
  }

  while ((match = blockTagRegex.exec(sourceDecoded)) !== null) {
    const deviceType = String(match[1] || '').trim().toLowerCase()
    const inner = String(match[2] || '').trim()
    if (!deviceType || !inner) continue

    const tagText = `<${deviceType}>${inner}</${deviceType}>`
    const commandOffset = Number(match.index) || 0
    const parsed = parseDeviceCommands(tagText)
    for (const cmd of parsed) {
      entries.push({ cmd, commandOffset, escaped: false })
    }
  }

  entries.sort((a, b) => (Number(a?.commandOffset) || 0) - (Number(b?.commandOffset) || 0))

  if (entries.length === 0) {
    const parsedFallback = parseDeviceCommands(sourceDecoded)
    for (const cmd of parsedFallback) {
      entries.push({ cmd, commandOffset: sourceRaw.length, escaped: false })
    }
  }

  return entries
}

async function executeMediaCommand(cmd, targetMessageId = null) {
  try {
    if (cmd.type === 'media_list') {
      console.log(`${NAME}: Executing media_list (targetMessageId=${targetMessageId ?? 'auto'})`)
      await refreshMenuMediaList()
      await waitMs(0)
      const injected = await injectMediaListIntoLastAssistantMessage(targetMessageId)
      console.log(`${NAME}: media_list injection result: ${injected ? 'success' : 'failed'}`)
      updateStatus(injected ? 'Media list injected into last assistant message' : 'Media list injection failed (assistant message not found)')
      if (injected) {
        emitIntifaceUiAction('media_list')
      }
      return
    }

    if (cmd.type === 'media_play') {
      const filename = String(cmd.filename || '').trim()
      if (!filename) {
        updateStatus('Media play command missing filename', true)
        return
      }
      await loadChatMediaFile(filename)
      return
    }

    if (cmd.type === 'media_stop') {
      await stopMediaPlayback()
      return
    }

    if (cmd.type === 'media_pause' || cmd.type === 'media_resume') {
      const videoEl = document.getElementById('intiface-chat-video-player')
      if (videoEl) {
        if (cmd.type === 'media_pause') {
          await videoEl.pause()
        } else {
          await videoEl.play().catch(() => {})
        }
      }
      return
    }

    if (cmd.type === 'media_intensity') {
      const value = Math.max(0, Math.min(500, Number(cmd.intensity) || 100))
      const intensitySlider = $('#intiface-menu-intensity')
      if (intensitySlider.length > 0) {
        intensitySlider.val(value)
        intensitySlider.trigger('input')
      }
    }
  } catch (e) {
    const action = String(cmd?.type || 'media command').replace('media_', '')
    updateStatus(`Failed media ${action}: ${e?.message || 'unknown error'}`, true)
    console.error(`${NAME}: Media command failed (${cmd?.type}):`, e)
  }
}

async function onStreamTokenReceived(data) {
  if (!aiCommandsEnabled) return

  const chunk = typeof data === 'string' ? data : (data?.text || data?.message || '')
  if (!chunk) return

  const text = String(chunk)

  // SillyTavern emits the whole generated text on STREAM_TOKEN_RECEIVED.
  // Keep the latest full text instead of appending chunks, which causes duplicates.
  if (!lastRawStreamText) {
    streamingText = text
  } else if (text.startsWith(lastRawStreamText)) {
    streamingText = text
  } else if (!streamingText.endsWith(text)) {
    // Fallback for providers that may emit delta-style chunks.
    streamingText += text
  }

  lastRawStreamText = text

  if (!hasPotentialCommandTags(streamingText)) return

  if (aiTtsSyncEnabled) {
    // Chunk-synced mode: parse commands from the live stream so timing offsets
    // are available before spoken chunk events fire.
    const entries = parseTaggedDeviceCommandsWithOffsets(streamingText)
      .filter((entry) => !!entry?.cmd?.type)

    for (const entry of entries) {
      const cmd = entry?.cmd
      if (!cmd) continue
      if (aiStopLatchActive && !isStopCommandType(cmd.type)) continue
      enqueueSpokenSyncCommand(cmd, null, {
        streamLen: streamingText.length,
        requestId: activeTtsRequestId || null,
        messageId: Number.isInteger(activeTtsMessageId) ? activeTtsMessageId : null,
        commandOffset: Number.isFinite(entry?.commandOffset) ? Number(entry.commandOffset) : null,
        sourceText: streamingText,
      })
    }
    return
  }

  const commandEntries = parseDeviceCommands(streamingText).map(cmd => ({ cmd, commandOffset: null }))

  const playerPanel = $("#intiface-chat-media-panel")
  const isMediaPlaying = playerPanel.length > 0 && playerPanel.is(":visible") && mediaPlayer.isPlaying

  for (const entry of commandEntries) {
    const cmd = entry?.cmd
    if (!cmd) continue
    if (aiStopLatchActive && !isStopCommandType(cmd.type)) continue
    const cmdSignature = JSON.stringify({
      type: cmd.type,
      deviceIndex: cmd.deviceIndex,
      modeName: cmd.modeName,
      presetName: cmd.presetName,
      pattern: cmd.pattern,
      intensity: cmd.intensity,
      commandOffset: Number.isFinite(entry?.commandOffset) ? Number(entry.commandOffset) : null,
    })

    if (!seenCommands.has(cmdSignature)) {
      seenCommands.add(cmdSignature)

      if (isSystemCommandType(cmd.type)) {
        console.log(`${NAME}: Deferring system command until final message: ${cmd.type}`)
        continue
      }

      if (isMediaCommandType(cmd.type)) {
        if (cmd.type === 'media_list') {
          console.log(`${NAME}: Deferring media_list injection until CHARACTER_MESSAGE_RENDERED`)
          pendingMediaListFromStream = true
          continue
        }

        console.log(`${NAME}: Deferring media command until final message: ${cmd.type}`)
        continue
      }

      const cmdKey = getImmediateCommandKey(cmd)

      if (!executedCommands.has(cmdKey)) {
        if (isMediaPlaying) {
          if (isStopCommandType(cmd.type)) {
            executedCommands.add(cmdKey)
            armTtsSyncGate()
            messageCommands.push(cmd)
            processCommandQueue()
          } else {
            console.log(`${NAME}: Skipping AI device command - media player is active: ${cmd.type}`)
          }
        } else {
          executedCommands.add(cmdKey)
          armTtsSyncGate()
          messageCommands.push(cmd)
          processCommandQueue()
        }
      }
    }
  }
}

function resolveMessageIdFromEventData(data) {
  if (Number.isInteger(data) && data >= 0) {
    return data
  }

  if (typeof data === 'string') {
    const parsed = Number.parseInt(data, 10)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
  }

  if (data && typeof data === 'object') {
    const candidates = [
      data.index,
      data.messageId,
      data.message_id,
      data.mesId,
      data.mes_id,
      data.id,
    ]

    for (const candidate of candidates) {
      if (Number.isInteger(candidate) && candidate >= 0) {
        return candidate
      }
      if (typeof candidate === 'string') {
        const parsed = Number.parseInt(candidate, 10)
        if (Number.isInteger(parsed) && parsed >= 0) {
          return parsed
        }
      }
    }
  }

  return null
}

function getChatMessages() {
  const context = window.getContext?.()
  if (Array.isArray(context?.chat)) {
    return context.chat
  }
  if (Array.isArray(globalChat)) {
    return globalChat
  }
  return []
}

function getActiveChatIdentity() {
  try {
    const context = window.getContext?.()
    const explicit = String(context?.chatId || context?.chat_id || context?.groupId || context?.group_id || '').trim()
    if (explicit) return explicit

    // Keep fallback identity stable. Using message tail/length causes false
    // "chat changed" events during normal typing/stream updates.
    return 'default_chat'
  } catch (_e) {
    return 'unknown'
  }
}

function isTypingInSendArea() {
  try {
    const active = document.activeElement
    if (!active) return false
    const id = String(active.id || '').trim().toLowerCase()
    const cls = String(active.className || '').toLowerCase()
    if (id === 'send_textarea' || id === 'chat-input' || cls.includes('send_textarea')) {
      return true
    }
    return false
  } catch (_e) {
    return false
  }
}

async function onChatChangedEvent() {
  console.log(`${NAME}: Chat changed`)

  if (isTypingInSendArea()) {
    // Ignore transient chat-changed notifications caused by input focus/draft
    // updates while typing in the send box.
    return
  }

  const nextChatIdentity = getActiveChatIdentity()
  const sameChat = !!lastKnownChatIdentity && lastKnownChatIdentity === nextChatIdentity
  lastKnownChatIdentity = nextChatIdentity

  if (sameChat) {
    // Ignore noisy CHAT_CHANGED events within the same chat session
    // (typing, streaming UI churn, message redraw). Keep prompt fresh only.
    updatePrompt()
    return
  }

  if (sameChat && aiTtsSyncEnabled && (ttsSyncActive || ttsSyncWaitingForStart || pendingSpokenSyncCommands.length > 0)) {
    console.debug(`${NAME}: Chat changed ignored while spoken sync active`, {
      chat: nextChatIdentity,
      waiting: ttsSyncWaitingForStart,
      active: ttsSyncActive,
      queued: pendingSpokenSyncCommands.length,
    })
    updatePrompt()
    return
  }

  clearTtsInterruptGraceTimer()
  resetTtsSyncState()
  clearSpokenSyncQueueState()
  activeTtsRequestId = null
  updatePrompt()
  hideChatMediaPanel()
}

function onDocumentVisibilityChangeEvent() {
  if (document.hidden) {
    console.log(`${NAME}: Tab hidden - switching to background mode`)
  } else {
    console.log(`${NAME}: Tab visible again`)
  }
}

function removeEventSourceListener(eventName, handler) {
  try {
    if (typeof eventSource?.off === 'function') {
      eventSource.off(eventName, handler)
      return
    }
    if (typeof eventSource?.removeListener === 'function') {
      eventSource.removeListener(eventName, handler)
    }
  } catch (_e) {}
}

function bindRuntimeEventListeners() {
  // Ensure singleton listener binding even if extension init runs multiple times.
  removeEventSourceListener(event_types.MESSAGE_RECEIVED, onMessageReceived)
  removeEventSourceListener(event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered)
  removeEventSourceListener(event_types.STREAM_TOKEN_RECEIVED, onStreamTokenReceived)
  removeEventSourceListener(event_types.GENERATION_STARTED, onGenerationStarted)
  removeEventSourceListener(event_types.GENERATION_ENDED, onGenerationEnded)
  removeEventSourceListener('voiceforge_tts_start', onVoiceforgeTtsStart)
  removeEventSourceListener('voiceforge_tts_end', onVoiceforgeTtsEnd)
  removeEventSourceListener('voiceforge_tts_interrupted', onVoiceforgeTtsInterrupted)
  removeEventSourceListener('voiceforge_tts_chunk_start', onVoiceforgeTtsChunkStart)
  removeEventSourceListener(event_types.CHAT_CHANGED, onChatChangedEvent)

  eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived)
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered)
  eventSource.on(event_types.STREAM_TOKEN_RECEIVED, onStreamTokenReceived)
  eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted)
  eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded)
  eventSource.on('voiceforge_tts_start', onVoiceforgeTtsStart)
  eventSource.on('voiceforge_tts_end', onVoiceforgeTtsEnd)
  eventSource.on('voiceforge_tts_interrupted', onVoiceforgeTtsInterrupted)
  eventSource.on('voiceforge_tts_chunk_start', onVoiceforgeTtsChunkStart)
  eventSource.on(event_types.CHAT_CHANGED, onChatChangedEvent)

  document.removeEventListener('visibilitychange', onDocumentVisibilityChangeEvent)
  document.addEventListener('visibilitychange', onDocumentVisibilityChangeEvent)
}

async function onMessageReceived(data, messageType) {
  if (!aiCommandsEnabled) return
  const chunkSyncMode = aiTtsSyncEnabled
  if (chunkSyncMode) {
    if (TARGET_PARSE_DEBUG) {
      console.log(`${NAME}: [parse-debug] parser_mode=chunk (message parser: system/media only)`)
    }
  } else if (TARGET_PARSE_DEBUG) {
    console.log(`${NAME}: [parse-debug] parser_mode=message`)
  }

  const chatMessages = getChatMessages()
  const incomingMessageId = resolveMessageIdFromEventData(data)
  if (!Number.isInteger(incomingMessageId)) return

  const messageId = incomingMessageId

  const message = chatMessages[messageId]

  if (!message || message.is_user) return

  const messageText = message.mes || ''
  if (TARGET_PARSE_DEBUG) {
    const targetSummary = summarizeTargetParsing(messageText)
    console.log(`${NAME}: [parse-debug] source=message`, {
      messageId,
      totalTargets: targetSummary.totalTargets,
      ...targetSummary.counts,
      sampleTargets: targetSummary.sampleTargets,
    })
  }

  let commands = parseDeviceCommands(messageText)

  if (aiStopLatchActive) {
    commands = commands.filter((cmd) => isStopCommandType(cmd?.type) || isSystemCommandType(cmd?.type) || isMediaCommandType(cmd?.type))
  }

  const hasSuspiciousWaveform = commands.some((cmd) => cmd?.type === 'waveform' && String(cmd?.pattern || '').toLowerCase() === 'waveform')
  if (hasSuspiciousWaveform) {
    const repaired = parseTaggedDeviceCommandsWithOffsets(messageText)
      .map((entry) => entry?.cmd)
      .filter((cmd) => !!cmd)
    if (repaired.length > 0) {
      commands = repaired
    }
  }

  if (commands.length === 0) return

  const systemCommands = commands.filter(cmd =>
    isSystemCommandType(cmd.type)
  )
  const mediaCommands = commands.filter(cmd => isMediaCommandType(cmd.type))

  const playerPanel = $("#intiface-chat-media-panel")
  const isMediaPlaying = playerPanel.length > 0 && playerPanel.is(":visible") && mediaPlayer.isPlaying

  const deviceCommandsList = commands.filter(cmd =>
    !isSystemCommandType(cmd.type) &&
    !isMediaCommandType(cmd.type) &&
    (!isMediaPlaying || isStopCommandType(cmd.type))
  )

  const parsedSummary = {
    messageId,
    tags: Array.from(String(messageText || '').matchAll(/<[^>]+>/g)).map((m) => String(m?.[0] || '')).slice(0, 6),
    commands: commands.map(describeCommand),
  }
  console.debug(`${NAME}: Parsed ${commands.length} command(s) from assistant message -> ${JSON.stringify(parsedSummary)}`)

  if (chunkSyncMode) {
    // In VoiceForge/Embody synced mode, STREAM_TOKEN_RECEIVED queues commands
    // and voiceforge_tts_chunk_start releases them. Do not execute a second
    // copy from the rendered final message.
    return
  }

  if (isMediaPlaying && commands.some(cmd =>
    !isSystemCommandType(cmd.type)
  )) {
    console.log(`${NAME}: Skipping AI device commands - media player is active`)
  }

  for (const cmd of systemCommands) {
    const cmdKey = getImmediateCommandKey(cmd)
    if (executedCommands.has(cmdKey)) {
      continue
    }
    executedCommands.add(cmdKey)
    await executeSystemCommand(cmd)
  }

  for (const cmd of mediaCommands) {
    const cmdKey = getImmediateCommandKey(cmd)
    if (executedCommands.has(cmdKey)) {
      continue
    }
    executedCommands.add(cmdKey)
    await executeMediaCommand(cmd, messageId)
  }

  // In chunk-synced mode, device commands are executed from spoken TTS chunk
  // events. Keep message parser for system/media commands only.
  if (chunkSyncMode) {
    return
  }

  const hasNonStopDeviceCommand = deviceCommandsList.some((cmd) => !isStopCommandType(cmd?.type))
  if (!client.connected && deviceCommandsList.length === 0) return
  if (!client.connected && hasNonStopDeviceCommand) {
    const firstType = String(deviceCommandsList[0]?.type || 'device command')
    updateStatus(`Parsed ${deviceCommandsList.length} device command(s) but no Intiface connection (${firstType})`, true)
    setPendingModelRuntimeNotice(`A haptic request was skipped because Intiface is disconnected (first command: ${firstType}).`)
    console.warn(`${NAME}: Parsed device commands but skipped execution because client is not connected`, deviceCommandsList)
    return
  }

  if (!aiTtsSyncEnabled && !mediaPlayer.isPlaying && !document.hidden) {
    messageCommands = []
    executedCommands.clear()
    streamingText = ''

    if (commandQueueInterval) {
      clearWorkerTimeout(commandQueueInterval)
      commandQueueInterval = null
    }

    await stopAllDeviceActions({ silent: true })
  }

  messageCommands = deviceCommandsList.filter(cmd => {
    if (cmd.modeName && !cmd.modeName.includes('_') && cmd.modeName.length < 5) {
      console.log(`${NAME}: Filtering out likely incomplete mode command: ${cmd.modeName}`)
      return false
    }
    return true
  }).map(cmd => ({
    ...cmd,
    char: typeof message?.name === 'string' ? message.name : null,
  }))
  executedCommands = new Set(messageCommands.map(cmd => JSON.stringify(cmd)))

  if (messageCommands.length > 0) {
    armTtsSyncGate()
  }

  processCommandQueue()
}

async function onCharacterMessageRendered(data, messageType) {
  const messageId = resolveMessageIdFromEventData(data)
  if (!Number.isInteger(messageId) || messageId < 0) {
    if (!pendingMediaListFromStream) return
    console.warn(`${NAME}: CHARACTER_MESSAGE_RENDERED missing valid message id for deferred media_list`)
    pendingMediaListFromStream = false
    return
  }

  if (!aiCommandsEnabled || !pendingMediaListFromStream) return

  const chatMessages = getChatMessages()

  const message = chatMessages[messageId]
  if (!message || message.is_user) {
    pendingMediaListFromStream = false
    return
  }

  console.log(`${NAME}: Consuming deferred media_list on CHARACTER_MESSAGE_RENDERED for message #${messageId} (type=${messageType || 'unknown'}, is_system=${!!message.is_system})`)
  pendingMediaListFromStream = false
  await executeMediaCommand({ type: 'media_list' }, messageId)
}

function onGenerationStarted() {
  clearAiStopLatch()
  const preserveSpokenSync = aiCommandsEnabled && aiTtsSyncEnabled && (ttsSyncActive || ttsSyncWaitingForStart || pendingSpokenSyncCommands.length > 0)
  executedCommands.clear()
  seenCommands.clear()
  messageCommands = []
  streamingText = ''
  lastRawStreamText = ''

  if (!preserveSpokenSync) {
    clearSpokenSyncQueueState()
    resetTtsSyncState()
  } else {
    console.debug(`${NAME}: [chunk-sync] preserving spoken sync state on new generation`, {
      waiting: ttsSyncWaitingForStart,
      active: ttsSyncActive,
      queued: pendingSpokenSyncCommands.length,
      activeTtsRequestId,
    })
  }
}

function onGenerationEnded() {
  if (!aiCommandsEnabled) return

  streamingText = ''
  lastRawStreamText = ''
  seenCommands.clear()
  processCommandQueue()
}

async function onVoiceforgeTtsStart(payload) {
  if (!aiCommandsEnabled) return

  if (!aiTtsSyncEnabled) return

  // Call mode may not emit GENERATION_STARTED for every utterance.
  // Clear STOP latch on a fresh TTS start so new haptic sync can resume.
  clearAiStopLatch()

  clearTtsInterruptGraceTimer()

  const req = String(payload?.requestId || payload?.request_id || '').trim()
  const previousRequestId = activeTtsRequestId
  const previousMessageId = activeTtsMessageId
  activeTtsRequestId = req || null
  const payloadMessageIdCandidates = [
    payload?.messageIdResolved,
    payload?.messageId,
    payload?.message_id,
    payload?.mesId,
    payload?.mes_id,
    payload?.id,
  ]
  let payloadMessageId = null
  for (const candidate of payloadMessageIdCandidates) {
    if (Number.isInteger(candidate)) {
      payloadMessageId = candidate
      break
    }
    if (typeof candidate === 'string') {
      const parsed = Number.parseInt(candidate, 10)
      if (Number.isInteger(parsed)) {
        payloadMessageId = parsed
        break
      }
    }
  }
  let nextActiveMessageId = Number.isInteger(payloadMessageId) ? payloadMessageId : null
  if (
    previousRequestId &&
    activeTtsRequestId &&
    previousRequestId === activeTtsRequestId &&
    Number.isInteger(previousMessageId) &&
    Number.isInteger(nextActiveMessageId) &&
    nextActiveMessageId < previousMessageId
  ) {
    nextActiveMessageId = previousMessageId
  }
  activeTtsMessageId = nextActiveMessageId

  // Do not hard-stop on new TTS request start. Let the previous motion continue
  // until the next command is actually ready to execute, which avoids dead-air
  // haptic gaps between utterances.

  console.debug(`${NAME}: [chunk-sync] tts_start ids`, {
    requestId: activeTtsRequestId,
    activeTtsMessageId,
    payloadMessageIdRaw: payload?.messageId ?? payload?.message_id ?? null,
  })

  const messageId = Number.isInteger(payload?.messageId) ? payload.messageId : 'unknown'
  const mode = payload?.mode || 'unknown'
  console.log(`${NAME}: VoiceForge TTS started (message=${messageId}, mode=${mode})`)
  if (TARGET_PARSE_DEBUG) {
    console.log(`${NAME}: [parse-debug] parser_mode=chunk`, {
      requestId: activeTtsRequestId,
      messageId: activeTtsMessageId,
    })
  }

  if (ttsSyncWaitingForStart) {
    releaseTtsSyncGate('tts')
  } else {
    ttsSyncActive = true
    ttsSyncLastReleaseSource = 'tts'
    updateAIStatusFromActivity()
  }

}

async function onVoiceforgeTtsEnd(payload) {
  if (!aiTtsSyncEnabled) return
  clearTtsInterruptGraceTimer()
  await flushPendingSpokenSyncCommands('tts_end')
  ttsSyncActive = false
  clearSpokenSyncQueueState()
  activeTtsRequestId = null
  activeTtsMessageId = null
  updateAIStatusFromActivity()
}

async function onVoiceforgeTtsInterrupted(payload = {}) {
  if (!aiCommandsEnabled || !aiTtsSyncEnabled) return

  const policy = aiTtsInterruptPolicy || 'grace'
  if (policy === 'preserve') {
    return
  }

  clearTtsInterruptGraceTimer()
  ttsSyncActive = false
  updateAIStatusFromActivity()

  if (policy === 'flush') {
    clearSpokenSyncQueueState()
    activeTtsRequestId = null
    activeTtsMessageId = null
    return
  }

  ttsInterruptGraceTimeoutId = setWorkerTimeout(() => {
    ttsInterruptGraceTimeoutId = null
    clearSpokenSyncQueueState()
    activeTtsRequestId = null
    activeTtsMessageId = null
    updateAIStatusFromActivity()
  }, 240)
}

async function executeNextSpokenSyncCommand(payload = {}, source = 'unknown') {
  const messageId = payload?.messageIdResolved ?? payload?.messageId ?? null
  const requestId = payload?.requestId ?? null
  const sequence = payload?.sequence ?? null
  const sourceStart = Number.isFinite(payload?.sourceStart) ? Number(payload.sourceStart) : null
  const sourceEnd = Number.isFinite(payload?.sourceEnd) ? Number(payload.sourceEnd) : null
  const subtitleChunkIndex = Number.isFinite(payload?.subtitleChunkIndex) ? Number(payload.subtitleChunkIndex) : null
  const rawChunkIndex = Number.isFinite(payload?.rawChunkIndex) ? Number(payload.rawChunkIndex) : null

  if (CHUNK_SYNC_DEBUG) {
    console.debug(`${NAME}: [chunk-sync] tick`, {
      source,
      requestId,
      messageId,
      sequence,
      subtitleChunkIndex,
      rawChunkIndex,
      sourceStart,
      sourceEnd,
      queueSize: pendingSpokenSyncCommands.length,
    })
  }

  let rawCmd = dequeueSpokenSyncCommandForPayload(payload)

  if (!rawCmd) {
    if (pendingSpokenSyncCommands.length > 0) {
      if (CHUNK_SYNC_DEBUG) {
        console.debug(`${NAME}: [chunk-sync] no eligible command yet`, {
          source,
          requestId,
          sourceStart,
          sourceEnd,
          queueSize: pendingSpokenSyncCommands.length,
        })
      }
    }
    return
  }

  const cmdKey = rawCmd?._execKey || getImmediateCommandKey(rawCmd)
  if (executedCommands.has(cmdKey)) {
    if (CHUNK_SYNC_DEBUG) {
      console.debug(`${NAME}: [chunk-sync] skipped duplicate`, {
        source,
        type: rawCmd?.type,
        requestId,
        messageId,
      })
    }
    return
  }

  if (aiTtsSyncOffsetMs > 0) {
    await waitMs(aiTtsSyncOffsetMs)
  }

  if (isSystemCommandType(rawCmd?.type)) {
    if (CHUNK_SYNC_DEBUG) {
      console.debug(`${NAME}: [chunk-sync] executing system`, {
        traceId: rawCmd?._traceId || null,
        type: rawCmd?.type,
        requestId,
        messageId,
      })
    }
    const syncCmd = {
      ...rawCmd,
      traceId: rawCmd?._traceId || null,
      requestId: requestId || rawCmd?.requestId || null,
      messageId: Number.isInteger(messageId) ? messageId : (Number.isInteger(rawCmd?.messageId) ? rawCmd.messageId : null),
      char: typeof payload?.char === 'string' ? payload.char : (rawCmd?.char || null),
    }
    executedCommands.add(cmdKey)
    executedCommands.add(getImmediateCommandKey(rawCmd))
    await executeSystemCommand(syncCmd)
    spokenSyncLastExecutionAt = Date.now()
    return
  }

  if (isMediaCommandType(rawCmd?.type)) {
    if (CHUNK_SYNC_DEBUG) {
      console.debug(`${NAME}: [chunk-sync] executing media`, {
        traceId: rawCmd?._traceId || null,
        type: rawCmd?.type,
        requestId,
        messageId,
      })
    }
    const syncCmd = {
      ...rawCmd,
      traceId: rawCmd?._traceId || null,
      requestId: requestId || rawCmd?.requestId || null,
      messageId: Number.isInteger(messageId) ? messageId : (Number.isInteger(rawCmd?.messageId) ? rawCmd.messageId : null),
      char: typeof payload?.char === 'string' ? payload.char : (rawCmd?.char || null),
    }
    executedCommands.add(cmdKey)
    executedCommands.add(getImmediateCommandKey(rawCmd))
    await executeMediaCommand(syncCmd, Number.isInteger(syncCmd?.messageId) ? syncCmd.messageId : null)
    spokenSyncLastExecutionAt = Date.now()
    return
  }

  if (isStopCommandType(rawCmd?.type)) {
    const syncCmd = {
      ...rawCmd,
      traceId: rawCmd?._traceId || null,
      requestId: requestId || rawCmd?.requestId || null,
      messageId: Number.isInteger(messageId) ? messageId : (Number.isInteger(rawCmd?.messageId) ? rawCmd.messageId : null),
      char: typeof payload?.char === 'string' ? payload.char : (rawCmd?.char || null),
    }
    executedCommands.add(cmdKey)
    executedCommands.add(getImmediateCommandKey(rawCmd))
    await executeStopCommand(syncCmd)
    spokenSyncLastExecutionAt = Date.now()
    return
  }

  if (aiStopLatchActive) {
    return
  }

  if (!client.connected) {
    setPendingModelRuntimeNotice(`A haptic request was skipped because Intiface is disconnected (command: ${String(rawCmd?.type || 'unknown')}).`)
    console.warn(`${NAME}: [chunk-sync] command skipped (not connected): ${rawCmd?.type || 'unknown'}`)
    // Do not drop spoken commands while a connect/scan command is still in flight.
    // Keep command queued so it can execute once the socket becomes available.
    requeueSpokenSyncCommandFront(rawCmd)
    return
  }

  executedCommands.add(cmdKey)
  executedCommands.add(getImmediateCommandKey(rawCmd))
  console.debug(`${NAME}: [chunk-sync] executing`, {
    traceId: rawCmd?._traceId || null,
    source,
    type: rawCmd?.type,
    resolvedTarget: classifyResolvedTargetFromCommand(rawCmd),
    requestId,
    messageId,
    subtitleChunkIndex,
    sourceStart,
    sourceEnd,
  })

  const syncCmd = {
    ...rawCmd,
    traceId: rawCmd?._traceId || null,
    requestId: requestId || rawCmd?.requestId || null,
    messageId: Number.isInteger(messageId) ? messageId : (Number.isInteger(rawCmd?.messageId) ? rawCmd.messageId : null),
    char: typeof payload?.char === 'string' ? payload.char : (rawCmd?.char || null),
  }

  const expandedCommands = expandCommandTargetsForExecution(syncCmd)
  if (expandedCommands.length === 0) {
    if (CHUNK_SYNC_DEBUG) {
      console.debug(`${NAME}: [chunk-sync] no target devices for command`, {
        traceId: rawCmd?._traceId || null,
        type: rawCmd?.type,
        targetChannel: resolveTargetChannelFromCommand(rawCmd),
      })
    }
    return
  }

  clearPendingModelRuntimeNotice()
  for (let i = 0; i < expandedCommands.length; i++) {
    const expandedCmd = expandedCommands[i]
    const cmdForExecution = i === 0 ? expandedCmd : { ...expandedCmd, _skipSyncStartLead: true }
    await executeCommand(cmdForExecution)
  }
  spokenSyncLastExecutionAt = Date.now()
}

async function onVoiceforgeTtsChunkStart(payload) {
  if (!aiCommandsEnabled || !aiTtsSyncEnabled) return

  const payloadRequestId = String(payload?.requestId || payload?.request_id || '').trim()
  if (activeTtsRequestId && payloadRequestId && payloadRequestId !== activeTtsRequestId) {
    return
  }

  const dedupeKey = [
    String(payload?.requestId || ''),
    String(payload?.sequence ?? ''),
    String(payload?.segmentId ?? ''),
    String(payload?.sourceStart ?? ''),
    String(payload?.sourceEnd ?? ''),
  ].join('|')
  if (dedupeKey && dedupeKey === spokenSyncLastChunkStartKey) {
    return
  }
  spokenSyncLastChunkStartKey = dedupeKey

  await executeNextSpokenSyncCommand(payload || {}, 'received tts chunk start')
}

// Device connection lifecycle is owned by connected_devices.js

// ==========================================
// PROMPT GENERATION
// ==========================================

let lastPromptHash = ''
let promptUpdateTimer = null

function buildDynamicPromptContext() {
  const connectedDevices = (client?.connected || isClientConnected()) ? devices : []
  const deviceNames = connectedDevices.map((dev) => getDeviceDisplayName(dev)).filter(Boolean)

  let enabledModes = PlayModeLoader?.getEnabledModes ? PlayModeLoader.getEnabledModes() : []

  // Prefer the live UI toggle state when available so prompt injection matches
  // exactly what the user has currently enabled in the checkboxes.
  const allUiToggleModes = $('.playmode-toggle')
  const uiEnabledModes = $('.playmode-toggle:checked').map(function () {
    return String($(this).data('mode') || '')
  }).get().filter(Boolean)

  if (allUiToggleModes.length > 0) {
    enabledModes = ['basic', ...uiEnabledModes.filter((id) => id !== 'basic')]
  }

  enabledModes = [...new Set(enabledModes)]

  const uniquePatterns = new Set()

  enabledModes.forEach((modeId) => {
    const sequences = PlayModeLoader?.getSequencesForMode ? PlayModeLoader.getSequencesForMode(modeId) : {}
    const patterns = PlayModeLoader?.getPatternsForMode ? PlayModeLoader.getPatternsForMode(modeId) : {}

    Object.keys(patterns || {}).forEach((patternName) => uniquePatterns.add(patternName))

  })

  const patternNames = [...uniquePatterns].sort((a, b) => a.localeCompare(b))
  const patternList = patternNames.join(', ')

  return {
    connectedDevices,
    deviceNames,
    patternNames,
    patternList,
    patternExample: patternNames[0] ? `<any:WAVEFORM: ${patternNames[0]}>` : null,
  }
}

function getVisibleMediaFilenames() {
  return $('#intiface-menu-media-list .menu-media-file-item').map(function () {
    return String($(this).data('filename') || '').trim()
  }).get().filter(Boolean)
}

async function injectMediaListIntoLastAssistantMessage(targetMessageId = null) {
  const mediaNames = getVisibleMediaFilenames()
  const chat = getChatMessages()
  if (!Array.isArray(chat) || chat.length === 0) {
    return false
  }

  let lastMessageIndex = -1

  if (Number.isInteger(targetMessageId) && targetMessageId >= 0 && targetMessageId < chat.length) {
    const targetMessage = chat[targetMessageId]
    if (targetMessage && !targetMessage.is_user) {
      lastMessageIndex = targetMessageId
    }
  }

  if (lastMessageIndex < 0) {
    lastMessageIndex = chat.length - 1
    while (lastMessageIndex >= 0 && chat[lastMessageIndex]?.is_user) {
      lastMessageIndex--
    }
  }

  if (lastMessageIndex < 0) {
    return false
  }

  const lastMessage = chat[lastMessageIndex]
  const existingText = String(lastMessage?.mes || '')
  const mediaBlockLabel = 'INTIFACE MEDIA LIBRARY'
  const stripPattern = /\n?```(?:\w+)?\nINTIFACE MEDIA LIBRARY[\s\S]*?\n```\n?/g
  const stripped = existingText.replace(stripPattern, '').trimEnd()

  const sortedMediaNames = [...mediaNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  const lines = sortedMediaNames.length > 0
    ? sortedMediaNames.map((name, idx) => `${String(idx + 1).padStart(2, '0')}. ${name}`)
    : ['(no media files found in assets/intiface/media)']

  const block = `\`\`\`text\n${mediaBlockLabel}\nCount: ${sortedMediaNames.length}\n\n${lines.join('\n')}\n\`\`\``
  const nextText = `${stripped}\n\n${block}`

  if (nextText === existingText) {
    return true
  }

  lastMessage.mes = nextText
  if (lastMessage.extra && typeof lastMessage.extra === 'object' && typeof lastMessage.extra.display_text === 'string') {
    lastMessage.extra.display_text = nextText
  }
  if (Array.isArray(lastMessage.swipes) && typeof lastMessage.swipe_id === 'number' && lastMessage.swipe_id >= 0 && lastMessage.swipe_id < lastMessage.swipes.length) {
    lastMessage.swipes[lastMessage.swipe_id] = nextText
  }

  updateMessageBlock(lastMessageIndex, lastMessage)

  saveChatDebounced()
  await eventSource.emit(event_types.MESSAGE_UPDATED, lastMessageIndex)
  return true
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hashPrompt(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(16)
}

function updatePrompt() {
  if (promptUpdateTimer) {
    clearTimeout(promptUpdateTimer)
  }
  promptUpdateTimer = setTimeout(() => actuallyUpdatePrompt(), 100)
}

function actuallyUpdatePrompt() {
  try {
    if (!aiCommandsEnabled) {
      setExtensionPrompt('intiface_control', '', extension_prompt_types.IN_PROMPT, 2, true, extension_prompt_roles.SYSTEM)
      if (lastPromptHash !== '__disabled__') {
        console.log(`${NAME}: Extension prompt disabled`)
      }
      lastPromptHash = '__disabled__'
      return
    }

    const exePath = localStorage.getItem("intiface-exe-path")
    const canStartIntiface = !!exePath
    const {
      connectedDevices,
      deviceNames,
      patternList,
      patternExample,
    } = buildDynamicPromptContext()
    const isConnected = !!(client?.connected || isClientConnected())
    const connectionState = isConnected ? 'connected' : 'disconnected'
    const hasDevices = connectedDevices.length > 0
    const deviceTypeTokens = [...new Set(connectedDevices.map((dev) => getDeviceType(dev)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .map((type) => `INTIFACE_TYPE:${String(type).toLowerCase()}`)

    const deviceLine = deviceNames.length > 0 ? deviceNames.join(', ') : 'none'
    const patternExampleLine = patternExample || ''
    const runtimeNotice = pendingModelRuntimeNotice

    const commandExamples = [
      '<media:LIST>',
      '<media:PLAY: filename.mp4>',
      '<any:STOP>',
    ]

    const needsInterfaceBootstrap = !isConnected || connectedDevices.length === 0

    if (needsInterfaceBootstrap) {
      commandExamples.unshift('<interface:SCAN>')
      commandExamples.unshift('<interface:CONNECT>')
      if (canStartIntiface) {
        commandExamples.unshift('<interface:START>')
      }
      commandExamples.push('<interface:DISCONNECT>')
    }

    if (connectedDevices.length > 0) {
      commandExamples.push('<any:VIBRATE: 50>')
      commandExamples.push('<A:OSCILLATE: 75>')
      commandExamples.push('<B:LINEAR: start=0, end=100, duration=1000>')
      if (patternExampleLine) {
        commandExamples.push(patternExampleLine)
      }
    }

    const modeSectionText = connectedDevices.length > 0
      ? `Target aliases: any=all channels, A/B/C/D=channels\n\nAvailable waveform patterns: ${patternList || 'none'}`
      : `Target aliases: any=all channels, A/B/C/D=channels\n\nAvailable waveform patterns: ${patternList || 'none'}`

    const prompt = `=== DEVICE CONTROL ACTIVE ===

Connection state: ${connectionState}
Connected devices: ${connectedDevices.length}
Device names: ${deviceLine}
${canStartIntiface ? 'Intiface Central startup command is available (<interface:START>).' : 'Startup command disabled (set Intiface executable path to enable <interface:START>).'}
${runtimeNotice ? `Runtime notice: ${runtimeNotice}` : 'Runtime notice: none'}

Runtime tokens:
- INTIFACE_AI:on
- INTIFACE_CONN:${connectionState}
- INTIFACE_HAS_DEVICES:${hasDevices ? 'yes' : 'no'}
- INTIFACE_DEVICE_COUNT:${connectedDevices.length}
- INTIFACE_DISCONNECT_REASON:${lastDisconnectReason}
${deviceTypeTokens.length > 0 ? `- ${deviceTypeTokens.join('\n- ')}` : '- INTIFACE_TYPE:none'}

${modeSectionText}

Use commands like:
${commandExamples.map((line) => `- ${line}`).join('\n')}

Rules:
- If no devices are connected, prefer interface/media commands (connect/scan/start/play/stop).
- Use device and waveform commands only when at least one device is connected.
- If Connected devices is greater than 0 and INTIFACE_CONN is connected, Intiface is already ready.
- When Intiface is already ready, never emit <interface:START>, <interface:CONNECT>, or <interface:SCAN> unless the user explicitly asks for those actions.
- If the user requests haptics/device motion while disconnected or with zero devices, your visible reply must first acknowledge this explicitly (short plain sentence), then offer reconnect/scan action.
- Never imply that haptics/device motion executed when disconnected or with zero devices.
- If Runtime notice is not "none", your next visible reply must start by acknowledging that notice in one short sentence before any other content.
- Commands are hidden from the user and execute instantly.`

    const promptHash = hashPrompt(prompt)
    const promptChanged = promptHash !== lastPromptHash
    try {
      // Always re-apply. This self-heals if another extension lifecycle wipes prompt state.
      setExtensionPrompt('intiface_control', prompt, extension_prompt_types.IN_PROMPT, 2, true, extension_prompt_roles.SYSTEM)

      if (promptChanged) {
        lastPromptHash = promptHash
        console.log(`${NAME}: Extension prompt updated`)
      }

      if (promptChanged) {
        Promise.resolve(getExtensionPromptByName('intiface_control')).then((value) => {
          const len = String(value || '').trim().length
          console.debug(`${NAME}: Prompt verify intiface_control length=${len}`)
        }).catch(() => {})
      }
    } catch (err) {
      console.error(`${NAME}: Failed to set extension prompt:`, err)
    }
  } catch (e) {
    console.error(`${NAME}: updatePrompt() crashed:`, e)
  }
}

// ==========================================
// INITIALIZATION
// ==========================================

let currentPatternCategory = 'basic'

function setActivePlayModeTab(category) {
  $('.playmode-tab').removeClass('active').css('background', '')
  const activeTab = $(`#intiface-tab-${category}`)
  if (activeTab.length) {
    activeTab.addClass('active').css('background', 'rgba(100,150,255,0.3)')
  }
}

function renderPlayModeUI() {
  if (!PlayModeLoader?.generateTabsHTML) return

  const tabsContainer = $('#intiface-playmode-tabs-container')
  const togglesContainer = $('#intiface-playmode-toggles-container')
  const intensityContainer = $('#intiface-playmode-intensity-container')

  tabsContainer.html(PlayModeLoader.generateTabsHTML())
  togglesContainer.html(PlayModeLoader.generateTogglesHTML())
  intensityContainer.html(PlayModeLoader.generateIntensityHTML())

  const enabledModes = new Set(PlayModeLoader.getEnabledModes())
  if (currentPatternCategory !== 'basic' && !enabledModes.has(currentPatternCategory)) {
    currentPatternCategory = 'basic'
  }

  setActivePlayModeTab(currentPatternCategory)
}

async function populatePatternButtons() {
  const container = $('#intiface-pattern-buttons')
  container.empty()

  if (!PlayModeLoader?.getEnabledSequences) {
    container.html('<div style="color: #666; font-size: 0.8em; width: 100%; text-align: center; padding: 20px;">Loading modes...</div>')
    return
  }

  // Get patterns for current category
  let presets = {}

    if (currentPatternCategory === 'basic') {
      const basicPatterns = PlayModeLoader.getPatternsForMode('basic') || {}
      Object.keys(basicPatterns).forEach(patternName => {
        presets[patternName] = {
          type: 'waveform',
          pattern: patternName
        }
      })
    } else {
    const modeId = currentPatternCategory
    const modeSequences = PlayModeLoader.getSequencesForMode(modeId)
    if (modeSequences) {
      for (const [seqName, seqData] of Object.entries(modeSequences)) {
        presets[seqName] = {
          type: 'sequence',
          sequence: seqData.steps,
          repeat: seqData.repeat !== false,
          description: seqData.description || seqName
        }
      }
    }

    const modePatterns = PlayModeLoader.getPatternsForMode(modeId)
    if (modePatterns) {
      Object.entries(modePatterns).forEach(([patternName, patternFunc]) => {
        presets[patternName] = {
          type: 'waveform',
          pattern: patternName
        }
      })
    }
  }

  Object.entries(presets).forEach(([key, preset]) => {
    const displayName = key.replace(/_/g, ' ')
    const btn = $(`
      <button class="menu_button pattern-btn" data-pattern="${key}" data-category="${currentPatternCategory}"
        title="${displayName} - Click to add to scene"
        style="padding: 6px 12px; font-size: 0.75em; border-radius: 4px;">
        ${displayName}
      </button>
    `)
    btn.on('click', () => selectPatternForTimeline(key, currentPatternCategory))
    container.append(btn)
  })

  if (Object.keys(presets).length === 0) {
    container.html('<div style="color: #666; font-size: 0.8em; width: 100%; text-align: center; padding: 20px;">No patterns available for this category</div>')
  }
}

$(document).off('click.intifacePlayModeTabs', '.playmode-tab').on('click.intifacePlayModeTabs', '.playmode-tab', function() {
  const category = $(this).data('category')
  if (!category) return
  currentPatternCategory = category
  setActivePlayModeTab(category)
  populatePatternButtons()
})

$(document).off('change.intifacePlayModeToggles', '.playmode-toggle').on('change.intifacePlayModeToggles', '.playmode-toggle', function() {
  const modeId = $(this).data('mode')
  if (!modeId || !PlayModeLoader?.setModeEnabled) return
  PlayModeLoader.setModeEnabled(modeId, $(this).is(':checked'))
  renderPlayModeUI()
  populatePatternButtons()
  updatePrompt()
})

$(document).off('input.intifacePlayModeIntensity', '[id^="intiface-mode-intensity-"]').on('input.intifacePlayModeIntensity', '[id^="intiface-mode-intensity-"]', function() {
  const modeId = $(this).data('mode')
  if (!modeId || !PlayModeLoader?.setIntensityMultiplier) return
  const value = Math.max(50, Math.min(400, parseInt($(this).val(), 10) || 100))
  PlayModeLoader.setIntensityMultiplier(modeId, value / 100)
  $(`#${$(this).attr('id')}-display`).text(`${value}%`)
})

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = url
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
}

$(async () => {
  try {
    if (typeof window !== 'undefined') {
      // Intiface consumes VoiceForge sync exclusively through eventSource.
      // Clear legacy direct bridge hooks to avoid duplicate handler paths.
      window.intifaceOnVoiceforgeTtsChunkStart = null
      window.intifaceOnVoiceforgeTtsSpokenText = null
    }

    // Load buttplug library
    await loadScript(`/scripts/extensions/third-party/${extensionName}/lib/buttplug.js`)
    buttplug = window.buttplug

    // Initialize timer worker
    initTimerWorker()

    // Load settings
    loadGlobalInvert()
    loadDevicePollingRate()
    loadAICommandsEnabled()
    loadAITtsSyncSettings()
    loadDebugLoggingSetting()

    // Create client
    client = new buttplug.ButtplugClient("SillyTavern Intiface Client")

    // Clear stale state
    devices = []
    window.devices = devices
    device = null
    activePatterns.clear()

    // Initialize universal sync
    initSync(devicePollingRate)

    // Initialize device execution module
    initDeviceExecution({
      NAME,
      client,
      devices,
      getConnectedDevices,
      buttplug,
      deviceAssignments,
      globalIntensityScale,
      globalInvert,
      updateStatus,
      updateAIStatusFromActivity,
      emitPlaybackEvent: emitIntifaceDevicePlaybackEvent,
      getSyncStartEventLeadMs: () => aiSyncStartLeadMs,
      clearWorkerTimeout,
      setWorkerTimeout,
      setWorkerInterval
    })

    // Initialize media module
    initMediaModule({
      NAME,
      client,
      devices,
      getConnectedDevices,
      getDeviceChannel,
      deviceAssignments,
      buttplug,
      updateStatus,
      updateAIStatusFromActivity,
      stopAllDeviceActions,
      clearWorkerTimeout,
      getPollingInterval,
      getDeviceType,
      getDeviceDefaultIntensity,
      applyInversion,
      getRequestHeaders,
      aiGenerateRaw: generateRaw,
      messageCommands,
      PlayModeLoader,
      startSync,
      pauseSync,
      resumeSync,
      stopSync,
      stopAllSync
    })

// Set parser name
setParserName(NAME)

// Load UI template from combined settings
const settingsHtml = $(await renderExtensionTemplateAsync(`third-party/Extension-Embody`, "settings"))
const intifaceSettings = settingsHtml.filter('#embody-intiface-settings').length
  ? settingsHtml.filter('#embody-intiface-settings')
  : settingsHtml.find('#embody-intiface-settings')
const template = intifaceSettings.children().first()
const embodyPanel = $('#embody-intiface-panel')
if (embodyPanel.length) {
  const drawerContent = template.hasClass('drawer') ? template.find('.drawer-content').children() : template
  embodyPanel.empty().append(drawerContent)
} else {
  $("#extensions-settings-button").after(template)
}
initializeIntifaceEmbodyTheme()

// Initialize connected devices module (requires template in DOM)
await initConnectedDevices(client, buttplug)

onDeviceChange(({ devices: currentDevices }) => {
  devices = currentDevices
  if (typeof window !== 'undefined') {
    window.devices = currentDevices
  }

  const nextAssignments = {}
  currentDevices.forEach((_, index) => {
    nextAssignments[index] = getDeviceChannel(index)
  })
  deviceAssignments = nextAssignments
  updatePrompt()
})

// Initialize media player (must be after template is loaded)
initMediaPlayer()

// Initialize timeline module (must be after template is loaded)
initTimelineModule({
  NAME,
  devices: window.devices,
  getConnectedDevices,
  deviceAssignments,
  buttplug,
  PlayModeLoader,
  updateStatus,
  stopAllDeviceActions,
  applyIntensityScale,
  applyInversion,
  getMotorCount: getDeviceMotorCount,
  getPollingInterval,
  executePattern,
  clearWorkerTimeout,
  startSync,
  pauseSync,
  resumeSync,
  stopSync
})

// Apply click handler hack for drawer toggle
function clickHandlerHack() {
  try {
    const element = document.querySelector("#extensions-settings-button .drawer-toggle")
    if (element) {
      const events = $._data(element, "events")
      if (events && events.click && events.click[0]) {
        const doNavbarIconClick = events.click[0].handler
        $("#intiface-connect-button .drawer-toggle").on("click", doNavbarIconClick)
      }
    }
  } catch (error) {
    console.error(`${NAME}: Failed to apply click handler hack.`, error)
  }
}
clickHandlerHack()

// Setup event handlers

// Connect button handled by connected_devices module
$(document).off('click.intifaceDisconnectIntent', '#intiface-connect-action-button').on('click.intifaceDisconnectIntent', '#intiface-connect-action-button', function() {
  if (client?.connected || isClientConnected()) {
    lastUiDisconnectIntentAt = Date.now()
  }
})

// Play Mode Menu toggle (main play mode section)
$("#intiface-playmode-menu-toggle").on("click", function() {
  const content = $("#intiface-playmode-menu-content")
  const arrow = $("#intiface-playmode-menu-arrow")
  if (content.is(":visible")) {
    content.slideUp(200)
    arrow.css("transform", "rotate(0deg)")
  } else {
    content.slideDown(200)
    arrow.css("transform", "rotate(180deg)")
  }
})

// AI Modes toggle (sub-section)
$("#intiface-ai-modes-toggle").on("click", function() {
  const content = $("#intiface-ai-modes-content")
  const arrow = $("#intiface-ai-modes-arrow")
  if (content.is(":visible")) {
    content.slideUp(200)
    arrow.css("transform", "rotate(0deg)")
  } else {
    content.slideDown(200)
    arrow.css("transform", "rotate(180deg)")
  }
})

// Mode Builder toggle
$("#intiface-mode-builder-toggle").on("click", function() {
  const content = $("#intiface-mode-builder-content")
  const arrow = $("#intiface-mode-builder-arrow")
  if (content.is(":visible")) {
    content.slideUp(200)
    arrow.css("transform", "rotate(0deg)")
  } else {
    content.slideDown(200)
    arrow.css("transform", "rotate(180deg)")
  }
})

// Mode Intensity toggle
$("#intiface-intensity-toggle").on("click", function() {
  const content = $("#intiface-intensity-content")
  const arrow = $("#intiface-intensity-arrow")
  if (content.is(":visible")) {
    content.slideUp(200)
    arrow.css("transform", "rotate(0deg)")
  } else {
    content.slideDown(200)
    arrow.css("transform", "rotate(180deg)")
  }
})

// Note: Media Library and Funscript menu toggles are handled in media_playback.js

// Advanced Configuration toggle
$("#intiface-advanced-toggle").on("click", function() {
  const content = $("#intiface-advanced-content")
  const arrow = $("#intiface-advanced-arrow")
  if (content.is(":visible")) {
    content.slideUp(200)
    arrow.removeClass("expanded")
  } else {
    content.slideDown(200)
    arrow.addClass("expanded")
  }
})

// Pattern configuration sliders
$("#intiface-pattern-duration").on("input", function() {
  const val = parseInt($(this).val())
  $("#intiface-pattern-duration-display").text(`${(val/1000).toFixed(1)}s`)
})

$("#intiface-pattern-min").on("input", function() {
  const val = parseInt($(this).val())
  $("#intiface-pattern-min-display").text(`${val}%`)
})

$("#intiface-pattern-max").on("input", function() {
  const val = parseInt($(this).val())
  $("#intiface-pattern-max-display").text(`${val}%`)
})

$("#intiface-pattern-cycles").on("input", function() {
  const val = parseInt($(this).val())
  $("#intiface-pattern-cycles-display").text(val)
})

// Timeline controls
$("#intiface-timeline-play").on("click", async function() {
  if (typeof playTimeline === 'function') {
    await playTimeline()
  }
})

$("#intiface-timeline-pause").on("click", async function() {
  if (typeof pauseTimeline === 'function') {
    await pauseTimeline()
  }
})

$("#intiface-timeline-clear").on("click", function() {
  if (typeof clearTimeline === 'function') {
    clearTimeline()
  }
})

// Reset mode intensities button
$("#intiface-reset-mode-intensities").on("click", function() {
  if (PlayModeLoader && PlayModeLoader.getAllModes) {
    const modes = PlayModeLoader.getAllModes()
    Object.keys(modes).forEach(modeId => {
      if (modeId !== 'basic') {
        PlayModeLoader.setIntensityMultiplier(modeId, 1.0)
      }
    })
    
    // Update all intensity sliders
    $('[id^="intiface-mode-intensity-"]').each(function() {
      const modeId = $(this).data('mode')
      if (modeId && modeId !== 'basic') {
        $(this).val(100)
        $(`#${$(this).attr('id')}-display`).text('100%')
      }
    })
    
    console.log(`${NAME}: Reset all mode intensities to 100%`)
  }
})

// Saved connection settings are handled by connected_devices module

    // Intiface executable path (for AI auto-start)
    loadExePath()
    $("#intiface-exe-path").on('input', function () {
      saveExePath($(this).val())
    })
    $("#intiface-exe-browse").on('click', async function () {
      await browseExePath()
    })

    // AI command toggle
    $("#intiface-ai-enabled").prop('checked', aiCommandsEnabled)
    $("#intiface-ai-enabled").on('change', async function() {
      const enabled = $(this).is(':checked')
      saveAICommandsEnabled(enabled)

      if (!enabled) {
        messageCommands = []
        executedCommands.clear()
        seenCommands.clear()
        streamingText = ''
        pendingSpokenSyncCommands = []
        pendingSpokenSyncKeys.clear()
        spokenSyncQueuedKeysEver.clear()
        spokenSyncSeenCommandSignaturesByRequest.clear()
        spokenSyncLastChunkStartKey = ''
        activeTtsRequestId = null
        resetTtsSyncState()
        if (commandQueueInterval) {
          clearWorkerTimeout(commandQueueInterval)
          commandQueueInterval = null
        }
        await stopAllDeviceActions({ silent: true })
      }

      lastPromptHash = ''
      updatePrompt()
      if (enabled) {
        await ensureIntifaceDeviceLorebook()
      }
      updateAIStatusFromActivity()
      updateStatus(enabled ? 'AI command control enabled' : 'AI command control disabled')
    })

    // AI TTS sync settings
    $("#intiface-ai-tts-sync-enabled").prop('checked', aiTtsSyncEnabled)
    updateAITtsSyncControls()
    $("#intiface-ai-tts-sync-enabled").on('change', function() {
      const enabled = $(this).is(':checked')
      saveAITtsSyncEnabled(enabled)
      updateAITtsSyncControls()

      if (!enabled) {
        resetTtsSyncState()
        processCommandQueue()
      }

      updateAIStatusFromActivity()
      updateStatus(enabled ? 'AI spoken-audio sync enabled' : 'AI spoken-audio sync disabled')
    })

    $("#intiface-ai-tts-sync-offset").val(aiTtsSyncOffsetMs)
    $("#intiface-ai-tts-sync-offset-display").text(`${aiTtsSyncOffsetMs}ms`)
    $("#intiface-ai-tts-sync-offset").on('input', function() {
      const value = Number.parseInt($(this).val(), 10) || 0
      saveAITtsSyncOffsetMs(value)
      $("#intiface-ai-tts-sync-offset-display").text(`${aiTtsSyncOffsetMs}ms`)
    })

    $("#intiface-ai-tts-sync-timeout").val(aiTtsSyncStartTimeoutMs)
    $("#intiface-ai-tts-sync-timeout-display").text(`${aiTtsSyncStartTimeoutMs}ms`)
    $("#intiface-ai-tts-sync-timeout").on('input', function() {
      const value = Number.parseInt($(this).val(), 10) || 1200
      saveAITtsSyncTimeoutMs(value)
      $("#intiface-ai-tts-sync-timeout-display").text(`${aiTtsSyncStartTimeoutMs}ms`)
    })

    $("#intiface-ai-sync-start-lead").val(aiSyncStartLeadMs)
    $("#intiface-ai-sync-start-lead-display").text(`${aiSyncStartLeadMs}ms`)
    $("#intiface-ai-sync-start-lead").on('input', function() {
      const value = Number.parseInt($(this).val(), 10) || 0
      saveAISyncStartLeadMs(value)
      $("#intiface-ai-sync-start-lead-display").text(`${aiSyncStartLeadMs}ms`)
    })

    $("#intiface-ai-tts-interrupt-policy").val(aiTtsInterruptPolicy)
    $("#intiface-ai-tts-interrupt-policy").on('change', function() {
      saveAITtsInterruptPolicy($(this).val())
      const label = aiTtsInterruptPolicy === 'flush'
        ? 'flush'
        : aiTtsInterruptPolicy === 'preserve'
          ? 'preserve'
          : 'grace'
      updateStatus(`AI interrupt policy: ${label}`)
    })

    // Intiface debug logging toggle
    $("#intiface-debug-logging-enabled").prop('checked', intifaceDebugLoggingEnabled)
    $("#intiface-debug-logging-enabled").on('change', function() {
      const enabled = $(this).is(':checked')
      saveDebugLoggingSetting(enabled)
      updateStatus(enabled ? 'Intiface debug logging enabled' : 'Intiface debug logging disabled')
    })

    // Polling rate
    $("#intiface-polling-rate").on("input", function() {
      const val = parseInt($(this).val())
      devicePollingRate = val
      saveDevicePollingRate(val)
      $("#intiface-polling-rate-display").text(`${val}Hz (${getPollingInterval()}ms)`)
      setPollingRate(val)
    })

    $("#intiface-polling-rate").val(devicePollingRate)
    $("#intiface-polling-rate-display").text(`${devicePollingRate}Hz (${getPollingInterval()}ms)`)

    // Global inversion
    $("#intiface-global-invert").prop('checked', globalInvert)
    $("#intiface-global-invert").on('change', function() {
      const isChecked = $(this).is(':checked')
      saveGlobalInvert(isChecked)
      const statusEl = $("#intiface-global-invert-status")
      if (isChecked) {
        statusEl.show()
        updateStatus('Global inversion enabled')
      } else {
        statusEl.hide()
        updateStatus('Global inversion disabled')
      }
    })

    // Initialize PlayModeLoader
    if (PlayModeLoader?.init) {
      await PlayModeLoader.init()
      console.log(`${NAME}: PlayModeLoader initialized`)

      const modeErrors = PlayModeLoader.modeErrors || {}
      const failedModes = Object.entries(modeErrors).filter(([, errors]) => Array.isArray(errors) && errors.length > 0)
      failedModes.forEach(([modeId, errors]) => {
        console.error(`${NAME}: Mode '${modeId}' disabled due to validation errors:`)
        errors.forEach((err) => console.error(` - ${err}`))
      })

      if (failedModes.length > 0) {
        const modeList = failedModes.map(([modeId]) => modeId).join(', ')
        updateStatus(`Disabled invalid playmode(s): ${modeList}. Check console for details.`, true)
      }

      renderPlayModeUI()
      populatePatternButtons()
    }

    const dynamicCommands = initDynamicCommands({
      PlayModeLoader,
      executeCommand,
      updateStatus,
    })

    initModeBuilder({
      NAME,
      PlayModeLoader,
      updateStatus,
      onModesUpdated: async () => {
        renderPlayModeUI()
        await populatePatternButtons()
        dynamicCommands.refresh()
        updatePrompt()
      }
    })

    // Setup timeline event handlers
    setupTimelineEventHandlers()

    // Setup runtime listeners (idempotent)
    bindRuntimeEventListeners()

    // Keep prompt/device state in sync even on unexpected socket drops.
    startConnectionStateMonitoring()

    if (aiCommandsEnabled) {
      await ensureIntifaceDeviceLorebook()
    }

    // Initial prompt update
    updatePrompt()
    setTimeout(() => updatePrompt(), 2000)
    setTimeout(() => updatePrompt(), 3000)

    // Update UI from shared connection state
    lastKnownChatIdentity = getActiveChatIdentity()
    const connectedNow = isClientConnected()
    updateButtonStates(connectedNow)
    updateStatus(connectedNow ? "Connected" : "Disconnected")
    updateAIStatusFromActivity()

    console.log(`${NAME}: Initialization complete`)

  } catch (error) {
    console.error(`${NAME}: Failed to initialize.`, error)
    updateStatus("Failed to load Buttplug.js. Check console.", true)
  }
})

// ==========================================
// EXPORTS
// ==========================================

window.__embody_intiface_exports = {
  stopAllDeviceActions,
  clearWorkerTimeout,
  getPollingInterval,
  updateAIStatusFromActivity,
  updateStatus,
  getDeviceType,
  getDeviceDefaultIntensity,
  applyInversion,
  NAME,
  client,
  devices,
  deviceAssignments,
  buttplug
}
}

// ==========================================
// VRM MODULE
// ==========================================
{
const UPDATE_INTERVAL = 100;
const extensionFolderPath = `scripts/extensions/third-party/Extension-Embody/vrm`;
const PHONE_DEVICE_MOTION = 'Using_Touchscreen.vrma';
const PHONE_START_COOLDOWN_MS = 300;
const PHONE_TOUCH_COOLDOWN_MS = 800;
const UI_ACTION_TOUCH_COOLDOWN_MS = 150;
const SYNC_QUEUE_DEDUPE_MS = 900;
const PHONE_PROP_HIDE_DELAY_MS = 8000;
const phoneMotionSyncState = new Map(); // character -> state
const VRM_INTFACE_LISTENER_KEY = '__vrm_intiface_playback_listener';
const VRM_INTFACE_LAST_EVENT_KEY = '__vrm_intiface_last_event_token';
const syncMotionDedupeState = new Map(); // key -> timestamp
const phonePropVisibilityTimers = new Map(); // character -> timeout id
const vrmMessageDispatchTimers = new Map(); // chat_id -> timeout id

function bindTopbarDrawerClickHandler() {
    try {
        const extensionsToggle = document.querySelector('#extensions-settings-button .drawer-toggle');
        if (!extensionsToggle) {
            return;
        }

        const events = $._data(extensionsToggle, 'events');
        if (!events?.click?.[0]?.handler) {
            return;
        }

        const drawerToggle = $('#vrm-settings-button .drawer-toggle');
        if (!drawerToggle.length) {
            return;
        }

        drawerToggle.off('click.vrmDrawer');
        drawerToggle.on('click.vrmDrawer', events.click[0].handler);
    } catch (error) {
        console.error(DEBUG_PREFIX, 'Failed to bind topbar drawer handler', error);
    }
}

function shouldQueueSyncMotion(character, motionName, source, dedupeMs = SYNC_QUEUE_DEDUPE_MS) {
    const key = `${character}|${source}|${motionName}`;
    const now = Date.now();
    const lastAt = Number(syncMotionDedupeState.get(key) || 0);
    if ((now - lastAt) < Math.max(50, Number(dedupeMs) || SYNC_QUEUE_DEDUPE_MS)) {
        return false;
    }
    syncMotionDedupeState.set(key, now);

    if (syncMotionDedupeState.size > 600) {
        syncMotionDedupeState.clear();
    }
    return true;
}

function getLastAssistantCharacterName() {
    const chat = getContext()?.chat;
    if (!Array.isArray(chat)) {
        return null;
    }

    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (!msg || msg.is_user || msg.is_system) {
            continue;
        }

        const name = String(msg.name || '').trim();
        if (name) {
            return name;
        }
    }

    return null;
}

function resolvePlaybackCharacter(payload = {}) {
    const payloadChar = String(payload?.char || '').trim();
    if (payloadChar && getVRM(payloadChar)) {
        return payloadChar;
    }

    const lastAssistant = getLastAssistantCharacterName();
    if (lastAssistant && getVRM(lastAssistant)) {
        return lastAssistant;
    }

    const selectedCharacter = String($('#vrm_character_select').val() || '').trim();
    if (selectedCharacter && selectedCharacter !== 'none' && getVRM(selectedCharacter)) {
        return selectedCharacter;
    }

    const members = currentChatMembers();
    for (const member of members) {
        if (member && getVRM(member)) {
            return member;
        }
    }

    return null;
}

function getPhoneMotionState(character) {
    if (!phoneMotionSyncState.has(character)) {
        phoneMotionSyncState.set(character, {
            active: false,
            lastPhoneAt: 0,
            lastTouchAt: 0,
            touchCountInSession: 0,
            startMotionPlayed: false,
            pendingStartAt: 0,
            pendingCommandType: '',
            pendingRequestId: '',
            pendingMessageId: null,
            playing: false,
        });
    }

    return phoneMotionSyncState.get(character);
}

function clearPhonePropHideTimer(character) {
    const existingTimer = phonePropVisibilityTimers.get(character);
    if (existingTimer) {
        clearTimeout(existingTimer);
        phonePropVisibilityTimers.delete(character);
    }
}

function setPhonePropPlaybackVisible(character, visible, hideDelayMs = PHONE_PROP_HIDE_DELAY_MS, phoneOptions = {}) {
    if (!character) {
        return;
    }

    clearPhonePropHideTimer(character);

    if (visible) {
        setPhonePropVisible(character, true, phoneOptions);
        return;
    }

    const timer = setTimeout(() => {
        setPhonePropVisible(character, false);
        phonePropVisibilityTimers.delete(character);
    }, Math.max(0, Number(hideDelayMs) || 0));

    phonePropVisibilityTimers.set(character, timer);
}

async function playDeviceSyncMotion(character, sequence, options = {}) {
    if (!character || !sequence) {
        return;
    }

    const rawSequence = String(sequence || '').trim();
    const normalizedTarget = rawSequence.toLowerCase().replaceAll('\\', '/');
    const extensionPathTarget = `${extensionFolderPath}/${rawSequence}`.replaceAll('\\', '/');
    const absoluteExtensionPathTarget = `/${extensionPathTarget}`;

    let resolvedMotionPath = null;
    if (Array.isArray(animations_files)) {
        resolvedMotionPath = animations_files.find((filePath) => {
            const normalizedPath = String(filePath || '').trim().toLowerCase().replaceAll('\\', '/');
            if (!normalizedPath) {
                return false;
            }
            if (normalizedPath === normalizedTarget) {
                return true;
            }
            return normalizedPath.endsWith('/' + normalizedTarget);
        }) || null;
    }

    if (!resolvedMotionPath) {
        resolvedMotionPath = absoluteExtensionPathTarget;
    }

    const withPhoneProp = options?.withPhoneProp === true;
    const keepPhonePropVisible = options?.keepPhonePropVisible === true;
    const handPreference = options?.handPreference || 'right';
    const loop = options?.loop === true;
    if (withPhoneProp) {
        setPhonePropPlaybackVisible(character, true, PHONE_PROP_HIDE_DELAY_MS, { handPreference });
    }

    try {
        console.debug(DEBUG_PREFIX, 'Queueing device-sync motion', resolvedMotionPath, 'for', character);
        await setMotionSequence(character, [{ animation: resolvedMotionPath, transition: 'crossfade', fadeSec: 0.42 }], {
            loop,
            append: false,
            replace: true,
            clearOnComplete: !loop,
            restoreBaseIdle: !loop,
            deferIfBusy: false,
            transition: 'crossfade',
            fadeSec: 0.42,
            priority: String(options?.priority || 'high'),
        });
    } catch (e) {
        console.debug(DEBUG_PREFIX, 'Device-sync motion failed for resolved path:', resolvedMotionPath, 'retrying raw sequence:', rawSequence, 'for', character, e);
        try {
            await setMotionSequence(character, [{ animation: rawSequence, transition: 'crossfade', fadeSec: 0.42 }], {
                loop,
                append: false,
                replace: true,
                clearOnComplete: !loop,
                restoreBaseIdle: !loop,
                deferIfBusy: false,
                transition: 'crossfade',
                fadeSec: 0.42,
                priority: String(options?.priority || 'high'),
            });
        } catch (retryError) {
            console.debug(DEBUG_PREFIX, 'Device-sync motion final failure:', rawSequence, 'for', character, retryError);
        }
    } finally {
        if (withPhoneProp && !keepPhonePropVisible) {
            setPhonePropPlaybackVisible(character, false, options?.phoneHideDelayMs);
        }
    }
}

async function onIntifaceDevicePlayback(payload = {}) {
    try {
        const token = [
            String(payload?.emittedAt ?? ''),
            String(payload?.state ?? ''),
            String(payload?.deviceIndex ?? ''),
            String(payload?.commandType ?? payload?.modeName ?? payload?.pattern ?? ''),
            String(payload?.requestId ?? ''),
            String(payload?.messageId ?? ''),
        ].join('|');
        if (token && window[VRM_INTFACE_LAST_EVENT_KEY] === token) {
            return;
        }
        window[VRM_INTFACE_LAST_EVENT_KEY] = token;
    } catch (_e) {}

    if (!extension_settings?.vrm?.enabled) {
        return;
    }

    const stateType = String(payload?.state || '').trim();
    if (!stateType) {
        return;
    }

    const character = resolvePlaybackCharacter(payload);
    if (!character) {
        return;
    }

    const state = getPhoneMotionState(character);
    const now = Date.now();
    const traceId = Number.isFinite(payload?.traceId) ? Number(payload.traceId) : null;

    if (stateType === 'ui_action') {
        // Ignore UI/system actions for device-sync motion. They can arrive before
        // actual haptic playback and cause visibly early false-positive motions.
        return;
    }

    if (stateType === 'start') {
        console.debug(DEBUG_PREFIX, '[intiface-sync] start received', {
            traceId,
            commandType: String(payload?.commandType || ''),
            requestId: String(payload?.requestId || ''),
            messageId: Number.isInteger(payload?.messageId) ? payload.messageId : null,
        });

        const requestId = String(payload?.requestId || '').trim();
        const messageId = Number.isInteger(payload?.messageId) ? payload.messageId : null;
        const hasTrustedSyncIdentity = traceId !== null || !!requestId || Number.isInteger(messageId);

        // Treat start events with sync identity as authoritative signal.
        if (hasTrustedSyncIdentity && !state.playing && (now - state.lastPhoneAt) >= PHONE_START_COOLDOWN_MS) {
            const sourceKey = `playback:start:${traceId ?? 'na'}:${requestId || 'no_req'}:${Number.isInteger(messageId) ? messageId : 'no_msg'}`;
            if (shouldQueueSyncMotion(character, PHONE_DEVICE_MOTION, sourceKey, 900)) {
                setPhonePropPlaybackVisible(character, true, PHONE_PROP_HIDE_DELAY_MS, { handPreference: 'left' });
                state.playing = true;
                state.lastPhoneAt = now;
                console.debug(DEBUG_PREFIX, '[intiface-sync] motion trigger (start)', {
                    traceId,
                    commandType: String(payload?.commandType || '').trim().toLowerCase(),
                    requestId,
                    messageId,
                });
                await playDeviceSyncMotion(character, PHONE_DEVICE_MOTION, { priority: 'high', withPhoneProp: true, keepPhonePropVisible: true, handPreference: 'left' });
                state.startMotionPlayed = true;
                state.touchCountInSession = 1;
                state.playing = false;
            }
        }

        state.active = true;
        state.touchCountInSession = 0;
        state.startMotionPlayed = true;
        state.pendingStartAt = now;
        state.pendingCommandType = String(payload?.commandType || '').trim().toLowerCase();
        state.pendingRequestId = String(payload?.requestId || '').trim();
        state.pendingMessageId = Number.isInteger(payload?.messageId) ? payload.messageId : null;
        return;
    }

    if (stateType === 'tick') {
        if (!state.active) {
            state.active = true;
            state.touchCountInSession = 0;
            state.startMotionPlayed = false;
        }

        // Tick does not trigger motion; start is authoritative.
        return;
    }

    if (stateType === 'stop') {
        state.active = false;
        state.touchCountInSession = 0;
        state.startMotionPlayed = false;
        state.pendingStartAt = 0;
        state.pendingCommandType = '';
        state.pendingRequestId = '';
        state.pendingMessageId = null;
        setPhonePropPlaybackVisible(character, false, PHONE_PROP_HIDE_DELAY_MS);
    }
}

function bindIntifacePlaybackListener() {
    try {
        const prev = window[VRM_INTFACE_LISTENER_KEY];
        if (typeof prev === 'function') {
            if (typeof eventSource?.off === 'function') {
                eventSource.off('intiface_device_playback', prev);
            } else if (typeof eventSource?.removeListener === 'function') {
                eventSource.removeListener('intiface_device_playback', prev);
            }
        }
    } catch (_e) {}

    window[VRM_INTFACE_LISTENER_KEY] = onIntifaceDevicePlayback;
    eventSource.on('intiface_device_playback', onIntifaceDevicePlayback);
}

function shouldUseVoiceforgeForVrmSpeech() {
    return extension_settings?.tts?.enabled === true;
}

function initializeVrmCollapsibleSections() {
    const defaultExpandedSections = new Set(['global_settings', 'model_mapping', 'model_settings']);

    $('#vrm_settings h4').each(function () {
        const title = String($(this).text() || '').trim();
        if (!title) {
            return;
        }

        const header = $(this).parent();
        if (header.hasClass('vrm-section-header')) {
            return;
        }

        const sectionId = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'section';
        const contentId = `vrm_section_content_${sectionId}`;
        const contentItems = [];
        let next = header.next();

        while (next.length && next.find('h4').length === 0) {
            contentItems.push(next[0]);
            next = next.next();
        }

        if (!contentItems.length) {
            return;
        }

        header
            .addClass('vrm-section-header')
            .attr({
                role: 'button',
                tabindex: '0',
                'aria-controls': contentId,
            });
        $(this).replaceWith(`<span>${title}</span><i class="fa-solid fa-chevron-down vrm-section-toggle-icon"></i>`);

        const content = $('<div></div>')
            .addClass('vrm-section-content')
            .attr('id', contentId)
            .append(contentItems);
        header.after(content);

        const storageKey = `vrm.section.${sectionId}.expanded`;
        const storedState = localStorage.getItem(storageKey);
        const isExpanded = storedState === null ? defaultExpandedSections.has(sectionId) : storedState === 'true';
        content.toggle(isExpanded);
        header.attr('aria-expanded', String(isExpanded));
        header.find('.vrm-section-toggle-icon')
            .toggleClass('fa-chevron-up', isExpanded)
            .toggleClass('fa-chevron-down', !isExpanded);

        const toggleSection = () => {
            const expanded = !content.is(':visible');
            content.slideToggle(160);
            header.attr('aria-expanded', String(expanded));
            header.find('.vrm-section-toggle-icon')
                .toggleClass('fa-chevron-up', expanded)
                .toggleClass('fa-chevron-down', !expanded);
            localStorage.setItem(storageKey, String(expanded));
        };

        header.on('click.vrmSectionToggle', toggleSection);
        header.on('keydown.vrmSectionToggle', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleSection();
            }
        });
    });
}

//#############################//

//#############################//
//  Extension UI and Settings  //
//#############################//

const defaultSettings = {
    // Global settings
    enabled: false,
    follow_camera: false,
    follow_cursor: false,
    tts_lips_sync: false,
    blink: false,
    natural_idle: true,
    auto_send_hitbox_message: false,
    hitbox_callmode_sync_delay_ms: 220,
    hitbox_callmode_wait_tts_start_ms: 4500,
    lock_models: false,
    model_z_index: 4,

    // Performances
    hitboxes: false,
    models_cache: false,
    animations_cache: false,

    // Scene
    light_color: DEFAULT_LIGHT_COLOR,
    light_intensity: DEFAULT_LIGHT_INTENSITY,

    // Debug
    show_grid: false,

    // Character model mapping
    character_model_mapping: {},
    model_settings: {},
}

//'assets/vrm/VRM1_Constraint_Twist_Sample.vrm'

function loadSettings() {
    if (extension_settings.vrm === undefined)
        extension_settings.vrm = {};

    // Migration from previous naming
    if (extension_settings.vrm.model_z_index === undefined && extension_settings.vrm.callmode_overlay_z_index !== undefined) {
        extension_settings.vrm.model_z_index = extension_settings.vrm.callmode_overlay_z_index;
    }

    // Ensure good format
    for (const key of Object.keys(extension_settings.vrm)) {
        // delete spurious keys
        if (!Object.keys(defaultSettings).includes(key))
            delete extension_settings.vrm[key];
    }
    for (const key of Object.keys(defaultSettings)) {
        // add missing keys
        if (!Object.keys(extension_settings.vrm).includes(key))
            extension_settings.vrm[key] = defaultSettings[key];
    }
    saveSettingsDebounced();

    $('#vrm_enabled_checkbox').prop('checked', extension_settings.vrm.enabled);
    $('#vrm_follow_camera_checkbox').prop('checked', extension_settings.vrm.follow_camera);
    $('#vrm_follow_cursor_checkbox').prop('checked', extension_settings.vrm.follow_cursor);
    $('#vrm_blink_checkbox').prop('checked', extension_settings.vrm.blink);
    $('#vrm_natural_idle_checkbox').prop('checked', extension_settings.vrm.natural_idle);
    $('#vrm_tts_lips_sync_checkbox').prop('checked', extension_settings.vrm.tts_lips_sync);
    $('#vrm_auto_send_hitbox_message_checkbox').prop('checked', extension_settings.vrm.auto_send_hitbox_message);
    $('#vrm_hitbox_callmode_sync_delay').val(extension_settings.vrm.hitbox_callmode_sync_delay_ms);
    $('#vrm_hitbox_callmode_sync_delay_value').text(extension_settings.vrm.hitbox_callmode_sync_delay_ms);
    $('#vrm_hitbox_callmode_wait_tts_start').val(extension_settings.vrm.hitbox_callmode_wait_tts_start_ms);
    $('#vrm_hitbox_callmode_wait_tts_start_value').text(extension_settings.vrm.hitbox_callmode_wait_tts_start_ms);
    $('#vrm_lock_models_checkbox').prop('checked', extension_settings.vrm.lock_models);
    $('#vrm_model_z_index').val(extension_settings.vrm.model_z_index);
    $('#vrm_hitboxes_checkbox').prop('checked', extension_settings.vrm.hitboxes);
    $('#vrm_models_cache_checkbox').prop('checked', extension_settings.vrm.models_cache);
    $('#vrm_animations_cache_checkbox').prop('checked', extension_settings.vrm.animations_cache);
    $('#vrm_show_grid_checkbox').prop('checked', extension_settings.vrm.show_grid);

    $('#vrm_enabled_checkbox').on('click', onEnabledClick);
    $('#vrm_follow_camera_checkbox').on('click', onFollowCameraClick);
    $('#vrm_follow_cursor_checkbox').on('click', onFollowCursorClick);
    $('#vrm_blink_checkbox').on('click', onBlinkClick);
    $('#vrm_natural_idle_checkbox').on('click', onNaturalIdleClick);
    $('#vrm_tts_lips_sync_checkbox').on('click', onTtsLipsSyncClick);
    $('#vrm_auto_send_hitbox_message_checkbox').on('click', onAutoSendHitboxMessageClick);
    $('#vrm_hitbox_callmode_sync_delay').on('input', onHitboxCallmodeDelayChange);
    $('#vrm_hitbox_callmode_wait_tts_start').on('input', onHitboxCallmodeWaitTtsStartChange);
    $('#vrm_lock_models_checkbox').on('click', onLockModelsClick);
    $('#vrm_model_z_index').on('input', onModelZIndexChange);
    $('#vrm_hitboxes_checkbox').on('click', onHitboxesClick);
    $('#vrm_models_cache_checkbox').on('click', onModelCacheClick);
    $('#vrm_animations_cache_checkbox').on('click', onAnimationCacheClick);
    $('#vrm_show_grid_checkbox').on('click', onShowGridClick);

    $('#vrm_light_color').on('input', onLightChange);
    $('#vrm_light_intensity').on('input', onLightChange);
    $('#vrm_light_color_reset_button').on('click', onLightColorResetClick);
    $('#vrm_light_intensity_reset_button').on('click', onLightIntensityResetClick);
    $('#vrm_character_select').on('change', onCharacterChange);
    $('#vrm_character_refresh_button').on('click', onCharacterRefreshClick);
    $('#vrm_character_remove_button').on('click', onCharacterRemoveClick);
    $('#vrm_character_map_copy_button').on('click', onCharacterMapCopyClick);
    $('#vrm_character_map_paste_button').on('click', onCharacterMapPasteClick);

    $('#vrm_model_refresh_button').on('click', onModelRefreshClick);
    $('#vrm_model_select').on('change', onModelChange);
    $('#vrm_model_reset_button').on('click', onModelResetClick);

    $('#vrm_settings').on('click keydown', '.vrm-section-header', function(event) {
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        event.preventDefault();
        const section = $(this).data('vrm-section');
        const content = $(`[data-vrm-section-content="${section}"]`);
        const isOpen = content.is(':visible');
        content.slideToggle(120);
        $(this).find('.vrm-section-toggle-icon').toggleClass('fa-chevron-down', isOpen).toggleClass('fa-chevron-up', !isOpen);
    });

    $('#vrm_model_scale').on('input', onModelScaleChange);
    $('#vrm_model_position_x').on('input', onModelPositionChange);
    $('#vrm_model_position_y').on('input', onModelPositionChange);
    $('#vrm_model_rotation_x').on('input', onModelRotationChange);
    $('#vrm_model_rotation_y').on('input', onModelRotationChange);

    $('#vrm_default_expression_select').on('change', () => {onAnimationMappingChange('animation_default');});
    $('#vrm_default_motion_select').on('change', () => {onAnimationMappingChange('animation_default');});
    $('#vrm_default_expression_replay').on('click', () => {onAnimationMappingChange('animation_default');});
    $('#vrm_default_motion_replay').on('click', () => {onAnimationMappingChange('animation_default');});

    // Animation sequence UI
    $('#vrm_sequence_play').on('click', onSequencePlayClick);
    $('#vrm_sequence_clear').on('click', onSequenceClearClick);

    // Blend shape mapping UI
    $('#vrm_blend_shape_add').on('click', onBlendShapeAddClick);
    $('#vrm_blend_shape_group_name').on('keypress', function(e) {
        if (e.which === 13) {
            onBlendShapeAddClick();
        }
    });

    $('#vrm_reload_button').on('click', async () => {
        await loadScene();
        await loadAllModels(currentChatMembers());
        console.debug(DEBUG_PREFIX,'Reset clicked, reloading VRM');
    });

    if (extension_settings.vrm.follow_cursor) {
        setCursorTracking(true);
    }

    applyModelZIndex(extension_settings.vrm.model_z_index);

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        updateCharactersList();
        updateCharactersModels();
        await loadAllModels(currentChatMembers());
    });

    eventSource.on(event_types.GROUP_UPDATED, async () => {
        updateCharactersList();
        updateCharactersModels();
        await loadAllModels(currentChatMembers());
    });

    const handleMessageEventForVrm = async (chat_id, source) => {
        const context = getContext();
        const chat = Array.isArray(context?.chat) ? context.chat : null;
        if (!chat) {
            console.warn(DEBUG_PREFIX, 'Skipping VRM message handling; chat buffer missing', { source, chat_id });
            return;
        }

        const id = Number(chat_id);
        if (!Number.isInteger(id) || id < 0 || id >= chat.length) {
            console.warn(DEBUG_PREFIX, 'Skipping VRM message handling; invalid chat id', { source, chat_id, length: chat.length });
            return;
        }

        const message = chat[id];
        if (!message || typeof message !== 'object') {
            console.warn(DEBUG_PREFIX, 'Skipping VRM message handling; chat entry is empty/invalid', { source, chat_id: id });
            return;
        }

        const existingTimer = vrmMessageDispatchTimers.get(id);
        if (existingTimer) {
            clearTimeout(existingTimer);
            vrmMessageDispatchTimers.delete(id);
        }

        const delayMs = source === 'MESSAGE_EDITED' ? 220 : 40;
        const timeoutId = setTimeout(async () => {
            vrmMessageDispatchTimers.delete(id);

            const latestContext = getContext();
            const latestChat = Array.isArray(latestContext?.chat) ? latestContext.chat : null;
            if (!latestChat || id < 0 || id >= latestChat.length) {
                return;
            }

            const latestMessage = latestChat[id];
            if (!latestMessage || typeof latestMessage !== 'object') {
                return;
            }

            await updateExpression(id);
            if (!shouldUseVoiceforgeForVrmSpeech()) {
                await talk(id);
            }
        }, delayMs);

        vrmMessageDispatchTimers.set(id, timeoutId);
    };

    eventSource.on(event_types.MESSAGE_RECEIVED, async (chat_id) => {
        await handleMessageEventForVrm(chat_id, 'MESSAGE_RECEIVED');
    });

    eventSource.on(event_types.MESSAGE_EDITED, async (chat_id) => {
        await handleMessageEventForVrm(chat_id, 'MESSAGE_EDITED');
    });

    bindIntifacePlaybackListener();

    updateCharactersListOnce();
    updateCharactersModels();

    loadScene();
}

//#############################//
//  Methods                    //
//#############################//

//#############################//
//  Module Worker              //
//#############################//

/*
async function moduleWorker() {

}
*/

//#############################//
//  Extension load             //
//#############################//

// This function is called when the extension is loaded
jQuery(async () => {
    $('#vrm_settings').remove();
    $('#vrm-settings-button').remove();

    const settingsHtml = $(await renderExtensionTemplateAsync('third-party/Extension-Embody', 'settings'));
    const vrmSettings = settingsHtml.filter('#embody-vrm-settings').length
        ? settingsHtml.filter('#embody-vrm-settings')
        : settingsHtml.find('#embody-vrm-settings');
    const embodyPanel = $('#embody-vrm-panel');
    if (embodyPanel.length) {
        embodyPanel.empty().append(vrmSettings);
    } else {

        const topbarDrawer = $(
            '<div id="vrm-settings-button" class="drawer">'
          + '  <div class="drawer-toggle drawer-header">'
          + '    <div class="drawer-icon fa-solid fa-person-walking fa-fw closedIcon" title="VRM"></div>'
          + '  </div>'
          + '  <div class="drawer-content closedDrawer"></div>'
          + '</div>'
        );

        topbarDrawer.find('.drawer-content').append(windowHtml);
        $('#extensions-settings-button').after(topbarDrawer);
        bindTopbarDrawerClickHandler();
    }

    initializeVrmCollapsibleSections();
    loadSettings();


    /*// Module worker
    const wrapper = new ModuleWorkerWrapper(moduleWorker);
    setInterval(wrapper.update.bind(wrapper), UPDATE_INTERVAL);
    moduleWorker();
    */
    registerSlashCommand('vrmlightcolor', setLightColorSlashCommand, [], '<span class="monospace">(expression)</span> – set vrm scene light color (example: "/vrmlightcolor white" or "/vrmlightcolor purple")', true, true);
    registerSlashCommand('vrmlightintensity', setLightIntensitySlashCommand, [], '<span class="monospace">(expression)</span> – set vrm scene light intensity in percent (example: "/vrmlightintensity 0" or "/vrmlightintensity 100")', true, true);
    registerSlashCommand('vrmmodel', setModelSlashCommand, [], '<span class="monospace">(expression)</span> – set vrm model (example: "/vrmmodel Seraphina.vrm" or "/vrmmodel character=Seraphina model=Seraphina.vrm")', true, true);
    registerSlashCommand('vrmexpression', setExpressionSlashCommand, [], '<span class="monospace">(expression)</span> – set vrm model expression (example: "/vrmexpression happy" or "/vrmexpression character=Seraphina expression=happy")', true, true);
    registerSlashCommand('vrmmotion', setMotionSlashCommand, [], '<span class="monospace">(motion)</span> – set vrm model motion (example: "/vrmmotion idle" or "/vrmmotion character=Seraphina motion=idle loop=true random=false")', true, true);
    registerSlashCommand('vrmmotionlist', MotionListSlashCommand, [], '<span class="monospace">(motion)</span> – list vrm model motions (example: "/vrmmotionlits")', true, true);
    registerSlashCommand('vrmmotionsequence', setMotionSequenceSlashCommand, [], '<span class="monospace">(sequence)</span> – play animation sequence (example: "/vrmmotionsequence wave,point,wait:500,idle" or "/vrmmotionsequence character=Seraphina sequence=wave,point idle loop=true")', true, true);
    registerSlashCommand('vrmmotionsequenceclear', clearMotionSequenceSlashCommand, [], '<span class="monospace">(character)</span> – clear animation sequence (example: "/vrmmotionsequenceclear" or "/vrmmotionsequenceclear character=Seraphina")', true, true);
    registerSlashCommand('vrmbackground', setBackgroundSlashCommand, [], '<span class="monospace">(motion)</span> – Set the 3d background (example: "/vrmbackground /assets/vrm/scene/test.fbx or /vrmbackground path=/assets/vrm/scene/test.fbx scale=0.01 x=0 y=0 z=0 rx=0 ry=0 rz=0)', true, true);
    registerSlashCommand('vrmmodelsettings', setModelSettingsSlashCommand, [], '<span class="monospace">(motion)</span> – Set the 3d background (example: "/vrmmodelsettings character=Seraphina scale=1 x=0 y=0 z=0 rx=0 ry=0 rz=0)', true, true);

    // Register function calling tools
    registerVRMFunctionTools();

});

async function setLightColorSlashCommand(_, color) {
    if (!color) {
        console.log('No color provided');
        return;
    }

    setLight(color,extension_settings.vrm.light_intensity);
}

async function setLightIntensitySlashCommand(_, intensity) {
    if (!intensity) {
        console.log('No intensity provided');
        return;
    }

    setLight(extension_settings.vrm.light_color,intensity);
}

// Example /vrmmotion anger
async function setModelSlashCommand(args, model) {
    let character = undefined;
    if (!model && !args["model"]) {
        console.log('No model provided');
        return;
    }

    if (args["character"])
        character = args["character"];

    if (args["model"])
        motion = args["model"];

    if (character === undefined) {
        const characters = currentChatMembers();
        if(characters.length == 0) {
            console.log('No character provided and none detected in current chat');
            return;
        }
        character = characters[0];
    }

    model = model.trim();
    console.debug(DEBUG_PREFIX,'Command vrmmodel received for character=',character,"model=", model);

    const fuse = new Fuse(models_files);
    const results = fuse.search(model);
    const fileItem = results[0]?.item;

    if (fileItem)
    {
        $('#vrm_character_select').val(character)
        $('#vrm_model_select').val(fileItem)
        onModelChange();
    }
    else{
        console.debug(DEBUG_PREFIX,'Model not found in', models_files);
    }
}

async function setExpressionSlashCommand(args, expression) {
    let character = undefined;
    if (!expression) {
        console.log('No expression provided');
        return;
    }

    if (args["character"])
        character = args["character"];

    if (args["expression"])
        character = args["expression"];

    if (character === undefined) {
        const characters = currentChatMembers();
        if(characters.length == 0) {
            console.log('No character provided and none detected in current chat');
            return;
        }
        character = characters[0];
    }

    expression = expression.trim();

    console.debug(DEBUG_PREFIX,'Command expression received for character=',character,"expression=",expression);

    await setExpression(character,expression);
}

// Example /vrmmotion anger
async function setMotionSlashCommand(args, motion) {
    let character = undefined;
    let loop = false;
    let random = false;
    if (!motion && !args["motion"]) {
        console.log('No motion provided');
        return;
    }

    if (args["character"])
        character = args["character"];

    if (args["motion"])
        motion = args["motion"];

    if (args["loop"])
        loop = args["loop"].toLowerCase() === "true";

    if (args["random"])
        random = args["random"].toLowerCase() === "true";

    if (character === undefined) {
        const characters = currentChatMembers();
        if(characters.length == 0) {
            console.log('No character provided and none detected in current chat');
            return;
        }
        character = characters[0];
    }

    motion = motion.trim();
    console.debug(DEBUG_PREFIX,'Command motion received for character=',character,"motion=", motion,"loop=",loop, "random=",random);

    const fuse = new Fuse(animations_files);
    const results = fuse.search(motion);
    const fileItem = results[0]?.item;

    if (fileItem)
    {
        setMotion(character, fileItem, loop, true, random);
    }
    else{
        console.debug(DEBUG_PREFIX,'Motion not found in', animations_files);
    }
}

// Example /vrmmotionlist
async function MotionListSlashCommand(args) {
    var animation_list = [];
    for(const fullPath of animations_files) {
        var filename = fullPath.replace(/^.*[\\/]/, '').replace(/\.[^/.]+$/, "")
        animation_list.push(filename)
    }
    return JSON. stringify(animation_list);
}

// Example /vrmbackground path=/assets/vrm/scene/test.fbx scale=0.01 x=0 y=0 z=0 rx=0 ry=2 rz=0
// /vrmbackground path=/assets/vrm/scene/sitting_room/scene.gltf scale=1 x=0 y=0 z=-0.5 rx=0 ry=2 rz=0
async function setBackgroundSlashCommand(args, path) {
    let scale = 1 // same as character is good
    let position = {"x":0,"y":0,"z":0} // z is -2 times scale
    let rotation = {"x":0,"y":0,"z":0}

    if (!path && !args["path"]) {
        console.log('No path provided');
        return;
    }

    if (args["path"])
        path = args["path"]

    //console.debug(DEBUG_PREFIX, "path:", path)

    if (args["scale"])
        scale = args["scale"]

    if (args["x"])
        position.x = args["x"];
    if (args["y"])
        position.y = args["y"];
    if (args["z"])
        position.z = args["z"];

    if (args["rx"])
        rotation.x = args["rx"];
    if (args["ry"])
        rotation.y = args["ry"];
    if (args["rz"])
        rotation.z = args["rz"];

    setBackground(path, scale, position, rotation);
}

async function setModelSettingsSlashCommand(args) {
    let character = undefined;
    let scale = 1;
    let position = {"x":0,"y":0,"z":0};
    let rotation = {"x":0,"y":0,"z":0};

    if(args["character"])
        character = args["character"];
    else
        character = currentChatMembers()[0];

    if (args["scale"])
        scale = args["scale"];

    if (args["x"])
        position.x = args["x"];
    if (args["y"])
        position.y = args["y"];
    if (args["z"])
        position.z = args["z"];

    if (args["rx"])
        rotation.x = args["rx"];
    if (args["ry"])
        rotation.y = args["ry"];
    if (args["rz"])
        rotation.z = args["rz"];


    const model_path = extension_settings.vrm.character_model_mapping[character];
    extension_settings.vrm.model_settings[model_path]['scale'] = scale;
    extension_settings.vrm.model_settings[model_path]['x'] = position.x;
    extension_settings.vrm.model_settings[model_path]['y'] = position.y;
    extension_settings.vrm.model_settings[model_path]['z'] = position.z;
    extension_settings.vrm.model_settings[model_path]['rx'] = rotation.x;
    extension_settings.vrm.model_settings[model_path]['ry'] = rotation.y;
    extension_settings.vrm.model_settings[model_path]['rz'] = rotation.z;

    updateModel(character);
}

// Example /vrmmotionsequence wave,point,wait:500,idle
// Example /vrmmotionsequence character=Seraphina sequence=wave,point idle loop=true
async function setMotionSequenceSlashCommand(args, sequenceStr) {
    let character = undefined;
    let sequence = sequenceStr;
    let loop = false;

    if (!sequence && !args["sequence"]) {
        console.log('No sequence provided');
        return;
    }

    if (args["character"])
        character = args["character"];

    if (args["sequence"])
        sequence = args["sequence"];

    if (args["loop"])
        loop = args["loop"].toLowerCase() === "true";

    if (character === undefined) {
        const characters = currentChatMembers();
        if(characters.length == 0) {
            console.log('No character provided and none detected in current chat');
            return;
        }
        character = characters[0];
    }

    sequence = sequence.trim();
    console.debug(DEBUG_PREFIX,'Command motion sequence received for character=',character,"sequence=", sequence,"loop=",loop);

    await setMotionSequence(character, sequence, { loop });
}

// Example /vrmmotionsequenceclear
// Example /vrmmotionsequenceclear character=Seraphina
async function clearMotionSequenceSlashCommand(args) {
    let character = undefined;

    if (args["character"])
        character = args["character"];

    if (character === undefined) {
        const characters = currentChatMembers();
        if(characters.length == 0) {
            console.log('No character provided and none detected in current chat');
            return;
        }
        character = characters[0];
    }

    console.debug(DEBUG_PREFIX,'Clearing motion sequence for character=',character);
    clearAnimationSequence(character);
}

//#############################//
//  Function Calling Tools     //
//#############################//

function registerVRMFunctionTools() {
    const context = getContext();
    
    if (!extension_settings.vrm.function_tools) {
        console.debug(DEBUG_PREFIX, 'Function tools are disabled in settings');
        return;
    }
    
    if (!context.ToolManager) {
        console.warn(DEBUG_PREFIX, 'ToolManager not available, skipping function tool registration');
        return;
    }

    // Tool: Set VRM Expression
    context.registerFunctionTool({
        name: 'SetVRMExpression',
        displayName: 'Set VRM Expression',
        description: 'Set the facial expression of a VRM avatar character. NOTE: Basic emotions are automatically handled by the system, but you can use this tool to OVERRIDE the automatic expression when you want a specific emotion that differs from the sentiment analysis, or when the automatic system does not capture the nuance of the character\'s emotional state. Use this to fine-tune expressions for more dramatic or subtle emotional moments.',
        parameters: {
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                character: {
                    type: 'string',
                    description: 'Name of the character to set expression for. If not provided, uses the first character in the chat.',
                },
                expression: {
                    type: 'string',
                    description: 'The expression name to set. Common expressions include: happy, sad, angry, surprised, relaxed, neutral. Use an expression that matches the character\'s current emotional state.',
                },
            },
            required: ['expression'],
        },
        action: async (args) => {
            const character = args.character || getFirstCharacter();
            if (!character) throw new Error('No character available');
            if (!args.expression) throw new Error('Expression is required');
            
            console.debug(DEBUG_PREFIX, 'Function tool: SetVRMExpression', character, args.expression);
            await setExpression(character, args.expression);
            return `Set expression to "${args.expression}" for ${character}`;
        },
        formatMessage: (args) => `Changing expression to "${args.expression}"...`,
    });

    // Tool: Set VRM Motion
    context.registerFunctionTool({
        name: 'SetVRMMotion',
        displayName: 'Set VRM Motion',
        description: 'Play a specific animation/motion on a VRM avatar character. The automatic system handles basic animations based on message sentiment, but you should use this tool to ADD specific physical actions that are explicitly described in the character\'s behavior like waving goodbye, pointing at an object, performing a dance, sitting down, bowing respectfully, clapping, or greeting someone. Use this to make the character\'s movements match their described actions more precisely.',
        parameters: {
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                character: {
                    type: 'string',
                    description: 'Name of the character to animate. If not provided, uses the first character in the chat.',
                },
                motion: {
                    type: 'string',
                    description: 'The animation/motion name to play. Examples: wave, point, idle, dance, sit, stand, bow, clap. Use an action that matches what the character is doing.',
                },
                loop: {
                    type: 'boolean',
                    description: 'Whether to loop the animation continuously. Set to true for idle animations, false for one-time actions.',
                    default: false,
                },
            },
            required: ['motion'],
        },
        action: async (args) => {
            const character = args.character || getFirstCharacter();
            if (!character) throw new Error('No character available');
            if (!args.motion) throw new Error('Motion is required');
            
            // Find the animation file
            const fuse = new Fuse(animations_files);
            const results = fuse.search(args.motion);
            const fileItem = results[0]?.item;
            
            if (!fileItem) {
                throw new Error(`Motion "${args.motion}" not found in available animations`);
            }
            
            console.debug(DEBUG_PREFIX, 'Function tool: SetVRMMotion', character, fileItem, args.loop);
            setMotion(character, fileItem, args.loop || false, true, true);
            return `Playing motion "${args.motion}" (${fileItem}) on ${character}`;
        },
        formatMessage: (args) => `Playing motion "${args.motion}"...`,
    });

    // Tool: Play Animation Sequence
    context.registerFunctionTool({
        name: 'PlayVRMAnimationSequence',
        displayName: 'Play VRM Animation Sequence',
        description: 'Play a sequence of multiple animations on a VRM avatar character. This tool is designed for COMPLEX multi-part actions that require several distinct movements chained together (like "wave, wait 500ms, then point, then return to idle"). The automatic system handles basic single animations, but use this tool when the character performs a sequence of actions or when you want to choreograph multiple movements. This adds layered, dynamic animation beyond what the automatic system provides.',
        parameters: {
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                character: {
                    type: 'string',
                    description: 'Name of the character to animate. If not provided, uses the first character in the chat.',
                },
                sequence: {
                    type: 'string',
                    description: 'Animation sequence string. Format: "animation1,animation2,wait:ms,animation3". Example: "wave,point,wait:500,idle" or "bow,wait:1000,wave". Use commas to separate animations and wait commands.',
                },
                loop: {
                    type: 'boolean',
                    description: 'Whether to loop the entire sequence continuously.',
                    default: false,
                },
            },
            required: ['sequence'],
        },
        action: async (args) => {
            const character = args.character || getFirstCharacter();
            if (!character) throw new Error('No character available');
            if (!args.sequence) throw new Error('Sequence is required');
            
            console.debug(DEBUG_PREFIX, 'Function tool: PlayVRMAnimationSequence', character, args.sequence, args.loop);
            await setMotionSequence(character, args.sequence, { loop: args.loop || false });
            return `Playing animation sequence "${args.sequence}" on ${character}`;
        },
        formatMessage: (args) => `Playing animation sequence...`,
    });

    // Tool: Clear Animation Sequence
    context.registerFunctionTool({
        name: 'ClearVRMAnimationSequence',
        displayName: 'Clear VRM Animation Sequence',
        description: 'Stop and clear any currently playing animation sequence on a VRM avatar character. ONLY call this if a long animation sequence is actively playing and you need to interrupt it. Do NOT call this routinely - animations naturally end on their own.',
        parameters: {
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                character: {
                    type: 'string',
                    description: 'Name of the character to stop animations for. If not provided, uses the first character in the chat.',
                },
            },
            required: [],
        },
        action: async (args) => {
            const character = args.character || getFirstCharacter();
            if (!character) throw new Error('No character available');
            
            console.debug(DEBUG_PREFIX, 'Function tool: ClearVRMAnimationSequence', character);
            clearAnimationSequence(character);
            return `Cleared animation sequence for ${character}`;
        },
        formatMessage: () => 'Stopping animation sequence...',
    });

    // Tool: Set VRM Light Color
    context.registerFunctionTool({
        name: 'SetVRMLightColor',
        displayName: 'Set VRM Light Color',
        description: 'Change the lighting color of the VRM scene. ONLY call this when there is a SIGNIFICANT scene change that requires different lighting (entering a dark cave, sunset, magical effect, etc.). Do NOT call for minor mood adjustments or on every message. Use very sparingly for major atmosphere shifts only.',
        parameters: {
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                color: {
                    type: 'string',
                    description: 'Color value. Can be a color name (white, red, blue, purple, orange, yellow, etc.) or hex code (#ff0000, #00ff00, etc.). Use colors that match the scene\'s mood.',
                },
            },
            required: ['color'],
        },
        action: async (args) => {
            if (!args.color) throw new Error('Color is required');
            
            console.debug(DEBUG_PREFIX, 'Function tool: SetVRMLightColor', args.color);
            setLight(args.color, extension_settings.vrm.light_intensity);
            return `Set light color to "${args.color}"`;
        },
        formatMessage: (args) => `Setting light color to "${args.color}"...`,
    });

    // Tool: Set VRM Light Intensity
    context.registerFunctionTool({
        name: 'SetVRMLightIntensity',
        displayName: 'Set VRM Light Intensity',
        description: 'Change the lighting brightness of the VRM scene. ONLY call this when there is a SIGNIFICANT change in lighting conditions (entering a dark room, bright sunlight, etc.). Do NOT call for minor adjustments or on every message. Use very sparingly for major lighting condition changes only.',
        parameters: {
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                intensity: {
                    type: 'number',
                    description: 'Light intensity percentage from 0 to 200. Common values: 100 (normal daylight), 50 (dim), 20 (dark), 150 (very bright).',
                    minimum: 0,
                    maximum: 200,
                },
            },
            required: ['intensity'],
        },
        action: async (args) => {
            if (args.intensity === undefined) throw new Error('Intensity is required');
            
            console.debug(DEBUG_PREFIX, 'Function tool: SetVRMLightIntensity', args.intensity);
            setLight(extension_settings.vrm.light_color, args.intensity);
            return `Set light intensity to ${args.intensity}%`;
        },
        formatMessage: (args) => `Setting light intensity to ${args.intensity}%...`,
    });

    // Tool: List VRM Motions
    context.registerFunctionTool({
        name: 'ListVRMMotions',
        displayName: 'List VRM Motions',
        description: 'Get a list of all available animation motions for the VRM avatar. Call this tool to see what animations you can use with SetVRMMotion. Common animations include: wave, point, idle, dance, sit, stand, bow, clap, and many more. Use this to discover the exact animation names available.',
        stealth: true, // This tool should not be visible to the user as it returns raw data
        parameters: {
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {},
            required: [],
        },
        action: async () => {
            const animationList = animations_files.map(fullPath => {
                const filename = fullPath.replace(/^.*[\\/]/, '').replace(/\.[^/.]+$/, '');
                return filename;
            });
            return JSON.stringify(animationList, null, 2);
        },
        formatMessage: () => 'Listing available motions...',
    });

    console.log(DEBUG_PREFIX, 'Registered VRM function calling tools');
}

function getFirstCharacter() {
    const characters = currentChatMembers();
    return characters.length > 0 ? characters[0] : null;
}
}

