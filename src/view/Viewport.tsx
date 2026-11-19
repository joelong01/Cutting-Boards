import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { inches } from '../model/fractions';
import { speciesById } from '../model/species';
import type { Species, Stage } from '../model/types';
import { BoardScene, type HoverInfo, type ViewName } from './scene';

export interface ViewportHandle {
  snapshot: (stage: Stage, size?: [number, number]) => string;
  capture: () => string;
  view: (name: ViewName) => void;
}

interface Props {
  stage: Stage;
  /** Set when the stage was reached by stepping forward, so the step can be animated. */
  from: Stage | null;
  species: Species[];
  gap: number;
  lines: boolean;
  highlights: number[];
  /** Tag the four sides of the panel with the names the Trim step uses. */
  edgeLabels: boolean;
  onPick: (slice: number) => void;
}

/** The 3D view as a React component: owns one BoardScene, pushes props into it, and shows the hover tooltip. */
export const Viewport = forwardRef<ViewportHandle, Props>(function Viewport(
  { stage, from, species, gap, lines, highlights, edgeLabels, onPick }, ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BoardScene | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let scene: BoardScene;
    try {
      scene = new BoardScene(canvasRef.current!);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      return;
    }
    scene.onHover = setHover;
    scene.onPick = (i) => pickRef.current(i);
    sceneRef.current = scene;
    // Handle for diagnostics from the developer console or `--eval`.
    (window as unknown as { boardScene?: BoardScene }).boardScene = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    snapshot: (s, size) => sceneRef.current?.snapshot(s, size) ?? '',
    capture: () => sceneRef.current?.capture() ?? '',
    view: (name) => sceneRef.current?.view(name),
  }), []);

  // Species first: materials are looked up while the stage is built.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setSpecies(species);
    scene.show(stage, from);
    // `from` is deliberately not a dependency: it only matters at the moment the stage changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, species]);
  useEffect(() => sceneRef.current?.setGap(gap), [gap]);
  useEffect(() => sceneRef.current?.setLines(lines), [lines]);
  useEffect(() => sceneRef.current?.setEdgeLabels(edgeLabels), [edgeLabels]);
  useEffect(() => sceneRef.current?.setHighlights(highlights), [highlights, stage]);

  return (
    <div className="viewport">
      <canvas ref={canvasRef} />
      {failed && <div className="gl-failed">The 3D view could not start: {failed}</div>}
      {hover && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{speciesById(species, hover.species).name}</strong>
          <span>{inches(hover.size[0])} × {inches(hover.size[2])} × {inches(hover.size[1])} tall</span>
          <span>{hover.endGrainUp ? 'End grain up' : 'Long grain up'}{hover.sliceCount ? ` · slice ${hover.slice + 1} of ${hover.sliceCount}` : ''}</span>
        </div>
      )}
    </div>
  );
});
