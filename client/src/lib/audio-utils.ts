export function encodeAudioData(audioData: Float32Array): string {
  // Convert float32 samples to int16
  const int16Array = new Int16Array(audioData.length);
  for (let i = 0; i < audioData.length; i++) {
    // Clamp values to [-1, 1] and convert to int16 range [-32768, 32767]
    const clamped = Math.max(-1, Math.min(1, audioData[i]));
    int16Array[i] = Math.round(clamped * 32767);
  }

  // Convert to base64
  const uint8Array = new Uint8Array(int16Array.buffer);
  return btoa(String.fromCharCode(...uint8Array));
}

export function decode(base64Data: string): Uint8Array {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: string,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  console.log('🔍 Decoding PCM - base64 length:', data.length, 'sampleRate:', sampleRate);
  
  const uint8Data = decode(data);
  console.log('🔍 Raw bytes length:', uint8Data.length);
  
  // Check if byte length is perfectly divisible for 16-bit samples
  const expectedSamples = Math.floor(uint8Data.length / 2 / numChannels);
  const actualByteLength = expectedSamples * 2 * numChannels;
  console.log('🔍 Expected samples:', expectedSamples, 'Actual byte usage:', actualByteLength, 'vs total:', uint8Data.length);
  
  const buffer = ctx.createBuffer(
    numChannels,
    expectedSamples,
    sampleRate,
  );

  const dataInt16 = new Int16Array(uint8Data.buffer);
  const l = dataInt16.length;
  console.log('🔍 Int16 samples count:', l);
  console.log('🔍 First 5 raw bytes:', Array.from(uint8Data.slice(0, 10)));
  console.log('🔍 Last 5 raw bytes:', Array.from(uint8Data.slice(-10)));
  console.log('🔍 First 5 Int16:', Array.from(dataInt16.slice(0, 5)));
  console.log('🔍 Last 5 Int16:', Array.from(dataInt16.slice(-5)));
  
  const dataFloat32 = new Float32Array(l);
  let clippedSamples = 0;
  for (let i = 0; i < l; i++) {
    // Normalize 16-bit signed PCM to [-1, 1] range
    const sample = dataInt16[i] / 32768.0;
    if (Math.abs(sample) > 1.0) clippedSamples++;
    dataFloat32[i] = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
  }
  
  console.log('🔍 First 5 Float32:', Array.from(dataFloat32.slice(0, 5)));
  console.log('🔍 Last 5 Float32:', Array.from(dataFloat32.slice(-5)));
  console.log('🔍 Clipped samples:', clippedSamples, 'out of', l);
  
  // Extract interleaved channels
  if (numChannels === 1) {
    buffer.copyToChannel(dataFloat32, 0);
  } else {
    for (let i = 0; i < numChannels; i++) {
      const channel = dataFloat32.filter(
        (_, index) => index % numChannels === i,
      );
      buffer.copyToChannel(channel, i);
    }
  }

  return buffer;
}

export function createAudioBlob(audioData: Float32Array): { data: string; mimeType: string } {
  return {
    data: encodeAudioData(audioData),
    mimeType: "audio/pcm;rate=16000"
  };
}

export async function processAudioBuffer(
  buffer: AudioBuffer,
  targetSampleRate: number = 16000
): Promise<Float32Array> {
  const channelData = buffer.getChannelData(0); // Use first channel
  
  if (buffer.sampleRate === targetSampleRate) {
    return channelData;
  }

  // Simple resampling (for production, consider using a proper resampling library)
  const ratio = buffer.sampleRate / targetSampleRate;
  const outputLength = Math.floor(channelData.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = Math.floor(i * ratio);
    output[i] = channelData[sourceIndex];
  }

  return output;
}
