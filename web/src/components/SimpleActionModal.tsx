/**
 * SimpleActionModal — editor for set_pc, io_out, and fill actions.
 */
import React, { useState } from 'react';
import type { ActionEntry } from '../store/machineStore';
import { useMachineStore } from '../store/machineStore';

const HEX2 = /^[0-9A-Fa-f]{2}$/;
const HEX4 = /^[0-9A-Fa-f]{4}$/;

const inputStyle: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 3,
  color: '#e6edf3',
  fontFamily: 'monospace',
  fontSize: 12,
  padding: '3px 6px',
  textTransform: 'uppercase',
  width: 70,
};

const labelStyle: React.CSSProperties = {
  color: '#6e7681',
  fontSize: 10,
  letterSpacing: 0.5,
  fontFamily: 'monospace',
};

interface Props {
  action: ActionEntry;
  onClose: () => void;
}

const ACTION_INFO: Record<string, { title: string; color: string; description: string }> = {
  set_pc: {
    title: 'Set Program Counter',
    color: '#3a9fd4',
    description: 'Set the CPU program counter to a specific address before the machine starts running.',
  },
  io_out: {
    title: 'I/O Port Write',
    color: '#e67e22',
    description: 'Write a byte to an I/O port before the machine starts. Useful for initializing hardware.',
  },
  fill: {
    title: 'Fill Memory',
    color: '#a855f7',
    description: 'Fill a range of memory addresses with a constant byte value.',
  },
};

export function SimpleActionModal({ action, onClose }: Props) {
  const updateAction = useMachineStore(s => s.updateAction);
  const info = ACTION_INFO[action.type] ?? { title: action.type, color: '#8b949e', description: '' };

  // Local state for editing
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const p = action.params as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(p)) {
      out[k] = String(v).toUpperCase();
    }
    return out;
  });
  const [error, setError] = useState<string | null>(null);

  const setField = (key: string, value: string) => {
    setFields(prev => ({ ...prev, [key]: value }));
    setError(null);
  };

  const validate = (): string | null => {
    switch (action.type) {
      case 'set_pc':
        if (!HEX4.test(fields.addr ?? '')) return 'Address must be 4 hex digits (e.g. FF00)';
        return null;
      case 'io_out':
        if (!HEX2.test(fields.port ?? '')) return 'Port must be 2 hex digits (e.g. 0E)';
        if (!HEX2.test(fields.value ?? '')) return 'Value must be 2 hex digits (e.g. AA)';
        return null;
      case 'fill':
        if (!HEX4.test(fields.start ?? '')) return 'Start address must be 4 hex digits';
        if (!HEX4.test(fields.end ?? '')) return 'End address must be 4 hex digits';
        if (!HEX2.test(fields.value ?? '')) return 'Fill value must be 2 hex digits';
        if (parseInt(fields.end, 16) < parseInt(fields.start, 16)) return 'End must be ≥ start';
        return null;
      default:
        return null;
    }
  };

  const handleApply = () => {
    const err = validate();
    if (err) { setError(err); return; }
    const normalised: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      normalised[k] = v.toUpperCase();
    }
    updateAction(action.id, { params: normalised } as Partial<ActionEntry>);
    onClose();
  };

  const renderFields = () => {
    switch (action.type) {
      case 'set_pc':
        return (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={labelStyle}>ADDRESS (hex)</span>
              <input
                value={fields.addr ?? ''}
                onChange={e => setField('addr', e.target.value)}
                maxLength={4}
                placeholder="FF00"
                style={inputStyle}
              />
            </div>
          </div>
        );
      case 'io_out':
        return (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={labelStyle}>PORT (hex)</span>
              <input
                value={fields.port ?? ''}
                onChange={e => setField('port', e.target.value)}
                maxLength={2}
                placeholder="0E"
                style={{ ...inputStyle, width: 44 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={labelStyle}>VALUE (hex)</span>
              <input
                value={fields.value ?? ''}
                onChange={e => setField('value', e.target.value)}
                maxLength={2}
                placeholder="AA"
                style={{ ...inputStyle, width: 44 }}
              />
            </div>
          </div>
        );
      case 'fill':
        return (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={labelStyle}>START (hex)</span>
              <input
                value={fields.start ?? ''}
                onChange={e => setField('start', e.target.value)}
                maxLength={4}
                placeholder="0000"
                style={inputStyle}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={labelStyle}>END (hex)</span>
              <input
                value={fields.end ?? ''}
                onChange={e => setField('end', e.target.value)}
                maxLength={4}
                placeholder="FFFF"
                style={inputStyle}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={labelStyle}>VALUE (hex)</span>
              <input
                value={fields.value ?? ''}
                onChange={e => setField('value', e.target.value)}
                maxLength={2}
                placeholder="00"
                style={{ ...inputStyle, width: 44 }}
              />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        width: 420,
        background: '#161b22',
        border: `1px solid ${info.color}`,
        borderRadius: 6,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: info.color, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', fontFamily: 'monospace' }}>
              {action.type.toUpperCase().replace('_', ' ')}
            </div>
            <div style={{ color: '#e6edf3', fontSize: 14, fontWeight: 600 }}>
              {info.title}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
          >✕</button>
        </div>

        <div style={{ color: '#8b949e', fontSize: 11, lineHeight: 1.5 }}>
          {info.description}
        </div>

        {/* Fields */}
        {renderFields()}

        {/* Error */}
        {error && (
          <div style={{ color: '#f85149', fontSize: 11, background: '#1a0505', border: '1px solid #4a1515', borderRadius: 3, padding: '6px 10px' }}>
            {error}
          </div>
        )}

        {/* Footer buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', cursor: 'pointer', fontSize: 12, padding: '5px 14px' }}
          >Cancel</button>
          <button
            onClick={handleApply}
            style={{
              background: '#238636',
              border: '1px solid #2ea043',
              borderRadius: 4, color: '#e6edf3', cursor: 'pointer',
              fontSize: 12, padding: '5px 14px', fontWeight: 600,
            }}
          >Apply</button>
        </div>
      </div>
    </div>
  );
}
