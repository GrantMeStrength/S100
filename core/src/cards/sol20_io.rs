// Processor Technology SOL-20 on-board I/O emulation.
//
// The SOL-20 motherboard integrates keyboard, tape, and serial UART functions
// that external S-100 machines would normally provide via a 3P+S card.
// All I/O is polled (no interrupts in this emulation).
//
// Port map (verified from SOLOS v1.3 source):
//   0xFA  R  STAPT — keyboard + tape status register
//              bit 0 (KDR):  keyboard data ready, **active-LOW**
//                            (SOLOS inverts with CMA before testing)
//              bit 6 (TDR):  tape data ready, active-HIGH (stubbed)
//              bit 7 (TTBE): tape TX buffer empty, active-HIGH (stubbed 1)
//   0xFC  R  KDATA — keyboard data (ASCII byte)
//   0xF8  R  SERST — serial status register
//              bit 6 (SDR):  serial RX data ready, active-HIGH
//              bit 7 (STBE): serial TX buffer empty, active-HIGH
//   0xF9  RW SDATA — serial data (RS-232; TX echoed to terminal output)
//   0xFE  W  DSTAT — VDM-1 display parameter port (scroll/offset)
//              handled by the VDM card; we claim the write port so SOLOS
//              OUT 0xFE calls don't cause bus noise
//
// The keyboard input queue is fed by the frontend via Machine::send_serial_input,
// which routes bytes here when serial_idx points to this card.

use std::any::Any;
use std::collections::VecDeque;
use crate::card::S100Card;

const PORT_KB_STATUS:  u8 = 0xFA;
const PORT_KB_DATA:    u8 = 0xFC;
const PORT_SER_STATUS: u8 = 0xF8;
const PORT_SER_DATA:   u8 = 0xF9;
const PORT_VDM_DSTAT:  u8 = 0xFE;

pub struct Sol20IoCard {
    name:       String,
    kb_buf:     VecDeque<u8>,   // keyboard input queue (from frontend)
    ser_tx_buf: VecDeque<u8>,   // serial TX output (to terminal)
    ser_rx_buf: VecDeque<u8>,   // serial RX input (stub; unused in SOLOS)
}

impl Sol20IoCard {
    pub fn new(name: impl Into<String>) -> Self {
        Sol20IoCard {
            name:       name.into(),
            kb_buf:     VecDeque::new(),
            ser_tx_buf: VecDeque::new(),
            ser_rx_buf: VecDeque::new(),
        }
    }

    pub fn push_rx(&mut self, byte: u8) {
        self.kb_buf.push_back(byte);
    }

    pub fn drain_tx(&mut self) -> Vec<u8> {
        self.ser_tx_buf.drain(..).collect()
    }
}

impl S100Card for Sol20IoCard {
    fn name(&self) -> &str { &self.name }

    fn reset(&mut self) {
        self.kb_buf.clear();
        self.ser_tx_buf.clear();
        self.ser_rx_buf.clear();
    }

    fn memory_read(&mut self, _addr: u16) -> Option<u8> { None }
    fn memory_write(&mut self, _addr: u16, _data: u8) {}

    fn io_read(&mut self, port: u8) -> Option<u8> {
        match port {
            PORT_KB_STATUS => {
                // Bit 0 is active-LOW: 0 = key ready, 1 = no key.
                // Bit 7 (TTBE) = tape TX buffer empty — always 1 (tape stubbed).
                if self.kb_buf.is_empty() {
                    Some(0xFF)   // no key: bit 0 HIGH, all others HIGH
                } else {
                    Some(0xFE)   // key ready: bit 0 LOW, bit 7 HIGH
                }
            }
            PORT_KB_DATA => {
                Some(self.kb_buf.pop_front().unwrap_or(0))
            }
            PORT_SER_STATUS => {
                // Bit 7 (STBE) = TX buffer empty — always 1.
                // Bit 6 (SDR)  = serial RX data ready.
                let sdr = if self.ser_rx_buf.is_empty() { 0x00 } else { 0x40 };
                Some(0x80 | sdr)
            }
            PORT_SER_DATA => {
                Some(self.ser_rx_buf.pop_front().unwrap_or(0))
            }
            _ => None,
        }
    }

    fn io_write(&mut self, port: u8, data: u8) {
        match port {
            PORT_SER_DATA => {
                self.ser_tx_buf.push_back(data);
            }
            PORT_VDM_DSTAT => {
                // The VDM card also claims this port for scroll control; we
                // absorb writes here so the bus doesn't log them as unhandled.
            }
            _ => {}
        }
    }

    fn step(&mut self) {}

    fn as_any_mut(&mut self) -> &mut dyn Any { self }
    fn as_any(&self) -> &dyn Any { self }
}
