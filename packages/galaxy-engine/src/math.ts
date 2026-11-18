export const clamp = (v: number, lo = 0, hi = 1) =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));
export const ease = (value: number, target: number, rate: number, dt: number) =>
  value + (target - value) * (1 - Math.exp(-rate * clamp(dt, 0, 0.1)));
export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function constellation(seed = 29) {
  const rng = random(seed),
    points: number[][] = [],
    colors: number[] = [];
  for (let cluster = 0; cluster < 8; cluster++) {
    const a = (cluster * Math.PI * 2) / 8,
      r = 14 + rng() * 6;
    const center = [
      Math.cos(a) * r,
      Math.sin(a) * r * 0.63,
      (rng() - 0.5) * 22,
    ];
    for (let j = 0; j < 8; j++) {
      points.push(center.map((v) => v + (rng() - 0.5) * 7));
      colors.push(cluster % 3);
    }
  }
  for (let i = 0; i < 32; i++) {
    points.push([(rng() - 0.5) * 60, (rng() - 0.5) * 40, (rng() - 0.5) * 25]);
    colors.push(0);
  }
  const edges: number[][] = [];
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      if (Math.hypot(...points[i].map((v, k) => v - points[j][k])) < 6)
        edges.push([i, j]);
  return { points, edges, colors };
}
