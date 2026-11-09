import React from 'react';
import { cx } from '../primitives/cx';
import { Icon } from '../primitives/Icon';
export function Field({ label, hint, error, className, children }) {
  return (
    <label className={cx('ds-field', className)}>
      <span className="ds-field__label">{label}</span>
      {children}
      {hint && !error && <span className="ds-field__hint">{hint}</span>}
      {error && <span className="ds-field__error"><Icon name="circle-alert" size={16} />{error}</span>}
    </label>
  );
}
