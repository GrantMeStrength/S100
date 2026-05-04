/**
 * S100CardShape — a React component that renders a visual representation
 * of a physical S-100 peripheral card: PCB body + gold edge connector.
 *
 * Real S-100 cards have a 100-pin dual-row edge connector at the bottom.
 * We simulate the alternating gold contact fingers with a CSS repeating
 * gradient, and add small mounting-hole circles in the PCB corners.
 */
import React from 'react';
import type { CardTypeInfo } from '../config/cardTypes';

export interface S100CardShapeProps {
  info: CardTypeInfo;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  draggable?: boolean;
  disabled?: boolean;
  /** Number of visible contact fingers on the edge connector (default 18). */
  contacts?: number;
  /** Optional CSS aspect-ratio for the PCB body (e.g. "2/1" for 10×5 S-100 proportions). */
  bodyAspect?: string;
  onDragStart?: (e: React.DragEvent) => void;
  onClick?: () => void;
  title?: string;
}

export function S100CardShape({
  info, children, style, draggable, disabled = false,
  contacts = 18, bodyAspect, onDragStart, onClick, title,
}: S100CardShapeProps) {
  const border = `1.5px solid ${disabled ? '#21262d' : info.accent}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', userSelect: 'none', ...style }}>

      {/* ── PCB body ─────────────────────────────────────────────────── */}
      <div
        draggable={draggable}
        onDragStart={onDragStart}
        onClick={onClick}
        title={title}
        style={{
          background: info.color,
          border,
          borderBottom: 'none',
          borderRadius: '4px 4px 0 0',
          padding: '7px 8px 9px',
          cursor: disabled ? 'not-allowed' : (draggable || onClick ? 'grab' : 'default'),
          opacity: disabled ? 0.38 : 1,
          position: 'relative',
          flex: bodyAspect ? undefined : 1,
          aspectRatio: bodyAspect,
          overflow: bodyAspect ? 'hidden' : undefined,
        }}
      >
        {/* Mounting holes — top corners */}
        <MountingHole style={{ position: 'absolute', top: 5, left: 5 }} />
        <MountingHole style={{ position: 'absolute', top: 5, right: 5 }} />

        {/* Short label / designator */}
        <div style={{
          color: info.accent,
          fontSize: 9,
          fontFamily: 'monospace',
          letterSpacing: 1,
          marginBottom: 5,
          marginLeft: 2,
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}>
          {info.shortLabel}
          {info.stub && (
            <span style={{ color: '#484f58', fontSize: 8, letterSpacing: 0 }}>SOON</span>
          )}
        </div>

        {children}
      </div>

      {/* ── Edge connector ───────────────────────────────────────────── */}
      {/* Real S-100: 10" card, ~6" connector centred, ~2" plain PCB each side */}
      <div style={{
        background: info.color,
        border,
        borderTop: `1px solid ${disabled ? '#21262d' : info.accent}44`,
        borderRadius: '0 0 3px 3px',
        height: 16,
        display: 'flex',
        alignItems: 'stretch',
        opacity: disabled ? 0.38 : 1,
        overflow: 'hidden',
      }}>
        {/* Left PCB wing (~20%) */}
        <div style={{ flex: '0 0 20%', background: info.color }} />

        {/* Gold contacts (~60%) */}
        <div style={{
          flex: '0 0 60%',
          background: '#140f00',
          display: 'flex',
          gap: 2,
          padding: '2px 2px',
          alignItems: 'stretch',
          borderLeft:  `1px solid #2a1e00`,
          borderRight: `1px solid #2a1e00`,
        }}>
          {Array.from({ length: contacts }, (_, i) => (
            <div key={i} style={{
              flex: 1,
              background: i % 2 === 0 ? '#c49a1a' : '#a07a10',
              borderRadius: '0 0 1px 1px',
              boxShadow: i % 2 === 0 ? 'inset 0 1px 1px rgba(255,255,255,0.15)' : 'none',
              minWidth: 1,
            }} />
          ))}
        </div>

        {/* Right PCB wing (~20%) */}
        <div style={{ flex: '0 0 20%', background: info.color }} />
      </div>
    </div>
  );
}

function MountingHole({ style }: { style: React.CSSProperties }) {
  return (
    <div style={{
      width: 5,
      height: 5,
      borderRadius: '50%',
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(0,0,0,0.5)',
      ...style,
    }} />
  );
}
