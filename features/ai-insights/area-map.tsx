"use client";

import { MapPin, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import citiesMap from "@/lib/geo/ph-cities.json";
import map from "@/lib/geo/ph-provinces.json";

import type { AreaFigures, CityFigures, PeriodDays, PlaceFigures, ProductFigures } from "./insights";
import { DEFAULT_PRODUCT_VIEW, ProductList, ProductRanking, type ProductView } from "./product-ranking";
import { favouriteByPlace, formatMetric, productName, rankProducts } from "./products";

export const LAYERS = ["orders", "lateOrFailed", "returned", "complaints", "freeDelivery"] as const;
export type Layer = (typeof LAYERS)[number];

/** Rates are shown only once a place has this many, so one bad Order never paints an area dark. */
export const MIN_FOR_RATE = 3;

const LAYER: Record<Layer, { label: string; count: (p: PlaceFigures) => number; rate?: (p: PlaceFigures) => number | null; noun: string }> = {
  orders: { label: "Orders", noun: "orders", count: (p) => p.orders },
  lateOrFailed: {
    label: "Late or failed", noun: "late or failed", count: (p) => p.lateOrFailed,
    rate: (p) => (p.wentOut >= MIN_FOR_RATE ? p.lateOrFailed / p.wentOut : null),
  },
  returned: {
    label: "Returns & damage", noun: "with a return", count: (p) => p.returned,
    rate: (p) => (p.orders >= MIN_FOR_RATE ? p.returned / p.orders : null),
  },
  complaints: { label: "Complaints", noun: "complaints", count: (p) => p.complaints },
  freeDelivery: {
    label: "Free-delivery reach", noun: "free delivery", count: (p) => p.freeDelivery,
    rate: (p) => (p.deliveries >= MIN_FOR_RATE ? p.freeDelivery / p.deliveries : null),
  },
};

/** What an area is shaded by: its rate when the layer has one, otherwise its count. Null when there is too little to say. */
export function layerValue(place: PlaceFigures, layer: Layer): number | null {
  const { rate, count } = LAYER[layer];
  return rate ? rate(place) : count(place);
}
const formatValue = (value: number | null, layer: Layer) =>
  value === null ? "Too few Orders" : LAYER[layer].rate ? `${Math.round(value * 100)}%` : value.toLocaleString("en-PH");

/** Change in Orders against the period before; null when there is nothing to compare. */
export function orderChange(place: Pick<PlaceFigures, "orders" | "previousOrders">): { label: string; up: boolean } | null {
  if (place.previousOrders === 0) return place.orders > 0 ? { label: "New", up: true } : null;
  const change = Math.round(((place.orders - place.previousOrders) / place.previousOrders) * 100);
  return change === 0 ? null : { label: `${change > 0 ? "+" : ""}${change}%`, up: change > 0 };
}

/** One hue, light to dark; no data stays neutral. */
const STEPS = ["#ebe2f5", "#d5c2ea", "#b597d8", "#8f63bf", "#6b3a99"];
const LAND = "#f3f1f6";

type AreaLevel = "city" | "province";
const SEA = "#e6eef7";

interface View { x: number; y: number; w: number; h: number }
const [, , MAP_W, MAP_H] = map.viewBox.split(" ").map(Number);
export const VIEWS = {
  philippines: { x: -40, y: 0, w: MAP_W + 80, h: MAP_H },
  "metro-manila": { x: 156, y: 263.5, w: 26, h: 23 },
} satisfies Record<string, View>;
type ViewName = keyof typeof VIEWS;
/** Below this width (in map units) the city outlines and bubbles show. */
export const CITY_ZOOM = 70;
const MIN_W = 6, MAX_W = MAP_W * 2;

const CITY_POINTS = new Map(citiesMap.cities.map((c) => [`${c.province}|${c.key}`, c]));

function zoomed(view: View, factor: number, cx: number, cy: number): View {
  const w = Math.min(MAX_W, Math.max(MIN_W, view.w * factor));
  const f = w / view.w;
  return { x: cx - (cx - view.x) * f, y: cy - (cy - view.y) * f, w, h: view.h * f };
}

function Change({ place }: { place: Pick<PlaceFigures, "orders" | "previousOrders"> }) {
  const change = orderChange(place);
  if (!change) return null;
  return <span className={change.up ? "text-xs font-medium text-[#15803d]" : "text-xs font-medium text-[#b91c1c]"}>{change.label}</span>;
}

/**
 * "Where it's happening" and "Top areas": Province shading for the whole country, and city outlines with bubbles once
 * zoomed in. Areas come from delivery addresses and are aggregated to city; no customer location is ever drawn.
 */
export function AreaSection({ areas, unmapped, orders, days, enoughData, products = null, canSeeRatings = false }: {
  areas: AreaFigures[]; unmapped: number; orders: number; days: PeriodDays; enoughData: boolean;
  /** Products by place from the stored run; null for runs from before products were counted. */
  products?: ProductFigures[] | null;
  /** Ranking by Customer rating needs the Feedback Module. */
  canSeeRatings?: boolean;
}) {
  const [productView, setProductView] = useState<ProductView>(DEFAULT_PRODUCT_VIEW);
  const [level, setLevel] = useState<AreaLevel>("city");
  const view_ = canSeeRatings || productView.metric !== "rating" ? productView : DEFAULT_PRODUCT_VIEW;
  const favourites = useMemo(() => {
    const rows = products && enoughData ? products : [];
    const options = { bySize: view_.bySize, metric: view_.metric };
    return { city: favouriteByPlace(rows, { scope: "city", ...options }), province: favouriteByPlace(rows, { scope: "province", ...options }) };
  }, [products, enoughData, view_.bySize, view_.metric]);
  const [layer, setLayer] = useState<Layer>("orders");
  const [view, setView] = useState<View>(VIEWS["metro-manila"]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const byArea = useMemo(() => new Map(areas.map((a) => [a.key, a])), [areas]);
  const cities = useMemo(() => areas.flatMap((a) => a.cities), [areas]);
  const byCity = useMemo(() => new Map(cities.map((c) => [c.key, c])), [cities]);
  const shown = enoughData ? areas : [];
  const max = Math.max(0, ...shown.map((a) => layerValue(a, layer) ?? 0));
  const maxCity = Math.max(0, ...cities.map((c) => LAYER[layer].count(c)));
  const showCities = enoughData && view.w <= CITY_ZOOM;
  const period = days === 7 ? "last 7 days" : "last 30 days";

  const fill = (key: string) => {
    const area = byArea.get(key);
    const value = area && enoughData ? layerValue(area, layer) : null;
    if (value === null || max === 0 || value === 0) return LAND;
    return STEPS[Math.min(STEPS.length - 1, Math.floor((value / max) * STEPS.length))];
  };

  /** From a pointer on the screen to map units, through the SVG's own transform. */
  const toMap = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: view.x + view.w / 2, y: view.y + view.h / 2 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  /** Map units per screen pixel at the current zoom; the SVG keeps its whole view box in sight ("meet"). */
  const px = size.width && size.height ? Math.max(view.w / size.width, view.h / size.height) : view.w / 600;

  // A non-passive listener, so the wheel zooms the map instead of scrolling the page.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
      setView((v) => zoomed(v, Math.exp(event.deltaY * 0.0015), p.x, p.y));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved.current = 0;
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) {
      const box = frameRef.current?.getBoundingClientRect();
      const key = (event.target as Element).getAttribute?.("data-place");
      setHover(key && box ? { key, x: event.clientX - box.left, y: event.clientY - box.top } : null);
      return;
    }
    if (pointers.current.size === 1) {
      const dx = event.clientX - last.x, dy = event.clientY - last.y;
      moved.current += Math.abs(dx) + Math.abs(dy);
      if (moved.current > 4) {
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        setView((v) => ({ ...v, x: v.x - dx * px, y: v.y - dy * px }));
        setHover(null);
      }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()];
      const other = a[0] === event.pointerId ? b[1] : a[1];
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      moved.current += 10;
      if (before > 0 && after > 0) {
        const mid = toMap((event.clientX + other.x) / 2, (event.clientY + other.y) / 2);
        setView((v) => zoomed(v, before / after, mid.x, mid.y));
      }
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const onPointerUp = (event: React.PointerEvent) => { pointers.current.delete(event.pointerId); };

  const pick = (key: string) => {
    if (moved.current > 4) return;
    setSelected((now) => (now === key ? null : byArea.has(key) || byCity.has(key) ? key : null));
  };
  const zoomBy = (factor: number) => setView((v) => zoomed(v, factor, v.x + v.w / 2, v.y + v.h / 2));
  const goTo = (name: ViewName) => { setView(VIEWS[name]); setHover(null); };
  const current: ViewName | null = (Object.keys(VIEWS) as ViewName[]).find((n) => VIEWS[n] === view) ?? null;

  const bubbles = showCities
    ? cities
      .map((city) => ({ city, point: CITY_POINTS.get(city.key), count: LAYER[layer].count(city) }))
      .filter((b): b is { city: CityFigures; point: (typeof citiesMap.cities)[number]; count: number } => !!b.point && b.count > 0)
      .sort((a, b) => b.count - a.count)
    : [];
  const hovered = hover ? byCity.get(hover.key) ?? byArea.get(hover.key) ?? null : null;
  const chosen = selected ? byCity.get(selected) ?? byArea.get(selected) ?? null : null;

  const hoveredFavourite = hover ? favourites.city.get(hover.key) ?? favourites.province.get(hover.key) ?? null : null;

  return (
    <div className="flex flex-col gap-4">
    <ProductRanking products={products} view={view_} onView={setProductView} canSeeRatings={canSeeRatings} days={days} enoughData={enoughData} />
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <section aria-label="Where it's happening" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-[#18181b]">Where it&apos;s happening</h2>
          <span className="rounded-full bg-[#f4f4f5] px-2.5 py-1 text-xs text-[#52525b]">{orders.toLocaleString("en-PH")} orders · {period}</span>
        </div>
        <div role="radiogroup" aria-label="Show on the map" className="flex flex-wrap gap-1">
          {LAYERS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={l === layer} onClick={() => setLayer(l)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#52525b] hover:bg-[#f5f0fa] aria-checked:bg-[#efe7f7] aria-checked:text-[#5b2a86]">
              {LAYER[l].label}
            </button>
          ))}
        </div>

        <div ref={frameRef} className="relative h-[320px] overflow-hidden rounded-xl border border-[#ece8f1] sm:h-[360px]" style={{ background: SEA }}
          onMouseLeave={() => setHover(null)}>
          <svg
            ref={svgRef}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`Map of delivery areas by ${LAYER[layer].label.toLowerCase()}. The Top areas list has the same figures.`}
            className="size-full cursor-grab touch-none select-none active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {map.shapes.map((shape) => (
              <path key={shape.key} d={shape.d} data-place={shape.key} data-area={shape.key}
                fill={fill(shape.key)} fillOpacity={showCities ? 0.55 : 1}
                stroke={shape.key === selected ? "#18181b" : "#ffffff"} strokeWidth={shape.key === selected ? 1.5 : 0.75}
                vectorEffect="non-scaling-stroke" onClick={() => pick(shape.key)} />
            ))}
            {showCities && (
              <g data-cities>
                <text x={160.4} y={277.6} fontSize={11 * px} fill="#7c93ad" fontStyle="italic" textAnchor="middle" pointerEvents="none">Manila Bay</text>
                <text x={175} y={286.5} fontSize={11 * px} fill="#7c93ad" fontStyle="italic" textAnchor="middle" pointerEvents="none">Laguna de Bay</text>
                {citiesMap.cities.map((c) => (
                  <path key={`${c.province}|${c.key}`} d={c.d} fill="#ffffff" fillOpacity={0.35} stroke="#d9d2e4" strokeWidth={0.75}
                    vectorEffect="non-scaling-stroke" pointerEvents="none" />
                ))}
                {bubbles.map(({ city, point, count }) => {
                  const r = (5 + 15 * Math.sqrt(count / Math.max(1, maxCity))) * px;
                  const active = city.key === selected;
                  return (
                    <g key={city.key} data-bubble={city.key} className="cursor-pointer" onClick={() => pick(city.key)}>
                      <circle cx={point.x} cy={point.y} r={r} data-place={city.key} fill="#8f63bf" fillOpacity={active ? 0.55 : 0.28}
                        stroke="#5b2a86" strokeWidth={active ? 2 : 1} vectorEffect="non-scaling-stroke" />
                      <circle cx={point.x} cy={point.y} r={2.2 * px} fill="#5b2a86" pointerEvents="none" />
                      <text x={point.x} y={point.y - r - 4 * px} fontSize={11 * px} fontWeight={600} fill="#18181b" textAnchor="middle"
                        paintOrder="stroke" stroke="#ffffff" strokeWidth={3 * px} pointerEvents="none">
                        {city.name} · {count}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}
          </svg>

          <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
            <div className="pointer-events-auto flex overflow-hidden rounded-lg border border-[#e4e4e7] bg-white text-xs font-medium shadow-sm" role="group" aria-label="Map view">
              {(["metro-manila", "philippines"] as const).map((name) => (
                <button key={name} type="button" aria-pressed={current === name} onClick={() => goTo(name)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[#52525b] aria-pressed:bg-[#efe7f7] aria-pressed:text-[#5b2a86]">
                  {name === "metro-manila" && <MapPin className="size-3" aria-hidden />}
                  {name === "metro-manila" ? "Metro Manila · delivery areas" : "Philippines"}
                </button>
              ))}
            </div>
            <div className="pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-[#e4e4e7] bg-white shadow-sm">
              <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1 / 1.5)} className="p-1.5 text-[#52525b] hover:bg-[#f5f0fa]"><Plus className="size-4" /></button>
              <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1.5)} className="border-t border-[#e4e4e7] p-1.5 text-[#52525b] hover:bg-[#f5f0fa]"><Minus className="size-4" /></button>
              <button type="button" aria-label="Reset the map" onClick={() => goTo("metro-manila")} className="border-t border-[#e4e4e7] p-1.5 text-[#52525b] hover:bg-[#f5f0fa]"><RotateCcw className="size-4" /></button>
            </div>
          </div>

          {enoughData && (
            <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-2 rounded-lg bg-white/90 px-2.5 py-1.5 text-[11px] text-[#52525b] shadow-sm" aria-hidden>
              {showCities ? (
                <><span className="inline-block size-3 rounded-full border border-[#5b2a86] bg-[#8f63bf]/30" /> Bubble = {LAYER[layer].noun} per city</>
              ) : (
                <><span>Low</span><span className="flex h-2 w-16 overflow-hidden rounded-sm">{STEPS.map((s) => <span key={s} className="flex-1" style={{ background: s }} />)}</span><span>{max > 0 ? formatValue(max, layer) : "High"}</span></>
              )}
            </div>
          )}

          {hover && hovered && (
            <div role="tooltip" className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-[#e6e1ee] bg-white px-3 py-2 text-xs shadow-md"
              style={{ left: hover.x, top: hover.y }}>
              <p className="font-medium text-[#18181b]">{hovered.name}</p>
              <p className="mt-0.5 text-[#52525b]">
                {LAYER[layer].label}: {formatValue(layerValue(hovered, layer), layer)}
                {layer !== "orders" && ` · ${hovered.orders} orders`}
              </p>
              {hoveredFavourite && <p className="mt-0.5 text-[#52525b]">Favourite: {productName(hoveredFavourite)}</p>}
            </div>
          )}

          {!enoughData && (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="w-full max-w-[20rem] rounded-xl border border-[#e6e1ee] bg-white px-5 py-4 text-center shadow-sm">
                <MapPin className="mx-auto size-5 text-[#5b2a86]" aria-hidden />
                <p className="mt-2 text-sm font-semibold text-[#18181b]">Not enough orders to draw the map</p>
                <p className="mt-1 text-xs text-[#71717a]">{orders} orders in the {period}. Areas show up after about 30.</p>
              </div>
            </div>
          )}
        </div>
        <p className="text-xs text-[#71717a]">
          Areas come from delivery addresses. The map shows areas, not exact customer locations.
          {enoughData && unmapped > 0 && ` ${unmapped} ${unmapped === 1 ? "address" : "addresses"} could not be placed.`}
        </p>
      </section>

      <TopAreas places={!enoughData ? [] : level === "city" ? cities : areas} level={level} onLevel={setLevel} chosen={chosen}
        onPick={setSelected} days={days} favourites={favourites[level]} products={enoughData ? products : null} view={view_} />
    </div>
    </div>
  );
}

function TopAreas({ places, level, onLevel, chosen, onPick, days, favourites, products, view }: {
  places: PlaceFigures[]; level: AreaLevel; onLevel: (level: AreaLevel) => void; chosen: PlaceFigures | null;
  onPick: (key: string | null) => void; days: PeriodDays; favourites: Map<string, ProductFigures>;
  products: ProductFigures[] | null; view: ProductView;
}) {
  const ranked = places.filter((c) => c.orders > 0).sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name)).slice(0, 8);
  const problems = places
    .map((c) => ({ city: c, total: c.lateOrFailed + c.returned + c.complaints }))
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total || a.city.name.localeCompare(b.city.name))
    .slice(0, 4);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const chosenScope = chosen && "cities" in chosen ? "province" : "city";
  const chosenProducts = chosen && products
    ? rankProducts(products, { scope: chosenScope, place: chosen.key, bySize: view.bySize, metric: view.metric })
    : [];

  return (
    <section aria-label="Top areas" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-[#18181b]">Top areas</h2>
        <span className="rounded-full bg-[#f4f4f5] px-2.5 py-1 text-xs text-[#52525b]">Last {days} days</span>
      </div>
      {chosen ? (
        <div className="flex flex-col gap-3">
          <button type="button" onClick={() => onPick(null)} className="w-fit rounded-lg px-2 py-1 text-sm font-medium text-[#5b2a86] hover:bg-[#f5f0fa]">← All areas</button>
          <div className="flex items-baseline gap-2">
            <h3 className="text-base font-semibold text-[#18181b]">{chosen.name}</h3>
            <Change place={chosen} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {([
              ["Orders", String(chosen.orders)],
              ["Before", String(chosen.previousOrders)],
              ["Late or failed", `${chosen.lateOrFailed} of ${chosen.wentOut}`],
              ["Returns", String(chosen.returned)],
              ["Complaints", String(chosen.complaints)],
              ["Free delivery", `${chosen.freeDelivery} of ${chosen.deliveries}`],
            ] as const).map(([label, value]) => (
              <div key={label}><dt className="text-xs text-[#71717a]">{label}</dt><dd className="tabular-nums text-[#18181b]">{value}</dd></div>
            ))}
          </dl>
          {chosenProducts.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-[#f0edf4] pt-3">
              <h4 className="text-xs font-semibold text-[#18181b]">Favourite products</h4>
              <ProductList rows={chosenProducts} metric={view.metric} limit={3} />
            </div>
          )}
        </div>
      ) : (
        <>
          <div role="radiogroup" aria-label="Areas" className="flex gap-1">
            {(["city", "province"] as const).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={l === level} onClick={() => onLevel(l)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#52525b] hover:bg-[#f5f0fa] aria-checked:bg-[#efe7f7] aria-checked:text-[#5b2a86]">
                {l === "city" ? "City" : "Province"}
              </button>
            ))}
          </div>
          <p className="text-xs text-[#71717a]">Orders by delivery area, compared with {days === 7 ? "the week" : "the 30 days"} before, with each area&apos;s favourite product.</p>
          {ranked.length === 0 ? (
            <p className="text-sm text-[#71717a]">No areas to rank yet. Rankings appear once there are enough orders.</p>
          ) : (
            <ol className="flex flex-col">
              {ranked.map((place, index) => {
                const favourite = favourites.get(place.key);
                return (
                  <li key={place.key}>
                    <button type="button" onClick={() => onPick(place.key)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[#f5f0fa]">
                      <span className="w-4 text-xs text-[#a1a1aa]">{index + 1}</span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[#18181b]">{place.name}</span>
                        {favourite && (
                          <span className="truncate text-xs text-[#71717a]">
                            Favourite: {productName(favourite)}{view.metric !== "orders" && view.metric !== "units" ? ` · ${formatMetric(favourite, view.metric)}` : ""}
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums font-medium text-[#18181b]">{place.orders}</span>
                      <span className="w-12 text-right"><Change place={place} /></span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {ranked.length > 0 && problems.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-[#f0edf4] pt-3">
              <h3 className="text-xs font-semibold text-[#18181b]">Problems by area</h3>
              <ul className="flex flex-col gap-1 text-xs text-[#52525b]">
                {problems.map(({ city }) => (
                  <li key={city.key}>
                    <button type="button" onClick={() => onPick(city.key)} className="text-left hover:text-[#5b2a86]">
                      <span className="font-medium text-[#18181b]">{city.name}</span>
                      {" · "}
                      {[city.lateOrFailed && `${city.lateOrFailed} late or failed`, city.returned && plural(city.returned, "return"), city.complaints && plural(city.complaints, "complaint")].filter(Boolean).join(", ")}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-[#a1a1aa]">Select an area to see its figures.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Shown at once while the run loads, the same size as the cards. */
export function AreaSectionSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
    <section aria-label="Top products" className="flex flex-col gap-3 rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4">
      <h2 className="text-[15px] font-semibold text-[#18181b]">Top products</h2>
      {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-6 animate-pulse rounded bg-[#f4f4f5]" />)}
    </section>
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <section aria-label="Where it's happening" className="flex flex-col gap-3 rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4">
        <h2 className="text-[15px] font-semibold text-[#18181b]">Where it&apos;s happening</h2>
        <div className="h-[320px] animate-pulse rounded-xl bg-[#f4f4f5] sm:h-[360px]" />
      </section>
      <section aria-label="Top areas" className="flex flex-col gap-3 rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4">
        <h2 className="text-[15px] font-semibold text-[#18181b]">Top areas</h2>
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-6 animate-pulse rounded bg-[#f4f4f5]" />)}
      </section>
    </div>
    </div>
  );
}
