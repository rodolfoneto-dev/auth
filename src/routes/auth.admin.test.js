process.env.JWT_SECRET = process.env.JWT_SECRET || 'supersecret_for_tests';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const Lead = require('../models/Lead');
const User = require('../models/User');

jest.mock('../models/Lead');
jest.mock('../models/User');
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
      const updatedLead = { _id: 'lead-1', status: 'enrolled', notes: 'Matrícula efetuada' };
      Lead.findByIdAndUpdate = jest.fn().mockResolvedValue(updatedLead);

      const res = await request(app)
        .patch('/auth/admin/leads/lead-1/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'enrolled', notes: 'Matrícula efetuada' });

      expect(res.status).toBe(200);
      expect(res.body.lead.status).toBe('enrolled');
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
      const updatedUser = { _id: 'u2', role: 'professor' };
      User.findByIdAndUpdate = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(updatedUser),
      });

      const res = await request(app)
        .patch('/auth/admin/users/u2/role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'professor' });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('professor');
    });
  });
});
