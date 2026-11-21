import type { CutList } from '../model/cutlist';
import { Len } from './inputs';
import { speciesById } from '../model/species';
import type { Design, Species } from '../model/types';
import { cubicMetres, sensible, showBoardFeet, showLength, showSize, showText, type Units } from '../model/units';

interface Props {
  design: Design;
  cutList: CutList;
  species: Species[];
  /** Present on screen, where the allowance can be edited; absent on the print sheet. */
  onChange?: (d: Design) => void;
  /** False leaves out the written order of operations, for a sheet that shows it with pictures instead. */
  steps?: boolean;
  /** Which units every length is written in. */
  units: Units;
  /** Present on screen, where the units can be chosen; absent on the print sheet, which follows the choice. */
  onUnits?: (u: Units) => void;
}

/**
 * Finished size against the target, the stock to mill, and (unless `steps` is false) the numbered
 * order of operations, in inches, millimetres or both. Used on screen and in the print sheet.
 */
export function CutListPanel({ design, cutList, species, onChange, steps = true, units, onUnits }: Props) {
  const u = sensible(units);
  /** A length in the chosen units. */
  const len = (v: number) => showLength(v, u);
  /** Turn one unit on or off; turning the last one off turns the other on, so there is always one. */
  const toggle = (which: keyof Units) => {
    const next = { ...u, [which]: !u[which] };
    onUnits?.(next.imperial || next.metric ? next : { imperial: !u.imperial, metric: !u.metric });
  };
  const [fx, fy, fz] = cutList.finished;
  const long = Math.max(fx, fz), short = Math.min(fx, fz);
  const tLong = Math.max(design.target.length, design.target.width), tShort = Math.min(design.target.length, design.target.width);
  /** How far a finished dimension is from its target, in words. */
  const delta = (a: number, b: number) => {
    const d = a - b;
    return Math.abs(d) < 1 / 128 ? 'on target' : `${len(Math.abs(d))} ${d > 0 ? 'over' : 'under'}`;
  };
  return (
    <div className="cutlist">
      {onUnits && (
        <div className="units" role="group" aria-label="Units">
          <span>Units</span>
          <label className="check"><input type="checkbox" checked={u.imperial} onChange={() => toggle('imperial')} />Imperial (inches)</label>
          <label className="check"><input type="checkbox" checked={u.metric} onChange={() => toggle('metric')} />Metric (mm)</label>
        </div>
      )}
      <h3>Finished board</h3>
      <table>
        <tbody>
          <tr><th>Length</th><td>{len(long)}</td><td className="dim">{delta(long, tLong)}</td></tr>
          <tr><th>Width</th><td>{len(short)}</td><td className="dim">{delta(short, tShort)}</td></tr>
          <tr><th>Thickness</th><td>{len(fy)}</td><td className="dim">{delta(fy, design.target.thickness)}</td></tr>
        </tbody>
      </table>

      <h3>Stock to mill</h3>
      <table>
        <thead>
          <tr><th>Wood</th><th>Qty</th><th>Rough cut</th><th>Mill to</th><th>For</th></tr>
        </thead>
        <tbody>
          {cutList.lines.map((l, i) => (
            <tr key={i}>
              <td><b className="swatch" style={{ background: speciesById(species, l.species).color }} />{speciesById(species, l.species).name}</td>
              <td>{l.count}</td>
              <td>
                {showSize([l.rough.thickness, l.rough.width, l.rough.length], u)}
                {l.ripped && <span className="dim"> (rip thin)</span>}
              </td>
              <td>{showSize([l.thickness, l.width, l.length], u)}</td>
              <td className="dim">{l.use}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {onChange && (
        <div className="row" title="Entered in inches, like every size in the design.">
          <Len label="Rough extra: thickness" value={cutList.allowance.thickness} onChange={(thickness) => onChange({ ...design, allowance: { ...cutList.allowance, thickness } })} />
          <Len label="Width" value={cutList.allowance.width} onChange={(width) => onChange({ ...design, allowance: { ...cutList.allowance, width } })} />
          <Len label="Length" value={cutList.allowance.length} onChange={(length) => onChange({ ...design, allowance: { ...cutList.allowance, length } })} />
        </div>
      )}
      <p className="note">
        Every size is thickness × width × length, thinnest dimension first. "Mill to" is the size each strip must be when it goes into the glue-up. "Rough cut" adds{' '}
        {len(cutList.allowance.thickness)} of thickness, {len(cutList.allowance.width)} of width and{' '}
        {len(cutList.allowance.length)} of length for jointing, planing and snipe.
        Strips marked "rip thin" are too thin to joint or plane: mill a wider board to the other dimension, then
        rip them off it at their finished thickness, so they get no extra there.
        Flattening and trimming after each glue-up are steps in the recipe, so the "Mill to" sizes already
        allow for them; sanding comes out of the last flattening.
        Rough stock totals {showBoardFeet(cutList.totalBf, u)}
        ({cutList.boardFeet.map((b) => `${speciesById(species, b.species).name} ${u.imperial ? b.bf.toFixed(2) : cubicMetres(b.bf)}`).join(', ')}).
        {' '}{Math.round(cutList.yield * 100)}% of that ends up in the board.
      </p>

      {steps && <h3>Order of operations</h3>}
      {steps && (
      <ol>
        {cutList.operations.map((o, i) => (
          <li key={i}>
            <strong>{o.title}.</strong> {showText(o.text, u)}
            {o.warning && <span className="warning"> Check: {showText(o.warning, u)}</span>}
          </li>
        ))}
      </ol>
      )}
    </div>
  );
}
