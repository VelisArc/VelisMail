export function formatINR(amount: number): string {
  if (amount === 0) return '0';
  return amount.toLocaleString('en-IN');
}

export function formatRelative(date: Date | string | number): string {
  const d = new Date(date);
  return d.toLocaleString();
}

export function formatInviteExpiry(date: Date | string | number): string {
  const d = new Date(date);
  return d.toLocaleString();
}
