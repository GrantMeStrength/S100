/**
 * IMSAI 8080 Programmed Output Panel
 *
 * Displays the eight front-panel "Programmed Output" LEDs that are driven by
 * OUT port 0xFF.  The IMSAI uses *negative logic*: a 0-bit lights the LED.
 *
 * Only rendered when the current machine name contains "IMSAI" or when the
 * `programmed_output` field is present in machine state.
 */
import React from 'react';
import { useMachineStore } from '../store/machineStore';

// Authentic IMSAI front-panel red LED colours
const LED_ON  = '#ff2a2a';   // lit
const LED_OFF = '#3a0a0a';   // dark

function Led({ on }: { on: boolean }) {
  return (
    <div style={{
      width: 14,
      height: 14,
      borderRadius: '50%',
      background: on ? LED_ON : LED_OFF,
      boxShadow: on
        ? `0 0 4px 2px ${LED_ON}88, inset 0 1px 2px rgba(255,255,255,0.25)`
        : 'inset 0 1px 2px rgba(0,0,0,0.6)',
      border: `1px solid ${on ? '#ff6666' : '#220808'}`,
      flexShrink: 0,
    }} />
  );
}

export function ProgrammedOutputPanel() {
  const machineState = useMachineStore(s => s.machineState);
  const machineName  = useMachineStore(s => s.machineName);

  // Show panel only for IMSAI preset, or any machine with "IMSAI" in the name
  const isImsai = machineName.toLowerCase().includes('imsai');
  if (!isImsai || !machineState) return null;

  const value = machineState.programmed_output ?? 0;

  // Negative logic: bit = 0 → LED on, bit = 1 → LED off
  const bits = Array.from({ length: 8 }, (_, i) => {
    const bitIndex = 7 - i;                       // D7 on left → D0 on right
    return ((value >> bitIndex) & 1) === 0;        // inverted: 0 = lit
  });

  return (
    <div>
      {/* Divider above (only when panel is visible) */}
      <div style={{ borderTop: '1px solid #21262d', marginBottom: 14 }} />
      <div style={{
        color: '#8b949e',
        fontSize: 11,
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginBottom: 6,
      }}>
        Programmed Output  <span style={{ color: '#6e7681', fontSize: 10 }}>port 0xFF</span>
      </div>

      {/* Panel body — styled after the IMSAI 8080 front panel section */}
      <div style={{
        background: '#1a0a0a',
        border: '1px solid #3a1a1a',
        borderRadius: 4,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        {/* LED row */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'space-between' }}>
          {bits.map((on, i) => <Led key={i} on={on} />)}
        </div>

        {/* Bit labels */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingLeft: 1,
          paddingRight: 1,
        }}>
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} style={{
              color: '#6e7681',
              fontSize: 10,
              fontFamily: 'monospace',
              width: 14,
              textAlign: 'center',
            }}>
              D{7 - i}
            </span>
          ))}
        </div>

        {/* Hex readout */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          borderTop: '1px solid #2a0f0f',
          paddingTop: 5,
          marginTop: 1,
        }}>
          <span style={{ color: '#6e7681', fontSize: 10, fontFamily: 'monospace' }}>
            OUT 0xFF =
          </span>
          <span style={{ color: '#f85149', fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>
            {value.toString(16).toUpperCase().padStart(2, '0')}H
          </span>
          <span style={{ color: '#8b949e', fontSize: 10, fontFamily: 'monospace' }}>
            ({value.toString(2).padStart(8, '0')}b)
          </span>
        </div>
      </div>
    </div>
  );
}
