-- Adds 30 more sample products across all existing categories.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- No "image" is set here (left NULL) — products fall back to their category icon
-- until you upload a real photo per product in the app.

INSERT INTO products (name, category, price, cost_price, stock, barcode, icon, sold) VALUES
('AMD Ryzen 9 5900X',          'Processors',  18000, 14000, 6,  'CPU-004', '💻', 9),
('Intel Core i7-12700K',       'Processors',  19500, 15200, 5,  'CPU-005', '💻', 7),
('Intel Core i3-12100',        'Processors',  6500,  4800,  15, 'CPU-006', '💻', 20),
('Kingston 16GB DDR4 3200MHz', 'RAM',         3200,  2400,  18, 'RAM-003', '🧩', 25),
('Corsair 32GB DDR4 3600MHz',  'RAM',         6200,  4800,  10, 'RAM-004', '🧩', 14),
('TeamGroup 8GB DDR3 1600MHz', 'RAM',         1200,  850,   12, 'RAM-005', '🧩', 10),
('NVIDIA RTX 4060 8GB',        'GPU',         25000, 19500, 5,  'GPU-003', '🎮', 6),
('NVIDIA RTX 3050 8GB',        'GPU',         13500, 10200, 7,  'GPU-004', '🎮', 9),
('AMD RX 6500 XT 4GB',         'GPU',         9500,  7200,  8,  'GPU-005', '🎮', 13),
('Samsung 1TB NVMe SSD',       'Storage',     4500,  3400,  14, 'SSD-002', '💾', 20),
('Kingston 240GB SSD',         'Storage',     1600,  1150,  25, 'SSD-003', '💾', 33),
('Seagate 2TB HDD',            'Storage',     3200,  2500,  10, 'HDD-002', '💾', 15),
('SanDisk 128GB microSD',      'Storage',     650,   420,   40, 'STG-001', '💾', 50),
('Laptop Lenovo IdeaPad 3',    'Laptops',     26000, 20500, 4,  'LAP-003', '💻', 6),
('Laptop HP Pavilion 14',      'Laptops',     32000, 25500, 3,  'LAP-004', '💻', 4),
('Laptop Dell Inspiron 15',    'Laptops',     29500, 23000, 3,  'LAP-005', '💻', 5),
('Wireless Mouse Logitech M185','Peripherals', 650,   420,   30, 'PER-003', '🖱️', 45),
('Membrane Keyboard Basic',    'Peripherals', 450,   280,   35, 'PER-004', '⌨️', 40),
('Gaming Headset HyperX',      'Peripherals', 2800,  2100,  12, 'PER-005', '🎧', 18),
('Webcam 1080p',               'Peripherals', 1500,  1050,  15, 'PER-006', '📷', 22),
('24-inch Monitor ASUS',       'Peripherals', 7500,  5800,  6,  'PER-007', '🖥️', 10),
('USB Flash Drive 32GB',       'Accessories', 350,   220,   60, 'ACC-003', '🔌', 90),
('Laptop Cooling Pad',         'Accessories', 850,   580,   20, 'ACC-004', '🔌', 28),
('Mouse Pad Large',            'Accessories', 250,   120,   45, 'ACC-005', '🔌', 60),
('Laptop Bag 15.6-inch',       'Accessories', 1200,  850,   18, 'ACC-006', '🔌', 22),
('Power Bank 10000mAh',        'Accessories', 950,   650,   25, 'ACC-007', '🔌', 30),
('Laptop Repair Diagnosis',    'Services',    300,   0,     0,  'SVC-003', '🔧', 25),
('Data Recovery Service',      'Services',    1500,  0,     0,  'SVC-004', '💿', 8),
('Virus Removal',              'Services',    600,   0,     0,  'SVC-005', '🛠️', 18),
('Custom PC Build',            'Services',    2000,  0,     0,  'SVC-006', '🔧', 6);
