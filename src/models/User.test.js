const User = require('./User');
const bcrypt = require('bcrypt');

describe('User Model', () => {
  it('deve validar um usuário válido com valores padrão (emailVerified=false)', async () => {
    const validUserData = {
      name: 'João Silva',
      email: 'joao@example.com',
      password: 'secretpassword',
    };

    const user = new User(validUserData);
    await expect(user.validate()).resolves.toBeUndefined();
    expect(user.role).toBe('aluno');
    expect(user.emailVerified).toBe(false);
    expect(user.emailVerificationTokenHash).toBeNull();
    expect(user.emailVerificationExpiresAt).toBeNull();
    expect(user.passwordResetTokenHash).toBeNull();
    expect(user.passwordResetExpiresAt).toBeNull();
    expect(user.refreshTokens).toEqual([]);
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

  it('deve gerar token de verificação criptografado e data de expiração', () => {
    const user = new User({
      name: 'Teste',
      email: 'teste@example.com',
      password: 'secretpassword',
    });

    const rawToken = user.generateEmailVerificationToken();

    expect(rawToken).toBeDefined();
    expect(typeof rawToken).toBe('string');
    expect(rawToken.length).toBe(64); // 32 bytes hex
    expect(user.emailVerificationTokenHash).toBeDefined();
    expect(user.emailVerificationTokenHash).not.toBe(rawToken);
    expect(user.emailVerificationExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('deve gerar token de redefinição de senha criptografado e data de expiração', () => {
    const user = new User({
      name: 'Teste',
      email: 'teste@example.com',
      password: 'secretpassword',
    });

    const rawToken = user.generatePasswordResetToken();

    expect(rawToken).toBeDefined();
    expect(typeof rawToken).toBe('string');
    expect(rawToken.length).toBe(64); // 32 bytes hex
    expect(user.passwordResetTokenHash).toBeDefined();
    expect(user.passwordResetTokenHash).not.toBe(rawToken);
    expect(user.passwordResetExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('deve gerenciar refresh tokens com rotação e revogação', () => {
    const user = new User({
      name: 'Teste',
      email: 'teste@example.com',
      password: 'secretpassword',
    });

    const token1 = user.generateRefreshToken();
    expect(token1).toBeDefined();
    expect(user.refreshTokens.length).toBe(1);
    expect(user.refreshTokens[0].revokedAt).toBeNull();

    const token2 = user.generateRefreshToken();
    expect(user.refreshTokens.length).toBe(2);

    // Revoga token1
    const revoked = user.revokeRefreshToken(token1, token2);
    expect(revoked).toBe(true);
    expect(user.refreshTokens[0].revokedAt).not.toBeNull();
    expect(user.refreshTokens[0].replacedByTokenHash).toBeDefined();

    // Revoga todos
    user.revokeAllRefreshTokens();
    expect(user.refreshTokens[1].revokedAt).not.toBeNull();
  });

  it('deve remover a senha, dados de tokens e refreshTokens no retorno toJSON', () => {
    const user = new User({
      name: 'Teste',
      email: 'teste@example.com',
      password: 'secretpassword',
    });
    user.generateEmailVerificationToken();
    user.generatePasswordResetToken();
    user.generateRefreshToken();

    const json = user.toJSON();
    expect(json.password).toBeUndefined();
    expect(json.emailVerificationTokenHash).toBeUndefined();
    expect(json.emailVerificationExpiresAt).toBeUndefined();
    expect(json.passwordResetTokenHash).toBeUndefined();
    expect(json.passwordResetExpiresAt).toBeUndefined();
    expect(json.refreshTokens).toBeUndefined();
    expect(json.__v).toBeUndefined();
    expect(json.email).toBe('teste@example.com');
    expect(json.emailVerified).toBe(false);
  });
});
