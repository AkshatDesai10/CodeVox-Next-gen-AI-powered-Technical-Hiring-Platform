export type WeightTriple = {
  accuracy: number;
  code_quality: number;
  originality: number;
};

type WeightKey = keyof WeightTriple;

const KEYS: WeightKey[] = ['accuracy', 'code_quality', 'originality'];

/** Redistribute the other two weights proportionally when one slider moves. */
export function redistributeWeights(
  current: WeightTriple,
  changedKey: WeightKey,
  nextValue: number,
): WeightTriple {
  const clamped = Math.max(0, Math.min(100, Math.round(nextValue)));
  const others = KEYS.filter((k) => k !== changedKey);
  const remaining = 100 - clamped;
  const otherSum = others.reduce((s, k) => s + current[k], 0);

  const out: WeightTriple = { ...current, [changedKey]: clamped };

  if (otherSum <= 0) {
    const each = Math.floor(remaining / others.length);
    others.forEach((k, i) => {
      out[k] = i === others.length - 1 ? remaining - each * (others.length - 1) : each;
    });
    return out;
  }

  let allocated = 0;
  others.forEach((k, i) => {
    if (i === others.length - 1) {
      out[k] = remaining - allocated;
    } else {
      const share = Math.round((current[k] / otherSum) * remaining);
      out[k] = share;
      allocated += share;
    }
  });
  return out;
}
