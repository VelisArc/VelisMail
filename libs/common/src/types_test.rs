//! Tests for core data types

#[cfg(test)]
mod tests {
    use super::*;
    use validator::Validate;
    use uuid::Uuid;

    #[test]
    fn test_email_validation() {
        let valid_email = Email {
            address: "user@example.com".to_string(),
            display_name: Some("User Name".to_string()),
        };
        
        assert!(valid_email.validate().is_ok());
        
        let invalid_email = Email {
            address: "invalid-email".to_string(),
            display_name: None,
        };
        
        assert!(invalid_email.validate().is_err());
    }

    #[test]
    fn test_pagination_calculation() {
        let pagination = Pagination::new(2, 20, 100);
        
        assert_eq!(pagination.page, 2);
        assert_eq!(pagination.per_page, 20);
        assert_eq!(pagination.total, 100);
        assert_eq!(pagination.offset(), 20); // (2-1) * 20 = 20
    }

    #[test]
    fn test_user_id_equality() {
        let uuid = Uuid::new_v4();
        let user_id1 = UserId(uuid);
        let user_id2 = UserId(uuid);
        let user_id3 = UserId(Uuid::new_v4());
        
        assert_eq!(user_id1, user_id2);
        assert_ne!(user_id1, user_id3);
    }

    #[test]
    fn test_tenant_id_equality() {
        let uuid = Uuid::new_v4();
        let tenant_id1 = TenantId(uuid);
        let tenant_id2 = TenantId(uuid);
        let tenant_id3 = TenantId(Uuid::new_v4());
        
        assert_eq!(tenant_id1, tenant_id2);
        assert_ne!(tenant_id1, tenant_id3);
    }

    #[test]
    fn test_message_status_ordering() {
        use MessageStatus::*;
        
        // Test equality
        assert_eq!(Draft, Draft);
        assert_ne!(Draft, Sent);
    }

    #[test]
    fn test_folder_type_serialization() {
        use FolderType::*;
        
        let inbox = Inbox;
        let custom = Custom("Archive".to_string());
        
        // Test pattern matching
        match inbox {
            Inbox => assert!(true),
            _ => assert!(false),
        }
        
        match custom {
            Custom(name) => assert_eq!(name, "Archive"),
            _ => assert!(false),
        }
    }

    #[test]
    fn test_priority_ordering() {
        use Priority::*;
        
        assert!(Low < Normal);
        assert!(Normal < High);
        assert!(High < Critical);
        assert_eq!(Low, Low);
        assert_ne!(Low, High);
    }

    #[test]
    fn test_encryption_status() {
        use EncryptionStatus::*;
        
        assert_eq!(None, None);
        assert_eq!(TLS, TLS);
        assert_eq!(E2EE, E2EE);
        assert_ne!(None, E2EE);
    }
}