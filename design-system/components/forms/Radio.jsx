import React from 'react';
import { cx, accentClass } from '../primitives/cx';
export function Radio({ label, accent, className, ...rest }) {
  return (
    <label className={cx('ds-radio', accentClass(accent), className)}>
      <input type="radio" {...rest} />
      <span className="ds-radio__dot" />
      <span>{label}</span>
    </label>
  );
}
