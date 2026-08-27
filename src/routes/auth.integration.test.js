const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server');
const User = require('../models/User');

const getTestMongoUri = () => {
  if (process.env.TEST_MONGO_URI) return process.env.TEST_MONGO_URI;
  if (process.env.MONGO_URI) {
    return process.env.MONGO_URI.replace(/\/eng_auth_db(\?|$)/, '/eng_auth_test_db$1');
  }
  return 'mongodb://127.0.0.1:27017/test_auth_db';
};

const MONGO_URI = getTestMongoUri();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';

describe('Auth Routes - Integration Tests', () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGO_URI);
    }
  });

  afterAll(async () => {
    await User.deleteMany({});
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    await User.deleteMany({});
  });

  describe('POST /auth/register', () => {
    it('deve registrar usuário com sucesso, retornar 201, token JWT, refreshToken, emailVerified=false e sem senha', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          name: 'Lucas Pereira',
          email: 'Lucas@Example.COM ',
          password: 'password123',
          role: 'professor',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
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
      expect(userInDb.refreshTokens.length).toBe(1);

      // Valida payload do token JWT
      const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
      expect(decoded.id).toBe(res.body.user._id);
      expect(decoded.sub).toBe(res.body.user._id);
      expect(decoded.name).toBe('Lucas Pereira');
      expect(decoded.email).toBe('lucas@example.com');
      expect(decoded.role).toBe('professor');
      expect(decoded.emailVerified).toBe(false);
    });

    it('deve bloquear tentativa de cadastro público com role admin (previne privilege escalation)', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          name: 'Hacker Admin',
          email: 'hacker@example.com',
          password: 'password123',
          role: 'admin',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.user.role).toBe('aluno'); // Force/default para aluno seguro
    });

    it('deve retornar 400 se faltar algum campo obrigatório', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'incompleto@example.com',
          password: 'password123',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
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
      expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
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

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.emailVerified).toBe(true);
      expect(updatedUser.emailVerificationTokenHash).toBeNull();
      expect(updatedUser.emailVerificationExpiresAt).toBeNull();
    });

    it('deve retornar 400 para token inválido ou inexistente', async () => {
      const res = await request(app).get('/auth/verify-email?token=token_invalido_123');

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    });

    it('deve retornar 400 se o token não for informado', async () => {
      const res = await request(app).get('/auth/verify-email');

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('TOKEN_REQUIRED');
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

    it('deve retornar mensagem neutra mesmo se o e-mail não existir (anti-enumeração)', async () => {
      const res = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'naoexiste@example.com' });

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toContain('Se o e-mail estiver cadastrado');
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

    it('deve autenticar usuário com credenciais corretas e retornar token + refreshToken', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'Login@Example.COM',
          password: 'secretPassword123',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.user.email).toBe('login@example.com');
      expect(res.body.user.password).toBeUndefined();

      const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
      expect(decoded.role).toBe('aluno');
      expect(decoded.name).toBe('Usuario Login');
      expect(decoded.email).toBe('login@example.com');
    });

    it('deve retornar 401 com mensagem genérica se a senha estiver errada', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'login@example.com',
          password: 'wrongpassword',
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('deve retornar 401 com mensagem genérica se o email não existir', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'naoexiste@example.com',
          password: 'secretPassword123',
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('POST /auth/refresh & POST /auth/logout', () => {
    it('deve renovar access token com rotação de refresh token', async () => {
      const reg = await request(app)
        .post('/auth/register')
        .send({
          name: 'Refresh User',
          email: 'refresh@example.com',
          password: 'secretPassword123',
        });

      const initialRefreshToken = reg.body.refreshToken;

      const refreshRes = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: initialRefreshToken });

      expect(refreshRes.statusCode).toBe(200);
      expect(refreshRes.body.token).toBeDefined();
      expect(refreshRes.body.refreshToken).toBeDefined();
      expect(refreshRes.body.refreshToken).not.toBe(initialRefreshToken);

      // Tentativa de reutilizar o token anterior deve disparar detecção de reuso
      const reuseRes = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: initialRefreshToken });

      expect(reuseRes.statusCode).toBe(401);
      expect(reuseRes.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    });

    it('deve revogar refresh token ao fazer logout', async () => {
      const reg = await request(app)
        .post('/auth/register')
        .send({
          name: 'Logout User',
          email: 'logout@example.com',
          password: 'secretPassword123',
        });

      const rt = reg.body.refreshToken;

      const logoutRes = await request(app)
        .post('/auth/logout')
        .send({ refreshToken: rt });

      expect(logoutRes.statusCode).toBe(200);

      // Não deve conseguir dar refresh com token deslogado
      const refreshRes = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: rt });

      expect(refreshRes.statusCode).toBe(401);
    });
  });

  describe('POST /auth/forgot-password & POST /auth/reset-password', () => {
    it('deve solicitar recuperação de senha e resetar senha com sucesso', async () => {
      const user = new User({
        name: 'Reset Teste',
        email: 'reset@example.com',
        password: 'oldPassword123',
      });
      await user.save();

      // Solicitação
      const forgotRes = await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'reset@example.com' });

      expect(forgotRes.statusCode).toBe(200);
      expect(forgotRes.body.message).toContain('instruções para redefinição de senha foram enviadas');

      // Pega token gerado no banco
      const userWithToken = await User.findById(user._id);
      const rawResetToken = userWithToken.generatePasswordResetToken();
      await userWithToken.save();

      // Reset
      const resetRes = await request(app)
        .post('/auth/reset-password')
        .send({
          token: rawResetToken,
          newPassword: 'newSecretPassword123@',
        });

      expect(resetRes.statusCode).toBe(200);
      expect(resetRes.body.success).toBe(true);

      // Login com nova senha deve funcionar
      const loginRes = await request(app)
        .post('/auth/login')
        .send({
          email: 'reset@example.com',
          password: 'newSecretPassword123@',
        });

      expect(loginRes.statusCode).toBe(200);

      // Login com senha antiga deve falhar
      const oldLoginRes = await request(app)
        .post('/auth/login')
        .send({
          email: 'reset@example.com',
          password: 'oldPassword123',
        });

      expect(oldLoginRes.statusCode).toBe(401);
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
      expect(res.body.error.code).toBe('UNAUTHORIZED');
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

  describe('POST /auth/logout-all & POST /auth/change-password', () => {
    it('deve permitir encerrar todas as sessões com /auth/logout-all', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({
          name: 'Multi Session User',
          email: 'multisession@example.com',
          password: 'password123',
        });

      const token = registerRes.body.token;
      const initialRefreshToken = registerRes.body.refreshToken;

      const logoutAllRes = await request(app)
        .post('/auth/logout-all')
        .set('Authorization', `Bearer ${token}`);

      expect(logoutAllRes.statusCode).toBe(200);
      expect(logoutAllRes.body.message).toContain('Todas as sessões foram encerradas');

      // Refresh token anterior deve estar revogado
      const refreshRes = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: initialRefreshToken });

      expect(refreshRes.statusCode).toBe(401);
    });

    it('deve permitir alterar senha com /auth/change-password e invalidar sessões anteriores', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({
          name: 'Change Pwd User',
          email: 'changepwd@example.com',
          password: 'oldSecretPassword123',
        });

      const token = registerRes.body.token;

      // Senha atual errada deve falhar
      const wrongOldRes = await request(app)
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'wrongPassword',
          newPassword: 'newSecretPassword123',
        });

      expect(wrongOldRes.statusCode).toBe(401);

      // Troca com sucesso
      const changeRes = await request(app)
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'oldSecretPassword123',
          newPassword: 'newSecretPassword123',
        });

      expect(changeRes.statusCode).toBe(200);
      expect(changeRes.body.success).toBe(true);

      // Login com nova senha deve funcionar
      const loginNewRes = await request(app)
        .post('/auth/login')
        .send({
          email: 'changepwd@example.com',
          password: 'newSecretPassword123',
        });

      expect(loginNewRes.statusCode).toBe(200);
    });

    it('deve suportar rememberMe no login definindo expiração curta ou longa', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({
          name: 'Remember User',
          email: 'remember@example.com',
          password: 'password123',
        });

      // Login com rememberMe: false
      const loginShortRes = await request(app)
        .post('/auth/login')
        .send({
          email: 'remember@example.com',
          password: 'password123',
          rememberMe: false,
        });

      expect(loginShortRes.statusCode).toBe(200);
      const userDb = await User.findOne({ email: 'remember@example.com' });
      const lastToken = userDb.refreshTokens[userDb.refreshTokens.length - 1];
      const diffHours = (lastToken.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
      expect(diffHours).toBeLessThanOrEqual(25); // ~1 dia
    });
  });
});
