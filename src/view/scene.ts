import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { basisFor, bbox, boxCenter, boxSize, cross, dot, faceNormal, normalize, scale, sub } from '../model/geometry';
import type { Piece, Plane, Slice, Species, Stage, Vec3 } from '../model/types';
import { makeWoodTexture } from './textures';

export interface HoverInfo {
  species: string;
  size: Vec3;
  endGrainUp: boolean;
  slice: number;
  sliceCount: number;
  x: number;
  y: number;
}

export type ViewName = 'iso' | 'top' | 'front' | 'end';

interface SliceNode {
  group: THREE.Group;
  mesh: THREE.Mesh;
  lines: THREE.LineSegments;
  center: THREE.Vector3;
  motion: Slice['motion'];
  pieces: Piece[];
  triPiece: number[];
  outline?: THREE.Box3Helper;
}

interface Shown {
  kind: Stage['kind'];
  nodes: SliceNode[];
  /** Slices set aside while another panel is made, drawn beside the work, and how far over they sit. */
  aside: SliceNode[];
  asideZ: number;
  asideDepth: number;
  asideX: number;
  sizeX: number;
  sizeY: number;
  centerZ: number;
  sizeZ: number;
}

/** How far past the work the set-aside slices sit, and the gap drawn between them. */
const ASIDE_GAP = 2.5, ASIDE_SPREAD = 0.3;

const VIEW_DIRS: Record<ViewName, [number, number, number]> = {
  iso: [0.5, 0.72, 0.9],
  top: [0, 1, 0.0005],
  front: [0, 0.18, 1],
  end: [1, 0.18, 0],
};

/** Ease-in-out curve for animations: slow start, slow finish. */
/**
 * Whether the segment v-w should be drawn as a line on a finished piece: it lies along an edge of
 * the original block (both ends on two or more of its planes) or along a glue face (both ends on
 * a plane that is not a face of the whole board). Facet lines on the rounded corners and edges,
 * and seams between the parts of a block split round the groove, are neither, and drawing them
 * would look like cracks.
 */
function onBlockEdge(v: Vec3, w: Vec3, planes: Plane[]): boolean {
  let shared = 0;
  for (const { n, d, outer } of planes) {
    if (Math.abs(dot(n, v) - d) < 1e-6 && Math.abs(dot(n, w) - d) < 1e-6) {
      if (!outer) return true;
      shared++;
    }
  }
  return shared >= 2;
}

/**
 * A small dark tag with white text that always faces the camera and stays the same size on
 * screen however far away it is. It is drawn over the wood, never hidden behind it.
 */
function makeTag(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const g = canvas.getContext('2d')!;
  g.fillStyle = 'rgba(35, 28, 22, 0.9)';
  g.beginPath();
  g.roundRect(2, 2, 252, 68, 18);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = '600 40px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 38);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, sizeAttenuation: false, depthTest: false, transparent: true }));
  const h = 0.019;
  sprite.scale.set((h * canvas.width) / canvas.height, h, 1);
  sprite.renderOrder = 10;
  return sprite;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class BoardScene {
  onHover: (info: HoverInfo | null) => void = () => {};
  onPick: (slice: number) => void = () => {};

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 2000);
  private controls: OrbitControls;
  private root = new THREE.Group();
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private lineMaterial = new THREE.LineBasicMaterial({ color: 0x1a120c, transparent: true, opacity: 0.32 });
  private species = new Map<string, Species>();
  private shown: Shown | null = null;
  private gap = 0.5;
  private gapMul = 1;
  private motionT = 1;
  private showLines = true;
  private highlights: number[] = [];
  // Name tags for the four sides of a panel, in the words the Trim step uses for them.
  private tags = { edgeA: makeTag('Edge A'), edgeB: makeTag('Edge B'), endA: makeTag('End A'), endB: makeTag('End B') };
  private tagGroup = new THREE.Group();
  private tagsOn = false;
  private anim: { start: number; dur: number; tick: (e: number) => void; done?: () => void } | null = null;
  private autoFit = true;
  private raf = 0;
  private pointer: { x: number; y: number; dirty: boolean; inside: boolean } = { x: 0, y: 0, dirty: false, inside: false };
  private down: { x: number; y: number } | null = null;
  private raycaster = new THREE.Raycaster();
  private observer: ResizeObserver;
  private disposed = false;

  /** Set up the renderer, lights, camera, orbit controls and pointer handlers on a canvas, and start the render loop. */
  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.add(this.root);
    this.tagGroup.add(...Object.values(this.tags));
    this.tagGroup.visible = false;
    this.scene.add(this.tagGroup);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8a892, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(6, 14, 9);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xfff1dd, 0.9);
    fill.position.set(-9, 6, -7);
    this.scene.add(fill);

    this.camera.position.set(...VIEW_DIRS.iso).multiplyScalar(40);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('start', () => {
      this.autoFit = false;
    });

    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Stop rendering and release every GPU resource and event listener. */
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.clear();
    for (const t of Object.values(this.tags)) {
      t.material.map?.dispose();
      t.material.dispose();
    }
    this.controls.dispose();
    for (const m of this.materials.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.renderer.dispose();
  }

  /** Tell the scene which woods exist. Takes effect the next time a stage is built. */
  setSpecies(list: Species[]) {
    this.species = new Map(list.map((s) => [s.id, s]));
  }

  /** Set the space drawn between loose slices and refit the camera to the wider layout. */
  setGap(gap: number) {
    this.gap = gap;
    this.fit(false);
  }

  /** Show or hide the glue lines on every slice. */
  setLines(on: boolean) {
    this.showLines = on;
    for (const n of this.shown?.nodes ?? []) n.lines.visible = on;
  }

  /** Show or hide the "Edge A / Edge B / End A / End B" tags beside a glued panel. Loose slices never get them. */
  setEdgeLabels(on: boolean) {
    this.tagsOn = on;
  }

  /** Outline the given slices, to show which ones a step applies to. */
  setHighlights(indices: number[]) {
    this.highlights = indices;
    this.applyHighlights();
  }

  /** Swing the camera to a named direction at its current distance, then refit. */
  view(name: ViewName) {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const dir = new THREE.Vector3(...VIEW_DIRS[name]).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.autoFit = true;
    this.fit(true);
  }

  /** Show a stage. With `from`, animate the step that produced it. */
  show(stage: Stage, from: Stage | null) {
    this.anim = null;
    if (from && from.kind !== 'panel' && stage.kind === 'panel') {
      // Glue-up: close the gaps on the loose slices or strips, then swap in the glued panel.
      this.build(from);
      this.gapMul = 1;
      this.motionT = 1;
      this.startAnim(650, (e) => {
        this.gapMul = 1 - e;
      }, () => {
        this.build(stage);
        this.gapMul = 1;
        this.fit(false);
      });
      return;
    }
    this.build(stage);
    this.gapMul = 1;
    this.motionT = 1;
    if (from && from.kind === 'panel' && stage.kind === 'slices') {
      this.gapMul = 0;
      this.startAnim(650, (e) => {
        this.gapMul = e;
      });
    } else if (from && stage.kind === 'slices' && stage.slices.some((s) => s.motion)) {
      this.motionT = 0;
      this.startAnim(850, (e) => {
        this.motionT = e;
      });
    }
    this.fit(false);
  }

  /**
   * Render one stage to a PNG data URL without disturbing what is on screen. With `size`
   * (width, height in pixels) the picture is drawn that small, which is far quicker to encode
   * than a full-window one; the canvas is put back to its own size afterwards.
   */
  snapshot(stage: Stage, size?: [number, number]): string {
    const keep = {
      shown: this.shown, gapMul: this.gapMul, motionT: this.motionT, anim: this.anim,
      autoFit: this.autoFit, fitGoal: this.fitGoal, tagsOn: this.tagsOn,
    };
    // The pictures on the printed sheet carry no edge tags.
    this.tagsOn = false;
    const camPos = this.camera.position.clone(), target = this.controls.target.clone();
    for (const n of [...(keep.shown?.nodes ?? []), ...(keep.shown?.aside ?? [])]) this.root.remove(n.group);
    this.shown = null;
    this.anim = null;
    const ratio = this.renderer.getPixelRatio();
    if (size) {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(size[0], size[1], false);
      this.camera.aspect = size[0] / size[1];
      this.camera.updateProjectionMatrix();
    }
    this.build(stage, false);
    this.gapMul = 1;
    this.motionT = 1;
    this.fit(true, true);
    this.applyTransforms();
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    this.clear();
    if (size) {
      this.renderer.setPixelRatio(ratio);
      this.resize();
    }
    this.shown = keep.shown;
    if (this.shown) for (const n of [...this.shown.nodes, ...this.shown.aside]) this.root.add(n.group);
    this.gapMul = keep.gapMul;
    this.motionT = keep.motionT;
    this.anim = keep.anim;
    this.autoFit = keep.autoFit;
    this.fitGoal = keep.fitGoal;
    this.tagsOn = keep.tagsOn;
    this.camera.position.copy(camPos);
    this.controls.target.copy(target);
    this.camera.lookAt(target);
    return url;
  }

  /** PNG of exactly what is on screen now. */
  capture(): string {
    this.applyTransforms();
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  // ---- internals

  /** Start an animation, replacing any in progress. tick receives eased progress from 0 to 1. */
  private startAnim(dur: number, tick: (e: number) => void, done?: () => void) {
    this.anim = { start: performance.now(), dur, tick, done };
  }

  /** The shared material for one wood and grain kind, created on first use. */
  private material(speciesId: string, kind: 'long' | 'end'): THREE.MeshStandardMaterial {
    const color = this.species.get(speciesId)?.color ?? '#999999';
    const key = `${color}|${kind}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        map: makeWoodTexture(color, kind), vertexColors: true, roughness: 0.72, metalness: 0,
      });
      this.materials.set(key, m);
    }
    return m;
  }

  /** Remove the stage on screen and free its geometry. */
  private clear() {
    for (const n of [...(this.shown?.nodes ?? []), ...(this.shown?.aside ?? [])]) {
      this.root.remove(n.group);
      n.mesh.geometry.dispose();
      n.lines.geometry.dispose();
      n.outline?.geometry.dispose();
    }
    this.shown = null;
  }

  /** Create the meshes for a stage and make it the one on screen. With dispose false the previous stage is left for the caller to restore. */
  private build(stage: Stage, dispose = true) {
    if (dispose) this.clear();
    const all = bbox(stage.slices.flatMap((s) => s.pieces));
    const size = boxSize(all);
    const nodes = stage.slices.map((s) => this.buildSlice(s));
    for (const n of nodes) this.root.add(n.group);
    // Slices set aside sit past edge B of the work, clear of it, in the order they were cut.
    const aside = (stage.aside ?? []).map((s) => this.buildSlice(s));
    for (const n of aside) this.root.add(n.group);
    const parked = aside.length ? bbox(stage.aside!.flatMap((s) => s.pieces)) : null;
    this.shown = {
      kind: stage.kind, nodes, sizeX: size[0], sizeY: size[1], sizeZ: size[2],
      centerZ: (all.min[2] + all.max[2]) / 2,
      aside,
      asideZ: parked ? all.max[2] + ASIDE_GAP - parked.min[2] : 0,
      asideDepth: parked ? parked.max[2] - parked.min[2] + ASIDE_GAP : 0,
      asideX: parked ? parked.max[0] - parked.min[0] + (aside.length - 1) * ASIDE_SPREAD : 0,
    };
    this.applyHighlights();
  }

  /** Turn one slice into a mesh and its glue lines. Triangles are grouped by wood and grain kind, and triPiece maps each triangle back to its piece for hover. */
  private buildSlice(slice: Slice): SliceNode {
    const buckets = new Map<string, { mat: THREE.Material; pos: number[]; nor: number[]; uv: number[]; col: number[]; tri: number[] }>();
    const edges: number[] = [];
    slice.pieces.forEach((p, pi) => {
      const k = 0.88 + 0.2 * p.tone;
      const ou = (p.tone * 37.13) % 1, ov = (p.tone * 91.7) % 1;
      for (const f of p.faces) {
        const n = normalize(faceNormal(f));
        const end = Math.abs(dot(n, p.grain)) > 0.75;
        let a: Vec3, b: Vec3, su: number, sv: number;
        if (end) {
          [a, b] = basisFor(n);
          su = sv = 1 / 1.5;
        } else {
          a = normalize(sub(p.grain, scale(n, dot(n, p.grain))));
          b = cross(n, a);
          su = 1 / 6;
          sv = 1 / 1.5;
        }
        const key = `${p.species}|${end ? 'end' : 'long'}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { mat: this.material(p.species, end ? 'end' : 'long'), pos: [], nor: [], uv: [], col: [], tri: [] };
          buckets.set(key, bucket);
        }
        for (let i = 1; i < f.length - 1; i++) {
          for (const v of [f[0], f[i], f[i + 1]]) {
            bucket.pos.push(v[0], v[1], v[2]);
            bucket.nor.push(n[0], n[1], n[2]);
            bucket.uv.push(dot(v, a) * su + ou, dot(v, b) * sv + ov);
            bucket.col.push(k, k, k);
          }
          bucket.tri.push(pi);
        }
        for (let i = 0; i < f.length; i++) {
          const v = f[i], w = f[(i + 1) % f.length];
          if (p.origin && !onBlockEdge(v, w, p.origin)) continue;
          edges.push(v[0], v[1], v[2], w[0], w[1], w[2]);
        }
      }
    });
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], triPiece: number[] = [];
    const mats: THREE.Material[] = [];
    const geo = new THREE.BufferGeometry();
    for (const b of buckets.values()) {
      geo.addGroup(pos.length / 3, b.pos.length / 3, mats.length);
      mats.push(b.mat);
      // Concatenate in a loop: spreading a large array into push() overflows the call stack.
      for (const x of b.pos) pos.push(x);
      for (const x of b.nor) nor.push(x);
      for (const x of b.uv) uv.push(x);
      for (const x of b.col) col.push(x);
      for (const x of b.tri) triPiece.push(x);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, mats);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
    const lines = new THREE.LineSegments(lineGeo, this.lineMaterial);
    lines.visible = this.showLines;
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.add(mesh, lines);
    const c = boxCenter(bbox(slice.pieces));
    return { group, mesh, lines, center: new THREE.Vector3(c[0], c[1], c[2]), motion: slice.motion, pieces: slice.pieces, triPiece };
  }

  /** Add or remove the outline box on each slice to match the highlight list. Panels are never outlined. */
  private applyHighlights() {
    if (!this.shown) return;
    this.shown.nodes.forEach((n, i) => {
      const want = this.shown!.kind === 'slices' && this.highlights.includes(i);
      if (want && !n.outline) {
        n.mesh.geometry.computeBoundingBox();
        n.outline = new THREE.Box3Helper(n.mesh.geometry.boundingBox!.clone().expandByScalar(0.03), 0x1f7ae0);
        n.group.add(n.outline);
      } else if (!want && n.outline) {
        n.group.remove(n.outline);
        n.outline.geometry.dispose();
        n.outline = undefined;
      }
    });
  }

  /** Overall length of what is on screen, including the gaps between loose slices. */
  private totalX(mul = this.gapMul): number {
    const s = this.shown;
    if (!s) return 0;
    return s.sizeX + (s.kind === 'slices' ? (s.nodes.length - 1) * this.gap * mul : 0);
  }

  /** How much wider than the wood itself loose strips are on screen: the gaps between them. Zero for anything else. */
  private spreadZ(mul = this.gapMul): number {
    const s = this.shown;
    return s && s.kind === 'strips' ? (s.nodes.length - 1) * this.gap * mul : 0;
  }

  /**
   * Position every slice for this frame: centred on the origin, spread by the gap, and part-way
   * through its move while a step is animating. Also puts the edge tags just outside the middle
   * of each side of a panel: edge A at the low-Z long edge, end A at the low-X end.
   */
  private applyTransforms() {
    const s = this.shown;
    this.tagGroup.visible = this.tagsOn && !!s && s.kind === 'panel';
    if (!s) return;
    if (this.tagGroup.visible) {
      const out = 0.8, y = s.sizeY;
      this.tags.edgeA.position.set(0, y, -s.sizeZ / 2 - out);
      this.tags.edgeB.position.set(0, y, s.sizeZ / 2 + out);
      this.tags.endA.position.set(-s.sizeX / 2 - out, y, 0);
      this.tags.endB.position.set(s.sizeX / 2 + out, y, 0);
    }
    // Slices lie apart along the board, strips across it; a panel has no gaps.
    const gap = s.kind === 'slices' ? this.gap * this.gapMul : 0;
    const gapZ = s.kind === 'strips' ? this.gap * this.gapMul : 0;
    this.root.position.set(-this.totalX() / 2, 0, -s.centerZ - this.spreadZ() / 2);
    const t = this.motionT;
    const m = new THREE.Matrix4(), r = new THREE.Matrix4(), back = new THREE.Matrix4();
    s.nodes.forEach((n, i) => {
      n.group.matrix.makeTranslation(i * gap, 0, i * gapZ);
      if (n.motion && t < 1) {
        // Play the move backwards from where the slice ended up: undo the unfinished part.
        const angle = (t - 1) * n.motion.angle;
        if (n.motion.axis === 'y') r.makeRotationY(angle);
        else if (n.motion.axis === 'z') r.makeRotationZ(angle);
        else r.identity();
        m.makeTranslation(n.center.x, n.center.y, n.center.z - (1 - t) * n.motion.shift);
        back.makeTranslation(-n.center.x, -n.center.y, -n.center.z);
        n.group.matrix.multiply(m).multiply(r).multiply(back);
      }
      n.group.matrixWorldNeedsUpdate = true;
    });
    // The slices set aside take no part in the step: they wait beside it, a little apart.
    s.aside.forEach((n, i) => {
      n.group.matrix.makeTranslation(i * ASIDE_SPREAD, 0, s.asideZ);
      n.group.matrixWorldNeedsUpdate = true;
    });
  }

  /** Aim the camera to frame the stage, keeping the viewing direction. Does nothing once the user has taken over the camera, unless forced. */
  private fit(force: boolean, instant = false) {
    const s = this.shown;
    if (!s) return;
    if (force) this.autoFit = true;
    if (!this.autoFit) return;
    // With slices set aside, frame the work and them together.
    const target = new THREE.Vector3(0, s.sizeY / 2, s.asideDepth / 2);
    const radius = 0.5 * Math.hypot(Math.max(this.totalX(1), s.asideX), s.sizeY, s.sizeZ + this.spreadZ(1) + s.asideDepth);
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.08;
    this.fitGoal = { target, dist };
    if (instant) this.stepFit(1);
  }

  private fitGoal: { target: THREE.Vector3; dist: number } | null = null;

  /** Move the camera a fraction k of the way to the framing goal; 1 jumps there. */
  private stepFit(k: number) {
    if (!this.fitGoal) return;
    const dir = this.camera.position.clone().sub(this.controls.target);
    const d = THREE.MathUtils.lerp(dir.length(), this.fitGoal.dist, k);
    this.controls.target.lerp(this.fitGoal.target, k);
    this.camera.position.copy(this.controls.target).addScaledVector(dir.normalize(), d);
    this.camera.lookAt(this.controls.target);
    if (k >= 1 || Math.abs(d - this.fitGoal.dist) < 0.01) this.fitGoal = null;
  }

  /** Match the drawing buffer and camera to the size of the canvas container. */
  private resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(50, el.clientWidth), h = Math.max(50, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fit(false);
  }

  /** One animation frame: advance the animation, ease the camera, position slices, draw, and report what is under the pointer. */
  private frame(now: number) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (now - a.start) / a.dur);
      a.tick(ease(t));
      if (t >= 1) {
        this.anim = null;
        a.done?.();
      }
    }
    if (this.autoFit) this.stepFit(0.18);
    this.applyTransforms();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.pointer.dirty) {
      this.pointer.dirty = false;
      const hit = this.pick(this.pointer.x, this.pointer.y);
      this.onHover(hit);
    }
  }

  /** The piece under a screen point, or null when the pointer is over empty space. */
  private pick(clientX: number, clientY: number): HoverInfo | null {
    const s = this.shown;
    if (!s || !this.pointer.inside) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(s.nodes.map((n) => n.mesh), false);
    if (!hits.length || hits[0].faceIndex == null) return null;
    const slice = s.nodes.findIndex((n) => n.mesh === hits[0].object);
    const node = s.nodes[slice];
    const piece = node.pieces[node.triPiece[hits[0].faceIndex]];
    if (!piece) return null;
    return {
      species: piece.species,
      size: boxSize(bbox([piece])),
      endGrainUp: Math.abs(piece.grain[1]) > 0.75,
      slice,
      sliceCount: s.kind === 'slices' ? s.nodes.length : 0,
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  /** Record where the pointer is; the hover lookup itself happens once per frame. */
  private onPointerMove = (e: PointerEvent) => {
    this.pointer = { x: e.clientX, y: e.clientY, dirty: true, inside: true };
  };

  /** Clear the hover tooltip when the pointer leaves the canvas. */
  private onPointerLeave = () => {
    this.pointer.inside = false;
    this.onHover(null);
  };

  /** Remember where a press started, to tell a click from an orbit drag. */
  private onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  /** Treat a press that barely moved as a click on a loose slice. */
  private onPointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    this.pointer.inside = true;
    const hit = this.pick(e.clientX, e.clientY);
    if (hit && hit.sliceCount) this.onPick(hit.slice);
  };
}
