const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
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
    it('deve registrar usuário com sucesso, retornar 201, token JWT e sem senha', async () => {
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
      expect(res.body.user.password).toBeUndefined();

      // Valida payload do token JWT
      const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
      expect(decoded.id).toBe(res.body.user._id);
      expect(decoded.role).toBe('professor');
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
});
