import React, { useRef, useState } from 'react';
import { useMachineStore } from '../store/machineStore';

const DRIVE_LABELS = ['A', 'B', 'C', 'D'];

export function DiskManager() {
  const diskStatus      = useMachineStore(s => s.diskStatus);
  const diskFormatLabel = useMachineStore(s => s.diskFormatLabel);
  const diskWarnings    = useMachineStore(s => s.diskWarnings);
  const insertDisk      = useMachineStore(s => s.insertDisk);
  const ejectDisk       = useMachineStore(s => s.ejectDisk);
  const wasmReady       = useMachineStore(s => s.wasmReady);

  const [activeWarning, setActiveWarning] = useState<number | null>(null);

  const fileRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const handleFile = (drive: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) insertDisk(drive, file);
    // Reset so the same file can be re-selected
    if (fileRefs[drive].current) fileRefs[drive].current!.value = '';
  };

  return (
    <div>
      <div style={{ color: '#f0883e', fontSize: 11, fontWeight: 'bold', marginBottom: 8, letterSpacing: 1 }}>
        DISK DRIVES
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {DRIVE_LABELS.map((label, i) => {
          const hasWarnings = diskWarnings[i] && diskWarnings[i]!.length > 0;
          const isError     = hasWarnings && diskStatus[i]?.endsWith(' ⚠');
          const fmt         = diskFormatLabel[i];

          return (
            <div key={label}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Drive label */}
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: diskStatus[i] ? '#3fb950' : '#484f58',
                  minWidth: 16,
                  fontWeight: 'bold',
                }}>
                  {label}:
                </span>

                {/* Filename */}
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: isError ? '#f85149' : diskStatus[i] ? '#c9d1d9' : '#484f58',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {diskStatus[i] ?? '—'}
                </span>

                {/* Format badge */}
                {fmt && (
                  <span style={{
                    fontFamily: 'monospace',
                    fontSize: 9,
                    color: isError ? '#f85149' : hasWarnings ? '#e3b341' : '#8b949e',
                    background: '#161b22',
                    border: `1px solid ${isError ? '#f85149' : hasWarnings ? '#e3b341' : '#30363d'}`,
                    borderRadius: 3,
                    padding: '0 4px',
                    flexShrink: 0,
                    cursor: hasWarnings ? 'pointer' : 'default',
                    userSelect: 'none',
                  }}
                    onClick={() => hasWarnings && setActiveWarning(activeWarning === i ? null : i)}
                    title={hasWarnings ? 'Click to show warnings' : fmt}
                  >
                    {fmt}{hasWarnings ? ' ⚠' : ''}
                  </span>
                )}

                {/* Mount/Eject buttons */}
                <input
                  ref={fileRefs[i]}
                  type="file"
                  accept=".dsk,.img,.bin,.imd,.td0"
                  style={{ display: 'none' }}
                  onChange={handleFile(i)}
                />
                {diskStatus[i] ? (
                  <DriveBtn onClick={() => { ejectDisk(i); setActiveWarning(null); }} color="#f85149" disabled={!wasmReady}>
                    ⏏
                  </DriveBtn>
                ) : (
                  <DriveBtn onClick={() => fileRefs[i].current?.click()} disabled={!wasmReady}>
                    ▲
                  </DriveBtn>
                )}
              </div>

              {/* Expandable warnings panel */}
              {activeWarning === i && diskWarnings[i] && (
                <div style={{
                  marginTop: 4,
                  marginLeft: 24,
                  padding: '6px 8px',
                  background: '#0d1117',
                  border: `1px solid ${isError ? '#f85149' : '#e3b341'}`,
                  borderRadius: 4,
                  fontSize: 10,
                  fontFamily: 'monospace',
                  color: isError ? '#f85149' : '#e3b341',
                  lineHeight: 1.5,
                }}>
                  {diskWarnings[i]!.map((w, wi) => (
                    <div key={wi}>{w}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DriveBtn({
  onClick, children, color = '#8b949e', disabled = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'transparent',
        border: '1px solid #30363d',
        color: disabled ? '#484f58' : color,
        padding: '1px 6px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 11,
        borderRadius: 3,
        fontFamily: 'monospace',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}
