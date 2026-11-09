import React from 'react';
import { cx, accentClass } from '../primitives/cx';
export function CourseBanner({ title, meta, accent, className }) {
  return <div className={cx('ds-course', accentClass(accent), className)}><h2 className="ds-course__title">{title}</h2>{meta && <p className="ds-course__meta">{meta}</p>}</div>;
}
