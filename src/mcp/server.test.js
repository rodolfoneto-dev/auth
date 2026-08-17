const jwt = require('jsonwebtoken');
const { server } = require('./server');

describe('Auth MCP Server', () => {
  process.env.JWT_SECRET = 'test_mcp_jwt_secret';

  it('deve ter o servidor MCP instanciado corretamente', () => {
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe('function');
    expect(typeof server.registerTool).toBe('function');
    expect(typeof server.registerResource).toBe('function');
  });

  it('deve validar token JWT gerado pelo helper', () => {
    const token = jwt.sign({ id: 'user_mcp_1', role: 'professor' }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.id).toBe('user_mcp_1');
    expect(decoded.role).toBe('professor');
  });
});
