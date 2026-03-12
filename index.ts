import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// Setup database
import db, { initDb } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize DB schema
initDb();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'stromira_super_secret_key_2026';

app.use(cors());
app.use(express.json());

// Setup static folder for uploads
const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

// JWT Middleware
const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        req.user = user;
        next();
    });
};

/* --- API ROUTES --- */

// --- Notification & WhatsApp System ---
let sseClients: any[] = [];

app.get('/api/notifications/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    sseClients.push(res);
    req.on('close', () => { sseClients = sseClients.filter(client => client !== res) });
});

app.get('/api/notifications', authenticateToken, (req, res) => {
    const notifications = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all();
    res.json(notifications);
});

app.put('/api/notifications/:id/read', authenticateToken, (req, res) => {
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

app.put('/api/notifications/read-all', authenticateToken, (req, res) => {
    db.prepare('UPDATE notifications SET read = 1').run();
    res.json({ success: true });
});

const handleNewEvent = (type: string, notificationMessage: string, waMessage: string) => {
    try {
        const stmt = db.prepare('INSERT INTO notifications (type, message, read) VALUES (?, ?, 0)');
        const info = stmt.run(type, notificationMessage);
        const notification = {
            id: info.lastInsertRowid, type, message: notificationMessage,
            read: 0, created_at: new Date().toISOString()
        };

        // Broadcast to clients
        sseClients.forEach(client => client.write(`data: ${JSON.stringify(notification)}\n\n`));

        // WhatsApp Auto-Send for: 01099316207 using CallMeBot API (Free)
        const whatsappNumber = '201099316207';
        const apiKey = '2716976'; // <--- PUT YOUR API KEY HERE

        console.log(`\n\n[WHATSAPP DISPATCH] -> ${whatsappNumber}`);
        console.log(waMessage);

        const apiUrl = `https://api.callmebot.com/whatsapp.php?phone=${whatsappNumber}&text=${encodeURIComponent(waMessage)}&apikey=${apiKey}`;

        fetch(apiUrl)
            .then(res => {
                if (res.ok) console.log('[WHATSAPP SENT SUCCESSFULLY]');
            })
            .catch(err => console.log('[WHATSAPP SEND ERROR]'));

    } catch (e) {
        console.error('Event Handle Error:', e);
    }
};

app.post('/api/visits', (req, res) => {
    // We throttle this on the frontend using sessionStorage
    const currentVisits = (db.prepare('SELECT COUNT(*) as count FROM customers').get() as any).count;
    handleNewEvent('VISIT', `زائر جديد يتصفح الموقع الآن.`, `🚨 *تنبيه من موقع Stromira* 🚨\nهناك زائر جديد يتصفح الموقع الآن!`);
    res.json({ success: true });
});

// --- Auth ---
app.post('/api/auth/register', (req, res) => {
    const { username, password } = req.body;

    // Check if user exists
    const existing = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (existing) return res.status(400).json({ error: 'Username already exists' });

    const hashedPassword = bcrypt.hashSync(password, 10);
    try {
        db.prepare('INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)').run(username, hashedPassword, 'admin');
        res.status(201).json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username) as any;
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    const validPassword = bcrypt.compareSync(password, admin.password_hash);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, admin: { username: admin.username, role: admin.role } });
});

app.get('/api/auth/me', authenticateToken, (req: any, res) => {
    res.json({ user: req.user });
});

// --- Settings/Dashboard Stats ---
app.get('/api/stats', authenticateToken, (req, res) => {
    const totalProducts = (db.prepare('SELECT COUNT(*) as count FROM products').get() as any).count;
    const totalOrders = (db.prepare('SELECT COUNT(*) as count FROM orders').get() as any).count;
    const totalRevenue = (db.prepare('SELECT SUM(spending) as sum FROM customers').get() as any).sum || 0;
    const totalCustomers = (db.prepare('SELECT COUNT(*) as count FROM customers').get() as any).count;

    const recentOrders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5').all();

    // Fake realistic monthly trajectory scaling to total revenue
    const monthlyData = [
        { name: 'Jan', revenue: Number((totalRevenue * 0.1).toFixed(2)) },
        { name: 'Feb', revenue: Number((totalRevenue * 0.15).toFixed(2)) },
        { name: 'Mar', revenue: Number((totalRevenue * 0.25).toFixed(2)) },
        { name: 'Apr', revenue: Number((totalRevenue * 0.2).toFixed(2)) },
        { name: 'May', revenue: Number((totalRevenue * 0.1).toFixed(2)) },
        { name: 'Jun', revenue: Number((totalRevenue * 0.2).toFixed(2)) },
    ];

    res.json({ totalProducts, totalOrders, totalRevenue, totalCustomers, recentOrders, monthlyData });
});

app.get('/api/settings', (req, res) => {
    const settings = db.prepare('SELECT * FROM settings').all();
    const settingsObj: any = {};
    settings.forEach((s: any) => { settingsObj[s.key] = s.value; });
    res.json(settingsObj);
});

app.put('/api/settings', authenticateToken, (req, res) => {
    const settings = req.body;
    const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

    db.transaction(() => {
        Object.keys(settings).forEach(key => {
            stmt.run(key, typeof settings[key] === 'object' ? JSON.stringify(settings[key]) : String(settings[key]));
        });
    })();

    res.json({ success: true });
});

// --- Uploads ---
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

// --- Collections ---
app.get('/api/collections', (req, res) => {
    const collections = db.prepare('SELECT * FROM collections ORDER BY created_at DESC').all();
    res.json(collections);
});

app.post('/api/collections', authenticateToken, (req, res) => {
    const { title, description, image, type, conditions, handle } = req.body;
    const finalHandle = handle || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    const insert = db.prepare(`
    INSERT INTO collections (title, description, image, type, conditions, handle)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    const info = insert.run(title, description, image, type, JSON.stringify(conditions || {}), finalHandle);
    res.status(201).json({ id: info.lastInsertRowid, handle: finalHandle });
});

app.put('/api/collections/:id', authenticateToken, (req, res) => {
    const { title, description, image, type, conditions, handle } = req.body;
    const finalHandle = handle || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    const update = db.prepare(`
    UPDATE collections SET
      title = ?, description = ?, image = ?, type = ?, conditions = ?, handle = ?
    WHERE id = ?
  `);
    update.run(title, description, image, type, JSON.stringify(conditions || {}), finalHandle, req.params.id);
    res.json({ success: true, handle: finalHandle });
});

app.delete('/api/collections/:id', authenticateToken, (req, res) => {
    db.prepare('DELETE FROM collections WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// --- Products ---
app.get('/api/products', (req, res) => {
    let products;
    if (req.query.all === 'true') {
        products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
    } else {
        products = db.prepare("SELECT * FROM products WHERE status = 'Active' ORDER BY created_at DESC").all();
    }
    // Parse JSON fields before sending
    const parsedProducts = products.map((p: any) => {
        const images = p.images ? JSON.parse(p.images) : [];
        return {
            ...p,
            images,
            img: images[0] || '', // Map first image to 'img' for carousel compatibility
            variants: p.variants ? JSON.parse(p.variants) : [],
            translations: p.translations ? JSON.parse(p.translations) : {},
            collections: p.collections_json ? JSON.parse(p.collections_json) : []
        };
    });
    res.json(parsedProducts);
});

app.post('/api/products', authenticateToken, (req, res) => {
    const {
        name, description, price, compare_at_price, cost_per_item, sku, stock, track_quantity,
        images, top_notes, heart_notes, base_notes, category, product_type, tags, variants,
        translations, collections, free_shipping, featured, visible, status, handle
    } = req.body;

    const finalHandle = handle || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    const insert = db.prepare(`
    INSERT INTO products (
        name, description, price, compare_at_price, cost_per_item, sku, stock, track_quantity,
        images, top_notes, heart_notes, base_notes, category, product_type, tags, variants,
        translations, collections_json, free_shipping, featured, visible, status, handle
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

    const info = insert.run(
        name, description, price, compare_at_price || 0, cost_per_item || 0, sku || null, stock || 0, track_quantity ? 1 : 0,
        typeof images === 'string' ? images : JSON.stringify(images || []),
        top_notes, heart_notes, base_notes, category, product_type, tags,
        typeof variants === 'string' ? variants : JSON.stringify(variants || []),
        typeof translations === 'string' ? translations : JSON.stringify(translations || {}),
        typeof collections === 'string' ? collections : JSON.stringify(collections || []),
        free_shipping ? 1 : 0, featured ? 1 : 0, visible === false ? 0 : 1, status || 'Active', finalHandle
    );

    res.status(201).json({ id: info.lastInsertRowid, handle: finalHandle });
});

app.put('/api/products/:id', authenticateToken, (req, res) => {
    const {
        name, description, price, compare_at_price, cost_per_item, sku, stock, track_quantity,
        images, top_notes, heart_notes, base_notes, category, product_type, tags, variants,
        translations, collections, free_shipping, featured, visible, status, handle
    } = req.body;

    const finalHandle = handle || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    const update = db.prepare(`
    UPDATE products SET
      name = ?, description = ?, price = ?, compare_at_price = ?, cost_per_item = ?, sku = ?, 
      stock = ?, track_quantity = ?, images = ?, top_notes = ?, heart_notes = ?, base_notes = ?, 
      category = ?, product_type = ?, tags = ?, variants = ?, translations = ?, collections_json = ?, 
      free_shipping = ?, featured = ?, visible = ?, status = ?, handle = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

    update.run(
        name, description, price, compare_at_price || 0, cost_per_item || 0, sku || null, stock || 0, track_quantity ? 1 : 0,
        typeof images === 'string' ? images : JSON.stringify(images || []),
        top_notes, heart_notes, base_notes, category, product_type, tags,
        typeof variants === 'string' ? variants : JSON.stringify(variants || []),
        typeof translations === 'string' ? translations : JSON.stringify(translations || {}),
        typeof collections === 'string' ? collections : JSON.stringify(collections || []),
        free_shipping ? 1 : 0, featured ? 1 : 0, visible === false ? 0 : 1, status || 'Active', finalHandle,
        req.params.id
    );

    res.json({ success: true, handle: finalHandle });
});

app.delete('/api/products/:id', authenticateToken, (req, res) => {
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

app.delete('/api/products/:id', authenticateToken, (req, res) => {
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// --- Orders ---
app.post('/api/orders', (req, res) => {
    const { customer_name, total_price, shipping_details, payment_method, receipt_image, items } = req.body;

    try {
        const insertOrder = db.prepare(`
            INSERT INTO orders (customer_name, total_price, shipping_details, payment_method, receipt_image, status, payment_status)
            VALUES (?, ?, ?, ?, ?, 'Pending', ?)
        `);

        const paymentStatus = 'Pending';

        let orderId: any;
        db.transaction(() => {
            // Manage customer record
            const email = shipping_details?.email;
            let customerId = null;
            if (email) {
                const existingCustomer = db.prepare('SELECT id FROM customers WHERE email = ?').get(email) as any;
                if (existingCustomer) {
                    customerId = existingCustomer.id;
                    db.prepare('UPDATE customers SET spending = spending + ?, phone = COALESCE(?, phone) WHERE id = ?').run(total_price, shipping_details?.phoneNumber || null, customerId);
                } else {
                    const info = db.prepare('INSERT INTO customers (name, email, phone, spending, source) VALUES (?, ?, ?, ?, ?)').run(
                        customer_name, email, shipping_details?.phoneNumber || null, total_price, 'Website'
                    );
                    customerId = info.lastInsertRowid;
                }
            }

            const info = insertOrder.run(
                customer_name,
                total_price,
                JSON.stringify(shipping_details || {}),
                payment_method || 'cod',
                receipt_image || null,
                paymentStatus
            );
            orderId = info.lastInsertRowid;

            if (customerId) {
                db.prepare('UPDATE orders SET customer_id = ? WHERE id = ?').run(customerId, orderId);
            }

            // Insert order items if provided - use product_id or fallback to id
            if (items && Array.isArray(items)) {
                const insertItem = db.prepare(`
                    INSERT OR IGNORE INTO order_items (order_id, product_id, quantity, price, variant)
                    VALUES (?, ?, ?, ?, ?)
                `);
                items.forEach((item: any) => {
                    const productId = item.product_id || item.id;
                    if (productId) {
                        try {
                            insertItem.run(orderId, productId, item.quantity || 1, item.price || 0, item.variant || null);
                        } catch (itemErr) {
                            // Non-fatal: continue even if individual item insert fails
                            console.error('item insert error:', itemErr);
                        }
                    }
                });
            }
        })();

        // Formulate WhatsApp message and Trigger Notification
        let parsedItems = items?.map((i: any) => `- ${i.name} (${i.variant || 'STANDARD'}) x${i.quantity} [SKU: ${i.sku || 'N/A'}]`).join('\n') || '';
        let waMessage = `🎉 *طلب جديد من الموقع!* 🎉\n
*رقم الأوردر:* #${orderId}
*الإسم:* ${customer_name}
*المبلغ الإجمالي:* ${total_price} جنيه
*وسيلة الدفع:* ${payment_method === 'cod' ? 'الدفع عند الاستلام' : payment_method}

*المنتجات:*
${parsedItems}

*التواصل:*
رقم الهاتف: ${shipping_details?.phoneNumber || 'غير محدد'}
العنوان: ${shipping_details?.address || 'غير محدد'}, ${shipping_details?.city || 'غير محدد'}`;

        handleNewEvent('ORDER', `طلب جديد بقيمة ${total_price} EGP من ${customer_name}`, waMessage);

        res.status(201).json({ success: true, orderId });
    } catch (error: any) {
        console.error('Error creating order:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/orders', authenticateToken, (req, res) => {
    const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    const parsedOrders = orders.map((order: any) => {
        let items = [];
        try {
            items = db.prepare(`
                SELECT oi.*, p.name, p.images, p.sku
                FROM order_items oi 
                LEFT JOIN products p ON oi.product_id = p.id 
                WHERE oi.order_id = ?
            `).all(order.id);
        } catch (e) {
            console.error('Error fetching order items:', e);
        }
        return {
            ...order,
            items: items.map((item: any) => ({
                ...item,
                img: item.images ? (JSON.parse(item.images)[0] || '') : ''
            }))
        };
    });
    res.json(parsedOrders);
});

app.put('/api/orders/:id', authenticateToken, (req, res) => {
    const { status, payment_status } = req.body;
    db.prepare('UPDATE orders SET status = ?, payment_status = ? WHERE id = ?')
        .run(status, payment_status, req.params.id);
    res.json({ success: true });
});

app.delete('/api/orders/:id', authenticateToken, (req, res) => {
    db.transaction(() => {
        db.prepare('DELETE FROM order_items WHERE order_id = ?').run(req.params.id);
        db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
    })();
    res.json({ success: true });
});

// --- Customers ---
app.get('/api/customers', authenticateToken, (req, res) => {
    const customers = db.prepare('SELECT * FROM customers ORDER BY registered_at DESC').all();
    res.json(customers);
});

app.post('/api/customers', authenticateToken, (req, res) => {
    const { name, email, phone, spending, source } = req.body;
    try {
        const info = db.prepare('INSERT INTO customers (name, email, phone, spending, source) VALUES (?, ?, ?, ?, ?)').run(
            name, email || `user_${Date.now()}@stromira.com`, phone || null, spending || 0, source || 'Website'
        );
        res.status(201).json({ success: true, id: info.lastInsertRowid });
    } catch (error: any) {
        console.error('Error adding customer:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/customers/:id', authenticateToken, (req, res) => {
    db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// --- Reviews ---
app.get('/api/reviews', authenticateToken, (req, res) => {
    // Join with products to get product names for better moderation
    const reviews = db.prepare(`
        SELECT r.*, p.name as product_name 
        FROM reviews r 
        LEFT JOIN products p ON r.product_id = p.id 
        ORDER BY r.created_at DESC
    `).all();
    res.json(reviews);
});

app.post('/api/reviews', (req, res) => {
    const { product_id, customer_name, rating, comment, image } = req.body;

    if (!product_id || !rating) {
        return res.status(400).json({ error: 'Missing product_id or rating' });
    }

    try {
        const insert = db.prepare(`
            INSERT INTO reviews (product_id, customer_name, rating, comment, image, status)
            VALUES (?, ?, ?, ?, ?, 'Pending')
        `);
        insert.run(product_id, customer_name || 'Anonymous Entity', rating, comment || '', image || null);

        // Fetch product name for WhatsApp message
        let productName = 'منتج مجهول';
        try {
            productName = (db.prepare('SELECT name FROM products WHERE id = ?').get(product_id) as any)?.name || productName;
        } catch (e) { }

        let waMessage = `⭐ *تقييم جديد تم إضافته!* ⭐\n
*المنتج:* ${productName}
*العميل:* ${customer_name || 'غير معروف'}
*التقييم:* ${rating}/5 نجوم
*الرأي:* "${comment || 'لا يوجد تعليق'}"\n
*يرجى مراجعته من الداشبورد للموافقة أو الرفض.*`;

        handleNewEvent('REVIEW', `تقييم ${rating} نجوم من ${customer_name || 'عميل'} على منتج #${product_id}`, waMessage);

        res.status(201).json({ success: true, message: 'Transmission received. Pending moderation.' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/products/:id/reviews', (req, res) => {
    const reviews = db.prepare("SELECT * FROM reviews WHERE product_id = ? AND status = 'Approved' ORDER BY created_at DESC").all(req.params.id);
    res.json(reviews);
});

app.put('/api/reviews/:id', authenticateToken, (req, res) => {
    const { status } = req.body; // Approved, Rejected
    db.prepare('UPDATE reviews SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ success: true });
});

app.delete('/api/reviews/:id', authenticateToken, (req, res) => {
    db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

app.delete('/api/reviews/:id', authenticateToken, (req, res) => {
    db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Express API Server running on port ${PORT}`);
});
