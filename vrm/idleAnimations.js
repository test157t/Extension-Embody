/**
 * Idle Animation System
 * Generates procedural AnimationClips for natural idle movements
 * These integrate with the AnimationMixer for proper fade in/out support
 */

import * as THREE from './lib/three.module.js';
import { DEBUG_PREFIX } from './constants.js';

/**
 * Generate a procedural idle animation clip
 * @param {VRM} vrm - The VRM instance
 * @param {Object} movementConfig - Configuration for the movement
 * @param {string} movementConfig.type - Movement type ('head', 'body', 'hips', etc.)
 * @param {number} movementConfig.duration - Duration in milliseconds
 * @param {Object} movementConfig.rotations - Map of bone names to rotation deltas {x, y, z}
 * @param {string} clipName - Name for the animation clip
 * @returns {THREE.AnimationClip} The generated animation clip
 */
export function generateIdleAnimationClip(vrm, movementConfig, clipName = 'naturalIdle') {
    const tracks = [];
    const duration = movementConfig.duration / 1000; // Convert to seconds
    const rampDuration = 3.5; // 3.5 seconds ramp up/down
    const holdDuration = duration - (rampDuration * 2);
    
    // Generate tracks for each bone
    for (const [boneName, rotation] of Object.entries(movementConfig.rotations)) {
        const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
        if (!bone) continue;
        
        const track = generateBoneTrack(bone, boneName, rotation, rampDuration, holdDuration);
        if (track) {
            tracks.push(track);
        }
    }
    
    if (tracks.length === 0) {
        console.warn(DEBUG_PREFIX, 'No valid bone tracks generated for idle animation:', clipName);
        return null;
    }
    
    return new THREE.AnimationClip(clipName, duration, tracks);
}

/**
 * Generate a quaternion keyframe track for a single bone
 * @param {THREE.Bone} bone - The bone to animate
 * @param {string} boneName - Name of the bone (VRM humanoid name)
 * @param {Object} rotationDelta - Euler rotation delta {x, y, z} in radians
 * @param {number} rampDuration - Ramp up/down duration in seconds
 * @param {number} holdDuration - Hold duration in seconds
 * @returns {THREE.QuaternionKeyframeTrack} The generated track
 */
function generateBoneTrack(bone, boneName, rotationDelta, rampDuration, holdDuration) {
    if (!bone || !bone.name) {
        console.warn(DEBUG_PREFIX, 'Invalid bone for track generation:', boneName);
        return null;
    }
    
    const baseQuat = bone.quaternion.clone();
    const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat);
    
    // Calculate target rotation
    const targetEuler = new THREE.Euler(
        baseEuler.x + (rotationDelta.x || 0),
        baseEuler.y + (rotationDelta.y || 0),
        baseEuler.z + (rotationDelta.z || 0)
    );
    const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
    
    // Create keyframes with easeInOutCubic interpolation
    const times = [0, rampDuration, rampDuration + holdDuration, rampDuration * 2 + holdDuration];
    const values = [];
    
    // Start at base
    values.push(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w);
    
    // Ramp up to target
    values.push(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w);
    
    // Hold at target
    values.push(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w);
    
    // Ramp down to base
    values.push(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w);
    
    // Track path: use the actual Three.js bone node name, not the VRM humanoid name
    const trackPath = bone.name + '.quaternion';
    return new THREE.QuaternionKeyframeTrack(trackPath, times, values);
}

/**
 * Movement definitions converted to rotation configurations
 * These generate procedural animations instead of manipulating bones directly
 */
export const IDLE_MOVEMENT_CONFIGS = {
  slowHeadTurn: {
    type: 'head',
    duration: 12000,
    description: 'slow head turn',
    rotations: {
      head: { x: 0.08, y: 0.35, z: 0.05 },
      neck: { x: 0.04, y: 0.15, z: 0.03 }
    },
    applyModelRotation: true,
    modelRotationRange: { min: 0.08, max: 0.18 }
  },
  headTilt: {
    type: 'head',
    duration: 12000,
    description: 'curious head tilt',
    rotations: {
      head: { x: 0.06, y: 0.08, z: 0.35 },
      neck: { x: 0.03, y: 0.05, z: 0.2 }
    },
    expressionChance: 0.5,
    expressions: ['happy', 'blinkLeft', 'blinkRight'],
    applyModelRotation: false
  },
  slowGlance: {
    type: 'head',
    duration: 10000,
    description: 'casual glance',
    rotations: {
      head: { x: 0.12, y: 0.28, z: 0.08 },
      neck: { x: 0.06, y: 0.15, z: 0.04 },
      spine: { x: 0.03, y: 0.12, z: 0.05 }
    },
    expressionChance: 0.5,
    expressions: ['surprised'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.05, max: 0.12 }
  },
  lookAround: {
    type: 'head',
    duration: 16000,
    description: 'looking around',
    rotations: {
      head: { x: 0.1, y: 0.25, z: 0.05 }
    },
    multiStage: true,
    stages: [
      { rotations: { head: { x: 0.12, y: 0.32, z: 0.04 } }, duration: 3500 },
      { rotations: { head: { x: 0.05, y: 0.08, z: 0.02 } }, duration: 2500 },
      { rotations: { head: { x: 0.1, y: -0.28, z: -0.03 } }, duration: 3500 },
      { rotations: { head: { x: 0.02, y: -0.06, z: 0.01 } }, duration: 3000 }
    ],
    expressionChance: 0.6,
    expressions: ['happy'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.06, max: 0.12 }
  },
  weightShift: {
    type: 'body',
    duration: 10000,
    description: 'weight shift with spine twist',
    rotations: {
      spine: { x: 0.08, y: 0.22, z: 0.15 },
      hips: { x: 0.06, y: -0.12, z: 0.12 },
      upperChest: { x: 0.04, y: 0.1, z: 0.08 }
    },
    expressionChance: 0.4,
    expressions: ['neutral'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.08, max: 0.18 }
  },
  neckStretch: {
    type: 'neck',
    duration: 10000,
    description: 'neck stretch',
    rotations: {
      neck: { x: 0.12, y: 0.25, z: 0.35 },
      head: { x: 0.08, y: 0.15, z: 0.28 }
    },
    expressionChance: 0.5,
    expressions: ['surprised'],
    applyModelRotation: false
  },
  subtleNod: {
    type: 'head',
    duration: 8000,
    description: 'subtle nod',
    rotations: {
      head: { x: 0.22, y: 0.05, z: 0.03 },
      neck: { x: 0.12, y: 0.03, z: 0.02 }
    },
    expressionChance: 0.7,
    expressions: ['happy'],
    applyModelRotation: false
  },
  hipShift: {
    type: 'hips',
    duration: 11000,
    description: 'hip shift with rotation',
    rotations: {
      hips: { x: 0.1, y: 0.25, z: 0.22 },
      spine: { x: 0.08, y: -0.15, z: -0.12 },
      upperChest: { x: 0.05, y: 0.08, z: 0.06 }
    },
    expressionChance: 0.4,
    expressions: ['surprised'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.08, max: 0.16 }
  },
  torsoSway: {
    type: 'torso',
    duration: 12000,
    description: 'torso sway with twist',
    rotations: {
      spine: { x: 0.1, y: 0.28, z: 0.12 },
      upperChest: { x: 0.08, y: 0.18, z: 0.1 },
      hips: { x: 0.05, y: -0.1, z: 0.08 }
    },
    expressionChance: 0.5,
    expressions: ['surprised', 'relaxed'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.08, max: 0.18 }
  },
  feminineHipSway: {
    type: 'hips',
    duration: 14000,
    description: 'feminine hip sway',
    rotations: {
      hips: { x: 0.08, y: 0.15, z: 0.35 },
      spine: { x: 0.06, y: -0.1, z: -0.18 },
      upperChest: { x: 0.08, y: -0.12, z: -0.12 },
      neck: { x: 0.04, y: -0.08, z: 0.1 }
    },
    expressionChance: 0.7,
    expressions: ['happy'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.06, max: 0.14 }
  },
  coyHeadTilt: {
    type: 'head',
    duration: 11000,
    description: 'coy head tilt',
    rotations: {
      head: { x: 0.15, y: 0.12, z: -0.38 },
      neck: { x: 0.08, y: 0.06, z: -0.22 }
    },
    expressionChance: 0.7,
    expressions: ['relaxed', 'shy'],
    applyModelRotation: false
  },
  chestLift: {
    type: 'chest',
    duration: 9000,
    description: 'chest lift',
    rotations: {
      upperChest: { x: 0.12, y: 0.04, z: 0.02 },
      spine: { x: 0.05, y: 0.03, z: 0.02 },
      neck: { x: -0.04, y: 0.02, z: 0.01 }
    },
    expressionChance: 0.6,
    expressions: ['happy', 'relaxed'],
    applyModelRotation: false
  },
  playfulHeadSway: {
    type: 'head',
    duration: 12800,
    description: 'playful head sway',
    multiStage: true,
    stages: [
      { rotations: { head: { x: 0.08, y: 0.14, z: 0.26 }, neck: { x: 0.05, y: 0.08, z: 0.16 }, upperChest: { x: 0.04, y: -0.04, z: -0.05 } }, duration: 3200 },
      { rotations: { head: { x: 0.05, y: 0.03, z: 0.08 }, neck: { x: 0.03, y: 0.02, z: 0.04 }, upperChest: { x: 0.03, y: 0.01, z: -0.02 } }, duration: 1800 },
      { rotations: { head: { x: 0.1, y: -0.18, z: -0.3 }, neck: { x: 0.06, y: -0.1, z: -0.18 }, upperChest: { x: 0.04, y: 0.05, z: 0.06 } }, duration: 3300 },
      { rotations: { head: { x: 0.04, y: -0.04, z: -0.07 }, neck: { x: 0.02, y: -0.02, z: -0.04 }, upperChest: { x: 0.02, y: 0.01, z: 0.02 } }, duration: 1900 }
    ],
    expressionChance: 0.8,
    expressions: ['happy', 'blinkLeft', 'blinkRight', 'shy'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.05, max: 0.11 }
  },
  bashfulShoulderDip: {
    type: 'torso',
    duration: 11800,
    description: 'bashful shoulder dip',
    multiStage: true,
    stages: [
      { rotations: { upperChest: { x: 0.09, y: -0.04, z: 0.18 }, spine: { x: 0.05, y: -0.03, z: 0.1 }, neck: { x: 0.05, y: 0.03, z: -0.1 }, head: { x: 0.07, y: 0.04, z: -0.16 } }, duration: 3000 },
      { rotations: { upperChest: { x: 0.04, y: -0.01, z: 0.06 }, spine: { x: 0.03, y: -0.01, z: 0.03 }, neck: { x: 0.03, y: 0.01, z: -0.04 }, head: { x: 0.04, y: 0.02, z: -0.06 } }, duration: 1600 },
      { rotations: { upperChest: { x: 0.08, y: 0.04, z: -0.2 }, spine: { x: 0.05, y: 0.03, z: -0.12 }, neck: { x: 0.05, y: -0.03, z: 0.1 }, head: { x: 0.07, y: -0.05, z: 0.18 } }, duration: 3200 },
      { rotations: { upperChest: { x: 0.03, y: 0.01, z: -0.05 }, spine: { x: 0.02, y: 0.01, z: -0.03 }, neck: { x: 0.02, y: -0.01, z: 0.03 }, head: { x: 0.03, y: -0.02, z: 0.05 } }, duration: 1700 }
    ],
    expressionChance: 0.82,
    expressions: ['shy', 'relaxed', 'happy'],
    applyModelRotation: false
  },
  flirtyLeanIn: {
    type: 'torso',
    duration: 11200,
    description: 'flirty lean in',
    multiStage: true,
    stages: [
      { rotations: { spine: { x: 0.1, y: 0.1, z: 0.05 }, upperChest: { x: 0.09, y: 0.07, z: 0.04 }, neck: { x: 0.02, y: 0.07, z: -0.05 }, head: { x: 0.03, y: 0.12, z: -0.09 }, hips: { x: 0.03, y: -0.05, z: 0.04 } }, duration: 3000 },
      { rotations: { spine: { x: 0.14, y: 0.16, z: 0.08 }, upperChest: { x: 0.12, y: 0.11, z: 0.06 }, neck: { x: 0.03, y: 0.1, z: -0.07 }, head: { x: 0.04, y: 0.18, z: -0.12 }, hips: { x: 0.04, y: -0.08, z: 0.06 } }, duration: 2500 },
      { rotations: { spine: { x: 0.08, y: 0.04, z: 0.03 }, upperChest: { x: 0.07, y: 0.03, z: 0.02 }, neck: { x: 0.02, y: 0.05, z: -0.03 }, head: { x: 0.02, y: 0.09, z: -0.05 }, hips: { x: 0.02, y: -0.03, z: 0.02 } }, duration: 1800 },
      { rotations: { spine: { x: 0.11, y: -0.08, z: -0.05 }, upperChest: { x: 0.09, y: -0.05, z: -0.04 }, neck: { x: 0.02, y: -0.04, z: 0.04 }, head: { x: 0.02, y: -0.1, z: 0.08 }, hips: { x: 0.03, y: 0.05, z: -0.04 } }, duration: 2300 }
    ],
    expressionChance: 0.85,
    expressions: ['happy', 'relaxed', 'blinkLeft', 'blinkRight'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.06, max: 0.13 }
  },
  cuteBounceShift: {
    type: 'hips',
    duration: 12600,
    description: 'cute bounce shift',
    multiStage: true,
    stages: [
      { rotations: { hips: { x: 0.06, y: 0.1, z: 0.16 }, spine: { x: 0.08, y: -0.06, z: -0.08 }, upperChest: { x: 0.06, y: -0.04, z: -0.06 }, neck: { x: 0.02, y: 0.04, z: 0.07 } }, duration: 2300 },
      { rotations: { hips: { x: 0.08, y: 0.05, z: 0.1 }, spine: { x: 0.12, y: -0.03, z: -0.05 }, upperChest: { x: 0.09, y: -0.02, z: -0.03 }, neck: { x: 0.04, y: 0.03, z: 0.05 } }, duration: 1900 },
      { rotations: { hips: { x: 0.06, y: -0.11, z: -0.17 }, spine: { x: 0.08, y: 0.07, z: 0.09 }, upperChest: { x: 0.06, y: 0.04, z: 0.06 }, neck: { x: 0.02, y: -0.04, z: -0.07 } }, duration: 2400 },
      { rotations: { hips: { x: 0.08, y: -0.05, z: -0.1 }, spine: { x: 0.12, y: 0.03, z: 0.05 }, upperChest: { x: 0.09, y: 0.02, z: 0.03 }, neck: { x: 0.04, y: -0.03, z: -0.05 } }, duration: 2000 }
    ],
    expressionChance: 0.78,
    expressions: ['happy', 'shy', 'relaxed'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.04, max: 0.1 }
  },
  softTwirlPrep: {
    type: 'body',
    duration: 12200,
    description: 'soft twirl prep',
    rotations: {
      hips: { x: 0.05, y: 0.22, z: 0.16 },
      spine: { x: 0.07, y: 0.14, z: 0.08 },
      upperChest: { x: 0.05, y: 0.1, z: 0.05 },
      neck: { x: -0.03, y: 0.06, z: -0.08 },
      head: { x: -0.04, y: 0.11, z: -0.14 }
    },
    expressionChance: 0.75,
    expressions: ['happy', 'relaxed'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.08, max: 0.16 }
  },
  teasingLookAway: {
    type: 'head',
    duration: 12400,
    description: 'teasing look away',
    multiStage: true,
    stages: [
      { rotations: { head: { x: 0.06, y: -0.16, z: 0.18 }, neck: { x: 0.04, y: -0.09, z: 0.11 }, upperChest: { x: 0.04, y: 0.05, z: -0.06 } }, duration: 2800 },
      { rotations: { head: { x: 0.08, y: -0.24, z: 0.26 }, neck: { x: 0.05, y: -0.13, z: 0.16 }, upperChest: { x: 0.04, y: 0.07, z: -0.08 } }, duration: 2300 },
      { rotations: { head: { x: 0.04, y: -0.06, z: 0.08 }, neck: { x: 0.03, y: -0.03, z: 0.05 }, upperChest: { x: 0.03, y: 0.02, z: -0.03 } }, duration: 1700 },
      { rotations: { head: { x: 0.06, y: 0.12, z: -0.14 }, neck: { x: 0.04, y: 0.07, z: -0.08 }, upperChest: { x: 0.03, y: -0.04, z: 0.05 } }, duration: 2500 }
    ],
    expressionChance: 0.86,
    expressions: ['relaxed', 'happy', 'blinkLeft', 'blinkRight', 'shy'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.06, max: 0.12 }
  },
  slowSeductiveSway: {
    type: 'torso',
    duration: 14400,
    description: 'slow seductive sway',
    multiStage: true,
    stages: [
      { rotations: { hips: { x: 0.05, y: 0.16, z: 0.2 }, spine: { x: 0.08, y: 0.12, z: 0.09 }, upperChest: { x: 0.08, y: 0.08, z: 0.07 }, neck: { x: 0.02, y: 0.06, z: -0.05 }, head: { x: 0.03, y: 0.08, z: -0.08 } }, duration: 3600 },
      { rotations: { hips: { x: 0.06, y: 0.03, z: 0.08 }, spine: { x: 0.1, y: 0.02, z: 0.03 }, upperChest: { x: 0.1, y: 0.01, z: 0.02 }, neck: { x: 0.03, y: 0.04, z: -0.02 }, head: { x: 0.03, y: 0.06, z: -0.04 } }, duration: 2000 },
      { rotations: { hips: { x: 0.05, y: -0.17, z: -0.21 }, spine: { x: 0.08, y: -0.13, z: -0.1 }, upperChest: { x: 0.08, y: -0.08, z: -0.08 }, neck: { x: 0.02, y: -0.06, z: 0.05 }, head: { x: 0.03, y: -0.09, z: 0.09 } }, duration: 3700 },
      { rotations: { hips: { x: 0.06, y: -0.03, z: -0.09 }, spine: { x: 0.1, y: -0.02, z: -0.04 }, upperChest: { x: 0.1, y: -0.01, z: -0.03 }, neck: { x: 0.03, y: -0.04, z: 0.02 }, head: { x: 0.03, y: -0.06, z: 0.04 } }, duration: 2100 }
    ],
    expressionChance: 0.83,
    expressions: ['relaxed', 'happy'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.08, max: 0.17 }
  },
  seductiveHipSway: {
    enabled: true,
    type: 'hips',
    duration: 15200,
    description: 'seductive hip sway',
    proceduralLayers: true,
    sampleRate: 30,
    layers: [
      {
        mode: 'sine',
        frequencyHz: 0.21,
        phase: 0.2,
        attackSec: 1.2,
        releaseSec: 1.5,
        bones: {
          hips: { x: 0.03, y: 0.08, z: 0.12 },
          spine: { x: 0.04, y: -0.03, z: -0.05 },
          upperChest: { x: 0.05, y: -0.015, z: -0.025 }
        }
      },
      {
        mode: 'sine',
        frequencyHz: 0.42,
        phase: 1.25,
        startSec: 0.8,
        endSec: 13.8,
        attackSec: 0.9,
        releaseSec: 1.2,
        bones: {
          hips: { x: 0.01, y: 0.03, z: 0.045 },
          spine: { x: 0.015, y: -0.015, z: -0.02 },
          upperChest: { x: 0.015, y: -0.01, z: -0.01 }
        }
      },
      {
        mode: 'sine',
        frequencyHz: 0.21,
        phase: 0.65,
        attackSec: 1.4,
        releaseSec: 1.6,
        bones: {
          neck: { x: 0.015, y: 0.02, z: 0.025 },
          head: { x: 0.015, y: 0.03, z: 0.03 }
        }
      }
    ],
    expressionChance: 0.8,
    expressions: ['relaxed', 'happy', 'blinkLeft', 'blinkRight'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.03, max: 0.07 }
  },
  comeCloserLean: {
    type: 'torso',
    duration: 11800,
    description: 'come closer lean',
    multiStage: true,
    stages: [
      { rotations: { spine: { x: 0.1, y: 0.08, z: 0.04 }, upperChest: { x: 0.09, y: 0.07, z: 0.03 }, neck: { x: 0.02, y: 0.08, z: -0.05 }, head: { x: 0.03, y: 0.14, z: -0.09 }, hips: { x: 0.03, y: -0.05, z: 0.03 } }, duration: 2800 },
      { rotations: { spine: { x: 0.15, y: 0.12, z: 0.06 }, upperChest: { x: 0.13, y: 0.1, z: 0.05 }, neck: { x: 0.03, y: 0.11, z: -0.07 }, head: { x: 0.04, y: 0.18, z: -0.12 }, hips: { x: 0.04, y: -0.08, z: 0.05 } }, duration: 2400 },
      { rotations: { spine: { x: 0.08, y: 0.03, z: 0.01 }, upperChest: { x: 0.07, y: 0.02, z: 0.01 }, neck: { x: 0.02, y: 0.05, z: -0.02 }, head: { x: 0.02, y: 0.08, z: -0.04 }, hips: { x: 0.02, y: -0.02, z: 0.01 } }, duration: 1800 },
      { rotations: { spine: { x: 0.11, y: -0.07, z: -0.04 }, upperChest: { x: 0.09, y: -0.05, z: -0.03 }, neck: { x: 0.02, y: -0.05, z: 0.04 }, head: { x: 0.02, y: -0.11, z: 0.07 }, hips: { x: 0.03, y: 0.05, z: -0.03 } }, duration: 2400 }
    ],
    expressionChance: 0.88,
    expressions: ['relaxed', 'happy', 'blinkLeft', 'blinkRight'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.06, max: 0.12 }
  },
  overShoulderGlance: {
    type: 'head',
    duration: 13400,
    description: 'over shoulder glance',
    multiStage: true,
    stages: [
      { rotations: { head: { x: 0.05, y: 0.18, z: -0.12 }, neck: { x: 0.04, y: 0.1, z: -0.07 }, spine: { x: 0.03, y: 0.06, z: -0.04 }, hips: { x: 0.02, y: -0.03, z: 0.03 } }, duration: 3000 },
      { rotations: { head: { x: 0.06, y: 0.32, z: -0.22 }, neck: { x: 0.05, y: 0.18, z: -0.13 }, spine: { x: 0.04, y: 0.12, z: -0.08 }, hips: { x: 0.03, y: -0.07, z: 0.05 } }, duration: 3000 },
      { rotations: { head: { x: 0.04, y: 0.07, z: -0.05 }, neck: { x: 0.03, y: 0.04, z: -0.03 }, spine: { x: 0.02, y: 0.02, z: -0.01 }, hips: { x: 0.02, y: -0.01, z: 0.01 } }, duration: 1700 },
      { rotations: { head: { x: 0.05, y: -0.12, z: 0.08 }, neck: { x: 0.04, y: -0.07, z: 0.05 }, spine: { x: 0.03, y: -0.04, z: 0.03 }, hips: { x: 0.02, y: 0.03, z: -0.02 } }, duration: 2500 }
    ],
    expressionChance: 0.8,
    expressions: ['happy', 'relaxed', 'shy'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.06, max: 0.14 }
  },
  lipBitePose: {
    type: 'head',
    duration: 9800,
    description: 'lip bite pose',
    rotations: {
      head: { x: 0.03, y: 0.14, z: -0.24 },
      neck: { x: 0.02, y: 0.08, z: -0.13 },
      upperChest: { x: 0.05, y: -0.02, z: 0.05 }
    },
    expressionChance: 0.88,
    expressions: ['shy', 'relaxed', 'blinkLeft', 'blinkRight'],
    applyModelRotation: false
  },
  chestAdjustGesture: {
    enabled: true,
    type: 'body',
    duration: 9800,
    description: 'chest adjust gesture',
    liftScaleRange: { min: 1.06, max: 1.34 },
    dropScaleRange: { min: 0.96, max: 1.5 },
    proceduralLayers: true,
    sampleRate: 30,
    layers: [
      {
        mode: 'pulse',
        centerSec: 3.3,
        widthSec: 0.95,
        attackSec: 0.7,
        releaseSec: 1.1,
        startSec: 1.1,
        endSec: 5.8,
        bones: {
          leftShoulder: { x: 0.035, y: 0.02, z: 0.07 },
          rightShoulder: { x: 0.035, y: -0.02, z: -0.07 },
          leftUpperArm: { x: -0.34, y: 0.07, z: 0.17 },
          rightUpperArm: { x: -0.34, y: -0.07, z: -0.17 },
          leftLowerArm: { x: -0.8, y: 0.04, z: 0.11 },
          rightLowerArm: { x: -0.8, y: -0.04, z: -0.11 },
          leftHand: { x: -0.28, y: 0.03, z: 0.08 },
          rightHand: { x: -0.28, y: -0.03, z: -0.08 },
          upperChest: { x: 0.055, y: 0.0, z: 0.03 },
          head: { x: 0.04, y: 0.045, z: -0.09 }
        }
      },
      {
        mode: 'pulse',
        centerSec: 6.0,
        widthSec: 0.7,
        attackSec: 0.45,
        releaseSec: 0.85,
        startSec: 5.1,
        endSec: 7.5,
        bones: {
          leftShoulder: { x: -0.01, y: -0.015, z: -0.03 },
          rightShoulder: { x: -0.01, y: 0.015, z: 0.03 },
          leftUpperArm: { x: 0.11, y: -0.03, z: -0.08 },
          rightUpperArm: { x: 0.11, y: 0.03, z: 0.08 },
          leftLowerArm: { x: 0.2, y: -0.02, z: -0.06 },
          rightLowerArm: { x: 0.2, y: 0.02, z: 0.06 },
          leftHand: { x: 0.1, y: -0.01, z: -0.04 },
          rightHand: { x: 0.1, y: 0.01, z: 0.04 },
          upperChest: { x: -0.01, y: 0.0, z: -0.01 }
        }
      },
      {
        mode: 'sine',
        frequencyHz: 0.28,
        phase: 0.9,
        attackSec: 1.1,
        releaseSec: 1.1,
        bones: {
          head: { x: 0.01, y: 0.02, z: -0.04 },
          neck: { x: 0.01, y: 0.015, z: -0.02 }
        }
      }
    ],
    expressionChance: 0.85,
    expressions: ['blinkLeft', 'blinkRight', 'shy', 'happy'],
    applyModelRotation: false
  },
  chestShakeTease: {
    type: 'chest',
    duration: 8600,
    description: 'chest shake tease',
    proceduralLayers: true,
    sampleRate: 30,
    layers: [
      {
        mode: 'sine',
        frequencyHz: 1.35,
        phase: 0.15,
        startSec: 1.2,
        endSec: 6.9,
        attackSec: 0.9,
        releaseSec: 1.0,
        bones: {
          upperChest: { x: 0.025, y: 0.0, z: 0.018 },
          chest: { x: 0.02, y: 0.0, z: 0.015 },
          spine: { x: 0.012, y: 0.0, z: 0.01 }
        }
      },
      {
        mode: 'sine',
        frequencyHz: 0.34,
        phase: 0.55,
        attackSec: 1.2,
        releaseSec: 1.2,
        bones: {
          hips: { x: 0.015, y: 0.025, z: 0.03 },
          spine: { x: 0.015, y: -0.01, z: -0.015 },
          upperChest: { x: 0.02, y: -0.01, z: -0.01 },
          head: { x: 0.01, y: 0.015, z: -0.03 },
          neck: { x: 0.01, y: 0.01, z: -0.015 }
        }
      }
    ],
    expressionChance: 0.7,
    expressions: ['happy', 'relaxed', 'blinkLeft', 'blinkRight'],
    applyModelRotation: true,
    modelRotationRange: { min: 0.03, max: 0.07 }
  }
};

/**
 * Generate a multi-stage animation clip (e.g., lookAround with multiple positions)
 * @param {VRM} vrm - The VRM instance
 * @param {Object} config - Movement configuration
 * @returns {THREE.AnimationClip} The generated animation clip
 */
export function generateMultiStageAnimationClip(vrm, config) {
    const tracks = [];
    let maxDuration = 0;
    
    // Collect all bone names used across stages
    const allBones = new Set();
    config.stages.forEach(stage => {
        Object.keys(stage.rotations).forEach(bone => allBones.add(bone));
    });
    
    // Generate tracks for each bone
    for (const boneName of allBones) {
        const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
        if (!bone) continue;
        
        const baseQuat = bone.quaternion.clone();
        const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat);
        
        const times = [0];
        const values = [baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w];
        
        let currentTime = 0;
        
        for (const stage of config.stages) {
            const stageDuration = stage.duration / 1000;
            const rotation = stage.rotations[boneName] || { x: 0, y: 0, z: 0 };
            
            // Target rotation
            const targetEuler = new THREE.Euler(
                baseEuler.x + (rotation.x || 0),
                baseEuler.y + (rotation.y || 0),
                baseEuler.z + (rotation.z || 0)
            );
            const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
            
            // Transition to target
            currentTime += stageDuration;
            times.push(currentTime);
            values.push(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w);
        }
        
        // Return to base
        const returnDuration = 2500 / 1000;
        currentTime += returnDuration;
        times.push(currentTime);
        values.push(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w);
        
        // Track max duration across all bones
        if (currentTime > maxDuration) {
            maxDuration = currentTime;
        }
        
        // Use the actual Three.js bone node name, not the VRM humanoid name
        const trackPath = bone.name + '.quaternion';
        tracks.push(new THREE.QuaternionKeyframeTrack(trackPath, times, values));
    }
    
    if (tracks.length === 0) return null;
    
    return new THREE.AnimationClip(config.description.replace(/\s+/g, ''), maxDuration, tracks);
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function smoothstep01(value) {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}

function computeLayerEnvelope(layer, timeSec, durationSec) {
    const start = Math.max(0, layer.startSec || 0);
    const end = Math.max(start, layer.endSec != null ? layer.endSec : durationSec);
    if (timeSec < start || timeSec > end) {
        return 0;
    }

    const attack = Math.max(0.001, layer.attackSec || 0.6);
    const release = Math.max(0.001, layer.releaseSec || 0.6);
    const fadeIn = smoothstep01((timeSec - start) / attack);
    const fadeOut = smoothstep01((end - timeSec) / release);
    return Math.min(fadeIn, fadeOut);
}

function computeLayerSignal(layer, timeSec) {
    const mode = layer.mode || 'sine';
    const phase = layer.phase || 0;

    if (mode === 'pulse') {
        const center = layer.centerSec || 0;
        const width = Math.max(0.02, layer.widthSec || 0.2);
        const norm = (timeSec - center) / width;
        return Math.exp(-(norm * norm));
    }

    const frequency = Math.max(0.01, layer.frequencyHz || 0.2);
    const omega = Math.PI * 2 * frequency;
    const sine = Math.sin((omega * timeSec) + phase);

    if (mode === 'triangle') {
        return (2 / Math.PI) * Math.asin(sine);
    }

    return sine;
}

export function generateLayeredProceduralClip(vrm, config, clipName = 'layeredIdle') {
    const durationSec = Math.max(2, (config.duration || 10000) / 1000);
    const fps = Math.max(12, Math.min(60, config.sampleRate || 30));
    const dt = 1 / fps;
    const layers = Array.isArray(config.layers) ? config.layers : [];
    if (!layers.length) {
        return null;
    }

    const boneNames = new Set();
    for (const layer of layers) {
        const bones = layer?.bones || {};
        for (const boneName of Object.keys(bones)) {
            boneNames.add(boneName);
        }
    }

    const tracks = [];

    for (const boneName of boneNames) {
        const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
        if (!bone) {
            continue;
        }

        const baseQuat = bone.quaternion.clone();
        const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat);
        const times = [];
        const values = [];

        for (let t = 0; t <= durationSec + 0.0001; t += dt) {
            let dx = 0;
            let dy = 0;
            let dz = 0;

            for (const layer of layers) {
                const boneDelta = layer?.bones?.[boneName];
                if (!boneDelta) {
                    continue;
                }

                const envelope = computeLayerEnvelope(layer, t, durationSec);
                if (envelope <= 0) {
                    continue;
                }

                const signal = computeLayerSignal(layer, t);
                const weight = envelope * signal;
                dx += (boneDelta.x || 0) * weight;
                dy += (boneDelta.y || 0) * weight;
                dz += (boneDelta.z || 0) * weight;
            }

            const targetEuler = new THREE.Euler(baseEuler.x + dx, baseEuler.y + dy, baseEuler.z + dz);
            const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
            times.push(Math.min(t, durationSec));
            values.push(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w);
        }

        tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
    }

    if (!tracks.length) {
        return null;
    }

    return new THREE.AnimationClip(clipName, durationSec, tracks);
}

/**
 * Generate a random variation of a movement configuration
 * @param {Object} baseConfig - Base movement configuration
 * @returns {Object} Randomized configuration
 */
export function randomizeMovementConfig(baseConfig) {
    const config = JSON.parse(JSON.stringify(baseConfig)); // Deep copy

    const lateralDirection = Math.random() > 0.5 ? 1 : -1;
    const intensityScale = 0.98 + Math.random() * 0.36;

    const randomizeRotationObject = (rotationObj) => {
        for (const axis of ['x', 'y', 'z']) {
            const base = rotationObj[axis] || 0;
            if (base === 0) continue;

            const baseSign = Math.sign(base) || 1;
            const directionalSign = (axis === 'y' || axis === 'z') ? baseSign * lateralDirection : baseSign;
            const amplitudeJitter = 0.9 + Math.random() * 0.2;

            rotationObj[axis] = Math.abs(base) * directionalSign * amplitudeJitter * intensityScale;
        }
    };

    // Randomize primary rotation set
    if (config.rotations) {
        for (const rotation of Object.values(config.rotations)) {
            randomizeRotationObject(rotation);
        }
    }

    // Randomize stage rotations and pacing for multi-stage motions
    if (Array.isArray(config.stages)) {
        for (const stage of config.stages) {
            if (stage.rotations) {
                for (const rotation of Object.values(stage.rotations)) {
                    randomizeRotationObject(rotation);
                }
            }
            if (stage.duration) {
                stage.duration = Math.max(650, Math.round(stage.duration * (0.8 + Math.random() * 0.18)));
            }
        }
    }

    if (config.duration) {
        config.duration = Math.max(2600, Math.round(config.duration * (0.78 + Math.random() * 0.16)));
    }

    if (Array.isArray(config.layers)) {
        for (const layer of config.layers) {
            layer.phase = (layer.phase || 0) + ((Math.random() - 0.5) * 0.6);
            if (layer.frequencyHz) {
                layer.frequencyHz = Math.max(0.05, layer.frequencyHz * (1.0 + Math.random() * 0.22));
            }
            if (layer.centerSec != null) {
                layer.centerSec = Math.max(0, layer.centerSec + ((Math.random() - 0.5) * 0.12));
            }
            if (layer.widthSec) {
                layer.widthSec = Math.max(0.08, layer.widthSec * (0.9 + Math.random() * 0.18));
            }
            if (layer.bones) {
                for (const delta of Object.values(layer.bones)) {
                    for (const axis of ['x', 'y', 'z']) {
                        const value = delta[axis] || 0;
                        if (!value) continue;
                        delta[axis] = value * (0.93 + Math.random() * 0.14);
                    }
                }
            }
        }

        if (config.description === 'chest adjust gesture' && config.layers.length >= 2) {
            const liftRange = config.liftScaleRange || { min: 1.02, max: 1.28 };
            const dropRange = config.dropScaleRange || { min: 0.92, max: 1.42 };
            const liftScale = liftRange.min + Math.random() * (liftRange.max - liftRange.min);
            const dropScale = dropRange.min + Math.random() * (dropRange.max - dropRange.min);

            const scaleLayer = (layerIndex, scale) => {
                const layer = config.layers[layerIndex];
                if (!layer?.bones) return;
                for (const [boneName, delta] of Object.entries(layer.bones)) {
                    if (!/shoulder|upperarm|lowerarm|hand/i.test(boneName)) continue;
                    for (const axis of ['x', 'y', 'z']) {
                        if (typeof delta[axis] === 'number') {
                            delta[axis] *= scale;
                        }
                    }
                }
            };

            scaleLayer(0, liftScale);
            scaleLayer(1, dropScale);
        }
    }
    
    // Randomize model rotation if applicable
    if (config.applyModelRotation) {
        config.modelRotation = (
            config.modelRotationRange.min + 
            Math.random() * (config.modelRotationRange.max - config.modelRotationRange.min)
        ) * (Math.random() > 0.5 ? 1 : -1);
    }
    
    return config;
}

function applyProceduralCalibration(config, calibration = null) {
    if (!calibration || !config) {
        return config;
    }

    const calibrated = JSON.parse(JSON.stringify(config));
    const bodyScale = calibration.bodyScale || 1;
    const shoulderScale = calibration.shoulderScale || 1;
    const armLiftScale = calibration.armLiftScale || 1;

    const applyBoneScale = (boneName, delta) => {
        if (!delta) return;
        const isShoulder = /shoulder/i.test(boneName);
        const isArmOrHand = /upperarm|lowerarm|hand/i.test(boneName);
        const scale = isShoulder ? shoulderScale : (isArmOrHand ? armLiftScale : bodyScale);
        for (const axis of ['x', 'y', 'z']) {
            if (typeof delta[axis] === 'number') {
                delta[axis] *= scale;
            }
        }
    };

    if (calibrated.rotations) {
        for (const [boneName, delta] of Object.entries(calibrated.rotations)) {
            applyBoneScale(boneName, delta);
        }
    }

    if (Array.isArray(calibrated.stages)) {
        for (const stage of calibrated.stages) {
            if (!stage?.rotations) continue;
            for (const [boneName, delta] of Object.entries(stage.rotations)) {
                applyBoneScale(boneName, delta);
            }
        }
    }

    if (Array.isArray(calibrated.layers)) {
        for (const layer of calibrated.layers) {
            if (!layer?.bones) continue;
            for (const [boneName, delta] of Object.entries(layer.bones)) {
                applyBoneScale(boneName, delta);
            }
        }
    }

    return calibrated;
}

/**
 * Get or generate an idle animation clip for a character
 * Generates fresh each time to ensure proper randomization
 * @param {string} character - Character name
 * @param {VRM} vrm - The VRM instance
 * @param {string} movementKey - Key from IDLE_MOVEMENT_CONFIGS
 * @returns {Object} Object containing { clip, randomizedRotation }
 */
export function getIdleAnimationClip(character, vrm, movementKey, calibration = null) {
    const baseConfig = IDLE_MOVEMENT_CONFIGS[movementKey];
    const config = applyProceduralCalibration(baseConfig, calibration);
    if (!config) {
        console.warn(DEBUG_PREFIX, 'Unknown idle movement:', movementKey);
        return { clip: null, randomizedRotation: 0 };
    }
    
    const randomizedConfig = randomizeMovementConfig(config);
    
    let clip;
    if (randomizedConfig.proceduralLayers) {
        clip = generateLayeredProceduralClip(vrm, randomizedConfig, movementKey);
    } else if (randomizedConfig.multiStage) {
        clip = generateMultiStageAnimationClip(vrm, randomizedConfig);
    } else {
        clip = generateIdleAnimationClip(vrm, randomizedConfig, movementKey);
    }
    
    return {
        clip: clip,
        randomizedRotation: randomizedConfig.modelRotation || 0
    };
}
