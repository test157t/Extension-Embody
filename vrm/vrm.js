import * as THREE from './lib/three.module.js';
import { GLTFLoader } from './lib/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from './lib/jsm/loaders/FBXLoader.js';
import { OrbitControls } from './lib/jsm/controls/OrbitControls.js';
import { VRMALoader } from './lib/jsm/loaders/VRMALoader.js';
import { VRMLoaderPlugin, VRMUtils, VRMSpringBoneCollider, VRMSpringBoneColliderShapeSphere } from './lib/three-vrm.module.js';
import { loadBVHAnimation, loadMixamoAnimation, loadMMDAnimation } from './animationLoader.js';
import { MMDLoader } from './lib/jsm/loaders/MMDLoader.js';

import { getRequestHeaders, saveSettings, saveSettingsDebounced, sendMessageAsUser } from '../../../../../script.js';
import { getContext, extension_settings, getApiUrl, doExtrasFetch, modules } from '../../../../extensions.js';

import {
    MODULE_NAME,
    DEBUG_PREFIX,
    VRM_CANVAS_ID,
    FALLBACK_EXPRESSION,
    ANIMATION_FADE_TIME,
    SPRITE_DIV,
    VN_MODE_DIV,
    HITBOXES
} from "./constants.js";

import {
    currentChatMembers,
    getExpressionLabel
} from './utils.js';

import {
    delay
} from '../../../../utils.js';

import {
    animations_files
} from './ui.js';

import {
    IDLE_MOVEMENT_CONFIGS,
    getIdleAnimationClip
} from './idleAnimations.js';

const console = { ...globalThis.console, debug: () => {}, log: () => {}, info: () => {} };

export {
    loadScene,
    loadAllModels,
    setModel,
    unloadModel,
    getVRM,
    setExpression,
    setMotion,
    setMotionSequence,
    setCursorPosition,
    setCursorTracking,
    markUserActivity,
    playAnimationSequence,
    clearAnimationSequence,
    updateExpression,
    talk,
  updateModel,
  current_avatars,
  renderer,
  camera,
  VRM_CONTAINER_NAME,
  clearModelCache,
  clearAnimationCache,
  setLight,
   setBackground
  ,getModelRotationWithoutCursorOffset
  ,setPhonePropVisible
  ,syncCharacterCollisionProxies
}

const VRM_CONTAINER_NAME = "VRM_CONTAINER";
const VRM_COLLIDER_NAME = "VRM_COLLIDER"
const VRM_PHONE_PROP_NAME = "VRM_PHONE_PROP";
const PHONE_PROP_FBX_PATH = '/scripts/extensions/third-party/Extension-Embody/vrm/phone.fbx';
const PHONE_PROP_TARGET_MAX_DIM = 0.16;
const PHONE_RIGHT_LOCAL_ROTATION = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.98, 1.58, 0.22));
const PHONE_RIGHT_LOCAL_OFFSET = new THREE.Vector3(0.048, 0.018, 0.014);
const PHONE_LEFT_LOCAL_ROTATION_DEFAULT = { x: -0.41, y: -0.28, z: 1.24 };
const PHONE_LEFT_LOCAL_OFFSET_DEFAULT = { x: -0.073, y: -0.035, z: -0.006 };
const phoneTmpWorldPos = new THREE.Vector3();
const phoneTmpWorldQuat = new THREE.Quaternion();
const phoneTmpOffset = new THREE.Vector3();
const phoneTmpLocalOffset = new THREE.Vector3();
const phoneTmpLocalQuat = new THREE.Quaternion();
const phoneTmpLocalEuler = new THREE.Euler();
const phonePropBBox = new THREE.Box3();
const phonePropBBoxSize = new THREE.Vector3();

let phonePropTemplate = null;
let phonePropTemplatePromise = null;

function decoratePhonePropObject(object, baseScale = 1, fromTemplate = false) {
    object.name = VRM_PHONE_PROP_NAME;
    object.visible = false;
    object.userData.phoneBaseScale = baseScale;
    object.userData.phoneFromTemplate = fromTemplate;
    object.traverse((node) => {
        if (!node?.isMesh) {
            return;
        }
        node.castShadow = false;
        node.receiveShadow = false;
    });
    return object;
}

function createFallbackPhonePropMesh() {
    const geometry = new THREE.BoxGeometry(0.08, 0.16, 0.01);
    const material = new THREE.MeshBasicMaterial({
        color: 0x1a1a1a,
    });
    const phone = new THREE.Mesh(geometry, material);
    return decoratePhonePropObject(phone, 1, false);
}

function clonePhonePropFromTemplate() {
    if (!phonePropTemplate) {
        return null;
    }
    const clone = phonePropTemplate.clone(true);
    const baseScale = Number(phonePropTemplate.userData?.phoneBaseScale);
    return decoratePhonePropObject(clone, Number.isFinite(baseScale) ? baseScale : 1, true);
}

async function ensurePhonePropTemplateLoaded() {
    if (phonePropTemplate) {
        return phonePropTemplate;
    }
    if (phonePropTemplatePromise) {
        return phonePropTemplatePromise;
    }

    const loader = new FBXLoader();
    phonePropTemplatePromise = loader.loadAsync(PHONE_PROP_FBX_PATH)
        .then((object) => {
            phonePropBBox.setFromObject(object);
            phonePropBBox.getSize(phonePropBBoxSize);
            const maxDim = Math.max(phonePropBBoxSize.x, phonePropBBoxSize.y, phonePropBBoxSize.z);
            const baseScale = maxDim > 0 ? PHONE_PROP_TARGET_MAX_DIM / maxDim : 1;
            phonePropTemplate = decoratePhonePropObject(object, baseScale, true);
            return phonePropTemplate;
        })
        .catch((error) => {
            console.debug(DEBUG_PREFIX, 'Failed to load phone prop FBX, using fallback mesh', error);
            return null;
        })
        .finally(() => {
            phonePropTemplatePromise = null;
        });

    return phonePropTemplatePromise;
}

function disposePhonePropObject(object) {
    if (!object) {
        return;
    }
    object.traverse((node) => {
        if (!node?.isMesh) {
            return;
        }
        node.geometry?.dispose?.();
        if (Array.isArray(node.material)) {
            for (const material of node.material) {
                material?.dispose?.();
            }
        } else {
            node.material?.dispose?.();
        }
    });
}

function upgradeAvatarPhonePropIfTemplateReady(character) {
    const avatar = current_avatars[character];
    if (!avatar || !phonePropTemplate) {
        return;
    }

    const currentProp = avatar.phoneProp;
    if (currentProp?.userData?.phoneFromTemplate) {
        return;
    }

    const replacement = clonePhonePropFromTemplate();
    if (!replacement) {
        return;
    }

    replacement.visible = !!currentProp?.visible;
    if (scene) {
        scene.add(replacement);
    }
    avatar.phoneProp = replacement;

    if (currentProp) {
        if (currentProp.parent) {
            currentProp.parent.remove(currentProp);
        }
        disposePhonePropObject(currentProp);
    }

    updatePhonePropTransform(character);
}

function getHumanoidBoneNode(vrm, boneName) {
    return vrm?.humanoid?.getRawBoneNode?.(boneName)
        || vrm?.humanoid?.getNormalizedBoneNode?.(boneName)
        || null;
}

const CACHED_BONE_NAMES = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
];

function buildAvatarBoneCache(vrm) {
    const bones = {};
    for (const boneName of CACHED_BONE_NAMES) {
        bones[boneName] = getHumanoidBoneNode(vrm, boneName);
    }
    return bones;
}

function buildAvatarExpressionCache(vrm) {
    const expressionMap = vrm?.expressionManager?.expressionMap || {};
    const names = Object.keys(expressionMap);
    return {
        names,
        visemes: names.filter(name => VRM_VISEME_SET.has(name)),
        nonVisemes: names.filter(name => !VRM_VISEME_SET.has(name)),
    };
}

function getCachedBone(avatar, boneName) {
    if (!avatar) return null;
    if (!avatar.bones) {
        avatar.bones = buildAvatarBoneCache(avatar.vrm);
    }
    if (avatar.bones[boneName] === undefined) {
        avatar.bones[boneName] = getHumanoidBoneNode(avatar.vrm, boneName);
    }
    return avatar.bones[boneName] || null;
}

function buildProceduralRigCalibration(vrm, hipsHeight = 1) {
    const leftShoulder = getHumanoidBoneNode(vrm, 'leftShoulder');
    const rightShoulder = getHumanoidBoneNode(vrm, 'rightShoulder');
    const leftUpperArm = getHumanoidBoneNode(vrm, 'leftUpperArm');
    const rightUpperArm = getHumanoidBoneNode(vrm, 'rightUpperArm');

    const shoulderSpan = (leftShoulder && rightShoulder)
        ? leftShoulder.getWorldPosition(new THREE.Vector3()).distanceTo(rightShoulder.getWorldPosition(new THREE.Vector3()))
        : 0.36;

    const leftArmLen = (leftUpperArm && leftUpperArm.children?.[0])
        ? leftUpperArm.getWorldPosition(new THREE.Vector3()).distanceTo(leftUpperArm.children[0].getWorldPosition(new THREE.Vector3()))
        : 0.28;
    const rightArmLen = (rightUpperArm && rightUpperArm.children?.[0])
        ? rightUpperArm.getWorldPosition(new THREE.Vector3()).distanceTo(rightUpperArm.children[0].getWorldPosition(new THREE.Vector3()))
        : 0.28;

    const meanArmLen = Math.max(0.18, (leftArmLen + rightArmLen) * 0.5);
    const scaleFromHips = Math.max(0.8, Math.min(1.25, (Number(hipsHeight) || 1) / 0.95));
    const shoulderScale = Math.max(0.88, Math.min(1.24, shoulderSpan / 0.36));
    const armLiftScale = Math.max(0.84, Math.min(1.28, (meanArmLen / 0.28) * 0.95 + (shoulderScale * 0.05)));

    return {
        bodyScale: Math.max(0.9, Math.min(1.2, scaleFromHips)),
        shoulderScale,
        armLiftScale,
        shoulderMobility: Math.max(0.85, Math.min(1.25, shoulderScale * 0.98 + armLiftScale * 0.06)),
        cursorBodyScale: Math.max(0.88, Math.min(1.16, scaleFromHips * 0.96 + shoulderScale * 0.04)),
    };
}

function applySpringBoneAntiClipPatch(vrm, hipsHeight = 1) {
    if (!vrm) {
        return;
    }

    const vrmUserData = vrm.userData || (vrm.userData = {});
    const manager = vrm?.springBoneManager;
    if (!manager || !manager.joints || manager.joints.size === 0) {
        return;
    }

    const patchVersion = 3;
    if (vrmUserData.stvSpringPatchApplied && vrmUserData.stvSpringPatchVersion === patchVersion) {
        return;
    }

    const removeExistingAutoColliders = () => {
        const autoPrefix = 'stv_auto_collider_';
        for (const joint of manager.joints) {
            if (!Array.isArray(joint?.colliderGroups)) {
                continue;
            }
            for (const group of joint.colliderGroups) {
                if (!Array.isArray(group?.colliders)) {
                    continue;
                }
                group.colliders = group.colliders.filter((collider) => {
                    const isAuto = String(collider?.name || '').startsWith(autoPrefix);
                    if (isAuto && collider.parent) {
                        collider.parent.remove(collider);
                    }
                    return !isAuto;
                });
            }
            joint.colliderGroups = joint.colliderGroups.filter((group) => Array.isArray(group?.colliders) && group.colliders.length > 0);
        }
    };

    removeExistingAutoColliders();

    const scale = Math.max(0.72, Math.min(1.45, Number(hipsHeight) || 1));
    const colliders = [];

    const addBodySphereCollider = (boneName, offset, radius) => {
        const bone = getHumanoidBoneNode(vrm, boneName);
        if (!bone) return;

        const shape = new VRMSpringBoneColliderShapeSphere({
            offset: new THREE.Vector3(offset[0], offset[1], offset[2]),
            radius: radius * scale,
        });
        const collider = new VRMSpringBoneCollider(shape);
        collider.name = `stv_auto_collider_${boneName}`;
        bone.add(collider);
        collider.updateWorldMatrix(true, false);
        colliders.push(collider);
    };

    addBodySphereCollider('head', [0.0, 0.015, 0.02], 0.1);
    addBodySphereCollider('neck', [0.0, 0.012, 0.02], 0.08);
    addBodySphereCollider('upperChest', [0.0, 0.01, 0.03], 0.09);

    if (colliders.length === 0) {
        vrmUserData.stvSpringPatchApplied = true;
        return;
    }

    const autoColliderGroup = {
        name: 'stv_auto_anticlip_body',
        colliders,
    };

    const dynamicNamePattern = /(hair|bang|ahoge|ponytail|twintail|braid|sidehair|fringe|earring|ribbon|accessor|antenna|tail|curl|strand)/i;
    const chestDynamicExcludePattern = /(breast|bust|boob|oppai|mune|chest)/i;
    const head = getHumanoidBoneNode(vrm, 'head');
    const neck = getHumanoidBoneNode(vrm, 'neck');

    const isDescendantOf = (node, ancestor) => {
        let current = node;
        while (current) {
            if (current === ancestor) return true;
            current = current.parent;
        }
        return false;
    };

    for (const joint of manager.joints) {
        const bone = joint?.bone;
        const boneName = String(bone?.name || '');
        const excludedDynamic = chestDynamicExcludePattern.test(boneName);
        const likelyHeadAttachment = dynamicNamePattern.test(boneName);
        const attachedToHead = !!bone && ((head && isDescendantOf(bone, head)) || (neck && isDescendantOf(bone, neck)));

        const shouldAttachColliderGroup = !excludedDynamic && (likelyHeadAttachment || attachedToHead);

        if (!shouldAttachColliderGroup) {
            continue;
        }

        if (!Array.isArray(joint.colliderGroups)) {
            joint.colliderGroups = [];
        }
        if (!joint.colliderGroups.includes(autoColliderGroup)) {
            joint.colliderGroups.push(autoColliderGroup);
        }

        const settings = joint.settings || {};
        settings.hitRadius = Math.max(0.014 * scale, Number(settings.hitRadius) || 0);
        joint.settings = settings;
    }

    manager.setInitState();
    manager.reset();
    vrmUserData.stvSpringPatchApplied = true;
    vrmUserData.stvSpringPatchVersion = patchVersion;
}

function getPreferredPhoneHandBone(vrm, preferredSide = "auto") {
    const side = String(preferredSide || "auto").toLowerCase();
    const preferLeft = side === "left";

    const primaryHumanoidBones = preferLeft
        ? ["leftHand", "leftLowerArm", "leftUpperArm"]
        : ["rightHand", "rightLowerArm", "rightUpperArm"];

    const secondaryHumanoidBones = preferLeft
        ? ["rightHand", "rightLowerArm", "rightUpperArm"]
        : ["leftHand", "leftLowerArm", "leftUpperArm"];

    const humanoidFallback = primaryHumanoidBones
        .map((boneName) => getHumanoidBoneNode(vrm, boneName))
        .find(Boolean)
        || secondaryHumanoidBones
            .map((boneName) => getHumanoidBoneNode(vrm, boneName))
            .find(Boolean)
        || getHumanoidBoneNode(vrm, "chest")
        || getHumanoidBoneNode(vrm, "spine");

    if (humanoidFallback) {
        return humanoidFallback;
    }

    // Last resort for rigs where humanoid mapping is incomplete.
    let best = null;
    let secondaryBest = null;
    vrm?.scene?.traverse?.((obj) => {
        if ((!obj?.isBone || !obj?.name) || (best && secondaryBest)) {
            return;
        }
        const name = String(obj.name).toLowerCase();
        const isRight = name.includes('r_hand') || name.includes('rhand') || name.includes('right_hand') || name.includes('hand_r') || name.includes('wrist_r');
        const isLeft = name.includes('l_hand') || name.includes('lhand') || name.includes('left_hand') || name.includes('hand_l') || name.includes('wrist_l');

        if (preferLeft && isLeft) {
            best = obj;
            return;
        }
        if (!preferLeft && isRight) {
            best = obj;
            return;
        }

        if (!secondaryBest && (isRight || isLeft || name.includes('hand') || name.includes('wrist'))) {
            secondaryBest = obj;
        }
    });
    return best || secondaryBest;
}

function attachPhonePropToAvatar(character, options = {}) {
    const avatar = current_avatars[character];
    const vrm = avatar?.vrm;
    if (!avatar || !vrm) {
        return null;
    }

    const requestedSide = String(options?.handPreference || avatar.phonePropSide || "right").toLowerCase();
    const normalizedRequestedSide = requestedSide === "left" ? "left" : "right";
    if (avatar.phonePropSide !== normalizedRequestedSide) {
        avatar.phonePropBone = null;
    }
    avatar.phonePropSide = normalizedRequestedSide;

    const handBone = avatar.phonePropBone || getPreferredPhoneHandBone(vrm, normalizedRequestedSide);
    if (!handBone) {
        return null;
    }
    avatar.phonePropBone = handBone;

    if (avatar.phoneProp && !avatar.phoneProp.userData?.phoneFromTemplate && phonePropTemplate) {
        upgradeAvatarPhonePropIfTemplateReady(character);
    }

    const phoneProp = avatar.phoneProp || clonePhonePropFromTemplate() || createFallbackPhonePropMesh();
    avatar.phoneProp = phoneProp;

    if (!phoneProp.userData?.phoneFromTemplate) {
        ensurePhonePropTemplateLoaded().then(() => {
            upgradeAvatarPhonePropIfTemplateReady(character);
        });
    }

    if (scene && phoneProp.parent !== scene) {
        scene.add(phoneProp);
    }

    return phoneProp;
}

function updatePhonePropTransform(character) {
    const avatar = current_avatars[character];
    const phoneProp = avatar?.phoneProp;
    const vrm = avatar?.vrm;
    if (!avatar || !phoneProp || !phoneProp.visible || !vrm) {
        return;
    }

    const side = avatar.phonePropSide === "left" ? "left" : "right";
    const localOffset = phoneTmpLocalOffset;
    let localRotation = PHONE_RIGHT_LOCAL_ROTATION;

    if (side === "left") {
        phoneTmpLocalEuler.set(
            PHONE_LEFT_LOCAL_ROTATION_DEFAULT.x,
            PHONE_LEFT_LOCAL_ROTATION_DEFAULT.y,
            PHONE_LEFT_LOCAL_ROTATION_DEFAULT.z
        );
        phoneTmpLocalQuat.setFromEuler(phoneTmpLocalEuler);
        localRotation = phoneTmpLocalQuat;

        localOffset.set(
            PHONE_LEFT_LOCAL_OFFSET_DEFAULT.x,
            PHONE_LEFT_LOCAL_OFFSET_DEFAULT.y,
            PHONE_LEFT_LOCAL_OFFSET_DEFAULT.z
        );
    } else {
        localOffset.copy(PHONE_RIGHT_LOCAL_OFFSET);
    }

    let handBone = avatar.phonePropBone;
    if (!handBone || !handBone.parent) {
        handBone = getPreferredPhoneHandBone(vrm, side);
        avatar.phonePropBone = handBone;
    }
    if (!handBone) {
        return;
    }

    handBone.getWorldPosition(phoneTmpWorldPos);
    handBone.getWorldQuaternion(phoneTmpWorldQuat);

    const modelScale = Math.max(0.5, Number(avatar?.objectContainer?.scale?.x) || 1);
    const baseScale = Number(phoneProp.userData?.phoneBaseScale);
    const safeBaseScale = Number.isFinite(baseScale) ? baseScale : 1;
    phoneTmpOffset.copy(localOffset).multiplyScalar(modelScale).applyQuaternion(phoneTmpWorldQuat);

    phoneProp.position.copy(phoneTmpWorldPos).add(phoneTmpOffset);
    phoneProp.quaternion.copy(phoneTmpWorldQuat).multiply(localRotation);
    phoneProp.scale.setScalar(modelScale * safeBaseScale);
}

function setPhonePropVisible(character, visible = true, options = {}) {
    const avatar = current_avatars[character];
    if (!avatar) {
        return false;
    }

    if (!visible) {
        if (avatar.phoneProp) {
            avatar.phoneProp.visible = false;
        }
        return true;
    }

    const phoneProp = attachPhonePropToAvatar(character, options);
    if (!phoneProp) {
        return false;
    }

    phoneProp.visible = true;
    updatePhonePropTransform(character);
    return true;
}

// Avatars
let current_avatars = {} // contain loaded avatar variables

// Caches
let models_cache = {};
let animations_cache = {};
let tts_lips_sync_job_id = 0;

// 3D Scene
let renderer = undefined;
let scene = undefined;
let camera = undefined;
let light = undefined;

// gltf and vrm
let currentInstanceId = 0;
let modelId = 0;
let clock = undefined;
const lookAtTarget = new THREE.Object3D();
const IDLE_ANIMS = ["idle", "breathe", "nod", "shrug", "think", "relax", "glance"];

// VRMA idle animation files cache
let vrmaIdleFiles = [];
let vrmaIdleCache = {}; // Cache loaded VRMA clips

const naturalIdleTimers = {};
const proceduralState = {};
const activeIdleAnimations = {}; // Track active procedural idle animations
const nextIdleEligibleTime = {};
const proceduralBoneBasePoses = {};
const idlePoseBlendJobs = {};

// Store base bone poses to restore after VRMA animations
const vrmaBoneBasePoses = {};

// Store base Y position to restore after VRMA animations (prevents height drop)
const vrmaBaseYPosition = {};

// Track last idle animation completion time for cooldown
const lastIdleCompletionTime = {};

const inactivityState = {
  lastActiveAt: Date.now(),
  intensity: 0,
  suppressUntil: 0,
  lastCursorX: window.innerWidth / 2,
  lastCursorY: window.innerHeight / 2,
  lastCursorActivityAt: 0
};
let lastSpeechActivityPingAt = 0;

let cursorTrackingEnabled = false;
let lastAppliedGridVisible = null;
let cursorPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let cursorNormalizedX = 0;
let cursorNormalizedY = 0;
let cursorTrackingDirty = true;
let cursorTrackingViewportWidth = window.innerWidth;
let cursorTrackingViewportHeight = window.innerHeight;
let cursorTarget = new THREE.Object3D();
let blendedTarget = new THREE.Object3D();
let cursorTiltState = {};
const cursorRaycaster = new THREE.Raycaster();
const cursorNdc = new THREE.Vector2();
const cursorTargetPos = new THREE.Vector3();
const expressionBlendJobs = {};
const socialLookState = {};
const cursorBodyFollowState = {};
const ambientPresenceState = {};
const ambientExpressionState = {};
const selfContactState = {};
const recentExpressionDispatch = new Map(); // key: character|chat_id -> signature

const IDENTITY_QUATERNION = new THREE.Quaternion();

function suspendNaturalIdle(character, minDelayMs = 3000) {
  const now = Date.now();
  const current = nextIdleEligibleTime[character] || 0;
  nextIdleEligibleTime[character] = Math.max(current, now + Math.max(300, Number(minDelayMs) || 3000));
}

function stopProceduralIdleForCharacter(character, vrm = null) {
  clearNaturalIdleTimer(character);
  clearIdleManagedTimers(character);

  const idleAction = activeIdleAnimations[character];
  if (idleAction) {
    const fadeMs = Math.max(120, ANIMATION_FADE_TIME * 1000);
    if (idleAction.fadeOut) {
      idleAction.fadeOut(ANIMATION_FADE_TIME);
    }
    if (idleAction.stop) {
      setManagedCharacterTimer(character, 'idleStopAfterFade', fadeMs + 30, () => {
        if (idleAction.stop) {
          idleAction.stop();
        }
      });
    }
    delete activeIdleAnimations[character];

    const avatarVrm = vrm || current_avatars[character]?.vrm;
    if (avatarVrm) {
      restoreIdleBasePoses(character, avatarVrm, { durationMs: fadeMs + 120 });
    }
  }
}

function scheduleNaturalIdleCheck(character, modelId, delayMs = 0, _reason = "") {
  if (!character || !Number.isFinite(Number(modelId))) {
    return;
  }

  clearNaturalIdleTimer(character);

  const now = Date.now();
  const nextEligible = nextIdleEligibleTime[character] || 0;
  const cooldownDelay = Math.max(0, nextEligible - now);
  const baseDelay = Math.max(0, Number(delayMs) || 0);
  const finalDelay = Math.max(baseDelay, cooldownDelay);

  setNaturalIdleTimer(character, finalDelay, () => {
    naturalIdleMovement(character, modelId);
  });

}

const animationManagerState = {};

function getAnimationManagerState(character) {
  if (!character) {
    return {
      sequenceGeneration: 0,
      timeoutIds: new Set(),
      managedTimers: new Map(),
    };
  }

  if (!animationManagerState[character]) {
    animationManagerState[character] = {
      sequenceGeneration: 0,
      timeoutIds: new Set(),
      managedTimers: new Map(),
    };
  }

  return animationManagerState[character];
}

function clearAnimationManagerTimeouts(character) {
  const managerState = animationManagerState[character];
  if (!managerState) {
    return;
  }

  for (const timeoutId of managerState.timeoutIds) {
    clearTimeout(timeoutId);
  }
  managerState.timeoutIds.clear();
}

function setManagedCharacterTimer(character, timerKey, delayMs, callback) {
  if (!character || !timerKey) {
    return null;
  }

  const managerState = getAnimationManagerState(character);
  if (!managerState.managedTimers) {
    managerState.managedTimers = new Map();
  }

  const existingTimer = managerState.managedTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timeoutId = setTimeout(() => {
    const state = animationManagerState[character];
    if (state?.managedTimers?.get(timerKey) === timeoutId) {
      state.managedTimers.delete(timerKey);
    }
    callback();
  }, Math.max(0, Number(delayMs) || 0));

  managerState.managedTimers.set(timerKey, timeoutId);
  return timeoutId;
}

function clearManagedCharacterTimer(character, timerKey) {
  const managerState = animationManagerState[character];
  if (!managerState?.managedTimers || !timerKey) {
    return;
  }

  const timeoutId = managerState.managedTimers.get(timerKey);
  if (timeoutId) {
    clearTimeout(timeoutId);
    managerState.managedTimers.delete(timerKey);
  }
}

function clearAllManagedCharacterTimers(character) {
  const managerState = animationManagerState[character];
  if (!managerState?.managedTimers) {
    return;
  }

  for (const timeoutId of managerState.managedTimers.values()) {
    clearTimeout(timeoutId);
  }
  managerState.managedTimers.clear();
}

function setNaturalIdleTimer(character, delayMs, callback) {
  clearNaturalIdleTimer(character);
  const timeoutId = setManagedCharacterTimer(character, 'naturalIdleLoop', delayMs, () => {
    if (naturalIdleTimers[character] === timeoutId) {
      delete naturalIdleTimers[character];
    }
    callback();
  });
  if (timeoutId) {
    naturalIdleTimers[character] = timeoutId;
  }
  return timeoutId;
}

function clearNaturalIdleTimer(character) {
  clearManagedCharacterTimer(character, 'naturalIdleLoop');
  if (naturalIdleTimers[character]) {
    clearTimeout(naturalIdleTimers[character]);
    delete naturalIdleTimers[character];
  }
}

function clearIdleManagedTimers(character) {
  clearManagedCharacterTimer(character, 'idleStopAfterFade');
  clearManagedCharacterTimer(character, 'naturalIdleExpression');
  clearManagedCharacterTimer(character, 'naturalIdleVrmaExpression');
  clearManagedCharacterTimer(character, 'naturalIdleFadeCleanup');
}

function invalidateSequenceGeneration(character) {
  const managerState = getAnimationManagerState(character);
  managerState.sequenceGeneration += 1;
  clearAnimationManagerTimeouts(character);
  return managerState.sequenceGeneration;
}

function scheduleSequenceTimeout(character, generation, callback, delayMs = 0) {
  const managerState = getAnimationManagerState(character);
  const timeoutId = setTimeout(() => {
    const state = animationManagerState[character];
    if (state?.timeoutIds) {
      state.timeoutIds.delete(timeoutId);
    }

    const activeGeneration = sequencePlaybackState[character]?.generation;
    if (activeGeneration !== generation) {
      return;
    }

    callback();
  }, Math.max(0, Number(delayMs) || 0));

  managerState.timeoutIds.add(timeoutId);
  return timeoutId;
}

function isCharacterInIdleMotion(character) {
  const avatar = current_avatars[character];
  if (!avatar) return false;

  const motionName = avatar.motion?.name;
  if (!motionName || motionName === "none") return true;

  const motionNameBase = motionName.replace(/\.[^/.]+$/, "").replace(/\d+$/, "");
  return IDLE_ANIMS.some((idleName) => motionNameBase === idleName);
}

function markUserActivity(_source = "generic") {
  const now = Date.now();
  inactivityState.lastActiveAt = now;
  inactivityState.suppressUntil = now + 1800;
  inactivityState.intensity *= 0.55;
}

function getRawInactivityIntensity(now = Date.now()) {
  if (now < inactivityState.suppressUntil) {
    return 0;
  }
  const idleStartMs = 5000;
  const fullIdleMs = 45000;
  const idleDuration = Math.max(0, now - inactivityState.lastActiveAt);
  const normalized = (idleDuration - idleStartMs) / (fullIdleMs - idleStartMs);
  return Math.max(0, Math.min(1, normalized));
}

function updateInactivityIntensity(deltaTime) {
  const target = getRawInactivityIntensity();
  const blendRate = target > inactivityState.intensity ? 0.45 : 8.5;
  const alpha = 1 - Math.exp(-Math.max(0, deltaTime) * blendRate);
  inactivityState.intensity += (target - inactivityState.intensity) * alpha;
  inactivityState.intensity = Math.max(0, Math.min(1, inactivityState.intensity));
  return inactivityState.intensity;
}

function getLookAtStateForCharacter(character) {
  const followCursor = cursorTrackingEnabled && extension_settings.vrm.follow_cursor;
  const followCamera = extension_settings.vrm.follow_camera;
  const idleAction = activeIdleAnimations[character];
  const idleActionActive = Boolean(idleAction && (!idleAction.isRunning || idleAction.isRunning()));

  if (!followCursor) {
    delete socialLookState[character];
    return {
      target: followCamera ? lookAtTarget : null,
      cursorInfluence: 0
    };
  }

  if (!followCamera) {
    delete socialLookState[character];
    return {
      target: cursorTarget,
      cursorInfluence: 1
    };
  }

  const now = Date.now();
  const cursorX = (cursorPosition.x / window.innerWidth) * 2 - 1;
  const cursorY = -(cursorPosition.y / window.innerHeight) * 2 + 1;
  const idleCursorDelayMs = 5000;
  const cameraReturnGlanceMinMs = 7000;
  const cameraReturnGlanceMaxMs = 11000;
  const returnGlanceMinMs = 1200;
  const returnGlanceMaxMs = 2000;
  const movementThreshold = 0.008;
  const allowReturnGlance = !idleActionActive;
  let state = socialLookState[character];

  if (!state) {
    state = {
      mode: "cursor",
      cameraBlend: 0,
      lastMovementAt: now,
      lastCursorX: cursorX,
      lastCursorY: cursorY,
      idleCursorWorldPos: cursorTarget.position.clone(),
      nextReturnGlanceAt: 0,
      returnGlanceUntil: 0
    };
    socialLookState[character] = state;
  }

  const cursorDelta = Math.hypot(cursorX - state.lastCursorX, cursorY - state.lastCursorY);
  state.lastCursorX = cursorX;
  state.lastCursorY = cursorY;

  if (cursorDelta > movementThreshold) {
    state.lastMovementAt = now;
    state.mode = "cursor";
    state.idleCursorWorldPos.copy(cursorTarget.position);
    state.nextReturnGlanceAt = 0;
    state.returnGlanceUntil = 0;
  } else if (now - state.lastMovementAt >= idleCursorDelayMs) {
    if (state.mode === "cursor") {
      state.mode = "camera";
      state.idleCursorWorldPos.copy(cursorTarget.position);
      state.nextReturnGlanceAt = now + cameraReturnGlanceMinMs + Math.random() * (cameraReturnGlanceMaxMs - cameraReturnGlanceMinMs);
      state.returnGlanceUntil = 0;
    } else if (allowReturnGlance && state.mode === "camera" && state.nextReturnGlanceAt > 0 && now >= state.nextReturnGlanceAt) {
      state.mode = "return_cursor";
      state.returnGlanceUntil = now + returnGlanceMinMs + Math.random() * (returnGlanceMaxMs - returnGlanceMinMs);
      state.nextReturnGlanceAt = 0;
    } else if (state.mode === "return_cursor" && now >= state.returnGlanceUntil) {
      state.mode = "camera";
      state.nextReturnGlanceAt = now + cameraReturnGlanceMinMs + Math.random() * (cameraReturnGlanceMaxMs - cameraReturnGlanceMinMs);
    }
  }

  if (!allowReturnGlance && state.mode === "return_cursor") {
    state.mode = "camera";
    state.returnGlanceUntil = 0;
    state.nextReturnGlanceAt = now + cameraReturnGlanceMinMs + Math.random() * (cameraReturnGlanceMaxMs - cameraReturnGlanceMinMs);
  }

  const targetBlend = state.mode === "camera" ? 1 : 0;
  const blendToCameraSpeed = 0.02;
  const blendToCursorSpeed = 0.12;
  const blendSpeed = targetBlend > state.cameraBlend ? blendToCameraSpeed : blendToCursorSpeed;
  state.cameraBlend += (targetBlend - state.cameraBlend) * blendSpeed;
  state.cameraBlend = Math.max(0, Math.min(1, state.cameraBlend));

  const activeCursorTargetPos = state.mode === "return_cursor" ? state.idleCursorWorldPos : cursorTarget.position;
  blendedTarget.position.copy(activeCursorTargetPos).lerp(lookAtTarget.position, state.cameraBlend);

  const cursorInfluenceScale = state.mode === "return_cursor" ? 0.45 : 1;

  return {
    target: blendedTarget,
    cursorInfluence: (1 - state.cameraBlend) * cursorInfluenceScale * (idleActionActive ? 0.72 : 1)
  };
}

// Cursor tracking functions
function setCursorPosition(x, y) {
  const dx = x - inactivityState.lastCursorX;
  const dy = y - inactivityState.lastCursorY;
  const movementForActivityThreshold = 14;
  const activityCooldownMs = 260;

  if (Math.hypot(dx, dy) > movementForActivityThreshold) {
    inactivityState.lastCursorX = x;
    inactivityState.lastCursorY = y;
    const now = Date.now();
    if (now - inactivityState.lastCursorActivityAt >= activityCooldownMs) {
      inactivityState.lastCursorActivityAt = now;
      markUserActivity("cursor");
    }
  }
  cursorPosition.x = x;
  cursorPosition.y = y;
  const width = Math.max(1, window.innerWidth || 1);
  const height = Math.max(1, window.innerHeight || 1);
  cursorNormalizedX = (x / width) * 2 - 1;
  cursorNormalizedY = -(y / height) * 2 + 1;
  cursorTrackingDirty = true;
}

function setCursorTracking(enabled) {
  cursorTrackingEnabled = enabled;
  cursorTrackingDirty = true;
  if (!enabled) {
    for (const character in socialLookState) {
      delete socialLookState[character];
    }
    for (const character in cursorBodyFollowState) {
      delete cursorBodyFollowState[character];
    }
  }
}

function getCursorBodyFollowWeight(character, inactivityIntensity = 0) {
  const idleAction = activeIdleAnimations[character];
  const idleActive = Boolean(idleAction && (!idleAction.isRunning || idleAction.isRunning()));
  const idleBodyWeight = 0.18 - (0.11 * inactivityIntensity);
  const targetWeight = idleActive ? Math.max(0.05, idleBodyWeight) : 1;

  if (cursorBodyFollowState[character] === undefined) {
    cursorBodyFollowState[character] = targetWeight;
    return targetWeight;
  }

  const currentWeight = cursorBodyFollowState[character];
  const blendSpeed = targetWeight < currentWeight ? 0.08 : 0.03;
  const nextWeight = currentWeight + (targetWeight - currentWeight) * blendSpeed;
  cursorBodyFollowState[character] = Math.max(0, Math.min(1, nextWeight));
  return cursorBodyFollowState[character];
}

const activeNaturalMovements = {};
const modelRotationJobs = {};

function applyNaturalMovementWithSlerp(vrm, boneName, movementConfig, character, modelId) {
    const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
    if (!bone) return;

    const startTime = Date.now();
    const baseQuat = bone.quaternion.clone();
    const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat);
    const targetEuler = new THREE.Euler(
        baseEuler.x + movementConfig.x,
        baseEuler.y + movementConfig.y,
        baseEuler.z + movementConfig.z
    );
    const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);

    const rampDuration = 3500;
    const holdDuration = 5000;
    const totalDuration = rampDuration * 2 + holdDuration;

    function updateMovement() {
        if (current_avatars[character]?.vrm !== vrm ||
            current_avatars[character]?.["id"] !== modelId) {
            return;
        }

        const now = Date.now();
        const elapsed = now - startTime;

        if (elapsed >= totalDuration) {
            bone.quaternion.slerp(baseQuat, 0.03);
            if (bone.quaternion.angleTo(baseQuat) > 0.001) {
                requestAnimationFrame(updateMovement);
            } else {
                bone.quaternion.slerp(baseQuat, 0.2);
                delete activeNaturalMovements[character];
            }
            return;
        }

        let t = 0;
        if (elapsed < rampDuration) {
            t = easeInOutCubic(elapsed / rampDuration);
            bone.quaternion.slerpQuaternions(baseQuat, targetQuat, t);
        } else if (elapsed < rampDuration + holdDuration) {
            bone.quaternion.slerp(targetQuat, 0.2);
        } else {
            const rampDownElapsed = elapsed - rampDuration - holdDuration;
            t = easeInOutCubic(rampDownElapsed / rampDuration);
            bone.quaternion.slerpQuaternions(targetQuat, baseQuat, t);
        }

        requestAnimationFrame(updateMovement);
    }

    activeNaturalMovements[character] = updateMovement;
    updateMovement();
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function setExpressionValueWithWinkSupport(expressionManager, expressionName, value) {
    const clamped = Math.min(1, Math.max(0, value));

    if (expressionName === 'blinkLeft' || expressionName === 'blinkRight') {
        const opposite = expressionName === 'blinkLeft' ? 'blinkRight' : 'blinkLeft';
        const curved = 1 - Math.pow(1 - clamped, 2);
        const boosted = Math.min(1, curved * 1.25);
        expressionManager.setValue(expressionName, boosted);
        expressionManager.setValue(opposite, 0);

        const blinkAssist = Math.min(1, boosted * 0.55);
        expressionManager.setValue('blink', Math.max(expressionManager.getValue('blink') || 0, blinkAssist));
        return;
    }

    expressionManager.setValue(expressionName, clamped);
}

// Helper to apply brief expressions during idle movements
function applyIdleExpression(vrm, character, expressionName, intensity = 0.7, duration = 2000, useClassifiedMapping = true) {
    if (!vrm.expressionManager) return;

    let finalExpression = expressionName;
    let finalIntensity = intensity;

    // Check if this is a winking expression - set flag to prevent automatic blink interference
    const isWinking = expressionName === 'blinkLeft' || expressionName === 'blinkRight';
    if (isWinking && current_avatars[character]) {
        current_avatars[character].winking = true;
        current_avatars[character].customWinking = true;
    }

    // Check if expressionName is a classified emotion and get mapping
    if (useClassifiedMapping) {
        const model_path = extension_settings.vrm.character_model_mapping[character];
        if (model_path && extension_settings.vrm.model_settings[model_path]) {
            const modelSettings = extension_settings.vrm.model_settings[model_path];
            if (modelSettings.classify_mapping && modelSettings.classify_mapping[expressionName]) {
                const mapping = modelSettings.classify_mapping[expressionName];
                if (mapping.expression && mapping.expression !== 'none') {
                    finalExpression = mapping.expression;
                }
                // Use intensity from mapping if available
                if (mapping.intensity !== undefined) {
                    finalIntensity = mapping.intensity;
                }
            }
        }
    }

    // Check for custom blend shape mapping
    const blendShapeMapping = getBlendShapeMapping(character, finalExpression);
    if (blendShapeMapping && blendShapeMapping.blendShapes) {
        applyCustomBlendShapeGroupIdle(vrm, character, finalExpression, blendShapeMapping, finalIntensity, duration, isWinking);
        return;
    }

    const startTime = Date.now();
    const rampDuration = duration * 0.3;
    const holdDuration = duration * 0.4;

    function updateExpression() {
        if (!current_avatars[character]) return;

        const elapsed = Date.now() - startTime;

        if (elapsed >= duration) {
            // Explicitly reset expression to 0 for blink-type expressions
            vrm.expressionManager.setValue(finalExpression, 0);
            // Clear winking state - let eyes return to neutral
            if (isWinking && current_avatars[character]) {
                vrm.expressionManager.setValue('blinkLeft', 0);
                vrm.expressionManager.setValue('blinkRight', 0);
                vrm.expressionManager.setValue('blink', 0);
                current_avatars[character].winking = false;
                current_avatars[character].customWinking = false;
            }
            return;
        }

        let amplitude = 0;
        if (elapsed < rampDuration) {
            amplitude = easeInOutCubic(elapsed / rampDuration);
        } else if (elapsed < rampDuration + holdDuration) {
            amplitude = 1;
        } else {
            amplitude = 1 - easeInOutCubic((elapsed - rampDuration - holdDuration) / (duration - rampDuration - holdDuration));
        }

        setExpressionValueWithWinkSupport(vrm.expressionManager, finalExpression, finalIntensity * amplitude);
        requestAnimationFrame(updateExpression);
    }

    updateExpression();
}

// Helper to apply custom blend shape groups during idle animations
function applyCustomBlendShapeGroupIdle(vrm, character, expressionName, blendMapping, intensity = 1.0, duration = 2000, isWinking = false) {
    if (!vrm || !vrm.expressionManager) return;

    // Set winking flag if this is a wink expression
    if (isWinking && current_avatars[character]) {
        current_avatars[character].winking = true;
        current_avatars[character].customWinking = true;
    }

    const startTime = Date.now();
    const rampDuration = duration * 0.3;
    const holdDuration = duration * 0.4;
    const blendShapes = blendMapping.blendShapes || {};

    function updateBlendShapes() {
        if (!current_avatars[character]) return;

        const elapsed = Date.now() - startTime;

        if (elapsed >= duration) {
            // Explicitly reset all blend shapes to 0
            for (const blendShapeName in blendShapes) {
                vrm.expressionManager.setValue(blendShapeName, 0);
            }
            // Clear winking state - let eyes return to neutral
            if (current_avatars[character]) {
                vrm.expressionManager.setValue('blinkLeft', 0);
                vrm.expressionManager.setValue('blinkRight', 0);
                vrm.expressionManager.setValue('blink', 0);
                current_avatars[character].winking = false;
                current_avatars[character].customWinking = false;
            }
            return;
        }

        let amplitude = 0;
        if (elapsed < rampDuration) {
            amplitude = easeInOutCubic(elapsed / rampDuration);
        } else if (elapsed < rampDuration + holdDuration) {
            amplitude = 1;
        } else {
            amplitude = 1 - easeInOutCubic((elapsed - rampDuration - holdDuration) / (duration - rampDuration - holdDuration));
        }

        for (const [blendShapeName, weight] of Object.entries(blendShapes)) {
            const adjustedIntensity = Math.min(1.0, Math.max(0.0, weight * intensity * amplitude));
            setExpressionValueWithWinkSupport(vrm.expressionManager, blendShapeName, adjustedIntensity);
        }

        requestAnimationFrame(updateBlendShapes);
    }

    updateBlendShapes();
}

// Helper to apply subtle model Y rotation during idle movements
function applyModelRotation(vrm, character, modelId, targetYaw, duration = 7000) {
    const objectContainer = current_avatars[character]?.["objectContainer"];
    if (!objectContainer) return;

    // Avoid conflicting body controllers: cursor tracking and natural model rotation
    // should not drive root yaw at the same time.
    if (cursorTrackingEnabled && extension_settings.vrm.follow_cursor) {
        return;
    }

    const jobId = (modelRotationJobs[character] || 0) + 1;
    modelRotationJobs[character] = jobId;
    
    const startYaw = objectContainer.rotation.y;
    const startTime = Date.now();
    const rampDuration = duration * 0.3;
    const holdDuration = duration * 0.4;
    const totalDuration = duration;
    
    function updateRotation() {
        if (current_avatars[character]?.["id"] !== modelId) return;
        if (modelRotationJobs[character] !== jobId) return;

        if (cursorTrackingEnabled && extension_settings.vrm.follow_cursor) {
            if (modelRotationJobs[character] === jobId) {
                delete modelRotationJobs[character];
            }
            return;
        }
        
        const elapsed = Date.now() - startTime;
        
        if (elapsed >= totalDuration) {
            // Return to base
            objectContainer.rotation.y += (startYaw - objectContainer.rotation.y) * 0.03;
            if (Math.abs(objectContainer.rotation.y - startYaw) > 0.001) {
                requestAnimationFrame(updateRotation);
            } else if (modelRotationJobs[character] === jobId) {
                delete modelRotationJobs[character];
            }
            return;
        }
        
        let amplitude = 0;
        if (elapsed < rampDuration) {
            amplitude = easeInOutCubic(elapsed / rampDuration);
        } else if (elapsed < rampDuration + holdDuration) {
            amplitude = 1;
        } else {
            amplitude = 1 - easeInOutCubic((elapsed - rampDuration - holdDuration) / rampDuration);
        }
        
        const currentTarget = startYaw + (targetYaw * amplitude);
        objectContainer.rotation.y += (currentTarget - objectContainer.rotation.y) * 0.04;
        
        requestAnimationFrame(updateRotation);
    }
    
    updateRotation();
}

// Helper to get available blend shape names from VRM model
function getAvailableBlendShapeNames(vrm) {
    if (!vrm || !vrm.blendShapeProxy) return [];

    const blendShapeNames = [];
    const expressionMap = vrm.expressionManager?.expressionMap || {};

    for (const expressionName in expressionMap) {
        blendShapeNames.push(expressionName);
    }

    return blendShapeNames;
}

// Helper to apply custom blend shape mapping
function applyCustomBlendShape(vrm, blendShapeName, intensity = 1.0) {
    if (!vrm || !vrm.expressionManager) return;

    const expressionMap = vrm.expressionManager.expressionMap;
    if (!expressionMap[blendShapeName]) {
        console.debug(DEBUG_PREFIX, 'Blend shape not found:', blendShapeName);
        return;
    }

    vrm.expressionManager.setValue(blendShapeName, intensity);
}

// Helper to apply custom blend shape mapping with multiple blend shapes
function applyCustomBlendShapeGroup(character, vrm, blendShapeGroup, intensity = 1.0) {
    if (!vrm || !vrm.expressionManager) return;

    const model_path = extension_settings.vrm.character_model_mapping[character];
    if (!model_path) return;

    const modelSettings = extension_settings.vrm.model_settings[model_path];
    const blendMapping = modelSettings?.blend_shape_mapping?.[blendShapeGroup];
    
    if (!blendMapping || !blendMapping.blendShapes) return;

    for (const [blendShapeName, weight] of Object.entries(blendMapping.blendShapes)) {
        const adjustedIntensity = Math.min(1.0, Math.max(0.0, weight * intensity));
        applyCustomBlendShape(vrm, blendShapeName, adjustedIntensity);
    }
}

// Helper to get blend shape mapping for an expression name
function getBlendShapeMapping(character, expressionName) {
    const model_path = extension_settings.vrm.character_model_mapping[character];
    if (!model_path) return null;
    
    const modelSettings = extension_settings.vrm.model_settings[model_path];
    if (!modelSettings?.blend_shape_mapping) return null;
    
    return modelSettings.blend_shape_mapping[expressionName] || null;
}

// Helper to reset all blend shapes to 0
function resetAllBlendShapes(vrm) {
    if (!vrm || !vrm.expressionManager) return;

    const expressionMap = vrm.expressionManager.expressionMap;
    for (const expressionName in expressionMap) {
        vrm.expressionManager.setValue(expressionName, 0.0);
    }
}

const NATURAL_MOVEMENTS = {
  slowHeadTurn: {
    type: 'head',
    duration: 12000,
    description: 'slow head turn',
    action: (vrm, character, modelId) => {
      const direction = Math.random() > 0.5 ? 1 : -1;
      const angleY = (Math.random() * 0.35 + 0.17) * direction;
      const angleX = (Math.random() * 0.16 - 0.08);
      const angleZ = (Math.random() * 0.1 - 0.05) * direction;

      // Head movement
      const headConfig = {
        x: angleX,
        y: angleY,
        z: angleZ
      };
      applyNaturalMovementWithSlerp(vrm, "head", headConfig, character, modelId);

      // Neck follows with natural follow-through
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: angleX * 0.5,
            y: angleY * 0.42,
            z: angleZ * 0.6
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 200);
      }

      // More pronounced model rotation to follow head
      const modelRotation = direction * (Math.random() * 0.1 + 0.08);
      applyModelRotation(vrm, character, modelId, modelRotation, 10000);
    }
  },
  headTilt: {
    type: 'head',
    duration: 12000,
    description: 'curious head tilt',
    action: (vrm, character, modelId) => {
      const direction = Math.random() > 0.5 ? 1 : -1;
      // More exaggerated tilt
      const angleZ = (Math.random() * 0.35 + 0.27) * direction;
      const angleX = (Math.random() * 0.12 - 0.06);
      const angleY = (Math.random() * 0.16 - 0.08) * direction;

      // Apply to head
      const headConfig = {
        x: angleX,
        y: angleY,
        z: angleZ
      };
      applyNaturalMovementWithSlerp(vrm, "head", headConfig, character, modelId);

      // Add neck follow with more natural movement
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: angleX * 0.5,
            y: angleY * 0.35,
            z: angleZ * 0.57
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 200);
      }

      // 30% chance to wink during head tilt
      if (Math.random() > 0.7) {
        const winkEye = direction > 0 ? 'blinkLeft' : 'blinkRight';
        setTimeout(() => {
          applyIdleExpression(vrm, character, winkEye, 0.9, 1500);
        }, 1000);
      }
      // 40% chance for curious smile
      else if (Math.random() > 0.6) {
        setTimeout(() => {
          applyIdleExpression(vrm, character, 'happy', 0.4, 2000);
        }, 500);
      }
    }
  },
  slowGlance: {
    type: 'head',
    duration: 10000,
    description: 'casual glance',
    action: (vrm, character, modelId) => {
      const directionX = Math.random() > 0.5 ? 1 : -1;
      const directionY = Math.random() > 0.5 ? 1 : -1;

      const angleX = (Math.random() * 0.14 + 0.05) * directionX;
      const angleY = (Math.random() * 0.28 + 0.13) * directionY;
      const angleZ = (Math.random() * 0.16 - 0.08);

      // More noticeable model rotation with glance
      const modelRotation = directionY * (Math.random() * 0.07 + 0.05);
      applyModelRotation(vrm, character, modelId, modelRotation, 9000);

      // 50% chance for curious expression
      if (Math.random() > 0.5) {
        setTimeout(() => applyIdleExpression(vrm, character, 'surprised', 0.5, 2000), 400);
      }

      // Head glance - more pronounced
      const headConfig = {
        x: angleX,
        y: angleY,
        z: angleZ
      };
      applyNaturalMovementWithSlerp(vrm, "head", headConfig, character, modelId);

      // Neck follows naturally
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: angleX * 0.5,
            y: angleY * 0.54,
            z: angleZ * 0.5
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 300);
      }

      // Spine twist for more natural look
      const spine = vrm.humanoid?.getNormalizedBoneNode("spine");
      if (spine) {
        setTimeout(() => {
          const spineConfig = {
            x: angleX * 0.25,
            y: angleY * 0.43,
            z: angleZ * 0.38
          };
          applyNaturalMovementWithSlerp(vrm, "spine", spineConfig, character, modelId);
        }, 500);
      }
    }
  },
  lookAround: {
    type: 'head',
    duration: 16000,
    description: 'looking around',
    action: (vrm, character, modelId) => {
      // Model rotation that follows to look pattern - more dynamic
      const modelRotation1 = 0.09;
      const modelRotation2 = -0.08;

      setTimeout(() => applyModelRotation(vrm, character, modelId, modelRotation1, 4500), 500);
      setTimeout(() => applyModelRotation(vrm, character, modelId, modelRotation2, 4500), 7000);

      // 60% chance for slight smile during look
      if (Math.random() > 0.4) {
        setTimeout(() => applyIdleExpression(vrm, character, 'happy', 0.45, 1800), 300);
      }

      const directions = [
        { x: 0.12, y: 0.32, duration: 3500 },
        { x: 0.05, y: 0.08, duration: 2500 },
        { x: 0.1, y: -0.28, duration: 3500 },
        { x: 0.02, y: -0.06, duration: 3000 }
      ];

            let currentStep = 0;
            const head = vrm.humanoid?.getNormalizedBoneNode("head");
            if (!head) return;
            const baseEuler = new THREE.Euler().setFromQuaternion(head.quaternion.clone());

            function doStep() {
                if (currentStep >= directions.length ||
                    current_avatars[character]?.vrm !== vrm ||
                    current_avatars[character]?.["id"] !== modelId) {
                    return;
                }

                const step = directions[currentStep];
                const startTime = Date.now();
                const startQuat = head.quaternion.clone();
                const targetEuler = new THREE.Euler(
                    baseEuler.x + step.x,
                    baseEuler.y + step.y,
                    baseEuler.z
                );
                const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);

                function animateStep() {
                    if (current_avatars[character]?.vrm !== vrm) return;
                    const elapsed = Date.now() - startTime;
                    const progress = Math.min(elapsed / step.duration, 1);
                    const eased = easeInOutCubic(progress);

                    head.quaternion.slerpQuaternions(startQuat, targetQuat, eased);

                    if (progress < 1) {
                        requestAnimationFrame(animateStep);
                    } else {
                        currentStep++;
                        if (currentStep < directions.length) {
                            setTimeout(doStep, 1200);
                        } else {
                            const returnStart = Date.now();
                            const returnDuration = 2500;
                            const holdQuat = head.quaternion.clone();
                            const baseQuat = new THREE.Quaternion().setFromEuler(baseEuler);

                            function returnToBase() {
                                const returnElapsed = Date.now() - returnStart;
                                const returnProgress = Math.min(returnElapsed / returnDuration, 1);
                                head.quaternion.slerpQuaternions(holdQuat, baseQuat, easeInOutCubic(returnProgress));

                                if (returnProgress < 1) {
                                    requestAnimationFrame(returnToBase);
                                }
                            }
                            returnToBase();
                        }
                    }
                }

                animateStep();
            }

            doStep();
        }
    },
    shoulderShrug: {
        type: 'body',
        duration: 6000,
        description: 'shoulder shrug',
        action: (vrm, character, modelId) => {
            const bothShoulders = Math.random() > 0.6;
            const leftShoulder = vrm.humanoid?.getNormalizedBoneNode("leftShoulder");
            const rightShoulder = vrm.humanoid?.getNormalizedBoneNode("rightShoulder");

            if (!leftShoulder && !rightShoulder) return;

            const shrugAmount = Math.random() * 0.12 + 0.06;
            const startTime = Date.now();
            const baseLeft = leftShoulder?.quaternion.clone();
            const baseRight = rightShoulder?.quaternion.clone();

            const rampDuration = 2500;
            const holdDuration = 4000;
            const totalDuration = rampDuration * 2 + holdDuration;

            function animateShrug() {
                if (current_avatars[character]?.vrm !== vrm ||
                    current_avatars[character]?.["id"] !== modelId) {
                    return;
                }

                const elapsed = Date.now() - startTime;

                if (elapsed >= totalDuration) {
                    if (leftShoulder && baseLeft) {
                        leftShoulder.quaternion.slerp(baseLeft, 0.03);
                    }
                    if (rightShoulder && baseRight && bothShoulders) {
                        rightShoulder.quaternion.slerp(baseRight, 0.03);
                    }

                    const stillMoving = (leftShoulder && baseLeft && leftShoulder.quaternion.angleTo(baseLeft) > 0.001) ||
                                       (rightShoulder && baseRight && bothShoulders && rightShoulder.quaternion.angleTo(baseRight) > 0.001);

                    if (stillMoving) {
                        requestAnimationFrame(animateShrug);
                    }
                    return;
                }

                let amplitude = 0;
                if (elapsed < rampDuration) {
                    amplitude = easeInOutCubic(elapsed / rampDuration);
                } else if (elapsed < rampDuration + holdDuration) {
                    amplitude = 1;
                } else {
                    amplitude = 1 - easeInOutCubic((elapsed - rampDuration - holdDuration) / rampDuration);
                }

                const shrugEuler = new THREE.Euler(-shrugAmount * amplitude, 0, 0);
                const shrugQuat = new THREE.Quaternion().setFromEuler(shrugEuler);

                if (leftShoulder && baseLeft) {
                    const targetQuat = baseLeft.clone().multiply(shrugQuat);
                    leftShoulder.quaternion.slerp(targetQuat, 0.04);
                }
                if (rightShoulder && baseRight && bothShoulders) {
                    const targetQuat = baseRight.clone().multiply(shrugQuat);
                    rightShoulder.quaternion.slerp(targetQuat, 0.04);
                }

                requestAnimationFrame(animateShrug);
            }

            animateShrug();
        }
    },
    armStretch: {
        type: 'body',
        duration: 8000,
        description: 'arm stretch',
        action: (vrm, character, modelId) => {
            const side = Math.random() > 0.5 ? "left" : "right";
            const upperArm = vrm.humanoid?.getNormalizedBoneNode(`${side}UpperArm`);
            const lowerArm = vrm.humanoid?.getNormalizedBoneNode(`${side}LowerArm`);

            if (!upperArm) return;

            const startTime = Date.now();
            const baseUpper = upperArm.quaternion.clone();
            const baseLower = lowerArm?.quaternion.clone();

            const rampDuration = 3000;
            const holdDuration = 5000;
            const totalDuration = rampDuration * 2 + holdDuration;

            function animateStretch() {
                if (current_avatars[character]?.vrm !== vrm ||
                    current_avatars[character]?.["id"] !== modelId) {
                    return;
                }

                const elapsed = Date.now() - startTime;

                if (elapsed >= totalDuration) {
                    upperArm.quaternion.slerp(baseUpper, 0.03);
                    if (lowerArm && baseLower) {
                        lowerArm.quaternion.slerp(baseLower, 0.03);
                    }

                    const stillMoving = upperArm.quaternion.angleTo(baseUpper) > 0.001 ||
                                       (lowerArm && baseLower && lowerArm.quaternion.angleTo(baseLower) > 0.001);

                    if (stillMoving) {
                        requestAnimationFrame(animateStretch);
                    }
                    return;
                }

                let amplitude = 0;
                if (elapsed < rampDuration) {
                    amplitude = easeInOutCubic(elapsed / rampDuration);
                } else if (elapsed < rampDuration + holdDuration) {
                    amplitude = 1;
                } else {
                    amplitude = 1 - easeInOutCubic((elapsed - rampDuration - holdDuration) / rampDuration);
                }

                const stretchEuler = new THREE.Euler(
                    -0.2 * amplitude,
                    0,
                    (side === "left" ? 0.25 : -0.25) * amplitude
                );
                const stretchQuat = new THREE.Quaternion().setFromEuler(stretchEuler);
                const targetUpper = baseUpper.clone().multiply(stretchQuat);

                upperArm.quaternion.slerp(targetUpper, 0.04);

                if (lowerArm && baseLower) {
                    const elbowBend = new THREE.Quaternion().setFromEuler(
                        new THREE.Euler(-0.12 * amplitude, 0, 0)
                    );
                    const targetLower = baseLower.clone().multiply(elbowBend);
                    lowerArm.quaternion.slerp(targetLower, 0.04);
                }

                requestAnimationFrame(animateStretch);
            }

            animateStretch();
        }
    },
  weightShift: {
    type: 'body',
    duration: 10000,
    description: 'weight shift with spine twist',
    action: (vrm, character, modelId) => {
      const direction = Math.random() > 0.5 ? 1 : -1;

      // More pronounced model rotation with weight shift
      const modelRotation = direction * (Math.random() * 0.1 + 0.08);
      applyModelRotation(vrm, character, modelId, modelRotation, 9000);

      // Spine: shift + twist - much more visible
      const spineConfig = {
        x: Math.random() * 0.06 - 0.03,
        y: (Math.random() * 0.22 + 0.1) * direction,
        z: (Math.random() * 0.2 + 0.05) * direction
      };
      applyNaturalMovementWithSlerp(vrm, "spine", spineConfig, character, modelId);

      // Upper chest follows for more natural movement
      const upperChest = vrm.humanoid?.getNormalizedBoneNode("upperChest");
      if (upperChest) {
        setTimeout(() => {
          const chestConfig = {
            x: Math.random() * 0.04 - 0.02,
            y: (Math.random() * 0.1 + 0.05) * direction,
            z: (Math.random() * 0.12 + 0.04) * direction
          };
          applyNaturalMovementWithSlerp(vrm, "upperChest", chestConfig, character, modelId);
        }, 200);
      }

      // Hips: counter-rotation for balance
      const hips = vrm.humanoid?.getNormalizedBoneNode("hips");
      if (hips) {
        setTimeout(() => {
          const hipsConfig = {
            x: Math.random() * 0.06 - 0.03,
            y: -(Math.random() * 0.12 + 0.05) * direction,
            z: (Math.random() * 0.15 + 0.05) * direction
          };
          applyNaturalMovementWithSlerp(vrm, "hips", hipsConfig, character, modelId);
        }, 350);
      }

      // 40% chance for thoughtful expression
      if (Math.random() > 0.6) {
        setTimeout(() => applyIdleExpression(vrm, character, 'neutral', 0.5, 1500), 800);
      }
    }
  },
  neckStretch: {
    type: 'neck',
    duration: 10000,
    description: 'neck stretch',
    action: (vrm, character, modelId) => {
      const directionX = Math.random() > 0.5 ? 1 : -1;
      const directionY = Math.random() > 0.5 ? 1 : -1;
      const directionZ = Math.random() > 0.5 ? 1 : -1;

      // Neck tilt - more pronounced stretching motion
      const neckConfig = {
        x: (Math.random() * 0.12 + 0.06) * directionX,
        y: (Math.random() * 0.25 + 0.05) * directionY,
        z: (Math.random() * 0.4 + 0.15) * directionZ
      };
      applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);

      // Head follows for natural stretching
      const head = vrm.humanoid?.getNormalizedBoneNode("head");
      if (head) {
        setTimeout(() => {
          const headConfig = {
            x: neckConfig.x * 0.7,
            y: neckConfig.y * 0.6,
            z: neckConfig.z * 0.8
          };
          applyNaturalMovementWithSlerp(vrm, "head", headConfig, character, modelId);
        }, 200);
      }

      // 50% chance for expression during stretch
      if (Math.random() > 0.5) {
        setTimeout(() => applyIdleExpression(vrm, character, 'surprised', 0.55, 2200), 500);
      }
    }
  },
  subtleNod: {
    type: 'head',
    duration: 8000,
    description: 'subtle nod',
    action: (vrm, character, modelId) => {
      const direction = Math.random() > 0.5 ? 1 : -1;
      // More pronounced nod with slight natural variation
      const headConfig = {
        x: Math.random() * 0.14 + 0.08,
        y: (Math.random() * 0.05) * direction,
        z: (Math.random() * 0.03) * direction
      };
      applyNaturalMovementWithSlerp(vrm, "head", headConfig, character, modelId);

      // Neck follows naturally
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: headConfig.x * 0.55,
            y: headConfig.y * 0.6,
            z: headConfig.z * 0.5
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 200);
      }

      // 70% chance for gentle smile during nod
      if (Math.random() > 0.3) {
        setTimeout(() => applyIdleExpression(vrm, character, 'happy', 0.5, 1500), 1000);
      }
    }
  },
  hipShift: {
    type: 'hips',
    duration: 11000,
    description: 'hip shift with rotation',
    action: (vrm, character, modelId) => {
      const direction = Math.random() > 0.5 ? 1 : -1;

      // Model rotation with hip shift - more dynamic
      const modelRotation = direction * (Math.random() * 0.08 + 0.08);
      applyModelRotation(vrm, character, modelId, modelRotation, 9500);

      // Hip tilt + rotation for more dynamic movement
      const hipConfig = {
        x: (Math.random() * 0.08 - 0.04),
        y: (Math.random() * 0.25 + 0.1) * direction,
        z: (Math.random() * 0.22 + 0.12) * direction
      };
      applyNaturalMovementWithSlerp(vrm, "hips", hipConfig, character, modelId);

      // Upper chest counter-movement for balance
      const upperChest = vrm.humanoid?.getNormalizedBoneNode("upperChest");
      if (upperChest) {
        setTimeout(() => {
          const chestConfig = {
            x: (Math.random() * 0.05 - 0.025),
            y: (Math.random() * 0.08 + 0.04) * direction,
            z: (Math.random() * 0.08 + 0.04) * direction
          };
          applyNaturalMovementWithSlerp(vrm, "upperChest", chestConfig, character, modelId);
        }, 250);
      }

      // Spine counter-movement for balance
      const spine = vrm.humanoid?.getNormalizedBoneNode("spine");
      if (spine) {
        setTimeout(() => {
          const spineConfig = {
            x: (Math.random() * 0.08 - 0.04),
            y: -(Math.random() * 0.15 + 0.08) * direction,
            z: -(Math.random() * 0.12 + 0.07) * direction
          };
          applyNaturalMovementWithSlerp(vrm, "spine", spineConfig, character, modelId);
        }, 400);
      }

      // 40% chance for curious expression
      if (Math.random() > 0.6) {
        setTimeout(() => applyIdleExpression(vrm, character, 'surprised', 0.6, 2200), 700);
      }
    }
  },
  feminineHipSway: {
    type: 'hips',
    duration: 14000,
    description: 'feminine hip sway',
    action: (vrm, character, modelId) => {
      const swayAmount = Math.random() * 0.25 + 0.22;
      const direction = Math.random() > 0.5 ? 1 : -1;

      // Model sways with hips - more pronounced
      const modelRotation = direction * (Math.random() * 0.08 + 0.06);
      applyModelRotation(vrm, character, modelId, modelRotation, 12000);

      // Hip sway with rotation - more dynamic
      const hipConfig = {
        x: (Math.random() * 0.08 - 0.04),
        y: Math.random() * 0.15,
        z: swayAmount
      };
      applyNaturalMovementWithSlerp(vrm, "hips", hipConfig, character, modelId);

      // Upper chest follows for more graceful movement
      const upperChest = vrm.humanoid?.getNormalizedBoneNode("upperChest");
      if (upperChest) {
        setTimeout(() => {
          const chestConfig = {
            x: (Math.random() * 0.06 - 0.03),
            y: -(Math.random() * 0.12 + 0.05),
            z: -swayAmount * 0.35
          };
          applyNaturalMovementWithSlerp(vrm, "upperChest", chestConfig, character, modelId);
        }, 200);
      }

      // Spine follows with delay
      const spine = vrm.humanoid?.getNormalizedBoneNode("spine");
      if (spine) {
        setTimeout(() => {
          const spineConfig = {
            x: (Math.random() * 0.06 - 0.03),
            y: -(Math.random() * 0.1),
            z: -swayAmount * 0.52
          };
          applyNaturalMovementWithSlerp(vrm, "spine", spineConfig, character, modelId);
        }, 400);
      }

      // Neck slight movement for elegance
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: (Math.random() * 0.04 - 0.02),
            y: -(Math.random() * 0.08),
            z: (Math.random() * 0.1 - 0.05)
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 600);
      }

      // 70% chance for pleasant expression
      if (Math.random() > 0.3) {
        setTimeout(() => applyIdleExpression(vrm, character, 'happy', 0.5, 2200), 1200);
      }
    }
  },
  coyHeadTilt: {
    type: 'head',
    duration: 11000,
    description: 'coy head tilt',
    action: (vrm, character, modelId) => {
      const direction = Math.random() > 0.5 ? 1 : -1;
      // More pronounced coy tilt with slight angle variation
      const headConfig = {
        x: Math.random() * 0.1 + 0.1,
        y: (Math.random() * 0.12) * direction,
        z: -(Math.random() * 0.16 + 0.22) * direction
      };
      applyNaturalMovementWithSlerp(vrm, "head", headConfig, character, modelId);

      // Neck follows for more natural movement
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: headConfig.x * 0.53,
            y: headConfig.y * 0.5,
            z: headConfig.z * 0.58
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 200);
      }

      // 70% chance for shy or cute expression
      const expression = Math.random() > 0.3 ? 'relaxed' : 'shy';
      setTimeout(() => applyIdleExpression(vrm, character, expression, 1.0, 2500), 1200);
    }
  },
  chestLift: {
    type: 'chest',
    duration: 9000,
    description: 'chest lift',
    action: (vrm, character, modelId) => {
      const upperChest = vrm.humanoid?.getNormalizedBoneNode("upperChest") || vrm.humanoid?.getNormalizedBoneNode("chest");
      if (!upperChest) return;
      const boneName = upperChest.name;

      // Keep this subtle to avoid exaggerated lean-back posture.
      const chestConfig = {
        x: Math.random() * 0.06 + 0.08,
        y: Math.random() * 0.04 - 0.02,
        z: Math.random() * 0.03 - 0.015
      };
      applyNaturalMovementWithSlerp(vrm, boneName, chestConfig, character, modelId);

      // Open arms slightly so hands do not rest into the thighs during this pose.
      const armOpenAmount = Math.random() * 0.05 + 0.06;
      applyNaturalMovementWithSlerp(vrm, "leftUpperArm", { x: -0.02, y: 0, z: armOpenAmount }, character, modelId);
      applyNaturalMovementWithSlerp(vrm, "rightUpperArm", { x: -0.02, y: 0, z: -armOpenAmount }, character, modelId);

      // Spine follows naturally
      const spine = vrm.humanoid?.getNormalizedBoneNode("spine");
      if (spine) {
        setTimeout(() => {
          const spineConfig = {
            x: chestConfig.x * 0.35,
            y: chestConfig.y * 0.5,
            z: chestConfig.z * 0.5
          };
          applyNaturalMovementWithSlerp(vrm, "spine", spineConfig, character, modelId);
        }, 250);
      }

      // Neck slight adjustment for natural lift
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: -chestConfig.x * 0.2,
            y: 0,
            z: 0
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 400);
      }

      // 60% chance for confident or proud expression
      if (Math.random() > 0.4) {
        const expression = Math.random() > 0.5 ? 'happy' : 'relaxed';
        setTimeout(() => applyIdleExpression(vrm, character, expression, 1.0, 2000), 1800);
      }
    }
  },
};

// debug
const gridHelper = new THREE.GridHelper( 20, 20 );
const axesHelper = new THREE.AxesHelper( 10 );

function updateCursorTracking() {
  if (!cursorTrackingEnabled || !camera || !renderer) return;

  const width = Math.max(1, window.innerWidth || 1);
  const height = Math.max(1, window.innerHeight || 1);
  if (width !== cursorTrackingViewportWidth || height !== cursorTrackingViewportHeight) {
    cursorTrackingViewportWidth = width;
    cursorTrackingViewportHeight = height;
    cursorNormalizedX = (cursorPosition.x / width) * 2 - 1;
    cursorNormalizedY = -(cursorPosition.y / height) * 2 + 1;
    cursorTrackingDirty = true;
  }

  if (!cursorTrackingDirty) return;
  cursorTrackingDirty = false;

  cursorNdc.set(cursorNormalizedX, cursorNormalizedY);
  cursorRaycaster.setFromCamera(cursorNdc, camera);

  const distance = 5.0;  // Far enough for natural eye movement range
  cursorTargetPos.copy(camera.position).add(cursorRaycaster.ray.direction.multiplyScalar(distance));

  cursorTarget.position.copy(cursorTargetPos);
}

function getProceduralControlProfile(character) {
  const avatar = current_avatars[character];
  const rigCal = avatar?.proceduralCalibration || null;
  const modelPath = extension_settings?.vrm?.character_model_mapping?.[character];
  const defaultMotion = modelPath ? extension_settings?.vrm?.model_settings?.[modelPath]?.animation_default?.motion : null;
  const currentMotionName = avatar?.motion?.name || 'none';
  const currentMotionAction = avatar?.motion?.animation;
  const sequenceBusy = Boolean(animationSequences?.[character] || sequencePlaybackState?.[character]?.active || sequencePlaybackState?.[character]?.waiting);
  const runningNonIdleMotion = Boolean(currentMotionAction && currentMotionAction.isRunning && currentMotionAction.isRunning() && !isIdleMotionName(currentMotionName, defaultMotion));
  const idleAction = activeIdleAnimations[character];
  const idleActionActive = Boolean(idleAction && (!idleAction.isRunning || idleAction.isRunning()));
  const activeIdleName = String(getActiveIdleClipName(character) || '').toLowerCase();
  const chestGestureActive = activeIdleName.includes('chestadjustgesture') || activeIdleName.includes('chestshaketease');
  const lipSyncActive = isCharacterLipSyncActive(character);

  const profile = {
    cursorGlobal: 1,
    cursorBody: rigCal?.cursorBodyScale || 1,
    cursorShoulders: (rigCal?.shoulderMobility || 1) * 0.9,
    cursorNeckScale: 1,
    ambientWeight: 0.55,
    selfContactWeight: 0.45,
    mode: 'default',
    sequenceBusy,
    runningNonIdleMotion,
    idleActionActive,
    chestGestureActive,
    lipSyncActive,
  };

  if (sequenceBusy || runningNonIdleMotion) {
    profile.mode = 'motion_priority';
    profile.cursorBody = 0.2;
    profile.cursorShoulders = 0.15;
    profile.cursorNeckScale = 0.92;
    profile.ambientWeight = 0.08;
    profile.selfContactWeight = 0;
  } else if (chestGestureActive) {
    profile.mode = 'gesture_priority';
    profile.cursorBody = 0.42;
    profile.cursorShoulders = 0.38;
    profile.cursorNeckScale = 1.02;
    profile.ambientWeight = 0.8;
    profile.selfContactWeight = 0;
  } else if (idleActionActive) {
    profile.mode = 'idle_blend';
    profile.cursorBody = 0.62;
    profile.cursorShoulders = 0.66;
    profile.cursorNeckScale = 1.05;
    profile.ambientWeight = 1;
    profile.selfContactWeight = 1;
  }

  if (lipSyncActive) {
    profile.cursorBody *= 0.9;
    profile.cursorShoulders *= 0.85;
    profile.ambientWeight *= 0.75;
  }

  profile.cursorBody = Math.max(0.08, Math.min(1.25, profile.cursorBody));
  profile.cursorShoulders = Math.max(0.06, Math.min(1.25, profile.cursorShoulders));
  profile.cursorNeckScale = Math.max(0.7, Math.min(1.35, profile.cursorNeckScale));
  profile.ambientWeight = Math.max(0, Math.min(1.3, profile.ambientWeight));
  profile.selfContactWeight = Math.max(0, Math.min(1.1, profile.selfContactWeight));

  return profile;
}

function applyCursorTiltAndShift(vrm, character, influenceTarget = 1, controlProfile = null) {
  const avatar = current_avatars[character];
  const upperChest = getCachedBone(avatar, "upperChest");
  const objectContainer = avatar?.["objectContainer"];

  if (!upperChest || !objectContainer) return;

  // Initialize state
  if (!cursorTiltState[character]) {
    cursorTiltState[character] = {
      currentYaw: 0,
      currentPitch: 0,
      shoulderCurrentYaw: 0,
      shoulderCurrentRoll: 0,
      bodyCursorX: 0,
      bodyCursorY: 0,
      modelCurrentYaw: 0,
      modelCurrentPitch: 0,
      neckCurrentYaw: 0,
      neckCurrentPitch: 0,
      headCurrentYaw: 0,
      headCurrentPitch: 0,
      modelAppliedYaw: 0,
      modelAppliedPitch: 0,
      influence: 0,
      chestAppliedQuat: new THREE.Quaternion(),
      neckAppliedQuat: new THREE.Quaternion(),
      headAppliedQuat: new THREE.Quaternion(),
      leftShoulderAppliedQuat: new THREE.Quaternion(),
      rightShoulderAppliedQuat: new THREE.Quaternion(),
      tempBaseQuat: new THREE.Quaternion(),
      tempInvQuat: new THREE.Quaternion(),
      tempEuler: new THREE.Euler(),
      tempQuat: new THREE.Quaternion(),
      tempBaseQuat2: new THREE.Quaternion(),
      tempEuler2: new THREE.Euler(),
      tempQuat2: new THREE.Quaternion()
    };
  }

  const state = cursorTiltState[character];

  const control = controlProfile || getProceduralControlProfile(character);
  const bodyCursorScale = control.cursorBody;
  const shoulderScale = control.cursorShoulders;
  const neckCursorScale = Math.max(0.52, bodyCursorScale * control.cursorNeckScale);

  const cursorX = cursorNormalizedX;
  const cursorY = cursorNormalizedY;

  const smoothstep = (edge0, edge1, value) => {
    const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(0.0001, edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };

  const absCursorX = Math.abs(cursorX);
  const absCursorY = Math.abs(cursorY);
  const turnStrength = smoothstep(0.12, 0.58, absCursorX);
  const extremeTurnStrength = smoothstep(0.42, 0.88, absCursorX);
  const pitchStrength = smoothstep(0.16, 0.7, absCursorY);

  // Human-like tracking chain: eyes/head first, then neck/shoulders(chest), then hips/root.
  const headGain = 1.0 - (0.18 * turnStrength);
  const neckGain = 0.82 + (0.26 * turnStrength);
  const chestGain = 0.32 + (0.78 * turnStrength);
  const modelGain = 0.08 + (0.7 * turnStrength) + (0.32 * extremeTurnStrength);

  state.influence += ((influenceTarget * control.cursorGlobal) - state.influence) * 0.12;
  state.influence = Math.max(0, Math.min(1, state.influence));

  // Body follows a delayed cursor signal so neck/head lead naturally.
  state.bodyCursorX += (cursorX - state.bodyCursorX) * 0.09;
  state.bodyCursorY += (cursorY - state.bodyCursorY) * 0.09;

  // HIERARCHY: Eyes > Head > Neck > Upper Body > Lower Body

  // MODEL Y ROTATION (Lower body horizontal) - Moderate turn
  const targetModelYaw = state.bodyCursorX * 0.2 * state.influence * bodyCursorScale * modelGain;
  const baseModelYaw = objectContainer.rotation.y - state.modelAppliedYaw;
  state.modelCurrentYaw += (targetModelYaw - state.modelCurrentYaw) * 0.08;
  // Clamp additive model yaw to prevent drift
  state.modelCurrentYaw = Math.max(-0.42, Math.min(0.42, state.modelCurrentYaw));
  state.modelAppliedYaw = state.modelCurrentYaw;
  objectContainer.rotation.y = baseModelYaw + state.modelAppliedYaw;

  // MODEL X ROTATION (Lower body pitch)
  // Keep root pitch neutral to avoid persistent leaning/back-tilt drift.
  const targetModelPitch = 0;
  const baseModelPitch = objectContainer.rotation.x - state.modelAppliedPitch;
  state.modelCurrentPitch += (targetModelPitch - state.modelCurrentPitch) * 0.08;
  // Clamp additive model pitch to prevent drift
  state.modelCurrentPitch = Math.max(-0.25, Math.min(0.25, state.modelCurrentPitch));
  state.modelAppliedPitch = state.modelCurrentPitch;
  objectContainer.rotation.x = baseModelPitch + state.modelAppliedPitch;

  // UPPER CHEST - Moderate head/chest tracking (reduced pitch to prevent excessive leaning)
  const targetYaw = state.bodyCursorX * 0.2 * state.influence * bodyCursorScale * chestGain;
  const targetPitch = state.bodyCursorY * 0.11 * state.influence * bodyCursorScale * (0.55 + 0.45 * pitchStrength);

  // Smooth interpolation towards target with limits to prevent drift
  state.currentYaw += (targetYaw - state.currentYaw) * 0.14;
  state.currentPitch += (targetPitch - state.currentPitch) * 0.14;

  // Clamp cursor offsets to prevent excessive accumulation
  state.currentYaw = Math.max(-0.5, Math.min(0.5, state.currentYaw));
  state.currentPitch = Math.max(-0.56, Math.min(0.56, state.currentPitch));

  // Rebuild animation base each frame, then apply additive cursor offset.
  const chestBaseQuat = state.tempBaseQuat.copy(upperChest.quaternion).multiply(state.tempInvQuat.copy(state.chestAppliedQuat).invert());
  const cursorQuat = state.tempQuat.setFromEuler(state.tempEuler.set(state.currentPitch, state.currentYaw, -state.currentYaw * 0.15));
  upperChest.quaternion.copy(chestBaseQuat).multiply(cursorQuat);
  state.chestAppliedQuat.copy(cursorQuat);

  const leftShoulder = getCachedBone(avatar, "leftShoulder");
  const rightShoulder = getCachedBone(avatar, "rightShoulder");
  if (leftShoulder && rightShoulder) {
    const shoulderTargetYaw = state.bodyCursorX * 0.11 * state.influence * shoulderScale * (0.35 + 0.7 * turnStrength);
    const shoulderTargetRoll = state.bodyCursorX * 0.07 * state.influence * shoulderScale * (0.35 + 0.6 * turnStrength);

    state.shoulderCurrentYaw += (shoulderTargetYaw - state.shoulderCurrentYaw) * 0.12;
    state.shoulderCurrentRoll += (shoulderTargetRoll - state.shoulderCurrentRoll) * 0.12;
    state.shoulderCurrentYaw = Math.max(-0.17, Math.min(0.17, state.shoulderCurrentYaw));
    state.shoulderCurrentRoll = Math.max(-0.13, Math.min(0.13, state.shoulderCurrentRoll));

    const leftBaseQuat = state.tempBaseQuat.copy(leftShoulder.quaternion).multiply(state.tempInvQuat.copy(state.leftShoulderAppliedQuat).invert());
    const rightBaseQuat = state.tempBaseQuat2.copy(rightShoulder.quaternion).multiply(state.tempQuat2.copy(state.rightShoulderAppliedQuat).invert());

    const leftQuat = state.tempQuat.setFromEuler(state.tempEuler.set(0, state.shoulderCurrentYaw * 0.55, state.shoulderCurrentRoll));
    const rightQuat = state.tempInvQuat.setFromEuler(state.tempEuler2.set(0, state.shoulderCurrentYaw * 0.55, -state.shoulderCurrentRoll));

    leftShoulder.quaternion.copy(leftBaseQuat).multiply(leftQuat);
    rightShoulder.quaternion.copy(rightBaseQuat).multiply(rightQuat);
    state.leftShoulderAppliedQuat.copy(leftQuat);
    state.rightShoulderAppliedQuat.copy(rightQuat);
  }

  // Neck rotation - add extra movement between chest and head
  const neck = getCachedBone(avatar, "neck");
  if (neck) {
    const neckTargetYaw = cursorX * 0.32 * state.influence * neckCursorScale * neckGain;
    const neckTargetPitch = cursorY * 0.075 * state.influence * neckCursorScale * (0.8 + 0.25 * pitchStrength);

    state.neckCurrentYaw += (neckTargetYaw - state.neckCurrentYaw) * 0.2;
    state.neckCurrentPitch += (neckTargetPitch - state.neckCurrentPitch) * 0.2;

    // Clamp neck offsets to prevent excessive accumulation
    state.neckCurrentYaw = Math.max(-0.68, Math.min(0.68, state.neckCurrentYaw));
    state.neckCurrentPitch = Math.max(-0.56, Math.min(0.56, state.neckCurrentPitch));

    // Rebuild animation base each frame, then apply additive cursor offset.
    const neckBaseQuat = state.tempBaseQuat.copy(neck.quaternion).multiply(state.tempInvQuat.copy(state.neckAppliedQuat).invert());
    const neckCursorQuat = state.tempQuat.setFromEuler(state.tempEuler.set(state.neckCurrentPitch, state.neckCurrentYaw, -state.neckCurrentYaw * 0.1));
    neck.quaternion.copy(neckBaseQuat).multiply(neckCursorQuat);
    state.neckAppliedQuat.copy(neckCursorQuat);
  }

  const head = getCachedBone(avatar, "head");
  if (head) {
    const headTargetYaw = cursorX * 0.24 * state.influence * headGain;
    const headTargetPitch = cursorY * 0.12 * state.influence * (0.92 + 0.12 * pitchStrength);

    state.headCurrentYaw += (headTargetYaw - state.headCurrentYaw) * 0.28;
    state.headCurrentPitch += (headTargetPitch - state.headCurrentPitch) * 0.28;

    state.headCurrentYaw = Math.max(-0.52, Math.min(0.52, state.headCurrentYaw));
    state.headCurrentPitch = Math.max(-0.38, Math.min(0.38, state.headCurrentPitch));

    const headBaseQuat = state.tempBaseQuat.copy(head.quaternion).multiply(state.tempInvQuat.copy(state.headAppliedQuat).invert());
    const headCursorQuat = state.tempQuat.setFromEuler(state.tempEuler.set(state.headCurrentPitch, state.headCurrentYaw, -state.headCurrentYaw * 0.07));
    head.quaternion.copy(headBaseQuat).multiply(headCursorQuat);
    state.headAppliedQuat.copy(headCursorQuat);
  }

  // Eyes are handled by VRM's built-in lookAt.target - no manual bone manipulation
}

function decayCursorTilt(vrm, character) {
  if (!cursorTiltState[character]) return;
  applyCursorTiltAndShift(vrm, character, 0);

  const state = cursorTiltState[character];
  if (
    state.influence < 0.01 &&
    Math.abs(state.modelAppliedYaw) < 0.001 &&
    Math.abs(state.modelAppliedPitch) < 0.001 &&
    state.chestAppliedQuat.angleTo(IDENTITY_QUATERNION) < 0.001 &&
    state.neckAppliedQuat.angleTo(IDENTITY_QUATERNION) < 0.001 &&
    state.headAppliedQuat.angleTo(IDENTITY_QUATERNION) < 0.001 &&
    (state.leftShoulderAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.001 &&
    (state.rightShoulderAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.001
  ) {
    resetCursorTilt(vrm, character);
  }
}

function getBoneQuaternionWithoutCursorOffset(character, boneName, currentQuaternion) {
  let baseQuaternion = currentQuaternion.clone();
  const ambientState = ambientPresenceState[character];

  if (boneName === 'upperChest' && ambientState) {
    baseQuaternion.multiply(ambientState.chestAppliedQuat.clone().invert());
  }

  if (boneName === 'neck' && ambientState) {
    baseQuaternion.multiply(ambientState.neckAppliedQuat.clone().invert());
  }

  if (boneName === 'leftShoulder' && ambientState) {
    baseQuaternion.multiply((ambientState.leftShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  if (boneName === 'rightShoulder' && ambientState) {
    baseQuaternion.multiply((ambientState.rightShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  if (boneName === 'leftUpperArm' && ambientState) {
    baseQuaternion.multiply((ambientState.leftUpperArmAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  if (boneName === 'rightUpperArm' && ambientState) {
    baseQuaternion.multiply((ambientState.rightUpperArmAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  const state = cursorTiltState[character];
  if (!state) {
    return baseQuaternion;
  }

  if (boneName === 'upperChest') {
    return baseQuaternion.multiply(state.chestAppliedQuat.clone().invert());
  }

  if (boneName === 'neck') {
    return baseQuaternion.multiply(state.neckAppliedQuat.clone().invert());
  }

  if (boneName === 'head') {
    return baseQuaternion.multiply(state.headAppliedQuat.clone().invert());
  }

  if (boneName === 'leftShoulder') {
    return baseQuaternion.multiply((state.leftShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  if (boneName === 'rightShoulder') {
    return baseQuaternion.multiply((state.rightShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  return baseQuaternion;
}

function getCursorAppliedQuaternionForBone(character, boneName) {
  const state = cursorTiltState[character];
  if (!state) {
    return new THREE.Quaternion();
  }

  if (boneName === 'upperChest') {
    return state.chestAppliedQuat.clone();
  }

  if (boneName === 'neck') {
    return state.neckAppliedQuat.clone();
  }

  if (boneName === 'head') {
    return state.headAppliedQuat.clone();
  }

  if (boneName === 'leftShoulder') {
    return state.leftShoulderAppliedQuat.clone();
  }

  if (boneName === 'rightShoulder') {
    return state.rightShoulderAppliedQuat.clone();
  }

  return new THREE.Quaternion();
}

function getAmbientAppliedQuaternionForBone(character, boneName) {
  const state = ambientPresenceState[character];
  if (!state) {
    return new THREE.Quaternion();
  }

  if (boneName === 'upperChest') {
    return state.chestAppliedQuat.clone();
  }

  if (boneName === 'neck') {
    return state.neckAppliedQuat.clone();
  }

  if (boneName === 'leftShoulder') {
    return (state.leftShoulderAppliedQuat || new THREE.Quaternion()).clone();
  }

  if (boneName === 'rightShoulder') {
    return (state.rightShoulderAppliedQuat || new THREE.Quaternion()).clone();
  }

  if (boneName === 'leftUpperArm') {
    return (state.leftUpperArmAppliedQuat || new THREE.Quaternion()).clone();
  }

  if (boneName === 'rightUpperArm') {
    return (state.rightUpperArmAppliedQuat || new THREE.Quaternion()).clone();
  }

  return new THREE.Quaternion();
}

function getCombinedAdditiveQuaternionForBone(character, boneName) {
  const cursorAppliedQuat = getCursorAppliedQuaternionForBone(character, boneName);
  const ambientAppliedQuat = getAmbientAppliedQuaternionForBone(character, boneName);
  return cursorAppliedQuat.multiply(ambientAppliedQuat);
}

function getModelRotationWithoutCursorOffset(character) {
  const objectContainer = current_avatars[character]?.["objectContainer"];
  if (!objectContainer) {
    return null;
  }

  const state = cursorTiltState[character];
  if (!state) {
    return {
      x: objectContainer.rotation.x,
      y: objectContainer.rotation.y,
      z: objectContainer.rotation.z,
    };
  }

  return {
    x: objectContainer.rotation.x - state.modelAppliedPitch,
    y: objectContainer.rotation.y - state.modelAppliedYaw,
    z: objectContainer.rotation.z,
  };
}

function resetCursorTilt(vrm, character) {
  if (!cursorTiltState[character]) return;

  const state = cursorTiltState[character];
  const avatar = current_avatars[character];
  const objectContainer = avatar?.["objectContainer"];

  // Remove additive model offsets and preserve model's own baseline rotation.
  if (objectContainer) {
    objectContainer.rotation.y -= state.modelAppliedYaw;
    objectContainer.rotation.x -= state.modelAppliedPitch;
  }

  // Remove additive chest offset.
  const upperChest = getCachedBone(avatar, "upperChest");
  if (upperChest) {
    upperChest.quaternion.multiply(state.chestAppliedQuat.clone().invert());
  }

  // Remove additive neck offset.
  const neck = getCachedBone(avatar, "neck");
  if (neck) {
    neck.quaternion.multiply(state.neckAppliedQuat.clone().invert());
  }

  // Remove additive head offset.
  const head = getCachedBone(avatar, "head");
  if (head) {
    head.quaternion.multiply(state.headAppliedQuat.clone().invert());
  }

  const leftShoulder = getCachedBone(avatar, "leftShoulder");
  if (leftShoulder) {
    leftShoulder.quaternion.multiply((state.leftShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  const rightShoulder = getCachedBone(avatar, "rightShoulder");
  if (rightShoulder) {
    rightShoulder.quaternion.multiply((state.rightShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  // Always clear state on reset to prevent accumulation
  delete cursorTiltState[character];
}

function resetAmbientPresence(vrm, character) {
  const state = ambientPresenceState[character];
  if (!state) return;

  const avatar = current_avatars[character];
  const objectContainer = avatar?.["objectContainer"];
  if (objectContainer) {
    objectContainer.position.y -= state.modelAppliedY;
  }

  const upperChest = getCachedBone(avatar, "upperChest");
  if (upperChest) {
    upperChest.quaternion.multiply(state.chestAppliedQuat.clone().invert());
  }

  const neck = getCachedBone(avatar, "neck");
  if (neck) {
    neck.quaternion.multiply(state.neckAppliedQuat.clone().invert());
  }

  const leftShoulder = getCachedBone(avatar, "leftShoulder");
  if (leftShoulder) {
    leftShoulder.quaternion.multiply((state.leftShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  const rightShoulder = getCachedBone(avatar, "rightShoulder");
  if (rightShoulder) {
    rightShoulder.quaternion.multiply((state.rightShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  const leftUpperArm = getCachedBone(avatar, "leftUpperArm");
  if (leftUpperArm) {
    leftUpperArm.quaternion.multiply((state.leftUpperArmAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  const rightUpperArm = getCachedBone(avatar, "rightUpperArm");
  if (rightUpperArm) {
    rightUpperArm.quaternion.multiply((state.rightUpperArmAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  delete ambientPresenceState[character];
}

function applyAmbientPresence(vrm, character, deltaTime, inactivityIntensity = 0, controlProfile = null) {
  const avatar = current_avatars[character];
  const objectContainer = avatar?.["objectContainer"];
  const upperChest = getCachedBone(avatar, "upperChest");
  const neck = getCachedBone(avatar, "neck");
  const leftShoulder = getCachedBone(avatar, "leftShoulder");
  const rightShoulder = getCachedBone(avatar, "rightShoulder");
  const leftUpperArm = getCachedBone(avatar, "leftUpperArm");
  const rightUpperArm = getCachedBone(avatar, "rightUpperArm");

  if (!objectContainer || !upperChest || !neck) {
    if (ambientPresenceState[character]) {
      resetAmbientPresence(vrm, character);
    }
    return;
  }

  let state = ambientPresenceState[character];
  if (!state) {
    state = {
      time: Math.random() * 100,
      phase: Math.random() * Math.PI * 2,
      weight: 0,
      microShift: 0,
      microShiftTarget: 0,
      nextMicroShiftAt: 0,
      chestAppliedQuat: new THREE.Quaternion(),
      neckAppliedQuat: new THREE.Quaternion(),
      leftShoulderAppliedQuat: new THREE.Quaternion(),
      rightShoulderAppliedQuat: new THREE.Quaternion(),
      leftUpperArmAppliedQuat: new THREE.Quaternion(),
      rightUpperArmAppliedQuat: new THREE.Quaternion(),
      modelAppliedY: 0
    };
    ambientPresenceState[character] = state;
  }

  state.time += Math.max(0, deltaTime);
  if (state.time >= state.nextMicroShiftAt) {
    state.microShiftTarget = (Math.random() * 2 - 1) * (0.012 + 0.018 * inactivityIntensity);
    state.nextMicroShiftAt = state.time + 3.5 + Math.random() * 4.5;
  }

  const shouldBeActive = extension_settings.vrm.natural_idle && isCharacterInIdleMotion(character);
  const control = controlProfile || getProceduralControlProfile(character);
  const intensityScale = Math.pow(Math.max(0, Math.min(1, inactivityIntensity)), 0.85);
  const targetWeight = shouldBeActive ? intensityScale * control.ambientWeight : 0;
  const weightBlendSpeed = targetWeight > state.weight ? 0.02 : 0.06;
  state.weight += (targetWeight - state.weight) * weightBlendSpeed;
  state.weight = Math.max(0, Math.min(1, state.weight));

  state.microShift += (state.microShiftTarget - state.microShift) * 0.01;

  const breath = Math.sin(state.time * 1.05 + state.phase) * (0.006 + 0.007 * inactivityIntensity) * state.weight;
  const sway = Math.sin(state.time * 0.42 + state.phase * 0.7) * (0.004 + 0.005 * inactivityIntensity) * state.weight;
  const microYaw = state.microShift * state.weight;

  const chestBaseQuat = upperChest.quaternion.clone().multiply(state.chestAppliedQuat.clone().invert());
  const chestAmbientEuler = new THREE.Euler(
    breath + sway * 0.18,
    microYaw * 0.35,
    sway * 0.32
  );
  const chestAmbientQuat = new THREE.Quaternion().setFromEuler(chestAmbientEuler);
  upperChest.quaternion.copy(chestBaseQuat).multiply(chestAmbientQuat);
  state.chestAppliedQuat.copy(chestAmbientQuat);

  const neckBaseQuat = neck.quaternion.clone().multiply(state.neckAppliedQuat.clone().invert());
  const neckAmbientEuler = new THREE.Euler(
    -breath * 0.3,
    microYaw * 0.6,
    -sway * 0.25
  );
  const neckAmbientQuat = new THREE.Quaternion().setFromEuler(neckAmbientEuler);
  neck.quaternion.copy(neckBaseQuat).multiply(neckAmbientQuat);
  state.neckAppliedQuat.copy(neckAmbientQuat);

  if (leftShoulder && rightShoulder && leftUpperArm && rightUpperArm) {
    const shoulderRoll = Math.sin(state.time * 0.76 + state.phase * 0.35) * (0.014 + 0.012 * inactivityIntensity) * state.weight;
    const shoulderYaw = Math.sin(state.time * 0.52 + state.phase * 0.9) * (0.012 + 0.01 * inactivityIntensity) * state.weight;
    const armSwing = Math.sin(state.time * 0.88 + state.phase * 1.2) * (0.02 + 0.015 * inactivityIntensity) * state.weight;

    const leftShoulderBase = leftShoulder.quaternion.clone().multiply((state.leftShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
    const rightShoulderBase = rightShoulder.quaternion.clone().multiply((state.rightShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
    const leftUpperArmBase = leftUpperArm.quaternion.clone().multiply((state.leftUpperArmAppliedQuat || new THREE.Quaternion()).clone().invert());
    const rightUpperArmBase = rightUpperArm.quaternion.clone().multiply((state.rightUpperArmAppliedQuat || new THREE.Quaternion()).clone().invert());

    const leftShoulderQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, shoulderYaw * 0.4, shoulderRoll));
    const rightShoulderQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, shoulderYaw * 0.4, -shoulderRoll));
    const leftUpperArmQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-armSwing, shoulderYaw * 0.25, shoulderRoll * 0.35));
    const rightUpperArmQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-armSwing, -shoulderYaw * 0.25, -shoulderRoll * 0.35));

    leftShoulder.quaternion.copy(leftShoulderBase).multiply(leftShoulderQuat);
    rightShoulder.quaternion.copy(rightShoulderBase).multiply(rightShoulderQuat);
    leftUpperArm.quaternion.copy(leftUpperArmBase).multiply(leftUpperArmQuat);
    rightUpperArm.quaternion.copy(rightUpperArmBase).multiply(rightUpperArmQuat);

    state.leftShoulderAppliedQuat.copy(leftShoulderQuat);
    state.rightShoulderAppliedQuat.copy(rightShoulderQuat);
    state.leftUpperArmAppliedQuat.copy(leftUpperArmQuat);
    state.rightUpperArmAppliedQuat.copy(rightUpperArmQuat);
  }

  const baseY = objectContainer.position.y - state.modelAppliedY;
  const targetY = Math.sin(state.time * 1.05 + state.phase * 0.5) * (0.0035 + 0.0035 * inactivityIntensity) * state.weight;
  state.modelAppliedY += (targetY - state.modelAppliedY) * 0.08;
  objectContainer.position.y = baseY + state.modelAppliedY;

  if (
    !shouldBeActive &&
    state.weight < 0.01 &&
    Math.abs(state.modelAppliedY) < 0.0005 &&
    state.chestAppliedQuat.angleTo(IDENTITY_QUATERNION) < 0.0008 &&
    state.neckAppliedQuat.angleTo(IDENTITY_QUATERNION) < 0.0008 &&
    (state.leftShoulderAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.0008 &&
    (state.rightShoulderAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.0008 &&
    (state.leftUpperArmAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.0008 &&
    (state.rightUpperArmAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.0008
  ) {
    resetAmbientPresence(vrm, character);
  }
}

function resetAmbientExpressionDynamics(character) {
  const state = ambientExpressionState[character];
  const expressionMgr = current_avatars[character]?.["vrm"]?.expressionManager;
  if (state && expressionMgr) {
    for (const expressionName of Object.keys(state.currentAdd || {})) {
      const current = expressionMgr.getValue(expressionName) || 0;
      const additive = state.currentAdd[expressionName] || 0;
      expressionMgr.setValue(expressionName, Math.max(0, current - additive));
    }
  }
  delete ambientExpressionState[character];
}

function resetSelfContactGuard(character, vrm = null) {
  const state = selfContactState[character];
  if (!state) return;

  const avatarVrm = vrm || current_avatars[character]?.vrm;
  if (avatarVrm) {
    for (const [boneName, appliedQuat] of Object.entries(state.applied || {})) {
      const bone = avatarVrm.humanoid?.getNormalizedBoneNode(boneName);
      if (bone && appliedQuat) {
        bone.quaternion.multiply(appliedQuat.clone().invert());
      }
    }
  }

  delete selfContactState[character];
}

function ensureSelfContactState(character) {
  let state = selfContactState[character];
  if (!state) {
    state = {
      leftWeight: 0,
      rightWeight: 0,
      applied: {
        leftUpperArm: new THREE.Quaternion(),
        leftLowerArm: new THREE.Quaternion(),
        rightUpperArm: new THREE.Quaternion(),
        rightLowerArm: new THREE.Quaternion(),
      }
    };
    selfContactState[character] = state;
  }
  return state;
}

function computeContactAvoidanceWeight(point, zones) {
  let strongest = 0;
  const delta = new THREE.Vector3();

  for (const zone of zones) {
    if (!zone.center || !Number.isFinite(zone.radius) || zone.radius <= 0) continue;
    delta.copy(point).sub(zone.center);
    const dist = delta.length();
    if (dist >= zone.radius) continue;
    const penetration = (zone.radius - dist) / zone.radius;
    strongest = Math.max(strongest, penetration * (zone.weight || 1));
  }

  return Math.max(0, Math.min(1, strongest));
}

function applyBoneContactOffset(bone, appliedQuat, targetEuler) {
  if (!bone || !appliedQuat) return;
  const baseQuat = bone.quaternion.clone().multiply(appliedQuat.clone().invert());
  const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
  bone.quaternion.copy(baseQuat).multiply(targetQuat);
  appliedQuat.copy(targetQuat);
}

function getActiveIdleClipName(character) {
  const action = activeIdleAnimations[character];
  if (!action) return '';
  if (typeof action.getClip === 'function') {
    return action.getClip()?.name || '';
  }
  return action._clip?.name || '';
}

function applySelfContactGuard(vrm, character, deltaTime = 0.016, controlProfile = null) {
  const control = controlProfile || getProceduralControlProfile(character);
  if (control.selfContactWeight <= 0.001) {
    resetSelfContactGuard(character, vrm);
    return;
  }

  if (!vrm?.humanoid) {
    resetSelfContactGuard(character, vrm);
    return;
  }

  const leftHand = getHumanoidBoneNode(vrm, 'leftHand');
  const rightHand = getHumanoidBoneNode(vrm, 'rightHand');
  const leftUpperArm = getHumanoidBoneNode(vrm, 'leftUpperArm');
  const rightUpperArm = getHumanoidBoneNode(vrm, 'rightUpperArm');
  const leftLowerArm = getHumanoidBoneNode(vrm, 'leftLowerArm');
  const rightLowerArm = getHumanoidBoneNode(vrm, 'rightLowerArm');
  const upperChest = getHumanoidBoneNode(vrm, 'upperChest') || getHumanoidBoneNode(vrm, 'chest');
  const chest = getHumanoidBoneNode(vrm, 'chest') || upperChest;
  const leftUpperLeg = getHumanoidBoneNode(vrm, 'leftUpperLeg');
  const rightUpperLeg = getHumanoidBoneNode(vrm, 'rightUpperLeg');

  if (!leftHand || !rightHand || !leftUpperArm || !rightUpperArm || !leftLowerArm || !rightLowerArm || !upperChest) {
    resetSelfContactGuard(character, vrm);
    return;
  }

  const state = ensureSelfContactState(character);
  const chestForward = new THREE.Vector3(0, 0, 1).applyQuaternion(upperChest.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(0.055);
  const chestCenter = upperChest.getWorldPosition(new THREE.Vector3()).add(chestForward);
  const chestCenterSecondary = chest ? chest.getWorldPosition(new THREE.Vector3()).add(chestForward.clone().multiplyScalar(0.7)) : chestCenter.clone();
  const leftThighCenter = leftUpperLeg ? leftUpperLeg.getWorldPosition(new THREE.Vector3()) : null;
  const rightThighCenter = rightUpperLeg ? rightUpperLeg.getWorldPosition(new THREE.Vector3()) : null;

  if (leftThighCenter) {
    leftThighCenter.add(new THREE.Vector3(0.015, 0.02, 0.045));
  }
  if (rightThighCenter) {
    rightThighCenter.add(new THREE.Vector3(-0.015, 0.02, 0.045));
  }

  const leftHandPos = leftHand.getWorldPosition(new THREE.Vector3());
  const rightHandPos = rightHand.getWorldPosition(new THREE.Vector3());

  const leftWeightTarget = computeContactAvoidanceWeight(leftHandPos, [
    { center: chestCenter, radius: 0.19, weight: 1.0 },
    { center: chestCenterSecondary, radius: 0.17, weight: 0.9 },
    { center: leftThighCenter, radius: 0.16, weight: 0.85 },
  ]);

  const rightWeightTarget = computeContactAvoidanceWeight(rightHandPos, [
    { center: chestCenter, radius: 0.19, weight: 1.0 },
    { center: chestCenterSecondary, radius: 0.17, weight: 0.9 },
    { center: rightThighCenter, radius: 0.16, weight: 0.85 },
  ]);

  const upRate = 0.24;
  const downRate = 0.16;
  const leftBlend = leftWeightTarget > state.leftWeight ? upRate : downRate;
  const rightBlend = rightWeightTarget > state.rightWeight ? upRate : downRate;
  const dtScale = Math.max(0.45, Math.min(1.75, deltaTime * 60));

  const activationDeadzone = 0.22;
  const maxAvoidanceWeight = 0.5;
  const leftGoal = (leftWeightTarget <= activationDeadzone ? 0 : Math.min(maxAvoidanceWeight, (leftWeightTarget - activationDeadzone) / (1 - activationDeadzone))) * control.selfContactWeight;
  const rightGoal = (rightWeightTarget <= activationDeadzone ? 0 : Math.min(maxAvoidanceWeight, (rightWeightTarget - activationDeadzone) / (1 - activationDeadzone))) * control.selfContactWeight;

  state.leftWeight += (leftGoal - state.leftWeight) * leftBlend * dtScale;
  state.rightWeight += (rightGoal - state.rightWeight) * rightBlend * dtScale;
  state.leftWeight = Math.max(0, Math.min(1, state.leftWeight));
  state.rightWeight = Math.max(0, Math.min(1, state.rightWeight));

  const leftUpperEuler = new THREE.Euler(
    -0.03 * state.leftWeight,
    0.17 * state.leftWeight,
    0.15 * state.leftWeight
  );
  const leftLowerEuler = new THREE.Euler(
    -0.02 * state.leftWeight,
    0.1 * state.leftWeight,
    0.09 * state.leftWeight
  );

  const rightUpperEuler = new THREE.Euler(
    -0.03 * state.rightWeight,
    -0.17 * state.rightWeight,
    -0.15 * state.rightWeight
  );
  const rightLowerEuler = new THREE.Euler(
    -0.02 * state.rightWeight,
    -0.1 * state.rightWeight,
    -0.09 * state.rightWeight
  );

  applyBoneContactOffset(leftUpperArm, state.applied.leftUpperArm, leftUpperEuler);
  applyBoneContactOffset(leftLowerArm, state.applied.leftLowerArm, leftLowerEuler);
  applyBoneContactOffset(rightUpperArm, state.applied.rightUpperArm, rightUpperEuler);
  applyBoneContactOffset(rightLowerArm, state.applied.rightLowerArm, rightLowerEuler);

  if (
    state.leftWeight < 0.005 &&
    state.rightWeight < 0.005 &&
    state.applied.leftUpperArm.angleTo(IDENTITY_QUATERNION) < 0.001 &&
    state.applied.leftLowerArm.angleTo(IDENTITY_QUATERNION) < 0.001 &&
    state.applied.rightUpperArm.angleTo(IDENTITY_QUATERNION) < 0.001 &&
    state.applied.rightLowerArm.angleTo(IDENTITY_QUATERNION) < 0.001
  ) {
    resetSelfContactGuard(character, vrm);
  }
}

function isAmbientExpressionCompatible(character) {
  const baseExpression = current_avatars[character]?.["expression"];
  if (!baseExpression || baseExpression === "none") return true;
  return baseExpression === "neutral" || baseExpression === "relaxed" || baseExpression === "happy";
}

function pickAmbientExpressionMode() {
  const roll = Math.random();
  if (roll < 0.5) return "thoughtful";
  if (roll < 0.82) return "giggly";
  return "bashful";
}

function getAmbientExpressionAdditions(mode, time) {
  if (mode === "thoughtful") {
    return {
      relaxed: 0.09 + Math.sin(time * 0.6) * 0.015,
      surprised: 0.015
    };
  }

  if (mode === "giggly") {
    return {
      happy: 0.15 + Math.sin(time * 2.1) * 0.03,
      relaxed: 0.07
    };
  }

  if (mode === "bashful") {
    return {
      relaxed: 0.11,
      happy: 0.06 + Math.sin(time * 0.9) * 0.01,
      surprised: 0.03
    };
  }

  return {};
}

function applyAmbientExpressionDynamics(character, deltaTime, inactivityIntensity = 0) {
  const avatar = current_avatars[character];
  const expressionMgr = avatar?.["vrm"]?.expressionManager;
  if (!expressionMgr) {
    delete ambientExpressionState[character];
    return;
  }

  const shouldBeActive = extension_settings.vrm.natural_idle &&
    isCharacterInIdleMotion(character) &&
    !isCharacterLipSyncActive(character) &&
    isAmbientExpressionCompatible(character) &&
    inactivityIntensity > 0.12;

  let state = ambientExpressionState[character];
  if (!state) {
    state = {
      time: Math.random() * 100,
      mode: null,
      modeWeight: 0,
      modeUntil: 0,
      nextModeAt: 0,
      currentAdd: {
        happy: 0,
        relaxed: 0,
        surprised: 0
      }
    };
    ambientExpressionState[character] = state;
  }

  state.time += Math.max(0, deltaTime);

  if (shouldBeActive) {
    const triggerChance = (0.04 + 0.08 * inactivityIntensity) * Math.min(1, Math.max(0.2, deltaTime * 60));
    if (!state.mode && state.time >= state.nextModeAt && Math.random() < triggerChance) {
      state.mode = pickAmbientExpressionMode();
      state.modeUntil = state.time + 2.8 + Math.random() * 2.8;
    }
    if (state.mode && state.time >= state.modeUntil) {
      state.mode = null;
      state.nextModeAt = state.time + 7 + Math.random() * 6;
    }
  } else {
    state.mode = null;
  }

  const targetModeWeight = shouldBeActive && state.mode ? Math.max(0, Math.min(1, inactivityIntensity)) : 0;
  const modeBlendSpeed = targetModeWeight > state.modeWeight ? 0.03 : 0.05;
  state.modeWeight += (targetModeWeight - state.modeWeight) * modeBlendSpeed;
  state.modeWeight = Math.max(0, Math.min(1, state.modeWeight));

  const targetAdd = { happy: 0, relaxed: 0, surprised: 0 };
  if (state.mode && state.modeWeight > 0.001) {
    const modeAdd = getAmbientExpressionAdditions(state.mode, state.time);
    for (const key of Object.keys(targetAdd)) {
      targetAdd[key] = Math.max(0, (modeAdd[key] || 0) * state.modeWeight * (0.7 + 0.6 * inactivityIntensity));
    }
  }

  for (const expressionName of Object.keys(targetAdd)) {
    const prevAdd = state.currentAdd[expressionName] || 0;
    const current = expressionMgr.getValue(expressionName) || 0;
    const baseValue = Math.max(0, current - prevAdd);
    const nextAdd = prevAdd + (targetAdd[expressionName] - prevAdd) * 0.08;
    state.currentAdd[expressionName] = Math.max(0, nextAdd);
    expressionMgr.setValue(expressionName, Math.min(1, baseValue + state.currentAdd[expressionName]));
  }

  if (!shouldBeActive && state.modeWeight < 0.01) {
    resetAmbientExpressionDynamics(character);
  }
}

// animate
function syncCharacterCollisionProxies(character, includeHitboxes = false) {
    const avatar = current_avatars[character];
    if (!avatar) {
        return;
    }

    const vrm = avatar["vrm"];
    const objectContainer = avatar["objectContainer"];
    const collider = avatar["collider"];
    const hips = vrm?.humanoid?.getNormalizedBoneNode("hips");

    if (!objectContainer || !collider || !hips) {
        return;
    }

    hips.getWorldPosition(collider.position);
    hips.getWorldQuaternion(collider.quaternion);
    collider.scale.copy(objectContainer.scale);

    if (!includeHitboxes) {
        return;
    }

    for (const body_part in avatar["hitboxes"]) {
        const bone = vrm.humanoid?.getNormalizedBoneNode(HITBOXES[body_part]["bone"]);
        if (bone !== null) {
            const hitboxContainer = avatar["hitboxes"][body_part]["offsetContainer"];
            bone.getWorldPosition(hitboxContainer.position);
            bone.getWorldQuaternion(hitboxContainer.quaternion);
            hitboxContainer.scale.copy(objectContainer.scale);
        }
    }
}

function animate() {
    requestAnimationFrame( animate );
    if (renderer !== undefined && scene !== undefined && camera !== undefined) {
        const deltaTime = clock.getDelta();
        const nowMs = Date.now();

        if (isAnyCharacterSpeaking(nowMs) && nowMs - lastSpeechActivityPingAt > 250) {
            markUserActivity("speech");
            lastSpeechActivityPingAt = nowMs;
        }
        const inactivityIntensity = updateInactivityIntensity(deltaTime);

        if (cursorTrackingEnabled) {
            updateCursorTracking();
        }

        for(const character in current_avatars) {
            const vrm = current_avatars[character]["vrm"];
            const mixer = current_avatars[character]["animation_mixer"];
            const lookAtState = getLookAtStateForCharacter(character);
            const proceduralControl = getProceduralControlProfile(character);
            
            // Set lookAt target before VRM update
            vrm.lookAt.target = lookAtState.target;

            vrm.update( deltaTime );
            mixer.update( deltaTime );
            
            // Apply cursor tracking AFTER mixer update so it adds on top of animations
            if (cursorTrackingEnabled && extension_settings.vrm.follow_cursor) {
                const cursorBodyWeight = getCursorBodyFollowWeight(character, inactivityIntensity);
                applyCursorTiltAndShift(vrm, character, lookAtState.cursorInfluence * cursorBodyWeight, proceduralControl);
            } else {
                decayCursorTilt(vrm, character);
            }

            applyAmbientPresence(vrm, character, deltaTime, inactivityIntensity, proceduralControl);
            applyAmbientExpressionDynamics(character, deltaTime, inactivityIntensity);
            applySelfContactGuard(vrm, character, deltaTime, proceduralControl);
            updateTextTalkMouth(character, vrm, nowMs);
            if (realtimeLipSyncActive && realtimeLipSyncCharacter === character) {
                updateRealtimeLipSync(nowMs);
            }

            const shouldSyncCollisionProxies = extension_settings.vrm.show_grid;
            if (shouldSyncCollisionProxies) {
                syncCharacterCollisionProxies(character, extension_settings.vrm.hitboxes);
            }

            const avatar = current_avatars[character];
            if (avatar._gridVisible !== shouldSyncCollisionProxies) {
                avatar["collider"].visible = shouldSyncCollisionProxies;
                for (const body_part in avatar["hitboxes"]) {
                    avatar["hitboxes"][body_part]["offsetContainer"].visible = shouldSyncCollisionProxies;
                }
                avatar._gridVisible = shouldSyncCollisionProxies;
            }

            if (avatar.phoneProp?.visible) {
                updatePhonePropTransform(character);
            }
        }
        // Show/hide helper grid
        if (lastAppliedGridVisible !== extension_settings.vrm.show_grid) {
            gridHelper.visible = extension_settings.vrm.show_grid;
            axesHelper.visible = extension_settings.vrm.show_grid;
            lastAppliedGridVisible = extension_settings.vrm.show_grid;
        }

        renderer.render( scene, camera );
    }
}

animate();

async function loadScene() {
    for (const character of Object.keys(current_avatars)) {
        await unloadModel(character);
    }

    if (renderer) {
        renderer.dispose();
        if (typeof renderer.forceContextLoss === 'function') {
            renderer.forceContextLoss();
        }
    }

    clock = new THREE.Clock();
    current_avatars = {};
    models_cache = {};
    animations_cache = {};
    for (const character in socialLookState) {
        delete socialLookState[character];
    }
    for (const character in cursorBodyFollowState) {
        delete cursorBodyFollowState[character];
    }
    for (const character in ambientPresenceState) {
        delete ambientPresenceState[character];
    }
    for (const character in ambientExpressionState) {
        delete ambientExpressionState[character];
    }
    for (const character in selfContactState) {
        delete selfContactState[character];
    }
    const instanceId = currentInstanceId + 1;
    currentInstanceId = instanceId;

    // Delete the canvas
    if (document.getElementById(VRM_CANVAS_ID) !== null) {
        document.getElementById(VRM_CANVAS_ID).remove();
        // Hide sprite divs
    }
    
    $('#' + SPRITE_DIV).addClass('vrm-hidden');
    $('#' + VN_MODE_DIV).addClass('vrm-hidden');

    if (!extension_settings.vrm.enabled) {
        $('#' + SPRITE_DIV).removeClass('vrm-hidden');
        $('#' + VN_MODE_DIV).removeClass('vrm-hidden');
        return
    }

    clock.start();

    // renderer
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias : true });
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setPixelRatio( Math.min(window.devicePixelRatio || 1, 1.5) );
    renderer.domElement.id = VRM_CANVAS_ID;
    document.body.appendChild( renderer.domElement );

    // camera
    camera = new THREE.PerspectiveCamera( 50.0, window.innerWidth / window.innerHeight, 0.1, 100.0 );
    //const camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 1, 1000 );
    camera.position.set( 0.0, 1.0, 5.0 );

    // camera controls
    //const controls = new OrbitControls( camera, renderer.domElement );
    //controls.screenSpacePanning = true;
    //controls.target.set( 0.0, 1.0, 0.0 );
    //controls.update();

    // scene
    scene = new THREE.Scene();
    
    // Grid debuging helpers
    scene.add( gridHelper );
    scene.add( axesHelper );
    gridHelper.visible = extension_settings.vrm.show_grid;
    axesHelper.visible = extension_settings.vrm.show_grid;

    // light
    light = new THREE.DirectionalLight();
    light.position.set( 1.0, 1.0, 1.0 ).normalize();
    setLight(extension_settings.vrm.light_color, extension_settings.vrm.light_intensity);
    scene.add( light );

    // lookat target
    camera.add( lookAtTarget );
    camera.add( cursorTarget );
    camera.add( blendedTarget );

    //current_characters = currentChatMembers();
    //await loadAllModels(current_characters);

    //console.debug(DEBUG_PREFIX,"DEBUG",renderer);
}

async function loadAllModels(current_characters) {
    const desiredModels = new Map();

    if (extension_settings.vrm.enabled) {
        for (const character of current_characters) {
            const model_path = extension_settings.vrm.character_model_mapping[character];
            if (model_path !== undefined && model_path !== 'none') {
                desiredModels.set(character, model_path);
            }
        }
    }

    for (const [character, avatar] of Object.entries(current_avatars)) {
        const desiredPath = desiredModels.get(character);
        if (!desiredPath || avatar.model_path !== desiredPath) {
            await unloadModel(character);
        }
    }

    if (!extension_settings.vrm.enabled) {
        return;
    }

    for (const [character, model_path] of desiredModels.entries()) {
        if (current_avatars[character] === undefined) {
            await setModel(character, model_path);
        }
    }
}

async function setModel(character,model_path) {
    let model;
    // Model is cached
    if (models_cache[model_path] !== undefined) {
        model = models_cache[model_path];
        await initModel(model);
    }
    else {
        model = await loadModel(model_path);
    }

    await unloadModel(character);

    // Error occured
    if (model === null) {
        extension_settings.vrm.character_model_mapping[character] = undefined;
        return;
    }

    // Set as character model and start animations
    modelId++;
    current_avatars[character] = model;
    current_avatars[character]["id"] = modelId;
    current_avatars[character]["objectContainer"].name = VRM_CONTAINER_NAME+"_"+character;
    current_avatars[character]["collider"].name = VRM_COLLIDER_NAME+"_"+character;

    // Load default expression/motion
    const expression = extension_settings.vrm.model_settings[model_path]['animation_default']['expression'];
    const motion =  extension_settings.vrm.model_settings[model_path]['animation_default']['motion'];

    if (expression !== undefined && expression != "none") {
        console.debug(DEBUG_PREFIX,"Set default expression to",expression);
        await setExpression(character, expression);
    }
    if (motion !== undefined && motion != "none") {
        console.debug(DEBUG_PREFIX,"Set default motion to",motion);
        await setMotion(character, motion, true);
    }

    if (extension_settings.vrm.blink)
        blink(character, modelId);
    textTalk(character, modelId);
    markUserActivity("model-load");
    suspendNaturalIdle(character, 2500);
    scheduleNaturalIdleCheck(character, modelId, 2500, "model-load");
    current_avatars[character]["objectContainer"].visible = true;
    current_avatars[character]["collider"].visible = extension_settings.vrm.show_grid;
    
    scene.add(current_avatars[character]["objectContainer"]);
    scene.add(current_avatars[character]["collider"]);
    for(const hitbox in current_avatars[character]["hitboxes"])
        scene.add(current_avatars[character]["hitboxes"][hitbox]["offsetContainer"]);

    triggerLoadGreetingMotion(character, model_path, modelId);
}

async function unloadModel(character) {
    // unload existing model
    if (current_avatars[character] !== undefined) {
        console.debug(DEBUG_PREFIX,"Unloading avatar of",character);
        const container = current_avatars[character]["objectContainer"];
        const collider = current_avatars[character]["collider"];
        const phoneProp = current_avatars[character]["phoneProp"];

        scene.remove(scene.getObjectByName(container.name));
        scene.remove(scene.getObjectByName(collider.name));
        if (phoneProp) {
            if (phoneProp.parent) {
                phoneProp.parent.remove(phoneProp);
            }
            if (!extension_settings.vrm.models_cache) {
                disposePhonePropObject(phoneProp);
            }
        }
        for(const hitbox in current_avatars[character]["hitboxes"]) {
            console.debug(DEBUG_PREFIX,"REMOVING",current_avatars[character]["hitboxes"][hitbox]["offsetContainer"])
            scene.remove(scene.getObjectByName(current_avatars[character]["hitboxes"][hitbox]["offsetContainer"].name));
        }

        // unload animations
        current_avatars[character]["animation_mixer"].stopAllAction();
        if (current_avatars[character]["motion"]["animation"]  !== null) {
            current_avatars[character]["motion"]["animation"].stop();
            current_avatars[character]["motion"]["animation"].terminated = true;
            current_avatars[character]["motion"]["animation"] = null;
        }

        clearNaturalIdleTimer(character);

    clearAnimationSequence(character);
    clearAnimationManagerTimeouts(character);
    clearAllManagedCharacterTimers(character);

    if (activeNaturalMovements[character]) {
        delete activeNaturalMovements[character];
    }
    
  // Clear idle animation for this character
  if (activeIdleAnimations[character]) {
    if (activeIdleAnimations[character].isRunning && activeIdleAnimations[character].fadeOut) {
      activeIdleAnimations[character].fadeOut(ANIMATION_FADE_TIME);
    }
    if (activeIdleAnimations[character].stop) {
      activeIdleAnimations[character].stop();
    }
    delete activeIdleAnimations[character];
  }

  restoreIdleBasePoses(character, current_avatars[character]["vrm"], { immediate: true });

  // Clear VRMA base poses for this character
  if (vrmaBoneBasePoses[character]) {
    delete vrmaBoneBasePoses[character];
  }

  // Clear VRMA base Y position for this character
  if (vrmaBaseYPosition[character]) {
    delete vrmaBaseYPosition[character];
  }

  // Clear idle completion time for this character
  if (lastIdleCompletionTime[character]) {
    delete lastIdleCompletionTime[character];
  }

  if (nextIdleEligibleTime[character]) {
    delete nextIdleEligibleTime[character];
  }

  if (proceduralState[character]) {
    delete proceduralState[character];
  }

  if (socialLookState[character]) {
    delete socialLookState[character];
  }

  if (cursorBodyFollowState[character] !== undefined) {
    delete cursorBodyFollowState[character];
  }

  if (audioLipSyncCharacter === character) {
    audioLipSyncCharacter = null;
  }

  if (realtimeLipSyncCharacter === character) {
    stopRealtimeLipSync();
  }

  if (expressionBlendJobs[character]) {
    delete expressionBlendJobs[character];
  }

  if (idlePoseBlendJobs[character]) {
    delete idlePoseBlendJobs[character];
  }

  if (modelRotationJobs[character]) {
    delete modelRotationJobs[character];
  }

  if (cursorTiltState[character]) {
    resetCursorTilt(current_avatars[character]["vrm"], character);
  }

  if (ambientPresenceState[character]) {
    resetAmbientPresence(current_avatars[character]["vrm"], character);
  }

  if (ambientExpressionState[character]) {
    resetAmbientExpressionDynamics(character);
  }

  if (selfContactState[character]) {
    resetSelfContactGuard(character, current_avatars[character]["vrm"]);
  }

  if (animationManagerState[character]) {
    delete animationManagerState[character];
  }

  delete current_avatars[character];

        container.visible = false;
        collider.visible = false;
        if (!extension_settings.vrm.models_cache) {
            await container.traverse(obj => obj.dispose?.());
            await collider.traverse(obj => obj.dispose?.());
        }
    }
}

async function loadModel(model_path) { // Only cache the model if character=null
    // gltf and vrm
    const loader = new GLTFLoader();
    loader.crossOrigin = 'anonymous';

    loader.register( ( parser ) => {
        return new VRMLoaderPlugin( parser );
    } );

    let gltf;
    try {
        gltf = await loader.loadAsync(model_path,
            // called after loaded
            () => {
            },
            // called while loading is progressing
            ( progress ) => {
                const percent = Math.round(100.0 * ( progress.loaded / progress.total ));
                $("#vrm_model_loading_percent").text(percent);
            },
            // called when loading has errors
            ( error ) => {
                console.debug(DEBUG_PREFIX,"Error when loading",model_path,":",error)
                toastr.error('Wrong avatar file:'+model_path, DEBUG_PREFIX + ' cannot load', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
                return;
            }
        );
    }
    catch (error) {
        console.debug(DEBUG_PREFIX,"Error when loading",model_path,":",error)
        toastr.error('Wrong avatar file:'+model_path, DEBUG_PREFIX + ' cannot load', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
        return null;
    }

    const vrm = gltf.userData.vrm;
    const vrmHipsY = vrm.humanoid?.getNormalizedBoneNode( 'hips' ).position.y;
    const vrmRootY = vrm.scene.position.y;
    const hipsHeight = Math.abs( vrmHipsY - vrmRootY ); // Used for offset center rotation and animation scaling

    // calling these functions greatly improves the performance
    VRMUtils.removeUnnecessaryVertices( gltf.scene );
    VRMUtils.removeUnnecessaryJoints( gltf.scene );

    // Disable frustum culling
    vrm.scene.traverse( ( obj ) => {
        obj.frustumCulled = false;
    } );

    // un-T-pose
    vrm.springBoneManager.reset();
    applySpringBoneAntiClipPatch(vrm, hipsHeight);
    if (vrm.meta?.metaVersion === '1') {
        vrm.humanoid.getNormalizedBoneNode("rightUpperArm").rotation.z = -250;
        vrm.humanoid.getNormalizedBoneNode("rightLowerArm").rotation.z = 0.2;
        vrm.humanoid.getNormalizedBoneNode("leftUpperArm").rotation.z = 250;
        vrm.humanoid.getNormalizedBoneNode("leftLowerArm").rotation.z = -0.2;
    }
    else {
        vrm.humanoid.getNormalizedBoneNode("rightUpperArm").rotation.z = 250;
        vrm.humanoid.getNormalizedBoneNode("rightLowerArm").rotation.z = -0.2;
        vrm.humanoid.getNormalizedBoneNode("leftUpperArm").rotation.z = -250;
        vrm.humanoid.getNormalizedBoneNode("leftLowerArm").rotation.z = 0.2;
    }

    // Add vrm to scene
    VRMUtils.rotateVRM0(vrm); // rotate if the VRM is VRM0.0
    const scale = extension_settings.vrm.model_settings[model_path]["scale"];
    // Create a group to set model center as rotation/scaling origin
    const object_container = new THREE.Group(); // First container to scale/position center model
    object_container.visible = false;
    object_container.name = VRM_CONTAINER_NAME;
    object_container.model_path = model_path; // link to character for mouse controls
    object_container.scale.set(scale,scale,scale);
    object_container.position.y = 0.5; // offset to center model
    const verticalOffset = new THREE.Group(); // Second container to rotate center model
    verticalOffset.position.y = -hipsHeight; // offset model for rotate on "center"
    verticalOffset.add(vrm.scene)
    object_container.add(verticalOffset);
    //object_container.parent = scene;
    
    // Collider used to detect mouse click
    const boundingBox = new THREE.Box3(new THREE.Vector3(-0.5,-1.0,-0.5), new THREE.Vector3(0.5,1.0,0.5));
    const dimensions = new THREE.Vector3().subVectors( boundingBox.max, boundingBox.min );
    // make a BoxGeometry of the same size as Box3
    const boxGeo = new THREE.BoxGeometry(dimensions.x, dimensions.y, dimensions.z);
    // move new mesh center so it's aligned with the original object
    const matrix = new THREE.Matrix4().setPosition(dimensions.addVectors(boundingBox.min, boundingBox.max).multiplyScalar( 0.5 ));
    boxGeo.applyMatrix4(matrix);
    // make a mesh
    const collider = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({
        visible: true,
        side: THREE.BackSide,
        wireframe: true,
        color:0xffff00
    }));
    collider.name = VRM_COLLIDER_NAME;
    collider.material.side = THREE.BackSide;
    //scene.add(collider);
    
    // Avatar dynamic settings
    const proceduralCalibration = buildProceduralRigCalibration(vrm, hipsHeight);
    const model = {
        "id": null,
        "model_path": model_path,
        "vrm": vrm, // the actual vrm object
        "hipsHeight": hipsHeight, // its original hips height, used for scaling loaded animation
        "proceduralCalibration": proceduralCalibration,
        "bones": buildAvatarBoneCache(vrm),
        "expressions": buildAvatarExpressionCache(vrm),
        "objectContainer": object_container, // the actual 3d group containing the vrm scene, handle centered position/rotation/scaling
        "collider": collider,
        "expression": "none",
        "animation_mixer": new THREE.AnimationMixer(vrm.scene),
        "motion": {
            "name": "none",
            "animation": null
        },
        "phoneProp": null,
        "phonePropBone": null,
        "phonePropSide": "right",
        "talkEnd": 0,
        "hitboxes": {}
    };

    // Hit boxes
    if (extension_settings.vrm.hitboxes) {
        for(const body_part in HITBOXES)
        {
            const bone = vrm.humanoid.getNormalizedBoneNode(HITBOXES[body_part]["bone"])
            if (bone !== null) {
                const position = new THREE.Vector3();
                position.setFromMatrixPosition(bone.matrixWorld);
                console.debug(DEBUG_PREFIX,"Creating hitbox for",body_part,"at",position);

                const size = HITBOXES[body_part]["size"];
                const offset = HITBOXES[body_part]["offset"];

                // Collider used to detect mouse click
                const boundingBox = new THREE.Box3(new THREE.Vector3(-size.x,-size.y,-size.z), new THREE.Vector3(size.x,size.y,size.z));
                const dimensions = new THREE.Vector3().subVectors( boundingBox.max, boundingBox.min );
                // make a BoxGeometry of the same size as Box3
                const boxGeo = new THREE.BoxGeometry(dimensions.x, dimensions.y, dimensions.z);
                // move new mesh center so it's aligned with the original object
                const matrix = new THREE.Matrix4().setPosition(dimensions.addVectors(boundingBox.min, boundingBox.max).multiplyScalar( 0.5 ));
                boxGeo.applyMatrix4(matrix);
                // make a mesh
                const collider = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({
                    visible: true,
                    side: THREE.BackSide,
                    wireframe: true,
                    color:HITBOXES[body_part]["color"]
                }));
                collider.name = body_part;
                if (vrm.meta?.metaVersion === '1')
                    collider.position.set(offset.x/hipsHeight,offset.y/hipsHeight,-offset.z/hipsHeight);
                else
                    collider.position.set(-offset.x/hipsHeight,offset.y/hipsHeight,offset.z/hipsHeight);
                // Create a offset container
                const offset_container = new THREE.Group(); // First container to scale/position center model
                offset_container.name = model_path+"_offsetContainer_hitbox_"+body_part;
                offset_container.visible = true;
                offset_container.add(collider);
                //scene.add(offset_container)

                //object_container.localToWorld(position);
                //position.add(new THREE.Vector3(offset.x,offset.y,offset.z));
                //collider.position.set(position.x,position.y,position.z);
                //scene.add(collider);

                model["hitboxes"][body_part] = {
                    "offsetContainer":offset_container,
                    "collider":collider
                }
            }
        }
    }

    //console.debug(DEBUG_PREFIX,vrm);

    // Cache model
    if (extension_settings.vrm.models_cache)
        models_cache[model_path] = model;

    await initModel(model);
    
    return model;
}

async function initModel(model) {
  const object_container = model["objectContainer"];
  const model_path = model["model_path"];

  object_container.scale.x = extension_settings.vrm.model_settings[model_path]['scale'];
  object_container.scale.y = extension_settings.vrm.model_settings[model_path]['scale'];
  object_container.scale.z = extension_settings.vrm.model_settings[model_path]['scale'];

  object_container.position.x = extension_settings.vrm.model_settings[model_path]['x'];
  object_container.position.y = extension_settings.vrm.model_settings[model_path]['y'];
  object_container.position.z = 0.0;

  object_container.rotation.x = extension_settings.vrm.model_settings[model_path]['rx'];
  object_container.rotation.y = extension_settings.vrm.model_settings[model_path]['ry'];
  object_container.rotation.z = 0.0;

  // Cache model animations
    if (extension_settings.vrm.animations_cache && animations_cache[model_path] === undefined) {
        animations_cache[model_path] = {};
        const animation_names = [extension_settings.vrm.model_settings[model_path]['animation_default']['motion']]
        for (const i in extension_settings.vrm.model_settings[model_path]['classify_mapping']) {
            animation_names.push(extension_settings.vrm.model_settings[model_path]['classify_mapping'][i]["motion"]);
        }

        let count = 0;
        for (const file of animations_files) {
            count++;
            for (const i of animation_names) {
                if(file.includes(i) && animations_cache[model_path][file] === undefined) {
                    const clip = await loadAnimation(model["vrm"], model["hipsHeight"], file);
                    if (clip !== undefined)
                        animations_cache[model_path][file] = clip;
                }
            }
        }
    }
}

async function setExpression(character, value) {
    if (current_avatars[character] === undefined) {
        console.debug(DEBUG_PREFIX,"WARNING requested setExpression of character without vrm loaded:",character,"(loaded",current_avatars,")");
        return;
    }

    const vrm = current_avatars[character]["vrm"];
    const current_expression = current_avatars[character]["expression"];

    if (value == "none")
        value = "neutral";

    if (current_expression === value) {
        return;
    }

    console.debug(DEBUG_PREFIX,"Switch expression of",character,"from",current_expression,"to",value);

    const expressionManager = vrm.expressionManager;
    if (!expressionManager || !expressionManager.expressionMap) {
        return;
    }

    const expressionMap = expressionManager.expressionMap;
    const previousBlendShapeMapping = getBlendShapeMapping(character, current_expression);
    const blendShapeMapping = getBlendShapeMapping(character, value);

    if (blendShapeMapping && blendShapeMapping.blendShapes) {
        // Switching into a custom blend shape group can touch many channels.
        // Reset once to guarantee clean state.
        resetAllBlendShapes(vrm);

        const intensity = blendShapeMapping.intensity || 1.0;
        applyCustomBlendShapeGroup(character, vrm, value, intensity);
        current_avatars[character]["expression"] = value;
    } else {
        if (expressionMap[value] === undefined) {
            console.debug(DEBUG_PREFIX, 'Expression not found:', value);
            value = "neutral";
        }

        if (previousBlendShapeMapping && previousBlendShapeMapping.blendShapes) {
            // Switching away from a custom blend shape group: clear stale channels.
            resetAllBlendShapes(vrm);
        } else if (current_expression && current_expression !== value && expressionMap[current_expression] !== undefined) {
            expressionManager.setValue(current_expression, 0.0);
            if (current_expression === 'blinkLeft' || current_expression === 'blinkRight') {
                expressionManager.setValue('blinkLeft', 0.0);
                expressionManager.setValue('blinkRight', 0.0);
                expressionManager.setValue('blink', 0.0);
            }
        }

        setExpressionValueWithWinkSupport(expressionManager, value, 1.0);
        current_avatars[character]["expression"] = value;
    }
}

function isCharacterLipSyncActive(character) {
  if (!extension_settings.vrm.tts_lips_sync) return false;
  if (realtimeLipSyncActive && realtimeLipSyncCharacter === character) return true;
  return audioLipSyncCharacter === character;
}

function isAnyCharacterSpeaking(nowMs = Date.now()) {
  for (const character of Object.keys(current_avatars)) {
    const talkEnd = current_avatars[character]?.talkEnd || 0;
    if (talkEnd > nowMs) {
      return true;
    }
    if (isCharacterLipSyncActive(character)) {
      return true;
    }
  }
  return false;
}

async function blendToExpression(character, targetExpression, durationMs = 220, preserveVisemes = null) {
  const avatar = current_avatars[character];
  const expressionMgr = avatar?.vrm?.expressionManager;
  if (!expressionMgr) return;

  const jobId = (expressionBlendJobs[character] || 0) + 1;
  expressionBlendJobs[character] = jobId;

  const expressionNames = avatar.expressions?.names || Object.keys(expressionMgr.expressionMap || {});
  const startValues = {};
  for (const name of expressionNames) {
    startValues[name] = expressionMgr.getValue(name) || 0;
  }

  await setExpression(character, targetExpression);

  if (current_avatars[character] === undefined || expressionBlendJobs[character] !== jobId) {
    return;
  }

  const targetValues = {};
  for (const name of expressionNames) {
    targetValues[name] = expressionMgr.getValue(name) || 0;
    expressionMgr.setValue(name, startValues[name]);
  }

  const startTime = performance.now();

  const step = () => {
    if (current_avatars[character] === undefined || expressionBlendJobs[character] !== jobId) {
      return;
    }

    const elapsed = performance.now() - startTime;
    const progress = Math.min(1, elapsed / Math.max(1, durationMs));
    const eased = easeInOutCubic(progress);
    const preserveLipSync = isCharacterLipSyncActive(character);
    const preserveBlink = !!current_avatars[character]?.winking || !!current_avatars[character]?.customWinking;

    for (const name of expressionNames) {
      if ((preserveLipSync && VRM_VISEME_SET.has(name)) || (preserveBlink && VRM_BLINK_SET.has(name))) {
        continue;
      }
      const from = startValues[name] || 0;
      const to = targetValues[name] || 0;
      setExpressionIfChanged(expressionMgr, name, from + (to - from) * eased);
    }

    if (preserveVisemes) {
      for (const [visemeName, visemeValue] of Object.entries(preserveVisemes)) {
        setExpressionIfChanged(expressionMgr, visemeName, visemeValue);
      }
    }

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };

  requestAnimationFrame(step);
}

async function restoreExpressionState(character, expressionName) {
  if (current_avatars[character] === undefined) return;

  const targetExpression = expressionName && expressionName !== "none"
    ? expressionName
    : (current_avatars[character]["expression"] || "neutral");

  const expressionMgr = current_avatars[character]["vrm"]?.expressionManager;
  const preserveLipSync = isCharacterLipSyncActive(character) && expressionMgr;
  const visemeNames = ['aa', 'ee', 'ih', 'oh', 'ou'];
  const visemeValues = {};

  if (preserveLipSync) {
    for (const visemeName of visemeNames) {
      visemeValues[visemeName] = expressionMgr.getValue(visemeName) || 0;
    }
  }

  await blendToExpression(character, targetExpression, 240, preserveLipSync ? visemeValues : null);
}

async function loadAnimation(vrm, hipsHeight, motion_file_path) {
    let clip;
    try {
        // Mixamo animation
        if (motion_file_path.endsWith(".fbx")) {
            clip = await loadMixamoAnimation(motion_file_path, vrm, hipsHeight);
        }
        else if (motion_file_path.endsWith(".bvh")) {
            clip = await loadBVHAnimation(motion_file_path, vrm, hipsHeight);
        }
        else if (motion_file_path.endsWith(".vmd")) {
            // MMD motion file
            clip = await loadMMDAnimation(motion_file_path, vrm, hipsHeight);
        }
        else if (motion_file_path.endsWith(".vrma")) {
            // VRMA (VRM Animation) file
            const vrmaLoader = new VRMALoader();
            const result = await vrmaLoader.loadAsync(motion_file_path, vrm);
            clip = result ? result.clip : null;
        }
        else {
            toastr.error('Wrong animation file format:' + motion_file_path, DEBUG_PREFIX + ' cannot play animation', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
            return null;
        }

        if (!clip) {
            toastr.error('Wrong animation file format:' + motion_file_path, DEBUG_PREFIX + ' cannot play animation', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
            return null;
        }
    }
    catch (error) {
        toastr.error('Wrong animation file format:' + motion_file_path, DEBUG_PREFIX + ' cannot play animation', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
        return null;
    }
    return clip;
}

async function setMotion(character, motion_file_path, loop=false, force=false, random=true, options = {} ) {
    if (current_avatars[character] === undefined) {
        console.debug(DEBUG_PREFIX,"WARNING requested setMotion of character without vrm loaded:",character,"(loaded",current_avatars,")");
        return;
    }
    const model_path = extension_settings.vrm.character_model_mapping[character];
    const vrm = current_avatars[character]["vrm"];
    const hipsHeight = current_avatars[character]["hipsHeight"];
    const defaultMotion = extension_settings.vrm.model_settings?.[model_path]?.["animation_default"]?.["motion"];

    // IMPORTANT: mixer might be undefined / invalid depending on load order or prior errors.
    let mixer = current_avatars[character]["animation_mixer"];

    const current_motion_name = current_avatars[character]["motion"]["name"];
    const current_motion_animation= current_avatars[character]["motion"]["animation"];
    let clip = undefined;

    console.debug(DEBUG_PREFIX,"Switch motion for",character,"from",current_motion_name,"to",motion_file_path,"loop=",loop,"force=",force,"random=",random);

    // Ensure VRM is actually present
    if (!vrm || !vrm.scene) {
        console.debug(DEBUG_PREFIX,"WARNING setMotion called but VRM/vrm.scene missing for character:",character,vrm);
        return;
    }

    // Ensure AnimationMixer exists and has a valid root
    // (The error you saw happens when mixer root is undefined and clipAction reads root.uuid.)
    if (!mixer || typeof mixer.clipAction !== 'function') {
        mixer = new THREE.AnimationMixer(vrm.scene);
        current_avatars[character]["animation_mixer"] = mixer;
        console.debug(DEBUG_PREFIX,"Created new AnimationMixer for",character);
    } else {
        // Some builds of three keep the root on _root; if it’s missing, recreate safely.
        // This is a pragmatic guard against mixer being created with an undefined root.
        if (!mixer._root) {
            mixer = new THREE.AnimationMixer(vrm.scene);
            current_avatars[character]["animation_mixer"] = mixer;
            console.debug(DEBUG_PREFIX,"Recreated AnimationMixer due to missing root for",character);
        }
    }

    // Disable current animation
    if (motion_file_path == "none") {
        if (current_motion_animation !== null) {
            current_motion_animation.fadeOut(ANIMATION_FADE_TIME);
            current_motion_animation.terminated = true;
        }
        current_avatars[character]["motion"]["name"] = "none";
        current_avatars[character]["motion"]["animation"] = null;
        return;
    }

    // Resolve known animation path first
    motion_file_path = resolveAnimationPath(motion_file_path);
    if (!motion_file_path) {
      console.warn(DEBUG_PREFIX, "Animation path could not be resolved for", character);
      return;
    }
    motion_file_path = ensureAnimationFileExtension(motion_file_path);

    // Pick random animationX
    const filename = motion_file_path.replace(/\.[^/.]+$/, "").replace(/\d+$/, "").toLowerCase();
    if (random) {
        let same_motion = []
        for(const i of animations_files) {
            const candidate = String(i || '').replace(/\.[^/.]+$/, "").replace(/\d+$/, "").toLowerCase().replaceAll('\\', '/');
            const normalizedFilename = filename.replaceAll('\\', '/');
            if (candidate === normalizedFilename || candidate.endsWith('/' + normalizedFilename)) {
              same_motion.push(i)
            }
        }
        if (same_motion.length > 0) {
          motion_file_path = same_motion[Math.floor(Math.random() * same_motion.length)];
          console.debug(DEBUG_PREFIX,"Picked a random animation among",same_motion,":",motion_file_path);
        } else {
          console.debug(DEBUG_PREFIX,"No random variants found for",filename,"using",motion_file_path);
        }
    }

  // new animation
  if (current_motion_name != motion_file_path || loop || force) {
    const targetIsIdleMotion = isIdleMotionName(motion_file_path, defaultMotion);

    if (!targetIsIdleMotion) {
      suspendNaturalIdle(character, 1800);
      clearNaturalIdleTimer(character);
    }

    // Clear any natural idle timer to prevent it from interrupting the new animation
    clearNaturalIdleTimer(character);
    console.debug(DEBUG_PREFIX,"Cleared natural idle timer for hitbox animation");
    
    // Also fade out any current idle animation
    if (activeIdleAnimations[character]) {
      stopProceduralIdleForCharacter(character, vrm);
      console.debug(DEBUG_PREFIX,"Faded out idle animation for hitbox animation");
    }

    if (animations_cache[model_path] !== undefined && animations_cache[model_path][motion_file_path] !== undefined) {
      clip = animations_cache[model_path][motion_file_path];
    }
    else {
      clip = await loadAnimation(vrm, hipsHeight, motion_file_path);

      if (clip === null) {
        return;
      }

      if (extension_settings.vrm.animations_cache)
        animations_cache[model_path][motion_file_path] = clip;
    }

    // Guard: loadAnimation should return an AnimationClip, but be defensive
    if (!clip || typeof clip.duration !== 'number') {
      console.debug(DEBUG_PREFIX,"WARNING loadAnimation did not return a valid AnimationClip for",motion_file_path,clip);
      return;
    }

    // create AnimationAction for VRM
    const new_motion_animation = mixer.clipAction( clip );

    // Fade out current animation
    if ( current_motion_animation !== null ) {
      current_motion_animation.fadeOut( ANIMATION_FADE_TIME );
      current_motion_animation.terminated = true;
      console.debug(DEBUG_PREFIX,"Fade out previous animation");
    }

        // Fade in new animation
        new_motion_animation
            .reset()
            .setEffectiveTimeScale( 1 )
            .setEffectiveWeight( 1 )
            .fadeIn( ANIMATION_FADE_TIME )
            .play();
        new_motion_animation.terminated = false;
        console.debug(DEBUG_PREFIX,"Loading new animation",motion_file_path);

  current_avatars[character]["motion"]["name"] = motion_file_path;
  current_avatars[character]["motion"]["animation"] = new_motion_animation;
  
  // Restart natural idle if switching to an idle animation
  const isIdleMotion = isIdleMotionName(motion_file_path, defaultMotion);
  if (isIdleMotion && extension_settings.vrm.natural_idle && loop) {
    console.debug(DEBUG_PREFIX, "Switched to idle animation, scheduling natural idle check for", character);
    const modelId = current_avatars[character]["id"];
    const idleCheckDelayMs = Math.max(800, Math.round(ANIMATION_FADE_TIME * 1000) + 300);
    scheduleNaturalIdleCheck(character, modelId, idleCheckDelayMs, "setMotion-idle-loop");
  }

    // Fade out animation after full loop
    if (!loop) {
      setTimeout(() => {
        if (!new_motion_animation.terminated) {
          const postMotionIdleDelayMs = 1200;
          suspendNaturalIdle(character, postMotionIdleDelayMs);
          setMotion(character, extension_settings.vrm.model_settings[model_path]["animation_default"]["motion"], true);
          if (options.restoreExpression) {
            restoreExpressionState(character, options.restoreExpression);
          }
        }
      }, clip.duration*1000 - ANIMATION_FADE_TIME*1000);
    }

    }
}

// Animation Sequence System
// Store for animation sequences per character
const animationSequences = {};
const sequencePlaybackState = {};

function isIdleMotionName(motionName, defaultMotion = null) {
    const motionNameBase = motionName?.replace(/\.[^/.]+$/, "").replace(/\d+$/, "");
    const defaultMotionBase = defaultMotion?.replace(/\.[^/.]+$/, "").replace(/\d+$/, "");
    return IDLE_ANIMS.some((idle) => motionNameBase === idle) || motionName === "none" || (defaultMotionBase && motionNameBase === defaultMotionBase);
}

function resolveAnimationPath(animationName) {
    const raw = String(animationName || '').trim();
    if (!raw) {
        return null;
    }

    const normalizedRaw = raw.toLowerCase().replaceAll('\\', '/');
    const normalizedNoLeadingSlash = normalizedRaw.replace(/^\/+/, '');
    for (const filePath of animations_files) {
        const normalizedPath = String(filePath || '').trim().toLowerCase().replaceAll('\\', '/');
        if (!normalizedPath) {
            continue;
        }
        const normalizedPathNoLeadingSlash = normalizedPath.replace(/^\/+/, '');
        if (normalizedPath === normalizedRaw ||
            normalizedPathNoLeadingSlash === normalizedNoLeadingSlash ||
            normalizedPath.endsWith('/' + normalizedNoLeadingSlash) ||
            normalizedPathNoLeadingSlash.endsWith('/' + normalizedNoLeadingSlash)) {
            return filePath;
        }
    }

    // Handle extensionless paths like "/assets/vrm/animation/neutral"
    // by matching against known animation files by basename/path without extension.
    const targetNoExt = normalizedNoLeadingSlash.replace(/\.[^/.]+$/, '');
    const targetLeafNoExt = targetNoExt.split('/').pop() || targetNoExt;

    for (const filePath of animations_files) {
        const normalizedPath = String(filePath || '').trim().toLowerCase().replaceAll('\\', '/').replace(/^\/+/, '');
        if (!normalizedPath) {
            continue;
        }

        const candidateNoExt = normalizedPath.replace(/\.[^/.]+$/, '');
        const candidateLeafNoExt = candidateNoExt.split('/').pop() || candidateNoExt;

        if (candidateNoExt === targetNoExt || candidateNoExt.endsWith('/' + targetNoExt) || candidateLeafNoExt === targetLeafNoExt) {
            return filePath;
        }
    }

    return normalizedNoLeadingSlash || raw;
}

function resolveGreetingMotionPath(model_path) {
    const modelSettings = extension_settings.vrm.model_settings?.[model_path] || {};
    const configuredGreeting = modelSettings?.animation_on_load?.motion
        || modelSettings?.animation_greeting?.motion
        || modelSettings?.greeting_motion
        || modelSettings?.greetingMotion;

    const pickRandom = (items) => {
        if (!Array.isArray(items) || items.length === 0) {
            return null;
        }
        return items[Math.floor(Math.random() * items.length)];
    };

    const allVrmaFiles = animations_files
        .map((filePath) => String(filePath || '').trim().replaceAll('\\', '/').replace(/^\/+/, ''))
        .filter((normalizedPath) => normalizedPath && normalizedPath.toLowerCase().endsWith('.vrma'));

    if (configuredGreeting && configuredGreeting !== 'none') {
        const resolved = ensureAnimationFileExtension(resolveAnimationPath(configuredGreeting));
        if (resolved && resolved !== 'none') {
            const resolvedNoExt = String(resolved).replace(/\.[^/.]+$/, '').toLowerCase();
            const resolvedLeafNoExt = resolvedNoExt.split('/').pop() || resolvedNoExt;
            const resolvedBase = resolvedNoExt.replace(/\d+$/, '');
            const resolvedLeafBase = resolvedLeafNoExt.replace(/\d+$/, '');

            const greetingVariants = allVrmaFiles.filter((candidatePath) => {
                const candidateNoExt = candidatePath.replace(/\.[^/.]+$/, '').toLowerCase();
                const candidateLeafNoExt = candidateNoExt.split('/').pop() || candidateNoExt;
                const candidateBase = candidateNoExt.replace(/\d+$/, '');
                const candidateLeafBase = candidateLeafNoExt.replace(/\d+$/, '');

                return candidateBase === resolvedBase
                    || candidateLeafBase === resolvedLeafBase
                    || candidateNoExt === resolvedNoExt
                    || candidateLeafNoExt === resolvedLeafNoExt;
            });

            return pickRandom(greetingVariants) || resolved;
        }
    }

    const greetingCandidates = allVrmaFiles.filter((candidatePath) => {
        const leaf = candidatePath.split('/').pop() || candidatePath;
        return leaf.toLowerCase().includes('greeting');
    });

    return pickRandom(greetingCandidates);
}

function triggerLoadGreetingMotion(character, model_path, expectedModelId) {
    const greetingMotion = resolveGreetingMotionPath(model_path);
    if (!greetingMotion) {
        return;
    }

    setTimeout(() => {
        if (!current_avatars[character] || current_avatars[character]["id"] !== expectedModelId) {
            return;
        }

        setMotionSequence(character, [{ animation: greetingMotion }], {
            replace: true,
            clearOnComplete: true,
            restoreBaseIdle: true,
            priority: 'high',
        }).catch((error) => {
            console.warn(DEBUG_PREFIX, 'Failed to play load greeting motion for', character, greetingMotion, error);
        });
    }, 250);
}

function ensureAnimationFileExtension(animationPath) {
    const raw = String(animationPath || '').trim();
    if (!raw) {
        return raw;
    }

    const normalized = raw.replaceAll('\\', '/').replace(/^\/+/, '');
    if (/\.[a-z0-9]+$/i.test(normalized)) {
        return normalized;
    }

    const normalizedNoExt = normalized.replace(/\.[^/.]+$/, '').toLowerCase();
    const leafNoExt = normalizedNoExt.split('/').pop() || normalizedNoExt;

    for (const filePath of animations_files) {
        const candidate = String(filePath || '').trim().replaceAll('\\', '/').replace(/^\/+/, '');
        if (!candidate) {
            continue;
        }

        const candidateNoExt = candidate.replace(/\.[^/.]+$/, '').toLowerCase();
        const candidateLeafNoExt = candidateNoExt.split('/').pop() || candidateNoExt;

        if (candidateNoExt === normalizedNoExt || candidateNoExt.endsWith('/' + normalizedNoExt) || candidateLeafNoExt === leafNoExt) {
            return candidate;
        }
    }

    return `${normalized}.bvh`;
}

/**
 * Play a sequence of animations for a character
 * @param {string} character - Character name
 * @param {Array} sequence - Array of animation sequence items
 * @param {Object} options - Playback options
 * @param {boolean} options.loop - Whether to loop the entire sequence
 * @param {boolean} options.clearOnComplete - Whether to clear the sequence queue when done
 * @returns {Promise<boolean>} - Success status
 * 
 * Sequence item format:
 * {
 *   animation: string,      // Animation file path or name
 *   duration: number,     // How long to play (ms), or null for full animation
 *   wait: number,         // Wait time after animation before next (ms)
 *   expression: string,   // Expression to set during this animation
 *   loop: boolean,        // Whether to loop this specific animation
 *   transition: string    // Transition type: 'fade', 'cut', or 'crossfade'
 * }
 */
async function playAnimationSequence(character, sequence, options = {}) {
    if (current_avatars[character] === undefined) {
        console.warn(DEBUG_PREFIX, "Cannot play sequence - character not loaded:", character);
        return false;
    }

    if (!Array.isArray(sequence) || sequence.length === 0) {
        console.warn(DEBUG_PREFIX, "Invalid sequence provided for", character);
        return false;
    }

    suspendNaturalIdle(character, 1800);
    stopProceduralIdleForCharacter(character, current_avatars[character]?.vrm);

    const managerState = getAnimationManagerState(character);
    const hasExistingQueue = !!animationSequences[character];
    const shouldReplaceQueue = !!options.replace;
    const shouldAppendToQueue = hasExistingQueue && !shouldReplaceQueue && options.append === true;

    if (shouldAppendToQueue) {
        const existing = animationSequences[character];
        const priority = String(options.priority || 'normal').toLowerCase();
        const activeGeneration = sequencePlaybackState[character]?.generation ?? managerState.sequenceGeneration;

        if (!sequencePlaybackState[character]) {
            sequencePlaybackState[character] = {
                active: false,
                startedAt: Date.now(),
                priority,
                generation: activeGeneration,
            };
        }

        if (sequence.length === 1 && existing.items.length > 0) {
            const normalizeAnimationName = (name) => {
                if (!name || name === 'none') {
                    return 'none';
                }
                const resolved = resolveAnimationPath(name);
                return ensureAnimationFileExtension(resolved || name);
            };

            const incoming = sequence[0] || {};
            const lastQueued = existing.items[existing.items.length - 1] || {};
            const sameAnimation = normalizeAnimationName(incoming.animation) === normalizeAnimationName(lastQueued.animation);
            const sameExpression = String(incoming.expression || 'none') === String(lastQueued.expression || 'none');
            const sameWait = Number(incoming.wait || 0) === Number(lastQueued.wait || 0);

            if (sameAnimation && sameExpression && sameWait) {
                console.debug(DEBUG_PREFIX, 'Skipping duplicate appended sequence item for', character, incoming);
                return true;
            }
        }

        existing.items.push(...sequence);
        console.debug(DEBUG_PREFIX, "Appended", sequence.length, `${priority}-priority sequence item(s) for`, character);

        const isPlaybackActive = !!sequencePlaybackState[character]?.active;
        if (!isPlaybackActive) {
            console.debug(DEBUG_PREFIX, "Sequence queue was idle after append; resuming playback for", character);
            playNextInSequence(character, activeGeneration).catch((err) => {
                console.warn(DEBUG_PREFIX, "Failed to resume appended sequence for", character, err);
            });
        }

        return true;
    }

    const activeGeneration = invalidateSequenceGeneration(character);

    sequencePlaybackState[character] = {
        active: true,
        startedAt: Date.now(),
        priority: String(options.priority || 'normal').toLowerCase(),
        generation: activeGeneration,
    };

    // Store sequence and options
    animationSequences[character] = {
        items: sequence,
        currentIndex: -1,
        options: {
            loop: options.loop || false,
            clearOnComplete: options.clearOnComplete !== false,
            ...options
        }
    };

    if (options.deferIfBusy) {
        const avatar = current_avatars[character];
        const modelPath = extension_settings.vrm.character_model_mapping[character];
        const defaultMotion = extension_settings.vrm.model_settings?.[modelPath]?.animation_default?.motion;
        const currentMotionName = avatar?.motion?.name || 'none';
        const currentMotionAction = avatar?.motion?.animation;
        const isCurrentActionRunning = Boolean(
            currentMotionAction
            && typeof currentMotionAction.isRunning === 'function'
            && currentMotionAction.isRunning()
            && !currentMotionAction.terminated,
        );
        const isBusyNonIdle = isCurrentActionRunning && !isIdleMotionName(currentMotionName, defaultMotion);

        if (isBusyNonIdle) {
            sequencePlaybackState[character] = {
                ...(sequencePlaybackState[character] || {}),
                active: false,
                waiting: true,
                startedAt: Date.now(),
                priority: String(options.priority || 'normal').toLowerCase(),
                generation: activeGeneration,
            };

            const waitForCurrentMotionToFinish = () => {
                const pendingQueue = animationSequences[character];
                const pendingAvatar = current_avatars[character];
                const pendingGeneration = sequencePlaybackState[character]?.generation;
                if (pendingGeneration !== activeGeneration) {
                    return;
                }
                if (!pendingQueue || !pendingAvatar) {
                    delete sequencePlaybackState[character];
                    return;
                }

                const pendingModelPath = extension_settings.vrm.character_model_mapping[character];
                const pendingDefaultMotion = extension_settings.vrm.model_settings?.[pendingModelPath]?.animation_default?.motion;
                const pendingMotionName = pendingAvatar?.motion?.name || 'none';
                const pendingAction = pendingAvatar?.motion?.animation;
                const pendingActionRunning = Boolean(
                    pendingAction
                    && typeof pendingAction.isRunning === 'function'
                    && pendingAction.isRunning()
                    && !pendingAction.terminated,
                );
                const stillBusy = pendingActionRunning && !isIdleMotionName(pendingMotionName, pendingDefaultMotion);

                if (stillBusy) {
                    scheduleSequenceTimeout(character, activeGeneration, waitForCurrentMotionToFinish, 120);
                    return;
                }

                sequencePlaybackState[character] = {
                    ...(sequencePlaybackState[character] || {}),
                    active: true,
                    waiting: false,
                    lastStepAt: Date.now(),
                    generation: activeGeneration,
                };

                playNextInSequence(character, activeGeneration).catch((err) => {
                    console.warn(DEBUG_PREFIX, "Failed to start deferred sequence for", character, err);
                });
            };

            scheduleSequenceTimeout(character, activeGeneration, waitForCurrentMotionToFinish, 120);
            console.debug(DEBUG_PREFIX, "Deferring sequence start until current non-idle motion finishes for", character);
            return true;
        }
    }

    console.debug(DEBUG_PREFIX, "Starting animation sequence for", character, "with", sequence.length, "items");
    
    // Start playing the sequence
    await playNextInSequence(character, activeGeneration);
    return true;
}

/**
 * Play the next animation in a character's sequence
 * @param {string} character - Character name
 */
async function playNextInSequence(character, expectedGeneration = null) {
    if (expectedGeneration !== null && sequencePlaybackState[character]?.generation !== expectedGeneration) {
        return;
    }

    const seqData = animationSequences[character];
    if (!seqData) {
        delete sequencePlaybackState[character];
        return;
    }

    const activeGeneration = expectedGeneration ?? sequencePlaybackState[character]?.generation ?? getAnimationManagerState(character).sequenceGeneration;

    sequencePlaybackState[character] = {
        ...(sequencePlaybackState[character] || {}),
        active: true,
        lastStepAt: Date.now(),
        generation: activeGeneration,
    };

    seqData.currentIndex++;

    // Check if we've reached the end
    if (seqData.currentIndex >= seqData.items.length) {
        if (seqData.options.loop) {
            // Loop back to start
            seqData.currentIndex = 0;
            console.debug(DEBUG_PREFIX, "Looping sequence for", character);
        } else {
            // Sequence complete
            console.debug(DEBUG_PREFIX, "Sequence complete for", character);
            if (seqData.options.restoreExpression) {
                restoreExpressionState(character, seqData.options.restoreExpression);
            }
            if (seqData.options.restoreBaseIdle !== false) {
                const modelPath = extension_settings.vrm.character_model_mapping[character];
                const defaultMotion = extension_settings.vrm.model_settings?.[modelPath]?.animation_default?.motion;
                if (defaultMotion && defaultMotion !== 'none' && current_avatars[character] !== undefined) {
                    try {
                        await setMotion(character, defaultMotion, true, true, false);
                    } catch (e) {
                        console.warn(DEBUG_PREFIX, "Failed restoring base idle after sequence for", character, e);
                    }
                }
            }
            if (seqData.options.clearOnComplete) {
                delete animationSequences[character];
            }
            clearAnimationManagerTimeouts(character);
            delete sequencePlaybackState[character];
            return;
        }
    }

    const item = seqData.items[seqData.currentIndex];
    const vrm = current_avatars[character]?.vrm;
    const model_path = extension_settings.vrm.character_model_mapping[character];

    if (!vrm || !model_path) {
        console.warn(DEBUG_PREFIX, "Cannot play sequence item - VRM or model path missing");
        clearAnimationManagerTimeouts(character);
        delete animationSequences[character];
        delete sequencePlaybackState[character];
        return;
    }

    suspendNaturalIdle(character, 1200);
    stopProceduralIdleForCharacter(character, vrm);

    console.debug(DEBUG_PREFIX, "Playing sequence item", seqData.currentIndex + 1, "/", seqData.items.length, "for", character, ":", item);

    // Set expression if specified
    if (item.expression && item.expression !== "none") {
        await setExpression(character, item.expression);
    }

    // Resolve animation file path
    let animationFile = item.animation;

    // Handle 'none' animation - skip to next item after wait
    if (animationFile === 'none') {
        console.debug(DEBUG_PREFIX, "Skipping 'none' animation for", character);
        scheduleSequenceTimeout(character, activeGeneration, () => {
            playNextInSequence(character, activeGeneration);
        }, item.wait || 0);
        return;
    }

    animationFile = resolveAnimationPath(animationFile);
    animationFile = ensureAnimationFileExtension(animationFile);

    if (!animationFile) {
        console.warn(DEBUG_PREFIX, "Animation not found:", item.animation);
        scheduleSequenceTimeout(character, activeGeneration, () => {
            playNextInSequence(character, activeGeneration);
        }, item.wait || 0);
        return;
    }

    if (!animationFile.includes('.')) {
        // Try to find matching animation file
        const fuse = new Fuse(animations_files);
        const results = fuse.search(animationFile);
        if (results.length > 0) {
            animationFile = results[0].item;
        }
    }

    if (!animationFile) {
        console.warn(DEBUG_PREFIX, "Animation not found:", item.animation);
        // Skip to next
        scheduleSequenceTimeout(character, activeGeneration, () => {
            playNextInSequence(character, activeGeneration);
        }, item.wait || 0);
        return;
    }

    // Determine transition type
    const transition = item.transition || seqData.options.transition || 'fade';
    const fadeSecondsRaw = Number.isFinite(item.fadeSec) ? Number(item.fadeSec) : Number(seqData.options.fadeSec);
    const fadeDurationSec = Number.isFinite(fadeSecondsRaw)
        ? Math.max(0, Math.min(1.2, fadeSecondsRaw))
        : ANIMATION_FADE_TIME;
    const isLoop = item.loop || false;

    // Play the animation
    // We need to handle the playback duration manually
    const hipsHeight = current_avatars[character]["hipsHeight"];
    let clip = null;

    // Load or get from cache
    if (animations_cache[model_path] !== undefined && animations_cache[model_path][animationFile] !== undefined) {
        clip = animations_cache[model_path][animationFile];
    } else {
        clip = await loadAnimation(vrm, hipsHeight, animationFile);
        if (clip && extension_settings.vrm.animations_cache) {
            animations_cache[model_path][animationFile] = clip;
        }
    }

    if (!clip || typeof clip.duration !== 'number') {
        console.warn(DEBUG_PREFIX, "Failed to load animation clip:", animationFile);
        scheduleSequenceTimeout(character, activeGeneration, () => {
            playNextInSequence(character, activeGeneration);
        }, item.wait || 0);
        return;
    }

    // Get mixer and play animation
    let mixer = current_avatars[character]["animation_mixer"];
    const current_motion_animation = current_avatars[character]["motion"]["animation"];

    // Ensure mixer exists
    if (!mixer || typeof mixer.clipAction !== 'function') {
        mixer = new THREE.AnimationMixer(vrm.scene);
        current_avatars[character]["animation_mixer"] = mixer;
    }

    // Create new animation action
    const new_motion_animation = mixer.clipAction(clip);
    new_motion_animation.setLoop(isLoop ? THREE.LoopRepeat : THREE.LoopOnce);
    new_motion_animation.clampWhenFinished = !isLoop;

    // Handle transition
    if (current_motion_animation !== null) {
        if (transition === 'cut') {
            current_motion_animation.stop();
        } else if (transition === 'crossfade') {
            current_motion_animation.crossFadeTo(new_motion_animation, fadeDurationSec, false);
        } else {
            // default fade
            current_motion_animation.fadeOut(fadeDurationSec);
        }
        current_motion_animation.terminated = true;
    }

    // Start new animation
    new_motion_animation
        .reset()
        .setEffectiveTimeScale(1)
        .setEffectiveWeight(1)
        .fadeIn(transition === 'cut' ? 0 : fadeDurationSec)
        .play();
    new_motion_animation.terminated = false;

    // Update current motion tracking
    current_avatars[character]["motion"]["name"] = animationFile;
    current_avatars[character]["motion"]["animation"] = new_motion_animation;

    // Determine playback duration
    let playDuration;
    if (item.duration !== undefined && item.duration !== null) {
        // Use specified duration
        playDuration = item.duration;
    } else if (isLoop) {
        // Loop indefinitely (but we need to move on eventually, so use a long duration)
        playDuration = 10000; // 10 seconds max for loop items in sequences
    } else {
        // Use full animation duration
        playDuration = clip.duration * 1000;
    }

    // Schedule next item
    const waitTime = item.wait || 0;
    const fadeLeadMs = Math.min(fadeDurationSec * 1000, Math.max(0, playDuration - 120));
    const totalTime = Math.max(0, playDuration - fadeLeadMs);

    scheduleSequenceTimeout(character, activeGeneration, () => {
        // Fade out current animation if not looping
        if (!isLoop && !new_motion_animation.terminated) {
            new_motion_animation.fadeOut(fadeDurationSec);
        }

        // Move to next after wait time
        scheduleSequenceTimeout(character, activeGeneration, () => {
            if (!new_motion_animation.terminated) {
                new_motion_animation.terminated = true;
            }
            playNextInSequence(character, activeGeneration);
        }, waitTime + (isLoop ? 0 : fadeDurationSec * 1000));
    }, totalTime);
}

/**
 * Clear a character's animation sequence
 * @param {string} character - Character name
 */
function clearAnimationSequence(character) {
    invalidateSequenceGeneration(character);
    if (animationSequences[character]) {
        delete animationSequences[character];
        console.debug(DEBUG_PREFIX, "Cleared animation sequence for", character);
    }
    if (sequencePlaybackState[character]) {
        delete sequencePlaybackState[character];
    }
}

/**
 * Set and immediately play a motion sequence from a parsed string or array
 * @param {string} character - Character name
 * @param {string|Array} sequence - Sequence definition (string like "wave,wait:500,point" or array)
 * @param {Object} options - Playback options
 */
async function setMotionSequence(character, sequence, options = {}) {
    let parsedSequence;

    if (typeof sequence === 'string') {
        // Parse sequence string
        // Format: "animation1,animation2,wait:500,animation3:duration:2000"
        parsedSequence = parseSequenceString(sequence);
    } else if (Array.isArray(sequence)) {
        parsedSequence = sequence;
    } else {
        console.warn(DEBUG_PREFIX, "Invalid sequence format for", character);
        return false;
    }

    if (parsedSequence.length === 0) {
        console.warn(DEBUG_PREFIX, "Empty sequence for", character);
        return false;
    }

    return await playAnimationSequence(character, parsedSequence, options);
}

/**
 * Parse a sequence string into array format
 * @param {string} str - Sequence string
 * @returns {Array} Parsed sequence array
 */
function parseSequenceString(str) {
    const items = [];
    const parts = str.split(',').map(p => p.trim()).filter(p => p);

    for (const part of parts) {
        // Check for special commands
        if (part.startsWith('wait:')) {
            const waitTime = parseInt(part.split(':')[1]) || 500;
            items.push({ wait: waitTime, animation: 'none' });
            continue;
        }

        if (part.startsWith('expression:')) {
            const expr = part.split(':')[1];
            if (items.length > 0) {
                items[items.length - 1].expression = expr;
            }
            continue;
        }

        // Parse animation with optional parameters
        // Format: animationName[:duration:ms][:loop:true][:transition:fade]
        const params = part.split(':');
        const animation = params[0];
        
        const item = { animation };
        
        for (let i = 1; i < params.length; i += 2) {
            const key = params[i];
            const value = params[i + 1];
            
            if (!value) continue;
            
            switch (key) {
                case 'duration':
                    item.duration = parseInt(value);
                    break;
                case 'wait':
                    item.wait = parseInt(value);
                    break;
                case 'loop':
                    item.loop = value === 'true';
                    break;
                case 'transition':
                    item.transition = value;
                    break;
                case 'expression':
                    item.expression = value;
                    break;
            }
        }

        items.push(item);
    }

    return items;
}

async function updateExpression(chat_id) {
    const message = getContext().chat[chat_id];
    if (!message) {
        return;
    }

    const character = message.name;
    const model_path = extension_settings.vrm.character_model_mapping[character];

    const dedupeKey = `${character}|${chat_id}`;
    const signature = `${character}|${chat_id}|${String(message?.mes || '').trim()}`;
    const previous = recentExpressionDispatch.get(dedupeKey);
    if (previous === signature) {
        console.debug(DEBUG_PREFIX, 'Skipping duplicate classify dispatch for', character, 'chat_id=', chat_id);
        return;
    }
    recentExpressionDispatch.set(dedupeKey, signature);
    if (recentExpressionDispatch.size > 400) {
        recentExpressionDispatch.clear();
    }

    if (message.is_user || message.is_system)
        return;

    if (model_path === undefined) {
        console.debug(DEBUG_PREFIX, 'No model assigned to', character);
        return;
    }

    const expression = await getExpressionLabel(message.mes);
    let model_expression = extension_settings.vrm.model_settings[model_path]['classify_mapping'][expression]['expression'];
    let model_motion = extension_settings.vrm.model_settings[model_path]['classify_mapping'][expression]['motion'];
    let sequence = extension_settings.vrm.model_settings[model_path]['classify_mapping'][expression]['sequence'];

    // Fallback animations
    if (model_expression == 'none') {
        model_expression = extension_settings.vrm.model_settings[model_path]['animation_default']['expression'];
    }

    const sequenceText = String(sequence || '').trim();

    // Keep classify motion optional: if mapping motion is "none" and no sequence is set,
    // update expression only and leave current motion untouched.

    const avatar = current_avatars[character];
    if (avatar && !sequenceText) {
        const normalizeMotionName = (name) => {
            if (!name || name === 'none') {
                return 'none';
            }
            const resolved = resolveAnimationPath(name);
            return ensureAnimationFileExtension(resolved || name);
        };

        const targetMotion = normalizeMotionName(model_motion);
        const currentMotion = normalizeMotionName(avatar["motion"]?.["name"]);
        const sameExpression = avatar["expression"] === model_expression;
        const sameMotion = targetMotion === currentMotion;
        const queueState = sequencePlaybackState[character];
        const hasSequenceWork = Boolean(animationSequences[character] || queueState?.active || queueState?.waiting);

        if (sameExpression && sameMotion && !hasSequenceWork) {
            console.debug(DEBUG_PREFIX, 'Skipping classify dispatch (already at target expression/motion) for', character);
            return;
        }
    }

    await setExpression(character, model_expression);

    let resolvedClassifyMotion = null;
    if (model_motion && model_motion !== 'none') {
        resolvedClassifyMotion = ensureAnimationFileExtension(resolveAnimationPath(model_motion));
        if (!resolvedClassifyMotion) {
            const fuse = new Fuse(animations_files || []);
            const results = fuse.search(String(model_motion));
            const fileItem = results[0]?.item;
            resolvedClassifyMotion = ensureAnimationFileExtension(resolveAnimationPath(fileItem || model_motion));
        }
    }

    console.debug(DEBUG_PREFIX, 'Classify mapping dispatch', {
        character,
        expression,
        model_expression,
        model_motion,
        resolvedClassifyMotion,
        sequenceText,
    });
    
    // Play classify output through the sequence queue with deterministic replacement.
    // Using replace avoids inheriting stale queue options (e.g. looping queues).
    if (sequenceText) {
        await setMotionSequence(character, sequence, {
            loop: false,
            replace: true,
            clearOnComplete: true,
            restoreBaseIdle: true,
            deferIfBusy: false,
            priority: 'high',
        });
    } else if (resolvedClassifyMotion) {
        await setMotionSequence(character, [{ animation: resolvedClassifyMotion }], {
            loop: false,
            replace: true,
            clearOnComplete: true,
            restoreBaseIdle: true,
            deferIfBusy: false,
            priority: 'high',
        });
    } else {
        console.debug(DEBUG_PREFIX, 'Classify motion unresolved/none; applied expression only for', character, model_motion);
    }
}


// Scan for VRMA idle animation files
async function scanVRMAIdleFiles() {
  if (vrmaIdleFiles.length > 0) return; // Already scanned

  // Try to discover VRMA files in the extension directory
  // In SillyTavern, extensions are served from /scripts/extensions/[type]/[name]/
  const possibleFiles = [
    'FanningSelfOff_Idle.vrma',
    'FullBodyStretch_Idle.vrma',
    'Impatient_Idle.vrma',
    'InspectHands_Idle.vrma',
    'KickingGround_Idle.vrma',
    'LookBehind_Idle.vrma',
    'Sigh_Idle.vrma',
    'Yawn_Stretch_Idle.vrma'
  ];

  // Build full paths for the bundled VRM assets inside Embody.
  const basePath = '/scripts/extensions/third-party/Extension-Embody/vrm/';

  for (const file of possibleFiles) {
    vrmaIdleFiles.push(`${basePath}${file}`);
  }

  console.debug(DEBUG_PREFIX, "Found VRMA idle files:", vrmaIdleFiles);
}

// Load a VRMA idle animation
async function loadVRMAIdleAnimation(vrm, hipsHeight, vrmaPath) {
  if (vrmaIdleCache[vrmaPath]) {
    return vrmaIdleCache[vrmaPath];
  }
  
  const vrmaLoader = new VRMALoader();
  const result = await vrmaLoader.loadAsync(vrmaPath, vrm);
  
  if (result && result.clip) {
    vrmaIdleCache[vrmaPath] = result.clip;
    return result.clip;
  }
  
  return null;
}

function getIdleMovementBones(config) {
  const bones = new Set();
  if (!config) return [];

  if (config.rotations) {
    Object.keys(config.rotations).forEach((bone) => bones.add(bone));
  }

  if (Array.isArray(config.stages)) {
    for (const stage of config.stages) {
      if (stage.rotations) {
        Object.keys(stage.rotations).forEach((bone) => bones.add(bone));
      }
    }
  }

  return Array.from(bones);
}

function captureProceduralIdleBasePoses(character, vrm, movementConfig) {
  const bones = getIdleMovementBones(movementConfig);
  if (bones.length === 0) return;

  proceduralBoneBasePoses[character] = {};
  for (const boneName of bones) {
    const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
    if (bone) {
      proceduralBoneBasePoses[character][boneName] = getBoneQuaternionWithoutCursorOffset(character, boneName, bone.quaternion);
    }
  }
}

function restoreIdleBasePoses(character, vrm, options = {}) {
  const immediate = options.immediate === true;
  const requestedDurationMs = options.durationMs;
  const minCorrectionAngle = options.minCorrectionAngle ?? 0.02;
  const minYCorrection = options.minYCorrection ?? 0.002;

  if (!vrm) {
    delete proceduralBoneBasePoses[character];
    delete vrmaBoneBasePoses[character];
    delete vrmaBaseYPosition[character];
    return;
  }

  if (idlePoseBlendJobs[character]) {
    idlePoseBlendJobs[character] += 1;
  } else {
    idlePoseBlendJobs[character] = 1;
  }
  const blendJobId = idlePoseBlendJobs[character];

  const combinedBasePoses = {
    ...(proceduralBoneBasePoses[character] || {}),
    ...(vrmaBoneBasePoses[character] || {})
  };

  const baseY = vrmaBaseYPosition[character];

  delete proceduralBoneBasePoses[character];
  delete vrmaBoneBasePoses[character];
  delete vrmaBaseYPosition[character];

  const objectContainer = current_avatars[character]?.["objectContainer"];

  if (immediate) {
    for (const [boneName, baseQuat] of Object.entries(combinedBasePoses)) {
      const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (bone) {
        bone.quaternion.copy(baseQuat);
      }
    }

    if (baseY !== undefined && objectContainer) {
      objectContainer.position.y = baseY;
    }
    return;
  }

  const startBoneQuats = {};
  let maxCorrectionAngle = 0;
  for (const [boneName, baseQuat] of Object.entries(combinedBasePoses)) {
    const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
    if (bone) {
      const boneBaseQuat = getBoneQuaternionWithoutCursorOffset(character, boneName, bone.quaternion);
      const correctionAngle = boneBaseQuat.angleTo(baseQuat);
      if (correctionAngle < minCorrectionAngle) {
        continue;
      }
      maxCorrectionAngle = Math.max(maxCorrectionAngle, correctionAngle);
      startBoneQuats[boneName] = {
        start: boneBaseQuat,
        target: baseQuat
      };
    }
  }

  const startY = objectContainer?.position.y;
  const needsYCorrection = baseY !== undefined && startY !== undefined && Math.abs(baseY - startY) >= minYCorrection;

  if (Object.keys(startBoneQuats).length === 0 && !needsYCorrection) {
    return;
  }

  const angleNormalized = Math.min(1, maxCorrectionAngle / 0.5);
  const adaptiveDurationMs = 320 + (angleNormalized * 460);
  const durationMs = Math.max(1, Math.round(requestedDurationMs ?? adaptiveDurationMs));
  const startTime = performance.now();

  const step = () => {
    if (current_avatars[character] === undefined || idlePoseBlendJobs[character] !== blendJobId) {
      return;
    }

    const elapsed = performance.now() - startTime;
    const progress = Math.min(1, elapsed / Math.max(1, durationMs));
    const eased = easeInOutCubic(progress);

    for (const [boneName, quats] of Object.entries(startBoneQuats)) {
      const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (bone) {
        const blendedBaseQuat = new THREE.Quaternion().slerpQuaternions(quats.start, quats.target, eased);
        const additiveQuat = getCombinedAdditiveQuaternionForBone(character, boneName);
        bone.quaternion.copy(blendedBaseQuat).multiply(additiveQuat);
      }
    }

    if (needsYCorrection && objectContainer && startY !== undefined) {
      objectContainer.position.y = startY + (baseY - startY) * eased;
    }

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };

  requestAnimationFrame(step);
}

function getCharacterIdleProfile(character) {
  if (!proceduralState[character]) {
    proceduralState[character] = {
      pauseMinMs: 2600 + Math.floor(Math.random() * 1600),
      pauseMaxMs: 6200 + Math.floor(Math.random() * 2600),
      cooldownMinMs: 9000 + Math.floor(Math.random() * 2500),
      cooldownMaxMs: 17000 + Math.floor(Math.random() * 5000),
      expressionChanceScale: 0.45 + Math.random() * 0.3,
      expressionIntensityScale: 0.7 + Math.random() * 0.3,
      modelRotationScale: 0.45 + Math.random() * 0.25,
      vrmaChance: 0.08 + Math.random() * 0.07,
      lastMovementKey: null,
      recentMovements: [],
      idleCycleQueue: []
    };
  }

  return proceduralState[character];
}

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }
  return items;
}

function buildIdleCycleQueue() {
  const queue = [];
  const movementKeys = Object.keys(IDLE_MOVEMENT_CONFIGS).filter((key) => IDLE_MOVEMENT_CONFIGS[key]?.enabled !== false);

  for (const key of movementKeys) {
    queue.push({ type: 'procedural', key });
  }

  for (const vrmaPath of vrmaIdleFiles) {
    queue.push({ type: 'vrma', key: vrmaPath });
  }

  return shuffleInPlace(queue);
}

function pickNextIdleChoice(character) {
  const profile = getCharacterIdleProfile(character);

  if (!Array.isArray(profile.idleCycleQueue) || profile.idleCycleQueue.length === 0) {
    profile.idleCycleQueue = buildIdleCycleQueue();
  }

  if (!profile.idleCycleQueue.length) {
    return null;
  }

  return profile.idleCycleQueue.shift();
}

async function naturalIdleMovement(character, modelId) {
  if (current_avatars[character] === undefined || current_avatars[character]["id"] != modelId) {
    clearNaturalIdleTimer(character);
    return;
  }

  const vrm = current_avatars[character]["vrm"];
  const motionName = current_avatars[character]["motion"]["name"];
  const currentMotionAction = current_avatars[character]["motion"]["animation"];
  const model_path = extension_settings.vrm.character_model_mapping[character];
  const defaultMotion = extension_settings.vrm.model_settings[model_path]["animation_default"]["motion"];
  let mixer = current_avatars[character]["animation_mixer"];

  const hasSequenceQueued = !!animationSequences[character];
  const hasSequenceActive = !!sequencePlaybackState[character]?.active;
  if (hasSequenceQueued || hasSequenceActive) {
    const delayTime = Math.floor(Math.random() * 1200) + 800;
    setNaturalIdleTimer(character, delayTime, () => {
      naturalIdleMovement(character, modelId);
    });
    return;
  }

  const hasRunningNonIdleMotion = !!(currentMotionAction && currentMotionAction.isRunning && currentMotionAction.isRunning() && !isIdleMotionName(motionName, defaultMotion));
  if (hasRunningNonIdleMotion) {
    const delayTime = Math.floor(Math.random() * 1200) + 800;
    setNaturalIdleTimer(character, delayTime, () => {
      naturalIdleMovement(character, modelId);
    });
    return;
  }

  const idleProfile = getCharacterIdleProfile(character);
  const inactivityIntensity = getRawInactivityIntensity();
  const profileExpressionChanceScale = idleProfile.expressionChanceScale * (0.85 + 0.75 * inactivityIntensity);
  const profileExpressionIntensityScale = idleProfile.expressionIntensityScale * (0.85 + 0.55 * inactivityIntensity);
  const profileModelRotationScale = idleProfile.modelRotationScale * (0.85 + 0.55 * inactivityIntensity);
  const pauseMinMs = Math.max(1200, Math.round(idleProfile.pauseMinMs * (1 - 0.4 * inactivityIntensity)));
  const pauseMaxMs = Math.max(pauseMinMs + 400, Math.round(idleProfile.pauseMaxMs * (1 - 0.35 * inactivityIntensity)));
  const cooldownMinMs = Math.max(4500, Math.round(idleProfile.cooldownMinMs * (1 - 0.45 * inactivityIntensity)));
  const cooldownMaxMs = Math.max(cooldownMinMs + 1500, Math.round(idleProfile.cooldownMaxMs * (1 - 0.35 * inactivityIntensity)));

  const isIdle = isIdleMotionName(motionName, defaultMotion);

  if (!isIdle || !extension_settings.vrm.natural_idle) {
    const delayTime = Math.floor(Math.random() * 10000) + 10000;
    setNaturalIdleTimer(character, delayTime, () => {
      naturalIdleMovement(character, modelId);
    });
    return;
  }

  const runningIdleAction = activeIdleAnimations[character];
  if (runningIdleAction?.isRunning && runningIdleAction.isRunning()) {
    setNaturalIdleTimer(character, 2000, () => {
      naturalIdleMovement(character, modelId);
    });
    return;
  }

  // Check cooldown window for this character
  const now = Date.now();
  const nextEligible = nextIdleEligibleTime[character] || 0;

  if (now < nextEligible) {
    const remainingCooldown = nextEligible - now;
    setNaturalIdleTimer(character, remainingCooldown, () => {
      naturalIdleMovement(character, modelId);
    });
    return;
  }

  // Ensure mixer exists
  if (!mixer || typeof mixer.clipAction !== 'function') {
    mixer = new THREE.AnimationMixer(vrm.scene);
    current_avatars[character]["animation_mixer"] = mixer;
  }

  // Scan for VRMA files on first run
  await scanVRMAIdleFiles();

  let clip = null;
  let clipDuration = 0;
  let isVRMA = false;
  let vrmaFileName = '';
  let movementConfig = null;
  let randomizedRotation = 0;

  const totalChoices = Math.max(1, Object.keys(IDLE_MOVEMENT_CONFIGS).length + vrmaIdleFiles.length);
  for (let attempts = 0; attempts < totalChoices && !clip; attempts++) {
    const choice = pickNextIdleChoice(character);
    if (!choice) {
      break;
    }

    if (choice.type === 'vrma') {
      const hipsHeight = current_avatars[character]["hipsHeight"];
      console.debug(DEBUG_PREFIX, "Loading VRMA idle animation:", choice.key, "for", character);
      try {
        clip = await loadVRMAIdleAnimation(vrm, hipsHeight, choice.key);
        if (clip) {
          clipDuration = clip.duration;
          isVRMA = true;
          vrmaFileName = choice.key.split('/').pop();
          console.debug(DEBUG_PREFIX, "Loaded VRMA idle animation:", choice.key, "duration:", clipDuration);
        }
      } catch (error) {
        console.warn(DEBUG_PREFIX, "Failed to load VRMA idle animation:", choice.key, error);
      }
      continue;
    }

    movementConfig = IDLE_MOVEMENT_CONFIGS[choice.key];
    console.debug(DEBUG_PREFIX, "Natural idle animation:", choice.key, "-", movementConfig?.description || "unknown", "for", character);
    const result = getIdleAnimationClip(character, vrm, choice.key, current_avatars[character]?.proceduralCalibration);
    clip = result.clip;
    randomizedRotation = result.randomizedRotation;
    if (clip) {
      clipDuration = clip.duration;
    }
  }

  if (!clip) {
    console.warn(DEBUG_PREFIX, "Failed to resolve any idle animation for", character);
    const nextDelay = Math.floor(Math.random() * 10000) + 10000;
    setNaturalIdleTimer(character, nextDelay, () => {
      naturalIdleMovement(character, modelId);
    });
    return;
  }

  // Fade out previous idle animation if exists
  const prevIdleAction = activeIdleAnimations[character];
  if (prevIdleAction && prevIdleAction.isRunning && prevIdleAction.isRunning()) {
    prevIdleAction.fadeOut(ANIMATION_FADE_TIME);
    console.debug(DEBUG_PREFIX, "Fade out previous idle animation");
  }

  // For VRMA files, store base bone poses and Y position before playing
  // This prevents accumulation of bone rotations and height drops over multiple VRMA plays
  if (isVRMA) {
    vrmaBoneBasePoses[character] = {};
    const bonesToTrack = ['hips', 'spine', 'upperChest', 'chest'];
    for (const boneName of bonesToTrack) {
      const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (bone) {
        vrmaBoneBasePoses[character][boneName] = getBoneQuaternionWithoutCursorOffset(character, boneName, bone.quaternion);
      }
    }
    // Store the base Y position to prevent height drop
    const objectContainer = current_avatars[character]?.["objectContainer"];
    if (objectContainer) {
      vrmaBaseYPosition[character] = objectContainer.position.y;
      console.debug(DEBUG_PREFIX, "Stored base Y position:", vrmaBaseYPosition[character], "for VRMA animation");
    }
  }

  // Create and play new idle animation
  const idleAction = mixer.clipAction(clip);
  idleAction
    .reset()
    .setLoop(THREE.LoopOnce) // Don't loop - play once
    .setEffectiveTimeScale(1)
    .setEffectiveWeight(1)
    .fadeIn(ANIMATION_FADE_TIME)
    .play();
  idleAction.clampWhenFinished = true;

  activeIdleAnimations[character] = idleAction;
  
  if (isVRMA) {
    console.debug(DEBUG_PREFIX, "Playing VRMA idle animation:", vrmaFileName, "duration:", clipDuration, "for", character);
  } else {
    console.debug(DEBUG_PREFIX, "Playing procedural idle animation:", movementConfig?.description, "duration:", clipDuration, "for", character);
  }

  // Apply model rotation if configured (procedural only)
  if (!isVRMA && movementConfig && movementConfig.applyModelRotation && randomizedRotation !== 0) {
    const objectContainer = current_avatars[character]?.["objectContainer"];
    if (objectContainer) {
      const targetYaw = randomizedRotation * profileModelRotationScale;
      const duration = movementConfig.duration || 10000;
      applyModelRotation(vrm, character, modelId, targetYaw, duration);
    }
  }

  // Apply expression if configured
  if (!isVRMA && movementConfig && movementConfig.expressionChance) {
    const expressionChance = Math.min(0.95, movementConfig.expressionChance * profileExpressionChanceScale);
    if (Math.random() < expressionChance) {
    const expressions = movementConfig.expressions || ['happy'];
    const randomExpression = expressions[Math.floor(Math.random() * expressions.length)];
    const delay = Math.random() * 1000 + 500;
    const expressionIntensity = Math.min(1.0, (0.45 + Math.random() * 0.35) * profileExpressionIntensityScale);
    const expressionDuration = Math.round(1400 + Math.random() * 1400);
    setManagedCharacterTimer(character, 'naturalIdleExpression', delay, () => {
      if (current_avatars[character]?.vrm === vrm) {
        applyIdleExpression(vrm, character, randomExpression, expressionIntensity, expressionDuration);
      }
    });
    }
  }
  
  // VRMA files also get expressions (40% chance)
  if (isVRMA && Math.random() < 0.35) {
    const expressions = ['happy', 'relaxed', 'surprised'];
    const randomExpression = expressions[Math.floor(Math.random() * expressions.length)];
    const delay = Math.random() * 1000 + 500;
    const expressionIntensity = Math.min(1.0, (0.45 + Math.random() * 0.3) * profileExpressionIntensityScale);
    const expressionDuration = Math.round(1400 + Math.random() * 1200);
    setManagedCharacterTimer(character, 'naturalIdleVrmaExpression', delay, () => {
      if (current_avatars[character]?.vrm === vrm) {
        applyIdleExpression(vrm, character, randomExpression, expressionIntensity, expressionDuration);
      }
    });
  }

  // Schedule next idle animation after this one completes
  const clipDurationMs = clipDuration * 1000;
  const pauseAfter = Math.floor(
    Math.random() * (pauseMaxMs - pauseMinMs + 1)
  ) + pauseMinMs;

  // For VRMA files, use a longer fade-out and restore base poses
  // to prevent bone rotation accumulation and snapping
  const fadeOutDurationSec = isVRMA ? Math.min(1.2, clipDuration * 0.2) : ANIMATION_FADE_TIME;
  const fadeOutDurationMs = Math.max(1, Math.round(fadeOutDurationSec * 1000));

  // Schedule fade-out - for VRMA start fading before end to blend smoothly
  const fadeOutDelay = isVRMA
    ? Math.max(clipDurationMs - fadeOutDurationMs - 200, clipDurationMs * 0.75)
    : clipDurationMs + pauseAfter;

  // First timeout: fade out the current animation
  setNaturalIdleTimer(character, fadeOutDelay, () => {
    const currentAction = activeIdleAnimations[character];
    if (currentAction) {
      // For VRMA, stop the action after fade to prevent bone pose lingering
      if (isVRMA) {
        currentAction.fadeOut(fadeOutDurationSec);
        setManagedCharacterTimer(character, 'naturalIdleFadeCleanup', fadeOutDurationMs + 100, () => {
          currentAction.stop();
          restoreIdleBasePoses(character, vrm, { durationMs: Math.min(420, fadeOutDurationMs + 160) });
          console.debug(DEBUG_PREFIX, "Restored base pose after VRMA animation with smoothing");
        });
        console.debug(DEBUG_PREFIX, "Fading out VRMA idle animation with pose restoration");
      } else {
        currentAction.fadeOut(fadeOutDurationSec);
        setManagedCharacterTimer(character, 'naturalIdleFadeCleanup', fadeOutDurationMs + 60, () => {
          if (currentAction.stop) {
            currentAction.stop();
          }
          restoreIdleBasePoses(character, vrm, { durationMs: fadeOutDurationMs + 120 });
        });
        console.debug(DEBUG_PREFIX, "Fade out idle animation before next");
      }
    }

      // Record completion time and schedule next idle after cooldown
      // The cooldown is enforced in naturalIdleMovement itself
      const completionTime = Date.now();
      lastIdleCompletionTime[character] = completionTime;
      const cooldownDuration = Math.floor(
        Math.random() * (cooldownMaxMs - cooldownMinMs + 1)
      ) + cooldownMinMs;
      nextIdleEligibleTime[character] = completionTime + cooldownDuration;
      console.debug(DEBUG_PREFIX, "Idle animation completed for", character, "at", completionTime, "- starting cooldown");
      
      // Keep cursor/body offsets blended continuously to avoid visible snaps.
      
      // Schedule next idle after fade completes (add extra time for VRMA pose restoration)
      const nextDelay = isVRMA ? fadeOutDurationMs + 200 + pauseAfter : 0;
      setNaturalIdleTimer(character, nextDelay, () => {
        naturalIdleMovement(character, modelId);
      });

  });
}

// Blink
function blink(character, modelId) {
    const avatar = current_avatars[character];
    if (avatar?.vrm?.expressionManager) {
        // Check for winking state and clear it
        const blinkLeftVal = avatar.vrm.expressionManager.getValue('blinkLeft') || 0;
        const blinkRightVal = avatar.vrm.expressionManager.getValue('blinkRight') || 0;
        if (blinkLeftVal > 0.1 || blinkRightVal > 0.1) {
            avatar.vrm.expressionManager.setValue('blinkLeft', 0);
            avatar.vrm.expressionManager.setValue('blinkRight', 0);
            avatar.winking = false;
            avatar.customWinking = false;
        }
    }

    if (current_avatars[character] === undefined || current_avatars[character]["id"] != modelId) {
        console.debug(DEBUG_PREFIX,"Stopping blink model is no more loaded:",character,modelId)
        clearManagedCharacterTimer(character, 'blinkClose');
        clearManagedCharacterTimer(character, 'blinkLoop');
        return;
    }

    const vrm = current_avatars[character]["vrm"];

    const blinktimeout = Math.floor(Math.random() * 250) + 50;
    setManagedCharacterTimer(character, 'blinkClose', blinktimeout, () => {
      const activeAvatar = current_avatars[character];
      if (activeAvatar?.["id"] !== modelId) {
        return;
      }
      activeAvatar["vrm"]?.expressionManager?.setValue("blink",0);
    });
    
    vrm.expressionManager.setValue("blink",1.0);

    const rand = Math.round((2 + Math.random() * 10) * 1000);
    setManagedCharacterTimer(character, 'blinkLoop', rand, () => {
      blink(character, modelId);
    });
}

function updateTextTalkMouth(character, vrm, nowMs) {
    if (extension_settings.vrm.tts_lips_sync || !current_avatars[character]?._textTalkEnabled) {
        return;
    }

    const talkEnd = Number(current_avatars[character]["talkEnd"] || 0);
    if (talkEnd > nowMs) {
        const mouth_y = (Math.sin(talkEnd - nowMs) + 1) / 2;
        // Neutralize expressions while procedural speech is moving the mouth.
        for (const expression in vrm.expressionManager.expressionMap) {
            vrm.expressionManager.setValue(expression, Math.min(0.25, vrm.expressionManager.getValue(expression)));
        }
        vrm.expressionManager.setValue("aa", mouth_y);
        return;
    }

    vrm.expressionManager.setValue(current_avatars[character]["expression"], 1.0);
    vrm.expressionManager.setValue("aa", 0.0);
}

// Legacy entry point retained for loadModel callers. Actual updates happen in animate().
async function textTalk(character, modelId) {
    if (current_avatars[character] !== undefined && current_avatars[character]["id"] == modelId) {
        current_avatars[character]._textTalkEnabled = true;
    }
}

// Add text duration to current_avatars[character]["talkEnd"]
// Overrided by tts lip sync option
async function talk(chat_id) {
    // TTS lip sync overide
    if (extension_settings.vrm.tts_lips_sync)
        return;

    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : null;
    const id = Number(chat_id);
    if (!chat || !Number.isInteger(id) || id < 0 || id >= chat.length) {
        console.warn(DEBUG_PREFIX, 'Skipping talk animation; invalid chat id', { chat_id, length: chat?.length || 0 });
        return;
    }

    const message = chat[id];
    if (!message || typeof message !== 'object') {
        console.warn(DEBUG_PREFIX, 'Skipping talk animation; chat entry invalid', { chat_id: id });
        return;
    }

    // No model for user or system
    if (message.is_user || message.is_system)
        return;

    const text = message.mes;
    const character = message.name;

    console.debug(DEBUG_PREFIX,"Playing mouth animation for",character," message:",text);

    // No model loaded for character
    if(current_avatars[character] === undefined) {
        console.debug(DEBUG_PREFIX,"No model loaded, cannot animate talk")
        return;
    }

    current_avatars[character]["talkEnd"] = Date.now() + text.length * 50;
    markUserActivity("text-speech");
}

// handle window resizes
window.addEventListener( 'resize', onWindowResize, false );

function onWindowResize(){
    if (camera !== undefined && renderer !== undefined) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();

        renderer.setSize( window.innerWidth, window.innerHeight );
    }
}

// Update a character model to fit the saved settings
async function updateModel(character) {
    if (current_avatars[character] !== undefined) {
        const object_container = current_avatars[character]["objectContainer"];
        const model_path = extension_settings.vrm.character_model_mapping[character];

        object_container.scale.x = extension_settings.vrm.model_settings[model_path]['scale'];
        object_container.scale.y = extension_settings.vrm.model_settings[model_path]['scale'];
        object_container.scale.z = extension_settings.vrm.model_settings[model_path]['scale'];

        object_container.position.x = extension_settings.vrm.model_settings[model_path]['x'];
        object_container.position.y = extension_settings.vrm.model_settings[model_path]['y'];
        object_container.position.z = extension_settings.vrm.model_settings[model_path]['z']; //0.0; // In case somehow it get away from 0

        object_container.rotation.x = extension_settings.vrm.model_settings[model_path]['rx'];
        object_container.rotation.y = extension_settings.vrm.model_settings[model_path]['ry'];
        object_container.rotation.z = extension_settings.vrm.model_settings[model_path]['rz']; //0.0; // In case somehow it get away from 0

    }
}

// Currently loaded character VRM accessor
function getVRM(character) {
    if (current_avatars[character] === undefined)
        return undefined;
    return current_avatars[character]["vrm"];
}

function clearModelCache() {
    models_cache = {};
}

function clearAnimationCache() {
    animations_cache = {};
}

// Global state for lip sync cleanup between chunks
let currentLipSyncCleanup = null;
let audioLipSyncCharacter = null;

// Real-time lip sync using VoiceForge's shared analyser
// Much simpler than per-chunk analysis - just reads actual audio output
let realtimeLipSyncActive = false;
let realtimeLipSyncCharacter = null;
let realtimeLipSyncAnimationId = null;
let realtimeLipSyncLastUpdate = 0;
let realtimeLipSyncFrequencyData = null;

const REALTIME_MOUTH_THRESHOLD = 22;  // Higher threshold - mouth only opens on clear audio
const REALTIME_MOUTH_BOOST = 8;
const REALTIME_VOWEL_DAMP = 60;
const REALTIME_VOWEL_MIN = 18;
const REALTIME_MOUTH_CUTOFF = 0.1;  // Snap to 0 below this threshold
const REALTIME_UPDATE_INTERVAL = 16; // ~60fps for smoother animation
const EXPRESSION_SET_EPSILON = 0.01;
const VRM_VISEMES = ['aa', 'ee', 'ih', 'oh', 'ou'];
const VRM_BLINK_EXPRESSIONS = ['blink', 'blinkLeft', 'blinkRight'];
const VRM_VISEME_SET = new Set(VRM_VISEMES);
const VRM_BLINK_SET = new Set(VRM_BLINK_EXPRESSIONS);

// Per-viseme decay rates - very aggressive for snappy closure at 60fps
const VISEME_DECAY = {
    aa: 0.5,   // Open mouth - decay per frame at 60fps
    ee: 0.45,  // Spread lips - fast
    ih: 0.45,  // Similar to ee
    oh: 0.55,  // Round mouth - slightly slower
    ou: 0.5,   // Pucker
};

function setExpressionIfChanged(expressionMgr, name, value, epsilon = EXPRESSION_SET_EPSILON) {
    if (!expressionMgr) return;
    const clamped = Math.max(0, Math.min(1, Number(value) || 0));
    const current = expressionMgr.getValue(name) || 0;
    if (Math.abs(current - clamped) >= epsilon || (clamped === 0 && current !== 0)) {
        expressionMgr.setValue(name, clamped);
    }
}

function updateRealtimeLipSync(now = Date.now()) {
    if (!realtimeLipSyncActive || !realtimeLipSyncCharacter) return;
    if (now - realtimeLipSyncLastUpdate < REALTIME_UPDATE_INTERVAL) return;

    const character = realtimeLipSyncCharacter;
    const analyser = window.getVoiceForgeAnalyser?.();
    const avatar = current_avatars[character];
    const expressionMgr = avatar?.vrm?.expressionManager;
    if (!analyser || !expressionMgr) return;

    realtimeLipSyncLastUpdate = now;

    if (!realtimeLipSyncFrequencyData || realtimeLipSyncFrequencyData.length !== analyser.frequencyBinCount) {
        realtimeLipSyncFrequencyData = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(realtimeLipSyncFrequencyData);
    const array = realtimeLipSyncFrequencyData;

    const binCount = array.length;
    const sampleRate = analyser.context?.sampleRate || 48000;
    const binHz = sampleRate / (binCount * 2);
    const veryLowEnd = Math.floor(400 / binHz);
    const lowEnd = Math.floor(800 / binHz);
    const midEnd = Math.floor(1500 / binHz);
    const highEnd = Math.floor(2500 / binHz);

    let veryLowSum = 0, lowSum = 0, midSum = 0, highSum = 0, totalSum = 0;
    const analysisEnd = Math.min(binCount, highEnd + 50);
    for (let i = 0; i < analysisEnd; i++) {
        const val = array[i];
        totalSum += val;
        if (i < veryLowEnd) veryLowSum += val;
        else if (i < lowEnd) lowSum += val;
        else if (i < midEnd) midSum += val;
        else if (i < highEnd) highSum += val;
    }

    const veryLowAvg = veryLowSum / Math.max(1, veryLowEnd);
    const lowAvg = lowSum / Math.max(1, lowEnd - veryLowEnd);
    const midAvg = midSum / Math.max(1, midEnd - lowEnd);
    const highAvg = highSum / Math.max(1, highEnd - midEnd);
    const totalAvg = totalSum / Math.max(1, analysisEnd);

    if (totalAvg > (REALTIME_MOUTH_THRESHOLD * 2)) {
        const nonVisemes = avatar.expressions?.nonVisemes || [];
        for (const expression of nonVisemes) {
            setExpressionIfChanged(expressionMgr, expression, Math.min(0.25, expressionMgr.getValue(expression) || 0), 0.02);
        }

        const baseOpen = Math.min(1.0, ((totalAvg - REALTIME_VOWEL_MIN) / REALTIME_VOWEL_DAMP) * (REALTIME_MOUTH_BOOST / 10));
        const totalEnergy = veryLowAvg + lowAvg + midAvg + highAvg + 0.1;
        const ouWeight = (veryLowAvg * 1.5) / totalEnergy;
        const ohWeight = (lowAvg * 1.3 + veryLowAvg * 0.5) / totalEnergy;
        const aaWeight = (midAvg * 1.5 + lowAvg * 0.5) / totalEnergy;
        const eeWeight = (highAvg * 0.8 + midAvg * 0.4) / totalEnergy;
        const ihWeight = (highAvg * 1.2) / totalEnergy;

        setExpressionIfChanged(expressionMgr, "ou", baseOpen * ouWeight * 1.0);
        setExpressionIfChanged(expressionMgr, "oh", baseOpen * ohWeight * 1.1);
        setExpressionIfChanged(expressionMgr, "aa", baseOpen * aaWeight * 1.3);
        setExpressionIfChanged(expressionMgr, "ee", baseOpen * eeWeight * 0.9);
        setExpressionIfChanged(expressionMgr, "ih", baseOpen * ihWeight * 0.7);
    } else {
        for (const name of VRM_VISEMES) {
            const current = expressionMgr.getValue(name) || 0;
            const decayed = current * VISEME_DECAY[name];
            setExpressionIfChanged(expressionMgr, name, decayed < REALTIME_MOUTH_CUTOFF ? 0 : decayed);
        }
    }
}

function startRealtimeLipSync(character) {
    if (!extension_settings.vrm.tts_lips_sync) return;

    if (realtimeLipSyncActive && realtimeLipSyncCharacter === character) {
        return; // Already running for this character
    }
    
    stopRealtimeLipSync(); // Stop any existing
    
    realtimeLipSyncActive = true;
    realtimeLipSyncCharacter = character;
    realtimeLipSyncLastUpdate = 0;
    markUserActivity("tts-lipsync-start");
    
    console.debug(DEBUG_PREFIX, "Starting real-time lip sync for", character);
}

function stopRealtimeLipSync() {
    if (realtimeLipSyncAnimationId) {
        cancelAnimationFrame(realtimeLipSyncAnimationId);
        realtimeLipSyncAnimationId = null;
    }
    
    // Close mouth
    if (realtimeLipSyncCharacter && current_avatars[realtimeLipSyncCharacter]) {
        const expressionMgr = current_avatars[realtimeLipSyncCharacter]["vrm"].expressionManager;
        expressionMgr.setValue("aa", 0);
        expressionMgr.setValue("ee", 0);
        expressionMgr.setValue("ih", 0);
        expressionMgr.setValue("oh", 0);
        expressionMgr.setValue("ou", 0);
    }
    
    realtimeLipSyncActive = false;
    realtimeLipSyncCharacter = null;
    realtimeLipSyncFrequencyData = null;
    console.debug(DEBUG_PREFIX, "Stopped real-time lip sync");
}

// Expose for VoiceForge to control
window.vrmStartLipSync = startRealtimeLipSync;
window.vrmStopLipSync = stopRealtimeLipSync;

// Generic API for any TTS provider to trigger lip sync
// Other TTS extensions can call: window.vrmLipSyncAudio(audioBlob, characterName)
window.vrmLipSyncAudio = async function(blob, character) {
    if (!extension_settings.vrm.tts_lips_sync) return;
    if (!blob || !character) return;
    
    await audioTalk(blob, character, { webAudio: false });
};

// Perform audio lip sync
// Overried text mouth movement
// 
// Parameters:
//   blob: Audio blob to analyze
//   character: Character name for VRM model lookup
//   options: Optional object with:
//     - webAudio: true if using Web Audio API for playback (VoiceForge gapless mode)
//     - startTime: When audio will start playing (audioContext.currentTime value)
//     - audioContext: Shared audio context from caller (for sync with Web Audio playback)
//
async function audioTalk(blob, character, options = {}) {
    // Option disable
    if (!extension_settings.vrm.tts_lips_sync)
        return;
    markUserActivity("tts-audio");
    
    const useWebAudio = options.webAudio === true;
    if (!useWebAudio) {
        audioLipSyncCharacter = character;
    }
    
    // For Web Audio mode: use real-time lip sync from VoiceForge's shared analyser
    // Much simpler and more reliable than per-chunk analysis
    if (useWebAudio) {
        startRealtimeLipSync(character);
        return; // Real-time mode handles everything via animation loop
    }
    
    // Audio element mode: use legacy per-blob analysis
    if (currentLipSyncCleanup) {
        try {
            currentLipSyncCleanup();
        } catch (e) {
            console.debug(DEBUG_PREFIX, "Previous cleanup error (safe to ignore):", e.message);
        }
        currentLipSyncCleanup = null;
    }
    
    tts_lips_sync_job_id++;
    const job_id = tts_lips_sync_job_id;
    console.debug(DEBUG_PREFIX, "Received lipsync", blob, character, job_id, "(Audio Element mode)");

    // Track state - set up BEFORE any async work
    let sourceStarted = false;
    let endTalkCalled = false;
    let audioReady = false;
    let audioContext = null;
    let analyser = null;
    let source = null;
    let javascriptNode = null;
    let frequencyData = null;
    let audioDuration = 0;
    let startTimestamp = 0;
    
    const mouththreshold = 8;   // Lower = responds to quieter audio (default 10)
    const mouthboost = 14;      // Higher = wider mouth opening (default 10)
    let lastUpdate = 0;
    const LIPS_SYNC_DELAY = 33;  // Faster updates for snappier lip sync (was 66ms = ~15fps, now ~30fps)
    const MOUTH_DECAY = 0.65;   // How fast mouth closes during silence (0-1, lower = faster close)
    
    // For Web Audio mode: track when this chunk SHOULD be playing
    const chunkStartTime = options.startTime || 0;  // audioContext time when chunk should start
    const contextTimeAtCreation = options.audioContext ? options.audioContext.currentTime : 0;
    
    // Decode audio in background (don't block)
    const setupAudio = async () => {
        try {
            // Use shared context if provided, otherwise create new one
            audioContext = options.audioContext || new(window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.smoothingTimeConstant = 0.5;
            analyser.fftSize = 1024;

            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            audioDuration = audioBuffer.duration;

            source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(analyser);

            // For Web Audio mode, don't connect to destination (VoiceForge handles actual playback)
            // Just use this for analysis
            javascriptNode = audioContext.createScriptProcessor(256, 1, 1);
            analyser.connect(javascriptNode);
            
            // Only connect to destination if we're not in Web Audio mode
            // In Web Audio mode, VoiceForge plays the audio, we just analyze
            if (!useWebAudio) {
                javascriptNode.connect(audioContext.destination);
            } else {
                // Create a silent destination for the script processor
                const silentGain = audioContext.createGain();
                silentGain.gain.value = 0;
                javascriptNode.connect(silentGain);
                silentGain.connect(audioContext.destination);
            }
            
            audioReady = true;
            
            // Set up source ended handler for clean termination
            // But NOT in Web Audio mode - chunks run in parallel and shouldn't terminate each other
            if (!useWebAudio) {
                source.onended = () => {
                    console.debug(DEBUG_PREFIX, "Lip sync source ended naturally");
                    if (!endTalkCalled) {
                        endTalk();
                    }
                };
            } else {
                // In Web Audio mode, just log when source ends (no termination)
                source.onended = () => {
                    console.debug(DEBUG_PREFIX, "Lip sync chunk analysis finished (Web Audio, not terminating)");
                };
            }
            
            // If audio already started playing, start the source now
            if (sourceStarted && !endTalkCalled) {
                // Always start immediately - time window checks in onAudioProcess handle timing
                source.start(0);
                javascriptNode.onaudioprocess = onAudioProcess;
                console.debug(DEBUG_PREFIX, "Lip sync (async) started, duration:", audioDuration.toFixed(2) + "s");
            }
        } catch (e) {
            console.debug(DEBUG_PREFIX, "Audio setup error:", e.message);
        }
    };
    
    // Start async setup but don't await
    setupAudio();

    var audio = document.getElementById("tts_audio");
    
    function endTalk() {
        // Prevent multiple calls
        if (endTalkCalled) return;
        endTalkCalled = true;
        
        // Clear global cleanup reference
        if (currentLipSyncCleanup === endTalk) {
            currentLipSyncCleanup = null;
        }
        
        try {
            if (source && sourceStarted) {
                source.stop(0);
            }
            if (source) source.disconnect();
            if (analyser) analyser.disconnect();
            if (javascriptNode) javascriptNode.disconnect();
            // Only close context if we created it (not shared)
            if (audioContext && !options.audioContext) audioContext.close();
        } catch (e) {
            // Ignore cleanup errors - nodes may already be disconnected
            console.debug(DEBUG_PREFIX, "Cleanup error (safe to ignore):", e.message);
        }
        
        // Only reset mouth visemes in audio element mode (single audio)
        // In Web Audio mode, another chunk might still be playing - don't reset
        if (!useWebAudio && current_avatars[character] !== undefined) {
            const expressionMgr = current_avatars[character]["vrm"].expressionManager;
            expressionMgr.setValue("aa", 0);
            expressionMgr.setValue("ee", 0);
            expressionMgr.setValue("ih", 0);
            expressionMgr.setValue("oh", 0);
            expressionMgr.setValue("ou", 0);
        }

        if (!useWebAudio && audioLipSyncCharacter === character) {
            audioLipSyncCharacter = null;
        }

        if (!useWebAudio) {
            audio.removeEventListener("play", startTalk);
            audio.removeEventListener("ended", endTalk);
        }
    }
    
    // Register this job's cleanup function globally
    currentLipSyncCleanup = endTalk;

    function startTalk() {
        if (sourceStarted || endTalkCalled) return; // Prevent double-start or start after cleanup
        sourceStarted = true;
        startTimestamp = Date.now();
        
        // If audio is ready, start the source and processing
        if (audioReady && source && !endTalkCalled) {
            try {
                // Always start immediately - we use time window checks in onAudioProcess
                // to determine when this chunk should actually animate
                source.start(0);
                javascriptNode.onaudioprocess = onAudioProcess;
                
                if (useWebAudio) {
                    console.debug(DEBUG_PREFIX, "Lip sync chunk started, window:", chunkStartTime.toFixed(2), "-", (chunkStartTime + audioDuration).toFixed(2) + "s");
                } else {
                    console.debug(DEBUG_PREFIX, "Lip sync source started, duration:", audioDuration.toFixed(2) + "s");
                }
            } catch (e) {
                console.debug(DEBUG_PREFIX, "Source start error:", e.message);
            }
        }
        // If not ready yet, setupAudio() will start it when done
        
        if (!useWebAudio) {
            audio.removeEventListener("play", startTalk);
        }
    }
    
    function onAudioProcess() {
        // Don't process if not ready or already ended
        if (!audioReady || !sourceStarted || endTalkCalled) {
            return;
        }
        
        // Check for termination conditions
        if (useWebAudio) {
            // In Web Audio mode, check if we're within this chunk's expected playback window
            // This prevents early chunks from interfering with later chunks' animation
            if (audioContext && audioDuration > 0) {
                const now = audioContext.currentTime;
                const chunkEnd = chunkStartTime + audioDuration;
                
                // Only animate if we're within this chunk's playback window (with small buffer)
                if (now < chunkStartTime - 0.1 || now > chunkEnd + 0.3) {
                    // Outside our window - don't animate, let other chunks handle it
                    return;
                }
            }
        } else {
            // In audio element mode, check audio state
            if (job_id != tts_lips_sync_job_id || audio.paused) {
                console.debug(DEBUG_PREFIX, "TTS lip sync job", job_id, "terminated");
                endTalk();
                return;
            }
        }

        if (!frequencyData || frequencyData.length !== analyser.frequencyBinCount) {
            frequencyData = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(frequencyData);
        const array = frequencyData;

        // Frequency band analysis for viseme selection
        // Split spectrum into bands for different mouth shapes
        const binCount = array.length;
        const lowEnd = Math.floor(binCount * 0.15);   // 0-15% = low frequencies (oh/ou)
        const midEnd = Math.floor(binCount * 0.4);    // 15-40% = mid frequencies (aa)
        const highEnd = Math.floor(binCount * 0.7);   // 40-70% = high frequencies (ee/ih)

        let lowSum = 0, midSum = 0, highSum = 0, totalSum = 0;
        for (let i = 0; i < binCount; i++) {
            totalSum += array[i];
            if (i < lowEnd) lowSum += array[i];
            else if (i < midEnd) midSum += array[i];
            else if (i < highEnd) highSum += array[i];
        }

        // Normalize by band size
        const lowAvg = lowSum / lowEnd;
        const midAvg = midSum / (midEnd - lowEnd);
        const highAvg = highSum / (highEnd - midEnd);
        const totalAvg = totalSum / binCount;

        var inputvolume = totalAvg * (audioContext.sampleRate / 48000); // Normalize threshold

        var voweldamp = 42;     // Lower = bigger movements (default 53)
        var vowelmin = 10;      // Lower = responds to quieter audio (default 12)

        if(lastUpdate < (Date.now() - LIPS_SYNC_DELAY)) {
            if (current_avatars[character] !== undefined) {
                const expressionMgr = current_avatars[character]["vrm"].expressionManager;

                if (inputvolume > (mouththreshold * 2)) {
                    // Neutralize other expressions only when we have audio to animate
                    for(const expression in expressionMgr.expressionMap) {
                        if (!['aa', 'ee', 'ih', 'oh', 'ou'].includes(expression)) {
                            expressionMgr.setValue(expression, Math.min(0.25, expressionMgr.getValue(expression)));
                        }
                    }

                    // Calculate base mouth opening
                    const baseOpen = Math.min(1.0, ((totalAvg - vowelmin) / voweldamp) * (mouthboost / 10));

                    // Determine dominant frequency band for viseme selection
                    const maxBand = Math.max(lowAvg, midAvg, highAvg);

                    if (maxBand > vowelmin) {
                        // Blend visemes based on frequency distribution
                        const lowWeight = lowAvg / (lowAvg + midAvg + highAvg + 0.1);
                        const midWeight = midAvg / (lowAvg + midAvg + highAvg + 0.1);
                        const highWeight = highAvg / (lowAvg + midAvg + highAvg + 0.1);

                        // Low frequencies = rounder mouth shapes (oh, ou)
                        // Mid frequencies = open mouth (aa)
                        // High frequencies = spread lips (ee, ih)

                        const ohValue = baseOpen * lowWeight * 1.2;
                        const ouValue = baseOpen * lowWeight * 0.8;
                        const aaValue = baseOpen * midWeight * 1.5;  // aa is primary
                        const eeValue = baseOpen * highWeight * 0.9;
                        const ihValue = baseOpen * highWeight * 0.6;

                        // Set all mouth visemes
                        expressionMgr.setValue("oh", Math.min(1.0, ohValue));
                        expressionMgr.setValue("ou", Math.min(1.0, ouValue));
                        expressionMgr.setValue("aa", Math.min(1.0, aaValue));
                        expressionMgr.setValue("ee", Math.min(1.0, eeValue));
                        expressionMgr.setValue("ih", Math.min(1.0, ihValue));
                    }
                }
                else {
                    // Silence detected - gradually close mouth (decay)
                    // This looks better than instant snap-shut, and handles gaps between chunks
                    const currentAa = expressionMgr.getValue("aa") || 0;
                    const currentEe = expressionMgr.getValue("ee") || 0;
                    const currentIh = expressionMgr.getValue("ih") || 0;
                    const currentOh = expressionMgr.getValue("oh") || 0;
                    const currentOu = expressionMgr.getValue("ou") || 0;

                    // Apply decay - mouth smoothly closes
                    expressionMgr.setValue("aa", currentAa * MOUTH_DECAY);
                    expressionMgr.setValue("ee", currentEe * MOUTH_DECAY);
                    expressionMgr.setValue("ih", currentIh * MOUTH_DECAY);
                    expressionMgr.setValue("oh", currentOh * MOUTH_DECAY);
                    expressionMgr.setValue("ou", currentOu * MOUTH_DECAY);
                }
            }
            lastUpdate = Date.now();
        }
    }

    if (useWebAudio) {
        // Web Audio mode: start immediately (VoiceForge handles actual playback timing)
        // The audio analysis runs in parallel with VoiceForge's scheduled playback
        startTalk();

        // Set up auto-end based on duration
        setupAudio().then(() => {
            if (audioDuration > 0 && !endTalkCalled) {
                setTimeout(() => {
                    if (!endTalkCalled && job_id === tts_lips_sync_job_id) {
                        endTalk();
                    }
                }, (audioDuration + 0.5) * 1000);
            }
        });
    } else {
        // Audio element mode: Set up event listeners IMMEDIATELY (synchronously) so they're ready when audio plays
        // The actual audio processing setup happens async in setupAudio()
        audio.addEventListener("play", startTalk, { once: true });
        audio.addEventListener("ended", endTalk, { once: true });
    }

    // TODO: restaure expression weight ?
}

window['vrmLipSync'] = audioTalk;

// color: any valid color format
// intensity: percent 0-100
function setLight(color,intensity) {

    light.color = new THREE.Color(color);
    light.intensity = intensity/100;
}

function setBackground(scenePath, scale, position, rotation) {

    if (background) {
        scene.remove(scene.getObjectByName(background.name));
    }

    if (scenePath.endsWith(".fbx")) {
        const fbxLoader = new FBXLoader()
        fbxLoader.load(
            scenePath,
        (object) => {
            // object.traverse(function (child) {
            //     if ((child as THREE.Mesh).isMesh) {
            //         // (child as THREE.Mesh).material = material
            //         if ((child as THREE.Mesh).material) {
            //             ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).transparent = false
            //         }
            //     }
            // })
            // object.scale.set(.01, .01, .01)
            background = object;
            background.scale.set(scale, scale, scale);
            background.position.set(position.x,position.y,position.z);
            background.rotation.set(rotation.x,rotation.y,rotation.z);
            background.name = "background";
            scene.add(background);
        },
        undefined,
        (error) => {
            console.error(DEBUG_PREFIX, 'Failed to load FBX background:', error)
        }
        )
    }

    if (scenePath.endsWith(".gltf")) {
        const loader = new GLTFLoader();

        loader.load( scenePath, function ( gltf ) {

            background = gltf.scene;
            background.scale.set(scale, scale, scale);
            background.position.set(position.x,position.y,position.z);
            background.rotation.set(rotation.x,rotation.y,rotation.z);
            scene.add(background);

        }, undefined, function ( error ) {

            console.error( error );

        } );
    }
}
