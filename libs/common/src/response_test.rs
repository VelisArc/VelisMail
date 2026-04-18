//! Tests for API response wrappers

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_api_response_success() {
        let data = json!({"id": "123", "name": "Test"});
        let response = ApiResponse::success(data.clone());
        
        assert!(response.success);
        assert_eq!(response.data, Some(data));
        assert!(response.pagination.is_none());
        assert!(response.meta.is_none());
    }

    #[test]
    fn test_api_response_with_pagination() {
        let data = json!([{"id": "1"}, {"id": "2"}]);
        let pagination = Pagination::new(1, 20, 100);
        let response = ApiResponse::with_pagination(data.clone(), pagination.clone());
        
        assert!(response.success);
        assert_eq!(response.data, Some(data));
        assert_eq!(response.pagination, Some(pagination));
        assert!(response.meta.is_none());
    }

    #[test]
    fn test_api_response_with_meta() {
        let data = json!({"status": "active"});
        let meta = json!({"request_id": "req_123", "timestamp": "2024-01-01T00:00:00Z"});
        let response = ApiResponse::with_meta(data.clone(), meta.clone());
        
        assert!(response.success);
        assert_eq!(response.data, Some(data));
        assert!(response.pagination.is_none());
        assert_eq!(response.meta, Some(meta));
    }

    #[test]
    fn test_empty_response() {
        let response = EmptyResponse::success("Operation completed");
        
        assert!(response.success);
        assert_eq!(response.message, "Operation completed");
    }

    #[test]
    fn test_bulk_operation_response() {
        let errors = vec![
            BulkError {
                index: 0,
                error: "Validation failed".to_string(),
            },
            BulkError {
                index: 2,
                error: "Duplicate entry".to_string(),
            },
        ];
        
        let response = BulkOperationResponse {
            success_count: 8,
            failed_count: 2,
            errors: errors.clone(),
        };
        
        assert_eq!(response.success_count, 8);
        assert_eq!(response.failed_count, 2);
        assert_eq!(response.errors, errors);
    }

    #[test]
    fn test_bulk_error_serialization() {
        let error = BulkError {
            index: 1,
            error: "Invalid format".to_string(),
        };
        
        // Test that it can be serialized
        let json = serde_json::to_string(&error).unwrap();
        let parsed: BulkError = serde_json::from_str(&json).unwrap();
        
        assert_eq!(parsed.index, 1);
        assert_eq!(parsed.error, "Invalid format");
    }
}