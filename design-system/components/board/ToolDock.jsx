import React from 'react';
import { cx } from '../primitives/cx';
export function ToolDock({ className, children }) {
  return <div role="toolbar" className={cx('ds-dock', className)}>{children}</div>;
}
ToolDock.Sep = function Sep() { return <span className="ds-dock__sep" role="separator" />; };
