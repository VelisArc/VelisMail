import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import AuthGuard from './components/AuthGuard';
import LoadingFallback from './components/LoadingFallback';
import './App.css';

// ---- Lazy-loaded pages for code splitting ----
const Home = lazy(() => import('./pages/Home'));
const Login = lazy(() => import('./pages/Login'));
const BusinessDashboard = lazy(() => import('./pages/BusinessDashboard'));
const BusinessSetup = lazy(() => import('./pages/BusinessSetup'));
const Contacts = lazy(() => import('./pages/Contacts'));
const Settings = lazy(() => import('./pages/Settings'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Terms = lazy(() => import('./pages/Terms'));
const About = lazy(() => import('./pages/About'));
const Cookies = lazy(() => import('./pages/Cookies'));
const AcceptableUse = lazy(() => import('./pages/AcceptableUse'));
const SecurityPolicy = lazy(() => import('./pages/SecurityPolicy'));
const Refund = lazy(() => import('./pages/Refund'));
const Documentation = lazy(() => import('./pages/Documentation'));
const Status = lazy(() => import('./pages/Status'));

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/cookies" element={<Cookies />} />
            <Route path="/aup" element={<AcceptableUse />} />
            <Route path="/security" element={<SecurityPolicy />} />
            <Route path="/refund" element={<Refund />} />
            <Route path="/about" element={<About />} />
            <Route path="/docs" element={<Documentation />} />
            <Route path="/status" element={<Status />} />

            {/* Protected routes — require authentication */}
            <Route
              path="/business"
              element={
                <AuthGuard requireSetup>
                  <BusinessDashboard />
                </AuthGuard>
              }
            />
            <Route
              path="/business-setup"
              element={
                <AuthGuard>
                  <BusinessSetup />
                </AuthGuard>
              }
            />
            <Route
              path="/contacts"
              element={
                <AuthGuard>
                  <Contacts />
                </AuthGuard>
              }
            />
            <Route
              path="/settings"
              element={
                <AuthGuard>
                  <Settings />
                </AuthGuard>
              }
            />

            {/* Catch-all redirect */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
