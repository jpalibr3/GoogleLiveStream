export class AudioAnalyzer {
  private analyser: AnalyserNode;
  private dataArray: Uint8Array;
  private bufferLength: number;

  constructor(audioContext: AudioContext) {
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 128;
    this.bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(this.bufferLength);
  }

  get analyserNode(): AnalyserNode {
    return this.analyser;
  }

  update(): void {
    this.analyser.getByteFrequencyData(this.dataArray);
  }

  getFrequencyData(): Uint8Array {
    return this.dataArray;
  }

  getAverageFrequency(): number {
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
    }
    return sum / this.dataArray.length;
  }

  getFrequencyRange(startHz: number, endHz: number, sampleRate: number = 44100): number {
    const nyquist = sampleRate / 2;
    const startBin = Math.floor((startHz / nyquist) * this.bufferLength);
    const endBin = Math.floor((endHz / nyquist) * this.bufferLength);
    
    let sum = 0;
    let count = 0;
    
    for (let i = startBin; i <= endBin && i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
      count++;
    }
    
    return count > 0 ? sum / count : 0;
  }
}
