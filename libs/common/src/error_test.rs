//! Tests for error handling

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;
    use serde_json::json;

    #[test]
    fn test_error_response_creation() {
        let error = ErrorResponse::new("TEST_ERROR", "Test error message");
        assert!(!error.success);
        assert_eq!(error.error.code, "TEST_ERROR");
        assert_eq!(error.error.message, "Test error message");
        assert!(error.error.details.is_none());
    }

    #[test]
    fn test_error_response_with_details() {
        let details = json!({"field": "email", "issue": "invalid format"});
        let error = ErrorResponse::with_details(
            "VALIDATION_ERROR",
            "Validation failed",
            details.clone(),
        );
        
        assert!(!error.success);
        assert_eq!(error.error.code, "VALIDATION_ERROR");
        assert_eq!(error.error.message, "Validation failed");
        assert_eq!(error.error.details, Some(details));
    }

    #[test]
    fn test_app_error_into_response() {
        let error = AppError::NotFound("Resource not found".to_string());
        let response = error.into_response();
        
        // Check status code
        let status = response.status();
        assert_eq!(status, axum::http::StatusCode::NOT_FOUND);
        
        // Check response body can be extracted
        // In real test, would extract and parse JSON
    }

    #[test]
    fn test_auth_error_display() {
        let error = AuthError::InvalidCredentials;
        assert_eq!(error.to_string(), "Invalid credentials");
        
        let error = AuthError::TokenExpired;
        assert_eq!(error.to_string(), "Token expired");
        
        let error = AuthError::AccountLocked;
        assert_eq!(error.to_string(), "Account locked");
    }

    #[test]
    fn test_validation_error_display() {
        let error = ValidationError {
            field: "email".to_string(),
            message: "must be a valid email address".to_string(),
        };
        
        assert_eq!(
            error.to_string(),
            "Validation error on 'email': must be a valid email address"
        );
    }
}