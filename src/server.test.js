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

  it('deve retornar o JSON cru da especificação OpenAPI em /docs.json', async () => {
    const res = await request(app).get('/docs.json');
    expect(res.statusCode).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.body.info.title).toBe('Auth Service API');
    expect(res.body.paths['/auth/register']).toBeDefined();
    expect(res.body.paths['/auth/login']).toBeDefined();
    expect(res.body.paths['/auth/validate']).toBeDefined();
    expect(res.body.paths['/auth/me']).toBeDefined();
  });
});

