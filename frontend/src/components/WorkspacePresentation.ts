import type { ReactNode } from 'react';

/** Concrete locations in the shared frame; each feature owns the behavior behind them. */
export type WorkspacePresentation = {
  eyebrow: ReactNode;
  headerActions: ReactNode;
  historyAction?: ReactNode;
  summary: ReactNode;
  rail: ReactNode;
  options: ReactNode;
  inspector: ReactNode;
};
