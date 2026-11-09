import React from 'react';
import { cx } from './cx';
export function BilingualLabel({ es, en, inline, onDark, className }) {
  return (
    <span className={cx('ds-bi', inline && 'ds-bi--inline', onDark && 'ds-bi--on-dark', className)}>
      <span className="ds-bi__es" lang="es">{es}</span>
      <span className="ds-bi__en" lang="en">{en}</span>
    </span>
  );
}
