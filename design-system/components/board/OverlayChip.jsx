import React from 'react';
import { cx } from '../primitives/cx';
import { Icon } from '../primitives/Icon';
const LBL = { unknown: 'Overlay ?', on: 'Overlay ON', off: 'Overlay OFF' };
const ICO = { unknown: 'info', on: 'triangle-alert', off: 'circle-check' };
export function OverlayChip({ state = 'unknown', className, ...rest }) {
  return <button type="button" className={cx('ds-chip', state !== 'unknown' && 'ds-chip--' + state, className)} {...rest}><Icon name={ICO[state]} size={18} />{LBL[state]}</button>;
}
