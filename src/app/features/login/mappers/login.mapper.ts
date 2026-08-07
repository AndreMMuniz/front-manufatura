import { LoginResponseDTO, UsuarioDTO } from '../interfaces/login.dto';
import { LoginAutenticado, Usuario } from '../models/usuario';

export function mapUsuarioResponse(dto: UsuarioDTO): Usuario {
  return {
    id: dto.id,
    nome: dto.nome,
    login: dto.login,
    permissoes: [...dto.permissoes],
  };
}

export function mapLoginResponse(value: unknown): LoginAutenticado {
  if (!isLoginResponse(value)) {
    throw new Error('Contrato de autenticação inválido.');
  }
  const dto: LoginResponseDTO = value;
  return {
    token: dto.token,
    tokenExpiresAt: dto.tokenExpiresAt,
    ...(dto.offlineSessionExpiresAt
      ? { offlineSessionExpiresAt: dto.offlineSessionExpiresAt }
      : {}),
    usuario: mapUsuarioResponse(dto.usuario),
  };
}

function isLoginResponse(value: unknown): value is LoginResponseDTO {
  if (!isRecord(value) || !isRecord(value['usuario'])) {
    return false;
  }
  const usuario = value['usuario'];
  const tokenExpiration = parseIsoDate(value['tokenExpiresAt']);
  const offlineExpiration = value['offlineSessionExpiresAt'] === undefined
    ? undefined
    : parseIsoDate(value['offlineSessionExpiresAt']);
  return typeof value['token'] === 'string'
    && value['token'].length > 0
    && tokenExpiration !== null
    && (offlineExpiration === undefined
      || (offlineExpiration !== null && offlineExpiration <= tokenExpiration))
    && typeof usuario['id'] === 'string'
    && typeof usuario['nome'] === 'string'
    && typeof usuario['login'] === 'string'
    && Array.isArray(usuario['permissoes'])
    && usuario['permissoes'].every(permission => typeof permission === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIsoDate(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : null;
}
