import React from 'react';
import { cx, accentClass } from '../primitives/cx';
export function Tabs({ tabs, value, onChange, accent, className }) {
  return (
    <div role="tablist" className={cx('ds-tabs', accentClass(accent), className)}>
      {tabs.map((t) => <button key={t.id} role="tab" type="button" aria-selected={t.id === value} className="ds-tabs__tab" onClick={() => onChange(t.id)}>{t.label}</button>)}
    </div>
  );
}
