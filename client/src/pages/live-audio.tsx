import { useState, useEffect, useRef, useCallback } from "react";
import { ThreeScene } from "@/components/three-scene";
import { AudioVisualizer } from "@/components/audio-visualizer";
import { ControlPanel } from "@/components/control-panel";
import { StatusOverlay } from "@/components/status-overlay";
import { AudioAnalyzer } from "@/lib/audio-analyzer";
import { GeminiLiveClient, ConnectionState } from "@/lib/gemini-live";
import { useToast } from "@/hooks/use-toast";

interface ParticleProps {
  id: number;
  x: number;
  y: number;
  delay: number;
  color: string;
  size: number;
}

export default function LiveAudio() {
  const { toast } = useToast();
  
  // State management
  const [isRecording, setIsRecording] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [statusMessage, setStatusMessage] = useState("Ready to connect to Gemini Live");
  const [error, setError] = useState<string | null>(null);
  
  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  const outputAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  const geminiClientRef = useRef<GeminiLiveClient | null>(null);
  
  // Generate floating particles
  const [particles] = useState<ParticleProps[]>(() => {
    return Array.from({ length: 8 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      delay: Math.random() * 5,
      color: Math.random() > 0.5 ? "hsl(var(--google-blue))" : "hsl(var(--neon-cyan))",
      size: Math.random() > 0.7 ? 2 : 1
    }));
  });

  // Initialize Gemini Live client
  useEffect(() => {
    const client = new GeminiLiveClient();
    geminiClientRef.current = client;

    // Set up event listeners
    client.onConnectionStateChange = (state) => {
      setConnectionState(state);
      
      switch (state) {
        case "connecting":
          setStatusMessage("Connecting to Gemini Live...");
          break;
        case "connected":
          setStatusMessage("Gemini Live Session Active");
          setError(null);
          break;
        case "disconnected":
          setStatusMessage("Disconnected from Gemini Live");
          break;
        case "error":
          setStatusMessage("Connection failed");
          setError("Failed to connect to Gemini Live API");
          break;
      }
    };

    client.onAudioReceived = (audioData) => {
      // Handle received audio from Gemini
      playAudioResponse(audioData);
    };

    client.onError = (errorMessage) => {
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
    };

    return () => {
      client.disconnect();
    };
  }, [toast]);

  // Play audio response from Gemini
  const playAudioResponse = useCallback(async (audioData: Uint8Array) => {
    if (!audioContextRef.current) return;

    try {
      // Decode the audio data and play it
      const audioBuffer = await audioContextRef.current.decodeAudioData(audioData.buffer.slice());
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      
      // Create analyzer for output audio
      if (!outputAnalyzerRef.current) {
        outputAnalyzerRef.current = new AudioAnalyzer(audioContextRef.current);
      }
      
      source.connect(outputAnalyzerRef.current.analyser);
      source.connect(audioContextRef.current.destination);
      source.start();
    } catch (error) {
      console.error("Error playing audio response:", error);
    }
  }, []);

  // Start recording function
  const handleStartRecording = useCallback(async () => {
    try {
      setStatusMessage("Requesting microphone access...");
      
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      // Initialize audio context
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000
      });
      
      audioContextRef.current = audioContext;
      mediaStreamRef.current = stream;

      // Create input analyzer
      const source = audioContext.createMediaStreamSource(stream);
      inputAnalyzerRef.current = new AudioAnalyzer(audioContext);
      source.connect(inputAnalyzerRef.current.analyser);

      // Set recording state first
      setIsRecording(true);
      
      // Connect to Gemini Live
      await geminiClientRef.current?.connect();
      
      // Start sending audio data
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        // Only check if client is connected, not isRecording state (which may be stale)
        if (geminiClientRef.current?.isConnected()) {
          const inputData = event.inputBuffer.getChannelData(0);
          console.log('🎤 Sending audio data from processor, length:', inputData.length);
          geminiClientRef.current.sendAudio(inputData);
        } else {
          console.log('⚠️ Not sending audio - client not connected');
        }
      };
      
      source.connect(processor);
      processor.connect(audioContext.destination);
      setStatusMessage("🔴 Recording... Capturing audio data.");
      setError(null);

    } catch (error) {
      console.error("Error starting recording:", error);
      setError(`Failed to start recording: ${error instanceof Error ? error.message : "Unknown error"}`);
      setStatusMessage("Error starting recording");
    }
  }, [isRecording]);

  // Stop recording function
  const handleStopRecording = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    inputAnalyzerRef.current = null;
    outputAnalyzerRef.current = null;
    
    // Signal turn completion to Gemini before stopping
    if (geminiClientRef.current?.isConnected()) {
      console.log('🔚 Signaling turn completion to Gemini');
      geminiClientRef.current.endTurn();
    }

    setIsRecording(false);
    setStatusMessage("Recording stopped. Click Start to begin again.");
  }, []);

  // Reset session function
  const handleReset = useCallback(() => {
    handleStopRecording();
    geminiClientRef.current?.disconnect();
    setError(null);
    setStatusMessage("Session cleared. Ready to connect to Gemini Live.");
  }, [handleStopRecording]);

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      {/* Three.js 3D Scene */}
      <ThreeScene 
        inputAnalyzer={inputAnalyzerRef.current}
        outputAnalyzer={outputAnalyzerRef.current}
        isActive={isRecording}
      />
      
      {/* Floating Particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {particles.map((particle) => (
          <div
            key={particle.id}
            className="absolute rounded-full opacity-30 particle-float"
            style={{
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              width: `${particle.size * 4}px`,
              height: `${particle.size * 4}px`,
              backgroundColor: particle.color,
              animationDelay: `${particle.delay}s`
            }}
          />
        ))}
      </div>

      {/* Status Overlay */}
      <StatusOverlay 
        connectionState={connectionState}
        error={error}
        statusMessage={statusMessage}
      />

      {/* Audio Visualizer */}
      <AudioVisualizer 
        inputAnalyzer={inputAnalyzerRef.current}
        outputAnalyzer={outputAnalyzerRef.current}
        isActive={isRecording}
      />

      {/* Control Panel */}
      <ControlPanel
        isRecording={isRecording}
        onStart={handleStartRecording}
        onStop={handleStopRecording}
        onReset={handleReset}
        disabled={connectionState === "connecting"}
      />

      {/* Status Message */}
      <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 z-10">
        <div className="text-white text-sm text-center opacity-80">
          {statusMessage}
        </div>
      </div>
    </div>
  );
}
