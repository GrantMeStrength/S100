// MITS 88-2SIO serial card emulation (MC6850 ACIA)
// Port protocol:
//   0x10 IN  = status: bit0=RDRF (1=char available), bit1=TDRE (1=TX ready, always 1)
//   0x10 OUT = control (master reset / init — accepted but ignored in emulation)
//   0x11 IN  = read received data byte
//   0x11 OUT = write data byte to transmit

use std::any::Any;
use std::collections::VecDeque;
use crate::card::S100Card;

const PORT_STATUS: u8 = 0x10;
const PORT_DATA:   u8 = 0x11;

pub struct Sio88Card {
    name:   String,
    rx_buf: VecDeque<u8>,
    tx_buf: VecDeque<u8>,
}

impl Sio88Card {
    pub fn new(name: impl Into<String>) -> Self {
        Sio88Card { name: name.into(), rx_buf: VecDeque::new(), tx_buf: VecDeque::new() }
    }

    pub fn drain_tx(&mut self) -> Vec<u8> {
        self.tx_buf.drain(..).collect()
    }

    pub fn push_rx(&mut self, byte: u8) {
        self.rx_buf.push_back(byte);
    }
}

impl S100Card for Sio88Card {
    fn name(&self) -> &str { &self.name }

    fn reset(&mut self) {
        self.rx_buf.clear();
        self.tx_buf.clear();
    }

    fn memory_read(&mut self, _addr: u16) -> Option<u8> { None }
    fn memory_write(&mut self, _addr: u16, _data: u8) {}

    fn io_read(&mut self, port: u8) -> Option<u8> {
        match port {
            PORT_STATUS => {
                // bit0 = RDRF (receive data register full)
                // bit1 = TDRE (transmit data register empty — always 1 in emulation)
                let rdrf = if self.rx_buf.is_empty() { 0 } else { 1 };
                Some(rdrf | 0x02)
            }
            PORT_DATA => Some(self.rx_buf.pop_front().unwrap_or(0)),
            _ => None,
        }
    }

    fn io_write(&mut self, port: u8, data: u8) {
        match port {
            PORT_STATUS => { /* control register — master reset / baud rate divisor, ignored */ }
            PORT_DATA   => { self.tx_buf.push_back(data); }
            _ => {}
        }
    }

    fn as_any(&self)         -> &dyn Any     { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
}
