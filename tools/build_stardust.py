#!/usr/bin/env python3
"""
STARDUST — A Dazzler shoot-em-up for the Cromemco Dazzler + D+7A joystick.
Builds a CP/M .COM file (Z80 machine code, ORG 0x0100).

Display: 64×64 color, 2K normal mode (16 IBGR colors)
Framebuffer: 0x2000 (page 0x10), 2048 bytes
  4 quadrants of 512 bytes: TL, TR, BL, BR
  Each quadrant: 32×32 pixels, 16 bytes/row, 2 px/byte (low nib=left, high=right)

Joystick: Cromemco D+7A
  Port 0x18: buttons (active-LOW, bit0=fire)
  Port 0x19: X-axis (0=center, 1-127=right, 128-255=left)
"""

import os, sys

# ─── Mini Z80 assembler ────────────────────────────────────────────────────────

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

    def push(self, rp): self.emit(0xC5 + self.RP2[rp]*16)
    def pop(self, rp): self.emit(0xC1 + self.RP2[rp]*16)

    def inc_r(self, r): self.emit(0x04 + self.R[r]*8)
    def dec_r(self, r): self.emit(0x05 + self.R[r]*8)
    def inc_rp(self, rp): self.emit(0x03 + self.RP[rp]*16)
    def dec_rp(self, rp): self.emit(0x0B + self.RP[rp]*16)

    def add_a_r(self, r): self.emit(0x80 + self.R[r])
    def add_a_n(self, n): self.emit(0xC6, n & 0xFF)
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
    def rra(self): self.emit(0x1F)
    def rlca(self): self.emit(0x07)
    def rrca(self): self.emit(0x0F)

    def ldir(self): self.emit(0xED, 0xB0)
    def neg(self): self.emit(0xED, 0x44)

# ─── Constants ──────────────────────────────────────────────────────────────────
# IBGR colors
BLACK, RED, GREEN, YELLOW = 0,1,2,3
BLUE, MAGENTA, CYAN, WHITE = 4,5,6,7
BRIGHT_RED, BRIGHT_GRN, BRIGHT_YEL = 9, 0x0A, 0x0B
BRIGHT_BLU, BRIGHT_MAG, BRIGHT_CYN, BRIGHT_WHT = 0x0C, 0x0D, 0x0E, 0x0F

# Hardware
DAZ_NX, DAZ_CC = 0x0E, 0x0F
JOY_BTN, JOY_X = 0x18, 0x19
FB_PAGE = 0x10
FB_BASE = 0x2000
FB_SIZE = 2048

# Game
NCOLS, NROWS = 8, 4
NALIENS = NCOLS * NROWS
PLAYER_W = 5

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

# Seed RNG from a few port reads
a.in_a(DAZ_NX)
a.ld_lbl_a('rng')

a.label('restart')
a.call('title_screen')
a.call('init_game')

# ─── Main loop ─────────────────────────────────────────────────────────────────
a.label('main_loop')
a.call('vsync')
a.call('input')
a.call('move_player')
a.call('move_bullet')
a.call('move_bombs')
a.call('move_aliens')
a.call('collide_bullet')
a.call('collide_bombs')
a.call('clear_fb')
a.call('draw_all')

# Check game over
a.ld_a_lbl('lives')
a.or_r('a')
a.jp('z', 'game_over')

# Check wave clear
a.ld_a_lbl('alive_ct')
a.or_r('a')
a.jp('z', 'wave_clear')

a.jp('main_loop')

# ─── Wave clear ────────────────────────────────────────────────────────────────
a.label('wave_clear')
a.ld_a_lbl('wave')
a.inc_r('a')
a.ld_lbl_a('wave')
# Speed up aliens (reduce delay, min 8)
a.ld_a_lbl('aspeed')
a.cp_n(10)
a.jr('c', 'wc_skip')
a.sub_n(4)
a.ld_lbl_a('aspeed')
a.label('wc_skip')
a.call('init_aliens')
# Clear bullets/bombs
a.xor_r('a')
a.ld_lbl_a('bul_y')
a.ld_lbl_a('bomb0_y')
a.ld_lbl_a('bomb1_y')
a.jp('main_loop')

# ─── Game over ─────────────────────────────────────────────────────────────────
a.label('game_over')
a.call('clear_fb')
# Draw red X across screen
a.ld_r_n('b', 30)
a.ld_r_n('d', 17)
a.ld_r_n('e', 17)
a.label('go_x')
a.push('bc')
a.push('de')
a.ld_r_n('c', BRIGHT_RED)
a.call('plot')
# Mirror diagonal
a.push('de')
a.ld_r_r('a', 'e')
a.ld_r_r('e', 'd')   # swap-ish: draw at (y_as_x, x_as_y) for other diagonal
a.ld_r_r('d', 'a')
# Actually: draw at (63-x, y) for the other arm
a.pop('de')
a.push('de')
a.ld_r_r('a', 'd')
a.cpl()
a.and_n(0x3F)
a.ld_r_r('d', 'a')
a.call('plot')
a.pop('de')
a.pop('de')
a.pop('bc')
a.inc_r('d')
a.inc_r('e')
a.djnz('go_x')
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

# HL += y * 16 (16-bit shift)
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
a.in_a(JOY_BTN)
a.ld_lbl_a('in_btn')
a.ret()

# ─── move_player ──────────────────────────────────────────────────────────────
a.label('move_player')
a.ld_a_lbl('in_x')
# Left: 128-255
a.cp_n(128)
a.jr('c', 'mp_chkr')
a.ld_a_lbl('px')
a.or_r('a')
a.jr('z', 'mp_fire')
a.dec_r('a')
a.ld_lbl_a('px')
a.jr('mp_fire')
a.label('mp_chkr')
# Right: 1-127
a.ld_a_lbl('in_x')
a.or_r('a')
a.jr('z', 'mp_fire')
a.ld_a_lbl('px')
a.cp_n(59)
a.jr('nc', 'mp_fire')
a.inc_r('a')
a.ld_lbl_a('px')

a.label('mp_fire')
# Fire button: bit 0 active-low
a.ld_a_lbl('in_btn')
a.bit(0, 'a')
a.jr('nz', 'mp_cool')   # not pressed

a.ld_a_lbl('fcool')
a.or_r('a')
a.jr('nz', 'mp_cool')

# Only fire if no bullet active
a.ld_a_lbl('bul_y')
a.or_r('a')
a.jr('nz', 'mp_cool')

# Spawn bullet
a.ld_a_lbl('px')
a.add_a_n(2)
a.ld_lbl_a('bul_x')
a.ld_r_n('a', 56)
a.ld_lbl_a('bul_y')
a.ld_r_n('a', 8)
a.ld_lbl_a('fcool')

# Click sound
a.ld_r_n('a', 0x80)
a.out_a(JOY_X)
a.xor_r('a')
a.out_a(JOY_X)

a.label('mp_cool')
a.ld_a_lbl('fcool')
a.or_r('a')
a.ret_cc('z')
a.dec_r('a')
a.ld_lbl_a('fcool')
a.ret()

# ─── move_bullet ──────────────────────────────────────────────────────────────
a.label('move_bullet')
a.ld_a_lbl('bul_y')
a.or_r('a')
a.ret_cc('z')
a.sub_n(2)
a.jr('c', 'mb_kill')
a.jr('z', 'mb_kill')
a.ld_lbl_a('bul_y')
a.ret()
a.label('mb_kill')
a.xor_r('a')
a.ld_lbl_a('bul_y')
a.ret()

# ─── move_bombs ───────────────────────────────────────────────────────────────
a.label('move_bombs')
# Move bomb 0
a.ld_a_lbl('bomb0_y')
a.or_r('a')
a.jr('z', 'mb1')
a.add_a_n(1)
a.cp_n(63)
a.jr('nc', 'mb0_kill')
a.ld_lbl_a('bomb0_y')
a.jr('mb1')
a.label('mb0_kill')
a.xor_r('a')
a.ld_lbl_a('bomb0_y')

a.label('mb1')
# Move bomb 1
a.ld_a_lbl('bomb1_y')
a.or_r('a')
a.jr('z', 'mb_drop')
a.add_a_n(1)
a.cp_n(63)
a.jr('nc', 'mb1_kill')
a.ld_lbl_a('bomb1_y')
a.jr('mb_drop')
a.label('mb1_kill')
a.xor_r('a')
a.ld_lbl_a('bomb1_y')

a.label('mb_drop')
# Maybe drop a new bomb
a.call('rand')
a.cp_n(244)
a.ret_cc('c')       # ~5% chance

# Pick random alien
a.call('rand')
a.and_n(0x1F)
a.cp_n(NALIENS)
a.ret_cc('nc')

# Check alive
a.ld_rp_label('hl', 'aliens')
a.ld_r_r('c', 'a')
a.ld_r_n('b', 0)
a.add_hl_rp('bc')
a.ld_r_r('a', '(hl)')
a.or_r('a')
a.ret_cc('z')

# Find empty bomb slot
a.ld_a_lbl('bomb0_y')
a.or_r('a')
a.jr('nz', 'md_try1')
# Use slot 0
a.call('alien_xy')    # Returns D=x, E=y from alien index C
a.ld_r_r('a', 'e')
a.add_a_n(3)
a.ld_lbl_a('bomb0_y')
a.ld_r_r('a', 'd')
a.add_a_n(1)
a.ld_lbl_a('bomb0_x')
a.ret()

a.label('md_try1')
a.ld_a_lbl('bomb1_y')
a.or_r('a')
a.ret_cc('nz')        # Both slots full
a.call('alien_xy')
a.ld_r_r('a', 'e')
a.add_a_n(3)
a.ld_lbl_a('bomb1_y')
a.ld_r_r('a', 'd')
a.add_a_n(1)
a.ld_lbl_a('bomb1_x')
a.ret()


# ─── alien_xy: C=alien index → D=x, E=y ──────────────────────────────────────
a.label('alien_xy')
a.push('bc')
# col = C & 7
a.ld_r_r('a', 'c')
a.and_n(7)
# x = 2 + col * 7
a.or_r('a')              # test col==0
a.jr('z', 'axy_xz')
a.ld_r_r('b', 'a')      # B = col (loop counter)
a.ld_r_n('a', 2)
a.label('axy_xm')
a.add_a_n(7)
a.djnz('axy_xm')
a.ld_r_r('d', 'a')      # D = x
a.jr('axy_xd')
a.label('axy_xz')
a.ld_r_n('d', 2)        # x = 2 when col=0
a.label('axy_xd')

# row = C >> 3
a.ld_r_r('a', 'c')
a.srl('a'); a.srl('a'); a.srl('a')
# y = base_y + row * 6
a.or_r('a')              # test row==0
a.jr('z', 'axy_y0')
a.ld_r_r('b', 'a')      # B = row counter
a.ld_a_lbl('abase_y')
a.label('axy_ym')
a.add_a_n(6)
a.djnz('axy_ym')
a.ld_r_r('e', 'a')      # E = y
a.jr('axy_yd')
a.label('axy_y0')
a.ld_a_lbl('abase_y')
a.ld_r_r('e', 'a')      # E = base_y (row 0)
a.label('axy_yd')

a.pop('bc')
a.ret()


# ─── move_aliens ──────────────────────────────────────────────────────────────
a.label('move_aliens')
a.ld_a_lbl('atimer')
a.inc_r('a')
a.ld_lbl_a('atimer')
a.ld_r_r('b', 'a')
a.ld_a_lbl('aspeed')
a.cp_r('b')
a.ret_cc('nz')

a.xor_r('a')
a.ld_lbl_a('atimer')

a.ld_a_lbl('abase_y')
a.inc_r('a')
a.cp_n(38)                    # Bottom aliens at y+18=56, near player
a.jr('c', 'ma_ok')
# Aliens reached bottom — lose a life
a.ld_a_lbl('lives')
a.or_r('a')
a.jr('z', 'ma_ok')     # Already dead
a.dec_r('a')
a.ld_lbl_a('lives')
a.call('init_aliens')
a.ret()
a.label('ma_ok')
a.ld_lbl_a('abase_y')
a.ret()


# ─── collide_bullet: check bullet vs each alien ──────────────────────────────
a.label('collide_bullet')
a.ld_a_lbl('bul_y')
a.or_r('a')
a.ret_cc('z')

# Store bullet coords in B=x, C=y for quick access
a.ld_a_lbl('bul_x')
a.ld_r_r('b', 'a')
a.ld_a_lbl('bul_y')
a.ld_r_r('c', 'a')

# Loop through aliens
a.ld_rp_label('hl', 'aliens')
a.push('bc')
a.ld_r_n('e', 0)       # alien index in E

a.label('cb_lp')
a.ld_r_r('a', '(hl)')
a.or_r('a')
a.jp('z', 'cb_nx')     # dead

a.push('hl')
a.push('de')

# Get alien position
a.ld_r_r('c', 'e')     # alien index
a.call('alien_xy')      # D=ax, E=ay

# Save alien position to temp vars
a.ld_r_r('a', 'd')
a.ld_lbl_a('tmp_ax')
a.ld_r_r('a', 'e')
a.ld_lbl_a('tmp_ay')

# Check Y overlap: bullet_y >= ay AND bullet_y < ay+3
a.ld_a_lbl('bul_y')
a.ld_r_r('b', 'a')      # B = bullet Y
a.ld_a_lbl('tmp_ay')
a.ld_r_r('c', 'a')      # C = alien Y
a.ld_r_r('a', 'b')
a.sub_r('c')             # A = bul_y - alien_y
a.jr('c', 'cb_nohit')   # bul_y < alien_y
a.cp_n(4)
a.jr('nc', 'cb_nohit')  # bul_y >= alien_y + 4

# Check X overlap: bul_x >= ax AND bul_x < ax+5
a.ld_a_lbl('bul_x')
a.ld_r_r('b', 'a')      # B = bullet X
a.ld_a_lbl('tmp_ax')
a.ld_r_r('c', 'a')      # C = alien X
a.ld_r_r('a', 'b')
a.sub_r('c')             # A = bul_x - alien_x
a.jr('c', 'cb_nohit')   # bul_x < alien_x
a.cp_n(5)
a.jr('nc', 'cb_nohit')  # bul_x >= alien_x + 5

# HIT!
a.pop('de')
a.pop('hl')
a.ld_r_n('(hl)', 0)    # Kill alien

# Remove bullet
a.xor_r('a')
a.ld_lbl_a('bul_y')

# Increment score
a.ld_a_lbl('score')
a.add_a_n(1)
a.daa()                 # BCD increment
a.ld_lbl_a('score')

# Decrement alive count
a.ld_a_lbl('alive_ct')
a.dec_r('a')
a.ld_lbl_a('alive_ct')

# Explosion sound (fixed delay — rand clobbers B which breaks DJNZ)
a.ld_r_n('b', 20)
a.label('exp_snd')
a.ld_r_n('a', 0xFF)
a.out_a(JOY_X)
a.ld_r_n('c', 12)
a.label('exp_del')
a.dec_r('c')
a.jr('nz', 'exp_del')
a.xor_r('a')
a.out_a(JOY_X)
a.ld_r_n('c', 8)
a.label('exp_dl2')
a.dec_r('c')
a.jr('nz', 'exp_dl2')
a.djnz('exp_snd')

a.pop('bc')             # restore original BC (bullet coords)
a.ret()

a.label('cb_nohit')
a.pop('de')
a.pop('hl')

a.label('cb_nx')
a.inc_rp('hl')
a.inc_r('e')
a.ld_r_r('a', 'e')
a.cp_n(NALIENS)
a.jp('c', 'cb_lp')

a.pop('bc')
a.ret()


# ─── collide_bombs: check bombs vs player ─────────────────────────────────────
a.label('collide_bombs')
# Check bomb 0
a.ld_a_lbl('bomb0_y')
a.or_r('a')
a.jr('z', 'cb2_1')
a.cp_n(56)
a.jr('c', 'cb2_1')
a.cp_n(61)
a.jr('nc', 'cb2_1')
# Y is in range, check X
a.ld_a_lbl('bomb0_x')
a.ld_r_r('b', 'a')
a.ld_a_lbl('px')
a.ld_r_r('c', 'a')
a.ld_r_r('a', 'b')
a.sub_r('c')
a.jr('c', 'cb2_1')
a.cp_n(PLAYER_W)
a.jr('nc', 'cb2_1')
# Hit!
a.xor_r('a')
a.ld_lbl_a('bomb0_y')
a.call('player_hit')

a.label('cb2_1')
# Check bomb 1
a.ld_a_lbl('bomb1_y')
a.or_r('a')
a.ret_cc('z')
a.cp_n(56)
a.ret_cc('c')
a.cp_n(61)
a.ret_cc('nc')
a.ld_a_lbl('bomb1_x')
a.ld_r_r('b', 'a')
a.ld_a_lbl('px')
a.ld_r_r('c', 'a')
a.ld_r_r('a', 'b')
a.sub_r('c')
a.ret_cc('c')
a.cp_n(PLAYER_W)
a.ret_cc('nc')
a.xor_r('a')
a.ld_lbl_a('bomb1_y')
a.call('player_hit')
a.ret()

# ─── player_hit ───────────────────────────────────────────────────────────────
a.label('player_hit')
a.ld_a_lbl('lives')
a.or_r('a')
a.ret_cc('z')
a.dec_r('a')
a.ld_lbl_a('lives')
# Death sound
a.ld_r_n('b', 60)
a.label('ph_snd')
a.ld_r_r('a', 'b')
a.out_a(JOY_X)
a.ld_r_n('c', 30)
a.label('ph_del')
a.dec_r('c')
a.jr('nz', 'ph_del')
a.xor_r('a')
a.out_a(JOY_X)
a.djnz('ph_snd')
a.ret()


# ─── draw_all: draw everything ───────────────────────────────────────────────
a.label('draw_all')
a.call('draw_aliens')
a.call('draw_player')
a.call('draw_bullet')
a.call('draw_bomb0')
a.call('draw_bomb1')
a.call('draw_score')
a.call('draw_lives')
a.ret()


# ─── draw_player ──────────────────────────────────────────────────────────────
a.label('draw_player')
a.ld_a_lbl('px')
a.ld_r_r('d', 'a')
a.ld_r_n('e', 58)
a.ld_r_n('c', BRIGHT_CYN)
# Shape:   ..X..   (row 0)
#          .XXX.   (row 1)
#          XXXXX   (row 2)
a.push('de')
a.ld_r_r('a', 'd')
a.add_a_n(2)
a.ld_r_r('d', 'a')
a.call('plot')
a.pop('de')
a.push('de')
a.inc_r('e')
a.inc_r('d')
a.ld_r_n('b', 3)
a.call('hline')
a.pop('de')
a.push('de')
a.inc_r('e')
a.inc_r('e')
a.ld_r_n('b', 5)
a.call('hline')
a.pop('de')
a.ret()


# ─── draw_aliens ──────────────────────────────────────────────────────────────
a.label('draw_aliens')
a.ld_rp_label('hl', 'aliens')
a.ld_r_n('e', 0)       # index

a.label('da_lp')
a.ld_r_r('a', '(hl)')
a.or_r('a')
a.jp('z', 'da_nx')

a.push('hl')
a.push('de')            # save index (in E)
a.ld_r_r('c', 'e')     # C = index for alien_xy
a.call('alien_xy')      # D=x, E=y

# Skip if off-screen
a.ld_r_r('a', 'e')
a.cp_n(61)
a.jr('nc', 'da_skip')

# Save alien position
a.ld_r_r('a', 'd')
a.ld_lbl_a('tmp_ax')
a.ld_r_r('a', 'e')
a.ld_lbl_a('tmp_ay')

# Color by row: use C (alien index, still valid)
a.ld_r_r('a', 'c')
a.srl('a'); a.srl('a'); a.srl('a')  # row
a.and_n(3)
a.ld_rp_label('hl', 'row_colors')
a.ld_r_n('b', 0)
a.ld_r_r('c', 'a')
a.add_hl_rp('bc')
a.ld_r_r('c', '(hl)')  # C = color

# Restore position for drawing
a.ld_a_lbl('tmp_ax')
a.ld_r_r('d', 'a')
a.ld_a_lbl('tmp_ay')
a.ld_r_r('e', 'a')

# Draw alien: 3×2 block
#  X.X   row 0
#  .X.   row 1
a.push('de')
a.call('plot')           # (x, y)
a.push('de')
a.inc_r('d')
a.inc_r('d')
a.call('plot')           # (x+2, y)
a.pop('de')
a.inc_r('e')
a.inc_r('d')
a.call('plot')           # (x+1, y+1)
a.pop('de')

a.label('da_skip')
a.pop('de')              # restore index
a.pop('hl')              # restore grid pointer

a.label('da_nx')
a.inc_rp('hl')
a.inc_r('e')
a.ld_r_r('a', 'e')
a.cp_n(NALIENS)
a.jp('c', 'da_lp')
a.ret()


# ─── draw_bullet ──────────────────────────────────────────────────────────────
a.label('draw_bullet')
a.ld_a_lbl('bul_y')
a.or_r('a')
a.ret_cc('z')
a.ld_r_r('e', 'a')
a.ld_a_lbl('bul_x')
a.ld_r_r('d', 'a')
a.ld_r_n('c', BRIGHT_WHT)
a.call('plot')
a.dec_r('e')
a.call('plot')
a.ret()


# ─── draw_bomb0 / draw_bomb1 ─────────────────────────────────────────────────
a.label('draw_bomb0')
a.ld_a_lbl('bomb0_y')
a.or_r('a')
a.ret_cc('z')
a.ld_r_r('e', 'a')
a.ld_a_lbl('bomb0_x')
a.ld_r_r('d', 'a')
a.ld_r_n('c', BRIGHT_RED)
a.call('plot')
a.ret()

a.label('draw_bomb1')
a.ld_a_lbl('bomb1_y')
a.or_r('a')
a.ret_cc('z')
a.ld_r_r('e', 'a')
a.ld_a_lbl('bomb1_x')
a.ld_r_r('d', 'a')
a.ld_r_n('c', BRIGHT_RED)
a.call('plot')
a.ret()


# ─── draw_score: BCD score as dot-bar at row 0 ───────────────────────────────
a.label('draw_score')
a.ld_a_lbl('score')
a.or_r('a')
a.ret_cc('z')
# Convert BCD to binary for bar length
# High nibble * 10 + low nibble
a.ld_r_r('b', 'a')
a.and_n(0x0F)
a.ld_r_r('c', 'a')     # low digit
a.ld_r_r('a', 'b')
a.srl('a'); a.srl('a'); a.srl('a'); a.srl('a')
# high digit * 10
a.ld_r_r('b', 'a')
a.add_a_r('a')          # *2
a.add_a_r('a')          # *4
a.add_a_r('b')          # *5
a.add_a_r('a')          # *10
a.add_a_r('c')          # + low digit
# Cap at 60
a.cp_n(61)
a.jr('c', 'ds_ok')
a.ld_r_n('a', 60)
a.label('ds_ok')
a.ld_r_r('b', 'a')
a.or_r('a')
a.ret_cc('z')
a.ld_r_n('d', 2)
a.ld_r_n('e', 0)
a.ld_r_n('c', BRIGHT_YEL)
a.call('hline')
a.ret()


# ─── draw_lives: small pips at top-right ──────────────────────────────────────
a.label('draw_lives')
a.ld_a_lbl('lives')
a.or_r('a')
a.ret_cc('z')
a.ld_r_r('b', 'a')
a.ld_r_n('d', 56)
a.ld_r_n('e', 0)
a.ld_r_n('c', BRIGHT_CYN)
a.label('dl_lp')
a.push('bc')
a.call('plot')
a.pop('bc')
a.inc_r('d')
a.inc_r('d')
a.djnz('dl_lp')
a.ret()


# ─── init_game ────────────────────────────────────────────────────────────────
a.label('init_game')
a.ld_r_n('a', 30)
a.ld_lbl_a('px')
a.ld_r_n('a', 3)
a.ld_lbl_a('lives')
a.xor_r('a')
a.ld_lbl_a('score')
a.ld_lbl_a('fcool')
a.ld_lbl_a('bul_y')
a.ld_lbl_a('bomb0_y')
a.ld_lbl_a('bomb1_y')
a.ld_r_n('a', 1)
a.ld_lbl_a('wave')
a.ld_r_n('a', 30)
a.ld_lbl_a('aspeed')
a.call('init_aliens')
a.ret()


# ─── init_aliens ──────────────────────────────────────────────────────────────
a.label('init_aliens')
a.ld_r_n('a', 4)
a.ld_lbl_a('abase_y')
a.xor_r('a')
a.ld_lbl_a('atimer')
a.ld_r_n('a', NALIENS)
a.ld_lbl_a('alive_ct')
a.ld_rp_label('hl', 'aliens')
a.ld_r_n('b', NALIENS)
a.ld_r_n('a', 1)
a.label('ia_lp')
a.ld_r_r('(hl)', 'a')
a.inc_rp('hl')
a.djnz('ia_lp')
a.ret()


# ─── rand: LFSR PRNG → A ─────────────────────────────────────────────────────
a.label('rand')
a.ld_a_lbl('rng')
a.ld_r_r('b', 'a')
a.add_a_r('a')
a.xor_r('b')
a.add_a_n(0x1D)
a.ld_lbl_a('rng')
a.ret()


# ─── title_screen ────────────────────────────────────────────────────────────
a.label('title_screen')
a.call('clear_fb')

# Starfield
a.ld_r_n('b', 50)
a.label('ts_star')
a.push('bc')
a.call('rand')
a.and_n(0x3F)
a.ld_r_r('d', 'a')
a.call('rand')
a.and_n(0x3F)
a.ld_r_r('e', 'a')
a.call('rand')
a.and_n(0x07)
a.or_n(0x08)            # bright color
a.ld_r_r('c', 'a')
a.call('plot')
a.pop('bc')
a.djnz('ts_star')

# Draw large ship
a.ld_r_n('c', BRIGHT_CYN)
# Row 0: tip
a.ld_r_n('d', 31); a.ld_r_n('e', 24)
a.call('plot')
# Row 1
a.ld_r_n('d', 30); a.ld_r_n('e', 25)
a.ld_r_n('b', 3)
a.call('hline')
# Row 2
a.ld_r_n('d', 28); a.ld_r_n('e', 26)
a.ld_r_n('b', 7)
a.call('hline')
# Row 3: wings
a.ld_r_n('d', 27); a.ld_r_n('e', 27)
a.ld_r_n('b', 9)
a.call('hline')
# Row 4: body
a.ld_r_n('d', 29); a.ld_r_n('e', 28)
a.ld_r_n('b', 5)
a.call('hline')
# Engines
a.ld_r_n('c', BRIGHT_RED)
a.ld_r_n('d', 30); a.ld_r_n('e', 29)
a.ld_r_n('b', 3)
a.call('hline')

# "Press fire" bar
a.ld_r_n('c', BRIGHT_YEL)
a.ld_r_n('d', 22); a.ld_r_n('e', 45)
a.ld_r_n('b', 20)
a.call('hline')

a.call('vsync')
a.call('wait_fire')
a.ret()

# ─── wait_fire ────────────────────────────────────────────────────────────────
a.label('wait_fire')
# Wait release
a.label('wf_r')
a.in_a(JOY_BTN)
a.bit(0, 'a')
a.jr('z', 'wf_r')
# Wait press
a.label('wf_p')
a.in_a(JOY_BTN)
a.bit(0, 'a')
a.jr('nz', 'wf_p')
a.ret()


# ═══════════════════════════════════════════════════════════════════════════════
#  DATA
# ═══════════════════════════════════════════════════════════════════════════════

a.label('row_colors')
a.db(BRIGHT_RED, BRIGHT_YEL, BRIGHT_GRN, BRIGHT_MAG)

# ═══════════════════════════════════════════════════════════════════════════════
#  VARIABLES (mutable, after code)
# ═══════════════════════════════════════════════════════════════════════════════

a.label('px');        a.db(30)
a.label('lives');     a.db(3)
a.label('score');     a.db(0)
a.label('wave');      a.db(1)
a.label('in_x');      a.db(0)
a.label('in_btn');    a.db(0xFF)
a.label('fcool');     a.db(0)
a.label('abase_y');   a.db(4)
a.label('atimer');    a.db(0)
a.label('aspeed');    a.db(30)
a.label('alive_ct');  a.db(NALIENS)
a.label('rng');       a.db(0x42)

a.label('bul_y');     a.db(0)
a.label('bul_x');     a.db(0)

a.label('bomb0_y');   a.db(0)
a.label('bomb0_x');   a.db(0)
a.label('bomb1_y');   a.db(0)
a.label('bomb1_x');   a.db(0)

a.label('tmp_ax');    a.db(0)
a.label('tmp_ay');    a.db(0)

a.label('aliens');    a.ds(NALIENS, 1)


# ═══════════════════════════════════════════════════════════════════════════════

out = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'STARDUST.COM')
a.save(out)
print(f"  Code: {len(a.code)} bytes  (0x{a.org:04X}–0x{a.org+len(a.code)-1:04X})")
print(f"  FB:   0x{FB_BASE:04X}–0x{FB_BASE+FB_SIZE-1:04X}")
