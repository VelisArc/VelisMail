# Tenant Service

The Tenant Service provides multi-tenant isolation and management for the VelisMail API Platform. It implements tenant creation, configuration, resource allocation, and custom domain management with PostgreSQL Row-Level Security (RLS) for data isolation.

## Features

### 1. Tenant Creation and Configuration
- **Tenant Creation**: Create isolated tenant instances for organizations
- **Plan Tiers**: Support for free, starter, business, and enterprise plans
- **Configuration Management**: Tenant-specific settings and limits
- **Status Tracking**: Active, suspended, pending verification, deleted

### 2. Row-Level Security (RLS) Patterns
- **PostgreSQL RLS**: Data isolation at database level
- **Tenant Context**: Automatic tenant ID injection for queries
- **Policy Enforcement**: RLS policies on all tenant-related tables
- **Admin Access**: Separate admin role for system administration

### 3. Tenant-Specific Resource Allocation
- **Resource Limits**: Configurable limits per tenant (users, storage, emails, API requests)
- **Usage Tracking**: Daily resource usage monitoring
- **Limit Enforcement**: Automatic checking and warnings
- **Statistics**: Real-time tenant statistics and metrics

### 4. Custom Domain Management
- **Domain Verification**: DNS-based domain ownership verification
- **DNS Record Generation**: Automatic TXT, MX, SPF, DKIM, DMARC records
- **Status Tracking**: Verification status and expiration tracking
- **Email Routing**: Domain-based email routing configuration

### 5. Audit and Compliance
- **Audit Logging**: Comprehensive audit trail for all tenant operations
- **Security Events**: Logging of security-relevant events
- **Compliance**: Support for regulatory compliance requirements
- **Traceability**: Full traceability of all tenant changes

## Database Schema

### Core Tables
1. **tenants**: Tenant information and configuration
2. **tenant_users**: Tenant-user associations and roles
3. **custom_domains**: Custom domain management
4. **resource_usage**: Daily resource usage tracking
5. **audit_logs**: Audit trail for compliance

### Row-Level Security Policies
All tables have RLS policies that enforce:
- Users can only access data for their tenant
- System admins can access all data
- Tenant context is automatically set for each request

## API Endpoints

### Tenant Management
- `POST /tenants`: Create new tenant
- `GET /tenants/:id`: Get tenant details
- `PUT /tenants/:id`: Update tenant configuration
- `GET /tenants/:id/stats`: Get tenant statistics
- `GET /tenants/:id/limits`: Check resource limits

### Domain Management
- `GET /tenants/:id/domains`: List custom domains
- `POST /tenants/:id/domains`: Add custom domain
- `POST /tenants/:id/domains/:domain/verify`: Verify domain ownership

### Settings and Billing
- `GET /tenants/:id/settings`: Get tenant settings
- `PUT /tenants/:id/settings`: Update tenant settings
- `GET /tenants/:id/billing`: Get billing information

### Audit and Monitoring
- `GET /tenants/:id/audit-logs`: Get audit logs
- `GET /health`: Service health check

## Implementation Details

### Isolation Mechanisms
1. **Database-Level Isolation**: PostgreSQL RLS ensures data isolation
2. **Tenant Context**: Each request sets tenant context for RLS
3. **Resource Quotas**: Enforced limits prevent resource exhaustion
4. **Audit Trail**: All operations logged for security and compliance

### Security Features
1. **Zero-Trust Principles**: Verify every request
2. **Role-Based Access**: Different roles for users, admins, system
3. **Audit Logging**: Comprehensive security event logging
4. **Input Validation**: All inputs validated and sanitized

### Performance Considerations
1. **Connection Pooling**: Efficient database connection management
2. **Index Optimization**: Proper indexes for performance
3. **Caching Strategy**: Redis caching for frequently accessed data
4. **Query Optimization**: Optimized queries for tenant isolation

## Testing

### Unit Tests
- Tenant creation and validation
- Resource limit enforcement
- Domain verification logic
- Audit logging functionality

### Property-Based Tests
- Tenant data isolation properties
- Resource tracking accuracy
- Configuration round-trip properties
- Domain validation rules

### Integration Tests
- End-to-end tenant workflows
- Cross-tenant isolation verification
- Resource limit enforcement scenarios
- Audit trail completeness

## Deployment

### Prerequisites
- PostgreSQL 14+ with RLS support
- Redis for caching and session management
- Rust toolchain for compilation

### Configuration
Environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `TENANT_HOST`: Service host (default: 0.0.0.0)
- `TENANT_PORT`: Service port (default: 3004)

### Migration
Run database migrations:
```bash
sqlx migrate run --database-url $DATABASE_URL
```

## Compliance with Requirements

### Requirement 1: Multi-Tenant Platform Architecture
- ✅ Supports multiple isolated tenant instances
- ✅ Creates new tenant instance on organization registration
- ✅ Enforces tenant isolation during request processing
- ✅ Applies tenant-specific configuration only to that tenant
- ✅ Notifies administrators and applies throttling on limit exceedance

### Implementation Status
- **Task 2.1**: ✅ Complete
  - Tenant creation and configuration implemented
  - PostgreSQL RLS patterns implemented
  - Tenant-specific resource allocation implemented
  - Unit tests created
  - Security patterns implemented

## Next Steps

1. **Property Tests**: Implement property-based tests for isolation properties
2. **Integration Tests**: Add integration tests for cross-tenant isolation
3. **Monitoring**: Add comprehensive monitoring and alerting
4. **Documentation**: Expand API documentation with examples
5. **Performance Testing**: Load testing with multiple tenants