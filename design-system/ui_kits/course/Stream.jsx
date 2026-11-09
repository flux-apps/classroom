import React from 'react';
import { StreamPost } from '../../components/course/StreamPost';
import { StatPanel } from '../../components/course/StatPanel';
export function Stream() {
  return (<>
    <div style={{ display: 'flex', gap: 16 }}>
      <StatPanel label="Entregas" value="18/24" delta="3 hoy" progress={75} accent="green" />
      <StatPanel label="Tardías" value="2" delta="1 más" trend="down" accent="magenta" />
    </div>
    <StreamPost icon="clipboard-list" accent="orange" title="Nueva tarea: El pretérito indefinido" meta="Publicada por Mari · 9 nov" side="Vence vie" />
    <StreamPost icon="book-open" accent="green" title="Material: Las fiestas (Agencia ELE, p. 48)" meta="Publicado por Mari · 7 nov" />
    <StreamPost icon="megaphone" accent="blue" title="Mañana traed el cuaderno" meta="Anuncio · 6 nov" />
  </>);
}
