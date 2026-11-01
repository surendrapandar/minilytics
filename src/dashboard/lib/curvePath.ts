/** A sampled chart point, with x coordinates in strictly increasing order. */
export interface CurvePoint {
  x: number;
  y: number;
}

const coord = (value: number) => value.toFixed(2);

/**
 * Shape-preserving cubic interpolation (PCHIP-style interior tangents).
 *
 * Unlike a generic spline, this never draws artificial peaks, negative dips,
 * or overshoot between sampled values. Each data bucket remains an exact knot.
 */
export function monotoneCurvePath(points: readonly CurvePoint[]): string {
  if (!points.length) return '';

  const first = points[0];
  let path = `M${coord(first.x)},${coord(first.y)}`;
  if (points.length === 1) return path;
  if (points.length === 2) {
    return `${path} L${coord(points[1].x)},${coord(points[1].y)}`;
  }

  const widths: number[] = [];
  const secants: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    widths.push(dx);
    secants.push((points[i + 1].y - points[i].y) / dx);
  }

  const tangents = points.map((_, index) => {
    if (index === 0) return secants[0];
    if (index === points.length - 1) return secants[secants.length - 1];

    const left = secants[index - 1];
    const right = secants[index];
    // A flat interval or a turning point must have a horizontal tangent.
    if (left === 0 || right === 0 || Math.sign(left) !== Math.sign(right)) return 0;

    // Weighted harmonic mean preserves monotonicity even for uneven x spacing.
    const previousWidth = widths[index - 1];
    const nextWidth = widths[index];
    const w1 = 2 * nextWidth + previousWidth;
    const w2 = nextWidth + 2 * previousWidth;
    return (w1 + w2) / (w1 / left + w2 / right);
  });

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const third = widths[i] / 3;
    path += ` C${coord(a.x + third)},${coord(a.y + tangents[i] * third)}` +
      ` ${coord(b.x - third)},${coord(b.y - tangents[i + 1] * third)}` +
      ` ${coord(b.x)},${coord(b.y)}`;
  }

  return path;
}
