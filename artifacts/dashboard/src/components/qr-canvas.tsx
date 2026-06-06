import { useEffect, useRef } from "react";
import QRCode from "qrcode";

interface QrCanvasProps {
  value: string;
  size?: number;
  className?: string;
}

/** Renders a QR code for the given value onto a canvas (client-side, no network). */
export function QrCanvas({ value, size = 160, className }: QrCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    QRCode.toCanvas(ref.current, value, { width: size, margin: 1 }, () => {
      /* errors are non-fatal — canvas simply stays blank */
    });
  }, [value, size]);

  return <canvas ref={ref} width={size} height={size} className={className} />;
}
