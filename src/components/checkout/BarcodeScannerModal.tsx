import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import {
  DecodeHintType,
  BarcodeFormat,
  type IScannerControls,
} from '@zxing/library';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CameraOff, SwitchCamera, Flashlight, CheckCircle2 } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Returns true if the scan matched/was accepted, false otherwise. */
  onScan: (code: string) => boolean | void;
}

// 1D barcode formats used by the warehouse (Code 128/39, EAN, UPC, ITF) + QR.
const SUPPORTED_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
];

// Native BarcodeDetector formats (Android Chrome) — equivalent set.
const NATIVE_FORMATS = [
  'code_128',
  'code_39',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'itf',
  'codabar',
  'qr_code',
];

function beep(ok: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.15;
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.25));
    osc.onended = () => ctx.close();
  } catch {
    // ignore
  }
}

export default function BarcodeScannerModal({ open, onClose, onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zxingControlsRef = useRef<IScannerControls | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<{ ok: boolean; code: string } | null>(null);

  // Debounced handler so the same barcode isn't fired repeatedly while held in frame.
  const handleDecoded = useCallback((raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    if (lastCodeRef.current.code === code && now - lastCodeRef.current.at < 1500) return;
    lastCodeRef.current = { code, at: now };

    const accepted = onScanRef.current(code);
    const ok = accepted !== false;
    beep(ok);
    setLastFeedback({ ok, code });
    if (navigator.vibrate) navigator.vibrate(ok ? 60 : [40, 40, 40]);
  }, []);

  const stopScanner = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      zxingControlsRef.current?.stop();
    } catch {
      // ignore
    }
    zxingControlsRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchOn(false);
    setTorchAvailable(false);
  }, []);

  const applyTorch = useCallback(async (on: boolean) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as any] });
      setTorchOn(on);
    } catch {
      // ignore
    }
  }, []);

  const startScanner = useCallback(async () => {
    stopScanner();
    setError(null);
    setLastFeedback(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      (video as any).playsInline = true;
      await video.play();

      // Detect torch capability.
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as any;
      setTorchAvailable(!!caps.torch);

      // ---- Path 1: native BarcodeDetector (best on Android) ----
      const NativeDetector = (window as any).BarcodeDetector;
      if (NativeDetector) {
        let formats = NATIVE_FORMATS;
        try {
          const supported: string[] = await NativeDetector.getSupportedFormats();
          formats = NATIVE_FORMATS.filter(f => supported.includes(f));
          if (formats.length === 0) formats = supported;
        } catch {
          // use defaults
        }
        const detector = new NativeDetector({ formats });
        const tick = async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length > 0 && codes[0].rawValue) {
              handleDecoded(codes[0].rawValue);
            }
          } catch {
            // transient detect errors are fine
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // ---- Path 2: ZXing fallback (iOS Safari, etc.) ----
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
      zxingControlsRef.current = await reader.decodeFromVideoElement(video, (result) => {
        if (result) handleDecoded(result.getText());
      });
    } catch (err) {
      console.error('Camera error:', err);
      setError('Não foi possível acessar a câmera. Verifique as permissões do app.');
    }
  }, [facingMode, handleDecoded, stopScanner]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(startScanner, 250);
      return () => clearTimeout(t);
    }
    stopScanner();
  }, [open, startScanner, stopScanner]);

  useEffect(() => () => stopScanner(), [stopScanner]);

  // Auto-clear the on-screen feedback flash.
  useEffect(() => {
    if (!lastFeedback) return;
    const t = setTimeout(() => setLastFeedback(null), 1400);
    return () => clearTimeout(t);
  }, [lastFeedback]);

  const handleClose = () => {
    stopScanner();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0 [&>button]:z-20 [&>button]:text-white">
        <div className="bg-black relative">
          <video
            ref={videoRef}
            className="w-full min-h-[340px] object-cover"
            muted
            playsInline
          />

          {/* Overlay guide */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div
              className={`border-2 rounded-lg w-[280px] h-[150px] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] transition-colors ${
                lastFeedback ? (lastFeedback.ok ? 'border-green-400' : 'border-red-500') : 'border-white/70'
              }`}
            />
            <div className="absolute left-0 right-0 mx-auto w-[280px] h-[2px] bg-red-500/80 animate-pulse" />
          </div>

          {/* Scan feedback flash */}
          {lastFeedback && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-white ${lastFeedback.ok ? 'bg-green-600' : 'bg-red-600'}`}>
                {lastFeedback.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CameraOff className="h-3.5 w-3.5" />}
                {lastFeedback.code}
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-white p-6 text-center gap-3">
              <CameraOff className="h-10 w-10 text-destructive" />
              <p className="text-sm">{error}</p>
              <Button variant="secondary" size="sm" onClick={startScanner}>
                Tentar novamente
              </Button>
            </div>
          )}
        </div>

        <div className="p-4 flex items-center justify-between bg-card gap-2">
          <p className="text-xs text-muted-foreground flex-1">
            Aponte para o código de barras — leitura contínua
          </p>
          {torchAvailable && (
            <Button
              variant={torchOn ? 'default' : 'outline'}
              size="icon"
              onClick={() => applyTorch(!torchOn)}
              title="Lanterna"
            >
              <Flashlight className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={() => setFacingMode(p => (p === 'environment' ? 'user' : 'environment'))}
            title="Alternar câmera"
          >
            <SwitchCamera className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={handleClose}>
            Concluir leitura
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
