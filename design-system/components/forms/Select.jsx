import React from 'react';
import { cx } from '../primitives/cx';
export function Select({ options, className, ...rest }) {
  return <select className={cx('ds-select', className)} {...rest}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
}
