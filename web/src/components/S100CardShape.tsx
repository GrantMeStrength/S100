/**
 * S100CardShape — visual representation of a physical S-100 peripheral card.
 *
 * Based on the IEEE-696 / S-100 PCB template (avitech.com.au):
 *   • 10" wide × 5" tall overall
 *   • Chamfered (45°) cuts at the top-left and top-right corners
 *   • Mounting holes H1/H2 inset from the chamfered corners
 *   • Edge connector centred-ish at bottom:
 *       left plain PCB  1.500" (15.0%)
 *       contacts        6.375" (63.75%)
 *       right plain PCB 2.125" (21.25%)
 *
 * The chamfered shape is achieved with CSS clip-path polygon.  Because
 * clip-path also clips any CSS border, the visible "border" is rendered
 * as a drop-shadow filter on the outer wrapper instead.
 */
import React from 'react';
import type { CardTypeInfo } from '../config/cardTypes';

// Chamfer is ~4% of width / ~8% of height → gives a true 45° cut on a 2:1 card.
const POLY = 'polygon(4% 0%, 96% 0%, 100% 8%, 100% 100%, 0% 100%, 0% 8%)';

export interface S100CardShapeProps {
  info: CardTypeInfo;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  draggable?: boolean;
  disabled?: boolean;
  /** Number of visible gold contact fingers (default 20). */
  contacts?: number;
  /** Optional CSS aspect-ratio for the PCB body, e.g. "2/1". */
  bodyAspect?: string;
  /** Override PCB body color (e.g. '#1e4a20' for library green). */
  pcbColor?: string;
  onDragStart?: (e: React.DragEvent) => void;
  onClick?: () => void;
  title?: string;
}

export function S100CardShape({
  info, children, style, draggable, disabled = false,
  contacts = 20, bodyAspect, pcbColor, onDragStart, onClick, title,
}: S100CardShapeProps) {
  const accent = disabled ? '#21262d' : info.accent;
  const bodyBg = pcbColor ?? info.color;

  // drop-shadow acts as a border that follows the clip-path outline
  const shadow = `drop-shadow(0 0 0.5px ${accent}) drop-shadow(0 0 0.5px ${accent})`;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', userSelect: 'none',
      filter: shadow,
      opacity: disabled ? 0.40 : 1,
      ...style,
    }}>

      {/* ── PCB body ─────────────────────────────────────────────────── */}
      <div
        draggable={draggable}
        onDragStart={onDragStart}
        onClick={onClick}
        title={title}
        style={{
          background: bodyBg,
          clipPath: POLY,
          padding: '7px 8px 9px',
          cursor: disabled ? 'not-allowed' : (draggable || onClick ? 'grab' : 'default'),
          position: 'relative',
          flex: bodyAspect ? undefined : 1,
          aspectRatio: bodyAspect,
          overflow: bodyAspect ? 'hidden' : undefined,
        }}
      >
        {/* Mounting holes H1 / H2 — near chamfered top corners */}
        <MountingHole style={{ position: 'absolute', top: '12%', left: '5%' }} />
        <MountingHole style={{ position: 'absolute', top: '12%', right: '5%' }} />

        {/* Short label / designator — offset right to clear the H1 mounting hole */}
        <div style={{
          color: accent,
          fontSize: 9,
          fontFamily: 'monospace',
          letterSpacing: 1,
          marginBottom: 5,
          marginLeft: 0,
          paddingLeft: '12%',
          paddingTop: '6%',
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
      {/* PCB material is cut away on each side; only the contact strip   */}
      {/* protrudes. Template: centred at 15% offset, 63.75% wide.        */}
      <div style={{
        height: 16,
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute',
          left: '15%',
          width: '63.75%',
          top: 0,
          bottom: 0,
          background: '#140f00',
          display: 'flex',
          gap: 2,
          padding: '2px 2px',
          alignItems: 'stretch',
          borderLeft:  '1px solid #2a1e00',
          borderRight: '1px solid #2a1e00',
          borderBottom: '1px solid #1a0e00',
          borderRadius: '0 0 2px 2px',
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
      </div>
    </div>
  );
}

function MountingHole({ style }: { style: React.CSSProperties }) {
  return (
    <div style={{
      width: 6, height: 6,
      borderRadius: '50%',
      border: '1px solid rgba(255,255,255,0.12)',
      background: 'rgba(0,0,0,0.55)',
      ...style,
    }} />
  );
}
