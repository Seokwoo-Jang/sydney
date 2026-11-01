'use client';
// A QR code of a link (qrcode.react, same as the workshop app): Ink modules on
// white with the standard 4-module quiet zone, as SVG so it stays crisp.
import { QRCodeSVG } from 'qrcode.react';

export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  return <QRCodeSVG value={value} level="M" marginSize={4} bgColor="#FFFFFF" fgColor="#172F3B" title={label} role="img" aria-label={label} className={className} />;
}
