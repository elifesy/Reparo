const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Production: volume mounted at /data — Local: next to this file
const DB_PATH = process.env.NODE_ENV === 'production'
  ? '/data/reparo.sqlite'
  : path.join(__dirname, 'reparo.sqlite');
const db = new Database(DB_PATH);

// ── Pragmas for performance ──
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ══════════════════════════════════════
// SCHEMA
// ══════════════════════════════════════
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    phone       TEXT,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'Customer',  -- Admin | Engineer | Customer
    status      TEXT NOT NULL DEFAULT 'Active',    -- Active | Inactive | On Leave
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS services (
    id            TEXT PRIMARY KEY,
    cust_id       TEXT,
    cust_name     TEXT NOT NULL,
    cust_phone    TEXT,
    cust_email    TEXT,
    device_type   TEXT NOT NULL,
    brand         TEXT NOT NULL,
    model         TEXT NOT NULL,
    serial        TEXT,
    imei          TEXT,
    color         TEXT,
    warranty      TEXT DEFAULT 'Not sure',
    purchase_date TEXT,
    issue_cat     TEXT NOT NULL,
    issue_desc    TEXT,
    diagnosis     TEXT,
    conditions    TEXT DEFAULT '[]',  -- JSON array
    accessories   TEXT,
    priority      TEXT DEFAULT 'Medium',
    status        TEXT DEFAULT 'Received',
    engineer_id   TEXT,
    engineer_name TEXT,
    cost          REAL DEFAULT 0,
    contact_pref  TEXT DEFAULT 'Phone call',
    source        TEXT DEFAULT 'online',
    notes         TEXT,
    eta           DATETIME,
    dispatch_at   DATETIME,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cust_id) REFERENCES users(id),
    FOREIGN KEY (engineer_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS service_activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id TEXT NOT NULL,
    text       TEXT NOT NULL,
    type       TEXT DEFAULT 'update',
    by_user    TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id        TEXT PRIMARY KEY,
    text      TEXT NOT NULL,
    type      TEXT DEFAULT 'info',
    audience  TEXT DEFAULT 'All users',
    active    INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT NOT NULL,
    user_email TEXT,
    ip         TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Indexes ──
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_services_cust    ON services(cust_id);
  CREATE INDEX IF NOT EXISTS idx_services_eng     ON services(engineer_id);
  CREATE INDEX IF NOT EXISTS idx_services_status  ON services(status);
  CREATE INDEX IF NOT EXISTS idx_activity_service ON service_activity(service_id);
`);

// ══════════════════════════════════════
// DEFAULT SETTINGS
// ══════════════════════════════════════
const defaultSettings = {
  working_hours:  '9:00 AM – 6:00 PM, Sat–Thu',
  express_fee:    '50',
  sla_days:       '5',
  max_jobs:       '8',
  portal_name:    'Reparo',
  support_phone:  '+971 4 000 0000',
  support_email:  'support@reparo.com',
  tagline:        'Intelligent Device Service Management',
  notif_sms:      '1',
  notif_email:    '1',
  notif_whatsapp: '1',
  notif_digest:   '0',
  sec_2fa:        '1',
  sec_timeout:    '1',
  sec_audit:      '1',
};
const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)`);
for (const [k, v] of Object.entries(defaultSettings)) insertSetting.run(k, v);

// ══════════════════════════════════════
// SEED (only if DB is empty)
// ══════════════════════════════════════
const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;

if (userCount === 0) {
  console.log('🌱  Seeding fresh database…');

  const engineers = [
    { id: 'eng1', first: 'Mohammed', last: 'Al-Farsi',  email: 'm.alfarsi@reparo.com',  phone: '+971502222222', role: 'Engineer' },
    { id: 'eng2', first: 'Sara',     last: 'Ibrahim',   email: 's.ibrahim@reparo.com',   phone: '+971503333333', role: 'Engineer' },
    { id: 'eng3', first: 'Khalid',   last: 'Hassan',    email: 'k.hassan@reparo.com',    phone: '+971504444444', role: 'Engineer' },
    { id: 'eng4', first: 'Rania',    last: 'Nasser',    email: 'r.nasser@reparo.com',    phone: '+971505555555', role: 'Engineer', status: 'On Leave' },
  ];
  const customers = [
    { id: 'demo', first: 'Ahmad',  last: 'Al-Rashid',   email: 'demo@reparo.com',  phone: '+971500000001' },
    { id: 'c2',   first: 'Sara',   last: 'Al-Mansouri', email: 'sara@reparo-demo.com',      phone: '+971502345678' },
    { id: 'c3',   first: 'Khalid', last: 'Hassan',      email: 'khalid@email.com',    phone: '+971503456789' },
    { id: 'c4',   first: 'Fatima', last: 'Nasser',      email: 'fatima@email.com',    phone: '+971504567890' },
    { id: 'c5',   first: 'Omar',   last: 'Al-Zaabi',    email: 'omar@email.com',      phone: '+971505678901' },
  ];

  const insertUser = db.prepare(`
    INSERT INTO users(id,first_name,last_name,email,phone,password,role,status,created_at,last_active)
    VALUES(?,?,?,?,?,?,?,?,datetime('now',?),datetime('now',?))`);

  // Admin
  const adminHash = bcrypt.hashSync('Admin1234!', 10);
  insertUser.run('admin1','System','Admin','admin@reparo.com','+971501111111',adminHash,'Admin','Active','-365 days','-1 hours');

  // Engineers
  const engHash = bcrypt.hashSync('Eng1234!', 10);
  for (const e of engineers) {
    insertUser.run(e.id, e.first, e.last, e.email, e.phone, engHash, e.role || 'Engineer', e.status || 'Active', '-180 days', '-2 hours');
  }

  // Customers
  const custHash = bcrypt.hashSync('Demo1234!', 10);
  for (const c of customers) {
    insertUser.run(c.id, c.first, c.last, c.email, c.phone, custHash, 'Customer', 'Active', '-45 days', '-1 hours');
  }

  // Services seed
  const devices = [
    { type:'Smartphone',    brand:'Apple',   model:'iPhone 15 Pro' },
    { type:'Laptop',        brand:'Dell',    model:'XPS 15' },
    { type:'Tablet',        brand:'Samsung', model:'Galaxy Tab S9' },
    { type:'Smartphone',    brand:'Samsung', model:'Galaxy S24 Ultra' },
    { type:'Laptop',        brand:'HP',      model:'Spectre x360' },
    { type:'Desktop PC',    brand:'Lenovo',  model:'ThinkCentre M90q' },
    { type:'Smartwatch',    brand:'Apple',   model:'Watch Ultra 2' },
    { type:'Gaming Console',brand:'Sony',    model:'PlayStation 5' },
    { type:'Smartphone',    brand:'Huawei',  model:'P60 Pro' },
    { type:'Laptop',        brand:'Apple',   model:'MacBook Air M3' },
  ];
  const issues   = ['Screen / Display','Battery','Charging / Power','Speaker / Microphone','Camera','Software / OS','Physical Damage','Water Damage','Connectivity','Keyboard / Trackpad'];
  const statuses = ['Received','Diagnosed','In Progress','Awaiting Parts','Ready','Dispatched'];
  const pris     = ['Low','Medium','High'];

  const insertSvc = db.prepare(`
    INSERT INTO services(id,cust_id,cust_name,cust_phone,cust_email,device_type,brand,model,serial,issue_cat,issue_desc,diagnosis,priority,status,engineer_id,engineer_name,cost,eta,dispatch_at,last_activity,created_at,source,notes,accessories,warranty)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now',?),?,datetime('now',?),datetime('now',?),?,?,?,?)`);

  const insertAct = db.prepare(`
    INSERT INTO service_activity(service_id,text,type,by_user,created_at) VALUES(?,?,?,?,datetime('now',?))`);

  let svcNum = 1;
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];

  for (let i = 0; i < 24; i++) {
    const cust  = rnd(customers);
    const dev   = rnd(devices);
    const eng   = rnd(engineers);
    const st    = rnd(statuses);
    const pri   = rnd(pris);
    const cost  = Math.floor(Math.random() * 1750) + 50;
    const daysAgo = -(Math.floor(Math.random() * 45) + 1);
    const etaDays = String(Math.floor(Math.random() * 10) - 2) + ' days';
    const dispatchDays = st === 'Dispatched' ? `${-(Math.floor(Math.random()*7)+1)} days` : null;
    const id = 'RPR-' + String(svcNum++).padStart(4,'0');

    insertSvc.run(
      id, cust.id, `${cust.first} ${cust.last}`, cust.phone, cust.email,
      dev.type, dev.brand, dev.model, `SN${Math.floor(Math.random()*900000)+100000}`,
      rnd(issues), 'Customer reported the issue. Device needs inspection.',
      'Initial visual inspection completed.',
      pri, st, eng.id, `Eng. ${eng.first} ${eng.last}`, cost,
      etaDays,
      dispatchDays ? `datetime('now','${dispatchDays}')` : null,
      `${daysAgo} days`, `${daysAgo} days`,
      'walk-in', '', 'Charger', 'Not sure'
    );

    // Activity entries
    insertAct.run(id, 'Service intake recorded', 'intake', 'System', `${daysAgo} days`);
    if (['Diagnosed','In Progress','Awaiting Parts','Ready','Dispatched'].includes(st))
      insertAct.run(id, `Device diagnosed by ${eng.first} ${eng.last}`, 'diagnosis', `${eng.first} ${eng.last}`, `${daysAgo + 0.1} days`);
    if (['In Progress','Awaiting Parts','Ready','Dispatched'].includes(st))
      insertAct.run(id, 'Repair work started', 'update', `${eng.first} ${eng.last}`, `${daysAgo + 0.3} days`);
    if (st === 'Dispatched')
      insertAct.run(id, 'Device dispatched to customer', 'dispatch', 'Front Desk', `${dispatchDays} days`);
  }

  // Announcements
  const insertAnn = db.prepare(`INSERT INTO announcements(id,text,type,audience) VALUES(?,?,?,?)`);
  insertAnn.run('ann1','Service center open Sat–Thu, 9am–6pm. Express service +AED 50.','info','All users');
  insertAnn.run('ann2','Average turnaround this week: 2.4 days — fastest ever!','success','All users');

  // Audit log
  const insertLog = db.prepare(`INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)`);
  insertLog.run('System seeded with demo data','system','localhost');
  insertLog.run('User admin@reparo.com created','system','localhost');

  console.log('✅  Seed complete — ' + svcNum + ' services, ' + (engineers.length + customers.length + 1) + ' users');
}

module.exports = db;
