-- Read-only. Run this BEFORE and AFTER reset_demo_data.sql to see row
-- counts for every table involved in the reset. Safe to run any time.

SELECT 'products' AS table_name, COUNT(*) FROM products
UNION ALL SELECT 'categories', COUNT(*) FROM categories
UNION ALL SELECT 'profiles', COUNT(*) FROM profiles
UNION ALL SELECT 'auth.users', COUNT(*) FROM auth.users
UNION ALL SELECT 'customers', COUNT(*) FROM customers
UNION ALL SELECT 'transactions', COUNT(*) FROM transactions
UNION ALL SELECT 'transaction_items', COUNT(*) FROM transaction_items
UNION ALL SELECT 'refunds', COUNT(*) FROM refunds
UNION ALL SELECT 'returns', COUNT(*) FROM returns
UNION ALL SELECT 'holds', COUNT(*) FROM holds
UNION ALL SELECT 'activity_log', COUNT(*) FROM activity_log
UNION ALL SELECT 'product_serials (In Stock)', COUNT(*) FROM product_serials WHERE status = 'In Stock'
UNION ALL SELECT 'product_serials (Sold)', COUNT(*) FROM product_serials WHERE status = 'Sold'
UNION ALL SELECT 'product_serials (Defective)', COUNT(*) FROM product_serials WHERE status = 'Defective'
UNION ALL SELECT 'storage.objects (return-evidence)', COUNT(*) FROM storage.objects WHERE bucket_id = 'return-evidence'
ORDER BY 1;
