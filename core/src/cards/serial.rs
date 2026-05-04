use std::any::Any;
use std::collections::VecDeque;
use crate::card::S100Card;

/// Polled serial UART card (no interrupts in MVP).
///
/// Status register bits:
///   bit 0: RX data available
///   bit 1: TX buffer empty (always 1 in this model — no flow control)
pub struct SerialCard {
    name: String,
    pub data_port: u8,
    pub status_port: u8,
    pub rx_buf: VecDeque<u8>,
    pub tx_buf: VecDeque<u8>,
}

impl SerialCard {
    pub fn new(name: impl Into<String>, data_port: u8, status_port: u8) -> Self {
        SerialCard {
            name: name.into(),
            data_port,
            status_port,
            rx_buf: VecDeque::new(),
            tx_buf: VecDeque::new(),
        }
    }

    pub fn push_rx(&mut self, byte: u8) {
        self.rx_buf.push_back(byte);
    }

    pub fn drain_tx(&mut self) -> Vec<u8> {
        self.tx_buf.drain(..).collect()
    }
}

impl S100Card for SerialCard {
    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
    fn name(&self) -> &str { &self.name }
    fn reset(&mut self) {
        self.rx_buf.clear();
        self.tx_buf.clear();
    }

    fn memory_read(&mut self, _addr: u16) -> Option<u8> { None }
    fn memory_write(&mut self, _addr: u16, _data: u8) {}

    fn io_read(&mut self, port: u8) -> Option<u8> {
        if port == self.data_port {
            Some(self.rx_buf.pop_front().unwrap_or(0))
        } else if port == self.status_port {
            let rx_ready = if self.rx_buf.is_empty() { 0 } else { 1 };
            Some(rx_ready | 0x02) // TX always ready
        } else {
            None
        }
    }

    fn io_write(&mut self, port: u8, data: u8) {
        if port == self.data_port {
            self.tx_buf.push_back(data);
        }
        // Writes to status port are ignored
    }
}
