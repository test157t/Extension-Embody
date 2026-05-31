import { getAudioManager } from './audio.js';
import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';

const DISABLED_VOICE_MARKER = 'disabled';
const DEFAULT_VOICE_MARKER = '[Default Voice]';

const console = { ...globalThis.console, debug: () => {}, log: () => {}, info: () => {} };

export { VoiceForgeProvider };

/**
 * VoiceForge TTS Provider
 * 
 * Integrates with VoiceForge server for TTS generation with:
 * - OmniVoice voice cloning and voice design`r`n * - RVC voice conversion
 * - Post-processing (EQ, reverb, ASMR, etc.)
 * - Background audio blending (via unified AudioManager)
 */
class VoiceForgeProvider {
    settings;
    voices = [];
    audioPrompts = [];
    rvcModels = [];
    kokoroVoices = []; // Kokoro TTS voices
    separator = ' . ';
    serverConfig = null; // Cached server config from /api/config
    
    // Request ID tracking for RVC model caching
    currentRequestId = null;
    lastCharacter = null;
    currentCharacter = null;
    activeStreamAbortController = null;
    activeStreamRequestId = null;

    audioElement = document.createElement('audio');

    sanitizeInputText(inputText) {
        if (typeof inputText !== 'string') {
            return '';
        }

        let text = String(inputText || '');

        text = text
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&amp;/gi, '&');

        // Strip Intiface/command-style control tags from speech input.
        text = text
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

        // Last-mile normalization before sending to VoiceForge.
        // Strips trailing ellipsis/dots that can appear from stream chunk boundaries.
        return text.replace(/(\.{3,}|…)\s*$/g, '').trim();
    }

    defaultSettings = {
        voiceMap: {},
        provider_endpoint: 'http://127.0.0.1:8888',
        chunk_size: 50,  // 5-100, affects quality vs speed tradeoff
        seed: 0,  // 0 = random, -1 = new random each time, >0 = specific seed
    tts_backend: null,
    };

    getOmniVoiceAsrModel() {
        const moduleSettings = extension_settings?.callmode || {};
        const model = String(moduleSettings.asr_model || '').trim();
        if (!model || model === 'large-v3-turbo' || model === 'whisper-large-v3-turbo') {
            return 'large-v3-turbo';
        }
        if (model === 'glm-asr-nano' || model === 'parakeet-tdt-0.6b-v3') {
            return model;
        }
        return 'large-v3-turbo';
    }

    normalizeTtsBackend(backend) {
        return backend;
    }

    get settingsHtml() {
        return `
        <div class="voiceforge-provider-settings">
            <!-- Connection Status (top) -->
            <div id="voiceforge_server_status" style="margin-bottom: 10px;">
                <div class="flex-container gap10 alignItemsCenter">
                    <span id="voiceforge_status_icon" style="color: orange;">●</span>
                    <span id="voiceforge_status_text">Not connected</span>
                </div>
                <div id="voiceforge_modules_status" class="marginTop5" style="font-size: 0.9em;"></div>
            </div>

            <!-- Server URL -->
            <div class="flex-container flexFlowColumn">
                <label for="voiceforge_endpoint">VoiceForge Server URL:</label>
                <div class="flex-container alignItemsCenter gap5">
                    <input id="voiceforge_endpoint" type="text" class="text_pole flex1" 
                           placeholder="http://127.0.0.1:8888" 
                           value="${this.settings?.provider_endpoint || this.defaultSettings.provider_endpoint}"/>
                    <button type="button" id="voiceforge_connect" class="menu_button" title="Connect to VoiceForge">
                        <i class="fa-solid fa-plug"></i> Connect
                    </button>
                </div>
                <small class="text_muted">VoiceForge server must be running</small>
            </div>

            <hr>

            <!-- TTS Generation Settings -->
            <div class="voiceforge-tts-settings">
                <div class="flex-container gap10 alignItemsCenter marginBot5">
                    <label for="voiceforge_chunk_size" style="min-width: 100px;">Chunk Size:</label>
                    <input type="range" id="voiceforge_chunk_size" min="5" max="100" step="5" 
                           value="${this.settings?.chunk_size || 50}" style="flex: 1;">
                    <span id="voiceforge_chunk_label" style="min-width: 50px; text-align: right;">
                        ${this.settings?.chunk_size || 50}
                    </span>
                </div>
                <small class="text_muted" style="display: block; margin-bottom: 8px;">
                    5-25 = fast startup | 50 = balanced | 75-100 = best quality
                </small>
                
                <div class="flex-container gap10 alignItemsCenter marginTop5">
                    <label for="voiceforge_seed" style="min-width: 100px;">Seed:</label>
                    <input type="number" id="voiceforge_seed" class="text_pole" style="width: 80px;"
                           value="${this.settings?.seed ?? 0}" min="-1" step="1">
                    <span class="text_muted" style="font-size: 0.85em;">0 = random, -1 = new each time, >0 = reproducible</span>
                </div>
            </div>
        </div>
        `;
    }

    constructor() {
        // No secret key handling needed - VoiceForge uses its own auth
    }

    dispose() {
        // Cleanup if needed
    }

    async loadSettings(settings) {
        // Initialize with defaults
        this.settings = { ...this.defaultSettings };

        // Apply saved settings
        for (const key in settings) {
            if (key in this.settings) {
                this.settings[key] = settings[key];
            }
        }

        // Setup UI event handlers
        this.setupEventHandlers();

        // Update UI checkboxes to reflect loaded settings
        this.updateSettingsUI();

        // Try to connect to VoiceForge server
        await this.connectToServer();

        console.debug('VoiceForge: Settings loaded', this.settings);
    }

    /**
     * Update the settings UI checkboxes to reflect current settings values
     */
    updateSettingsUI() {
        $('#voiceforge_endpoint').val(this.settings.provider_endpoint);
        
        // TTS generation settings
        const chunkSize = this.settings.chunk_size || 50;
        $('#voiceforge_chunk_size').val(chunkSize);
        $('#voiceforge_chunk_label').text(chunkSize);
        
        const seed = this.settings.seed ?? 0;
        $('#voiceforge_seed').val(seed);
        
        console.debug('VoiceForge: UI updated - chunk:', chunkSize, 'seed:', seed);
    }

    saveTtsProviderSettings() {
        extension_settings.tts['VoiceForge'] = this.settings;
        saveSettingsDebounced();
    }

    setupEventHandlers() {
        // Endpoint change
        $('#voiceforge_endpoint').off('input').on('input', () => {
            this.settings.provider_endpoint = String($('#voiceforge_endpoint').val()).trim();
            this.saveTtsProviderSettings();
        });

        // Connect button
        $('#voiceforge_connect').off('click').on('click', async () => {
            this.settings.provider_endpoint = String($('#voiceforge_endpoint').val()).trim();
            this.saveTtsProviderSettings();
            await this.connectToServer();
        });

        // Chunk size slider
        $('#voiceforge_chunk_size').off('input').on('input', () => {
            const size = parseInt($('#voiceforge_chunk_size').val());
            this.settings.chunk_size = size;
            $('#voiceforge_chunk_label').text(size);
            this.saveTtsProviderSettings();
        });
        // Seed
        $('#voiceforge_seed').off('input').on('input', () => {
            this.settings.seed = parseInt($('#voiceforge_seed').val()) || 0;
            this.saveTtsProviderSettings();
        });
    }

    async connectToServer() {
        const statusIcon = $('#voiceforge_status_icon');
        const statusText = $('#voiceforge_status_text');
        const modulesStatus = $('#voiceforge_modules_status');

        statusIcon.css('color', 'orange');
        statusText.text('Connecting...');
        modulesStatus.empty();

        try {
            // Check health
            const healthResponse = await fetch(`${this.settings.provider_endpoint}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });

            if (!healthResponse.ok) {
                throw new Error('Server not responding');
            }

            // Fetch modules status
            const modulesResponse = await fetch(`${this.settings.provider_endpoint}/api/modules`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });

            let modules = {};
            if (modulesResponse.ok) {
                modules = await modulesResponse.json();
            }

            await Promise.allSettled([
                this.fetchConfig(),
                this.fetchAudioPrompts(),
                this.fetchRvcModels(),
                this.fetchKokoroVoices(),
                this.fetchBackgroundTracks(),
            ]);

            // Update status
            statusIcon.css('color', 'lime');
            statusText.text('Connected to VoiceForge');

            // Show modules status
            const modulesList = [];
            if (modules.pocket_tts) modulesList.push('✓ Pocket TTS');
            else modulesList.push('✗ Pocket TTS');
            if (modules.kokoro) modulesList.push('✓ Kokoro');
            else modulesList.push('✗ Kokoro');
            if (modules.rvc) modulesList.push('✓ RVC');
            else modulesList.push('✗ RVC');
            if (modules.postprocess) modulesList.push('✓ Post-Process');
            else modulesList.push('✗ Post-Process');

            modulesStatus.html(`<small>${modulesList.join(' | ')}</small>`);

            // Build voices list
            await this.buildVoicesList();
            
            // Warm up the TTS endpoint connection (non-blocking)
            // This pre-establishes the HTTP connection for faster first TTS request
            this.warmupConnection();

            return true;
        } catch (error) {
            console.error('VoiceForge: Connection failed', error);
            statusIcon.css('color', 'red');
            statusText.text('Connection failed - Is VoiceForge running?');
            modulesStatus.html(`<small style="color: #ff6b6b;">${error.message}</small>`);
            return false;
        }
    }
    
    /**
     * Warm up the TTS endpoint connection
     * This sends a lightweight request to pre-establish the HTTP connection,
     * reducing latency on the first actual TTS request (avoids DNS/TLS overhead)
     */
    warmupConnection() {
        // Fire-and-forget request to health endpoint to establish connection
        fetch(`${this.settings.provider_endpoint}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(2000),
        }).catch(() => {});
        console.debug('[VoiceForge] Connection warmup sent');
    }

    async fetchAudioPrompts() {
        try {
            const response = await fetch(`${this.settings.provider_endpoint}/api/audio-prompts`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
                const data = await response.json();
                this.audioPrompts = data.prompts || [];
                console.debug('VoiceForge: Loaded audio prompts', this.audioPrompts);
            }
        } catch (error) {
            console.warn('VoiceForge: Failed to fetch audio prompts', error);
            this.audioPrompts = [];
        }
    }

    async fetchRvcModels() {
        try {
            const response = await fetch(`${this.settings.provider_endpoint}/api/models`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
                const data = await response.json();
                this.rvcModels = data.models || [];
                console.debug('VoiceForge: Loaded RVC models', this.rvcModels);
            }
        } catch (error) {
            console.warn('VoiceForge: Failed to fetch RVC models', error);
            this.rvcModels = [];
        }
    }

    async fetchKokoroVoices() {
        // Kokoro voices are hardcoded to match the VoiceForge server
        // These are the available voices in Kokoro v1.0
        this.kokoroVoices = [
            // American English (en-us) - Female
            { name: 'af_sarah', label: 'Sarah (Female US)' },
            { name: 'af_bella', label: 'Bella (Female US)' },
            { name: 'af_heart', label: 'Heart (Female US)' },
            { name: 'af_nicole', label: 'Nicole (Female US)' },
            { name: 'af_sky', label: 'Sky (Female US)' },
            // American English (en-us) - Male
            { name: 'am_michael', label: 'Michael (Male US)' },
            { name: 'am_echo', label: 'Echo (Male US)' },
            { name: 'am_onyx', label: 'Onyx (Male US)' },
            { name: 'am_fable', label: 'Fable (Male US)' },
            { name: 'am_puck', label: 'Puck (Male US)' },
            { name: 'am_sage', label: 'Sage (Male US)' },
            // British English (en-gb) - Female
            { name: 'bf_emma', label: 'Emma (Female UK)' },
            { name: 'bf_isabella', label: 'Isabella (Female UK)' },
            { name: 'bf_alice', label: 'Alice (Female UK)' },
            // British English (en-gb) - Male
            { name: 'bm_george', label: 'George (Male UK)' },
            { name: 'bm_lewis', label: 'Lewis (Male UK)' },
            { name: 'bm_daniel', label: 'Daniel (Male UK)' },
        ];
        console.debug('VoiceForge: Loaded Kokoro voices', this.kokoroVoices);
    }

    /**
     * Fetch server config from /api/config endpoint
     * This is used to populate the Default Voice with actual server settings
     */
    async fetchConfig() {
        try {
            const response = await fetch(`${this.settings.provider_endpoint}/api/config`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
                this.serverConfig = await response.json();
                console.debug('VoiceForge: Loaded server config', this.serverConfig);
            }
        } catch (error) {
            console.warn('VoiceForge: Failed to fetch config', error);
            this.serverConfig = null;
        }
    }

    /**
     * Get server config (for Default Voice population)
     */
    getServerConfig() {
        return this.serverConfig;
    }

    async fetchBackgroundTracks() {
        try {
            const backgroundListUrl = `${this.settings.provider_endpoint}/v1/background/list`;
            console.debug('VoiceForge: Fetching background tracks from:', backgroundListUrl);
            
            const response = await fetch(backgroundListUrl, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
                const data = await response.json();
                console.debug('VoiceForge: Raw background tracks response:', data);
                
                // Handle different response formats
                let tracks = data.files || data.tracks || data || [];
                
                // Normalize tracks to array of {name, path} objects
                this.bgTracks = tracks.map(track => {
                    if (typeof track === 'string') {
                        return { 
                            name: track.split('/').pop().replace(/\.[^/.]+$/, ''), 
                            path: track 
                        };
                    } else if (track && typeof track === 'object') {
                        return {
                            name: track.name || track.filename || track.path?.split('/').pop().replace(/\.[^/.]+$/, '') || 'Unknown',
                            path: track.path || track.url || track.file || ''
                        };
                    }
                    return null;
                }).filter(t => t && t.path);
                
                console.debug('VoiceForge: Loaded background tracks', this.bgTracks);
            } else {
                console.warn('VoiceForge: Background tracks fetch failed with status:', response.status);
                this.bgTracks = [];
            }
        } catch (error) {
            console.warn('VoiceForge: Failed to fetch background tracks', error);
            this.bgTracks = [];
        }
    }

    async buildVoicesList() {
        // Build a combined list of available voices
        // Each "voice" is a combination of audio_prompt + optional rvc_model
        this.voices = [];

        // Add audio prompts as voice options
        for (const prompt of this.audioPrompts) {
            this.voices.push({
                name: prompt.name,
                voice_id: prompt.name,
                type: 'audio_prompt',
                path: prompt.path,
            });
        }

        console.debug('VoiceForge: Built voices list', this.voices);
    }

    async checkReady() {
        // Try to connect if not already connected
        if (this.voices.length === 0) {
            await this.connectToServer();
        }
    }

    async onRefreshClick() {
        await this.connectToServer();
    }

    /**
     * Get voice configuration for a voice name
     */
    async getVoice(voiceName) {
        if (this.voices.length === 0) {
            await this.buildVoicesList();
        }

        const match = this.voices.find(v => v.name === voiceName);

        if (!match) {
            throw `VoiceForge: Voice "${voiceName}" not found`;
        }

        return match;
    }

    /**
     * Get available audio prompts for voice map UI
     */
    getAudioPrompts() {
        return this.audioPrompts;
    }

    /**
     * Get available RVC models for voice map UI
     */
    getRvcModels() {
        return this.rvcModels;
    }

    /**
     * Get available Kokoro voices for voice map UI
     */
    getKokoroVoices() {
        return this.kokoroVoices;
    }

    /**
     * Get available background tracks (cached)
     */
    getBackgroundTracks() {
        return this.bgTracks || [];
    }

    /**
     * Generate a unique request ID for session tracking
     * This ensures all requests in a TTS session use the same ID for caching
     */
    generateRequestId() {
        return Math.random().toString(36).substring(2, 10);
    }

    /**
     * Reset request ID for a new message/session
     * Call this when starting a completely new TTS session
     */
    resetRequestId() {
        this.currentRequestId = null;
        this.lastCharacter = null;
        console.log('[VoiceForge] Request ID reset');
    }

    /**
     * Generate TTS audio (always streaming mode)
     * @param {string} text - Text to speak
     * @param {string} voiceId - Voice ID (audio prompt name)
     * @param {string} voiceMapKey - Full voice map key (character name)
     * @param {string} requestId - Optional request ID for session tracking (reuse for same character)
     */
    async generateTts(text, voiceId, voiceMapKey = null, requestId = null) {
        // Get voice-specific settings from voice map
        const voiceSettings = this.getVoiceSettings(voiceMapKey || voiceId);
        
        // Character name for this request - use voiceMapKey which IS the character name
        const characterName = voiceMapKey || voiceId;
        this.currentCharacter = characterName;
        console.log('[VoiceForge] generateTts - character:', characterName);
        
        // Generate or reuse request ID for session tracking
        // This ensures RVC model caching works across chunks
        if (!requestId) {
            // Check if same character - reuse existing request ID
            if (characterName === this.lastCharacter && this.currentRequestId) {
                requestId = this.currentRequestId;
                console.log('[VoiceForge] Reusing request ID for same character:', requestId);
            } else {
                requestId = this.generateRequestId();
                this.currentRequestId = requestId;
                this.lastCharacter = characterName;
                console.log('[VoiceForge] New request ID for character:', requestId);
            }
        } else {
            this.currentRequestId = requestId;
        }
        
        // Pass character name directly to streaming function - no race conditions
        return this.fetchTtsGenerationStreaming(text, voiceSettings, requestId, characterName);
    }

    async cancelGeneration(requestId = null) {
        const targetRequestId = (typeof requestId === 'string' && requestId.trim())
            ? requestId.trim()
            : (typeof this.activeStreamRequestId === 'string' && this.activeStreamRequestId.trim())
                ? this.activeStreamRequestId.trim()
                : (typeof this.currentRequestId === 'string' && this.currentRequestId.trim())
                    ? this.currentRequestId.trim()
                    : null;

        if (!targetRequestId) {
            return { status: 'skipped', message: 'No active VoiceForge request id', requestId: null };
        }

        const cancelUrl = `${this.settings.provider_endpoint}/api/generate/cancel?request_id=${encodeURIComponent(targetRequestId)}`;
        let response;
        try {
            response = await fetch(cancelUrl, { method: 'POST' });
        } catch (error) {
            if (this.activeStreamAbortController) {
                this.activeStreamAbortController.abort('cancel_generation_transport_failed');
            }
            throw error;
        }

        let data = null;
        try {
            data = await response.json();
        } catch (_) {
            data = null;
        }

        if (!response.ok) {
            throw new Error(`VoiceForge cancel failed: HTTP ${response.status}`);
        }

        if (this.activeStreamAbortController) {
            this.activeStreamAbortController.abort('cancel_generation_requested');
        }

        return {
            status: data?.status || 'ok',
            message: data?.message || 'Cancel signal sent',
            requestId: targetRequestId,
        };
    }

    /**
     * Get voice settings from the voice map
     * Returns all settings including post-processing and background tracks
     * Falls back to server config (from /api/config) for defaults
     */
    getVoiceSettings(voiceMapKey) {
        // Get defaults from server config
        const cfg = this.serverConfig || {};
        const defaultRvc = cfg.enable_rvc !== undefined ? cfg.enable_rvc : true;
        const defaultPost = cfg.enable_post !== undefined ? cfg.enable_post : true;
        const defaultBg = cfg.enable_background !== undefined ? cfg.enable_background : false;

        // Try to get extended settings from voiceMap
        const voiceMap = this.settings.voiceMap || {};
        const settings = voiceMap[voiceMapKey];
        const defaultSettings = voiceMap[DEFAULT_VOICE_MARKER];
        const defaultObj = defaultSettings && typeof defaultSettings === 'object' ? defaultSettings : null;
        const resolved = settings || defaultSettings;

    if (resolved && typeof resolved === 'object') {
        // Use server config defaults when value is null or undefined
        return {
            audio_prompt: (resolved.audio_prompt && resolved.audio_prompt !== DEFAULT_VOICE_MARKER)
                ? resolved.audio_prompt
                : (defaultObj?.audio_prompt || null),
            pocket_tts_voice: resolved.pocket_tts_voice || defaultObj?.pocket_tts_voice || null,
            kokoro_voice: resolved.kokoro_voice || defaultObj?.kokoro_voice || null,
            omnivoice_voice: resolved.omnivoice_voice || defaultObj?.omnivoice_voice || null,
            omnivoice_ref_text: resolved.omnivoice_ref_text || defaultObj?.omnivoice_ref_text || null,
            tts_backend: resolved.tts_backend || defaultObj?.tts_backend || null,
            rvc_model: resolved.rvc_model || null,
            enable_rvc: resolved.enable_rvc != null ? resolved.enable_rvc : defaultRvc,
            enable_post: resolved.enable_post != null ? resolved.enable_post : defaultPost,
            enable_background: resolved.enable_background != null ? resolved.enable_background : defaultBg,
            // Per-voice background tracks
            bg_tracks: resolved.bg_tracks || [],
            // Per-voice RVC settings (null means use server defaults)
            rvc: resolved.rvc || null,
            // Per-voice post-processing settings (null means use server defaults)
            post: resolved.post || null,
        };
    }

    throw new Error(`Voice settings not found for key "${voiceMapKey}"`);
}

    /**
     * Fetch TTS voice objects for the voice map dropdown
     */
    async fetchTtsVoiceObjects() {
        // Return audio prompts as voice options
        if (this.audioPrompts.length === 0) {
            await this.fetchAudioPrompts();
        }

        return this.audioPrompts.map(p => ({
            name: p.name,
            voice_id: p.name,
            lang: 'en-US',
            preview_url: false,
        }));
    }

/**
   * Build request body for TTS generation
   * Includes all per-voice RVC, post-processing and background settings
   */
  buildRequestBody(inputText, voiceSettings) {
    if (!voiceSettings || typeof voiceSettings !== 'object') {
      throw new Error('Voice settings missing for request');
    }

    const backend = this.normalizeTtsBackend(voiceSettings.tts_backend);
    if (!backend) {
      throw new Error('tts_backend missing in voice settings');
    }
    if (!Number.isFinite(Number(this.settings.chunk_size))) {
      throw new Error('chunk_size missing in provider settings');
    }

    const normalizedInputText = this.sanitizeInputText(inputText);

    const body = {
      input: normalizedInputText,
      rvc_model: voiceSettings.rvc_model || null,
      enable_rvc: voiceSettings.enable_rvc && voiceSettings.rvc_model ? true : false,
      enable_post: voiceSettings.enable_post,
      enable_background: voiceSettings.enable_background,
      response_format: 'mp3',
      tts_mode: 'streaming',
      output_volume: 1.0,
      tts_backend: backend,
    };
    // Add Pocket TTS voice if using that backend
    if (backend === 'pocket_tts') {
      if (!voiceSettings.pocket_tts_voice) {
        throw new Error('pocket_tts requires pocket_tts_voice');
      }
      body.pocket_tts_voice = voiceSettings.pocket_tts_voice;
    }

    // Add Kokoro voice if using that backend
    if (backend === 'kokoro') {
      if (!voiceSettings.kokoro_voice) {
        throw new Error('kokoro requires kokoro_voice');
      }
      body.kokoro_voice = voiceSettings.kokoro_voice;
    }

    // Add OmniVoice voice/prompt if using OmniVoice backend
    if (backend === 'omnivoice') {
      let promptPath = null;
      if (voiceSettings.audio_prompt) {
        if (typeof voiceSettings.audio_prompt === 'string' && (voiceSettings.audio_prompt.includes('/') || voiceSettings.audio_prompt.includes('\\') || voiceSettings.audio_prompt.endsWith('.wav'))) {
          promptPath = voiceSettings.audio_prompt;
        } else {
          const prompt = this.audioPrompts.find(p => p.name === voiceSettings.audio_prompt);
          if (prompt) {
            promptPath = prompt.path;
          }
        }
      }
      const omniVoiceSetting = (voiceSettings.omnivoice_voice && voiceSettings.omnivoice_voice !== DISABLED_VOICE_MARKER)
        ? voiceSettings.omnivoice_voice
        : null;
      const omniVoiceRef = promptPath || omniVoiceSetting;
      if (!omniVoiceRef) {
        throw new Error(`${backend} requires audio_prompt path or omnivoice_voice`);
      }
      body.omnivoice_voice = omniVoiceRef;
      body.omnivoice_ref_asr_model = this.getOmniVoiceAsrModel();
      if (voiceSettings.omnivoice_ref_text && String(voiceSettings.omnivoice_ref_text).trim()) {
        body.omnivoice_ref_text = String(voiceSettings.omnivoice_ref_text).trim();
      }
    }

        // Handle per-voice RVC settings
        const rvc = voiceSettings.rvc;
        if (voiceSettings.enable_rvc && rvc) {
            if (rvc.pitch_algo !== undefined) body.pitch_algo = rvc.pitch_algo;
            if (rvc.pitch_level !== undefined) body.pitch_level = rvc.pitch_level;
            if (rvc.index_influence !== undefined) body.index_influence = rvc.index_influence;
            if (rvc.respiration_median_filtering !== undefined) body.respiration_median_filtering = rvc.respiration_median_filtering;
            if (rvc.envelope_ratio !== undefined) body.envelope_ratio = rvc.envelope_ratio;
            if (rvc.consonant_breath_protection !== undefined) body.consonant_breath_protection = rvc.consonant_breath_protection;
        }

        // Handle per-voice background tracks
        const bgTracks = voiceSettings.bg_tracks || [];
        if (voiceSettings.enable_background && bgTracks.length > 0) {
            // Use per-voice background tracks
            body.bg_files = bgTracks.map(t => t.path).filter(Boolean);
            body.bg_volumes = bgTracks.map(t => t.volume || 0.5);
            body.bg_delays = bgTracks.map(t => t.delay || 0);
            body.bg_fade_ins = bgTracks.map(t => t.fade_in || 2);
            body.bg_fade_outs = bgTracks.map(t => t.fade_out || 2);
            body.use_config_bg_tracks = false; // Don't use server config, use our tracks
        } else if (voiceSettings.enable_background) {
            // No per-voice tracks, use server config
            body.use_config_bg_tracks = true;
        }

        // Handle per-voice post-processing settings
        // NOTE: Must match exactly what VoiceForge UI sends in collectTTSRequest()
        const post = voiceSettings.post;
        if (voiceSettings.enable_post && post) {
            // EQ settings
            if (post.highpass !== undefined) body.highpass = post.highpass;
            if (post.lowpass !== undefined) body.lowpass = post.lowpass;
            if (post.bass_freq !== undefined) body.bass_freq = post.bass_freq;
            if (post.bass_gain !== undefined) body.bass_gain = post.bass_gain;
            if (post.treble_freq !== undefined) body.treble_freq = post.treble_freq;
            if (post.treble_gain !== undefined) body.treble_gain = post.treble_gain;

            // Reverb settings
            if (post.reverb_delay !== undefined) body.reverb_delay = post.reverb_delay;
            if (post.reverb_decay !== undefined) body.reverb_decay = post.reverb_decay;

            // Effects
            if (post.crystalizer !== undefined) body.crystalizer = post.crystalizer;
            if (post.deesser !== undefined) body.deesser = post.deesser;

            // Spatial Audio (8D)
            if (post.audio_8d_enabled !== undefined) body.audio_8d_enabled = post.audio_8d_enabled;
            if (post.audio_8d_mode !== undefined) body.audio_8d_mode = post.audio_8d_mode;
            if (post.audio_8d_speed !== undefined) body.audio_8d_speed = post.audio_8d_speed;
            if (post.audio_8d_depth !== undefined) body.audio_8d_depth = post.audio_8d_depth;  // Arc in degrees
            if (post.audio_8d_distance !== undefined) body.audio_8d_distance = post.audio_8d_distance;
            if (post.audio_8d_quality !== undefined) body.audio_8d_quality = post.audio_8d_quality;
            if (post.audio_8d_itd !== undefined) body.audio_8d_itd = post.audio_8d_itd;
            if (post.audio_8d_proximity !== undefined) body.audio_8d_proximity = post.audio_8d_proximity;
            if (post.audio_8d_crossfeed !== undefined) body.audio_8d_crossfeed = post.audio_8d_crossfeed;
            if (post.audio_8d_micro_movements !== undefined) body.audio_8d_micro_movements = post.audio_8d_micro_movements;
            if (post.audio_8d_speech_aware !== undefined) body.audio_8d_speech_aware = post.audio_8d_speech_aware;

            // ASMR Enhancement
            if (post.asmr_enabled !== undefined) body.asmr_enabled = post.asmr_enabled;
            if (post.asmr_tingles !== undefined) body.asmr_tingles = post.asmr_tingles;
            if (post.asmr_breathiness !== undefined) body.asmr_breathiness = post.asmr_breathiness;
            if (post.asmr_crispness !== undefined) body.asmr_crispness = post.asmr_crispness;
            if (post.asmr_warmth !== undefined) body.asmr_warmth = post.asmr_warmth;
            if (post.asmr_intimacy !== undefined) body.asmr_intimacy = post.asmr_intimacy;
            if (post.asmr_mouth_detail !== undefined) body.asmr_mouth_detail = post.asmr_mouth_detail;
            if (post.asmr_softness !== undefined) body.asmr_softness = post.asmr_softness;
        }

        return body;
    }

    /**
     * Call VoiceForge TTS API (streaming mode - returns async generator)
     * Yields audio chunks as they become available.
     * Background audio is handled via the main VoiceForge background stream.
     * @param {string} inputText - Text to speak
     * @param {object} voiceSettings - Voice configuration
     * @param {string} requestId - Request ID for session tracking and RVC caching
     * @param {string} characterName - Character name for background audio tracking
     */
    async *fetchTtsGenerationStreaming(inputText, voiceSettings, requestId, characterName) {
        const fetchStartTime = performance.now();
        const verboseTiming = localStorage.getItem('voiceforge_tts_timing') === '1';
        if (verboseTiming) {
            console.info(`[TTS TIMING ${requestId}] FETCH START at ${fetchStartTime.toFixed(0)}ms - "${inputText.substring(0, 30)}"`);
        }

        const abortController = new AbortController();
        this.activeStreamAbortController = abortController;
        this.activeStreamRequestId = requestId;

        const backend = this.normalizeTtsBackend(voiceSettings?.tts_backend);
        const needsPromptLookup = backend === 'omnivoice' && !!voiceSettings?.audio_prompt;
        if (needsPromptLookup) {
            const hasPromptInCache = this.audioPrompts.some(p => p.name === voiceSettings.audio_prompt);
            if (!hasPromptInCache) {
                await this.fetchAudioPrompts();
            }
        }

        const requestBody = this.buildRequestBody(inputText, voiceSettings);

        // Add request_id for session tracking - critical for RVC model caching
        requestBody.request_id = requestId;

        let response;
        try {
            response = await fetch(`${this.settings.provider_endpoint}/api/generate/stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                signal: abortController.signal,
            });
        } catch (error) {
            if (error?.name === 'AbortError') {
                return;
            }
            throw error;
        }
        
        if (verboseTiming) {
            console.info(`[TTS TIMING ${requestId}] FETCH RESPONSE at ${(performance.now() - fetchStartTime).toFixed(0)}ms`);
        }

        if (!response.ok) {
            const errorText = await response.text();
            toastr.error(`TTS Generation Failed: ${response.status}`, 'VoiceForge');
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        // Parse SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let isFirstChunk = true;
        let bgSessionId = null;
        // LOCAL copy of bgStreamInfo for this request
        let localBgStreamInfo = null;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const event = JSON.parse(line.slice(6));
                            
                            if (event.type === 'start') {
                                // Handle background audio setup from start event
                                if (verboseTiming) {
                                    console.log('[VoiceForge] Stream started:', event);
                                    console.log('[VoiceForge] background_enabled:', event.background_enabled);
                                    console.log('[VoiceForge] background_tracks:', event.background_tracks);
                                    console.log('[VoiceForge] characterName:', characterName);
                                }
                                
                                // Store background stream info locally to prevent race conditions
                                if (event.background_enabled && event.background_tracks && event.background_tracks.length > 0) {
                                    const mainUrl = new URL(this.settings.provider_endpoint);
                                    const asUrl = mainUrl.origin;

								localBgStreamInfo = {
								session_id: event.background_session_id || event.request_id,
								tracks: event.background_tracks,
								sample_rate: event.sample_rate || 44100,
								voiceforge_url: asUrl,
								};

                                    bgSessionId = localBgStreamInfo.session_id;
                                    if (verboseTiming) {
                                        console.log(`[VoiceForge] Background audio enabled: ${event.background_tracks.length} tracks`);
                                        console.log('[VoiceForge] localBgStreamInfo:', localBgStreamInfo);
                                    }
                                } else {
                                    localBgStreamInfo = null;
                                    if (verboseTiming) console.log('[VoiceForge] Background audio NOT enabled or no tracks');
                                }
                                
                            } else if (event.type === 'chunk' && event.audio) {
                                if (verboseTiming) {
                                    console.info(`[TTS TIMING ${requestId}] CHUNK RECEIVED at ${(performance.now() - fetchStartTime).toFixed(0)}ms`);
                                }
                                // Start background audio on first voice chunk of this request
                                // AudioManager handles the same-character check internally
                                // Delay background start slightly so TTS playback gets priority
                                if (isFirstChunk && localBgStreamInfo) {
                                    const bgInfo = localBgStreamInfo;
                                    const charName = characterName;
                                    setTimeout(() => {
                                        const audioManager = getAudioManager();
                                        if (audioManager) {
                                            // Let AudioManager decide whether to start/skip/restart
                                            // It will skip if already playing for same character
                                            audioManager.startVoiceForgeBackground(bgInfo, charName);
                                        }
                                    }, 300); // 300ms delay for TTS to start playing first
                                }
                                isFirstChunk = false;
                                
                                // Decode base64 audio and create blob - yield directly for speed
                                const audioData = atob(event.audio);
                                const audioArray = new Uint8Array(audioData.length);
                                for (let i = 0; i < audioData.length; i++) {
                                    audioArray[i] = audioData.charCodeAt(i);
                                }
                                yield new Blob([audioArray], { type: event.mime_type || event.mimeType || 'audio/wav' });
                                
                            } else if (event.type === 'complete') {
                                if (verboseTiming) console.log('[VoiceForge] Stream complete');
                                // Note: Background audio will continue until voice playback ends
                                // The caller is responsible for calling stopBackgroundStream when audio playback finishes
                                
                            } else if (event.type === 'error') {
                                console.error('VoiceForge streaming error:', event.message);
                                toastr.error(event.message, 'VoiceForge');
                                // Force stop background on error via AudioManager
                                const audioManager = getAudioManager();
                                if (audioManager) {
                                    audioManager.stopVoiceForgeBackground(0.5, true);
                                }
                                
                            } else if (event.type === 'cancelled') {
                                console.warn('VoiceForge generation cancelled:', event.message);
                            }
                        } catch (e) {
                            console.warn('Failed to parse SSE event:', line, e);
                        }
                    }
                }
            }
        } catch (error) {
            if (error?.name !== 'AbortError') {
                throw error;
            }
        } finally {
            // Stream ended - but don't stop background here, let it continue with voice playback
            // The index.js will call stopBackgroundStream when audio playback is complete
            if (this.activeStreamAbortController === abortController) {
                this.activeStreamAbortController = null;
            }
            if (this.activeStreamRequestId === requestId) {
                this.activeStreamRequestId = null;
            }
        }
    }

    /**
     * Stop background audio stream (delegates to AudioManager)
     * @param {number} fadeOut - Fade out duration in seconds (default 2.0)
     */
    async stopBackgroundStream(fadeOut = 2.0) {
        const audioManager = getAudioManager();
        if (audioManager) {
            await audioManager.stopVoiceForgeBackground(fadeOut);
        }
        // Background state is managed by AudioManager per request
    }
    
    /**
     * Check if background audio is currently playing
     */
    isBackgroundPlaying() {
        const audioManager = getAudioManager();
        return audioManager?.isVoiceForgeBackgroundPlaying() || false;
    }
}
