// Unit tests for session store
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useSessionStore } from './sessionStore';
import type { User } from '../types/session';

describe('sessionStore', () => {
  // Clear sessionStorage before each test
  beforeEach(() => {
    sessionStorage.clear();
    useSessionStore.setState({
      user: null,
      accountType: 'personal',
      navigation: {
        accountType: 'personal',
        activeTab: 'domains',
        activeFolder: 'inbox',
        selectedEmailId: null,
        searchQuery: '',
        timestamp: Date.now(),
      },
      verification: {
        emailVerified: false,
        domainVerified: false,
        profileComplete: false,
        twoFactorEnabled: false,
      },
      lastActivity: Date.now(),
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe('setSession', () => {
    it('should set user and account type from user profile', () => {
      const user: User = {
        id: 'usr_123',
        email: 'test@example.com',
        displayName: 'Test User',
        plan: 'Starter',
        accountType: 'business',
        isSetupComplete: true,
        createdAt: new Date().toISOString(),
      };

      useSessionStore.getState().setSession(user);

      const state = useSessionStore.getState();
      expect(state.user).toEqual(user);
      expect(state.accountType).toBe('business');
      expect(state.navigation.accountType).toBe('business');
    });

    it('should update lastActivity timestamp', () => {
      const before = Date.now();
      
      const user: User = {
        id: 'usr_123',
        email: 'test@example.com',
        displayName: 'Test User',
        plan: 'Starter',
        accountType: 'personal',
        isSetupComplete: true,
        createdAt: new Date().toISOString(),
      };

      useSessionStore.getState().setSession(user);

      const after = Date.now();
      const state = useSessionStore.getState();
      expect(state.lastActivity).toBeGreaterThanOrEqual(before);
      expect(state.lastActivity).toBeLessThanOrEqual(after);
    });
  });

  describe('clearSession', () => {
    it('should reset all state to defaults', () => {
      // First set some state
      const user: User = {
        id: 'usr_123',
        email: 'test@example.com',
        displayName: 'Test User',
        plan: 'Starter',
        accountType: 'business',
        isSetupComplete: true,
        createdAt: new Date().toISOString(),
      };

      useSessionStore.getState().setSession(user);
      useSessionStore.getState().updateNavigation({ activeFolder: 'sent' });

      // Now clear
      useSessionStore.getState().clearSession();

      const state = useSessionStore.getState();
      expect(state.user).toBeNull();
      expect(state.accountType).toBe('personal');
      expect(state.navigation.activeFolder).toBe('inbox');
    });
  });

  describe('setAccountType', () => {
    it('should update account type in both root and navigation', () => {
      useSessionStore.getState().setAccountType('business');

      const state = useSessionStore.getState();
      expect(state.accountType).toBe('business');
      expect(state.navigation.accountType).toBe('business');
    });

    it('should preserve other navigation state when changing account type', () => {
      useSessionStore.getState().updateNavigation({ 
        activeFolder: 'sent',
        selectedEmailId: 'email_123',
      });

      useSessionStore.getState().setAccountType('business');

      const state = useSessionStore.getState();
      expect(state.accountType).toBe('business');
      expect(state.navigation.activeFolder).toBe('sent');
      expect(state.navigation.selectedEmailId).toBe('email_123');
    });
  });

  describe('updateNavigation', () => {
    it('should update navigation state partially', () => {
      useSessionStore.getState().updateNavigation({ 
        activeFolder: 'spam',
        selectedEmailId: 'email_456',
      });

      const state = useSessionStore.getState();
      expect(state.navigation.activeFolder).toBe('spam');
      expect(state.navigation.selectedEmailId).toBe('email_456');
      expect(state.navigation.activeTab).toBe('domains'); // preserved
    });

    it('should update timestamp on navigation change', () => {
      const before = Date.now();
      
      useSessionStore.getState().updateNavigation({ activeFolder: 'archive' });

      const state = useSessionStore.getState();
      expect(state.navigation.timestamp).toBeGreaterThanOrEqual(before);
    });
  });

  describe('updateVerification', () => {
    it('should update verification status partially', () => {
      useSessionStore.getState().updateVerification({ 
        emailVerified: true,
        profileComplete: true,
      });

      const state = useSessionStore.getState();
      expect(state.verification.emailVerified).toBe(true);
      expect(state.verification.profileComplete).toBe(true);
      expect(state.verification.domainVerified).toBe(false); // preserved default
    });
  });

  describe('updateUser', () => {
    it('should update user data partially', () => {
      const user: User = {
        id: 'usr_123',
        email: 'test@example.com',
        displayName: 'Test User',
        plan: 'Starter',
        accountType: 'personal',
        isSetupComplete: true,
        createdAt: new Date().toISOString(),
      };

      useSessionStore.getState().setSession(user);
      useSessionStore.getState().updateUser({ 
        displayName: 'Updated Name',
        plan: 'Premium',
      });

      const state = useSessionStore.getState();
      expect(state.user?.displayName).toBe('Updated Name');
      expect(state.user?.plan).toBe('Premium');
      expect(state.user?.email).toBe('test@example.com'); // preserved
    });

    it('should do nothing if no user is set', () => {
      useSessionStore.getState().updateUser({ displayName: 'New Name' });

      const state = useSessionStore.getState();
      expect(state.user).toBeNull();
    });
  });

  describe('touchActivity', () => {
    it('should update lastActivity timestamp', () => {
      const before = Date.now();
      
      useSessionStore.getState().touchActivity();

      const after = Date.now();
      const state = useSessionStore.getState();
      expect(state.lastActivity).toBeGreaterThanOrEqual(before);
      expect(state.lastActivity).toBeLessThanOrEqual(after);
    });
  });

  describe('persistence', () => {
    it('should persist accountType and navigation to sessionStorage', () => {
      useSessionStore.getState().setAccountType('business');
      useSessionStore.getState().updateNavigation({ activeFolder: 'sent' });

      // Check sessionStorage has the data
      const stored = sessionStorage.getItem('velismail-session');
      expect(stored).not.toBeNull();
      
      const parsed = JSON.parse(stored!);
      expect(parsed.state.accountType).toBe('business');
      expect(parsed.state.navigation.activeFolder).toBe('sent');
    });

    it('should not persist user data to sessionStorage', () => {
      const user: User = {
        id: 'usr_123',
        email: 'test@example.com',
        displayName: 'Test User',
        plan: 'Starter',
        accountType: 'personal',
        isSetupComplete: true,
        createdAt: new Date().toISOString(),
      };

      useSessionStore.getState().setSession(user);

      // Check sessionStorage does not have user data
      const stored = sessionStorage.getItem('velismail-session');
      const parsed = JSON.parse(stored!);
      expect(parsed.state.user).toBeUndefined();
    });
  });
});
