
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ComponentProps,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

import { landCoverage } from "@/components/dithercn/world-land";
import type { LatLon } from "@/components/dithercn/world-land";
import {
  thresholdAt,
  useDitherColors,
  useFrameLoop,
  usePrefersReducedMotion,
} from "@/lib/dither";
import type { DitherColor, DitherMatrix, Rgba } from "@/lib/dither";
import { cn } from "@/lib/utils";

export type { LatLon } from "@/components/dithercn/world-land";

/** A pulsing location on the globe. */
export interface GlobeMarker {
  /** `[lat, lon]` in degrees. */
  at: LatLon;
  /** Default: the globe's `accent`. */
  color?: DitherColor;
}

/** A dotted arc that lifts off the surface between two places. */
export interface GlobeArc {
  from: LatLon;
  to: LatLon;
  /** Default: the globe's `accent`. */
  color?: DitherColor;
}

export type DitherGlobeProps = Omit<ComponentProps<"div">, "children"> & {
  /** Colour of the land and the atmosphere. Default `"ink"`. */
  color?: DitherColor;
  /** Colour of markers and arcs unless they set their own. Default `"orange"`. */
  accent?: DitherColor;
  /** Locations to mark. Markers on the far side are hidden. */
  markers?: readonly GlobeMarker[];
  /** Connections between places, lifted off the surface. */
  arcs?: readonly GlobeArc[];
  /** Degrees of rotation per second. Negative spins the other way. Default 6. */
  speed?: number;
  /** Longitude facing the viewer at the start, in degrees. Default 10. */
  start?: number;
  /** How far the north pole leans towards the viewer, in degrees. Default 18. */
  tilt?: number;
  /** Where the light comes from, in degrees clockwise from the top. Default 300 (upper left). */
  light?: number;
  /** Brightness of the sea on the lit side, 0 to 1. Default 0.18. */
  ocean?: number;
  /** A thin dithered glow around the lit rim. Default true. */
  atmosphere?: boolean;
  /** Let people drag sideways to spin the globe. Default true. */
  draggable?: boolean;
  /** Size of one dither cell in CSS pixels. Default 2. */
  cell?: number;
  /** Threshold matrix. Default `"bayer4"`. */
  matrix?: DitherMatrix;
  /** Spin and pulse. false draws one still frame; reduced motion does the same. Default true. */
  animate?: boolean;
  /**
   * Turn to face this place, hold it for a while, then resume the idle spin.
   * Pass a new object to aim again, even at the same place.
   */
  focus?: { at: LatLon } | null;
};

const RADIANS = Math.PI / 180;
const RADIUS_SHARE = 0.42;

type Vec3 = readonly [number, number, number];

interface Disc {
  columns: number;
  rows: number;
  cx: number;
  cy: number;
  radius: number;
  /** Pixel index, then the view-space normal, for every pixel on the sphere. */
  sphere: Float32Array;
  /** Pixel index and glow strength for the atmosphere ring. */
  halo: Float32Array;
}

const buildDisc = (columns: number, rows: number): Disc => {
  const cx = columns / 2;
  const cy = rows / 2;
  const radius = Math.min(columns, rows) * RADIUS_SHARE;
  const sphere: number[] = [];
  const halo: number[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const nx = (x + 0.5 - cx) / radius;
      const ny = (cy - y - 0.5) / radius;
      const r2 = nx * nx + ny * ny;
      if (r2 <= 1) {
        sphere.push(y * columns + x, nx, ny, Math.sqrt(1 - r2));
      } else if (r2 < 1.16) {
        halo.push(y * columns + x, 1 - (Math.sqrt(r2) - 1) / 0.077);
      }
    }
  }
  return {
    columns,
    cx,
    cy,
    halo: Float32Array.from(halo),
    radius,
    rows,
    sphere: Float32Array.from(sphere),
  };
};

/** The globe's orientation, as sines and cosines worked out once a frame. */
interface View {
  cosS: number;
  sinS: number;
  cosT: number;
  sinT: number;
}

/** `spin` turns about the axis, `tilt` leans it towards the viewer; radians. */
const makeView = (spin: number, tilt: number): View => ({
  cosS: Math.cos(spin),
  cosT: Math.cos(tilt),
  sinS: Math.sin(spin),
  sinT: Math.sin(tilt),
});

/** View space to the globe's own frame: undo the tilt, then the spin. */
const toWorld = ({ cosS, sinS, cosT, sinT }: View, [x, y, z]: Vec3): Vec3 => {
  const y1 = y * cosT - z * sinT;
  const z1 = y * sinT + z * cosT;
  return [x * cosS + z1 * sinS, y1, -x * sinS + z1 * cosS];
};

/** The globe's frame to view space. */
const toView = ({ cosS, sinS, cosT, sinT }: View, [x, y, z]: Vec3): Vec3 => {
  const x1 = x * cosS - z * sinS;
  const z1 = x * sinS + z * cosS;
  return [x1, y * cosT + z1 * sinT, -y * sinT + z1 * cosT];
};

const fromLatLon = ([lat, lon]: LatLon): Vec3 => {
  const phi = lat * RADIANS;
  const lambda = lon * RADIANS;
  return [
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
    Math.cos(phi) * Math.cos(lambda),
  ];
};

const lightVector = (degrees: number): Vec3 => {
  const angle = degrees * RADIANS;
  const x = Math.sin(angle) * 0.75;
  const y = Math.cos(angle) * 0.75;
  const length = Math.hypot(x, y, 0.62);
  return [x / length, y / length, 0.62 / length];
};

interface Paint {
  land: Rgba;
  accent: Rgba;
  extra: ReadonlyMap<DitherColor, Rgba>;
}

interface Scene {
  disc: Disc;
  view: View;
  light: Vec3;
  ocean: number;
  matrix: DitherMatrix;
  paint: Paint;
}

const put = (data: Uint8ClampedArray, index: number, [r, g, b, a]: Rgba) => {
  const at = index * 4;
  data[at] = r * 255;
  data[at + 1] = g * 255;
  data[at + 2] = b * 255;
  data[at + 3] = a * 255;
};

const surfaceTone = (scene: Scene, normal: Vec3) => {
  const { view, light, ocean } = scene;
  const lit =
    normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2];
  // Lambert light with a short soft edge past the terminator.
  const shade = Math.min(1, Math.max(0, (lit + 0.08) / 1.08));
  const [wx, wy, wz] = toWorld(view, normal);
  const lat = Math.asin(Math.max(-1, Math.min(1, wy))) / RADIANS;
  const lon = Math.atan2(wx, wz) / RADIANS;
  if (landCoverage(lat, lon) >= 0.5) {
    return 0.07 + 0.93 * shade;
  }
  const rim = (1 - normal[2]) ** 3;
  return shade * (ocean * (0.5 + rim) + rim * 0.1);
};

/** Land, sea and terminator: one dithered tone per pixel of the sphere. */
const paintSphere = (image: ImageData, scene: Scene) => {
  const { disc, matrix, paint } = scene;
  const { sphere, columns } = disc;
  for (let i = 0; i < sphere.length; i += 4) {
    const index = sphere[i] ?? 0;
    const tone = surfaceTone(scene, [
      sphere[i + 1] ?? 0,
      sphere[i + 2] ?? 0,
      sphere[i + 3] ?? 0,
    ]);
    const x = index % columns;
    if (tone > thresholdAt(matrix, x, (index - x) / columns)) {
      put(image.data, index, paint.land);
    }
  }
};

/** A thin glow around the sphere, strongest towards the light. */
const paintAtmosphere = (image: ImageData, scene: Scene) => {
  const { disc, light, matrix, paint } = scene;
  const { halo, columns, cx, cy, radius } = disc;
  for (let i = 0; i < halo.length; i += 2) {
    const index = halo[i] ?? 0;
    const x = index % columns;
    const y = (index - x) / columns;
    const nx = (x + 0.5 - cx) / radius;
    const ny = (cy - y - 0.5) / radius;
    const facing = Math.max(
      0,
      (nx * light[0] + ny * light[1]) / Math.hypot(nx, ny)
    );
    const tone = (halo[i + 1] ?? 0) ** 2 * (0.12 + 0.5 * facing);
    if (tone > thresholdAt(matrix, x, y)) {
      put(image.data, index, paint.land);
    }
  }
};

interface Projected {
  x: number;
  y: number;
  /** Depth towards the viewer, -1 to 1 on the surface. */
  z: number;
  /** In front of the globe, or beside it where the globe can't hide it. */
  visible: boolean;
}

const projectPoint = (disc: Disc, view: View, point: Vec3): Projected => {
  const [x, y, z] = toView(view, point);
  return {
    visible: z > 0 || x * x + y * y > 1,
    x: disc.cx + x * disc.radius,
    y: disc.cy - y * disc.radius,
    z,
  };
};

const rgba = (color: Rgba) =>
  `rgba(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255}, ${color[3]})`;

const fillCell = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size = 1
) => {
  const offset = Math.floor(size / 2);
  context.fillRect(Math.round(x) - offset, Math.round(y) - offset, size, size);
};

const PULSE = 2.6;

const paintMarker = (
  context: CanvasRenderingContext2D,
  scene: Scene,
  point: Projected,
  phase: number
) => {
  // An expanding ring of dithered cells that fades as it grows.
  const ring = 2 + phase * Math.max(6, scene.disc.radius * 0.1);
  const fade = (1 - phase) ** 1.5;
  const steps = Math.ceil(ring * 6);
  for (let s = 0; s < steps; s += 1) {
    const angle = (s / steps) * Math.PI * 2;
    const x = Math.round(point.x + Math.cos(angle) * ring);
    // Flattened by depth, so rings near the limb lie on the surface.
    const y = Math.round(point.y + Math.sin(angle) * ring * point.z);
    if (fade > thresholdAt(scene.matrix, x, y)) {
      fillCell(context, x, y);
    }
  }
  fillCell(context, point.x, point.y, 3);
};

const paintMarkers = (
  context: CanvasRenderingContext2D,
  scene: Scene,
  markers: readonly GlobeMarker[],
  time: number
) => {
  const { disc, view, paint } = scene;
  for (const [index, marker] of markers.entries()) {
    const point = projectPoint(disc, view, fromLatLon(marker.at));
    if (point.z > 0.05) {
      context.fillStyle = rgba(
        (marker.color && paint.extra.get(marker.color)) || paint.accent
      );
      paintMarker(context, scene, point, (time / PULSE + index * 0.37) % 1);
    }
  }
};

/** A point on the great circle from `a` to `b`, lifted in the middle. */
const arcPoint = (a: Vec3, b: Vec3, angle: number, s: number): Vec3 => {
  const sin = Math.sin(angle) || 1;
  const wa = Math.sin((1 - s) * angle) / sin;
  const wb = Math.sin(s * angle) / sin;
  const lift = 1 + Math.sin(Math.PI * s) * (0.06 + angle * 0.1);
  return [
    (a[0] * wa + b[0] * wb) * lift,
    (a[1] * wa + b[1] * wb) * lift,
    (a[2] * wa + b[2] * wb) * lift,
  ];
};

const paintArcs = (
  context: CanvasRenderingContext2D,
  scene: Scene,
  arcs: readonly GlobeArc[],
  time: number
) => {
  const { disc, view, paint } = scene;
  for (const [index, arc] of arcs.entries()) {
    const a = fromLatLon(arc.from);
    const b = fromLatLon(arc.to);
    const angle = Math.acos(
      Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
    );
    context.fillStyle = rgba(
      (arc.color && paint.extra.get(arc.color)) || paint.accent
    );
    const steps = Math.max(12, Math.ceil(angle * disc.radius * 1.3));
    // A bright stretch travels along each arc; the rest is dotted.
    const head = (time / 3.2 + index * 0.41) % 1.5;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const point = projectPoint(disc, view, arcPoint(a, b, angle, t));
      const lit = t <= head && t > head - 0.25;
      if (point.visible && (lit || s % 3 === 0)) {
        fillCell(context, point.x, point.y);
      }
    }
  }
};

interface CanvasSize {
  columns: number;
  rows: number;
}

const useCanvasSize = (
  wrapper: RefObject<HTMLDivElement | null>,
  cell: number
) => {
  const [size, setSize] = useState<CanvasSize | null>(null);
  useEffect(() => {
    const element = wrapper.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) {
        setSize({
          columns: Math.max(8, Math.floor(box.width / cell)),
          rows: Math.max(8, Math.floor(box.height / cell)),
        });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [wrapper, cell]);
  return size;
};

/** Steepest the globe can be tilted by hand, in degrees either way. */
const TILT_LIMIT = 60;
/** Touch travel in px before a gesture counts as a drag or a scroll. */
const TOUCH_SLOP = 8;
/** How quickly a fling slows, per second. */
const FRICTION = 3.5;
/** Fastest fling, in degrees per second. */
const MAX_FLING = 600;
/** How quickly the idle spin comes back after a drag, per second. */
const IDLE_RETURN = 1.2;
/** Degrees one arrow key press turns the globe. */
const KEY_SPIN = 20;
const KEY_TILT = 10;
/** Arrow keys turn the globe the way a drag in that direction would. */
const KEY_STEPS: ReadonlyMap<string, Turn> = new Map([
  ["ArrowDown", { spin: 0, tilt: KEY_TILT }],
  ["ArrowLeft", { spin: KEY_SPIN, tilt: 0 }],
  ["ArrowRight", { spin: -KEY_SPIN, tilt: 0 }],
  ["ArrowUp", { spin: 0, tilt: -KEY_TILT }],
]);
/** How quickly an aimed turn closes on its target, per second. */
const AIM_SPEED = 3;
/** Seconds an aimed turn holds its place before the idle spin returns. */
const AIM_HOLD = 10;
/** A pointer that rested this long before release doesn't fling. */
const FLING_WINDOW = 80;

type Gesture =
  | { kind: "none" }
  /** A touch that hasn't moved far enough to say if it's a drag or a scroll. */
  | { kind: "pending"; pointerId: number; x: number; y: number }
  | {
      kind: "dragging";
      pointerId: number;
      x: number;
      y: number;
      /** `event.timeStamp` of the last move, for the fling. */
      time: number;
    };

/** How far the globe has been turned, in degrees, on top of `start` and `tilt`. */
interface Turn {
  spin: number;
  tilt: number;
}

interface GlobeTurnOptions {
  /** Base tilt from props, so the total stays inside the limit. */
  tilt: number;
  /** Fling and ease back into the idle spin, or follow the pointer only. */
  moving: boolean;
  /** Degrees per CSS pixel that keep the surface under the pointer. */
  degreesPerPixel: () => number;
  /** Paint now, for still globes and between frames while dragging. */
  redraw: () => void;
}

interface GlobeTurn {
  /** Move the idle spin and any fling on by `delta` seconds. */
  advance: (delta: number, speed: number) => Turn;
  /** Ease towards these offsets from `start` and `tilt`, taking the short way round. */
  aim: (spin: number, tilt: number) => void;
  handlers: Pick<
    ComponentProps<"div">,
    | "onKeyDown"
    | "onLostPointerCapture"
    | "onPointerCancel"
    | "onPointerDown"
    | "onPointerMove"
    | "onPointerUp"
  >;
}

const clampTilt = (base: number, extra: number) => {
  const low = Math.min(-TILT_LIMIT, base);
  const high = Math.max(TILT_LIMIT, base);
  return Math.min(high, Math.max(low, base + extra)) - base;
};

const clampFling = (velocity: number) =>
  Math.max(-MAX_FLING, Math.min(MAX_FLING, velocity));

/**
 * Drag, fling and arrow keys for the globe. Dragging sideways turns it about
 * its axis and up or down tilts it, with the surface kept under the pointer.
 * On touch, a gesture that starts mostly vertical is left to the page so it
 * scrolls. The idle spin stops while dragging and eases back afterwards.
 */
const useGlobeTurn = ({
  tilt,
  moving,
  degreesPerPixel,
  redraw,
}: GlobeTurnOptions): GlobeTurn => {
  const turn = useRef<Turn>({ spin: 0, tilt: 0 });
  const target = useRef<(Turn & { held: number }) | null>(null);
  const fling = useRef<Turn>({ spin: 0, tilt: 0 });
  const idle = useRef(1);
  const gesture = useRef<Gesture>({ kind: "none" });
  // Pointers down on the globe; a second one means a pinch, never a drag.
  const pointers = useRef(new Set<number>());

  const turnBy = (spin: number, lean: number) => {
    turn.current.spin += spin;
    turn.current.tilt = clampTilt(tilt, turn.current.tilt + lean);
  };

  const advance = (delta: number, speed: number): Turn => {
    if (gesture.current.kind === "dragging") {
      idle.current = 0;
      return turn.current;
    }
    const aimed = target.current;
    if (aimed && aimed.held < AIM_HOLD) {
      const ease = 1 - Math.exp(-delta * AIM_SPEED);
      turn.current.spin += (aimed.spin - turn.current.spin) * ease;
      turn.current.tilt += (aimed.tilt - turn.current.tilt) * ease;
      aimed.held += delta;
      idle.current = 0;
      return turn.current;
    }
    target.current = null;
    const decay = Math.exp(-delta * FRICTION);
    const before = turn.current.tilt;
    turnBy(
      (fling.current.spin * (1 - decay)) / FRICTION,
      (fling.current.tilt * (1 - decay)) / FRICTION
    );
    // A fling that ran into the tilt limit stops there.
    if (turn.current.tilt === before) {
      fling.current.tilt = 0;
    }
    fling.current.spin *= decay;
    fling.current.tilt *= decay;
    idle.current += (1 - idle.current) * (1 - Math.exp(-delta * IDLE_RETURN));
    turn.current.spin += speed * idle.current * delta;
    return turn.current;
  };

  /** Drop the gesture without a fling. */
  const cancel = (element: HTMLDivElement) => {
    const { current } = gesture;
    if (
      current.kind === "dragging" &&
      element.hasPointerCapture(current.pointerId)
    ) {
      element.releasePointerCapture(current.pointerId);
    }
    gesture.current = { kind: "none" };
    fling.current = { spin: 0, tilt: 0 };
    delete element.dataset.dragging;
  };

  const end = (
    event: ReactPointerEvent<HTMLDivElement>,
    flingAway: boolean
  ) => {
    pointers.current.delete(event.pointerId);
    const { current } = gesture;
    if (current.kind === "none" || current.pointerId !== event.pointerId) {
      return;
    }
    const resting =
      current.kind !== "dragging" ||
      event.timeStamp - current.time > FLING_WINDOW;
    if (!(flingAway && moving) || resting) {
      fling.current = { spin: 0, tilt: 0 };
    }
    gesture.current = { kind: "none" };
    delete event.currentTarget.dataset.dragging;
  };

  const aim = (spin: number, lean: number) => {
    const around = ((((spin - turn.current.spin) % 360) + 540) % 360) - 180;
    const next = { spin: turn.current.spin + around, tilt: clampTilt(tilt, lean) };
    fling.current = { spin: 0, tilt: 0 };
    if (moving) {
      target.current = { ...next, held: 0 };
    } else {
      turn.current = next;
    }
  };

  const startDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    x: number,
    y: number
  ) => {
    gesture.current = {
      kind: "dragging",
      pointerId: event.pointerId,
      time: event.timeStamp,
      x,
      y,
    };
    target.current = null;
    fling.current = { spin: 0, tilt: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = "";
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The first pointer of a new touch or click: nothing else is down.
    if (event.isPrimary) {
      pointers.current.clear();
    }
    pointers.current.add(event.pointerId);
    if (pointers.current.size > 1) {
      cancel(event.currentTarget);
      return;
    }
    if (gesture.current.kind !== "none" || event.button !== 0) {
      return;
    }
    if (event.pointerType === "touch") {
      gesture.current = {
        kind: "pending",
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      return;
    }
    // Keep a mouse drag from selecting text around the globe.
    event.preventDefault();
    startDrag(event, event.clientX, event.clientY);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { current } = gesture;
    if (current.kind === "none" || current.pointerId !== event.pointerId) {
      return;
    }
    if (current.kind === "pending") {
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (Math.hypot(dx, dy) < TOUCH_SLOP) {
        return;
      }
      if (Math.abs(dy) >= Math.abs(dx)) {
        // A scroll: the browser takes it and cancels this pointer.
        gesture.current = { kind: "none" };
        return;
      }
      if (pointers.current.size > 1) {
        return;
      }
      startDrag(event, current.x, current.y);
    }
    const dragging = gesture.current;
    if (dragging.kind !== "dragging") {
      return;
    }
    const scale = degreesPerPixel();
    const spin = -(event.clientX - dragging.x) * scale;
    const lean = (event.clientY - dragging.y) * scale;
    const seconds = Math.max((event.timeStamp - dragging.time) / 1000, 1 / 240);
    // Smoothed so one uneven event doesn't decide the fling.
    fling.current = {
      spin: clampFling(fling.current.spin * 0.3 + (spin / seconds) * 0.7),
      tilt: clampFling(fling.current.tilt * 0.3 + (lean / seconds) * 0.7),
    };
    turnBy(spin, lean);
    gesture.current = {
      ...dragging,
      time: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
    };
    redraw();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = KEY_STEPS.get(event.key);
    if (!step || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    if (moving) {
      // A fling that covers exactly one step, so held keys glide.
      fling.current = {
        spin: step.spin ? step.spin * FRICTION : fling.current.spin,
        tilt: step.tilt ? step.tilt * FRICTION : fling.current.tilt,
      };
    } else {
      turnBy(step.spin, step.tilt);
      redraw();
    }
  };

  return {
    advance,
    aim,
    handlers: {
      onKeyDown,
      // Capture can go without a pointerup (an alert, a removed node):
      // stop where it is. The pointer itself may still be down. Taking
      // capture from the canvas, where a touch lands, fires this on the
      // canvas too; that one isn't ours to act on.
      onLostPointerCapture: (event) => {
        if (
          event.target === event.currentTarget &&
          gesture.current.kind !== "none" &&
          gesture.current.pointerId === event.pointerId
        ) {
          cancel(event.currentTarget);
        }
      },
      onPointerCancel: (event) => end(event, false),
      onPointerDown,
      onPointerMove,
      onPointerUp: (event) => end(event, true),
    },
  };
};

const NO_MARKERS: readonly GlobeMarker[] = [];
const NO_ARCS: readonly GlobeArc[] = [];

/**
 * A rotating dithered globe: land from a built-in mask, a lit terminator
 * and a thin atmosphere, with optional pulsing markers and arcs between
 * places. Drawn on a small 2D canvas at dither-cell resolution, so it uses
 * no WebGL context. The globe stays round and centred in its box: size the
 * box with `className` (for example `aspect-square w-full`).
 */
export const DitherGlobe = ({
  color = "ink",
  accent = "orange",
  markers = NO_MARKERS,
  arcs = NO_ARCS,
  speed = 6,
  start = 10,
  tilt = 18,
  light = 300,
  ocean = 0.18,
  atmosphere = true,
  draggable = true,
  cell = 2,
  matrix = "bayer4",
  animate = true,
  focus,
  className,
  ...props
}: DitherGlobeProps) => {
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cellSize = Math.max(1, cell);
  const size = useCanvasSize(wrapper, cellSize);
  const extraNames = [
    ...new Set(
      [...markers, ...arcs].flatMap((item) =>
        item.color === undefined ? [] : [item.color]
      )
    ),
  ];
  const colors = useDitherColors(wrapper, [color, accent, ...extraNames]);
  const reducedMotion = usePrefersReducedMotion();
  const clock = useRef(0);
  const disc = useRef<Disc | null>(null);
  // Reused across frames; reallocated only when the cell grid changes size.
  const frame = useRef<ImageData | null>(null);
  const drawRef = useRef<(time: number, delta: number) => void>(() => {
    // Replaced on the first render.
  });
  // One paint per frame while dragging, however fast pointer events arrive.
  const pendingDraw = useRef(0);
  const redraw = useCallback(() => {
    if (pendingDraw.current) {
      return;
    }
    pendingDraw.current = requestAnimationFrame(() => {
      pendingDraw.current = 0;
      drawRef.current(clock.current, 0);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(pendingDraw.current), []);
  const aimRef = useRef<(spin: number, tilt: number) => void>(() => {});
  const turn = useGlobeTurn({
    degreesPerPixel: () =>
      disc.current ? 1 / (disc.current.radius * cellSize * RADIANS) : 0,
    moving: animate && !reducedMotion,
    redraw,
    tilt,
  });

  aimRef.current = turn.aim;
  // Only when a new focus arrives; start and tilt are read as they are then.
  useEffect(() => {
    if (focus) {
      aimRef.current(focus.at[1] - start, focus.at[0] - tilt);
      redraw();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const extra = new Map(
    colors
      ? extraNames.map((name, index) => [name, colors[index + 2] ?? colors[1]])
      : []
  );

  const draw = (time: number, delta: number) => {
    const context = canvas.current?.getContext("2d");
    const { current } = disc;
    if (!context || !current || !colors) {
      return;
    }
    clock.current = time;
    const turned = turn.advance(delta, speed);
    const scene: Scene = {
      disc: current,
      light: lightVector(light),
      matrix,
      ocean,
      paint: { accent: colors[1], extra, land: colors[0] },
      view: makeView(
        (start + turned.spin) * RADIANS,
        -(tilt + turned.tilt) * RADIANS
      ),
    };
    let image = frame.current;
    if (image?.width !== current.columns || image.height !== current.rows) {
      image = context.createImageData(current.columns, current.rows);
      frame.current = image;
    } else {
      image.data.fill(0);
    }
    paintSphere(image, scene);
    if (atmosphere) {
      paintAtmosphere(image, scene);
    }
    context.putImageData(image, 0, 0);
    paintArcs(context, scene, arcs, time);
    paintMarkers(context, scene, markers, time);
  };
  useEffect(() => {
    drawRef.current = draw;
  });

  // Resize, and repaint whenever a prop or the theme changes, so a still
  // frame stays current too.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !size) {
      return;
    }
    if (element.width !== size.columns || element.height !== size.rows) {
      element.width = size.columns;
      element.height = size.rows;
      disc.current = buildDisc(size.columns, size.rows);
    }
    drawRef.current(clock.current, 0);
  });

  useFrameLoop((time, delta) => drawRef.current(time, delta), {
    enabled: animate,
    target: wrapper,
  });

  return (
    <div
      ref={wrapper}
      className={cn(
        "relative overflow-hidden select-none",
        draggable &&
          "focus-visible:outline-ring cursor-grab outline-none [touch-action:pan-y_pinch-zoom] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline data-[dragging]:cursor-grabbing",
        className
      )}
      {...(draggable
        ? {
            "aria-label": "Globe. Drag it or use the arrow keys to turn it.",
            role: "img",
            tabIndex: 0,
            ...turn.handlers,
          }
        : { "aria-hidden": true })}
      {...props}
    >
      <canvas
        ref={canvas}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 [image-rendering:pixelated]"
        style={
          size
            ? { height: size.rows * cellSize, width: size.columns * cellSize }
            : undefined
        }
      />
    </div>
  );
};
