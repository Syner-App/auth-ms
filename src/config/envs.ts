import 'dotenv/config';

import Joi from 'joi';

interface EnvVars {
    PORT: number;
    DATABASE_URL: string;
    JWT_SECRET: string;
    JWT_EXPIRES_IN: string;
    SUPERADMIN_NAME: string;
    SUPERADMIN_EMAIL: string;
    SUPERADMIN_PASSWORD: string;
}

const envsSchema = Joi.object({
    PORT: Joi.number().required(),
    DATABASE_URL: Joi.string().required(),
    JWT_SECRET: Joi.string().required(),
    JWT_EXPIRES_IN: Joi.string().default('2h'),
    // Platform superadmin, created on startup when no user has SUPERADMIN_EMAIL
    SUPERADMIN_NAME: Joi.string().required(),
    SUPERADMIN_EMAIL: Joi.string().email().required(),
    SUPERADMIN_PASSWORD: Joi.string().required(),
}).unknown(true);

const { error, value } = envsSchema.validate(process.env);

if (error) {
     throw new Error(`Config validation error: ${ error }`);
}

const envVars: EnvVars = value;

export const envs = {
    port: envVars.PORT,
    databaseUrl: envVars.DATABASE_URL,
    jwtSecret: envVars.JWT_SECRET,
    jwtExpiresIn: envVars.JWT_EXPIRES_IN,
    superadmin: {
        name: envVars.SUPERADMIN_NAME,
        email: envVars.SUPERADMIN_EMAIL,
        password: envVars.SUPERADMIN_PASSWORD,
    },
}
