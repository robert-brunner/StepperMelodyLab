// StepperMelodyLab.jsx
// React port — includes Three.js ESP32 WROOM-32 pinout visualizer.
// Pauses between notes: halfPeriodUs=0 segments → motor holds still (rest preserved).

import { useState, useEffect, useRef } from "react";
import Esp32Viewer from "./Esp32Viewer";

// ─── MIDI / Firmware Engine (unchanged) ──────────────────────────────────────

const freq = n => 440 * Math.pow(2, (n - 69) / 12);
const noteName = n => ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n % 12] + (Math.floor(n / 12) - 1);

function parseMidi(buffer) {
  const b = new Uint8Array(buffer); let p = 0;
  const need = n => { if (p + n > b.length) throw Error('Truncated MIDI file.'); };
  const u8 = () => { need(1); return b[p++]; };
  const u16 = () => u8() * 256 + u8();
  const u32 = () => u8() * 16777216 + u8() * 65536 + u8() * 256 + u8();
  const str = n => { need(n); const x = String.fromCharCode(...b.slice(p, p + n)); p += n; return x; };
  const vlq = () => { let v = 0; for (let i = 0; i < 4; i++) { const c = u8(); v = v * 128 + (c & 127); if (c < 128) return v; } throw Error('Invalid VLQ.'); };
  if (str(4) !== 'MThd') throw Error('Not a standard MIDI file.');
  const header = u32(); if (header < 6) throw Error('Invalid MIDI header.');
  const format = u16(), ntr = u16(), ppq = u16();
  if (format > 1) throw Error('MIDI format 2 not supported.');
  if (ppq & 32768) throw Error('SMPTE-timed MIDI not supported.');
  if (!ppq) throw Error('Invalid time division.');
  need(header - 6); p += header - 6;
  const tempos = [{ tick: 0, tempo: 500000, order: -1 }], notes = [], parts = [];
  let eventCount = 0, maxTick = 0;
  for (let ti = 0; ti < ntr; ti++) {
    if (str(4) !== 'MTrk') throw Error('Missing MIDI track.');
    const len = u32(); need(len); const end = p + len;
    let tick = 0, running = 0, trackName = 'Track ' + (ti + 1);
    const active = new Map(), sustained = [], pedal = Array(16).fill(false), program = Array(16).fill(0);
    const finish = (n, t) => { if (t > n.startTick) notes.push({ ...n, endTick: t }); };
    while (p < end) {
      if (++eventCount > 1000000) throw Error('MIDI exceeds 1M event limit.');
      tick += vlq(); let s = u8();
      if (s < 128) { if (!running) throw Error('Invalid running status.'); p--; s = running; }
      else if (s < 240) running = s;
      if (s === 255) {
        const type = u8(), n = vlq(); need(n); if (p + n > end) throw Error('Invalid meta-event length.');
        if (type === 3) trackName = new TextDecoder().decode(b.slice(p, p + n));
        if (type === 81 && n === 3) { const tempo = b[p] * 65536 + b[p + 1] * 256 + b[p + 2]; if (tempo > 0) tempos.push({ tick, tempo, order: eventCount }); }
        p += n;
      } else if (s === 240 || s === 247) { running = 0; const n = vlq(); need(n); p += n; }
      else if (s < 240) {
        const kind = s >> 4, ch = s & 15, a = u8(), v = (kind === 12 || kind === 13) ? 0 : u8();
        if (a > 127 || v > 127) throw Error('Invalid MIDI data byte.');
        const key = ch + ':' + a;
        if (kind === 9 && v) { const q = active.get(key) || []; q.push({ track: ti, channel: ch, note: a, velocity: v, startTick: tick, program: program[ch] }); active.set(key, q); }
        else if (kind === 8 || (kind === 9 && !v)) { const q = active.get(key); if (q?.length) { const n = q.shift(); if (pedal[ch]) sustained.push(n); else finish(n, tick); } }
        else if (kind === 12) program[ch] = a;
        else if (kind === 11 && a === 64) { pedal[ch] = v >= 64; if (!pedal[ch]) for (let k = sustained.length - 1; k >= 0; k--) if (sustained[k].channel === ch) finish(sustained.splice(k, 1)[0], tick); }
        else if (kind === 11 && (a === 120 || a === 123)) {
          for (const q of active.values()) for (let k = q.length - 1; k >= 0; k--) if (q[k].channel === ch) finish(q.splice(k, 1)[0], tick);
          for (let k = sustained.length - 1; k >= 0; k--) if (sustained[k].channel === ch) finish(sustained.splice(k, 1)[0], tick);
        }
      } else throw Error('Unsupported MIDI system event.');
      if (p > end) throw Error('Event extends beyond MIDI track.');
    }
    for (const q of active.values()) for (const n of q) finish(n, tick);
    for (const n of sustained) finish(n, tick);
    maxTick = Math.max(maxTick, tick); parts.push({ track: ti, name: trackName }); p = end;
  }
  tempos.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const map = []; let lastTick = 0, lastMs = 0, tempo = 500000;
  for (const t of tempos) {
    lastMs += (t.tick - lastTick) * tempo / ppq / 1000; lastTick = t.tick; tempo = t.tempo;
    if (map.length && map.at(-1).tick === t.tick) map.pop();
    map.push({ tick: t.tick, ms: lastMs, tempo });
  }
  const toMs = t => { let lo = 0, hi = map.length - 1; while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (map[m].tick <= t) lo = m; else hi = m - 1; } const a = map[lo]; return a.ms + (t - a.tick) * a.tempo / ppq / 1000; };
  const groups = new Map();
  for (const n of notes) {
    if (n.channel === 9) continue;
    const key = n.track + ':' + n.channel;
    if (!groups.has(key)) groups.set(key, { id: key, name: parts[n.track].name + ' · ch ' + (n.channel + 1), notes: [] });
    groups.get(key).notes.push({ ...n, start: toMs(n.startTick), end: toMs(n.endTick) });
  }
  const result = [...groups.values()].filter(g => g.notes.length);
  for (const g of result) g.notes.sort((a, b) => a.start - b.start || a.note - b.note);
  rankGroups(result);
  if (!result.length) throw Error('No pitched notes found (percussion excluded).');
  return { groups: result, format, ppq, tempoChanges: map.length, duration: Math.round(toMs(maxTick)) };
}

function rankGroups(groups) {
  const total = Math.max(1, ...groups.map(g => g.notes.reduce((m, n) => Math.max(m, n.end), 0)));
  for (const g of groups) {
    const notes = g.notes, pitches = notes.map(n => n.note).sort((a, b) => a - b);
    const median = pitches[Math.floor(pitches.length / 2)];
    const starts = new Set(notes.map(n => Math.round(n.start))).size;
    const leadHint = /melody|lead|vocal|voice|solo|theme/i.test(g.name);
    const backingHint = /bass|drum|percuss|pad|chord|accomp/i.test(g.name);
    let covered = 0, end = 0;
    for (const n of [...notes].sort((a, b) => a.start - b.start)) { covered += Math.max(0, n.end - Math.max(end, n.start)); end = Math.max(end, n.end); }
    const upper = [...notes].sort((a, b) => a.start - b.start || b.note - a.note).filter((n, i, a) => !i || Math.round(n.start) !== Math.round(a[i - 1].start));
    const motifs = new Map();
    for (let i = 3; i < upper.length; i++) { const key = [1, 2, 3].map(j => upper[i - 3 + j].note - upper[i - 4 + j].note).join(','); motifs.set(key, (motifs.get(key) || 0) + 1); }
    const repeated = [...motifs.values()].reduce((s, n) => s + Math.max(0, n - 1), 0) / Math.max(1, upper.length - 3);
    const coverage = covered / total, monophony = starts / notes.length;
    const register = median >= 55 && median <= 88 ? 1 : median < 48 ? -0.6 : 0.3;
    g.score = (leadHint ? 45 : 0) - (backingHint ? 25 : 0) + coverage * 30 + monophony * 18 + repeated * 18 + register * 12 + Math.min(starts, 100) / 10;
    g.reason = [leadHint ? 'lead/theme name' : null, Math.round(coverage * 100) + '% coverage', Math.round(monophony * 100) + '% single-onset', Math.round(repeated * 100) + '% repeated intervals'].filter(Boolean).join(' · ');
    g.signature = JSON.stringify(notes.map(n => [Math.round(n.start), Math.round(n.end), n.note]).sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]));
  }
  return groups.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function autoParts(groups, count = 3) {
  const ids = [], seen = new Set();
  for (const g of groups) { if (seen.has(g.signature)) continue; seen.add(g.signature); ids.push(g.id); if (ids.length === count) break; }
  while (ids.length < count) ids.push('');
  return ids;
}

function fitPitch(note, { low = 43, high = 62, transpose = -14, fold = true } = {}) {
  let pitch = note + transpose;
  if (fold) { while (pitch > high) pitch -= 12; while (pitch < low) pitch += 12; }
  return pitch >= low && pitch <= high ? pitch : -1;
}

function convert(group, { low = 43, high = 62, transpose = -14, fold = true, method = 'highest', speed = 1, cropStart = 0, cropEnd } = {}) {
  if (!Number.isInteger(low) || !Number.isInteger(high) || low < 0 || high > 127 || high - low < 11) throw Error('Range must cover at least 12 MIDI notes.');
  if (!Number.isInteger(transpose) || !Number.isFinite(speed) || speed <= 0) throw Error('Invalid transpose or speed.');
  if (!['highest', 'latest'].includes(method)) throw Error('Invalid overlap method.');
  const originalEnd = group.notes.reduce((m, n) => Math.max(m, n.end), 0);
  if (cropEnd === undefined) cropEnd = originalEnd;
  if (!Number.isFinite(cropStart) || !Number.isFinite(cropEnd) || cropStart < 0 || cropEnd <= cropStart) throw Error('Crop end must be after crop start.');
  const duration = Math.round((cropEnd - cropStart) / speed);
  if (duration < 1 || duration > 21600000) throw Error('Duration must be 1ms–6 hours.');
  let id = 0; const events = [];
  for (const n of group.notes) {
    const start = Math.max(cropStart, n.start), end = Math.min(cropEnd, n.end);
    if (end <= start) continue;
    const note = { ...n, id: id++ };
    events.push({ time: start - cropStart, on: true, n: note }, { time: end - cropStart, on: false, n: note });
  }
  events.sort((a, b) => a.time - b.time || Number(a.on) - Number(b.on));
  const active = new Map(), segments = [], shiftedIds = new Set(), droppedIds = new Set();
  let last = 0, selected = null, i = 0;
  function emit(until) {
    const start = Math.round(last / speed), end = Math.round(until / speed);
    if (end <= start) return;
    let pitch = -1, key = -1;
    if (selected) {
      pitch = fitPitch(selected.note, { low, high, transpose, fold }); key = selected.id;
      if (pitch < 0) droppedIds.add(key);
      else if (pitch !== selected.note + transpose) shiftedIds.add(key);
    }
    // pitch === -1 → rest; halfPeriodUs will be 0; motor holds still during the gap.
    const prev = segments.at(-1);
    if (prev && prev.key === key && prev.note === pitch && prev.end === start) prev.end = end;
    else segments.push({ start, end, note: pitch, key });
  }
  while (i < events.length) {
    const time = events[i].time; emit(time);
    while (i < events.length && events[i].time === time) { const e = events[i++]; if (e.on) active.set(e.n.id, e.n); else active.delete(e.n.id); }
    selected = null;
    for (const n of active.values()) if (!selected || (method === 'latest' ? (n.start > selected.start || (n.start === selected.start && n.note > selected.note)) : (n.note > selected.note || (n.note === selected.note && n.start > selected.start)))) selected = n;
    last = time;
  }
  emit(cropEnd - cropStart);
  const notes = segments.filter(s => s.note >= 0).map(s => ({ note: s.note, start: s.start, end: s.end }));
  return { segments, notes, shifted: shiftedIds.size, dropped: droppedIds.size, duration };
}

const OUTPUT_PINS = [0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33];

function validatePins(pins) {
  if (!Array.isArray(pins) || pins.length < 1 || pins.length > 3) throw Error('Choose 1–3 motors.');
  const used = new Set();
  pins.forEach((p, i) => {
    for (const key of ['step', 'dir']) {
      const pin = p[key];
      if (!Number.isInteger(pin) || !OUTPUT_PINS.includes(pin)) throw Error(`Motor ${i + 1}: invalid ESP32 WROOM-32 output GPIO.`);
      if (used.has(pin)) throw Error(`GPIO ${pin} assigned to multiple motors.`);
      used.add(pin);
    }
  });
}

function arrangement(groups, ids, opts, pins) {
  validatePins(pins);
  if (ids.length !== pins.length) throw Error('Motor count mismatch.');
  const voices = ids.map((id, i) => {
    const group = id ? groups.find(g => g.id === id) : { id: '', name: 'Silent', notes: [] };
    if (!group) throw Error('Selected part missing.');
    return { ...convert(group, opts), id, partName: group.name, pins: pins[i] };
  });
  if (!voices.some(v => v.notes.length)) throw Error('No notes in crop. Try another section or part.');
  return { voices, duration: voices[0].duration, notes: voices.flatMap((v, i) => v.notes.map(n => ({ ...n, motor: i }))), options: { ...opts } };
}

function writeMidi(result) {
  const voices = result.voices || [result];
  const vlq = n => { const a = [n & 127]; while (n = Math.floor(n / 128)) a.unshift((n & 127) | 128); return a; };
  const be32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const bytes = [77, 84, 104, 100, 0, 0, 0, 6, 0, voices.length > 1 ? 1 : 0, 0, voices.length, 1, 244];
  voices.forEach((v, ch) => {
    const out = [0, 255, 81, 3, 7, 161, 32, 0, 192 | ch, 0];
    const label = new TextEncoder().encode('Motor ' + (ch + 1));
    out.push(0, 255, 3, ...vlq(label.length), ...label);
    const events = [];
    for (const n of v.notes) { events.push({ t: n.start, bytes: [144 | ch, n.note, 90] }, { t: n.end, bytes: [128 | ch, n.note, 0] }); }
    events.sort((a, b) => a.t - b.t || a.bytes[0] - b.bytes[0]); let prev = 0;
    for (const e of events) { out.push(...vlq(e.t - prev), ...e.bytes); prev = e.t; }
    out.push(...vlq(result.duration - prev), 255, 47, 0);
    bytes.push(77, 84, 114, 107, ...be32(out.length));
    for (const b of out) bytes.push(b);
  });
  return new Uint8Array(bytes);
}

const periodFor = note => note < 0 ? 0 : Math.max(2, Math.round(50 / Math.pow(2, (note - 55) / 12)));

function firmware(result, title = 'MOTOR MELODY') {
  validatePins(result.voices.map(v => v.pins));
  const safe = title.replace(/[^a-zA-Z0-9 _.-]/g, '').slice(0, 80) || 'MOTOR MELODY';
  const arrays = result.voices.map((v, i) =>
    `// Motor ${i + 1}: ${v.partName.replace(/[^a-zA-Z0-9 _.-]/g, '').slice(0, 100)}\n` +
    `// halfPeriodUs=0 segments are rests — motor holds still, preserving MIDI pauses.\n` +
    `const Segment part${i + 1}[] = {\n` +
    v.segments.map(s => `  {${s.end}UL, ${periodFor(s.note)}UL}`).join(',\n') +
    `\n};`
  ).join('\n\n');
  return `// ${safe}
// Crop: ${result.options.cropStart}–${result.options.cropEnd} ms; tempo ×${result.options.speed}.
// Transpose ${result.options.transpose}; octave fit ${result.options.low}..${result.options.high}: ${result.options.fold}.
// Fixed mapping: note 55 = 50 µs HIGH / LOW.
// halfPeriodUs=0 → motor idle (rest). Pauses in the MIDI are preserved.
// Starts at power-up; reset to replay. No encoder or OLED.
// One A4988 per motor — each needs its own STEP/DIR wires.
#include <Arduino.h>

struct Segment { uint32_t endMs; uint32_t halfPeriodUs; };
${arrays}

struct Motor {
  uint8_t  stepPin;
  uint8_t  dirPin;
  const Segment* part;
  size_t   count;
  size_t   index;
  uint32_t halfPeriodUs;
  uint32_t lastEdgeUs;
  bool     high;
};

Motor motors[] = {
${result.voices.map((v, i) => `  {${v.pins.step}, ${v.pins.dir}, part${i + 1}, sizeof(part${i + 1}) / sizeof(part${i + 1}[0]), 0, 0, 0, false}`).join(',\n')}
};
const size_t   MOTOR_COUNT      = sizeof(motors) / sizeof(motors[0]);
const uint32_t SONG_DURATION_MS = ${result.duration}UL;
uint32_t songStartMs = 0;
bool     playing     = false;

void setup() {
  for (size_t i = 0; i < MOTOR_COUNT; ++i) {
    Motor& m = motors[i];
    pinMode(m.stepPin, OUTPUT);
    pinMode(m.dirPin,  OUTPUT);
    digitalWrite(m.stepPin, LOW);
    digitalWrite(m.dirPin,  LOW);
    m.halfPeriodUs = m.part[0].halfPeriodUs;
  }
  songStartMs = millis();
  uint32_t startUs = micros();
  for (size_t i = 0; i < MOTOR_COUNT; ++i) motors[i].lastEdgeUs = startUs;
  playing = true;
}

void loop() {
  if (!playing) { delay(10); return; }
  const uint32_t elapsedMs = millis() - songStartMs;
  if (elapsedMs >= SONG_DURATION_MS) {
    for (size_t i = 0; i < MOTOR_COUNT; ++i) {
      digitalWrite(motors[i].stepPin, LOW);
      motors[i].high = false;
    }
    playing = false;
    return;
  }
  for (size_t i = 0; i < MOTOR_COUNT; ++i) {
    Motor& m = motors[i];
    while (m.index < m.count && elapsedMs >= m.part[m.index].endMs) ++m.index;
    const uint32_t period = m.index < m.count ? m.part[m.index].halfPeriodUs : 0;
    uint32_t nowUs = micros();
    if (period != m.halfPeriodUs) {
      digitalWrite(m.stepPin, LOW);
      m.high         = false;
      m.halfPeriodUs = period;
      m.lastEdgeUs   = nowUs;
    }
    if (period && nowUs - m.lastEdgeUs >= period) {
      m.high = !m.high;
      digitalWrite(m.stepPin, m.high ? HIGH : LOW);
      m.lastEdgeUs = nowUs;
    }
  }
}
`;
}

const ROW_PAIRS = [[60,3],[60,3],[60,2],[62,1],[64,3],[64,2],[62,1],[64,2],[65,1],[67,6],[72,1],[72,1],[72,1],[67,1],[67,1],[67,1],[64,1],[64,1],[64,1],[60,1],[60,1],[60,1],[67,2],[65,1],[64,2],[62,1],[60,6]];
function demoGroup() {
  let t = 0;
  return { id: 'demo', name: 'Row, Row, Row Your Boat', notes: ROW_PAIRS.map(([note, units]) => { const n = { note, start: t, end: t + units * 200 }; t = n.end; return n; }) };
}

function downloadBlob(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const MOTOR_COLORS_CSS = ['#ffd319', '#f222ff', '#ff901f'];

// ─── Pin Legend Table ─────────────────────────────────────────────────────────

function PinLegend({ motorCount, pins }) {
  const css = {
    wrap: { marginTop: 16 },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: 'ui-monospace, monospace' },
    th: { textAlign: 'left', padding: '6px 10px', color: '#c9a8e8', borderBottom: '1px solid #3d1a6e', fontWeight: 600 },
    td: { padding: '7px 10px', borderBottom: '1px solid #2a0f4d' },
    dot: (color) => ({ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color, marginRight: 7, verticalAlign: 'middle' }),
  };

  const rows = [];
  for (let i = 0; i < motorCount; i++) {
    const { step, dir } = pins[i];
    const color = MOTOR_COLORS_CSS[i];
    rows.push(
      <tr key={`m${i}-step`}>
        <td style={css.td}><span style={css.dot(color)} />Motor {i + 1}</td>
        <td style={{ ...css.td, color }}>{step}</td>
        <td style={{ ...css.td, color: '#c9a8e8' }}>STEP</td>
      </tr>,
      <tr key={`m${i}-dir`}>
        <td style={css.td}><span style={css.dot(color)} /></td>
        <td style={{ ...css.td, color }}>{dir}</td>
        <td style={{ ...css.td, color: '#c9a8e8' }}>DIR</td>
      </tr>
    );
  }

  return (
    <div style={css.wrap}>
      <table style={css.table}>
        <thead>
          <tr>
            <th style={css.th}>Motor</th>
            <th style={css.th}>GPIO</th>
            <th style={css.th}>Signal</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

// ─── Canvas Helpers ───────────────────────────────────────────────────────────

function CropCanvas({ groups, sourceDuration, cropStart, cropEnd }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
    let lo = 127, hi = 0;
    for (const g of groups) for (const n of g.notes) { lo = Math.min(lo, n.note); hi = Math.max(hi, n.note); }
    const w = c.width, h = c.height, span = Math.max(1, hi - lo);
    for (let i = 0; i < groups.length; i++) {
      ctx.fillStyle = i === 0 ? '#ff2975' : '#5a2a9e';
      for (const n of groups[i].notes) ctx.fillRect(n.start / sourceDuration * w, 8 + (hi - n.note) / span * (h - 16), Math.max(1, (n.end - n.start) / sourceDuration * w), 2);
    }
    if (!Number.isFinite(cropStart) || !Number.isFinite(cropEnd)) return;
    const a = Math.max(0, Math.min(w, cropStart / sourceDuration * w));
    const bx = Math.max(0, Math.min(w, cropEnd / sourceDuration * w));
    ctx.fillStyle = '#0d0221cc'; ctx.fillRect(0, 0, a, h); ctx.fillRect(bx, 0, w - bx, h);
    ctx.strokeStyle = '#ffd319'; ctx.lineWidth = 3; ctx.strokeRect(a, 2, Math.max(0, bx - a), h - 4);
  }, [groups, sourceDuration, cropStart, cropEnd]);
  return <canvas ref={ref} width={1100} height={100} style={{ width: '100%', height: 100, background: '#12052a', borderRadius: 8 }} />;
}

function RollCanvas({ result }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
    if (!result) return;
    let lo = 127, hi = 0;
    for (const n of result.notes) { lo = Math.min(lo, n.note); hi = Math.max(hi, n.note); }
    lo -= 2; hi += 2;
    const H = c.height - 32, W = c.width - 55;
    ctx.font = '13px monospace';
    for (let n = lo; n <= hi; n++) {
      const y = H - (n - lo) / (hi - lo) * H;
      ctx.strokeStyle = n % 12 === 0 ? '#5a2a9e' : '#2a0f4d'; ctx.beginPath(); ctx.moveTo(48, y); ctx.lineTo(c.width, y); ctx.stroke();
      if (n >= 0 && n % 12 === 0) { ctx.fillStyle = '#c9a8e8'; ctx.fillText(noteName(n), 2, y + 4); }
    }
    for (const n of result.notes) {
      ctx.fillStyle = MOTOR_COLORS_CSS[n.motor];
      const y = H - (n.note - lo) / (hi - lo) * H;
      ctx.fillRect(50 + n.start / result.duration * W, y - 3 + n.motor, Math.max(1, (n.end - n.start) / result.duration * W), 5);
    }
    ctx.fillStyle = '#c9a8e8';
    for (let i = 0; i <= 4; i++) ctx.fillText((result.duration * i / 4000).toFixed(1) + 's', 50 + i * W / 4 - (i === 4 ? 45 : 0), c.height - 6);
  }, [result]);
  return <canvas ref={ref} width={1100} height={250} style={{ width: '100%', height: 250, background: '#12052a', borderRadius: 8 }} />;
}

// ─── Main App ─────────────────────────────────────────────────────────────────

const DEFAULT_PINS = [{ step: 16, dir: 17 }, { step: 19, dir: 18 }, { step: 26, dir: 27 }];

export default function StepperMelodyLab() {
  const [groups, setGroups] = useState(() => rankGroups([demoGroup()]));
  const [sourceDuration, setSourceDuration] = useState(() => rankGroups([demoGroup()])[0].notes.at(-1).end);
  const [songName, setSongName] = useState('Row Your Boat');
  const [filename, setFilename] = useState('Row, Row, Row Your Boat loaded');

  const [motorCount, setMotorCount] = useState(1);
  const [trackIds, setTrackIds] = useState(['demo', '', '']);
  const [pins, setPins] = useState(DEFAULT_PINS);
  const [method, setMethod] = useState('highest');
  const [transpose, setTranspose] = useState(-14);
  const [speed, setSpeed] = useState(1);

  const [cropStart, setCropStart] = useState(0);
  const [cropEnd, setCropEnd] = useState(() => rankGroups([demoGroup()])[0].notes.at(-1).end);

  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [codeVisible, setCodeVisible] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy code');
  const [playing, setPlaying] = useState(false);

  const audioRef = useRef(null);
  const sourcesRef = useRef([]);
  const previewTimerRef = useRef(null);
  const previewRevRef = useRef(0);
    // Sidebar follows scroll: sticks at its bottom going down, at its top going up
  const asideRef = useRef(null);
  useEffect(() => {
    const el = asideRef.current; if (!el) return;
    const GAP = 16;
    let top = GAP, lastY = window.scrollY;
    const apply = () => {
      const min = Math.min(GAP, window.innerHeight - el.offsetHeight - GAP);
      const dy = window.scrollY - lastY; lastY = window.scrollY;
      top = Math.max(min, Math.min(GAP, top - dy));
      el.style.top = top + 'px';
    };
    apply();
    window.addEventListener('scroll', apply, { passive: true });
    window.addEventListener('resize', apply);
    const ro = new ResizeObserver(apply); ro.observe(el);
    return () => {
      window.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      ro.disconnect();
    };
  }, []);

  const opts = { low: 43, high: 62, transpose, fold: true, method, speed, cropStart: Math.round(cropStart), cropEnd: Math.round(cropEnd) };

  useEffect(() => {
    setError(''); setWarnings(''); setStatusMsg('');
    try {
      const ids = trackIds.slice(0, motorCount);
      const activePins = pins.slice(0, motorCount);
      if (!Number.isFinite(cropStart) || !Number.isFinite(cropEnd) || cropStart < 0 || cropEnd <= cropStart || cropEnd > sourceDuration)
        throw Error('Crop must satisfy 0 ≤ start < end ≤ source duration.');
      const r = arrangement(groups, ids, opts, activePins);
      setResult(r);
      setStatusMsg(r.voices.map((v, i) => `M${i + 1}: ${v.notes.length} notes, ${v.shifted} fitted, ${v.dropped} excluded`).join(' · '));
      const unique = new Set(ids.filter(Boolean));
      const bootPins = activePins.flatMap(p => [p.step, p.dir]).filter(p => [0, 2, 5, 12, 15].includes(p));
      setWarnings([
        unique.size < ids.filter(Boolean).length ? 'Same part assigned to multiple motors.' : '',
        r.voices.some(v => !v.notes.length) ? 'One or more motors are silent in this crop.' : '',
        bootPins.length ? `Boot-strapping GPIO in use (${bootPins.join(', ')}); may affect boot.` : '',
      ].filter(Boolean).join(' '));
    } catch (e) {
      setResult(null);
      setError(e.message);
    }
  }, [groups, motorCount, trackIds, pins, transpose, speed, method, cropStart, cropEnd, sourceDuration]);

  function applyAutoParts() { setTrackIds(autoParts(groups, 3)); }

  function handleFile(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError('File must be under 8 MB.'); return; }
    file.arrayBuffer().then(bytes => {
      try {
        const parsed = parseMidi(bytes);
        rankGroups(parsed.groups);
        setGroups(parsed.groups); setSourceDuration(parsed.duration);
        setSongName(file.name.replace(/\.midi?$/i, ''));
        setFilename(`${file.name} · ${parsed.groups.length} parts · ${parsed.tempoChanges} tempo points`);
        setTrackIds(autoParts(parsed.groups, 3));
        setCropStart(0); setCropEnd(parsed.duration);
      } catch (e) { setError(e.message); }
    });
  }

  function loadDemo() {
    const g = rankGroups([demoGroup()]);
    setGroups(g); setSourceDuration(g[0].notes.at(-1).end);
    setSongName('Row Your Boat'); setFilename('Row, Row, Row Your Boat loaded');
    setTrackIds(autoParts(g, 3)); setCropStart(0); setCropEnd(g[0].notes.at(-1).end);
  }

  function stopPreview() {
    previewRevRef.current++;
    for (const s of sourcesRef.current) { try { s.stop(); } catch { } }
    sourcesRef.current = []; clearTimeout(previewTimerRef.current); setPlaying(false);
  }

  async function startPreview() {
    if (!result) return;
    stopPreview();
    const revision = ++previewRevRef.current, snapshot = result;
    try {
      audioRef.current ??= new (window.AudioContext || window.webkitAudioContext)();
      await audioRef.current.resume();
      if (revision !== previewRevRef.current) return;
      const audio = audioRef.current, base = audio.currentTime + 0.08;
      const notes = [...snapshot.notes].sort((a, b) => a.start - b.start);
      let cursor = 0; const until = base + snapshot.duration / 1000;
      setPlaying(true);
      function schedule() {
        if (revision !== previewRevRef.current) return;
        const horizon = audio.currentTime + 1;
        while (cursor < notes.length && base + notes[cursor].start / 1000 < horizon) {
          const n = notes[cursor++], start = base + n.start / 1000, end = base + n.end / 1000;
          if (end <= audio.currentTime) continue;
          const osc = audio.createOscillator(), gain = audio.createGain();
          osc.type = 'square'; osc.frequency.value = freq(n.note);
          osc.connect(gain); gain.connect(audio.destination);
          const t = Math.max(start, audio.currentTime), release = Math.min(0.01, (end - t) / 3), vol = 0.025 / snapshot.voices.length;
          gain.gain.setValueAtTime(vol, t); gain.gain.setValueAtTime(vol, end - release); gain.gain.linearRampToValueAtTime(0, end);
          osc.start(t); osc.stop(end);
          sourcesRef.current.push(osc);
          osc.onended = () => { sourcesRef.current = sourcesRef.current.filter(s => s !== osc); osc.disconnect(); gain.disconnect(); };
        }
        if (audio.currentTime < until) previewTimerRef.current = setTimeout(schedule, 200);
        else setPlaying(false);
      }
      schedule();
    } catch (e) { setError('Audio preview: ' + e.message); setPlaying(false); }
  }

  const makeCode = () => result ? firmware(result, songName) : '';

  function downloadTest() {
    const g = demoGroup();
    const r = arrangement([g], [g.id], { low: 43, high: 62, transpose: -14, fold: true, method: 'highest', speed: 1, cropStart: 0, cropEnd: g.notes.at(-1).end }, [{ step: 16, dir: 17 }]);
    downloadBlob(firmware(r, 'ROW YOUR BOAT'), 'RowBoatTest.cpp', 'text/plain');
  }

  async function copyCode() {
    const code = makeCode(); if (!code) return;
    let copied = false;
    if (window.isSecureContext && navigator.clipboard?.writeText) { try { await navigator.clipboard.writeText(code); copied = true; } catch { } }
    if (!copied) { const ta = document.querySelector('#code-ta'); if (ta) { ta.focus(); ta.select(); try { copied = document.execCommand('copy'); } catch { } } }
    setCopyLabel(copied ? 'Copied!' : 'Press Ctrl+C');
    setTimeout(() => setCopyLabel('Copy code'), 2500);
  }

  function updatePin(i, field, val) {
    setPins(prev => prev.map((p, j) => j === i ? { ...p, [field]: parseInt(val) || 0 } : p));
  }

  const cropReadout = (Number.isFinite(cropStart) && Number.isFinite(cropEnd) && cropEnd > cropStart)
    ? `${((cropEnd - cropStart) / 1000).toFixed(3)}s selected of ${(sourceDuration / 1000).toFixed(3)}s total`
    : 'Enter a valid start and end within the song.';

  const rangeHz = result ? (() => {
    const hz = n => Math.round(500000 / periodFor(n)).toLocaleString();
    const outside = opts.low !== 43 || opts.high !== 62;
    return `Anchor: MIDI 55 = 50 µs. Range ${noteName(opts.low)}–${noteName(opts.high)} → ${hz(opts.low)}–${hz(opts.high)} STEP pulses/sec.${outside ? ' Outside G2–D4 preset.' : ''}`;
  })() : '';

  let noteCount = '—', durationSec = '—', noteSpan = '—';
  if (result) {
    noteCount = result.notes.length; durationSec = (result.duration / 1000).toFixed(3);
    let lo = 127, hi = 0; for (const n of result.notes) { lo = Math.min(lo, n.note); hi = Math.max(hi, n.note); }
    noteSpan = `${noteName(lo)}–${noteName(hi)}`;
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const PIXEL = "'Press Start 2P', monospace";
  const RETRO = "'VT323', monospace";
  const S = {
    root:        { color: '#f6e9ff', minHeight: '100vh', fontFamily: RETRO, fontSize: 20, lineHeight: 1.3 },
    header:      { borderBottom: '2px solid #f222ff', boxShadow: '0 2px 18px rgba(242,34,255,0.45)', background: 'rgba(13,2,33,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 5%', gap: 20, flexWrap: 'wrap' },
    brand:       { fontFamily: PIXEL, fontSize: 13, letterSpacing: '0.08em', color: '#ffd319', textShadow: '0 0 8px #ff901f, 0 0 16px #ff2975' },
    mono:        { fontFamily: RETRO, fontSize: 18, color: '#c9a8e8', letterSpacing: '0.06em' },
    main:        { maxWidth: 1440, margin: 'auto', padding: '32px 5%' },
    intro:       { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, marginBottom: 30, flexWrap: 'wrap' },
    h1:          { fontFamily: PIXEL, fontSize: 'clamp(20px,2.6vw,34px)', lineHeight: 1.35, margin: '14px 0', background: 'linear-gradient(180deg,#ffd319 0%,#ff901f 40%,#ff2975 70%,#f222ff 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 10px rgba(255,41,117,0.55))' },
    eyebrow:     { fontFamily: RETRO, fontSize: 18, color: '#f222ff', letterSpacing: '0.2em', margin: 0 },
    layout:      { display: 'grid', gridTemplateColumns: '320px minmax(0,1fr)', gap: 24 },
    aside:       { position: 'sticky', top: 16, alignSelf: 'start' },
    panel:       { padding: 24, background: 'rgba(26,8,51,0.88)', border: '2px solid #8c1eff', borderRadius: 4, marginBottom: 20, boxShadow: '0 0 18px rgba(140,30,255,0.35), inset 0 0 24px rgba(242,34,255,0.08)' },
    shead:       { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
    h2:          { fontFamily: PIXEL, fontSize: 12, margin: 0, color: '#ffd319', letterSpacing: '0.06em', textShadow: '0 0 8px rgba(255,144,31,0.7)' },
    label:       { display: 'block', margin: '16px 0 6px', fontSize: 19, color: '#ff901f', letterSpacing: '0.04em' },
    sel:         { width: '100%', background: '#12052a', color: '#f6e9ff', border: '2px solid #5a2a9e', borderRadius: 2, padding: '6px 10px', fontSize: 19, fontFamily: RETRO },
    num:         { width: '100%', background: '#12052a', color: '#f6e9ff', border: '2px solid #5a2a9e', borderRadius: 2, padding: '6px 10px', fontSize: 19, fontFamily: RETRO, boxSizing: 'border-box' },
    btn:         { fontFamily: PIXEL, background: 'linear-gradient(90deg,#ff2975,#f222ff)', color: '#ffffff', border: 'none', padding: '12px 16px', borderRadius: 2, fontSize: 10, letterSpacing: '0.06em', cursor: 'pointer', boxShadow: '4px 4px 0 #8c1eff, 0 0 14px rgba(242,34,255,0.6)' },
    btnSec:      { fontFamily: PIXEL, background: 'transparent', color: '#ffd319', border: '2px solid #ff901f', padding: '10px 14px', borderRadius: 2, fontSize: 10, letterSpacing: '0.06em', cursor: 'pointer', boxShadow: '3px 3px 0 #ff2975' },
    sm:          { padding: '8px 12px', fontSize: 9, marginTop: 12 },
    muted:       { fontSize: 18, color: '#c9a8e8', margin: '8px 0' },
    help:        { fontSize: 17, color: '#c9a8e8', margin: '6px 0' },
    two:         { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
    motorCard:   { borderTop: '2px dashed #3d1a6e', marginTop: 16, paddingTop: 4 },
    stats:       { display: 'flex', gap: 32, borderBottom: '2px solid #3d1a6e', paddingBottom: 20, marginBottom: 16, flexWrap: 'wrap' },
    statVal:     { display: 'block', fontFamily: PIXEL, fontSize: 20, color: '#ffd319', textShadow: '0 0 10px #ff901f', marginBottom: 6 },
    statLbl:     { fontSize: 17, color: '#c9a8e8' },
    badge:       { fontFamily: PIXEL, fontSize: 9, border: '2px solid #f222ff', padding: '6px 8px', borderRadius: 2, color: '#f222ff', marginLeft: 'auto', boxShadow: '0 0 10px rgba(242,34,255,0.5)' },
    amber:       { color: '#ff901f' },
    err:         { color: '#ff2975', fontSize: 18, margin: '6px 0' },
    transport:   { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0' },
    exports:     { display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 16, borderTop: '2px solid #3d1a6e', marginTop: 4 },
    textarea:    { width: '100%', height: 280, background: '#0d0221', color: '#f6e9ff', border: '2px solid #3d1a6e', padding: 14, fontFamily: 'ui-monospace, monospace', fontSize: 13, lineHeight: 1.6, resize: 'vertical', borderRadius: 2, boxSizing: 'border-box' },
    inlineCode:  { fontFamily: 'ui-monospace, monospace', fontSize: 13, background: '#12052a', color: '#ffd319', padding: '2px 5px', borderRadius: 2 },
    footer:      { padding: '20px 5%', borderTop: '2px solid #3d1a6e', color: '#c9a8e8', fontSize: 17 },
    monoNum:     { fontFamily: PIXEL, fontSize: 11, color: '#f222ff', textShadow: '0 0 8px #f222ff' },
    legend:      { display: 'flex', gap: 16, fontSize: 17, color: '#c9a8e8', margin: '6px 0' },
    ol:          { paddingLeft: 22, color: '#c9a8e8' },
    li:          { margin: '10px 0' },
  };

  const trackOptions = (i) => (
    <>
      <option value="">Silent / no part</option>
      {groups.map((g, j) => <option key={g.id} value={g.id}>{j === 0 ? 'Likely main melody · ' : ''}{g.name}</option>)}
    </>
  );

  return (
    <div style={S.root}>
      <header style={S.header}>
        <span style={S.brand}>▥ STEPPER MELODY LAB</span>
        <span style={S.mono}>ESP32 · A4988 · 1–3 INDEPENDENT MOTORS</span>
      </header>

      <main style={S.main}>
        <div style={S.intro}>
          <div>
            <p style={{ ...S.mono, color: '#f222ff', letterSpacing: '0.16em', margin: 0 }}>ONE SONG. UP TO THREE PARTS.</p>
            <h1 style={S.h1}>Make your stepper sing.</h1>
            <p style={{ ...S.muted, margin: '10px 0 0' }}>Load a MIDI, crop the section you want, assign a part per motor.</p>
          </div>
          <button style={S.btnSec} onClick={loadDemo}>Load Row Your Boat demo</button>
        </div>

        <div style={S.layout}>
          {/* ── Left sidebar ── */}
                              <aside style={S.aside} ref={asideRef}>
            {/* 01 Source */}
            <section style={S.panel}>
              <div style={S.shead}><span style={S.monoNum}>01</span><h2 style={S.h2}>Source</h2></div>
              <label
                style={{ padding: '20px 14px', textAlign: 'center', border: '1px dashed #f222ff', borderRadius: 8, background: '#12052a', cursor: 'pointer', display: 'block' }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
              >
                <strong style={{ display: 'block' }}>Open a MIDI file</strong>
                <span style={{ ...S.help, display: 'block', margin: '8px 0' }}>.mid or .midi — processed locally</span>
                <input type="file" accept=".mid,.midi,audio/midi" style={{ width: '100%', fontSize: 13 }} onChange={e => handleFile(e.target.files[0])} />
              </label>
              <p style={S.muted}>{filename}</p>

              <label style={S.label} htmlFor="motorCount">Motors</label>
              <select id="motorCount" style={S.sel} value={motorCount} onChange={e => setMotorCount(+e.target.value)}>
                <option value={1}>1 motor</option>
                <option value={2}>2 motors</option>
                <option value={3}>3 motors</option>
              </select>
              <button style={{ ...S.btnSec, ...S.sm }} onClick={applyAutoParts}>Auto-pick parts</button>
              <p style={S.help}>Ranked by coverage, register, and repeated patterns.</p>

              {[0, 1, 2].map(i => (
                <div key={i} style={{ ...S.motorCard, display: i < motorCount ? 'block' : 'none' }}>
                  <label style={{ ...S.label, color: MOTOR_COLORS_CSS[i] }} htmlFor={`track${i}`}>Motor {i + 1} · part</label>
                  <select id={`track${i}`} style={S.sel} value={trackIds[i]} onChange={e => setTrackIds(prev => prev.map((v, j) => j === i ? e.target.value : v))}>
                    {trackOptions(i)}
                  </select>
                  <p style={S.help}>{groups.find(g => g.id === trackIds[i])?.reason ?? 'No part assigned — motor stays silent.'}</p>
                  <div style={S.two}>
                    <div>
                      <label style={S.label} htmlFor={`step${i}`}>STEP GPIO</label>
                      <input id={`step${i}`} type="number" min="0" max="33" style={S.num} value={pins[i].step} onChange={e => updatePin(i, 'step', e.target.value)} />
                    </div>
                    <div>
                      <label style={S.label} htmlFor={`dir${i}`}>DIR GPIO</label>
                      <input id={`dir${i}`} type="number" min="0" max="33" style={S.num} value={pins[i].dir} onChange={e => updatePin(i, 'dir', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}

              <label style={S.label} htmlFor="method">When notes overlap</label>
              <select id="method" style={S.sel} value={method} onChange={e => setMethod(e.target.value)}>
                <option value="highest">Highest active note</option>
                <option value="latest">Most recently started note</option>
              </select>
            </section>

            {/* 02 Fit */}
            <section style={S.panel}>
              <div style={S.shead}><span style={S.monoNum}>02</span><h2 style={S.h2}>Fit the motor</h2></div>
              <p style={S.help}>Working preset: −14 st, octave-fitted G2–D4 (MIDI 43–62). Note 55 anchored at 50 µs/half-cycle.</p>
              <p style={S.help}>{rangeHz}</p>
              <label style={S.label} htmlFor="transpose">Transpose</label>
              <select id="transpose" style={S.sel} value={transpose} onChange={e => setTranspose(+e.target.value)}>
                {Array.from({ length: 97 }, (_, i) => i - 48).map(n => (
                  <option key={n} value={n}>{n > 0 ? '+' : ''}{n} st{n === -14 ? ' · working preset' : ''}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 14, fontSize: 14 }}>
                <input type="checkbox" checked disabled style={{ accentColor: '#ffd319', marginTop: 4 }} />
                <label>Octave-shift out-of-range notes (always on)</label>
              </div>
              <button style={{ ...S.btnSec, ...S.sm }} onClick={() => setTranspose(-14)}>Restore preset</button>
              <label style={S.label} htmlFor="speed">Speed</label>
              <select id="speed" style={S.sel} value={speed} onChange={e => setSpeed(+e.target.value)}>
                {[1, 1.5, 2, 5].map(v => <option key={v} value={v}>{v}×</option>)}
              </select>
            </section>
          </aside>

          {/* ── Workspace ── */}
          <div>
            {/* 03 Crop */}
            <section style={S.panel}>
              <div style={S.shead}>
                <span style={S.monoNum}>03</span><h2 style={S.h2}>Crop</h2>
                <button style={{ ...S.btnSec, ...S.sm, marginLeft: 'auto', marginTop: 0 }} onClick={() => { setCropStart(0); setCropEnd(sourceDuration); }}>Full song</button>
              </div>
              <CropCanvas groups={groups} sourceDuration={sourceDuration} cropStart={cropStart} cropEnd={cropEnd} />
              <div style={{ ...S.two, marginTop: 14 }}>
                <div>
                  <label style={S.label}>Start (s)</label>
                  <input type="number" min={0} max={sourceDuration / 1000} step={0.001} style={S.num}
                    value={(cropStart / 1000).toFixed(3)} onChange={e => setCropStart(Math.min(+e.target.value * 1000, cropEnd - 1))} />
                  <input type="range" min={0} max={sourceDuration / 1000} step={0.001} style={{ width: '100%', accentColor: '#ffd319', marginTop: 10 }}
                    value={cropStart / 1000} onChange={e => setCropStart(Math.min(+e.target.value * 1000, cropEnd - 1))} />
                </div>
                <div>
                  <label style={S.label}>End (s)</label>
                  <input type="number" min={0} max={sourceDuration / 1000} step={0.001} style={S.num}
                    value={(cropEnd / 1000).toFixed(3)} onChange={e => setCropEnd(Math.max(+e.target.value * 1000, cropStart + 1))} />
                  <input type="range" min={0} max={sourceDuration / 1000} step={0.001} style={{ width: '100%', accentColor: '#ffd319', marginTop: 10 }}
                    value={cropEnd / 1000} onChange={e => setCropEnd(Math.max(+e.target.value * 1000, cropStart + 1))} />
                </div>
              </div>
              <p style={S.help}>{cropReadout}</p>
            </section>

            {/* 04 Listen & Export */}
            <section style={S.panel}>
              <div style={S.shead}>
                <span style={S.monoNum}>04</span><h2 style={S.h2}>Listen & export</h2>
                <span style={S.badge}>{motorCount} MOTOR{motorCount > 1 ? 'S' : ''}</span>
              </div>
              <div style={S.stats}>
                <div><strong style={S.statVal}>{noteCount}</strong><span style={S.statLbl}>notes</span></div>
                <div><strong style={S.statVal}>{durationSec}</strong><span style={S.statLbl}>seconds</span></div>
                <div><strong style={S.statVal}>{noteSpan}</strong><span style={S.statLbl}>output range</span></div>
              </div>
              <RollCanvas result={result} />
              <div style={S.transport}>
                <button style={S.btn} disabled={!result} onClick={playing ? stopPreview : startPreview}>
                  {playing ? '■ Stop' : '▶ Preview parts'}
                </button>
                <span style={S.help}>Speaker preview — not actual motor sound.</span>
              </div>
              <div style={S.legend}>
                {MOTOR_COLORS_CSS.slice(0, motorCount).map((c, i) => <span key={i} style={{ color: c }}>● Motor {i + 1}</span>)}
              </div>
              {warnings && <p style={{ ...S.help, ...S.amber }}>{warnings}</p>}
              {statusMsg && <p style={S.help}>{statusMsg}</p>}
              {error && <p style={S.err} role="alert">{error}</p>}
              <div style={S.exports}>
                <button style={S.btnSec} disabled={!result} onClick={() => result && downloadBlob(writeMidi(result), 'motor-parts.mid', 'audio/midi')}>Download MIDI</button>
                <button style={S.btn} disabled={!result} onClick={() => result && downloadBlob(makeCode(), 'StepperSong.cpp', 'text/plain')}>Download C++</button>
                <button style={S.btnSec} disabled={!result} onClick={() => result && downloadBlob(makeCode(), 'StepperSong.ino', 'text/plain')}>Download .ino</button>
              </div>
              <details style={{ margin: '16px 0' }} open={codeVisible} onToggle={e => setCodeVisible(e.target.open)}>
                <summary style={{ cursor: 'pointer', color: '#f222ff', fontSize: 14 }}>View / copy C++ sketch</summary>
                <button style={{ ...S.btnSec, ...S.sm }} onClick={copyCode}>{copyLabel}</button>
                <textarea id="code-ta" readOnly style={S.textarea} value={makeCode()} spellCheck={false} />
              </details>
            </section>

            {/* 05 Board Visualizer */}
            <section style={S.panel}>
              <div style={S.shead}>
                <span style={S.monoNum}>05</span>
                <h2 style={S.h2}>Pin assignment — ESP32 WROOM-32</h2>
                <span style={S.badge}>LIVE PINOUT</span>
              </div>
              <p style={S.help}>Left-Drag = Rotate  |  Middle-Drag= Pan  |  Scroll = Zoom</p>
              <div style={{ position: 'relative', width: '100%', height: 480, borderRadius: 10, overflow: 'hidden' }}>
                <Esp32Viewer motorCount={motorCount} pins={pins} />
              </div>
              <PinLegend motorCount={motorCount} pins={pins} />
            </section>

            {/* 06 Wiring notes */}
            <section style={S.panel}>
              <div style={S.shead}><span style={S.monoNum}>06</span><h2 style={S.h2}>Wiring</h2><span style={{ ...S.badge, marginLeft: 'auto' }}>FIXED DIRECTION</span></div>
              <p style={S.muted}>One A4988 per motor. Defaults: M1 16/17, M2 19/18, M3 26/27 (STEP/DIR).</p>
              <p style={{ ...S.help, ...S.amber }}>Your blade drivers previously shared STEP/DIR. They cannot play independent parts while tied together — split those control lines. Disconnect power before rewiring. Use unloaded motors (not connected to the cutter mechanism) when testing.</p>
              <ol style={S.ol}>
                <li style={S.li}>Load a MIDI and assign a part per motor. Review the pinout above.</li>
                <li style={S.li}>Set crop and transpose. Working preset: −14 st, G2–D4, note 55 at 50 µs/half-cycle. <strong>MIDI pauses are preserved</strong> — <code style={S.inlineCode}>halfPeriodUs=0</code> holds the motor still.</li>
                <li style={S.li}>Download C++ and flash. All motors start together and stop at song end. Reset to replay.</li>
              </ol>
              <button style={{ ...S.btnSec, ...S.sm }} onClick={downloadTest}>Download Row Your Boat test (C++)</button>
            </section>

            {/* About */}
            <section style={S.panel}>
              <h2 style={{ ...S.h2, marginBottom: 12 }}>What this does</h2>
              <p style={S.muted}>Reads MIDI format 0/1, honors tempo changes and sustain, excludes percussion, reduces each part to one note at a time. Gaps between notes produce rest segments (<code style={S.inlineCode}>halfPeriodUs=0</code>) — the motor holds still, so pauses are preserved. The original MIDI is never modified.</p>
            </section>
          </div>
        </div>
      </main>

      <footer style={S.footer}>Local MIDI processing · no upload · ESP32 WROOM-32 · Created by Robert Brunner  · 2026</footer>
    </div>
  );
}