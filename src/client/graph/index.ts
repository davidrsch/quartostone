/**
 * Page-link graph visualization.
 * Renders all pages as nodes and wiki-link edges as directed arrows
 * on a <canvas> element using a simple force-directed layout.
 */

import { API } from '../api/endpoints.js';

interface GraphNode {
  id:       string;
  title:    string;
  tags:     string[];
  inDegree: number;
  // Simulation state
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  from: string;
  to:   string;
}

interface GraphData {
  nodes: Array<{ id: string; title: string; tags: string[]; inDegree: number }>;
  edges: GraphEdge[];
}

export type OpenPageFn = (path: string, title: string) => void;

const RADIUS_BASE  = 6;
const RADIUS_SCALE = 2.5;
const REPEL_FORCE  = 8000;
const SPRING_LEN   = 120;
const SPRING_K     = 0.04;
const DAMPING      = 0.82;
const TICK_DT      = 0.016;

export function initGraphPanel(
  panelEl:    HTMLElement,
  onOpenPage: OpenPageFn,
): { open(): void; close(): void; refresh(): void } {
  let visible = false;
  let nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];
  let animId = 0;
  let hoveredNode: GraphNode | null = null;
  let filterQuery = '';

  /* ── DOM setup ────────────────────────────────────────────────────────── */

  panelEl.innerHTML = `
    <div id="graph-toolbar">
      <input id="graph-filter" type="text" placeholder="Filter by tag or directory…" />
      <button id="graph-close-btn" title="Close graph">✕</button>
    </div>
    <canvas id="graph-canvas"></canvas>
    <div id="graph-tooltip" class="hidden"></div>
  `;

  const canvas     = panelEl.querySelector<HTMLCanvasElement>('#graph-canvas')!;
  const ctx2d      = canvas.getContext('2d')!;
  const tooltip    = panelEl.querySelector<HTMLElement>('#graph-tooltip')!;
  const filterInput = panelEl.querySelector<HTMLInputElement>('#graph-filter')!;
  const closeBtn   = panelEl.querySelector<HTMLButtonElement>('#graph-close-btn')!;

  // FIX GRAPH-01: ARIA role + keyboard accessibility for canvas
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Page link graph — use the filter input above to find and highlight pages');
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
    }
  });

  closeBtn.addEventListener('click', () => close());

  filterInput.addEventListener('input', () => {
    filterQuery = filterInput.value.toLowerCase().trim();
    draw();
  });

  /* ── Layout helpers ───────────────────────────────────────────────────── */

  function radius(n: GraphNode): number {
    return RADIUS_BASE + n.inDegree * RADIUS_SCALE;
  }

  function isVisible(n: GraphNode): boolean {
    if (!filterQuery) return true;
    return n.id.toLowerCase().includes(filterQuery) ||
           n.title.toLowerCase().includes(filterQuery) ||
           n.tags.some(t => t.toLowerCase().includes(filterQuery));
  }

  function initPositions(): void {
    const cw = canvas.width;
    const ch = canvas.height;
    nodes.forEach((n, i) => {
      // Try to restore saved position from localStorage
      const saved = localStorage.getItem(`qs-graph-${n.id}`);
      if (saved) {
        try {
          const { x, y } = JSON.parse(saved) as { x: number; y: number };
          n.x = x; n.y = y;
        } catch {
          n.x = cw / 2 + (Math.random() - 0.5) * cw * 0.6;
          n.y = ch / 2 + (Math.random() - 0.5) * ch * 0.6;
        }
      } else {
        // Distribute evenly in a circle initially
        const angle = (i / nodes.length) * 2 * Math.PI;
        const r = Math.min(cw, ch) * 0.35;
        n.x = cw / 2 + Math.cos(angle) * r;
        n.y = ch / 2 + Math.sin(angle) * r;
      }
      n.vx = 0; n.vy = 0;
    });
  }

  function savePositions(): void {
    for (const n of nodes) {
      localStorage.setItem(`qs-graph-${n.id}`, JSON.stringify({ x: n.x, y: n.y }));
    }
  }

  /* ── Force simulation ─────────────────────────────────────────────────── */

  const nodeMap = new Map<string, GraphNode>();

  function tick(): void {
    const cw = canvas.width;
    const ch = canvas.height;

    // Repulsion between all node pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!; const b = nodes[j]!;
        if (!isVisible(a) || !isVisible(b)) continue;
        const dx = b.x - a.x; const dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy || 1;
        const dist  = Math.sqrt(dist2);
        const force = REPEL_FORCE / dist2;
        const fx = (dx / dist) * force * TICK_DT;
        const fy = (dy / dist) * force * TICK_DT;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // Spring attraction along edges
    for (const edge of edges) {
      const a = nodeMap.get(edge.from); const b = nodeMap.get(edge.to);
      if (!a || !b || !isVisible(a) || !isVisible(b)) continue;
      const dx = b.x - a.x; const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const stretch = dist - SPRING_LEN;
      const fx = (dx / dist) * SPRING_K * stretch * TICK_DT;
      const fy = (dy / dist) * SPRING_K * stretch * TICK_DT;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // Centre-gravity: gentle pull toward canvas centre
    const cx = cw / 2; const cy = ch / 2;
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.0005;
      n.vy += (cy - n.y) * 0.0005;
    }

    // Integrate + damp
    for (const n of nodes) {
      n.vx *= DAMPING; n.vy *= DAMPING;
      n.x  += n.vx;    n.y  += n.vy;
      // Clamp to canvas bounds
      const r = radius(n);
      n.x = Math.max(r, Math.min(cw - r, n.x));
      n.y = Math.max(r, Math.min(ch - r, n.y));
    }
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */

  const ACCENT   = '#7c6af7';
  const ORPHAN   = '#f97171';
  const EDGE_CLR = '#4a556880';

  function draw(): void {
    const cw = canvas.width; const ch = canvas.height;
    ctx2d.clearRect(0, 0, cw, ch);

    // Draw edges
    for (const edge of edges) {
      const a = nodeMap.get(edge.from); const b = nodeMap.get(edge.to);
      if (!a || !b || !isVisible(a) || !isVisible(b)) continue;

      const dx = b.x - a.x; const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const rb = radius(b);
      const ex = b.x - (dx / dist) * rb;
      const ey = b.y - (dy / dist) * rb;

      ctx2d.beginPath();
      ctx2d.moveTo(a.x, a.y);
      ctx2d.lineTo(ex, ey);
      ctx2d.strokeStyle = EDGE_CLR;
      ctx2d.lineWidth = 1;
      ctx2d.stroke();

      // Arrowhead
      const angle = Math.atan2(dy, dx);
      const al = 8;
      ctx2d.beginPath();
      ctx2d.moveTo(ex, ey);
      ctx2d.lineTo(ex - al * Math.cos(angle - 0.4), ey - al * Math.sin(angle - 0.4));
      ctx2d.lineTo(ex - al * Math.cos(angle + 0.4), ey - al * Math.sin(angle + 0.4));
      ctx2d.closePath();
      ctx2d.fillStyle = EDGE_CLR;
      ctx2d.fill();
    }

    // Draw nodes
    for (const n of nodes) {
      if (!isVisible(n)) continue;
      const r = radius(n);
      const isOrphan = n.inDegree === 0 && !edges.some(e => e.from === n.id);
      const isHovered = hoveredNode === n;
      const color = isHovered ? '#a78bfa' : isOrphan ? ORPHAN : ACCENT;

      ctx2d.beginPath();
      ctx2d.arc(n.x, n.y, r, 0, 2 * Math.PI);
      ctx2d.fillStyle = color;
      ctx2d.fill();
      if (isHovered) {
        ctx2d.strokeStyle = '#fff';
        ctx2d.lineWidth = 2;
        ctx2d.stroke();
      }

      // Label for larger nodes or hovered
      if (r > 8 || isHovered) {
        ctx2d.font = '11px system-ui, sans-serif';
        ctx2d.fillStyle = '#e2e8f0';
        ctx2d.textAlign = 'center';
        ctx2d.fillText(n.title.slice(0, 24), n.x, n.y + r + 12);
      }
    }
  }

  /* ── Animation loop ───────────────────────────────────────────────────── */

  let settled = false;
  let tickCount = 0;

  function loop(): void {
    if (!visible) return;
    if (!settled) {
      tick();
      tickCount++;
      if (tickCount > 300) { settled = true; savePositions(); }
    }
    draw();
    animId = requestAnimationFrame(loop);
  }

  /* ── Mouse interaction ────────────────────────────────────────────────── */

  let dragging: GraphNode | null = null;
  let dragOffX = 0; let dragOffY = 0;

  function hitTest(mx: number, my: number): GraphNode | null {
    for (const n of nodes) {
      if (!isVisible(n)) continue;
      const dx = mx - n.x; const dy = my - n.y;
      if (dx * dx + dy * dy <= Math.pow(radius(n) + 4, 2)) return n;
    }
    return null;
  }

  canvas.addEventListener('mousedown', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
    const hit = hitTest(mx, my);
    if (hit) { dragging = hit; dragOffX = mx - hit.x; dragOffY = my - hit.y; }
  });

  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
    if (dragging) {
      dragging.x = mx - dragOffX;
      dragging.y = my - dragOffY;
      dragging.vx = 0; dragging.vy = 0;
      settled = false; tickCount = 0;
    } else {
      const hit = hitTest(mx, my);
      hoveredNode = hit;
      canvas.style.cursor = hit ? 'pointer' : 'default';
      if (hit) {
        tooltip.textContent = `${hit.title} (${hit.inDegree} backlinks)`;
        tooltip.style.left = (mx + 12) + 'px';
        tooltip.style.top  = (my - 4)  + 'px';
        tooltip.classList.remove('hidden');
      } else {
        tooltip.classList.add('hidden');
      }
    }
  });

  canvas.addEventListener('mouseup', () => {
    if (dragging) { savePositions(); dragging = null; }
  });

  canvas.addEventListener('click', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
    const hit = hitTest(mx, my);
    if (hit) onOpenPage(hit.id, hit.title);
  });

  /* ── Resize observer ──────────────────────────────────────────────────── */

  const ro = new ResizeObserver(() => {
    canvas.width  = panelEl.clientWidth;
    canvas.height = panelEl.clientHeight - 44; // subtract toolbar
    draw();
  });

  /* ── Load graph data ──────────────────────────────────────────────────── */

  async function loadData(): Promise<void> {
    try {
      const res = await fetch(API.linksGraph);
      if (!res.ok) return;
      const data = await res.json() as GraphData;

      nodes = data.nodes.map(n => ({ ...n, x: 0, y: 0, vx: 0, vy: 0 }));
      edges = data.edges;
      nodeMap.clear();
      for (const n of nodes) nodeMap.set(n.id, n);

      canvas.width  = panelEl.clientWidth;
      canvas.height = panelEl.clientHeight - 44;
      initPositions();
      settled = false;
      tickCount = 0;
    } catch { /* ignore, keep previous state */ }
  }

  /* ── Public API ───────────────────────────────────────────────────────── */

  async function open(): Promise<void> {
    visible = true;
    panelEl.classList.remove('hidden');
    ro.observe(panelEl);
    await loadData();
    cancelAnimationFrame(animId);
    loop();
  }

  function close(): void {
    visible = false;
    panelEl.classList.add('hidden');
    ro.disconnect();
    cancelAnimationFrame(animId);
    tooltip.classList.add('hidden');
  }

  return {
    open,
    close,
    async refresh(): Promise<void> {
      if (visible) await loadData();
    },
  };
}
