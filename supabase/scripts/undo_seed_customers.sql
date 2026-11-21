-- Removes exactly the 12 customers added by seed_customers.sql, matched
-- by their exact emails so nothing else is touched.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.

DELETE FROM customers WHERE email IN (
  'marialuz.abellana12@gmail.com',
  'juancarlo.pacana45@gmail.com',
  'rosemarie.tan33@gmail.com',
  'ronnie.dagohoy88@gmail.com',
  'angelica.nacional21@gmail.com',
  'markanthony.yap77@gmail.com',
  'cristina.borja09@gmail.com',
  'jun.villareal64@gmail.com',
  'precious.gonzaga18@gmail.com',
  'dindo.macabenta52@gmail.com',
  'shielamarie.cagoco39@gmail.com',
  'noel.pelaez71@gmail.com'
);
