use std::any::Any;
use std::collections::VecDeque;
use crate::card::S100Card;

/// Polled serial UART card (no interrupts in MVP).
///
/// Supports asymmetric TX/RX ports and separate TX/RX status ports:
///   tx_port           — OUT to this port sends a character (default = data_port)
///   rx_port           — IN from this port receives a character (default = data_port)
///   status_port       — IN returns TX status (bit status_tx_bit set/cleared per polarity)
///   rx_status_port    — IN returns RX status (defaults to status_port = combined register)
///   status_rx_bit     — which bit indicates "RX data available" (default 0)
///   status_tx_bit     — which bit indicates "TX buffer empty" (default 1)
///   status_rx_invert  — if true, bit is CLEARED when data ready (active-low, e.g. 88-SIO)
///   status_tx_invert  — if true, bit is SET when TX busy instead of when TX ready
///   seven_bit         — if true, strip bit 7 from all TX bytes (7-bit ASCII, e.g. 88-SIO)
pub struct SerialCard {
    name: String,
    pub data_port: u8,
    pub status_port: u8,
    pub tx_port: u8,
    pub rx_port: u8,
    pub rx_status_port: u8,
    pub status_rx_bit: u8,
    pub status_tx_bit: u8,
    pub status_rx_invert: bool,
    pub status_tx_invert: bool,
    pub seven_bit: bool,
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
            rx_status_port: status_port,   // same port for both TX and RX status
            status_rx_bit: 0,
            status_tx_bit: 1,
            status_rx_invert: false,
            status_tx_invert: false,
            seven_bit: false,
            rx_buf: VecDeque::new(),
            tx_buf: VecDeque::new(),
        }
    }

    pub fn with_ports(
        name: impl Into<String>,
        tx_port: u8, rx_port: u8, status_port: u8,
        rx_status_port: u8,
        status_rx_bit: u8, status_tx_bit: u8,
        status_rx_invert: bool, status_tx_invert: bool,
    ) -> Self {
        SerialCard {
            name: name.into(),
            data_port: rx_port,
            status_port,
            tx_port,
            rx_port,
            rx_status_port,
            status_rx_bit,
            status_tx_bit,
            status_rx_invert,
            status_tx_invert,
            seven_bit: false,
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

    /// Returns the TX status bit value: SET when TX ready (normal) or SET when TX busy (inverted).
    fn tx_status_bit(&self) -> u8 {
        // TX is always ready in our emulator (no outgoing buffer backpressure).
        // Normal (invert=false): bit SET when ready.
        // Inverted (invert=true): bit SET when BUSY (i.e., cleared when ready).
        if !self.status_tx_invert { 1u8 << self.status_tx_bit } else { 0 }
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
        } else if port == self.rx_status_port {
            // RX status: bit SET when ready (normal) or CLEARED when ready (inverted)
            let rx_ready = !self.rx_buf.is_empty();
            let rx_bit = if rx_ready ^ self.status_rx_invert {
                1u8 << self.status_rx_bit
            } else { 0 };
            // If rx_status_port == status_port, also include TX status
            let tx_bit = if self.rx_status_port == self.status_port {
                self.tx_status_bit()
            } else { 0 };
            Some(rx_bit | tx_bit)
        } else if port == self.status_port {
            // TX-only status port (used when rx_status_port is different)
            Some(self.tx_status_bit())
        } else {
            None
        }
    }

    fn io_write(&mut self, port: u8, data: u8) {
        if port == self.tx_port {
            let byte = if self.seven_bit { data & 0x7F } else { data };
            self.tx_buf.push_back(byte);
        }
        // Writes to status/control port are ignored (init commands accepted silently)
    }

    fn owns_io(&self, port: u8) -> bool {
        port == self.tx_port || port == self.rx_port
            || port == self.status_port || port == self.rx_status_port
    }
}
