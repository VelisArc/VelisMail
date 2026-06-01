import LegalLayout from './LegalLayout';

export default function Cookies() {
  return (
    <LegalLayout
      slug="cookies"
      title="Cookie Policy"
      description="VelisMail uses essential first-party session tokens and local browser storage only where needed for secure authentication, product reliability, and privacy-first performance."
      contactEmail="privacy@velismail.online"
      contactLabel="If you have questions about cookies or browser storage, contact our privacy team."
    >
      <section>
        <p>
          VelisMail's enterprise email platform operates on a strict privacy-first methodology. This policy explains our minimal approach to cookies and browser storage.
        </p>
      </section>

      <section>
        <h2>1. Essential Session Cookies Only</h2>
        <p>
          VelisMail does not use third-party tracking cookies, advertising pixels, or behavioral analytics trackers on the webmail interface or business dashboard. We use essential first-party cookies only when they are required to maintain a secure Zero Trust authentication session.
        </p>
      </section>

      <section>
        <h2>2. Types of Cookies and Storage We Use</h2>
        <ul>
          <li><strong>Authentication Tokens:</strong> Secure first-party tokens used to verify your identity while navigating the dashboard.</li>
          <li><strong>Security and Anti-CSRF Tokens:</strong> Tokens used exclusively to prevent Cross-Site Request Forgery attacks against your account.</li>
          <li><strong>Local Storage Cache:</strong> Browser localStorage may temporarily cache encrypted application state for offline reading and faster rendering. Private state is cleared on logout.</li>
          <li><strong>Team Access State:</strong> Short-lived invite keys, role metadata, and OTP challenge state may be stored in first-party browser storage so delegated sessions can be validated.</li>
          <li><strong>Progressive Web App Cache:</strong> The service worker stores static application assets for installability and faster startup, but it does not cache private cross-origin mail API responses.</li>
        </ul>
      </section>

      <section>
        <h2>3. Managing Cookies</h2>
        <p>
          You can configure your browser to block all cookies. Because our cookies are tied to cryptographic session management, disabling them may prevent you from logging into the VelisMail Business Dashboard.
        </p>
      </section>
    </LegalLayout>
  );
}
