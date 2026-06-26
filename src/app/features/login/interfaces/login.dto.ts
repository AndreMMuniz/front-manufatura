export interface LoginRequestDTO {
  login: string;
  senha: string;
}

export interface UsuarioDTO {
  id: string;
  nome: string;
  login: string;
  permissoes: Array<string>;
}

export interface LoginResponseDTO {
  token: string;
  usuario: UsuarioDTO;
}
