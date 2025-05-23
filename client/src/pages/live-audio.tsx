import { useState, useEffect, useRef, useCallback } from "react";
import { ThreeScene } from "@/components/three-scene";
import { AudioVisualizer } from "@/components/audio-visualizer";
import { ControlPanel } from "@/components/control-panel";
import { StatusOverlay } from "@/components/status-overlay";
import { AudioAnalyzer } from "@/lib/audio-analyzer";
import { GeminiLiveClient, ConnectionState } from "@/lib/gemini-live";
import { VoiceActivityDetector } from "@/lib/voice-activity-detector";
import { decodeAudioData as customDecodeAudioData } from "@/lib/audio-utils";
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
  const [selectedModel, setSelectedModel] = useState("models/gemini-2.0-flash-live-001");
  
  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackAudioContextRef = useRef<AudioContext | null>(null); // Dedicated 24kHz context for Gemini audio
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  const outputAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  const geminiClientRef = useRef<GeminiLiveClient | null>(null);
  const voiceDetectorRef = useRef<VoiceActivityDetector | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  
  // Audio queue system for sequential playback
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  
  // Sequential audio playback handler
  const playNextInQueue = useCallback(() => {
    if (!playbackAudioContextRef.current || audioQueueRef.current.length === 0 || isPlayingRef.current) {
      return;
    }
    
    const buffer = audioQueueRef.current.shift();
    if (!buffer) return;
    
    isPlayingRef.current = true;
    const source = playbackAudioContextRef.current.createBufferSource();
    source.buffer = buffer;
    
    // Connect directly to destination only (testing without analyzer for cleaner audio)
    source.connect(playbackAudioContextRef.current.destination);
    
    // Calculate start time
    const currentTime = playbackAudioContextRef.current.currentTime;
    const startTime = Math.max(currentTime, nextPlayTimeRef.current);
    
    // Schedule playback
    source.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;
    
    console.log('🎵 Playing audio chunk sequentially, duration:', buffer.duration, 'start time:', startTime);
    
    // When this chunk ends, try to play the next one
    source.onended = () => {
      isPlayingRef.current = false;
      playNextInQueue();
    };
  }, []);
  
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

    client.onAudioReceived = (base64AudioData, mimeType) => {
      // Handle received audio from Gemini
      playAudioResponse(base64AudioData, mimeType);
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

  // Play audio response from Gemini using sequential queue
  const playAudioResponse = useCallback(async (base64AudioData: string, mimeType: string = 'audio/pcm;rate=24000') => {
    try {
      console.log('🔊 Queuing audio response, base64 length:', base64AudioData.length, 'mimeType:', mimeType);
      
      // Extract sample rate from mimeType (Priority 1: Correct playback sample rate)
      const sampleRate = parseInt(mimeType.split('rate=')[1]) || 24000;
      console.log('🎵 Detected sample rate:', sampleRate, 'Hz');
      
      // Create dedicated 24kHz playback context (separate from 16kHz recording context)
      if (!playbackAudioContextRef.current) {
        playbackAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 24000 // Always use 24kHz for Gemini playback
        });
        console.log('🎵 Created dedicated 24kHz playback AudioContext');
        
        // Initialize next play time
        nextPlayTimeRef.current = playbackAudioContextRef.current.currentTime;
        
        // Create output analyzer for the playback context
        if (!outputAnalyzerRef.current) {
          outputAnalyzerRef.current = new AudioAnalyzer(playbackAudioContextRef.current);
        }
      }
      
      // Decode audio using the dedicated 24kHz playback context
      const audioBuffer = await customDecodeAudioData(
        base64AudioData,
        playbackAudioContextRef.current,
        24000, // Force 24kHz for consistent playback
        1 // Mono audio from Gemini
      );
      
      // Priority 2: Add to queue for sequential playback
      audioQueueRef.current.push(audioBuffer);
      console.log('📥 Added audio chunk to queue, total chunks:', audioQueueRef.current.length);
      
      // Ensure the playback context is resumed
      if (playbackAudioContextRef.current.state === 'suspended') {
        await playbackAudioContextRef.current.resume();
      }
      
      // Start playing if not already playing
      playNextInQueue();

    } catch (error) {
      console.error("Error queuing audio response:", error);
      setError(`Playback error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [playNextInQueue]);

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

  // Available models for switching
  const availableModels = [
    { value: "models/gemini-2.0-flash-live-001", label: "Gemini 2.0 Flash Live" },
    { value: "models/gemini-2.5-flash-preview-native-audio-dialog", label: "Gemini 2.5 Flash Preview" }
  ];

  // Handle model change
  const handleModelChange = useCallback((newModel: string) => {
    setSelectedModel(newModel);
    
    // If currently connected, disconnect and reconnect with new model
    if (connectionState === "connected") {
      geminiClientRef.current?.disconnect();
      setTimeout(() => {
        geminiClientRef.current?.connect({ model: newModel });
      }, 500);
    }
    
    toast({
      title: "Model Changed",
      description: `Switched to ${availableModels.find(m => m.value === newModel)?.label}`,
    });
  }, [connectionState, toast]);

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      {/* Model Selector - Top Right */}
      <div className="absolute top-4 right-4 z-20">
        <div className="glass-morphism rounded-lg p-3">
          <label className="text-white text-xs font-medium mb-2 block">Model</label>
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
            className="bg-black/20 text-white text-sm rounded px-3 py-1 border border-white/20 min-w-[200px]"
          >
            {availableModels.map((model) => (
              <option key={model.value} value={model.value} className="bg-gray-800">
                {model.label}
              </option>
            ))}
          </select>
        </div>
      </div>

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
