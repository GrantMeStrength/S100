use std::any::Any;

/// Every S-100 peripheral card implements this trait.
/// Cards decline to handle a request by returning `None` from read methods.
/// Bus iterates cards in slot order; first `Some(...)` wins.
pub trait S100Card: Any {
    /// Downcasting support.
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;

    fn name(&self) -> &str;
    fn reset(&mut self);

    /// Return `Some(byte)` if this card owns `addr`, else `None`.
    fn memory_read(&mut self, addr: u16) -> Option<u8>;
    fn memory_write(&mut self, addr: u16, data: u8);

    fn io_read(&mut self, port: u8) -> Option<u8>;
    fn io_write(&mut self, port: u8, data: u8);

    /// Called once per emulated machine cycle (for DMA, timers, etc.).
    fn step(&mut self) {}
}
