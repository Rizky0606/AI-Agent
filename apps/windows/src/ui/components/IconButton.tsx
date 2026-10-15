import React from 'react';
import './Components.css';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon: React.ReactNode;
  isLoading?: boolean;
}

export const IconButton: React.FC<IconButtonProps> = ({
  'aria-label': ariaLabel,
  variant = 'ghost',
  size = 'md',
  icon,
  isLoading = false,
  disabled,
  className = '',
  ...rest
}) => {
  const classes = [
    'ui-icon-btn',
    `ui-btn-${variant}`,
    `ui-icon-btn-${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled || isLoading}
      {...rest}
    >
      {isLoading ? <span className="ui-spinner ui-spinner-sm" aria-hidden="true" /> : icon}
    </button>
  );
};
