import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, CameraOff, SwitchCamera } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}

export default function BarcodeScannerModal({ open, onClose, onScan }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const containerId = 'barcode-scanner-container';

  const stopScanner = useCallback(async () => {
    try {
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop();
      }
      scannerRef.current?.clear();
    } catch {
      // ignore
    }
    scannerRef.current = null;
  }, []);

  const startScanner = useCallback(async () => {
    await stopScanner();
    setError(null);

    try {
      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode },
        {
          fps: 15,
          qrbox: { width: 280, height: 160 },
          aspectRatio: 1.5,
        },
        (decodedText) => {
          onScan(decodedText);
          stopScanner();
          onClose();
        },
        () => { /* ignore scan failures */ }
      );
    } catch (err: any) {
      console.error('Camera error:', err);
      setError('Não foi possível acessar a câmera. Verifique as permissões.');
    }
  }, [facingMode, onScan, onClose, stopScanner]);

  useEffect(() => {
    if (open) {
      // Small delay to ensure the DOM container is rendered
      const t = setTimeout(startScanner, 300);
      return () => clearTimeout(t);
    } else {
      stopScanner();
    }
  }, [open, startScanner, stopScanner]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopScanner(); };
  }, [stopScanner]);

  const handleFlip = async () => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { stopScanner(); onClose(); } }}>
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0 [&>button]:z-20 [&>button]:text-white">
        <div className="bg-black relative">
          {/* Scanner viewport */}
          <div id={containerId} className="w-full min-h-[320px]" />

          {/* Overlay guide */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="border-2 border-white/60 rounded-lg w-[280px] h-[160px] shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
          </div>

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white p-6 text-center gap-3">
              <CameraOff className="h-10 w-10 text-destructive" />
              <p className="text-sm">{error}</p>
              <Button variant="secondary" size="sm" onClick={startScanner}>
                Tentar novamente
              </Button>
            </div>
          )}
        </div>

        <div className="p-4 flex items-center justify-between bg-card">
          <p className="text-sm text-muted-foreground">
            Aponte a câmera para o código de barras
          </p>
          <Button variant="outline" size="icon" onClick={handleFlip} title="Alternar câmera">
            <SwitchCamera className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
