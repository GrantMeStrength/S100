import React from 'react';
import { CARD_TYPES, getCardType } from '../config/cardTypes';
import { useMachineStore } from '../store/machineStore';
import { S100CardShape } from './S100CardShape';

export function CardLibrary() {
  const slots    = useMachineStore(s => s.slots);
  const addCard  = useMachineStore(s => s.addCard);

  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'library_card', cardId }));
  };

  const handleClick = (cardId: string) => {
    const occupied = new Set(slots.map(s => s.slot));
    for (let i = 0; i < 16; i++) {
      if (!occupied.has(i)) {
        const ct = CARD_TYPES.find(c => c.id === cardId)!;
        addCard(i, cardId, { ...ct.defaultParams });
        return;
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ color: '#8b949e', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
        Card Library
      </span>
      <span style={{ color: '#484f58', fontSize: 10 }}>Drag to slot · click to add</span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {CARD_TYPES.map(info => {
          const alreadyIn = info.unique && slots.some(s => {
            const ct = getCardType(s.card);
            return ct?.id === info.id;
          });

          return (
            <S100CardShape
              key={info.id}
              info={info}
              draggable={!alreadyIn}
              disabled={alreadyIn}
              contacts={20}
              bodyAspect="2/1"
              pcbColor={alreadyIn ? undefined : '#1a3d1a'}
              title={alreadyIn ? 'Already installed in chassis' : info.description}
              onDragStart={e => !alreadyIn && handleDragStart(e, info.id)}
              onClick={() => !alreadyIn && handleClick(info.id)}
            >
              <div style={{
                color: '#c9d1d9',
                fontSize: 12,
                fontWeight: 600,
                lineHeight: 1.3,
                marginBottom: 3,
                marginLeft: 2,
              }}>
                {info.label}
              </div>
              <div style={{
                color: '#8b949e',
                fontSize: 10,
                lineHeight: 1.4,
                marginLeft: 2,
              }}>
                {info.summary}
              </div>
            </S100CardShape>
          );
        })}
      </div>
    </div>
  );
}
