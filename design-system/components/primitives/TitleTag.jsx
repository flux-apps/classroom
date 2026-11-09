import React from 'react';
import { cx, accentClass } from './cx';
export function TitleTag({ accent, className, children }) {
  return (
    <div className={cx('ds-titlebar', accentClass(accent), className)}>
      <span className="ds-titletag">{children}</span>
    </div>
  );
}
