export interface User {
  username: string;
}

export interface AuthSession {
  user: User;
  authenticatedAt: Date;
}
