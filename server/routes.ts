import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, LiveServerMessage, MediaResolution, Modality, Session } from "@google/genai";
import { storage } from "./storage";

interface GeminiLiveMessage {
  type: string;
  apiKey?: string;
  config?: any;
  data?: any;
  text?: string;
  mimeType?: string;
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
    
    let liveSession: Session | null = null;
  const responseQueue: LiveServerMessage[] = [];

  // Handle responses like TypeScript example
  function handleModelTurn(message: LiveServerMessage, ws: WebSocket) {
    if (message.serverContent?.modelTurn?.parts) {
      const part = message.serverContent.modelTurn.parts[0];

      if (part.inlineData) {
        console.log('🔊 Audio data received from Gemini');
        ws.send(JSON.stringify({
          type: 'audio',
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType
        }));
      }

      if (part.text) {
        console.log('💬 Text received from Gemini:', part.text);
        ws.send(JSON.stringify({
          type: 'text',
          text: part.text
        }));
      }
    }
  }

  async function waitMessage(ws: WebSocket): Promise<LiveServerMessage> {
    let done = false;
    let message: LiveServerMessage | undefined = undefined;
    while (!done) {
      message = responseQueue.shift();
      if (message) {
        handleModelTurn(message, ws);
        done = true;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return message!;
  }

  async function handleTurn(ws: WebSocket): Promise<LiveServerMessage[]> {
    const turn: LiveServerMessage[] = [];
    let done = false;
    while (!done) {
      const message = await waitMessage(ws);
      turn.push(message);
      if (message.serverContent && message.serverContent.turnComplete) {
        done = true;
      }
    }
    return turn;
  }
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

              console.log('🚀 Connecting using proven Python pattern...');
              genAI = new GoogleGenAI({ apiKey });
              
              const modelName = "models/gemini-2.0-flash-live-001";
              console.log('Using model:', modelName);
              
              // Use proper TypeScript config format like the example
              const config = {
                responseModalities: [Modality.AUDIO],
                mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: 'Zephyr',
                    }
                  }
                }
              };

              console.log('🧪 Testing Live API connection with detailed logging...');
              console.log('📋 Model:', modelName);
              console.log('📋 Config:', JSON.stringify(config, null, 2));
              
              // Test connection with comprehensive error handling
              try {
                console.log('🔄 Calling genAI.live.connect()...');
                liveSession = await genAI.live.connect({
                model: modelName,
                callbacks: {
                  onopen: function () {
                    console.log('✅ SUCCESS: Live API connection opened!');
                    ws.send(JSON.stringify({
                      type: 'debug',
                      message: 'Live API connection established successfully'
                    }));
                  },
                  onmessage: function (responseMessage: LiveServerMessage) {
                    console.log('🔔 Message received from Live API:', JSON.stringify(responseMessage, null, 2));
                    
                    // Directly process and forward responses to client
                    if (responseMessage.serverContent?.modelTurn?.parts) {
                      const part = responseMessage.serverContent.modelTurn.parts[0];
                      
                      if (part.inlineData?.data && part.inlineData.mimeType) {
                        console.log('🔊 Audio data received from Gemini, forwarding to client');
                        ws.send(JSON.stringify({
                          type: 'audio',
                          data: part.inlineData.data, // This is base64
                          mimeType: part.inlineData.mimeType
                        }));
                      }
                      
                      if (part.text) {
                        console.log('💬 Text received from Gemini, forwarding to client:', part.text);
                        ws.send(JSON.stringify({
                          type: 'text',
                          text: part.text
                        }));
                      }
                    }
                    
                    if (responseMessage.serverContent?.interrupted) {
                      console.log('🛑 Generation interrupted by Gemini.');
                      ws.send(JSON.stringify({ type: 'interrupted' }));
                    }
                  },
                  onerror: function (e: ErrorEvent) {
                    console.error('❌ LIVE API ERROR DETAILS:');
                    console.error('  - Error object:', e);
                    console.error('  - Message:', e.message);
                    console.error('  - Type:', e.type);
                    console.error('  - Error property:', e.error);
                    ws.send(JSON.stringify({
                      type: 'error',
                      error: `Live API Error: ${e.message || e.type || 'Connection failed'}`
                    }));
                    // Attempt to close and cleanup on error
                    if (liveSession) {
                      try {
                        liveSession.close();
                      } catch (err) {
                        console.error('Error closing session:', err);
                      }
                    }
                  },
                  onclose: function (e: CloseEvent) {
                    console.log('🔌 Live API connection closed:', e.reason);
                    ws.send(JSON.stringify({
                      type: 'error',
                      error: 'Connection closed: ' + e.reason
                    }));
                  },
                },
                config
              });
              
              console.log('✅ SUCCESS: genAI.live.connect() completed without throwing');
              
              // Start processing responses
              handleTurn(ws);
              
              // Notify client of successful connection
              ws.send(JSON.stringify({
                type: 'connected'
              }));
              
              } catch (connectError) {
                console.error('❌ CRITICAL: genAI.live.connect() failed completely:');
                console.error('  - Error type:', typeof connectError);
                console.error('  - Error object:', connectError);
                console.error('  - Error message:', connectError instanceof Error ? connectError.message : String(connectError));
                console.error('  - Error stack:', connectError instanceof Error ? connectError.stack : 'No stack trace');
                
                ws.send(JSON.stringify({
                  type: 'error',
                  error: `Live API Connection Failed: ${connectError instanceof Error ? connectError.message : String(connectError)}`
                }));
                
                throw connectError; // Re-throw to be caught by outer try-catch
              }

            } catch (error) {
              console.error('Error connecting to Gemini Live API:', error);
              ws.send(JSON.stringify({
                type: 'error',
                error: `Failed to connect to Gemini Live API: ${error}`
              }));
            }
            break;

          case 'audio':
            if (liveSession && message.data && typeof message.data === 'string' && message.mimeType) {
              try {
                console.log(`📤 Relaying audio to Live API: mimeType=${message.mimeType}, data length=${message.data.length}`);
                
                // Use correct SDK structure for sendRealtimeInput
                await liveSession.sendRealtimeInput({
                  audio: { 
                    data: message.data, 
                    mimeType: message.mimeType 
                  }
                });
                
                console.log('✅ Audio data relayed successfully to Live API');
              } catch (error) {
                console.error('❌ Error sending audio to Live API:', error);
                ws.send(JSON.stringify({ 
                  type: 'error', 
                  error: `Failed to send audio: ${error instanceof Error ? error.message : String(error)}` 
                }));
              }
            } else {
              console.warn('⚠️ No liveSession or invalid audio message from client', message);
              ws.send(JSON.stringify({ 
                type: 'error', 
                error: 'Invalid audio message format from client' 
              }));
            }
            break;

          case 'text':
            if (liveSession) {
              try {
                console.log('🔚 Sending turn completion using TypeScript pattern');
                
                // Send turn completion using TypeScript sendClientContent method
                liveSession.sendClientContent({
                  turns: [
                    "Please respond with voice" // Simple prompt to trigger response
                  ]
                });
                
                console.log('✅ Turn completion sent successfully (TypeScript pattern)');
              } catch (error) {
                console.error('Error sending text to Live API:', error);
                ws.send(JSON.stringify({
                  type: 'error',
                  error: `Failed to send text: ${error}`
                }));
              }
            }
            break;

          case 'endTurn':
            console.log('🚨 DEBUG: endTurn case triggered - TESTING NO EXPLICIT SIGNALS');
            console.log('🔇 Letting Gemini handle turn completion naturally (no explicit signals sent)');
            // REMOVED: All explicit turn completion signals to test if Gemini's natural VAD 
            // and generationComplete handling works better without our interference
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
