import { AlertCircle, Wifi, WifiOff } from "lucide-react";
import { ConnectionState } from "@/lib/gemini-live";

interface StatusOverlayProps {
  connectionState: ConnectionState;
  error: string | null;
  statusMessage: string;
}

export function StatusOverlay({ connectionState, error, statusMessage }: StatusOverlayProps) {
  const getStatusColor = () => {
    switch (connectionState) {
      case "connected":
        return "bg-green-500";
      case "connecting":
        return "bg-yellow-500";
      case "error":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusIcon = () => {
    switch (connectionState) {
      case "connected":
        return <Wifi className="w-4 h-4" />;
      case "error":
        return <WifiOff className="w-4 h-4" />;
      default:
        return <Wifi className="w-4 h-4" />;
    }
  };

  return (
    <>
      {/* Connection Status */}
      <div className="absolute top-6 left-6 z-20">
        <div className="glass-morphism rounded-xl px-4 py-2 text-white">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full status-indicator ${getStatusColor()}`} />
            <span className="text-sm font-medium capitalize">{connectionState}</span>
            {getStatusIcon()}
          </div>
          <div className="text-xs text-gray-300 mt-1">
            {statusMessage}
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="absolute top-6 right-6 z-20">
          <div className="glass-morphism rounded-xl px-4 py-2 text-red-400 border-red-500/50">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Error</span>
            </div>
            <div className="text-xs text-red-300 mt-1 max-w-xs">
              {error}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
