// Session types for VelisMail state management

/**
 * User information stored in session
 */
export interface User {
  id: string;
  email: string;
  displayName: string;
  plan: string;
  accountType: 'personal' | 'business';
  customDomain?: string;
  mailProvider?: 'velismail' | 'sendgrid' | 'resend' | 'custom_smtp';
  apiKey?: string;
  isSetupComplete: boolean;
  customDbUrl?: string;
  createdAt: string;
  // Business Mail fields
  isBusinessSetupComplete?: boolean;
  businessDomain?: string;
  businessDbUrl?: string;
  businessApiKey?: string;
  businessMailProvider?: string;
  businessDomainVerified?: boolean;
  dkimStatus?: 'pending' | 'verified' | 'failed';
  spfStatus?: 'pending' | 'verified' | 'failed';
  dmarcStatus?: 'pending' | 'verified' | 'failed';
  // Profile image
  profileImageUrl?: string;
  // Business profile configuration
  businessProfile?: {
    domain?: string;
    dbUrl?: string;
    apiKey?: string;
    mailProvider?: string;
    verified?: boolean;
    dkimStatus?: 'pending' | 'verified' | 'failed';
    spfStatus?: 'pending' | 'verified' | 'failed';
    dmarcStatus?: 'pending' | 'verified' | 'failed';
  };
}

/**
 * Verification status for the user account
 */
export interface VerificationStatus {
  emailVerified: boolean;
  domainVerified: boolean;      // For business accounts
  profileComplete: boolean;
  twoFactorEnabled: boolean;
}

/**
 * Navigation state that persists across page refreshes
 */
export interface NavigationState {
  accountType: 'personal' | 'business';
  activeTab: string;           // For BusinessDashboard (domains, team, analytics, queue)
  activeFolder: string;        // Current email folder (inbox, sent, drafts, etc.)
  selectedEmailId: string | null;
  searchQuery: string;
  timestamp: number;           // When the state was last updated
}

/**
 * Complete session state managed by Zustand
 */
export interface SessionState {
  // Core state
  user: User | null;
  accountType: 'personal' | 'business';
  navigation: NavigationState;
  verification: VerificationStatus;
  lastActivity: number;

  // Actions
  setSession: (user: User) => void;
  clearSession: () => void;
  setAccountType: (type: 'personal' | 'business') => void;
  updateNavigation: (state: Partial<NavigationState>) => void;
  updateVerification: (status: Partial<VerificationStatus>) => void;
  updateUser: (updates: Partial<User>) => void;
  touchActivity: () => void;
}

/**
 * Default navigation state
 */
export const DEFAULT_NAVIGATION_STATE: NavigationState = {
  accountType: 'personal',
  activeTab: 'domains',
  activeFolder: 'inbox',
  selectedEmailId: null,
  searchQuery: '',
  timestamp: Date.now(),
};

/**
 * Default verification status
 */
export const DEFAULT_VERIFICATION_STATUS: VerificationStatus = {
  emailVerified: false,
  domainVerified: false,
  profileComplete: false,
  twoFactorEnabled: false,
};
