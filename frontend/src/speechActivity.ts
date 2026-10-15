export async function watchSpeechActivity(
  stream: MediaStream,
  onActivity: (active: boolean) => void,
): Promise<() => void> {
  const context = new AudioContext();
  try {
    await context.audioWorklet.addModule(
      new URL("./vad.worklet.js", import.meta.url).href,
    );
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "forgepad-vad");
    node.port.onmessage = (event: MessageEvent<{ active: boolean }>) =>
      onActivity(event.data.active);
    source.connect(node);
    node.connect(context.destination);
    await context.resume();
    return () => {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      void context.close();
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}
