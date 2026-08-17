const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const app = require('../server');
const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test_auth_db';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';

describe('Auth Routes - Integration Tests', () => {
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

  describe('POST /auth/register', () => {
    it('deve registrar usuário com sucesso, retornar 201, token JWT, emailVerified=false e sem senha', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          name: 'Lucas Pereira',
          email: 'lucas@example.com',
          password: 'password123',
          role: 'professor',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.name).toBe('Lucas Pereira');
      expect(res.body.user.email).toBe('lucas@example.com');
      expect(res.body.user.role).toBe('professor');
      expect(res.body.user.emailVerified).toBe(false);
      expect(res.body.user.password).toBeUndefined();

      // Valida que o token de confirmação foi salvo no banco com hash
      const userInDb = await User.findOne({ email: 'lucas@example.com' });
      expect(userInDb.emailVerificationTokenHash).toBeDefined();
      expect(userInDb.emailVerificationExpiresAt).toBeDefined();

      // Valida payload do token JWT
      const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
      expect(decoded.id).toBe(res.body.user._id);
      expect(decoded.role).toBe('professor');
      expect(decoded.emailVerified).toBe(false);
    });

    it('deve retornar 400 se faltar algum campo obrigatório', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'incompleto@example.com',
          password: 'password123',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Nome, email e senha são obrigatórios');
    });

    it('deve retornar 409 se o email já estiver cadastrado', async () => {
      await request(app)
        .post('/auth/register')
        .send({
          name: 'Primeiro Cadastro',
          email: 'repetido@example.com',
          password: 'password123',
        });

      const res = await request(app)
        .post('/auth/register')
        .send({
          name: 'Segundo Cadastro',
          email: 'repetido@example.com',
          password: 'password456',
        });

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('Email já cadastrado');
    });
  });

  describe('GET /auth/verify-email', () => {
    it('deve verificar o e-mail com sucesso usando token válido', async () => {
      const user = new User({
        name: 'Aluno Para Verificar',
        email: 'verificar@example.com',
        password: 'password123',
      });
      const rawToken = user.generateEmailVerificationToken();
      await user.save();

      const res = await request(app).get(`/auth/verify-email?token=${rawToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('E-mail verificado com sucesso!');

      // Verifica no banco se emailVerified foi atualizado para true
      const updatedUser = await User.findById(user._id);
      expect(updatedUser.emailVerified).toBe(true);
      expect(updatedUser.emailVerificationTokenHash).toBeNull();
      expect(updatedUser.emailVerificationExpiresAt).toBeNull();
    });

    it('deve retornar 400 para token inválido ou inexistente', async () => {
      const res = await request(app).get('/auth/verify-email?token=token_invalido_123');

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Token de verificação inválido ou expirado');
    });

    it('deve retornar 400 se o token não for informado', async () => {
      const res = await request(app).get('/auth/verify-email');

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Token de verificação é obrigatório');
    });

    it('deve retornar 400 para token expirado', async () => {
      const user = new User({
        name: 'Expirado Teste',
        email: 'expirado@example.com',
        password: 'password123',
      });
      const rawToken = user.generateEmailVerificationToken();
      // Força data de expiração no passado
      user.emailVerificationExpiresAt = new Date(Date.now() - 1000 * 60);
      await user.save();

      const res = await request(app).get(`/auth/verify-email?token=${rawToken}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Token de verificação inválido ou expirado');
    });
  });

  describe('POST /auth/resend-verification', () => {
    it('deve reenviar token de confirmação para usuário não verificado', async () => {
      const user = new User({
        name: 'Reenvio Teste',
        email: 'reenvio@example.com',
        password: 'password123',
      });
      await user.save();

      const res = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'reenvio@example.com' });

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toContain('Se o e-mail estiver cadastrado');

      const updatedUser = await User.findOne({ email: 'reenvio@example.com' });
      expect(updatedUser.emailVerificationTokenHash).toBeDefined();
    });

    it('deve retornar 400 se o email não for informado', async () => {
      const res = await request(app).post('/auth/resend-verification').send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Email é obrigatório');
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/auth/register')
        .send({
          name: 'Usuario Login',
          email: 'login@example.com',
          password: 'secretPassword123',
          role: 'aluno',
        });
    });

    it('deve autenticar usuário com credenciais corretas e retornar 200 com token', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'login@example.com',
          password: 'secretPassword123',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('login@example.com');
      expect(res.body.user.password).toBeUndefined();

      const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
      expect(decoded.role).toBe('aluno');
    });

    it('deve retornar 401 com mensagem genérica se a senha estiver errada', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'login@example.com',
          password: 'wrongpassword',
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Credenciais inválidas');
    });

    it('deve retornar 401 com mensagem genérica se o email não existir', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'naoexiste@example.com',
          password: 'secretPassword123',
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Credenciais inválidas');
    });

    it('deve retornar 400 se email ou senha não forem fornecidos', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'login@example.com',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Email e senha são obrigatórios');
    });
  });

  describe('GET /auth/validate', () => {
    it('deve validar token correto e retornar 200 com payload do usuário', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({
          name: 'Professor Teste',
          email: 'prof@example.com',
          password: 'password123',
          role: 'professor',
        });

      const token = registerRes.body.token;

      const validateRes = await request(app)
        .get('/auth/validate')
        .set('Authorization', `Bearer ${token}`);

      expect(validateRes.statusCode).toBe(200);
      expect(validateRes.body.valid).toBe(true);
      expect(validateRes.body.user.id).toBe(registerRes.body.user._id);
      expect(validateRes.body.user.role).toBe('professor');
      expect(validateRes.body.user.emailVerified).toBe(false);
    });

    it('deve retornar 401 ao tentar validar sem token', async () => {
      const res = await request(app).get('/auth/validate');

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Token não fornecido ou formato inválido');
    });
  });

  describe('GET /auth/me', () => {
    it('deve retornar dados completos do perfil do usuário autenticado', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({
          name: 'Aluno Teste',
          email: 'aluno@example.com',
          password: 'password123',
          role: 'aluno',
        });

      const token = registerRes.body.token;

      const meRes = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meRes.statusCode).toBe(200);
      expect(meRes.body.user.name).toBe('Aluno Teste');
      expect(meRes.body.user.email).toBe('aluno@example.com');
      expect(meRes.body.user.role).toBe('aluno');
      expect(meRes.body.user.emailVerified).toBe(false);
      expect(meRes.body.user.password).toBeUndefined();
    });
  });
});
