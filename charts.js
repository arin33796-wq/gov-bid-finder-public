// Small SVG chart set. One series per chart -> categorical slot 1; hover tooltip on every mark;
// selective direct labels; hairline recessive grid. No dual axes, no value-ramp on nominal bars.
const NS = "http://www.w3.org/2000/svg";
import { FL_SHAPES, FL_COAST, FL_VIEW, US_SHAPES, US_VIEW } from "./geo.js?v=1";
const tip = () => document.getElementById("tip");

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  parent?.appendChild(n);
  return n;
}
export const fmt = (n) => n == null ? "—" : n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k" : String(Math.round(n));
export const usd = (n) => "$" + fmt(n);

function showTip(evt, title, lines) {
  const t = tip();
  t.innerHTML = `<div class="t">${title}</div>` + lines.map((l) => `<div class="muted">${l}</div>`).join("");
  t.style.opacity = 1;
  const r = t.getBoundingClientRect();
  t.style.left = Math.min(window.innerWidth - r.width - 10, evt.clientX + 14) + "px";
  t.style.top = Math.max(8, evt.clientY - r.height - 12) + "px";
}
function hideTip() { tip().style.opacity = 0; }

function hookTip(node, title, lines) {
  node.addEventListener("mousemove", (e) => showTip(e, title, lines));
  node.addEventListener("mouseleave", hideTip);
}

// Horizontal bars: best for long category labels (agency names, set-asides, NAICS).
export function hbar(host, data, { valueLabel = "notices", max = null, onClick = null } = {}) {
  host.innerHTML = "";
  if (!data.length) { host.innerHTML = '<div class="empty small">No data for these filters.</div>'; return; }
  const w = host.clientWidth || 420;
  // WHY 420: below that, a 168px label column plus the value leaves almost no bar,
  // and the value text draws past the viewBox. That spilled the page at phone width.
  // WHY 108 / 36: the desktop columns are 168 and 46, which do not fit a phone row.
  const narrow = w < 420;
  const labelW = narrow ? 108 : 168, valueW = narrow ? 36 : 46;
  const labelMax = narrow ? 16 : 26;
  const rowH = 27, gap = 2;
  const plotW = Math.max(40, w - labelW - valueW);
  const h = data.length * rowH;
  const top = max ?? (Math.max(...data.map((d) => d.value)) || 1);
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, height: h, role: "img" }, host);
  data.forEach((d, i) => {
    const y = i * rowH;
    const g = el("g", { class: "bar-row", style: onClick ? "cursor:pointer" : "" }, svg);
    el("text", { x: labelW - 10, y: y + rowH / 2 + 4, "text-anchor": "end", class: "blabel" }, g).textContent =
      d.label.length > labelMax ? d.label.slice(0, labelMax - 1) + "…" : d.label;
    el("rect", { x: labelW, y: y + gap, width: plotW, height: rowH - gap * 2, rx: 4, class: "bar-track" }, g);
    const bw = Math.max(2, (d.value / top) * plotW);
    el("rect", { x: labelW, y: y + gap, width: bw, height: rowH - gap * 2, rx: 4, fill: "var(--series-1)", class: "bar" }, g);
    el("text", { x: labelW + plotW + 8, y: y + rowH / 2 + 4, class: "bvalue" }, g).textContent = fmt(d.value);
    el("rect", { x: 0, y, width: w, height: rowH, fill: "transparent" }, g);
    hookTip(g, d.label, [`${d.value.toLocaleString()} ${valueLabel}`, ...(d.note ? [d.note] : [])]);
    if (onClick) g.addEventListener("click", () => onClick(d));
  });
}

// Vertical bars over time (deadline pressure by week).
export function vbar(host, data, { valueLabel = "notices", onClick = null } = {}) {
  host.innerHTML = "";
  if (!data.length) { host.innerHTML = '<div class="empty small">No data for these filters.</div>'; return; }
  const w = host.clientWidth || 420, h = 190, padL = 34, padB = 30, padT = 12;
  const plotW = w - padL - 8, plotH = h - padB - padT;
  const top = Math.max(...data.map((d) => d.value)) || 1;
  const step = plotW / data.length, bw = Math.min(38, step - 4);
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, height: h, role: "img" }, host);
  for (let i = 0; i <= 3; i++) {
    const v = (top / 3) * i, y = padT + plotH - (v / top) * plotH;
    el("line", { x1: padL, x2: w - 8, y1: y, y2: y, class: i === 0 ? "axisline" : "gridline" }, svg);
    el("text", { x: padL - 7, y: y + 4, "text-anchor": "end", class: "tick" }, svg).textContent = fmt(v);
  }
  data.forEach((d, i) => {
    const bh = Math.max(2, (d.value / top) * plotH);
    const x = padL + i * step + (step - bw) / 2, y = padT + plotH - bh;
    const g = el("g", { class: "bar-row", style: onClick ? "cursor:pointer" : "" }, svg);
    el("rect", { x, y, width: bw, height: bh, rx: 4, fill: "var(--series-1)", class: "bar" }, g);
    el("rect", { x: padL + i * step, y: padT, width: step, height: plotH, fill: "transparent" }, g);
    if (data.length <= 10 || i % 2 === 0)
      el("text", { x: x + bw / 2, y: h - 10, "text-anchor": "middle", class: "tick" }, svg).textContent = d.short ?? d.label;
    hookTip(g, d.full ?? d.label, [`${d.value.toLocaleString()} ${valueLabel}`]);
    if (onClick) g.addEventListener("click", () => onClick(d));
  });
}

// Single-series line with area, for award dollars over months.
export function line(host, data, { valueFmt = fmt, valueLabel = "" } = {}) {
  host.innerHTML = "";
  if (data.length < 2) { host.innerHTML = '<div class="empty small">Not enough history yet.</div>'; return; }
  const w = host.clientWidth || 420, h = 190, padL = 44, padB = 26, padT = 12;
  const plotW = w - padL - 10, plotH = h - padB - padT;
  const top = Math.max(...data.map((d) => d.value)) || 1;
  const X = (i) => padL + (i / (data.length - 1)) * plotW;
  const Y = (v) => padT + plotH - (v / top) * plotH;
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, height: h, role: "img" }, host);
  for (let i = 0; i <= 3; i++) {
    const v = (top / 3) * i, y = Y(v);
    el("line", { x1: padL, x2: w - 10, y1: y, y2: y, class: i === 0 ? "axisline" : "gridline" }, svg);
    el("text", { x: padL - 7, y: y + 4, "text-anchor": "end", class: "tick" }, svg).textContent = valueFmt(v);
  }
  const pts = data.map((d, i) => `${X(i)},${Y(d.value)}`).join(" ");
  el("polygon", { points: `${padL},${Y(0)} ${pts} ${X(data.length - 1)},${Y(0)}`, fill: "var(--series-1)", opacity: .1 }, svg);
  el("polyline", { points: pts, fill: "none", stroke: "var(--series-1)", "stroke-width": 2, "stroke-linejoin": "round" }, svg);
  const last = data.length - 1;
  el("circle", { cx: X(last), cy: Y(data[last].value), r: 4.5, fill: "var(--series-1)", stroke: "var(--surface-1)", "stroke-width": 2 }, svg);
  el("text", { x: X(last) - 6, y: Y(data[last].value) - 11, "text-anchor": "end", class: "bvalue" }, svg).textContent = valueFmt(data[last].value);
  data.forEach((d, i) => {
    if (i % Math.ceil(data.length / 6) === 0)
      el("text", { x: X(i), y: h - 8, "text-anchor": "middle", class: "tick" }, svg).textContent = d.short ?? d.label;
    const hit = el("rect", { x: X(i) - plotW / (data.length * 2), y: padT, width: plotW / data.length, height: plotH, fill: "transparent" }, svg);
    hookTip(hit, d.full ?? d.label, [`${valueFmt(d.value)} ${valueLabel}`.trim(), ...(d.note ? [d.note] : [])]);
  });
}

// Five shades of --heat (orange, matching the logo) for heatmaps. Quantile breaks, not linear: one state
// (Maryland, Virginia) would otherwise turn every other state the palest shade.
const HEAT_MIX = [16, 34, 52, 72, 94];
// WHY 2: heatFill(0) is the light base for a county that has open contracts
// and none in the trade. A trade match starts at this step so it stays darker.
const MATCH_FLOOR_BIN = 2;
const heatFill = (bin) => bin < 0 ? "var(--grid)" : `color-mix(in srgb, var(--heat) ${HEAT_MIX[bin]}%, var(--surface-1))`;
export function quantileBins(values, n = HEAT_MIX.length) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return () => -1;
  const breaks = Array.from({ length: n - 1 }, (_, i) => sorted[Math.floor(((i + 1) / n) * sorted.length)]);
  return (v) => v > 0 ? breaks.filter((b) => v >= b).length : -1;
}
function heatLegend(host, lo, hi, label) {
  const d = document.createElement("div");
  d.className = "heat-legend";
  d.innerHTML = `<span>${label}: ${fmt(lo)}</span>${HEAT_MIX.map((_, i) => `<i style="background:${heatFill(i)}"></i>`).join("")}<span>${fmt(hi)}</span>`;
  host.appendChild(d);
}
// Two shades, each named for what it counts. The ramp on the right is still
// --heat via heatFill: more matches step from MATCH_FLOOR_BIN toward the darkest.
function layerLegend(host) {
  const d = document.createElement("div");
  d.className = "heat-legend";
  d.innerHTML = `<i style="background:${heatFill(0)}"></i><span>All open contracts</span><i style="background:${heatFill(MATCH_FLOOR_BIN)}"></i><i style="background:${heatFill(HEAT_MIX.length - 1)}"></i><span>Match your trade</span>`;
  host.appendChild(d);
}
function opportunityTip(openN, matched) {
  const matchLabel = matched === 1 ? "1 matches your trade" : `${matched.toLocaleString()} match your trade`;
  return `${openN.toLocaleString()} open, ${matchLabel}`;
}

// Choropleth on real outlines (geo.js). `shapes` maps a key to { d, c }: an SVG
// path and a label point in a `view` = [width, height] coordinate space.
// The selected area is outlined and called out with its count, so the one county
// or state the viewer cares about reads at a glance even when it is small.
export function shapeMap(host, counts, shapes, view, { selected = "", names = {}, notes = {}, valueLabel = "open notices", onClick = null, ariaLabel = "Map", water = [], coast = "", calloutAbove = true, base = null } = {}) {
  host.innerHTML = "";
  const [W, H] = view;
  const useLayers = base != null;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": ariaLabel, class: "shape-map" }, host);
  // WHY scale type with the view: the US map is drawn 60% wider than Florida, so fixed
  // sizes would shrink its labels to unreadable when both render at the same width.
  svg.style.setProperty("--map-type", `${W / 35}px`);
  for (const [x, y, text, anchor = "middle"] of water) el("text", { x, y, "text-anchor": anchor, class: "map-water" }, svg).textContent = text;
  const bin = quantileBins(Object.keys(shapes).map((k) => counts[k] || 0));
  const land = el("g", {}, svg);
  for (const [key, { d }] of Object.entries(shapes)) {
    const matched = counts[key] || 0;
    const openN = useLayers ? (base[key] || 0) : matched;
    const fill = !useLayers ? heatFill(bin(matched))
      : matched > 0 ? heatFill(Math.max(MATCH_FLOOR_BIN, bin(matched)))
      : openN > 0 ? heatFill(0)
      : heatFill(-1);
    const clickable = onClick && (useLayers ? openN > 0 || matched > 0 : matched);
    const path = el("path", { d, fill, class: "map-area" + (clickable ? " clickable" : "") }, land);
    const lines = useLayers
      ? [opportunityTip(openN, matched), ...(notes[key] ? [notes[key]] : [])]
      : [`${matched.toLocaleString()} ${valueLabel}`, ...(notes[key] ? [notes[key]] : [])];
    hookTip(path, names[key] || key, lines);
    if (clickable) path.addEventListener("click", () => onClick(key));
  }
  if (coast) el("path", { d: coast, class: "map-coast", fill: "none" }, svg);
  const sel = shapes[selected];
  if (sel) {
    // WHY drawn last: an outline under its neighbours would be half hidden.
    el("path", { d: sel.d, class: "map-sel", fill: "none" }, svg);
    const [cx, cy] = sel.c, shown = useLayers ? (base[selected] || 0) : (counts[selected] || 0);
    // WHY 0.72 / 0.28: past those points a centered label would run off the map edge.
    const anchor = cx > W * 0.72 ? "end" : cx < W * 0.28 ? "start" : "middle";
    const ty = calloutAbove ? Math.max(30, cy - 64) : Math.min(H - 8, cy + 64);
    el("line", { x1: cx, y1: cy, x2: cx, y2: ty + (calloutAbove ? 8 : -24), class: "map-leader" }, svg);
    el("circle", { cx, cy, r: 3.5, class: "map-pin" }, svg);
    const t = el("text", { x: cx, y: ty, "text-anchor": anchor, class: "map-callout" }, svg);
    el("tspan", { class: "map-callout-n" }, t).textContent = shown.toLocaleString();
    el("tspan", { dx: 6 }, t).textContent = (names[selected] || selected).replace(/ County$/, "");
  }
  if (useLayers) layerLegend(host);
  else {
    const vals = Object.keys(shapes).map((k) => counts[k] || 0).filter((v) => v > 0);
    if (vals.length) heatLegend(host, Math.min(...vals), Math.max(...vals), "Fewer");
  }
}

const countyNames = Object.fromEntries(Object.keys(FL_SHAPES).map((k) => [k, `${k} County`]));
// Water labels in Florida map coordinates, placed in open sea beside the coast.
const FL_WATER = [[150, 300, "Gulf of Mexico"], [596, 288, "Atlantic", "end"], [596, 306, "Ocean", "end"], [330, 548, "Florida Keys"]];
export const floridaMap = (host, counts, opts = {}) =>
  shapeMap(host, counts, FL_SHAPES, FL_VIEW, { names: countyNames, coast: FL_COAST, water: FL_WATER, ariaLabel: "Florida counties", ...opts });
export const stateMap = (host, counts, opts = {}) =>
  shapeMap(host, counts, US_SHAPES, US_VIEW, { ariaLabel: "Open notices by state", calloutAbove: false, ...opts });

// Calendar heatmap: one square per day, weeks as columns, so crowded deadline days
// stand out the way they would on a wall calendar.
export function calendarHeat(host, byDay, { start, weeks = 13, today = "", valueLabel = "deadlines" } = {}) {
  host.innerHTML = "";
  const first = new Date(start + "T12:00:00");
  first.setDate(first.getDate() - first.getDay());
  const padL = 26, padT = 18, gap = 3;
  const w = host.clientWidth || 420;
  const s = Math.max(9, Math.min(30, (w - padL - gap * weeks) / weeks));
  const svg = el("svg", { viewBox: `0 0 ${padL + weeks * (s + gap)} ${padT + 7 * (s + gap)}`, role: "img", "aria-label": "Deadlines per day" }, host);
  svg.style.maxWidth = `${padL + weeks * (s + gap)}px`;
  ["Sun", "", "Tue", "", "Thu", "", "Sat"].forEach((d, i) => d && (el("text", { x: 0, y: padT + i * (s + gap) + s * 0.75, class: "tick" }, svg).textContent = d));
  const days = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(first); d.setDate(first.getDate() + i);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  const bin = quantileBins(days.map((k) => byDay[k] || 0));
  let lastMonth = "";
  days.forEach((k, i) => {
    const c = Math.floor(i / 7), r = i % 7, x = padL + c * (s + gap), y = padT + r * (s + gap);
    if (r === 0 && k.slice(0, 7) !== lastMonth) {
      lastMonth = k.slice(0, 7);
      el("text", { x, y: 11, class: "tick" }, svg).textContent = new Date(k + "T12:00:00").toLocaleDateString("en-US", { month: "short" });
    }
    const v = byDay[k] || 0, past = today && k < today;
    const rect = el("rect", { x, y, width: s, height: s, rx: 3, fill: past ? "transparent" : heatFill(bin(v)), class: k === today ? "today" : "" }, svg);
    if (!past) hookTip(rect, new Date(k + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }), [`${v.toLocaleString()} ${valueLabel}`]);
  });
  const vals = days.filter((k) => !today || k >= today).map((k) => byDay[k] || 0).filter(Boolean);
  if (vals.length) heatLegend(host, Math.min(...vals), Math.max(...vals), "Quiet");
}

export function card(title, sub) {
  const d = document.createElement("div");
  d.className = "card";
  d.innerHTML = `<p class="chart-title">${title}</p><p class="chart-sub">${sub}</p><div class="plot"></div>`;
  return d;
}
