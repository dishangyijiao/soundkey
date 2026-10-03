// Hands microphone data to the side panel block by block on the audio thread (replaces the deprecated ScriptProcessorNode).
class Recorder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) this.port.postMessage(channel.slice());
    return true;
  }
}

registerProcessor("fengsong-recorder", Recorder);
