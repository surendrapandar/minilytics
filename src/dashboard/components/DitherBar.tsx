import type { CSSProperties } from 'react';
import { fillStyle } from '@/lib/dither';

// A soft tint, dithered toward the bar's end only, so labels on top stay readable.
const barEnd = (color: 'blue' | 'orange') => fillStyle('gradient', { color, edge: 'right', length: 14, from: 0.5, to: 0 });
const ENDS: Record<'blue' | 'orange', CSSProperties> = { blue: barEnd('blue'), orange: barEnd('orange') };
const TINTS = { blue: 'bg-visitorsSoft', orange: 'bg-revenueSoft' } as const;

/** One horizontal bar of a breakdown list: blue for visitors, orange for revenue. */
export function DitherBar({ width, minWidth, color }: { width: string; minWidth?: number; color: 'blue' | 'orange' }) {
  return (
    <div className={`relative overflow-hidden ${TINTS[color]}`} style={{ width, minWidth }}>
      <div className="absolute inset-0" style={ENDS[color]} />
    </div>
  );
}
