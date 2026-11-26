import { useEffect } from 'react';
import { APP_VERSION } from '../model/version';

interface Props {
  onClose: () => void;
}

/**
 * The About box: what the app is, its version, who designed it, and how it was built. It says
 * plainly that the code was written by an AI model, which is what anyone using or reading it is
 * entitled to know. Closes on Escape, on its ✕, or on a click outside it.
 */
export function About({ onClose }: Props) {
  useEffect(() => {
    /** Close on Escape. */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal about" role="dialog" aria-label="About Cutting Boards" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Cutting Boards</h2>
          <button onClick={onClose} title="Close (Esc)">✕</button>
        </header>
        <p className="version">Version {APP_VERSION}</p>
        <p><strong>Designed by Joe Long.</strong></p>
        <p>
          Joe designed and architected the app, and set and enforced its standards. Claude, an AI model made by Anthropic,
          wrote the code, the tests and the documentation to them, using Claude Code.
        </p>
        <p className="note">
          The sizes and steps are worked out by software. Check every measurement against your own stock and tools before you cut.
        </p>
        <footer><button className="primary" onClick={onClose}>Close</button></footer>
      </div>
    </div>
  );
}
