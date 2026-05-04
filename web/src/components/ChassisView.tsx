import React from 'react';
import { useMachineStore } from '../store/machineStore';

// Slot colors for known card types
function cardColor(name: string): string {
  if (name.includes('ram'))    return '#1c4a2e';
  if (name.includes('rom'))    return '#1c2e4a';
  if (name.includes('serial')) return '#4a2e1c';
  if (name.includes('cpu'))    return '#3d1c4a';
  return '#252b35';
}

function cardLabel(name: string): string {
  if (name.includes('ram'))    return 'RAM';
  if (name.includes('rom'))    return 'ROM';
  if (name.includes('serial')) return 'SIO';
  if (name.includes('cpu'))    return 'CPU';
  return name.slice(0, 6).toUpperCase();
}

export function ChassisView() {
  const state = useMachineStore(s => s.machineState);
  const machineName = state?.name ?? 'S-100 System';
  const cards = state?.cards ?? [];

  // Always show 22 slots (typical S-100 backplane)
  const slots = Array.from({ length: 22 }, (_, i) => cards[i] ?? null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: '#8b949e', fontSize: 12 }}>CHASSIS — {machineName}</span>

      {/* Backplane rail */}
      <div style={{
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 4,
        padding: '6px 4px',
        display: 'flex',
        gap: 3,
        flexWrap: 'wrap',
      }}>
        {slots.map((card, i) => (
          <div
            key={i}
            title={card ?? `Empty slot ${i}`}
            style={{
              width: 32,
              height: 56,
              background: card ? cardColor(card) : '#0d1117',
              border: `1px solid ${card ? '#30363d' : '#1c2128'}`,
              borderRadius: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 0',
              cursor: card ? 'pointer' : 'default',
            }}
          >
            {/* Card gold edge connector */}
            <div style={{
              width: '80%',
              height: 6,
              background: card ? '#b8860b' : '#1a1a1a',
              borderRadius: 1,
            }} />
            <span style={{
              fontSize: 8,
              color: card ? '#c9d1d9' : '#30363d',
              textAlign: 'center',
              lineHeight: '1.1',
              padding: '0 2px',
            }}>
              {card ? cardLabel(card) : String(i).padStart(2, '0')}
            </span>
            <div style={{
              width: '80%',
              height: 6,
              background: card ? '#b8860b' : '#1a1a1a',
              borderRadius: 1,
            }} />
          </div>
        ))}
      </div>
    </div>
  );
}
