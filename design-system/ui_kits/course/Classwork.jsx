import React from 'react';
import { SectionAccordion } from '../../components/course/SectionAccordion';
import { ActivityRow } from '../../components/course/ActivityRow';
import { ProgressBar } from '../../components/feedback/ProgressBar';
const NEXT = { none: 'todo', todo: 'done', done: 'none', late: 'done' };
export function Classwork() {
  const [open, setOpen] = React.useState({ u5: true, u6: false });
  const [rows, setRows] = React.useState({ a: 'done', b: 'todo', c: 'late', d: 'none' });
  const t = (k) => () => setRows({ ...rows, [k]: NEXT[rows[k]] });
  return (<>
    <SectionAccordion title="Unidad 5 · ¡Qué fiesta!" accent="green" open={open.u5} onToggle={() => setOpen({ ...open, u5: !open.u5 })} right={<div style={{ width: 140 }}><ProgressBar value={60} accent="green" /></div>}>
      <ActivityRow icon="book-open" name="Lectura: Las fiestas" state={rows.a} accent="green" onToggle={t('a')} />
      <ActivityRow icon="file-text" name="Ejercicio 3: pretérito indefinido" due="vie" state={rows.b} accent="green" onToggle={t('b')} />
      <ActivityRow icon="volume-2" name="Audio 19" due="ayer" state={rows.c} accent="green" onToggle={t('c')} />
    </SectionAccordion>
    <SectionAccordion title="Unidad 6 · Cuento contigo" accent="orange" open={open.u6} onToggle={() => setOpen({ ...open, u6: !open.u6 })}>
      <ActivityRow icon="message-square" name="Foro: tu mejor fiesta" state={rows.d} accent="orange" onToggle={t('d')} />
    </SectionAccordion>
  </>);
}
