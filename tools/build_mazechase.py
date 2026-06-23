#!/usr/bin/env python3
"""
MAZECHASE — A Pac-Man style maze chase game for the Cromemco Dazzler + D+7A joystick.
Builds a CP/M .COM file (Z80 machine code, ORG 0x0100).

Display: 64×64 color, 2K normal mode (16 IBGR colors)
Framebuffer: 0x2000 (page 0x10), 2048 bytes

Maze: 16×16 cells, each cell = 4×4 pixels = full 64×64 display
Player: 3×3 yellow, moves cell-to-cell
Ghosts: 3×3 pixels (red, magenta, cyan), simple chase AI
Dots: 1×1 white pixel at center of each path cell

Joystick: Cromemco D+7A
  Port 0x18: buttons (active-LOW, bit0=Btn1, bit1=Btn2)
  Port 0x19: X-axis (0=center, 1-127=right, 128-255=left)
  Port 0x1A: Y-axis (0=center, 1-127=up, 128-255=down)

Controls: Joystick to move, Button 1 = exit to CP/M
"""

import os, sys

# ─── Mini Z80 assembler (same as STARDUST) ──────────────────────────────────────

class Z80:
    def __init__(self, org=0x0100):
        self.org = org
        self.code = bytearray()
        self.labels = {}
        self.fixups = []

    @property
    def pc(self):
        return self.org + len(self.code)

    def label(self, name):
        if name in self.labels:
            raise ValueError(f"Duplicate label: {name}")
        self.labels[name] = self.pc

    def emit(self, *bs):
        for b in bs:
            self.code.append(b & 0xFF)

    def emit16(self, v):
        self.emit(v & 0xFF, (v >> 8) & 0xFF)

    def db(self, *vals):
        for v in vals:
            if isinstance(v, (bytes, bytearray)):
                self.code.extend(v)
            elif isinstance(v, str):
                self.code.extend(v.encode('ascii'))
            else:
                self.emit(v)

    def ds(self, n, fill=0):
        self.code.extend([fill] * n)

    def _ref16(self, lbl):
        self.fixups.append((len(self.code), lbl, 16))
        self.emit16(0)

    def _ref8(self, lbl):
        self.fixups.append((len(self.code), lbl, 8))
        self.emit(0)

    def resolve(self):
        for off, lbl, bits in self.fixups:
            if lbl not in self.labels:
                raise ValueError(f"Undefined label: {lbl}")
            addr = self.labels[lbl]
            if bits == 16:
                self.code[off] = addr & 0xFF
                self.code[off+1] = (addr >> 8) & 0xFF
            else:
                rel = addr - (self.org + off + 1)
                if rel < -128 or rel > 127:
                    raise ValueError(f"JR out of range: {lbl} (offset {rel})")
                self.code[off] = rel & 0xFF

    def save(self, path):
        self.resolve()
        with open(path, 'wb') as f:
            f.write(self.code)
        print(f"Written {len(self.code)} bytes → {path}")

    # Register encodings
    R = {'b':0,'c':1,'d':2,'e':3,'h':4,'l':5,'(hl)':6,'a':7}
    RP = {'bc':0,'de':1,'hl':2,'sp':3}
    RP2 = {'bc':0,'de':1,'hl':2,'af':3}
    CC = {'nz':0,'z':1,'nc':2,'c':3}

    # Instructions
    def nop(self): self.emit(0x00)
    def di(self): self.emit(0xF3)
    def ei(self): self.emit(0xFB)
    def ret(self): self.emit(0xC9)
    def cpl(self): self.emit(0x2F)
    def halt(self): self.emit(0x76)
    def daa(self): self.emit(0x27)

    def ld_r_r(self, d, s): self.emit(0x40 + self.R[d]*8 + self.R[s])
    def ld_r_n(self, r, n): self.emit(0x06 + self.R[r]*8, n & 0xFF)
    def ld_rp_nn(self, rp, nn): self.emit(0x01 + self.RP[rp]*16); self.emit16(nn)
    def ld_rp_label(self, rp, lbl): self.emit(0x01 + self.RP[rp]*16); self._ref16(lbl)
    def ld_a_addr(self, addr): self.emit(0x3A); self.emit16(addr)
    def ld_a_lbl(self, lbl): self.emit(0x3A); self._ref16(lbl)
    def ld_lbl_a(self, lbl): self.emit(0x32); self._ref16(lbl)
    def ld_a_de(self): self.emit(0x1A)
    def ld_de_a(self): self.emit(0x12)
    def ld_sp_hl(self): self.emit(0xF9)
    def ld_hl_r(self, r): self.emit(0x70 + self.R[r])  # LD (HL), r
    def ld_r_hl(self, r): self.emit(0x46 + self.R[r]*8)  # LD r, (HL)

    def push(self, rp): self.emit(0xC5 + self.RP2[rp]*16)
    def pop(self, rp): self.emit(0xC1 + self.RP2[rp]*16)

    def inc_r(self, r): self.emit(0x04 + self.R[r]*8)
    def dec_r(self, r): self.emit(0x05 + self.R[r]*8)
    def inc_rp(self, rp): self.emit(0x03 + self.RP[rp]*16)
    def dec_rp(self, rp): self.emit(0x0B + self.RP[rp]*16)

    def add_a_r(self, r): self.emit(0x80 + self.R[r])
    def add_a_n(self, n): self.emit(0xC6, n & 0xFF)
    def adc_a_r(self, r): self.emit(0x88 + self.R[r])
    def sub_r(self, r): self.emit(0x90 + self.R[r])
    def sub_n(self, n): self.emit(0xD6, n & 0xFF)
    def and_r(self, r): self.emit(0xA0 + self.R[r])
    def and_n(self, n): self.emit(0xE6, n & 0xFF)
    def or_r(self, r): self.emit(0xB0 + self.R[r])
    def or_n(self, n): self.emit(0xF6, n & 0xFF)
    def xor_r(self, r): self.emit(0xA8 + self.R[r])
    def xor_n(self, n): self.emit(0xEE, n & 0xFF)
    def cp_r(self, r): self.emit(0xB8 + self.R[r])
    def cp_n(self, n): self.emit(0xFE, n & 0xFF)
    def add_hl_rp(self, rp): self.emit(0x09 + self.RP[rp]*16)

    def in_a(self, p): self.emit(0xDB, p & 0xFF)
    def out_a(self, p): self.emit(0xD3, p & 0xFF)

    def jr(self, cc_or_lbl, lbl2=None):
        if lbl2: self.emit(0x20 + self.CC[cc_or_lbl]*8); self._ref8(lbl2)
        else:    self.emit(0x18); self._ref8(cc_or_lbl)

    def jp(self, cc_or_lbl, lbl2=None):
        if lbl2: self.emit(0xC2 + self.CC[cc_or_lbl]*8); self._ref16(lbl2)
        else:    self.emit(0xC3); self._ref16(cc_or_lbl)

    def call(self, cc_or_lbl, lbl2=None):
        if lbl2: self.emit(0xC4 + self.CC[cc_or_lbl]*8); self._ref16(lbl2)
        else:    self.emit(0xCD); self._ref16(cc_or_lbl)

    def ret_cc(self, cc): self.emit(0xC0 + self.CC[cc]*8)
    def djnz(self, lbl): self.emit(0x10); self._ref8(lbl)
    def jp_hl(self): self.emit(0xE9)

    def srl(self, r): self.emit(0xCB, 0x38 + self.R[r])
    def sla(self, r): self.emit(0xCB, 0x20 + self.R[r])
    def rl(self, r):  self.emit(0xCB, 0x10 + self.R[r])
    def rr(self, r):  self.emit(0xCB, 0x18 + self.R[r])
    def bit(self, b, r): self.emit(0xCB, 0x40 + b*8 + self.R[r])
    def set_bit(self, b, r): self.emit(0xCB, 0xC0 + b*8 + self.R[r])
    def res_bit(self, b, r): self.emit(0xCB, 0x80 + b*8 + self.R[r])
    def rra(self): self.emit(0x1F)
    def rla(self): self.emit(0x17)
    def rlca(self): self.emit(0x07)
    def rrca(self): self.emit(0x0F)

    def ldir(self): self.emit(0xED, 0xB0)
    def neg(self): self.emit(0xED, 0x44)

# ─── Constants ──────────────────────────────────────────────────────────────────
# IBGR colors
BLACK, RED, GREEN, YELLOW = 0, 1, 2, 3
BLUE, MAGENTA, CYAN, WHITE = 4, 5, 6, 7
BRIGHT_RED, BRIGHT_GRN, BRIGHT_YEL = 9, 0x0A, 0x0B
BRIGHT_BLU, BRIGHT_MAG, BRIGHT_CYN, BRIGHT_WHT = 0x0C, 0x0D, 0x0E, 0x0F

# Hardware
DAZ_NX, DAZ_CC = 0x0E, 0x0F
JOY_BTN, JOY_X, JOY_Y = 0x18, 0x19, 0x1A
FB_PAGE = 0x10
FB_BASE = 0x2000
FB_SIZE = 2048

# Game constants
MAZE_W, MAZE_H = 16, 16
CELL_SIZE = 4       # pixels per cell
NUM_GHOSTS = 3
PLAYER_START_X, PLAYER_START_Y = 1, 1
GHOST_START_X, GHOST_START_Y = 7, 7

# Directions: 0=right, 1=down, 2=left, 3=up, 4=none
DIR_RIGHT, DIR_DOWN, DIR_LEFT, DIR_UP, DIR_NONE = 0, 1, 2, 3, 4

# ─── Maze design ────────────────────────────────────────────────────────────────
# 16×16 grid: 1=wall, 0=path
# Designed to be symmetric and fun with tunnels on sides
MAZE = [
    #0123456789ABCDEF
    "################",  # 0
    "#......##......#",  # 1
    "#.####.##.####.#",  # 2
    "#..............#",  # 3
    "#.##.#.##.#.##.#",  # 4
    "#....#....#....#",  # 5
    "####.##..##.####",  # 6
    "......#..#......",  # 7  (tunnels - open sides)
    "####.#....#.####",  # 8
    "#....#.##.#....#",  # 9
    "#.##...##...##.#",  # 10
    "#..............#",  # 11
    "#.##.#.##.#.##.#",  # 12
    "#....#....#....#",  # 13
    "#.####.##.####.#",  # 14
    "################",  # 15
]

def maze_to_bytes(maze):
    """Convert maze to bit-packed bytes (2 bytes per row, MSB first)."""
    data = []
    for row in maze:
        hi = 0
        lo = 0
        for c in range(8):
            if row[c] == '#':
                hi |= (0x80 >> c)
        for c in range(8):
            if row[8 + c] == '#':
                lo |= (0x80 >> c)
        data.append(hi)
        data.append(lo)
    return data

def count_dots(maze):
    """Count path cells (dots) in the maze."""
    count = 0
    for row in maze:
        for ch in row:
            if ch == '.':
                count += 1
    return count

def dots_to_bytes(maze):
    """Initial dot state: 1=dot present (matches path cells)."""
    data = []
    for row in maze:
        hi = 0
        lo = 0
        for c in range(8):
            if row[c] == '.':
                hi |= (0x80 >> c)
        for c in range(8):
            if row[8 + c] == '.':
                lo |= (0x80 >> c)
        data.append(hi)
        data.append(lo)
    return data

MAZE_DATA = maze_to_bytes(MAZE)
DOTS_DATA = dots_to_bytes(MAZE)
TOTAL_DOTS = count_dots(MAZE)

print(f"Maze: {MAZE_W}×{MAZE_H}, {TOTAL_DOTS} dots")

# ═══════════════════════════════════════════════════════════════════════════════

a = Z80()

# ─── Entry ─────────────────────────────────────────────────────────────────────
a.label('start')
a.di()
a.ld_rp_nn('sp', 0x1F00)

# Init Dazzler: normal, 2K, color
a.ld_r_n('a', 0x30)
a.out_a(DAZ_CC)
a.ld_r_n('a', 0x80 | FB_PAGE)
a.out_a(DAZ_NX)

# Seed RNG
a.in_a(DAZ_NX)
a.ld_lbl_a('rng')

a.label('restart')
a.call('init_game')

# ─── Main loop ─────────────────────────────────────────────────────────────────
# Initial full draw (once) — jumps to full_redraw which sets up then enters main_loop
a.jp('full_redraw')

a.label('main_loop')
a.call('vsync')
a.call('input')
a.call('check_exit')

# Erase player at current position (black 3×3)
a.call('erase_player')
# Erase ghosts at current positions
a.call('erase_ghosts')

# Move
a.call('move_player')
a.call('move_ghosts')
a.call('eat_dot')
a.call('check_ghost_col')

# Draw at new positions
a.call('draw_player')
a.call('draw_ghosts')
a.call('draw_score')

# Check win (all dots eaten)
a.ld_a_lbl('dot_count')
a.or_r('a')
a.jp('z', 'level_clear')

# Check lives
a.ld_a_lbl('lives')
a.or_r('a')
a.jp('z', 'game_over')

a.jp('main_loop')

# ─── Level clear ──────────────────────────────────────────────────────────────
a.label('level_clear')
a.call('flash_screen')
a.call('init_level')
# Full redraw after level reset
a.label('full_redraw')
a.call('clear_fb')
a.call('draw_maze')
a.call('draw_dots')
a.call('draw_player')
a.call('draw_ghosts')
a.call('draw_score')
a.jp('main_loop')

# ─── Game over ────────────────────────────────────────────────────────────────
a.label('game_over')
a.call('clear_fb')
# Draw red border
a.ld_r_n('d', 0)
a.ld_r_n('e', 0)
a.ld_r_n('b', 64)
a.ld_r_n('c', BRIGHT_RED)
a.call('hline')
a.ld_r_n('d', 0)
a.ld_r_n('e', 63)
a.ld_r_n('b', 64)
a.call('hline')
# Draw score
a.call('draw_score')
a.call('vsync')
a.call('wait_fire')
a.jp('restart')


# ═══════════════════════════════════════════════════════════════════════════════
#  SUBROUTINES
# ═══════════════════════════════════════════════════════════════════════════════

# ─── vsync ─────────────────────────────────────────────────────────────────────
a.label('vsync')
a.label('vs1')
a.in_a(DAZ_NX)
a.and_n(0x40)
a.jr('nz', 'vs1')
a.label('vs2')
a.in_a(DAZ_NX)
a.and_n(0x40)
a.jr('z', 'vs2')
a.ret()

# ─── clear_fb ──────────────────────────────────────────────────────────────────
a.label('clear_fb')
a.ld_rp_nn('hl', FB_BASE)
a.ld_rp_nn('de', FB_BASE + 1)
a.ld_rp_nn('bc', FB_SIZE - 1)
a.ld_r_n('(hl)', 0)
a.ldir()
a.ret()

# ─── plot: pixel at D=x(0-63), E=y(0-63), color C. Clobbers A,HL ─────────────
a.label('plot')
a.push('bc')
a.push('de')

# Bounds check
a.ld_r_r('a', 'd')
a.cp_n(64)
a.jp('nc', 'pl_out')
a.ld_r_r('a', 'e')
a.cp_n(64)
a.jp('nc', 'pl_out')

# Compute framebuffer address in HL
a.ld_rp_nn('hl', FB_BASE)

# Quadrant X: if x >= 32 → HL += 512
a.ld_r_r('a', 'd')
a.and_n(0x20)
a.jr('z', 'pl_lx')
a.push('bc')
a.ld_rp_nn('bc', 512)
a.add_hl_rp('bc')
a.pop('bc')
a.label('pl_lx')

# Quadrant Y: if y >= 32 → HL += 1024
a.ld_r_r('a', 'e')
a.and_n(0x20)
a.jr('z', 'pl_ly')
a.push('bc')
a.ld_rp_nn('bc', 1024)
a.add_hl_rp('bc')
a.pop('bc')
a.label('pl_ly')

# Local coords (0-31)
a.ld_r_r('a', 'd')
a.and_n(0x1F)
a.ld_r_r('d', 'a')
a.ld_r_r('a', 'e')
a.and_n(0x1F)

# HL += y * 16
a.push('de')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d')
a.add_hl_rp('de')
a.pop('de')

# HL += x / 2
a.ld_r_r('a', 'd')
a.srl('a')
a.push('de')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.add_hl_rp('de')
a.pop('de')

# Set the appropriate nibble
a.ld_r_r('a', 'd')
a.and_n(1)
a.jr('nz', 'pl_hi')

# Even x → low nibble
a.ld_r_r('a', '(hl)')
a.and_n(0xF0)
a.or_r('c')
a.ld_r_r('(hl)', 'a')
a.jr('pl_out')

a.label('pl_hi')
# Odd x → high nibble
a.ld_r_r('a', 'c')
a.sla('a'); a.sla('a'); a.sla('a'); a.sla('a')
a.ld_r_r('b', 'a')
a.ld_r_r('a', '(hl)')
a.and_n(0x0F)
a.or_r('b')
a.ld_r_r('(hl)', 'a')

a.label('pl_out')
a.pop('de')
a.pop('bc')
a.ret()

# ─── hline: D=x, E=y, B=width, C=color ───────────────────────────────────────
a.label('hline')
a.push('bc')
a.push('de')
a.label('hl_lp')
a.call('plot')
a.inc_r('d')
a.djnz('hl_lp')
a.pop('de')
a.pop('bc')
a.ret()


# ─── input ─────────────────────────────────────────────────────────────────────
a.label('input')
a.in_a(JOY_X)
a.ld_lbl_a('in_x')
a.in_a(JOY_Y)
a.ld_lbl_a('in_y')
a.in_a(JOY_BTN)
a.ld_lbl_a('in_btn')

# Determine desired direction from joystick
# Priority: last moved axis. Check X first, then Y.
a.ld_a_lbl('in_x')
a.cp_n(128)
a.jr('nc', 'in_left')
a.or_r('a')
a.jr('z', 'in_chky')     # center
# Right (1-127)
a.ld_r_n('a', DIR_RIGHT)
a.ld_lbl_a('want_dir')
a.ret()
a.label('in_left')
# Left (128-255)
a.ld_r_n('a', DIR_LEFT)
a.ld_lbl_a('want_dir')
a.ret()

a.label('in_chky')
a.ld_a_lbl('in_y')
a.cp_n(128)
a.jr('nc', 'in_down')
a.or_r('a')
a.jr('z', 'in_done')     # center
# Up (1-127): joystick pushed up = positive on real hardware
a.ld_r_n('a', DIR_UP)
a.ld_lbl_a('want_dir')
a.ret()
a.label('in_down')
# Down (128-255): joystick pushed down = negative on real hardware
a.ld_r_n('a', DIR_DOWN)
a.ld_lbl_a('want_dir')
a.ret()
a.label('in_done')
a.ret()


# ─── check_exit: Button 1 (bit 0) exits to CP/M ─────────────────────────────
a.label('check_exit')
a.ld_a_lbl('in_btn')
a.bit(0, 'a')
a.ret_cc('nz')           # not pressed
# Exit
a.ld_r_n('a', 0x00)
a.out_a(DAZ_NX)
a.ei()
a.emit(0xC3); a.emit16(0x0000)  # JP 0x0000


# ─── is_wall: check if cell (B=x, C=y) is a wall. Returns Z=wall, NZ=path ───
# Clobbers A, HL, DE
a.label('is_wall')
a.push('bc')
# Handle tunnel wrap: x & 0x0F (mod 16)
a.ld_r_r('a', 'b')
a.and_n(0x0F)
a.ld_r_r('b', 'a')
# HL = maze_data + y * 2
a.ld_rp_label('hl', 'maze_data')
a.ld_r_r('a', 'c')
a.sla('a')               # A = y * 2
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.add_hl_rp('de')
# Now HL points to row byte pair. x < 8 → first byte, x >= 8 → second byte
a.ld_r_r('a', 'b')
a.cp_n(8)
a.jr('nc', 'iw_hi')
# x < 8: bit = 7 - x in first byte
a.ld_r_r('a', '(hl)')
a.ld_r_r('e', 'a')      # E = maze byte
a.ld_r_n('a', 7)
a.sub_r('b')             # A = 7 - x = bit position
a.jr('iw_test')

a.label('iw_hi')
# x >= 8: bit = 15 - x = 7 - (x-8) in second byte
a.inc_rp('hl')
a.ld_r_r('a', '(hl)')
a.ld_r_r('e', 'a')      # E = maze byte
a.ld_r_r('a', 'b')
a.sub_n(8)
a.ld_r_r('b', 'a')      # B = x - 8
a.ld_r_n('a', 7)
a.sub_r('b')             # A = 7 - (x-8) = bit position

a.label('iw_test')
# Test bit A of byte E. Shift E right by (7-A) ... actually shift E left by A
# Simpler: use a mask. Rotate 0x80 right by (7 - bit) = left by... 
# Actually: mask = 1 << bit_pos. Test E & mask.
# Create mask: start with 1, shift left A times
a.ld_r_r('b', 'a')      # B = shift count
a.or_r('a')
a.jr('z', 'iw_noshift')
a.ld_r_n('a', 1)
a.label('iw_shlp')
a.sla('a')
a.djnz('iw_shlp')
a.jr('iw_dotest')
a.label('iw_noshift')
a.ld_r_n('a', 1)        # bit 0
a.label('iw_dotest')
# A = mask, E = byte
a.and_r('e')             # Z if bit clear (path), NZ if bit set (wall)
a.pop('bc')
a.ret()


# ─── move_player ──────────────────────────────────────────────────────────────
a.label('move_player')
# Move timer
a.ld_a_lbl('ptimer')
a.inc_r('a')
a.ld_lbl_a('ptimer')
a.cp_n(4)               # Move every 4 frames
a.ret_cc('nz')
a.xor_r('a')
a.ld_lbl_a('ptimer')

# Try wanted direction first
a.ld_a_lbl('want_dir')
a.cp_n(DIR_NONE)
a.jr('z', 'mp_cur')     # no input, try current dir

# Check if wanted direction is valid
a.ld_a_lbl('want_dir')
a.call('try_dir')        # Returns Z=free, NZ=blocked
a.jr('nz', 'mp_cur')    # blocked, try current

# Wanted dir is valid — adopt it
a.ld_a_lbl('want_dir')
a.ld_lbl_a('pdir')
a.call('apply_move')
a.ret()

a.label('mp_cur')
# Try current direction
a.ld_a_lbl('pdir')
a.cp_n(DIR_NONE)
a.ret_cc('z')            # no direction set
a.call('try_dir')
a.ret_cc('nz')           # blocked
a.ld_a_lbl('pdir')
a.call('apply_move')
a.ret()


# ─── try_dir: A=direction → compute target cell, check wall.
#     Returns Z=free (can move), NZ=blocked (wall). Clobbers B,C,DE,HL ────────
a.label('try_dir')
a.ld_lbl_a('tmp_dir')
# Load player pos
a.ld_a_lbl('px')
a.ld_r_r('b', 'a')
a.ld_a_lbl('py')
a.ld_r_r('c', 'a')
# Apply direction offset
a.ld_a_lbl('tmp_dir')
a.cp_n(DIR_RIGHT)
a.jr('nz', 'td_1')
a.inc_r('b')
a.jr('td_chk')
a.label('td_1')
a.cp_n(DIR_LEFT)
a.jr('nz', 'td_2')
a.dec_r('b')
a.jr('td_chk')
a.label('td_2')
a.cp_n(DIR_DOWN)
a.jr('nz', 'td_3')
a.inc_r('c')
a.jr('td_chk')
a.label('td_3')
# Must be UP
a.dec_r('c')

a.label('td_chk')
# Wrap x for tunnels (mod 16)
a.ld_r_r('a', 'b')
a.and_n(0x0F)
a.ld_r_r('b', 'a')
# Wrap y (mod 16)
a.ld_r_r('a', 'c')
a.and_n(0x0F)
a.ld_r_r('c', 'a')
# Check wall — is_wall returns Z=path(free), NZ=wall(blocked)
a.call('is_wall')
a.ret()  # flags pass through: Z=free, NZ=blocked


# ─── apply_move: move player in direction stored in pdir ─────────────────────
a.label('apply_move')
a.ld_a_lbl('pdir')
a.cp_n(DIR_RIGHT)
a.jr('nz', 'am_1')
a.ld_a_lbl('px')
a.inc_r('a')
a.and_n(0x0F)
a.ld_lbl_a('px')
a.ret()
a.label('am_1')
a.cp_n(DIR_LEFT)
a.jr('nz', 'am_2')
a.ld_a_lbl('px')
a.dec_r('a')
a.and_n(0x0F)
a.ld_lbl_a('px')
a.ret()
a.label('am_2')
a.cp_n(DIR_DOWN)
a.jr('nz', 'am_3')
a.ld_a_lbl('py')
a.inc_r('a')
a.and_n(0x0F)
a.ld_lbl_a('py')
a.ret()
a.label('am_3')
# UP
a.ld_a_lbl('py')
a.dec_r('a')
a.and_n(0x0F)
a.ld_lbl_a('py')
a.ret()


# ─── move_ghosts ──────────────────────────────────────────────────────────────
a.label('move_ghosts')
a.ld_a_lbl('gtimer')
a.inc_r('a')
a.ld_lbl_a('gtimer')
a.cp_n(6)               # Ghosts move every 6 frames (slower than player)
a.ret_cc('nz')
a.xor_r('a')
a.ld_lbl_a('gtimer')

# Move each ghost
a.ld_r_n('e', 0)        # ghost index
a.label('mg_loop')
a.push('de')
a.call('move_one_ghost')
a.pop('de')
a.inc_r('e')
a.ld_r_r('a', 'e')
a.cp_n(NUM_GHOSTS)
a.jr('c', 'mg_loop')
a.ret()


# ─── move_one_ghost: E=ghost index ───────────────────────────────────────────
a.label('move_one_ghost')
# Get ghost position: HL = ghost_data + E*3 (x, y, dir)
a.ld_rp_label('hl', 'ghost_data')
a.ld_r_r('a', 'e')
a.add_a_r('a')           # A = E*2
a.add_a_r('e')           # A = E*3
a.ld_r_r('d', 'a')
a.ld_r_n('e', 0)        # DE = offset (A was <12 so fits in D... wait no, E=0,D=offset is wrong)
# Fix: put in E
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.add_hl_rp('de')
# HL points to ghost x
a.ld_r_r('b', '(hl)')   # B = ghost x
a.inc_rp('hl')
a.ld_r_r('c', '(hl)')   # C = ghost y
a.inc_rp('hl')
a.ld_r_r('a', '(hl)')   # A = ghost dir
a.ld_lbl_a('tmp_gdir')
a.push('hl')             # save pointer to dir byte

# Ghost AI: try current direction. If blocked, pick random valid direction.
# First try current dir
a.ld_a_lbl('tmp_gdir')
a.cp_n(DIR_NONE)
a.jp('z', 'mg_pick')

# Try current direction
a.push('bc')
a.ld_a_lbl('tmp_gdir')
a.ld_lbl_a('tmp_dir')
# Apply direction to B,C
a.cp_n(DIR_RIGHT)
a.jr('nz', 'mg_d1')
a.inc_r('b')
a.jr('mg_dchk')
a.label('mg_d1')
a.cp_n(DIR_LEFT)
a.jr('nz', 'mg_d2')
a.dec_r('b')
a.jr('mg_dchk')
a.label('mg_d2')
a.cp_n(DIR_DOWN)
a.jr('nz', 'mg_d3')
a.inc_r('c')
a.jr('mg_dchk')
a.label('mg_d3')
a.dec_r('c')

a.label('mg_dchk')
# Wrap
a.ld_r_r('a', 'b')
a.and_n(0x0F)
a.ld_r_r('b', 'a')
a.ld_r_r('a', 'c')
a.and_n(0x0F)
a.ld_r_r('c', 'a')
a.call('is_wall')
a.pop('bc')              # restore original pos
a.jp('nz', 'mg_pick')   # wall → need new direction

# Current dir is free — move
a.ld_a_lbl('tmp_gdir')
a.jp('mg_apply')

a.label('mg_pick')
# Chase AI with randomness: ~30% chance to scatter (random direction order)
a.push('bc')
a.push('de')
a.call('rand')
a.pop('de')
a.pop('bc')
a.and_n(0x07)
a.cp_n(3)               # values 0,1,2 → scatter (3/8 = 37.5%)
a.jr('nc', 'mg_chase')  # 3-7 → normal chase

# Scatter mode: randomize direction priority
a.push('bc')
a.push('de')
a.call('rand')
a.pop('de')
a.pop('bc')
a.and_n(0x03)           # random first dir (0-3)
a.add_a_r('a')          # *2... no, just use as rotation
# Set a random permutation: rotate the standard R/D/L/U order
a.ld_lbl_a('tmp_gdir')  # temp use for rotation count
# Simple approach: pick random starting direction
a.ld_a_lbl('tmp_gdir')
a.cp_n(0)
a.jr('nz', 'mg_sc1')
a.ld_r_n('a', DIR_RIGHT)
a.ld_lbl_a('chase_d0')
a.ld_r_n('a', DIR_DOWN)
a.ld_lbl_a('chase_d1')
a.ld_r_n('a', DIR_LEFT)
a.ld_lbl_a('chase_d2')
a.ld_r_n('a', DIR_UP)
a.ld_lbl_a('chase_d3')
a.jp('mg_trylist')
a.label('mg_sc1')
a.cp_n(1)
a.jr('nz', 'mg_sc2')
a.ld_r_n('a', DIR_DOWN)
a.ld_lbl_a('chase_d0')
a.ld_r_n('a', DIR_LEFT)
a.ld_lbl_a('chase_d1')
a.ld_r_n('a', DIR_UP)
a.ld_lbl_a('chase_d2')
a.ld_r_n('a', DIR_RIGHT)
a.ld_lbl_a('chase_d3')
a.jp('mg_trylist')
a.label('mg_sc2')
a.cp_n(2)
a.jr('nz', 'mg_sc3')
a.ld_r_n('a', DIR_LEFT)
a.ld_lbl_a('chase_d0')
a.ld_r_n('a', DIR_UP)
a.ld_lbl_a('chase_d1')
a.ld_r_n('a', DIR_RIGHT)
a.ld_lbl_a('chase_d2')
a.ld_r_n('a', DIR_DOWN)
a.ld_lbl_a('chase_d3')
a.jp('mg_trylist')
a.label('mg_sc3')
a.ld_r_n('a', DIR_UP)
a.ld_lbl_a('chase_d0')
a.ld_r_n('a', DIR_RIGHT)
a.ld_lbl_a('chase_d1')
a.ld_r_n('a', DIR_DOWN)
a.ld_lbl_a('chase_d2')
a.ld_r_n('a', DIR_LEFT)
a.ld_lbl_a('chase_d3')
a.jp('mg_trylist')

a.label('mg_chase')
# Normal chase AI: compute preferred directions toward player
# B = ghost x, C = ghost y
# Build priority list: [preferred_x_dir, preferred_y_dir, other_x, other_y]
# Store 4 directions to try in order

# Compute preferred X direction
a.ld_a_lbl('px')
a.cp_r('b')               # px - ghost_x
a.jr('z', 'mg_xeq')
a.jr('c', 'mg_xleft')     # px < ghost_x → go left
a.ld_r_n('a', DIR_RIGHT)
a.ld_lbl_a('chase_d0')
a.ld_r_n('a', DIR_LEFT)
a.ld_lbl_a('chase_d2')
a.jr('mg_ychase')
a.label('mg_xleft')
a.ld_r_n('a', DIR_LEFT)
a.ld_lbl_a('chase_d0')
a.ld_r_n('a', DIR_RIGHT)
a.ld_lbl_a('chase_d2')
a.jr('mg_ychase')
a.label('mg_xeq')
# X equal — put horizontal dirs as low priority
a.ld_r_n('a', DIR_RIGHT)
a.ld_lbl_a('chase_d0')
a.ld_r_n('a', DIR_LEFT)
a.ld_lbl_a('chase_d2')

a.label('mg_ychase')
# Compute preferred Y direction
a.ld_a_lbl('py')
a.cp_r('c')               # py - ghost_y
a.jr('z', 'mg_yeq')
a.jr('c', 'mg_yup')       # py < ghost_y → go up
a.ld_r_n('a', DIR_DOWN)
a.ld_lbl_a('chase_d1')
a.ld_r_n('a', DIR_UP)
a.ld_lbl_a('chase_d3')
a.jr('mg_trylist')
a.label('mg_yup')
a.ld_r_n('a', DIR_UP)
a.ld_lbl_a('chase_d1')
a.ld_r_n('a', DIR_DOWN)
a.ld_lbl_a('chase_d3')
a.jr('mg_trylist')
a.label('mg_yeq')
a.ld_r_n('a', DIR_UP)
a.ld_lbl_a('chase_d1')
a.ld_r_n('a', DIR_DOWN)
a.ld_lbl_a('chase_d3')

a.label('mg_trylist')
# Add randomness: 25% chance to swap first two priorities
a.push('bc')
a.push('de')
a.call('rand')
a.pop('de')
a.pop('bc')
a.and_n(0x03)
a.jr('nz', 'mg_noswap')   # 75% keep priority order
# Swap d0 and d1
a.ld_a_lbl('chase_d0')
a.ld_r_r('d', 'a')
a.ld_a_lbl('chase_d1')
a.ld_lbl_a('chase_d0')
a.ld_r_r('a', 'd')
a.ld_lbl_a('chase_d1')
a.label('mg_noswap')

# Try each of the 4 priority directions
a.ld_r_n('d', 0)          # index into chase_d0..d3
a.label('mg_try')
# Load direction[d] from chase list
a.ld_r_r('a', 'd')
a.or_r('a')
a.jp('nz', 'mg_ld1')
a.ld_a_lbl('chase_d0')
a.jp('mg_ldok')
a.label('mg_ld1')
a.cp_n(1)
a.jp('nz', 'mg_ld2')
a.ld_a_lbl('chase_d1')
a.jp('mg_ldok')
a.label('mg_ld2')
a.cp_n(2)
a.jp('nz', 'mg_ld3')
a.ld_a_lbl('chase_d2')
a.jp('mg_ldok')
a.label('mg_ld3')
a.ld_a_lbl('chase_d3')
a.label('mg_ldok')
a.ld_lbl_a('tmp_gdir')

# Apply direction to test position
a.push('bc')
a.push('de')
a.ld_a_lbl('tmp_gdir')
a.cp_n(DIR_RIGHT)
a.jr('nz', 'mg_p1')
a.inc_r('b')
a.jr('mg_pchk')
a.label('mg_p1')
a.cp_n(DIR_LEFT)
a.jr('nz', 'mg_p2')
a.dec_r('b')
a.jr('mg_pchk')
a.label('mg_p2')
a.cp_n(DIR_DOWN)
a.jr('nz', 'mg_p3')
a.inc_r('c')
a.jr('mg_pchk')
a.label('mg_p3')
a.dec_r('c')

a.label('mg_pchk')
a.ld_r_r('a', 'b')
a.and_n(0x0F)
a.ld_r_r('b', 'a')
a.ld_r_r('a', 'c')
a.and_n(0x0F)
a.ld_r_r('c', 'a')
a.call('is_wall')
a.pop('de')
a.pop('bc')
a.jp('z', 'mg_found')     # Z = path = free!

# Try next direction in list
a.inc_r('d')
a.ld_r_r('a', 'd')
a.cp_n(4)
a.jp('c', 'mg_try')

# All attempts failed — ghost stays put
a.pop('hl')
a.ret()

a.label('mg_found')
a.ld_a_lbl('tmp_gdir')

a.label('mg_apply')
# A = direction to move. Apply to ghost position.
a.ld_lbl_a('tmp_gdir')  # save chosen dir
a.pop('hl')              # HL points to ghost dir byte
a.ld_r_r('(hl)', 'a')   # store new direction
a.dec_rp('hl')           # HL → ghost y
a.dec_rp('hl')           # HL → ghost x

# Apply movement
a.ld_a_lbl('tmp_gdir')
a.cp_n(DIR_RIGHT)
a.jr('nz', 'mg_a1')
a.ld_r_r('a', '(hl)')
a.inc_r('a')
a.and_n(0x0F)
a.ld_r_r('(hl)', 'a')
a.ret()
a.label('mg_a1')
a.cp_n(DIR_LEFT)
a.jr('nz', 'mg_a2')
a.ld_r_r('a', '(hl)')
a.dec_r('a')
a.and_n(0x0F)
a.ld_r_r('(hl)', 'a')
a.ret()
a.label('mg_a2')
a.cp_n(DIR_DOWN)
a.jr('nz', 'mg_a3')
a.inc_rp('hl')           # HL → ghost y
a.ld_r_r('a', '(hl)')
a.inc_r('a')
a.and_n(0x0F)
a.ld_r_r('(hl)', 'a')
a.ret()
a.label('mg_a3')
# UP
a.inc_rp('hl')           # HL → ghost y
a.ld_r_r('a', '(hl)')
a.dec_r('a')
a.and_n(0x0F)
a.ld_r_r('(hl)', 'a')
a.ret()


# ─── eat_dot: check if player is on a dot ─────────────────────────────────────
a.label('eat_dot')
# Check dot at player position
a.ld_a_lbl('px')
a.ld_r_r('b', 'a')
a.ld_a_lbl('py')
a.ld_r_r('c', 'a')
# HL = dots + y*2
a.ld_rp_label('hl', 'dots')
a.ld_r_r('a', 'c')
a.sla('a')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.add_hl_rp('de')
# Determine byte and bit
a.ld_r_r('a', 'b')
a.cp_n(8)
a.jr('nc', 'ed_hi')
# x < 8
a.ld_r_n('a', 7)
a.sub_r('b')             # bit position
a.jr('ed_mk')
a.label('ed_hi')
a.inc_rp('hl')
a.ld_r_r('a', 'b')
a.sub_n(8)
a.ld_r_r('b', 'a')
a.ld_r_n('a', 7)
a.sub_r('b')
a.label('ed_mk')
# A = bit position, create mask
a.ld_r_r('b', 'a')
a.or_r('a')
a.jr('z', 'ed_b0')
a.ld_r_n('a', 1)
a.label('ed_sl')
a.sla('a')
a.djnz('ed_sl')
a.jr('ed_tst')
a.label('ed_b0')
a.ld_r_n('a', 1)
a.label('ed_tst')
# A = mask
a.ld_r_r('b', 'a')      # B = mask
a.ld_r_r('a', '(hl)')   # A = dot byte
a.and_r('b')
a.ret_cc('z')            # no dot here

# Eat the dot: clear the bit
a.ld_r_r('a', 'b')      # A = mask
a.cpl()                  # A = ~mask
a.and_r('(hl)')          # A = byte & ~mask
a.ld_r_r('(hl)', 'a')   # store

# Increment score (BCD)
a.ld_a_lbl('score')
a.add_a_n(1)
a.daa()
a.ld_lbl_a('score')

# Decrement dot count
a.ld_a_lbl('dot_count')
a.dec_r('a')
a.ld_lbl_a('dot_count')
a.ret()


# ─── check_ghost_col: check if player overlaps any ghost ─────────────────────
a.label('check_ghost_col')
a.ld_rp_label('hl', 'ghost_data')
a.ld_r_n('e', 0)
a.label('gc_lp')
a.ld_r_r('a', '(hl)')   # ghost x
a.ld_r_r('b', 'a')
a.inc_rp('hl')
a.ld_r_r('a', '(hl)')   # ghost y
a.ld_r_r('c', 'a')
a.inc_rp('hl')
a.inc_rp('hl')           # skip dir

# Compare with player
a.ld_a_lbl('px')
a.cp_r('b')
a.jr('nz', 'gc_nx')
a.ld_a_lbl('py')
a.cp_r('c')
a.jr('nz', 'gc_nx')

# Collision! Lose a life
a.ld_a_lbl('lives')
a.or_r('a')
a.ret_cc('z')
a.dec_r('a')
a.ld_lbl_a('lives')
# Reset positions
a.call('reset_positions')
# Death sound
a.ld_r_n('b', 40)
a.label('gc_snd')
a.ld_r_r('a', 'b')
a.out_a(JOY_X)
a.ld_r_n('c', 20)
a.label('gc_del')
a.dec_r('c')
a.jr('nz', 'gc_del')
a.xor_r('a')
a.out_a(JOY_X)
a.djnz('gc_snd')
a.ret()

a.label('gc_nx')
a.inc_r('e')
a.ld_r_r('a', 'e')
a.cp_n(NUM_GHOSTS)
a.jr('c', 'gc_lp')
a.ret()


# ─── draw_maze: draw wall cells as blue blocks ────────────────────────────────
a.label('draw_maze')
a.ld_r_n('c', 0)        # row
a.label('dm_row')
a.ld_r_n('b', 0)        # col
a.label('dm_col')
a.push('bc')
a.call('is_wall')
a.pop('bc')
a.jr('z', 'dm_nxt')     # Z = path, skip

# Draw wall cell: 4×4 blue block
a.push('bc')
# Pixel coords: d = b*4, e = c*4
a.ld_r_r('a', 'b')
a.sla('a'); a.sla('a')
a.ld_r_r('d', 'a')
a.ld_r_r('a', 'c')
a.sla('a'); a.sla('a')
a.ld_r_r('e', 'a')
# Draw 4 rows of 4 pixels (use hline)
a.ld_r_n('c', BLUE)
a.push('de')
a.ld_r_n('b', 4)
a.call('hline')
a.pop('de')
a.push('de')
a.inc_r('e')
a.ld_r_n('b', 4)
a.call('hline')
a.pop('de')
a.push('de')
a.inc_r('e')
a.inc_r('e')
a.ld_r_n('b', 4)
a.call('hline')
a.pop('de')
a.inc_r('e')
a.inc_r('e')
a.inc_r('e')
a.ld_r_n('b', 4)
a.call('hline')
a.pop('bc')

a.label('dm_nxt')
a.inc_r('b')
a.ld_r_r('a', 'b')
a.cp_n(MAZE_W)
a.jr('c', 'dm_col')
a.inc_r('c')
a.ld_r_r('a', 'c')
a.cp_n(MAZE_H)
a.jr('c', 'dm_row')
a.ret()


# ─── draw_dots: draw remaining dots as white pixels ──────────────────────────
a.label('draw_dots')
a.ld_r_n('c', 0)        # row
a.label('dd_row')
a.ld_r_n('b', 0)        # col
a.label('dd_col')
a.push('bc')
# Check dot at (B, C)
a.ld_rp_label('hl', 'dots')
a.ld_r_r('a', 'c')
a.sla('a')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.add_hl_rp('de')
# Byte and bit
a.ld_r_r('a', 'b')
a.cp_n(8)
a.jr('nc', 'dd_hi')
a.ld_r_n('a', 7)
a.sub_r('b')
a.jr('dd_mk')
a.label('dd_hi')
a.inc_rp('hl')
a.ld_r_r('a', 'b')
a.sub_n(8)
a.push('bc')
a.ld_r_r('b', 'a')
a.ld_r_n('a', 7)
a.sub_r('b')
a.pop('bc')
a.label('dd_mk')
# A = bit pos, make mask
a.push('bc')
a.ld_r_r('b', 'a')
a.or_r('a')
a.jr('z', 'dd_b0')
a.ld_r_n('a', 1)
a.label('dd_sl')
a.sla('a')
a.djnz('dd_sl')
a.jr('dd_tst')
a.label('dd_b0')
a.ld_r_n('a', 1)
a.label('dd_tst')
a.and_r('(hl)')
a.pop('bc')
a.pop('bc')              # restore row/col
a.jr('z', 'dd_nxt')     # no dot

# Draw dot: single white pixel at cell center (x*4+2, y*4+2)
a.push('bc')
a.ld_r_r('a', 'b')
a.sla('a'); a.sla('a')
a.add_a_n(2)
a.ld_r_r('d', 'a')
a.ld_r_r('a', 'c')
a.sla('a'); a.sla('a')
a.add_a_n(2)
a.ld_r_r('e', 'a')
a.ld_r_n('c', WHITE)
a.call('plot')
a.pop('bc')

a.label('dd_nxt')
a.inc_r('b')
a.ld_r_r('a', 'b')
a.cp_n(MAZE_W)
a.jr('c', 'dd_col')
a.inc_r('c')
a.ld_r_r('a', 'c')
a.cp_n(MAZE_H)
a.jr('c', 'dd_row')
a.ret()


# ─── erase_player: draw black 3×3 at player pos, redraw dot if present ───────
a.label('erase_player')
a.ld_a_lbl('px')
a.sla('a'); a.sla('a')
a.inc_r('a')
a.ld_r_r('d', 'a')
a.ld_a_lbl('py')
a.sla('a'); a.sla('a')
a.inc_r('a')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BLACK)
a.push('de')
a.ld_r_n('b', 3)
a.call('hline')
a.pop('de')
a.push('de')
a.inc_r('e')
a.ld_r_n('b', 3)
a.call('hline')
a.pop('de')
a.inc_r('e')
a.inc_r('e')
a.ld_r_n('b', 3)
a.call('hline')
# Redraw dot at this cell if it still exists
a.ld_a_lbl('px')
a.ld_r_r('b', 'a')
a.ld_a_lbl('py')
a.ld_r_r('c', 'a')
a.call('redraw_dot')
a.ret()


# ─── erase_ghosts: black 3×3 at each ghost pos ──────────────────────────────
a.label('erase_ghosts')
a.ld_rp_label('hl', 'ghost_data')
a.ld_r_n('e', 0)
a.label('eg_lp')
a.push('hl')
a.push('de')
# Get pixel position
a.ld_r_r('a', '(hl)')
a.sla('a'); a.sla('a')
a.inc_r('a')
a.ld_r_r('d', 'a')
a.inc_rp('hl')
a.ld_r_r('a', '(hl)')
a.sla('a'); a.sla('a')
a.inc_r('a')
a.ld_r_r('e', 'a')
# Draw black 3×3
a.ld_r_n('c', BLACK)
a.push('de')
a.ld_r_n('b', 3)
a.call('hline')
a.pop('de')
a.push('de')
a.inc_r('e')
a.ld_r_n('b', 3)
a.call('hline')
a.pop('de')
a.inc_r('e')
a.inc_r('e')
a.ld_r_n('b', 3)
a.call('hline')
# Redraw dot at this ghost's cell
a.pop('de')
a.pop('hl')
a.push('hl')
a.push('de')
a.ld_r_r('b', '(hl)')   # ghost cell x
a.inc_rp('hl')
a.ld_r_r('c', '(hl)')   # ghost cell y
a.call('redraw_dot')
a.pop('de')
a.pop('hl')
# Advance
a.inc_rp('hl')
a.inc_rp('hl')
a.inc_rp('hl')
a.inc_r('e')
a.ld_r_r('a', 'e')
a.cp_n(NUM_GHOSTS)
a.jr('c', 'eg_lp')
a.ret()


# ─── redraw_dot: if dot exists at cell (B,C), draw white pixel at center ─────
a.label('redraw_dot')
a.push('bc')
# Check if dot exists at (B, C)
a.ld_rp_label('hl', 'dots')
a.ld_r_r('a', 'c')
a.sla('a')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.add_hl_rp('de')
a.ld_r_r('a', 'b')
a.cp_n(8)
a.jr('nc', 'rd_hi')
a.ld_r_n('a', 7)
a.sub_r('b')
a.jr('rd_mk')
a.label('rd_hi')
a.inc_rp('hl')
a.ld_r_r('a', 'b')
a.sub_n(8)
a.push('bc')
a.ld_r_r('b', 'a')
a.ld_r_n('a', 7)
a.sub_r('b')
a.pop('bc')
a.label('rd_mk')
# A = bit pos
a.push('bc')
a.ld_r_r('b', 'a')
a.or_r('a')
a.jr('z', 'rd_b0')
a.ld_r_n('a', 1)
a.label('rd_sl')
a.sla('a')
a.djnz('rd_sl')
a.jr('rd_tst')
a.label('rd_b0')
a.ld_r_n('a', 1)
a.label('rd_tst')
a.and_r('(hl)')
a.pop('bc')
a.pop('bc')
a.ret_cc('z')            # no dot
# Draw dot pixel at cell center
a.ld_r_r('a', 'b')
a.sla('a'); a.sla('a')
a.add_a_n(2)
a.ld_r_r('d', 'a')
a.ld_r_r('a', 'c')
a.sla('a'); a.sla('a')
a.add_a_n(2)
a.ld_r_r('e', 'a')
a.ld_r_n('c', WHITE)
a.call('plot')
a.ret()


# ─── draw_player: 3×3 yellow at player cell ──────────────────────────────────
a.label('draw_player')
a.ld_a_lbl('px')
a.sla('a'); a.sla('a')
a.inc_r('a')             # x*4 + 1 (centered in cell)
a.ld_r_r('d', 'a')
a.ld_a_lbl('py')
a.sla('a'); a.sla('a')
a.inc_r('a')             # y*4 + 1
a.ld_r_r('e', 'a')
a.ld_r_n('c', BRIGHT_YEL)
# Row 0: 3 pixels
a.push('de')
a.ld_r_n('b', 3)
a.call('hline')
a.pop('de')
# Row 1: 3 pixels
a.push('de')
a.inc_r('e')
a.ld_r_n('b', 3)
a.call('hline')
a.pop('de')
# Row 2: 3 pixels
a.inc_r('e')
a.inc_r('e')
a.ld_r_n('b', 3)
a.call('hline')
a.ret()


# ─── draw_ghosts: 3×3 colored blocks ─────────────────────────────────────────
a.label('draw_ghosts')
a.ld_rp_label('hl', 'ghost_data')
a.ld_r_n('e', 0)        # index for color selection
a.label('dg_lp')
a.push('hl')
a.push('de')

# Get position
a.ld_r_r('a', '(hl)')   # ghost x
a.sla('a'); a.sla('a')
a.inc_r('a')
a.ld_r_r('d', 'a')
a.inc_rp('hl')
a.ld_r_r('a', '(hl)')   # ghost y
a.sla('a'); a.sla('a')
a.inc_r('a')
a.ld_r_r('e', 'a')

# Color based on index (index is in C after POP BC from pushed DE)
a.pop('bc')              # B=old D, C=old E(index)
a.push('bc')
a.ld_r_r('a', 'c')      # A = ghost index
a.ld_rp_label('hl', 'ghost_colors')
a.ld_r_r('c', 'a')
a.ld_r_n('b', 0)
a.add_hl_rp('bc')
a.ld_r_r('c', '(hl)')   # C = color

# Draw 3×3 block
a.push('de')
a.ld_r_n('b', 3)
a.call('hline')
a.pop('de')
a.push('de')
a.inc_r('e')
a.ld_r_n('b', 3)
a.call('hline')
a.pop('de')
a.inc_r('e')
a.inc_r('e')
a.ld_r_n('b', 3)
a.call('hline')

a.pop('de')
a.pop('hl')
# Advance to next ghost (3 bytes)
a.inc_rp('hl')
a.inc_rp('hl')
a.inc_rp('hl')
a.inc_r('e')
a.ld_r_r('a', 'e')
a.cp_n(NUM_GHOSTS)
a.jr('c', 'dg_lp')
a.ret()


# ─── draw_score: yellow bar at top of screen (over maze) ─────────────────────
a.label('draw_score')
# Bar width = (TOTAL_DOTS - dot_count) / 2  (0 to 63 pixels)
a.ld_r_n('a', TOTAL_DOTS)
a.ld_r_r('b', 'a')
a.ld_a_lbl('dot_count')
a.ld_r_r('c', 'a')
a.ld_r_r('a', 'b')
a.sub_r('c')             # A = dots eaten
a.ret_cc('z')            # nothing eaten yet
a.srl('a')               # A = dots_eaten / 2
a.ret_cc('z')
a.ld_r_r('b', 'a')
a.ld_r_n('d', 0)
a.ld_r_n('e', 0)
a.ld_r_n('c', BRIGHT_YEL)
a.call('hline')
a.ret()


# ─── flash_screen ────────────────────────────────────────────────────────────
a.label('flash_screen')
a.ld_r_n('b', 10)
a.label('fs_lp')
a.push('bc')
a.call('vsync')
a.call('vsync')
a.call('vsync')
a.call('clear_fb')
a.call('vsync')
a.call('vsync')
a.call('vsync')
a.call('draw_maze')
a.pop('bc')
a.djnz('fs_lp')
a.ret()


# ─── wait_fire: wait for button 2 press ──────────────────────────────────────
a.label('wait_fire')
a.label('wf_r')
a.in_a(JOY_BTN)
a.bit(1, 'a')
a.jr('z', 'wf_r')
a.label('wf_p')
a.in_a(JOY_BTN)
a.bit(1, 'a')
a.jr('nz', 'wf_p')
a.ret()


# ─── rand: LCG PRNG (period 256) → A ─────────────────────────────────────────
a.label('rand')
a.ld_a_lbl('rng')
a.ld_r_r('b', 'a')      # B = old
a.sla('a')               # A = old * 2
a.sla('a')               # A = old * 4
a.add_a_r('b')           # A = old * 5
a.add_a_n(3)             # A = old * 5 + 3
a.ld_lbl_a('rng')
a.ret()


# ─── init_game ────────────────────────────────────────────────────────────────
a.label('init_game')
a.xor_r('a')
a.ld_lbl_a('score')
a.ld_r_n('a', 3)
a.ld_lbl_a('lives')
a.call('init_level')
a.ret()


# ─── init_level: reset dots and positions ─────────────────────────────────────
a.label('init_level')
# Copy initial dots
a.ld_rp_label('hl', 'dots_init')
a.ld_rp_label('de', 'dots')
a.ld_rp_nn('bc', 32)
a.ldir()
# Reset dot count
a.ld_r_n('a', TOTAL_DOTS)
a.ld_lbl_a('dot_count')
# Reset positions and state
a.call('reset_positions')
a.xor_r('a')
a.ld_lbl_a('ptimer')
a.ld_lbl_a('gtimer')
a.ld_r_n('a', DIR_NONE)
a.ld_lbl_a('pdir')
a.ld_lbl_a('want_dir')
a.ret()


# ─── reset_positions ──────────────────────────────────────────────────────────
a.label('reset_positions')
# Player start
a.ld_r_n('a', PLAYER_START_X)
a.ld_lbl_a('px')
a.ld_r_n('a', PLAYER_START_Y)
a.ld_lbl_a('py')
# Ghosts start in center area
a.ld_rp_label('hl', 'ghost_data')
# Ghost 0: (7, 7)
a.ld_r_n('a', 7)
a.ld_r_r('(hl)', 'a'); a.inc_rp('hl')
a.ld_r_n('a', 7)
a.ld_r_r('(hl)', 'a'); a.inc_rp('hl')
a.ld_r_n('a', DIR_RIGHT)
a.ld_r_r('(hl)', 'a'); a.inc_rp('hl')
# Ghost 1: (8, 7)
a.ld_r_n('a', 8)
a.ld_r_r('(hl)', 'a'); a.inc_rp('hl')
a.ld_r_n('a', 7)
a.ld_r_r('(hl)', 'a'); a.inc_rp('hl')
a.ld_r_n('a', DIR_LEFT)
a.ld_r_r('(hl)', 'a'); a.inc_rp('hl')
# Ghost 2: (7, 8)
a.ld_r_n('a', 7)
a.ld_r_r('(hl)', 'a'); a.inc_rp('hl')
a.ld_r_n('a', 8)
a.ld_r_r('(hl)', 'a'); a.inc_rp('hl')
a.ld_r_n('a', DIR_UP)
a.ld_r_r('(hl)', 'a')
a.ret()


# ═══════════════════════════════════════════════════════════════════════════════
#  DATA
# ═══════════════════════════════════════════════════════════════════════════════

a.label('ghost_colors')
a.db(BRIGHT_RED, BRIGHT_MAG, BRIGHT_CYN)

a.label('maze_data')
for b in MAZE_DATA:
    a.db(b)

a.label('dots_init')
for b in DOTS_DATA:
    a.db(b)


# ═══════════════════════════════════════════════════════════════════════════════
#  VARIABLES (mutable)
# ═══════════════════════════════════════════════════════════════════════════════

a.label('px');         a.db(PLAYER_START_X)
a.label('py');         a.db(PLAYER_START_Y)
a.label('pdir');       a.db(DIR_NONE)
a.label('want_dir');   a.db(DIR_NONE)
a.label('ptimer');     a.db(0)
a.label('gtimer');     a.db(0)
a.label('lives');      a.db(3)
a.label('score');      a.db(0)
a.label('dot_count');  a.db(TOTAL_DOTS)
a.label('rng');        a.db(0x42)

a.label('in_x');       a.db(0)
a.label('in_y');       a.db(0)
a.label('in_btn');     a.db(0xFF)

a.label('tmp_dir');    a.db(0)
a.label('tmp_gdir');   a.db(0)
a.label('chase_d0');   a.db(0)
a.label('chase_d1');   a.db(0)
a.label('chase_d2');   a.db(0)
a.label('chase_d3');   a.db(0)

# Ghost data: 3 ghosts × 3 bytes (x, y, dir)
a.label('ghost_data')
a.db(7, 7, DIR_RIGHT)   # ghost 0
a.db(8, 7, DIR_LEFT)    # ghost 1
a.db(7, 8, DIR_UP)      # ghost 2

# Dot state (mutable copy of dots_init)
a.label('dots')
a.ds(32, 0)


# ═══════════════════════════════════════════════════════════════════════════════

out = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'MAZECHASE.COM')
a.save(out)
out2 = os.path.join(os.path.dirname(__file__), '..', 'games', 'MAZECHASE.COM')
a.save(out2)
print(f"  Code: {len(a.code)} bytes  (0x{a.org:04X}–0x{a.org+len(a.code)-1:04X})")
print(f"  FB:   0x{FB_BASE:04X}–0x{FB_BASE+FB_SIZE-1:04X}")
print(f"  Dots: {TOTAL_DOTS}")
