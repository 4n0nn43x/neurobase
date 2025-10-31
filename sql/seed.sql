-- NeuroBase Sample Data
-- This script populates the database with sample e-commerce data

-- Insert sample users
INSERT INTO users (email, name, last_login, is_active) VALUES
('john.smith@email.com', 'John Smith', NOW() - INTERVAL '2 hours', true),
('alice.brown@email.com', 'Alice Brown', NOW() - INTERVAL '1 day', true),
('bob.johnson@email.com', 'Bob Johnson', NOW() - INTERVAL '3 days', true),
('carol.white@email.com', 'Carol White', NOW() - INTERVAL '1 week', true),
('david.lee@email.com', 'David Lee', NOW() - INTERVAL '2 weeks', true),
('emma.wilson@email.com', 'Emma Wilson', NOW() - INTERVAL '1 month', false),
('frank.miller@email.com', 'Frank Miller', NOW() - INTERVAL '2 months', true),
('grace.taylor@email.com', 'Grace Taylor', NOW() - INTERVAL '5 days', true),
('henry.anderson@email.com', 'Henry Anderson', NOW() - INTERVAL '1 hour', true),
('iris.martinez@email.com', 'Iris Martinez', NOW() - INTERVAL '3 hours', true)
ON CONFLICT (email) DO NOTHING;

-- Insert sample categories
INSERT INTO categories (name, description, parent_id) VALUES
('Electronics', 'Electronic devices and accessories', NULL),
('Computers', 'Laptops, desktops, and accessories', 1),
('Smartphones', 'Mobile phones and accessories', 1),
('Home & Garden', 'Home improvement and garden supplies', NULL),
('Furniture', 'Indoor and outdoor furniture', 4),
('Books', 'Physical and digital books', NULL),
('Fiction', 'Fiction books', 6),
('Non-Fiction', 'Non-fiction books', 6),
('Clothing', 'Apparel and accessories', NULL),
('Sports', 'Sports equipment and activewear', NULL)
ON CONFLICT (name) DO NOTHING;

-- Insert sample products
INSERT INTO products (name, description, category_id, price, stock_quantity) VALUES
('MacBook Pro 16"', 'High-performance laptop for professionals', 2, 2499.99, 25),
('iPhone 15 Pro', 'Latest flagship smartphone', 3, 1199.99, 50),
('Samsung Galaxy S24', 'Premium Android smartphone', 3, 999.99, 40),
('Dell XPS 15', 'Premium Windows laptop', 2, 1799.99, 30),
('iPad Air', 'Versatile tablet for work and play', 1, 599.99, 45),
('Office Chair Pro', 'Ergonomic office chair', 5, 399.99, 20),
('Standing Desk', 'Adjustable height desk', 5, 599.99, 15),
('The Great Gatsby', 'Classic American novel', 7, 12.99, 100),
('Sapiens', 'A Brief History of Humankind', 8, 18.99, 75),
('Running Shoes', 'Professional running shoes', 10, 129.99, 60),
('Yoga Mat', 'Premium yoga mat', 10, 39.99, 80),
('Wireless Headphones', 'Noise-cancelling headphones', 1, 349.99, 55),
('Smart Watch', 'Fitness and health tracker', 1, 399.99, 35),
('Coffee Maker', 'Programmable coffee maker', 4, 89.99, 40),
('Blender', 'High-power blender', 4, 129.99, 30)
ON CONFLICT DO NOTHING;

-- Insert sample orders
WITH user_ids AS (SELECT id FROM users LIMIT 10)
INSERT INTO orders (user_id, status, total_amount, created_at) VALUES
((SELECT id FROM users WHERE email = 'john.smith@email.com'), 'delivered', 0, NOW() - INTERVAL '2 weeks'),
((SELECT id FROM users WHERE email = 'alice.brown@email.com'), 'delivered', 0, NOW() - INTERVAL '1 week'),
((SELECT id FROM users WHERE email = 'bob.johnson@email.com'), 'shipped', 0, NOW() - INTERVAL '3 days'),
((SELECT id FROM users WHERE email = 'carol.white@email.com'), 'processing', 0, NOW() - INTERVAL '1 day'),
((SELECT id FROM users WHERE email = 'david.lee@email.com'), 'delivered', 0, NOW() - INTERVAL '1 month'),
((SELECT id FROM users WHERE email = 'john.smith@email.com'), 'delivered', 0, NOW() - INTERVAL '5 days'),
((SELECT id FROM users WHERE email = 'grace.taylor@email.com'), 'delivered', 0, NOW() - INTERVAL '2 weeks'),
((SELECT id FROM users WHERE email = 'henry.anderson@email.com'), 'pending', 0, NOW() - INTERVAL '2 hours'),
((SELECT id FROM users WHERE email = 'alice.brown@email.com'), 'delivered', 0, NOW() - INTERVAL '3 weeks'),
((SELECT id FROM users WHERE email = 'iris.martinez@email.com'), 'shipped', 0, NOW() - INTERVAL '4 days')
ON CONFLICT DO NOTHING;

-- Insert sample order items
INSERT INTO order_items (order_id, product_id, quantity, price)
SELECT
    o.id,
    p.id,
    (RANDOM() * 3 + 1)::INTEGER,
    p.price
FROM orders o
CROSS JOIN LATERAL (
    SELECT id, price
    FROM products
    ORDER BY RANDOM()
    LIMIT (RANDOM() * 3 + 1)::INTEGER
) p
WHERE NOT EXISTS (
    SELECT 1 FROM order_items oi
    WHERE oi.order_id = o.id AND oi.product_id = p.id
)
LIMIT 30;

-- Insert sample reviews
INSERT INTO reviews (product_id, user_id, rating, comment, created_at)
SELECT
    p.id,
    u.id,
    (FLOOR(RANDOM() * 5) + 1)::INTEGER,  -- Generates 1-5 (not 6)
    CASE (RANDOM() * 4)::INTEGER
        WHEN 0 THEN 'Great product! Highly recommend.'
        WHEN 1 THEN 'Good value for money.'
        WHEN 2 THEN 'Decent quality, works as expected.'
        WHEN 3 THEN 'Love it! Exceeded my expectations.'
        ELSE 'Satisfactory purchase.'
    END,
    NOW() - (RANDOM() * INTERVAL '30 days')
FROM products p
CROSS JOIN LATERAL (
    SELECT id FROM users
    ORDER BY RANDOM()
    LIMIT 1
) u
WHERE (RANDOM() < 0.6)  -- 60% of products have reviews
LIMIT 25
ON CONFLICT DO NOTHING;

-- Update statistics
ANALYZE users;
ANALYZE products;
ANALYZE orders;
ANALYZE order_items;
ANALYZE reviews;
ANALYZE categories;
