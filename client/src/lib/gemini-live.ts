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
  private websocket: WebSocket | null = null;
  private connectionState: ConnectionState = "disconnected";
  private outputAudioContext: AudioContext | null = null;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  
  // Event handlers
  public onConnectionStateChange?: (state: ConnectionState) => void;
  public onAudioReceived?: (base64AudioData: string, mimeType?: string) => void;
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

      // Connect to our server's WebSocket which handles Live API
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('Connected to server WebSocket');
        
        // Send setup message to server
        const setupMessage = {
          type: 'setup',
          apiKey: apiKey,
          config: {
            model: config?.model || "models/gemini-2.5-flash-preview-native-audio-dialog",
            generationConfig: config?.generationConfig
          }
        };

        this.websocket?.send(JSON.stringify(setupMessage));
      };

      this.websocket.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        await this.handleServerMessage(message);
      };

      this.websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.setConnectionState("error");
        this.onError?.("Connection error");
      };

      this.websocket.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.setConnectionState("disconnected");
        
        // Auto-reconnect if connection dropped unexpectedly  
        if (event.code !== 1000 && event.code !== 1001) {
          console.log('Connection dropped, cleaning up...');
          this.disconnect(); // Ensure clean disconnect
          console.log('Attempting to reconnect in 2 seconds...');
          setTimeout(() => {
            if (this.connectionState === "disconnected") {
              this.connect(config).catch(error => {
                console.error('Reconnection failed:', error);
                this.onError?.('Failed to reconnect: ' + error.message);
              });
            }
          }, 2000);
        }
      };

    } catch (error) {
      console.error('Error connecting to Gemini Live:', error);
      this.setConnectionState("error");
      this.onError?.(`Connection failed: ${error}`);
      throw error;
    }
  }

  private async handleServerMessage(message: any): Promise<void> {
    try {
      switch (message.type) {
        case 'connected':
          this.setConnectionState("connected");
          console.log('Successfully connected to Gemini Live API via server');
          break;
          
        case 'audio':
          if (message.data) {
            console.log('🔊 Processing audio response from Gemini');
            try {
              // Forward base64 data directly to callback
              const mimeType = message.mimeType || 'audio/pcm;rate=24000';
              this.onAudioReceived?.(message.data as string, mimeType);
            } catch (error) {
              console.error('Error processing Gemini audio:', error);
            }
          }
          break;
          
        case 'text':
          if (message.text) {
            console.log('Text response:', message.text);
            this.onTextReceived?.(message.text);
          }
          break;
          
        case 'error':
          console.error('Server error:', message.error);
          this.setConnectionState("error");
          this.onError?.(message.error);
          break;
          
        default:
          console.log('Unknown server message type:', message.type);
      }
    } catch (error) {
      console.error('Error handling server message:', error);
    }
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

  private async playGeminiAudio(audioData: Uint8Array, mimeType: string): Promise<void> {
    if (!this.outputAudioContext) return;

    try {
      console.log('🎵 Decoding Gemini PCM audio, length:', audioData.length, 'mimeType:', mimeType);
      
      // Parse sample rate from mime type (e.g., "audio/pcm;rate=24000")
      const sampleRate = mimeType.includes('rate=') ? 
        parseInt(mimeType.split('rate=')[1]) : 24000;
      
      // Convert PCM bytes to 16-bit signed integers (little-endian)
      const samples = new Int16Array(audioData.buffer, audioData.byteOffset, audioData.byteLength / 2);
      
      // Create audio buffer
      const audioBuffer = this.outputAudioContext.createBuffer(1, samples.length, sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      
      // Convert 16-bit PCM to float32 (-1.0 to 1.0)
      for (let i = 0; i < samples.length; i++) {
        channelData[i] = samples[i] / 32768.0; // Normalize 16-bit to float
      }
      
      // Play the audio
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
      
      console.log('✅ Successfully playing Gemini audio, duration:', audioBuffer.duration.toFixed(2), 'seconds');
      
    } catch (error) {
      console.error('Error decoding/playing Gemini audio:', error);
    }
  }

  disconnect(): void {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
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
    if (!this.websocket || this.connectionState !== "connected") {
      console.warn('Cannot send audio: not connected');
      return;
    }

    try {
      console.log('🎤 GeminiLiveClient sending audio data, length:', audioData.length);
      
      // Use createAudioBlob to properly encode audio data
      const audioBlob = createAudioBlob(audioData);
      const message = {
        type: 'audio',
        data: audioBlob.data, // Send base64 string
        mimeType: audioBlob.mimeType // Send mimeType
      };
      
      this.websocket.send(JSON.stringify(message));
      console.log('✅ Audio data sent to WebSocket successfully');
    } catch (error) {
      console.error('❌ Error sending audio:', error);
      this.onError?.(`Failed to send audio: ${error}`);
    }
  }

  endTurn(): void {
    if (!this.websocket || this.connectionState !== "connected") {
      console.warn('Cannot end turn: not connected');
      return;
    }

    try {
      const message = {
        type: 'endTurn'
      };
      
      this.websocket.send(JSON.stringify(message));
      console.log('🔚 Signaling end of turn to Gemini');
    } catch (error) {
      console.error('❌ Error ending turn:', error);
      this.onError?.(`Failed to end turn: ${error}`);
    }
  }

  sendText(text: string): void {
    if (!this.websocket || this.connectionState !== "connected") {
      console.warn('Cannot send text: not connected');
      return;
    }

    try {
      const message = {
        type: 'text',
        text: text
      };
      
      this.websocket.send(JSON.stringify(message));
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