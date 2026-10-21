import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Keep assessment state in its workbench while displaying details in the shared inspector. */
export function RecoveryInspector({ target, children, simple = false }: {
  target?: HTMLElement | null;
  children: ReactNode;
  simple?: boolean;
}) {
  return target
    ? createPortal(<div className={`catlas recovery-detail-content${simple ? ' simple-recovery' : ''}`}>{children}</div>, target)
    : children;
}

export type RecoveryView = 'assessment' | 'history';

export function RecoveryOptionsTabs({ view, onChange }: {
  view: RecoveryView;
  onChange: (view: RecoveryView) => void;
}) {
  return <nav className="recovery-options-tabs" aria-label="Recovery options">
    <button type="button" aria-pressed={view === 'assessment'} onClick={() => onChange('assessment')}>Assessment</button>
    <button type="button" aria-pressed={view === 'history'} onClick={() => onChange('history')}>History</button>
  </nav>;
}
