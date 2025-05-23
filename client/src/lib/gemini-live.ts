import { GoogleGenAI, Live } from "@google/genai";
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
  private genAI: GoogleGenAI | null = null;
  private live: Live | null = null;
  private session: any = null;
  private connectionState: ConnectionState = "disconnected";
  private outputAudioContext: AudioContext | null = null;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private audioInQueue: any[] = [];
  private isProcessingAudio = false;
  
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

    try {
      this.setConnectionState("connecting");
      
      // Get API key from server
      const response = await fetch("/api/get-api-key");
      if (!response.ok) {
        throw new Error("Failed to get API key");
      }
      const { apiKey } = await response.json();
      
      if (!apiKey) {
        throw new Error("API key not available");
      }

      // Initialize Google GenAI client
      this.genAI = new GoogleGenAI(apiKey);

      // Create Live instance using the client's components
      this.live = new Live(
        this.genAI.live.apiClient,
        this.genAI.live.auth,
        this.genAI.live.webSocketFactory
      );

      // Create Live session configuration with model and config
      const modelName = config?.model || "models/gemini-2.5-flash-preview-native-audio-dialog";
      const params = {
        model: modelName,
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Zephyr"
              }
            }
          },
          mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
          ...config?.generationConfig
        }
      };

      // Connect to Live API
      this.session = await this.live.connect(params);

      // Set up audio processing
      this.startAudioProcessing();
      
      this.setConnectionState("connected");
      console.log('Connected to Gemini Live API via official SDK');

    } catch (error) {
      console.error('Error connecting to Gemini Live:', error);
      this.setConnectionState("error");
      this.onError?.(`Connection failed: ${error}`);
      throw error;
    }
  }

  private async startAudioProcessing(): Promise<void> {
    if (!this.session) return;

    try {
      // Start listening for responses
      for await (const response of this.session.receive()) {
        if (response.data) {
          // Handle audio data
          this.audioInQueue.push(response.data);
          if (!this.isProcessingAudio) {
            this.processAudioQueue();
          }
          this.onAudioReceived?.(response.data);
        }
        
        if (response.text) {
          // Handle text response
          console.log('Text response:', response.text);
          this.onTextReceived?.(response.text);
        }
      }
    } catch (error) {
      console.error('Audio processing error:', error);
      this.onError?.(`Audio processing error: ${error}`);
    }
  }

  private async processAudioQueue(): Promise<void> {
    if (this.isProcessingAudio || this.audioInQueue.length === 0) return;
    
    this.isProcessingAudio = true;
    
    while (this.audioInQueue.length > 0) {
      const audioData = this.audioInQueue.shift();
      if (audioData && this.outputAudioContext) {
        try {
          await this.playAudioData(audioData);
        } catch (error) {
          console.error('Error playing audio:', error);
        }
      }
    }
    
    this.isProcessingAudio = false;
  }

  private async playAudioData(audioData: Uint8Array): Promise<void> {
    if (!this.outputAudioContext) return;

    try {
      const audioBuffer = await decodeAudioData(audioData, this.outputAudioContext);
      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputAudioContext.destination);
      
      const startTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
      source.start(startTime);
      this.nextStartTime = startTime + audioBuffer.duration;
      
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
      };
    } catch (error) {
      console.error('Error decoding/playing audio:', error);
    }
  }

  disconnect(): void {
    if (this.session) {
      this.session.close?.();
      this.session = null;
    }
    
    this.sources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Source might already be stopped
      }
    });
    this.sources.clear();
    
    this.setConnectionState("disconnected");
  }

  sendAudio(audioData: Float32Array): void {
    if (!this.session || this.connectionState !== "connected") {
      console.warn('Cannot send audio: not connected');
      return;
    }

    try {
      // Convert Float32Array to the format expected by the Live API
      const audioMessage = {
        data: audioData,
        mimeType: "audio/pcm"
      };
      
      this.session.send(audioMessage);
    } catch (error) {
      console.error('Error sending audio:', error);
      this.onError?.(`Failed to send audio: ${error}`);
    }
  }

  sendText(text: string): void {
    if (!this.session || this.connectionState !== "connected") {
      console.warn('Cannot send text: not connected');
      return;
    }

    try {
      this.session.send(text);
    } catch (error) {
      console.error('Error sending text:', error);
      this.onError?.(`Failed to send text: ${error}`);
    }
  }

  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  private setConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    this.onConnectionStateChange?.(state);
  }
}