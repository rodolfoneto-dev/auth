process.env.JWT_SECRET = process.env.JWT_SECRET || 'supersecret_for_tests';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const Lead = require('../models/Lead');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

jest.mock('../models/Lead');
jest.mock('../models/User');
jest.mock('../models/AuditLog');
jest.mock('../services/email');

describe('Auth Service - Lead Capture & Admin Endpoints', () => {
  const adminToken = jwt.sign(
    { sub: 'admin-123', id: 'admin-123', role: 'admin', emailVerified: true },
    process.env.JWT_SECRET
  );

  const studentToken = jwt.sign(
    { sub: 'student-123', id: 'student-123', role: 'aluno', emailVerified: true },
    process.env.JWT_SECRET
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/leads', () => {
    it('deve registrar um novo lead com sucesso', async () => {
      const mockLeadData = {
        name: 'Carlos Aluno',
        phone: '(11) 98765-4321',
        email: 'carlos@example.com',
        level: 'Básico',
        plan: 'pro',
        verifiedHuman: true,
      };

      Lead.prototype.save = jest.fn().mockResolvedValue(mockLeadData);

      const res = await request(app)
        .post('/auth/leads')
        .send(mockLeadData);

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('Lead registrado com sucesso');
    });

    it('deve rejeitar cadastro de lead sem campos obrigatórios', async () => {
      const res = await request(app)
        .post('/auth/leads')
        .send({ name: 'Incompleto' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /auth/admin/leads', () => {
    it('deve permitir que administradores listem os leads', async () => {
      const mockLeads = [
        { _id: '1', name: 'Lead 1', email: 'lead1@test.com', status: 'new' },
        { _id: '2', name: 'Lead 2', email: 'lead2@test.com', status: 'contacted' },
      ];

      Lead.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockLeads),
      });

      const res = await request(app)
        .get('/auth/admin/leads')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.leads).toHaveLength(2);
    });

    it('deve proibir que alunos acessem a listagem de leads', async () => {
      const res = await request(app)
        .get('/auth/admin/leads')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /auth/admin/leads/:id/status', () => {
    it('deve atualizar o status de um lead para matriculado', async () => {
      const mockLead = {
        _id: 'lead-1',
        name: 'Lead Alvo',
        email: 'lead@test.com',
        phone: '11999999999',
        plan: 'pro',
        status: 'new',
        save: jest.fn().mockResolvedValue(true),
      };
      Lead.findById = jest.fn().mockResolvedValue(mockLead);

      const res = await request(app)
        .patch('/auth/admin/leads/lead-1/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'enrolled', notes: 'Matrícula efetuada' });

      expect(res.status).toBe(200);
      expect(res.body.lead.status).toBe('enrolled');
      expect(mockLead.save).toHaveBeenCalled();
    });
  });

  describe('DELETE /auth/admin/leads/:id', () => {
    it('deve excluir um lead com sucesso', async () => {
      const mockLead = {
        _id: 'lead-1',
        name: 'Lead Alvo',
        email: 'lead@test.com',
        phone: '11999999999',
        status: 'new',
      };
      Lead.findByIdAndDelete = jest.fn().mockResolvedValue(mockLead);

      const res = await request(app)
        .delete('/auth/admin/leads/lead-1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Lead excluído com sucesso');
    });
  });

  describe('GET /auth/admin/users', () => {
    it('deve listar usuários cadastrados para o admin', async () => {
      const mockUsers = [
        { _id: 'u1', name: 'Admin Master', role: 'admin' },
        { _id: 'u2', name: 'Aluno Fox', role: 'aluno' },
      ];

      User.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue(mockUsers),
        }),
      });

      const res = await request(app)
        .get('/auth/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
    });
  });

  describe('PATCH /auth/admin/users/:id/role', () => {
    it('deve atualizar o papel do usuário para professor', async () => {
      const mockUser = {
        _id: 'u2',
        name: 'Aluno Alvo',
        email: 'alvo@test.com',
        role: 'aluno',
        save: jest.fn().mockResolvedValue(true),
      };
      User.findById = jest.fn().mockResolvedValue(mockUser);

      const res = await request(app)
        .patch('/auth/admin/users/u2/role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'professor' });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('professor');
      expect(mockUser.save).toHaveBeenCalled();
    });

    it('deve bloquear tentativa de auto-modificação de papel pelo admin logado', async () => {
      const res = await request(app)
        .patch('/auth/admin/users/admin-123/role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'aluno' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_SELF_MODIFICATION');
    });

    it('deve proteger contas de administrador contra rebaixamento direto', async () => {
      const mockAdmin = {
        _id: 'admin-999',
        name: 'Outro Admin',
        email: 'admin2@test.com',
        role: 'admin',
        save: jest.fn().mockResolvedValue(true),
      };
      User.findById = jest.fn().mockResolvedValue(mockAdmin);

      const res = await request(app)
        .patch('/auth/admin/users/admin-999/role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'aluno' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ADMIN_ROLE_PROTECTED');
    });
  });

  describe('PATCH /auth/admin/users/:id/status', () => {
    it('deve atualizar o status do usuário para suspended e revogar sessões', async () => {
      const mockUser = {
        _id: 'u2',
        name: 'Aluno Alvo',
        email: 'alvo@test.com',
        role: 'aluno',
        status: 'active',
        emailVerified: true,
        revokeAllRefreshTokens: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };
      User.findById = jest.fn().mockResolvedValue(mockUser);

      const res = await request(app)
        .patch('/auth/admin/users/u2/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'suspended' });

      expect(res.status).toBe(200);
      expect(res.body.user.status).toBe('suspended');
      expect(mockUser.revokeAllRefreshTokens).toHaveBeenCalled();
      expect(mockUser.save).toHaveBeenCalled();
    });

    it('deve bloquear tentativa de auto-suspensão pelo admin logado', async () => {
      const res = await request(app)
        .patch('/auth/admin/users/admin-123/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'suspended' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_SELF_SUSPENSION');
    });

    it('deve rejeitar status inválido com 400', async () => {
      const res = await request(app)
        .patch('/auth/admin/users/u2/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'invalid_status' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /auth/admin/audit-logs', () => {
    it('deve permitir que administradores listem logs de auditoria', async () => {
      const mockLogs = [
        {
          _id: 'log1',
          actorName: 'Admin Master',
          actorEmail: 'admin@englishfox.com.br',
          targetUserName: 'Aluno Alvo',
          targetUserEmail: 'alvo@test.com',
          action: 'STATUS_CHANGE',
          previousValue: 'active',
          newValue: 'suspended',
          details: 'Status alterado de active para suspended',
          createdAt: new Date(),
        },
      ];

      AuditLog.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(mockLogs),
        }),
      });

      const res = await request(app)
        .get('/auth/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.logs[0].action).toBe('STATUS_CHANGE');
    });

    it('deve proibir que alunos acessem logs de auditoria', async () => {
      const res = await request(app)
        .get('/auth/admin/audit-logs')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('BLOCK_REGISTRATION (Controle de Staging)', () => {
    afterEach(() => {
      delete process.env.BLOCK_REGISTRATION;
    });

    it('deve bloquear /auth/register com 403 e REGISTRATION_DISABLED quando BLOCK_REGISTRATION=1', async () => {
      process.env.BLOCK_REGISTRATION = '1';

      const res = await request(app)
        .post('/auth/register')
        .send({
          name: 'Tentativa Aluno',
          email: 'staging@test.com',
          password: 'senhaSegura123@',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('REGISTRATION_DISABLED');
      expect(res.body.error.message).toContain('temporariamente suspensos');
    });

    it('deve permitir cadastro quando BLOCK_REGISTRATION não estiver ativo', async () => {
      delete process.env.BLOCK_REGISTRATION;

      User.prototype.generateEmailVerificationToken = jest.fn().mockReturnValue('raw-verify-token');
      User.prototype.generateRefreshToken = jest.fn().mockReturnValue('raw-refresh-token');
      User.prototype._id = { toString: () => 'new-user-123' };
      User.prototype.role = 'aluno';
      User.prototype.save = jest.fn().mockResolvedValue(true);

      const res = await request(app)
        .post('/auth/register')
        .send({
          name: 'Aluno Permitido',
          email: 'permitido@test.com',
          password: 'senhaSegura123@',
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('sucesso');
    });
  });
});
