import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Pricing from './Pricing';

function renderPricing() {
  return render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  );
}

describe('Pricing enterprise plan', () => {
  it('shows custom pricing and a contact action instead of checkout', () => {
    renderPricing();

    const card = screen.getByRole('heading', { name: 'Enterprise' }).closest('.pricing-card');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('Custom')).toBeTruthy();
    expect(within(card as HTMLElement).queryByText(/₹2,499/)).toBeNull();
    expect(within(card as HTMLElement).getByRole('button', { name: /contact now/i })).toBeTruthy();
  });

  it('opens the team contact form from the enterprise card', () => {
    renderPricing();

    fireEvent.click(screen.getByRole('button', { name: /contact now/i }));

    const dialog = screen.getByRole('dialog', { name: /talk to the velismail team/i });
    expect(within(dialog).getByLabelText('Name')).toBeTruthy();
    expect(within(dialog).getByLabelText('Work email')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /send request/i })).toBeTruthy();
  });
});
