import {
  and,
  desc,
  eq,
  isNotNull,
  socialPost,
} from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type SuggestPostingTimeInput,
  suggestPostingTimeSchema,
} from './suggest-posting-time.schema.js';

const INDUSTRY_DEFAULTS: Record<
  string,
  { days: string[]; timeRange: string; reason: string }
> = {
  facebook: {
    days: ['Tuesday', 'Wednesday', 'Thursday'],
    timeRange: '12:00 PM – 3:00 PM',
    reason:
      'Industry data shows highest Facebook engagement mid-week during lunch hours.',
  },
  instagram: {
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    timeRange: '11:00 AM – 1:00 PM',
    reason:
      'Industry data shows highest Instagram engagement on weekdays around lunchtime.',
  },
};

export interface Suggestion {
  platform?: string;
  day?: string;
  days?: string[];
  timeRange: string;
  postsInWindow?: number;
  reasoning: string;
}

export interface SuggestPostingTimeResult {
  dataSource: 'industry_defaults' | 'historical';
  postsAnalyzed: number;
  note?: string;
  suggestions: Suggestion[];
}

const suggestPostingTimeImpl = async (
  db: DbConnection,
  input: SuggestPostingTimeInput
): Promise<Result<SuggestPostingTimeResult>> => {
  const parsed = suggestPostingTimeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, platform } = parsed.data;

  const publishedPosts = await db
    .select({
      id: socialPost.id,
      platforms: socialPost.platforms,
      publishedAt: socialPost.publishedAt,
      platformResults: socialPost.platformResults,
    })
    .from(socialPost)
    .where(
      and(
        eq(socialPost.organizationId, organizationId),
        eq(socialPost.status, 'published'),
        isNotNull(socialPost.publishedAt)
      )
    )
    .orderBy(desc(socialPost.publishedAt))
    .limit(50);

  const relevantPosts = platform
    ? publishedPosts.filter((p) => {
        const platforms = p.platforms as string[] | null;
        return platforms?.includes(platform);
      })
    : publishedPosts;

  const MIN_POSTS = 5;

  if (relevantPosts.length < MIN_POSTS) {
    const suggestions: Suggestion[] = [];
    const targetPlatforms = platform ? [platform] : ['facebook', 'instagram'];

    for (const p of targetPlatforms) {
      const defaults = INDUSTRY_DEFAULTS[p];
      if (defaults) {
        suggestions.push({
          platform: p,
          days: defaults.days,
          timeRange: defaults.timeRange,
          reasoning: defaults.reason,
        });
      }
    }

    return ok({
      dataSource: 'industry_defaults',
      postsAnalyzed: relevantPosts.length,
      note: `Only ${relevantPosts.length} published post(s) found. Using industry defaults. More data will improve recommendations.`,
      suggestions,
    });
  }

  const dayHourCounts: Record<string, { count: number; posts: number }> = {};
  const dayNames = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];

  for (const post of relevantPosts) {
    if (!post.publishedAt) continue;
    const date = new Date(post.publishedAt);
    const day = dayNames[date.getDay()];
    const hour = date.getHours();
    const windowStart = Math.floor(hour / 2) * 2;
    const key = `${day}_${windowStart}`;

    if (!dayHourCounts[key]) {
      dayHourCounts[key] = { count: 0, posts: 0 };
    }
    dayHourCounts[key].count++;
    dayHourCounts[key].posts++;
  }

  const sorted = Object.entries(dayHourCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3);

  const formatHour = (h: number) => {
    const period = h >= 12 ? 'PM' : 'AM';
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${display}:00 ${period}`;
  };

  const suggestions: Suggestion[] = sorted.map(([key, data]) => {
    const [day, hourStr] = key.split('_');
    const hour = Number.parseInt(hourStr, 10);
    const endHour = hour + 2;

    return {
      day,
      timeRange: `${formatHour(hour)} – ${formatHour(endHour)}`,
      postsInWindow: data.posts,
      reasoning: `${data.posts} of your past posts were published on ${day}s between ${formatHour(hour)} and ${formatHour(endHour)}.`,
    };
  });

  return ok({
    dataSource: 'historical',
    postsAnalyzed: relevantPosts.length,
    suggestions,
  });
};

export const suggestPostingTime = (
  db: DbConnection,
  input: SuggestPostingTimeInput
) =>
  trackedResult(
    'socialPosts.suggestPostingTime',
    () => withOrgScope((tx) => suggestPostingTimeImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );
