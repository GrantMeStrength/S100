/**
 * DiskFileBrowser — CP/M file browser for mounted disk images.
 * Shows file listing, allows download/upload/delete of individual files.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useMachineStore } from '../store/machineStore';
import { listFiles, extractFile, writeFile, deleteFile, getDiskStats, CpmFile } from '../utils/cpmFiles';
import * as wasm from '../wasm';

type DiskModState = 'idle' | 'modified';

interface Props {
  drive: number;
  onClose: () => void;
}

export function DiskFileBrowser({ drive, onClose }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [modState, setModState] = useState<DiskModState>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const warmReset = useMachineStore(s => s.warmReset);

  // Get current disk data
  const diskData = useMemo(() => {
    try {
      return wasm.getDiskData(drive);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drive, refreshKey]);

  const files = useMemo(() => {
    if (!diskData || diskData.length === 0) return [];
    return listFiles(diskData);
  }, [diskData]);

  const stats = useMemo(() => {
    if (!diskData || diskData.length === 0) return null;
    return getDiskStats(diskData);
  }, [diskData]);

  const refresh = useCallback(() => {
    setRefreshKey(k => k + 1);
    setError(null);
  }, []);

  const handleReboot = useCallback(() => {
    warmReset();
    setModState('idle');
    onClose();
  }, [warmReset, onClose]);

  const handleDownload = useCallback((file: CpmFile) => {
    if (!diskData) return;
    const content = extractFile(diskData, file);
    if (!content) {
      setError(`Failed to extract ${file.name}`);
      return;
    }
    const blob = new Blob([new Uint8Array(content)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }, [diskData]);

  const handleDelete = useCallback((file: CpmFile) => {
    // Read FRESH disk data (CP/M may have written since modal opened)
    let fresh: Uint8Array;
    try { fresh = wasm.getDiskData(drive); } catch { return; }
    if (!fresh || fresh.length === 0) return;
    const newData = deleteFile(fresh, file);
    wasm.insertDisk(drive, newData);
    setModState('modified');
    refresh();
  }, [drive, refresh]);

  const uploadFile = useCallback(async (file: File) => {
    setError(null);
    // Read FRESH disk data (CP/M may have written since modal opened)
    let fresh: Uint8Array;
    try { fresh = wasm.getDiskData(drive); } catch { setError('Cannot read disk'); return; }
    if (!fresh || fresh.length === 0) { setError('No disk mounted'); return; }
    const buffer = await file.arrayBuffer();
    const fileBytes = new Uint8Array(buffer);
    const result = writeFile(fresh, file.name, fileBytes);
    if (result.error) { setError(result.error); return; }
    wasm.insertDisk(drive, result.data);
    setModState('modified');
    refresh();
  }, [drive, refresh]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      uploadFile(files[i]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      uploadFile(files[i]);
    }
  }, [uploadFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  if (!diskData || diskData.length === 0) {
    return (
      <div style={modalOverlay}>
        <div style={modalBox}>
          <div style={headerRow}>
            <span style={{ color: '#f0883e', fontSize: 12, fontWeight: 600 }}>
              Drive {'ABCD'[drive]}: — No Disk
            </span>
            <button onClick={onClose} style={closeBtn}>✕</button>
          </div>
          <div style={{ color: '#8b949e', fontSize: 11, padding: 12 }}>
            No disk mounted in this drive.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={modalOverlay}>
      <div style={{ ...modalBox, maxHeight: '80vh' }}>
        {/* Header */}
        <div style={headerRow}>
          <div>
            <span style={{ color: '#f0883e', fontSize: 12, fontWeight: 600 }}>
              Drive {'ABCD'[drive]}: — CP/M Files
            </span>
            {stats && (
              <span style={{ color: '#6e7681', fontSize: 10, marginLeft: 8, fontFamily: 'monospace' }}>
                {stats.fileCount} files · {stats.usedKb}K used · {stats.freeKb}K free
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={refresh} style={actionBtn} title="Refresh file list">↻</button>
            <button onClick={onClose} style={closeBtn}>✕</button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: '6px 10px', background: '#1a0505', border: '1px solid #4a1515', borderRadius: 3, color: '#f85149', fontSize: 10, margin: '0 12px' }}>
            {error}
          </div>
        )}

        {/* Disk modified — reboot prompt */}
        {modState === 'modified' && !error && (
          <div style={{ padding: '6px 10px', background: '#0d1a0d', border: '1px solid #2ea043', borderRadius: 3, color: '#3fb950', fontSize: 10, margin: '0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>✓ Disk updated</span>
            <button
              onClick={handleReboot}
              style={{
                background: '#238636', border: '1px solid #2ea043', borderRadius: 3,
                color: '#e6edf3', cursor: 'pointer', fontSize: 10, padding: '2px 8px',
                fontFamily: 'monospace',
              }}
            >
              Reboot CP/M
            </button>
            <span style={{ color: '#6e7681' }}>to refresh DIR (use at CP/M prompt)</span>
          </div>
        )}

        {/* File list */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 12px',
            border: dragOver ? '2px dashed #3fb950' : '2px dashed transparent',
            borderRadius: 4,
            transition: 'border-color 0.15s',
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {files.length === 0 ? (
            <div style={{ color: '#484f58', fontSize: 11, fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>
              No files on disk — drag & drop files here to upload
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' }}>
              <thead>
                <tr style={{ color: '#6e7681', borderBottom: '1px solid #21262d' }}>
                  <th style={thStyle}>Name</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 60 }}>Size</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: 40 }}>Usr</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: 40 }}>Attr</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {files.map((file, idx) => (
                  <tr
                    key={`${file.name}-${file.user}-${idx}`}
                    style={{ borderBottom: '1px solid #161b22' }}
                  >
                    <td style={{ ...tdStyle, color: '#e6edf3' }}>
                      {file.name}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: '#8b949e' }}>
                      {formatSize(file.size)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', color: '#6e7681' }}>
                      {file.user}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', color: '#6e7681' }}>
                      {file.readOnly ? 'R/O' : ''}{file.system ? ' SYS' : ''}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button
                        onClick={() => handleDownload(file)}
                        title="Download file"
                        style={tblBtn}
                      >↓</button>
                      <button
                        onClick={() => handleDelete(file)}
                        title="Delete file"
                        style={{ ...tblBtn, color: '#f85149' }}
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Upload area */}
        <div style={{ padding: '8px 12px', borderTop: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileInput}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: '#238636',
              border: '1px solid #2ea043',
              borderRadius: 4,
              color: '#e6edf3',
              cursor: 'pointer',
              fontSize: 11,
              padding: '4px 12px',
              fontFamily: 'monospace',
            }}
          >
            Upload File
          </button>
          <span style={{ color: '#484f58', fontSize: 10, fontStyle: 'italic' }}>
            or drag & drop files onto the list above
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${Math.ceil(bytes / 1024)}K`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const modalOverlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const modalBox: React.CSSProperties = {
  width: 500,
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 12px', borderBottom: '1px solid #21262d',
};

const closeBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#8b949e',
  cursor: 'pointer', fontSize: 16, lineHeight: 1,
};

const actionBtn: React.CSSProperties = {
  background: '#21262d', border: '1px solid #30363d', borderRadius: 3,
  color: '#8b949e', cursor: 'pointer', fontSize: 12, padding: '2px 8px',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '4px 6px', fontSize: 10,
  fontWeight: 'normal', letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: '4px 6px',
};

const tblBtn: React.CSSProperties = {
  background: 'none', border: '1px solid #30363d', borderRadius: 3,
  color: '#79c0ff', cursor: 'pointer', fontSize: 11, padding: '1px 5px',
  marginLeft: 4, fontFamily: 'monospace',
};
