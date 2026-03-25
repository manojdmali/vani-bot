import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

export class GeminiVoiceAgent {
  private ai: GoogleGenAI;
  private session: any;
  private audioContext: AudioContext | null = null;
  private nextStartTime: number = 0;
  private onMessage: (msg: string) => void;
  private onStatus: (status: string) => void;

  constructor(apiKey: string, onMessage: (msg: string) => void, onStatus: (status: string) => void) {
    this.ai = new GoogleGenAI({ apiKey });
    this.onMessage = onMessage;
    this.onStatus = onStatus;
  }

  async connect(systemInstruction: string, voiceName: string = "Kore", tools: any[] = []) {
    console.log(`[GeminiVoiceAgent] Connecting with voice: ${voiceName}`);
    this.onStatus("Connecting...");
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    this.nextStartTime = this.audioContext.currentTime;

    this.session = await this.ai.live.connect({
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      callbacks: {
        onopen: () => {
          this.onStatus("Connected");
          this.startMic();
        },
        onmessage: async (message: LiveServerMessage) => {
          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData?.data) {
                this.playAudio(part.inlineData.data);
              }
              if (part.text) {
                // Filter out common "thinking" or "markdown" patterns if they still appear
                const cleanText = part.text.replace(/\*\*.*?\*\*/g, '').replace(/#+ /g, '').trim();
                if (cleanText) {
                  this.onMessage(cleanText);
                }
              }
            }
          }
          if (message.serverContent?.interrupted) {
            this.stopAudio();
          }
        },
        onclose: () => {
          this.onStatus("Disconnected");
        },
        onerror: (err) => {
          console.error("Gemini Live Error:", err);
          this.onStatus("Error: " + err.message);
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          // 'Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
        systemInstruction,
        tools,
      },
    });
  }

  private async startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = this.audioContext!.createMediaStreamSource(stream);
      const processor = this.audioContext!.createScriptProcessor(4096, 1, 1);

      source.connect(processor);
      processor.connect(this.audioContext!.destination);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = this.floatTo16BitPCM(inputData);
        const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
        
        this.session.sendRealtimeInput({
          audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      };
    } catch (err) {
      console.error("Mic Error:", err);
      this.onStatus("Mic Error: " + (err as Error).message);
    }
  }

  private floatTo16BitPCM(input: Float32Array) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
  }

  private async playAudio(base64Data: string) {
    if (!this.audioContext) return;
    const arrayBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0)).buffer;
    const pcmData = new Int16Array(arrayBuffer);
    const floatData = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      floatData[i] = pcmData[i] / 0x8000;
    }

    const audioBuffer = this.audioContext.createBuffer(1, floatData.length, 16000);
    audioBuffer.getChannelData(0).set(floatData);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    const startTime = Math.max(this.nextStartTime, this.audioContext.currentTime);
    source.start(startTime);
    this.nextStartTime = startTime + audioBuffer.duration;
  }

  private stopAudio() {
    this.nextStartTime = this.audioContext?.currentTime || 0;
    // In a real app, you'd track and stop active sources
  }

  disconnect() {
    this.session?.close();
    this.audioContext?.close();
  }
}
