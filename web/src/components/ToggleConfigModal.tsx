/**
 * ToggleConfigModal — editor for a Toggle action entry.
 *
 * Lets the user define a list of { addr (hex4), bytes (hex pairs) } entries
 * that are written directly into RAM before the machine starts running.
 * This simulates front-panel toggling of bootstrap code.
 */
import React, { useState } from 'react';
import type { ActionEntry, ToggleEntry } from '../store/machineStore';
import { useMachineStore } from '../store/machineStore';

const HEX4  = /^[0-9A-Fa-f]{4}$/;
const HEX2P = /^(?:[0-9A-Fa-f]{2})+$/;

function validateEntry(e: ToggleEntry): string | null {
  if (!HEX4.test(e.addr))  return `Address "${e.addr}" must be 4 hex digits (e.g. F800)`;
  const cleanBytes = e.bytes.replace(/\s/g, '');
  if (!cleanBytes)             return 'Bytes field is empty';
  if (!HEX2P.test(cleanBytes)) return `Bytes must be pairs of hex digits (e.g. 3E AA D3 FF)`;
  const addr  = parseInt(e.addr, 16);
  const count = cleanBytes.length / 2;
  if (addr + count - 1 > 0xFFFF) return `Address 0x${e.addr} + ${count} bytes overflows 0xFFFF`;
  return null;
}

interface RowProps {
  entry: ToggleEntry;
  onChange: (e: ToggleEntry) => void;
  onDelete: () => void;
  error: string | null;
}

function EntryRow({ entry, onChange, onDelete, error }: RowProps) {
  const [addrStr,  setAddrStr]  = useState(entry.addr);
  const [bytesStr, setBytesStr] = useState(entry.bytes);

  const commit = () => {
    onChange({ addr: addrStr.toUpperCase(), bytes: bytesStr.toUpperCase() });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {/* Address */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ color: '#6e7681', fontSize: 9, letterSpacing: 0.5 }}>ADDR (hex4)</label>
          <input
            value={addrStr}
            onChange={e => setAddrStr(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }}
            maxLength={4}
            spellCheck={false}
            style={{
              width: 54,
              background: '#0d1117',
              border: `1px solid ${error ? '#f85149' : '#30363d'}`,
              borderRadius: 3,
              color: '#e6edf3',
              fontFamily: 'monospace',
              fontSize: 12,
              padding: '3px 6px',
              textTransform: 'uppercase',
            }}
          />
        </div>

        {/* Bytes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          <label style={{ color: '#6e7681', fontSize: 9, letterSpacing: 0.5 }}>BYTES (hex pairs)</label>
          <input
            value={bytesStr}
            onChange={e => setBytesStr(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }}
            spellCheck={false}
            placeholder="e.g. 3EAA D3FF 76"
            style={{
              background: '#0d1117',
              border: `1px solid ${error ? '#f85149' : '#30363d'}`,
              borderRadius: 3,
              color: '#e6edf3',
              fontFamily: 'monospace',
              fontSize: 12,
              padding: '3px 6px',
              textTransform: 'uppercase',
              width: '100%',
            }}
          />
        </div>

        {/* Byte count hint */}
        <span style={{ color: '#484f58', fontSize: 9, fontFamily: 'monospace', width: 36, flexShrink: 0 }}>
          {HEX2P.test(bytesStr.replace(/\s/g,'')) ? `${bytesStr.replace(/\s/g,'').length / 2}B` : '—'}
        </span>

        {/* Delete */}
        <button
          onClick={onDelete}
          style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1 }}
        >✕</button>
      </div>

      {error && (
        <span style={{ color: '#f85149', fontSize: 9, paddingLeft: 60 }}>{error}</span>
      )}
    </div>
  );
}

interface Props {
  action: ActionEntry & { type: 'toggle' };
  onClose: () => void;
}

export function ToggleConfigModal({ action, onClose }: Props) {
  const updateAction = useMachineStore(s => s.updateAction);

  // Local copy of entries for editing (normalise whitespace from bytes)
  const [entries, setEntries] = useState<ToggleEntry[]>(
    action.params.entries.map(e => ({
      addr:  e.addr.toUpperCase(),
      bytes: e.bytes.replace(/\s/g, '').toUpperCase(),
    }))
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  const rowErrors: (string | null)[] = entries.map(validateEntry);

  const updateEntry = (i: number, e: ToggleEntry) => {
    const next = entries.map((r, idx) => idx === i ? e : r);
    setEntries(next);
    setSubmitError(null);
  };

  const addEntry = () => {
    setEntries(prev => [...prev, { addr: '0000', bytes: '00' }]);
    setSubmitError(null);
  };

  const deleteEntry = (i: number) => {
    setEntries(prev => prev.filter((_, idx) => idx !== i));
    setSubmitError(null);
  };

  const handleApply = () => {
    // Re-validate at submit time (catches unfocused fields) — do NOT write here,
    // since updateAction reloads the machine which would wipe anything we wrote.
    const normalised = entries.map(e => ({
      addr:  e.addr.replace(/\s/g, '').toUpperCase(),
      bytes: e.bytes.replace(/\s/g, '').toUpperCase(),
    }));
    for (const e of normalised) {
      const err = validateEntry(e);
      if (err) { setSubmitError(err); return; }
    }
    updateAction(action.id, { params: { entries: normalised } });
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      {/* S-100 card shape */}
      <div style={{
        width: 520,
        background: '#1a3d1a',
        border: '1px solid #2ea043',
        borderRadius: 6,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        maxHeight: '80vh',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#2ea043', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', fontFamily: 'monospace' }}>
              TOGGLE
            </div>
            <div style={{ color: '#e6edf3', fontSize: 14, fontWeight: 600 }}>
              Front-Panel Memory Toggle
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
          >✕</button>
        </div>

        <div style={{ color: '#8b949e', fontSize: 11, lineHeight: 1.5 }}>
          Enter addresses and bytes to write into RAM when the machine starts.
          Simulates front-panel toggle switches. Bytes are written in order; later entries overwrite earlier ones at the same address.
        </div>

        {/* Entry list */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          overflowY: 'auto', flex: 1,
          paddingRight: 4,
        }}>
          {entries.length === 0 && (
            <div style={{ color: '#484f58', fontSize: 11, fontStyle: 'italic', textAlign: 'center', padding: 12 }}>
              No entries yet — click "+ Add Entry" below
            </div>
          )}
          {entries.map((e, i) => (
            <EntryRow
              key={i}
              entry={e}
              onChange={next => updateEntry(i, next)}
              onDelete={() => deleteEntry(i)}
              error={rowErrors[i]}
            />
          ))}
        </div>

        {/* Add entry */}
        <button
          onClick={addEntry}
          style={{
            background: '#0d1117', border: '1px dashed #30363d', borderRadius: 3,
            color: '#8b949e', cursor: 'pointer', fontSize: 11, padding: '5px 0',
            fontFamily: 'monospace',
          }}
        >+ Add Entry</button>

        {/* Submit error */}
        {submitError && (
          <div style={{ color: '#f85149', fontSize: 11, background: '#1a0505', border: '1px solid #4a1515', borderRadius: 3, padding: '6px 10px' }}>
            {submitError}
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
            disabled={rowErrors.some(e => e !== null)}
            style={{
              background: rowErrors.some(e => e !== null) ? '#21262d' : '#238636',
              border: `1px solid ${rowErrors.some(e => e !== null) ? '#30363d' : '#2ea043'}`,
              borderRadius: 4, color: '#e6edf3', cursor: rowErrors.some(e => e !== null) ? 'not-allowed' : 'pointer',
              fontSize: 12, padding: '5px 14px', fontWeight: 600,
            }}
          >Apply</button>
        </div>
      </div>
    </div>
  );
}
