import React, { useRef } from 'react';
import { useMachineStore } from '../store/machineStore';

const DRIVE_LABELS = ['A', 'B', 'C', 'D'];

export function DiskManager() {
  const diskStatus = useMachineStore(s => s.diskStatus);
  const insertDisk = useMachineStore(s => s.insertDisk);
  const ejectDisk  = useMachineStore(s => s.ejectDisk);
  const wasmReady  = useMachineStore(s => s.wasmReady);

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
        {DRIVE_LABELS.map((label, i) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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

            {/* Status */}
            <span style={{
              fontFamily: 'monospace',
              fontSize: 11,
              color: diskStatus[i] ? '#c9d1d9' : '#484f58',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {diskStatus[i] ?? '—'}
            </span>

            {/* Mount/Eject buttons */}
            <input
              ref={fileRefs[i]}
              type="file"
              accept=".dsk,.img,.bin"
              style={{ display: 'none' }}
              onChange={handleFile(i)}
            />
            {diskStatus[i] ? (
              <DriveBtn onClick={() => ejectDisk(i)} color="#f85149" disabled={!wasmReady}>
                ⏏
              </DriveBtn>
            ) : (
              <DriveBtn onClick={() => fileRefs[i].current?.click()} disabled={!wasmReady}>
                ▲
              </DriveBtn>
            )}
          </div>
        ))}
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
