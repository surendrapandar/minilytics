
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ComponentProps,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from "react";

import {
  cssColor,
  MOTION,
  readDitherCell,
  SERIES_COLORS,
  useFrameLoop,
} from "@/lib/dither";
import type { Bloom, DitherColor, FillVariant } from "@/lib/dither";
import { cn } from "@/lib/utils";

/**
 * The shared frame behind AreaChart, LineChart and BarChart: measuring,
 * scales, axes, the hover and keyboard readout, the legend and the
 * screen-reader table. The marks themselves come from each chart.
 */

/** The keys of `T` whose values are assignable to `V`. */
export type KeyOfType<T, V> = {
  [K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T];

/**
 * Where a chart reads a field: a key of the datum, or a function. Keys
 * work from Server Components; functions only from Client Components.
 */
export type Accessor<T, V> = KeyOfType<T, V> | ((datum: T) => V);

/** A category label, as text. */
export const readLabel = <T,>(
  datum: T,
  accessor: Accessor<T, string | number>
): string =>
  String(typeof accessor === "function" ? accessor(datum) : datum[accessor]);

/** A value, as a number. Anything that is not a finite number reads as 0. */
export const readValue = <T,>(datum: T, accessor: Accessor<T, number>) => {
  const raw =
    typeof accessor === "function" ? accessor(datum) : datum[accessor];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
};

/**
 * How values are written: `Intl.NumberFormat` options (usable from Server
 * Components) or a function.
 */
export type ValueFormat =
  | Intl.NumberFormatOptions
  | ((value: number) => string);

const COMPACT: Intl.NumberFormatOptions = {
  maximumFractionDigits: 1,
  notation: "compact",
};

/** A formatter for a `ValueFormat`. Default compact, as in 1.2K. */
export const toFormatter = (
  format: ValueFormat = COMPACT
): ((value: number) => string) => {
  if (typeof format === "function") {
    return format;
  }
  const formatter = new Intl.NumberFormat("en", format);
  return (value) => formatter.format(value);
};

/** One value read from every datum, drawn as one line, area or bar set. */
export interface ChartSeries<T> {
  /** Name in the legend, the readout and the data table. */
  label: string;
  /** The key holding this series' value, or a function that reads it. */
  value: Accessor<T, number>;
  /** Colour: a palette name (`"green"`) or any CSS colour. Default: the chart's `colors`, then ink, orange, green, pink, purple, blue, red, grey. */
  color?: DitherColor;
}

export type NonEmpty<T> = readonly [T, ...T[]];

/**
 * The colour series `index` draws in: its own `color`, then the chart's
 * `colors`, then the default palette (ink, orange, green, pink, ...).
 */
export const seriesColor = (
  color: DitherColor | undefined,
  index: number,
  colors: readonly DitherColor[] = []
): DitherColor =>
  color ??
  colors[index] ??
  SERIES_COLORS[index % SERIES_COLORS.length] ??
  "ink";

/** Snap a length to whole device pixels so dither cells stay sharp. */
const snapToDevice = (px: number, dpr: number) =>
  Math.max(1, Math.round(px * dpr)) / dpr;

export interface ChartSize {
  width: number;
  /** Dither cell in CSS px, snapped to whole device pixels. */
  cell: number;
}

/**
 * Width of the element and the dither cell to draw with. `null` until the
 * first measurement, so charts render nothing on the server.
 */
export const useChartSize = (
  ref: { current: HTMLElement | null },
  cell?: number
): ChartSize | null => {
  const [measured, setMeasured] = useState<{
    width: number;
    baseCell: number;
    dpr: number;
  } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      setMeasured({
        baseCell: readDitherCell(el),
        dpr: window.devicePixelRatio || 1,
        width: Math.floor(entry.contentRect.width),
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  if (measured === null) {
    return null;
  }
  return {
    cell: snapToDevice(cell ?? measured.baseCell, measured.dpr),
    width: measured.width,
  };
};

/** Round a dither level to whole cells of a 4×4 tile so it renders exactly. */
export const quantizeLevel = (level: number) =>
  Math.round(Math.min(1, Math.max(0, level)) * 16) / 16;

const NICE_STEPS = [1, 2, 2.5, 5, 10];

export interface Scale {
  min: number;
  max: number;
  ticks: readonly number[];
}

/**
 * A y domain with round ticks that covers every value. With `zero` it
 * always includes zero, as bars and areas need.
 */
export const niceScale = (
  values: readonly number[],
  { zero = true, count = 4 }: { zero?: boolean; count?: number } = {}
): Scale => {
  const finite = values.filter((value) => Number.isFinite(value));
  const floor = zero ? [0] : [];
  const low = finite.length > 0 ? Math.min(...floor, ...finite) : 0;
  const high = finite.length > 0 ? Math.max(...floor, ...finite) : 1;
  const span = high - low || Math.abs(high) || 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    (NICE_STEPS.find((candidate) => candidate * magnitude >= raw) ?? 10) *
    magnitude;
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) {
    ticks.push(Number(tick.toPrecision(12)));
  }
  return { max, min, ticks };
};

export interface Point {
  x: number;
  y: number;
}

/** Straight segments through the points. */
export const linearPath = (points: readonly Point[]) =>
  points
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x} ${y}`)
    .join("");

/**
 * A smooth curve through the points that never overshoots them
 * (monotone cubic, Fritsch–Carlson), so peaks stay at the data.
 */
export const monotonePath = (points: readonly Point[]) => {
  const count = points.length;
  if (count < 3) {
    return linearPath(points);
  }
  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    slopes.push(a && b ? (b.y - a.y) / (b.x - a.x || 1) : 0);
  }
  const tangents = points.map((_, index) => {
    const before = slopes[index - 1];
    const after = slopes[index];
    if (before === undefined) {
      return after ?? 0;
    }
    if (after === undefined) {
      return before;
    }
    return before * after <= 0 ? 0 : (before + after) / 2;
  });
  for (let index = 0; index < count - 1; index += 1) {
    const slope = slopes[index] ?? 0;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
    } else {
      const a = (tangents[index] ?? 0) / slope;
      const b = (tangents[index + 1] ?? 0) / slope;
      const length = a * a + b * b;
      if (length > 9) {
        const scale = 3 / Math.sqrt(length);
        tangents[index] = scale * a * slope;
        tangents[index + 1] = scale * b * slope;
      }
    }
  }
  let path = "";
  for (let index = 0; index < count; index += 1) {
    const point = points[index];
    const previous = points[index - 1];
    if (point === undefined) {
      break;
    }
    if (previous === undefined) {
      path += `M${point.x} ${point.y}`;
    } else {
      const third = (point.x - previous.x) / 3;
      const startTangent = tangents[index - 1] ?? 0;
      const endTangent = tangents[index] ?? 0;
      path += `C${previous.x + third} ${previous.y + startTangent * third} ${point.x - third} ${point.y - endTangent * third} ${point.x} ${point.y}`;
    }
  }
  return path;
};

/**
 * 0 → 1 over the entrance, stepping through dither levels, once the chart
 * is on screen. 1 at once under reduced motion or with `enabled: false`.
 */
export const useReveal = (
  target: { current: Element | null },
  enabled = true
) => {
  const [progress, setProgress] = useState(enabled ? 0 : 1);
  const duration = (MOTION.slow + MOTION.base) / 1000;
  useFrameLoop(
    (time) => {
      const linear = Math.min(1, time / duration);
      // Cubic ease-out, then whole steps so React re-renders at most 16 times.
      setProgress(Math.round((1 - (1 - linear) ** 3) * 16) / 16);
    },
    { enabled: enabled && progress < 1, stillTime: duration, target }
  );
  return progress;
};

export interface Plot {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** What every chart's marks are drawn from. Stable while the pointer scrubs. */
export interface ChartContext {
  /** Prefix for pattern, mask and clip ids. */
  uid: string;
  width: number;
  height: number;
  cell: number;
  plot: Plot;
  /** Centre of datum `index` on the x axis. */
  xAt: (index: number) => number;
  /** Width of one category: the step between points, or one bar band. */
  band: number;
  yAt: (value: number) => number;
  /** Entrance progress, 0 → 1. */
  reveal: number;
  /** Whether entrance motion is on (off under `animate={false}`). */
  animate: boolean;
  /** The spotlit series: hovered in the legend, else locked. */
  focus: number | null;
  /** Whether the pointer or keyboard is scrubbing. */
  scrubbing: boolean;
  /** The colour of series `index`. */
  colorOf: (index: number) => DitherColor;
  /** 1, or dimmed when another series is spotlit. */
  opacityOf: (index: number) => number;
}

/** Where a series sits at the scrubbed datum, for the marker and the readout. */
export interface ScrubPoint {
  seriesIndex: number;
  /** y in px. */
  y: number;
}

export interface ReadoutRow {
  label: string;
  color: DitherColor;
  value: string;
}

/** Props every cartesian chart shares. */
export interface ChartStyleProps {
  /** Texture of the fills: `gradient`, `dotted`, `hatched` or `solid`. */
  fill?: FillVariant;
  /** Soft glow in each series' colour behind its fill: `off`, `low` or `high`. Default `off`. */
  bloom?: Bloom;
  /** Colours by series position, as palette names or CSS colours. A series' own `color` wins. */
  colors?: readonly DitherColor[];
  /** Hover, keyboard scrubbing, readout and legend spotlight. `false` for decorative charts. Default true. */
  interactive?: boolean;
  /** Entrance motion. Default true; always off under reduced motion. */
  animate?: boolean;
}

export interface CartesianChartProps<T> extends Omit<
  ComponentProps<"div">,
  "children"
> {
  data: readonly T[];
  /** Category label for a datum, shown on the x axis and in the readout. */
  x: Accessor<T, string | number>;
  series: NonEmpty<ChartSeries<T>>;
  colors: readonly DitherColor[] | undefined;
  scale: Scale;
  /** `point`: data sit on the plot edges and between. `band`: each datum owns a slot. */
  layout: "point" | "band";
  height: number;
  axes: boolean;
  tooltip: boolean;
  legend: boolean;
  interactive: boolean;
  animate: boolean;
  cell?: number;
  formatValue: (value: number) => string;
  /** Axis tick labels. Default `formatValue`. */
  formatTick?: (value: number) => string;
  /** Readout rows for a datum. Default: every series' value. */
  readout?: (datum: T) => readonly ReadoutRow[];
  /** Heading of the readout and data table for a datum. Default: the x label. */
  readoutLabel?: (datum: T) => string;
  /** Legend key for one series. */
  swatch: (index: number, color: DitherColor) => ReactNode;
  /** `line`: a crosshair with a marker per series. `column`: a soft band behind the category. */
  scrub: "line" | "column";
  /** Where each series sits at a datum: markers and the readout anchor. */
  pointsAt: (index: number, context: ChartContext) => readonly ScrubPoint[];
  /** Extra marks for the scrubbed datum, such as solid bars. */
  activeMarks?: (index: number, context: ChartContext) => ReactNode;
  /** Short description of the chart, read before the data table. */
  summary: string;
  children: (context: ChartContext) => ReactNode;
}

const AXIS_FONT_WIDTH = 6.1;
const DIMMED = 0.18;

/** Where the plot sits inside the chart, and the scales that map into it. */
const layoutPlot = ({
  axes,
  count,
  formatTick,
  height,
  layout,
  scale,
  width,
}: {
  axes: boolean;
  count: number;
  formatTick: (value: number) => string;
  height: number;
  layout: "point" | "band";
  scale: Scale;
  width: number;
}) => {
  const tickLabels = scale.ticks.map((tick) => formatTick(tick));
  const longest = Math.max(1, ...tickLabels.map((label) => label.length));
  const plot: Plot = {
    bottom: height - (axes ? 22 : 1),
    left: axes ? Math.ceil(longest * AXIS_FONT_WIDTH) + 10 : 0,
    right: width - (axes && layout === "point" ? 6 : 0),
    top: axes ? 8 : 4,
  };
  const plotWidth = Math.max(1, plot.right - plot.left);
  const slots = layout === "band" ? count : count - 1;
  const band = plotWidth / Math.max(1, slots);
  const xAt = (index: number) => {
    if (layout === "band") {
      return plot.left + band * (index + 0.5);
    }
    return plot.left + (count === 1 ? plotWidth / 2 : band * index);
  };
  const span = scale.max - scale.min || 1;
  const yAt = (value: number) =>
    plot.bottom - ((value - scale.min) / span) * (plot.bottom - plot.top);
  return { band, plot, plotWidth, tickLabels, xAt, yAt };
};

/**
 * Every value, for screen readers.
 * Hidden through a wrapping div, not the table itself: a table ignores the
 * 1px size, and Safari clips only the table box, which leaves the caption
 * painted across the chart.
 */
const DataTable = ({
  summary,
  series,
  rows,
}: {
  summary: string;
  series: readonly { label: string }[];
  rows: readonly { label: string; values: readonly ReadoutRow[] }[];
}) => (
  <div className="sr-only">
    <table>
      <caption>{summary}</caption>
      <thead>
        <tr>
          <th scope="col">Category</th>
          {series.map((entry) => (
            <th key={entry.label} scope="col">
              {entry.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- categories can repeat; position is the identity.
          <tr key={index}>
            <th scope="row">{row.label}</th>
            {row.values.map((value) => (
              <td key={value.label}>{value.value}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/**
 * Every `every`th label, plus the last. The one before the last drops out
 * when it would sit too close to it.
 */
const xLabelIndices = (count: number, every: number) => {
  const step = Math.max(1, every);
  const shown = new Set<number>();
  for (let index = 0; index < count; index += step) {
    shown.add(index);
  }
  const last = count - 1;
  if (last > 0 && !shown.has(last)) {
    const previous = last - (last % step);
    if (previous > 0 && last - previous < step * 0.7) {
      shown.delete(previous);
    }
    shown.add(last);
  }
  return shown;
};

const labelAnchor = (
  layout: "point" | "band",
  index: number,
  count: number
) => {
  if (layout === "band" || count === 1) {
    return "middle";
  }
  if (index === 0) {
    return "start";
  }
  return index === count - 1 ? "end" : "middle";
};

/**
 * The scrubbed datum; whether moving to it glides (pointer) or jumps
 * (keyboard, first touch); and whether the scrub is showing. A hidden
 * scrub keeps its index so the crosshair fades out where it was.
 */
interface Scrub {
  index: number;
  glide: boolean;
  visible: boolean;
}

const hide = (current: Scrub | null): Scrub | null =>
  current === null ? null : { ...current, glide: false, visible: false };

// Gliding parts share one duration and the site's ease-out. Every glide is
// a transform, so it never triggers layout.
const GLIDE =
  "transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none data-[glide=false]:transition-[opacity]";

/** Gap between the readout and the marker it describes. */
const READOUT_GAP = 12;

/**
 * Moves the readout to sit centred above the highest marker, clamped
 * inside the chart. When there is no room above, it sits beside the
 * crosshair at the top of the plot instead, so it never covers a marker.
 * Writes the transform straight to the element so a scrub never
 * re-lays out React.
 */
const useReadoutPosition = (
  ref: { current: HTMLDivElement | null },
  anchor: { x: number; y: number; width: number; top: number } | null
) => {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || anchor === null) {
      return;
    }
    const { offsetWidth: w, offsetHeight: h } = el;
    const above = anchor.y - h - READOUT_GAP;
    let left = Math.min(
      Math.max(0, anchor.x - w / 2),
      Math.max(0, anchor.width - w)
    );
    let top = above;
    if (above < 0) {
      const right = anchor.x + READOUT_GAP;
      left = right + w <= anchor.width ? right : anchor.x - READOUT_GAP - w;
      ({ top } = anchor);
    }
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  });
};

const ARROW_STEPS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
};

/**
 * The scrub state and its handlers: pointer moves throttled to one update
 * per frame, keyboard steps that jump, and a hide that keeps the position.
 */
const useScrub = ({
  count,
  indexAt,
  onEscape,
}: {
  count: number;
  indexAt: (px: number) => number;
  onEscape: () => void;
}) => {
  const [scrub, setScrub] = useState<Scrub | null>(null);
  const pointerX = useRef<number | null>(null);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (count === 0) {
      return;
    }
    pointerX.current =
      event.clientX - event.currentTarget.getBoundingClientRect().left;
    if (frame.current !== 0) {
      return;
    }
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pointerX.current === null) {
        return;
      }
      const index = indexAt(pointerX.current);
      setScrub((current) =>
        current?.index === index && current.visible
          ? current
          : { glide: current?.visible === true, index, visible: true }
      );
    });
  };

  const onPointerLeave = () => {
    pointerX.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    setScrub(hide);
  };

  const jumpTo = (index: number) =>
    setScrub({
      glide: false,
      index: Math.min(count - 1, Math.max(0, index)),
      visible: true,
    });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      setScrub(hide);
      onEscape();
      return;
    }
    if (count === 0) {
      return;
    }
    const current = scrub?.index ?? count - 1;
    const page = Math.max(1, Math.round(count / 10));
    const targets: Readonly<Record<string, number>> = {
      End: count - 1,
      Home: 0,
      PageDown: current + page,
      PageUp: current - page,
    };
    const step = ARROW_STEPS[event.key];
    const target = step === undefined ? targets[event.key] : current + step;
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    // The page may bind the arrows too (docs prev/next); the chart owns them while focused.
    event.stopPropagation();
    // Keyboard steps jump: easing would lag behind held arrow keys.
    jumpTo(target);
  };

  const onFocus = () =>
    setScrub((current) =>
      current?.visible === true
        ? current
        : { glide: false, index: current?.index ?? count - 1, visible: true }
    );

  return {
    handlers: {
      onBlur: () => setScrub(hide),
      onFocus,
      onKeyDown,
      onPointerLeave,
      onPointerMove,
    },
    scrub,
  };
};

/** Gridlines and value labels, then the category labels that fit. */
const Axes = <T,>({
  data,
  x,
  scale,
  tickLabels,
  plot,
  plotWidth,
  height,
  layout,
  xAt,
  yAt,
}: {
  data: readonly T[];
  x: Accessor<T, string | number>;
  scale: Scale;
  tickLabels: readonly string[];
  plot: Plot;
  plotWidth: number;
  height: number;
  layout: "point" | "band";
  xAt: (index: number) => number;
  yAt: (value: number) => number;
}) => {
  const count = data.length;
  // Space x labels so they never collide: about one per 72px.
  const shown = xLabelIndices(
    count,
    Math.ceil(count / Math.max(1, Math.floor(plotWidth / 72)))
  );
  return (
    <g>
      {scale.ticks.map((tick, index) => (
        <g key={tick}>
          <line
            x1={plot.left}
            x2={plot.right}
            y1={Math.round(yAt(tick)) + 0.5}
            y2={Math.round(yAt(tick)) + 0.5}
            className="stroke-border"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
          <text
            x={plot.left - 10}
            y={yAt(tick)}
            dy="0.32em"
            textAnchor="end"
            className="fill-muted-foreground font-mono text-[10px] tabular-nums"
          >
            {tickLabels[index]}
          </text>
        </g>
      ))}
      {data.map((datum, index) =>
        shown.has(index) ? (
          <text
            // oxlint-disable-next-line react/no-array-index-key -- categories can repeat; position is the identity.
            key={index}
            x={xAt(index)}
            y={height - 6}
            textAnchor={labelAnchor(layout, index, count)}
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {readLabel(datum, x)}
          </text>
        ) : null
      )}
    </g>
  );
};

/** A dashed crosshair and one marker per series, gliding by transform. */
const Crosshair = ({
  plot,
  x,
  anchorY,
  points,
  visible,
  glide,
  context,
  labels,
}: {
  plot: Plot;
  x: number;
  anchorY: number;
  points: readonly ScrubPoint[];
  visible: boolean;
  glide: string;
  context: ChartContext;
  labels: readonly string[];
}) => (
  <g aria-hidden="true">
    <line
      data-glide={glide}
      x1={0.5}
      x2={0.5}
      y1={plot.top}
      y2={plot.bottom}
      className={cn("stroke-foreground/35", GLIDE)}
      strokeWidth={1}
      strokeDasharray="2 3"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(${Math.round(x)}px)`,
      }}
    />
    {labels.map((label, index) => {
      const point = points.find((candidate) => candidate.seriesIndex === index);
      return (
        <circle
          key={label}
          data-glide={glide}
          r={4}
          fill={cssColor(context.colorOf(index))}
          stroke="var(--dither-paper)"
          strokeWidth={2}
          className={GLIDE}
          style={{
            opacity:
              point === undefined || !visible ? 0 : context.opacityOf(index),
            transform: `translate(${x}px, ${point?.y ?? anchorY}px)`,
          }}
        />
      );
    })}
  </g>
);

/** The readout card: the category, then one row per series. */
const Readout = ({
  readoutRef,
  row,
  visible,
  glide,
  focus,
}: {
  // A plain prop: React 18 doesn't pass `ref` through to function components.
  readoutRef: { current: HTMLDivElement | null };
  row: { label: string; values: readonly ReadoutRow[] } | undefined;
  visible: boolean;
  glide: string;
  focus: number | null;
}) => (
  <div
    ref={readoutRef}
    aria-hidden="true"
    data-glide={glide}
    className={cn(
      "bg-popover/95 text-popover-foreground border-border pointer-events-none absolute top-0 left-0 z-10 min-w-32 rounded-lg border px-2.5 py-2 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.6)] backdrop-blur-sm",
      GLIDE
    )}
    style={{ opacity: visible ? 1 : 0 }}
  >
    {row === undefined ? null : (
      <>
        <div className="text-muted-foreground mb-1.5 font-mono text-[10px] tracking-wide uppercase">
          {row.label}
        </div>
        <div className="flex flex-col gap-1">
          {row.values.map((value, index) => (
            <div
              key={value.label}
              className={cn(
                "flex items-center gap-2 text-xs transition-opacity duration-150",
                focus !== null && focus !== index && "opacity-40"
              )}
            >
              <span
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: cssColor(value.color) }}
              />
              <span className="text-muted-foreground pr-3">{value.label}</span>
              <span className="ml-auto font-mono font-medium tabular-nums">
                {value.value}
              </span>
            </div>
          ))}
        </div>
      </>
    )}
  </div>
);

/**
 * Legend entries. Interactive ones are toggle buttons: hover or focus
 * spotlights a series, click locks it, Escape lets go.
 */
const Legend = ({
  labels,
  interactive,
  focus,
  locked,
  swatch,
  colorOf,
  onHover,
  onLock,
}: {
  labels: readonly string[];
  interactive: boolean;
  focus: number | null;
  locked: number | null;
  swatch: (index: number, color: DitherColor) => ReactNode;
  colorOf: (index: number) => DitherColor;
  onHover: (index: number | null) => void;
  onLock: (index: number | null) => void;
}) => (
  <div
    className="mt-3 flex flex-wrap gap-1"
    {...(interactive
      ? { "aria-label": "Series", role: "group" }
      : { "aria-hidden": true })}
  >
    {labels.map((label, index) => {
      const content = (
        <>
          {swatch(index, colorOf(index))}
          {label}
        </>
      );
      const itemClass = cn(
        "text-muted-foreground inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-[11px] transition-[color,opacity,background-color] duration-150 ease-out",
        focus !== null && focus !== index && "opacity-45"
      );
      if (!interactive) {
        return (
          <span key={label} className={itemClass}>
            {content}
          </span>
        );
      }
      return (
        <button
          key={label}
          type="button"
          aria-pressed={locked === index}
          aria-label={`Spotlight ${label}`}
          onPointerEnter={() => onHover(index)}
          onPointerLeave={() => onHover(null)}
          onFocus={() => onHover(index)}
          onBlur={() => onHover(null)}
          onClick={() => onLock(locked === index ? null : index)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onLock(null);
            }
          }}
          className={cn(
            itemClass,
            "hover:text-foreground focus-visible:ring-ring/60 aria-pressed:bg-muted aria-pressed:text-foreground cursor-pointer outline-none focus-visible:ring-2"
          )}
        >
          {content}
        </button>
      );
    })}
  </div>
);

/** The visually hidden key help and the live readout for screen readers. */
const ScreenReaderStatus = ({
  id,
  row,
}: {
  id: string;
  row: { label: string; values: readonly ReadoutRow[] } | undefined;
}) => (
  <>
    <p id={id} className="sr-only">
      Use the arrow keys to move through the data, Home and End to jump to the
      ends, Escape to clear.
    </p>
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {row === undefined
        ? ""
        : `${row.label}: ${row.values.map((value) => `${value.label} ${value.value}`).join(", ")}`}
    </div>
  </>
);

interface ScrubView {
  scrubbing: boolean;
  activeRow: { label: string; values: readonly ReadoutRow[] } | undefined;
  activeX: number;
  points: readonly ScrubPoint[];
  /** The highest marker's y, or the plot bottom. */
  anchorY: number;
  glide: string;
  extraMarks: ReactNode;
}

/** What the scrub shows right now, derived from its state. */
const scrubView = ({
  scrub,
  tableRows,
  xAt,
  plot,
  context,
  pointsAt,
  activeMarks,
}: {
  scrub: Scrub | null;
  tableRows: readonly { label: string; values: readonly ReadoutRow[] }[];
  xAt: (index: number) => number;
  plot: Plot;
  context: ChartContext | null;
  pointsAt: (index: number, context: ChartContext) => readonly ScrubPoint[];
  activeMarks:
    | ((index: number, context: ChartContext) => ReactNode)
    | undefined;
}): ScrubView => {
  const scrubbing = scrub?.visible === true;
  const glide = String(scrub?.glide ?? false);
  if (scrub === null || context === null) {
    return {
      activeRow: undefined,
      activeX: 0,
      anchorY: plot.bottom,
      extraMarks: null,
      glide,
      points: [],
      scrubbing,
    };
  }
  const points = pointsAt(scrub.index, context);
  return {
    activeRow: tableRows[scrub.index],
    activeX: xAt(scrub.index),
    anchorY: Math.min(plot.bottom, ...points.map((point) => point.y)),
    extraMarks: scrubbing ? activeMarks?.(scrub.index, context) : null,
    glide,
    points,
    scrubbing,
  };
};

/** Root props: a focusable, labelled group when interactive, else an image. */
const rootProps = ({
  interactive,
  handlers,
  uid,
  label,
  count,
}: {
  interactive: boolean;
  handlers: ReturnType<typeof useScrub>["handlers"];
  uid: string;
  label: string;
  count: number;
}) =>
  interactive
    ? {
        ...handlers,
        "aria-describedby": `${uid}-keys`,
        "aria-label": label,
        "aria-roledescription": "chart",
        role: "group",
        tabIndex: count > 0 ? 0 : -1,
      }
    : { "aria-label": label, role: "img" };

/** The drawing: axes (children), the column band, marks, then the crosshair. */
const ChartSvg = ({
  context,
  view,
  marks,
  scrubKind,
  labels,
  children,
}: {
  context: ChartContext;
  view: ScrubView;
  marks: ReactNode;
  scrubKind: "line" | "column" | "none";
  labels: readonly string[];
  children: ReactNode;
}) => {
  const { width, height, plot, band } = context;
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block overflow-visible select-none"
    >
      {children}
      {scrubKind === "column" ? (
        <rect
          data-glide={view.glide}
          x={-band / 2}
          y={plot.top}
          width={band}
          height={plot.bottom - plot.top}
          className={cn("fill-foreground/[0.06]", GLIDE)}
          style={{
            opacity: view.scrubbing ? 1 : 0,
            transform: `translateX(${view.activeX}px)`,
          }}
        />
      ) : null}
      {marks}
      {view.extraMarks}
      {scrubKind === "line" ? (
        <Crosshair
          plot={plot}
          x={view.activeX}
          anchorY={view.anchorY}
          points={view.points}
          visible={view.scrubbing}
          glide={view.glide}
          context={context}
          labels={labels}
        />
      ) : null}
    </svg>
  );
};

/**
 * Measures itself, lays out the plot and owns the interaction: a gliding
 * crosshair and readout, keyboard scrubbing, and a legend that spotlights
 * a series on hover and locks it on click. Charts pass their marks as a
 * render function of the layout; it is memoised, so scrubbing only
 * redraws the crosshair, markers and readout.
 */
export const CartesianChart = <T,>({
  data,
  x,
  series,
  colors,
  scale,
  layout,
  height,
  axes,
  tooltip,
  legend,
  interactive,
  animate,
  cell,
  formatValue,
  formatTick = formatValue,
  readout,
  readoutLabel,
  swatch,
  scrub: scrubKind,
  pointsAt,
  activeMarks,
  summary,
  children,
  className,
  "aria-label": ariaLabel,
  ...props
}: CartesianChartProps<T>) => {
  const uid = useId().replaceAll(":", "");
  const ref = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const size = useChartSize(ref, cell);
  const reveal = useReveal(ref, animate);
  const [hoveredSeries, setHoveredSeries] = useState<number | null>(null);
  const [lockedSeries, setLockedSeries] = useState<number | null>(null);

  const count = data.length;
  const width = size?.width ?? 0;
  const { plot, plotWidth, band, xAt, yAt, tickLabels } = useMemo(
    () => layoutPlot({ axes, count, formatTick, height, layout, scale, width }),
    [axes, count, formatTick, height, layout, scale, width]
  );
  const indexAt = (px: number) => {
    const offset = (px - plot.left) / band;
    const raw = layout === "band" ? Math.floor(offset) : Math.round(offset);
    return Math.min(count - 1, Math.max(0, raw));
  };
  const { scrub, handlers } = useScrub({
    count,
    indexAt,
    onEscape: () => setLockedSeries(null),
  });

  const focus = interactive ? (hoveredSeries ?? lockedSeries) : null;
  const scrubbing = scrub?.visible === true;
  const colorOf = useCallback(
    (index: number) => seriesColor(series[index]?.color, index, colors),
    [series, colors]
  );
  const context = useMemo<ChartContext | null>(
    () =>
      size === null
        ? null
        : {
            animate,
            band,
            cell: size.cell,
            colorOf,
            focus,
            height,
            opacityOf: (index) =>
              focus === null || focus === index ? 1 : DIMMED,
            plot,
            reveal,
            scrubbing,
            uid,
            width,
            xAt,
            yAt,
          },
    [
      animate,
      band,
      size,
      colorOf,
      focus,
      height,
      plot,
      reveal,
      scrubbing,
      uid,
      width,
      xAt,
      yAt,
    ]
  );
  const marks = useMemo(
    () => (context === null ? null : children(context)),
    [children, context]
  );

  const rowsFor = useCallback(
    (datum: T): readonly ReadoutRow[] =>
      readout?.(datum) ??
      series.map((entry, index) => ({
        color: colorOf(index),
        label: entry.label,
        value: formatValue(readValue(datum, entry.value)),
      })),
    [readout, series, colorOf, formatValue]
  );
  const tableRows = useMemo(
    () =>
      data.map((datum) => ({
        label: readoutLabel?.(datum) ?? readLabel(datum, x),
        values: rowsFor(datum),
      })),
    [data, x, readoutLabel, rowsFor]
  );
  const labels = series.map((entry) => entry.label);

  const view = scrubView({
    activeMarks,
    context,
    plot,
    pointsAt,
    scrub,
    tableRows,
    xAt,
  });
  const showReadout = interactive && tooltip && view.scrubbing;

  useReadoutPosition(
    readoutRef,
    showReadout
      ? { top: plot.top, width, x: view.activeX, y: view.anchorY }
      : null
  );

  return (
    <div {...props} className={cn("relative w-full", className)}>
      <div
        ref={ref}
        {...rootProps({
          count,
          handlers,
          interactive,
          label: ariaLabel ?? summary,
          uid,
        })}
        className="focus-visible:ring-ring/60 relative w-full touch-pan-y rounded-sm outline-none focus-visible:ring-2"
        style={{ height }}
      >
        {context === null ? null : (
          <ChartSvg
            context={context}
            view={view}
            marks={marks}
            scrubKind={interactive ? scrubKind : "none"}
            labels={labels}
          >
            {axes ? (
              <Axes
                data={data}
                x={x}
                scale={scale}
                tickLabels={tickLabels}
                plot={plot}
                plotWidth={plotWidth}
                height={height}
                layout={layout}
                xAt={xAt}
                yAt={yAt}
              />
            ) : null}
          </ChartSvg>
        )}
        {interactive && tooltip ? (
          <Readout
            readoutRef={readoutRef}
            row={view.activeRow}
            visible={showReadout}
            glide={view.glide}
            focus={focus}
          />
        ) : null}
      </div>
      {legend ? (
        <Legend
          labels={labels}
          interactive={interactive}
          focus={focus}
          locked={lockedSeries}
          swatch={swatch}
          colorOf={colorOf}
          onHover={setHoveredSeries}
          onLock={setLockedSeries}
        />
      ) : null}
      {interactive ? (
        <ScreenReaderStatus
          id={`${uid}-keys`}
          row={view.scrubbing ? view.activeRow : undefined}
        />
      ) : null}
      <DataTable summary={summary} series={series} rows={tableRows} />
    </div>
  );
};

/** "Revenue and Costs" / "Revenue, Costs and Refunds". */
export const listLabels = (labels: readonly string[]) =>
  labels.length < 2
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1) ?? ""}`;

/** "Area chart of Revenue and Costs, Jan to Dec." */
export const chartSummary = <T,>({
  kind,
  series,
  data,
  x,
}: {
  kind: string;
  series: readonly { label: string }[];
  data: readonly T[];
  x: Accessor<T, string | number>;
}) => {
  const [first] = data;
  const last = data.at(-1);
  const range =
    first === undefined || last === undefined
      ? ""
      : `, ${readLabel(first, x)} to ${readLabel(last, x)}`;
  return `${kind} of ${listLabels(series.map((entry) => entry.label))}${range}.`;
};
