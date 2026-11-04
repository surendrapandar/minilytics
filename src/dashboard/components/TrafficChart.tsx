import { Fragment, useCallback, useMemo } from 'react';
import { CartesianChart, monotonePath, niceScale, quantizeLevel, type ChartContext, type ChartSeries, type NonEmpty, type Point } from '@/components/dithercn/cartesian-chart';
import { cssColor, DitherPattern, FillPattern } from '@/lib/dither';
import { fmtNumber } from '../lib/format';

/** One time bucket. Sparklines only have visitors and revenue. */
interface Datum {
  visitors: number;
  revenue: number;
  pageviews?: number;
  payments?: number;
}

const VISITORS = 'blue';
const REVENUE = 'orange';

const seriesFor = <T extends Datum>(): NonEmpty<ChartSeries<T>> => [
  { label: 'Visitors', value: (d) => d.visitors, color: VISITORS },
  { label: 'Revenue', value: (d) => d.revenue, color: REVENUE },
];

// How far below the visitors line each dither band reaches (share of the plot) and how dense it is,
// from dithercn's area chart: densest just under the line, thinning toward the axis.
const DENSITY_BANDS = [
  { depth: Number.POSITIVE_INFINITY, share: 0.2 },
  { depth: 0.6, share: 0.35 },
  { depth: 0.4, share: 0.5 },
  { depth: 0.25, share: 0.65 },
  { depth: 0.13, share: 0.8 },
  { depth: 0.05, share: 1 },
] as const;
const AREA_LEVEL = 0.625;

const MAX_BAR = 36;
/** Revenue bars fade from dense at the top over this share of the plot, down to the floor. */
const BAR_FADE = 0.7;
const BAR_FLOOR = 0.125;
const BAR_CAP = 2;
/** Headroom keeps revenue bars in the lower part of the chart, under the visitors line. */
const REVENUE_HEADROOM = 1.6;

export interface TrafficChartProps<T extends Datum> {
  data: readonly T[];
  /** Axis label for a bucket. */
  label: (d: T) => string;
  /** Readout heading for a bucket. */
  longLabel?: (d: T) => string;
  money: (minor: number, compact?: boolean) => string;
  showVisitors?: boolean;
  showRevenue?: boolean;
  /** Sparkline mode: no axes, no readout. */
  compact?: boolean;
  height?: number;
  className?: string;
}

/** Visitors as a dithered area, revenue as dithered bars on their own scale. */
export function TrafficChart<T extends Datum>({ data, label, longLabel, money, showVisitors = true, showRevenue = true, compact = false, height = compact ? 80 : 300, className }: TrafficChartProps<T>) {
  const series = useMemo(() => seriesFor<T>(), []);
  const scale = useMemo(() => niceScale(data.map((d) => d.visitors)), [data]);
  const revenueMax = useMemo(() => Math.max(1, ...data.map((d) => d.revenue)) * REVENUE_HEADROOM, [data]);

  const revenueY = useCallback(
    ({ plot }: Pick<ChartContext, 'plot'>, value: number) => plot.bottom - (Math.max(0, value) / revenueMax) * (plot.bottom - plot.top),
    [revenueMax],
  );

  const marks = useCallback(
    (ctx: ChartContext) => {
      const { uid, cell: px, plot, xAt, yAt, band, reveal } = ctx;
      const plotHeight = plot.bottom - plot.top;

      // Visitors: the line, carried flat to both edges so the area fills the plot.
      const points: Point[] = data.map((d, i) => ({ x: xAt(i), y: yAt(d.visitors) }));
      const first = points[0];
      const last = points[points.length - 1];
      const line = first && last ? monotonePath([{ x: plot.left, y: first.y }, ...points, { x: plot.right, y: last.y }]) : '';
      const baseline = yAt(Math.max(scale.min, 0));
      const area = line ? `${line}L${plot.right} ${baseline}L${plot.left} ${baseline}Z` : '';

      const width = Math.max(2, Math.floor(Math.min(MAX_BAR, band * 0.6)));
      const bars = data.flatMap((d, i) => {
        if (d.revenue <= 0) return [];
        const y = Math.round(revenueY(ctx, d.revenue));
        const h = Math.round(plot.bottom) - y;
        return h > 0 ? [{ i, x: Math.round(xAt(i) - width / 2), y, h }] : [];
      });
      const blue = cssColor(VISITORS);
      const orange = cssColor(REVENUE);

      return (
        <>
          <defs>
            {DENSITY_BANDS.map((b, bi) => (
              <DitherPattern key={b.depth} id={`${uid}-vp${bi}`} level={quantizeLevel(AREA_LEVEL * b.share * reveal)} cell={px} color={VISITORS} />
            ))}
            {DENSITY_BANDS.map((b, bi) =>
              Number.isFinite(b.depth) ? (
                <mask key={b.depth} id={`${uid}-vm${bi}`}>
                  <rect x={plot.left} y={plot.top - 4} width={plot.right - plot.left} height={plotHeight + 8} fill="white" />
                  <path d={area} transform={`translate(0 ${Math.max(px * 2, b.depth * plotHeight)})`} fill="black" shapeRendering="crispEdges" />
                </mask>
              ) : null,
            )}
            <FillPattern
              id={`${uid}-rev`}
              fill="gradient"
              color={REVENUE}
              cell={px}
              level={0.75 * reveal}
              floor={BAR_FLOOR}
              ramp={{ at: 0, edge: 'top', extent: plotHeight + px * 8, length: plotHeight * BAR_FADE }}
            />
            {/* Each bar's ramp starts at its own top. */}
            {bars.map((b) => (
              <pattern key={b.i} id={`${uid}-rev${b.i}`} href={`#${uid}-rev`} y={b.y} />
            ))}
          </defs>

          {showVisitors &&
            DENSITY_BANDS.map((b, bi) => (
              <path
                key={b.depth}
                d={area}
                fill={`url(#${uid}-vp${bi})`}
                mask={Number.isFinite(b.depth) ? `url(#${uid}-vm${bi})` : undefined}
                shapeRendering="crispEdges"
              />
            ))}

          {showRevenue &&
            bars.map((b) => (
              <Fragment key={b.i}>
                {/* Paper behind the bar so the two textures never mix. */}
                <rect x={b.x} y={b.y} width={width} height={b.h} fill="var(--dither-paper)" />
                <rect x={b.x} y={b.y} width={width} height={b.h} fill={`url(#${uid}-rev${b.i})`} shapeRendering="crispEdges" />
                <rect x={b.x} y={b.y} width={width} height={Math.min(BAR_CAP, b.h)} fill={orange} shapeRendering="crispEdges" />
              </Fragment>
            ))}

          {showVisitors && line && (
            <path d={line} fill="none" stroke={blue} strokeWidth={compact ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" opacity={reveal < 1 ? 0.4 + reveal * 0.6 : 1} />
          )}
        </>
      );
    },
    [data, scale, revenueY, showVisitors, showRevenue, compact],
  );

  const readout = useCallback(
    (d: T) => [
      { label: 'Visitors', color: VISITORS, value: fmtNumber(d.visitors) },
      ...(d.pageviews !== undefined ? [{ label: 'Pageviews', color: 'grey', value: fmtNumber(d.pageviews) }] : []),
      { label: 'Revenue', color: REVENUE, value: money(d.revenue) },
      ...(d.payments ? [{ label: 'Payments', color: REVENUE, value: String(d.payments) }] : []),
    ],
    [money],
  );

  const pointsAt = useCallback(
    (index: number, ctx: ChartContext) => {
      const d = data[index];
      if (!d) return [];
      return [
        ...(showVisitors ? [{ seriesIndex: 0, y: ctx.yAt(d.visitors) }] : []),
        ...(showRevenue && d.revenue > 0 ? [{ seriesIndex: 1, y: revenueY(ctx, d.revenue) }] : []),
      ];
    },
    [data, showVisitors, showRevenue, revenueY],
  );

  if (!data.length) return null;

  return (
    <CartesianChart
      className={className}
      data={data}
      x={label}
      series={series}
      colors={undefined}
      scale={scale}
      layout="band"
      height={height}
      axes={!compact}
      tooltip={!compact}
      legend={false}
      interactive={!compact}
      animate
      formatValue={fmtNumber}
      readout={readout}
      readoutLabel={longLabel}
      swatch={() => null}
      scrub="line"
      pointsAt={pointsAt}
      summary={`Visitors and revenue, ${data.length} periods.`}
    >
      {marks}
    </CartesianChart>
  );
}
