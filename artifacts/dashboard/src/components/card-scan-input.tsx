import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CreditCard, X, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface CardScanInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Input field with USB HID card reader support.
 *
 * USB card readers act as HID keyboards — they "type" the card number very fast
 * (all characters within ~100ms) and then send Enter. This component listens for
 * that pattern when in scanning mode and captures the card number automatically.
 *
 * The admin computer only needs the USB reader plugged in and the browser focused
 * on this field — no drivers, no special setup needed.
 */
export function CardScanInput({ value, onChange, placeholder, disabled }: CardScanInputProps) {
  const [scanning, setScanning] = useState(false);
  const [justScanned, setJustScanned] = useState(false);
  const [scanBuffer, setScanBuffer] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopScanning = useCallback(() => {
    setScanning(false);
    setScanBuffer("");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (cancelTimeoutRef.current) clearTimeout(cancelTimeoutRef.current);
  }, []);

  const handleScanComplete = useCallback((cardNo: string) => {
    const trimmed = cardNo.trim();
    if (trimmed) {
      onChange(trimmed);
      setJustScanned(true);
      setTimeout(() => setJustScanned(false), 2000);
    }
    stopScanning();
  }, [onChange, stopScanning]);

  useEffect(() => {
    if (!scanning) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stopScanning();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        handleScanComplete(scanBuffer);
        return;
      }

      if (e.key.length === 1) {
        e.preventDefault();
        setScanBuffer((prev) => prev + e.key);

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          setScanBuffer((prev) => {
            if (prev.trim()) handleScanComplete(prev);
            return "";
          });
        }, 150);
      }
    };

    document.addEventListener("keydown", onKeyDown);

    cancelTimeoutRef.current = setTimeout(() => {
      stopScanning();
    }, 15000);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (cancelTimeoutRef.current) clearTimeout(cancelTimeoutRef.current);
    };
  }, [scanning, scanBuffer, handleScanComplete, stopScanning]);

  if (scanning) {
    return (
      <div className="relative">
        <div
          className={cn(
            "flex items-center gap-3 rounded-md border-2 border-blue-500 bg-blue-50 dark:bg-blue-950/30 px-3 py-2.5",
            "animate-pulse"
          )}
        >
          <CreditCard className="w-5 h-5 text-blue-500 shrink-0" />
          <div className="flex-1 min-w-0">
            {scanBuffer ? (
              <span className="font-mono text-sm font-semibold tracking-widest text-blue-700 dark:text-blue-300">
                {scanBuffer}
              </span>
            ) : (
              <span className="text-sm text-blue-600 dark:text-blue-400">
                Поднесете картата към четеца…
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-blue-500 hover:text-blue-700"
            onClick={stopScanning}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Натиснете <kbd className="px-1 py-0.5 bg-muted rounded text-xs font-mono">Esc</kbd> за отказ
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "Номер на карта"}
          disabled={disabled}
          className={cn(
            justScanned && "border-green-500 bg-green-50 dark:bg-green-950/20"
          )}
        />
        {justScanned && (
          <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 gap-1.5 text-blue-600 border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
        onClick={() => {
          setScanBuffer("");
          setScanning(true);
        }}
        disabled={disabled}
        title="Активирай сканиране на карта"
      >
        <CreditCard className="w-4 h-4" />
        <span className="hidden sm:inline">Сканирай</span>
      </Button>
    </div>
  );
}
