import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbDir = path.join(__dirname, '../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Connect to SQLite database
const db = new Database(path.join(dbDir, 'stromira.db'), { verbose: console.log });
db.pragma('journal_mode = WAL');

// Initialize database schema
export const initDb = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'Admin'
    );

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      image TEXT,
      type TEXT DEFAULT 'Manual',
      conditions TEXT,
      handle TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      compare_at_price REAL DEFAULT 0,
      cost_per_item REAL DEFAULT 0,
      sku TEXT,
      stock INTEGER DEFAULT 0,
      track_quantity BOOLEAN DEFAULT 1,
      images TEXT,
      top_notes TEXT,
      heart_notes TEXT,
      base_notes TEXT,
      category TEXT,
      product_type TEXT,
      tags TEXT,
      variants TEXT,
      translations TEXT,
      collections_json TEXT,
      free_shipping BOOLEAN DEFAULT 0,
      featured BOOLEAN DEFAULT 0,
      visible BOOLEAN DEFAULT 1,
      status TEXT DEFAULT 'Active',
      handle TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT,
      spending REAL DEFAULT 0,
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      customer_name TEXT,
      total_price REAL NOT NULL,
      status TEXT DEFAULT 'Pending',
      payment_status TEXT DEFAULT 'Pending',
      payment_method TEXT DEFAULT 'cod',
      receipt_image TEXT,
      shipping_details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      product_name TEXT,
      customer_id INTEGER,
      customer_name TEXT,
      rating INTEGER NOT NULL,
      comment TEXT,
      image TEXT,
      status TEXT DEFAULT 'Pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      read BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Dynamic Schema Updater for products table
  const expectedProductColumns: Record<string, string> = {
    collections_json: 'TEXT',
    variants: 'TEXT',
    translations: 'TEXT',
    compare_at_price: 'REAL DEFAULT 0',
    cost_per_item: 'REAL DEFAULT 0',
    sku: 'TEXT',
    product_type: 'TEXT',
    tags: 'TEXT',
    status: 'TEXT DEFAULT "Active"',
    free_shipping: 'BOOLEAN DEFAULT 0',
    track_quantity: 'BOOLEAN DEFAULT 1',
    handle: 'TEXT'
  };

  const productCols = (db.prepare('PRAGMA table_info(products)').all() as any[]).map((c: any) => c.name);
  for (const [col, type] of Object.entries(expectedProductColumns)) {
    if (!productCols.includes(col)) {
      console.log(`Adding missing column ${col} to products...`);
      try {
        db.prepare(`ALTER TABLE products ADD COLUMN ${col} ${type}`).run();
      } catch (e: any) { console.error('Error adding column to products', col, e.message); }
    }
  }

  const expectedOrderColumns: Record<string, string> = {
    payment_method: 'TEXT',
    receipt_image: 'TEXT'
  };

  const orderCols = (db.prepare('PRAGMA table_info(orders)').all() as any[]).map((c: any) => c.name);
  for (const [col, type] of Object.entries(expectedOrderColumns)) {
    if (!orderCols.includes(col)) {
      console.log(`Adding missing column ${col} to orders...`);
      try {
        db.prepare(`ALTER TABLE orders ADD COLUMN ${col} ${type}`).run();
      } catch (e: any) { console.error('Error adding column to orders', col, e.message); }
    }
  }

  // Dynamic Schema Updater for collections table
  const expectedCollectionColumns: Record<string, string> = {
    handle: 'TEXT'
  };

  const colCols = (db.prepare('PRAGMA table_info(collections)').all() as any[]).map((c: any) => c.name);
  for (const [col, type] of Object.entries(expectedCollectionColumns)) {
    if (!colCols.includes(col)) {
      console.log(`Adding missing column ${col} to collections...`);
      try {
        db.prepare(`ALTER TABLE collections ADD COLUMN ${col} ${type}`).run();
      } catch (e: any) { console.error('Error adding column to collections', col, e.message); }
    }
  }

  // Dynamic Schema Updater for order_items table
  const expectedOrderItemColumns: Record<string, string> = {
    variant: 'TEXT'
  };

  const orderItemCols = (db.prepare('PRAGMA table_info(order_items)').all() as any[]).map((c: any) => c.name);
  for (const [col, type] of Object.entries(expectedOrderItemColumns)) {
    if (!orderItemCols.includes(col)) {
      console.log(`Adding missing column ${col} to order_items...`);
      try {
        db.prepare(`ALTER TABLE order_items ADD COLUMN ${col} ${type}`).run();
      } catch (e: any) { console.error('Error adding column to order_items', col, e.message); }
    }
  }

  // Dynamic Schema Updater for customers table
  const expectedCustomerColumns: Record<string, string> = {
    source: 'TEXT DEFAULT "Website"'
  };

  const customerCols = (db.prepare('PRAGMA table_info(customers)').all() as any[]).map((c: any) => c.name);
  for (const [col, type] of Object.entries(expectedCustomerColumns)) {
    if (!customerCols.includes(col)) {
      console.log(`Adding missing column ${col} to customers...`);
      try {
        db.prepare(`ALTER TABLE customers ADD COLUMN ${col} ${type}`).run();
      } catch (e: any) { console.error('Error adding column to customers', col, e.message); }
    }
  }

  // Dynamic Schema Updater for reviews table
  const expectedReviewColumns: Record<string, string> = {
    product_name: 'TEXT',
    image: 'TEXT'
  };

  const reviewCols = (db.prepare('PRAGMA table_info(reviews)').all() as any[]).map((c: any) => c.name);
  for (const [col, type] of Object.entries(expectedReviewColumns)) {
    if (!reviewCols.includes(col)) {
      console.log(`Adding missing column ${col} to reviews...`);
      try {
        db.prepare(`ALTER TABLE reviews ADD COLUMN ${col} ${type}`).run();
      } catch (e: any) { console.error('Error adding column to reviews', col, e.message); }
    }
  }

  // Create default admin if not exists (admin:admin)
  const stmt = db.prepare('SELECT COUNT(*) as count FROM admins');
  const result: any = stmt.get();

  if (result.count === 0) {
    const hash = bcrypt.hashSync('admin', 10);
    const insertAdmin = db.prepare('INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)');
    insertAdmin.run('admin', hash, 'Admin');
    console.log('Default admin created (admin / admin)');
  }
};

export default db;

