/* 16 kHz signed PCM for WhisperLiveKit's --pcm-input WebSocket protocol.
 * This is a lightweight averaging resampler, not a full anti-alias filter.
 * Audio is never written to storage. */
class ConvoLensPCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.resampleStep = sampleRate / 16000;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.out = new Int16Array(1600);
    this.position = 0;
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (let i = 0; i < samples.length; i++) {
      this.sum += samples[i]; this.count++; this.phase++;
      if (this.phase >= this.resampleStep) {
        const average = Math.max(-1, Math.min(1, this.sum / this.count));
        this.out[this.position++] = average < 0 ? Math.round(average * 32768) : Math.round(average * 32767);
        this.phase -= this.resampleStep; this.sum = 0; this.count = 0;
        if (this.position === this.out.length) {
          const ready = this.out;
          this.port.postMessage(ready.buffer, [ready.buffer]);
          this.out = new Int16Array(1600); this.position = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('convolens-pcm', ConvoLensPCMProcessor);
