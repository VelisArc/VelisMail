//! Tests for account locking functionality

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Utc, Duration};
    use sqlx::PgPool;
    use std::sync::Arc;
    use uuid::Uuid;
    use velismail_common::UserId;

    // Mock database and Redis for testing
    struct TestContext {
        db: PgPool,
        redis: Arc<redis::Client>,
    }

    impl TestContext {
        async fn new() -> Self {
            // In production tests, use test containers or mocks
            todo!("Implement test context with test database")
        }
    }

    #[tokio::test]
    async fn test_account_lock_after_max_attempts() {
        let ctx = TestContext::new().await;
        let manager = AccountLockManager::new(
            ctx.db,
            ctx.redis,
            3, // max_failed_attempts
            15, // lockout_duration_minutes
            15, // window_duration_minutes
        );

        let email = "test@example.com";
        let user_id = UserId(Uuid::new_v4());
        let ip_address = "192.168.1.1";

        // Record 2 failed attempts
        for _ in 0..2 {
            manager.record_failed_attempt(
                Some(user_id.clone()),
                email,
                ip_address,
            ).await.unwrap();
        }

        // Account should not be locked yet
        assert!(!manager.is_account_locked(email).await.unwrap());

        // Record 3rd failed attempt
        manager.record_failed_attempt(
            Some(user_id.clone()),
            email,
            ip_address,
        ).await.unwrap();

        // Account should now be locked
        assert!(manager.is_account_locked(email).await.unwrap());

        // Clear failed attempts
        manager.clear_failed_attempts(email).await.unwrap();

        // Account should no longer be locked
        assert!(!manager.is_account_locked(email).await.unwrap());
    }

    #[tokio::test]
    async fn test_failed_attempts_expire_after_window() {
        let ctx = TestContext::new().await;
        let manager = AccountLockManager::new(
            ctx.db,
            ctx.redis,
            3, // max_failed_attempts
            15, // lockout_duration_minutes
            1, // 1 minute window for testing
        );

        let email = "test2@example.com";
        let user_id = UserId(Uuid::new_v4());
        let ip_address = "192.168.1.2";

        // Record 3 failed attempts
        for _ in 0..3 {
            manager.record_failed_attempt(
                Some(user_id.clone()),
                email,
                ip_address,
            ).await.unwrap();
        }

        // Account should be locked
        assert!(manager.is_account_locked(email).await.unwrap());

        // Wait for window to expire (in real test, would mock time)
        // After window expires, attempts should be cleared
        
        // This test would need time mocking to work properly
    }

    #[tokio::test]
    async fn test_get_failed_attempts_count() {
        let ctx = TestContext::new().await;
        let manager = AccountLockManager::new(
            ctx.db,
            ctx.redis,
            5, // max_failed_attempts
            15, // lockout_duration_minutes
            15, // window_duration_minutes
        );

        let email = "test3@example.com";
        let user_id = UserId(Uuid::new_v4());
        let ip_address = "192.168.1.3";

        // Record 3 failed attempts
        for _ in 0..3 {
            manager.record_failed_attempt(
                Some(user_id.clone()),
                email,
                ip_address,
            ).await.unwrap();
        }

        // Should count 3 failed attempts
        let count = manager.get_failed_attempts_count(email).await.unwrap();
        assert_eq!(count, 3);
    }

    #[tokio::test]
    async fn test_get_lockout_expiry() {
        let ctx = TestContext::new().await;
        let manager = AccountLockManager::new(
            ctx.db,
            ctx.redis,
            3, // max_failed_attempts
            15, // lockout_duration_minutes
            15, // window_duration_minutes
        );

        let email = "test4@example.com";
        let user_id = UserId(Uuid::new_v4());
        let ip_address = "192.168.1.4";

        // Record 3 failed attempts to trigger lockout
        for _ in 0..3 {
            manager.record_failed_attempt(
                Some(user_id.clone()),
                email,
                ip_address,
            ).await.unwrap();
        }

        // Should have lockout expiry time
        let expiry = manager.get_lockout_expiry(email).await.unwrap();
        assert!(expiry.is_some());
        
        // Expiry should be in the future
        if let Some(expiry_time) = expiry {
            assert!(expiry_time > Utc::now());
        }
    }
}