import { describe, expect, it } from 'vitest';
import { monotoneCurvePath, type CurvePoint } from '../src/dashboard/lib/curvePath';

function cubicSegments(path: string) {
  return [...path.matchAll(/C(-?[0-9.]+),(-?[0-9.]+) (-?[0-9.]+),(-?[0-9.]+) (-?[0-9.]+),(-?[0-9.]+)/g)]
    .map((match) => match.slice(1).map(Number));
}

describe('website overview trend curves', () => {
  it('handles empty, single-bucket and two-bucket periods without inventing bends', () => {
    expect(monotoneCurvePath([])).toBe('');
    expect(monotoneCurvePath([{ x: 0, y: 20 }])).toBe('M0.00,20.00');
    expect(monotoneCurvePath([{ x: 0, y: 20 }, { x: 10, y: 40 }]))
      .toBe('M0.00,20.00 L10.00,40.00');
  });

  it('passes exactly through each bucket with cubic segments', () => {
    const points: CurvePoint[] = [
      { x: 0, y: 60 }, { x: 20, y: 10 }, { x: 40, y: 35 }, { x: 60, y: 5 },
    ];
    const path = monotoneCurvePath(points);
    const segments = cubicSegments(path);
    expect(path.startsWith('M0.00,60.00 C')).toBe(true);
    expect(segments).toHaveLength(points.length - 1);
    for (let i = 0; i < segments.length; i++) {
      expect(segments[i].slice(4)).toEqual([points[i + 1].x, points[i + 1].y]);
    }
  });

  it('never overshoots neighboring samples at peaks, valleys or flat zero intervals', () => {
    const points: CurvePoint[] = [
      { x: 0, y: 75 }, { x: 10, y: 75 }, { x: 20, y: 7 },
      { x: 30, y: 75 }, { x: 40, y: 75 }, { x: 50, y: 20 },
    ];
    const segments = cubicSegments(monotoneCurvePath(points));
    expect(segments).toHaveLength(points.length - 1);
    for (let i = 0; i < segments.length; i++) {
      const [ , control1Y, , control2Y ] = segments[i];
      const low = Math.min(points[i].y, points[i + 1].y);
      const high = Math.max(points[i].y, points[i + 1].y);
      expect(control1Y).toBeGreaterThanOrEqual(low);
      expect(control1Y).toBeLessThanOrEqual(high);
      expect(control2Y).toBeGreaterThanOrEqual(low);
      expect(control2Y).toBeLessThanOrEqual(high);
    }
  });

  it('keeps monotone control points bounded with uneven x spacing', () => {
    const points: CurvePoint[] = [
      { x: 0, y: 75 }, { x: 3, y: 74 }, { x: 30, y: 20 }, { x: 40, y: 5 },
    ];
    const segments = cubicSegments(monotoneCurvePath(points));
    expect(segments).toHaveLength(3);
    for (let i = 0; i < segments.length; i++) {
      const [ , y1, , y2 ] = segments[i];
      expect(y1).toBeGreaterThanOrEqual(points[i + 1].y);
      expect(y1).toBeLessThanOrEqual(points[i].y);
      expect(y2).toBeGreaterThanOrEqual(points[i + 1].y);
      expect(y2).toBeLessThanOrEqual(points[i].y);
    }
  });
});
