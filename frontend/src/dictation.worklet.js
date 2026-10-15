// Downsample microphone input to mono 16 kHz PCM. Output stays silent.
class DictationCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(1600);
    this.index = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.[0]) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      this.sum += value;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        this.frame[this.index++] = this.sum / this.count;
        this.sum = 0;
        this.count = 0;
        if (this.index === this.frame.length) {
          this.port.postMessage(this.frame, [this.frame.buffer]);
          this.frame = new Float32Array(1600);
          this.index = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("forgepad-dictation", DictationCapture);
