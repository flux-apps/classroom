import React from 'react';
import { cx } from '../primitives/cx';
import { IconButton } from '../primitives/IconButton';
export function ZoomControl({ value, onZoomIn, onZoomOut, onFit, className }) {
  return (
    <div className={cx('ds-zoom', className)}>
      <IconButton size="board" icon="minus" label="Alejar / Zoom out" onClick={onZoomOut} />
      <button type="button" className="ds-zoom__value" aria-label="Zoom">{value}%</button>
      <IconButton size="board" icon="plus" label="Acercar / Zoom in" onClick={onZoomIn} />
      <IconButton size="board" icon="maximize" label="Ajustar / Fit" onClick={onFit} />
    </div>
  );
}
