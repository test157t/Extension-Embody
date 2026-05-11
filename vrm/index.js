/*
DONE:
- Running example into ST: load model/animation
- Organize code into clean part
- basic ui enable/disable, show grid, follow cursor, reset scene
- Character/model select
- expression/animation select default/classify message
- model reset settings button
- blinking auto (basic)
- transparent background
- slash command expression/motion
- default setting using expression name
- Efficient resize handling
- basic bvh loader
- mouth movement
    - basic text based
- Basic model control move/rotate/scale
    - dragging keep offset with mouse cursor
    - should not work through ui
- Save model settings pos/rotate/scale
- Fix animation chaining / crossfading / default loop
- loop option for animations command
- Consider animation as group Idle.bvh/Idle1.bvh/Idle2.bvh appear as "Idle" group, play one randomly
- Command by default play requested animation not the group
- group support
- Better text talk function
- only full load at start and on reload button
- Error message for wrong animation files
- cache animation files
- tts lip sync
    - xtts compatible (not streaming mode)
    - RVC compatible
    - created and delete on tts_audio play/pause/end
- animation cache
    - optional
    - model specific
    - when loading a model all its animation group are cached
    - playing a non cached animation will cached it
- vrm cache
    - optional
    - keep vrm model previously loaded for instant switch between models
    - no duplicate model possible if on
- Control box follow animation
- Hit boxes
    - click detection
    - expression/motion/message mapping ui
    - default to no change if set to none
    - disabled by default, enable checkbox in ui
- Light control
- lock model menu option


TODO:
    v1.0:
        - Change default map from happy to relaxed
    v2.0:
        - custom color picker
        - blink smooth and adapt to current expression?
            - The expression define the blink blend can't do much for now
        - click interaction
        - other kind of camera
        - 3D room
        - make it work with live2d on top of it
        - Model Gallery

*/
import { eventSource, event_types, getCharacters, saveSettings, saveSettingsDebounced } from "../../../../../script.js";
import { extension_settings, getContext, ModuleWorkerWrapper } from "../../../../extensions.js";
import { registerSlashCommand } from '../../../../slash-commands.js';
export { MODULE_NAME };
import {
    MODULE_NAME,
    DEBUG_PREFIX,
    VRM_CANVAS_ID,
    DEFAULT_LIGHT_COLOR,
    DEFAULT_LIGHT_INTENSITY
} from "./constants.js";
import {
    loadScene,
    loadAllModels,
    getVRM,
    setExpression,
    setMotion,
    setMotionSequence,
    setCursorTracking,
    clearAnimationSequence,
    updateExpression,
    talk,
    setModel,
    setLight,
    setBackground,
    updateModel,
    setPhonePropVisible
} from "./vrm.js";
import {
    onEnabledClick,
    onFollowCameraClick,
    onFollowCursorClick,
    onBlinkClick,
    onNaturalIdleClick,
    onTtsLipsSyncClick,
    onAutoSendHitboxMessageClick,
    onHitboxCallmodeDelayChange,
    onHitboxCallmodeWaitTtsStartChange,
    onLockModelsClick,
    onHitboxesClick,
    onModelCacheClick,
    onAnimationCacheClick,
    onLightChange,
    onLightColorResetClick,
    onLightIntensityResetClick,
    onShowGridClick,
    onModelZIndexChange,
    onCharacterChange,
    onCharacterRefreshClick,
    onCharacterRemoveClick,
    updateCharactersList,
    updateCharactersListOnce,
    updateCharactersModels,
    onModelRefreshClick,
    onModelChange,
    onModelResetClick,
    onModelScaleChange,
    onModelPositionChange,
    onModelRotationChange,
    onAnimationMappingChange,
    onSequencePlayClick,
    onSequenceClearClick,
    onBlendShapeAddClick,
    loadBlendShapeMappingUi,
    applyModelZIndex,
    animations_files,
    models_files
} from "./ui.js";
import "./controls.js";

import { currentChatMembers } from "./utils.js";

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

    $('#vrm_model_refresh_button').on('click', onModelRefreshClick);
    $('#vrm_model_select').on('change', onModelChange);
    $('#vrm_model_reset_button').on('click', onModelResetClick);

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

    const windowHtml = $(await $.get(`${extensionFolderPath}/window.html`));
    const embodyPanel = $('#embody-vrm-panel');
    if (embodyPanel.length) {
        embodyPanel.empty().append(windowHtml);
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
