import React, { useRef, useState } from 'react';
import type { SlotEntry } from '../store/machineStore';
import { useMachineStore } from '../store/machineStore';
import { getCardType } from '../config/cardTypes';
import type { ConfigField } from '../config/cardTypes';
import { S100CardShape } from './S100CardShape';

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
      const buf  = e.target!.result as ArrayBuffer;
      const bytes = new Uint8Array(buf);
      let binary = '';
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

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#161b22',
        border: `1px solid ${info.accent}`,
        borderRadius: 8,
        padding: 20,
        minWidth: 340,
        maxWidth: 480,
        width: '90vw',
        boxShadow: `0 0 30px ${info.accent}33`,
      }}>
        {/* Header — S-100 card shape */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 18 }}>
          <S100CardShape info={info} contacts={22} style={{ width: 110, flexShrink: 0 }}>
            <div style={{ color: '#c9d1d9', fontSize: 12, fontWeight: 600, lineHeight: 1.3, marginLeft: 2, marginBottom: 2 }}>
              {info.label}
            </div>
            <div style={{ color: '#6e7681', fontSize: 9, lineHeight: 1.4, marginLeft: 2 }}>
              {info.description}
            </div>
          </S100CardShape>
          <div>
            <div style={{ color: '#484f58', fontSize: 10, marginBottom: 4 }}>SLOT {slot}</div>
            <div style={{ color: '#c9d1d9', fontSize: 15, fontWeight: 600 }}>{info.label}</div>
            <div style={{ color: '#8b949e', fontSize: 11, marginTop: 2 }}>Configuration</div>
          </div>
        </div>

        {info.stub ? (
          <div style={{
            background: '#21262d',
            border: '1px solid #30363d',
            borderRadius: 4,
            padding: 12,
            color: '#8b949e',
            fontSize: 12,
            marginBottom: 16,
            lineHeight: 1.5,
          }}>
            ⚠ {info.stub}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
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

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <ModalBtn onClick={onClose} bg="#21262d" color="#c9d1d9">Cancel</ModalBtn>
          <ModalBtn onClick={handleApply} bg={info.accent} color="#0d1117">Apply</ModalBtn>
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
    <label style={{ display: 'block', color: '#8b949e', fontSize: 11, marginBottom: 4 }}>
      {field.label}
    </label>
  );

  if (field.type === 'file') {
    const loaded = fileName ?? (hasBase64 ? 'ROM loaded' : undefined);
    return (
      <div>
        {label}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ModalBtn onClick={() => fileRef.current?.click()} bg="#21262d" color="#c9d1d9">
            Choose file…
          </ModalBtn>
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
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 4,
  color: '#c9d1d9',
  padding: '5px 8px',
  fontSize: 12,
  fontFamily: 'monospace',
  boxSizing: 'border-box',
};

function ModalBtn({
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
        borderRadius: 4,
        color,
        padding: '6px 14px',
        fontSize: 12,
        cursor: 'pointer',
        fontFamily: 'monospace',
      }}
    >
      {children}
    </button>
  );
}
