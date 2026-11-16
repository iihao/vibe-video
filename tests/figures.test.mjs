import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBalance, drawCandles, drawCompare, drawPie } from '../shared/figures.mjs';

const palette = {
  bg: '#080b0e',
  ink: '#f5e5ce',
  accent: '#e9b77c',
  faint: '#65716e',
  grid: '#b8bca9',
};

function context() {
  return {
    labels: [],
    rectangles: [],
    beginPath() {},
    arc() {},
    closePath() {},
    fill() {},
    fillRect(...rect) {
      this.rectangles.push(rect);
    },
    fillText(value) {
      this.labels.push(String(value));
    },
    lineTo() {},
    moveTo() {},
    restore() {},
    rotate() {},
    save() {},
    setLineDash() {},
    stroke() {},
    strokeRect() {},
  };
}

test('quantitative visuals do not invent values when model data is absent', () => {
  for (const draw of [drawCandles, drawPie, drawCompare, drawBalance]) {
    const ctx = context();
    draw(ctx, palette, 0, 2, {});
    assert.deepEqual(ctx.labels, []);
    assert.deepEqual(ctx.rectangles, []);
  }
});

test('quantitative visuals render the supplied data and labels', () => {
  const pie = context();
  drawPie(pie, palette, 0, 2, {
    data: [
      { label: 'A', value: 2 },
      { label: 'B', value: 3 },
    ],
  });
  assert.deepEqual(pie.labels, ['A 40%', 'B 60%']);

  const compare = context();
  drawCompare(compare, palette, 0, 2, {
    data: [
      { label: 'Before', value: 4 },
      { label: 'After', value: 8 },
    ],
  });
  assert.deepEqual(compare.labels, ['4', 'Before', '8', 'After']);

  const candles = context();
  drawCandles(candles, palette, 0, 2, { data: [2, 5, 3] });
  assert.deepEqual(candles.labels, ['3']);

  const balance = context();
  drawBalance(balance, palette, 0, 2, { left: 3, right: 1 });
  assert.deepEqual(balance.labels, ['3', '1']);
});
