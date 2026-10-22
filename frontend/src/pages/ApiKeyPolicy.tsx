import LegalLayout from './LegalLayout';
import './Legal.css';

const effectiveDate = 'October 22, 2026';
const lastUpdated = 'October 22, 2026';

const workspaceScopes = [
  ['admin.full', 'Full workspace access', 'Everything below in one key. Use only for an assistant that truly runs the whole workspace.', 'high'],
  ['team.read', 'Read the team', 'List members and pending invitations.', 'low'],
  ['team.write', 'Manage the team', 'Invite, re-role and remove members.', 'medium'],
  ['domains.read', 'Read domains', 'List domains and their DNS records.', 'low'],
  ['domains.write', 'Manage domains', 'Add a domain and trigger its verification.', 'medium'],
  ['mailboxes.read', 'Read mailboxes', 'List the mailboxes of the workspace.', 'low'],
  ['mailboxes.write', 'Manage mailboxes', 'Create and remove mailboxes.', 'medium'],
  ['mail.read', 'Read mail activity', 'Read the delivery queue and the sent mail of the workspace.', 'low'],
  ['mail.send', 'Send mail', 'Send mail on behalf of the workspace through the platform relay or a configured provider.', 'high'],
  ['audit.read', 'Read the audit trail', 'Read every audited action of the workspace.', 'low'],
  ['templates.read', 'Read templates', 'List the saved templates.', 'low'],
  ['templates.write', 'Manage templates', 'Create, edit and delete templates.', 'medium'],
  ['contacts.read', 'Read contacts', 'List contacts and contact groups.', 'low'],
  ['contacts.write', 'Manage contacts', 'Create and delete contacts.', 'medium'],
  ['signatures.read', 'Read signatures', 'List the saved signatures.', 'low'],
  ['signatures.write', 'Manage signatures', 'Create and delete signatures.', 'medium'],
];

const platformScopes = [
  ['platform.full', 'Full platform access', 'Everything below in one key. Use only for an assistant that runs the whole control plane.', 'high'],
  ['platform.read', 'Read the platform', 'Baseline read access to the control plane.', 'low'],
  ['platform.companies.read', 'Read companies', 'List and open every company (tenant).', 'low'],
  ['platform.companies.write', 'Manage companies', 'Suspend/activate, move plans, change seats, revoke keys, close cases.', 'high'],
  ['platform.users.read', 'Read users', 'List and open every user account.', 'low'],
  ['platform.users.write', 'Manage users', 'Suspend/activate, terminate sessions, change role.', 'high'],
  ['platform.support.read', 'Read support', 'Read every support ticket.', 'low'],
  ['platform.support.write', 'Manage support', 'Update ticket status, assignee and priority.', 'medium'],
  ['platform.investigations.read', 'Read investigations', 'Read every investigation and its events.', 'low'],
  ['platform.investigations.write', 'Manage investigations', 'Create and update investigations and events.', 'medium'],
  ['platform.audit.read', 'Read the audit trail', 'Read every audited action platform-wide.', 'low'],
  ['platform.team.read', 'Read the platform team', 'List admins and roles.', 'low'],
  ['platform.team.write', 'Manage the platform team', 'Add/update admins.', 'high'],
  ['platform.billing.read', 'Read billing', 'Read MRR, invoices, plan distribution.', 'low'],
  ['platform.flags.read', 'Read feature flags', 'Read every feature flag.', 'low'],
  ['platform.flags.write', 'Manage feature flags', 'Toggle flags and rollout percent.', 'medium'],
  ['platform.announcements.read', 'Read announcements', 'Read every announcement.', 'low'],
  ['platform.announcements.write', 'Manage announcements', 'Create announcements.', 'medium'],
  ['platform.broadcast', 'Broadcast', 'Send a platform-wide email broadcast.', 'high'],
  ['platform.settings.read', 'Read settings', 'Read platform settings.', 'low'],
  ['platform.settings.write', 'Manage settings', 'Update platform settings.', 'medium'],
  ['platform.keys.read', 'Read platform keys', 'List platform keys and the scope catalogue.', 'low'],
  ['platform.keys.write', 'Manage platform keys', 'Create and revoke platform keys.', 'high'],
];

const workspacePresets = [
  { id: 'reporting', name: 'Reporting', scopes: 8, summary: 'Read-only access to everything, for a dashboard or an auditor.' },
  { id: 'sending', name: 'Sending assistant', scopes: 7, summary: 'Looks up what it needs to send mail on your behalf.' },
  { id: 'mailboxes', name: 'Mailbox operations', scopes: 5, summary: 'Keeps the mailboxes and the domains in order.' },
  { id: 'workspace', name: 'Workspace manager', scopes: 13, summary: 'Runs the workspace for you, without the owner rights.' },
  { id: 'full', name: 'Full workspace access', scopes: 1, summary: 'One key that can do everything in the workspace (admin.full).' },
];

const platformPresets = [
  { id: 'monitoring', name: 'Monitoring', scopes: 12, summary: 'Read-only view of the whole platform for an assistant or dashboard.' },
  { id: 'fleet', name: 'Fleet operations', scopes: 13, summary: 'Operates companies and users across the platform.' },
  { id: 'support', name: 'Support desk', scopes: 8, summary: 'Handles support tickets and investigations.' },
  { id: 'growth', name: 'Growth and announcements', scopes: 8, summary: 'Manages announcements, flags and broadcasts.' },
  { id: 'full', name: 'Full platform access', scopes: 1, summary: 'One key with platform.full — runs the entire control plane.' },
];

export default function ApiKeyPolicy() {
  return (
    <LegalLayout
      slug="api-keys"
      title="API Key Policy & Usage Guide"
      description="Everything you need to know about VelisMail API keys: the two key systems, every scope, every preset, example keys, and a complete usage roadmap. No guessing."
      category="Developer Policy"
      effectiveDate={effectiveDate}
      lastUpdated={lastUpdated}
      contactEmail="support@velismail.online"
      contactLabel="Questions about API keys or scopes? Contact our developer support team."
    >
      <section>
        <h2>1. Overview — two key systems, one platform</h2>
        <p>
          VelisMail has <strong>two separate API key systems</strong>. They never overlap and a key of one
          system is refused on the routes of the other (fail-closed). Pick the one that matches what you are
          building.
        </p>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead><tr><th></th><th>Workspace key</th><th>Platform key</th></tr></thead>
            <tbody>
              <tr><td><strong>Prefix</strong></td><td><code>vsk_…</code></td><td><code>vsk_plat_…</code></td></tr>
              <tr><td><strong>Scope of power</strong></td><td>One company (tenant)</td><td>The whole platform</td></tr>
              <tr><td><strong>Who creates it</strong></td><td>Company owner / admin</td><td>Platform owner only</td></tr>
              <tr><td><strong>Where used</strong></td><td>Business dashboard → API Keys</td><td>Platform control plane → Management API</td></tr>
              <tr><td><strong>Typical caller</strong></td><td>Your app, your assistant, your integration</td><td>An AI/assistant that monitors or fixes accounts</td></tr>
              <tr><td><strong>Can send mail?</strong></td><td>Yes, with <code>mail.send</code></td><td>No — platform keys cannot call mail routes</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>2. Example keys (what a key actually looks like)</h2>
        <p>
          A key is shown <strong>once</strong>, at creation. Store it immediately — it cannot be retrieved again.
          Only the prefix and metadata are stored after that.
        </p>
        <h3>2.1 Workspace key example</h3>
        <pre className="legal-code">{`{
  "id": "9f2c…",
  "name": "Sending assistant - production",
  "prefix": "vsk_a1b2c3d4",
  "scopes": ["mail.read", "mail.send", "mailboxes.read", "templates.read", "contacts.read", "signatures.read", "domains.read"],
  "createdBy": "admin@company.com",
  "createdAt": "2026-10-22T10:00:00Z",
  "expiresAt": "2027-10-22T10:00:00Z",
  "lastUsedAt": "2026-10-22T10:05:00Z",
  "revokedAt": null
}`}</pre>
        <p>The secret itself looks like <code>vsk_a1b2c3d4e5f6…</code> (sent as <code>Authorization: Bearer vsk_…</code>).</p>

        <h3>2.2 Platform key example</h3>
        <pre className="legal-code">{`{
  "id": "cdf9…",
  "name": "Full platform access",
  "prefix": "vsk_plat_e038f1f4a5a",
  "scopes": ["platform.full"],
  "createdBy": "admin@velismail.online",
  "createdAt": "2026-10-22T10:00:00Z",
  "expiresAt": "2026-11-21T10:00:00Z",
  "lastUsedAt": null,
  "revokedAt": null
}`}</pre>
        <p>The secret looks like <code>vsk_plat_e038f1f4a5a24ca48eae5979e086653b…</code>.</p>
      </section>

      <section>
        <h2>3. Workspace API keys (prefix <code>vsk_</code>)</h2>
        <p>
          Bound to exactly one company. Every action is attributed to that company in the audit trail.
          A workspace key can only ever touch its own company's data.
        </p>

        <h3>3.1 Scopes (16)</h3>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead><tr><th>Scope</th><th>Label</th><th>What it unlocks</th><th>Risk</th></tr></thead>
            <tbody>
              {workspaceScopes.map(([id, label, detail, risk]) => (
                <tr key={id}><td><code>{id}</code></td><td>{label}</td><td>{detail}</td><td>{risk}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>3.2 Presets (5)</h3>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead><tr><th>Preset</th><th>Scopes</th><th>Summary</th></tr></thead>
            <tbody>
              {workspacePresets.map(p => (
                <tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.scopes}</td><td>{p.summary}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>3.3 Enforcement rules</h3>
        <ul>
          <li>A route the key does not have a scope for returns <code>403</code> with the missing scope named.</li>
          <li><code>admin.full</code> unlocks everything in the workspace.</li>
          <li>An expired or revoked key returns <code>401</code>.</li>
          <li>Every key action is written to the workspace audit trail.</li>
          <li>A key can never escape its own company — cross-tenant access is impossible.</li>
        </ul>
      </section>

      <section>
        <h2>4. Platform API keys (prefix <code>vsk_plat_</code>)</h2>
        <p>
          Run the entire control plane without a user session. Created and revoked by the platform owner only.
          These keys can read every user's feedback/reports and everything in the admin panel, and can upgrade or
          fix accounts.
        </p>

        <h3>4.1 Scopes (23)</h3>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead><tr><th>Scope</th><th>Label</th><th>What it unlocks</th><th>Risk</th></tr></thead>
            <tbody>
              {platformScopes.map(([id, label, detail, risk]) => (
                <tr key={id}><td><code>{id}</code></td><td>{label}</td><td>{detail}</td><td>{risk}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>4.2 Presets (5)</h3>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead><tr><th>Preset</th><th>Scopes</th><th>Summary</th></tr></thead>
            <tbody>
              {platformPresets.map(p => (
                <tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.scopes}</td><td>{p.summary}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>4.3 Fail-closed behaviour</h3>
        <ul>
          <li>A platform key on a route that is <strong>not part of the platform API</strong> returns <code>403</code>
            with <code>"A platform API key cannot call this endpoint."</code> — even if the route is added later,
            an old key can never reach it.</li>
          <li>A platform key on a platform route it lacks the scope for returns <code>403</code> naming the missing scope.</li>
          <li>Platform keys cannot call workspace routes (companies' own mail, mailboxes, billing, etc.).</li>
          <li>Platform keys cannot send mail — mail sending is a workspace capability.</li>
        </ul>
      </section>

      <section>
        <h2>5. Usage roadmap — from zero to a working integration</h2>
        <ol>
          <li><strong>Create the key.</strong> In the dashboard: Workspace → API Keys (or Platform → Management API for platform keys). Pick a preset, fine-tune scopes, set an expiry.</li>
          <li><strong>Copy the secret immediately.</strong> It is shown once. Store it in a secrets manager, never in source code.</li>
          <li><strong>Call the API.</strong> Send <code>Authorization: Bearer vsk_…</code> (or <code>vsk_plat_…</code>) on every request.</li>
          <li><strong>Handle 401/403.</strong> 401 = expired/revoked key. 403 = missing scope (the message names it) or off-platform route.</li>
          <li><strong>Rotate.</strong> Create a new key, switch traffic, revoke the old one. Revocation is immediate.</li>
          <li><strong>Audit.</strong> Every action is attributed to the key's creator in the audit trail; <code>lastUsedAt</code> shows real usage.</li>
        </ol>

        <h3>5.1 Workspace quickstart</h3>
        <pre className="legal-code">{`# List the queue
curl -H "Authorization: Bearer vsk_…" https://api.velismail.online/api/v1/queue

# Send mail
curl -X POST -H "Authorization: Bearer vsk_…" -H "Content-Type: application/json" \\
  -d '{"to":"user@example.com","subject":"Hi","body":"Hello"}' \\
  https://api.velismail.online/api/v1/mail/send`}</pre>

        <h3>5.2 Platform quickstart</h3>
        <pre className="legal-code">{`# Read every company
curl -H "Authorization: Bearer vsk_plat_…" https://api.velismail.online/api/v1/admin/platform/companies

# Read support tickets
curl -H "Authorization: Bearer vsk_plat_…" https://api.velismail.online/api/v1/admin/platform/support

# Suspend a company
curl -X POST -H "Authorization: Bearer vsk_plat_…" -H "Content-Type: application/json" \\
  -d '{"action":"suspend","reason":"abuse"}' \\
  https://api.velismail.online/api/v1/admin/platform/companies/{id}/actions`}</pre>
      </section>

      <section>
        <h2>6. Security rules (must follow)</h2>
        <ul>
          <li><strong>Never commit a key</strong> to source control or share it in chat/email.</li>
          <li><strong>Least privilege:</strong> pick the narrowest preset/scope set that works. Prefer <code>reporting</code> over <code>full</code>.</li>
          <li><strong>Set an expiry.</strong> Rotate keys on a schedule (recommended: 90 days).</li>
          <li><strong>One key per integration</strong> so revocation does not break unrelated callers.</li>
          <li><strong>Revoke immediately</strong> if a key leaks — revocation takes effect on the next request.</li>
          <li><strong>Platform keys are owner-only</strong> — only the configured platform owner can create or revoke them.</li>
        </ul>
      </section>

      <section>
        <h2>7. Other feature policies (upgraded)</h2>
        <ul>
          <li><strong>Plans &amp; quotas:</strong> allowances are enforced server-side per tenant. "Not capped" means the platform does not cap that dimension (not an unlimited promise). Enterprise/Premium plans are negotiated — no published allowance, contact sales.</li>
          <li><strong>Enterprise plan:</strong> never purchasable directly. Obtained only by request. Shows as "Custom / Contact Sales".</li>
          <li><strong>Broadcasts:</strong> platform broadcasts require a verified sender mailbox on a verified domain. Audience is filtered; recipient count is capped by the request.</li>
          <li><strong>Storage:</strong> per-plan allowance (e.g. 500 MB on the standard plan). Premium/Enterprise storage is negotiated.</li>
          <li><strong>Rate limits:</strong> per-tenant requests per minute (e.g. 30 req/min) are enforced by the gateway.</li>
          <li><strong>Privacy &amp; data:</strong> see the Privacy Policy. Workspace data is isolated per tenant; API keys are scoped to one tenant.</li>
        </ul>
      </section>

      <section>
        <h2>9. Admin roles and API key management</h2>
        <p>
          Only the <strong>platform owner</strong> can create or revoke platform keys. The platform team page
          exposes roles with an <code>ownerOnly</code> flag — roles marked owner-only can only be handed out by
          the owner. Every key action is attributed to its creator in the audit trail.
        </p>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead><tr><th>Role</th><th>Can create workspace keys</th><th>Can create platform keys</th><th>Can revoke keys</th></tr></thead>
            <tbody>
              <tr><td>Platform owner</td><td>Yes</td><td>Yes</td><td>Yes (any key)</td></tr>
              <tr><td>Platform admin (with keys.write)</td><td>Yes (own company)</td><td>No</td><td>Workspace keys only</td></tr>
              <tr><td>Company owner / admin</td><td>Yes</td><td>No</td><td>Own company keys</td></tr>
              <tr><td>Member / viewer</td><td>No</td><td>No</td><td>No</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted">
          A key is always scoped to its creator's tenant. A platform key additionally requires
          <code>platform.keys.write</code> and is owner-gated on the server.
        </p>
      </section>
        <section>
          <ol>
          <li><code>401</code> → key expired or revoked. Create a new key.</li>
          <li><code>403 "missing the X scope"</code> → recreate the key with that scope, or switch to a broader preset.</li>
          <li><code>403 "A platform API key cannot call this endpoint."</code> → you are using a platform key on a workspace route. Use a workspace key instead.</li>
          <li><code>403 "This platform API key is missing the … scope."</code> → add the scope or use <code>platform.full</code>.</li>
          <li><code>429</code> → rate limited; back off and retry.</li>
        </ol>
      </section>
    </LegalLayout>
  );
}
