import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { AdminConfirmSelect } from './AdminConfirm';
import { useAdminConfirm } from './useAdminConfirm';

function Harness({ onApply }: { onApply: (next: string) => void }) {
  const { confirm, dialog } = useAdminConfirm();
  const [value, setValue] = useState('free');

  return (
    <div>
      <AdminConfirmSelect
        value={value}
        options={['free', 'business']}
        confirm={confirm}
        title={(next) => `Move to the ${next} plan`}
        message={(next) => `The plan changes to ${next}.`}
        confirmLabel="Change plan"
        tone="primary"
        onApply={(next) => {
          onApply(next);
          setValue(next);
        }}
        ariaLabel="Plan"
      />
      {dialog}
    </div>
  );
}

describe('admin two-step confirmation', () => {
  it('does not apply a select change before the operator confirms it', async () => {
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'business' } });

    // First step: the dialog opens, nothing is applied yet.
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText('Move to the business plan')).toBeTruthy();

    // Second step: confirming applies the change.
    fireEvent.click(screen.getByText('Change plan'));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith('business'));
  });

  it('discards the pending change when the operator cancels', async () => {
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'business' } });
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText('Move to the business plan')).toBeNull());
    expect(onApply).not.toHaveBeenCalled();

    // The stored value is untouched, so the select snaps back.
    expect((screen.getByLabelText('Plan') as HTMLSelectElement).value).toBe('free');
  });
});
