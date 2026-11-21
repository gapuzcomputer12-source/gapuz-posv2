-- 15 real computer parts — run after the TRUNCATE to seed real inventory.

INSERT INTO products (name, category, price, cost_price, stock, barcode, icon, sold) VALUES
('AMD Ryzen 5 5600',             'Processors',  7800,  6000,  15, 'CPU-101', '💻', 0),
('Intel Core i5-13400F',         'Processors',  11500, 9000,  10, 'CPU-102', '💻', 0),
('AMD Ryzen 7 7800X3D',          'Processors',  21500, 17500, 5,  'CPU-103', '💻', 0),
('Kingston Fury Beast 16GB DDR4 3200MHz', 'RAM', 2600,  2000,  20, 'RAM-101', '🧩', 0),
('Corsair Vengeance 32GB DDR5 5600MHz',   'RAM', 7200,  5800,  12, 'RAM-102', '🧩', 0),
('NVIDIA RTX 4060 8GB',          'GPU',         18500, 14500, 6,  'GPU-101', '🎮', 0),
('AMD RX 7600 8GB',              'GPU',         15500, 12000, 7,  'GPU-102', '🎮', 0),
('NVIDIA RTX 4070 12GB',         'GPU',         32000, 26000, 3,  'GPU-103', '🎮', 0),
('Samsung 970 EVO Plus 1TB NVMe SSD', 'Storage', 4200,  3300,  20, 'SSD-101', '💾', 0),
('WD Black 2TB NVMe SSD',        'Storage',     6800,  5400,  10, 'SSD-102', '💾', 0),
('Seagate Barracuda 2TB HDD',    'Storage',     3200,  2500,  18, 'HDD-101', '💾', 0),
('ASUS Prime B650M-A Motherboard', 'Motherboards', 7500, 6000, 9,  'MB-101',  '🧠', 0),
('MSI PRO B760M-A Motherboard',  'Motherboards', 8200,  6600,  8,  'MB-102',  '🧠', 0),
('Corsair RM750 750W 80+ Gold PSU', 'Power Supply', 5600, 4400, 14, 'PSU-101', '🔋', 0),
('NZXT H5 Flow Mid Tower Case',  'Cases',       3800,  2900,  11, 'CASE-101', '🖥️', 0);
