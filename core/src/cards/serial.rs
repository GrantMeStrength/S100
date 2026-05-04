use std::any::Any;
use std::collections::VecDeque;
use crate::card::S100Card;

/// Polled serial UART card (no interrupts in MVP).
///
/// Supports asymmetric TX/RX ports (e.g. Z80 SIO / Memon/80 JAIR):
///   tx_port      — OUT to this port sends a character (default = data_port)
///   rx_port      — IN from this port receives a character (default = data_port)
///   status_port  — IN returns status byte
///   status_rx_bit — which bit of status indicates "RX data available" (default 0)
///   status_tx_bit — which bit of status indicates "TX buffer empty"   (default 1)
pub struct SerialCard {
    name: String,
    pub data_port: u8,
    pub status_port: u8,
    pub tx_port: u8,
    pub rx_port: u8,
    pub status_rx_bit: u8,
    pub status_tx_bit: u8,
    pub rx_buf: VecDeque<u8>,
    pub tx_buf: VecDeque<u8>,
}

impl SerialCard {
    pub fn new(name: impl Into<String>, data_port: u8, status_port: u8) -> Self {
        SerialCard {
            name: name.into(),
            data_port,
            status_port,
            tx_port: data_port,
            rx_port: data_port,
            status_rx_bit: 0,
            status_tx_bit: 1,
            rx_buf: VecDeque::new(),
            tx_buf: VecDeque::new(),
        }
    }

    pub fn with_ports(
        name: impl Into<String>,
        tx_port: u8, rx_port: u8, status_port: u8,
        status_rx_bit: u8, status_tx_bit: u8,
    ) -> Self {
        SerialCard {
            name: name.into(),
            data_port: rx_port, // data_port kept for downcast compatibility
            status_port,
            tx_port,
            rx_port,
            status_rx_bit,
            status_tx_bit,
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
        if port == self.rx_port {
            Some(self.rx_buf.pop_front().unwrap_or(0))
        } else if port == self.status_port {
            let rx_bit = if self.rx_buf.is_empty() { 0u8 } else { 1u8 << self.status_rx_bit };
            let tx_bit = 1u8 << self.status_tx_bit; // TX always ready
            Some(rx_bit | tx_bit)
        } else {
            None
        }
    }

    fn io_write(&mut self, port: u8, data: u8) {
        if port == self.tx_port {
            self.tx_buf.push_back(data);
        }
        // Writes to status/control port are ignored (init commands accepted silently)
    }

    fn owns_io(&self, port: u8) -> bool {
        port == self.tx_port || port == self.rx_port || port == self.status_port
    }
}
