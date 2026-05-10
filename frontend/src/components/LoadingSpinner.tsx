type LoadingSpinnerProps = {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
};

export default function LoadingSpinner({
  size = 'md',
  label = 'Loading',
  className = '',
}: LoadingSpinnerProps) {
  return (
    <span
      className={`velis-spinner velis-spinner-${size} ${className}`.trim()}
      role="status"
      aria-label={label}
    />
  );
}
