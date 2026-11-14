import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal } from '@mansora/ui';

/**
 * C57: scan a barcode with the phone, tablet or laptop camera.
 *
 * Uses the browser's own barcode detector where it has one (Chrome on Android, most Android phones), and
 * otherwise a bundled decoder (iPhone Safari, Firefox, Windows laptops). Nothing leaves the device: frames are
 * read in the page and only the decoded number is used. A USB or Bluetooth scanner needs none of this: it types
 * the number like a keyboard, straight into the search box.
 */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

export function cameraAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function CameraScanButton({ onCode, continuous = false, label = 'Scan with camera' }: { onCode: (code: string) => void; continuous?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!cameraAvailable()) return null;
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} aria-label={label}>{label}</Button>
      {open && <CameraScanner continuous={continuous} onClose={() => setOpen(false)} onCode={(code) => { onCode(code); if (!continuous) setOpen(false); }} />}
    </>
  );
}

export function CameraScanner({ onCode, onClose, continuous }: { onCode: (code: string) => void; onClose: () => void; continuous?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const handler = useRef(onCode);
  handler.current = onCode;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | undefined;
    let stopDecoder: (() => void) | undefined;
    let lastCode = '', lastAt = 0;
    const hit = (code: string) => {
      const now = Date.now();
      // The same code seen again within two seconds is the same item still in view, not a second item.
      if (!code || (code === lastCode && now - lastAt < 2000)) return;
      lastCode = code; lastAt = now;
      navigator.vibrate?.(60);
      setLast(code);
      handler.current(code);
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const el = video.current!;
        el.srcObject = stream;
        await el.play();
        const Native = (window as any).BarcodeDetector;
        const supported: string[] = Native ? await Native.getSupportedFormats().catch(() => []) : [];
        if (Native && supported.some((f) => FORMATS.includes(f))) {
          const detector = new Native({ formats: FORMATS.filter((f) => supported.includes(f)) });
          let timer: ReturnType<typeof setTimeout>;
          const tick = async () => {
            if (stopped) return;
            try { const found = await detector.detect(el); if (found[0]?.rawValue) hit(String(found[0].rawValue).trim()); } catch { /* a frame that cannot be read is skipped */ }
            timer = setTimeout(tick, 150);
          };
          void tick();
          stopDecoder = () => clearTimeout(timer);
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromVideoElement(el, (result) => { if (result) hit(result.getText().trim()); });
          stopDecoder = () => controls.stop();
        }
      } catch (e: any) {
        if (stopped) return;
        setError(e?.name === 'NotAllowedError'
          ? 'Camera access was refused. Allow the camera for this site in your browser settings, then try again.'
          : e?.name === 'NotFoundError' ? 'No camera was found on this device.' : 'The camera could not be started. Type the barcode instead, or use a USB scanner.');
      }
    })();
    return () => { stopped = true; stopDecoder?.(); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <Modal title="Scan a barcode" open onClose={onClose} footer={<Button dismiss onClick={onClose}>{continuous ? 'Done' : 'Cancel'}</Button>}>
      {error ? <Alert tone="bad">{error}</Alert> : (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-md bg-black">
            <video ref={video} className="block w-full" muted playsInline aria-label="Camera view" />
            <div aria-hidden className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
          </div>
          <p className="text-sm text-slate-700">Hold the barcode flat, in good light, about a hand's width from the camera.</p>
          {last && <p className="text-sm font-medium text-emerald-800" role="status">Scanned {last}{continuous ? '. Scan the next item.' : ''}</p>}
        </div>
      )}
    </Modal>
  );
}
