'use strict';
const bcrypt = require('bcryptjs');

function seed(db) {
  const engineers = [
    { id: 'eng1', first: 'Mohammed', last: 'Al-Farsi',  email: 'm.alfarsi@reparo.com',  phone: '+971502222222' },
    { id: 'eng2', first: 'Sara',     last: 'Ibrahim',   email: 's.ibrahim@reparo.com',   phone: '+971503333333' },
    { id: 'eng3', first: 'Khalid',   last: 'Hassan',    email: 'k.hassan@reparo.com',    phone: '+971504444444' },
    { id: 'eng4', first: 'Rania',    last: 'Nasser',    email: 'r.nasser@reparo.com',    phone: '+971505555555', status: 'On Leave' },
  ];
  const customers = [
    { id: 'demo', first: 'Ahmad',  last: 'Al-Rashid',   email: 'demo@reparo.com',       phone: '+971500000001' },
    { id: 'c2',   first: 'Sara',   last: 'Al-Mansouri', email: 'sara@reparo-demo.com',  phone: '+971502345678' },
    { id: 'c3',   first: 'Khalid', last: 'Hassan',      email: 'khalid@email.com',      phone: '+971503456789' },
    { id: 'c4',   first: 'Fatima', last: 'Nasser',      email: 'fatima@email.com',      phone: '+971504567890' },
    { id: 'c5',   first: 'Omar',   last: 'Al-Zaabi',    email: 'omar@email.com',        phone: '+971505678901' },
  ];

  const insertUser = db.prepare(`
    INSERT INTO users(id,first_name,last_name,email,phone,password,role,status,created_at,last_active)
    VALUES(?,?,?,?,?,?,?,?,datetime('now',?),datetime('now',?))`);

  const adminHash = bcrypt.hashSync('Admin1234!', 10);
  insertUser.run('admin1','System','Admin','admin@reparo.com','+971501111111',adminHash,'Admin','Active','-365 days','-1 hours');

  const engHash = bcrypt.hashSync('Eng1234!', 10);
  for (const e of engineers) {
    insertUser.run(e.id, e.first, e.last, e.email, e.phone, engHash, 'Engineer', e.status || 'Active', '-180 days', '-2 hours');
  }

  const custHash = bcrypt.hashSync('Demo1234!', 10);
  for (const c of customers) {
    insertUser.run(c.id, c.first, c.last, c.email, c.phone, custHash, 'Customer', 'Active', '-45 days', '-1 hours');
  }

  const devices  = [
    { type:'Smartphone',     brand:'Apple',   model:'iPhone 15 Pro' },
    { type:'Laptop',         brand:'Dell',    model:'XPS 15' },
    { type:'Tablet',         brand:'Samsung', model:'Galaxy Tab S9' },
    { type:'Smartphone',     brand:'Samsung', model:'Galaxy S24 Ultra' },
    { type:'Laptop',         brand:'HP',      model:'Spectre x360' },
    { type:'Desktop PC',     brand:'Lenovo',  model:'ThinkCentre M90q' },
    { type:'Smartwatch',     brand:'Apple',   model:'Watch Ultra 2' },
    { type:'Gaming Console', brand:'Sony',    model:'PlayStation 5' },
    { type:'Smartphone',     brand:'Huawei',  model:'P60 Pro' },
    { type:'Laptop',         brand:'Apple',   model:'MacBook Air M3' },
  ];
  const issues   = ['Screen / Display','Battery','Charging / Power','Speaker / Microphone','Camera','Software / OS','Physical Damage','Water Damage','Connectivity','Keyboard / Trackpad'];
  const statuses = ['Received','Diagnosed','In Progress','Awaiting Parts','Ready','Dispatched'];
  const pris     = ['Low','Medium','High'];
  const rnd      = arr => arr[Math.floor(Math.random() * arr.length)];

  const insertSvc = db.prepare(`
    INSERT INTO services(id,cust_id,cust_name,cust_phone,cust_email,device_type,brand,model,serial,issue_cat,issue_desc,diagnosis,priority,status,engineer_id,engineer_name,cost,eta,dispatch_at,last_activity,created_at,source,notes,accessories,warranty)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now',?),?,datetime('now',?),datetime('now',?),?,?,?,?)`);

  const insertAct = db.prepare(`
    INSERT INTO service_activity(service_id,text,type,by_user,created_at) VALUES(?,?,?,?,datetime('now',?))`);

  let svcNum = 1;
  for (let i = 0; i < 24; i++) {
    const cust = rnd(customers);
    const dev  = rnd(devices);
    const eng  = rnd(engineers);
    const st   = rnd(statuses);
    const pri  = rnd(pris);
    const cost = Math.floor(Math.random() * 1750) + 50;
    const daysAgo   = -(Math.floor(Math.random() * 45) + 1);
    const etaDays   = String(Math.floor(Math.random() * 10) - 2) + ' days';
    const dispDays  = st === 'Dispatched' ? `${-(Math.floor(Math.random()*7)+1)} days` : null;
    const id = 'RPR-' + String(svcNum++).padStart(4,'0');

    insertSvc.run(
      id, cust.id, `${cust.first} ${cust.last}`, cust.phone, cust.email,
      dev.type, dev.brand, dev.model, `SN${Math.floor(Math.random()*900000)+100000}`,
      rnd(issues), 'Customer reported the issue. Device needs inspection.',
      'Initial visual inspection completed.',
      pri, st, eng.id, `Eng. ${eng.first} ${eng.last}`, cost,
      etaDays,
      dispDays ? `datetime('now','${dispDays}')` : null,
      `${daysAgo} days`, `${daysAgo} days`,
      'walk-in', '', 'Charger', 'Not sure'
    );

    insertAct.run(id, 'Service intake recorded', 'intake', 'System', `${daysAgo} days`);
    if (['Diagnosed','In Progress','Awaiting Parts','Ready','Dispatched'].includes(st))
      insertAct.run(id, `Device diagnosed by ${eng.first} ${eng.last}`, 'diagnosis', `${eng.first} ${eng.last}`, `${daysAgo + 0.1} days`);
    if (['In Progress','Awaiting Parts','Ready','Dispatched'].includes(st))
      insertAct.run(id, 'Repair work started', 'update', `${eng.first} ${eng.last}`, `${daysAgo + 0.3} days`);
    if (st === 'Dispatched')
      insertAct.run(id, 'Device dispatched to customer', 'dispatch', 'Front Desk', `${dispDays} days`);
  }

  db.prepare(`INSERT INTO announcements(id,text,type,audience) VALUES(?,?,?,?)`)
    .run('ann1','Service center open Sat–Thu, 9am–6pm. Express service +AED 50.','info','All users');
  db.prepare(`INSERT INTO announcements(id,text,type,audience) VALUES(?,?,?,?)`)
    .run('ann2','Average turnaround this week: 2.4 days — fastest ever!','success','All users');

  db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run('System seeded with demo data','system','localhost');
  db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run('User admin@reparo.com created','system','localhost');
}

module.exports = { seed };
