/* ==========================================================================
   Sample drawing — so the tool can be tried without a file
   ========================================================================== */
export function samplePlan() {
  const c = document.createElement('canvas');
  c.width = 1400; c.height = 1000;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = g.fillStyle = '#1c2119';
  g.lineCap = 'square';
  const wall = (x0, y0, x1, y1, t = 14) => { g.lineWidth = t; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  // 12 m × 8 m house drawn at 100 px per metre, origin (150, 150)
  const X = (m) => 150 + m * 100, Y = (m) => 150 + m * 100;
  const E = 23;                                    // outer wall thickness
  // outer walls with an entrance (S), windows on every side
  wall(X(0), Y(0), X(2), Y(0), E); wall(X(3.6), Y(0), X(5.6), Y(0), E); wall(X(7.2), Y(0), X(9.2), Y(0), E); wall(X(10.6), Y(0), X(12), Y(0), E);
  wall(X(12), Y(0), X(12), Y(1.5), E); wall(X(12), Y(3), X(12), Y(4.8), E); wall(X(12), Y(6), X(12), Y(8), E);
  wall(X(0), Y(8), X(1.5), Y(8), E); wall(X(3.3), Y(8), X(5), Y(8), E); wall(X(6), Y(8), X(10.3), Y(8), E); wall(X(11.7), Y(8), X(12), Y(8), E);
  wall(X(0), Y(0), X(0), Y(2.6), E); wall(X(0), Y(4), X(0), Y(8), E);
  // partitions with doors
  wall(X(4.5), Y(0), X(4.5), Y(3)); wall(X(4.5), Y(3.9), X(4.5), Y(4.6));
  wall(X(0), Y(4.6), X(1.6), Y(4.6)); wall(X(2.5), Y(4.6), X(8), Y(4.6));
  wall(X(8), Y(0), X(8), Y(2.4)); wall(X(8), Y(3.3), X(8), Y(4.6));
  wall(X(8), Y(4.6), X(8.6), Y(4.6)); wall(X(9.5), Y(4.6), X(12), Y(4.6));
  wall(X(9.6), Y(4.6), X(9.6), Y(5.3)); wall(X(9.6), Y(6.2), X(9.6), Y(8));
  wall(X(10.5), Y(6.2), X(12), Y(6.2));
  // window symbols (hairlines inside the gaps) — ignored by the solid-wall reading
  g.lineWidth = 2;
  const win = (x0, y0, x1, y1) => {
    g.beginPath();
    if (y0 === y1) { [-8, 0, 8].forEach((o) => { g.moveTo(x0, y0 + o); g.lineTo(x1, y1 + o); }); }
    else { [-8, 0, 8].forEach((o) => { g.moveTo(x0 + o, y0); g.lineTo(x1 + o, y1); }); }
    g.stroke();
  };
  win(X(2), Y(0), X(3.6), Y(0)); win(X(5.6), Y(0), X(7.2), Y(0)); win(X(9.2), Y(0), X(10.6), Y(0));
  win(X(12), Y(1.5), X(12), Y(3)); win(X(12), Y(4.8), X(12), Y(6)); win(X(0), Y(2.6), X(0), Y(4));
  win(X(1.5), Y(8), X(3.3), Y(8)); win(X(10.3), Y(8), X(11.7), Y(8));
  // door swings, furniture, dimensions, text — drafting marks to be ignored
  g.lineWidth = 1.5;
  const arc = (x, y, r, a0, a1) => { g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke(); };
  arc(X(5), Y(8), 100, Math.PI, 1.5 * Math.PI); arc(X(4.5), Y(3.9), 90, 0, 0.5 * Math.PI);
  arc(X(2.5), Y(4.6), 90, Math.PI, 1.5 * Math.PI); arc(X(8), Y(3.3), 90, 0.5 * Math.PI, Math.PI);
  arc(X(9.5), Y(4.6), 90, 0.5 * Math.PI, Math.PI); arc(X(9.6), Y(6.2), 90, 0, 0.5 * Math.PI);
  g.strokeRect(X(0.6), Y(0.6), 180, 210); g.strokeRect(X(9), Y(0.6), 160, 200);
  g.strokeRect(X(5.2), Y(0.5), 220, 60); g.strokeRect(X(1), Y(5.4), 200, 90);
  g.beginPath(); g.arc(X(6.3), Y(2.4), 55, 0, 7); g.stroke();
  g.beginPath(); g.moveTo(X(0), Y(-0.7)); g.lineTo(X(12), Y(-0.7));
  g.moveTo(X(0), Y(-0.85)); g.lineTo(X(0), Y(-0.55)); g.moveTo(X(12), Y(-0.85)); g.lineTo(X(12), Y(-0.55)); g.stroke();
  g.font = '500 24px sans-serif'; g.textAlign = 'center';
  [['BEDROOM', X(2.2), Y(2.5)], ['LIVING / DINING', X(6.3), Y(3.6)], ['BEDROOM', X(10), Y(2.6)],
    ['KITCHEN', X(1.8), Y(6.6)], ['VERANDAH', X(5.5), Y(6.5)], ['BATH', X(10.8), Y(7.3)], ['STORE', X(10.8), Y(5.5)]]
    .forEach(([t, x, y]) => g.fillText(t, x, y));
  g.font = '20px monospace';
  g.fillText('12 000', X(6), Y(-0.85));
  g.fillText('GROUND FLOOR PLAN · 1:100', X(6), Y(8.9));
  return c;
}
