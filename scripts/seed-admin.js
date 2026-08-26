require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const User = require('../src/models/User');

const ADMIN_NAME = process.env.ADMIN_NAME || 'Master Admin UP!Experience';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function seedAdmin() {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error('❌ [Seed Admin] Erro: MONGO_URI não configurada no .env.');
    process.exit(1);
  }

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('❌ [Seed Admin] Erro: ADMIN_EMAIL e ADMIN_PASSWORD são obrigatórios e devem estar definidos no .env.');
    process.exit(1);
  }

  try {
    console.log(`[Seed Admin] Conectando ao MongoDB...`);
    await mongoose.connect(mongoUri);

    const cleanEmail = ADMIN_EMAIL.trim().toLowerCase();
    let admin = await User.findOne({ email: cleanEmail });

    if (admin) {
      console.log(`[Seed Admin] Usuário ${cleanEmail} já existe. Atualizando role para 'admin' e redefinindo credencial a partir do .env...`);
      admin.name = ADMIN_NAME;
      admin.role = 'admin';
      admin.emailVerified = true;
      admin.password = ADMIN_PASSWORD; // O pre-save hook fará o hash seguro com bcrypt
      await admin.save();
      console.log(`[Seed Admin] ✅ Administrador atualizado com sucesso! ID: ${admin._id}`);
    } else {
      console.log(`[Seed Admin] Criando novo administrador ${cleanEmail} a partir do .env...`);
      admin = new User({
        name: ADMIN_NAME,
        email: cleanEmail,
        password: ADMIN_PASSWORD,
        role: 'admin',
        emailVerified: true,
      });
      await admin.save();
      console.log(`[Seed Admin] ✅ Administrador criado com sucesso! ID: ${admin._id}`);
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[Seed Admin] ❌ Erro ao executar seed de admin:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  seedAdmin();
}

module.exports = seedAdmin;
