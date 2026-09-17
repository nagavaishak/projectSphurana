export interface DurationOption {
  value: number;
  label: string;
}

const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}hr`;
  return `${hours}hr ${mins}`;
};

const STEPS: number[] = [
  15, 20, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 420, 480,
];

export const durationOptions: DurationOption[] = STEPS.map((value) => ({
  value,
  label: formatDuration(value),
}));
