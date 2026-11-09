import React from 'react';
import { cx, accentClass } from './cx';
import { Icon } from './Icon';
export function Tag({ onRemove, accent, className, children }) {
  return (
    <span className={cx('ds-tag', accent && 'ds-tag--accent', accentClass(accent), className)}>
      {children}
      {onRemove && <button type="button" aria-label="Quitar" className="ds-tag__x" onClick={onRemove}><Icon name="x" size={14} /></button>}
    </span>
  );
}
