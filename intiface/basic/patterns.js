/**
 * Basic Waveform Patterns
 * Core patterns available to all modes
 */

const TAU = Math.PI * 2
const fract = (v) => v - Math.floor(v)
const clamp01 = (v) => Math.max(0, Math.min(1, v))

const BasicPatterns = {
      sine: (phase, intensity) => ((Math.sin(fract(phase) * TAU - Math.PI / 2) + 1) * 0.5) * intensity,
      triangle: (phase, intensity) => (1 - Math.abs(fract(phase) * 2 - 1)) * intensity,
      square: (phase, intensity) => (fract(phase) < 0.5 ? 1 : 0) * intensity,
      sawtooth: (phase, intensity) => fract(phase) * intensity,
      pulse: (phase, intensity) => {
      const p = fract(phase)
      if (p < 0.08) return (p / 0.08) * intensity
      if (p < 0.2) return (1 - (p - 0.08) / 0.12) * intensity
      return 0
    },
      ramp_up: (phase, intensity) => clamp01(fract(phase)) * intensity,
      ramp_down: (phase, intensity) => (1 - clamp01(fract(phase))) * intensity,
      wave: (phase, intensity) => ((Math.sin(fract(phase) * TAU * 1.5 - Math.PI / 2) + 1) * 0.5) * intensity,
      gentle: (phase, intensity) => ((Math.sin(fract(phase) * TAU - Math.PI / 2) + 1) * 0.5) * intensity * 0.45,
      heartbeat: (phase, intensity) => {
      const p = fract(phase * 2)
      const first = p < 0.14 ? (1 - (p / 0.14)) : 0
      const second = p > 0.25 && p < 0.38 ? (1 - ((p - 0.25) / 0.13)) * 0.6 : 0
      return (first + second) * intensity
    },
      double_pulse: (phase, intensity) => {
      const p = fract(phase * 2)
      if (p < 0.06) return (p / 0.06) * intensity
      if (p < 0.16) return (1 - ((p - 0.06) / 0.1)) * intensity
      return 0
    },
      stairs: (phase, intensity) => {
      const p = fract(phase)
      const levels = 6
      return (Math.floor(p * levels) / (levels - 1)) * intensity
    },
      knock: (phase, intensity) => ((fract(phase * 6) < 0.06 ? 1 : fract(phase * 6) < 0.14 ? 0.35 : 0) * intensity),
      rumble: (phase, intensity) => (((Math.sin(fract(phase) * TAU * 0.7 - Math.PI / 2) + 1) * 0.5) * intensity),
      purr: (phase, intensity) => ((((Math.sin(fract(phase) * TAU * 8 - Math.PI / 2) + 1) * 0.5) * 0.65) + (((Math.sin(fract(phase) * TAU * 14 - Math.PI / 2) + 1) * 0.5) * 0.35)) * intensity * 0.7,
      throb: (phase, intensity) => ((fract(phase * 2.5) < 0.64 ? Math.sin((fract(phase * 2.5) / 0.64) * Math.PI * 0.5) : 0.18) * intensity),
      chop: (phase, intensity) => ((fract(phase * 10) < 0.09 ? 1 : fract(phase * 10) < 0.2 ? 0.42 : 0.08) * intensity),
      triplet: (phase, intensity) => ((fract(phase * 3) < 0.08 ? 1 : fract(phase * 3) < 0.16 ? 0.55 : fract(phase * 3) < 0.24 ? 0.25 : 0) * intensity),
      hf_buzz: (phase, intensity) => (((Math.sin(fract(phase) * TAU * 24 - Math.PI / 2) + 1) * 0.5) * intensity),
      lf_swell: (phase, intensity) => (((Math.sin(fract(phase) * TAU * 0.45 - Math.PI / 2) + 1) * 0.5) * intensity),
      sweep_up: (phase, intensity) => Math.pow(fract(phase), 1.3) * intensity,
      sweep_down: (phase, intensity) => (1 - Math.pow(fract(phase), 1.3)) * intensity,
      gate_hold: (phase, intensity) => ((fract(phase * 2) < 0.45 ? Math.pow(fract(phase * 2) / 0.45, 0.95) : fract(phase * 2) < 0.85 ? 0.88 : 0.08) * intensity),
      bounce: (phase, intensity) => {
      const p = fract(phase * 2.2)
      const tri = p < 0.5 ? p * 2 : 1 - ((p - 0.5) * 2)
      return Math.pow(tri, 0.8) * intensity
    },
      notch: (phase, intensity) => ((fract(phase * 8) < 0.08 ? 0.95 : fract(phase * 8) < 0.18 ? 0.5 : fract(phase * 8) < 0.32 ? 0.2 : 0.06) * intensity),
      teasing: (phase, intensity) => ((Math.sin(fract(phase) * TAU * 1.3 - Math.PI / 2) + 1) * 0.5) * intensity,
      tickle: (phase, intensity) => ((fract(phase * 10) < 0.1 ? 0.8 : fract(phase * 10) < 0.22 ? 0.35 : 0.05) * intensity),
      micro_tease: (phase, intensity) => (((Math.sin(fract(phase) * TAU * 6 - Math.PI / 2) + 1) * 0.5) * 0.35) * intensity,
      abrupt_edge: (phase, intensity) => ((fract(phase * 2.2) < 0.7 ? Math.pow(fract(phase * 2.2) / 0.7, 1.25) : 0.08) * intensity),
      crescendo: (phase, intensity) => (Math.pow(fract(phase), 1.35) * (0.7 + ((Math.sin(fract(phase) * TAU * 3 - Math.PI / 2) + 1) * 0.5) * 0.3)) * intensity,
      rapid_fire: (phase, intensity) => ((fract(phase * 11) < 0.08 ? 1 : fract(phase * 11) < 0.18 ? 0.45 : fract(phase * 11) < 0.32 ? 0.2 : 0.08) * intensity),
      intense_waves: (phase, intensity) => (((Math.sin(fract(phase) * TAU * 3.2 - Math.PI / 2) + 1) * 0.5) * intensity),
      build_and_ruin: (phase, intensity) => ((fract(phase * 2.4) < 0.74 ? Math.pow(fract(phase * 2.4) / 0.74, 1.2) : fract(phase * 2.4) < 0.88 ? 0.95 : 0.1) * intensity),
      held_edge: (phase, intensity) => ((fract(phase * 1.9) < 0.56 ? Math.pow(fract(phase * 1.9) / 0.56, 0.9) : fract(phase * 1.9) < 0.9 ? 0.88 : 0.06) * intensity),
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BasicPatterns
}

// Register on window for dynamic loading
if (typeof window !== 'undefined') {
    window.BasicPatterns = BasicPatterns
}
