import React from 'react';
import { cx, accentClass } from './cx';
export function Card({ variant = 'raised', accent, title, className, children }) {
  return (
    <div className={cx('ds-card', variant !== 'raised' && 'ds-card--' + variant, accentClass(accent), className)}>
      {title && <h3 className="ds-card__title">{title}</h3>}
      {children}
    </div>
  );
}
