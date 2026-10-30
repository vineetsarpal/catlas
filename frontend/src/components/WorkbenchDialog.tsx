import * as Dialog from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';

type WorkbenchDialogProps = {
  title: string;
  eyebrow?: string;
  className?: string;
  focusContent?: boolean;
  onClose: () => void;
  children: ReactNode;
};

/** A controlled modal for workspaces whose opening controls live outside the dialog. */
export function WorkbenchDialog({ title, eyebrow, className, focusContent = false, onClose, children }: WorkbenchDialogProps) {
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const content = useRef<HTMLDivElement>(null);
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    {/* Keep the overlay in its workspace so existing scoped CSS continues to apply. */}
    <Dialog.Overlay className="atlas-modal-backdrop">
      <Dialog.Content ref={content} className={`atlas-modal${className ? ` ${className}` : ''}`} aria-modal="true" aria-describedby={undefined}
        onOpenAutoFocus={event => {
          if (focusContent) { event.preventDefault(); content.current?.focus(); }
        }}
        onEscapeKeyDown={event => event.stopPropagation()}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus();
        }}>
        <div className="atlas-panel-heading">
          <div>{eyebrow && <p className="exposure-eyebrow">{eyebrow}</p>}<Dialog.Title asChild><h2>{title}</h2></Dialog.Title></div>
          <Dialog.Close asChild><button type="button" aria-label="Close dialog">×</button></Dialog.Close>
        </div>
        <div className="atlas-modal-scroll">{children}</div>
      </Dialog.Content>
    </Dialog.Overlay>
  </Dialog.Root>;
}
