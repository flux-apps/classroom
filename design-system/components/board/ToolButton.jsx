import React from 'react';
import { cx } from '../primitives/cx';
import { Icon } from '../primitives/Icon';
export function ToolButton({ icon, label, en, pressed, className, ...rest }) {
  return (
    <button type="button" aria-pressed={pressed} className={cx('ds-tool', className)} {...rest}>
      <Icon name={icon} size={28} /><span lang="es">{label}</span>{en && <span lang="en" className="ds-tool__en">{en}</span>}
    </button>
  );
}
