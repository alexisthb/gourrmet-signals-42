import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ScoreStars - design Gourrmet : etoiles indigo (au lieu de warning jaune)
 * pour aligner sur la palette dominante du brand.
 */
interface ScoreStarsProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ScoreStars({ score, size = 'md', className }: ScoreStarsProps) {
  const sizeClasses = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  };

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            sizeClasses[size],
            i <= score ? 'fill-indigo-600 text-indigo-600' : 'text-border-strong'
          )}
          strokeWidth={1.6}
        />
      ))}
    </div>
  );
}
