// VelisMail Session Store - Centralized state management with Zustand
// Uses sessionStorage for navigation state persistence (survives refresh, cleared on tab close)

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { 
  SessionState, 
  User, 
  NavigationState, 
  VerificationStatus,
} from '../types/session';

/**
 * Default navigation state
 */
const DEFAULT_NAVIGATION: NavigationState = {
  accountType: 'business',
  activeTab: 'domains',
  activeFolder: 'inbox',
  selectedEmailId: null,
  searchQuery: '',
  timestamp: Date.now(),
};

/**
 * Default verification status
 */
const DEFAULT_VERIFICATION: VerificationStatus = {
  emailVerified: false,
  domainVerified: false,
  profileComplete: false,
  twoFactorEnabled: false,
};

/**
 * Session store with Zustand
 * 
 * Persists navigation state to sessionStorage for state restoration after page refresh.
 * User data is stored separately in localStorage by the auth system for backward compatibility.
 * 
 * Key features:
 * - Navigation state persists across page refreshes (sessionStorage)
 * - Account type is maintained consistently
 * - State is cleared when browser tab is closed (sessionStorage behavior)
 */
export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      // Core state
      user: null,
      accountType: 'business',
      navigation: DEFAULT_NAVIGATION,
      verification: DEFAULT_VERIFICATION,
      lastActivity: Date.now(),

      // Actions

      /**
       * Set the user session
       * Updates user data and sets account type from user profile
       */
      setSession: (user: User) => {
        // Preserve any existing navigation state (e.g. current tab) instead of forcing defaults on login/restore.
        const currentNavigation = get().navigation || DEFAULT_NAVIGATION;
        set({
          user,
          accountType: user.accountType,
          lastActivity: Date.now(),
          navigation: {
            ...currentNavigation,
            accountType: user.accountType,
            timestamp: Date.now(),
          },
        });
      },

      /**
       * Clear the session completely
       * Resets all state to defaults
       */
      clearSession: () => {
        set({
          user: null,
          accountType: 'business',
          navigation: DEFAULT_NAVIGATION,
          verification: DEFAULT_VERIFICATION,
          lastActivity: Date.now(),
        });
      },

      /**
       * Set the account type (personal or business)
       * Updates both the root accountType and navigation.accountType
       */
      setAccountType: (type: 'business') => {
        const currentNavigation = get().navigation;
        set({
          accountType: type,
          navigation: {
            ...currentNavigation,
            accountType: type,
            timestamp: Date.now(),
          },
          lastActivity: Date.now(),
        });
      },

      /**
       * Update navigation state partially
       * Merges with existing navigation state and updates timestamp
       */
      updateNavigation: (state: Partial<NavigationState>) => {
        const currentNavigation = get().navigation;
        set({
          navigation: {
            ...currentNavigation,
            ...state,
            timestamp: Date.now(),
          },
          lastActivity: Date.now(),
        });
      },

      /**
       * Update verification status partially
       * Merges with existing verification status
       */
      updateVerification: (status: Partial<VerificationStatus>) => {
        const currentVerification = get().verification;
        set({
          verification: {
            ...currentVerification,
            ...status,
          },
          lastActivity: Date.now(),
        });
      },

      /**
       * Update user data partially
       * Merges with existing user data
       */
      updateUser: (updates: Partial<User>) => {
        const currentUser = get().user;
        if (currentUser) {
          set({
            user: {
              ...currentUser,
              ...updates,
            },
            lastActivity: Date.now(),
          });
        }
      },

      /**
       * Update last activity timestamp
       * Used for session timeout tracking
       */
      touchActivity: () => {
        set({
          lastActivity: Date.now(),
        });
      },
    }),
    {
      name: 'velismail-session', // Storage key
      storage: createJSONStorage(() => sessionStorage),
      // Only persist specific fields - user data is handled separately by auth
      partialize: (state) => ({
        accountType: state.accountType,
        navigation: state.navigation,
        lastActivity: state.lastActivity,
      }),
    }
  )
);

/**
 * Hook to get the current user
 */
export const useUser = () => useSessionStore((state) => state.user);

/**
 * Hook to get the current account type
 */
export const useAccountType = () => useSessionStore((state) => state.accountType);

/**
 * Hook to get the navigation state
 */
export const useNavigation = () => useSessionStore((state) => state.navigation);

/**
 * Hook to get the verification status
 */
export const useVerification = () => useSessionStore((state) => state.verification);

/**
 * Hook to get session actions
 */
export const useSessionActions = () => {
  return {
    setSession: useSessionStore((state) => state.setSession),
    clearSession: useSessionStore((state) => state.clearSession),
    setAccountType: useSessionStore((state) => state.setAccountType),
    updateNavigation: useSessionStore((state) => state.updateNavigation),
    updateVerification: useSessionStore((state) => state.updateVerification),
    updateUser: useSessionStore((state) => state.updateUser),
    touchActivity: useSessionStore((state) => state.touchActivity),
  };
};

export default useSessionStore;
