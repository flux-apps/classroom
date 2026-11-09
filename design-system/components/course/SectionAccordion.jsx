import React from 'react';
import { cx, accentClass } from '../primitives/cx';
import { Icon } from '../primitives/Icon';
export function SectionAccordion({ title, accent, open = true, onToggle, right, className, children }) {
  return (
    <section className={cx('ds-section', accentClass(accent), className)} data-open={open}>
      <button type="button" className="ds-section__head" aria-expanded={open} onClick={onToggle}>
        <span className="ds-section__bar" />
        <span className="ds-section__title">{title}</span>
        {right}
        <span className="ds-section__chev"><Icon name="chevron-down" size={22} /></span>
      </button>
      {open && <div className="ds-section__body">{children}</div>}
    </section>
  );
}
