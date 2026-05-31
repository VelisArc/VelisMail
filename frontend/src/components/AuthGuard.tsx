import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { auth, isBusinessSetupReady } from '../api/client';

interface AuthGuardProps {
  children: ReactNode;
  requireSetup?: boolean;
}

/**
 * AuthGuard — Protects routes that require authentication.
 * Redirects to /login if no valid session exists.
 * Enforces infrastructure connectivity: database URL AND API key must be
 * present before any business dashboard access is granted.
 * If infrastructure was removed (e.g. database deleted, API key revoked),
 * the setup flag is reset and the user is redirected to /business-setup.
 */
export default function AuthGuard({ children, requireSetup = false }: AuthGuardProps) {
  const location = useLocation();
  const user = auth.getSession();

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (requireSetup) {
    if (!isBusinessSetupReady(user)) {
      return <Navigate to="/business-setup" replace />;
    }
  }

  return <>{children}</>;
}
