import { GoogleGenAI } from "@google/genai";
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

    this.setConnectionState("connecting");

    try {
      // Get API key from backend
      const response = await fetch('/api/get-api-key');
      const { apiKey } = await response.json();
      
      if (!apiKey) {
        throw new Error("API key not available");
      }

      // Connect directly to Gemini Live API WebSocket with v1beta
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('Connected to Gemini Live API');
        
        // Send initial setup configuration
        const setupMessage = {
          setup: {
            model: config?.model || "models/gemini-2.5-flash-preview-native-audio-dialog",
            generationConfig: {
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
          }
        };

        this.websocket?.send(JSON.stringify(setupMessage));
        this.setConnectionState("connected");
      };

      this.websocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleGeminiMessage(message);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      this.websocket.onerror = (error) => {
        console.error("WebSocket error:", error);
        this.setConnectionState("error");
        this.onError?.("WebSocket connection error");
      };

      this.websocket.onclose = (event) => {
        console.log("WebSocket connection closed:", event.code, event.reason);
        if (event.code !== 1000) {
          console.error("WebSocket closed with error code:", event.code, "reason:", event.reason);
          this.onError?.(`WebSocket closed with code ${event.code}: ${event.reason || 'Connection failed'}`);
        }
        this.setConnectionState("disconnected");
        this.websocket = null;
      };

    } catch (error) {
      console.error("Error connecting to Gemini Live:", error);
      this.setConnectionState("error");
      this.onError?.(`Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  disconnect(): void {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    this.setConnectionState("disconnected");
    
    // Stop all audio sources
    this.sources.forEach(source => {
      source.stop();
    });
    this.sources.clear();
  }

  sendAudio(audioData: Float32Array): void {
    if (!this.isConnected()) return;

    const audioBlob = createAudioBlob(audioData);
    const message = {
      realtimeInput: {
        audio: audioBlob
      }
    };
    
    this.websocket?.send(JSON.stringify(message));
  }

  sendText(text: string): void {
    if (!this.isConnected()) return;

    const message = {
      clientContent: {
        turns: [{ role: "user", parts: [{ text: text }] }],
        turnComplete: true
      }
    };
    
    this.websocket?.send(JSON.stringify(message));
  }

  isConnected(): boolean {
    return this.connectionState === "connected" && 
           this.websocket?.readyState === WebSocket.OPEN;
  }

  private setConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    this.onConnectionStateChange?.(state);
  }

  private async handleGeminiMessage(message: any): Promise<void> {
    try {
      const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData;

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
        this.sources.forEach(source => {
          source.stop();
        });
        this.sources.clear();
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
