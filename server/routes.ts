import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Live } from "@google/genai";
import { storage } from "./storage";

interface GeminiLiveMessage {
  type: string;
  apiKey?: string;
  config?: any;
  data?: any;
  text?: string;
}

// JavaScript SDK uses callbacks instead of receive() - removed old function

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // API endpoint to provide API key to frontend
  app.get('/api/get-api-key', (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'API key not configured' });
    }
    res.json({ apiKey });
  });

  // Test endpoint to verify API key works with basic Gemini API
  app.get('/api/test-gemini', async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'API key not configured' });
      }

      console.log('Testing API key with basic Gemini API...');
      const genAI = new GoogleGenAI({ apiKey });
      const response = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: "Explain how AI works in a few words"
      });

      console.log('✅ API key test successful! Response:', response.text);
      res.json({ 
        success: true, 
        text: response.text,
        message: "API key works with basic Gemini API!" 
      });

    } catch (error) {
      console.error('Gemini API test error:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to connect to Gemini API',
        details: error
      });
    }
  });

  // Create WebSocket server on /ws path to avoid conflicts with Vite HMR
  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: '/ws' 
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected to WebSocket');
    
    let liveSession: any = null;
    let genAI: GoogleGenAI | null = null;

    ws.on('message', async (data: Buffer) => {
      try {
        const message: GeminiLiveMessage = JSON.parse(data.toString());
        
        switch (message.type) {
          case 'setup':
            const apiKey = message.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
            
            if (!apiKey) {
              ws.send(JSON.stringify({
                type: 'error',
                error: 'API key not provided'
              }));
              return;
            }

            // Initialize Google GenAI client and Live API on server
            try {
              if (!apiKey) {
                throw new Error('API key is missing or invalid');
              }

              console.log('Initializing GenAI with provided API key...');
              genAI = new GoogleGenAI({ apiKey });
              
              const modelName = message.config?.model || "gemini-2.5-flash-preview-native-audio-dialog";
              console.log('Using model:', modelName);
              
              const config = {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: "Zephyr"
                    }
                  }
                },
                mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
                ...message.config?.generationConfig
              };

              console.log('Attempting to connect to Gemini Live API...');
              
              // Add required callbacks parameter with onmessage
              const connectParams = {
                model: modelName,
                config,
                callbacks: {
                  onmessage: (message: any) => {
                    console.log('🔔 Live API message received:', JSON.stringify(message, null, 2));
                    
                    // Handle different message types
                    if (message.serverContent?.modelTurn?.parts) {
                      console.log('📝 Processing model turn with parts:', message.serverContent.modelTurn.parts.length);
                      for (const part of message.serverContent.modelTurn.parts) {
                        if (part.inlineData?.mimeType?.startsWith('audio/')) {
                          console.log('🔊 Sending audio response to client, mimeType:', part.inlineData.mimeType);
                          ws.send(JSON.stringify({
                            type: 'audio',
                            data: part.inlineData.data,
                            mimeType: part.inlineData.mimeType
                          }));
                        } else if (part.text) {
                          console.log('💬 Sending text response to client:', part.text);
                          ws.send(JSON.stringify({
                            type: 'text',
                            text: part.text
                          }));
                        }
                      }
                    } else {
                      console.log('ℹ️ Message received but no model turn parts found');
                    }
                  },
                  onData: (data: any) => {
                    console.log('Live API data received:', data);
                    ws.send(JSON.stringify({ type: 'audio', data: data }));
                  },
                  onText: (text: string) => {
                    console.log('Live API text received:', text);
                    ws.send(JSON.stringify({ type: 'text', text: text }));
                  },
                  onError: (error: any) => {
                    console.error('Live API callback error:', error);
                    ws.send(JSON.stringify({ type: 'error', error: error.message }));
                  }
                }
              };
              
              // Connect using the server-side Live API
              liveSession = await genAI.live.connect(connectParams);
              
              // Debug: Check what methods are available on liveSession
              console.log('Live session object type:', typeof liveSession);
              console.log('Live session methods:', Object.getOwnPropertyNames(liveSession));
              console.log('Live session prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(liveSession)));
              
              // Check if liveSession has receive method
              console.log('Has receive method:', 'receive' in liveSession);
              console.log('Receive method type:', typeof liveSession.receive);
              
              // Callbacks handle responses automatically - no need for manual listening
              
              // Notify client of successful connection
              ws.send(JSON.stringify({
                type: 'connected'
              }));
              
              console.log('Connected to Gemini Live API via server SDK');

            } catch (error) {
              console.error('Error connecting to Gemini Live API:', error);
              ws.send(JSON.stringify({
                type: 'error',
                error: `Failed to connect to Gemini Live API: ${error}`
              }));
            }
            break;

          case 'audio':
            if (liveSession && message.data) {
              try {
                console.log('📤 Sending audio data to Live API, length:', message.data.length);
                console.log('📤 Audio data type:', typeof message.data);
                console.log('📤 Audio data sample:', message.data.substring(0, 100));
                
                // Use sendRealtimeInput for audio data
                await liveSession.sendRealtimeInput({
                  mediaChunks: [{
                    mimeType: 'audio/pcm',
                    data: message.data
                  }]
                });
                
                console.log('✅ Audio data sent successfully to Live API');
              } catch (error) {
                console.error('❌ Error sending audio to Live API:', error);
                ws.send(JSON.stringify({
                  type: 'error',
                  error: `Failed to send audio: ${error}`
                }));
              }
            } else {
              console.log('⚠️ No liveSession or audio data to send');
            }
            break;

          case 'text':
            if (liveSession && message.text) {
              try {
                // Use sendClientContent for text
                await liveSession.sendClientContent({
                  turns: [{
                    role: 'user',
                    parts: [{
                      text: message.text
                    }]
                  }]
                });
              } catch (error) {
                console.error('Error sending text to Live API:', error);
                ws.send(JSON.stringify({
                  type: 'error',
                  error: `Failed to send text: ${error}`
                }));
              }
            }
            break;

          default:
            console.log('Unknown message type:', message.type);
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Invalid message format'
        }));
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected from WebSocket');
      if (liveSession) {
        liveSession.close?.();
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      if (liveSession) {
        liveSession.close?.();
      }
    });
  });

  return httpServer;
}
