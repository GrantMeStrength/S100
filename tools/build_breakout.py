#!/usr/bin/env python3
"""
BREAKOUT — A brick-breaker game for the Cromemco Dazzler + D+7A joystick.
Builds a CP/M .COM file (Z80 machine code, ORG 0x0100).

Display: 64×64 color, 2K normal mode (16 IBGR colors)
Framebuffer: 0x2000 (page 0x10), 2048 bytes
  4 quadrants of 512 bytes: TL, TR, BL, BR
  Each quadrant: 32×32 pixels, 16 bytes/row, 2 px/byte (low nib=left, high=right)

Joystick: Cromemco D+7A
  Port 0x18: buttons (active-LOW, bit0=exit, bit1=launch)
  Port 0x19: X-axis (0=center, 1-127=right, 128-255=left)
  Port 0x1A: Y-axis
"""

import os, sys

# ─── Mini Z80 assembler (same as MAZECHASE) ────────────────────────────────────

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
BRIGHT_CYAN = CYAN | BRIGHT
BRIGHT_BLUE = BLUE | BRIGHT
BRIGHT_WHITE = WHITE | BRIGHT

PADDLE_Y = 60
PADDLE_W = 8
BALL_REST_Y = 59
BRICK_W = 7
BRICK_H = 2
BRICK_STEP_X = 8
BRICK_STEP_Y = 3
BRICK_START_Y = 6
BRICK_COLS = 8
BRICK_ROWS = 5
BRICK_COUNT = BRICK_COLS * BRICK_ROWS

BRICK_ROW_COLORS = [
    BRIGHT_RED,
    BRIGHT_YELLOW,
    BRIGHT_GREEN,
    BRIGHT_CYAN,
    BRIGHT_BLUE,
]

BRICKS = []
for row in range(BRICK_ROWS):
    y = BRICK_START_Y + row * BRICK_STEP_Y
    for col in range(BRICK_COLS):
        x = col * BRICK_STEP_X
        BRICKS.append((row, col, x, y, BRICK_ROW_COLORS[row]))

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


def brick_label(idx):
    return f'brick_{idx}'


def emit_draw_brick(x, y, color_reg='a'):
    a.ld_r_r('c', color_reg)
    a.ld_r_n('d', x)
    a.ld_r_n('e', y)
    a.ld_r_n('b', BRICK_W)
    a.call('hline')
    a.ld_r_n('d', x)
    a.ld_r_n('e', y + 1)
    a.ld_r_n('b', BRICK_W)
    a.call('hline')


def emit_erase_brick(x, y):
    hline_imm(x, y, BRICK_W, BLACK)
    hline_imm(x, y + 1, BRICK_W, BLACK)


# ─── Entry ─────────────────────────────────────────────────────────────────────
a.label('start')
a.di()
a.ld_rp_nn('sp', 0x1F00)

a.ld_r_n('a', 0x30)
a.out_a(DAZ_CC)
a.ld_r_n('a', 0x80 | FB_PAGE)
a.out_a(DAZ_NX)

a.in_a(DAZ_NX)
a.ld_lbl_a('rng')

a.call('init_game')

# ─── Main loop ─────────────────────────────────────────────────────────────────
a.label('main_loop')
a.call('vsync')
a.call('erase_ball')
a.call('erase_paddle')
a.call('read_input')
a.call('move_paddle')
a.call('move_ball')
a.call('draw_paddle')
a.call('draw_ball')
a.jp('main_loop')

# ═══════════════════════════════════════════════════════════════════════════════
#  SUBROUTINES
# ═══════════════════════════════════════════════════════════════════════════════

a.label('init_game')
a.call('clear_fb')
a.ld_r_n('a', 3)
a.ld_lbl_a('lives')
a.xor_r('a')
a.ld_lbl_a('score')
a.ld_lbl_a('level')
a.ld_lbl_a('launch_request')
a.ld_r_n('a', 1)
a.ld_lbl_a('level')
a.ld_r_n('a', 2)
a.ld_lbl_a('ball_delay')
a.call('init_level')
a.ret()

a.label('init_level')
a.call('clear_fb')
a.ld_rp_label('hl', 'brick_init')
a.ld_rp_label('de', 'brick_state')
a.ld_rp_nn('bc', BRICK_COUNT)
a.ldir()
a.ld_r_n('a', BRICK_COUNT)
a.ld_lbl_a('bricks_left')
a.ld_r_n('a', 28)
a.ld_lbl_a('paddle_x')
a.xor_r('a')
a.ld_lbl_a('launched')
a.ld_lbl_a('launch_request')
a.ld_lbl_a('ball_dx')
a.ld_r_n('a', 0xFF)
a.ld_lbl_a('ball_dy')
a.ld_a_lbl('ball_delay')
a.ld_lbl_a('ball_timer')
a.call('sync_ball_to_paddle')
a.call('draw_bricks')
a.ret()

a.label('sync_ball_to_paddle')
a.ld_a_lbl('paddle_x')
a.add_a_n(3)
a.ld_lbl_a('ball_x')
a.ld_r_n('a', BALL_REST_Y)
a.ld_lbl_a('ball_y')
a.ret()

a.label('erase_ball')
a.ld_a_lbl('ball_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('ball_y')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BLACK)
a.call('plot')
a.ret()

a.label('draw_ball')
a.ld_a_lbl('ball_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('ball_y')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BRIGHT_WHITE)
a.call('plot')
a.ret()

a.label('erase_paddle')
a.ld_a_lbl('paddle_x')
a.ld_r_r('d', 'a')
a.ld_r_n('e', PADDLE_Y)
a.ld_r_n('b', PADDLE_W)
a.ld_r_n('c', BLACK)
a.call('hline')
a.ret()

a.label('draw_paddle')
a.ld_a_lbl('paddle_x')
a.ld_r_r('d', 'a')
a.ld_r_n('e', PADDLE_Y)
a.ld_r_n('b', PADDLE_W)
a.ld_r_n('c', BRIGHT_WHITE)
a.call('hline')
a.ret()

a.label('read_input')
a.in_a(JOY_X)
a.ld_lbl_a('in_x')
a.in_a(JOY_BTN)
a.ld_lbl_a('in_btn')

a.ld_a_lbl('in_btn')
a.bit(0, 'a')
a.call('z', 'exit_to_cpm')

a.ld_a_lbl('in_btn')
a.bit(1, 'a')
a.jp('nz', 'ri_done')
a.ld_a_lbl('launched')
a.or_r('a')
a.jp('nz', 'ri_done')
a.ld_r_n('a', 1)
a.ld_lbl_a('launch_request')
a.label('ri_done')
a.ret()

a.label('move_paddle')
a.ld_a_lbl('in_x')
a.cp_n(128)
a.jp('nc', 'mp_left')
a.or_r('a')
a.ret_cc('z')
a.ld_a_lbl('paddle_x')
a.cp_n(56)
a.ret_cc('nc')
a.inc_r('a')
a.ld_lbl_a('paddle_x')
a.ret()

a.label('mp_left')
a.ld_a_lbl('paddle_x')
a.or_r('a')
a.ret_cc('z')
a.dec_r('a')
a.ld_lbl_a('paddle_x')
a.ret()

a.label('move_ball')
a.ld_a_lbl('launched')
a.or_r('a')
a.jp('nz', 'mb_active')
a.call('sync_ball_to_paddle')
a.ld_a_lbl('launch_request')
a.or_r('a')
a.ret_cc('z')
a.xor_r('a')
a.ld_lbl_a('launch_request')
a.ld_r_n('a', 1)
a.ld_lbl_a('launched')
a.call('rand8')
a.and_n(1)
a.jp('z', 'mb_launch_left')
a.ld_r_n('a', 1)
a.ld_lbl_a('ball_dx')
a.jp('mb_launch_common')
a.label('mb_launch_left')
a.ld_r_n('a', 0xFF)
a.ld_lbl_a('ball_dx')
a.label('mb_launch_common')
a.ld_r_n('a', 0xFF)
a.ld_lbl_a('ball_dy')
a.ld_a_lbl('ball_delay')
a.ld_lbl_a('ball_timer')
a.ret()

a.label('mb_active')
a.ld_a_lbl('ball_timer')
a.or_r('a')
a.jp('z', 'mb_do_move')
a.dec_r('a')
a.ld_lbl_a('ball_timer')
a.ret()

a.label('mb_do_move')
a.ld_a_lbl('ball_delay')
a.ld_lbl_a('ball_timer')

a.ld_a_lbl('ball_dx')
a.or_r('a')
a.jp('z', 'mb_vertical')
a.cp_n(0xFF)
a.jp('z', 'mb_move_left')

a.ld_a_lbl('ball_x')
a.cp_n(63)
a.jp('z', 'mb_wall_right')
a.inc_r('a')
a.ld_lbl_a('ball_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('ball_y')
a.ld_r_r('e', 'a')
a.call('check_brick_hit')
a.or_r('a')
a.jp('z', 'mb_vertical')
a.ld_a_lbl('ball_x')
a.dec_r('a')
a.ld_lbl_a('ball_x')
a.ld_r_n('a', 0xFF)
a.ld_lbl_a('ball_dx')
a.ld_a_lbl('bricks_left')
a.or_r('a')
a.jp('z', 'mb_level_done')
a.jp('mb_vertical')

a.label('mb_wall_right')
a.ld_r_n('a', 62)
a.ld_lbl_a('ball_x')
a.ld_r_n('a', 0xFF)
a.ld_lbl_a('ball_dx')
a.jp('mb_vertical')

a.label('mb_move_left')
a.ld_a_lbl('ball_x')
a.or_r('a')
a.jp('z', 'mb_wall_left')
a.dec_r('a')
a.ld_lbl_a('ball_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('ball_y')
a.ld_r_r('e', 'a')
a.call('check_brick_hit')
a.or_r('a')
a.jp('z', 'mb_vertical')
a.ld_a_lbl('ball_x')
a.inc_r('a')
a.ld_lbl_a('ball_x')
a.ld_r_n('a', 1)
a.ld_lbl_a('ball_dx')
a.ld_a_lbl('bricks_left')
a.or_r('a')
a.jp('z', 'mb_level_done')
a.jp('mb_vertical')

a.label('mb_wall_left')
a.ld_r_n('a', 1)
a.ld_lbl_a('ball_x')
a.ld_r_n('a', 1)
a.ld_lbl_a('ball_dx')

a.label('mb_vertical')
a.ld_a_lbl('ball_dy')
a.cp_n(0xFF)
a.jp('z', 'mb_move_up')

a.ld_a_lbl('ball_y')
a.inc_r('a')
a.ld_lbl_a('ball_y')
a.cp_n(PADDLE_Y)
a.jp('c', 'mb_down_brick')
a.jp('z', 'mb_try_paddle')
a.cp_n(63)
a.jp('nc', 'mb_life_lost')
a.jp('mb_down_brick')

a.label('mb_try_paddle')
a.ld_a_lbl('ball_x')
a.ld_r_r('d', 'a')
a.call('check_paddle_hit')
a.or_r('a')
a.jp('z', 'mb_down_brick')
a.ld_r_n('a', BALL_REST_Y)
a.ld_lbl_a('ball_y')
a.ret()

a.label('mb_down_brick')
a.ld_a_lbl('ball_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('ball_y')
a.ld_r_r('e', 'a')
a.call('check_brick_hit')
a.or_r('a')
a.ret_cc('z')
a.ld_a_lbl('ball_y')
a.dec_r('a')
a.ld_lbl_a('ball_y')
a.ld_r_n('a', 0xFF)
a.ld_lbl_a('ball_dy')
a.ld_a_lbl('bricks_left')
a.or_r('a')
a.jp('z', 'mb_level_done')
a.ret()

a.label('mb_move_up')
a.ld_a_lbl('ball_y')
a.or_r('a')
a.jp('z', 'mb_top_bounce')
a.dec_r('a')
a.ld_lbl_a('ball_y')
a.ld_a_lbl('ball_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('ball_y')
a.ld_r_r('e', 'a')
a.call('check_brick_hit')
a.or_r('a')
a.ret_cc('z')
a.ld_a_lbl('ball_y')
a.inc_r('a')
a.ld_lbl_a('ball_y')
a.ld_r_n('a', 1)
a.ld_lbl_a('ball_dy')
a.ld_a_lbl('bricks_left')
a.or_r('a')
a.jp('z', 'mb_level_done')
a.ret()

a.label('mb_top_bounce')
a.ld_r_n('a', 1)
a.ld_lbl_a('ball_y')
a.ld_lbl_a('ball_dy')
a.ret()

a.label('mb_life_lost')
a.call('lose_life')
a.ret()

a.label('mb_level_done')
a.call('next_level')
a.ret()

a.label('check_paddle_hit')
a.ld_r_r('b', 'd')
a.ld_a_lbl('paddle_x')
a.ld_r_r('c', 'a')
a.ld_r_r('a', 'b')
a.sub_r('c')
a.jp('c', 'cph_nohit')
a.cp_n(PADDLE_W)
a.jp('nc', 'cph_nohit')
a.ld_r_r('b', 'a')
a.cp_n(3)
a.jp('c', 'cph_left')
a.cp_n(6)
a.jp('c', 'cph_center')
a.ld_r_n('a', 1)
a.ld_lbl_a('ball_dx')
a.jp('cph_hit')

a.label('cph_center')
a.xor_r('a')
a.ld_lbl_a('ball_dx')
a.jp('cph_hit')

a.label('cph_left')
a.ld_r_n('a', 0xFF)
a.ld_lbl_a('ball_dx')

a.label('cph_hit')
a.ld_r_n('a', 0xFF)
a.ld_lbl_a('ball_dy')
a.ld_r_n('a', 1)
a.ret()

a.label('cph_nohit')
a.xor_r('a')
a.ret()

a.label('check_brick_hit')
for idx, (_, _, x, y, _) in enumerate(BRICKS):
    nxt = f'cbh_next_{idx}'
    a.ld_r_r('a', 'e')
    a.cp_n(y)
    a.jp('c', nxt)
    a.cp_n(y + BRICK_H)
    a.jp('nc', nxt)
    a.ld_r_r('a', 'd')
    a.cp_n(x)
    a.jp('c', nxt)
    a.cp_n(x + BRICK_W)
    a.jp('nc', nxt)
    a.ld_a_lbl(brick_label(idx))
    a.or_r('a')
    a.jp('z', nxt)
    a.xor_r('a')
    a.ld_lbl_a(brick_label(idx))
    a.ld_a_lbl('score')
    a.inc_r('a')
    a.ld_lbl_a('score')
    a.ld_a_lbl('bricks_left')
    a.dec_r('a')
    a.ld_lbl_a('bricks_left')
    emit_erase_brick(x, y)
    a.ld_r_n('a', 1)
    a.ret()
    a.label(nxt)
a.xor_r('a')
a.ret()

a.label('draw_bricks')
for idx, (_, _, x, y, _) in enumerate(BRICKS):
    nxt = f'db_skip_{idx}'
    a.ld_a_lbl(brick_label(idx))
    a.or_r('a')
    a.jp('z', nxt)
    emit_draw_brick(x, y)
    a.label(nxt)
a.ret()

a.label('lose_life')
a.xor_r('a')
a.ld_lbl_a('launched')
a.ld_lbl_a('launch_request')
a.ld_a_lbl('lives')
a.dec_r('a')
a.ld_lbl_a('lives')
a.or_r('a')
a.jp('z', 'game_over')
a.ld_a_lbl('ball_delay')
a.ld_lbl_a('ball_timer')
a.ld_r_n('a', 28)
a.ld_lbl_a('paddle_x')
a.call('sync_ball_to_paddle')
a.ret()

a.label('next_level')
a.ld_a_lbl('level')
a.inc_r('a')
a.ld_lbl_a('level')
a.ld_a_lbl('ball_delay')
a.cp_n(1)
a.jp('z', 'nl_keep_speed')
a.dec_r('a')
a.ld_lbl_a('ball_delay')
a.label('nl_keep_speed')
a.call('init_level')
a.ret()

a.label('game_over')
a.call('clear_fb')
hline_imm(16, 26, 32, BRIGHT_RED)
hline_imm(12, 27, 40, BRIGHT_RED)
hline_imm(8, 28, 48, BRIGHT_YELLOW)
hline_imm(8, 29, 48, BRIGHT_YELLOW)
hline_imm(12, 30, 40, BRIGHT_RED)
hline_imm(16, 31, 32, BRIGHT_RED)
hline_imm(24, 36, 16, BRIGHT_BLUE)
hline_imm(22, 37, 20, BRIGHT_BLUE)
hline_imm(20, 38, 24, BRIGHT_CYAN)
hline_imm(18, 39, 28, BRIGHT_CYAN)
hline_imm(20, 40, 24, BRIGHT_BLUE)
hline_imm(22, 41, 20, BRIGHT_BLUE)
a.ld_r_n('b', 180)
a.label('go_wait')
a.call('vsync')
a.djnz('go_wait')
a.jp('exit_to_cpm')

a.label('rand8')
a.ld_a_lbl('rng')
a.ld_r_r('b', 'a')
a.add_a_r('a')
a.add_a_r('a')
a.add_a_r('b')
a.add_a_n(3)
a.ld_lbl_a('rng')
a.ret()

a.label('exit_to_cpm')
a.emit(0xC3, 0x00, 0x00)

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

# ─── Data ──────────────────────────────────────────────────────────────────────
a.label('in_x'); a.db(0)
a.label('in_btn'); a.db(0xFF)
a.label('paddle_x'); a.db(28)
a.label('ball_x'); a.db(31)
a.label('ball_y'); a.db(BALL_REST_Y)
a.label('ball_dx'); a.db(0)
a.label('ball_dy'); a.db(0xFF)
a.label('ball_delay'); a.db(2)
a.label('ball_timer'); a.db(2)
a.label('launched'); a.db(0)
a.label('launch_request'); a.db(0)
a.label('lives'); a.db(3)
a.label('level'); a.db(1)
a.label('score'); a.db(0)
a.label('bricks_left'); a.db(BRICK_COUNT)
a.label('rng'); a.db(0x5A)

a.label('brick_init')
for _, _, _, _, color in BRICKS:
    a.db(color)

a.label('brick_state')
for idx in range(BRICK_COUNT):
    a.label(brick_label(idx)); a.db(0)

# ─── Save ──────────────────────────────────────────────────────────────────────
out = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'BREAKOUT.COM')
a.save(out)
out2 = os.path.join(os.path.dirname(__file__), '..', 'games', 'BREAKOUT.COM')
a.save(out2)
