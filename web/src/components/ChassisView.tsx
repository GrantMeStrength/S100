import React, { useState } from 'react';
import { useMachineStore } from '../store/machineStore';
import type { SlotEntry, ActionEntry } from '../store/machineStore';
import { getCardType, CARD_TYPES } from '../config/cardTypes';
import { CardConfigModal } from './CardConfigModal';
import { ToggleConfigModal } from './ToggleConfigModal';

const NUM_SLOTS = 16;

const iconBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#8b949e',
  cursor: 'pointer',
  fontSize: 12,
  padding: '2px 5px',
  flexShrink: 0,
  lineHeight: 1,
};

export function ChassisView() {
  const slots      = useMachineStore(s => s.slots);
  const machineName = useMachineStore(s => s.machineName);
  const addCard    = useMachineStore(s => s.addCard);
  const removeCard = useMachineStore(s => s.removeCard);
  const moveCard   = useMachineStore(s => s.moveCard);
  const actions    = useMachineStore(s => s.actions);
  const running    = useMachineStore(s => s.running);
  const actionsApplied = useMachineStore(s => s.actionsApplied);
  const addAction  = useMachineStore(s => s.addAction);
  const removeAction = useMachineStore(s => s.removeAction);
  const applyActionsNow = useMachineStore(s => s.applyActionsNow);

  const [configSlot,   setConfigSlot]   = useState<number | null>(null);
  const [configAction, setConfigAction] = useState<ActionEntry | null>(null);
  const [dragOver,     setDragOver]     = useState<number | null>(null);

  const slotMap = new Map(slots.map(s => [s.slot, s]));

  const handleDragStart = (e: React.DragEvent, slotIndex: number) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'chassis_card', slotIndex }));
  };

  const handleDrop = (e: React.DragEvent, targetSlot: number) => {
    e.preventDefault();
    setDragOver(null);
    try {
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw) return;
      const data = JSON.parse(raw) as { type: string; slotIndex?: number; cardId?: string };
      if (data.type === 'chassis_card' && data.slotIndex !== undefined) {
        if (data.slotIndex !== targetSlot) moveCard(data.slotIndex, targetSlot);
      } else if (data.type === 'library_card' && data.cardId) {
        const ct = CARD_TYPES.find(c => c.id === data.cardId);
        if (ct) addCard(targetSlot, data.cardId, { ...ct.defaultParams });
      }
    } catch { /* ignore */ }
  };

  const configEntry: SlotEntry | undefined = configSlot !== null ? slotMap.get(configSlot) : undefined;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ color: '#8b949e', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
          Chassis — {machineName}
        </span>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {Array.from({ length: NUM_SLOTS }, (_, i) => {
            const entry = slotMap.get(i);
            const info  = entry ? getCardType(entry.card) : undefined;
            const over  = dragOver === i;

            return (
              <div
                key={i}
                onDragOver={e => { e.preventDefault(); setDragOver(i); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => handleDrop(e, i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 6px',
                  background: over ? '#1c2840' : (entry ? '#0d1117' : 'transparent'),
                  border: `1px solid ${over ? '#3b82f6' : (entry ? '#30363d' : '#1c2128')}`,
                  borderRadius: 3,
                  minHeight: 30,
                  transition: 'border-color 0.1s, background 0.1s',
                }}
              >
                <span style={{ color: '#484f58', fontSize: 9, width: 14, textAlign: 'right', flexShrink: 0, fontFamily: 'monospace' }}>
                  {String(i).padStart(2, '0')}
                </span>

                {entry && info ? (
                  <>
                    <div
                      draggable
                      onDragStart={e => handleDragStart(e, i)}
                      title="Drag to move"
                      style={{
                        background: info.color,
                        border: `1px solid ${info.accent}`,
                        borderRadius: 2,
                        padding: '1px 5px',
                        fontSize: 9,
                        color: info.accent,
                        fontFamily: 'monospace',
                        cursor: 'grab',
                        flexShrink: 0,
                        letterSpacing: 0.5,
                      }}
                    >
                      {info.shortLabel}
                    </div>

                    <span style={{ color: '#c9d1d9', fontSize: 11, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {info.label}
                    </span>

                    {/* Settings button — always shown */}
                    <button
                      onClick={() => setConfigSlot(i)}
                      title="Card info & settings"
                      style={iconBtn}
                    >⚙</button>

                    <button
                      onClick={() => removeCard(i)}
                      title="Remove card"
                      style={{ ...iconBtn, color: '#f85149' }}
                    >✕</button>
                  </>
                ) : (
                  <span style={{ color: '#30363d', fontSize: 10, fontStyle: 'italic', flex: 1 }}>
                    {over ? '↓ drop here' : 'empty'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ACTIONS section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#8b949e', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
            Actions
          </span>
          <button
            onClick={addAction}
            style={{ background: 'none', border: '1px dashed #30363d', borderRadius: 3, color: '#8b949e', cursor: 'pointer', fontSize: 10, padding: '2px 8px', fontFamily: 'monospace' }}
          >+ Toggle</button>
        </div>

        {actions.length === 0 ? (
          <div style={{ color: '#484f58', fontSize: 10, fontStyle: 'italic', padding: '4px 0' }}>
            No actions — add a Toggle to pre-load bytes into RAM
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {actions.map(action => (
                <div
                  key={action.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '3px 6px',
                    background: '#0d1117',
                    border: '1px solid #2a3d2a',
                    borderRadius: 3,
                    minHeight: 30,
                  }}
                >
                  <div style={{
                    background: '#0f2d0f',
                    border: '1px solid #2ea043',
                    borderRadius: 2,
                    padding: '1px 5px',
                    fontSize: 9,
                    color: '#2ea043',
                    fontFamily: 'monospace',
                    flexShrink: 0,
                    letterSpacing: 0.5,
                  }}>
                    TOGGLE
                  </div>

                  <span style={{ color: '#c9d1d9', fontSize: 11, flex: 1, fontFamily: 'monospace' }}>
                    {action.params.entries.length === 0
                      ? '(no entries)'
                      : action.params.entries.map(e => `${e.addr}:${e.bytes.replace(/\s/g,'').length/2}B`).join(', ')}
                  </span>

                  <button
                    onClick={() => setConfigAction(action)}
                    title="Configure"
                    style={iconBtn}
                  >⚙</button>

                  <button
                    onClick={() => removeAction(action.id)}
                    title="Remove action"
                    style={{ ...iconBtn, color: '#f85149' }}
                  >✕</button>
                </div>
              ))}
            </div>

            {/* Manual apply button — visible when CPU is stopped */}
            {!running && (
              <button
                onClick={applyActionsNow}
                title="Write toggle bytes into RAM now"
                style={{
                  background: actionsApplied ? '#0f2d0f' : '#0d2d1a',
                  border: `1px solid ${actionsApplied ? '#2ea043' : '#3fb950'}`,
                  borderRadius: 3,
                  color: actionsApplied ? '#2ea043' : '#3fb950',
                  cursor: 'pointer',
                  fontSize: 10,
                  padding: '4px 0',
                  fontFamily: 'monospace',
                  letterSpacing: 0.5,
                }}
              >
                {actionsApplied ? '✓ Applied' : '▶ Apply Now'}
              </button>
            )}
          </>
        )}
      </div>

      {configSlot !== null && configEntry && (
        <CardConfigModal
          slot={configSlot}
          entry={configEntry}
          onClose={() => setConfigSlot(null)}
        />
      )}

      {configAction && (
        <ToggleConfigModal
          action={configAction}
          onClose={() => setConfigAction(null)}
        />
      )}
    </>
  );
}
