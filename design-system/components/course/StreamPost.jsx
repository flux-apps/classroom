import React from 'react';
import { cx, accentClass } from '../primitives/cx';
import { Icon } from '../primitives/Icon';
export function StreamPost({ icon, title, meta, side, accent, className }) {
  return (
    <div className={cx('ds-post', accentClass(accent), className)}>
      <span className="ds-post__icon"><Icon name={icon} size={22} /></span>
      <div className="ds-post__main"><p className="ds-post__title">{title}</p>{meta && <p className="ds-post__meta">{meta}</p>}</div>
      {side && <span className="ds-post__side">{side}</span>}
    </div>
  );
}
