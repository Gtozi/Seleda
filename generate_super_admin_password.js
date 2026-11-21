/**
 * Generate bcrypt password hash for super admin
 * Run this with: node generate_super_admin_password.js
 */

import bcrypt from 'bcryptjs';

const password = 'SuperAdmin123!'; // Change this to your desired password
const saltRounds = 10;

bcrypt.hash(password, saltRounds, (err, hash) => {
  if (err) {
    console.error('Error generating hash:', err);
    return;
  }
  
  console.log('Password Hash:', hash);
  console.log('\nUse this hash in the SQL script to create the super admin account.');
  console.log('Email: superadmin@hotel.com');
  console.log('Password:', password);
});
