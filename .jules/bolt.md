
## 2024-05-18 - Team Access & Onboarding Bypass

**Learning:** Invited team members authenticate via generated API keys. The onboarding/infrastructure setup flow (Domain Setup -> Verification -> Ready) is not necessary for invited members since they inherit the main account's setup.

**Action:** The presence of a `teamAccessRole` on the user object can be used to bypass the `isBusinessSetupReady` check in `frontend/src/api/client-core.ts`. When removing a team member via the `businessTeam` client, always remember to concurrently invoke `teamAccess.revoke(apiKey)` to ensure secure offboarding.
