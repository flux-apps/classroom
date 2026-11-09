import React from 'react';
import { cx, accentClass } from '../primitives/cx';
export function Switch({ label, accent, className, ...rest }) {
  return (
    <label className={cx('ds-switch', accentClass(accent), className)}>
      <input type="checkbox" role="switch" {...rest} />
      <span className="ds-switch__track" />
      <span>{label}</span>
    </label>
  );
}
