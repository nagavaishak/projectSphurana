import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis } from 'recharts';

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const dailyConfig = {
  count: {
    label: 'Messages',
    color: 'var(--primary)',
  },
} satisfies ChartConfig;

const monthlyConfig = {
  count: {
    label: 'Messages',
    color: 'var(--primary)',
  },
} satisfies ChartConfig;

const SHORT_MONTH = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const formatDailyTick = (value: string) => {
  const [, monthStr, dayStr] = value.split('-');
  if (!monthStr || !dayStr) return value;
  const month = SHORT_MONTH[Number.parseInt(monthStr, 10) - 1] ?? '';
  const day = Number.parseInt(dayStr, 10);
  return `${month} ${day}`;
};

const formatMonthlyTick = (value: string) => {
  const [, monthStr] = value.split('-');
  if (!monthStr) return value;
  return SHORT_MONTH[Number.parseInt(monthStr, 10) - 1] ?? value;
};

export interface DailyTrendChartProps {
  data: Array<{ date: string; count: number }>;
  /**
   * The date string (`YYYY-MM-DD`) of the bar to highlight (typically today).
   * Highlighted bars use a stronger fill; the rest fade slightly.
   */
  highlightDate?: string;
  className?: string;
}

export function DailyTrendChart({
  data,
  highlightDate,
  className,
}: DailyTrendChartProps) {
  return (
    <ChartContainer
      config={dailyConfig}
      className={cn('aspect-auto h-[180px] w-full', className)}
    >
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={formatDailyTick}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent labelFormatter={formatDailyTick} />}
        />
        <Bar
          dataKey="count"
          fill="var(--color-count)"
          radius={[4, 4, 0, 0]}
          fillOpacity={0.7}
          activeBar={{ fillOpacity: 1 }}
          isAnimationActive={false}
          // biome-ignore lint/suspicious/noExplicitAny: Recharts shape helpers
          shape={(props: any) => {
            const isHighlight =
              highlightDate && props.payload?.date === highlightDate;
            const opacity = isHighlight ? 1 : 0.6;
            return (
              <rect
                x={props.x}
                y={props.y}
                width={props.width}
                height={props.height}
                rx={4}
                ry={4}
                fill={props.fill}
                fillOpacity={opacity}
              />
            );
          }}
        />
      </BarChart>
    </ChartContainer>
  );
}

export interface MonthlyTrendChartProps {
  data: Array<{ month: string; count: number }>;
  className?: string;
}

export function MonthlyTrendChart({ data, className }: MonthlyTrendChartProps) {
  return (
    <ChartContainer
      config={monthlyConfig}
      className={cn('aspect-auto h-[180px] w-full', className)}
    >
      <LineChart
        accessibilityLayer
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={formatMonthlyTick}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent labelFormatter={formatMonthlyTick} />}
        />
        <Line
          type="monotone"
          dataKey="count"
          stroke="var(--color-count)"
          strokeWidth={2}
          dot={{ fill: 'var(--color-count)' }}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
