'use client';
import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

type Props = {
  value: string;
  format?: 'CODE128' | 'CODE39' | 'EAN13';
  height?: number;
  width?: number;
  displayValue?: boolean;
  background?: string;
  lineColor?: string;
  margin?: number;
};

export function Barcode({
  value,
  format = 'CODE128',
  height = 56,
  width = 1.6,
  displayValue = false,
  background = '#ffffff',
  lineColor = '#0a0a0a',
  margin = 6,
}: Props) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format,
        height,
        width,
        displayValue,
        background,
        lineColor,
        margin,
      });
    } catch {
      /* valor inválido para el formato — ignorar para no romper UI */
    }
  }, [value, format, height, width, displayValue, background, lineColor, margin]);

  return <svg ref={ref} />;
}
