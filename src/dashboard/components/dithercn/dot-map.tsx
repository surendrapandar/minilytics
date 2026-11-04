
import { useId, useMemo } from "react";
import type { ComponentProps, CSSProperties } from "react";

import { landCoverage } from "@/components/dithercn/world-land";
import type { LatLon } from "@/components/dithercn/world-land";
import { cssColor, thresholdAt } from "@/lib/dither";
import type { DitherColor } from "@/lib/dither";
import { cn } from "@/lib/utils";

export type { LatLon } from "@/components/dithercn/world-land";

/** A pulsing location on the map. */
export interface DotMapMarker {
  /** Where it is: `[lat, lon]` in degrees. */
  at: LatLon;
  /** Short text shown beside the marker and read by screen readers. */
  label?: string;
  /** Colour of the marker and its halo. Default: the map's `accent`. */
  color?: DitherColor;
}

/** A dotted arc between two places, drawn as a lifted curve. */
export interface DotMapArc {
  from: LatLon;
  to: LatLon;
  /** Default: the map's `accent`. */
  color?: DitherColor;
}

/** The part of the world to draw, in degrees. */
export interface DotMapBounds {
  north: number;
  south: number;
  west: number;
  east: number;
}

export type DotMapProps = Omit<ComponentProps<"div">, "children"> & {
  /** Locations to mark. */
  markers?: readonly DotMapMarker[];
  /** Connections between locations. */
  arcs?: readonly DotMapArc[];
  /** Colour of the land dots. Default `"grey"`. */
  color?: DitherColor;
  /** Colour of markers, halos and arcs unless they set their own. Default `"ink"`. */
  accent?: DitherColor;
  /** Dots across the full width. Default 160. */
  columns?: number;
  /** Dot shape. Default `"square"`. */
  shape?: "square" | "round";
  /** Radius in degrees of the dithered glow each marker casts on the land around it. 0 turns it off. Default 14. */
  halo?: number;
  /** Share of sea cells with a faint dot, 0 to 1. Default 0. */
  ocean?: number;
  /** The region to draw. Default the inhabited world: 78°N to 56°S, all longitudes. */
  bounds?: DotMapBounds;
  /** Pulse the markers and run light along the arcs. Static under reduced motion. Default true. */
  animate?: boolean;
  /** Accessible name. Marker labels are appended. Default `"World map"`. */
  title?: string;
};

const WORLD: DotMapBounds = { east: 180, north: 78, south: -56, west: -180 };
const NO_MARKERS: readonly DotMapMarker[] = [];
const NO_ARCS: readonly DotMapArc[] = [];

interface Grid {
  columns: number;
  rows: number;
  /** Degrees per cell. */
  step: number;
  bounds: DotMapBounds;
}

const makeGrid = (columns: number, bounds: DotMapBounds): Grid => {
  const step = (bounds.east - bounds.west) / columns;
  return {
    bounds,
    columns,
    rows: Math.max(1, Math.round((bounds.north - bounds.south) / step)),
    step,
  };
};

const project = (grid: Grid, [lat, lon]: LatLon): readonly [number, number] => [
  (lon - grid.bounds.west) / grid.step,
  (grid.bounds.north - lat) / grid.step,
];

/** One SVG path of horizontal runs, from a per-cell predicate. */
const runsPath = (grid: Grid, inked: (x: number, y: number) => boolean) => {
  let path = "";
  for (let y = 0; y < grid.rows; y += 1) {
    let start = -1;
    for (let x = 0; x <= grid.columns; x += 1) {
      const on = x < grid.columns && inked(x, y);
      if (on && start < 0) {
        start = x;
      } else if (!on && start >= 0) {
        path += `M${start} ${y}h${x - start}v1h${start - x}z`;
        start = -1;
      }
    }
  }
  return path;
};

const landCache = new Map<string, Uint8Array>();

/** Land cells of a grid, 1 for land. Cached per grid. */
const landCells = (grid: Grid) => {
  const { bounds, columns, rows, step } = grid;
  const key = `${columns}:${bounds.north}:${bounds.south}:${bounds.west}:${bounds.east}`;
  const cached = landCache.get(key);
  if (cached) {
    return cached;
  }
  const cells = new Uint8Array(columns * rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const lat = bounds.north - (y + 0.5) * step;
      const lon = bounds.west + (x + 0.5) * step;
      cells[y * columns + x] = landCoverage(lat, lon) >= 0.5 ? 1 : 0;
    }
  }
  landCache.set(key, cells);
  return cells;
};

interface Layers {
  land: string;
  ocean: string;
  halos: readonly { color: DitherColor; path: string }[];
}

interface LayerInput {
  grid: Grid;
  markers: readonly DotMapMarker[];
  accent: DitherColor;
  halo: number;
  ocean: number;
}

/** Index of the marker whose halo covers a cell most strongly, or -1. */
const haloOwner = (
  centres: readonly (readonly [number, number])[],
  radius: number,
  x: number,
  y: number
) => {
  let owner = -1;
  let best = 0;
  for (const [index, [cx, cy]] of centres.entries()) {
    const tone = 1 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
    if (tone > best) {
      best = tone;
      owner = index;
    }
  }
  // Dense at the marker, thinning out through the Bayer levels.
  return owner >= 0 && Math.sqrt(best) > thresholdAt("bayer4", x, y)
    ? owner
    : -1;
};

const buildLayers = ({
  grid,
  markers,
  accent,
  halo,
  ocean,
}: LayerInput): Layers => {
  const cells = landCells(grid);
  const centres = markers.map((marker) => project(grid, marker.at));
  const radius = halo / grid.step;
  const owners = new Int16Array(cells.length).fill(-1);
  if (radius > 0) {
    for (let y = 0; y < grid.rows; y += 1) {
      for (let x = 0; x < grid.columns; x += 1) {
        if (cells[y * grid.columns + x] === 1) {
          owners[y * grid.columns + x] = haloOwner(centres, radius, x, y);
        }
      }
    }
  }
  const at = (x: number, y: number) => y * grid.columns + x;
  const colors = [...new Set(markers.map((marker) => marker.color ?? accent))];
  return {
    halos: colors.map((color) => ({
      color,
      path: runsPath(grid, (x, y) => {
        const owner = owners[at(x, y)] ?? -1;
        return owner >= 0 && (markers[owner]?.color ?? accent) === color;
      }),
    })),
    land: runsPath(
      grid,
      (x, y) => cells[at(x, y)] === 1 && owners[at(x, y)] === -1
    ),
    ocean:
      ocean > 0
        ? runsPath(
            grid,
            (x, y) =>
              cells[at(x, y)] === 0 && ocean > thresholdAt("blue-noise", x, y)
          )
        : "",
  };
};

/** A lifted quadratic curve between two points, bowing towards the top. */
const arcPath = (grid: Grid, arc: DotMapArc) => {
  const [x1, y1] = project(grid, arc.from);
  const [x2, y2] = project(grid, arc.to);
  const lift = Math.hypot(x2 - x1, y2 - y1) * 0.32;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - lift;
  return `M${x1} ${y1}Q${mx} ${my} ${x2} ${y2}`;
};

// The pulse and arc keyframes (dcn-dot-map-*) live in styles.css: React 18 can't hoist a <style> tag.


const DotPattern = ({
  id,
  color,
  shape,
}: {
  id: string;
  color: DitherColor;
  shape: "square" | "round";
}) => (
  <pattern id={id} width={1} height={1} patternUnits="userSpaceOnUse">
    {shape === "round" ? (
      <circle cx={0.5} cy={0.5} r={0.32} fill={cssColor(color)} />
    ) : (
      <rect x={0.2} y={0.2} width={0.6} height={0.6} fill={cssColor(color)} />
    )}
  </pattern>
);

const Arcs = ({
  grid,
  arcs,
  accent,
  animate,
}: {
  grid: Grid;
  arcs: readonly DotMapArc[];
  accent: DitherColor;
  animate: boolean;
}) =>
  arcs.map((arc, index) => {
    const d = arcPath(grid, arc);
    const stroke = cssColor(arc.color ?? accent);
    return (
      <g key={index} fill="none" stroke={stroke} strokeLinecap="butt">
        <path
          d={d}
          strokeWidth={0.45}
          strokeDasharray="0.6 0.9"
          opacity={0.7}
        />
        {animate ? (
          <path
            d={d}
            pathLength={100}
            strokeWidth={0.6}
            strokeDasharray="14 86"
            className="dcn-dot-map-run"
            style={{ animationDelay: `${index * -0.7}s` }}
          />
        ) : null}
      </g>
    );
  });

const Markers = ({
  grid,
  markers,
  accent,
  animate,
}: {
  grid: Grid;
  markers: readonly DotMapMarker[];
  accent: DitherColor;
  animate: boolean;
}) =>
  markers.map((marker, index) => {
    const [x, y] = project(grid, marker.at);
    const fill = cssColor(marker.color ?? accent);
    return (
      <g key={index} fill={fill}>
        {animate ? (
          <rect
            x={x - 0.8}
            y={y - 0.8}
            width={1.6}
            height={1.6}
            fill="none"
            stroke={fill}
            strokeWidth={0.25}
            className="dcn-dot-map-pulse"
            style={{ animationDelay: `${(index * 0.53) % 2.8}s` }}
          />
        ) : null}
        <rect x={x - 0.8} y={y - 0.8} width={1.6} height={1.6} />
      </g>
    );
  });

const Labels = ({
  grid,
  markers,
}: {
  grid: Grid;
  markers: readonly DotMapMarker[];
}) =>
  markers.map((marker, index) => {
    if (!marker.label) {
      return null;
    }
    const [x, y] = project(grid, marker.at);
    const style: CSSProperties = {
      left: `${(x / grid.columns) * 100}%`,
      top: `${(y / grid.rows) * 100}%`,
    };
    return (
      <span
        key={index}
        className="bg-background/80 text-foreground absolute translate-x-2.5 -translate-y-1/2 rounded-sm px-1.5 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap backdrop-blur-sm sm:text-[11px]"
        style={style}
      >
        {marker.label}
      </span>
    );
  });

/**
 * A flat world map drawn in dithered dots, with pulsing location markers
 * that cast a dithered glow on the land around them, and dotted arcs
 * between places. For "customers worldwide" and "global network" sections.
 * The land mask ships with the component; nothing is fetched. Scales to
 * its container's width and keeps its aspect ratio.
 */
export const DotMap = ({
  markers = NO_MARKERS,
  arcs = NO_ARCS,
  color = "grey",
  accent = "ink",
  columns = 160,
  shape = "square",
  halo = 14,
  ocean = 0,
  bounds = WORLD,
  animate = true,
  title = "World map",
  className,
  ...props
}: DotMapProps) => {
  const id = useId();
  const grid = useMemo(
    () => makeGrid(Math.max(24, Math.round(columns)), bounds),
    [columns, bounds]
  );
  const layers = useMemo(
    () => buildLayers({ accent, grid, halo, markers, ocean }),
    [accent, grid, halo, markers, ocean]
  );
  const labels = markers.flatMap((marker) => marker.label ?? []);
  const name = labels.length > 0 ? `${title}: ${labels.join(", ")}` : title;

  return (
    <div
      role="img"
      aria-label={name}
      className={cn("relative w-full", className)}
      {...props}
    >
      <svg
        viewBox={`0 0 ${grid.columns} ${grid.rows}`}
        className="block h-auto w-full overflow-visible"
        aria-hidden
      >
        <defs>
          <DotPattern id={`${id}-land`} color={color} shape={shape} />
          {layers.halos.map((layer, index) => (
            <DotPattern
              key={index}
              id={`${id}-halo-${index}`}
              color={layer.color}
              shape={shape}
            />
          ))}
        </defs>
        {layers.ocean ? (
          <path d={layers.ocean} fill={`url(#${id}-land)`} opacity={0.25} />
        ) : null}
        <path d={layers.land} fill={`url(#${id}-land)`} opacity={0.6} />
        {layers.halos.map((layer, index) => (
          <path key={index} d={layer.path} fill={`url(#${id}-halo-${index})`} />
        ))}
        <Arcs grid={grid} arcs={arcs} accent={accent} animate={animate} />
        <Markers
          grid={grid}
          markers={markers}
          accent={accent}
          animate={animate}
        />
      </svg>
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <Labels grid={grid} markers={markers} />
      </div>
    </div>
  );
};
