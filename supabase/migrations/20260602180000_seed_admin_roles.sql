-- Grant admin role to Garrett Blinkhorn and Jordan Reticker.
-- Sets role directly on the players row by phone number.
UPDATE players SET role = 'admin'
WHERE phone IN ('+17703552520', '+14044064765');
