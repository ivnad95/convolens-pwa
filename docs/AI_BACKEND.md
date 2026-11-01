# Integrating a real speaker-aware AI backend

The standalone frontend works with browser-native speech recognition. For reliable cross-platform transcription and speaker-turn labelling, connect a **self-hosted WhisperLiveKit server** using the selectable engine in Preferences.

Reference implementation: <https://github.com/QuentinFuxa/WhisperLiveKit>

Protocol specification (confirm against your pinned server version): <https://github.com/QuentinFuxa/WhisperLiveKit/blob/main/docs/API.md>

## Minimum backend

On a machine running Python with enough memory and CPU/GPU capacity for inference:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install whisperlivekit
# Diarisation needs extra NVIDIA NeMo dependencies according to the upstream project.
# Check the upstream README and its exact version-specific flags.
whisperlivekit-server --model base --language en --diarization --pcm-input --host 127.0.0.1 --port 8000
```

- `--pcm-input`: enables input as signed 16-bit little-endian PCM at **16 kHz mono**. The provided `pcm-worklet.js` converts browser microphone buffers to this format.
- `--diarization`: enables speaker tracking. The web UI displays IDs such as **Speaker 1**. It does not imply confirmed identity or infer who a real person is.
- The server's `/asr` WebSocket must be available through an HTTPS/TLS proxy as `wss://your-domain/asr` for production mobile phones. Example with Caddy, after DNS configuration:

```caddyfile
ai.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

Configure authentication/rate limits separately. Unauthenticated publicly reachable inference endpoints can be abused and run up costs. Neither a static PWA nor Caddy's basic reverse-proxy stanza secures this by itself.

## Data exchange implemented in the PWA

1. The user explicitly selects the AI server, enters the WSS address, and taps Start listening.
2. The browser requests microphone permission and opens a WebSocket to `/asr?mode=full&language=...`.
3. The server confirms the `useAudioWorklet` flag. The PWA requires `true`, matching `--pcm-input`.
4. An AudioWorklet streams binary frames of 16 kHz, mono, signed 16-bit PCM. No audio is stored in the frontend.
5. The server responds with JSON containing committed `lines` (including text and speaker ID) and transient `buffer_transcription`.
6. The UI reconciles committed captions; when the server has diarisation and the checkbox is enabled it displays **Speaker N**. A user can override any caption label manually.
7. Stop listening sends an empty binary frame to the server, requesting final output before closure.

**Implementation warning:** the worklet uses lightweight averaged downsampling rather than professional-quality anti-alias filtering. Validate 44.1/48 kHz input, different mobile microphones, latency and transcription quality before production. The frontend/server combination has not been exercised with live WhisperLiveKit in this delivery.

## Next features to beat competing caption apps

1. **Audio-source classification:** run sound-event tagging on short overlapping windows (e.g. browser-friendly ONNX model or YAMNet server-side) to label *speech / singing / music / alarms*. Classification alone does NOT suppress overlapping vocals.
2. **Target-speech source separation:** add a speech extraction model, e.g. evaluated MossFormer2 variants, rather than claiming that an equaliser separates simultaneous sources. Test how much speech content suppression removes accidentally.
3. **Speaker identity:** train or integrate consent-based embeddings to map repeat voices to locally saved user-chosen names. Expose uncertainty and allow correction, never assert identity from voice alone.
4. **Distance/range:** use calibrated multiple microphones or external hardware if you wish to estimate metres. Otherwise display a clearly labelled microphone-input meter, not fictitious range.
5. **Production:** authentication, secure WSS, data retention controls, offline strategies, GDPR assessment, server cost limits, accessibility tests with Deaf and hard-of-hearing people, evaluation against real noisy-room recordings.

## Browser operating system limitations

Safari and Chrome differ in availability of browser-native speech recognition. Even after installing the PWA, iOS and Android may suspend microphone capture when the app is in the background or the screen locks. The optional server mode helps with browser speech-recognition inconsistencies but **does not bypass the phone's microphone/background restrictions**.
