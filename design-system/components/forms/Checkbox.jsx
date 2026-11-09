import React from 'react';
import { cx, accentClass } from '../primitives/cx';
import { Icon } from '../primitives/Icon';
export function Checkbox({ label, accent, className, ...rest }) {
  return (
    <label className={cx('ds-check', accentClass(accent), className)}>
      <input type="checkbox" {...rest} />
      <span className="ds-check__box"><Icon name="check" size={16} /></span>
      <span>{label}</span>
    </label>
  );
}
