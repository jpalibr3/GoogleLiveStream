export class VoiceActivityDetector {
  private analyser: AnalyserNode;
  private dataArray: Uint8Array;
  private isActive = false;
  private silenceThreshold = 30; // Adjust based on environment
  private silenceFrames = 0;
  private maxSilenceFrames = 30; // ~1 second at 30fps
  private voiceFrames = 0;
  private minVoiceFrames = 5; // Minimum frames to consider speech started
  
  public onSpeechStart?: () => void;
  public onSpeechEnd?: () => void;
  public onVolumeChange?: (volume: number) => void;

  constructor(audioContext: AudioContext, source: MediaStreamAudioSourceNode) {
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    
    const bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(bufferLength);
    
    source.connect(this.analyser);
    this.startDetection();
  }

  private startDetection() {
    const detectVoice = () => {
      if (!this.isActive) return;
      
      this.analyser.getByteFrequencyData(this.dataArray);
      
      // Calculate average volume
      const average = this.dataArray.reduce((sum, value) => sum + value, 0) / this.dataArray.length;
      this.onVolumeChange?.(average);
      
      const isSpeaking = average > this.silenceThreshold;
      
      if (isSpeaking) {
        this.voiceFrames++;
        this.silenceFrames = 0;
        
        // Start speech if we have enough voice frames
        if (this.voiceFrames >= this.minVoiceFrames && !this.isSpeechActive()) {
          console.log('🎤 Speech detected - starting conversation');
          this.onSpeechStart?.();
        }
      } else {
        this.silenceFrames++;
        this.voiceFrames = 0;
        
        // End speech if we have enough silence frames
        if (this.silenceFrames >= this.maxSilenceFrames && this.isSpeechActive()) {
          console.log('🔇 Silence detected - ending turn');
          this.onSpeechEnd?.();
        }
      }
      
      requestAnimationFrame(detectVoice);
    };
    
    this.isActive = true;
    detectVoice();
  }

  private isSpeechActive(): boolean {
    return this.voiceFrames >= this.minVoiceFrames;
  }

  stop() {
    this.isActive = false;
  }

  setSensitivity(threshold: number) {
    this.silenceThreshold = threshold;
  }
}