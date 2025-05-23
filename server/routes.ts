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

  // Response listener function like Python's receive_audio
  async function startResponseListener(session: any, ws: WebSocket) {
    try {
      console.log('🎧 Starting response listener...');
      
      while (true) {
        const turn = session.receive();
        for await (const response of turn) {
          console.log('🔔 Response received:', JSON.stringify(response, null, 2));
          
          if (response.data) {
            console.log('🔊 Audio data received from Gemini');
            ws.send(JSON.stringify({
              type: 'audio',
              data: response.data
            }));
          }
          
          if (response.text) {
            console.log('💬 Text received from Gemini:', response.text);
            ws.send(JSON.stringify({
              type: 'text',
              text: response.text
            }));
          }
        }
        
        // Handle turn completion and interruptions like Python example
        console.log('🔄 Turn completed, ready for next interaction');
      }
    } catch (error) {
      console.error('❌ Response listener error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Response listener failed'
      }));
    }
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
              
              const modelName = "models/gemini-2.5-flash-preview-native-audio-dialog";
              console.log('Using model:', modelName);
              
              // Match exact config from working Python example
              const config = {
                response_modalities: ["AUDIO"],
                media_resolution: "MEDIA_RESOLUTION_MEDIUM", 
                speech_config: {
                  voice_config: {
                    prebuilt_voice_config: {
                      voice_name: "Zephyr"  // Same as Python example
                    }
                  }
                }
              };

              console.log('Attempting to connect to Gemini Live API...');
              
              // Use direct Live API connection like Python example
              liveSession = await genAI.live.connect({
                model: modelName,
                config: config
              });
              
              console.log('✅ Connected to Gemini Live API using Python pattern');
              
              // Start response listening like Python's receive_audio function
              startResponseListener(liveSession, ws);
              
              // Notify client of successful connection
              ws.send(JSON.stringify({
                type: 'connected'
              }));

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
                console.log('📤 Received audio data from client, length:', Array.isArray(message.data) ? message.data.length : 'not array');
                console.log('📤 Audio data type:', typeof message.data);
                
                // Convert array to base64 for Live API
                let audioData: string;
                if (Array.isArray(message.data)) {
                  // Convert Float32Array back to base64
                  const float32Array = new Float32Array(message.data);
                  const buffer = new ArrayBuffer(float32Array.length * 4);
                  const view = new DataView(buffer);
                  for (let i = 0; i < float32Array.length; i++) {
                    view.setFloat32(i * 4, float32Array[i], true);
                  }
                  audioData = Buffer.from(buffer).toString('base64');
                } else {
                  audioData = String(message.data);
                }
                
                console.log('📤 Converted audio data, length:', typeof audioData === 'string' ? audioData.length : 'not string');
                console.log('📤 Audio data sample:', typeof audioData === 'string' ? audioData.substring(0, 100) : 'Array data');
                
                // Send audio data like Python example
                await liveSession.send({
                  input: {
                    data: audioData,
                    mime_type: "audio/pcm" // Match Python format exactly
                  }
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
            if (liveSession) {
              try {
                console.log('🔚 Sending turn completion like Python example');
                
                // Send turn completion like Python: await self.session.send(input=text or ".", end_of_turn=True)
                await liveSession.send({
                  input: ".", // Minimal input like Python example
                  end_of_turn: true // Python pattern for turn completion
                });
                
                console.log('✅ Turn completion sent successfully (Python pattern)');
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
