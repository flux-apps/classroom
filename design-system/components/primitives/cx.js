export const cx = (...a) => a.filter(Boolean).join(' ');
export const accentClass = (accent) => (accent ? 'acc-' + accent : '');
export const ACCENT_SHAPE = { lime: 'cross', green: 'circle', orange: 'triangle', magenta: 'diamond', blue: 'square', purple: 'hexagon', teal: 'pentagon' };
