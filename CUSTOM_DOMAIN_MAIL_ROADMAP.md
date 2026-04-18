# Custom Domain Mail Roadmap

## Goal

VelisMail me business users ko apne khud ke domain, jaise `example.com`, se mail send/receive karne ka complete workflow dena:

- domain add karna
- DNS records generate karna
- ownership verify karna
- sending domain activate karna
- dashboard/settings se status monitor karna

## Current Scope

Is session me yeh parts implement hue:

- frontend local data layer me reusable custom-domain model
- generated DNS records for `TXT`, `MX`, `SPF`, `DKIM`, `DMARC`
- business setup flow me persisted domain creation and verification
- settings page me domain management, verification, activation, removal
- business dashboard me live domain health status

## Delivery Phases

### Phase 1: Domain Onboarding

- business setup me infrastructure details collect karna
- custom domain normalize aur persist karna
- verification token generate karna
- registrar ke liye DNS record list dikhana

### Phase 2: Verification Workflow

- TXT ownership check
- MX readiness check
- SPF policy validation
- DKIM selector readiness
- DMARC policy validation
- verification result ko domain profile me persist karna

### Phase 3: Mail Activation

- verified domain ko active business domain mark karna
- compose/dashboard me `admin@domain` sending identity use karna
- per-domain health badges dikhana

### Phase 4: Backend Hardening

- `tenant-service` me domain verification ko real DNS lookup se wire karna
- `delivery-engine` me per-domain DKIM selector/key management
- `mail-service` me inbound routing rules by verified tenant domain
- bounce/reputation handling by tenant domain

### Phase 5: Production Readiness

- certificate provisioning
- rate limits by domain
- audit logs for domain changes
- retryable verification jobs
- monitoring and alerting for SPF/DKIM/DMARC regressions

## Suggested Backend Tasks

1. `tenant-service` me `verify_domain` ko DB update-only se nikal kar real DNS resolution ke saath implement karo.
2. domain table me selector, token, verification attempts aur `last_checked_at` fields add karo.
3. `delivery-engine` me tenant/domain specific DKIM signing config support karo.
4. `mail-service` me verified domain ke against outbound sender validation lagao.
5. admin UI/API me domain failure reasons expose karo.

## Acceptance Checklist

- domain add hone par DNS records consistently generate hon
- verification ke baad status `verified` ho
- active domain settings aur dashboard dono me reflect ho
- unverified domain ko active send path me clearly mark kiya jaye
- remove/switch domain flow safe ho
