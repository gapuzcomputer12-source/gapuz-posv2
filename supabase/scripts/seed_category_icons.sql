-- Pins an explicit icon to each default seeded category, matching what the
-- keyword-based auto-guess already picks for them — so they stay fixed even
-- if the keyword rules in src/utils/helpers.js ever change. Run this AFTER
-- add_category_icon.sql, in Supabase Dashboard -> SQL Editor -> New query -> Run.

UPDATE categories SET icon = 'Cpu'          WHERE name = 'Processors';
UPDATE categories SET icon = 'MemoryStick'  WHERE name = 'RAM';
UPDATE categories SET icon = 'CircuitBoard' WHERE name = 'GPU';
UPDATE categories SET icon = 'HardDrive'    WHERE name = 'Storage';
UPDATE categories SET icon = 'Laptop'       WHERE name = 'Laptops';
UPDATE categories SET icon = 'Mouse'        WHERE name = 'Peripherals';
UPDATE categories SET icon = 'Cable'        WHERE name = 'Accessories';
UPDATE categories SET icon = 'Wrench'       WHERE name = 'Services';

-- If you've added custom categories since setup, add a matching line here.
-- Valid icon keys: Cpu, CircuitBoard, MemoryStick, HardDrive, Laptop, Monitor,
-- Keyboard, Mouse, Headphones, Webcam, Printer, Router, Usb, Cable, Fan,
-- BatteryCharging, Gamepad2, Smartphone, Tablet, Wrench, Package
-- Example:
-- UPDATE categories SET icon = 'Monitor' WHERE name = 'Monitors';
