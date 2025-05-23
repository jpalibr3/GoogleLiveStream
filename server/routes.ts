import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";

interface GeminiLiveMessage {
  type: string;
  apiKey?: string;
  config?: any;
  data?: any;
  text?: string;
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
    
    let geminiWs: WebSocket | null = null;
    let apiKey: string | null = null;

    ws.on('message', async (data: Buffer) => {
      try {
        const message: GeminiLiveMessage = JSON.parse(data.toString());
        
        switch (message.type) {
          case 'setup':
            apiKey = message.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
            
            if (!apiKey) {
              ws.send(JSON.stringify({
                type: 'error',
                error: 'API key not provided'
              }));
              return;
            }

            // Connect to Gemini Live API
            try {
              const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
              geminiWs = new WebSocket(geminiUrl);

              geminiWs.on('open', () => {
                console.log('Connected to Gemini Live API');
                
                // Send setup configuration
                if (geminiWs && message.config) {
                  geminiWs.send(JSON.stringify(message.config));
                }
                
                // Notify client of successful connection
                ws.send(JSON.stringify({
                  type: 'connected'
                }));
              });

              geminiWs.on('message', (geminiData: Buffer) => {
                try {
                  const geminiMessage = JSON.parse(geminiData.toString());
                  
                  // Forward Gemini response to client
                  if (geminiMessage.serverContent) {
                    // Handle audio response
                    if (geminiMessage.serverContent.modelTurn?.parts) {
                      for (const part of geminiMessage.serverContent.modelTurn.parts) {
                        if (part.inlineData?.data) {
                          ws.send(JSON.stringify({
                            type: 'audio',
                            data: part.inlineData.data
                          }));
                        }
                        if (part.text) {
                          ws.send(JSON.stringify({
                            type: 'text',
                            text: part.text
                          }));
                        }
                      }
                    }
                  }
                } catch (error) {
                  console.error('Error processing Gemini message:', error);
                }
              });

              geminiWs.on('error', (error) => {
                console.error('Gemini WebSocket error:', error);
                ws.send(JSON.stringify({
                  type: 'error',
                  error: `Gemini API connection error: ${error.message || error}`
                }));
              });

              geminiWs.on('close', (code, reason) => {
                console.log('Gemini WebSocket closed with code:', code, 'reason:', reason.toString());
                ws.send(JSON.stringify({
                  type: 'error',
                  error: `Gemini API connection closed (code: ${code}) - ${reason.toString() || 'Please check API key permissions for Gemini Live API'}`
                }));
              });

            } catch (error) {
              console.error('Error connecting to Gemini Live API:', error);
              ws.send(JSON.stringify({
                type: 'error',
                error: 'Failed to connect to Gemini Live API'
              }));
            }
            break;

          case 'audio':
            if (geminiWs && geminiWs.readyState === WebSocket.OPEN && message.data) {
              // Forward audio data to Gemini
              const geminiMessage = {
                realtimeInput: {
                  audio: message.data
                }
              };
              geminiWs.send(JSON.stringify(geminiMessage));
            }
            break;

          case 'text':
            if (geminiWs && geminiWs.readyState === WebSocket.OPEN && message.text) {
              // Forward text to Gemini
              const geminiMessage = {
                clientContent: {
                  turns: [{
                    role: "user",
                    parts: [{ text: message.text }]
                  }],
                  turnComplete: true
                }
              };
              geminiWs.send(JSON.stringify(geminiMessage));
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
      if (geminiWs) {
        geminiWs.close();
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      if (geminiWs) {
        geminiWs.close();
      }
    });
  });

  return httpServer;
}
