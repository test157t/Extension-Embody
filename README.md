# Embody for SillyTavern

Embody is a SillyTavern extension for embodied character interaction. It combines VRM avatars, VoiceForge TTS/call mode, and Intiface device support in one extension.

## Included Support

- `vrm/` - VRM model rendering, animation, hitboxes, expressions, and lip sync.
- `voiceforge/` - VoiceForge TTS playback, streaming voice output, and call mode inside SillyTavern.
- `intiface/` - Intiface/Buttplug device integration and synchronized device control.

## VoiceForge Server

Embody includes the SillyTavern-side VoiceForge TTS integration. The VoiceForge TTS server/engine is separate.

Use this TTS engine with Embody's VoiceForge support:

https://github.com/test157t/VoiceForge

Run the VoiceForge server, then configure Embody's VoiceForge settings inside SillyTavern to connect to that server endpoint.

## Notes

- VoiceForge call mode and VRM lip sync work best when TTS audio is played through SillyTavern so the extension can analyze the audible Web Audio stream.
- VRM models and animations should be placed in the SillyTavern user asset folders described in `vrm/README.md`.
- Intiface support requires Intiface Central or a compatible Buttplug websocket server.
