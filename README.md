# ConvoLens — an installable accessibility web app

**Live:** https://ivnad95.github.io/convolens-pwa/ (GitHub Pages, deployed from `main`).

**Status:** Working PWA prototype, not a clinically or safety-validated accessibility product. The core design is mobile-first and supports iOS, Android and desktop browsers. No account or paid service is required for the interface and microphone meter.

## What works now

- Installable PWA: app manifest, 192/512 px icons, standalone layout, cached app shell.
- Live microphone input meter and actual waveform (not simulated when the microphone is active).
- Browser speech recognition where the browser provides `SpeechRecognition` or `webkitSpeechRecognition`. This may use a cloud service, and is not available consistently on every phone/browser.
- **Optional WhisperLiveKit streaming backend**, configurable in Preferences, supporting real AI transcription and numbered speaker IDs when diarisation is enabled on the backend.
- Manual speaker labelling per caption, even when no AI server is connected.
- Explicit save, copy, review, export and delete transcript features. Only saved transcripts are persisted (in browser localStorage).
- Typed reply: speak aloud with system text-to-speech or display the text full-screen.
- Adjustable caption sizes, languages and optional haptics.
- Accessible keyboard focus, readable type, reduced-motion support and phone-safe-area layout.

## What is not implemented yet

- **Music versus singing versus nearby speech separation:** needs sound-event classification and source-separation processing. The app does **not** claim to filter music yet.
- **Exact distance in metres:** cannot be reliably inferred from one phone microphone. The current bar measures input signal amplitude only, **not** distance or intelligibility.
- **Named speaker identification:** the AI backend can assign speaker numbers when correctly configured, but recognising a known person by name requires consent-based voice enrolment and a speaker embedding model.
- Fully offline captions: the app shell is offline-capable, but browser speech recognition may require connectivity; the optional AI server also requires connectivity to that server.
- Background listening while the phone is locked: mobile operating systems may suspend browser capture. Keep the PWA open and the screen awake during use.
- Production-grade security, account management, clinician/Deaf-community testing, model evaluation and emergency alarms.

## Run locally

No Node dependencies, build step or secret keys are required for the frontend.

```bash
cd convolens-pwa
python3 -m http.server 8080
```

Open <http://localhost:8080> on the same computer. `localhost` is treated as a secure context for microphone APIs. Opening `http://YOUR-LAN-IP:8080` from a phone is **not** sufficient for microphone access: deploy via HTTPS or set up a trusted development certificate.

To run production-like local checks, use Chrome, Safari or another supported browser. Speak after tapping **Start listening**. The browser may ask for microphone and speech recognition permission.

## Deploy to an HTTPS website

1. Copy these files to a new GitHub repository (keep `index.html`, `styles.css`, `app.js`, `pcm-worklet.js`, `sw.js`, `manifest.webmanifest`, and `icons/` at the site root).
2. Import the repository into Vercel or Netlify as a **static** project. No build command is needed; publish the repository root.
3. Open your deployed `https://...` address on your phone.
4. **iPhone:** open Safari → Share → **Add to Home Screen** → **Open as Web App** → Add.
5. **Android:** open Chrome → menu → **Install app** or **Add to Home screen**.
6. Launch it from its icon and give microphone permission when asked.

You do not need the Apple App Store or Google Play for Home Screen installation.

### AI server mode (optional)

See [docs/AI_BACKEND.md](docs/AI_BACKEND.md) for the actual protocol and production deployment/security caveats.

Quick-start for development on an appropriate server:

```bash
pip install whisperlivekit
whisperlivekit-server --model base --language en --pcm-input --diarization --host 127.0.0.1 --port 8000
```

Host this server behind a reverse proxy providing **WSS** and transport security. In Preferences → Caption engine, select **Self-hosted WhisperLiveKit**, enter `wss://YOUR-AI-DOMAIN/asr`, and tick the diarisation checkbox **only if** the server really is using `--diarization`.

This feature is **integrated but not tested against a running real model** in this package; server model downloads, weight licences, capacity, and browser audio interoperability must be validated separately. The server is not included or deployed here.

## Privacy and accessibility notes

ConvoLens does not write raw microphone audio to disk. When the browser speech engine is selected, the browser/provider controls speech processing and may send audio to the provider. When the self-hosted server engine is selected, audio is **streamed** to the configured WSS endpoint; do not enter an untrusted service. Client transcripts are only saved to browser localStorage on deliberate user action, and may be lost if browser data is cleared.

The optional server should have authentication, traffic limits, bounded retention, an appropriate data-processing/consent policy and published uptime/availability limits before real users are invited.

Never depend on this app for emergency alerts or safeguarding.

## Repository contents

```text
convolens-pwa/
  index.html            Screen structure, navigation, accessible controls
  styles.css            Responsive design
  app.js                PWA functionality and optional AI backend adapter
  pcm-worklet.js        Real-time PCM audio conversion to 16 kHz for AI server
  manifest.webmanifest  App installation metadata
  sw.js                 Offline cache of the interface
  icons/                PWA icons
  docs/AI_BACKEND.md    WhisperLiveKit setup and next phases
```

## Licence considerations

The frontend here contains original code generated for this request. External speech models and AI frameworks have their own licences; check the specific model weights and dependencies before commercial use.
