import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Opcode table: [opcode, immediate bytes, pops, pushes]
const OP_DEFS: [number, number, number, number][] = [
  [0x00, 0, 0, 0], [0x01, 1, 0, 1], [0x02, 4, 0, 1], [0x03, 0, 1, 0],
  [0x04, 0, 1, 2], [0x05, 0, 2, 2], [0x06, 0, 2, 3], [0x07, 0, 3, 3],
  [0x10, 0, 2, 1], [0x11, 0, 2, 1], [0x12, 0, 2, 1], [0x13, 0, 2, 1],
  [0x14, 0, 2, 1], [0x15, 0, 2, 1], [0x16, 0, 2, 1], [0x17, 0, 1, 1],
  [0x18, 0, 2, 1], [0x19, 0, 2, 1], [0x1a, 0, 2, 1], [0x1b, 0, 1, 1],
  [0x1c, 0, 2, 1], [0x1d, 0, 2, 1], [0x1e, 0, 2, 1], [0x20, 0, 2, 1],
  [0x21, 0, 2, 1], [0x22, 0, 2, 1], [0x30, 2, 0, 0], [0x31, 2, 1, 0],
  [0x32, 2, 1, 0], [0x33, 2, 0, 0], [0x34, 0, 0, 0], [0x40, 0, 1, 1],
  [0x41, 0, 2, 0], [0x50, 0, 1, 0], [0x51, 0, 1, 0], [0x52, 0, 0, 1],
  [0x53, 0, 1, 0],
];

// Encoded opcode metadata: bit 0: valid, bits 1..3: imm, bits 4..5: pops, bits 6..7: pushes
const OP_INFO = new Uint8Array(256);
for (const [op, imm, pops, pushes] of OP_DEFS) {
  OP_INFO[op] = 1 | (imm << 1) | (pops << 4) | (pushes << 6);
}

// Preallocated machine state
const D = new Int32Array(256);
const C = new Int32Array(64);
const M = new Int32Array(256);
const out = new Uint8Array(65536);

function run(program: Uint8Array, input: Uint8Array): { stdout: Uint8Array; exit: number } {
  const n = program.length;
  let sp = 0;
  let csp = 0;
  let olen = 0;
  let inPos = 0;
  let pc = 0;
  let steps = 0;
  M.fill(0);

  const done = (exit: number) => ({ stdout: out.subarray(0, olen), exit });
  const trap = (code: number) => done(code);

  for (;;) {
    if (steps === 1000000) return trap(10);
    if (pc < 0 || pc >= n) return trap(9);
    const info = OP_INFO[program[pc]];
    if (info === 0) return trap(5);
    const imm = (info >> 1) & 7;
    const pops = (info >> 4) & 3;
    const pushes = info >> 6;
    if (pc + imm >= n) return trap(9);
    steps++;
    const next = pc + 1 + imm;
    if (sp < pops) return trap(2);
    if (sp - pops + pushes > 256) return trap(3);
    const op = program[pc];
    pc = next;

    if (op >= 0x10 && op <= 0x22 && op !== 0x17 && op !== 0x1b) {
      const b = D[sp - 1];
      const a = D[sp - 2];
      if (op >= 0x13 && op <= 0x16 && b === 0) return trap(4);
      let r = 0;
      switch (op) {
        case 0x10: r = (a + b) | 0; break;
        case 0x11: r = (a - b) | 0; break;
        case 0x12: r = Math.imul(a, b); break;
        case 0x13: r = a === -2147483648 && b === -1 ? a : (a / b) | 0; break;
        case 0x14: r = b === -1 ? 0 : (a % b) | 0; break;
        case 0x15: r = Math.floor((a >>> 0) / (b >>> 0)) | 0; break;
        case 0x16: r = ((a >>> 0) % (b >>> 0)) | 0; break;
        case 0x18: r = a & b; break;
        case 0x19: r = a | b; break;
        case 0x1a: r = a ^ b; break;
        case 0x1c: r = a << (b & 31); break;
        case 0x1d: r = a >> (b & 31); break;
        case 0x1e: r = (a >>> (b & 31)) | 0; break;
        case 0x20: r = a === b ? 1 : 0; break;
        case 0x21: r = a < b ? 1 : 0; break;
        case 0x22: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
      }
      sp -= 2;
      D[sp++] = r;
      continue;
    }

    switch (op) {
      case 0x00: return done(0);
      case 0x01: D[sp++] = (program[next - 1] << 24) >> 24; break;
      case 0x02:
        D[sp++] = program[next - 4] | (program[next - 3] << 8) | (program[next - 2] << 16) | (program[next - 1] << 24);
        break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: {
        const t = D[sp - 1];
        D[sp - 1] = D[sp - 2];
        D[sp - 2] = t;
        break;
      }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: {
        const a = D[sp - 3];
        D[sp - 3] = D[sp - 2];
        D[sp - 2] = D[sp - 1];
        D[sp - 1] = a;
        break;
      }
      case 0x17: D[sp - 1] = (-D[sp - 1]) | 0; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      case 0x30:
      case 0x31:
      case 0x32: {
        const rel = ((program[next - 2] | (program[next - 1] << 8)) << 16) >> 16;
        if (op === 0x30 || (op === 0x31 ? D[--sp] === 0 : D[--sp] !== 0)) {
          pc = next + rel;
        }
        break;
      }
      case 0x33:
        if (csp === 64) return trap(7);
        C[csp++] = next;
        pc = program[next - 2] | (program[next - 1] << 8);
        break;
      case 0x34:
        if (csp === 0) return trap(8);
        pc = C[--csp];
        break;
      case 0x40: {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return trap(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 0x41: {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return trap(6);
        M[addr] = D[sp - 2];
        sp -= 2;
        break;
      }
      case 0x50: {
        const s = String(D[sp - 1]);
        if (olen + s.length > 65536) return trap(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[olen++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (olen >= 65536) return trap(11);
        out[olen++] = D[--sp] & 255;
        break;
      case 0x52:
        D[sp++] = inPos < input.length ? input[inPos++] : -1;
        break;
      case 0x53:
        return done(D[--sp] & 255);
    }
  }
}

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

for (const id of readdirSync(inputDir).sort()) {
  const p = new Uint8Array(readFileSync(join(inputDir, id, 'program.bin')));
  const inp = new Uint8Array(readFileSync(join(inputDir, id, 'input.bin')));
  const res = run(p, inp);
  const outSubdir = join(outputDir, id);
  mkdirSync(outSubdir, { recursive: true });
  writeFileSync(join(outSubdir, 'stdout.bin'), res.stdout);
  writeFileSync(join(outSubdir, 'exit.txt'), `${res.exit}\n`);
}
