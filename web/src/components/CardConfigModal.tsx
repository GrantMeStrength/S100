import React, { useRef, useState } from 'react';
import type { SlotEntry } from '../store/machineStore';
import { useMachineStore } from '../store/machineStore';
import { getCardType } from '../config/cardTypes';
import type { ConfigField } from '../config/cardTypes';

interface Props {
  slot: number;
  entry: SlotEntry;
  onClose: () => void;
}

export function CardConfigModal({ slot, entry, onClose }: Props) {
  const updateCardParams = useMachineStore(s => s.updateCardParams);
  const info = getCardType(entry.card);

  const [params, setParams] = useState<Record<string, unknown>>({ ...entry.params });

  if (!info) return null;

  const setParam = (key: string, value: unknown) =>
    setParams(prev => ({ ...prev, [key]: value }));

  const handleFileLoad = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const buf   = e.target!.result as ArrayBuffer;
      const bytes = new Uint8Array(buf);
      let binary  = '';
      bytes.forEach(b => (binary += String.fromCharCode(b)));
      setParam('data_base64', btoa(binary));
      setParam('size', bytes.length);
      setParam('_fileName', file.name);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleApply = () => {
    updateCardParams(slot, params);
    onClose();
  };

  const CONTACTS = 26;

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.80)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* ── The card itself ─────────────────────────────────────────── */}
      {/* drop-shadow acts as border following the chamfered clip-path  */}
      <div style={{
        display: 'flex', flexDirection: 'column',
        width: 'min(640px, 92vw)',
        filter: `drop-shadow(0 0 1px ${info.accent}) drop-shadow(0 0 1px ${info.accent}) drop-shadow(0 0 24px ${info.accent}66)`,
        userSelect: 'none',
      }}>

        {/* ── PCB body (2:1 aspect, chamfered top corners) ───────────── */}
        {/* Template: 10"×5", 45° chamfer ~4% of width / ~8% of height   */}
        <div style={{
          background: info.color,
          clipPath: 'polygon(4% 0%, 96% 0%, 100% 8%, 100% 100%, 0% 100%, 0% 8%)',
          aspectRatio: '2/1',
          position: 'relative',
          padding: '14px 16px 12px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Mounting holes H1/H2 — near chamfered top corners */}
          <Hole style={{ position: 'absolute', top: '12%', left: '5%' }} />
          <Hole style={{ position: 'absolute', top: '12%', right: '5%' }} />

          {/* Card header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
            <div style={{ flex: 1, paddingLeft: 16 }}>
              <div style={{
                color: info.accent,
                fontSize: 10,
                fontFamily: 'monospace',
                letterSpacing: 2,
                marginBottom: 2,
              }}>
                {info.shortLabel}  ·  SLOT {slot}
              </div>
              <div style={{ color: '#e6edf3', fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>
                {info.label}
              </div>
              <div style={{ color: '#6e7681', fontSize: 10, marginTop: 3 }}>
                {info.description}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none',
                color: '#484f58', fontSize: 18, cursor: 'pointer',
                lineHeight: 1, padding: '0 4px', marginTop: -2,
              }}
              title="Close"
            >✕</button>
          </div>

          {/* Config area — scrollable if content overflows */}
          <div style={{ flex: 1, overflowY: 'auto', paddingLeft: 16, paddingRight: 4 }}>
            {info.stub ? (
              <div style={{
                border: `1px solid ${info.accent}44`,
                borderRadius: 4,
                padding: '10px 12px',
                color: '#8b949e',
                fontSize: 12,
                lineHeight: 1.5,
              }}>
                ⚠ {info.stub}
              </div>
            ) : info.configFields.length === 0 ? (
              <div style={{ color: '#484f58', fontSize: 12 }}>No configurable parameters.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {info.configFields.map(field => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    value={params[field.key]}
                    fileName={params['_fileName'] as string | undefined}
                    hasBase64={!!params['data_base64']}
                    onChange={v => setParam(field.key, v)}
                    onFile={handleFileLoad}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{
            display: 'flex', gap: 8, justifyContent: 'flex-end',
            paddingLeft: 16, paddingTop: 8,
          }}>
            <CardBtn onClick={onClose} bg="#21262d" color="#8b949e">Cancel</CardBtn>
            <CardBtn onClick={handleApply} bg={info.accent} color="#0d1117">Apply</CardBtn>
          </div>
        </div>

        {/* ── Edge connector ─────────────────────────────────────────── */}
        {/* PCB cut away on each side — only the contact strip protrudes  */}
        <div style={{ height: 22, position: 'relative' }}>
          <div style={{
            position: 'absolute',
            left: '15%',
            width: '63.75%',
            top: 0, bottom: 0,
            background: '#140f00',
            display: 'flex',
            gap: 2,
            padding: '3px 3px',
            alignItems: 'stretch',
            borderLeft:  '1px solid #2a1e00',
            borderRight: '1px solid #2a1e00',
            borderBottom: '1px solid #1a0e00',
            borderRadius: '0 0 3px 3px',
          }}>
            {Array.from({ length: CONTACTS }, (_, i) => (
              <div key={i} style={{
                flex: 1,
                background: i % 2 === 0 ? '#c49a1a' : '#a07a10',
                borderRadius: '0 0 2px 2px',
                boxShadow: i % 2 === 0 ? 'inset 0 1px 1px rgba(255,255,255,0.15)' : 'none',
                minWidth: 1,
              }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Field renderers ────────────────────────────────────────────────────────────

function FieldRow({
  field, value, fileName, hasBase64, onChange, onFile,
}: {
  field: ConfigField;
  value: unknown;
  fileName?: string;
  hasBase64?: boolean;
  onChange: (v: unknown) => void;
  onFile: (f: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const label = (
    <label style={{ display: 'block', color: '#8b949e', fontSize: 10, marginBottom: 3 }}>
      {field.label}
    </label>
  );

  if (field.type === 'file') {
    const loaded = fileName ?? (hasBase64 ? 'ROM loaded' : undefined);
    return (
      <div>
        {label}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <CardBtn onClick={() => fileRef.current?.click()} bg="#21262d" color="#c9d1d9">
            Choose file…
          </CardBtn>
          <span style={{ color: loaded ? '#3fb950' : '#484f58', fontSize: 11 }}>
            {loaded ?? 'No file loaded'}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept={field.accept}
            style={{ display: 'none' }}
            onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </div>
      </div>
    );
  }

  const num = typeof value === 'number' ? value : (field.default as number ?? 0);

  if (field.type === 'hex') {
    return (
      <div>
        {label}
        <input
          type="text"
          value={'0x' + num.toString(16).toUpperCase().padStart(4, '0')}
          onChange={e => {
            const parsed = parseInt(e.target.value.replace(/^0[xX]/, ''), 16);
            if (!isNaN(parsed)) onChange(parsed);
          }}
          style={inputStyle}
          placeholder="0x0000"
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <div>
      {label}
      <input
        type="number"
        value={num}
        min={field.min}
        max={field.max}
        step={field.step ?? 1}
        onChange={e => onChange(Number(e.target.value))}
        style={inputStyle}
      />
    </div>
  );
}

// ── Shared styles ──────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid #30363d',
  borderRadius: 3,
  color: '#c9d1d9',
  padding: '4px 8px',
  fontSize: 12,
  fontFamily: 'monospace',
  boxSizing: 'border-box',
};

function Hole({ style }: { style: React.CSSProperties }) {
  return (
    <div style={{
      width: 7, height: 7,
      borderRadius: '50%',
      border: '1px solid rgba(255,255,255,0.10)',
      background: 'rgba(0,0,0,0.6)',
      ...style,
    }} />
  );
}

function CardBtn({
  onClick, children, bg, color,
}: {
  onClick: () => void;
  children: React.ReactNode;
  bg: string;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: bg,
        border: 'none',
        borderRadius: 3,
        color,
        padding: '5px 14px',
        fontSize: 11,
        cursor: 'pointer',
        fontFamily: 'monospace',
        letterSpacing: 0.5,
      }}
    >
      {children}
    </button>
  );
}
