import React from 'react';
import { cx } from '../primitives/cx';
export function Tooltip({ text, open, children }) {
  return <span className={cx('ds-tip', open && 'ds-tip--open')}>{children}<span role="tooltip" className="ds-tip__bubble">{text}</span></span>;
}
