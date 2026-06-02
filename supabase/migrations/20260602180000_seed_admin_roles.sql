-- Grant admin role to Garrett Blinkhorn and Jordan Reticker.
-- Uses a SELECT so rows are skipped for any user who hasn't signed in yet
-- (no auth.users row = no insert, no FK violation).
INSERT INTO user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE phone IN ('17703552520', '14044064765')
ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
