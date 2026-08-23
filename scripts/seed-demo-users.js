require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const User = require('../src/models/User');

const DEMO_USERS = [
  {
    name: 'Master Admin English Fox',
    email: 'admin@englishfox.com',
    password: 'senhaSegura123@',
    role: 'admin',
    emailVerified: true,
  },
  {
    name: 'Prof. Sarah Jenkins',
    email: 'teacher@englishfox.com.br',
    password: 'senhaSegura123@',
    role: 'professor',
    emailVerified: true,
  },
  {
    name: 'Lucas Silva (Aluno Demo)',
    email: 'aluno@englishfox.com.br',
    password: 'senhaSegura123@',
    role: 'aluno',
    emailVerified: true,
  },
];

async function seedDemoUsers() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/englishfox_staging';

  try {
    console.log(`[Seed Demo] Conectando ao MongoDB em ${mongoUri}...`);
    await mongoose.connect(mongoUri);

    for (const demo of DEMO_USERS) {
      const cleanEmail = demo.email.trim().toLowerCase();
      let user = await User.findOne({ email: cleanEmail });

      if (user) {
        user.name = demo.name;
        user.role = demo.role;
        user.emailVerified = true;
        user.password = demo.password; // Hook pre-save fará o hash com bcrypt
        await user.save();
        console.log(`[Seed Demo] ✅ Usuário ${cleanEmail} (${demo.role}) atualizado!`);
      } else {
        user = new User({
          name: demo.name,
          email: cleanEmail,
          password: demo.password,
          role: demo.role,
          emailVerified: true,
        });
        await user.save();
        console.log(`[Seed Demo] ✅ Usuário ${cleanEmail} (${demo.role}) criado com sucesso!`);
      }
    }

    console.log('[Seed Demo] ✨ Todos os usuários demo foram persistidos com sucesso!');
    await mongoose.disconnect();
    if (require.main === module) process.exit(0);
  } catch (err) {
    console.error('[Seed Demo] ❌ Erro ao executar seed:', err);
    if (require.main === module) process.exit(1);
  }
}

if (require.main === module) {
  seedDemoUsers();
}

module.exports = seedDemoUsers;
