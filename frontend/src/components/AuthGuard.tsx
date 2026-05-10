import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { auth } from '../api/client';

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
    // Enforce infrastructure connectivity — DB + API key + domain must all exist
    const hasDb = Boolean(user.businessDbUrl?.trim());
    const hasApiKey = Boolean(user.businessApiKey?.trim());
    const hasDomain = Boolean(user.businessDomain?.trim());
    const hasProvider = Boolean(user.businessMailProvider?.trim());
    const infraComplete = hasDb && hasApiKey && hasDomain && hasProvider;

    if (!infraComplete) {
      return <Navigate to="/business-setup" replace />;
    }

    if (!user.isBusinessSetupComplete) {
      return <Navigate to="/business-setup" replace />;
    }
  }

  return <>{children}</>;
}
