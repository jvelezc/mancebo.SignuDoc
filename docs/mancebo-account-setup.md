# Connect a signing installation to a Mancebo workspace

Use a dedicated installation and database for each workspace. Set up the
Mancebo Document Signing brand, transactional mail and private object storage
before connecting customer sign-in. Run the database migrations before starting
the updated application. In production, each installation needs its own
HTTPS origin, auth secret and private R2 bucket or scoped storage credentials.

1. Complete first-run setup with a separate operator recovery address and set
   the display name to **Mancebo Document Signing**. Keep local registration
   closed. Confirm the support address and verify mail delivery.
2. Set `APP_URL` and `BETTER_AUTH_URL` to the exact tenant hostname. Set
   `MANCEBO_SIGNING_TENANT_ID` to the workspace UUID shared with its R2 configuration and
   `MANCEBO_SIGNING_BRIDGE_SECRET` to a fresh 32-byte base64url secret
   (43 characters without padding). Give the same value to the Mancebo Edge
   Function for that one workspace through its secret configuration.
3. From [Mancebo document signing](https://mancebo.ai/documents), choose the
   connected workspace. **Request a signature** opens the PDF upload, and
   **Open documents** opens the sender dashboard. Recipients use the invitation
   sent to their own address.
4. For a trusted operator, assign an administrator role explicitly to their
   existing `mancebo-<account-id>` user after verifying both the Mancebo
   membership and local account. Keep sender accounts at the default user
   role. A matching email on a preexisting local account needs an operator
   migration before sign-in can succeed.

The browser posts a one-time 60-second ticket and receives an HttpOnly session
for the signing host. Existing sessions expire after 30 minutes. Workspace
membership removal prevents new tickets. To expire an existing signing session
before this time, revoke it from the signing installation. Changing the
installation's workspace UUID does not reassign its database. The database binds
to the first workspace configured at issuance.

When troubleshooting, check `mancebo_signing_install_not_ready`,
`mancebo_signing_ticket_issue_failed`, and `mancebo_signing_session_failed` in
application logs. Log event names and HTTP statuses. Leave ticket bodies, emails,
bridge headers and PDF data out of access and error logs. To remove the connection,
remove its mapping from the Edge Function. Restore standalone authentication
only in a restricted operator recovery window.
