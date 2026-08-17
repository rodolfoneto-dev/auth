const jwt = require('jsonwebtoken');
const { authenticate, checkRole } = require('./auth');

describe('Auth Middlewares', () => {
  const secret = 'test_secret_jwt';
  process.env.JWT_SECRET = secret;

  describe('authenticate middleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = { headers: {} };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      next = jest.fn();
    });

    it('deve retornar 401 se o header Authorization estiver ausente', () => {
      authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Token não fornecido ou formato inválido',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 401 se o formato não começar com Bearer', () => {
      req.headers.authorization = 'Basic token123';
      authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Token não fornecido ou formato inválido',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 401 se o token for inválido', () => {
      req.headers.authorization = 'Bearer token-falso-invalido';
      authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Token inválido' });
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 401 se o token estiver expirado', () => {
      const expiredToken = jwt.sign(
        { id: '123', role: 'aluno' },
        secret,
        { expiresIn: '-1s' }
      );
      req.headers.authorization = `Bearer ${expiredToken}`;
      authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Token expirado' });
      expect(next).not.toHaveBeenCalled();
    });

    it('deve injetar req.user e chamar next() para token válido', () => {
      const validToken = jwt.sign(
        { id: 'user_id_123', role: 'professor' },
        secret,
        { expiresIn: '1h' }
      );
      req.headers.authorization = `Bearer ${validToken}`;
      authenticate(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user.id).toBe('user_id_123');
      expect(req.user.role).toBe('professor');
      expect(next).toHaveBeenCalled();
    });
  });

  describe('checkRole middleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = { user: null };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      next = jest.fn();
    });

    it('deve retornar 401 se req.user não estiver presente', () => {
      const middleware = checkRole('admin');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Não autenticado' });
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 403 se o role do usuário não for permitido', () => {
      req.user = { id: '123', role: 'aluno' };
      const middleware = checkRole('professor', 'admin');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Acesso negado para o seu perfil',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('deve chamar next() se o role do usuário for permitido', () => {
      req.user = { id: '123', role: 'admin' };
      const middleware = checkRole('professor', 'admin');
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
