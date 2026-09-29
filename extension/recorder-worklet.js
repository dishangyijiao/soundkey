// 在音频线程里把麦克风数据一块块交给侧边栏（替代已弃用的 ScriptProcessorNode）。
class Recorder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) this.port.postMessage(channel.slice());
    return true;
  }
}

registerProcessor("fengsong-recorder", Recorder);
