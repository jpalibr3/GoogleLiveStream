import { GoogleGenAI, Modality } from "@google/genai";
import { createAudioBlob, decodeAudioData } from "./audio-utils";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface GeminiLiveConfig {
  model?: string;
  generationConfig?: {
    responseModalities: string[];
    speechConfig?: object;
  };
}

export class GeminiLiveClient {
  private client: GoogleGenAI | null = null;
  private session: any = null;
  private connectionState: ConnectionState = "disconnected";
  private outputAudioContext: AudioContext | null = null;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  
  // Event handlers
  public onConnectionStateChange?: (state: ConnectionState) => void;
  public onAudioReceived?: (audioData: Uint8Array) => void;
  public onTextReceived?: (text: string) => void;
  public onError?: (error: string) => void;

  constructor() {
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 24000
    });
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  async connect(config?: GeminiLiveConfig): Promise<void> {
    if (this.connectionState === "connected" || this.connectionState === "connecting") {
      return;
    }

    this.setConnectionState("connecting");

    try {
      // Get API key from backend
      const response = await fetch('/api/get-api-key');
      const { apiKey } = await response.json();
      
      if (!apiKey) {
        throw new Error("API key not available");
      }

      // Initialize Google GenAI client
      this.client = new GoogleGenAI({
        apiKey: apiKey,
      });

      const model = config?.model || 'gemini-2.0-flash-live-001';
      
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            console.log('Connected to Gemini Live API');
            this.setConnectionState("connected");
          },
          onmessage: async (message: any) => {
            await this.handleGeminiMessage(message);
          },
          onerror: (error: any) => {
            console.error('Gemini Live API error:', error);
            this.setConnectionState("error");
            this.onError?.(error.message || "Gemini API error");
          },
          onclose: (event: any) => {
            console.log('Gemini Live API connection closed');
            this.setConnectionState("disconnected");
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Orus' } },
          },
          ...config?.generationConfig
        },
      });

    } catch (error) {
      console.error("Error connecting to Gemini Live:", error);
      this.setConnectionState("error");
      this.onError?.(`Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  disconnect(): void {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.setConnectionState("disconnected");
    
    // Stop all audio sources
    for (const source of this.sources.values()) {
      source.stop();
      this.sources.delete(source);
    }
  }

  sendAudio(audioData: Float32Array): void {
    if (!this.isConnected() || !this.session) return;

    const audioBlob = createAudioBlob(audioData);
    this.session.sendRealtimeInput({ media: audioBlob });
  }

  sendText(text: string): void {
    if (!this.isConnected() || !this.session) return;

    this.session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: text }] }],
      turnComplete: true
    });
  }

  isConnected(): boolean {
    return this.connectionState === "connected" && this.session;
  }

  private setConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    this.onConnectionStateChange?.(state);
  }

  private async handleGeminiMessage(message: any): Promise<void> {
    try {
      const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData;

      if (audio && this.outputAudioContext) {
        this.nextStartTime = Math.max(
          this.nextStartTime,
          this.outputAudioContext.currentTime,
        );

        const audioBuffer = await decodeAudioData(
          audio.data,
          this.outputAudioContext,
          24000,
          1,
        );
        
        const source = this.outputAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.outputAudioContext.destination);
        
        source.addEventListener('ended', () => {
          this.sources.delete(source);
        });

        source.start(this.nextStartTime);
        this.nextStartTime = this.nextStartTime + audioBuffer.duration;
        this.sources.add(source);
        
        // Notify audio received
        this.onAudioReceived?.(new Uint8Array(audioBuffer.getChannelData(0).buffer));
      }

      // Handle interruptions
      const interrupted = message.serverContent?.interrupted;
      if (interrupted) {
        for (const source of this.sources.values()) {
          source.stop();
          this.sources.delete(source);
        }
        this.nextStartTime = 0;
      }

      // Handle text responses
      if (message.serverContent?.modelTurn?.parts) {
        for (const part of message.serverContent.modelTurn.parts) {
          if (part.text) {
            this.onTextReceived?.(part.text);
          }
        }
      }
    } catch (error) {
      console.error("Error processing Gemini message:", error);
    }
  }
}
