//! Tenant service business logic

use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use serde_json::json;
use sqlx::{PgPool, QueryBuilder, Row};
use tracing::info;
use uuid::Uuid;

use crate::models::*;

/// Tenant service for managing tenant isolation and configuration
pub struct TenantService {
    pool: PgPool,
}

impl TenantService {
    /// Create a new tenant service
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    fn current_period_start() -> chrono::NaiveDateTime {
        Utc::now().date_naive().and_time(chrono::NaiveTime::MIN)
    }

    /// Create a new tenant with isolation mechanisms
    pub async fn create_tenant(&self, request: CreateTenantRequest) -> Result<Tenant> {
        info!(
            "Creating new tenant for organization: {}",
            request.organization_name
        );

        let tenant_id = Uuid::new_v4();
        let now = Utc::now();

        // Default settings if not provided
        let settings = request.initial_settings.unwrap_or_else(|| {
            json!({
                "enable_e2ee": true,
                "require_mfa": false,
                "audit_log_enabled": true,
                "session_timeout_minutes": 60
            })
        });

        // Default limits based on plan tier
        let plan_tier = request.plan_tier.unwrap_or_else(|| "starter".to_string());
        let limits = match plan_tier.as_str() {
            "free" => json!({
                "max_users": 3,
                "max_storage_mb": 500,
                "max_emails_per_day": 100,
                "monthly_email_limit": 3000,
                "max_attachment_size_mb": 5,
                "api_rate_limit_per_minute": 30,
                "max_domains": 1,
                "max_templates": 3,
                "audit_retention_days": 7
            }),
            "starter" => json!({
                "max_users": 15,
                "max_storage_mb": 10240,
                "max_emails_per_day": 150000,
                "monthly_email_limit": 150000,
                "max_attachment_size_mb": 25,
                "api_rate_limit_per_minute": 120,
                "max_domains": 3,
                "max_templates": 25,
                "audit_retention_days": 30
            }),
            "business" => json!({
                "max_users": 75,
                "max_storage_mb": 51200,
                "max_emails_per_day": 750000,
                "monthly_email_limit": 750000,
                "max_attachment_size_mb": 50,
                "api_rate_limit_per_minute": 500,
                "max_domains": 10,
                "max_templates": 9999,
                "audit_retention_days": 90
            }),
            "enterprise" => json!({
                "max_users": 9999,
                "max_storage_mb": 512000,
                "max_emails_per_day": 3000000,
                "monthly_email_limit": 3000000,
                "max_attachment_size_mb": 100,
                "api_rate_limit_per_minute": 2000,
                "max_domains": 9999,
                "max_templates": 9999,
                "audit_retention_days": 365
            }),
            _ => json!({
                "max_users": 3,
                "max_storage_mb": 500,
                "max_emails_per_day": 100,
                "monthly_email_limit": 3000,
                "max_attachment_size_mb": 5,
                "api_rate_limit_per_minute": 30,
                "max_domains": 1,
                "max_templates": 3,
                "audit_retention_days": 7
            }),
        };

        // Default billing info
        let billing_info = json!({
            "plan": plan_tier,
            "billing_cycle": "monthly",
            "next_billing_date": now + Duration::days(30)
        });

        // Insert tenant with RLS context
        let tenant = sqlx::query_as::<_, Tenant>(
            r#"
            INSERT INTO tenants (
                id, organization_name, organization_email, plan_tier, status,
                settings, limits, billing_info, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, 'pending_verification', $5, $6, $7, $8, $8)
            RETURNING *
            "#,
        )
        .bind(tenant_id)
        .bind(&request.organization_name)
        .bind(&request.organization_email)
        .bind(&plan_tier)
        .bind(&settings)
        .bind(&limits)
        .bind(&billing_info)
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .context("Failed to create tenant")?;

        // Create initial resource usage record
        sqlx::query(
            r#"
            INSERT INTO resource_usage (
                tenant_id, period_start, period_end,
                emails_sent, emails_received, storage_used_bytes,
                api_requests, active_users
            )
            VALUES ($1, $2, $3, 0, 0, 0, 0, 0)
            "#,
        )
        .bind(tenant_id)
        .bind(now)
        .bind(now + Duration::days(1))
        .execute(&self.pool)
        .await
        .context("Failed to create initial resource usage record")?;

        // Log the creation
        self.log_audit(
            tenant_id,
            None, // No user ID for system creation
            "tenant_created",
            "tenant",
            Some(tenant_id),
            json!({
                "organization_name": request.organization_name,
                "plan_tier": plan_tier
            }),
            None,
            None,
        )
        .await?;

        info!("Tenant created successfully: {}", tenant_id);
        Ok(tenant)
    }

    /// Get tenant by ID with isolation enforcement
    pub async fn get_tenant(&self, tenant_id: Uuid) -> Result<Option<Tenant>> {
        // Set tenant context for RLS
        sqlx::query("SELECT set_tenant_context($1)")
            .bind(tenant_id)
            .execute(&self.pool)
            .await
            .context("Failed to set tenant context")?;

        let tenant = sqlx::query_as::<_, Tenant>(
            "SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(tenant_id)
        .fetch_optional(&self.pool)
        .await
        .context("Failed to fetch tenant")?;

        Ok(tenant)
    }

    /// Update tenant configuration
    pub async fn update_tenant(
        &self,
        tenant_id: Uuid,
        request: UpdateTenantRequest,
    ) -> Result<Tenant> {
        // Set tenant context for RLS
        sqlx::query("SELECT set_tenant_context($1)")
            .bind(tenant_id)
            .execute(&self.pool)
            .await
            .context("Failed to set tenant context")?;

        // Build dynamic update query using QueryBuilder to allow dynamic binds
        let mut qb = QueryBuilder::<sqlx::Postgres>::new("UPDATE tenants SET ");
        let mut separated = qb.separated(", ");
        let mut updated_fields: usize = 0;

        if let Some(name) = &request.organization_name {
            separated.push("organization_name = ").push_bind(name);
            updated_fields += 1;
        }

        if let Some(email) = &request.organization_email {
            separated.push("organization_email = ").push_bind(email);
            updated_fields += 1;
        }

        if let Some(plan) = &request.plan_tier {
            separated.push("plan_tier = ").push_bind(plan);
            updated_fields += 1;
        }

        if let Some(status) = &request.status {
            separated.push("status = ").push_bind(status);
            updated_fields += 1;
        }

        if let Some(settings) = &request.settings {
            separated.push("settings = ").push_bind(settings);
            updated_fields += 1;
        }

        if let Some(limits) = &request.limits {
            separated.push("limits = ").push_bind(limits);
            updated_fields += 1;
        }

        if updated_fields == 0 {
            return self
                .get_tenant(tenant_id)
                .await?
                .context("Tenant not found");
        }

        // Always update timestamp
        separated.push("updated_at = NOW()");

        qb.push(" WHERE id = ").push_bind(tenant_id);
        qb.push(" AND deleted_at IS NULL RETURNING *");

        let tenant = qb
            .build_query_as::<Tenant>()
            .fetch_one(&self.pool)
            .await
            .context("Failed to update tenant")?;

        // Log the update
        self.log_audit(
            tenant_id,
            None, // User ID would come from auth context
            "tenant_updated",
            "tenant",
            Some(tenant_id),
            json!({
                "updated_fields": updated_fields,
                "new_status": request.status
            }),
            None,
            None,
        )
        .await?;

        Ok(tenant)
    }

    /// Add custom domain to tenant
    pub async fn add_domain(
        &self,
        tenant_id: Uuid,
        request: AddDomainRequest,
    ) -> Result<CustomDomain> {
        // Set tenant context for RLS
        sqlx::query("SELECT set_tenant_context($1)")
            .bind(tenant_id)
            .execute(&self.pool)
            .await
            .context("Failed to set tenant context")?;

        // Validate domain format according to RFC standards
        if !Self::validate_domain_format(&request.domain_name) {
            return Err(anyhow::anyhow!(
                "Invalid domain format: '{}'. Domain must follow RFC 1035/1123 standards.",
                request.domain_name
            ));
        }

        let domain_id = Uuid::new_v4();
        let now = Utc::now();

        // Generate verification token
        let verification_token = Uuid::new_v4().to_string();

        // Create DNS records for verification
        let base_domain = std::env::var("BASE_DOMAIN").unwrap_or_else(|_| "velismail.online".to_string());
        let dns_records = json!([
            {
                "type": "TXT",
                "name": "_velismail-verification",
                "value": verification_token,
                "ttl": 300
            },
            {
                "type": "MX",
                "name": "@",
                "value": format!("mx.{}", base_domain),
                "priority": 10,
                "ttl": 3600
            }
        ]);

        let domain = sqlx::query_as::<_, CustomDomain>(
            r#"
            INSERT INTO custom_domains (
                id, tenant_id, domain_name, verification_status,
                verification_method, dns_records, created_at
            )
            VALUES ($1, $2, $3, 'pending', $4, $5, $6)
            RETURNING *
            "#,
        )
        .bind(domain_id)
        .bind(tenant_id)
        .bind(&request.domain_name)
        .bind(request.verification_method.as_deref())
        .bind(&dns_records)
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .context("Failed to add custom domain")?;

        // Log the domain addition
        self.log_audit(
            tenant_id,
            None,
            "domain_added",
            "domain",
            Some(domain_id),
            json!({
                "domain_name": request.domain_name,
                "verification_method": request.verification_method
            }),
            None,
            None,
        )
        .await?;

        Ok(domain)
    }

    /// Track resource usage for tenant
    pub async fn track_resource_usage(
        &self,
        tenant_id: Uuid,
        resource_type: &str,
        amount: i64,
    ) -> Result<()> {
        let period_start = Self::current_period_start();
        let period_end = period_start + Duration::days(1);

        // Set tenant context for RLS
        sqlx::query("SELECT set_tenant_context($1)")
            .bind(tenant_id)
            .execute(&self.pool)
            .await
            .context("Failed to set tenant context")?;

        // Update resource usage with conflict handling
        let update_field = match resource_type {
            "emails_sent" => "emails_sent = resource_usage.emails_sent + $3",
            "emails_received" => "emails_received = resource_usage.emails_received + $3",
            "storage_used_bytes" => "storage_used_bytes = resource_usage.storage_used_bytes + $3",
            "api_requests" => "api_requests = resource_usage.api_requests + $3",
            "active_users" => "active_users = $3", // Set, not increment
            _ => return Err(anyhow::anyhow!("Invalid resource type: {}", resource_type)),
        };

        sqlx::query(&format!(
            r#"
            INSERT INTO resource_usage (
                tenant_id, period_start, period_end,
                emails_sent, emails_received, storage_used_bytes,
                api_requests, active_users
            )
            VALUES ($1, $2, $3, 0, 0, 0, 0, 0)
            ON CONFLICT (tenant_id, period_start) DO UPDATE
            SET {} 
            WHERE resource_usage.tenant_id = $1 AND resource_usage.period_start = $2
            "#,
            update_field
        ))
        .bind(tenant_id)
        .bind(period_start)
        .bind(period_end)
        .bind(amount)
        .execute(&self.pool)
        .await
        .context("Failed to track resource usage")?;

        Ok(())
    }

    /// Check if tenant has exceeded resource limits
    pub async fn check_resource_limits(&self, tenant_id: Uuid) -> Result<Option<String>> {
        // Set tenant context for RLS
        sqlx::query("SELECT set_tenant_context($1)")
            .bind(tenant_id)
            .execute(&self.pool)
            .await
            .context("Failed to set tenant context")?;

        // Get tenant limits
        let tenant = self
            .get_tenant(tenant_id)
            .await?
            .context("Tenant not found")?;

        let limits: ResourceLimits =
            serde_json::from_value(tenant.limits).context("Failed to parse tenant limits")?;

        // Get current usage for today
        let period_start = Self::current_period_start();

        let usage = sqlx::query_as::<_, ResourceUsage>(
            "SELECT * FROM resource_usage WHERE tenant_id = $1 AND period_start = $2",
        )
        .bind(tenant_id)
        .bind(period_start)
        .fetch_optional(&self.pool)
        .await
        .context("Failed to fetch resource usage")?;

        if let Some(usage) = usage {
            // Check each limit
            if limits.max_emails_per_day > 0 && usage.emails_sent as u32 > limits.max_emails_per_day
            {
                return Ok(Some(format!(
                    "Email limit exceeded: {}/{} emails sent today",
                    usage.emails_sent, limits.max_emails_per_day
                )));
            }

            if limits.max_storage_mb > 0 {
                let storage_used_mb = usage.storage_used_bytes as f64 / (1024.0 * 1024.0);
                if storage_used_mb > limits.max_storage_mb as f64 {
                    return Ok(Some(format!(
                        "Storage limit exceeded: {:.2}/{} MB used",
                        storage_used_mb, limits.max_storage_mb
                    )));
                }
            }
        }

        Ok(None)
    }

    /// Get tenant statistics
    pub async fn get_tenant_stats(&self, tenant_id: Uuid) -> Result<TenantStats> {
        // Set tenant context for RLS
        sqlx::query("SELECT set_tenant_context($1)")
            .bind(tenant_id)
            .execute(&self.pool)
            .await
            .context("Failed to set tenant context")?;

        let period_start = Self::current_period_start();

        // Get resource usage for today
        let usage = sqlx::query_as::<_, ResourceUsage>(
            "SELECT * FROM resource_usage WHERE tenant_id = $1 AND period_start = $2",
        )
        .bind(tenant_id)
        .bind(period_start)
        .fetch_optional(&self.pool)
        .await
        .context("Failed to fetch resource usage")?;

        // Get domain counts
        let domain_counts = sqlx::query(
            r#"
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN verification_status = 'verified' THEN 1 END) as verified
            FROM custom_domains 
            WHERE tenant_id = $1
            "#,
        )
        .bind(tenant_id)
        .fetch_one(&self.pool)
        .await
        .context("Failed to fetch domain counts")?;

        // Get user counts (this would need user service integration)
        // Get user counts safely with fallbacks
        let total_users = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
            .fetch_one(&self.pool)
            .await
            .unwrap_or(0) as u32;
        let active_users = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE is_active = true")
            .fetch_one(&self.pool)
            .await
            .unwrap_or(0) as u32;

        let stats = TenantStats {
            total_users,
            active_users,
            storage_used_gb: usage
                .as_ref()
                .map(|u| u.storage_used_bytes as f64 / (1024.0 * 1024.0 * 1024.0))
                .unwrap_or(0.0),
            emails_sent_today: usage.as_ref().map(|u| u.emails_sent as u32).unwrap_or(0),
            emails_received_today: usage
                .as_ref()
                .map(|u| u.emails_received as u32)
                .unwrap_or(0),
            api_requests_today: usage.as_ref().map(|u| u.api_requests as u32).unwrap_or(0),
            domains_count: domain_counts.get::<i64, _>("total") as u32,
            verified_domains_count: domain_counts.get::<i64, _>("verified") as u32,
        };

        Ok(stats)
    }

    /// Log audit event
    #[allow(clippy::too_many_arguments)]
    pub async fn log_audit(
        &self,
        tenant_id: Uuid,
        user_id: Option<Uuid>,
        action: &str,
        resource_type: &str,
        resource_id: Option<Uuid>,
        details: serde_json::Value,
        ip_address: Option<String>,
        user_agent: Option<String>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO audit_logs (
                tenant_id, user_id, action, resource_type,
                resource_id, details, ip_address, user_agent
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
        )
        .bind(tenant_id)
        .bind(user_id)
        .bind(action)
        .bind(resource_type)
        .bind(resource_id)
        .bind(&details)
        .bind(ip_address)
        .bind(user_agent)
        .execute(&self.pool)
        .await
        .context("Failed to log audit event")?;

        Ok(())
    }

    /// Set tenant context for RLS in current transaction
    pub async fn set_tenant_context(&self, tenant_id: Uuid) -> Result<()> {
        sqlx::query("SELECT set_tenant_context($1)")
            .bind(tenant_id)
            .execute(&self.pool)
            .await
            .context("Failed to set tenant context")?;
        Ok(())
    }

    /// Check if current context has admin privileges
    pub async fn is_admin_context(&self) -> Result<bool> {
        let result = sqlx::query_scalar("SELECT is_admin()")
            .fetch_one(&self.pool)
            .await
            .context("Failed to check admin context")?;
        Ok(result)
    }

    /// Validate domain format according to RFC standards
    ///
    /// This function validates domain names according to RFC 1035 and RFC 1123:
    /// - Labels (parts separated by dots) must be 1-63 characters
    /// - Total length must be 1-253 characters
    /// - Labels can contain letters, digits, and hyphens
    /// - Labels cannot start or end with hyphens
    /// - Top-level domain must be at least 2 characters
    /// - Domain must contain at least one dot
    ///
    /// **Validates: Requirements 4.1**
    /// **Property 5: Domain Validation Rules**
    pub fn validate_domain_format(domain: &str) -> bool {
        // Check total length (1-253 characters)
        if domain.is_empty() || domain.len() > 253 {
            return false;
        }

        // Domain must contain at least one dot
        if !domain.contains('.') {
            return false;
        }

        // Split into labels
        let labels: Vec<&str> = domain.split('.').collect();

        // Must have at least 2 labels (domain and TLD)
        if labels.len() < 2 {
            return false;
        }

        // Check each label
        for (i, label) in labels.iter().enumerate() {
            // Label length must be 1-63 characters
            if label.is_empty() || label.len() > 63 {
                return false;
            }

            // Check label characters
            for c in label.chars() {
                if !c.is_ascii_alphanumeric() && c != '-' {
                    return false;
                }
            }

            // Label cannot start or end with hyphen
            if label.starts_with('-') || label.ends_with('-') {
                return false;
            }

            // Last label (TLD) must be at least 2 characters
            if i == labels.len() - 1 && label.len() < 2 {
                return false;
            }
        }

        // Domain cannot start or end with dot
        if domain.starts_with('.') || domain.ends_with('.') {
            return false;
        }

        // Domain cannot have consecutive dots
        if domain.contains("..") {
            return false;
        }

        true
    }
}
