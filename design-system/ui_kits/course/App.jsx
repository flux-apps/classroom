import React from 'react';
import { NavItem } from '../../components/navigation/NavItem';
import { Tabs } from '../../components/navigation/Tabs';
import { IconButton } from '../../components/primitives/IconButton';
import { Button } from '../../components/primitives/Button';
import { CourseBanner } from '../../components/course/CourseBanner';
import { Stream } from './Stream';
import { Classwork } from './Classwork';
export function App() {
  const [tab, setTab] = React.useState('stream');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-canvas)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 64, padding: '0 16px', background: 'var(--surface-card)', borderBottom: '1px solid var(--border-quiet)' }}>
        <IconButton icon="menu" label="Menú" /><strong className="t-h3">Classroom</strong><span style={{ flex: 1 }} />
        <Button icon="plus">Crear</Button><IconButton icon="bell" label="Avisos" />
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <nav style={{ width: 'var(--sidebar-w)', padding: '16px 16px 0 0', background: 'var(--surface-card)' }}>
          <NavItem icon="house" label="Inicio" /><NavItem icon="calendar" label="Calendario" />
          <NavItem icon="graduation-cap" label="Español A2" current accent="green" /><NavItem icon="graduation-cap" label="Español B1" /><NavItem icon="clipboard-list" label="Por revisar" />
        </nav>
        <main style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <div style={{ maxWidth: 'var(--stream-w)', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <CourseBanner title="Español A2" meta="Grupo 3 · lunes y miércoles" accent="green" />
            <Tabs accent="green" value={tab} onChange={setTab} tabs={[{ id: 'stream', label: 'Tablón' }, { id: 'work', label: 'Trabajo de clase' }]} />
            {tab === 'stream' ? <Stream /> : <Classwork />}
          </div>
        </main>
      </div>
    </div>
  );
}
