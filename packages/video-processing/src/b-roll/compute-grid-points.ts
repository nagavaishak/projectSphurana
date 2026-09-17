/**
 * Compute Grid Points
 *
 * Generates evenly-spaced edit points across a timeline range,
 * used for beat-synced b-roll scheduling.
 */

/**
 * Compute an array of evenly-spaced grid points across a timeline range.
 *
 * Each point represents a potential edit/cut point for b-roll placement.
 * Points are spaced by `editIntervalSec` and stay within [availableStart, availableEnd].
 */
export function computeGridPoints(
  availableStart: number,
  availableEnd: number,
  editIntervalSec: number
): number[] {
  const gridPoints: number[] = [];
  let t = availableStart;
  while (t + editIntervalSec <= availableEnd) {
    gridPoints.push(t);
    t += editIntervalSec;
  }
  return gridPoints;
}
