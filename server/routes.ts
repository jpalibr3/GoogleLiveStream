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

// Helper function to start listening for Live API responses
async function startLiveSessionListening(liveSession: any, ws: WebSocket) {
  try {
    for await (const response of liveSession.receive()) {
      if (response.data) {
        // Forward audio data to client
        ws.send(JSON.stringify({
          type: 'audio',
          data: response.data
        }));
      }
      
      if (response.text) {
        // Forward text response to client
        ws.send(JSON.stringify({
          type: 'text',
          text: response.text
        }));
      }
    }
  } catch (error) {
    console.error('Live session error:', error);
    ws.send(JSON.stringify({
      type: 'error',
      error: `Live session error: ${error}`
    }));
  }
}

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
              genAI = new GoogleGenAI({ apiKey });
              
              const modelName = message.config?.model || "models/gemini-2.5-flash-preview-native-audio-dialog";
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

              // Connect using the server-side Live API
              liveSession = await genAI.live.connect({ model: modelName, config });
              
              // Start listening for responses in background
              startLiveSessionListening(liveSession, ws);
              
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
                // Forward audio data to Live API session
                await liveSession.send({
                  data: message.data,
                  mimeType: "audio/pcm"
                });
              } catch (error) {
                console.error('Error sending audio to Live API:', error);
                ws.send(JSON.stringify({
                  type: 'error',
                  error: `Failed to send audio: ${error}`
                }));
              }
            }
            break;

          case 'text':
            if (liveSession && message.text) {
              try {
                // Forward text to Live API session
                await liveSession.send(message.text);
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
