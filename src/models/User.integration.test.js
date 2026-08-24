require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const User = require('./User');

const getTestMongoUri = () => {
  if (process.env.TEST_MONGO_URI) return process.env.TEST_MONGO_URI;
  if (process.env.MONGO_URI) {
    return process.env.MONGO_URI.replace(/\/eng_auth_db(\?|$)/, '/eng_auth_test_db$1');
  }
  return 'mongodb://127.0.0.1:27017/test_auth_db';
};

const MONGO_URI = getTestMongoUri();

describe('User Model - Testes de Integração com Banco Real', () => {
  beforeAll(async () => {
    await mongoose.connect(MONGO_URI);
  });

  afterAll(async () => {
    await User.deleteMany({});
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    await User.deleteMany({});
  });

  it('deve salvar usuário no banco e aplicar hash na senha automaticamente', async () => {
    const rawPassword = 'mySecurePassword123';
    const user = new User({
      name: 'Carlos Oliveira',
      email: 'carlos@example.com',
      password: rawPassword,
      role: 'aluno',
    });

    const savedUser = await user.save();
    expect(savedUser._id).toBeDefined();

    // Consulta direta na coleção para verificar hash persistido
    const userInDb = await mongoose.connection.db
      .collection('users')
      .findOne({ _id: savedUser._id });

    expect(userInDb).toBeDefined();
    expect(userInDb.password).not.toBe(rawPassword);
    expect(userInDb.password.startsWith('$2')).toBe(true); // Hash bcrypt
  });

  it('deve impedir criação de dois usuários com mesmo email (índice único)', async () => {
    await User.init(); // Garante que índices do Mongoose estão criados no banco

    const user1 = new User({
      name: 'Usuario 1',
      email: 'duplicado@example.com',
      password: 'password123',
    });
    await user1.save();

    const user2 = new User({
      name: 'Usuario 2',
      email: 'duplicado@example.com',
      password: 'password456',
    });

    await expect(user2.save()).rejects.toThrow();
  });

  it('deve buscar usuário salvo por email', async () => {
    const user = new User({
      name: 'Mariana Costa',
      email: 'mariana@example.com',
      password: 'password123',
      role: 'professor',
    });
    await user.save();

    const foundUser = await User.findOne({ email: 'mariana@example.com' });
    expect(foundUser).not.toBeNull();
    expect(foundUser.name).toBe('Mariana Costa');
    expect(foundUser.role).toBe('professor');
  });
});
