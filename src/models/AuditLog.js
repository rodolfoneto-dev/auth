const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actorId: {
      type: String,
      required: [true, 'ID do autor é obrigatório'],
    },
    actorName: {
      type: String,
      required: [true, 'Nome do autor é obrigatório'],
      trim: true,
    },
    actorEmail: {
      type: String,
      required: [true, 'Email do autor é obrigatório'],
      trim: true,
      lowercase: true,
    },
    targetUserId: {
      type: String,
      default: '',
    },
    targetType: {
      type: String,
      enum: ['user', 'lead', 'course', 'system'],
      default: 'user',
    },
    targetUserName: {
      type: String,
      default: '',
      trim: true,
    },
    targetUserEmail: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },
    action: {
      type: String,
      enum: {
        values: [
          'STATUS_CHANGE',
          'ROLE_CHANGE',
          'USER_DELETED',
          'LEAD_STATUS_CHANGE',
          'LEAD_DELETED',
          'COURSE_MODERATED',
        ],
        message: 'Ação de auditoria inválida',
      },
      required: [true, 'Tipo de ação é obrigatório'],
    },
    previousValue: {
      type: String,
      default: '',
    },
    newValue: {
      type: String,
      required: [true, 'Novo valor é obrigatório'],
    },
    details: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetUserId: 1 });
auditLogSchema.index({ actorId: 1 });

const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
