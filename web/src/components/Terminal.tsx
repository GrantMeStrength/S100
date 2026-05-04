import React, { useRef, useEffect, useCallback } from 'react';
import { useMachineStore } from '../store/machineStore';

const FONT = '13px "Courier New", monospace';
const CHAR_W = 8;
const CHAR_H = 16;
const COLS = 80;
const ROWS = 24;

// ANSI color palette (basic 8)
const PALETTE = [
  '#000000', '#cc0000', '#00cc00', '#cccc00',
  '#0000cc', '#cc00cc', '#00cccc', '#cccccc',
];

interface TermLine {
  text: string;
  fg: number; // palette index
}

export function Terminal() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terminalOutput = useMachineStore(s => s.terminalOutput);
  const sendInput = useMachineStore(s => s.sendInput);
  const clearTerminal = useMachineStore(s => s.clearTerminal);

  // Simple line-buffer rendering (no full VT100 state machine for MVP)
  const render = useCallback((output: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = FONT;
    ctx.textBaseline = 'top';

    // Split into lines, keep last ROWS
    const lines = output.split('\n');
    const visible = lines.slice(Math.max(0, lines.length - ROWS));

    visible.forEach((line, row) => {
      ctx.fillStyle = '#c9d1d9';
      // Truncate to COLS chars
      ctx.fillText(line.slice(0, COLS), 4, row * CHAR_H + 2);
    });

    // Draw cursor at end of last line
    const lastRow = Math.min(visible.length - 1, ROWS - 1);
    const lastLine = visible[visible.length - 1] ?? '';
    const cursorX = 4 + Math.min(lastLine.length, COLS) * CHAR_W;
    const cursorY = lastRow * CHAR_H + 2;
    ctx.fillStyle = '#58a6ff';
    ctx.fillRect(cursorX, cursorY, CHAR_W, CHAR_H - 2);
  }, []);

  useEffect(() => {
    render(terminalOutput);
  }, [terminalOutput, render]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    const key = e.key;
    if (key === 'Enter') {
      sendInput('\r\n');
    } else if (key === 'Backspace') {
      sendInput('\x08');
    } else if (key.length === 1) {
      sendInput(e.ctrlKey ? String.fromCharCode(key.charCodeAt(0) & 0x1F) : key);
    }
  }, [sendInput]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#8b949e', fontSize: 12 }}>TERMINAL (VT100)</span>
        <button
          onClick={clearTerminal}
          style={btnStyle}
        >
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={COLS * CHAR_W + 8}
        height={ROWS * CHAR_H + 4}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        style={{
          outline: '1px solid #30363d',
          cursor: 'text',
          background: '#0d1117',
          display: 'block',
        }}
      />
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #30363d',
  color: '#8b949e',
  padding: '2px 8px',
  cursor: 'pointer',
  fontSize: 11,
  borderRadius: 3,
};
