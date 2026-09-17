import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Info, Sparkles } from 'lucide-react';
import type * as React from 'react';

export type ContentIdeaCategory =
  | 'Trust'
  | 'Results'
  | 'Informative'
  | 'Promotion'
  | 'Social Proof'
  | 'Carousel'
  | 'Single image'
  | 'Organic';

export type ContentIdeaStatus = 'available' | 'coming_soon';

export interface ContentIdea {
  id: string;
  title: string;
  description: string;
  category: ContentIdeaCategory;
  status: ContentIdeaStatus;
  isRecommended?: boolean;
  icon: React.ReactNode;
}

export interface ContentIdeaCardProps {
  idea: ContentIdea;
  onUseTemplate?: (ideaId: string) => void;
  isLoading?: boolean;
  className?: string;
  /** Action button label. Defaults to "Make Video" (the original use case). */
  actionLabel?: string;
}

export function ContentIdeaCard({
  idea,
  onUseTemplate,
  isLoading = false,
  className,
  actionLabel = 'Make Video',
}: ContentIdeaCardProps) {
  const { id, title, description, category, status, isRecommended, icon } =
    idea;

  const handleUseTemplate = () => {
    if (status === 'available') {
      onUseTemplate?.(id);
    }
  };

  return (
    <Card
      className={cn(
        'relative flex flex-col items-center p-4 gap-4 transition-shadow hover:shadow-md',
        className
      )}
    >
      {/* Header badges */}
      <div className="absolute left-4 right-4 top-4 flex items-start justify-between">
        <Badge
          variant="outline"
          className="text-xs font-medium text-muted-foreground rounded-md"
        >
          {category}
        </Badge>
        {isRecommended && (
          <Badge className="gap-1 bg-primary text-xs font-normal text-primary-foreground">
            <Sparkles className="size-3" />
            Recommended
          </Badge>
        )}
      </div>

      <CardContent className="flex flex-col items-center gap-2 px-6 pt-8 text-center">
        {/* Icon */}
        <div className="flex size-16 bg-accent rounded-md items-center justify-center mb-2">
          {icon}
        </div>

        {/* Title */}
        <h3 className="text-base font-medium">{title}</h3>

        {/* Description */}
        <p className="max-w-xs text-center text-sm text-muted-foreground font-normal line-clamp-3">
          {description}
        </p>

        {/* Action */}
        <div className="mt-2 w-full">
          {status === 'coming_soon' ? (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
              <Info className="size-4" />
              Coming Soon
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              onClick={handleUseTemplate}
              disabled={isLoading}
            >
              {actionLabel}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export interface ContentIdeaGridProps {
  children: React.ReactNode;
  className?: string;
}

export function ContentIdeaGrid({ children, className }: ContentIdeaGridProps) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {children}
    </div>
  );
}
