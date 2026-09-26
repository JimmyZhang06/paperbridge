import type { ButtonHTMLAttributes } from 'react';

type AppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'secondary' | 'soft' | 'text';
};

export function AppButton({ variant = 'secondary', className = '', type = 'button', ...props }: AppButtonProps) {
  return <button type={type} className={`app-button app-button--${variant} ${className}`.trim()} {...props} />;
}
