#!/usr/bin/env python3
"""
LANDER — A Lunar Lander game for the Cromemco Dazzler + D+7A joystick.
Builds a CP/M .COM file (Z80 machine code, ORG 0x0100).

Display: 64×64 color, 2K normal mode (16 IBGR colors)
Framebuffer: 0x2000 (page 0x10), 2048 bytes
  4 quadrants of 512 bytes: TL, TR, BL, BR
  Each quadrant: 32×32 pixels, 16 bytes/row, 2 px/byte (low nib=left, high=right)

Joystick: Cromemco D+7A
  Port 0x18: buttons (active-LOW, bit0=exit, bit1=thruster)
  Port 0x19: X-axis (0=center, 1-127=right, 128-255=left)
  Port 0x1A: Y-axis
"""

import os, sys

# ─── Mini Z80 assembler (same as MISSILE / MAZECHASE) ─────────────────────────

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
    def ld_hl_r(self, r): self.emit(0x70 + self.R[r])
    def ld_r_hl(self, r): self.emit(0x46 + self.R[r]*8)

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
DAZ_NX, DAZ_CC = 0x0E, 0x0F
FB_BASE = 0x2000
FB_PAGE = 0x10
FB_SIZE = 2048
JOY_BTN, JOY_X, JOY_Y = 0x18, 0x19, 0x1A

BLACK, RED, GREEN, YELLOW = 0, 1, 2, 3
BLUE, MAGENTA, CYAN, WHITE = 4, 5, 6, 7
BRIGHT = 8
BRIGHT_RED = RED | BRIGHT
BRIGHT_GREEN = GREEN | BRIGHT
BRIGHT_YELLOW = YELLOW | BRIGHT
BRIGHT_WHITE = WHITE | BRIGHT

PAD1_START, PAD1_END = 18, 25
PAD2_START, PAD2_END = 32, 39
PAD3_START, PAD3_END = 46, 53

TERRAIN = (
    [10,11,12,13,14,15,16,17] +
    [16,15,14,13,12,11,10,9,8,8] +
    [8]*8 +
    [9,10,11,12,12,11] +
    [7]*8 +
    [8,9,10,11,12,11] +
    [10]*8 +
    [11,12,13,14,15,16,15,14,13,12]
)
assert len(TERRAIN) == 64

STARS = [
    (4,3), (11,8), (18,5), (26,11),
    (34,4), (41,9), (49,6), (57,12),
    (8,16), (22,18), (38,15), (53,20),
]

EXPLOSION_POINTS = [
    (0, 0, BRIGHT_YELLOW),
    (-1, -1, BRIGHT_RED),
    (1, -1, BRIGHT_YELLOW),
    (-1, 1, BRIGHT_YELLOW),
    (1, 1, BRIGHT_RED),
    (-2, 0, RED),
    (2, 0, BRIGHT_RED),
    (0, -2, YELLOW),
    (0, 2, BRIGHT_YELLOW),
    (-3, 1, RED),
    (3, 1, YELLOW),
    (0, 3, BRIGHT_RED),
]

# ═══════════════════════════════════════════════════════════════════════════════

a = Z80()

# ─── Python emission helpers ───────────────────────────────────────────────────

def plot_imm(x, y, color):
    a.ld_r_n('d', x)
    a.ld_r_n('e', y)
    a.ld_r_n('c', color)
    a.call('plot')


def hline_imm(x, y, w, color):
    if w <= 0:
        return
    a.ld_r_n('d', x)
    a.ld_r_n('e', y)
    a.ld_r_n('b', w)
    a.ld_r_n('c', color)
    a.call('hline')


def plot_relative(xlbl, ylbl, dx, dy, color):
    a.ld_a_lbl(xlbl)
    if dx > 0:
        a.add_a_n(dx)
    elif dx < 0:
        a.sub_n(-dx)
    a.ld_r_r('d', 'a')

    a.ld_a_lbl(ylbl)
    if dy > 0:
        a.add_a_n(dy)
    elif dy < 0:
        a.sub_n(-dy)
    a.ld_r_r('e', 'a')

    a.ld_r_n('c', color)
    a.call('plot')

# ─── Entry ─────────────────────────────────────────────────────────────────────
a.label('start')
a.di()
a.ld_rp_nn('sp', 0x1F00)

a.ld_r_n('a', 0x30)
a.out_a(DAZ_CC)
a.ld_r_n('a', 0x80 | FB_PAGE)
a.out_a(DAZ_NX)

a.call('init_game')

a.label('main_loop')
a.call('vsync')
a.call('poll_exit')
a.ld_a_lbl('frame_ctr')
a.inc_r('a')
a.ld_lbl_a('frame_ctr')

a.ld_a_lbl('success_timer')
a.or_r('a')
a.jp('nz', 'success_frame')

a.ld_a_lbl('explosion_timer')
a.or_r('a')
a.jp('nz', 'explosion_frame')

a.call('read_input')
a.call('apply_gravity')
a.call('apply_thrust')
a.call('move_lander')
a.call('check_landing')

a.ld_a_lbl('success_timer')
a.or_r('a')
a.jp('nz', 'flash_now')

a.call('clear_fb')
a.call('draw_stars')
a.call('draw_terrain')

a.ld_a_lbl('explosion_timer')
a.or_r('a')
a.jp('nz', 'draw_explosion_now')

a.call('draw_lander')
a.call('draw_hud')
a.jp('main_loop')

a.label('flash_now')
a.call('fill_green')
a.jp('main_loop')

a.label('draw_explosion_now')
a.call('draw_explosion')
a.call('draw_hud')
a.jp('main_loop')

a.label('success_frame')
a.call('fill_green')
a.call('tick_success')
a.jp('main_loop')

a.label('explosion_frame')
a.call('clear_fb')
a.call('draw_stars')
a.call('draw_terrain')
a.call('draw_explosion')
a.call('draw_hud')
a.call('tick_explosion')
a.jp('main_loop')

# ═══════════════════════════════════════════════════════════════════════════════
#  SUBROUTINES
# ═══════════════════════════════════════════════════════════════════════════════

a.label('poll_exit')
a.in_a(JOY_BTN)
a.bit(0, 'a')
a.jp('z', 'exit_game')
a.ret()

a.label('init_game')
a.ld_r_n('a', 3)
a.ld_lbl_a('lives')
a.call('init_round')
a.ret()

a.label('init_round')
a.ld_r_n('a', 32)
a.ld_lbl_a('lander_x')
a.ld_r_n('a', 4)
a.ld_lbl_a('lander_y')
a.xor_r('a')
a.ld_lbl_a('vx')
a.ld_lbl_a('vy')
a.ld_lbl_a('grav_ctr')
a.ld_lbl_a('vy_ctr')
a.ld_lbl_a('thrust_on')
a.ld_lbl_a('orient')
a.ld_lbl_a('success_timer')
a.ld_lbl_a('explosion_timer')
a.ld_lbl_a('frame_ctr')
a.ld_r_n('a', 255)
a.ld_lbl_a('fuel')
a.ret()

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

a.label('clear_fb')
a.ld_rp_nn('hl', FB_BASE)
a.ld_rp_nn('de', FB_BASE + 1)
a.ld_rp_nn('bc', FB_SIZE - 1)
a.ld_r_n('(hl)', 0)
a.ldir()
a.ret()

a.label('fill_fb')
a.ld_rp_nn('hl', FB_BASE)
a.ld_rp_nn('de', FB_BASE + 1)
a.ld_rp_nn('bc', FB_SIZE - 1)
a.ld_hl_r('a')
a.ldir()
a.ret()

a.label('fill_green')
a.ld_r_n('a', 0xAA)
a.jp('fill_fb')

a.label('fill_red')
a.ld_r_n('a', 0x99)
a.jp('fill_fb')

# plot: pixel at D=x(0-63), E=y(0-63), color C. Clobbers A,HL
a.label('plot')
a.push('bc')
a.push('de')

a.ld_r_r('a', 'd')
a.cp_n(64)
a.jp('nc', 'pl_out')
a.ld_r_r('a', 'e')
a.cp_n(64)
a.jp('nc', 'pl_out')

a.ld_rp_nn('hl', FB_BASE)

a.ld_r_r('a', 'd')
a.and_n(0x20)
a.jr('z', 'pl_lx')
a.push('bc')
a.ld_rp_nn('bc', 512)
a.add_hl_rp('bc')
a.pop('bc')
a.label('pl_lx')

a.ld_r_r('a', 'e')
a.and_n(0x20)
a.jr('z', 'pl_ly')
a.push('bc')
a.ld_rp_nn('bc', 1024)
a.add_hl_rp('bc')
a.pop('bc')
a.label('pl_ly')

a.ld_r_r('a', 'd')
a.and_n(0x1F)
a.ld_r_r('d', 'a')
a.ld_r_r('a', 'e')
a.and_n(0x1F)

a.push('de')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d')
a.add_hl_rp('de')
a.pop('de')

a.ld_r_r('a', 'd')
a.srl('a')
a.push('de')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.add_hl_rp('de')
a.pop('de')

a.ld_r_r('a', 'd')
a.and_n(1)
a.jr('nz', 'pl_hi')

a.ld_r_r('a', '(hl)')
a.and_n(0xF0)
a.or_r('c')
a.ld_r_r('(hl)', 'a')
a.jr('pl_out')

a.label('pl_hi')
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

a.label('draw_stars')
for sx, sy in STARS:
    plot_imm(sx, sy, WHITE)
a.ret()

a.label('draw_terrain')
a.ld_rp_label('hl', 'terrain')
a.ld_r_n('b', 64)
a.xor_r('a')
a.ld_lbl_a('tmp_x')
a.label('dt_col')
a.push('bc')
a.ld_r_hl('a')
a.ld_lbl_a('tmp_h')
a.ld_a_lbl('tmp_x')
a.ld_r_r('d', 'a')
a.call('is_pad_column')
a.or_r('a')
a.ld_r_n('c', WHITE)
a.jp('z', 'dt_have_color')
a.ld_r_n('c', BRIGHT_GREEN)
a.label('dt_have_color')
a.ld_a_lbl('tmp_h')
a.ld_r_r('b', 'a')
a.ld_r_n('a', 64)
a.sub_r('b')
a.ld_r_r('e', 'a')
a.ld_a_lbl('tmp_h')
a.ld_r_r('b', 'a')
a.label('dt_pix')
a.call('plot')
a.inc_r('e')
a.djnz('dt_pix')
a.pop('bc')
a.inc_rp('hl')
a.ld_a_lbl('tmp_x')
a.inc_r('a')
a.ld_lbl_a('tmp_x')
a.djnz('dt_col')
a.ret()

a.label('is_pad_column')
a.cp_n(PAD1_START)
a.jp('c', 'is_pad_no')
a.cp_n(PAD1_END + 1)
a.jp('c', 'is_pad_yes')
a.cp_n(PAD2_START)
a.jp('c', 'is_pad_no')
a.cp_n(PAD2_END + 1)
a.jp('c', 'is_pad_yes')
a.cp_n(PAD3_START)
a.jp('c', 'is_pad_no')
a.cp_n(PAD3_END + 1)
a.jp('c', 'is_pad_yes')
a.label('is_pad_no')
a.xor_r('a')
a.ret()
a.label('is_pad_yes')
a.ld_r_n('a', 1)
a.ret()

a.label('get_ground_y')
a.push('de')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.ld_rp_label('hl', 'terrain')
a.add_hl_rp('de')
a.ld_r_hl('a')
a.ld_r_r('b', 'a')
a.ld_r_n('a', 64)
a.sub_r('b')
a.pop('de')
a.ret()

a.label('read_input')
a.in_a(JOY_BTN)
a.bit(1, 'a')
a.ld_r_n('a', 1)
a.jp('z', 'ri_store_thrust')
a.xor_r('a')
a.label('ri_store_thrust')
a.ld_lbl_a('thrust_on')

a.in_a(JOY_X)
a.or_r('a')
a.jp('z', 'ri_center')
a.cp_n(128)
a.jp('nc', 'ri_left')

a.label('ri_right')
a.ld_a_lbl('vx')
a.cp_n(3)
a.jp('z', 'ri_right_done')
a.inc_r('a')
a.ld_lbl_a('vx')
a.label('ri_right_done')
a.ld_r_n('a', 1)
a.ld_lbl_a('orient')
a.ret()

a.label('ri_left')
a.ld_a_lbl('vx')
a.cp_n(0xFD)
a.jp('z', 'ri_left_done')
a.dec_r('a')
a.ld_lbl_a('vx')
a.label('ri_left_done')
a.ld_r_n('a', 0xFF)
a.ld_lbl_a('orient')
a.ret()

a.label('ri_center')
a.ld_a_lbl('vx')
a.or_r('a')
a.jp('z', 'ri_center_zero')
a.cp_n(128)
a.jp('c', 'ri_center_pos')
a.inc_r('a')
a.ld_lbl_a('vx')
a.or_r('a')
a.jp('z', 'ri_center_zero')
a.ld_r_n('a', 0xFF)
a.ld_lbl_a('orient')
a.ret()

a.label('ri_center_pos')
a.dec_r('a')
a.ld_lbl_a('vx')
a.or_r('a')
a.jp('z', 'ri_center_zero')
a.ld_r_n('a', 1)
a.ld_lbl_a('orient')
a.ret()

a.label('ri_center_zero')
a.xor_r('a')
a.ld_lbl_a('orient')
a.ret()

a.label('apply_gravity')
a.ld_a_lbl('grav_ctr')
a.inc_r('a')
a.ld_lbl_a('grav_ctr')
a.cp_n(8)
a.ret_cc('c')
a.xor_r('a')
a.ld_lbl_a('grav_ctr')
a.ld_a_lbl('vy')
a.cp_n(15)
a.ret_cc('nc')
a.inc_r('a')
a.ld_lbl_a('vy')
a.ret()

a.label('apply_thrust')
a.ld_a_lbl('thrust_on')
a.or_r('a')
a.ret_cc('z')
a.ld_a_lbl('fuel')
a.or_r('a')
a.ret_cc('z')
a.dec_r('a')
a.ld_lbl_a('fuel')
a.ld_a_lbl('vy')
a.or_r('a')
a.jp('z', 'at_lift')
a.cp_n(2)
a.jp('c', 'at_zero_vy')
a.sub_n(2)
a.ld_lbl_a('vy')
a.jp('at_lift')
a.label('at_zero_vy')
a.xor_r('a')
a.ld_lbl_a('vy')
a.label('at_lift')
a.ld_a_lbl('frame_ctr')
a.and_n(1)
a.ret_cc('nz')
a.ld_a_lbl('lander_y')
a.or_r('a')
a.ret_cc('z')
a.dec_r('a')
a.ld_lbl_a('lander_y')
a.ret()

a.label('move_lander')
a.ld_a_lbl('vx')
a.or_r('a')
a.jp('z', 'mv_vertical')
a.cp_n(128)
a.jp('c', 'mv_right')

a.cp_n(0xFF)
a.jp('nz', 'mv_left_step')
a.ld_a_lbl('frame_ctr')
a.and_n(1)
a.jp('nz', 'mv_vertical')
a.label('mv_left_step')
a.ld_a_lbl('lander_x')
a.cp_n(1)
a.jp('z', 'mv_vertical')
a.jp('c', 'mv_vertical')
a.dec_r('a')
a.ld_lbl_a('lander_x')
a.jp('mv_vertical')

a.label('mv_right')
a.ld_a_lbl('vx')
a.cp_n(1)
a.jp('nz', 'mv_right_step')
a.ld_a_lbl('frame_ctr')
a.and_n(1)
a.jp('nz', 'mv_vertical')
a.label('mv_right_step')
a.ld_a_lbl('lander_x')
a.cp_n(62)
a.jp('nc', 'mv_vertical')
a.inc_r('a')
a.ld_lbl_a('lander_x')

a.label('mv_vertical')
a.ld_a_lbl('vy_ctr')
a.inc_r('a')
a.ld_lbl_a('vy_ctr')
a.ld_a_lbl('vy')
a.ld_r_r('b', 'a')
a.ld_r_n('a', 16)
a.sub_r('b')
a.ld_r_r('b', 'a')
a.ld_a_lbl('vy_ctr')
a.cp_r('b')
a.ret_cc('c')
a.xor_r('a')
a.ld_lbl_a('vy_ctr')
a.ld_a_lbl('lander_y')
a.cp_n(61)
a.ret_cc('nc')
a.inc_r('a')
a.ld_lbl_a('lander_y')
a.ret()

a.label('check_landing')
a.ld_a_lbl('lander_x')
a.call('get_ground_y')
a.ld_lbl_a('tmp_ground')
a.ld_a_lbl('lander_y')
a.add_a_n(2)
a.ld_r_r('b', 'a')
a.ld_a_lbl('tmp_ground')
a.cp_r('b')
a.jp('z', 'cl_collision')
a.jp('c', 'cl_collision')
a.ret()

a.label('cl_collision')
a.ld_a_lbl('lander_x')
a.call('is_pad_column')
a.or_r('a')
a.jp('z', 'cl_crash')
a.ld_a_lbl('vy')
a.cp_n(3)
a.jp('nc', 'cl_crash')
a.ld_a_lbl('vx')
a.or_r('a')
a.jp('z', 'cl_land')
a.cp_n(1)
a.jp('z', 'cl_land')
a.cp_n(0xFF)
a.jp('z', 'cl_land')

a.label('cl_crash')
a.ld_r_n('a', 12)
a.ld_lbl_a('explosion_timer')
a.xor_r('a')
a.ld_lbl_a('thrust_on')
a.ret()

a.label('cl_land')
a.ld_a_lbl('tmp_ground')
a.sub_n(2)
a.ld_lbl_a('lander_y')
a.xor_r('a')
a.ld_lbl_a('vx')
a.ld_lbl_a('vy')
a.ld_lbl_a('thrust_on')
a.ld_r_n('a', 16)
a.ld_lbl_a('success_timer')
a.ret()

a.label('tick_success')
a.ld_a_lbl('success_timer')
a.or_r('a')
a.ret_cc('z')
a.dec_r('a')
a.ld_lbl_a('success_timer')
a.jp('nz', 'ts_done')
a.call('init_round')
a.label('ts_done')
a.ret()

a.label('tick_explosion')
a.ld_a_lbl('explosion_timer')
a.or_r('a')
a.ret_cc('z')
a.dec_r('a')
a.ld_lbl_a('explosion_timer')
a.jp('nz', 'te_done')
a.ld_a_lbl('lives')
a.or_r('a')
a.jp('z', 'game_over')
a.dec_r('a')
a.ld_lbl_a('lives')
a.jp('z', 'game_over')
a.call('init_round')
a.label('te_done')
a.ret()

a.label('draw_lander')
plot_relative('lander_x', 'lander_y', 0, 0, BRIGHT_WHITE)
plot_relative('lander_x', 'lander_y', -1, 1, BRIGHT_WHITE)
plot_relative('lander_x', 'lander_y', 1, 1, BRIGHT_WHITE)

a.ld_a_lbl('orient')
a.cp_n(0xFF)
a.jp('z', 'dl_left')
a.cp_n(1)
a.jp('z', 'dl_right')
plot_relative('lander_x', 'lander_y', 0, 1, BRIGHT_WHITE)
a.jp('dl_thruster')

a.label('dl_left')
plot_relative('lander_x', 'lander_y', -1, 0, BRIGHT_WHITE)
a.jp('dl_thruster')

a.label('dl_right')
plot_relative('lander_x', 'lander_y', 1, 0, BRIGHT_WHITE)

a.label('dl_thruster')
a.ld_a_lbl('thrust_on')
a.or_r('a')
a.ret_cc('z')
a.ld_a_lbl('fuel')
a.or_r('a')
a.ret_cc('z')
plot_relative('lander_x', 'lander_y', 0, 2, BRIGHT_YELLOW)
plot_relative('lander_x', 'lander_y', 0, 3, YELLOW)
a.ret()

a.label('draw_explosion')
for dx, dy, color in EXPLOSION_POINTS:
    plot_relative('lander_x', 'lander_y', dx, dy, color)
a.ret()

a.label('draw_hud')
a.ld_a_lbl('fuel')
a.srl('a'); a.srl('a'); a.srl('a'); a.srl('a')
a.or_r('a')
a.jp('z', 'dh_vel')
a.ld_r_r('b', 'a')
a.ld_r_n('d', 1)
a.ld_r_n('e', 1)
a.ld_r_n('c', BRIGHT_GREEN)
a.call('hline')
a.ld_r_n('d', 1)
a.ld_r_n('e', 2)
a.ld_r_n('c', BRIGHT_GREEN)
a.call('hline')

a.label('dh_vel')
a.ld_a_lbl('vy')
a.or_r('a')
a.jp('z', 'dh_lives')
a.ld_r_r('b', 'a')
a.ld_r_n('c', BRIGHT_YELLOW)
a.cp_n(8)
a.jp('c', 'dh_vel_color_done')
a.ld_r_n('c', BRIGHT_RED)
a.label('dh_vel_color_done')
a.ld_r_n('a', 63)
a.sub_r('b')
a.ld_r_r('d', 'a')
a.ld_r_n('e', 1)
a.call('hline')
a.ld_r_n('a', 63)
a.sub_r('b')
a.ld_r_r('d', 'a')
a.ld_r_n('e', 2)
a.call('hline')

a.label('dh_lives')
a.ld_a_lbl('lives')
a.or_r('a')
a.jp('z', 'dh_done')
plot_imm(1, 4, BRIGHT_RED)
a.ld_a_lbl('lives')
a.cp_n(2)
a.jp('c', 'dh_done')
plot_imm(3, 4, BRIGHT_RED)
a.ld_a_lbl('lives')
a.cp_n(3)
a.jp('c', 'dh_done')
plot_imm(5, 4, BRIGHT_RED)

a.label('dh_done')
a.ret()

a.label('game_over')
a.call('fill_red')
a.call('vsync')
a.call('vsync')
a.jp('exit_game')

a.label('exit_game')
a.emit(0xC3, 0x00, 0x00)

# ═══════════════════════════════════════════════════════════════════════════════
#  DATA
# ═══════════════════════════════════════════════════════════════════════════════

a.label('terrain')
a.db(*TERRAIN)

a.label('lives');            a.db(3)
a.label('fuel');             a.db(255)
a.label('lander_x');         a.db(32)
a.label('lander_y');         a.db(4)
a.label('vx');               a.db(0)
a.label('vy');               a.db(0)
a.label('grav_ctr');         a.db(0)
a.label('vy_ctr');           a.db(0)
a.label('frame_ctr');        a.db(0)
a.label('thrust_on');        a.db(0)
a.label('orient');           a.db(0)
a.label('success_timer');    a.db(0)
a.label('explosion_timer');  a.db(0)
a.label('tmp_x');            a.db(0)
a.label('tmp_h');            a.db(0)
a.label('tmp_ground');       a.db(0)

# ─── Save ──────────────────────────────────────────────────────────────────────
out = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'LANDER.COM')
a.save(out)
out2 = os.path.join(os.path.dirname(__file__), '..', 'games', 'LANDER.COM')
a.save(out2)
print(f"  Code: {len(a.code)} bytes  (0x{a.org:04X}–0x{a.org+len(a.code)-1:04X})")
print(f"  FB:   0x{FB_BASE:04X}–0x{FB_BASE+FB_SIZE-1:04X}")
