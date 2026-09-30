import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, SALT_ROUNDS);
