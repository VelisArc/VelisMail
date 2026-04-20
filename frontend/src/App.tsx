import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import BusinessDashboard from './pages/BusinessDashboard';
import BusinessSetup from './pages/BusinessSetup';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import About from './pages/About';
import Settings from './pages/Settings';
import Setup from './pages/Setup';
import Cookies from './pages/Cookies';
import AcceptableUse from './pages/AcceptableUse';
import SecurityPolicy from './pages/SecurityPolicy';
import Refund from './pages/Refund';
import Contacts from './pages/Contacts';
import Documentation from './pages/Documentation';
import Status from './pages/Status';
import { theme } from './api/client';
import './App.css';

// Initialize theme on app load
theme.init();

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/:folder" element={<Dashboard />} />
        <Route path="/business" element={<BusinessDashboard />} />
        <Route path="/business-setup" element={<BusinessSetup />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/cookies" element={<Cookies />} />
        <Route path="/aup" element={<AcceptableUse />} />
        <Route path="/security" element={<SecurityPolicy />} />
        <Route path="/refund" element={<Refund />} />
        <Route path="/about" element={<About />} />
        <Route path="/docs" element={<Documentation />} />
        <Route path="/status" element={<Status />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
