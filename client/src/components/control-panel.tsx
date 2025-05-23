import { RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ControlPanelProps {
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  disabled?: boolean;
}

export function ControlPanel({ 
  isRecording, 
  onStart, 
  onStop, 
  onReset, 
  disabled = false 
}: ControlPanelProps) {
  return (
    <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-20">
      <div className="glass-morphism rounded-2xl p-6">
        <div className="flex items-center gap-6">
          
          {/* Reset Button */}
          <Button
            onClick={onReset}
            disabled={disabled || isRecording}
            className="control-button glass-morphism rounded-xl p-4 bg-transparent border-white/20 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
            size="lg"
          >
            <RotateCcw className="w-8 h-8" />
          </Button>

          {/* Record Button */}
          <Button
            onClick={isRecording ? onStop : onStart}
            disabled={disabled}
            className={`control-button rounded-full p-6 relative ${
              isRecording 
                ? "bg-red-500 hover:bg-red-600 recording-active" 
                : "bg-red-500 hover:bg-red-600"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            size="lg"
          >
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center">
              {isRecording ? (
                <Square className="w-6 h-6 text-red-500 fill-current" />
              ) : (
                <div className="w-6 h-6 bg-red-500 rounded-full" />
              )}
            </div>
          </Button>

          {/* Stop Button */}
          <Button
            onClick={onStop}
            disabled={disabled || !isRecording}
            className="control-button glass-morphism rounded-xl p-4 bg-transparent border-white/20 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
            size="lg"
          >
            <Square className="w-8 h-8" />
          </Button>
        </div>

        {/* Control Labels */}
        <div className="flex justify-between text-xs text-gray-400 mt-4 px-2">
          <span>Reset</span>
          <span>{isRecording ? "Recording..." : "Start Recording"}</span>
          <span>Stop</span>
        </div>
      </div>
    </div>
  );
}
