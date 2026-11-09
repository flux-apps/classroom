import React from 'react';
import { cx, accentClass } from './cx';
export function SectionTab({ accent, className, children }) {
  return <span className="ds-tab-wrap"><span className={cx('ds-tab', accentClass(accent), className)}>{children}</span></span>;
}
