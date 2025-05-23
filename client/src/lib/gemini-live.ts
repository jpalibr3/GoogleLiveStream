import { createAudioBlob } from "./audio-utils";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface GeminiLiveConfig {
  model?: string;
  generationConfig?: {
    responseModalities: string[];
    speechConfig?: object;
  };
}

export class GeminiLiveClient {
  private websocket: WebSocket | null = null;
  private connectionState: ConnectionState = "disconnected";
  private apiKey: string;
  
  // Event handlers
  public onConnectionStateChange?: (state: ConnectionState) => void;
  public onAudioReceived?: (audioData: Uint8Array) => void;
  public onTextReceived?: (text: string) => void;
  public onError?: (error: string) => void;

  constructor() {
    // API key will be handled by the backend server
    this.apiKey = "";
  }

  async connect(config?: GeminiLiveConfig): Promise<void> {
    if (this.connectionState === "connected" || this.connectionState === "connecting") {
      return;
    }

    this.setConnectionState("connecting");

    try {
      // Connect via our backend WebSocket proxy
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log("Connected to WebSocket proxy");
        
        // Send initial configuration
        const setupMessage = {
          setup: {
            model: config?.model || "gemini-2.0-flash-live-001",
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: "Puck"
                  }
                }
              },
              ...config?.generationConfig
            }
          }
        };

        this.websocket?.send(JSON.stringify({
          type: "setup",
          config: setupMessage
        }));
      };

      this.websocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      this.websocket.onerror = (error) => {
        console.error("WebSocket error:", error);
        this.setConnectionState("error");
        this.onError?.("WebSocket connection error");
      };

      this.websocket.onclose = () => {
        console.log("WebSocket connection closed");
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
  }

  sendAudio(audioData: Float32Array): void {
    if (!this.isConnected()) return;

    const audioBlob = createAudioBlob(audioData);
    const message = {
      type: "audio",
      data: audioBlob
    };

    this.websocket?.send(JSON.stringify(message));
  }

  sendText(text: string): void {
    if (!this.isConnected()) return;

    const message = {
      type: "text",
      text: text
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

  private handleMessage(message: any): void {
    switch (message.type) {
      case "connected":
        this.setConnectionState("connected");
        break;
        
      case "audio":
        if (message.data) {
          // Decode base64 audio data
          const audioData = new Uint8Array(
            atob(message.data)
              .split("")
              .map(char => char.charCodeAt(0))
          );
          this.onAudioReceived?.(audioData);
        }
        break;
        
      case "text":
        if (message.text) {
          this.onTextReceived?.(message.text);
        }
        break;
        
      case "error":
        console.error("Gemini Live API error:", message.error);
        this.setConnectionState("error");
        this.onError?.(message.error || "Unknown API error");
        break;
        
      default:
        console.log("Unknown message type:", message.type);
    }
  }
}
