const User = require('./User');
const bcrypt = require('bcrypt');

describe('User Model', () => {
  it('deve validar um usuário válido com valores padrão', async () => {
    const validUserData = {
      name: 'João Silva',
      email: 'joao@example.com',
      password: 'secretpassword',
    };

    const user = new User(validUserData);
    await expect(user.validate()).resolves.toBeUndefined();
    expect(user.role).toBe('aluno');
  });

  it('deve falhar se campos obrigatórios estiverem ausentes', async () => {
    const user = new User({});
    await expect(user.validate()).rejects.toThrow();
  });

  it('deve rejeitar formato de email inválido', async () => {
    const user = new User({
      name: 'Teste',
      email: 'email-invalido',
      password: 'secretpassword',
    });

    await expect(user.validate()).rejects.toThrow('Formato de email inválido');
  });

  it('deve rejeitar papel (role) não permitido', async () => {
    const user = new User({
      name: 'Teste',
      email: 'teste@example.com',
      password: 'secretpassword',
      role: 'superusuario',
    });

    await expect(user.validate()).rejects.toThrow();
  });

  it('deve aceitar papéis válidos: aluno, professor, admin', async () => {
    for (const role of ['aluno', 'professor', 'admin']) {
      const user = new User({
        name: 'Teste',
        email: `teste.${role}@example.com`,
        password: 'secretpassword',
        role,
      });

      await expect(user.validate()).resolves.toBeUndefined();
      expect(user.role).toBe(role);
    }
  });

  it('deve rejeitar senha com menos de 6 caracteres', async () => {
    const user = new User({
      name: 'Teste',
      email: 'teste@example.com',
      password: '123',
    });

    await expect(user.validate()).rejects.toThrow('Senha deve ter no mínimo 6 caracteres');
  });

  it('deve comparar senha com sucesso usando comparePassword', async () => {
    const plainPassword = 'mySecretPassword123';
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const user = new User({
      name: 'Teste',
      email: 'teste@example.com',
      password: hashedPassword,
    });

    const isMatch = await user.comparePassword(plainPassword);
    const isWrongMatch = await user.comparePassword('wrongpassword');

    expect(isMatch).toBe(true);
    expect(isWrongMatch).toBe(false);
  });

  it('deve remover a senha no retorno toJSON', () => {
    const user = new User({
      name: 'Teste',
      email: 'teste@example.com',
      password: 'secretpassword',
    });

    const json = user.toJSON();
    expect(json.password).toBeUndefined();
    expect(json.email).toBe('teste@example.com');
  });
});
