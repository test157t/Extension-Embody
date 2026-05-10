import * as THREE from './lib/three.module.js';
import { eventSource, saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings, getContext } from '../../../../extensions.js';

import {
    DEBUG_PREFIX,
    VRM_CANVAS_ID,
    MIN_SCALE,
    MAX_SCALE,
    HIT_BOX_DELAY
} from "./constants.js";

import {
    current_avatars,
    renderer,
    camera,
    VRM_CONTAINER_NAME,
    setExpression,
    setMotion,
    setMotionSequence,
    setCursorPosition,
    getModelRotationWithoutCursorOffset,
    markUserActivity,
    syncCharacterCollisionProxies
} from "./vrm.js";
import { func } from './lib/jsm/nodes/code/FunctionNode.js';
import { delay } from '../../../../utils.js';

// Mouse controls
let previousMouse = undefined;
let currentMouse = undefined;
let mouseOffset = undefined;
let isDragging = false;
let isRotating = false;
let isScaling = false;
let dragCharacter = undefined;
let isMouseDown = false;

let previous_interaction = { 'character': '', 'message': '' };
let hitboxAutoGenerateInFlight = false;
const touchMemory = {};
const voiceforgeSyncState = {
    listenersBound: false,
    speaking: false,
    lastTtsStartAt: 0,
    lastTtsChunkAt: 0,
};
const TRANSFORM_SYNC_INTERVAL_MS = 75;
let lastTransformSyncAt = 0;

let raycaster = new THREE.Raycaster();

const HITBOX_LABELS = {
    head: 'head',
    chest: 'chest',
    groin: 'groin',
    butt: 'butt',
    leftHand: 'left hand',
    rightHand: 'right hand',
    leftLeg: 'left thigh',
    rightLeg: 'right thigh',
    leftFoot: 'left foot',
    rightFoot: 'right foot',
};

const HITBOX_TOUCH_LINES = {
    head: [
        'I gently brush your hair near your head.',
        'I softly pat your head.',
        'I lightly run my fingers over your head.'
    ],
    chest: [
        'I gently touch your chest.',
        'I slowly place my hands on your chest for a moment.',
        'I softly graze your chest with my fingertips.'
    ],
    groin: [
        'I brush my hand over your groin.',
        'I slowly touch your groin.',
        'I tease your groin with a light touch.'
    ],
    butt: [
        'I place a playful hand on your butt.',
        'I gently squeeze your butt.',
        'I run my palm over your butt.'
    ],
    leftHand: [
        'I take your left hand in mine.',
        'I gently trace along your left hand.',
        'I squeeze your left hand softly.'
    ],
    rightHand: [
        'I take your right hand in mine.',
        'I gently trace along your right hand.',
        'I squeeze your right hand softly.'
    ],
    leftLeg: [
        'I slowly touch your left thigh.',
        'I run my hand along your left leg.',
        'I gently squeeze your left thigh.'
    ],
    rightLeg: [
        'I slowly touch your right thigh.',
        'I run my hand along your right leg.',
        'I gently squeeze your right thigh.'
    ],
    leftFoot: [
        'I lightly touch your left foot.',
        'I trace my fingers along your left foot.',
        'I gently hold your left foot for a second.'
    ],
    rightFoot: [
        'I lightly touch your right foot.',
        'I trace my fingers along your right foot.',
        'I gently hold your right foot for a second.'
    ],
};

function getHitboxTouchPrompt(character, hitbox, mappedMessage = '') {
    const rawMapped = String(mappedMessage || '').trim();
    const label = HITBOX_LABELS[hitbox] || hitbox;
    const memoryKey = `${character}:${hitbox}`;
    const now = Date.now();
    const memory = touchMemory[memoryKey] || { count: 0, lastAt: 0 };
    memory.count = now - memory.lastAt < 3000 ? memory.count + 1 : 1;
    memory.lastAt = now;
    touchMemory[memoryKey] = memory;

    if (rawMapped) {
        const withPlaceholders = rawMapped
            .replaceAll('{character}', character)
            .replaceAll('{hitbox}', label)
            .replaceAll('{count}', String(memory.count));
        return withPlaceholders;
    }

    const lines = HITBOX_TOUCH_LINES[hitbox] || [`I touch your ${label}.`];
    const baseLine = lines[Math.floor(Math.random() * lines.length)];

    if (memory.count >= 3) {
        return `${baseLine} I keep focusing on your ${label}.`;
    }

    return baseLine;
}

function removeEventSourceListener(eventName, handler) {
    try {
        if (typeof eventSource?.off === 'function') {
            eventSource.off(eventName, handler);
            return;
        }
        if (typeof eventSource?.removeListener === 'function') {
            eventSource.removeListener(eventName, handler);
        }
    } catch (_e) {}
}

function bindVoiceforgeSyncListeners() {
    if (voiceforgeSyncState.listenersBound || !eventSource) {
        return;
    }

    const onTtsStart = () => {
        voiceforgeSyncState.speaking = true;
        voiceforgeSyncState.lastTtsStartAt = Date.now();
    };
    const onTtsChunkStart = () => {
        voiceforgeSyncState.speaking = true;
        voiceforgeSyncState.lastTtsChunkAt = Date.now();
    };
    const onTtsEnd = () => {
        voiceforgeSyncState.speaking = false;
    };

    removeEventSourceListener('voiceforge_tts_start', onTtsStart);
    removeEventSourceListener('voiceforge_tts_chunk_start', onTtsChunkStart);
    removeEventSourceListener('voiceforge_tts_end', onTtsEnd);
    removeEventSourceListener('voiceforge_tts_interrupted', onTtsEnd);

    eventSource.on('voiceforge_tts_start', onTtsStart);
    eventSource.on('voiceforge_tts_chunk_start', onTtsChunkStart);
    eventSource.on('voiceforge_tts_end', onTtsEnd);
    eventSource.on('voiceforge_tts_interrupted', onTtsEnd);

    voiceforgeSyncState.listenersBound = true;
}

function isVoiceforgeSpeechSyncEnabled() {
    return extension_settings?.tts?.enabled === true;
}

function getHitboxCallmodeSyncDelayMs() {
    const raw = Number(extension_settings?.vrm?.hitbox_callmode_sync_delay_ms);
    if (!Number.isFinite(raw)) {
        return 220;
    }
    return Math.max(0, Math.min(3000, Math.round(raw)));
}

function getHitboxCallmodeWaitForTtsStartMs() {
    const raw = Number(extension_settings?.vrm?.hitbox_callmode_wait_tts_start_ms);
    if (!Number.isFinite(raw)) {
        return 4500;
    }
    return Math.max(0, Math.min(12000, Math.round(raw)));
}

async function playHitboxAnimationAlignedWithVoiceforge(character, playFn) {
    if (typeof playFn !== 'function') {
        return;
    }

    if (!isVoiceforgeSpeechSyncEnabled()) {
        playFn();
        return;
    }

    bindVoiceforgeSyncListeners();

    const now = Date.now();
    const latestSpeechAt = Math.max(voiceforgeSyncState.lastTtsStartAt || 0, voiceforgeSyncState.lastTtsChunkAt || 0);
    const speakingRecently = latestSpeechAt > 0 && (now - latestSpeechAt) < 1300;

    const syncDelayMs = getHitboxCallmodeSyncDelayMs();

    if (voiceforgeSyncState.speaking || speakingRecently) {
        await delay(syncDelayMs);
        playFn();
        return;
    }

    const waitForTtsMs = getHitboxCallmodeWaitForTtsStartMs();

    await new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            removeEventSourceListener('voiceforge_tts_start', onSpeech);
            removeEventSourceListener('voiceforge_tts_chunk_start', onSpeech);
            clearTimeout(timeoutId);
            resolve();
        };
        const onSpeech = () => {
            voiceforgeSyncState.speaking = true;
            setTimeout(finish, syncDelayMs);
        };

        eventSource.on('voiceforge_tts_start', onSpeech);
        eventSource.on('voiceforge_tts_chunk_start', onSpeech);
        const timeoutId = setTimeout(finish, waitForTtsMs);
    });

    playFn();
}

function syncTransformUI(character, force = false) {
    if (!character || current_avatars[character] === undefined) {
        return;
    }

    const now = Date.now();
    if (!force && now - lastTransformSyncAt < TRANSFORM_SYNC_INTERVAL_MS) {
        return;
    }
    lastTransformSyncAt = now;

    const model_path = current_avatars[character]["model_path"];
    const settings = extension_settings.vrm.model_settings[model_path];

    $('#vrm_model_position_x').val(settings['x']);
    $('#vrm_model_position_x_value').text(settings['x']);
    $('#vrm_model_position_y').val(settings['y']);
    $('#vrm_model_position_y_value').text(settings['y']);
    $('#vrm_model_rotation_x').val(settings['rx']);
    $('#vrm_model_rotation_x_value').text(settings['rx']);
    $('#vrm_model_rotation_y').val(settings['ry']);
    $('#vrm_model_rotation_y_value').text(settings['ry']);
    $('#vrm_model_scale').val(settings['scale']);
    $('#vrm_model_scale_value').text(settings['scale']);

    saveSettingsDebounced();
}

function rescale(object, scaleDelta) {
    // Save mouse offset to avoid teleporting model to cursor
    //const range = camera.position.z * Math.tan( camera.fov / 360.0 * Math.PI );
    //const px = ( 2.0 * event.clientX - window.innerWidth ) / window.innerHeight * range;
    //const py = - ( 2.0 * event.clientY - window.innerHeight ) / window.innerHeight * range;
    //mouseOffset = new THREE.Vector2(px - dragCharacter.position.x, py - dragCharacter.position.y);

    object.scale.x *= scaleDelta;
    object.scale.y *= scaleDelta;
    object.scale.z *= scaleDelta;

    object.scale.x = Math.min(Math.max(object.scale.x, MIN_SCALE), MAX_SCALE)
    object.scale.y = Math.min(Math.max(object.scale.y, MIN_SCALE), MAX_SCALE)
    object.scale.z = Math.min(Math.max(object.scale.z, MIN_SCALE), MAX_SCALE)

    // TODO: restaure model offset to simulate zoom

    //console.debug(DEBUG_PREFIX,"Scale updated to",object.scale.x);
}

async function hitboxClick(character,hitbox) {
  await delay(HIT_BOX_DELAY);

  // Using control
  if (isMouseDown) {
    console.debug(DEBUG_PREFIX,"Hitbox click ignored - mouse still held (treated as drag)");
    return;
  }

  // Was a simple click
  const model_path = current_avatars[character]["model_path"];
  const hitboxKey = typeof hitbox === 'string' ? hitbox : String(hitbox?.name || '');
  const mappingRoot = extension_settings?.vrm?.model_settings?.[model_path]?.hitboxes_mapping || {};
  const mapped = mappingRoot?.[hitboxKey] || {};

  console.debug(DEBUG_PREFIX,"Detected click on hitbox",character,hitboxKey,model_path,mappingRoot);

    const previousExpression = current_avatars[character]["expression"] || "neutral";
    const model_expression = mapped["expression"] || "none";
    const model_motion = mapped["motion"] || "none";
    const sequence = mapped["sequence"] || "";
    const message = mapped["message"] || "";

    const playHitboxAnimation = () => {
        if (model_expression != "none") {
            setExpression(character, model_expression);
        }

        // Play sequence if defined, otherwise play single motion
        if (sequence && sequence.trim()) {
            setMotionSequence(character, sequence, { loop: false, restoreExpression: previousExpression, transition: 'crossfade', fadeSec: 0.42 });
        } else if (model_motion != "none") {
            setMotion(character, model_motion, false, true, true, { restoreExpression: previousExpression, transition: 'crossfade', fadeSec: 0.42 });
        }
    };

    void playHitboxAnimationAlignedWithVoiceforge(character, playHitboxAnimation);

    const generatedTouchPrompt = getHitboxTouchPrompt(character, hitboxKey, message);

    if (generatedTouchPrompt != '') {
        const context = getContext();
        const lastChatMessage = context?.chat?.[context.chat.length - 1] || null;
        console.debug(DEBUG_PREFIX, context);
        const shouldAutoSend = extension_settings.vrm.auto_send_hitbox_message;
        const isDuplicateInteraction = previous_interaction['character'] == character && previous_interaction['message'] == generatedTouchPrompt;

        // Avoid spam duplicates for repeated click bursts.
        if (isDuplicateInteraction && (shouldAutoSend || lastChatMessage?.is_user)) {
            console.debug(DEBUG_PREFIX,'Same as last interaction, nothing done');
        }
        else {
            previous_interaction['character'] = character;
            previous_interaction['message'] = generatedTouchPrompt;

            if (shouldAutoSend) {
                const chat = Array.isArray(context?.chat) ? context.chat : [];
                const tailIndex = chat.length - 1;
                const tailMessage = tailIndex >= 0 ? chat[tailIndex] : null;
                const hasValidTail = !!tailMessage && typeof tailMessage === 'object';

                if (!hasValidTail) {
                    console.warn(DEBUG_PREFIX, 'Skipping hitbox auto-generate due to invalid chat tail', {
                        character,
                        hitbox: hitboxKey,
                        chatLength: chat.length,
                        tailIndex,
                    });
                    return;
                }

                if (hitboxAutoGenerateInFlight) {
                    console.debug(DEBUG_PREFIX, 'Skipping hitbox auto-generate; previous generate still in flight');
                    return;
                }

                hitboxAutoGenerateInFlight = true;
                try {
                    // Send as a normal user message via textarea+generate.
                    // Avoid injecting custom system messages that can race with core chat rendering.
                    $('#send_textarea').val(generatedTouchPrompt)[0]?.dispatchEvent(new Event('input', { bubbles: true }));
                    await context.generate();
                } finally {
                    hitboxAutoGenerateInFlight = false;
                }
            } else {
                $('#send_textarea').val(generatedTouchPrompt);
            }
        }
    }
    else
        console.debug(DEBUG_PREFIX,'Mapped message empty, nothing to send.');
}

//--------------
// Events
//-------------

document.addEventListener("pointermove", async (event) => {pointerMove(event);});
document.addEventListener("pointerdown", (event) => {pointerDown(event);});
document.addEventListener("wheel", async (event) => {wheel(event)});
document.addEventListener("pointerup", () => {// Drop object
    const releasedCharacter = dragCharacter;
    isDragging = false;
    isRotating = false;
    isScaling = false;
    dragCharacter = undefined;

    isMouseDown = false;
    syncTransformUI(releasedCharacter, true);
    //console.debug(DEBUG_PREFIX,"Ponter released");
} );

// Select model for drag/rotate
async function pointerDown(event) {
    isMouseDown = true;
    markUserActivity("pointer-down");
    if (raycaster !== undefined && currentMouse !== undefined && camera !== undefined) {
        // UI between mouse and canvas
        const element = document.elementFromPoint(event.clientX, event.clientY);
        if (element.id != VRM_CANVAS_ID)
            return;

        const mouseX = (event.offsetX / renderer.domElement.clientWidth) * 2 - 1;
        const mouseY = -(event.offsetY / renderer.domElement.clientHeight) * 2 + 1;
        const pointer = new THREE.Vector2(mouseX,mouseY);

        raycaster.setFromCamera(pointer, camera);
        
        // Check for character 
        for(const character in current_avatars) {
            syncCharacterCollisionProxies(character, extension_settings.vrm.hitboxes);

            const hitboxes = []

            for(const hit_part in current_avatars[character]["hitboxes"])
                hitboxes.push(current_avatars[character]["hitboxes"][hit_part]["collider"])
            
            let insersects = raycaster.intersectObjects(hitboxes, false);

            if(insersects.length > 0) {
                const hitbox = insersects[0].object;
                hitboxClick(character,hitbox.name);
            }

            insersects = raycaster.intersectObject(current_avatars[character]["collider"], false);
            
            if(insersects.length > 0) {
                dragCharacter = character;
                break;
            }

        }

        // Mouse controls disabled
        if (extension_settings.vrm.lock_models)
            return;

        if (dragCharacter === undefined)
            return;

        const isLeftClick = event.pointerType === 'mouse' && event.button === 0;
        const isMiddleClick = event.pointerType === 'mouse' && event.button === 1;

        // Move
        if(isLeftClick && !event.ctrlKey && !event.shiftKey){
            // Save mouse offset to avoid teleporting model to cursor
            const range = camera.position.z * Math.tan( camera.fov / 360.0 * Math.PI );
            const px = ( 2.0 * event.clientX - window.innerWidth ) / window.innerHeight * range;
            const py = - ( 2.0 * event.clientY - window.innerHeight ) / window.innerHeight * range;
            mouseOffset = new THREE.Vector2(px - current_avatars[dragCharacter]["objectContainer"].position.x, py - current_avatars[dragCharacter]["objectContainer"].position.y);

            isDragging = true;
            isRotating = false;
            isScaling = false;
        }

        // Rotation
        if(isMiddleClick || (isLeftClick && event.ctrlKey && !event.shiftKey)){ 
            isDragging = false;
            isRotating = true;
            isScaling = false;
        }

        // Scale
        if(isLeftClick && event.shiftKey && !event.ctrlKey){
            isScaling = true;
        }
    }
}

async function pointerMove(event) {
    if (extension_settings.vrm.follow_cursor) {
        setCursorPosition(event.clientX, event.clientY);
    }
    // init
    if (previousMouse === undefined || currentMouse === undefined) {
        previousMouse = new THREE.Vector2();
        currentMouse = new THREE.Vector2();
    }
    
    // Mouse controls disabled
    if (extension_settings.vrm.lock_models)
        return;

    if (raycaster !== undefined && camera !== undefined) {
        const character = dragCharacter;

        // Draggin model
        if (isDragging) {
            markUserActivity("drag");
            const range = (camera.position.z - current_avatars[character]["objectContainer"].position.z) * Math.tan( camera.fov / 360.0 * Math.PI );
            const px = ( 2.0 * event.clientX - window.innerWidth ) / window.innerHeight * range;
            const py = - ( 2.0 * event.clientY - window.innerHeight ) / window.innerHeight * range;
            const model_path = current_avatars[character]["model_path"];
            current_avatars[character]["objectContainer"].position.set( px-mouseOffset.x, py-mouseOffset.y, current_avatars[character]["objectContainer"].position.z );

            extension_settings.vrm.model_settings[model_path]['x'] = (current_avatars[character]["objectContainer"].position.x).toFixed(2);
            extension_settings.vrm.model_settings[model_path]['y'] = (current_avatars[character]["objectContainer"].position.y).toFixed(2);
            syncTransformUI(character);
        }

        // Rotating model
        if (isRotating) {
            markUserActivity("rotate");
            const xDelta = (previousMouse.x - (event.clientX / window.innerWidth)) * 10;
            const yDelta = (previousMouse.y - (event.clientY / window.innerHeight)) * 10;
            const model_path = current_avatars[character]["objectContainer"].model_path;
            current_avatars[character]["objectContainer"].rotation.set(current_avatars[character]["objectContainer"].rotation.x - yDelta, current_avatars[character]["objectContainer"].rotation.y - xDelta , 0.0 );

            const baseRotation = getModelRotationWithoutCursorOffset(character) || current_avatars[character]["objectContainer"].rotation;
            extension_settings.vrm.model_settings[model_path]['rx'] = Number(baseRotation.x).toFixed(2);
            extension_settings.vrm.model_settings[model_path]['ry'] = Number(baseRotation.y).toFixed(2);
            syncTransformUI(character);
        }

        // Scaling
        if (isScaling) {
            markUserActivity("scale");
            const yDelta = (previousMouse.y - (event.clientY / window.innerHeight)) * 10;
            
            //console.debug(DEBUG_PREFIX,"SCALING delta",yDelta)
            let scaleDelta = 1.05;
            if (yDelta < 0)
                scaleDelta = 0.95;

            rescale(current_avatars[character]["objectContainer"], scaleDelta);
            rescale(current_avatars[character]["collider"], scaleDelta);
            
            // Update saved settings
            const model_path = current_avatars[character]["model_path"];
            extension_settings.vrm.model_settings[model_path]['scale'] = (current_avatars[character]["objectContainer"].scale.x).toFixed(2);
            syncTransformUI(character);
        }

        // Save mouse position
        previousMouse.x = (event.clientX / window.innerWidth);
        previousMouse.y = (event.clientY / window.innerHeight);
    }
}

async function wheel(event) {
    // Mouse controls disabled
    if (extension_settings.vrm.lock_models)
        return;

    //No change
    if(event.deltaY == 0)
        return;

    // UI between mouse and canvas
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (element != null && element.id != VRM_CANVAS_ID)
        return;

    const mouseX = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
    const mouseY = -(event.clientY / renderer.domElement.clientHeight) * 2 + 1;
    const pointer = new THREE.Vector2(mouseX,mouseY);

    raycaster.setFromCamera(pointer, camera);

    // Check for character 
    for(const character in current_avatars) {
        syncCharacterCollisionProxies(character, false);
        const insersects = raycaster.intersectObject(current_avatars[character]["collider"], false);
            
        if(insersects.length > 0) {
            // Restrict scale
            let scaleDelta = 1.1;
            if (event.deltaY > 0)
                scaleDelta = 0.9;

            rescale(current_avatars[character]["objectContainer"], scaleDelta);
            rescale(current_avatars[character]["collider"], scaleDelta);
            markUserActivity("wheel");
            
            // Update saved settings
            const model_path = current_avatars[character]["model_path"];
            extension_settings.vrm.model_settings[model_path]['scale'] = (current_avatars[character]["objectContainer"].scale.x).toFixed(2);
            syncTransformUI(character, true);
            break;
        }
    }
}
