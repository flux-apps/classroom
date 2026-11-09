import React from 'react';
import { cx, accentClass } from '../primitives/cx';
export function ProgressBar({ value, accent, label, className }) {
  return (
    <div className={cx('ds-progress', accentClass(accent), className)}>
      <div className="ds-progress__track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><div className="ds-progress__fill" style={{ width: value + '%' }} /></div>
      <span>{label || value + '%'}</span>
    </div>
  );
}
