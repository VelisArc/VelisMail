import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SignupGuide from './SignupGuide';

describe('signup quick-start guide', () => {
  it('walks through every setup step and finishes registration', () => {
    const onComplete = vi.fn();
    render(<SignupGuide onComplete={onComplete} onSkip={() => {}} />);

    expect(
      screen.getByRole('heading', { name: 'Set up VelisMail in 5 steps' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeTruthy();

    for (let step = 2; step <= 5; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
    }

    expect(screen.getByRole('heading', { name: /Verify once/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Create my account/ }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('lets a user skip the guide', () => {
    const onSkip = vi.fn();
    render(<SignupGuide onComplete={() => {}} onSkip={onSkip} />);

    fireEvent.click(screen.getByRole('button', { name: /Skip guide/ }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
