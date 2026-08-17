const request = require('supertest');
const app = require('./server');

describe('Health check', () => {
  it('deve retornar status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Swagger Documentation', () => {
  it('deve responder com sucesso na rota /docs/', async () => {
    const res = await request(app).get('/docs/');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('Swagger UI');
  });

  it('deve retornar a documentação em formato Markdown em /docs.md', async () => {
    const res = await request(app).get('/docs.md');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.text).toContain('# Auth Service API');
    expect(res.text).toContain('/auth/register');
    expect(res.text).toContain('/auth/login');
    expect(res.text).toContain('/auth/validate');
    expect(res.text).toContain('/auth/me');
  });

  it('deve renderizar a página de visualização Markdown em /docs/preview', async () => {
    const res = await request(app).get('/docs/preview');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('Auth API - Markdown Docs');
    expect(res.text).toContain('Copiar Markdown para Prompt IA');
  });
});

