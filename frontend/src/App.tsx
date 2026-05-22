import { lazy, Suspense, useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useNavigation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import AuthGuard from './components/AuthGuard';
import LoadingFallback from './components/LoadingFallback';
import PageTransition from './components/PageTransition';
import Analytics from './components/Analytics';
import './App.css';

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
const Pricing = lazy(() => import('./pages/Pricing'));
const NotFound = lazy(() => import('./pages/NotFound'));

function NavigationProgress() {
  const navigation = useNavigation();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (navigation.state === 'loading') {
      setProgress(30);
      setVisible(true);
      const t1 = setTimeout(() => setProgress(60), 100);
      const t2 = setTimeout(() => setProgress(85), 300);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    } else {
      setProgress(100);
      const t = setTimeout(() => { setVisible(false); setProgress(0); }, 300);
      return () => clearTimeout(t);
    }
  }, [navigation.state]);

  if (!visible) return null;

  return (
    <div className="nav-progress" aria-hidden="true">
      <div className="nav-progress-bar" style={{ width: `${progress}%` }} />
    </div>
  );
}

function RootLayout() {
  return (
    <>
      <Analytics />
      <NavigationProgress />
      <Suspense fallback={<LoadingFallback />}>
        <Outlet />
      </Suspense>
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <PageTransition><Home /></PageTransition> },
      { path: "/login", element: <PageTransition><Login /></PageTransition> },
      { path: "/privacy", element: <PageTransition><Privacy /></PageTransition> },
      { path: "/terms", element: <PageTransition><Terms /></PageTransition> },
      { path: "/cookies", element: <PageTransition><Cookies /></PageTransition> },
      { path: "/aup", element: <PageTransition><AcceptableUse /></PageTransition> },
      { path: "/security", element: <PageTransition><SecurityPolicy /></PageTransition> },
      { path: "/refund", element: <PageTransition><Refund /></PageTransition> },
      { path: "/about", element: <PageTransition><About /></PageTransition> },
      { path: "/docs", element: <PageTransition><Documentation /></PageTransition> },
      { path: "/status", element: <PageTransition><Status /></PageTransition> },
      { path: "/pricing", element: <PageTransition><Pricing /></PageTransition> },
      { path: "/business", element: <PageTransition><AuthGuard requireSetup><BusinessDashboard /></AuthGuard></PageTransition> },
      { path: "/business-setup", element: <PageTransition><AuthGuard><BusinessSetup /></AuthGuard></PageTransition> },
      { path: "/contacts", element: <PageTransition><AuthGuard requireSetup><Contacts /></AuthGuard></PageTransition> },
      { path: "/settings", element: <PageTransition><AuthGuard requireSetup><Settings /></AuthGuard></PageTransition> },
      { path: "/404", element: <PageTransition><NotFound /></PageTransition> },
      { path: "*", element: <Navigate to="/404" replace /> },
    ],
  },
]);

function App() {
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}

export default App;
