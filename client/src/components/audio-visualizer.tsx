import { useEffect, useState } from "react";
import { AudioAnalyzer } from "@/lib/audio-analyzer";

interface AudioVisualizerProps {
  inputAnalyzer: AudioAnalyzer | null;
  outputAnalyzer: AudioAnalyzer | null;
  isActive: boolean;
}

export function AudioVisualizer({ inputAnalyzer, outputAnalyzer, isActive }: AudioVisualizerProps) {
  const [inputBars, setInputBars] = useState<number[]>([20, 20, 20, 20, 20]);
  const [outputBars, setOutputBars] = useState<number[]>([20, 20, 20, 20, 20]);

  useEffect(() => {
    if (!isActive) {
      setInputBars([20, 20, 20, 20, 20]);
      setOutputBars([20, 20, 20, 20, 20]);
      return;
    }

    const updateBars = () => {
      // Update input bars
      if (inputAnalyzer) {
        inputAnalyzer.update();
        const data = inputAnalyzer.getFrequencyData();
        const newInputBars = Array.from({ length: 5 }, (_, i) => {
          const index = Math.floor((i / 5) * data.length);
          return Math.max(20, (data[index] / 255) * 100);
        });
        setInputBars(newInputBars);
      }

      // Update output bars
      if (outputAnalyzer) {
        outputAnalyzer.update();
        const data = outputAnalyzer.getFrequencyData();
        const newOutputBars = Array.from({ length: 5 }, (_, i) => {
          const index = Math.floor((i / 5) * data.length);
          return Math.max(20, (data[index] / 255) * 100);
        });
        setOutputBars(newOutputBars);
      }
    };

    const interval = setInterval(updateBars, 100);
    return () => clearInterval(interval);
  }, [inputAnalyzer, outputAnalyzer, isActive]);

  return (
    <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2 z-10">
      <div className="glass-morphism rounded-2xl p-4 mt-[50px] mb-[50px]">
        <div className="flex items-center gap-4">
          {/* Input Audio Bars */}
          <div className="flex items-end gap-1 h-12">
            {inputBars.map((height, index) => (
              <div
                key={`input-${index}`}
                className="w-2 bg-gradient-to-t from-red-500 to-amber-400 rounded-sm transition-all duration-150"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
          
          <div className="text-white text-xs font-medium">INPUT</div>
          
          {/* Output Audio Bars */}
          <div className="flex items-end gap-1 h-12">
            {outputBars.map((height, index) => (
              <div
                key={`output-${index}`}
                className="w-2 rounded-sm transition-all duration-150"
                style={{ 
                  height: `${height}%`,
                  background: "linear-gradient(to top, hsl(var(--google-blue)), hsl(var(--neon-cyan)))"
                }}
              />
            ))}
          </div>
          
          <div className="text-white text-xs font-medium">OUTPUT</div>
        </div>
      </div>
    </div>
  );
}
