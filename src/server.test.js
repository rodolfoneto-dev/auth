const request = require('supertest');
const app = require('./server');

describe('Health check', () => {
  it('deve retornar status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('CORS Configuration', () => {
  it('deve responder aos headers de CORS em requisições de origem cruzada', async () => {
    const res = await request(app)
      .options('/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  it('deve incluir o header access-control-allow-origin em requisições GET padrão', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:3000');

    expect(res.headers['access-control-allow-origin']).toBeDefined();
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
    expect(res.body.paths['/auth/register']).toBeDefined();
    expect(res.body.paths['/auth/verify-email']).toBeDefined();
    expect(res.body.paths['/auth/resend-verification']).toBeDefined();
    expect(res.body.paths['/auth/login']).toBeDefined();
    expect(res.body.paths['/auth/validate']).toBeDefined();
    expect(res.body.paths['/auth/me']).toBeDefined();
  });

  it('deve retornar a documentação em formato Markdown em /docs.md', async () => {
    const res = await request(app).get('/docs.md');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.text).toContain('# Auth Service API');
    expect(res.text).toContain('/auth/register');
    expect(res.text).toContain('/auth/verify-email');
    expect(res.text).toContain('/auth/resend-verification');
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
