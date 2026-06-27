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

export function mapLoginResponse(dto: LoginResponseDTO): LoginAutenticado {
  return {
    token: dto.token,
    usuario: mapUsuarioResponse(dto.usuario),
  };
}
