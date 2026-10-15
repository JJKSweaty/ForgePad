// Energy-based voice activity detection runs on the audio rendering thread.
// Sends only activity metadata to the UI; it never posts microphone samples.
class ForgePadVAD extends AudioWorkletProcessor {
  constructor() { super(); this.frames=0; this.lastMessage=0; this.lastVoice=0; this.heard=false; }
  process(inputs) {
    const samples=inputs[0]?.[0];
    if(!samples)return true;
    let sum=0;for(const x of samples)sum+=x*x;
    const active=Math.sqrt(sum/samples.length)>0.015;
    if(active){this.lastVoice=currentTime;this.heard=true;}
    if(currentTime-this.lastMessage>0.15){
      this.port.postMessage({active,heard:this.heard,silence_seconds:currentTime-this.lastVoice});
      this.lastMessage=currentTime;
    }
    return true; // Output buffers remain zero: no microphone monitoring or spoken echo.
  }
}
registerProcessor('forgepad-vad',ForgePadVAD);
