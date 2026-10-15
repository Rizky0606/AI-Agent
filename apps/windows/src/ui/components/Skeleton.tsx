import React from 'react';
import './Components.css';

export interface SkeletonProps {
  variant?: 'text' | 'circular' | 'rectangular';
  className?: string;
  lines?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'text',
  className = '',
  lines = 1,
}) => {
  if (variant === 'text' && lines > 1) {
    return (
      <div className="ui-skeleton-group" aria-busy="true" aria-hidden="true">
        {Array.from({ length: lines }).map((_, index) => (
          <span
            key={index}
            className={`ui-skeleton ui-skeleton-text ${className}`.trim()}
          />
        ))}
      </div>
    );
  }

  return (
    <span
      aria-busy="true"
      aria-hidden="true"
      className={`ui-skeleton ui-skeleton-${variant} ${className}`.trim()}
    />
  );
};
