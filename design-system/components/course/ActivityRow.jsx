import React from 'react';
import { cx, accentClass } from '../primitives/cx';
import { Icon } from '../primitives/Icon';
import { CompletionCheck } from '../feedback/CompletionCheck';
export function ActivityRow({ icon, name, due, state = 'none', accent, onToggle, className }) {
  return (
    <div className={cx('ds-activity', accentClass(accent), className)}>
      <span className="ds-activity__type"><Icon name={icon} size={18} /></span>
      <span className="ds-activity__name">{name}</span>
      {due && <span className="ds-activity__due">{due}</span>}
      <CompletionCheck state={state} accent={accent} onClick={onToggle} />
    </div>
  );
}
