import React from 'react';
import { CARD_TYPES, getCardType } from '../config/cardTypes';
import { useMachineStore } from '../store/machineStore';

export function CardLibrary() {
  const slots    = useMachineStore(s => s.slots);
  const addCard  = useMachineStore(s => s.addCard);

  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'library_card', cardId }));
  };

  /** Click to add: places card in the first empty slot (0–15). */
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: '#8b949e', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
        Card Library
      </span>
      <span style={{ color: '#484f58', fontSize: 10 }}>
        Drag to slot or click to add
      </span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {CARD_TYPES.map(info => {
          const alreadyIn = info.unique && slots.some(s => {
            const ct = getCardType(s.card);
            return ct?.id === info.id;
          });

          return (
            <div
              key={info.id}
              draggable={!alreadyIn}
              onDragStart={e => !alreadyIn && handleDragStart(e, info.id)}
              onClick={() => !alreadyIn && handleClick(info.id)}
              title={alreadyIn ? 'Already installed' : info.description}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '5px 7px',
                background: info.color,
                border: `1px solid ${alreadyIn ? '#21262d' : info.accent}`,
                borderRadius: 4,
                cursor: alreadyIn ? 'not-allowed' : 'grab',
                opacity: alreadyIn ? 0.35 : 1,
                transition: 'opacity 0.15s',
                userSelect: 'none',
              }}
            >
              <span style={{
                color: info.accent,
                fontSize: 9,
                fontFamily: 'monospace',
                width: 26,
                flexShrink: 0,
                letterSpacing: 0.5,
              }}>
                {info.shortLabel}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#c9d1d9', fontSize: 11 }}>{info.label}</div>
                <div style={{ color: '#8b949e', fontSize: 9, marginTop: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {info.description}
                </div>
              </div>

              {info.stub && (
                <span style={{ color: '#484f58', fontSize: 8, flexShrink: 0 }}>SOON</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
