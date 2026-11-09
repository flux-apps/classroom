import React from 'react';
import { IconButton } from '../primitives/IconButton';
export function Dialog({ title, onClose, actions, children }) {
  return (
    <div className="ds-scrim">
      <div className="ds-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="ds-dialog__head"><h2 className="ds-dialog__title">{title}</h2>{onClose && <IconButton icon="x" label="Cerrar" onClick={onClose} />}</div>
        <div className="ds-dialog__body">{children}</div>
        {actions && <div className="ds-dialog__foot">{actions}</div>}
      </div>
    </div>
  );
}
