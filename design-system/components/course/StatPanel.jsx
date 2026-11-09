import React from 'react';
import { cx, accentClass } from '../primitives/cx';
import { ProgressBar } from '../feedback/ProgressBar';
export function StatPanel({ label, value, delta, trend = 'up', progress, accent, className }) {
  return (
    <div className={cx('ds-stat', accentClass(accent), className)}>
      <span className="ds-stat__label">{label}</span>
      <span className="ds-stat__value">{value}</span>
      {delta && <span className={cx('ds-stat__delta', 'ds-stat__delta--' + trend)}>{(trend === 'up' ? '▲ ' : '▼ ') + delta}</span>}
      {progress != null && <ProgressBar value={progress} accent={accent} label=" " />}
    </div>
  );
}
